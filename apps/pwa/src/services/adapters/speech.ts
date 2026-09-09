/**
 * SPOKEN WARNINGS - the switch that promised speech and spoke nothing.
 *
 * THE RULE THIS FILE ENFORCES
 *   A turn cue never talks over a camera warning. Camera and abuse-area speech
 *   is the warning; navigation speech is a convenience. When the two collide
 *   the warning wins, and it wins by INTERRUPTING rather than by waiting.
 *
 * WHAT WAS BROKEN
 *   Three things already promised this and none of them reached a platform API.
 *   `features/map/MapViewPanel.tsx` ships a "Spoken warnings" switch whose
 *   on-state reads "distance and side, once per camera"; `stores/settings.ts`
 *   carries `audio: true`; `stores/alert.ts` exports `useShouldSpeak()`. There
 *   was no `speechSynthesis` reference anywhere in `src` -- `services/alerts/
 *   delivery.ts` says so in its own header -- so pressing "test alert" was
 *   silent by construction, not by a bug in the gate.
 *
 * PRIORITY, IMPLEMENTED RATHER THAN HOPED FOR
 *   `camera-alert` and `abuse-area` call `cancel()` first, so they cut off
 *   whatever is mid-sentence. `navigation` is DROPPED when anything is already
 *   speaking or queued.
 *
 *   Queueing is the tempting third option and it is the wrong one. The web
 *   speech queue is FIFO with no priority, so a turn cue queued behind a camera
 *   warning is spoken after the junction it was describing -- an instruction
 *   that is not merely late but actively wrong, and one the driver cannot tell
 *   from a correct one. Dropping it loses a cue the driver can still read off
 *   the screen. Queueing it invents a cue that no longer matches the road.
 *
 *   The same reasoning is why the warning cancels instead of queueing behind a
 *   turn cue: "camera in 400 feet" delivered after the camera is passed is not
 *   a warning at all.
 *
 * PLATES ARE NOT THIS ADAPTER'S GUARD, AND THAT IS DELIBERATE
 *   Two halves, and only one of them is enforceable here.
 *
 *   STRUCTURAL, and it is real: `watchlist` is not a `SpeechSource`. The one
 *   surface in this product that holds a plate cannot address this adapter at
 *   all, the way `notifications.ts` gives the watchlist card no parameter a
 *   plate could travel through. That is the same guarantee, made the same way.
 *
 *   FREE TEXT, which the caller owns. `speak()` takes a string, so a caller
 *   could put anything in it, and there is no regular expression that separates
 *   a plate from a road: a US plate is 5-8 alphanumerics and so is "US 69",
 *   "I-435", "K-10", "MO 152" and half the numbered streets in Kansas City. A
 *   guard that ate those would silence real turn instructions, and one loose
 *   enough not to would catch nothing. So there is no guard, and the callers
 *   carry it instead: `services/alerts/delivery.ts` builds camera and abuse
 *   text from the structured fields of `CameraAlertPayload` / `AbuseAreaPayload`
 *   (a distance, a bearing phrase, a county, a count -- no plate is reachable),
 *   and navigation text is the router's own `instruction` string out of
 *   `services/route/maneuvers.ts`, which is a street name by design and never
 *   reads a plate. Anything else that wants to speak has to justify itself
 *   against this paragraph first.
 *
 * WHAT "ok" MEANS HERE - ACCEPTED, NOT SPOKEN
 *   `speechSynthesis.speak()` returns void and reports nothing synchronously.
 *   It is a request to a queue owned by the OS, which may refuse it for a
 *   missing voice pack, an audio focus loss to a phone call, a Bluetooth route
 *   change, or an iOS autoplay policy that wants a gesture first. So `ok: true`
 *   means the utterance was handed over and nothing threw -- the same honesty
 *   problem `vibration.ts` has with `navigator.vibrate`, and the same answer.
 *   The one late signal the platform does give is the utterance `error` event,
 *   and it is wired to `core.fail` so a silent failure at least lands somewhere
 *   a screen can read.
 *
 * WHAT THE PLATFORM WILL NOT PROMISE
 *   Speech stops when the page is backgrounded or the screen locks on most
 *   engines, exactly like the rest of the foreground-only stack. The wake lock
 *   adapter is what keeps DRIVE alive; this adapter does not work around it and
 *   does not claim to.
 *
 * NAMING
 *   `speechRecognition.ts` already owns `SpeechAdapter`, `createSpeechAdapter`
 *   and `speechCapability` in the `./index` barrel, and that is the ear rather
 *   than the mouth. The factory and capability probe here are named for
 *   synthesis so both can be re-exported. `SpeechResult` is the one name that
 *   still collides; the barrel has to alias one of the two.
 */

import { createCore } from './core';
import { errorMessage, globalValue, no, ok, type Adapter, type Capability } from './types';

