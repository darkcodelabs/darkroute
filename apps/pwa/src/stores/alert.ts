/**
 * ALERT - the engine's state, cached, and the ONE gate on delivery.
 * =============================================================================
 * `@fwm/core`'s `AlertEngine` decides everything: the state machine, the
 * hysteresis, the closing test, the dwell, the per-camera mute arithmetic. This
 * slice takes the `AlertTick` it produced and does three things with it -
 * caches it, fans it out to the cameras and history slices, and decides whether
 * the DRIVER is disturbed.
 *
 * THE MUTE RULE, IMPLEMENTED RATHER THAN COMMENTED
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *   count in EXPOSURE, still log to LOOKUP. Muting only removes the alert -
 *   never the record." - Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 *   "MUTED · hue desaturates, data stays live"
 * - Flockys App Screens.dc.html, RADAR state matrix
 *
 *   {@link AlertActions.ingest} therefore runs identically muted or not. The
 *   state transition happens, the assessments are stored, the history row is
 *   written, the exposure counter moves. Mute touches only the DERIVED
 *   delivery fields - {@link AlertSliceState.shouldAlertUser} and the haptic,
 *   notification and takeover channels it gates - and nothing that is part of
 *   the record. `alert.test.ts` drives the same tick sequence twice, muted and
 *   unmuted, and asserts the two records are identical.
 *
 * THE ONE EXCEPTION THE DESIGN ASKS FOR
 *   "RE-ALERT ON MUTED IF closer than 150 ft"
 * - Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 *   A mute is a request for less noise, not a request to be driven past a
 *   camera in silence. Inside that distance the engine alerts anyway, and this
 *   slice honours it: {@link AlertSliceState.mutePierced} says so out loud so
 *   the screen can explain why it just buzzed. Being quieter than the design
 *   here would be the dangerous direction.
 *
 * ONE GATE, AND ONLY ONE
 *   {@link useShouldAlertUser} is the single boolean that authorises sound,
 *   vibration and the screen takeover. No component may assemble its own
 *   version out of `state === 'in_range'` and a mute check - that is how a
 *   muted camera ends up buzzing a phone in a meeting. The per-channel
 *   preferences (`vibration`, `audio`) narrow it further; nothing widens it.
 *
 * A LIVE CAMERA ALERT OUTRANKS EVERYTHING
 *   "A live camera alert always wins the screen." - Screens II, B10.
 *   The takeover is an explicit save/restore of the interrupted sheet or modal,
 *   not a z-index race: dismissing, muting, or the alert simply clearing all
 *   put the driver back exactly where they were.
 *
 * WHAT THIS SLICE NEVER DOES
 *   Arithmetic on a coordinate, a distance or a bearing. Every number it holds
 *   arrived on a tick. There is no `Math.` call in this file for that reason.
 * =============================================================================
 */

import { create } from 'zustand';

import { camerasActions } from './cameras.ts';
import type { AlertState, AlertTick, SuppressionReason } from './fwmCore.ts';
import { historyActions } from './history.ts';
import { navigationActions, useNavigationStore } from './navigation.ts';
import type { ScreenId } from './navigation.ts';
import {
  globalMuteRemainingMs,
  isCameraMutedAt,
  isGloballyMutedAt,
  useSettingsStore,
} from './settings.ts';

export type { AlertState, AlertTick, SuppressionReason };

/**
 * What the takeover layer needs, and what has to be put back afterwards.
 *
 * Frozen and shared when idle, so `useAlertTakeover()` is reference-stable
 * across every tick that does not change the takeover.
 */
export interface AlertTakeover {
  readonly active: boolean;
  readonly cameraId: string | null;
  readonly state: AlertState;
  readonly sinceMs: number | null;
  /** The screen showing when the alert interrupted. */
  readonly interruptedScreen: ScreenId | null;
  /** How many sheets/modals were moved aside. Zero is the common case. */
  readonly interruptedOverlays: number;
}

