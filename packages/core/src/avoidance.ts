/**
 * ROUTE AROUND THEM - detour waypoints that keep a distance from cameras.
 *
 * =============================================================================
 * WHAT THIS IS, AND THE ONE THING IT IS NOT
 * =============================================================================
 * Given where you are, where you are going, and the cameras that are cached on
 * the phone, this returns a short ordered list of points to travel VIA. Handed
 * to a maps app as intermediate stops, they bias the route away from the
 * cameras beside it.
 *
 * IT IS NOT A ROUTING ENGINE AND IT DOES NOT PROMISE AVOIDANCE. There is no
 * road graph here. A waypoint 1000 ft to the side of a camera may sit in a
 * field, a river, or the wrong carriageway of a divided highway; the maps app
 * will then route to the nearest drivable point to it, which may be back past
 * the camera. What this can honestly say is "these are the points to prefer",
 * and what the caller must honestly say is that the result is a suggestion.
 *
 * That distinction is the whole reason this file is separate from the button.
 * "Route around all 9" has been firing a `geo:` intent that drops a single pin
 * and routes past everything - a promise the code could not keep. Replacing one
 * overclaim with a subtler one would be worse, not better, so the return type
 * carries the counts that let a caller tell the truth: how many cameras the
 * waypoints came from, how many are too close to push off at all, and how many
 * were dropped for the handoff's own limit.
 *
 * =============================================================================
 * WHY CLEARANCE IS A DISTANCE AND NOT A ROUTE COST
 * =============================================================================
 * An ALPR camera reads a plate at a range set by its optics and the geometry of
 * the road, not by how far your route happens to deviate. So the input is a
 * flat distance in feet, defaulting to {@link DEFAULT_CLEARANCE_FT}, and every
 * camera inside it is treated the same. A driver who wants a wider berth raises
 * one number.
 */

import { bearing, destinationPoint, distanceM, feetToMetres, metresToFeet } from './geo.ts';

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** The default berth, in feet. Comfortably outside typical ALPR read range. */
export const DEFAULT_CLEARANCE_FT = 1000;

/**
 * How many intermediate stops a handoff may carry.
 *
 * Nine is the Google Maps URL limit for `waypoints`, and it is the smallest cap
 * among the handoffs this could use, so it is the one that binds. Cameras past
 * it are REPORTED rather than quietly discarded - see {@link DetourPlan.dropped}.
 */
export const MAX_HANDOFF_WAYPOINTS = 9;

/**
 * Cameras closer together than this along the route share one waypoint.
 *
 * Without it a row of six cameras down one boulevard becomes six stops, which
 * exhausts the cap and produces a zig-zag no driver would follow. Expressed as
 * a multiple of the clearance because that is the scale the detour works at.
 */
export const CLUSTER_SPAN_MULTIPLE = 2;

export interface DetourOptions {
  /** The berth to keep, in feet. Defaults to {@link DEFAULT_CLEARANCE_FT}. */
  readonly clearanceFt?: number;
  /** Cap on returned waypoints. Defaults to {@link MAX_HANDOFF_WAYPOINTS}. */
  readonly maxWaypoints?: number;
}

export interface DetourPlan {
  /** The points to travel via, in the order they are met. */
  readonly waypoints: readonly LatLon[];
  /** How many cameras beside the route the waypoints were derived from. */
  readonly consideredCameras: number;
  /**
   * Cameras so close to the straight line that no side has room.
   *
   * A camera essentially ON the route cannot be pushed off it by moving the
   * route sideways - both sides are inside the clearance. Saying so is the
   * point: this is the case where a detour cannot help and the driver should
   * know they will pass it.
   */
  readonly unavoidable: number;
  /** Waypoints the cap discarded. Never silent. */
  readonly dropped: number;
  /** The clearance actually applied, in feet. */
  readonly clearanceFt: number;
}

/** Cross-track and along-track offsets of a point from a great-circle path. */
interface Offsets {
  readonly crossTrackM: number;
  readonly alongTrackM: number;
}

/**
 * Where a point sits relative to the path, in metres.
 *
 * `crossTrackM` is signed: positive is right of the direction of travel,
 * negative is left. That sign is what decides which way the detour goes, so it
 * has to survive rather than being absolute-valued for convenience.
 */
