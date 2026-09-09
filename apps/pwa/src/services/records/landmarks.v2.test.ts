/**
 * THE DICTIONARY ENCODING, and why the index could not ship without it.
 *
 * v1 wrote the landmark's name into every record. This index is mostly chains,
 * so that stored "Walmart" thousands of times and every other brand likewise:
 * 2.78 MB against a 1.6 MB ceiling, which the builder refused outright rather
 * than shipping over budget. Narrowing the radius or the tag allowlist would
 * have fixed the number by dropping real coverage; the repetition was the
 * actual waste, so the repetition is what went.
 *
 * These tests hold both halves: v2 resolves through the table, and a phone
 * still holding a cached v1 file keeps working rather than losing its chips.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { landmarkFor, loadLandmarks, resetLandmarksForTest } from './landmarks.ts';

function serving(body: unknown): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response)) as unknown as typeof fetch;
}

beforeEach(() => {
  resetLandmarksForTest();
});

describe('the v2 landmark index', () => {
  it('resolves a record through the name table', async () => {
    await loadLandmarks(
      serving({
        schema: 'darkroute-landmarks/v2',
        names: [['Walmart', 'Q483551'], ['Indian Creek Library']],
        landmarks: { 'osm:1': [0, 84], 'osm:2': [1, 61] },
      }),
    );

    expect(landmarkFor('osm:1')).toEqual({ name: 'Walmart', metres: 84, brandId: 'Q483551' });
    // No brand id in the table entry means none on the record - not an empty
    // string, which would render as a chip with nothing in it.
    expect(landmarkFor('osm:2')).toEqual({
      name: 'Indian Creek Library',
      metres: 61,
      brandId: null,
    });
  });

  it('shares one brand id across every camera at that chain', async () => {
    // The whole point of the table: the id is a property of the brand, so
    // repeating it per camera repeated v1's mistake one column over.
    await loadLandmarks(
      serving({
        schema: 'darkroute-landmarks/v2',
        names: [['Walmart', 'Q483551']],
        landmarks: { 'osm:1': [0, 84], 'osm:2': [0, 110], 'osm:3': [0, 12] },
      }),
    );

    for (const id of ['osm:1', 'osm:2', 'osm:3']) {
      expect(landmarkFor(id)?.brandId).toBe('Q483551');
    }
  });

  it('drops a record pointing outside the table rather than inventing a blank name', async () => {
    await loadLandmarks(
      serving({
        schema: 'darkroute-landmarks/v2',
        names: [['Walmart']],
        landmarks: { 'osm:1': [0, 84], 'osm:2': [7, 61] },
      }),
    );

    expect(landmarkFor('osm:1')?.name).toBe('Walmart');
    expect(landmarkFor('osm:2')).toBeNull();
  });

  it('still reads a v1 file, because a phone holding one is not wrong', async () => {
    await loadLandmarks(
      serving({
        schema: 'darkroute-landmarks/v1',
        landmarks: { 'osm:1': ['Home Depot', 92, 'Q864407'] },
      }),
    );

    expect(landmarkFor('osm:1')).toEqual({
      name: 'Home Depot',
      metres: 92,
      brandId: 'Q864407',
    });
  });

  it('is an empty table, not an error, when the file is not there yet', async () => {
    // The index is a convenience. A device with no signal, or one where no
    // landmark run has happened, must keep every warning it has.
    await loadLandmarks((() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)) as unknown as typeof fetch);

    expect(landmarkFor('osm:1')).toBeNull();
  });
});
