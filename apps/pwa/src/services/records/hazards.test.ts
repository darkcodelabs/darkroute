/**
 * The two rules this layer cannot get wrong.
 *
 *   1. It is not a police layer, and nothing in it says it is.
 *   2. "No roadwork here" and "no feed for this state" are different facts and
 *      must never render the same, because a blank map in an uncovered state
 *      says nothing at all about the road.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  coverageOf,
  hazardAgeMs,
  hazardCoverage,
  hazardSources,
  hazards,
  hazardsStale,
  loadHazards,
  resetHazardsForTest,
} from './hazards.ts';

const BUILT = '2026-09-04T12:00:00.000Z';
const PAYLOAD = {
  schema: 'darkroute-hazards/v1',
  builtAt: BUILT,
  coverage: ['KS', 'MO'],
  sources: [
    { key: 'ks-kandrive-wzdx', ok: true, label: 'Kansas DOT', licence: 'CC0-1.0', attribution: 'KDOT', records: 400 },
    { key: 'broken', ok: false, reason: 'HTTP 504', records: 0 },
  ],
  count: 2,
  hazards: [
    { s: 'ks-kandrive-wzdx', i: '1', k: 'work-zone', lat: 38.96, lon: -94.65, d: 'lane closed', r: 'I-435' },
    { s: 'mo-modot-wzdx', i: '2', k: 'detour', lat: 39.1, lon: -94.58, d: '', r: '' },
  ],
};

function serve(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => Promise.resolve(body) }) as unknown as Response) as typeof fetch;
}

beforeEach(() => {
  resetHazardsForTest();
});

describe('loading', () => {
  it('reads the hazards and the sources that succeeded', async () => {
    await loadHazards(serve(PAYLOAD));
    expect(hazards()).toHaveLength(2);
    // The failed source is not presented as a source of anything.
    expect(hazardSources()).toHaveLength(1);
    expect(hazardSources()[0]?.licence).toBe('CC0-1.0');
  });

  it('is an empty layer rather than an error when the file is missing', async () => {
    await loadHazards(serve(null, false));
    expect(hazards()).toHaveLength(0);
  });

  it('refuses a payload tagged with another schema', async () => {
    await loadHazards(serve({ ...PAYLOAD, schema: 'darkroute-hazards/v2' }));
    expect(hazards()).toHaveLength(0);
  });
});

describe('staleness is measured from the file, not from the build', () => {
  it('reports the real age of the data', async () => {
    await loadHazards(serve(PAYLOAD));
    const twoHoursLater = Date.parse(BUILT) + 2 * 60 * 60 * 1000;
    expect(hazardAgeMs(twoHoursLater)).toBe(2 * 60 * 60 * 1000);
    expect(hazardsStale(twoHoursLater)).toBe(false);
  });

  it('calls itself stale past a day', async () => {
    await loadHazards(serve(PAYLOAD));
    expect(hazardsStale(Date.parse(BUILT) + 25 * 60 * 60 * 1000)).toBe(true);
  });

  it('is stale when nothing loaded, rather than claiming to be current', async () => {
    await loadHazards(serve(null, false));
    expect(hazardAgeMs()).toBeNull();
    expect(hazardsStale()).toBe(true);
  });
});

describe('an empty map means two different things', () => {
  it('says covered inside a state with a feed', async () => {
    await loadHazards(serve(PAYLOAD));
    expect(coverageOf(38.96, -94.65)).toBe('covered');
  });

  it('says uncovered where no feed exists, which is NOT the same as clear', async () => {
    await loadHazards(serve(PAYLOAD));
    // Los Angeles: the layer has nothing to say about it.
    expect(coverageOf(34.05, -118.24)).toBe('uncovered');
  });

  it('says unknown with no fix, rather than guessing either way', async () => {
    await loadHazards(serve(PAYLOAD));
    expect(coverageOf(null, null)).toBe('unknown');
  });

  it('names the states it covers so the control can say so', async () => {
    await loadHazards(serve(PAYLOAD));
    expect(hazardCoverage()).toEqual(['KS', 'MO']);
  });
});
