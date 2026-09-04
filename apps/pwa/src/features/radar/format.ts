/**
 * RADAR's presentation formatting. Strings only, and every string here is one
 * the design files literally render.
 *
 * =============================================================================
 * WHY THIS IS A SEPARATE FILE
 * =============================================================================
 * `RadarScreen.tsx` reads selectors and composes components. It does no
 * arithmetic. Everything that turns a number into the exact glyphs the design
 * draws -- "425" / "FT", "2.4" / "MI TO NEAREST", "NE" / "041°", "MUTED 8:12",
 * "39.0997 N, 84.5786 W" -- lives here, where it is pure and enumerable.
 *
 * =============================================================================
 * THIS IS NOT GEODESY
 * =============================================================================
 * Distance, bearing and relative direction all arrive already computed, on the
 * `CameraAssessment` the engine published. The only angle work below is the
 * SIGN of an already-computed relative bearing, and it is done with the
 * engine's own {@link angularDifferenceDeg} rather than with a local `%`. The
 * two cut points it needs are engine constants, imported, never retyped:
 *
 *   APPROACHING_OUTER_FT   1000 ft -- where the readout switches to miles,
 *                          which is also where "approaching" starts, so the
 *                          unit change and the amber both happen at one line.
 *   AHEAD_HALF_ANGLE_DEG   45° -- the `ahead` sector's half-angle, reused as
 *                          the compass sector width, and halved for the
 *                          "SLIGHT LEFT" cut.
 *
 * The relative path to `@fwm/core` follows the precedent set by
 * `src/stores/fwmCore.ts` and `src/services/simulator/fwmCore.ts`: the package
 * name is not in `apps/pwa/package.json` yet, and adding it is a manifest
 * decision, not this module's.
 *
 * =============================================================================
 * COORDINATES
 * =============================================================================
 * {@link formatCoordinates} is for the pixels on the driver's own screen and
 * for nothing else. Its output must never reach a log line, a notification, an
 * analytics event, a crash report or a request body -- the redacted shape from
 * `positionForDiagnostics()` is the only thing allowed to leave the device, and
 * it rounds harder than this does.
 */

import {
  AHEAD_HALF_ANGLE_DEG,
  APPROACHING_OUTER_FT,
  angularDifferenceDeg,
} from '../../../../../packages/core/src/index.ts';
import type { RelativeDirection } from '../../../../../packages/core/src/index.ts';
import type { RadarState } from './radarState.ts';

export type { RelativeDirection };

/**
 * What a readout shows when the value genuinely is not known.
 *
 * An em dash, not a zero and not a spinner: "0 FT" is a camera on the bumper
 * and "--" is an honest absence. The design never draws this because the design
 * never draws an empty RADAR.
 * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn
 */
export const NO_VALUE = '—';

/** Feet under 1000, miles at or above it. Both rendered as the design draws them. */
export type DistanceUnit = 'FT' | 'MI';

export function distanceUnit(distanceFt: number | null): DistanceUnit {
  if (distanceFt === null || !Number.isFinite(distanceFt)) return 'FT';
  return distanceFt >= APPROACHING_OUTER_FT ? 'MI' : 'FT';
}

/** Statute feet per mile. Exact by definition, and not a screen length. */
const FEET_PER_MILE = 5280;

/**
 * The hero numerals. "425", or "2.4" once it is a mile-scale distance.
 *
 * Whole feet and one decimal mile, exactly as rendered in
 * `01 · RADAR - IN RANGE` (425), the state matrix (820, 2.4, 425) and
 * `A2 · OFFLINE` (610).
 */
export function formatDistanceValue(distanceFt: number | null): string {
  if (distanceFt === null || !Number.isFinite(distanceFt)) return NO_VALUE;
  const feet = Math.max(0, distanceFt);
  if (feet >= APPROACHING_OUTER_FT) return (feet / FEET_PER_MILE).toFixed(1);
  return String(Math.round(feet));
}

/**
 * "8:12". The header countdown while a mute is live.
 *
 * Rounds up so the last second is shown as 0:01 rather than 0:00 -- a
 * countdown that reads zero while the mute is still on is a lie about the
 * state of the alert gate.
 */
export function formatMuteCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * "39.0997 N, 84.5786 W" -- four decimals, hemisphere letters, as rendered.
 *
 * RENDER ONLY. See the privacy note at the top of this file.
 */