/**
 * Every caller allowed to speak. `watchlist` is absent on purpose - see the
 * plate paragraph in the header. Adding a member here is a privacy decision,
 * not a plumbing one.
 */
export type SpeechSource = 'camera-alert' | 'abuse-area' | 'navigation';

export interface SpeechRequest {
  readonly source: SpeechSource;
  /** Already composed for the ear. The caller owns what is in it. */
  readonly text: string;
}

/**
 * `accepted` is handed to the OS queue. `dropped` is the priority rule doing
 * its job. The rest are the ways this never reached a speaker at all.
 */
export type SpeechOutcome = 'accepted' | 'dropped' | 'blocked' | 'unsupported' | 'failed';

export interface SpeechResult {
  /** Accepted by the platform. NOT "the driver heard it" - see the header. */
  readonly ok: boolean;
  readonly source: SpeechSource;
  readonly outcome: SpeechOutcome;
  /** True when this request cut off something that was already speaking. */
  readonly cancelled: boolean;
  readonly reason?: string;
}

/**
 * Deliberately carries no text. A subscriber - and any future diagnostic path
 * hanging off one - gets the shape of what happened and none of the words, the
 * same trade `NotificationEvent` makes.
 */
export interface SpeechEvent {
  readonly source: SpeechSource;
  readonly outcome: SpeechOutcome;
  readonly cancelled: boolean;
  readonly timestamp: number;
}

export interface SpeechSynthesisAdapter extends Adapter<SpeechEvent> {
  /** Applies the priority rule, then hands the utterance to the platform. */
  speak(request: SpeechRequest): SpeechResult;
  /** Mirrors the "Spoken warnings" switch: false until `start()`. */
  enabled(): boolean;
  /** What the platform says about its own queue, not what we last did. */
  speaking(): boolean;
}

/**
 * VOICE TUNING, CHOSEN FOR A MOVING CAR AND NOT TUNED.
 *
 * 1.1 is a tenth above the platform default. Fast enough that "camera, 400
 * feet, ahead slight left" finishes while the number is still true at 60 mph,
 * slow enough to survive road noise and a phone speaker in a mount. Nobody has
 * run a listening test in an actual car, so this is a defensible starting point
 * rather than a measured one; treat it as a value to revisit, not a constant to
 * respect.
 *
 * PITCH IS DELIBERATELY NOT SET. Every engine ships a different default voice
 * and a pitch offset that flatters one makes another sound synthetic. The
 * platform default is the voice the driver already chose in their OS settings.
 *
 * VOLUME IS DELIBERATELY NOT SET for the same reason plus a worse one: the
 * media volume is a physical control the driver is holding, and an app that
 * quietly overrides it is an app whose warnings are the wrong loudness exactly
 * once, in the car, at speed.
 */
export const SPEECH_RATE = 1.1;

/**
 * The copy this adapter is handed is written in English. Tagging the utterance
 * stops a device set to another locale from reading English words with a voice
 * built for a different phoneme set, which is where text-to-speech stops being
 * merely accented and starts being unintelligible.
 */
export const SPEECH_LANG = 'en-US';

/** Cancels; never yields. The two that mean "a camera is the problem". */
const PRIORITY_SOURCES: readonly SpeechSource[] = ['camera-alert', 'abuse-area'];

/** Exported so a caller can reason about its own request before making it. */
export function isPrioritySource(source: SpeechSource): boolean {
  return PRIORITY_SOURCES.includes(source);
}

/**
 * The platform surface, described structurally so the tests can substitute one.
 * Reached through `globalValue` rather than a bare `speechSynthesis`, the way
 * `notifications.ts` reaches `Notification`: a headless runtime does not have
 * it, and a test has to be able to delete it.
 */
interface UtteranceLike {
  rate: number;
  lang: string;
  onerror: ((event: { readonly error?: string }) => void) | null;
}

type UtteranceCtor = new (text: string) => UtteranceLike;

interface SynthesisLike {
  readonly speaking: boolean;
  readonly pending: boolean;
  speak: (utterance: UtteranceLike) => void;
  cancel: () => void;
}

function synthesis(): SynthesisLike | undefined {
  return globalValue<SynthesisLike>('speechSynthesis');
}

function utteranceCtor(): UtteranceCtor | undefined {
  return globalValue<UtteranceCtor>('SpeechSynthesisUtterance');
}

export function speechSynthesisCapability(): Capability {
  if (synthesis() === undefined) {
    // jsdom has never implemented it, and neither do some Android WebViews
    // shipped without a TTS engine, which is the case that matters.
    return no('this browser cannot speak; warnings will be shown and buzzed instead');
  }
  if (utteranceCtor() === undefined) {
    // Half an API is worse than none, because the capability probe would pass
    // and the failure would surface as silence at the first alert.
    return no('this browser has speech synthesis but nothing to hand it to speak');
  }
  return ok();
}

