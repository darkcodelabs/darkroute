/**
 * HAPTICS - what a buzz is allowed to mean.
 *
 * THE RULE THIS FILE ENFORCES
 *   A driver in a mount feels a SHAPE, not a source, so the vocabulary is
 *   three shapes that can be told apart with both eyes on the road:
 *
 *     camera-alert   two firm pulses       THE SIGNATURE. Reserved. Nothing
 *                                          else in this product may use it.
 *     abuse-area     one long, one short   a record of misuse, not a hazard
 *                                          on the road ahead.
 *     navigation     one short pulse       a turn cue, the quietest thing here.
 *
 *   watchlist, mesh-activity, ui-feedback and sync never buzz, on any path, in
 *   any state. They have no pattern at all, and a source with no pattern is a
 *   programming error rather than a quiet no-op: `assertCanBuzz` throws for
 *   every one of them and `buzz()` runs it before anything can reach
 *   `navigator.vibrate`.
 *
 *   This WIDENS the old rule, which was "a buzz in this product means a
 *   camera, full stop" and refused every non-camera source outright. That rule
 *   was protecting the SIGNATURE, not the motor: a driver must never brake for
 *   a buzz that was not a camera. Two pulses still mean a camera and only a
 *   camera. An abuse area entered and a turn coming up are things the driver
 *   asked to be told about, and telling them only on a screen they are not
 *   allowed to look at is not telling them.
 *
 *   None of that is left to reviewer discipline. `SOURCE_PATTERNS` is the
 *   whole table, `patternFor` is the only way to read it, and
 *   `vibration.test.ts` walks every source x every state to prove the camera
 *   signature is unreachable from anything that is not a camera.
 *
 * WHERE THE PATTERNS COME FROM - and why they are not design tokens
 *   `./notifications`, imported, never re-typed. The notification now carries a
 *   `vibrate` pattern of its own, and THAT is the path that survives a dark
 *   screen; this file is the same buzz for the foregrounded app and for a
 *   driver who refused notification permission. One buzz with two definitions
 *   would drift, and the drift would be a driver learning a signature on one
 *   path and not recognising it on the other.
 *
 *   The old patterns came off the duration scale in tokens.json: PULSE and GAP
 *   were both `tokens.duration.instant`, so the camera alert was `[90, 90, 90]`
 *   and the test alert through a pocket or a mount reported it as nothing.
 *   Pointing both at one token is exactly what made them the same number - and
 *   90ms is a correct animation and a wrong buzz. A duration scale is built so
 *   that a fade and a slide agree with each other; nothing on it was ever
 *   chosen by how a motor feels through a coat, and there is no token that
 *   could be. A vibration duration is a physical threshold, not a design value,
 *   which is why it lives next to the notification that posts it instead of in
 *   the scale that animates the screen.
 *
 * WHICH CAMERA STATES BUZZ IS THE NOTIFICATION'S ANSWER
 *   Not re-decided here. `isSilentChannel(ALERT_CHANNELS[state])` is what the
 *   card asks, so it is what this asks: `clear` and `approaching` are below the
 *   alert threshold and are silent on BOTH paths; `in_range` and `multiple` are
 *   the alert and get the signature.
 *
 *   That contradicts one line of the state matrix - "APPROACHING · 1 pulse @
 *   1000ft" - and the contradiction is the design's, not this file's: the same
 *   design says silent below the threshold, and `alert-approaching` is in
 *   `SILENT_CHANNELS`. Resolved toward the notification, because that is the
 *   copy the driver actually receives, and because a page-side pulse for a
 *   state the notification posts silently is a cue that exists only while
 *   somebody is looking at the screen. Nothing changes on the road today
 *   either way: the upstream gate is `cooled.length > 0`, so `buzz()` is only
 *   ever reached with a camera in range.
 *
 * TWO FORMS OF ONE PATTERN
 *   The shared constants are written delay-first - `[0, 260, 120, 260]` is two
 *   firm 260ms pulses only if the leading 0 is a wait. `navigator.vibrate`
 *   reads index 0 as a PULSE, so handing it the array as written buzzes for
 *   0ms, waits 260ms, and fires a single 120ms tap - which is the same
 *   imperceptible nothing this file was rewritten to stop, and for the turn cue
 *   `[0, 180]` it is literally no vibration at all. `pulsesOnly()` drops the
 *   leading wait at the one call site that needs it. The pattern is still ONE
 *   definition; only the units of the API being called change.
 *
 * WHAT THE PLATFORM WILL NOT PROMISE
 *   `navigator.vibrate` is absent on iOS Safari entirely, and on Chrome it is
 *   ignored unless the document is visible and has been interacted with - a
 *   phone face-down in a mount with the screen off is exactly that case, which
 *   is why the notification carries its own pattern.
 *
 *   AND THIS ADAPTER CANNOT VERIFY THAT A BUZZ HAPPENED. `vibrate()` returns
 *   true when the pattern was ACCEPTED, not when a motor moved: a device with
 *   no vibrator, a phone in silent or do-not-disturb, an OS-level haptics
 *   switch turned off, a driver holding the phone still enough to feel nothing
 *   - all of them return true. There is no callback, no completion event and
 *   nothing to read back. `ok: true` therefore means "the browser took it",
 *   and any screen that renders it as "vibration works" is making a claim this
 *   code cannot support. The settings screen must not say it buzzed; the most
 *   it may honestly say is what was sent.
 */

