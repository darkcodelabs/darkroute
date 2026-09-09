/**
 * BUILDING A DARK ROUTE, WHICH TAKES MORE THAN ONE REQUEST.
 *
 * =============================================================================
 * THE BUG THIS FILE EXISTS FOR
 * =============================================================================
 * The first version asked once: plan a route, count the readers on it, send
 * those back as exclusions, draw the answer. It reported "2 readers avoided"
 * over a line that passed nine.
 *
 * Both halves of that were true and the conclusion was wrong. The router DID
 * avoid the two it was given - exclusions work, they were measured working. But
 * a route that has been bent around two readers is A DIFFERENT ROUTE, down
 * different streets, with its own readers on it that nobody had looked at. One
 * pass avoids the cameras on the road you were going to take. It says nothing
 * about the road you are now taking.
 *
 * =============================================================================
 * SO IT ITERATES
 * =============================================================================
 * Plan, measure the new line against the archive ON THE DEVICE, and if readers
 * are still on it, add them to the exclusion set and ask again. The avoid set
 * only ever GROWS, so the router cannot ping-pong between two roads by
 * forgetting what it was avoiding last time - which is the obvious way for a
 * loop like this to run forever.
 *
 * =============================================================================
 * IT STOPS, AND IT SAYS WHERE IT STOPPED
 * =============================================================================
 * Three outcomes, and the middle one is the honest part:
 *
 *   CLEAR - a round came back with nothing on the corridor. Done.
 *   NOT CLEAR - the round limit was reached, or the router refused to route
 *     around any more of them, and readers remain. The route is still returned,
 *     and `remaining` says how many. In a dense downtown that is the true
 *     answer, and an app that quietly reported "avoided" over it would be
 *     lying about the one thing it exists to do.
 *   NO ROUTE - the exclusions closed every road. The caller shows the router's
 *     own sentence, which says to try with fewer.
 *
 * The round limit is small on purpose: each round is a request, this runs while
 * somebody waits at a junction, and the improvement per round falls off fast -
 * the first pass removes the readers that were in the way, the second removes
 * the ones the detour introduced, and by the fourth it is usually trading one
 * reader for another.
 */

import type { CameraRecord } from '../../stores/cameras.ts';

import { camerasOnRoute } from './corridor.ts';
import { RouteRefused, planRoute } from './planRoute.ts';
import type { PlannedRoute, RoutePoint } from './planRoute.ts';

/**
 * HOW MANY TIMES IT WILL ASK.
 *
 * Four: the plain route, then three attempts to clear it. Each is a round trip
 * a driver is waiting on, and the endpoint caps a single request at sixty
 * exclusions - a set that keeps growing would hit that cap and start silently
 * dropping readers, which is the failure this whole file is about.
 */
export const MAX_ROUNDS = 4;

export interface DarkRoute {
  readonly route: PlannedRoute;
  /** Every reader the router was told to keep out of, across all rounds. */
  readonly avoided: readonly CameraRecord[];
  /**
   * Readers STILL on the final line.
   *
   * Empty is the good outcome. Non-empty is the honest one, and the card says
   * so rather than claiming a clear road.
   */
  readonly remaining: readonly CameraRecord[];
  /** How many requests this took. Useful in a log, and in a bug report. */
  readonly rounds: number;
}

export interface DarkRouteRequest {
  readonly from: RoutePoint;
  readonly to: RoutePoint;
  /** Everything on the phone. The corridor is measured against this locally. */
  readonly cameras: readonly CameraRecord[];
}

/**
 * Plan the plain route first, so the caller can price the detour against it.
 *
 * Separate from the loop below because it is a different question - "how do I
 * get there" rather than "how do I get there without passing those" - and
 * because DRIVE draws the plain line while the driver decides.
 */
export async function planPlainRoute(
  request: DarkRouteRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<PlannedRoute> {
  return planRoute({ from: request.from, to: request.to, avoid: [] }, fetchImpl);
}

/**
 * Ask until the line is clear, or until it is clear that it will not be.
 *
 * Throws `RouteRefused` only when there is NO route at all to return - a middle
 * round that fails leaves the last good route standing, because a worse answer
 * that exists beats a better one that does not.
 */
export async function planDarkRoute(
  request: DarkRouteRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DarkRoute> {
  const avoiding = new Map<string, CameraRecord>();
  let best: PlannedRoute | null = null;
  let remaining: readonly CameraRecord[] = [];
  let rounds = 0;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let planned: PlannedRoute;
    try {
      planned = await planRoute(
        {
          from: request.from,
          to: request.to,
          avoid: [...avoiding.values()].map((camera) => ({
            lat: camera.lat,
            lon: camera.lon,
          })),
        },
        fetchImpl,
      );
    } catch (cause) {
      /*
       * The exclusions closed every road. If a previous round produced a
       * route, keep it - it avoids fewer readers than we hoped and it gets the
       * driver there, which is strictly better than nothing. With no route at
       * all, the refusal is the answer and the caller prints it.
       */
      if (best === null) throw cause;
      break;
    }

    rounds += 1;
    best = planned;
    // MEASURED LOCALLY, against the cameras already on this phone. The server
    // is never told which readers matter; see `corridor.ts`.
    remaining = camerasOnRoute(planned.shape, request.cameras);
    if (remaining.length === 0) break;

    // GROW ONLY. Dropping a reader that a previous round avoided is how a
    // router gets to alternate between two roads forever.
    const before = avoiding.size;
    for (const camera of remaining) avoiding.set(camera.id, camera);
    /*
     * NOTHING NEW TO SAY. Every reader on this line was already in the
     * exclusion set, which means the router has told us it will not do better -
     * asking again would send the identical request and get the identical
     * answer.
     */
    if (avoiding.size === before) break;
  }

  if (best === null) {
    throw new RouteRefused('router_empty', 'no route could be planned to there.');
  }
  return { route: best, avoided: [...avoiding.values()], remaining, rounds };
}
