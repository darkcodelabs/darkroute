/**
 * FETCH THE CAMERAS FOR WHAT THE MAP IS LOOKING AT, NOT ONLY FOR THE CAR.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * `sync.ts` fetches a ring of z11 tiles around the VEHICLE and nothing else.
 * That is right for driving and wrong for looking: pan to another state and the
 * map draws clusters and heat there - `overview.json` carries every camera's
 * coordinate nationwide - but tapping one opens nothing, because the RECORD
 * (owner, direction, mount, tags) lives in the z11 tile and no tile for that
 * ground was ever requested.
 *
 * So the far view had data and the near view had none, in the same place, and
 * the seam was invisible: cameras were plainly on screen and simply inert.
 *
 * =============================================================================
 * WHY THIS IS NOT JUST `syncAt(centre)`
 * =============================================================================
 * A ring sized for the car is sized for a windscreen. Panning to a metro at
 * z9 shows several hundred kilometres, and a 3x3 ring in the middle of that
 * leaves a straight-edged box of loaded ground with dead cameras all around it
 * - the same shape complaint `coverRangeFt` was written for on the radar dial.
 * So the viewport's own diagonal drives the ring, and the centre drives the
 * fetch.
 *
 * =============================================================================
 * WHAT STOPS THIS BEING EXPENSIVE
 * =============================================================================
 * Three things, in order of how much they save:
 *
 *   A ZOOM FLOOR. Below `VIEWPORT_SYNC_MIN_ZOOM` the viewport is a continent,
 *   `ringsForRangeFt` saturates at its 8-ring cap, and 289 tiles would be
 *   fetched to answer a question - "where is it bad nationally" - that the heat
 *   layer already answers from the overview. Nothing is fetched there.
 *
 *   A MOVEMENT GATE. `moveend` fires on every nudge, including the ones the
 *   camera effect itself causes by following the car. Re-fetching a ring
 *   because the centre moved fifty metres is pure noise, so a move has to be a
 *   real fraction of the screen before it counts.
 *
 *   THE SYNC'S OWN SKIP. `syncAt` serialises on one promise queue and does not
 *   re-fetch a tile it holds, so a pan back over covered ground costs nothing.
 *
 * None of this evicts. Tiles fetched for a look stay held for the drive.
 */

import { ringsForRangeFt } from '../../services/cameras/sync.ts';

/**
 * The zoom at which looking becomes specific enough to be worth fetching for.
 *
 * Chosen against `POINT_MIN_ZOOM` (11) in `layers.ts` rather than picked: below
 * 11 the map draws clusters, and a cluster is a count rather than a camera you
 * can open. Two zooms of headroom, so the tiles are already arriving by the
 * time the reader crosses into the zoom where individual poles appear and they
 * do not watch them pop in.
 */
export const VIEWPORT_SYNC_MIN_ZOOM = 9;

/**
 * How far the centre must move before it counts as a new place to look.
 *
 * A fraction of the span rather than a fixed distance, because "the same view"
 * means something different at z9 and at z16. A fifth: small enough that a
 * deliberate pan always registers, large enough that following the car does
 * not.
 */
export const VIEWPORT_MOVE_FRACTION = 0.2;

const FEET_PER_METRE = 3.280839895;
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle metres. Same haversine `sync.ts` uses, and for the same reason. */
export function metresBetween(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface ViewportBox {
  readonly centreLat: number;
  readonly centreLon: number;
  /** North-east and south-west corners, as MapLibre reports its bounds. */
  readonly northLat: number;
  readonly eastLon: number;
  readonly southLat: number;
  readonly westLon: number;
  readonly zoom: number;
}

/**
 * The range a ring has to cover to fill this viewport, in feet.
 *
 * The DIAGONAL, not the width: a ring is square and the viewport's corners are
 * the furthest ground on screen, so sizing to the width leaves the corners
 * empty - which is exactly the straight-edged box this is here to avoid.
 */
export function viewportRangeFt(box: ViewportBox): number {
  const diagonalM = metresBetween(box.southLat, box.westLon, box.northLat, box.eastLon);
  return diagonalM * FEET_PER_METRE;
}

export interface ViewportSyncDecision {
  readonly fetch: boolean;
  readonly rings: number;
  readonly reason: 'too-far-out' | 'not-moved' | 'fetch';
}

/**
 * Whether this viewport is worth fetching for, and how wide a ring it needs.
 *
 * Pure, so the policy is testable without a map: the caller holds the previous
 * centre and applies the answer.
 */
export function decideViewportSync(
  box: ViewportBox,
  previous: { readonly lat: number; readonly lon: number } | null,
): ViewportSyncDecision {
  if (box.zoom < VIEWPORT_SYNC_MIN_ZOOM) {
    return { fetch: false, rings: 0, reason: 'too-far-out' };
  }
  const rangeFt = viewportRangeFt(box);
  const rings = ringsForRangeFt(rangeFt);
  if (previous !== null) {
    const movedM = metresBetween(previous.lat, previous.lon, box.centreLat, box.centreLon);
    const spanM = rangeFt / FEET_PER_METRE;
    if (movedM < spanM * VIEWPORT_MOVE_FRACTION) {
      return { fetch: false, rings, reason: 'not-moved' };
    }
  }
  return { fetch: true, rings, reason: 'fetch' };
}