export const TAKEOVER_IDLE: AlertTakeover = Object.freeze({
  active: false,
  cameraId: null,
  state: 'clear',
  sinceMs: null,
  interruptedScreen: null,
  interruptedOverlays: 0,
});

export interface AlertSliceState {
  readonly state: AlertState;
  readonly previousState: AlertState;
  readonly changedAtMs: number | null;
  readonly lastTickAtMs: number | null;
  readonly ticks: number;
  /** The camera the current state is about, or null. */
  readonly nearestCameraId: string | null;
  /** Its distance, cached from the tick. Never recomputed here. */
  readonly nearestDistanceFt: number | null;
  /** The threshold the engine actually used, after hysteresis. */
  readonly effectiveThresholdFt: number;
  /** The threshold the engine was configured with on that tick. */
  readonly thresholdFt: number;
  readonly isClosing: boolean | null;
  readonly stationary: boolean;
  readonly suppressedBy: readonly SuppressionReason[];

  // -- what the engine said, before this slice decides anything -------------
  /**
   * The engine wants to FIRE on this tick - a fresh edge, past its own
   * notification cooldown. Never read by a component: it is the transient half
   * of the decision, and {@link AlertSliceState.shouldAlertUser} is the gate.
   */
  readonly engineFiring: boolean;
  /**
   * The engine refused to alert for a reason that is not mute: the fix is too
   * inaccurate, or the vehicle has been stationary long enough that a camera it
   * is parked next to stops being news. Both must also shut the takeover.
   */
  readonly engineBlocked: boolean;
  readonly engineHapticPulses: 0 | 1 | 2;
  readonly engineNotifyCameraIds: readonly string[];

  // -- evaluated mute ------------------------------------------------------
  readonly muted: boolean;
  readonly mutedRemainingMs: number;
  /** Cameras individually muted right now. SWEEP greys these, keeps drawing them. */
  readonly mutedCameraIds: readonly string[];
  /**
   * A mute is live, and the camera is close enough that the design says alert
   * anyway ("RE-ALERT ON MUTED IF closer than 150 ft"). The gate is open and
   * the screen should say why.
   */
  readonly mutePierced: boolean;

  // -- the gate ------------------------------------------------------------
  /** THE GATE. Audio, vibration and takeover read this and nothing else. */
  readonly shouldAlertUser: boolean;
  /** 0 whenever the gate is shut. Reserved for cameras. */
  readonly hapticPulses: 0 | 1 | 2;
  /** Empty whenever the gate is shut. */
  readonly notifyCameraIds: readonly string[];

  readonly takeover: AlertTakeover;
  /** Bumped when a non-alerting state becomes an alerting one. */
  readonly episode: number;
  /** The episode the driver dismissed, so it is not re-raised. */
  readonly dismissedEpisode: number | null;

  readonly delivered: number;
  readonly suppressed: number;
  /**
   * Ticks where the engine said "alert" while this slice held a live mute.
   *
   * Should be zero forever. Non-zero means the engine's mute timers and the
   * settings slice's have drifted - a wiring bug, not a user-visible state.
   * The gate has already forced delivery off; this counter is how the bug
   * becomes findable instead of inaudible.
   */
  readonly muteOverrides: number;
}

/** Optional context for the LOG row. Never a coordinate, never a plate. */
export interface IngestContext {
  /** Place name for a camera id ("Vine St & 7th"), or null when unknown. */
  readonly labelFor?: (cameraId: string) => string | null;
  /** Speed at the moment of the alert, for the LOG row. */
  readonly speedMph?: number | null;
  /** Trip odometer delta since the last pass, in miles. */
  readonly distanceMi?: number;
}

export interface AlertActions {
  /** One tick of the driving loop. See the module comment. */
  ingest(tick: AlertTick, context?: IngestContext): void;
  /** "CLEAR ALERT" / swipe away. Ends the takeover, keeps the record. */
  dismiss(): void;
  /** "MUTE 10 MIN". Silences delivery; detection and the record continue. */
  muteAll(nowMs: number, durationMs?: number): void;
  unmuteAll(nowMs: number): void;
  /** "MUTE THIS ONE" from the INTEL CARD. */
  muteCamera(cameraId: string, nowMs: number, durationMs?: number): void;
  unmuteCamera(cameraId: string, nowMs: number): void;
  /** Re-read the mute config against a clock, without a tick. */
  refreshMute(nowMs: number): void;
  reset(): void;
}

