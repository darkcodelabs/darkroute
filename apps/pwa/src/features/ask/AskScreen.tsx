/**
 * ASK -- the voice screen. `04 · ASK - LISTENING`.
 *
 * =============================================================================
 * THE MICROPHONE OPENS FROM A PRESS AND FROM NOWHERE ELSE
 * =============================================================================
 * There is exactly one call to `startPushToTalk()` per press path and exactly
 * one call to `start({ mode: 'wake-word' })` in this file, and all of them are
 * inside `onClick` handlers. The mount effects do three things, all of them
 * passive:
 *
 *   capability()            synchronous feature detection. Reads globals.
 *   wakeWordCapability()    the same, plus a `document.visibilityState` read.
 *   subscribe()             registers a listener. It does not start a session.
 *
 * `WAKE WORD ON` is drawn armed in the design. It ships DISARMED, because
 * rendering it armed would mean the app opens the microphone the moment ASK
 * appears. `AskScreen.test.tsx` proves the mount case by counting the mock
 * adapter's starts and requests after a render and asserting zero.
 *
 * =============================================================================
 * THE SCREEN MAY NEVER ANIMATE A MICROPHONE THAT IS SHUT
 * =============================================================================
 * The adapter has no outbound signal for "the session ended". `core.fail()`
 * records an error without notifying subscribers, and the recogniser's `end`
 * event flips the adapter's own flag silently -- so a denied permission prompt,
 * or Chrome ending the session on silence (docs/platform-capabilities.md), used
 * to leave this screen painting cyan bars and `LISTENING…` at a closed
 * microphone forever.
 *
 * Until the adapter can say so, {@link AskScreen} watches it: while, and only
 * while, the phase is `listening`, a short interval re-reads `listening()` and
 * drops the screen back to idle -- rendering the adapter's own error if it left
 * one -- the moment the session is gone. The watch starts on the press that
 * opened the microphone and is cleared the instant the phase changes.
 * GAP: see docs/gaps-inbox/ask.md#the-listening-state-has-to-be-polled
 *
 * =============================================================================
 * NOTHING SAID HERE IS PERSISTED, LOGGED, SHARED OR SENT
 * =============================================================================
 * The transcript lives in one `useState` for as long as the screen is mounted.
 * It is never written to storage, never put in the URL, never attached to a
 * notification, never logged and never handed to any store. A spoken question
 * can contain a licence plate, and the answering path in `askAnswer.ts` never
 * interpolates the question into its output, so a plate cannot ride out of this
 * screen inside an answer either.
 *
 * The one platform fact that has to be admitted BEFORE the first press is that
 * Chromium's recogniser is network-backed. `sendsAudioOffDevice()` reports it
 * and the notice strip renders it, unpressed -- and it is rendered ALONGSIDE a
 * transient adapter error rather than behind it, so a recogniser hiccup can
 * never take the product's only privacy disclosure off the screen.
 *
 * =============================================================================
 * TWO CAPABILITY ANSWERS, NOT ONE
 * =============================================================================
 * `capability()` gates the voice band (push-to-talk, the dependable path).
 * `wakeWordCapability()` -- a separate, deliberately pessimistic probe -- gates
 * the chip, and its reason is what the notice strip renders instead of a broken
 * promise. See docs/platform-capabilities.md.
 *
 * =============================================================================
 * THE ANSWER IS NOT INVENTED HERE, OR ANYWHERE
 * =============================================================================
 * `resolveAsk()` answers only from numbers the stores already hold and refuses
 * everything else by name. This file supplies the facts and renders whatever
 * comes back. It does no arithmetic, no geospatial work and no routing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

import { openScreen } from '../../app/screenState.ts';
import { FEATURES } from '../../config/features.ts';
import { createPlatformAdapters } from '../../services/adapters';
import type { AdapterSet, Capability } from '../../services/adapters';
import {
  useCachedCameras,
  useCountInRange,
  useGpsStatus,
  useNearestCamera,
  useTodayPasses,
} from '../../stores';

import { resolveAsk } from './askAnswer.ts';
import type { AskAnswer, AskFacts } from './askAnswer.ts';
import { AskView } from './components/AskView.tsx';
import type { AskViewProps } from './components/AskView.tsx';
import type { AskNoticeState, AskPhase, AskViewModel } from './components/AskView.tsx';
import { TRY_CHIPS } from './components/TryChips.tsx';
import type { WakeWordState } from './components/WakeWordChip.tsx';

import './ask.css';

/**
 * The one authored sentence in the notice strip. Cadenced on RADAR's
 * `NO NETWORK · RUNNING ON CACHE`; the fact itself is the adapter's
 * `sendsAudioOffDevice()`, not an assumption made here.
 * GAP: see docs/gaps-inbox/ask.md#off-device-audio-warning-is-authored
 */
