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
 * So the end point is DERIVED, and it is the honest one: out along a bearing,
 * far enough to be past the last camera this phone is tracking, and not one
 * foot further. The route ends where the app's knowledge ends. That is a claim
 * the product can keep, unlike a destination it invented, and it is what the
 * prompt tells the driver the route is.
 *
 * =============================================================================
 * AND WHICH BEARING, WHICH IS THE PART THAT WAS WRONG
 * =============================================================================
 * The bearing used to be the device heading, full stop. That is right for the
 * surface this was written for: `features/alert/AlertV1.tsx` fires it MID
 * ALERT, where the car is moving, the course is measured, and the readers are
 * genuinely in front of the windscreen. Nothing about that case changes here.
 *
 * It is wrong for the surface that now also fires it. 4 DENSE AREA is a BROWSE
 * state - parked, or never yet moved, with readers scattered in every direction
 * over two miles. `planDetour` keeps only the cameras inside a corridor one
 * clearance either side of the line, so a bearing that owes nothing to the
 * readers put ONE of fourteen inside a 2000 ft-wide strip. One camera, one
 * cluster, one waypoint: "route around them" going one hop, which is the
 * reported defect, and it was never a fault in the planner.
 *
 * So when there is no heading to plan along, the line is AIMED AT THE SET -
 * see {@link detourAimBearing}. The corridor then contains readers because it
 * was chosen to, and the number the key prints is a number the plan delivers.
 *
 * WHAT THIS CANNOT DO, said once so nothing downstream implies otherwise: a
 * straight corridor cannot hold a ring. Fourteen readers scattered over two
 * miles do not fit on one line at any bearing, and widening the berth until
 * they did would both redefine the berth - which is an ALPR read range, not a
 * routing preference - and push every waypoint out by twice the widening. What
 * a single line can honestly carry is the most of them that any single line
 * carries, and that is what this picks.
 *
 * =============================================================================
 * WHY A REFUSAL IS A VALUE AND NOT A NULL
 * =============================================================================
 * `reroute.ts` carries the report that closed its own version of this: the key
 * stayed drawn at full strength and silently did nothing, on a road where the
 * honest behaviour and a broken control look exactly alike.
 *
 * A bare null here would put that back. There are several separate reasons this
 * can come to nothing - no fix, nothing tracked, every camera already clear,
 * every camera ON the road - and they are different things to tell a driver.
 * The caller renders whichever one is true, so the key always answers.
 *
 * =============================================================================
 * AND THE NUMBER ON THE KEY COMES OUT OF THE SAME CALL
 * =============================================================================
 * `Around 14` was counted off a different collection from the one the planner
 * was handed. The dock counted every reader inside two miles; the plan then
 * dropped every one of them that was behind the car, or further off the line
 * than the berth, or past the end point. Fourteen on the glass and nothing
 * routed around, which is what a driver reported.
 *
 * So the count is read off the PLAN and not off the input - see
 * `detourKeyCount` - and the surface that draws the key is the surface that
 * planned it. A number the route does not keep cannot reach the glass.
 *
 * =============================================================================
 * ONE COLLECTION, AND THE ROUTER GETS IT TOO
 * =============================================================================
 * The label, the planner's input and the set the router measures its answer
 * against were three readings of "the cameras". `detourRouteCameras` is the
 * third of them, built from the SAME array the planner is handed, so a caller
 * cannot count one set and route another without writing the second one down.
 */

import {
  DEFAULT_CLEARANCE_FT,
  angularDifferenceDeg,
  bearing,
  closestApproachFt,
  destinationPoint,
  distanceM,
  feetToMetres,
  normaliseBearingDeg,
  planDetour,
} from '../../stores/fwmCore.ts';
import type { DetourPlan, LatLon } from '../../stores/fwmCore.ts';
import type { CameraRecord } from '../../stores/cameras.ts';

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

/**
 * The shape this needs off an assessment. `CameraAssessment` satisfies it.
 *
 * `id` AND `directionDeg` ARE HERE FOR THE ROUTER, not for the geometry. The
 * planner needs a position and a range and nothing else. But the same array
 * has to reach `services/route/darkRoute.ts` as `CameraRecord`s - see
 * {@link detourRouteCameras} - and it cannot be identified or excluded without
 * an id. Demanding them here is what makes "the set you steer around is the
 * set you measure against" a type rule rather than a habit.
 */
export interface DetourCamera {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly directionDeg: number | null;
  readonly distanceFt: number;
}

