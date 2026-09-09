/**
 * WHICH STREET IS THIS CAMERA ON - asked of the map, not of a build step.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * The Intel card prints "Main St @ Cross St", and 77.6% of camera records carry
 * that name. It was baked in at build time by a script that downloaded TIGER
 * All-Roads shapefiles per county and snapped every camera to the nearest
 * centreline -- a pipeline that has since been deleted, because TIGER was
 * replaced by OSM everywhere else and keeping two road datasets meant two
 * answers to "what road is this camera on" in an app whose entire value is
 * answering exactly that.
 *
 * Deleting it left the field with no producer: existing records keep their
 * names, and every camera discovered from here on would have none.
 *
 * The fix is not to rebuild the baking step. The basemap ALREADY has the roads,
 * with their names, in the tile the driver is looking at -- so the honest place
 * to ask is the map itself. That means:
 *
 *   - no build step, and no second road dataset to disagree with the first
 *   - names that update when OSM updates, with no re-bake
 *   - the name shown is from the same geometry drawn on screen, so it can never
 *     disagree with what the driver can see
 *
 * =============================================================================
 * WHAT IT REFUSES TO DO
 * =============================================================================
 * A camera sits beside a road, not on it, and the nearest line to a point is not
 * always the road it watches -- a frontage road runs 30 m from a freeway, and a
 * car park aisle can be closer than either. So this answers only when the answer
 * is unambiguous, and returns null otherwise. The card already falls back
 * gracefully to what it printed before, and a wrong street name on a
 * surveillance record is worse than no street name.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * How close a road must be to be considered the camera's road, in metres.
 *
 * ALPR cameras are mounted at the roadside, typically within a lane or two of
 * the carriageway centreline. Thirty metres covers a wide divided road; beyond
 * that the nearest line is more likely to be a different road than a far edge
 * of the same one.
 */
export const MAX_SNAP_M = 30;

/**
 * How much closer the winner must be than the runner-up, as a ratio.
 *
 * The frontage-road case: a camera almost equidistant between two named roads
 * has no defensible answer, and picking the marginally closer one is a coin
 * flip presented as a fact. The winner has to be clearly closer.
 */
export const AMBIGUITY_RATIO = 0.6;

const EARTH_RADIUS_M = 6_378_137;

/** Metres between two lon/lat points, flat-earth over the tens of metres here. */
function metresBetween(a: [number, number], b: [number, number]): number {
  const latRad = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * (Math.PI / 180) * Math.cos(latRad);
  const y = (b[1] - a[1]) * (Math.PI / 180);
  return Math.hypot(x, y) * EARTH_RADIUS_M;
}

/** Shortest distance in metres from a point to a segment. */
function distanceToSegmentM(
  point: [number, number],
  from: [number, number],
  to: [number, number],
): number {
  const latRad = point[1] * (Math.PI / 180);
  const scale = Math.cos(latRad);
  const px = (point[0] - from[0]) * scale;
  const py = point[1] - from[1];
  const vx = (to[0] - from[0]) * scale;
  const vy = to[1] - from[1];
  const lenSq = vx * vx + vy * vy;
  if (lenSq === 0) return metresBetween(point, from);
  const t = Math.max(0, Math.min(1, (px * vx + py * vy) / lenSq));
  const nearest: [number, number] = [from[0] + (t * vx) / scale, from[1] + t * vy];
  return metresBetween(point, nearest);
}

function coordinateRings(geometry: unknown): [number, number][][] {
  if (typeof geometry !== 'object' || geometry === null) return [];
  const g = geometry as { type?: unknown; coordinates?: unknown };
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    return [g.coordinates as [number, number][]];
  }
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    return g.coordinates as [number, number][][];
  }
  return [];
}

export interface StreetGuess {
  readonly name: string;
  readonly distanceM: number;
}

/**
 * The named road a point sits on, or null when that is not clear.
 *
 * Reads `querySourceFeatures`, which returns what is IN the loaded tiles rather
 * than what is currently painted -- a road under the Intel card's own overlay,
 * or scrolled just off screen, is still the road the camera is on.
 *
 * Note the features come back SPLIT at tile boundaries, so one road can appear
 * as several partial features. That is harmless here: they share a name, and we
 * want the minimum distance across all of them.
 */
export function streetAt(
  map: Pick<MapLibreMap, 'querySourceFeatures'>,
  lon: number,
  lat: number,
  options: { readonly maxSnapM?: number; readonly sourceLayer?: string } = {},
): StreetGuess | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const maxSnapM = options.maxSnapM ?? MAX_SNAP_M;

  let features: { properties?: Record<string, unknown> | null; geometry?: unknown }[];
  try {
    features = map.querySourceFeatures('basemap', {
      sourceLayer: options.sourceLayer ?? 'roads',
    }) as typeof features;
  } catch {
    // No source, no style, no map. The card falls back to what it had.
    return null;
  }

  const point: [number, number] = [lon, lat];
  /** Best distance per NAME, because one road arrives as many split features. */
  const byName = new Map<string, number>();

  for (const feature of features) {
    const name = feature.properties?.['name'];
    if (typeof name !== 'string' || name.trim() === '') continue;
    for (const ring of coordinateRings(feature.geometry)) {
      for (let i = 1; i < ring.length; i += 1) {
        const a = ring[i - 1];
        const b = ring[i];
        if (a === undefined || b === undefined) continue;
        const distance = distanceToSegmentM(point, a, b);
        const best = byName.get(name);
        if (best === undefined || distance < best) byName.set(name, distance);
      }
    }
  }

  const ranked = [...byName.entries()].sort((a, b) => a[1] - b[1]);
  const winner = ranked[0];
  if (winner === undefined || winner[1] > maxSnapM) return null;

  // AMBIGUITY. Two roads within a whisker of each other is the frontage-road
  // case, and there is no honest answer -- so there is no answer. See the
  // header for why a wrong street is worse than none.
  const runnerUp = ranked[1];
  if (runnerUp !== undefined && winner[1] > runnerUp[1] * AMBIGUITY_RATIO) return null;

  return { name: winner[0], distanceM: Math.round(winner[1] * 10) / 10 };
}