const OFF_DEVICE_NOTICE = 'AUDIO LEAVES THE PHONE · THIS BROWSER USES A REMOTE SPEECH SERVICE';

/**
 * Said when a band press takes the microphone off an armed wake-word session.
 * The adapter runs one session at a time, so the chip really does go off -- and
 * a control that changes another control's state has to say so.
 * GAP: see docs/gaps-inbox/ask.md#a-band-press-takes-the-microphone-from-wake-word
 */
const WAKE_YIELDED = 'WAKE WORD OFF · THE MICROPHONE RUNS ONE SESSION AND PUSH-TO-TALK HAS IT';

/** Unreachable in practice: `reason` is present exactly when unsupported. */
const SPEECH_FALLBACK = 'this browser cannot listen.';
const WAKE_FALLBACK = 'this browser has no wake word.';

/**
 * How often the screen re-reads `listening()` while it claims to be listening.
 * Short enough that a denied prompt does not leave a fake meter running for a
 * noticeable beat, long enough to be nothing on a battery; it runs only while
 * the microphone is supposed to be open.
 */
const LISTENING_WATCH_MS = 250;

/** Answering may be asynchronous when a caller injects its own resolver. */
export type AskResolver = (question: string, facts: AskFacts) => AskAnswer | Promise<AskAnswer>;

function isPromise(value: AskAnswer | Promise<AskAnswer>): value is Promise<AskAnswer> {
  return typeof (value as Promise<AskAnswer>).then === 'function';
}

interface Probe {
  readonly speech: Capability;
  readonly wake: Capability;
  readonly offDevice: boolean;
}

export interface AskScreenProps {
  /**
   * WHICH VIEW DRAWS THE MODEL. Same seam as `SettingsScreen`: the speech
   * adapter, the wake word, the capability probe, the off-device disclosure
   * and the resolver are all the container's. Defaults to v0's view.
   */
  readonly view?: ComponentType<AskViewProps> | undefined;
  /**
   * The platform adapters. Defaults to the real set, which is inert until
   * something calls it -- constructing an adapter touches no browser API.
   */
  readonly adapters?: AdapterSet;
  /**
   * How a question becomes an answer. Defaults to {@link resolveAsk}, which
   * answers only from on-device facts and refuses everything else.
   */
  readonly resolve?: AskResolver;
  /** The TRY chips. Defaults to the three the design draws, in its order. */
  readonly chips?: readonly string[];
  /** Owned by whoever owns routing. Absent renders `TAKE DETOUR` disabled. */
  readonly onTakeDetour?: (() => void) | undefined;
  /** Defaults to opening SWEEP, which is the dock's own behaviour for it. */
  readonly onShowOnSweep?: (() => void) | undefined;
}