export type AlertStore = AlertSliceState & AlertActions;

const NO_REASONS: readonly SuppressionReason[] = Object.freeze([]);
const NO_IDS: readonly string[] = Object.freeze([]);

const INITIAL_STATE: AlertSliceState = Object.freeze({
  state: 'clear',
  previousState: 'clear',
  changedAtMs: null,
  lastTickAtMs: null,
  ticks: 0,
  nearestCameraId: null,
  nearestDistanceFt: null,
  effectiveThresholdFt: 0,
  thresholdFt: 0,
  isClosing: null,
  stationary: false,
  suppressedBy: NO_REASONS,
  engineFiring: false,
  engineBlocked: false,
  engineHapticPulses: 0,
  engineNotifyCameraIds: NO_IDS,
  muted: false,
  mutedRemainingMs: 0,
  mutedCameraIds: NO_IDS,
  mutePierced: false,
  shouldAlertUser: false,
  hapticPulses: 0,
  notifyCameraIds: NO_IDS,
  takeover: TAKEOVER_IDLE,
  episode: 0,
  dismissedEpisode: null,
  delivered: 0,
  suppressed: 0,
  muteOverrides: 0,
});

/** The two states that authorise a takeover. `approaching` never takes the screen. */
export function isAlertingState(state: AlertState): boolean {
  return state === 'in_range' || state === 'multiple';
}

/**
 * Suppressions that must also shut the gate, as opposed to merely delaying the
 * next buzz.
 *
 * `cooldown` is deliberately NOT here. It means "the engine already told you
 * about this camera thirty seconds ago", which is a reason not to buzz again -
 * not a reason to tear the takeover off the screen while the camera is still
 * in range. Treating the two the same is how a live alert flickers.
 */
export function blocksDelivery(reasons: readonly SuppressionReason[]): boolean {
  return reasons.some((reason) => reason === 'accuracy' || reason === 'stationary');
}

/**
 * "RE-ALERT ON MUTED IF closer than 150 ft" - B4.
 *
 * Distance is taken from the tick, never measured here. The threshold is the
 * driver's own setting, defaulted from `@fwm/core`.
 */
export function mutePierces(
  nearestDistanceFt: number | null,
  reAlertWhenCloserThanFt: number,
): boolean {
  return nearestDistanceFt !== null && nearestDistanceFt < reAlertWhenCloserThanFt;
}

function liveMutedCameraIds(
  mutedCameras: Readonly<Record<string, number>>,
  nowMs: number,
): readonly string[] {
  const live: string[] = [];
  for (const [cameraId, until] of Object.entries(mutedCameras)) {
    if (until > nowMs) live.push(cameraId);
  }
  return live.length === 0 ? NO_IDS : Object.freeze(live);
}

/** The engine's camera answers, handed to the cameras slice in one write. */
function fanOutToCameras(tick: AlertTick): void {
  camerasActions.applyAssessment({
    assessments: tick.cameras,
    nearest: tick.nearest,
    countInRange: tick.countInRange,
  });
}

