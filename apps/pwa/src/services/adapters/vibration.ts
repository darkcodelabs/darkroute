/**
 * HAPTICS - reserved for cameras.
 *
 * THE RULE THIS FILE ENFORCES
 *   Alert haptics belong to camera alerts and to nothing else. The county
 *   RECORD notification is explicit about it: "Silent, no vibration - alert
 *   haptics stay reserved for cameras." The watchlist notification is silent
 *   for the same reason. A buzz in this product means a camera, so a buzz that
 *   does not mean a camera is a lie about the road ahead.
 *
 *   That is not left to reviewer discipline. `assertCameraAlertOnly` throws for
 *   any other source, `buzz()` runs it before it can reach `navigator.vibrate`,
 *   and there is no second code path to the platform API.
 *
 * PATTERNS - read off the design, not invented
 *   clear:       "CLEAR · no haptic, no sound"      (App Screens, state matrix)
 *   approaching: "APPROACHING · 1 pulse @ 1000ft"   (App Screens, state matrix)
 *   in_range:    "IN RANGE / ALERT · 2 PULSES"      (Screens II B7 · WEAR)
 *                "alert = 2 haptic pulses"          (Design System, watch rules)
 *   multiple:    "2+ in range · 2-pulse haptic"     (Design System, hue table)
 *
 *   That is 0 / 1 / 2 / 2, which is exactly `HAPTIC_PULSES_BY_STATE` in
 *   packages/core/src/alert.ts. The engine decides how many pulses a tick
 *   deserves; this file decides what a pulse feels like. The two must not
 *   disagree, and `vibration.test.ts` asserts the counts so they cannot.
 *
 * PULSE LENGTH
 *   Not stated either. The pulse and the gap between pulses both come from the
 *   duration scale in tokens.json (`instant`), imported rather than copied, so
 *   there is no raw millisecond value in this file.
 *   See DESIGN-GAPS.md#haptic-pulse-duration.
 *
 * WHAT THE PLATFORM WILL NOT PROMISE
 *   `navigator.vibrate` is absent on iOS Safari entirely, and on Chrome it is
 *   ignored unless the document is visible and has been interacted with. Both
 *   are reported, never worked around.
 */

import tokens from '../../styles/tokens.json';
import { createCore } from './core';
import { nav, no, ok, type Adapter, type AlertState, type Capability } from './types';

/** Every caller that could conceivably want a buzz, named. Only one may. */
export type HapticSource =
  'camera-alert' | 'county-entry' | 'watchlist' | 'mesh-activity' | 'ui-feedback' | 'sync';

export interface VibrationRequest {
  readonly source: HapticSource;
  readonly state: AlertState;
}

export interface VibrationEvent {
  readonly state: AlertState;
  readonly pattern: readonly number[];
  readonly timestamp: number;
}

export interface VibrationResult {
  readonly ok: boolean;
  readonly pattern: readonly number[];
  readonly reason?: string;
}

export interface VibrationAdapter extends Adapter<VibrationEvent> {
  /** Runs the guard, then vibrates. Throws for any non-camera source. */
  buzz(request: VibrationRequest): VibrationResult;
  patternFor(state: AlertState): readonly number[];
  /** Mirrors the settings "Vibration" toggle: false until `start()`. */
  enabled(): boolean;
}

/** One pulse, and the silence between two of them. Both from the token scale. */
const PULSE = tokens.duration.instant; /* GAP: see DESIGN-GAPS.md#haptic-pulse-duration */
const GAP = tokens.duration.instant; /* GAP: see DESIGN-GAPS.md#haptic-pulse-duration */

/**
 * `pulses` -> pattern. One entry per pulse count the engine can produce, so a
 * caller holding `hapticPulses` from packages/core can reach a pattern without
 * re-deriving it from the state.
 */
export const PULSE_PATTERNS: Readonly<Record<0 | 1 | 2, readonly number[]>> = {
  0: [],
  1: [PULSE],
  2: [PULSE, GAP, PULSE],
};

export function patternForPulses(pulses: 0 | 1 | 2): readonly number[] {
  return PULSE_PATTERNS[pulses];
}

