/**
 * "YOU ARE ENTERING A WATCHED AREA - 23 CAMERAS."
 *
 * The alert engine answers one camera at a time: how far, which way, alert or
 * not. It cannot answer the question a driver actually asks approaching a town
 * they have not driven through - *is this place covered?* One camera at 800 ft
 * is a thing to note. Forty of them inside two miles is a different fact, and
 * nothing in the product said it.
 *
 * WHAT IT IS NOT
 *   Not an alert. It never takes the screen, never fires a haptic, never
 *   notifies. "A live camera alert always wins the screen" - this is the
 *   opposite end of that scale: ambient context, shown once on entry, ignorable.
 *   Alert haptics are reserved for cameras (adapters/vibration.ts enforces it),
 *   and county-entry style notices are silent by the same rule.
 *
 * WHAT COUNTS AS "A WATCHED AREA"
 *   A count inside a radius, and nothing cleverer. No clustering, no
 *   heuristics about roads, no inferred boundary - the app knows where cameras
 *   are and where the driver is, and any line drawn beyond that would be a
 *   claim it cannot support. The radius is generous (2 miles) because the point
 *   is to describe the AREA, not the road.
 *
 * WHY IT LATCHES
 *   Without hysteresis this would fire on every tick along the edge of an area,
 *   which is how a useful notice becomes noise a driver learns to ignore. It
 *   arms on entry, and does not re-arm until the count has fallen well below
 *   the entry threshold - the same shape as the engine's own hysteresis.
 */

import type { CameraRecord } from '../db/schema.ts';

import { metresBetween } from './sync.ts';

/** Metres in a statute mile. A unit, not a screen length. */
const METRES_PER_MILE = 1609.344;

/** How far out "the area" reaches. */
export const AREA_RADIUS_MI = 2;
export const AREA_RADIUS_M = AREA_RADIUS_MI * METRES_PER_MILE;

/**
 * How many cameras inside that radius make it worth saying.
 *
 * Twelve, because a handful is ordinary - a few junctions on any arterial - and
 * the notice has to mean something the driver did not already assume. Below
 * this the map still shows every camera; it just does not editorialise.
 */
export const AREA_ENTRY_COUNT = 12;

/**
 * The count must fall to this before the notice can fire again.
 *
 * Two thirds of the entry count, so driving along the boundary does not
 * re-announce the same town every 250 m.
 */
export const AREA_EXIT_COUNT = 8;

export interface WatchedArea {
  /** True while the driver is inside a dense area. */
  readonly inside: boolean;
  /** Cameras within {@link AREA_RADIUS_MI}. Reported whether inside or not. */
  readonly count: number;
  /**
   * True on the tick the driver ENTERS one. The screens show the notice on
   * this edge only; `inside` is what keeps a persistent strip up.
   */
  readonly entered: boolean;
}

export const NO_AREA: WatchedArea = Object.freeze({ inside: false, count: 0, entered: false });

export function camerasWithin(
  at: { lat: number; lon: number },
  cameras: readonly CameraRecord[],
  radiusM: number = AREA_RADIUS_M,
): number {
  let count = 0;
  for (const camera of cameras) {
    if (metresBetween(at, camera) <= radiusM) count += 1;
  }
  return count;
}

/**
 * One step of the latch.
 *
 * Pure, and takes the previous state rather than holding it: the caller owns
 * the lifetime, and a test can drive a whole drive through it without a clock
 * or a store.
 */
export function stepWatchedArea(
  previous: WatchedArea,
  at: { lat: number; lon: number } | null,
  cameras: readonly CameraRecord[],
  options: { readonly radiusM?: number; readonly entryCount?: number; readonly exitCount?: number } = {},
): WatchedArea {
  if (at === null) return NO_AREA;

  const radiusM = options.radiusM ?? AREA_RADIUS_M;
  const entryCount = options.entryCount ?? AREA_ENTRY_COUNT;
  const exitCount = options.exitCount ?? AREA_EXIT_COUNT;
  const count = camerasWithin(at, cameras, radiusM);

  if (previous.inside) {
    // Still inside until the count drops clear of the entry threshold.
    const stillInside = count > exitCount;
    return Object.freeze({ inside: stillInside, count, entered: false });
  }

  const entering = count >= entryCount;
  return Object.freeze({ inside: entering, count, entered: entering });
}

/**
 * The sentence, or `null` when there is nothing worth saying.
 *
 * Lowercase and blunt, as the chrome voice is. It states a count and a radius
 * and stops - it does not tell the driver what to do about it, because the
 * product does not know and would be guessing.
 */
export function watchedAreaNotice(area: WatchedArea): string | null {
  if (!area.inside || area.count === 0) return null;
  const cameras = area.count === 1 ? '1 camera' : `${String(area.count)} cameras`;
  return `entering a watched area · ${cameras} within ${String(AREA_RADIUS_MI)} mi`;
}
