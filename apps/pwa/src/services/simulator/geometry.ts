/**
 * Route geometry for the drive simulator.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE DOES NOT IMPLEMENT GEODESY. IT INVERTS THE ENGINE'S.
 *
 * `@fwm/core` solves the geodesic INVERSE problem: given two points, how far
 * apart are they (`distanceM`, Vincenty on WGS-84) and in what direction
 * (`bearing`). It does not solve the DIRECT problem - given a point, a bearing
 * and a distance, where do you end up - and a simulator needs exactly that to
 * put a vehicle 500.00 ft from a camera.
 *
 * The temptation is to write Vincenty's direct formula here. That would be a
 * second geodesy in the codebase, and the moment the two disagree by a
 * millimetre every threshold test starts asserting against a position the
 * engine measures differently from the way the simulator placed it.
 *
 * So instead: guess, ask the engine how wrong the guess is, correct, repeat.
 * The guess is a local flat-earth offset; the correction is a rotation and a
 * scale in a local north/east frame; the ONLY measurement anywhere in the loop
 * is `distanceM` and `bearing` from `@fwm/core`. The result is therefore
 * correct BY THE ENGINE'S OWN DEFINITION of correct, to
 * {@link SOLVER_TOLERANCE_M}, and `geometry.test.ts` asserts precisely that.
 *
 * The only geometry this file performs itself is linear interpolation of a
 * latitude/longitude pair, which is a parameterisation of a segment, not a
 * measurement of one - every distance derived from it is measured by the
 * engine.
 */

import {
  MIN_METRES_PER_DEGREE_LATITUDE,
  angularDifferenceDeg,
  assertLatLon,
  bearing,
  distanceM,
  feetToMetres,
  metresToFeet,
  normaliseBearingDeg,
  normaliseLongitudeDeg,
} from './fwmCore.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A bare coordinate. Not a fix: no accuracy, no speed, no time. */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** A compiled polyline: the legs, their lengths and where they point. */
export interface RouteGeometry {
  readonly points: readonly LatLon[];
  /** Length of each leg in metres, measured by `distanceM`. `points.length - 1` entries. */
  readonly legLengthsM: readonly number[];
  /** Distance from the start to each point. `cumulativeM[0]` is 0. */
  readonly cumulativeM: readonly number[];
  readonly totalM: number;
  /** Initial bearing of each leg, measured by `bearing`. */
  readonly legBearingsDeg: readonly number[];
}

/** Where the vehicle is after travelling `routeM` along a route. */
export interface RoutePosition {
  readonly point: LatLon;
  /** Index of the leg the vehicle is on. The last leg once the route ends. */
  readonly legIndex: number;
  /** Direction of travel - the leg's bearing. */
  readonly bearingDeg: number;
  /** Distance travelled from the start, metres. Clamped to the route. */
  readonly routeM: number;
  /** `true` once `routeM` has reached the end of the polyline. */
  readonly atEnd: boolean;
}

// ---------------------------------------------------------------------------
// Solver settings
// ---------------------------------------------------------------------------

/**
 * How close the solver has to get before it stops, metres. One micrometre.
 *
 * This is not an arbitrary small number, and it is not as small as it could
 * naively be written. The solver cannot beat its own oracle: `distanceM`
 * declares convergence when Vincenty's lambda iteration moves by less than
 * 1e-12 radians, and the residual that leaves - plus double-precision
 * round-off - puts a floor of roughly 1.3e-8 m on any distance this solver can
 * confirm. Measured, not assumed: iterating four times and iterating twenty
 * times both bottom out there. Asking for 1e-9 m would be asking for a
 * precision the engine does not have, and would spend twelve iterations
 * failing to reach it.
 *
 * A micrometre is two orders of magnitude above that floor and roughly
 * 3.3e-6 ft - three hundred thousand times finer than the smallest distance
 * this product renders. The alert threshold is a hard comparison
 * (`distance <= threshold`), and at this precision a point placed at "exactly
 * 500 ft" cannot land on the wrong side of it.
 */
export const SOLVER_TOLERANCE_M = 1e-6;

/**
 * Bearing convergence, degrees.
 *
 * Same story with a different floor: `bearing` is the initial GREAT-CIRCLE
 * bearing while `distanceM` is the ellipsoidal geodesic, so the two models
 * disagree by around 1.5e-6 degrees at the scales measured here and no amount
 * of iterating closes that. 1e-5 degrees is above the floor and, at 1000 ft,
 * is 1.7e-4 ft of cross-track error.
 */
export const SOLVER_BEARING_TOLERANCE_DEG = 1e-5;

