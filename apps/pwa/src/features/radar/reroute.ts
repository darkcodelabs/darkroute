/**
 * REROUTE - get me around this, without asking me where I am going.
 *
 * =============================================================================
 * THE PROBLEM, AND WHY THE OBVIOUS SOLUTION IS NOT AVAILABLE
 * =============================================================================
 * "Route me around the cameras" is the feature a driver actually wants. It is
 * also not something this app can do, and it is worth being precise about why
 * rather than shipping something that pretends otherwise:
 *
 *   No routing engine here. Turn-by-turn needs a road graph, and the app has
 *   road GEOMETRY for drawing, not a routable network with turn restrictions,
 *   one-ways or speeds.
 *
 *   No destination. A driver who has not told anybody where they are going
 *   cannot be routed anywhere, and asking for one to avoid a camera two minutes
 *   ahead is a worse interaction than the problem.
 *
 *   No third-party routing call, ever. Sending "here is where I am, route me
 *   around surveillance" to a routing API puts the driver's position and their
 *   intent on somebody else's server. That is the exact exposure this product
 *   exists to reduce.
 *
 * =============================================================================
 * WHAT THIS DOES INSTEAD, AND WHY IT IS HONEST
 * =============================================================================
 * It picks a WAYPOINT: a point roughly where the driver is already heading,
 * offset to the side that has fewer cameras on it, and hands that to whatever
 * maps app the phone has as a destination.
 *
 * The maps app then does the routing - with its own road graph, its own
 * traffic, and the driver's own location under its own permission, which it
 * already has. The result is a real route that goes around the cluster,
 * produced by a tool that is good at routing, with nothing about surveillance
 * sent anywhere.
 *
 * The waypoint carries the CAMERA-DERIVED offset only. It never carries a
 * destination the driver typed, because there is none, and it never says why.
 *
 * =============================================================================
 * WHAT IT MUST NOT CLAIM
 * =============================================================================
 * This is a DETOUR SUGGESTION, not a guaranteed clear route. The maps app may
 * route straight back through the cluster; the corridor is a cone, not a road;
 * and the camera data is incomplete everywhere. The button's label and the text
 * beside it have to say "around this stretch", never "avoids all cameras".
 *
 * A driver who believes this makes them invisible is worse off than one who
 * never pressed it.
 */

import type { Corridor } from './corridor.ts';

/** How far ahead the waypoint is placed, in feet. */
export const REROUTE_LEAD_FT = 2 * 5280;

/**
 * How far to the side, in feet.
 *
 * About half a mile: far enough that a routing engine picks a genuinely
 * different road rather than the same one with a jog in it, close enough that
 * the detour costs a minute rather than ten.
 */
export const REROUTE_OFFSET_FT = 2_640;

const FEET_PER_DEGREE_LAT = 364_000;

export interface RerouteOrigin {
  readonly lat: number;
  readonly lon: number;
}

export interface RerouteWaypoint {
  readonly lat: number;
  readonly lon: number;
  /** Which way the detour leans. For the label, so the button can say it. */
  readonly side: 'left' | 'right';
  /** Cameras the corridor holds on the side being avoided. */
  readonly avoiding: number;
}

/**
 * Which side of the corridor has more cameras on it.
 *
 * The detour goes the OTHER way. A tie goes right, arbitrarily and
 * deliberately: in right-hand-drive traffic a right turn is the easier and
 * safer of the two to take at short notice, and a coin-flip that sometimes
 * sends a driver across oncoming traffic is not a neutral default.
 */
export function busierSide(corridor: Corridor): 'left' | 'right' {
  let left = 0;
  let right = 0;
  for (const camera of corridor.cameras) {
    if (camera.offsetDeg < 0) left += 1;
    else right += 1;
  }
  return left > right ? 'left' : 'right';
}

/**
 * IS THERE ANYTHING TO ROUTE AROUND, and a direction to route it in.
 *
 * =============================================================================
 * WHY THIS IS EXPORTED RATHER THAN LEFT INSIDE `rerouteWaypoint`
 * =============================================================================
 * Because the BUTTON has to know the same answer. `rerouteWaypoint` returning
 * null is a correct refusal -- there is no way around a stretch with no
 * cameras on it, and no "ahead" to put a waypoint in without a heading -- but
 * the handler simply returned, and the key stayed drawn at full strength while
 * doing nothing. Reported as "the reroute button doesn't work anymore", on a
 * road reading CLEAR FOR 3 MI and 0 AROUND YOU, where the honest behaviour and
 * a broken control look exactly alike.
 *
 * The two callers now read the same predicate, so the key cannot claim to be
 * pressable on a state the waypoint maths will refuse.
 */
export function canReroute(corridor: Corridor | null): boolean {
  if (corridor === null || corridor.cameras.length === 0) return false;
  // No heading, no "ahead" and no "side" -- see the note in `rerouteWaypoint`.
  return corridor.headingDeg !== null && Number.isFinite(corridor.headingDeg);
}

/**
 * A point to route to, or null when there is nothing to route around.
 *
 * Null for an empty corridor on purpose: offering a detour around nothing
 * teaches a driver the button is decorative.
 */
export function rerouteWaypoint(
  origin: RerouteOrigin,
  corridor: Corridor | null,
): RerouteWaypoint | null {
  if (corridor === null || corridor.cameras.length === 0) return null;
  /*
   * NO HEADING, NO REROUTE.
   *
   * A waypoint is "ahead of you and off to the quieter side", and both halves
   * of that are directions. Against a proximity view (`aroundYou`, headingDeg
   * null) there is no ahead and no side, and `offsetDeg` is zero for every
   * camera -- so `busierSide` would pick a side from nothing and this would
   * hand a maps app a point in an arbitrary compass direction, presented as a
   * way around the cameras.
   *
   * Refusing means the REROUTE key does nothing while stationary, which is
   * correct: there is no route to leave.
   */
  if (corridor.headingDeg === null || !Number.isFinite(corridor.headingDeg)) return null;
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) return null;

  const busier = busierSide(corridor);
  const side = busier === 'left' ? 'right' : 'left';
  const avoiding = corridor.cameras.filter((camera) =>
    busier === 'left' ? camera.offsetDeg < 0 : camera.offsetDeg >= 0,
  ).length;

  // Heading, then ninety degrees off it toward the quieter side.
  const headingRad = (corridor.headingDeg * Math.PI) / 180;
  const sideRad = headingRad + (side === 'right' ? Math.PI / 2 : -Math.PI / 2);

  const northFt =
    Math.cos(headingRad) * REROUTE_LEAD_FT + Math.cos(sideRad) * REROUTE_OFFSET_FT;
  const eastFt =
    Math.sin(headingRad) * REROUTE_LEAD_FT + Math.sin(sideRad) * REROUTE_OFFSET_FT;

  // A degree of longitude shortens with latitude; ignoring that puts the
  // waypoint measurably east or west of where it was meant to be at any
  // latitude the product runs at.
  const feetPerDegreeLon = FEET_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  if (!Number.isFinite(feetPerDegreeLon) || feetPerDegreeLon === 0) return null;

  return {
    lat: origin.lat + northFt / FEET_PER_DEGREE_LAT,
    lon: origin.lon + eastFt / feetPerDegreeLon,
    side,
    avoiding,
  };
}

/** What the button says under it. States the limit, because the limit is real. */
export function rerouteNotice(waypoint: RerouteWaypoint | null): string | null {
  if (waypoint === null) return null;
  return `sends your maps app around this stretch, ${waypoint.side}. it is a detour, not a clear road.`;
}
