/**
 * THE POSTED SPEED LIMIT OF THE ROAD UNDERNEATH - read off the map.
 *
 * =============================================================================
 * WHY A SEPARATE ARCHIVE
 * =============================================================================
 * Takes ALREADY-DECODED WAYS rather than a map, because the archive is z14-only
 * and MapLibre never requests a tile for it at RADAR's usual zoom -- see
 * `speedSource.ts`. This file is the judgement; that one is the fetch.
 *
 * The basemap carries no speed data. Verified by decoding its own roads layer:
 * `is_bridge, is_link, kind, kind_detail, min_zoom, name, network, oneway, ref,
 * shield_text, sort_rank` -- and every other off-the-shelf tile schema is the
 * same. Shortbread, OpenMapTiles and VersaTiles all omit it. So there is a
 * second, small archive holding nothing but drivable ways that actually carry
 * an OSM `maxspeed`, and this reads it.
 *
 * =============================================================================
 * IT REFUSES FAR MORE OFTEN THAN IT ANSWERS, ON PURPOSE
 * =============================================================================
 * The plate is drawn as an MUTCD road sign, so anything it prints it asserts
 * with a road sign's authority. `speedLimit.ts` therefore refuses every value
 * it cannot stand behind, and the job here is to hand it only readings that
 * survive the same test:
 *
 *   TOO FAR      A camera-side road 40 m away is a different road.
 *   AMBIGUOUS    A frontage road runs parallel to a freeway with a different
 *                limit; when two candidates are within a whisker of each other
 *                there is no defensible answer, so there is none.
 *   WRONG WAY    A road running across the driver's heading is a road they are
 *                crossing, not driving. Bearing disagreement is the single most
 *                useful signal for telling a junction from a carriageway.
 *
 * Coverage is about 56% of US vehicle-miles -- roughly 95% of freeway miles and
 * 10% of residential -- so a dash is the NORMAL answer on a side street, and
 * that is correct rather than broken.
 */

import type { SpeedWay } from './speedSource.ts';

/** How close a way must be to be the road under the vehicle, in metres. */
export const MAX_SNAP_M = 25;

/**
 * How much closer the winner must be than the runner-up.
 *
 * The frontage-road case. Two roads at similar distance is the situation where
 * a wrong answer is most likely AND most costly -- a 45 sign shown to somebody
 * on a 70 freeway, or the reverse.
 */
export const AMBIGUITY_RATIO = 0.6;

/**
 * How far the road's own direction may differ from the driver's heading.
 *
 * A road at right angles to travel is being crossed, not driven. Sixty degrees
 * is loose enough for a curve and a lane change; anything beyond it is a
 * different road. Applied only when a heading is actually known -- parked, the
 * orientation gate holds it null and this check cannot run.
 */
export const MAX_BEARING_DELTA_DEG = 60;

const EARTH_RADIUS_M = 6_378_137;

function metresBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const latRad = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * (Math.PI / 180) * Math.cos(latRad);
  const y = (b[1] - a[1]) * (Math.PI / 180);
  return Math.hypot(x, y) * EARTH_RADIUS_M;
}

/** Distance in metres from a point to a segment, and the segment's bearing. */
function segment(
  point: readonly [number, number],
  from: readonly [number, number],
  to: readonly [number, number],
): { distanceM: number; bearingDeg: number } {
  const scale = Math.cos(point[1] * (Math.PI / 180));
  const px = (point[0] - from[0]) * scale;
  const py = point[1] - from[1];
  const vx = (to[0] - from[0]) * scale;
  const vy = to[1] - from[1];
  const lenSq = vx * vx + vy * vy;
  const bearingDeg = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
  if (lenSq === 0) return { distanceM: metresBetween(point, from), bearingDeg };
  const t = Math.max(0, Math.min(1, (px * vx + py * vy) / lenSq));
  const nearest: [number, number] = [from[0] + (t * vx) / scale, from[1] + t * vy];
  return { distanceM: metresBetween(point, nearest), bearingDeg };
}


/**
 * Smallest angle between two bearings, ignoring direction of travel.
 *
 * A one-way pair is drawn in opposite directions and both are the same road, so
 * 175 degrees of disagreement is a match, not a mismatch.
 */
export function bearingDelta(a: number, b: number): number {
  const raw = Math.abs(((a - b + 540) % 360) - 180);
  return raw > 90 ? 180 - raw : raw;
}

export interface SpeedReading {
  /** The OSM `maxspeed` string, VERBATIM. Parsed by `speedLimit.ts`, not here. */
  readonly maxspeed: string;
  readonly distanceM: number;
}

/**
 * The posted limit for the way under this point, or null when unsure.
 *
 * Returns the raw OSM string rather than a number: `speedLimit.ts` owns every
 * decision about what is a usable value, and duplicating that here is how two
 * places start disagreeing about whether "signals" is a speed.
 */
export function speedAt(
  ways: readonly SpeedWay[],
  lon: number,
  lat: number,
  headingDeg: number | null,
  options: { readonly maxSnapM?: number } = {},
): SpeedReading | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const maxSnapM = options.maxSnapM ?? MAX_SNAP_M;

  const point: [number, number] = [lon, lat];
  const candidates: { maxspeed: string; distanceM: number }[] = [];

  for (const way of ways) {
    const maxspeed = way.maxspeed;
    if (typeof maxspeed !== 'string' || maxspeed.trim() === '') continue;

    let best: { distanceM: number; bearingDeg: number } | null = null;
    const ring = way.line;
    for (let i = 1; i < ring.length; i += 1) {
      const a = ring[i - 1];
      const b = ring[i];
      if (a === undefined || b === undefined) continue;
      const hit = segment(point, a, b);
      if (best === null || hit.distanceM < best.distanceM) best = hit;
    }
    if (best === null || best.distanceM > maxSnapM) continue;

    // WRONG WAY. A road across the heading is being crossed, not driven.
    if (headingDeg !== null && Number.isFinite(headingDeg)) {
      if (bearingDelta(best.bearingDeg, headingDeg) > MAX_BEARING_DELTA_DEG) continue;
    }

    candidates.push({ maxspeed, distanceM: best.distanceM });
  }

  candidates.sort((a, b) => a.distanceM - b.distanceM);
  const winner = candidates[0];
  if (winner === undefined) return null;

  // AMBIGUOUS. Two roads equally close, with DIFFERENT limits, is the
  // frontage-road case and has no defensible answer. Two that agree do not
  // conflict at all -- a divided carriageway is two ways and one limit.
  const rival = candidates.find((c) => c.maxspeed !== winner.maxspeed);
  if (rival !== undefined && winner.distanceM > rival.distanceM * AMBIGUITY_RATIO) return null;

  return { maxspeed: winner.maxspeed, distanceM: Math.round(winner.distanceM * 10) / 10 };
}
