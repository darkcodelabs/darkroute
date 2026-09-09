/**
 * SWEEP ZOOM - the same dial, at four ranges.
 *
 * The design draws SWEEP at exactly one range: rings at 100 / 300 / 500 /
 * 1000 ft (`02 · SWEEP`). That is the right range for the product's actual job,
 * which is warning a driver about a camera they are about to pass - but it
 * answers nothing about where they are. A driver who wants to know whether the
 * road ahead is watched at all, or which town the cluster belongs to, has no
 * way to see past 1000 feet.
 *
 * SO THE RINGS SCALE, AND NOTHING ELSE DOES.
 *   Every level reuses the design's own ring insets and its own non-linear
 *   spacing, by keeping the RATIOS the design drew: 0.1, 0.3, 0.5, 1.0 of the
 *   outer ring. At the default level those ratios reproduce 100 / 300 / 500 /
 *   1000 exactly, so the drawn state is the design's state, byte for byte -
 *   this file adds levels above it and changes nothing at it.
 *
 * WHY NOT A MAP
 *   None of the four design files draws a basemap under SWEEP, and a tile layer
 *   would mean network requests keyed to the driver's position - which
 *   contradicts what A1 promises out loud: "Coordinates never leave the phone
 *   unless you file a report." `leaflet` stays unimported.
 *   GAP: see docs/gaps-inbox/sweep.md#sweep-is-not-a-map
 *
 * THE SCALE IS NOT THE ALERT THRESHOLD
 *   Zooming out does NOT widen what alerts. `SWEEP_RING_FT` in packages/core is
 *   the engine's copy of the drawn scale and the alert threshold lives in
 *   settings; neither is touched here. Looking further and being warned further
 *   are different questions, and a zoom control that quietly changed the second
 *   one would be a driving hazard.
 */

import { SWEEP_RING_FT } from '../../stores/fwmCore.ts';

/** Feet in a statute mile. Not a design value: it is a unit. */
export const FEET_PER_MILE = 5280;

/**
 * Ring positions as a fraction of the outer ring, innermost first.
 *
 * Derived from the design rather than chosen: 100/1000, 300/1000, 500/1000,
 * 1000/1000. Keeping the ratios is what makes every level read like the drawn
 * one - the near field stays compressed, which is where the cameras that
 * matter are.
 */
export const RING_RATIOS: readonly number[] = SWEEP_RING_FT.map(
  (ft) => ft / Math.max(...SWEEP_RING_FT),
);

export interface SweepZoom {
  /** Stable id, and the value written to `data-fwm-sweep-zoom`. */
  readonly id: string;
  /** The outermost ring, in feet. */
  readonly outerFt: number;
  /** The key's label. */
  readonly label: string;
  /** How a ring at `ratio` of the outer ring is labelled at this level. */
  readonly ringLabel: (ratio: number) => string;
}

function feetLabel(outerFt: number): (ratio: number) => string {
  return (ratio) => String(Math.round(outerFt * ratio));
}

function mileLabel(outerFt: number): (ratio: number) => string {
  return (ratio) => {
    const miles = Math.round(((outerFt * ratio) / FEET_PER_MILE) * 10) / 10;
    // A decimal only when there is one to show. Rounding by MAGNITUDE instead
    // would put "7.5" and "13" on the same dial, which reads as two different
    // scales rather than four rings of one.
    return Number.isInteger(miles) ? String(miles) : miles.toFixed(1);
  };
}

/**
 * The levels, nearest first.
 *
 * 1000 FT is the design. 1 MI is "the next few minutes of driving". 5 MI is
 * "this side of town". 25 MI is "am I heading into a watched county at all",
 * and is the ceiling because past it a dot is a region, not a camera, and the
 * dial would be claiming a precision it does not have.
 */
export const SWEEP_ZOOMS: readonly SweepZoom[] = [
  {
    id: '1000ft',
    outerFt: 1000,
    label: '1000 FT',
    ringLabel: feetLabel(1000),
  },
  {
    id: '1mi',
    outerFt: FEET_PER_MILE,
    label: '1 MI',
    ringLabel: mileLabel(FEET_PER_MILE),
  },
  {
    id: '5mi',
    outerFt: 5 * FEET_PER_MILE,
    label: '5 MI',
    ringLabel: mileLabel(5 * FEET_PER_MILE),
  },
  {
    id: '25mi',
    outerFt: 25 * FEET_PER_MILE,
    label: '25 MI',
    ringLabel: mileLabel(25 * FEET_PER_MILE),
  },
];

/** The drawn state. Anything that does not name a level gets this one. */
/**
 * THE DIAL OPENS AT ONE MILE, NOT AT THE TIGHTEST RUNG.
 *
 * It used to default to `SWEEP_ZOOMS[0]` -- 1000 ft -- and that was wrong for
 * two reasons at once, both of which a driver sees immediately:
 *
 *   The scope is empty. 1000 ft is under a fifth of a mile. The nearest camera
 *   is typically further out than that, so RADAR opened with the hero reading
 *   `1.5 MI · NEAREST AHEAD` above a scope with nothing on it. The screen
 *   contradicted itself.
 *
 *   Pinch has nowhere to go. 1000 ft is also `MIN_OUTER_FT`, so the dial opened
 *   already clamped at the floor: spreading two fingers -- the gesture for a
 *   tighter range -- did nothing at all, and the only zoom control the screen
 *   has left after the slider was removed read as broken.
 *
 * One mile opens with travel in both directions and comfortably contains the
 * 500 ft threshold ring, so the line the alert fires on is still legible.
 */