/**
 * Iteration cap. The correction is multiplicative in distance and additive in
 * angle, so it reaches the tolerance above in three or four passes at any scale
 * this product measures; the cap exists so a pathological input terminates
 * rather than spins.
 */
export const SOLVER_MAX_ITERATIONS = 12;

/**
 * Latitude beyond which the local north/east frame stops being usable, because
 * the `1 / cos(latitude)` term in it runs away. Nothing in this product drives
 * there, and failing loudly beats returning a plausible wrong answer.
 */
export const MAX_SOLVER_LATITUDE_DEG = 85;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The one piece of geometry this file performs: a fraction of the way from `a`
 * to `b`. Longitude goes through `normaliseLongitudeDeg` so a leg that crosses
 * the antimeridian takes the short way round rather than the 359-degree way.
 */
function lerpPoint(a: LatLon, b: LatLon, t: number): LatLon {
  const dLon = normaliseLongitudeDeg(b.lon - a.lon);
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: normaliseLongitudeDeg(a.lon + dLon * t),
  };
}

// ---------------------------------------------------------------------------
// Direct problem, by inversion
// ---------------------------------------------------------------------------

function frameToPoint(from: LatLon, north: number, east: number, cosLat: number): LatLon {
  return {
    lat: clamp(from.lat + north, -90, 90),
    lon: normaliseLongitudeDeg(from.lon + east / cosLat),
  };
}

/**
 * The point exactly `metres` away from `from` on `bearingDeg`.
 *
 * Convergence is measured with `@fwm/core`'s `distanceM` and `bearing`, so the
 * returned point satisfies the engine's own measurement - not a second
 * geodesy's opinion of it.
 *
 * @throws RangeError on an invalid origin, a negative or non-finite distance,
 *         or an origin closer to a pole than {@link MAX_SOLVER_LATITUDE_DEG}.
 */
export function pointAtDistanceM(from: LatLon, bearingDeg: number, metres: number): LatLon {
  assertLatLon(from.lat, from.lon, 'pointAtDistanceM(from)');
  if (!Number.isFinite(metres) || metres < 0) {
    throw new RangeError(
      `pointAtDistanceM: metres must be finite and >= 0, received ${String(metres)}`,
    );
  }
  if (Math.abs(from.lat) > MAX_SOLVER_LATITUDE_DEG) {
    throw new RangeError(
      `pointAtDistanceM: the local frame is unusable above ${String(MAX_SOLVER_LATITUDE_DEG)} degrees of latitude, received ${String(from.lat)}`,
    );
  }
  if (metres === 0) return { lat: from.lat, lon: from.lon };

  const target = normaliseBearingDeg(bearingDeg);
  const cosLat = Math.cos(from.lat * DEG_TO_RAD);
  const targetRad = target * DEG_TO_RAD;

  // First guess: a flat-earth offset expressed in degrees of latitude. The
  // constant only has to be the right order of magnitude - the loop fixes it.
  let north = (metres * Math.cos(targetRad)) / MIN_METRES_PER_DEGREE_LATITUDE;
  let east = (metres * Math.sin(targetRad)) / MIN_METRES_PER_DEGREE_LATITUDE;
  let point = frameToPoint(from, north, east, cosLat);

  for (let i = 0; i < SOLVER_MAX_ITERATIONS; i++) {
    const achievedM = distanceM(from.lat, from.lon, point.lat, point.lon);
    if (achievedM === 0) break; // degenerate guess; nothing to correct against
    const achievedBearing = bearing(from.lat, from.lon, point.lat, point.lon);
    const distanceError = metres - achievedM;
    const bearingError = angularDifferenceDeg(target, achievedBearing);
    if (
      Math.abs(distanceError) <= SOLVER_TOLERANCE_M &&
      Math.abs(bearingError) <= SOLVER_BEARING_TOLERANCE_DEG
    ) {
      break;
    }
    const magnitude = Math.hypot(north, east) * (metres / achievedM);
    const angle = Math.atan2(east, north) + bearingError * DEG_TO_RAD;
    north = magnitude * Math.cos(angle);
    east = magnitude * Math.sin(angle);
    point = frameToPoint(from, north, east, cosLat);
  }
  return point;
}

/** {@link pointAtDistanceM} in the unit every screen in this product speaks. */
export function pointAtDistanceFt(from: LatLon, bearingDeg: number, ft: number): LatLon {
  return pointAtDistanceM(from, bearingDeg, feetToMetres(ft));
}

/**
 * The point exactly `metres` along the leg from `a` to `b`.
 *
 * Same inversion, applied to the interpolation parameter instead of an offset
 * vector: pick a `t`, ask the engine how far `lerp(a, b, t)` actually is from
 * `a`, scale `t`, repeat.
 *
 * @throws RangeError on invalid endpoints or a non-finite distance.
 */
