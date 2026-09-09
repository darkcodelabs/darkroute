/**
 * WHEN TO SAY THE TURN, AND WHETHER THE DRIVER IS STILL ON THE ROUTE.
 *
 * =============================================================================
 * ONE ANNOUNCEMENT PER RUNG, PER TURN
 * =============================================================================
 * `maneuvers.ts` answers "which turn is next, and how far along the road" and
 * it answers it on every GPS tick - two or three times a second. Wire that
 * straight to a notification and the card re-posts sixty times before one
 * junction; wire it to a voice and the voice never stops talking.
 *
 * What a driver wants is a LADDER. Told once at a mile, once at a half, once
 * at a quarter, once on the approach, and once at the mouth of the turn. So
 * this file holds the single piece of state `maneuvers.ts` deliberately refuses
 * to hold - what has already been said - and nothing else.
 *
 * =============================================================================
 * IT ANNOUNCES NOTHING. IT SAYS WHAT IS DUE.
 * =============================================================================
 * No notification is composed here, no speech is spoken, no store is touched
 * and no reroute is requested. `consider()` returns the payload that is owed
 * and the caller delivers it - or does not, because the caller is the one that
 * knows whether the screen is on, whether the driver muted the trip, and
 * whether a camera alert is already holding the card. A module that both
 * decided and delivered would leave those questions with nowhere to be asked.
 *
 * The same rule covers going off route. This file reports the FACT and stops.
 * Asking for a new route is a network request carrying a driver's position and
 * destination, which `planRoute.ts` says is never made speculatively - and a
 * geometry function firing one off on the driver's behalf is exactly the
 * speculation that rule forbids.
 *
 * =============================================================================
 * WHY THE FIRED SET IS KEYED ON beginShapeIndex
 * =============================================================================
 * A driver stopped at a light 1,320 ft from a turn creeps forward and back
 * across the rung boundary for a minute, and the naive "distance is under the
 * rung" test announces the same quarter mile a dozen times. The guard is a set
 * of (turn, rung) pairs that have been spent.
 *
 * `beginShapeIndex` is the identity because it is the only field on a maneuver
 * that is stable and unique down the drive: the instruction text repeats (two
 * right turns onto the same street), the street repeats, the object identity
 * survives only as long as the route does, and a list index shifts the moment
 * anything trims the list.
 *
 * Announcing a rung ALSO spends every coarser rung for that turn. Without it, a
 * fix that jumps - a tunnel, a dropped fix, a reacquire - can announce "in a
 * quarter mile" and then, one wobble later, "in a half mile" for the same turn,
 * which is a nav app telling a driver the junction moved away from them.
 *
 * =============================================================================
 * A NEW ROUTE IS A NEW SLATE
 * =============================================================================
 * Reset keys on the route OBJECT, not on its contents. `planRoute()` builds a
 * fresh `PlannedRoute` for every answer, so a reroute, a re-plan around one
 * more camera, or a destination change all arrive as a new reference, and all
 * three must be allowed to announce the turn ahead again from the top of the
 * ladder. Comparing shapes instead would make a reroute that happens to leave
 * the next turn where it was go silent on the leg the driver just missed.
 */

import type { NavigationPayload } from '../adapters/notifications.ts';

import { projectOnSegment } from './corridor.ts';
import { nextManeuver } from './maneuvers.ts';
import type { Maneuver, PlannedRoute, RoutePoint } from './planRoute.ts';

/** Units, not design values. Both are definitions and neither is a choice. */
const METRES_PER_FOOT = 0.3048;
const FEET_PER_MILE = 5280;

export type RungId = 'mile' | 'half-mile' | 'quarter-mile' | 'approach' | 'now';

export interface Rung {
  readonly id: RungId;
  /** Distance to the turn, along the road, at which this rung is due. */
  readonly feet: number;
}

/**
 * A MILE OUT. The first thing said about a turn, and on a highway the only one
 * with enough road left in it to change lanes for.
 */
export const RUNG_MILE = FEET_PER_MILE;
/** HALF A MILE. Roughly thirty seconds at 60 mph, twenty at 45. */
export const RUNG_HALF_MILE = FEET_PER_MILE / 2;
/**
 * A QUARTER MILE. The rung a city driver actually acts on - far enough to pick
 * the lane, close enough that the junction is the one they can see.
 */
export const RUNG_QUARTER_MILE = FEET_PER_MILE / 4;
/**
 * FIVE HUNDRED FEET. Below a quarter mile the next useful thing to say is not
 * another fraction, it is a block: 500 ft is about two city blocks, which is
 * the last point where a driver can still get across two lanes.
 */
export const RUNG_APPROACH = 500;
/**
 * THE MOUTH OF THE TURN. One hundred feet, which is the same boundary
 * `composeNavigation` prints "now" below, so the card and the ladder cannot
 * disagree about where a distance stops being worth reading out.
 */
