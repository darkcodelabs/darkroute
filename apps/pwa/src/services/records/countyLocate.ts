/**
 * WHICH COUNTY A POINT IS IN, ANSWERED ON THE DEVICE.
 *
 * =============================================================================
 * THIS IS WHAT MADE "NEAR ME" WORK
 * =============================================================================
 * The MISUSE records are keyed by county FIPS, so the NEAR ME chip needs the
 * driver's county. It used to read `countyFips` off the nearest cached camera,
 * which was a sound idea and returned null every single time: the shipped
 * archive's cameras do not carry the field. Measured on the live archive, 0 of
 * 868 cameras across 60 randomly sampled z11 tiles have it, and it is absent
 * from the record shape entirely. So the chip was permanently disabled.
 *
 * NOTHING LEAVES THE DEVICE. That was the original reason for preferring the
 * camera field over a reverse geocode, and it still holds - `county-index.json`
 * is a static file, and the lookup below is arithmetic. A driver's position is
 * never sent anywhere to answer this question.
 *
 * =============================================================================
 * THE FILE, AND WHY THE READER LOOKS LIKE THIS
 * =============================================================================
 * `scripts/build-county-index.mjs` writes it: 3,221 counties, each with a FIPS,
 * a name, a quantized bounding box and delta-encoded rings on a 1e-4 degree
 * grid (about 11 m). 1.06 MB, 405 KB over the wire gzipped. See that script for
 * why the encoding is what it is.
 *
 * TWO PASSES, because 3,221 counties is a lot of ring-walking to do on a phone
 * that is also drawing a map:
 *
 *   1. The BOX. Four integer comparisons reject all but a handful. The boxes
 *      are stored rounded OUTWARD so this pass can never reject a county that
 *      genuinely contains the point.
 *   2. The RINGS, even-odd ray casting, only for survivors of pass 1.
 *
 * EVEN-ODD ACROSS ALL RINGS IS CORRECT HERE, including for the awkward
 * counties. A multi-part county (an island, a detached parcel) has each part as
 * its own ring: a point inside one part crosses that part an odd number of
 * times and the others zero, so the total stays odd. A county with a hole in it
 * has the hole as another ring: a point in the hole crosses the outer ring once
 * and the hole once, so the total is even and the point is correctly outside.
 * That is why the rings are flattened rather than kept as polygon groups.
 */

/** The file the index is served from. Reference data, not camera data. */
const INDEX_URL = '/records/county-index.json';

/** The schema this reader understands. A different tag is refused, not guessed at. */
const SCHEMA = 'darkroute.county-index.v1';

interface RawCounty {
  readonly fips?: unknown;
  readonly name?: unknown;
  readonly box?: unknown;
  readonly rings?: unknown;
}

interface County {
  readonly fips: string;
  readonly name: string;
  /** Quantized `[minX, minY, maxX, maxY]`, rounded outward. */
  readonly box: readonly [number, number, number, number];
  /**
   * Absolute quantized vertices, `[x0, y0, x1, y1, ...]` per ring.
   *
   * DECODED ONCE, AT PARSE TIME, not on every lookup. The file stores deltas
   * because they compress; walking a ray across deltas would mean re-summing
   * the whole ring for every candidate on every fix update.
   */
  readonly rings: readonly (readonly number[])[];
}