/**
 * Why there is no route. Every one of these is said out loud somewhere.
 *
 *   no-fix           no gps yet. there is no line to route off.
 *   no-heading       no direction can be named at all: no course, and no
 *                    reader far enough from the car to aim at either. See
 *                    `planDriveDetour` - this became the degenerate case when
 *                    the bearing started being derived from the readers.
 *   nothing-ahead    no cameras being tracked at all.
 *   already-clear    the cameras on the line are outside the berth already.
 *   all-unavoidable  they are ON the line. no stop to one side moves the
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
      /** Where the route ends: along the aim, past the last camera. */
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
 * The cameras this can actually plan with, which is the set every half uses.
 *
 * A camera with no measured distance cannot size the route, and one with no
 * position cannot be routed around. Dropped rather than defaulted - and
 * dropped HERE, in one exported place, so the planner's input and the router's
 * input are the same array minus the same members rather than two filters that
 * agree until one of them is edited.
 */
export function usableDetourCameras<T extends DetourCamera>(
  cameras: readonly T[],
): readonly T[] {
  return cameras.filter(
    (camera) =>
      Number.isFinite(camera.lat) &&
      Number.isFinite(camera.lon) &&
      Number.isFinite(camera.distanceFt),
  );
}

/**
 * THE SAME COLLECTION, AS THE ROUTER TAKES IT.
 *
 * `services/route/darkRoute.ts` re-measures every round's new line against the
 * cameras it is handed - a route bent around the readers on your line is a
 * different road with its own readers on it, and a build that handed over only
 * the readers it had already avoided reported "2 avoided" over a line that
 * passed nine. So the set has to be wider than the plan's `consideredCameras`,
 * and it is: this is everything the caller was tracking, not the subset that
 * ended up beside the line.
 *
 * IT IS THE PLANNER'S ARRAY AND NOT A SECOND READING OF THE STORE. That is the
 * whole reason this function exists rather than the call site reaching for
 * `useCamerasStore.getState().cameras`: the label, the plan and the router's
 * measuring stick are then one collection, and "counts one set, routes
 * another" stops being expressible.
 *
 * The cost, said plainly: a reader outside whatever horizon the caller applied
 * is not measured against the returned line either. The caller's horizon has
 * to be wide enough to cover where the route can reach.
 */
export function detourRouteCameras(
  cameras: readonly DetourCamera[],
): readonly CameraRecord[] {
  return usableDetourCameras(cameras).map((camera) => ({
    id: camera.id,
    lat: camera.lat,
    lon: camera.lon,
    directionDeg: camera.directionDeg,
  }));
}

/**
 * How far inside the berth the aim is allowed to put its anchor, in metres.
 *
 * The bearing below is chosen so a named camera sits just inside the corridor.
 * "Just inside" has to survive the difference between the flat trigonometry
 * here and the great-circle cross-track `planDetour` actually filters on -
 * they agree to centimetres over these distances, not to nothing - or the very
 * camera the bearing was picked for falls out of the plan. Ten metres is three
 * orders of magnitude above that disagreement and 3% of a 1000 ft berth.
 */
const AIM_MARGIN_M = 10;

/** A camera inside the berth is in the corridor for any bearing ahead of it. */
const QUARTER_TURN_DEG = 90;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * How many readers the AIM may weigh, nearest first.
 *
 * The search below is quadratic, and this component is mounted for the life of
 * the app and re-planned at GPS rate - so the cost has to have a ceiling that
 * does not depend on how dense the city is. Measured at 500 readers it was
 * 30 ms a render; capped it is about two, whatever is cached.
 *
 * NEAREST FIRST, because this is a line the driver would leave on, and the
 * readers they meet first are the ones that will actually be on it.
 *
 * IT CAPS THE SEARCH AND NOT THE PROMISE. `planDetour` is still handed every
 * usable camera, so the number on the key counts readers this never looked at;
 * the cap can only cost a slightly worse bearing, never an overstated count.
 */
const AIM_MAX_CAMERAS = 128;

/** One camera's angular claim on the aim: which bearings put it in the corridor. */
interface AimArc {
  readonly bearingDeg: number;
  readonly halfWidthDeg: number;
  readonly rangeM: number;
}

