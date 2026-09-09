#!/usr/bin/env node
/**
 * BUILD THE ON-DEVICE COUNTY INDEX.
 *
 * =============================================================================
 * WHY THIS EXISTS: "NEAR ME" WAS DEAD, AND THE FIX IT WAS WAITING FOR IS NOT COMING SOON
 * =============================================================================
 * The MISUSE screen's records are keyed by county FIPS, and its NEAR ME chip
 * needs to know which county the driver is in. It worked this out by reading
 * `countyFips` off the nearest cached camera - a good idea, because the records
 * are FIPS-keyed and the cameras were supposed to carry it.
 *
 * They do not. `fetch-cameras.mjs:490` emits `countyFips`, but the capture path
 * that actually produced the shipped archive is `fetch-cameras-deflock.mjs`,
 * which never writes it. Measured on the live archive: 0 of 868 cameras across
 * 60 randomly sampled z11 tiles carry the field, and it is not in the record
 * shape at all (`confirmations, cross, directionDeg, id, lat, lon, ownerType,
 * street, tags`). So `myFips` was permanently null and the chip was permanently
 * disabled - correctly, since it is `disabled` rather than silently returning
 * everything, but permanently.
 *
 * Enriching the cameras is the other fix, and it is gated behind the approved v3
 * capture, which needs a bucket-scoped read-only credential and a human GO.
 *
 * =============================================================================
 * WHY NOT A REVERSE GEOCODE
 * =============================================================================
 * The same reason the original comment gives: asking a network service where
 * somebody is standing is the exact thing this product exists not to do. This
 * index is a static file. The lookup runs on the device, offline, and nothing
 * about the driver's position leaves it.
 *
 * COUNTY BOUNDARIES ARE NOT CAMERA DATA, so this file lives under
 * `public/records/` beside the misuse records it serves, NOT under
 * `public/cameras/`. It is bound to the Census vintage, not to a camera
 * generation, and coupling it to the generation protocol would mean reissuing
 * county borders every time a camera moved.
 *
 * =============================================================================
 * THE ENCODING, AND WHY IT IS AFFORDABLE
 * =============================================================================
 * Source is `scripts/data/us-counties.geojson` - the same 3,221-feature Census
 * 500k county file the basemap receipt validates its coverage against, already
 * tracked in git. Shipping it verbatim is 3.1 MB, which is not a thing to hand
 * a phone on a roadside.
 *
 * Two transforms take it to 0.34 MB gzipped, measured:
 *
 *   raw GeoJSON                        3.10 MB
 *   quantized + delta-encoded          0.83 MB   (0.34 MB gzipped)
 *
 * QUANTIZED to a 1e-4 degree grid, about 11 m. That is far finer than the
 * source: the Census 500k series is itself generalized to roughly half a
 * kilometre, so the grid adds no error worth having. It is also far finer than
 * the question - which county is this - needs.
 *
 * DELTA-ENCODED along each ring, because consecutive boundary vertices are
 * close together, so the deltas are small integers where the absolutes are
 * seven-digit ones. This is what gzip then compresses well.
 *
 * A BOUNDING BOX PER COUNTY is stored alongside, so the reader can reject
 * almost every county with four comparisons before it parses a single ring.
 * See `countyLocate.ts`.
 *
 * Usage: node scripts/build-county-index.mjs [--check]
 *   --check  Rebuild in memory and fail if the committed file differs, rather
 *            than writing. This is what CI runs, so a stale index cannot ship.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SOURCE = join(ROOT, 'scripts', 'data', 'us-counties.geojson');
const OUTPUT = join(ROOT, 'apps', 'pwa', 'public', 'records', 'county-index.json');

/**
 * Coordinates per degree. 1e-4 degrees is about 11 m of latitude.
 *
 * IT IS ALSO THE READER'S CONTRACT. `countyLocate.ts` divides by this exact
 * number, so it is written into the file rather than agreed by convention - a
 * scale change here that the reader did not hear about would silently move
 * every county boundary.
 */
const SCALE = 10000;

/** The schema tag, so a reader can refuse a file it does not understand. */
const SCHEMA = 'darkroute.county-index.v1';

/** Every ring of a polygon or multipolygon, flattened. */
function ringsOf(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  throw new Error(`unsupported geometry: ${String(geometry.type)}`);
}

function build() {
  const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const features = source.features ?? [];
  if (features.length === 0) throw new Error('county source has no features');

  const counties = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    const state = String(props.STATE ?? '');
    const county = String(props.COUNTY ?? '');
    if (state.length !== 2 || county.length !== 3) {
      throw new Error(`county feature has no usable FIPS: ${JSON.stringify(props)}`);
    }
    const fips = `${state}${county}`;

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    const rings = [];
    for (const ring of ringsOf(feature.geometry)) {
      // Delta-encoded on the quantized grid, x then y, from an origin of 0.
      let prevX = 0;
      let prevY = 0;
      const encoded = [];
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
        const x = Math.round(lon * SCALE);
        const y = Math.round(lat * SCALE);
        encoded.push(x - prevX, y - prevY);
        prevX = x;
        prevY = y;
      }
      // A ring needs three distinct vertices to enclose anything. Quantization
      // can collapse a sliver below that, and a degenerate ring in the file
      // would be a ring the reader walks for nothing.
      if (encoded.length >= 6) rings.push(encoded);
    }
    if (rings.length === 0) continue;

    counties.push({
      fips,
      name: String(props.NAME ?? ''),
      // THE BOX IS QUANTIZED THE SAME WAY, and OUTWARD. Rounding a bounding box
      // to the nearest grid cell can shrink it below the geometry it bounds,
      // which would let the reader's prefilter reject a county that genuinely
      // contains the point. Floor the minima and ceil the maxima so the box is
      // never smaller than the polygon.
      box: [
        Math.floor(minLon * SCALE),
        Math.floor(minLat * SCALE),
        Math.ceil(maxLon * SCALE),
        Math.ceil(maxLat * SCALE),
      ],
      rings,
    });
  }

  counties.sort((a, b) => (a.fips < b.fips ? -1 : a.fips > b.fips ? 1 : 0));

  return {
    schema: SCHEMA,
    scale: SCALE,
    source: 'US Census Bureau cartographic boundary file, counties, 1:500k',
    attribution: 'US Census Bureau, public domain',
    counties,
  };
}

function serialize(index) {
  return `${JSON.stringify(index)}\n`;
}

const check = process.argv.includes('--check');
const body = serialize(build());
const digest = createHash('sha256').update(body).digest('hex');

if (check) {
  let current = null;
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    current = null;
  }
  if (current !== body) {
    process.stderr.write(
      'build-county-index: apps/pwa/public/records/county-index.json is stale.\n' +
        'Run `node scripts/build-county-index.mjs` and commit the result.\n',
    );
    process.exit(1);
  }
  process.stdout.write(`build-county-index: up to date (sha256 ${digest})\n`);
} else {
  writeFileSync(OUTPUT, body);
  const counties = JSON.parse(body).counties.length;
  process.stdout.write(
    `build-county-index: wrote ${String(counties)} counties, ` +
      `${String(body.length)} bytes (sha256 ${digest})\n`,
  );
}
