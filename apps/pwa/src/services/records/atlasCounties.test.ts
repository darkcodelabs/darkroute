/**
 * THE THREE ABSENCES, AND THE ONE CLAIM THIS LAYER IS NOT ALLOWED TO MAKE.
 *
 * "the Atlas has no row for this county", "the Atlas file did not load" and
 * "there is no county to ask about" are three different facts, and the only one
 * of them that says anything about American policing is the first. If a failed
 * fetch renders as the first, this layer has published a claim about every
 * police department in the country on the strength of a 404.
 *
 * The shipped artifact is read off disk in the last block rather than
 * fabricated, for the reason `countyLocate.test.ts` gives: a fixture proves the
 * wiring and says nothing about whether the file the app actually serves holds
 * what it claims.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ATLAS_REFRESH_INTERVAL_MS, createAtlasCounties, parseAtlasCounty } from './atlasCounties.ts';
import type { AtlasIndex } from './atlasCounties.ts';

const PAYLOAD = {
  schema: 'darkroute-atlas-counties/v1',
  fetchedAt: '2026-09-07T13:50:00.991Z',
  checkedAt: '2026-09-07T13:50:25.927Z',
  source: {
    name: 'Atlas of Surveillance',
    home: 'https://atlasofsurveillance.org/',
    attribution: 'Atlas of Surveillance, a project of the Electronic Frontier Foundation and the University of Nevada, Reno Reynolds School of Journalism',
    licence: {
      observed: 'Creative Commons Attribution - version unconfirmed',
      confirmed: false,
      url: 'https://www.eff.org/copyright',
    },
  },
  totals: { alprRows: 4146, placed: 4142, unplaced: 4, counties: 1345, agencies: 3574 },
  counties: {
    '39061': {
      n: 26,
      agencies: ['Cincinnati Police Department', "Hamilton County Sheriff's Office"],
      vendors: ['Flock Safety'],
      vendorKnown: 25,
    },
    '29095': {
      n: 7,
      agencies: ['Kansas City Police Department'],
      vendors: [],
      vendorKnown: 0,
    },
  },
};

function serve(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({ ok, json: async () => Promise.resolve(body) }) as unknown as Response) as typeof fetch;
}

/**
 * The index loads on demand and holds no subscription, so a test has to poke it
 * once and then let the microtask queue drain. `ready()` is the signal the
 * screen uses for the same reason.
 */
async function loaded(body: unknown, ok = true): Promise<AtlasIndex> {
  const index = createAtlasCounties({ fetchImpl: serve(body, ok) });
  index.forCounty('39061');
  while (!index.ready()) await Promise.resolve();
  return index;
}

describe('what the Atlas says about a county', () => {
  it('reports the recorded deployments and the agencies behind them', async () => {
    const index = await loaded(PAYLOAD);
    const hit = index.forCounty('39061');
    expect(hit?.deployments).toBe(26);
    expect(hit?.agencies).toHaveLength(2);
    expect(index.coverageOf('39061')).toBe('recorded');
  });

  it('says a county has NONE without claiming the Atlas is complete', async () => {
    const index = await loaded(PAYLOAD);
    // A county the file has read and does not list. The service reports 'none';
    // the screen is what turns that into the sentence about the Atlas being
    // compiled from public records rather than being a census. What must NOT
    // happen here is 'none' being confused with 'unknown'.
    expect(index.forCounty('06037')).toBeNull();
    expect(index.coverageOf('06037')).toBe('none');
  });

  it('says UNKNOWN and not "none" when the file could not be read', async () => {
    // THE REGRESSION THIS FILE EXISTS FOR. An empty index answering 'none' would
    // tell every driver in America that no agency near them is on record as
    // operating a plate reader, on the strength of a failed fetch.
    const index = await loaded(null, false);
    expect(index.coverageOf('39061')).toBe('unknown');
  });

  it('says UNKNOWN for a payload tagged with a schema it does not understand', async () => {
    const index = await loaded({ ...PAYLOAD, schema: 'darkroute-atlas-counties/v2' });
    expect(index.coverageOf('39061')).toBe('unknown');
  });

  it('says UNKNOWN with no county, rather than answering about nowhere', async () => {
    const index = await loaded(PAYLOAD);
    expect(index.coverageOf(null)).toBe('unknown');
    expect(index.coverageOf('')).toBe('unknown');
  });
});

describe('the vendor picture is partial and the file says by how much', () => {
  it('carries how many rows named a vendor, not just the names', async () => {
    const index = await loaded(PAYLOAD);
    // 25 of 26. A list without this number beside it reads as the whole picture.
    expect(index.forCounty('39061')?.vendorKnown).toBe(25);
  });

  it('reports zero known vendors rather than an empty list that looks complete', async () => {
    const index = await loaded(PAYLOAD);
    expect(index.forCounty('29095')?.vendors).toEqual([]);
    expect(index.forCounty('29095')?.vendorKnown).toBe(0);
  });

  it('clamps a vendorKnown larger than the deployment count', () => {
    // "vendor recorded for 9 of 7" reads as a bug because it is one.
    const county = parseAtlasCounty('12345', { n: 7, agencies: ['A PD'], vendors: ['X'], vendorKnown: 9 });
    expect(county?.vendorKnown).toBe(7);
  });
});

