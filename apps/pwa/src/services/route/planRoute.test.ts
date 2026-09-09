/**
 * THE ROUTING PROMISES, held by test rather than by comment.
 *
 * =============================================================================
 * WHAT IS BEING GUARDED
 * =============================================================================
 *   1. IT GOES TO DARKROUTE. Not to a maps company. The app used to hand a
 *      driver's origin and destination to Google Maps to draw a route around
 *      cameras; these assert the request goes to this app's own path, which is
 *      the whole reason the endpoint exists.
 *
 *   2. THE READERS ARE SENT AS THINGS TO AVOID, not as waypoints. A via-point
 *      says "go through here". A driver wants "do not go through there", and
 *      the difference is the product.
 *
 *   3. THE SERVER'S OWN SENTENCE SURVIVES. "No driving route avoids all of
 *      those" tells a driver what to do next; "routing failed" does not.
 */

import { describe, expect, it, vi } from 'vitest';

import { RouteRefused, findPlaces, planRoute } from './planRoute.ts';
import type { PlannedRoute } from './planRoute.ts';

function answering(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(body),
    } as Response),
  ) as unknown as typeof fetch;
}

const HERE = { lat: 39.05, lon: -94.6 };
const THERE = { lat: 39.1, lon: -94.58 };

describe('planning a route', () => {
  it('asks darkroute, not a maps company', async () => {
    const fetchImpl = answering({ shape: [HERE, THERE], miles: 3.2, seconds: 400, avoided: 0 });
    await planRoute({ from: HERE, to: THERE, avoid: [] }, fetchImpl);

    const url = String((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]);
    expect(url).toContain('/api/v1/route');
    expect(url).not.toContain('google');
    expect(url).not.toContain('maps');
  });

  it('sends the readers as things to AVOID', async () => {
    const fetchImpl = answering({ shape: [HERE, THERE], miles: 4, seconds: 500, avoided: 2 });
    await planRoute(
      { from: HERE, to: THERE, avoid: [{ lat: 39.06, lon: -94.59 }, { lat: 39.07, lon: -94.59 }] },
      fetchImpl,
    );

    const url = new URL(
      String((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]),
    );
    expect(url.searchParams.get('avoid')).toBe('39.06,-94.59;39.07,-94.59');
  });

  it('sends no avoid parameter at all when there is nothing to avoid', async () => {
    // A router given an empty exclusion list is being asked a subtly different
    // question than one given none. The plain route is what a driver with a
    // clear corridor should get.
    const fetchImpl = answering({ shape: [HERE, THERE], miles: 3, seconds: 380, avoided: 0 });
    await planRoute({ from: HERE, to: THERE, avoid: [] }, fetchImpl);

    const url = new URL(
      String((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]),
    );
    expect(url.searchParams.has('avoid')).toBe(false);
  });

  it("carries the server's own sentence rather than replacing it", async () => {
    const detail =
      'no driving route avoids all of those. try again with fewer of them, or accept the ' +
      'ones you cannot get around.';
    const fetchImpl = answering({ error: 'no_route', detail }, false, 409);

    await expect(planRoute({ from: HERE, to: THERE, avoid: [] }, fetchImpl)).rejects.toThrow(detail);
  });

  it('names the refusal, so a caller can tell "no route" from "router down"', async () => {
    const fetchImpl = answering({ error: 'no_route', detail: 'no route' }, false, 409);
    await planRoute({ from: HERE, to: THERE, avoid: [] }, fetchImpl).catch((cause: unknown) => {
      expect(cause).toBeInstanceOf(RouteRefused);
      expect((cause as RouteRefused).code).toBe('no_route');
    });
  });

  it('refuses a route with no line in it rather than reporting an empty drive', async () => {
    const fetchImpl = answering({ shape: [], miles: 0, seconds: 0, avoided: 0 });
    await expect(planRoute({ from: HERE, to: THERE, avoid: [] }, fetchImpl)).rejects.toThrow(
      /no usable route/,
    );
  });
});

