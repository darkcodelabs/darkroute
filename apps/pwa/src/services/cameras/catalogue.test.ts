/**
 * THE CATALOGUE READS WHAT IS SERVED, NOT WHAT WAS BUILT.
 *
 * This distinction is the whole reason `upstream()` exists. The freshness
 * patrol publishes a complete R2 generation hourly and atomically advances its
 * pointer; it commits neither tiles nor a watermark to Git, because an hourly
 * commit would mean ~720 Pages builds a month against a ceiling of 500. So the
 * DATA a driver is warned against moves without the BUNDLE moving.
 *
 * Measured the hour that went live: the bundle held 132,068 cameras at
 * 2026-08-26T19:00Z, and R2 held 132,470 at 2026-08-31T17:00Z. INTEL's
 * `DATA AS OF` row was briefly a build constant, which would have reported
 * five-day-old data to a driver being warned against current data - the exact
 * failure the row exists to prevent.
 */

import { describe, expect, it, vi } from 'vitest';

import { createCatalogue } from './catalogue.ts';

const GENERATION = 'a'.repeat(64);

function serving(body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-darkroute-camera-generation': GENERATION,
        },
      }),
  ) as unknown as typeof fetch;
}

function testedCatalogue(fetchImpl: typeof fetch) {
  return createCatalogue({ fetchImpl, workingGeneration: () => GENERATION });
}

describe('total', () => {
  it('reads the published count, and is null until it has it', async () => {
    const c = testedCatalogue(
      serving({
        zoom: 11,
        cameras: 132470,
        tiles: 8_605,
        upstream: '2026-08-31T17:00:00Z',
      }),
    );
    expect(c.ready()).toBe(false);
    await vi.waitFor(() => {
      expect(c.total()).toBe(132470);
    });
    expect(c.ready()).toBe(true);
  });

  it('reports unknown rather than a guess when the fetch fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const c = testedCatalogue(fetchImpl);
    expect(c.total()).toBeNull();
    await Promise.resolve();
    expect(c.total()).toBeNull();
    expect(c.ready()).toBe(false);
  });
});

describe('upstream', () => {
  it('reads the SERVED archive stamp', async () => {
    const c = testedCatalogue(
      serving({
        zoom: 11,
        cameras: 132470,
        tiles: 8_605,
        upstream: '2026-08-31T17:00:00Z',
      }),
    );
    await vi.waitFor(() => {
      expect(c.upstream()).toBe('2026-08-31T17:00:00Z');
    });
    expect(c.total()).toBe(132470);
    expect(c.generation()).toBe(GENERATION);
  });

  it('takes `upstream`, never `generatedAt`', async () => {
    // Two timestamps sit in index.json and only one is a fact about the
    // cameras: `upstream` is the OSM snapshot, `generatedAt` is when the build
    // ran over it. Reporting the second would make a stale archive look an hour
    // fresher than it is.
    const c = testedCatalogue(
      serving({
        zoom: 11,
        cameras: 10,
        tiles: 1,
        upstream: '2026-08-31T17:00:00Z',
        generatedAt: '2026-08-31T18:04:37.346Z',
      }),
    );
    await vi.waitFor(() => {
      expect(c.upstream()).toBe('2026-08-31T17:00:00Z');
    });
  });

  it('rejects an index missing its upstream rather than inventing one', async () => {
    const c = testedCatalogue(serving({ zoom: 11, cameras: 10, tiles: 1 }));
    await Promise.resolve();
    expect(c.upstream()).toBeNull();
    expect(c.total()).toBeNull();
  });

  it('does not trust a plausible body without the generation header', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            zoom: 11,
            cameras: 10,
            tiles: 1,
            upstream: '2026-08-31T17:00:00Z',
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const c = testedCatalogue(fetchImpl);
    expect(c.total()).toBeNull();
    await Promise.resolve();
    expect(c.ready()).toBe(false);
  });

  it('never labels G1 working tiles with a G2 catalogue', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            zoom: 11,
            cameras: 200,
            tiles: 20,
            upstream: '2026-09-02T11:00:00Z',
          }),
          { headers: { 'x-darkroute-camera-generation': 'b'.repeat(64) } },
        ),
    ) as unknown as typeof fetch;
    const c = createCatalogue({
      fetchImpl,
      workingGeneration: () => GENERATION,
    });

    expect(c.total()).toBeNull();
    await Promise.resolve();
    expect(c.total()).toBeNull();
    expect(c.upstream()).toBeNull();
  });

  it('invalidates G1 values and reloads them only after the working store reaches G2', async () => {
    let working = GENERATION;
    let served = GENERATION;
    const fetchImpl = vi.fn(async () => {
      const isG2 = served.startsWith('b');
      return new Response(
        JSON.stringify({
          zoom: 11,
          cameras: isG2 ? 200 : 100,
          tiles: isG2 ? 20 : 10,
          upstream: isG2 ? '2026-09-02T11:00:00Z' : '2026-09-02T10:00:00Z',
        }),
        { headers: { 'x-darkroute-camera-generation': served } },
      );
    }) as unknown as typeof fetch;
    const c = createCatalogue({ fetchImpl, workingGeneration: () => working });
    await vi.waitFor(() => expect(c.total()).toBe(100));

    working = 'b'.repeat(64);
    served = 'b'.repeat(64);
    expect(c.total()).toBeNull();
    await vi.waitFor(() => expect(c.total()).toBe(200));
    expect(c.upstream()).toBe('2026-09-02T11:00:00Z');
  });
});
