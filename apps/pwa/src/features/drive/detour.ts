/**
 * WHAT DRIVE HAS, AND WHAT `planDetour` NEEDS.
 *
 * =============================================================================
 * THE MISSING HALF OF THE INPUT
 * =============================================================================
 * `packages/core/src/avoidance.ts` plans a detour from a start, an END and a
 * set of cameras. DRIVE has the start and the cameras and has never had a
 * destination: nobody types one into this app, and `features/radar/reroute.ts`
 * already worked out why asking for one to dodge a camera two minutes ahead is
 * a worse interaction than the problem.
 *
 * So the end point is DERIVED, and it is the honest one: straight along the
 * heading, far enough to be past the last camera this phone is tracking, and
 * not one foot further. The route ends where the app's knowledge ends. That is
 * a claim the product can keep, unlike a destination it invented, and it is
 * what the prompt tells the driver the route is.
 *
 * =============================================================================
 * WHY A REFUSAL IS A VALUE AND NOT A NULL
 * =============================================================================
 * `reroute.ts` carries the report that closed its own version of this: the key
 * stayed drawn at full strength and silently did nothing, on a road where the
 * honest behaviour and a broken control look exactly alike.
 *
 * A bare null here would put that back. There are four separate reasons this
 * can come to nothing - no fix, never moved, every camera already clear, every
 * camera ON the road - and they are four different things to tell a driver.
 * The caller renders whichever one is true, so the key always answers.
 */

import {
  DEFAULT_CLEARANCE_FT,
  closestApproachFt,
  destinationPoint,
  feetToMetres,
  planDetour,
} from '../../stores/fwmCore.ts';
import type { DetourPlan, LatLon } from '../../stores/fwmCore.ts';

/**
 * How far past the last known camera the route ends, in feet.
 *
 * A quarter of a mile. It has to be more than the clearance or the last camera
 * would sit outside the planned stretch and be dropped from the plan, and it
 * should not be much more: every foot beyond the last camera is a foot of
 * route the app is guessing at. `reroute.ts` puts its single waypoint two
 * miles out because it has nothing else to aim at; this has the cameras.
 */
export const DETOUR_RUNOUT_FT = 1320;

/** The shape this needs off an assessment. `CameraAssessment` satisfies it. */
export interface DetourCamera {
  readonly lat: number;
  readonly lon: number;
  readonly distanceFt: number;
}

/**
 * Why there is no route. Every one of these is said out loud somewhere.
 *
 *   no-fix           no gps yet. there is no line to route off.
 *   no-heading       never seen moving. a detour needs a direction, and a
 *                    heading computed inside a parked phone's error cloud is
 *                    a random number - see `steady.ts`.
 *   nothing-ahead    no cameras being tracked at all.
 *   already-clear    the cameras ahead are outside the berth already.
 *   all-unavoidable  they are ON the road. no stop to one side moves the
 *                    route off them, and saying so is the point.
 */
export type DetourRefusal =
  | 'no-fix'
  | 'no-heading'
  | 'nothing-ahead'
  | 'already-clear'
  | 'all-unavoidable';

export type DetourOutcome =
  | {
      readonly kind: 'route';
      /** Where the route ends: along the heading, past the last camera. */
      readonly to: LatLon;
      readonly plan: DetourPlan;
      /**
       * The closest any planned stop comes to a known camera, in feet.
       *
       * MEASURED, not promised. The plan aims each stop a clearance off the
       * far side of a CLUSTER's mean, so an outlier inside a cluster can end
       * up nearer than the berth asked for. The prompt prints this number
       * rather than repeating the berth, because the berth is the request and
       * this is the result.
       */
      readonly closestFt: number | null;
    }
  | {
      readonly kind: 'none';
      readonly reason: DetourRefusal;
      /** Cameras on the line itself. Only meaningful for `all-unavoidable`. */
      readonly unavoidable: number;
      /**
       * The berth that was asked for, carried even when nothing was planned.
       *
       * `already-clear` has to print it - "already further than 1000 ft off
       * your line" is the whole explanation - and reading it back off a
       * default in the view would let the sentence and the arithmetic drift
       * apart the first time a caller asks for a different berth.
       */
      readonly clearanceFt: number;
    };

/** A start point. Deliberately structural: this never sees the position store. */
export interface DetourOrigin {
  readonly lat: number;
  readonly lon: number;
}

function refuse(
  reason: DetourRefusal,
  clearanceFt: number,
  unavoidable = 0,
): DetourOutcome {
  return { kind: 'none', reason, unavoidable, clearanceFt };
}

/**
 * Plan the detour DRIVE would send, or say why it cannot.
 *
 * NOTHING HERE IS KEPT. The result is handed straight to the surface that asks
 * the driver about it and is dropped when that surface closes; see
 * `DetourOffer.tsx`. The origin is not part of the result at all - the handoff
 * does not carry an origin (`routeVia.ts`), so there is no reason for the live
 * fix to travel any further than this function.
 *
 * @param headingDeg the STEADY heading, not the raw one. See `steady.ts`: a
 *   stationary phone reports a course computed from inside its own error
 *   cloud, and a route built along that points somewhere arbitrary.
 */
export function planDriveDetour(
  from: DetourOrigin | null,
  headingDeg: number | null,
  cameras: readonly DetourCamera[],
  clearanceFt: number = DEFAULT_CLEARANCE_FT,
): DetourOutcome {
  if (from === null || !Number.isFinite(from.lat) || !Number.isFinite(from.lon)) {
    return refuse('no-fix', clearanceFt);
  }
  if (headingDeg === null || !Number.isFinite(headingDeg)) {
    return refuse('no-heading', clearanceFt);
  }

  // A camera with no measured distance cannot size the route, and one with no
  // position cannot be routed around. Dropped rather than defaulted.
  const usable = cameras.filter(
    (camera) =>
      Number.isFinite(camera.lat) &&
      Number.isFinite(camera.lon) &&
      Number.isFinite(camera.distanceFt),
  );
  if (usable.length === 0) return refuse('nothing-ahead', clearanceFt);

  /*
   * HOW LONG THE ROUTE IS.
   *
   * Straight-line distance is an upper bound on how far ALONG the heading a
   * camera sits, so a run-out measured from the farthest of them is past every
   * one of them whatever direction they lie in. Getting this wrong in the
   * other direction is the expensive mistake: `planDetour` ignores anything
   * beyond the end point, so a route that stopped short would silently plan
   * around fewer cameras than the key counted.
   */
  const farthestFt = usable.reduce((far, camera) => Math.max(far, camera.distanceFt), 0);
  const to = destinationPoint(
    from.lat,
    from.lon,
    headingDeg,
    feetToMetres(farthestFt + DETOUR_RUNOUT_FT),
  );

  const plan = planDetour(from, to, usable, { clearanceFt });
  if (plan.waypoints.length > 0) {
    return { kind: 'route', to, plan, closestFt: closestApproachFt(plan.waypoints, usable) };
  }
  if (plan.unavoidable > 0) return refuse('all-unavoidable', clearanceFt, plan.unavoidable);
  return refuse('already-clear', clearanceFt);
}
