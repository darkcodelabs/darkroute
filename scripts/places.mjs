/**
 * places.mjs - which city or town a camera is in.
 *
 * County came from the polygons already on disk. City did not exist anywhere:
 * OSM's ALPR nodes carry no `addr:city`, and nothing in the dump names a
 * place. This reads the Census cartographic-boundary PLACE file, which is the
 * authority for incorporated places and census-designated places in the US.
 *
 * WHY IT PARSES A SHAPEFILE BY HAND
 *   The file is distributed as a zipped shapefile and there is no GeoJSON
 *   endpoint that will serve it to a script - TIGERweb's REST service rejects
 *   automated requests outright (a WAF block, not a robots rule). Adding a
 *   shapefile dependency to a vanilla-first PWA repo is a decision for the repo
 *   owner, and .shp/.dbf are simple enough formats that reading the two
 *   record types we need is smaller than the argument would be.
 *
 * ACCESS
 *   `www2.census.gov/robots.txt` names specific crawlers and bars them; the
 *   generic `User-agent: *` block carries no Disallow. Checked before the first
 *   byte was fetched, as every other source in this repo was.
 *
 * WHAT IT REFUSES TO DO
 *   Guess. A camera outside every place polygon gets no city - rural
 *   unincorporated land is most of the country's area, and "nearest town" is a
 *   different fact from "in this town". A screen that names an agency must not
 *   round a camera into a jurisdiction it is not in.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = join(ROOT, '.cache/census');

/** Cartographic boundary, places, 1:500k. The smallest file that is still true. */
export const PLACE_URL =
  'https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_place_500k.zip';

const USER_AGENT =
  'DarkRoute/0.1 (ALPR transparency; cory@darkcode.ai) census-boundary-client';

// ---------------------------------------------------------------------------
// .dbf - fixed-width attribute records
// ---------------------------------------------------------------------------

