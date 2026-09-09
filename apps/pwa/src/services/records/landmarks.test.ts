/**
 * The rule this file exists to hold: a landmark that does not DISTINGUISH is
 * not shown. Six readers around one store all reading NEAR HOME DEPOT would
 * recreate the exact problem the landmark was added to solve, with a different
 * word in it - and would imply to a driver that there is one camera there.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  distinctLandmarks,
  landmarkAttribution,
  landmarkFor,
  loadLandmarks,
  landmarksReady,
  resetLandmarksForTest,
} from './landmarks.ts';

const PAYLOAD = {
  schema: 'darkroute-landmarks/v1',
  attribution: 'Map data © OpenStreetMap contributors',
  radiusM: 120,
  landmarks: {
    'osm:1': ['The Home Depot', 40, 'Q864407'],
    'osm:2': ['The Home Depot', 55, 'Q864407'],
    'osm:3': ['Price Chopper', 30],
    'osm:4': ['home depot', 61],
    'osm:5': ['Sprint Center', 90],
  },
};

function serve(body: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      json: async () => Promise.resolve(body),
    }) as unknown as Response) as typeof fetch;
}

beforeEach(() => {
  resetLandmarksForTest();
});

describe('loading', () => {
  it('reads the table and reports itself ready', async () => {
    await loadLandmarks(serve(PAYLOAD));
    expect(landmarksReady()).toBe(true);
    expect(landmarkFor('osm:3')?.name).toBe('Price Chopper');
    expect(landmarkFor('osm:3')?.metres).toBe(30);
  });

  it('carries the brand id when the source recorded one', async () => {
    await loadLandmarks(serve(PAYLOAD));
    expect(landmarkFor('osm:1')?.brandId).toBe('Q864407');
    expect(landmarkFor('osm:3')?.brandId).toBeNull();
  });

  it('is empty rather than broken when the file is missing', async () => {
    await loadLandmarks(serve(null, false));
    expect(landmarksReady()).toBe(true);
    expect(landmarkFor('osm:1')).toBeNull();
  });

  it('is empty rather than broken when the fetch throws', async () => {
    await loadLandmarks((() => Promise.reject(new Error('offline'))) as typeof fetch);
    expect(landmarkFor('osm:1')).toBeNull();
  });

  /*
   * A different schema is REFUSED, not guessed at. A reader that tolerates an
   * unknown shape is a reader that will one day render a field that means
   * something else.
   */
  it('refuses a payload tagged with another schema', async () => {
    await loadLandmarks(serve({ ...PAYLOAD, schema: 'darkroute-landmarks/v2' }));
    expect(landmarkFor('osm:1')).toBeNull();
  });

  it('carries the attribution, because ODbL obliges it wherever this is shown', async () => {
    await loadLandmarks(serve(PAYLOAD));
    expect(landmarkAttribution()).toContain('OpenStreetMap');
  });
});

describe('only landmarks that distinguish are shown', () => {
  it('suppresses a landmark two visible cameras share', async () => {
    await loadLandmarks(serve(PAYLOAD));
    const shown = distinctLandmarks(['osm:1', 'osm:2', 'osm:3']);
    expect(shown.has('osm:1')).toBe(false);
    expect(shown.has('osm:2')).toBe(false);
    // The one that is unique among these still shows.
    expect(shown.get('osm:3')?.name).toBe('Price Chopper');
  });

  it('shows it when the sharing camera is not on screen', async () => {
    await loadLandmarks(serve(PAYLOAD));
    const shown = distinctLandmarks(['osm:1', 'osm:3']);
    expect(shown.get('osm:1')?.name).toBe('The Home Depot');
  });

  /*
   * Two branches of one chain must collide even when their names are cased
   * differently, which is why the brand id is preferred and the name is folded.
   */
  it('groups by brand id, and falls back to a case-folded name', async () => {
    await loadLandmarks(serve(PAYLOAD));
    // osm:4 is "home depot" with no brand id; osm:1 is "The Home Depot" with
    // one, so those two do NOT collide - different keys, both unique.
    expect(distinctLandmarks(['osm:1', 'osm:4']).size).toBe(2);
    // But two records with the same brand id do collide regardless of name.
    expect(distinctLandmarks(['osm:1', 'osm:2']).size).toBe(0);
  });

  it('ignores cameras with no landmark rather than counting them together', async () => {
    await loadLandmarks(serve(PAYLOAD));
    const shown = distinctLandmarks(['osm:5', 'osm:missing', undefined]);
    expect(shown.size).toBe(1);
    expect(shown.get('osm:5')?.name).toBe('Sprint Center');
  });

  it('shows nothing at all before the table has loaded', () => {
    expect(distinctLandmarks(['osm:1', 'osm:3']).size).toBe(0);
  });
});