export const RUNG_NOW = 100;

/**
 * The ladder, coarsest first. Order is load-bearing for {@link rungFor}, which
 * wants the TIGHTEST rung a distance is inside.
 */
export const RUNGS: readonly Rung[] = [
  { id: 'mile', feet: RUNG_MILE },
  { id: 'half-mile', feet: RUNG_HALF_MILE },
  { id: 'quarter-mile', feet: RUNG_QUARTER_MILE },
  { id: 'approach', feet: RUNG_APPROACH },
  { id: 'now', feet: RUNG_NOW },
];

/**
 * HOW FAR OFF THE LINE COUNTS AS OFF THE ROUTE, in feet.
 *
 * 240 ft, about 73 m. It has to clear three things that are not a wrong turn: a
 * phone's own error under trees or between buildings, which runs to 100 ft on a
 * bad fix; the route line being a road CENTRELINE, so the far lane of a wide
 * divided arterial is legitimately 50-60 ft off it; and a service road or slip
 * lane running beside the road the route is on. It sits below the distance to a
 * PARALLEL street, which is what a genuine wrong turn puts a driver on - 300 ft
 * and up on a US grid.
 */
export const OFF_ROUTE_FT = 240;

/**
 * HOW CLOSE IT TAKES TO BE BACK ON, in feet.
 *
 * Half the threshold that declared it. A single number for both edges makes a
 * fix sitting on the boundary flip on-off-on-off at the sample rate, and every
 * flip is a "you are off route" a caller would act on. Coming back has to be
 * unambiguous, so the driver has to get properly back onto the line rather than
 * merely stop being clearly off it.
 */
export const BACK_ON_ROUTE_FT = 120;

/**
 * Trip-level facts the announcer cannot compute and the card wants anyway.
 *
 * `avoided` is deliberately NOT here: the route already carries how many
 * readers the router was told to keep out of, and a caller passing a second
 * number would eventually pass a different one.
 */
export interface TripFacts {
  readonly etaMinutes?: number;
  readonly milesRemaining?: number;
}

export interface Announcement {
  /** The sentence that is due, or null when nothing is. */
  readonly payload: NavigationPayload | null;
  /**
   * True while the driver is judged off the route. Reported on every call, not
   * just the edge, so a caller can keep a banner up without tracking it.
   */
  readonly offRoute: boolean;
}

export interface Announcer {
  /**
   * One tick. Pass `null` for the route to end the trip and clear the state.
   *
   * A null fix does NOT clear the off-route flag: a dropped GPS tick is an
   * absence of evidence, and treating it as evidence the driver came back is
   * how a lost signal cancels a wrong-turn banner.
   */
  consider(route: PlannedRoute | null, fix: RoutePoint | null, trip?: TripFacts): Announcement;
}

const NOTHING: Announcement = Object.freeze({ payload: null, offRoute: false });

/**
 * How far the fix is from the nearest point on the line, in feet, or null when
 * there is no line to be off.
 *
 * This is the number `maneuvers.ts` throws away. `projectOnSegment` clamps to
 * the segment, so the distance ALONG the road comes back for a fix a mile off
 * it; the perpendicular distance is the part that says whether the answer means
 * anything, and nothing was reading it.
 *
 * Same flat model as `corridor.ts` and `maneuvers.ts`, so "off the route" and
 * "on this route" are measured with one ruler.
 */
export function feetOffRoute(shape: readonly RoutePoint[], fix: RoutePoint): number | null {
  if (shape.length < 2) return null;
  let bestSq = Infinity;
  for (let i = 0; i < shape.length - 1; i += 1) {
    const a = shape[i];
    const b = shape[i + 1];
    if (a === undefined || b === undefined) continue;
    const { distSq } = projectOnSegment(fix, a, b);
    if (distSq < bestSq) bestSq = distSq;
  }
  if (!Number.isFinite(bestSq)) return null;
  return Math.sqrt(bestSq) / METRES_PER_FOOT;
}

/**
 * The tightest rung a distance is inside, or null when the turn is further away
 * than the top of the ladder.
 *
 * STRICTLY inside, because `composeNavigation` tests `ft < 100` for its "now",
 * and two thresholds that name the same moment must not disagree by a foot.
 */
export function rungFor(distanceFt: number): Rung | null {
  let found: Rung | null = null;
  for (const rung of RUNGS) {
    if (distanceFt < rung.feet) found = rung;
  }
  return found;
}

function firedKey(beginShapeIndex: number, id: RungId): string {
  return `${String(beginShapeIndex)}:${id}`;
}

/**
 * The final instruction of the drive.
 *
 * Two tests because the two disagree on real routes: the router marks the
 * arrival with the `arrive` kind, and a route whose maneuver list was trimmed
 * or came from a fixture ends on whatever it ends on. Either is the last thing
 * this driver will be told.
 */
