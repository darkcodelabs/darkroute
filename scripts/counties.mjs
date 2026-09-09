/**
 * counties.mjs - which county a camera is in.
 *
 * The county is the unit this product already speaks: RADAR draws a county
 * strip ("HAMILTON CO · 6 ON RECORD"), RECORD is scoped by county, and B10's
 * escalation ladder fires on crossing into one. None of it could run, because
 * nothing knew which county a camera was in.
 *
 * The public default is the vendored Plotly/Census file at
 * `scripts/data/us-counties.geojson` (3,221 features carrying STATE, COUNTY,
 * NAME and LSAD); its pinned provenance, licence and checksum live beside it.
 * The sync patrol uses that exact file as its territorial admission gate.
 * `fetch-cameras.mjs` may instead receive an explicit compatible polygon path
 * for its optional county-enrichment join. This module only implements the
 * shared indexed point-in-polygon operation; callers choose the input policy.
 *
 * WHY A GRID INDEX
 *   130,684 cameras against 3,221 polygons is 421 million tests done naively,
 *   and most polygons are nowhere near most cameras. Bucketing each polygon's
 *   bounding box into a 1-degree grid turns the search into "the handful of
 *   counties that overlap this square", which is a few tests per camera.
 *
 * WHAT IT DOES NOT DO
 *   Guess. A camera that falls in no polygon gets no county - offshore nodes,
 *   coastline gaps and territories outside the file are real, and an
 *   almost-right county on a screen that names agencies is worse than none.
 */

import { readFileSync } from 'node:fs';

/**
 * FIPS state code -> USPS abbreviation.
 *
 * Census FIPS 5-2, the same standard the GEO_ID in the polygon file uses. It is
 * reference data, not a choice: the county file carries the numeric code and
 * every screen wants the two letters.
 */
export const STATE_BY_FIPS = Object.freeze({
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  10: 'DE', 11: 'DC', 12: 'FL', 13: 'GA', 15: 'HI', 16: 'ID', 17: 'IL', 18: 'IN',
  19: 'IA', 20: 'KS', 21: 'KY', 22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI',
  27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE', 32: 'NV', 33: 'NH', 34: 'NJ',
  35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH', 40: 'OK', 41: 'OR', 42: 'PA',
  44: 'RI', 45: 'SC', 46: 'SD', 47: 'TN', 48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA',
  53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY', 60: 'AS', 66: 'GU', 69: 'MP', 72: 'PR',
  78: 'VI',
});

const GRID = 1; // degrees per bucket

function bboxOf(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Every ring of a Polygon or MultiPolygon, flattened to one list. */
function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

/** Ray casting. `true` when the point is inside the ring. */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function loadCounties(path) {
  return loadCountiesBytes(readFileSync(path));
}

/** Build the index from the exact byte snapshot a caller already verified. */
export function loadCountiesBytes(bytes) {
  const raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const counties = [];
  const buckets = new Map();

  for (const feature of raw.features ?? []) {
    const p = feature.properties ?? {};
    const stateFips = String(p.STATE ?? '').padStart(2, '0');
    const fips = `${stateFips}${String(p.COUNTY ?? '').padStart(3, '0')}`;
    const rings = ringsOf(feature.geometry ?? {});
    if (rings.length === 0) continue;

    const county = {
      fips,
      name: String(p.NAME ?? ''),
      // "County", "Parish", "Borough", "Census Area" - kept because Louisiana
      // and Alaska do not have counties and a screen that says so is wrong.
      lsad: String(p.LSAD ?? 'County'),
      state: STATE_BY_FIPS[stateFips] ?? STATE_BY_FIPS[Number(stateFips)] ?? '',
      rings,
      bbox: bboxOf(rings),
    };
    const index = counties.push(county) - 1;

    for (let x = Math.floor(county.bbox.minX / GRID); x <= Math.floor(county.bbox.maxX / GRID); x += 1) {
      for (let y = Math.floor(county.bbox.minY / GRID); y <= Math.floor(county.bbox.maxY / GRID); y += 1) {
        const key = `${String(x)}/${String(y)}`;
        const list = buckets.get(key);
        if (list === undefined) buckets.set(key, [index]);
        else list.push(index);
      }
    }
  }

  return {
    counties,
    /** The county containing this point, or null. */
    lookup(lat, lon) {
      const key = `${String(Math.floor(lon / GRID))}/${String(Math.floor(lat / GRID))}`;
      for (const index of buckets.get(key) ?? []) {
        const county = counties[index];
        const b = county.bbox;
        if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
        // Odd number of containing rings = inside. Even = inside a hole, which
        // is how the Census file encodes an enclave.
        let hits = 0;
        for (const ring of county.rings) {
          if (pointInRing(lon, lat, ring)) hits += 1;
        }
        if (hits % 2 === 1) return county;
      }
      return null;
    },
  };
}

/** "JOHNSON CO, KS" - the strip's own shape, uppercase, abbreviated. */
export function countyLabel(county) {
  if (county === null) return null;
  const kind = county.lsad.toLowerCase() === 'county' ? 'CO' : county.lsad.toUpperCase();
  const state = county.state === '' ? '' : `, ${county.state}`;
  return `${county.name.toUpperCase()} ${kind}${state}`;
}
