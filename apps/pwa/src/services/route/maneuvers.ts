/**
 * WHICH TURN IS NEXT, AND HOW FAR IT IS.
 *
 * =============================================================================
 * WHY THIS IS NOT "THE FIRST INSTRUCTION IN THE LIST"
 * =============================================================================
 * The router hands back every turn of the drive at once, in order, and the card
 * needs exactly one of them: the one the driver is about to make. Ten minutes
 * into a route the first entry in that list is a turn that happened ten minutes
 * ago, and a nav card that shows it is not late, it is wrong.
 *
 * So the driver's fix is projected onto the route line, and the next maneuver
 * is the first one that is still AHEAD of that point. Nothing here tracks state
 * between calls - it is a pure function of the route and the current fix, so a
 * dropped GPS tick, a backgrounded app or a rerouted line cannot leave it
 * pointing at a turn the driver already took.
 *
 * =============================================================================
 * THE DISTANCE IS MEASURED ALONG THE ROAD
 * =============================================================================
 * Not straight-line to the junction. A turn 400 m ahead round a bend is 400 m
 * of driving, and the crow-flies figure - which would read 250 m - is the
 * number that makes an app announce a turn before the driver can see it. Every
 * segment between the fix and the turn is added up, including the part of the
 * segment the driver is standing in.
 *
 * =============================================================================
 * IT DOES NOT JUDGE WHETHER YOU ARE STILL ON THE ROUTE
 * =============================================================================
 * `projectOnSegment` clamps to the line, so a fix a mile off it still gets an
 * answer - measured from the nearest point on the route. That is deliberate:
 * deciding a driver has left the route and asking for a new one is a decision
 * with a request attached, and this file makes no requests. It answers the
 * question it was asked.
 */

import { projectOnSegment } from './corridor.ts';
import type { Maneuver, PlannedRoute, RoutePoint } from './planRoute.ts';

/**
 * Metres in a degree of latitude, and metres in a statute mile.
 *
 * The same flat model `corridor.ts` measures this shape with - longitude scaled
 * by cos(lat), both axes in metres. It is repeated rather than imported from
 * `cameras/sync.ts`, whose `metresBetween` is a haversine: that module pulls in
 * the tile store, the camera store and the session guard, and a pure geometry
 * function has no business dragging the whole sync graph in behind it. Over a
 * segment of road the two agree to centimetres, and using the SAME model as the
 * corridor means the distance to a turn and the distance to a camera on the
 * same stretch of road cannot disagree.
 */
const M_PER_DEG_LAT = 111_320;
const METRES_PER_MILE = 1609.344;

/**
 * HOW FAR PAST A TURN STILL COUNTS AS BEING AT IT, in shape points.
 *
 * A driver stopped exactly on a junction projects to 13.0000001 as often as to
 * 13.0, and without a little slack the card would skip to the following turn at
 * the precise moment the driver most needs to be told about this one. A
 * hundredth of a segment is well under a metre on a city street.
 */
const AT_TURN_SLACK = 0.01;

export interface NextManeuver {
  readonly maneuver: Maneuver;
  /** How far to it along the road, in miles. Zero when you are on it. */
  readonly miles: number;
}

/** One segment's length in the flat model. */
function segmentMetres(a: RoutePoint, b: RoutePoint): number {
  const scale = Math.cos((a.lat * Math.PI) / 180);
  const dx = (b.lon - a.lon) * scale * M_PER_DEG_LAT;
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The turn the driver is approaching, and how far it is.
 *
 * Null when there is no route, no fix, no turn list or no turn left ahead -
 * every one of which is a state the drive screen is in at some point, and none
 * of which is worth a thrown error. A card with nothing to say says nothing.
 *
 * PAST THE LAST TURN is not one of those cases. The router's final maneuver is
 * the arrival, and its shape index is the end of the line, so a driver who has
 * made every turn is told they are arriving - which is the true answer to
 * "what is next", not an absence.
 */
export function nextManeuver(
  route: PlannedRoute | null,
  fix: RoutePoint | null,
): NextManeuver | null {
  if (route === null || fix === null) return null;
  const shape = route.shape;
  if (shape.length < 2 || route.maneuvers.length === 0) return null;

  /*
   * WHERE THE DRIVER IS ON THE LINE, as `segment index + fraction of it` - the
   * same measure `camerasOnRoute` orders cameras by, from the same projection,
   * so "the next turn" and "the next camera" are positions on one scale.
   */
  let bestSq = Infinity;
  let bestIndex = 0;
  let bestT = 0;
  for (let i = 0; i < shape.length - 1; i += 1) {
    const a = shape[i];
    const b = shape[i + 1];
    if (a === undefined || b === undefined) continue;
    const { distSq, t } = projectOnSegment(fix, a, b);
    if (distSq < bestSq) {
      bestSq = distSq;
      bestIndex = i;
      bestT = t;
    }
  }
  const along = bestIndex + bestT;
  const lastIndex = shape.length - 1;

  /*
   * The first maneuver not already behind. They arrive in driving order, so
   * this is a scan and not a search. The index is clamped because it came off
   * the wire: a maneuver pointing past the end of the shape would otherwise
   * measure a distance across segments that do not exist.
   */
  let target: Maneuver | null = null;
  let targetIndex = 0;
  for (const maneuver of route.maneuvers) {
    const at = Math.min(Math.max(maneuver.beginShapeIndex, 0), lastIndex);
    if (at < along - AT_TURN_SLACK) continue;
    target = maneuver;
    targetIndex = at;
    break;
  }
  if (target === null) return null;

  let metres = 0;
  if (targetIndex > bestIndex) {
    // The rest of the segment the driver is currently in, then the whole ones.
    const a = shape[bestIndex];
    const b = shape[bestIndex + 1];
    if (a !== undefined && b !== undefined) metres += (1 - bestT) * segmentMetres(a, b);
    for (let i = bestIndex + 1; i < targetIndex; i += 1) {
      const from = shape[i];
      const to = shape[i + 1];
      if (from === undefined || to === undefined) continue;
      metres += segmentMetres(from, to);
    }
  }

  return { maneuver: target, miles: metres / METRES_PER_MILE };
}