export interface CountyHit {
  readonly fips: string;
  readonly name: string;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Delta-decode one ring into absolute quantized coordinates. */
function decodeRing(deltas: readonly number[]): readonly number[] {
  const out = new Array<number>(deltas.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < deltas.length; i += 2) {
    x += deltas[i] ?? 0;
    y += deltas[i + 1] ?? 0;
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

function parseCounty(raw: RawCounty): County | null {
  const { fips, name, box, rings } = raw;
  if (typeof fips !== 'string' || fips.length !== 5) return null;
  if (!isNumberArray(box) || box.length !== 4) return null;
  if (!Array.isArray(rings) || rings.length === 0) return null;

  const decoded: (readonly number[])[] = [];
  for (const ring of rings) {
    if (!isNumberArray(ring) || ring.length < 6) continue;
    decoded.push(decodeRing(ring));
  }
  if (decoded.length === 0) return null;

  return {
    fips,
    name: typeof name === 'string' ? name : '',
    box: [box[0] ?? 0, box[1] ?? 0, box[2] ?? 0, box[3] ?? 0],
    rings: decoded,
  };
}

/**
 * Is `(x, y)` inside this county? Even-odd ray casting, eastward.
 *
 * The half-open comparison `(yi > y) !== (yj > y)` is what stops a vertex that
 * sits exactly on the ray being counted twice - the classic double-count that
 * turns an inside point into an outside one. Quantizing to a grid makes exact
 * vertex hits far more likely than they would be with floats, so this matters
 * here more than it usually would.
 */
function contains(county: County, x: number, y: number): boolean {
  let inside = false;
  for (const ring of county.rings) {
    const n = ring.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = ring[i] ?? 0;
      const yi = ring[i + 1] ?? 0;
      const xj = ring[j] ?? 0;
      const yj = ring[j + 1] ?? 0;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export interface CountyLocator {
  /** The county containing `lat`/`lon`, or null when none does. */
  readonly locate: (lat: number, lon: number) => Promise<CountyHit | null>;
  /** Already-loaded answer, or null. Never triggers a fetch. */
  readonly locateLoaded: (lat: number, lon: number) => CountyHit | null;
}

export interface CountyLocatorOptions {
  readonly fetchImpl?: typeof fetch;
  readonly url?: string;
}

export function createCountyLocator(options: CountyLocatorOptions = {}): CountyLocator {
  /*
   * RESOLVED PER CALL, NOT CAPTURED AT CONSTRUCTION.
   *
   * This module has a singleton, so binding `globalThis.fetch` here would bind
   * whatever existed at IMPORT time. That is the wrong `fetch` twice over: a
   * service worker registered after import would never see these requests, and
   * a test that installs a fetch would be talking to a locator that had already
   * captured the real one.
   */
  const doFetch = (input: string): Promise<Response> =>
    (options.fetchImpl ?? globalThis.fetch)(input);
  const url = options.url ?? INDEX_URL;

  let counties: readonly County[] | null = null;
  let scale = 0;
  let loading: Promise<void> | null = null;

  const load = (): Promise<void> => {
    if (counties !== null) return Promise.resolve();
    if (loading !== null) return loading;
    loading = (async (): Promise<void> => {
      try {
        const res = await doFetch(url);
        if (!res.ok) return;
        const body = (await res.json()) as {
          schema?: unknown;
          scale?: unknown;
          counties?: RawCounty[];
        };
        /*
         * THE SCALE COMES FROM THE FILE, and a file that does not carry a usable
         * one is refused rather than defaulted. The builder and this reader agree
         * on the grid through this number alone; guessing it would move every
         * county boundary by however far the guess was wrong.
         */
        if (body.schema !== SCHEMA) return;
        if (typeof body.scale !== 'number' || !Number.isFinite(body.scale) || body.scale <= 0) {
          return;
        }
        const parsed: County[] = [];
        for (const raw of body.counties ?? []) {
          const county = parseCounty(raw);
          if (county !== null) parsed.push(county);
        }
        if (parsed.length === 0) return;
        scale = body.scale;
        counties = parsed;
      } catch {
        // An unreadable index means NEAR ME stays disabled, which is what it
        // already did and is the honest answer. It must never mean "no records
        // near you", which is a claim about the world rather than about a file.
      } finally {
        /*
         * A FAILED LOAD MUST NOT POISON THE CACHE. Without this, the first
         * attempt while the phone is in a dead spot would leave a permanently
         * rejected promise in `loading`, and NEAR ME would stay disabled for
         * the rest of the session even once the device was back online. A
         * SUCCESSFUL load is held by `counties`, which `load` checks first, so
         * clearing this cannot cause a second fetch of a megabyte of geometry.
         */
        if (counties === null) loading = null;
      }
    })();
    return loading;
  };

  const find = (lat: number, lon: number): CountyHit | null => {
    if (counties === null || scale <= 0) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const x = lon * scale;
    const y = lat * scale;
    for (const county of counties) {
      const [minX, minY, maxX, maxY] = county.box;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (contains(county, x, y)) return { fips: county.fips, name: county.name };
    }
    return null;
  };

  return {
    locate: async (lat, lon) => {
      await load();
      return find(lat, lon);
    },
    locateLoaded: (lat, lon) => find(lat, lon),
  };
}

/** The app's one locator. */
export const countyLocator = createCountyLocator();