export function pointAlongLeg(a: LatLon, b: LatLon, metres: number, legLengthM?: number): LatLon {
  assertLatLon(a.lat, a.lon, 'pointAlongLeg(a)');
  assertLatLon(b.lat, b.lon, 'pointAlongLeg(b)');
  if (!Number.isFinite(metres)) {
    throw new RangeError(`pointAlongLeg: metres must be finite, received ${String(metres)}`);
  }
  const length = legLengthM ?? distanceM(a.lat, a.lon, b.lat, b.lon);
  if (metres <= 0 || length === 0) return { lat: a.lat, lon: a.lon };
  if (metres >= length) return { lat: b.lat, lon: b.lon };

  let t = clamp(metres / length, 0, 1);
  let point = lerpPoint(a, b, t);
  for (let i = 0; i < SOLVER_MAX_ITERATIONS; i++) {
    const achievedM = distanceM(a.lat, a.lon, point.lat, point.lon);
    if (Math.abs(achievedM - metres) <= SOLVER_TOLERANCE_M) break;
    // A zero measurement means `t` collapsed; nudge it off the origin rather
    // than dividing by nothing.
    t = achievedM === 0 ? clamp(t + metres / length, 0, 1) : clamp(t * (metres / achievedM), 0, 1);
    point = lerpPoint(a, b, t);
  }
  return point;
}

// ---------------------------------------------------------------------------
// Segment generators
// ---------------------------------------------------------------------------

/**
 * A straight run: `lengthFt` on one bearing, sampled every `stepFt`.
 *
 * The simulator interpolates between waypoints anyway, so two points describe
 * the whole run. Subdividing is for callers who want the polyline to hug the
 * geodesic over a long leg, or who want waypoint indices to land somewhere
 * meaningful for `jumpToWaypoint`.
 *
 * @throws RangeError on a non-positive length or step.
 */
export function straightSegment(
  from: LatLon,
  bearingDeg: number,
  lengthFt: number,
  stepFt?: number,
): LatLon[] {
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) {
    throw new RangeError(`straightSegment: lengthFt must be finite and > 0, received ${String(lengthFt)}`);
  }
  const step = stepFt ?? lengthFt;
  if (!Number.isFinite(step) || step <= 0) {
    throw new RangeError(`straightSegment: stepFt must be finite and > 0, received ${String(step)}`);
  }
  const out: LatLon[] = [{ lat: from.lat, lon: from.lon }];
  for (let travelled = step; travelled < lengthFt; travelled += step) {
    out.push(pointAtDistanceFt(from, bearingDeg, travelled));
  }
  out.push(pointAtDistanceFt(from, bearingDeg, lengthFt));
  return out;
}

/**
 * A constant-radius turn, sampled as `steps` chords.
 *
 * Every vertex lands ON the circle of radius `radiusFt`, which is what makes
 * this a turn of that radius rather than a turn of approximately that radius:
 * each step advances by the true chord `2R·sin(Δ/2)` - NOT by `arcLength /
 * steps`, which is longer and would push every vertex progressively outside
 * the circle. The polyline is therefore an inscribed polygon, slightly shorter
 * than the arc it approximates, and slightly tighter than the road it stands
 * for. That is not an error in the simulation: the simulator measures along
 * the polyline it was actually given.
 *
 * `turnDeg` is signed: positive turns right (clockwise), negative left.
 *
 * @throws RangeError on a non-positive radius, a zero turn, or `steps < 1`.
 */
