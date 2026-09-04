/**
 * Geodesy for a product that alerts at 500 ft while doing 47 mph.
 *
 * Distance uses the Vincenty inverse solution on WGS-84 rather than haversine.
 * That is not gold-plating: at the Cincinnati fix the design screens use
 * (39.0997 N, 84.5786 W) a haversine sphere reports 500.80 ft for a point that
 * is exactly 500.00 ft away - 0.8 ft of error inside the tightest ring the
 * SWEEP screen draws (100 ft). The threshold slider bottoms out at 100 ft and
 * the watch bezel steps in 50 ft, so the measurement has to be good to well
 * under a foot for those controls to mean anything.
 */

import type { RelativeDirection } from './types.ts';

// ---------------------------------------------------------------------------
// Reference ellipsoid and unit conversion
// ---------------------------------------------------------------------------

/** WGS-84 semi-major axis, metres. */
export const EARTH_EQUATORIAL_RADIUS_M = 6378137.0;
/** WGS-84 flattening. */
export const EARTH_FLATTENING = 1 / 298.257223563;
/** WGS-84 semi-minor axis, metres. */
export const EARTH_POLAR_RADIUS_M = EARTH_EQUATORIAL_RADIUS_M * (1 - EARTH_FLATTENING);
/** IUGG mean radius, used only by the near-antipodal fallback. */
export const EARTH_MEAN_RADIUS_M = 6371008.8;

/** International foot. Exact by definition. */
export const METRES_PER_FOOT = 0.3048;
/** Exact by definition, as the reciprocal of {@link METRES_PER_FOOT}. */
export const FEET_PER_METRE = 1 / METRES_PER_FOOT;
/** Statute mile per hour in metres per second. Exact by definition. */
export const METRES_PER_SECOND_PER_MPH = 0.44704;

/**
 * The shortest a degree of latitude ever gets, metres (at the equator).
 * Used as a conservative window when bounding a search by latitude: a window
 * sized with the minimum is always wide enough at every other latitude.
 */
export const MIN_METRES_PER_DEGREE_LATITUDE = 110574;

/** Half-angle of the `ahead` sector. Four 90° sectors, `ahead` centred on the heading. */
export const AHEAD_HALF_ANGLE_DEG = 45;

/**
 * Half-angle of a camera's coverage cone, degrees.
 *
 * Sourced from `Flockys App Screens.dc.html` 06 · REPORT - the facing dial is
 * drawn `conic-gradient(from 200deg, … 0 60deg, transparent 60deg)`: a 60°
 * wedge, so ±30° either side of the lens axis.
 */
export const DEFAULT_FACING_TOLERANCE_DEG = 30;

export function feetToMetres(ft: number): number {
  return ft * METRES_PER_FOOT;
}

export function metresToFeet(m: number): number {
  return m * FEET_PER_METRE;
}

export function mphToMetresPerSecond(mph: number): number {
  return mph * METRES_PER_SECOND_PER_MPH;
}

export function metresPerSecondToMph(mps: number): number {
  return mps / METRES_PER_SECOND_PER_MPH;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Reject a coordinate that cannot exist.
 *
 * A silent NaN propagating through the alert engine is the worst failure this
 * package can have: the driver sees CLEAR and there is a camera. So bad input
 * throws at the boundary rather than producing a plausible-looking number.
 *
 * @throws RangeError on NaN, Infinity, |lat| > 90 or |lon| > 180.
 */
export function assertLatLon(lat: number, lon: number, label = 'coordinate'): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new RangeError(`${label}: lat/lon must be finite numbers, received ${String(lat)},${String(lon)}`);
  }
  if (lat < -90 || lat > 90) {
    throw new RangeError(`${label}: latitude out of range [-90, 90], received ${String(lat)}`);
  }
  if (lon < -180 || lon > 180) {
    throw new RangeError(`${label}: longitude out of range [-180, 180], received ${String(lon)}`);
  }
}

