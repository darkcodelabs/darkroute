/**
 * WHICH READERS ARE ACTUALLY ON THIS ROUTE.
 *
 * =============================================================================
 * WHY THIS IS NOT "CAMERAS NEAR THE DESTINATION"
 * =============================================================================
 * A driver asking to avoid cameras is asking about the ROAD THEY WILL DRIVE,
 * not about a circle drawn around where they are going. Those are very
 * different sets: a forty-mile route passes hundreds of readers the destination
 * is nowhere near, and a reader two blocks from the destination on a street the
 * route never enters is not one they will pass.
 *
 * So this measures each camera against the route LINE - every segment of it -
 * and keeps the ones within a corridor either side.
 *
 * =============================================================================
 * WHY IT IS ALL LOCAL AND WHY THAT MATTERS
 * =============================================================================
 * The route shape came back from the server; the cameras are already on the
 * phone. Pairing them happens here, on the device, which means the server is
 * never told which readers a driver cares about and never sees the answer.
 *
 * It also means this runs on every route with no request, so the count on the
 * card is live rather than something fetched and then out of date.
 */

import type { CameraRecord } from '../../stores/cameras.ts';

export interface RoutePoint {
  readonly lat: number;
  readonly lon: number;
}

/**
 * HOW FAR OFF THE LINE STILL COUNTS, in metres.
 *
 * 60 m. A reader watches the road it is on; one that far off the route's
 * centreline is on that road or on the junction it crosses. Wider and a route
 * down a main street starts claiming the readers on the parallel one, which
 * makes "route around all 9" avoid nine cameras a driver was never going to
 * pass and adds miles for nothing.
 *
 * Narrower is worse in a way that is harder to see: a route's shape is a
 * polyline of the road centreline, and a reader on a pole at a wide junction is
 * genuinely 30-40 m from it. Cut this to 25 m and the app confidently reports
 * no cameras on a road with a camera on it.
 */
export const CORRIDOR_M = 60;

const M_PER_DEG_LAT = 111_320;

/**
 * How close a point is to a segment, AND how far along that segment.
 *
 * Both, from one projection, because the caller needs both and computing them
 * separately would do the same arithmetic twice per camera per segment.
 *
 * `distSq` is squared and never square-rooted - the caller compares against
 * `CORRIDOR_M ** 2`, so the root would change no answer and costs a call per
 * segment.
 *
 * `t` is the position along AB of the closest point, 0 at A and 1 at B. It is
 * what makes the RESULT ORDERED: a segment index alone puts every camera on a
 * two-point route at index 0, and the list comes back in whatever order the
 * cameras happened to be stored in rather than the order they are driven past.
 *
 * The projection is flat: longitude is scaled by `cos(lat)` and both axes
 * become metres. Over a segment of road that is exact enough to be irrelevant,
 * and haversine per segment is thirty times the arithmetic for an answer that
 * differs by centimetres.
 */
export function projectOnSegment(
  point: RoutePoint,
  a: RoutePoint,
  b: RoutePoint,
): { distSq: number; t: number } {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const px = (point.lon - a.lon) * scale * M_PER_DEG_LAT;
  const py = (point.lat - a.lat) * M_PER_DEG_LAT;
  const bx = (b.lon - a.lon) * scale * M_PER_DEG_LAT;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;

  const lenSq = bx * bx + by * by;
  // A zero-length segment - two identical shape points, which routers do emit -
  // is just the point A.
  if (lenSq === 0) return { distSq: px * px + py * py, t: 0 };

  // Clamped to the segment itself, so a camera beyond either end measures to
  // the END rather than to the infinite line through it.
  let t = (px * bx + py * by) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  const dx = px - t * bx;
  const dy = py - t * by;
  return { distSq: dx * dx + dy * dy, t };
}

/** Just the distance. Kept because most callers only ever want that. */
export function metresToSegmentSq(point: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  return projectOnSegment(point, a, b).distSq;
}

/**
 * The cameras within `CORRIDOR_M` of the route, in the order they are passed.
 *
 * ORDER MATTERS and is why this returns the index of the nearest segment as
 * well: "the next one is in 1.5 miles" is the reading a driver acts on, and it
 * cannot be answered by a set.
 *
 * PRE-FILTERED BY BOUNDING BOX before any segment arithmetic. A route across a
 * metro area has a few thousand shape points and the phone holds tens of
 * thousands of cameras; testing every camera against every segment is tens of
 * millions of operations on a phone that is also drawing a map. The box test is
 * two comparisons and discards almost everything.
 */
export function camerasOnRoute(
  shape: readonly RoutePoint[],
  cameras: readonly CameraRecord[],
): readonly CameraRecord[] {
  if (shape.length < 2) return [];

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of shape) {
    if (point.lon < west) west = point.lon;
    if (point.lon > east) east = point.lon;
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
  }

  // The corridor, in degrees, so the bounding box does not clip a camera that
  // is inside the corridor but outside the shape's own extent.
  const padLat = CORRIDOR_M / M_PER_DEG_LAT;
  const midLat = (south + north) / 2;
  const padLon = padLat / Math.max(0.01, Math.cos((midLat * Math.PI) / 180));

  const limitSq = CORRIDOR_M * CORRIDOR_M;
  const found: { camera: CameraRecord; at: number }[] = [];

  for (const camera of cameras) {
    if (camera.lon < west - padLon || camera.lon > east + padLon) continue;
    if (camera.lat < south - padLat || camera.lat > north + padLat) continue;

    let bestSq = Infinity;
    /*
     * DISTANCE ALONG THE ROUTE, as `segment index + fraction of it`. Not a
     * metre count - the segments are not equal lengths - but strictly
     * increasing along the line, which is all an ordering needs.
     *
     * The fraction is the part that matters: without it every camera on a
     * two-point route shares index 0 and the list comes back in storage order.
     */
    let bestAt = 0;
    for (let i = 0; i < shape.length - 1; i += 1) {
      const a = shape[i];
      const b = shape[i + 1];
      if (a === undefined || b === undefined) continue;
      const { distSq, t } = projectOnSegment(camera, a, b);
      if (distSq < bestSq) {
        bestSq = distSq;
        bestAt = i + t;
      }
    }
    if (bestSq <= limitSq) found.push({ camera, at: bestAt });
  }

  found.sort((x, y) => x.at - y.at);
  return found.map((entry) => entry.camera);
}
