/**
 * THE OVERVIEW IS A SNAPSHOT, AND IT SAYS WHICH ONE.
 *
 * `overview.json` is the whole published archive as bare coordinates. Two
 * screens read it -- the map below z11, and the POI export -- and both used to
 * `fetch('/cameras/overview.json')` raw: no generation query, no header check,
 * not even `guardedFetch`, so an expired sign-in was indistinguishable from
 * data. A generation transition could leave the map drawing one snapshot's dots
 * over another snapshot's warnings, and could hand a driver a POI file that
 * disagreed with the app that produced it.
 */

import { describe, expect, it, vi } from 'vitest';

import { createCameraOverview } from './overview.ts';

const G1 = 'a'.repeat(64);
const G2 = 'b'.repeat(64);

function overviewFile(
  coords: readonly number[],
  generation: string | null,
  status = 200,
): Response {
  return new Response(
    JSON.stringify({
      coords,
      attribution: 'Map data © OpenStreetMap contributors',
      licence: 'ODbL-1.0',
    }),
    {
      status,
      ...(generation === null ? {} : { headers: { 'x-darkroute-camera-generation': generation } }),
    },
  );
}

describe('the overview is bound to the generation it describes', () => {
  it('asks for the working generation and carries the ODbL notice with the points', async () => {
    const fetchImpl = vi.fn(async () =>
      overviewFile([39.0997, -84.5786], G1),
    ) as unknown as typeof fetch;
    const overview = createCameraOverview({ fetchImpl, workingGeneration: () => G1 });

    const held = await overview.settled();

    expect(held?.coords).toEqual([39.0997, -84.5786]);
    // ODbL requires the attribution wherever the points are rendered, so it
    // travels with them rather than being re-stated by each screen.
    expect(held?.attribution).toBe('Map data © OpenStreetMap contributors');
    expect(held?.licence).toBe('ODbL-1.0');
    expect(fetchImpl).toHaveBeenCalledWith(`/cameras/overview.json?generation=${G1}`, {
      redirect: 'manual',
    });
  });

  it('draws nothing at all before a generation is known', async () => {
    // A hundred thousand dots over a map with no warnings behind them is the
    // incoherence this binding exists to prevent, not a richer map.
    const fetchImpl = vi.fn(async () => overviewFile([39, -84], G1)) as unknown as typeof fetch;
    const overview = createCameraOverview({ fetchImpl, workingGeneration: () => null });

    await expect(overview.settled()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a body served under a different generation', async () => {
    const fetchImpl = vi.fn(async () => overviewFile([39, -84], G2)) as unknown as typeof fetch;
    const overview = createCameraOverview({ fetchImpl, workingGeneration: () => G1 });

    await expect(overview.settled()).resolves.toBeNull();
    expect(overview.ready()).toBe(false);
  });

  it('refuses an empty coordinate list rather than reporting an empty country', async () => {
    // A damaged generation and a country with no cameras in it are different
    // claims. The export would carry the second one into another device.
    const fetchImpl = vi.fn(async () => overviewFile([], G1)) as unknown as typeof fetch;
    const overview = createCameraOverview({ fetchImpl, workingGeneration: () => G1 });

    await expect(overview.settled()).resolves.toBeNull();
  });

  it('refuses the 503 a damaged generation answers a missing sidecar with', async () => {
    const fetchImpl = vi.fn(async () =>
      overviewFile([39, -84], G1, 503),
    ) as unknown as typeof fetch;
    const overview = createCameraOverview({ fetchImpl, workingGeneration: () => G1 });

    await expect(overview.settled()).resolves.toBeNull();
  });

  it('re-reads the file when the working generation moves', async () => {
    let working = G1;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://darkroute.test');
      const generation = url.searchParams.get('generation') ?? '';
      return overviewFile(generation === G1 ? [39, -84] : [40, -85], generation);
    }) as unknown as typeof fetch;
    const overview = createCameraOverview({ fetchImpl, workingGeneration: () => working });

    await expect(overview.settled()).resolves.toMatchObject({ coords: [39, -84] });

    working = G2;
    // The old points are dropped the instant the pointer moves, not when the
    // replacement arrives: a stale overview is a claim about where cameras are.
    expect(overview.get()).toBeNull();
    await expect(overview.settled()).resolves.toMatchObject({ coords: [40, -85] });
  });

  it('drops a slow G1 body that lands after the store has reached G2', async () => {
    // THE LATE-RESPONSE RACE, on the file most likely to lose it: this one is
    // about a megabyte, so it is the read most likely to still be in flight
    // when the hourly pointer moves.
    let working = G1;
    let releaseG1 = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseG1 = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://darkroute.test');
      const generation = url.searchParams.get('generation') ?? '';
      if (generation === G1) await held;
      return overviewFile(generation === G1 ? [39, -84] : [40, -85], generation);
    }) as unknown as typeof fetch;
    const overview = createCameraOverview({ fetchImpl, workingGeneration: () => working });

    overview.get();
    working = G2;
    const settled = overview.settled();
    releaseG1();

    await expect(settled).resolves.toMatchObject({ coords: [40, -85] });
    await Promise.resolve();
    expect(overview.get()).toMatchObject({ coords: [40, -85] });
    expect(overview.generation()).toBe(G2);
  });
});