function assertFiniteDegrees(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label}: expected a finite number of degrees, received ${String(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Fold any bearing into [0, 360). Handles negatives and multiple turns. */
export function normaliseBearingDeg(deg: number): number {
  assertFiniteDegrees(deg, 'normaliseBearingDeg');
  const wrapped = deg % 360;
  if (wrapped >= 0) return wrapped;
  // A tiny negative (-1e-15, which `atan2` produces for a due-north bearing
  // computed the long way round) plus 360 rounds to exactly 360 in binary
  // floating point. The interval is half-open, so that has to come back as 0
  // or every `< 360` check downstream is a lie.
  const shifted = wrapped + 360;
  return shifted >= 360 ? 0 : shifted;
}

/**
 * Signed shortest angular difference `a - b`, in (-180, 180].
 * Positive means `a` is clockwise of `b`.
 */
export function angularDifferenceDeg(a: number, b: number): number {
  assertFiniteDegrees(a, 'angularDifferenceDeg');
  assertFiniteDegrees(b, 'angularDifferenceDeg');
  const diff = ((a - b) % 360 + 540) % 360 - 180;
  // The fold above lands exactly on -180 for antipodal angles; report +180 so
  // the range is (-180, 180] and `Math.abs` never has two answers.
  return diff === -180 ? 180 : diff;
}

/** Fold a longitude into [-180, 180). +180 wraps to -180 - they are the same meridian. */
export function normaliseLongitudeDeg(lon: number): number {
  assertFiniteDegrees(lon, 'normaliseLongitudeDeg');
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

const VINCENTY_MAX_ITERATIONS = 200;
const VINCENTY_CONVERGENCE = 1e-12;

/** Great-circle fallback for the near-antipodal case Vincenty cannot solve. */
function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dPhi = phi2 - phi1;
  const dLambda = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Geodesic distance in metres (Vincenty inverse, WGS-84).
 *
 * Accurate to well under a millimetre for everything that is not close to
 * antipodal. Antipodal pairs do not converge; those fall back to a spherical
 * great circle, which is fine because nothing in this product measures halfway
 * around the world.
 *
 * @throws RangeError on invalid coordinates.
 */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  assertLatLon(lat1, lon1, 'distanceM(from)');
  assertLatLon(lat2, lon2, 'distanceM(to)');

  const a = EARTH_EQUATORIAL_RADIUS_M;
  const b = EARTH_POLAR_RADIUS_M;
  const f = EARTH_FLATTENING;

  // Signed shortest longitude difference: this is what makes the antimeridian
  // a non-event. 179.99°E to 179.99°W is 0.02° apart, not 359.98°.
  const L = normaliseLongitudeDeg(lon2 - lon1) * DEG_TO_RAD;

  const U1 = Math.atan((1 - f) * Math.tan(lat1 * DEG_TO_RAD));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * DEG_TO_RAD));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cosSqAlpha = 0;
  let cos2SigmaM = 0;
  let converged = false;

  for (let i = 0; i < VINCENTY_MAX_ITERATIONS; i++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return 0; // coincident points
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    // cosSqAlpha === 0 is an equatorial line, where 2*sigma_m is undefined.
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    const lambdaPrev = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - lambdaPrev) < VINCENTY_CONVERGENCE) {
      converged = true;
      break;
    }
  }

  if (!converged) return haversineMetres(lat1, lon1, lat2, lon2);

  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  return b * A * (sigma - deltaSigma);
}

/**
 * Geodesic distance in feet. The unit every screen in this product speaks.
 *
 * @throws RangeError on invalid coordinates.
 */
export function distanceFt(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return metresToFeet(distanceM(lat1, lon1, lat2, lon2));
}

// ---------------------------------------------------------------------------
// Bearing
// ---------------------------------------------------------------------------

/**
 * Initial great-circle bearing from one point to another, in [0, 360).
 * 0 = north, increasing clockwise - the same convention as a compass and as
 * the REPORT sheet's "223°".
 *
 * Coincident points have no bearing; this returns 0 for them rather than NaN,
 * because a camera you are standing on is `ahead` by every useful reading.
 *
 * @throws RangeError on invalid coordinates.
 */
export function bearing(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  assertLatLon(fromLat, fromLon, 'bearing(from)');
  assertLatLon(toLat, toLon, 'bearing(to)');

  const phi1 = fromLat * DEG_TO_RAD;
  const phi2 = toLat * DEG_TO_RAD;
  const dLambda = normaliseLongitudeDeg(toLon - fromLon) * DEG_TO_RAD;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  if (y === 0 && x === 0) return 0;
  return normaliseBearingDeg(Math.atan2(y, x) * RAD_TO_DEG);
}

// ---------------------------------------------------------------------------
// Relative direction
// ---------------------------------------------------------------------------

/**
 * Which quadrant of the windscreen a camera sits in.
 *
 * Four 90° sectors with `ahead` centred on the heading. Sectors are half-open,
 * lower bound inclusive, walking clockwise from `ahead`:
 *
 *   [315, 360) ∪ [0, 45) → ahead
 *   [45, 135)            → right
 *   [135, 225)           → behind
 *   [225, 315)           → left
 *
 * So exactly 45 is `right`, exactly 135 is `behind`, exactly 225 is `left`,
 * exactly 315 is `ahead`. Picking a side at every cut point matters more than
 * which side: a boundary that belongs to nobody is a boundary that flickers.
 *
 * @throws RangeError if either angle is not finite.
 */
