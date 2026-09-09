/**
 * THE COUNTY LOOKUP, CHECKED AGAINST THE REAL INDEX.
 *
 * These tests read `apps/pwa/public/records/county-index.json` off disk - the
 * exact bytes the app ships - rather than a hand-written fixture. A fixture
 * would prove the ray-casting arithmetic and nothing about whether the file it
 * runs against is correctly built, and the whole point of this module is that
 * the two agree.
 *
 * The coordinates below are real places with known counties, checked against
 * the Census FIPS they belong to.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCountyLocator } from './countyLocate.ts';

// Off `process.cwd()` rather than `import.meta.url`: the suite runs under jsdom,
// where `import.meta.url` is not a file: URL and `fileURLToPath` throws. Vitest's
// root for this package is `apps/pwa`.
const INDEX_PATH = resolve(process.cwd(), 'public/records/county-index.json');

function locatorOverRealIndex() {
  const body = readFileSync(INDEX_PATH, 'utf8');
  return createCountyLocator({
    url: '/records/county-index.json',
    fetchImpl: (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch,
  });
}

/** Real places, their coordinates, and the county FIPS they are actually in. */
const PLACES: readonly { where: string; lat: number; lon: number; fips: string; county: string }[] =
  [
    {
      where: 'downtown Cincinnati OH',
      lat: 39.1031,
      lon: -84.512,
      fips: '39061',
      county: 'Hamilton',
    },
    { where: 'downtown Houston TX', lat: 29.7604, lon: -95.3698, fips: '48201', county: 'Harris' },
    { where: 'downtown Denver CO', lat: 39.7392, lon: -104.9903, fips: '08031', county: 'Denver' },
    { where: 'Wichita KS', lat: 37.6872, lon: -97.3301, fips: '20173', county: 'Sedgwick' },
    { where: 'Honolulu HI', lat: 21.3069, lon: -157.8583, fips: '15003', county: 'Honolulu' },
    { where: 'Anchorage AK', lat: 61.2181, lon: -149.9003, fips: '02020', county: 'Anchorage' },
    { where: 'Miami FL', lat: 25.7617, lon: -80.1918, fips: '12086', county: 'Miami-Dade' },
    { where: 'Manhattan NY', lat: 40.7831, lon: -73.9712, fips: '36061', county: 'New York' },
  ];

describe('the on-device county lookup', () => {
  it('puts real places in the county they are actually in', async () => {
    const locator = locatorOverRealIndex();
    for (const place of PLACES) {
      const hit = await locator.locate(place.lat, place.lon);
      expect(hit, `${place.where} resolved to nothing`).not.toBeNull();
      expect(hit?.fips, `${place.where} resolved to the wrong county`).toBe(place.fips);
    }
  });

  it('carries the county NAME, so a chip can say where "near me" means', async () => {
    const locator = locatorOverRealIndex();
    const hit = await locator.locate(39.1031, -84.512);
    expect(hit?.name).toBe('Hamilton');
  });

  it('covers Alaska and Hawaii, which a CONUS-only index would miss', async () => {
    // Named separately from the table above because "nationwide" is a claim this
    // product makes out loud, and the last artifact that claimed it was quietly
    // clipped to a CONUS bounding box.
    const locator = locatorOverRealIndex();
    expect((await locator.locate(21.3069, -157.8583))?.fips).toBe('15003');
    expect((await locator.locate(61.2181, -149.9003))?.fips).toBe('02020');
  });

  it('returns null in the middle of the ocean rather than the nearest county', async () => {
    // The distinction that matters: NEAR ME must be able to say "I do not know
    // which county this is". A nearest-centroid fallback would answer every
    // point on Earth with a US county, which is worse than answering nothing.
    const locator = locatorOverRealIndex();
    expect(await locator.locate(30, -140)).toBeNull();
    expect(await locator.locate(0, 0)).toBeNull();
  });

  it('rejects a non-finite fix instead of walking every ring', async () => {
    const locator = locatorOverRealIndex();
    expect(await locator.locate(Number.NaN, -84.512)).toBeNull();
    expect(await locator.locate(39.1031, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('fetches the index ONCE however many lookups are made', async () => {
    const body = readFileSync(INDEX_PATH, 'utf8');
    let calls = 0;
    const locator = createCountyLocator({
      fetchImpl: (async () => {
        calls += 1;
        return new Response(body, { status: 200 });
      }) as typeof fetch,
    });
    await locator.locate(39.1031, -84.512);
    await locator.locate(29.7604, -95.3698);
    await locator.locate(21.3069, -157.8583);
    expect(calls).toBe(1);
  });

  it('leaves NEAR ME unanswerable when the index cannot be read, and does not throw', async () => {
    // An unreadable index must read as "I do not know", never as "nothing near
    // you" - the second is a claim about surveillance records that the app has
    // no basis for making.
    const locator = createCountyLocator({
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    await expect(locator.locate(39.1031, -84.512)).resolves.toBeNull();
  });

  it('RETRIES after a failed load, so a dead spot does not disable NEAR ME for the session', async () => {
    // Without this the first attempt in a tunnel would leave a settled failure
    // cached and the chip would stay disabled until the app was restarted.
    const body = readFileSync(INDEX_PATH, 'utf8');
    let attempt = 0;
    const locator = createCountyLocator({
      fetchImpl: (async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return new Response(body, { status: 200 });
      }) as typeof fetch,
    });

    expect(await locator.locate(39.1031, -84.512)).toBeNull();
    expect(await locator.locate(39.1031, -84.512)).toEqual({ fips: '39061', name: 'Hamilton' });
    expect(attempt).toBe(2);
  });

  it('does not re-fetch once loaded, even across many lookups', async () => {
    // The other half of the retry rule: clearing the in-flight promise on
    // failure must not turn a success into a repeated megabyte download.
    const body = readFileSync(INDEX_PATH, 'utf8');
    let calls = 0;
    const locator = createCountyLocator({
      fetchImpl: (async () => {
        calls += 1;
        return new Response(body, { status: 200 });
      }) as typeof fetch,
    });
    for (const place of PLACES) await locator.locate(place.lat, place.lon);
    expect(calls).toBe(1);
  });

  it('refuses an index whose schema tag it does not know', async () => {
    const locator = createCountyLocator({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ schema: 'something.else.v9', scale: 10000, counties: [] }), {
          status: 200,
        })) as typeof fetch,
    });
    expect(await locator.locate(39.1031, -84.512)).toBeNull();
  });

  it('refuses an index with no usable scale rather than guessing one', async () => {
    // Guessing the grid would not fail loudly - it would move every county
    // boundary by however far the guess was wrong and still return a FIPS.
    const raw = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Record<string, unknown>;
    const locator = createCountyLocator({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ...raw, scale: 0 }), { status: 200 })) as typeof fetch,
    });
    expect(await locator.locate(39.1031, -84.512)).toBeNull();
  });

  it('answers from memory once loaded, without a fetch', async () => {
    const locator = locatorOverRealIndex();
    expect(locator.locateLoaded(39.1031, -84.512)).toBeNull(); // nothing loaded yet
    await locator.locate(39.1031, -84.512);
    expect(locator.locateLoaded(29.7604, -95.3698)?.fips).toBe('48201');
  });
});