export function AskScreen({
  adapters: adaptersProp,
  resolve,
  chips: chipsProp,
  onTakeDetour,
  onShowOnSweep,
  view: View = AskView,
}: AskScreenProps = {}): ReactElement {
  // Built once. A new set per render would re-probe on every state change.
  const adapters = useMemo(() => adaptersProp ?? createPlatformAdapters(), [adaptersProp]);
  const speech = adapters.speechRecognition;

  // --- what this platform can actually do ----------------------------------
  // Read once, synchronously, at mount. All three are documented as safe to
  // call at any time and none of them can raise a dialog.
  const [probe, setProbe] = useState<Probe>(() => ({
    speech: speech.capability(),
    wake: speech.wakeWordCapability(),
    offDevice: speech.sendsAudioOffDevice(),
  }));

  const [localPhase, setLocalPhase] = useState<AskPhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [wakeArmed, setWakeArmed] = useState(false);
  /** One line about what just happened. Never displaces a standing disclosure. */
  const [transientNotice, setTransientNotice] = useState<AskNoticeState | null>(null);

  // --- the facts an answer may be built from -------------------------------
  const gps = useGpsStatus();
  const countInRange = useCountInRange();
  const nearest = useNearestCamera();
  const todayPasses = useTodayPasses();
  // Already in memory: the cameras slice's cached records. Read, never fetched.
  const cachedCameras = useCachedCameras();

  const facts: AskFacts = useMemo(
    () => ({
      hasFix: gps === 'lock',
      countInRange,
      nearestDistanceFt: nearest?.distanceFt ?? null,
      nearestDirection: nearest?.relativeDirection ?? null,
      todayPasses,
      plateLookupEnabled: FEATURES.plateLookup,
      cachedCameras,
    }),
    [gps, countInRange, nearest, todayPasses, cachedCameras],
  );

  // Refs so the result subscription can be registered once and still read the
  // newest facts, resolver and answer. Re-subscribing on every fix would drop
  // interim results mid-sentence.
  const factsRef = useRef<AskFacts>(facts);
  const resolveRef = useRef<AskResolver>(resolve ?? resolveAsk);
  const answerRef = useRef<AskAnswer | null>(answer);
  useEffect(() => {
    factsRef.current = facts;
    resolveRef.current = resolve ?? resolveAsk;
    answerRef.current = answer;
  });

  /** The adapter's own last error, as a notice line. Null when it has none. */
  const adapterNotice = useCallback((): AskNoticeState | null => {
    const failure = speech.error();
    return failure === null ? null : { text: failure.message, tone: 'warning' };
  }, [speech]);

  /**
   * A question -> an answer. Also the chip path, which never opens the
   * microphone at all.
   */
  const ask = useCallback((question: string) => {
    if (question.trim() === '') return;
    setTranscript(question);
    setInterim(false);
    setTransientNotice(null);

    const outcome = resolveRef.current(question, factsRef.current);
    if (!isPromise(outcome)) {
      setAnswer(outcome);
      setLocalPhase('answered');
      return;
    }
    setAnswer(null);
    setLocalPhase('answering');
    outcome.then(
      (resolved) => {
        setAnswer(resolved);
        setLocalPhase('answered');
      },
      () => {
        // An answerer that threw has not answered. Say so; do not draw a card.
        setAnswer(null);
        setLocalPhase('idle');
        setTransientNotice({ text: 'that could not be answered.', tone: 'warning' });
      },
    );
  }, []);

  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  }, [ask]);

  // --- results -------------------------------------------------------------
  // `subscribe` registers a listener. It starts nothing and prompts nothing.
  useEffect(
    () =>
      speech.subscribe((result) => {
        setTranscript(result.transcript);
        setInterim(!result.isFinal);
        if (result.isFinal) askRef.current(result.transcript);
      }),
    [speech],
  );

  // The microphone must not survive this screen.
  useEffect(
    () => () => {
      speech.stop();
    },
    [speech],
  );

  // --- the session can end without telling anyone ---------------------------
  // A denied permission prompt, a recogniser error, or Chrome's end-on-silence
  // all leave the adapter idle with no outbound signal. While the screen claims
  // to be listening -- and only then -- it checks.
  useEffect(() => {
    if (localPhase !== 'listening') return undefined;

    const watch = setInterval(() => {
      if (speech.listening()) return;
      setLocalPhase(answerRef.current === null ? 'idle' : 'answered');
      setWakeArmed(false);
      setTransientNotice(adapterNotice());
    }, LISTENING_WATCH_MS);

    return () => {
      clearInterval(watch);
    };
  }, [localPhase, speech, adapterNotice]);

  // --- the one door to the microphone --------------------------------------
  /** Opens a push-to-talk session and reports whatever the adapter did. */
  const openPushToTalk = useCallback(
    (notice: AskNoticeState | null) => {
      setTranscript('');
      setInterim(false);
      setAnswer(null);
      setTransientNotice(notice);
      speech.startPushToTalk();

      if (speech.listening()) {
        setLocalPhase('listening');
        return;
      }
      // It refused. Render the reason rather than an animation of nothing.
      setTransientNotice(adapterNotice());
      setLocalPhase('idle');
    },
    [speech, adapterNotice],
  );

  const toggleListening = useCallback(() => {
    if (speech.listening()) {
      if (wakeArmed) {
        // The adapter runs one session at a time, so a push-to-talk question
        // has to take the microphone off the wake-word session. It does that
        // rather than only tearing down -- a press on the band must always be
        // a way to ask something -- and it says that the chip went off.
        speech.stop();
        setWakeArmed(false);
        openPushToTalk({ text: WAKE_YIELDED, tone: 'unsupported' });
        return;
      }
      // A push-to-talk session is stopped so the final transcript still lands.
      speech.stopPushToTalk();
      setLocalPhase(answerRef.current === null ? 'idle' : 'answered');
      return;
    }

    openPushToTalk(null);
  }, [speech, wakeArmed, openPushToTalk]);

  const toggleWakeWord = useCallback(() => {
    if (wakeArmed) {
      speech.stop();
      setWakeArmed(false);
      setLocalPhase('idle');
      return;
    }

    // Re-probed at the press, not trusted from mount: the pessimistic answer
    // depends on visibility, and visibility changes.
    const wake = speech.wakeWordCapability();
    setProbe((current) => ({ ...current, wake }));
    if (!wake.supported) {
      setTransientNotice({ text: wake.reason ?? WAKE_FALLBACK, tone: 'unsupported' });
      return;
    }

    setTransientNotice(null);
    speech.start({ mode: 'wake-word' });
    if (speech.listening()) {
      setWakeArmed(true);
      setLocalPhase('listening');
      return;
    }
    setTransientNotice(adapterNotice());
  }, [speech, wakeArmed, adapterNotice]);

  // --- wake word cannot outlive the screen being on screen ------------------
  // "wake word only runs while darkroute is on screen; it stops when the screen
  //  locks" -- docs/platform-capabilities.md. The adapter enforces it; this
  // reflects it, and re-reads the adapter's own reason rather than restating it.
  // The watch is started only while armed, so nothing observes the page until
  // the driver has asked for something that needs it.
  useEffect(() => {
    if (!wakeArmed) return undefined;
    const visibility = adapters.visibility;
    visibility.start();
    const off = visibility.subscribe((state) => {
      if (state.visibility !== 'hidden') return;
      speech.stop();
      setWakeArmed(false);
      setLocalPhase('idle');
      setProbe((current) => ({ ...current, wake: speech.wakeWordCapability() }));
    });
    return () => {
      off();
      visibility.stop();
    };
  }, [wakeArmed, adapters, speech]);

  // --- presentation --------------------------------------------------------
  const phase: AskPhase = probe.speech.supported ? localPhase : 'unavailable';

  const wakeWord: WakeWordState = !probe.wake.supported ? 'unavailable' : wakeArmed ? 'on' : 'off';

  /**
   * At most one transient line, at most one capability line, and the standing
   * privacy disclosure -- in that order, deduplicated by text.
   *
   * The disclosure is LAST but it is not lowest priority: it is additive. An
   * adapter error used to replace it, which meant the one place the product
   * admits that audio leaves the phone disappeared the first time the
   * recogniser hiccuped.
   */
  const notices = useMemo<readonly AskNoticeState[]>(() => {
    const lines: AskNoticeState[] = [];
    const seen = new Set<string>();
    const add = (line: AskNoticeState | null): void => {
      if (line === null || seen.has(line.text)) return;
      seen.add(line.text);
      lines.push(line);
    };

    add(transientNotice);
    if (!probe.speech.supported) {
      add({ text: probe.speech.reason ?? SPEECH_FALLBACK, tone: 'unsupported' });
    } else if (!probe.wake.supported) {
      add({ text: probe.wake.reason ?? WAKE_FALLBACK, tone: 'unsupported' });
    }
    if (probe.offDevice) add({ text: OFF_DEVICE_NOTICE, tone: 'warning' });
    return lines;
  }, [transientNotice, probe]);

  const chips = useMemo(() => chipsProp ?? TRY_CHIPS, [chipsProp]);

  const showOnSweep = useMemo(
    () =>
      onShowOnSweep ??
      ((): void => {
        openScreen('sweep');
      }),
    [onShowOnSweep],
  );

  const model: AskViewModel = {
    phase,
    wakeWord,
    notices,
    transcript,
    transcriptInterim: interim,
    answer,
    chips,
  };

  return (
    <View
      model={model}
      onToggleListening={toggleListening}
      onToggleWakeWord={toggleWakeWord}
      onAsk={ask}
      onTakeDetour={onTakeDetour}
      onShowOnSweep={showOnSweep}
    />
  );
}