export function readDbf(buffer) {
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);

  const fields = [];
  for (let offset = 32; buffer[offset] !== 0x0d; offset += 32) {
    fields.push({
      name: buffer.toString('ascii', offset, offset + 11).replace(/\0.*$/, ''),
      length: buffer[offset + 16],
    });
  }

  const rows = [];
  for (let i = 0; i < recordCount; i += 1) {
    let cursor = headerLength + i * recordLength + 1; // +1 skips the delete flag
    const row = {};
    for (const field of fields) {
      row[field.name] = buffer.toString('latin1', cursor, cursor + field.length).trim();
      cursor += field.length;
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// .shp - only the polygon record types this file uses
// ---------------------------------------------------------------------------

const SHAPE_NULL = 0;
const SHAPE_POLYGON = 5;

/**
 * Every ring of every shape, in file order, so a shape's index lines up with
 * its .dbf row. A null shape yields an empty ring list rather than being
 * skipped - dropping it would shift every later attribute by one.
 */
export function readShp(buffer) {
  const shapes = [];
  let offset = 100; // file header
  while (offset + 8 <= buffer.length) {
    const contentLength = buffer.readInt32BE(offset + 4) * 2;
    const start = offset + 8;
    const type = buffer.readInt32LE(start);
    offset = start + contentLength;

    if (type === SHAPE_NULL) {
      shapes.push([]);
      continue;
    }
    if (type !== SHAPE_POLYGON) {
      // The place file is all polygons. Anything else is a format surprise and
      // is better reported than silently treated as empty.
      throw new Error(`places: unexpected shape type ${String(type)} at byte ${String(start)}`);
    }

    const numParts = buffer.readInt32LE(start + 36);
    const numPoints = buffer.readInt32LE(start + 40);
    const partsAt = start + 44;
    const pointsAt = partsAt + numParts * 4;

    const parts = [];
    for (let p = 0; p < numParts; p += 1) parts.push(buffer.readInt32LE(partsAt + p * 4));

    const rings = [];
    for (let p = 0; p < numParts; p += 1) {
      const from = parts[p];
      const to = p + 1 < numParts ? parts[p + 1] : numPoints;
      const ring = [];
      for (let i = from; i < to; i += 1) {
        ring.push([
          buffer.readDoubleLE(pointsAt + i * 16),
          buffer.readDoubleLE(pointsAt + i * 16 + 8),
        ]);
      }
      rings.push(ring);
    }
    shapes.push(rings);
  }
  return shapes;
}

// ---------------------------------------------------------------------------
// Fetch + index
// ---------------------------------------------------------------------------

export async function download(url = PLACE_URL) {
  mkdirSync(CACHE, { recursive: true });
  const zip = join(CACHE, 'places.zip');
  if (!existsSync(zip)) {
    process.stdout.write(`fetching ${url}\n`);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`census place file: HTTP ${String(res.status)}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('unzip', ['-o', '-q', zip, '-d', CACHE]);
  const base = join(CACHE, 'cb_2023_us_place_500k');
  return { shp: `${base}.shp`, dbf: `${base}.dbf` };
}

/**
 * Census LSAD codes, for the ones this file actually contains.
 *
 * The distinction that matters: a CDP is a *census-designated place* - a
 * named settlement with no government of its own. A screen that names who
 * operates a camera must not imply a city hall that does not exist.
 */
export const LSAD_WORDS = Object.freeze({
  21: 'borough', 25: 'city', 43: 'town', 47: 'village', 53: 'municipality',
  55: 'comunidad', 57: 'CDP', 62: 'zona urbana',
});

export function placeLabel(place) {
  if (place === null) return null;
  const kind = LSAD_WORDS[Number(place.lsad)] ?? 'place';
  return kind === 'CDP' ? `${place.name.toUpperCase()} (CDP)` : place.name.toUpperCase();
}

const GRID = 0.25; // degrees; places are far smaller than counties

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

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function buildIndex(shpPath, dbfPath) {
  const shapes = readShp(readFileSync(shpPath));
  const rows = readDbf(readFileSync(dbfPath));
  const places = [];
  const buckets = new Map();

  for (let i = 0; i < shapes.length; i += 1) {
    const rings = shapes[i];
    if (rings.length === 0) continue;
    const row = rows[i] ?? {};
    const place = {
      geoid: row.GEOID ?? '',
      name: row.NAME ?? '',
      // LSAD distinguishes "city" from "town", "village", "CDP" - a CDP is not
      // an incorporated place and has no government, which matters on a screen
      // that names who operates a camera.
      lsad: row.LSAD ?? '',
      stateFips: row.STATEFP ?? '',
      rings,
      bbox: bboxOf(rings),
    };
    const index = places.push(place) - 1;
    for (let x = Math.floor(place.bbox.minX / GRID); x <= Math.floor(place.bbox.maxX / GRID); x += 1) {
      for (let y = Math.floor(place.bbox.minY / GRID); y <= Math.floor(place.bbox.maxY / GRID); y += 1) {
        const key = `${String(x)}/${String(y)}`;
        const list = buckets.get(key);
        if (list === undefined) buckets.set(key, [index]);
        else list.push(index);
      }
    }
  }

  return {
    places,
    lookup(lat, lon) {
      const key = `${String(Math.floor(lon / GRID))}/${String(Math.floor(lat / GRID))}`;
      for (const index of buckets.get(key) ?? []) {
        const place = places[index];
        const b = place.bbox;
        if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
        let hits = 0;
        for (const ring of place.rings) {
          if (pointInRing(lon, lat, ring)) hits += 1;
        }
        if (hits % 2 === 1) return place;
      }
      return null;
    },
  };
}

async function main() {
  const { shp, dbf } = await download();
  const index = buildIndex(shp, dbf);
  process.stdout.write(`${String(index.places.length)} places\n`);
  for (const [lat, lon, what] of [
    [38.9181, -94.6923, 'KC metro'],
    [39.0997, -84.5786, 'Cincinnati'],
    [40.7128, -74.006, 'NYC'],
    [44.9, -110.5, 'Yellowstone (rural)'],
  ]) {
    const p = index.lookup(lat, lon);
    process.stdout.write(`  ${what.padEnd(20)} -> ${p === null ? 'no place' : `${p.name} (${p.lsad})`}\n`);
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) main().then((c) => process.exit(c));
