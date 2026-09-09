/**
 * THE ROUTE PREVIEW -- fewest cameras first, honest counts, never empty.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../services/db/schema.ts';
import type { DarkRoute } from '../../services/route/darkRoute.ts';
import type { PlannedRoute } from '../../services/route/planRoute.ts';

import { COUNT_UNKNOWN } from './panel.ts';
import { PREVIEW_FAILED, PREVIEW_NO_FIX, previewWithoutFix, routeOptionsFrom } from './preview.ts';

function camera(id: string, lat: number, lon: number): CameraRecord {
  return { id, lat, lon, directionDeg: null };
}

/* A straight line east along 38.9 N. The reader at 38.9, -94.66 sits on it;
   the one a kilometre north does not. */
const PLAIN: PlannedRoute = {
  shape: [
    { lat: 38.9, lon: -94.7 },
    { lat: 38.9, lon: -94.6 },
  ],
  miles: 5.4,
  seconds: 9 * 60 + 20,
  avoided: 0,
  maneuvers: [],
};

const DARK: DarkRoute = {
  route: { ...PLAIN, miles: 6.1, seconds: 12 * 60, avoided: 1 },
  avoided: [camera('osm:on-line', 38.9, -94.66)],
  remaining: [],
  rounds: 2,
};

const CAMERAS = [camera('osm:on-line', 38.9, -94.66), camera('osm:north', 38.91, -94.66)];

describe('the preview rows', () => {
  it('puts fewest cameras first, with the readers still on that line as its count', () => {
    const rows = routeOptionsFrom(PLAIN, DARK, CAMERAS);
    expect(rows.map((row) => row.kind)).toEqual(['fewest-cameras', 'fastest']);
    expect(rows[0]).toEqual({ kind: 'fewest-cameras', detail: '12 min · 6.1 mi', count: { state: 'known', cams: 0 } });
  });

  it('counts the fastest line against the archive on the phone', () => {
    const fastest = routeOptionsFrom(PLAIN, DARK, CAMERAS)[1];
    expect(fastest).toEqual({ kind: 'fastest', detail: '9 min · 5.4 mi', count: { state: 'known', cams: 1 } });
  });

  it('still offers one row when only one plan came back', () => {
    expect(routeOptionsFrom(PLAIN, null, CAMERAS).map((row) => row.kind)).toEqual(['fastest']);
    expect(routeOptionsFrom(null, DARK, CAMERAS).map((row) => row.kind)).toEqual(['fewest-cameras']);
  });

  it('is never empty: a failed preview and a fix-less one each draw a startable row', () => {
    expect(routeOptionsFrom(null, null, CAMERAS)).toEqual([
      { kind: 'fewest-cameras', detail: PREVIEW_FAILED, count: COUNT_UNKNOWN },
    ]);
    expect(previewWithoutFix()).toEqual([
      { kind: 'fewest-cameras', detail: PREVIEW_NO_FIX, count: COUNT_UNKNOWN },
    ]);
  });
});