describe('an entry that cannot be checked is dropped rather than shown', () => {
  it('refuses a county that claims deployments but names no agency', () => {
    // The count on its own is the part a reader cannot verify. This layer's
    // whole value is that every number is a list of agencies somebody can look
    // up, so a bare number is not a smaller answer - it is a worse one.
    expect(parseAtlasCounty('12345', { n: 4, agencies: [], vendors: [], vendorKnown: 0 })).toBeNull();
  });

  it('refuses a county whose count is missing or zero', () => {
    expect(parseAtlasCounty('12345', { agencies: ['A PD'] })).toBeNull();
    expect(parseAtlasCounty('12345', { n: 0, agencies: ['A PD'] })).toBeNull();
  });
});

describe('provenance travels with the data', () => {
  it('carries EFF and the university, because attribution is a licence condition', async () => {
    const index = await loaded(PAYLOAD);
    expect(index.source()?.attribution).toContain('Electronic Frontier Foundation');
    expect(index.source()?.attribution).toContain('Reynolds School of Journalism');
  });

  it('reports the licence as UNCONFIRMED and names no version', async () => {
    // eff.org/copyright states CC BY 4.0 in prose and CC BY 3.0 US in the
    // rel="license" badge in the same paragraph. A version here would be this
    // project asserting something it was never told.
    const index = await loaded(PAYLOAD);
    expect(index.source()?.licenceConfirmed).toBe(false);
    expect(index.source()?.licenceObserved).not.toMatch(/4\.0|3\.0/);
  });

  it('reports when the bytes were fetched, which is not when EFF compiled them', async () => {
    const index = await loaded(PAYLOAD);
    expect(index.fetchedAt()).toBe('2026-09-07T13:50:00.991Z');
    expect(index.checkedAt()).toBe('2026-09-07T13:50:25.927Z');
  });
});

describe('refreshing the shared index', () => {
  it('deduplicates reads and publishes changed agencies to subscribers after the stale interval', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const revised = { ...PAYLOAD, fetchedAt: '2026-09-10T00:00:00Z', checkedAt: '2026-09-10T00:00:01Z',
      counties: { '29095': { n: 2, agencies: ['Updated agency'], vendors: ['Updated vendor'], vendorKnown: 2 } } };
    const read = vi.fn().mockResolvedValueOnce(Response.json(PAYLOAD)).mockResolvedValueOnce(Response.json(revised));
    const index = createAtlasCounties({ fetchImpl: read });
    const changed = vi.fn();
    const stop = index.subscribe(changed);
    const first = index.refreshIfStale();
    expect(index.refreshIfStale()).toBe(first);
    await first;
    await index.refreshIfStale();
    expect(read).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1000 + ATLAS_REFRESH_INTERVAL_MS);
    await index.refreshIfStale();
    expect(read).toHaveBeenCalledTimes(2);
    expect(index.forCounty('29095')?.agencies).toEqual(['Updated agency']);
    expect(index.fetchedAt()).toBe('2026-09-10T00:00:00Z');
    expect(index.checkedAt()).toBe('2026-09-10T00:00:01Z');
    expect(index.getRevision()).toBe(2);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith('/records/atlas-counties.json', expect.objectContaining({
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache',
    }));
    stop();
    await index.refresh();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('retains the last good county data and provenance after failed or malformed refreshes', async () => {
    const read = vi.fn().mockResolvedValueOnce(Response.json(PAYLOAD))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ ...PAYLOAD, schema: 'wrong' }))
      .mockResolvedValueOnce(Response.json({ ...PAYLOAD, counties: {} }));
    const index = createAtlasCounties({ fetchImpl: read });
    await index.refresh();
    for (let attempt = 0; attempt < 3; attempt++) {
      await index.refresh();
      expect(index.coverageOf('39061')).toBe('recorded');
      expect(index.forCounty('39061')?.deployments).toBe(26);
      expect(index.fetchedAt()).toBe(PAYLOAD.fetchedAt);
      expect(index.checkedAt()).toBe(PAYLOAD.checkedAt);
    }
  });

  it('retries an initial unavailable index when it becomes stale', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json(PAYLOAD));
    const index = createAtlasCounties({ fetchImpl: read });
    await index.refreshIfStale();
    expect(index.ready()).toBe(true);
    expect(index.coverageOf('39061')).toBe('unknown');
    now.mockReturnValue(ATLAS_REFRESH_INTERVAL_MS);
    await index.refreshIfStale();
    expect(index.coverageOf('39061')).toBe('recorded');
  });
});

describe('the file the app actually serves', () => {
  const SHIPPED: unknown = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/records/atlas-counties.json'), 'utf8'),
  );

  it('parses through the real service and places thousands of agencies', async () => {
    const index = await loaded(SHIPPED);
    const totals = index.totals();
    expect(totals?.counties).toBeGreaterThan(1000);
    expect(totals?.agencies).toBeGreaterThan(3000);
  });

  it('publishes the rows it REFUSED to place rather than dropping them quietly', () => {
    const body = SHIPPED as { unplaced?: { why?: string }[] };
    expect(body.unplaced?.length).toBeGreaterThan(0);
    for (const row of body.unplaced ?? []) {
      expect(row.why?.length ?? 0).toBeGreaterThan(20);
    }
  });
});
