/**
 * SPEECH RECOGNITION - push-to-talk is the product; wake word is a bonus.
 *
 * ASK is a voice screen ("any cameras on my route home") and on the watch it is
 * voice-only ("W9 · ASK - VOICE ONLY ... SPOKEN ALOUD · NO SCROLLING"). Screen
 * 04 draws a "WAKE WORD ON" chip. This adapter implements both, and is blunt
 * about which of the two the web can actually keep.
 *
 * PUSH-TO-TALK - DEPENDABLE
 *   Hold the key, talk, release. One recognition session per press, started
 *   from the gesture that opened it, ended by the user. This is the path the
 *   screens should treat as always available when `capability().supported`.
 *
 * WAKE WORD - BEST EFFORT, AND ONLY WHILE THE APP IS ON SCREEN
 *   A browser cannot run always-on listening. `SpeechRecognition` is killed
 *   when the document is hidden, the screen locks or the tab is backgrounded;
 *   on Chrome it also streams audio to a Google service and stops on silence.
 *   So: wake word runs ONLY while `document.visibilityState === 'visible'`,
 *   this adapter stops it the moment that changes, and
 *   `wakeWordCapability()` reports the real reason whenever it cannot run.
 *   Nothing in this file claims always-on listening works. It does not.
 *
 * PRIVACY
 *   Recognition means audio leaves the device on Chromium. That is a fact about
 *   the platform, surfaced through `sendsAudioOffDevice`, so a screen can warn
 *   before the first press instead of after.
 */

import { createCore, createListenerBag } from './core';
import {
  doc,
  errorMessage,
  globalValue,
  nav,
  no,
  ok,
  queryPermission,
  type Adapter,
  type Capability,
  type PermissionOutcome,
  type RequestOutcome,
} from './types';

export type SpeechMode = 'push-to-talk' | 'wake-word';

export interface SpeechResult {
  readonly transcript: string;
  readonly isFinal: boolean;
  readonly confidence: number | null;
  readonly mode: SpeechMode;
  readonly timestamp: number;
}

export interface SpeechOptions {
  readonly mode?: SpeechMode;
  readonly lang?: string;
  readonly interim?: boolean;
}

export interface SpeechAdapter extends Adapter<SpeechResult, SpeechOptions> {
  permission(): Promise<PermissionOutcome>;
  request(): Promise<RequestOutcome>;
  /** Honest, separate answer for the wake-word path. Never optimistic. */
  wakeWordCapability(): Capability;
  /** USER GESTURE ONLY. The dependable interaction: hold to talk. */
  startPushToTalk(opts?: SpeechOptions): void;
  /** Release. Ends the session and lets the final result arrive. */
  stopPushToTalk(): void;
  mode(): SpeechMode | null;
  listening(): boolean;
  /** True where recognition is performed by a remote service (Chromium). */
  sendsAudioOffDevice(): boolean;
}

export const DEFAULT_LANG = 'en-US';

interface AlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}
interface ResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: AlternativeLike | undefined;
}
interface ResultListLike {
  readonly length: number;
  readonly [index: number]: ResultLike | undefined;
}
interface SpeechEventLike extends Event {
  readonly resultIndex: number;
  readonly results: ResultListLike;
}
interface SpeechErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}
interface RecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | undefined {
  return (
    globalValue<RecognitionCtor>('SpeechRecognition') ??
    globalValue<RecognitionCtor>('webkitSpeechRecognition')
  );
}

/** Chromium's implementation is the webkit-prefixed, network-backed one. */
function isNetworkBacked(): boolean {
  return (
    globalValue<unknown>('webkitSpeechRecognition') !== undefined &&
    globalValue<unknown>('SpeechRecognition') === undefined
  );
}

export function speechCapability(): Capability {
  if (recognitionCtor() === undefined) {
    return no('speech recognition is not available in this browser');
  }
  const secure = globalValue<boolean>('isSecureContext');
  if (secure === false) {
    return no('the microphone needs a secure context (https or localhost); this page is not one');
  }
  return ok();
}

/**
 * The separate, pessimistic probe. Exported for the ASK screen so the
 * "WAKE WORD ON" chip can render a reason instead of a broken promise.
 */
/* GAP: see DESIGN-GAPS.md#wake-word-is-not-always-on */
export function wakeWordCapability(): Capability {
  const base = speechCapability();
  if (!base.supported) return base;
  const document = doc();
  if (document === undefined) return no('no document, so visibility cannot be honoured');
  if (document.visibilityState === 'hidden') {
    return no('wake word only runs while darkroute is on screen; it stops when the screen locks');
  }
  const Ctor = recognitionCtor();
  if (Ctor === undefined) return no('speech recognition is not available in this browser');
  try {
    const probe = new Ctor();
    if (typeof probe.continuous !== 'boolean') {
      return no('this browser cannot listen continuously, so there is no wake word');
    }
  } catch (cause) {
    return no(errorMessage(cause, 'speech recognition could not be started on this browser'));
  }
  return ok();
}

