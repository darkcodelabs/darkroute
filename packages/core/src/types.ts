/**
 * @fwm/core - shared domain types.
 *
 * Nothing in this file references React, zustand, a browser global or the
 * backend. The whole package is a pure function of the values below, which is
 * what makes the driving loop testable in node with an injected clock.
 */

/**
 * Where a camera sits relative to where the vehicle is pointing.
 *
 * Four sectors, 90° each, `ahead` centred on the heading. The RADAR screen
 * renders a finer label on top of this ("AHEAD · SLIGHT LEFT" in
 * `Flockys App Screens.dc.html` 01 · RADAR - IN RANGE); the finer label is a
 * presentation concern and is derived from the raw relative angle, not from
 * this type.
 */
export type RelativeDirection = 'ahead' | 'left' | 'right' | 'behind';

/**
 * The alert state machine. Hue means state and nothing else.
 *
 * Sourced from `Flockys Design System.dc.html` § alert states:
 *   clear       "#3DE08A · nothing in threshold"
 *   approaching "#FFC02E · 500 - 1000 ft, closing"
 *   in_range    "#FF2D5E · inside threshold"
 *   multiple    "#FF3DBE · 2+ in range · 2-pulse haptic"
 */
export type AlertState = 'clear' | 'approaching' | 'in_range' | 'multiple';

/** A slippy-map tile address. */
export interface TileRef {
  x: number;
  y: number;
  z: number;
}

/**
 * The minimum a camera record has to carry for the engine to reason about it.
 *
 * `directionDeg` is the compass direction the lens points TOWARD - the value
 * the REPORT sheet captures from the compass ("FACING · FROM COMPASS … 223° ·
 * covering the northbound lane", `Flockys App Screens.dc.html` 06 · REPORT).
 *
 * `null` means the facing is genuinely unknown. It is never a synonym for
 * "not facing you": an unknown-facing camera still reads every plate it can
 * see, so it stays in every list, every count and every alert.
 */
export interface CameraLike {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly directionDeg: number | null;
}

/**
 * One position sample handed to the engine.
 *
 * Field-for-field this is what a `GeolocationPosition` can supply, plus an
 * optional motion magnitude. It is deliberately a plain object: the engine
 * never touches `navigator`, and the sensor adapters in the PWA are the only
 * code allowed to.
 *
 * `speedMps` follows the documented source order - `GeolocationCoordinates.speed`
 * first; when the platform reports `null` the engine falls back to a smoothed
 * position delta. `motionMagnitudeMps2` is SUPPORTING EVIDENCE ONLY: it can
 * veto a "stationary" conclusion, it can never establish a speed.
 */
export interface PositionFix {
  readonly lat: number;
  readonly lon: number;
  /** Compass degrees of travel, or `null` when the platform has no heading. */
  readonly headingDeg: number | null;
  /** Metres per second from the platform, or `null` to derive it. */
  readonly speedMps: number | null;
  /** Horizontal accuracy in metres (the "±4 M" on the REPORT sheet), or `null`. */
  readonly accuracyM: number | null;
  /** Device-motion magnitude in m/s². Supporting evidence only. */
  readonly motionMagnitudeMps2?: number | null;
  /** Sample time. Defaults to the injected clock, never to `Date.now()`. */
  readonly timestampMs?: number;
}

/** How the engine arrived at the speed it used on a tick. */
export type SpeedSource = 'gps' | 'derived' | 'unknown';