export function createAlertStore() {
  return create<AlertStore>()((set, get) => {
    /**
     * WHICH CAMERAS WERE IN RANGE ON THE LAST TICK.
     *
     * =======================================================================
     * THE BUG THIS EXISTS FOR
     * =======================================================================
     * The log recorded ONE camera per tick -- `nearestId` -- so driving
     * through a cluster of four wrote a single entry. `tick.cameras` carried
     * all four and `tick.countInRange` counted all four; only the log threw
     * them away. Reported as "the log is definitely not saving all the things
     * you've passed", and it was right: a pass is per CAMERA and the log was
     * keeping a per-SCREEN record.
     *
     * `isCameraPass` (features/log/exposure.ts) reads a transition INTO an
     * alerting state, so detecting one per camera needs the previous tick's
     * membership. The engine does not carry it -- `CameraAssessment.inRange`
     * is this tick only -- so the store remembers it.
     *
     * A ref, not store state: it is read once per tick to compute a diff and
     * nothing renders from it, so putting it in the store would be a re-render
     * per GPS fix for a value no screen reads.
     */
    let previouslyInRange: ReadonlySet<string> = new Set();
    /** Move any sheet/modal aside and remember what was moved. */
    function beginTakeover(cameraId: string | null, state: AlertState, atMs: number): AlertTakeover {
      const before = useNavigationStore.getState();
      const interruptedOverlays = before.overlays.length;
      navigationActions.saveForAlert();
      return Object.freeze({
        active: true,
        cameraId,
        state,
        sinceMs: atMs,
        interruptedScreen: before.screen,
        interruptedOverlays,
      });
    }

    /** Put the interrupted stack back, under anything opened during the alert. */
    function endTakeover(current: AlertTakeover): AlertTakeover {
      if (!current.active) return current;
      navigationActions.restoreAfterAlert();
      return TAKEOVER_IDLE;
    }

    /**
     * Recompute the gate from the cached engine verdict plus the mute config.
     *
     * The engine's verdict is kept separately from the gate precisely so that
     * un-muting mid-episode can re-open the gate without waiting for the next
     * position fix - at 47 mph, a tick is a car length.
     */
    function reevaluate(nowMs: number): void {
      const settings = useSettingsStore.getState();
      const current = get();
      const globallyMuted = isGloballyMutedAt(settings, nowMs);
      const cameraMuted =
        current.nearestCameraId !== null &&
        isCameraMutedAt(settings, current.nearestCameraId, nowMs);
      const alerting = isAlertingState(current.state);
      const pierced =
        (globallyMuted || cameraMuted) &&
        mutePierces(current.nearestDistanceFt, settings.reAlertWhenCloserThanFt);
      const silencedByMute = (globallyMuted || cameraMuted) && !pierced;
      const deliver =
        alerting &&
        !silencedByMute &&
        !current.engineBlocked &&
        current.dismissedEpisode !== current.episode;

      const takeover = deliver
        ? current.takeover.active
          ? current.takeover
          : beginTakeover(current.nearestCameraId, current.state, nowMs)
        : endTakeover(current.takeover);

      set({
        muted: globallyMuted,
        mutedRemainingMs: globalMuteRemainingMs(settings, nowMs),
        mutedCameraIds: liveMutedCameraIds(settings.mutedCameras, nowMs),
        mutePierced: pierced,
        shouldAlertUser: deliver,
        hapticPulses: deliver && current.engineFiring ? current.engineHapticPulses : 0,
        notifyCameraIds: deliver && current.engineFiring ? current.engineNotifyCameraIds : NO_IDS,
        takeover,
      });
    }

    return {
      ...INITIAL_STATE,

      ingest(tick, context = {}) {
        const nowMs = tick.timestampMs;

        // Expire mute timers against the tick's clock. No store runs a timer.
        useSettingsStore.getState().pruneMutes(nowMs);
        const settings = useSettingsStore.getState();

        const globallyMuted = isGloballyMutedAt(settings, nowMs);
        const nearestId = tick.nearest?.id ?? null;
        const cameraMuted = nearestId !== null && isCameraMutedAt(settings, nearestId, nowMs);

        const previous = get();
        const alerting = isAlertingState(tick.state);
        const wasAlerting = isAlertingState(previous.state);
        // A new episode starts when a non-alerting state becomes an alerting
        // one. Dismissing silences THIS episode, never the next camera.
        const newEpisode = alerting && !wasAlerting;
        const episode = newEpisode ? previous.episode + 1 : previous.episode;
        const dismissedEpisode = newEpisode ? null : previous.dismissedEpisode;

        // Belt and braces. The engine already suppresses delivery while muted;
        // if it ever disagrees with the settings slice, the mute wins and the
        // disagreement is counted rather than silently resolved.
        const anyMute = globallyMuted || cameraMuted;
        // The design's own exception, honoured rather than second-guessed.
        const pierced =
          anyMute && mutePierces(tick.nearest?.distanceFt ?? null, settings.reAlertWhenCloserThanFt);
        const silencedByMute = anyMute && !pierced;
        // A genuine disagreement is the engine firing while a mute applies AND
        // the pierce does not. Anything else is the design working.
        const muteConflict = tick.shouldAlertUser && silencedByMute;
        const blocked = blocksDelivery(tick.suppressedBy);
        // THE GATE. True for as long as the driver may be disturbed by this
        // episode - not just on the tick the engine chose to buzz.
        const deliver = alerting && !silencedByMute && !blocked && dismissedEpisode !== episode;
        // The transient edge inside the gate: the engine's own cooldown decides
        // when a NEW pulse or notification is warranted.
        const firing = deliver && tick.shouldAlertUser;

        // --- THE RECORD. Byte-identical muted or not. ----------------------
        fanOutToCameras(tick);

        /*
         * ONE ENTRY PER CAMERA THAT JUST CAME INTO RANGE.
         *
         * Runs regardless of `tick.changed`, because that flag is about the
         * SCREEN's state: a second camera entering range while the first is
         * still in range does not change it, and used to be recorded nowhere.
         *
         * The nearest is excluded when the block below is about to record it,
         * so the two paths cannot write the same pass twice.
         */
        const nowInRange = new Set(
          tick.cameras.filter((camera) => camera.inRange).map((camera) => camera.id),
        );
        const newlyInRange = tick.cameras.filter(
          (camera) => camera.inRange && !previouslyInRange.has(camera.id),
        );
        for (const camera of newlyInRange) {
          historyActions.record({
            cameraId: camera.id,
            label: context.labelFor?.(camera.id) ?? null,
            atMs: nowMs,
            // Per-camera, not per-screen: this camera was not in range and now
            // is, which is exactly what `isCameraPass` looks for.
            state: 'in_range',
            previousState: 'clear',
            distanceFt: camera.distanceFt,
            speedMph: context.speedMph ?? null,
            headingDeg: camera.bearingDeg,
            muted: anyMute || camera.muted,
          });
          // Unconditionally, and `distanceMi` may be undefined -- `notePass`
          // defaults it to 0. Guarding on it here meant a tick ingested with no
          // context counted no exposure at all, which took `exposurePasses` to
          // zero and broke the muted-and-unmuted-are-identical invariant.
          historyActions.notePass(camera.id, context.distanceMi);
        }
        previouslyInRange = nowInRange;

        /*
         * THE SCREEN-STATE RECORD, which is a different thing from a pass.
         *
         * It draws the timeline: approaching, clearing, the states an encounter
         * moves through. `isCameraPass` also reads it, though, so when it is
         * pass-shaped AND about a camera the loop above just wrote, it is the
         * same pass twice and EXPOSURE reads high. Suppressed in exactly that
         * case and in no other -- an approaching or clearing transition still
         * draws its row.
         */
        const screenEntryIsAPass =
          isAlertingState(tick.state) && !isAlertingState(tick.previousState);
        const loopAlreadyWroteNearest =
          nearestId !== null && newlyInRange.some((camera) => camera.id === nearestId);

        if (tick.changed && !(screenEntryIsAPass && loopAlreadyWroteNearest)) {
          historyActions.record({
            cameraId: nearestId,
            label: nearestId === null ? null : (context.labelFor?.(nearestId) ?? null),
            atMs: nowMs,
            state: tick.state,
            previousState: tick.previousState,
            distanceFt: tick.nearest?.distanceFt ?? null,
            speedMph: context.speedMph ?? null,
            headingDeg: tick.nearest?.bearingDeg ?? null,
            // Written down, never acted on.
            muted: anyMute,
          });
          // A camera pass counts in EXPOSURE whether or not it was audible.
          // Skipped when the per-camera loop already counted this one, for the
          // same reason the record above is.
          if (newEpisode && nearestId !== null && !loopAlreadyWroteNearest) {
            historyActions.notePass(nearestId, context.distanceMi);
          }
        }

        // --- THE TAKEOVER --------------------------------------------------
        let takeover = previous.takeover;
        if (deliver && !takeover.active) {
          takeover = beginTakeover(nearestId, tick.state, nowMs);
        } else if (takeover.active && !deliver) {
          takeover = endTakeover(takeover);
        } else if (takeover.active && takeover.state !== tick.state) {
          // Escalation inside a live takeover (in_range -> multiple). The saved
          // stack is untouched; only what the layer renders changes.
          takeover = Object.freeze({ ...takeover, state: tick.state, cameraId: nearestId });
        }

        set({
          state: tick.state,
          previousState: tick.previousState,
          changedAtMs: tick.changed ? nowMs : previous.changedAtMs,
          lastTickAtMs: nowMs,
          ticks: previous.ticks + 1,
          nearestCameraId: nearestId,
          nearestDistanceFt: tick.nearest?.distanceFt ?? null,
          effectiveThresholdFt: tick.effectiveThresholdFt,
          thresholdFt: tick.thresholdFt,
          isClosing: tick.isClosing,
          stationary: tick.stationary,
          suppressedBy:
            tick.suppressedBy.length === 0 && !muteConflict ? NO_REASONS : tick.suppressedBy,
          engineFiring: tick.shouldAlertUser,
          engineBlocked: blocked,
          engineHapticPulses: tick.hapticPulses,
          engineNotifyCameraIds: tick.notifyCameraIds,
          muted: globallyMuted,
          mutedRemainingMs: globalMuteRemainingMs(settings, nowMs),
          mutedCameraIds: liveMutedCameraIds(settings.mutedCameras, nowMs),
          mutePierced: pierced,
          shouldAlertUser: deliver,
          hapticPulses: firing ? tick.hapticPulses : 0,
          notifyCameraIds: firing ? tick.notifyCameraIds : NO_IDS,
          takeover,
          episode,
          dismissedEpisode,
          delivered: previous.delivered + (firing ? 1 : 0),
          suppressed: previous.suppressed + (tick.suppressedBy.length > 0 ? 1 : 0),
          muteOverrides: previous.muteOverrides + (muteConflict ? 1 : 0),
        });
      },

      dismiss() {
        const current = get();
        set({
          dismissedEpisode: current.episode,
          shouldAlertUser: false,
          hapticPulses: 0,
          notifyCameraIds: NO_IDS,
          takeover: endTakeover(current.takeover),
        });
      },

      muteAll(nowMs, durationMs) {
        useSettingsStore.getState().muteAll(nowMs, durationMs);
        reevaluate(nowMs);
      },

      unmuteAll(nowMs) {
        useSettingsStore.getState().unmuteAll();
        reevaluate(nowMs);
      },

      muteCamera(cameraId, nowMs, durationMs) {
        useSettingsStore.getState().muteCamera(cameraId, nowMs, durationMs);
        reevaluate(nowMs);
      },

      unmuteCamera(cameraId, nowMs) {
        useSettingsStore.getState().unmuteCamera(cameraId);
        reevaluate(nowMs);
      },

      refreshMute(nowMs) {
        reevaluate(nowMs);
      },

      reset() {
        const current = get();
        if (current.takeover.active) navigationActions.restoreAfterAlert();
        set({ ...INITIAL_STATE });
      },
    };
  });
}