import { createCore } from './core';
import {
  ABUSE_VIBRATION,
  ALERT_CHANNELS,
  CAMERA_VIBRATION,
  NAVIGATION_VIBRATION,
  SILENT_VIBRATION,
  isSilentChannel,
} from './notifications';
import { nav, no, ok, type Adapter, type AlertState, type Capability } from './types';

/** Every caller that could conceivably want a buzz, named. Three of them may. */
export const HAPTIC_SOURCES = [
  'camera-alert',
  'abuse-area',
  'navigation',
  'watchlist',
  'mesh-activity',
  'ui-feedback',
  'sync',
] as const;

export type HapticSource = (typeof HAPTIC_SOURCES)[number];

/**
 * The sources that own a pattern. `assertCanBuzz` narrows to this, and the
 * test asserts the narrowing agrees with `SOURCE_PATTERNS` - a source added to
 * one and not the other is the bug that would let a silent channel through.
 */
export const BUZZING_SOURCES = ['camera-alert', 'abuse-area', 'navigation'] as const;

export type BuzzingSource = (typeof BUZZING_SOURCES)[number];

/** Named so a caller can say "this one never buzzes" in a type. */
export type SilentSource = Exclude<HapticSource, BuzzingSource>;

export interface VibrationRequest {
  readonly source: HapticSource;
  /**
   * CAMERA ONLY, and it can only SILENCE the alert - never reshape it. The
   * other sources have exactly one pattern each and pass nothing. A camera
   * request that names no state is the alert itself.
   */
  readonly state?: AlertState;
}

export interface VibrationEvent {
  readonly source: HapticSource;
  /** Present for camera alerts, absent for everything else. Never invented. */
  readonly state?: AlertState;
  readonly pattern: readonly number[];
  readonly timestamp: number;
}

export interface VibrationResult {
  readonly ok: boolean;
  /**
   * The pattern as the design names it, delay-first, exactly as the
   * notification posts it. What went to `navigator.vibrate` is this with the
   * leading wait dropped - see `pulsesOnly`.
   */
  readonly pattern: readonly number[];
  readonly reason?: string;
}

export interface VibrationAdapter extends Adapter<VibrationEvent> {
  /** Runs the guard, then vibrates. Throws for a source that has no pattern. */
  buzz(request: VibrationRequest): VibrationResult;
  /** What this request is meant to feel like. Pure, and runs no guard. */
  patternFor(request: VibrationRequest): readonly number[];
  /** Mirrors the map view panel's "Vibration" toggle: false until `start()`. */
  enabled(): boolean;
}

/**
 * THE TABLE. One row per source, and the four patterns are the ones
 * `./notifications` posts - imported, so there is no second copy to drift.
 */
export const SOURCE_PATTERNS: Readonly<Record<HapticSource, readonly number[]>> = {
  // Two firm pulses. Reserved: nothing below this line may point at it.
  'camera-alert': CAMERA_VIBRATION,
  // Long then short. Deliberately unlike a camera - a driver who felt this and
  // braked would have braked for a county record.
  'abuse-area': ABUSE_VIBRATION,
  // One short pulse. The quietest thing in the vocabulary, because a turn is
  // the least urgent thing this product has to say.
  navigation: NAVIGATION_VIBRATION,
  // Silent by design, all four. A watchlist read is not urgent, a mesh peer is
  // not urgent, a tap does not need confirming through a motor, and a sync
  // that buzzed would be the product interrupting a drive to say nothing.
  watchlist: SILENT_VIBRATION,
  'mesh-activity': SILENT_VIBRATION,
  'ui-feedback': SILENT_VIBRATION,
  sync: SILENT_VIBRATION,
};

/**
 * `clear` is silent by design, not by omission, and `approaching` is silent
 * because the channel it posts on is - see the header. Derived from the
 * notification's own silence table rather than restated.
 */