function isArrival(route: PlannedRoute, maneuver: Maneuver): boolean {
  if (maneuver.turn === 'arrive') return true;
  return route.maneuvers[route.maneuvers.length - 1] === maneuver;
}

function navigationPayload(
  route: PlannedRoute,
  maneuver: Maneuver,
  distanceFt: number,
  trip: TripFacts,
): NavigationPayload {
  return {
    kind: 'navigation',
    instruction: maneuver.instruction,
    turn: maneuver.turn,
    distanceFt,
    avoided: route.avoided,
    ...(trip.etaMinutes === undefined ? {} : { etaMinutes: trip.etaMinutes }),
    ...(trip.milesRemaining === undefined ? {} : { milesRemaining: trip.milesRemaining }),
    ...(isArrival(route, maneuver) ? { arriving: true } : {}),
  };
}

export function createAnnouncer(): Announcer {
  /** (turn, rung) pairs already spent. Cleared when the route object changes. */
  const fired = new Set<string>();
  let current: PlannedRoute | null = null;
  let offRoute = false;

  return {
    consider(
      route: PlannedRoute | null,
      fix: RoutePoint | null,
      trip: TripFacts = {},
    ): Announcement {
      if (route !== current) {
        current = route;
        fired.clear();
        offRoute = false;
      }
      if (route === null) return NOTHING;
      if (fix === null) return { payload: null, offRoute };

      const offset = feetOffRoute(route.shape, fix);
      if (offset !== null) {
        offRoute = offRoute ? offset > BACK_ON_ROUTE_FT : offset > OFF_ROUTE_FT;
      }
      /*
       * A distance measured along a route the driver is not on is a fiction,
       * and announcing a turn off it is worse than saying nothing - it points
       * at a junction that is not in front of them. The rung stays unspent, so
       * a driver who rejoins the same route is still told about it.
       */
      if (offRoute) return { payload: null, offRoute: true };

      const next = nextManeuver(route, fix);
      if (next === null) return NOTHING;

      const distanceFt = next.miles * FEET_PER_MILE;
      const rung = rungFor(distanceFt);
      if (rung === null) return NOTHING;

      const at = next.maneuver.beginShapeIndex;
      if (fired.has(firedKey(at, rung.id))) return NOTHING;
      // This rung and every coarser one. See the header.
      for (const candidate of RUNGS) {
        if (candidate.feet >= rung.feet) fired.add(firedKey(at, candidate.id));
      }

      return {
        payload: navigationPayload(route, next.maneuver, distanceFt, trip),
        offRoute: false,
      };
    },
  };
}

/**
 * HOW THE SAME TURN IS SAID OUT LOUD.
 *
 * Not the card copy, and not a reading of it. The card is a glance - a figure,
 * a unit, an arrow - and the glance is why it can say "1314" and "FT". A
 * sentence read into a car cannot: a driver hears "one thousand three hundred
 * and fourteen feet" and has to convert it back into a fraction of a mile
 * before it means anything, at exactly the moment they are supposed to be
 * looking at the road. So a spoken distance is the rung, in the words a driver
 * uses for it, and the exact feet stay on the card where they are readable.
 *
 * The instruction is the ROUTER'S OWN SENTENCE, lowercased at the head and
 * stripped of its full stop. Only the first character: "West 119th Street" is a
 * name, and a wholesale `toLowerCase()` - which is what the card does, because
 * a card is set in the chrome voice - would hand a speech engine "west 119th
 * street" and change how it reads the number.
 */
const SPOKEN_LEAD: Readonly<Record<RungId, string>> = {
  mile: 'in one mile',
  'half-mile': 'in a half mile',
  'quarter-mile': 'in a quarter mile',
  approach: 'in 500 feet',
  /** At the mouth of the turn the distance is the one word that adds nothing. */
  now: '',
};

function spokenSentence(instruction: string): string {
  const trimmed = instruction.trim().replace(/\.$/, '');
  const head = trimmed.slice(0, 1);
  return head.toLowerCase() + trimmed.slice(1);
}

/** Past the top of the ladder, where a driver still counts in whole miles. */
function spokenMiles(distanceFt: number): string {
  const miles = Math.round(distanceFt / FEET_PER_MILE);
  return miles <= 1 ? 'in one mile' : `in ${String(miles)} miles`;
}

export function spokenFor(payload: NavigationPayload): string {
  const sentence = spokenSentence(payload.instruction);
  const rung = rungFor(payload.distanceFt);
  const lead = rung === null ? spokenMiles(payload.distanceFt) : SPOKEN_LEAD[rung.id];
  if (sentence === '') return lead;
  if (lead === '') return sentence;
  return `${lead}, ${sentence}`;
}
