/**
 * THE COORDINATE ORDER, PINNED IN BOTH DIRECTIONS.
 *
 * Three orderings meet in this module and they disagree on purpose:
 *
 *   overview.json   [lat, lon, lat, lon, ...]
 *   GPX             lat="" lon=""
 *   Garmin CSV      lon,lat,name,description
 *
 * Swapping any pair does not throw. It produces a well-formed file, of the
 * right size, with every camera in the wrong hemisphere - and the driver finds
 * out by not being warned. So the test does not check that the output parses;
 * it checks that a known point lands where that point actually is.
 *
 * The same inversion is already flagged for GeoJSON in `docs/public/
 * TAXONOMY.md`, which is how it got a test here before it got a chance to ship.
 */

import { describe, expect, it } from 'vitest';

import {
  POI_NAME,
  poiFilename,
  renderPoi,
  toGarminCsv,
  toGpx,
  toPoints,
} from './poiExport.ts';

/** Kauai. Chosen because the two numbers are unmistakable if transposed: a
 *  latitude of -159 is not a latitude at all. */
const KAUAI = { lat: 22.2211, lon: -159.57868 };
const SOURCE = { coords: [KAUAI.lat, KAUAI.lon] };

describe('coordinate order', () => {
  it('reads overview.json as LAT first', () => {
    const [p] = toPoints([22.2211, -159.57868]);
    expect(p?.lat).toBeCloseTo(22.2211, 5);
    expect(p?.lon).toBeCloseTo(-159.57868, 5);
  });

  it('writes Garmin CSV as LON first, which is the opposite', () => {
    const [first = ''] = toGarminCsv(SOURCE).split('\n');
    const [a, b] = first.split(',');
    expect(Number(a)).toBeCloseTo(KAUAI.lon, 4);
    expect(Number(b)).toBeCloseTo(KAUAI.lat, 4);
  });

  it('writes GPX as LAT first', () => {
    const gpx = toGpx(SOURCE);
    expect(gpx).toContain('lat="22.221100"');
    expect(gpx).toContain('lon="-159.578680"');
  });

  it('never emits a latitude outside ±90, which is what a swap looks like', () => {
    // The cheapest possible detector for the whole class of bug: if lon ever
    // reached the latitude slot, this catches it for any real-world point.
    for (const line of toGarminCsv({ coords: [22.2211, -159.57868, 41.8819, -87.6206] }).trim().split('\n')) {
      const lat = Number(line.split(',')[1]);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
    for (const m of toGpx({ coords: [22.2211, -159.57868, 41.8819, -87.6206] }).matchAll(/lat="(-?[\d.]+)"/g)) {
      expect(Math.abs(Number(m[1]))).toBeLessThanOrEqual(90);
    }
  });
});

describe('what is refused', () => {
  it('drops a coordinate that is not one rather than clamping it', () => {
    // A clamped value is a confident wrong answer: a false alert at a real
    // place. Dropping loses one camera, which is the safer failure.
    expect(toPoints([Number.NaN, -87.6, 41.9, Number.POSITIVE_INFINITY])).toHaveLength(0);
    expect(toPoints([91, -87.6])).toHaveLength(0);
    expect(toPoints([41.9, -181])).toHaveLength(0);
  });

  it('ignores a trailing unpaired number instead of inventing a partner', () => {
    expect(toPoints([41.8819, -87.6206, 39.0997])).toHaveLength(1);
  });

  it('produces an empty file rather than throwing on an empty archive', () => {
    expect(toGarminCsv({ coords: [] }).trim()).toBe('');
    expect(toGpx({ coords: [] })).toContain('</gpx>');
  });
});

describe('what travels with the data', () => {
  it('carries the attribution in every CSV row, not just a header', () => {
    // A CSV has no header this format would keep, and a row separated from its
    // file is still an ODbL extract. So the obligation rides on the row.
    const line = toGarminCsv({ coords: [1, 2], attribution: 'Map data © OpenStreetMap contributors' });
    expect(line).toContain('Map data © OpenStreetMap contributors');
  });

  it('carries attribution and licence in the GPX metadata', () => {
    const gpx = toGpx({ coords: [1, 2] });
    expect(gpx).toContain('OpenStreetMap contributors');
    expect(gpx).toContain('ODbL-1.0');
  });

  it('names every point the same thing, because the unit reads it aloud', () => {
    // "ALPR 41.88, -87.62" spoken at speed is noise. The driver needs to know
    // WHAT, not WHERE - they can see where.
    expect(toGarminCsv(SOURCE)).toContain(POI_NAME);
    expect(toGpx(SOURCE)).toContain(`<name>${POI_NAME}</name>`);
  });
});

describe('the filename', () => {
  it('carries the archive date, so a stale file is visible in the name', () => {
    expect(poiFilename('gpx', '2026-08-26T20:00:10.314Z')).toBe('darkroute-alpr-2026-08-26.gpx');
    expect(poiFilename('csv', null)).toBe('darkroute-alpr-unknown.csv');
  });
});

describe('renderPoi', () => {
  it('routes to the right writer', () => {
    expect(renderPoi('csv', SOURCE)).toBe(toGarminCsv(SOURCE));
    expect(renderPoi('gpx', SOURCE)).toBe(toGpx(SOURCE));
  });
});