function cameraPattern(state: AlertState): readonly number[] {
  return isSilentChannel(ALERT_CHANNELS[state])
    ? SILENT_VIBRATION
    : SOURCE_PATTERNS['camera-alert'];
}

export const CAMERA_ALERT_PATTERNS: Readonly<Record<AlertState, readonly number[]>> = {
  clear: cameraPattern('clear'),
  approaching: cameraPattern('approaching'),
  in_range: cameraPattern('in_range'),
  multiple: cameraPattern('multiple'),
};

export function patternFor(request: VibrationRequest): readonly number[] {
  if (request.source !== 'camera-alert') return SOURCE_PATTERNS[request.source];
  if (request.state === undefined) return SOURCE_PATTERNS['camera-alert'];
  return CAMERA_ALERT_PATTERNS[request.state];
}

/**
 * Delay-first (how the patterns are written, and what an Android notification
 * channel wants) -> on-first (what `navigator.vibrate` reads). See the header:
 * getting this wrong costs the first pulse of every pattern and the whole of
 * the turn cue. Every shared pattern waits 0ms, and a real wait has no
 * expressible form here, so this refuses to guess at one.
 */
function pulsesOnly(pattern: readonly number[]): number[] {
  return pattern[0] === 0 ? [...pattern.slice(1)] : [...pattern];
}

/**
 * Thrown when a source with no pattern tries to buzz the device. It is a
 * programming error, and it is loud on purpose: a silent `return false` here
 * would let a watchlist read start buzzing in a later refactor and nobody would
 * find out until a driver braked for a camera that was not there.
 */
export class SilentChannelError extends Error {
  override readonly name = 'SilentChannelError';
  readonly source: HapticSource;

  constructor(source: HapticSource) {
    super(
      `"${source}" has no haptic pattern; it is a silent channel. ` +
        'watchlist, mesh activity, ui feedback and sync never vibrate, on any path. ' +
        'only camera alerts, abuse areas and turn cues have a pattern.',
    );
    this.source = source;
  }
}

/**
 * THE GUARD. Every path to `navigator.vibrate` in this codebase goes through
 * it. Table-driven rather than a list of allowed names, so adding a row to
 * `SOURCE_PATTERNS` is the only edit a new haptic needs - and adding a row
 * with no pattern keeps the refusal automatically. Exported so a caller can
 * check its own intent before building a request.
 */
export function assertCanBuzz(source: HapticSource): asserts source is BuzzingSource {
  if (SOURCE_PATTERNS[source].length === 0) throw new SilentChannelError(source);
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

  return {
    name: 'vibration',

    capability: vibrationCapability,

    /**
     * Enable haptics. This is the map view panel's "Vibration" toggle, not a
     * permission - there is no prompt anywhere in this adapter. Idempotent.
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
      // Guard first. Nothing below this line runs for a silent source.
      assertCanBuzz(request.source);

      const pattern = patternFor(request);

      // NAMES THE MAP VIEW PANEL, NOT SETTINGS, and the distinction is the
      // whole point of the move. This said "in settings" while the Vibration
      // switch lived there; it is a row in DRIVE's MAP VIEW panel now, and the
      // settings copy was deleted rather than mirrored. A refusal that sends
      // the driver to a screen the control is no longer on is worse than no
      // reason at all - they would go and find nothing, which reads as the
      // switch being broken rather than off.
      if (!core.running()) {
        return { ok: false, pattern, reason: 'haptics are switched off in the map view panel' };
      }
      const capability = vibrationCapability();
      if (!capability.supported) {
        return { ok: false, pattern, reason: capability.reason ?? 'vibration is not available' };
      }
      if (pattern.length === 0) {
        // A camera state below the alert threshold. Returning ok:false with a
        // reason keeps the caller honest instead of reporting a buzz that
        // never happened.
        return { ok: false, pattern, reason: 'this alert state is silent by design' };
      }

      const navigator = nav();
      const accepted = navigator?.vibrate(pulsesOnly(pattern)) ?? false;
      if (!accepted) {
        core.fail(
          'vibrate-rejected',
          'the browser refused the vibration; it needs a visible page that has been interacted with',
        );
        return { ok: false, pattern, reason: 'the browser refused the vibration' };
      }
      core.clearError();
      // `accepted` is the browser taking the pattern, NOT a motor moving. See
      // the header: there is nothing to read back, so this event says what was
      // asked for and never claims it was felt.
      core.emit({
        source: request.source,
        pattern,
        timestamp: Date.now(),
        ...(request.state === undefined ? {} : { state: request.state }),
      });
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