export const useAlertStore = createAlertStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The state machine. Hue means this and nothing else. */
export const useAlertState = (): AlertState => useAlertStore((s) => s.state);

/**
 * THE GATE.
 *
 * The only thing in this codebase that authorises a sound, a vibration or the
 * screen takeover. If a component needs to know "may I disturb the driver",
 * this is the answer, and there is deliberately no second way to arrive at it.
 */
export const useShouldAlertUser = (): boolean => useAlertStore((s) => s.shouldAlertUser);

/** The takeover state. Reference-stable while nothing about it changes. */
export const useAlertTakeover = (): AlertTakeover => useAlertStore((s) => s.takeover);

export const useIsAlertTakeoverActive = (): boolean => useAlertStore((s) => s.takeover.active);

/** Global mute. `useIsCameraMuted` answers the per-camera question. */
export const useIsMuted = (): boolean => useAlertStore((s) => s.muted);

export const useIsCameraMuted = (cameraId: string): boolean =>
  useAlertStore((s) => s.muted || s.mutedCameraIds.includes(cameraId));

/**
 * True when the alert is sounding THROUGH a live mute because the camera is
 * inside the re-alert distance. The screen should say so - an unexplained buzz
 * after the driver muted reads as a bug.
 */
export const useMutePierced = (): boolean => useAlertStore((s) => s.mutePierced);