/**
 * What the scope opens at: 5 MI, the third rung.
 *
 * It was 1 MI, and 1 MI is the wrong first impression almost everywhere. The
 * markers are culled to the visible rectangle, so at a one-mile range a driver
 * whose nearest camera is a mile and a half away opens the app to an empty
 * map -- coverage field, no contacts. Measured in Overland Park, which is not
 * an edge case: nearest 1.5 mi, dots on screen ZERO, and that is the honest
 * answer to the question the scope was asked.
 *
 * It is the wrong question to be asking on the first frame. Somebody opening
 * this wants to know what is around them, and the answer at five miles is
 * dozens of cameras and a shape they can recognise. Zooming in is one gesture
 * away; realising the app is not broken is not.
 */
export const DEFAULT_SWEEP_ZOOM: SweepZoom = (SWEEP_ZOOMS[2] ??
  SWEEP_ZOOMS[0]) as SweepZoom;

export function isSweepZoomId(value: unknown): boolean {
  return typeof value === 'string' && SWEEP_ZOOMS.some((z) => z.id === value);
}

export function zoomById(id: string): SweepZoom {
  return SWEEP_ZOOMS.find((z) => z.id === id) ?? DEFAULT_SWEEP_ZOOM;
}

/**
 * The unit a level counts in, for the legend and for screen readers. The dial
 * labels are bare numbers, exactly as the design draws them, so the unit has to
 * be said once somewhere that is not a ring.
 */
export function zoomUnit(zoom: SweepZoom): 'ft' | 'mi' {
  return zoom.outerFt <= 1000 ? 'ft' : 'mi';
}

// ---------------------------------------------------------------------------
// The range as a continuous value
// ---------------------------------------------------------------------------

/**
 * The bounds a pinch may move the outer ring between.
 *
 * The floor is the design's drawn range: below it the rings stop describing
 * anything a driver needs, and the dial is not a street map. The ceiling is the
 * widest named level - past it a dot is a region, not a camera, and the dial
 * would claim a precision it does not have.
 */
export const MIN_OUTER_FT: number = SWEEP_ZOOMS[0]?.outerFt ?? 1000;
export const MAX_OUTER_FT: number =
  SWEEP_ZOOMS[SWEEP_ZOOMS.length - 1]?.outerFt ?? 25 * FEET_PER_MILE;

export function clampOuterFt(outerFt: number): number {
  if (!Number.isFinite(outerFt)) return MIN_OUTER_FT;
  return Math.min(MAX_OUTER_FT, Math.max(MIN_OUTER_FT, outerFt));
}

/**
 * The named range nearest a continuous one, for highlighting the key row.
 *
 * Nearest in RATIO, not in feet: 1000 ft and 1 mi are 4,280 ft apart while 5 mi
 * and 25 mi are 105,600 apart, so a linear nearest would snap almost everything
 * to the widest key. What a driver perceives is the ratio.
 */
export function nearestZoom(outerFt: number): SweepZoom {
  const target = clampOuterFt(outerFt);
  let best = DEFAULT_SWEEP_ZOOM;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const zoom of SWEEP_ZOOMS) {
    const distance = Math.abs(Math.log(zoom.outerFt / target));
    if (distance < bestDistance) {
      best = zoom;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A ring's label at ANY outer ring, not only at a named level.
 *
 * Feet below a mile, miles at or above it, and a decimal only when there is one
 * to show - the same rules the named levels use, applied to a value a pinch can
 * land anywhere on.
 */
export function ringLabelFor(outerFt: number, ratio: number): string {
  const range = clampOuterFt(outerFt);
  const value = range * ratio;
  // The unit comes from the DIAL, not from each ring. A 5 mi dial labelled
  // "2640 / 1.5 / 2.5 / 5" reads as two scales on one face; a test caught it.
  if (unitForOuterFt(range) === 'FT') {
    // Round to a readable step rather than to the foot: "528" is noise on a
    // ring label, "530" is not, and neither is a measurement of anything.
    const step = value >= 100 ? 10 : 5;
    return String(Math.round(value / step) * step);
  }
  const miles = Math.round((value / FEET_PER_MILE) * 10) / 10;
  return Number.isInteger(miles) ? String(miles) : miles.toFixed(1);
}

/** The unit a continuous range counts its rings in. */
export function unitForOuterFt(outerFt: number): 'FT' | 'MI' {
  return clampOuterFt(outerFt) < FEET_PER_MILE ? 'FT' : 'MI';
}

/** What the range reads as on screen, e.g. "1000 FT" or "3.2 MI". */
export function formatOuterFt(outerFt: number): string {
  const ft = clampOuterFt(outerFt);
  if (ft < FEET_PER_MILE) return `${String(Math.round(ft / 10) * 10)} FT`;
  const miles = Math.round((ft / FEET_PER_MILE) * 10) / 10;
  return `${Number.isInteger(miles) ? String(miles) : miles.toFixed(1)} MI`;
}

/**
 * The range as a slider position, 0 (nearest) to 1 (widest), logarithmically.
 *
 * Log, not linear: the span is 132x, so on a linear track everything from the
 * drawn range out to a mile would live in the first 3% of it - unreachable with
 * a thumb in a moving car. On a log scale equal travel is equal RATIO, which is
 * how zoom is actually perceived.
 */
export function positionForOuterFt(outerFt: number): number {
  const ft = clampOuterFt(outerFt);
  const span = Math.log(MAX_OUTER_FT / MIN_OUTER_FT);
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, Math.log(ft / MIN_OUTER_FT) / span));
}

/** The inverse. `positionForOuterFt(outerFtForPosition(p)) === p`. */
export function outerFtForPosition(position: number): number {
  if (!Number.isFinite(position)) return MIN_OUTER_FT;
  const p = Math.min(1, Math.max(0, position));
  return clampOuterFt(MIN_OUTER_FT * Math.exp(p * Math.log(MAX_OUTER_FT / MIN_OUTER_FT)));
}
