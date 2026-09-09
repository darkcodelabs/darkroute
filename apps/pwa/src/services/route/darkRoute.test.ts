/**
 * THE BUG: A DARK ROUTE THAT PASSED NINE READERS.
 *
 * The first build asked once. Plan a route, count the readers on it, send those
 * back as exclusions, draw the answer, report "2 readers avoided". The line it
 * drew went straight through nine.
 *
 * Nothing was broken in the sense of throwing. The router avoided the two it
 * was given - that was measured against the live service. But a route bent
 * around two readers IS A DIFFERENT ROUTE, down different streets, with its own
 * readers on it that nobody had looked at.
 *
 * Every test here is about the loop that fixes that, and about the two ways a
 * loop like this goes wrong: never stopping, and stopping quietly while
 * claiming success.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CameraRecord } from '../../stores/cameras.ts';

import { MAX_ROUNDS, planDarkRoute } from './darkRoute.ts';
import type { PlannedRoute } from './planRoute.ts';

const FROM = { lat: 39.0, lon: -94.6 };
const TO = { lat: 39.05, lon: -94.6 };

function camera(id: string, lat: number, lon: number): CameraRecord {
  return { id, lat, lon, directionDeg: 0, confirmations: 1 };
}

/** A north-south line the corridor test can measure cameras against. */
function line(lon: number): PlannedRoute {
  return {
    shape: [
      { lat: FROM.lat, lon },
      { lat: TO.lat, lon },
    ],
    miles: 3.4,
    seconds: 420,
    avoided: 0,
    // No turn list. These tests are about which line comes back and which
    // readers are on it, not about what the nav card says next.
    maneuvers: [],
  };
}

/**
 * A fake router that returns a different road each round.
 *
 * `roads` is a list of longitudes; each call takes the next one. That models
 * the real behaviour this loop exists for - excluding something moves you onto
 * a street nobody has checked yet.
 */
function router(roads: readonly number[]): { impl: typeof fetch; calls: unknown[] } {
  const calls: unknown[] = [];
  let round = 0;
  const impl = vi.fn((url: string) => {
    calls.push(url);
    const lon = roads[Math.min(round, roads.length - 1)] ?? -94.6;
    round += 1;
    const route = line(lon);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...route, avoided: 0 }),
    } as Response);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('building a dark route', () => {
  it('stops as soon as the line comes back clear', async () => {
    // One camera, on the first road and not the second.
    const cameras = [camera('on-first', 39.02, -94.6)];
    const { impl, calls } = router([-94.6, -94.62]);

    const built = await planDarkRoute({ from: FROM, to: TO, cameras }, impl);

    expect(built.remaining).toEqual([]);
    expect(built.avoided.map((c) => c.id)).toEqual(['on-first']);
    // Round one found it, round two came back clear. No third request.
    expect(calls).toHaveLength(2);
  });

  it('keeps going when the new road has its own readers on it', async () => {
    // THE REPORTED BUG. Avoiding the first camera moves the route onto a road
    // with a second one, which one pass would have drawn and called avoided.
    const cameras = [camera('first', 39.02, -94.6), camera('second', 39.02, -94.62)];
    const { impl } = router([-94.6, -94.62, -94.64]);

    const built = await planDarkRoute({ from: FROM, to: TO, cameras }, impl);

    expect(built.remaining).toEqual([]);
    expect(built.avoided.map((c) => c.id).sort()).toEqual(['first', 'second']);
  });

  it('reports what it could NOT avoid rather than claiming a clear road', async () => {
    // The router has one road and it has a camera on it. That is a real answer
    // in a dense area, and the honest one.
    const cameras = [camera('unavoidable', 39.02, -94.6)];
    const { impl, calls } = router([-94.6]);

    const built = await planDarkRoute({ from: FROM, to: TO, cameras }, impl);

    expect(built.remaining.map((c) => c.id)).toEqual(['unavoidable']);
    expect(built.route).not.toBeNull();
    // AND IT STOPPED. The second round produced the same road with the same
    // camera, so there was nothing new to exclude and no reason to ask again.
    expect(calls).toHaveLength(2);
  });

  it('never asks more than the round limit, whatever the router does', async () => {
    // A router that hands back a fresh road with a fresh camera every time
    // would loop forever without a cap.
    const cameras = Array.from({ length: 20 }, (_, i) =>
      camera(`c${String(i)}`, 39.02, -94.6 - i * 0.02),
    );
    const { impl, calls } = router(cameras.map((c) => c.lon));

    const built = await planDarkRoute({ from: FROM, to: TO, cameras }, impl);

    expect(calls.length).toBeLessThanOrEqual(MAX_ROUNDS);
    // It still returns the best line it got, with an honest remainder.
    expect(built.route).not.toBeNull();
    expect(built.remaining.length).toBeGreaterThan(0);
  });

  it('keeps the last good route when a later round finds no way through', async () => {
    // Exclusions can close every road. A worse answer that exists beats a
    // better one that does not.
    const cameras = [camera('first', 39.02, -94.6)];
    let call = 0;
    const impl = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(line(-94.6)),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'no_route', detail: 'no route avoids all of those.' }),
      } as Response);
    }) as unknown as typeof fetch;

    const built = await planDarkRoute({ from: FROM, to: TO, cameras }, impl);

    expect(built.route.miles).toBe(3.4);
    expect(built.remaining.map((c) => c.id)).toEqual(['first']);
  });

  it('refuses when there was never a route to keep', async () => {
    const impl = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'no_route', detail: 'no route avoids all of those.' }),
      } as Response),
    ) as unknown as typeof fetch;

    await expect(planDarkRoute({ from: FROM, to: TO, cameras: [] }, impl)).rejects.toThrow(
      /no route/,
    );
  });
});