describe('the turn list off the wire', () => {
  /*
   * `readManeuvers` had no tests, and it is the one place in this file that
   * decides what a driver SEES rather than where a request goes. Both things it
   * validates are load-bearing: `turn` picks the arrow drawn at the junction,
   * and `beginShapeIndex` is what `nextManeuver` measures the distance to.
   */
  function withTurns(maneuvers: unknown): Promise<PlannedRoute> {
    const fetchImpl = answering({ shape: [HERE, THERE], miles: 3, seconds: 380, maneuvers });
    return planRoute({ from: HERE, to: THERE, avoid: [] }, fetchImpl);
  }

  it('keeps the turns in the order they are driven', async () => {
    const route = await withTurns([
      { instruction: 'Drive north.', turn: 'start', beginShapeIndex: 0 },
      { instruction: 'Turn right onto W 111th St.', turn: 'right', beginShapeIndex: 1 },
    ]);

    expect(route.maneuvers.map((entry) => entry.turn)).toEqual(['start', 'right']);
  });

  it('drops a turn with no sentence rather than showing a blank row with an arrow on it', async () => {
    const route = await withTurns([
      { turn: 'right', beginShapeIndex: 1 },
      { instruction: 'Turn left onto State Line Rd.', turn: 'left', beginShapeIndex: 1 },
    ]);

    expect(route.maneuvers).toHaveLength(1);
  });

  it('drops a turn that names no shape point, because there is nothing to measure to', async () => {
    const route = await withTurns([
      { instruction: 'Somewhere.', turn: 'right' },
      { instruction: 'Nowhere.', turn: 'right', beginShapeIndex: -3 },
      { instruction: 'Turn left.', turn: 'left', beginShapeIndex: 1 },
    ]);

    expect(route.maneuvers.map((entry) => entry.instruction)).toEqual(['Turn left.']);
  });

  it('makes an index a whole shape point, because half a point is not a place', async () => {
    // A fraction here does not round itself off harmlessly downstream: the
    // distance walk counts whole segments, so a 1.5 would have it count segment
    // one entire and put the turn half a segment further on than it is.
    const route = await withTurns([
      { instruction: 'Turn right.', turn: 'right', beginShapeIndex: 1.5 },
    ]);

    expect(Number.isInteger(route.maneuvers[0]?.beginShapeIndex)).toBe(true);
  });

  it('draws a kind it does not know as straight rather than as no arrow at all', async () => {
    const route = await withTurns([
      { instruction: 'Board the ferry.', turn: 'ferry', beginShapeIndex: 0 },
    ]);

    expect(route.maneuvers[0]?.turn).toBe('straight');
  });

  it('does not mistake a property every object has for a kind of turn', async () => {
    // The reason the lookup is `Object.hasOwn` and not `in`: `in` walks the
    // prototype chain, and 'constructor' would pass it and then be handed to a
    // renderer that has no glyph under that name.
    const route = await withTurns([
      { instruction: 'Turn right.', turn: 'constructor', beginShapeIndex: 0 },
    ]);

    expect(route.maneuvers[0]?.turn).toBe('straight');
  });

  it('reads a route the endpoint sent no turn list for as a route, not a failure', async () => {
    // The line is the part the product depends on. A drive still draws and
    // still gets its readers counted with an empty turn list.
    await expect(withTurns(undefined)).resolves.toMatchObject({ maneuvers: [] });
  });
});

describe('looking a place up', () => {
  it('goes through darkroute, so a geocoder never sees the driver', async () => {
    const fetchImpl = answering({ places: [{ name: 'Home Depot', detail: 'Metcalf', lat: 38.9, lon: -94.6 }] });
    await findPlaces('home depot', HERE, fetchImpl);

    const url = new URL(
      String((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]),
    );
    expect(url.pathname).toBe('/api/v1/place');
    expect(url.searchParams.get('q')).toBe('home depot');
    // Where the driver is, as a PREFERENCE - it biases the answer toward their
    // part of the country and does not restrict it.
    expect(url.searchParams.get('near')).toBe('39.05,-94.6');
  });

  it('sends no position when there is no fix, rather than a zero one', async () => {
    const fetchImpl = answering({ places: [] });
    await findPlaces('denver', null, fetchImpl);

    const url = new URL(
      String((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]),
    );
    expect(url.searchParams.has('near')).toBe(false);
  });

  it('returns nothing rather than throwing when the geocoder knows no such place', async () => {
    const fetchImpl = answering({ places: [] });
    await expect(findPlaces('zzzznowhere', null, fetchImpl)).resolves.toEqual([]);
  });
});