/**
 * THE BEARING TO PLAN ALONG WHEN THE PHONE CANNOT NAME ONE.
 *
 * =============================================================================
 * WHAT IS BEING CHOSEN
 * =============================================================================
 * `planDetour` keeps a camera when its cross-track is inside the clearance and
 * its along-track is between the car and the end point. With the end point
 * always past the farthest camera, the second half is free, so membership is
 * decided entirely by the bearing: camera `i`, at range `d` and bearing `t`,
 * is in the corridor for exactly those aims within `asin(clearance / d)` of
 * `t`, and for anything within a quarter turn when it is nearer than the
 * clearance already.
 *
 * That makes each camera an ARC of acceptable bearings, and the question "which
 * line holds the most readers" is "which bearing is covered by the most arcs".
 * Coverage only ever RISES at an arc's leading edge, so the best bearing is one
 * of those and nothing else has to be tried - subject to the two restrictions
 * written down below, both of them deliberate: an abeam edge proposes nothing,
 * and only the nearest {@link AIM_MAX_CAMERAS} propose at all.
 *
 * =============================================================================
 * WHY THE EDGE AND NOT THE CAMERA
 * =============================================================================
 * Aiming straight AT a reader is the obvious thing and it is the wrong thing.
 * A camera on the centreline has no roomy side - `planDetour` counts it
 * `unavoidable` and refuses to push a waypoint off it - so a bearing picked by
 * pointing at a reader systematically produces the one plan that cannot help.
 * The arc edge puts that reader a berth off the line instead: still counted,
 * and pushable.
 *
 * =============================================================================
 * WHY THE DENSEST LINE AND NOT THE EMPTIEST
 * =============================================================================
 * The emptiest bearing is a real answer to a different question. This key says
 * `Around N` and offers to steer around N readers; a corridor with nothing in
 * it plans nothing, prints no key, and tells a parked driver nothing they did
 * not already see on the map. The densest corridor is the one where the offer
 * has the most to say, and every reader it names is one the plan actually
 * pushes the line off.
 *
 * =============================================================================
 * THE COST
 * =============================================================================
 * Quadratic in the readers it weighs, which is why it weighs at most
 * {@link AIM_MAX_CAMERAS} of them. Nothing here runs when a heading exists.
 *
 * Returns null when no bearing can be named at all, which needs every camera to
 * be sitting on the fix.
 */
export function detourAimBearing(
  from: DetourOrigin,
  cameras: readonly DetourCamera[],
  clearanceFt: number = DEFAULT_CLEARANCE_FT,
): number | null {
  const aimClearanceM = Math.max(1, feetToMetres(clearanceFt) - AIM_MARGIN_M);

  const measured: AimArc[] = [];
  for (const camera of cameras) {
    const rangeM = distanceM(from.lat, from.lon, camera.lat, camera.lon);
    // A camera ON the fix has no bearing from it. There is nothing to aim at.
    if (rangeM === 0) continue;
    measured.push({
      bearingDeg: bearing(from.lat, from.lon, camera.lat, camera.lon),
      halfWidthDeg:
        rangeM <= aimClearanceM
          ? QUARTER_TURN_DEG
          : Math.asin(aimClearanceM / rangeM) * RAD_TO_DEG,
      rangeM,
    });
  }
  if (measured.length === 0) return null;
  const arcs = [...measured]
    .sort((a, b) => a.rangeM - b.rangeM)
    .slice(0, AIM_MAX_CAMERAS);

  /*
   * THE ARCS THAT CAN ANCHOR AN AIM are the ones with a real edge. A camera
   * already inside the berth spans a quarter turn either way, so its "edge" is
   * abeam of it - a line that leaves it 90 degrees off the bow, barely ahead
   * and unpushable. It votes on every candidate and proposes none.
   *
   * When every camera is that close there is no such candidate, and the
   * fallback is the farthest one's own bearing. That plan will mostly come
   * back `all-unavoidable`, which is the truth: readers within a berth of a
   * stationary car cannot be routed around from where it is standing.
   */
  const anchors = arcs.filter((arc) => arc.halfWidthDeg < QUARTER_TURN_DEG);
  const fallback = arcs.reduce((far, arc) => (arc.rangeM > far.rangeM ? arc : far));

  let bestBearingDeg = normaliseBearingDeg(fallback.bearingDeg);
  let bestCount = -1;
  let bestRangeM = Infinity;

  for (const anchor of anchors.length > 0 ? anchors : [fallback]) {
    /*
     * The leading edge, except in the fallback - where there is no edge to
     * take and the aim is the reader itself, which is the honest shape of
     * "every reader I know about is already within a berth of me".
     */
    const candidateDeg = normaliseBearingDeg(
      anchor.halfWidthDeg < QUARTER_TURN_DEG
        ? anchor.bearingDeg - anchor.halfWidthDeg
        : anchor.bearingDeg,
    );
    /*
     * THE ANCHOR COUNTS ITSELF, and it is counted here rather than measured.
     * The candidate is its own arc's edge, so the test below sits exactly on
     * the boundary it compares against and floating point decides the answer.
     * The anchor is inside its corridor by construction - that is what
     * `AIM_MARGIN_M` bought - so saying so is the correct reading, and a vote
     * that flips on rounding would let two equal corridors rank arbitrarily.
     */
    let count = 1;
    for (const arc of arcs) {
      if (arc === anchor) continue;
      if (Math.abs(angularDifferenceDeg(arc.bearingDeg, candidateDeg)) < arc.halfWidthDeg) {
        count += 1;
      }
    }
    /*
     * TIES GO TO THE NEARER ANCHOR. Two corridors that hold the same number of
     * readers are worth the same to the count on the key, and the one built
     * around the reader you would meet first is the one a driver leaving this
     * spot is most likely to actually be on.
     */
    if (count > bestCount || (count === bestCount && anchor.rangeM < bestRangeM)) {
      bestCount = count;
      bestRangeM = anchor.rangeM;
      bestBearingDeg = candidateDeg;
    }
  }

  return bestBearingDeg;
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
 *   cloud, so this is the last heading taken while the car was actually moving,
 *   held while it is stopped, and null until it has been seen to move at all.
 *   A held heading is still used: a car waiting at a light is still pointing
 *   the way it was going, and that is the line its detour belongs on. NULL is
 *   the browse case, and null is what sends this to {@link detourAimBearing}.
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

  const usable = usableDetourCameras(cameras);
  if (usable.length === 0) return refuse('nothing-ahead', clearanceFt);

  /*
   * THE HEADING WINS WHENEVER THERE IS ONE, and that is what keeps `AlertV1`
   * exactly as it was: mid-alert the car is moving, the course is measured,
   * and a bearing derived from the readers would be a worse answer than the
   * one the road is already giving. The derived aim is the browse case only.
   */
  const aimDeg =
    headingDeg !== null && Number.isFinite(headingDeg)
      ? headingDeg
      : detourAimBearing(from, usable, clearanceFt);
  if (aimDeg === null) return refuse('no-heading', clearanceFt);

  /*
   * HOW LONG THE ROUTE IS.
   *
   * Straight-line distance is an upper bound on how far ALONG the aim a camera
   * sits, so a run-out measured from the farthest of them is past every one of
   * them whatever direction they lie in. Getting this wrong in the other
   * direction is the expensive mistake: `planDetour` ignores anything beyond
   * the end point, so a route that stopped short would silently plan around
   * fewer cameras than the key counted.
   */
  const farthestFt = usable.reduce((far, camera) => Math.max(far, camera.distanceFt), 0);
  const to = destinationPoint(
    from.lat,
    from.lon,
    aimDeg,
    feetToMetres(farthestFt + DETOUR_RUNOUT_FT),
  );

  const plan = planDetour(from, to, usable, { clearanceFt });
  if (plan.waypoints.length > 0) {
    return { kind: 'route', to, plan, closestFt: closestApproachFt(plan.waypoints, usable) };
  }
  if (plan.unavoidable > 0) return refuse('all-unavoidable', clearanceFt, plan.unavoidable);
  return refuse('already-clear', clearanceFt);
}