export function formatCoordinates(lat: number | null, lon: number | null): string {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NO_VALUE;
  }
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)} ${ns}, ${Math.abs(lon).toFixed(4)} ${ew}`;
}

/**
 * The right-hand slot of the GPS row: "7 SATS", or "±4 M" when the platform
 * will not say how many satellites it used.
 *
 * A browser `GeolocationPosition` carries no satellite count and never has;
 * only the hardware bridge supplies one. Printing "0 SATS" there would report
 * a lock we do have as a lock we do not, so the row falls back to the accuracy
 * figure, which is the same fact the design prints beside the sat count on the
 * REPORT sheet ("±4 M · 9 SATS · Reading Rd").
 * GAP: see docs/gaps-inbox/radar-screen.md#sat-count-unavailable-on-the-web
 */
export function formatSatellites(satellites: number | null, accuracyM: number | null): string {
  if (satellites !== null && Number.isFinite(satellites)) return `${String(satellites)} SATS`;
  if (accuracyM !== null && Number.isFinite(accuracyM))
    return `±${String(Math.round(accuracyM))} M`;
  return NO_VALUE;
}

/** The HEADING tile's big word: an 8-point cardinal, as rendered ("NE"). */
export function formatHeadingCardinal(headingDeg: number | null): string {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return NO_VALUE;
  // Eight sectors of AHEAD_HALF_ANGLE_DEG (45°), centred on each cardinal.
  const sectors = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  const wrapped = ((headingDeg % 360) + 360) % 360;
  const index = Math.round(wrapped / AHEAD_HALF_ANGLE_DEG) % sectors.length;
  return sectors[index] ?? NO_VALUE;
}

/** The HEADING tile's caption: "041°", zero-padded to three digits as rendered. */
export function formatHeadingDegrees(headingDeg: number | null): string {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return NO_VALUE;
  const wrapped = Math.round(((headingDeg % 360) + 360) % 360) % 360;
  return `${String(wrapped).padStart(3, '0')}°`;
}

/** The SPEED tile. Whole mph, as rendered ("47"). */
export function formatSpeedMph(speedMph: number | null): string {
  if (speedMph === null || !Number.isFinite(speedMph)) return NO_VALUE;
  return String(Math.round(Math.max(0, speedMph)));
}

/** A count for a tile or a bar. Never a placeholder -- zero passes is a real zero. */
export function formatCount(count: number): string {
  return String(Math.max(0, Math.trunc(count)));
}

/**
 * "40s", for "last fix 40s ago." Minutes past a minute, because a driver
 * reading "312s ago" has to do arithmetic at 47 mph.
 */
export function formatFixAge(ageMs: number | null): string | null {
  if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return null;
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  return `${String(Math.floor(seconds / 60))}m`;
}

/** The four sectors, in the words the design uses for them. */
const COARSE: Readonly<Record<RelativeDirection, string>> = {
  ahead: 'AHEAD',
  left: 'LEFT',
  right: 'RIGHT',
  behind: 'BEHIND',
};

/** "AHEAD" / "LEFT" / "RIGHT" / "BEHIND". Null when there is no heading to be relative to. */
export function coarseDirection(direction: RelativeDirection | null): string | null {
  return direction === null ? null : COARSE[direction];
}

export interface FineDirectionInput {
  readonly direction: RelativeDirection | null;
  /** Bearing from the vehicle to the camera. From the assessment, not computed here. */
  readonly bearingDeg: number | null;
  /** The vehicle's heading. From the position slice, not computed here. */
  readonly headingDeg: number | null;
}

/**
 * "AHEAD · SLIGHT LEFT" -- the finer label screen 01 renders.
 *
 * `RelativeDirection` is deliberately coarse (four 90° sectors) and the type's
 * own doc comment says the finer label is presentation, derived from the raw
 * relative angle. So: take the sign of the relative bearing, and split the
 * `ahead` sector in half.
 *
 * WHERE THE CUT COMES FROM: the design renders the phrase and never says at
 * what angle it starts. Half of `AHEAD_HALF_ANGLE_DEG` (22.5°) is the only
 * cut point in the system that is not invented -- it is the midpoint of the
 * sector being subdivided.
 * GAP: see docs/gaps-inbox/radar-screen.md#slight-left-cut-point-undefined
 */
export function fineDirection(input: FineDirectionInput): string | null {
  const coarse = coarseDirection(input.direction);
  if (coarse === null) return null;
  if (input.direction !== 'ahead') return coarse;
  if (input.bearingDeg === null || input.headingDeg === null) return coarse;
  if (!Number.isFinite(input.bearingDeg) || !Number.isFinite(input.headingDeg)) return coarse;

  const relative = angularDifferenceDeg(input.bearingDeg, input.headingDeg);
  if (Math.abs(relative) < AHEAD_HALF_ANGLE_DEG / 2) return coarse;
  // Positive is clockwise of the heading, which is the driver's right.
  return relative > 0 ? `${coarse} · SLIGHT RIGHT` : `${coarse} · SLIGHT LEFT`;
}

export interface DirectionLineInput extends FineDirectionInput {
  readonly state: RadarState;
  /** `true` closing, `false` receding, `null` not yet known. From the engine. */
  readonly isClosing: boolean | null;
  /** Running on cached tiles with no network. */
  readonly offline: boolean;
}

/**
 * The line under the hero numerals. Every branch is a literal design string.
 *
 *   in_range / multiple  "AHEAD · SLIGHT LEFT"        01 · RADAR - IN RANGE
 *   approaching          "AHEAD · CLOSING"            state matrix, card 2
 *   clear                "CLEAR · NEAREST AHEAD"      Screens II, county strip
 *   muted                "STILL TRACKING"             state matrix, card 4
 *   offline              "CACHED CAMERA · AHEAD"      A2 · OFFLINE - DEGRADED
 *   no_gps               none -- the state matrix replaces the line with copy
 *
 * The offline branch wins over `clear` and `approaching` because A2 draws it
 * that way and because "clear" from a two-day-old database is a claim the app
 * cannot make. It does NOT win over `in_range`: at that point the driver needs
 * the direction, not the provenance.
 *
 * `approaching` keeps the coarse label so the rendered string is exactly
 * "AHEAD · CLOSING" rather than a three-clause line at the moment the alert is
 * about to fire.
 */
export function directionLine(input: DirectionLineInput): string | null {
  if (input.state === 'no_gps') return null;
  if (input.state === 'muted') return 'STILL TRACKING';

  const coarse = coarseDirection(input.direction);

  if (input.offline && input.state !== 'in_range' && input.state !== 'multiple') {
    return coarse === null ? 'CACHED CAMERA' : `CACHED CAMERA · ${coarse}`;
  }

  switch (input.state) {
    case 'clear':
      return coarse === null ? 'CLEAR' : `CLEAR · NEAREST ${coarse}`;
    case 'approaching':
      if (coarse === null) return input.isClosing === true ? 'CLOSING' : null;
      return input.isClosing === true ? `${coarse} · CLOSING` : coarse;
    case 'in_range':
    case 'multiple':
      return fineDirection(input);
  }
}