/** "MUTED 8:12". Milliseconds; the screen formats it. */
export const useMuteRemainingMs = (): number => useAlertStore((s) => s.mutedRemainingMs);

export const useMutedCameraIds = (): readonly string[] => useAlertStore((s) => s.mutedCameraIds);

export const useEffectiveThresholdFt = (): number => useAlertStore((s) => s.effectiveThresholdFt);

export const useIsClosing = (): boolean | null => useAlertStore((s) => s.isClosing);

export const useIsStationary = (): boolean => useAlertStore((s) => s.stationary);

export const useSuppressionReasons = (): readonly SuppressionReason[] =>
  useAlertStore((s) => s.suppressedBy);

export const useAlertTickCount = (): number => useAlertStore((s) => s.ticks);

/**
 * Haptic pulses for this moment: 0 · 1 · 2, and 0 whenever the gate is shut.
 *
 * "Alert haptics stay reserved for cameras" (B10 · 3): county-entry and
 * watchlist notifications are silent, and the vibration adapter refuses any
 * other source outright.
 */
export const useHapticPulses = (): 0 | 1 | 2 => useAlertStore((s) => s.hapticPulses);

/** The gate, narrowed by the "Vibration" component toggle. Never widened. */
export const useShouldVibrate = (): boolean => {
  const gate = useAlertStore((s) => s.shouldAlertUser);
  const enabled = useSettingsStore((s) => s.vibration);
  return gate && enabled;
};