export function curvedSegment(
  from: LatLon,
  startBearingDeg: number,
  turnDeg: number,
  radiusFt: number,
  steps = 8,
): LatLon[] {
  if (!Number.isFinite(radiusFt) || radiusFt <= 0) {
    throw new RangeError(`curvedSegment: radiusFt must be finite and > 0, received ${String(radiusFt)}`);
  }
  if (!Number.isFinite(turnDeg) || turnDeg === 0) {
    throw new RangeError(`curvedSegment: turnDeg must be finite and non-zero, received ${String(turnDeg)}`);
  }
  if (!Number.isInteger(steps) || steps < 1) {
    throw new RangeError(`curvedSegment: steps must be an integer >= 1, received ${String(steps)}`);
  }

  const turnPerStep = turnDeg / steps;
  // The chord subtended by one step's turn, with both ends on the circle.
  const chordFt = 2 * radiusFt * Math.sin((Math.abs(turnPerStep) * DEG_TO_RAD) / 2);

  const out: LatLon[] = [{ lat: from.lat, lon: from.lon }];
  let cursor: LatLon = { lat: from.lat, lon: from.lon };
  let heading = normaliseBearingDeg(startBearingDeg);
  for (let i = 0; i < steps; i++) {
    // Advance on the heading at the middle of the step, which is what makes an
    // inscribed polygon symmetric about the arc instead of drifting outward.
    const chordBearing = normaliseBearingDeg(heading + turnPerStep / 2);
    cursor = pointAtDistanceFt(cursor, chordBearing, chordFt);
    heading = normaliseBearingDeg(heading + turnPerStep);
    out.push(cursor);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route compilation
// ---------------------------------------------------------------------------

/**
 * Measure a polyline once, so the tick loop never re-measures it.
 *
 * @throws RangeError on fewer than two points, an invalid coordinate, or two
 *         consecutive points at the same place (a zero-length leg has no
 *         bearing, and a route with one is a caller bug, not a road).
 */
export function buildRouteGeometry(points: readonly LatLon[]): RouteGeometry {
  if (points.length < 2) {
    throw new RangeError(
      `buildRouteGeometry: a route needs at least two points, received ${String(points.length)}. A stationary vehicle is a speed profile with a zero phase, not a one-point route.`,
    );
  }
  const copied: LatLon[] = [];
  for (const point of points) {
    assertLatLon(point.lat, point.lon, 'buildRouteGeometry(point)');
    copied.push({ lat: point.lat, lon: point.lon });
  }

  const legLengthsM: number[] = [];
  const legBearingsDeg: number[] = [];
  const cumulativeM: number[] = [0];
  for (let i = 0; i < copied.length - 1; i++) {
    const a = copied[i];
    const b = copied[i + 1];
    if (a === undefined || b === undefined) continue;
    const length = distanceM(a.lat, a.lon, b.lat, b.lon);
    if (length === 0) {
      throw new RangeError(
        `buildRouteGeometry: leg ${String(i)} has zero length; consecutive route points must differ`,
      );
    }
    legLengthsM.push(length);
    legBearingsDeg.push(bearing(a.lat, a.lon, b.lat, b.lon));
    cumulativeM.push((cumulativeM[i] ?? 0) + length);
  }

  return {
    points: copied,
    legLengthsM,
    cumulativeM,
    totalM: cumulativeM[cumulativeM.length - 1] ?? 0,
    legBearingsDeg,
  };
}

/**
 * Where the vehicle is after `metres` along the route.
 *
 * Distances past the end clamp to the end and report `atEnd`; the simulator
 * uses that to stop rather than to teleport back to the start.
 *
 * @throws RangeError on a non-finite distance.
 */
export function positionOnRoute(geometry: RouteGeometry, metres: number): RoutePosition {
  if (!Number.isFinite(metres)) {
    throw new RangeError(`positionOnRoute: metres must be finite, received ${String(metres)}`);
  }
  const lastLeg = geometry.legLengthsM.length - 1;
  const clamped = clamp(metres, 0, geometry.totalM);

  if (clamped >= geometry.totalM) {
    const end = geometry.points[geometry.points.length - 1];
    const heading = geometry.legBearingsDeg[lastLeg];
    if (end === undefined || heading === undefined) {
      throw new RangeError('positionOnRoute: route geometry is empty');
    }
    return { point: end, legIndex: lastLeg, bearingDeg: heading, routeM: geometry.totalM, atEnd: true };
  }

  // Linear scan. Routes here are tens of points, and a binary search would buy
  // nothing but an off-by-one to get wrong.
  let legIndex = 0;
  while (legIndex < lastLeg && (geometry.cumulativeM[legIndex + 1] ?? 0) <= clamped) {
    legIndex += 1;
  }
  const a = geometry.points[legIndex];
  const b = geometry.points[legIndex + 1];
  const legStart = geometry.cumulativeM[legIndex];
  const legLength = geometry.legLengthsM[legIndex];
  const heading = geometry.legBearingsDeg[legIndex];
  if (a === undefined || b === undefined || legStart === undefined || legLength === undefined || heading === undefined) {
    throw new RangeError(`positionOnRoute: leg ${String(legIndex)} is missing from the geometry`);
  }

  return {
    point: pointAlongLeg(a, b, clamped - legStart, legLength),
    legIndex,
    bearingDeg: heading,
    routeM: clamped,
    atEnd: false,
  };
}

/** Total route length in feet - the unit the screens speak. */
export function routeLengthFt(geometry: RouteGeometry): number {
  return metresToFeet(geometry.totalM);
}

/** Degrees to radians, exported so a caller does not re-derive the constant. */
export function degreesToRadians(deg: number): number {
  return deg * DEG_TO_RAD;
}

/** Radians to degrees. */
export function radiansToDegrees(rad: number): number {
  return rad * RAD_TO_DEG;
}
