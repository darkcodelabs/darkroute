/**
 * NAMES BELONG TO THE SNAPSHOT THEY WERE PUBLISHED IN.
 *
 * `counties.json` and `places.json` are rewritten inside every camera
 * generation: a county's camera count changes, a place is renamed, a FIPS is
 * re-issued. They were fetched once, unversioned, with no header check and no
 * invalidation input at all -- a module singleton a mid-drive pointer change
 * could never correct -- so a driver could be warned about G2 cameras under G1
 * names for the rest of the session, with nothing on screen to say so.
 *
 * These tests are the protocol, not the parser: which URL is asked for, which
 * responses are admitted, and what happens when one arrives late.
 */

import { describe, expect, it, vi } from 'vitest';

import { createGazetteer } from './gazetteer.ts';

const G1 = 'a'.repeat(64);
const G2 = 'b'.repeat(64);

interface Row {
  readonly fips?: string;
  readonly geoid?: string;
  readonly name?: string;
  readonly label?: string;
  readonly cameras?: number;
}

function file(rows: readonly Row[], generation: string | null, status = 200): Response {
  return new Response(JSON.stringify({ rows }), {
    status,
    ...(generation === null ? {} : { headers: { 'x-darkroute-camera-generation': generation } }),
  });
}

const G1_COUNTY: Row = { fips: '20091', name: 'JOHNSON', label: 'JOHNSON CO, KS', cameras: 401 };
const G2_COUNTY: Row = { fips: '20091', name: 'JOHNSON', label: 'JOHNSON CO, KS', cameras: 402 };
const PLACE: Row = { geoid: '2053775', name: 'OVERLAND PARK', label: 'OVERLAND PARK' };

/** A server that answers both files out of whichever generation it is serving. */
function gazetteerServer(generation: () => string): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://darkroute.test');
    const served = generation();
    if (url.pathname.endsWith('/counties.json')) {
      return file([served === G1 ? G1_COUNTY : G2_COUNTY], served);
    }
    return file([PLACE], served);
  }) as unknown as typeof fetch;
}

describe('the gazetteer asks for one generation', () => {
  it('puts the working generation in the URL of both files', async () => {
    const fetchImpl = gazetteerServer(() => G1);
    const g = createGazetteer({ fetchImpl, workingGeneration: () => G1 });

    g.county('20091');
    await vi.waitFor(() => {
      expect(g.ready()).toBe(true);
    });

    const asked = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.map(
      ([input]) => String(input),
    );
    expect(asked).toContain(`/cameras/counties.json?generation=${G1}`);
    expect(asked).toContain(`/cameras/places.json?generation=${G1}`);
  });

  it('fetches nothing at all before a generation is known', async () => {
    // No identity means the warning tiles are empty too. Naming places out of
    // an unbindable file would be the app disagreeing with itself.
    const fetchImpl = gazetteerServer(() => G1);
    const g = createGazetteer({ fetchImpl, workingGeneration: () => null });

    expect(g.county('20091')).toBeNull();
    expect(g.place('2053775')).toBeNull();
    await Promise.resolve();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(g.ready()).toBe(false);
    expect(g.generation()).toBeNull();
  });

  it('refuses a body served under a different generation than the one asked for', async () => {
    // The pointer moved between the request and the response. The names are
    // real -- for the other snapshot.
    const fetchImpl = vi.fn(async () => file([G2_COUNTY], G2)) as unknown as typeof fetch;
    const g = createGazetteer({ fetchImpl, workingGeneration: () => G1 });

    g.county('20091');
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    await Promise.resolve();

    expect(g.county('20091')).toBeNull();
    expect(g.ready()).toBe(false);
  });

  it('refuses a plausible body with no generation header at all', async () => {
    const fetchImpl = vi.fn(async () => file([G1_COUNTY], null)) as unknown as typeof fetch;
    const g = createGazetteer({ fetchImpl, workingGeneration: () => G1 });

    g.county('20091');
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    await Promise.resolve();

    expect(g.county('20091')).toBeNull();
  });

  it('is an absence, never a thrown screen, when the file cannot be read', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const g = createGazetteer({ fetchImpl, workingGeneration: () => G1 });

    expect(g.county('20091')).toBeNull();
    await Promise.resolve();
    expect(g.county('20091')).toBeNull();
    expect(g.ready()).toBe(false);
  });
});

describe('a generation transition mid-drive', () => {
  it('drops the old names the moment the working generation moves', async () => {
    let working = G1;
    const g = createGazetteer({
      fetchImpl: gazetteerServer(() => working),
      workingGeneration: () => working,
    });

    await vi.waitFor(() => {
      expect(g.county('20091')?.cameras).toBe(401);
    });

    working = G2;
    // Not "the previous answer until the new one arrives": that is the state
    // this binding exists to make impossible.
    expect(g.county('20091')).toBeNull();
    expect(g.generation()).toBeNull();

    await vi.waitFor(() => {
      expect(g.county('20091')?.cameras).toBe(402);
    });
    await vi.waitFor(() => {
      expect(g.generation()).toBe(G2);
    });
  });

  it('drops a slow G1 response that lands after the store has reached G2', async () => {
    // THE LATE-RESPONSE RACE. The bytes are honestly G1 and the header proves
    // it; the store is on G2 by the time they arrive. Admitting them would
    // install G1 names beside G2 warnings -- the same mixture the header check
    // catches in the other direction.
    let working = G1;
    let releaseG1 = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseG1 = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://darkroute.test');
      const generation = url.searchParams.get('generation') ?? '';
      if (generation === G1) await held;
      const rows = url.pathname.endsWith('/counties.json')
        ? [generation === G1 ? G1_COUNTY : G2_COUNTY]
        : [PLACE];
      return file(rows, generation);
    }) as unknown as typeof fetch;

    const g = createGazetteer({ fetchImpl, workingGeneration: () => working });
    g.county('20091');

    working = G2;
    g.county('20091');
    releaseG1();
    await vi.waitFor(() => {
      expect(g.county('20091')?.cameras).toBe(402);
    });

    // And the late G1 body settling afterwards must not roll it back.
    await Promise.resolve();
    expect(g.county('20091')?.cameras).toBe(402);
    await vi.waitFor(() => {
      expect(g.generation()).toBe(G2);
    });
  });

  it('never reports ready while its two files describe different generations', async () => {
    // One file answered from a worker cache for the previous generation and
    // the other from the network is a mixture, and a mixture is not a
    // gazetteer.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://darkroute.test');
      return url.pathname.endsWith('/counties.json') ? file([G1_COUNTY], G1) : file([PLACE], G2);
    }) as unknown as typeof fetch;
    const g = createGazetteer({ fetchImpl, workingGeneration: () => G1 });

    await vi.waitFor(() => {
      expect(g.county('20091')?.cameras).toBe(401);
    });

    expect(g.place('2053775')).toBeNull();
    expect(g.ready()).toBe(false);
    expect(g.generation()).toBeNull();
  });
});