/** The refusal names the panel the switch is actually on. */
const SWITCHED_OFF = 'spoken warnings are switched off in the map view panel';

export function createSpeechSynthesisAdapter(): SpeechSynthesisAdapter {
  const core = createCore<SpeechEvent>();

  const emit = (result: SpeechResult): SpeechResult => {
    /*
     * Every outcome is published, refusals included. A DROPPED turn cue is the
     * one event with no other trace anywhere - nothing was spoken, nothing was
     * drawn, nothing threw - so if it is not emitted here it is unobservable,
     * and "the app skipped a turn" becomes unanswerable.
     */
    core.emit({
      source: result.source,
      outcome: result.outcome,
      cancelled: result.cancelled,
      timestamp: Date.now(),
    });
    return result;
  };

  return {
    name: 'speech',

    capability: speechSynthesisCapability,

    /**
     * Enable speech. This is the "Spoken warnings" switch, not a permission -
     * there is no prompt in this adapter and nothing here may raise one.
     * Idempotent.
     */
    start(): void {
      const capability = speechSynthesisCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'speech is not available');
        return;
      }
      core.clearError();
      core.setRunning(true);
    },

    /** Disable speech and cut off anything mid-sentence. Idempotent. */
    stop(): void {
      if (core.running()) {
        // Guarded on `running` so a second stop() does not re-cancel, and so
        // stop() on an unsupported platform stays a no-op rather than throwing.
        try {
          synthesis()?.cancel();
        } catch {
          // Nothing was speaking, or the engine went away with the page.
        }
      }
      core.setRunning(false);
    },

    speak(request: SpeechRequest): SpeechResult {
      const source = request.source;

      if (!core.running()) {
        return emit({
          ok: false,
          source,
          outcome: 'blocked',
          cancelled: false,
          reason: SWITCHED_OFF,
        });
      }

      const capability = speechSynthesisCapability();
      if (!capability.supported) {
        return emit({
          ok: false,
          source,
          outcome: 'unsupported',
          cancelled: false,
          reason: capability.reason ?? 'speech is not available',
        });
      }

      const text = request.text.trim();
      if (text === '') {
        // Not a failure. A composer with nothing to say is a normal answer, and
        // an empty utterance would still take the queue away from one that has.
        return emit({
          ok: false,
          source,
          outcome: 'blocked',
          cancelled: false,
          reason: 'there was nothing to say',
        });
      }

      const engine = synthesis();
      const Ctor = utteranceCtor();
      if (engine === undefined || Ctor === undefined) {
        // Unreachable while the capability probe above holds; kept because the
        // alternative is a non-null assertion, which the lint rules forbid and
        // which would be a lie about a global a test is allowed to delete.
        return emit({
          ok: false,
          source,
          outcome: 'unsupported',
          cancelled: false,
          reason: 'speech synthesis went away between the check and the call',
        });
      }

      // THE PRIORITY RULE. `pending` counts as busy: an utterance the engine
      // has accepted but not started is still ahead of this one in the queue.
      const busy = engine.speaking || engine.pending;
      if (busy && !isPrioritySource(source)) {
        return emit({
          ok: false,
          source,
          outcome: 'dropped',
          cancelled: false,
          reason: 'a warning was still speaking; the turn cue was dropped rather than queued',
        });
      }

      let cancelled = false;
      if (busy) {
        try {
          engine.cancel();
          cancelled = true;
        } catch {
          // The queue emptied on its own between the read and the cancel. The
          // utterance below is what matters and it can still go.
        }
      }

      try {
        const utterance = new Ctor(text);
        utterance.rate = SPEECH_RATE;
        utterance.lang = SPEECH_LANG;
        /*
         * The only signal the platform gives after the fact. `speak()` itself
         * says nothing, so without this an engine that refuses the utterance -
         * no voice installed, audio focus lost to a call - is indistinguishable
         * from one that spoke it perfectly.
         */
        utterance.onerror = (event): void => {
          const code =
            event.error === undefined || event.error === '' ? 'speech-error' : event.error;
          core.fail(code, `the warning was not spoken: ${code}`);
        };
        engine.speak(utterance);
      } catch (cause) {
        const reason = errorMessage(cause, 'the browser refused to speak the warning');
        core.fail('speak-failed', reason);
        return emit({ ok: false, source, outcome: 'failed', cancelled, reason });
      }

      core.clearError();
      return emit({ ok: true, source, outcome: 'accepted', cancelled });
    },

    enabled(): boolean {
      return core.running();
    },

    speaking(): boolean {
      return synthesis()?.speaking === true;
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
    subscribeToError: core.subscribeToError,
  };
}