/**
 * WHAT THE `Around N` KEY IS ALLOWED TO SAY, or null when it must not draw.
 *
 * ONLY A PLANNED ROUTE PUTS A NUMBER ON THE KEY, and the number is the plan's
 * own `consideredCameras`: the readers that ended up beside the line it built -
 * ahead of the car, inside the berth, before the end point. Not the set the
 * planner was HANDED, which is a wider collection every time a reader sits
 * behind you or half a mile off your road.
 *
 * IT IS ALSO NOT A NUMBER THE GEOMETRY WAS ALLOWED TO SHRINK QUIETLY. When
 * there is no heading the line is aimed at the readers rather than at a bearing
 * that owes them nothing - `detourAimBearing` - precisely so this count is as
 * large as a straight line can honestly make it. Trimming the promise to fit a
 * badly aimed corridor was the wrong half of the fix.
 *
 * EVERY REFUSAL IS A ZERO, AND A ZERO DRAWS NOTHING. `dockState.ts` already
 * rules that a key offering to route around nothing is a key that refuses, and
 * every refusal is a way of routing around nothing:
 *
 *   no-fix               there is no line, so there is no set to count.
 *   no-heading           no course and no reader off the fix to aim at either.
 *   nothing-ahead        nothing is being tracked at all.
 *   already-clear        nothing is close enough to the line to move away from.
 *   all-unavoidable      the readers are real and the detour clears NONE of
 *                        them. `Around 3` here would promise three and deliver
 *                        zero; DENSE AREA's own numeral still says how many are
 *                        within two miles, so nothing about the road is hidden.
 *
 * THE SAME NUMBER THE REST OF THE FEATURE SAYS. `DetourOffer` prints
 * `consideredCameras` in its plan line and names the destination card after it
 * through `detourDestinationName`, so the key, the prompt and the card on the
 * map all say one number about one set.
 */
export function detourKeyCount(outcome: DetourOutcome): number | null {
  if (outcome.kind !== 'route') return null;
  return outcome.plan.consideredCameras > 0 ? outcome.plan.consideredCameras : null;
}
