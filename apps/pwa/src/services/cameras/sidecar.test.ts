/**
 * THE GENERATION-BOUND SIDECAR LOADER, AND ITS FAILURE BEHAVIOUR.
 *
 * =============================================================================
 * WHY THE FAILURE PATH IS THE INTERESTING ONE
 * =============================================================================
 * These resources are read from RENDER BODIES on the driving screen -
 * `ZoneCard`, `ZoneCaption`, `RadarScreen`, `MisuseScreen` and `IntelScreen`
 * all call `gazetteer.county()` / `place()` while rendering - and `get()`
 * starts the load. So the cost of a failed load is not one wasted request, it
 * is one wasted request PER RENDER, of files that are 370 KB and 1.36 MB.
 *
 * That was measured at 20 fetches across 10 render passes against a 503, which
 * is the exact answer `functions/cameras/[[path]].ts` gives for a damaged
 * generation and the shape of an offline miss. The module this replaced did two
 * fetches in the life of a session.
 */

import { describe, expect, it, vi } from 'vitest';

import { CAMERA_GENERATION_HEADER } from './generation.ts';
import { SIDECAR_RETRY_COOLDOWN_MS, createGenerationBoundResource } from './sidecar.ts';

const G = 'a'.repeat(64);

/** A server that answers `status` for every sidecar, stamping the header. */
function server(status: number, body: unknown = { rows: [] }) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(status === 200 ? JSON.stringify(body) : 'nope', {
      status,
      headers: { [CAMERA_GENERATION_HEADER]: G, 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function resource(fetchImpl: typeof fetch, now: () => number) {
  return createGenerationBoundResource<{ rows: unknown[] }>({
    path: 'counties.json',
    parse: (body) => body as { rows: unknown[] },
    fetchImpl,
    workingGeneration: () => G,
    now,
  });
}

describe('a generation-bound sidecar', () => {
  it('does NOT refetch on every read once the load has failed', async () => {
    /*
     * THE REGRESSION THIS FILE EXISTS FOR. Ten `get()` calls is ten renders of
     * the driving screen, which is a second or two of driving. Without the
     * cooldown this issued a fresh request for every one of them.
     */
    const { impl, calls } = server(503);
    const clock = 0;
    const res = resource(impl, () => clock);

    // SETTLE THE FAILURE FIRST. An earlier version of this test fired the ten
    // reads while the first load was still in flight, so the in-flight guard
    // deduped them and it passed with the cooldown removed - proving only that
    // concurrent reads share a load, which was never the bug. The storm happens
    // AFTER a load has finished failing and cleared itself.
    await res.settled();
    expect(calls.length).toBe(1);

    for (let i = 0; i < 10; i += 1) res.get();
    await Promise.resolve();

    expect(calls.length).toBe(1);
    expect(res.get()).toBeNull();
    expect(res.ready()).toBe(false);
  });

  it('tries again once the cooldown has passed, so a dead spot is not permanent', async () => {
    // The other half: a 503 can mean the pointer is mid-transition, and a
    // driver coming back into signal must get county names again without
    // restarting the app.
    const { impl, calls } = server(503);
    let clock = 0;
    const res = resource(impl, () => clock);

    await res.settled();
    expect(calls.length).toBe(1);

    clock += SIDECAR_RETRY_COOLDOWN_MS + 1;
    await res.settled();

    expect(calls.length).toBe(2);
  });

  it('serves from memory after a success, without refetching', async () => {
    const { impl, calls } = server(200, { rows: [1, 2, 3] });
    const clock = 0;
    const res = resource(impl, () => clock);

    await res.settled();
    for (let i = 0; i < 10; i += 1) res.get();
    await Promise.resolve();

    expect(calls.length).toBe(1);
    expect(res.ready()).toBe(true);
    expect(res.get()).toEqual({ rows: [1, 2, 3] });
  });

  it('clears the cooldown after a success, so a later failure is not skipped', async () => {
    // A stale cooldown left over from an earlier failure would suppress the
    // retry for a generation that had since become readable and failed again.
    let status = 503;
    const calls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(status === 200 ? JSON.stringify({ rows: [] }) : 'nope', {
        status,
        headers: { [CAMERA_GENERATION_HEADER]: G, 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    let clock = 0;
    const res = resource(impl, () => clock);

    await res.settled();
    expect(calls.length).toBe(1);

    status = 200;
    clock += SIDECAR_RETRY_COOLDOWN_MS + 1;
    await res.settled();
    expect(res.ready()).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('settles without hanging while the cooldown is active', async () => {
    // `settled()` must answer "nothing more to wait for" rather than awaiting a
    // load that the cooldown deliberately did not start.
    const { impl } = server(503);
    const clock = 0;
    const res = resource(impl, () => clock);

    await res.settled();
    await expect(res.settled()).resolves.toBeNull();
  });
});