export function createSpeechAdapter(): SpeechAdapter {
  const core = createCore<SpeechResult>();
  const listeners = createListenerBag();
  let recognition: RecognitionLike | null = null;
  let activeMode: SpeechMode | null = null;
  let isListening = false;

  const teardown = (): void => {
    const active = recognition;
    recognition = null;
    isListening = false;
    activeMode = null;
    listeners.removeAll();
    if (active) {
      try {
        active.abort();
      } catch {
        // Already finished. Nothing to abort.
      }
    }
  };

  const handleResult = (event: Event): void => {
    const speech = event as SpeechEventLike;
    const results = speech.results;
    for (let i = speech.resultIndex; i < results.length; i += 1) {
      const result = results[i];
      if (result === undefined) continue;
      const best = result[0];
      if (best === undefined) continue;
      core.emit({
        transcript: best.transcript,
        isFinal: result.isFinal === true,
        confidence: Number.isFinite(best.confidence) ? best.confidence : null,
        mode: activeMode ?? 'push-to-talk',
        timestamp: Date.now(),
      });
    }
  };

  const begin = (mode: SpeechMode, opts?: SpeechOptions): void => {
    const capability = mode === 'wake-word' ? wakeWordCapability() : speechCapability();
    if (!capability.supported) {
      core.fail(
        mode === 'wake-word' ? 'wake-word-unavailable' : 'unsupported',
        capability.reason ?? 'speech recognition is not available',
      );
      return;
    }
    if (isListening) return; // idempotent: one session at a time

    const Ctor = recognitionCtor();
    if (Ctor === undefined) return;
    try {
      const next = new Ctor();
      next.lang = opts?.lang ?? DEFAULT_LANG;
      next.interimResults = opts?.interim ?? true;
      next.maxAlternatives = 1;
      next.continuous = mode === 'wake-word';

      listeners.on(next, 'result', handleResult);
      listeners.on(next, 'error', (event) => {
        const err = event as SpeechErrorEventLike;
        const code = err.error === '' ? 'speech-error' : err.error;
        core.fail(code, err.message ?? `speech recognition stopped: ${code}`);
      });
      listeners.on(next, 'end', () => {
        isListening = false;
        activeMode = null;
      });

      if (mode === 'wake-word') {
        // The single non-negotiable rule for this mode.
        listeners.on(doc(), 'visibilitychange', () => {
          if (doc()?.visibilityState === 'hidden') {
            core.fail(
              'wake-word-suspended',
              'wake word stopped because darkroute left the screen; press to talk instead',
            );
            teardown();
          }
        });
      }

      recognition = next;
      activeMode = mode;
      isListening = true;
      core.clearError();
      next.start();
    } catch (cause) {
      teardown();
      core.fail('start-failed', errorMessage(cause, 'speech recognition refused to start'));
    }
  };

  return {
    name: 'speechRecognition',

    capability: speechCapability,
    wakeWordCapability,

    async permission(): Promise<PermissionOutcome> {
      if (!speechCapability().supported) return 'unavailable';
      return queryPermission('microphone');
    },

    /**
     * USER GESTURE ONLY. Opens the microphone prompt by taking a stream and
     * immediately giving it back - the shortest possible time holding the mic.
     * Wire it to the ASK screen's first press, never to page load.
     */
    async request(): Promise<RequestOutcome> {
      if (!speechCapability().supported) return 'unavailable';
      const media = nav()?.mediaDevices;
      if (!media || typeof media.getUserMedia !== 'function') return 'unavailable';
      try {
        const stream = await media.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
        return 'granted';
      } catch (cause) {
        core.fail('permission-request-failed', errorMessage(cause, 'microphone access refused'));
        return 'denied';
      }
    },

    /**
     * USER GESTURE ONLY when `mode` is push-to-talk (the default), because the
     * first session triggers the microphone prompt. Idempotent: a second call
     * while a session is live does nothing.
     */
    start(opts?: SpeechOptions): void {
      begin(opts?.mode ?? 'push-to-talk', opts);
    },

    /** Idempotent. Safe when nothing is listening. */
    stop(): void {
      const active = recognition;
      if (active) {
        try {
          active.stop(); // stop(), not abort(): let the final transcript land
        } catch {
          // Session already over.
        }
      }
      teardown();
    },

    startPushToTalk(opts?: SpeechOptions): void {
      begin('push-to-talk', opts);
    },

    stopPushToTalk(): void {
      const active = recognition;
      if (active === null) return;
      try {
        active.stop();
      } catch {
        // Session already over.
      }
      isListening = false;
    },

    mode(): SpeechMode | null {
      return activeMode;
    },

    listening(): boolean {
      return isListening;
    },

    sendsAudioOffDevice(): boolean {
      return isNetworkBacked();
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}