function offsetsFromPath(from: LatLon, pathBearingDeg: number, point: LatLon): Offsets {
  const R = 6371008.8;
  const d13 = distanceM(from.lat, from.lon, point.lat, point.lon);
  if (d13 === 0) return { crossTrackM: 0, alongTrackM: 0 };

  const theta13 = bearing(from.lat, from.lon, point.lat, point.lon);
  const delta13 = d13 / R;
  const deltaTheta = ((theta13 - pathBearingDeg) * Math.PI) / 180;

  const crossTrack = Math.asin(Math.sin(delta13) * Math.sin(deltaTheta)) * R;
  const alongTrackCos = Math.cos(delta13) / Math.cos(crossTrack / R);
  const alongTrack = Math.acos(Math.min(1, Math.max(-1, alongTrackCos))) * R;

  // `acos` cannot tell ahead from behind, so recover it from the turn angle.
  const behind = Math.abs(((theta13 - pathBearingDeg + 540) % 360) - 180) > 90;
  return { crossTrackM: crossTrack, alongTrackM: behind ? -alongTrack : alongTrack };
}

/**
 * Plan the detour.
 *
 * Cameras behind you, past the destination, or already outside the clearance
 * are ignored - the first two are not on the journey and the third needs no
 * action. What remains is grouped along the route, and each group yields one
 * waypoint pushed to the far side of the clearance from it.
 */
export function planDetour(
  from: LatLon,
  to: LatLon,
  cameras: readonly LatLon[],
  options: DetourOptions = {},
): DetourPlan {
  const clearanceFt = options.clearanceFt ?? DEFAULT_CLEARANCE_FT;
  const maxWaypoints = options.maxWaypoints ?? MAX_HANDOFF_WAYPOINTS;
  const clearanceM = feetToMetres(clearanceFt);
  const empty: DetourPlan = {
    waypoints: [],
    consideredCameras: 0,
    unavoidable: 0,
    dropped: 0,
    clearanceFt,
  };

  const routeLengthM = distanceM(from.lat, from.lon, to.lat, to.lon);
  if (routeLengthM === 0 || cameras.length === 0) return empty;
  const pathBearing = bearing(from.lat, from.lon, to.lat, to.lon);

  const beside = cameras
    .map((camera) => ({ camera, ...offsetsFromPath(from, pathBearing, camera) }))
    .filter(
      (entry) =>
        Math.abs(entry.crossTrackM) < clearanceM &&
        entry.alongTrackM > 0 &&
        entry.alongTrackM < routeLengthM,
    )
    .sort((a, b) => a.alongTrackM - b.alongTrackM);

  if (beside.length === 0) return empty;

  /*
   * A camera within a metre of the centreline has no roomy side: pushing the
   * route far enough to clear it puts the waypoint a full clearance out in a
   * direction the road probably does not go. Counted and reported instead of
   * being pushed anyway, so the caller can say "you will pass this one".
   */
  const ON_LINE_M = 1;
  const unavoidable = beside.filter((entry) => Math.abs(entry.crossTrackM) < ON_LINE_M).length;
  const pushable = beside.filter((entry) => Math.abs(entry.crossTrackM) >= ON_LINE_M);

  const clusterSpanM = clearanceM * CLUSTER_SPAN_MULTIPLE;
  const clusters: (typeof pushable)[] = [];
  for (const entry of pushable) {
    const current = clusters.at(-1);
    const last = current?.at(-1);
    if (current && last && entry.alongTrackM - last.alongTrackM <= clusterSpanM) current.push(entry);
    else clusters.push([entry]);
  }

  const all = clusters.map((cluster) => {
    const meanAlong = cluster.reduce((sum, e) => sum + e.alongTrackM, 0) / cluster.length;
    const meanCross = cluster.reduce((sum, e) => sum + e.crossTrackM, 0) / cluster.length;
    // The point on the route abreast of the cluster...
    const onRoute = destinationPoint(from.lat, from.lon, pathBearing, meanAlong);
    // ...pushed to the OPPOSITE side, far enough out to clear them.
    const awayBearing = pathBearing + (meanCross >= 0 ? -90 : 90);
    const pushM = clearanceM - Math.abs(meanCross) + clearanceM;
    return destinationPoint(onRoute.lat, onRoute.lon, awayBearing, pushM);
  });

  return {
    waypoints: all.slice(0, maxWaypoints),
    consideredCameras: beside.length,
    unavoidable,
    dropped: Math.max(0, all.length - maxWaypoints),
    clearanceFt,
  };
}

/**
 * The closest a plan's waypoints come to any of the given cameras, in feet.
 *
 * For tests and for telling a driver what the suggestion is actually worth.
 * Returns null when there are no waypoints to measure.
 */
export function closestApproachFt(
  waypoints: readonly LatLon[],
  cameras: readonly LatLon[],
): number | null {
  if (waypoints.length === 0 || cameras.length === 0) return null;
  let closest = Infinity;
  for (const point of waypoints) {
    for (const camera of cameras) {
      closest = Math.min(closest, distanceM(point.lat, point.lon, camera.lat, camera.lon));
    }
  }
  return metresToFeet(closest);
}