/** `clear` is silent by design, not by omission. */
export const CAMERA_ALERT_PATTERNS: Readonly<Record<AlertState, readonly number[]>> = {
  clear: PULSE_PATTERNS[0],
  approaching: PULSE_PATTERNS[1],
  in_range: PULSE_PATTERNS[2],
  multiple: PULSE_PATTERNS[2],
};

/**
 * Thrown when something that is not a camera alert tries to buzz the device.
 * It is a programming error, and it is loud on purpose: a silent `return false`
 * here would let a county notification start buzzing in a later refactor and
 * nobody would find out until a driver braked for a camera that was not there.
 */
export class SilentChannelError extends Error {
  override readonly name = 'SilentChannelError';
  readonly source: HapticSource;

  constructor(source: HapticSource) {
    super(
      `haptics are reserved for camera alerts; "${source}" is a silent channel. ` +
        'County entry and watchlist notifications never vibrate.',
    );
    this.source = source;
  }
}

/**
 * THE GUARD. Every path to `navigator.vibrate` in this codebase goes through
 * it. Exported so a caller can check its own intent before building a request.
 */
/* GAP: see DESIGN-GAPS.md#non-camera-haptics-on-the-watch -- the watch bezel
 * tick and long-press confirmation ask for haptics this guard refuses. */
export function assertCameraAlertOnly(source: HapticSource): asserts source is 'camera-alert' {
  if (source !== 'camera-alert') throw new SilentChannelError(source);
}

export function vibrationCapability(): Capability {
  const navigator = nav();
  if (navigator === undefined) return no('no navigator in this runtime');
  if (typeof navigator.vibrate !== 'function') {
    return no(
      'navigator.vibrate is not available in this browser (ios safari has no vibration api)',
    );
  }
  return ok();
}

export function createVibrationAdapter(): VibrationAdapter {
  const core = createCore<VibrationEvent>();

  const patternFor = (state: AlertState): readonly number[] => CAMERA_ALERT_PATTERNS[state];

  return {
    name: 'vibration',

    capability: vibrationCapability,

    /**
     * Enable haptics. This is the settings "Vibration" toggle, not a permission
     * - there is no prompt anywhere in this adapter. Idempotent.
     */
    start(): void {
      const capability = vibrationCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'vibration is not available');
        return;
      }
      core.clearError();
      core.setRunning(true);
    },

    /** Disable haptics and cancel anything in flight. Idempotent. */
    stop(): void {
      const navigator = nav();
      if (core.running() && navigator && typeof navigator.vibrate === 'function') {
        // 0 cancels an in-flight pattern. Guarded so stop() on an unsupported
        // platform stays a no-op rather than throwing.
        navigator.vibrate(0);
      }
      core.setRunning(false);
    },

    buzz(request: VibrationRequest): VibrationResult {
      // Guard first. Nothing below this line runs for a silent channel.
      assertCameraAlertOnly(request.source);

      const pattern = patternFor(request.state);

      if (!core.running()) {
        return { ok: false, pattern, reason: 'haptics are switched off in settings' };
      }
      const capability = vibrationCapability();
      if (!capability.supported) {
        return { ok: false, pattern, reason: capability.reason ?? 'vibration is not available' };
      }
      if (pattern.length === 0) {
        // `clear` has no haptic. Returning ok:false with a reason keeps the
        // caller honest instead of reporting a buzz that never happened.
        return { ok: false, pattern, reason: 'this alert state is silent by design' };
      }

      const navigator = nav();
      const accepted = navigator?.vibrate([...pattern]) ?? false;
      if (!accepted) {
        core.fail(
          'vibrate-rejected',
          'the browser refused the vibration; it needs a visible page that has been interacted with',
        );
        return { ok: false, pattern, reason: 'the browser refused the vibration' };
      }
      core.clearError();
      core.emit({ state: request.state, pattern, timestamp: Date.now() });
      return { ok: true, pattern };
    },

    patternFor,

    enabled(): boolean {
      return core.running();
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,
  };
}