export function relativeDirection(
  vehicleHeading: number,
  cameraBearing: number,
): RelativeDirection {
  assertFiniteDegrees(vehicleHeading, 'relativeDirection(vehicleHeading)');
  assertFiniteDegrees(cameraBearing, 'relativeDirection(cameraBearing)');

  const relative = normaliseBearingDeg(cameraBearing - vehicleHeading);
  if (relative < AHEAD_HALF_ANGLE_DEG || relative >= 360 - AHEAD_HALF_ANGLE_DEG) return 'ahead';
  if (relative < 180 - AHEAD_HALF_ANGLE_DEG) return 'right';
  if (relative < 180 + AHEAD_HALF_ANGLE_DEG) return 'behind';
  return 'left';
}

// ---------------------------------------------------------------------------
// Facing
// ---------------------------------------------------------------------------

/**
 * Is this camera's lens pointed back at the vehicle?
 *
 * `cameraDirection` is where the lens looks; `vehicleBearingToCamera` is the
 * bearing FROM the vehicle TO the camera. The camera is looking at you when
 * its axis is within `toleranceDeg` of the reciprocal of that bearing.
 *
 * Returns `null` - never `false` - when the facing is unknown. An unrecorded
 * facing is missing information, not an all-clear, and the caller has to render
 * that difference. A camera with a `null` facing is still counted, still drawn
 * and still alerted on.
 *
 * @param toleranceDeg half-angle of the coverage cone. Defaults to
 *        {@link DEFAULT_FACING_TOLERANCE_DEG} (the 60° wedge the REPORT sheet draws).
 * @throws RangeError if the tolerance is outside (0, 180] or an angle is not finite.
 */
export function isFacingVehicle(
  cameraDirection: number | null,
  vehicleBearingToCamera: number,
  toleranceDeg: number = DEFAULT_FACING_TOLERANCE_DEG,
): boolean | null {
  if (cameraDirection === null) return null;
  assertFiniteDegrees(cameraDirection, 'isFacingVehicle(cameraDirection)');
  assertFiniteDegrees(vehicleBearingToCamera, 'isFacingVehicle(vehicleBearingToCamera)');
  if (!Number.isFinite(toleranceDeg) || toleranceDeg <= 0 || toleranceDeg > 180) {
    throw new RangeError(
      `isFacingVehicle: toleranceDeg must be in (0, 180], received ${String(toleranceDeg)}`,
    );
  }
  const reciprocal = normaliseBearingDeg(vehicleBearingToCamera + 180);
  return Math.abs(angularDifferenceDeg(cameraDirection, reciprocal)) <= toleranceDeg;
}

/**
 * The point you reach by leaving one from a bearing and travelling a distance.
 *
 * The inverse of {@link bearing} and {@link distanceM}, and the piece routing
 * around something needs: a detour waypoint is "the road position 1000 ft to
 * the side of that camera", which cannot be expressed without projecting.
 *
 * SPHERICAL, DELIBERATELY, while `distanceM` is ellipsoidal. Over the distances
 * this is used at - hundreds of feet to a few miles - the two disagree by well
 * under a metre, which is far inside the error of the thing being avoided: an
 * OSM camera node is a hand-placed point, and its own position is good to a few
 * metres at best. Spending an iterative Vincenty solution on that would be
 * false precision, and the closing error would still be dominated by the node.
 *
 * @throws RangeError on invalid coordinates.
 */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceMetres: number,
): { readonly lat: number; readonly lon: number } {
  assertLatLon(lat, lon, 'destinationPoint(from)');
  if (!Number.isFinite(bearingDeg)) throw new RangeError('destinationPoint: bearing is not finite');
  if (!Number.isFinite(distanceMetres)) {
    throw new RangeError('destinationPoint: distance is not finite');
  }

  const angular = distanceMetres / EARTH_MEAN_RADIUS_M;
  const theta = normaliseBearingDeg(bearingDeg) * DEG_TO_RAD;
  const phi1 = lat * DEG_TO_RAD;
  const lambda1 = lon * DEG_TO_RAD;

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angular) * Math.cos(phi1),
      Math.cos(angular) - Math.sin(phi1) * sinPhi2,
    );

  return {
    lat: phi2 * RAD_TO_DEG,
    lon: normaliseLongitudeDeg(lambda2 * RAD_TO_DEG),
  };
}