/** The gate, narrowed by the audio toggle. "SPOKEN ALOUD IF AUDIO IS ON". */
export const useShouldSpeak = (): boolean => {
  const gate = useAlertStore((s) => s.shouldAlertUser);
  const enabled = useSettingsStore((s) => s.audio);
  return gate && enabled;
};

export const alertActions = {
  ingest: (tick: AlertTick, context?: IngestContext): void => {
    useAlertStore.getState().ingest(tick, context);
  },
  dismiss: (): void => {
    useAlertStore.getState().dismiss();
  },
  muteAll: (nowMs: number, durationMs?: number): void => {
    useAlertStore.getState().muteAll(nowMs, durationMs);
  },
  unmuteAll: (nowMs: number): void => {
    useAlertStore.getState().unmuteAll(nowMs);
  },
  muteCamera: (cameraId: string, nowMs: number, durationMs?: number): void => {
    useAlertStore.getState().muteCamera(cameraId, nowMs, durationMs);
  },
  unmuteCamera: (cameraId: string, nowMs: number): void => {
    useAlertStore.getState().unmuteCamera(cameraId, nowMs);
  },
  refreshMute: (nowMs: number): void => {
    useAlertStore.getState().refreshMute(nowMs);
  },
  reset: (): void => {
    useAlertStore.getState().reset();
  },
};

/** One call for the driving loop. Named for what it is at the call site. */
export function ingestAlertTick(tick: AlertTick, context?: IngestContext): void {
  alertActions.ingest(tick, context);
}
