#!/usr/bin/env node
/**
 * WHERE EACH CAMERA STANDS, IN WORDS -- computed once, at build time, offline.
 *
 * =============================================================================
 * THE PROBLEM
 * =============================================================================
 * Not one of the 139,613 ALPR nodes in the reviewed capture carries a street.
 * OSM's surveillance nodes have `direction`, `manufacturer`, sometimes an
 * `operator`; never `addr:street`, never a name. So every Lookup row read
 * "unnamed pole" over a raw id, and every Exposure pass -- which is labelled
 * from the same record -- read as a dash. "I want nothing to be empty" -- the
 * owner, 2026-09-09.
 *
 * The earlier answer, `fetch-street-names.mjs`, snapped every camera to TIGER
 * All Roads and was deleted when the app began drawing the basemap. This is
 * the same idea against a better source: the basemap itself.
 *
 * =============================================================================
 * THE SOURCE IS OUR OWN BASEMAP, PINNED
 * =============================================================================
 * `tiles.darkroute.ai/basemap-us-20260901-full-us.pmtiles` is the archive the
 * app draws roads from. Its `roads` layer carries a `name` on every named way
 * at z14, so the street a camera stands on is the nearest named road in the
 * tile that contains it -- the same road the driver sees under the marker.
 * Nothing leaves this machine to compute it: the archive is read as a local
 * file, and its identity (bytes, sha256, the etag the host serves) is written
 * into the output so a reviewer can pin what the names came from.
 *
 * Census PLACE polygons supply the locality, exactly as `places.mjs` reads
 * them for the (disabled) places sidecar; the county name comes from the
 * archive's own `counties.json` when a camera is in no place at all.
 *
 * =============================================================================
 * WHAT IS WRITTEN, AND WHAT IS NOT
 * =============================================================================
 * One record per camera id: the street, the cross street when a differently
 * named road is close enough to call an intersection, the distance to the
 * street in metres, and the locality. Distances are kept because a camera 300
 * metres from the nearest named road is not ON that road, and the row should
 * be able to say "off" rather than "at".
 *
 * Names are abbreviated the way a street sign is ("West 95th Street" ->
 * "W 95th St") so a row on a phone fits. The abbreviation table is small and
 * deliberate; anything it does not know is left as the basemap spells it.
 *
 * No geometry ships. The output is a string table and one short row per
 * camera, a few megabytes for the whole country, and it is a release input
 * bound by hash in the review receipt like the county geofence is.
 */

import { createHash } from 'node:crypto';
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { buildIndex as buildPlaceIndex } from './places.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTEXT_SCHEMA = 'darkroute-camera-context/v1';
export const DEFAULT_CONTEXT_PATH = resolve(ROOT, 'scripts/data/camera-context.json');

/** The zoom the basemap carries every named road at. */
const ZOOM = 14;
const EARTH_RADIUS_M = 6_378_137;
/**
 * A camera further than this from any named road has no street to stand on.
 * The old TIGER pipeline refused past 40 m; this keeps the nearest road up to
 * a rural distance and records how far, so the row can say "off".
 */
export const MAX_STREET_M = 2_000;
/** A differently named road within this is an intersection, not a neighbour. */
export const MAX_CROSS_M = 120;
/** Roads the basemap names but nobody drives on. */
const NOT_A_STREET = new Set(['path', 'ferry', 'rail', 'aerialway', 'pier']);
/** Decoded tiles held at once; cameras are visited in tile order so this is enough. */
const TILE_CACHE = 512;

const SUFFIXES = new Map([
  ['Street', 'St'],
  ['Avenue', 'Ave'],
  ['Boulevard', 'Blvd'],
  ['Drive', 'Dr'],
  ['Road', 'Rd'],
  ['Lane', 'Ln'],
  ['Court', 'Ct'],
  ['Place', 'Pl'],
  ['Terrace', 'Ter'],
  ['Circle', 'Cir'],
  ['Parkway', 'Pkwy'],
  ['Highway', 'Hwy'],
  ['Freeway', 'Fwy'],
  ['Expressway', 'Expy'],
  ['Turnpike', 'Tpke'],
  ['Trail', 'Trl'],
  ['Square', 'Sq'],
  ['Crossing', 'Xing'],
  ['Extension', 'Ext'],
  ['Mount', 'Mt'],
  ['Saint', 'St'],
  ['Fort', 'Ft'],
]);
const DIRECTIONS = new Map([
  ['North', 'N'],
  ['South', 'S'],
  ['East', 'E'],
  ['West', 'W'],
  ['Northeast', 'NE'],
  ['Northwest', 'NW'],
  ['Southeast', 'SE'],
  ['Southwest', 'SW'],
]);

/** "West 95th Street" -> "W 95th St". Exported for the test. */
export function abbreviate(name) {
  const words = name.trim().split(/\s+/u);
  return words
    .map((word, index) => {
      if (index === 0 && DIRECTIONS.has(word) && words.length > 1) return DIRECTIONS.get(word);
      if (index === words.length - 1 && DIRECTIONS.has(word) && words.length > 1) {
        return DIRECTIONS.get(word);
      }
      if (index === words.length - 1 && SUFFIXES.has(word)) return SUFFIXES.get(word);
      if (index === words.length - 2 && SUFFIXES.has(word) && DIRECTIONS.has(words[index + 1])) {
        return SUFFIXES.get(word);
      }
      return word;
    })
    .join(' ');
}

function tileCoordinates(lat, lon) {
  const n = 2 ** ZOOM;
  const x = ((lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return { x, y };
}

function segmentDistance(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + t * dx - px, a.y + t * dy - py);
}

/** A PMTiles source over a local file: the archive is 4.5 GB and read by range. */
class FileSource {
  constructor(path) {
    this.path = path;
  }
  getKey() {
    return this.path;
  }
  async getBytes(offset, length) {
    const handle = await open(this.path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) };
    } finally {
      await handle.close();
    }
  }
}

/**
 * The named roads of one z14 tile, as polylines in tile-space units where one
 * unit is one tile. Cached with the tile key so a neighbour is decoded once.
 */
export class RoadReader {
  constructor(archive) {
    this.archive = archive;
    this.cache = new Map();
    this.decoded = 0;
  }
  async roads(tx, ty) {
    const key = `${String(tx)}/${String(ty)}`;
    const held = this.cache.get(key);
    if (held !== undefined) return held;
    const tile = await this.archive.getZxy(ZOOM, tx, ty);
    const out = [];
    if (tile !== undefined) {
      const layer = new VectorTile(new PbfReader(new Uint8Array(tile.data))).layers['roads'];
      for (let i = 0; layer !== undefined && i < layer.length; i += 1) {
        const feature = layer.feature(i);
        const name = feature.properties['name'];
        const kind = feature.properties['kind'];
        if (typeof name !== 'string' || name.trim() === '') continue;
        if (typeof kind === 'string' && NOT_A_STREET.has(kind)) continue;
        out.push({
          name: name.trim(),
          lines: feature
            .loadGeometry()
            .map((ring) => ring.map((pt) => ({ x: tx + pt.x / layer.extent, y: ty + pt.y / layer.extent }))),
        });
      }
    }
    this.decoded += 1;
    if (this.cache.size >= TILE_CACHE) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, out);
    return out;
  }
  /**
   * Nearest named road and nearest differently named road to a point, with
   * distances in metres. Neighbouring tiles are read when the point is within
   * a tenth of a tile of an edge, which at z14 is about 240 m.
   */
  async nearest(lat, lon) {
    const { x, y } = tileCoordinates(lat, lon);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const metresPerTile = (2 * Math.PI * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180)) / 2 ** ZOOM;
    const fx = x - tx;
    const fy = y - ty;
    const candidates = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === -1 && fx > 0.1) continue;
      if (dx === 1 && fx < 0.9) continue;
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dy === -1 && fy > 0.1) continue;
        if (dy === 1 && fy < 0.9) continue;
        candidates.push(...(await this.roads(tx + dx, ty + dy)));
      }
    }
    const best = new Map();
    for (const road of candidates) {
      for (const line of road.lines) {
        for (let i = 1; i < line.length; i += 1) {
          const metres = segmentDistance(x, y, line[i - 1], line[i]) * metresPerTile;
          const held = best.get(road.name);
          if (held === undefined || metres < held) best.set(road.name, metres);
        }
      }
    }
    const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
    const street = ranked[0];
    const cross = ranked[1];
    return {
      street: street === undefined || street[1] > MAX_STREET_M ? null : { name: street[0], metres: street[1] },
      cross:
        street === undefined || cross === undefined || cross[1] > MAX_CROSS_M
          ? null
          : { name: cross[0], metres: cross[1] },
    };
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  const handle = await open(path, 'r');
  try {
    const chunk = Buffer.alloc(8 * 1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

async function readCameras(target) {
  const cameras = [];
  const zoomDir = join(target, '11');
  for (const x of await readdir(zoomDir)) {
    for (const file of await readdir(join(zoomDir, x))) {
      if (!file.endsWith('.json')) continue;
      const tile = JSON.parse(await readFile(join(zoomDir, x, file), 'utf8'));
      for (const camera of tile.cameras ?? []) {
        cameras.push({
          id: camera.id,
          lat: camera.lat,
          lon: camera.lon,
          countyFips: camera.countyFips ?? null,
        });
      }
    }
  }
  return cameras;
}

/** County names, from the archive's own sidecar, keyed by FIPS. */
async function readCountyNames(target) {
  const names = new Map();
  try {
    const doc = JSON.parse(await readFile(join(target, 'counties.json'), 'utf8'));
    const rows = Array.isArray(doc.rows) ? doc.rows : Array.isArray(doc.counties) ? doc.counties : [];
    for (const row of rows) {
      const fips = row.fips ?? row.geoid ?? row.id;
      const name = row.name ?? row.label ?? row.county;
      if (typeof fips === 'string' && typeof name === 'string') names.set(fips, name);
    }
  } catch {}
  return names;
}

function parseArguments(argv) {
  const opts = {
    target: resolve(ROOT, 'apps/pwa/public/cameras'),
    basemap: null,
    basemapName: 'basemap-us-20260901-full-us.pmtiles',
    basemapEtag: null,
    places: resolve(ROOT, '.cache/census/cb_2023_us_place_500k'),
    out: DEFAULT_CONTEXT_PATH,
    limit: Infinity,
  };
  for (const arg of argv) {
    if (arg.startsWith('--target=')) opts.target = resolve(ROOT, arg.slice(9));
    else if (arg.startsWith('--basemap=')) opts.basemap = resolve(arg.slice(10));
    else if (arg.startsWith('--basemap-name=')) opts.basemapName = arg.slice(15);
    else if (arg.startsWith('--basemap-etag=')) opts.basemapEtag = arg.slice(15);
    else if (arg.startsWith('--places=')) opts.places = resolve(ROOT, arg.slice(9));
    else if (arg.startsWith('--out=')) opts.out = resolve(ROOT, arg.slice(6));
    else if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice(8));
    else throw new Error(`unknown argument ${arg}`);
  }
  if (opts.basemap === null) throw new Error('--basemap=<local pmtiles> is required');
  return opts;
}

class StringTable {
  constructor() {
    this.index = new Map();
    this.values = [];
  }
  id(value) {
    if (value === null) return -1;
    const held = this.index.get(value);
    if (held !== undefined) return held;
    const id = this.values.length;
    this.values.push(value);
    this.index.set(value, id);
    return id;
  }
}

async function main() {
  const opts = parseArguments(process.argv.slice(2));
  const log = (line) => process.stdout.write(`${line}\n`);

  log(`hashing ${opts.basemap} (this is the whole archive, once)`);
  const basemapBytes = (await stat(opts.basemap)).size;
  const basemapSha256 = await sha256File(opts.basemap);
  const archive = new PMTiles(new FileSource(opts.basemap));
  const header = await archive.getHeader();
  if (header.maxZoom < ZOOM) throw new Error(`basemap stops at z${String(header.maxZoom)}`);
  const reader = new RoadReader(archive);

  log('reading the Census place polygons');
  const placeIndex = buildPlaceIndex(`${opts.places}.shp`, `${opts.places}.dbf`);
  const placeShpSha256 = await sha256File(`${opts.places}.shp`);
  const placeDbfSha256 = await sha256File(`${opts.places}.dbf`);
  const countyNames = await readCountyNames(opts.target);

  const cameras = (await readCameras(opts.target)).slice(0, opts.limit);
  cameras.sort((a, b) => {
    const ta = tileCoordinates(a.lat, a.lon);
    const tb = tileCoordinates(b.lat, b.lon);
    return Math.floor(ta.x) - Math.floor(tb.x) || Math.floor(ta.y) - Math.floor(tb.y);
  });
  log(`${String(cameras.length)} cameras, in tile order`);

  const streets = new StringTable();
  const localities = new StringTable();
  const rows = {};
  const stats = { street: 0, at40: 0, at100: 0, at400: 0, cross: 0, place: 0, county: 0, none: 0 };
  let done = 0;
  for (const camera of cameras) {
    const near = await reader.nearest(camera.lat, camera.lon);
    const place = placeIndex.lookup(camera.lat, camera.lon);
    /* A locality is a Census place when the camera is inside one, else its
       county. Both carry the geoid the app's gazetteer keys on, so the
       archive's places.json can be written from these rows alone. */
    const locality =
      place !== null
        ? JSON.stringify({
            name: place.name,
            kind: 'place',
            geoid: place.geoid,
            lsad: String(place.lsad),
            stateFips: place.stateFips,
          })
        : camera.countyFips !== null && countyNames.has(camera.countyFips)
          ? JSON.stringify({
              name: `${countyNames.get(camera.countyFips)} County`,
              kind: 'county',
              geoid: camera.countyFips,
              lsad: 'County',
              stateFips: camera.countyFips.slice(0, 2),
            })
          : null;
    if (place !== null) stats.place += 1;
    else if (locality !== null) stats.county += 1;
    if (near.street !== null) {
      stats.street += 1;
      if (near.street.metres <= 40) stats.at40 += 1;
      if (near.street.metres <= 100) stats.at100 += 1;
      if (near.street.metres <= 400) stats.at400 += 1;
    } else {
      stats.none += 1;
    }
    if (near.cross !== null) stats.cross += 1;
    rows[camera.id] = [
      streets.id(near.street === null ? null : abbreviate(near.street.name)),
      streets.id(near.cross === null ? null : abbreviate(near.cross.name)),
      near.street === null ? -1 : Math.round(near.street.metres),
      localities.id(locality),
    ];
    done += 1;
    if (done % 5000 === 0) log(`  ${String(done)} / ${String(cameras.length)} (${String(reader.decoded)} tiles decoded)`);
  }

  const doc = {
    schema: CONTEXT_SCHEMA,
    generatedAt: new Date().toISOString(),
    basemap: {
      name: opts.basemapName,
      bytes: basemapBytes,
      sha256: basemapSha256,
      ...(opts.basemapEtag === null ? {} : { etag: opts.basemapEtag }),
      zoom: ZOOM,
    },
    places: { vintage: 'cb_2023_us_place_500k', shpSha256: placeShpSha256, dbfSha256: placeDbfSha256 },
    method: { maxStreetM: MAX_STREET_M, maxCrossM: MAX_CROSS_M },
    attribution: 'Map data © OpenStreetMap contributors; places © US Census Bureau',
    licence: 'ODbL-1.0',
    cameras: cameras.length,
    stats,
    /** Row: [streetIndex, crossIndex, streetMetres, localityIndex]; -1 is absent. */
    streets: streets.values,
    /** Objects, keyed once: `{name, kind, geoid, lsad, stateFips}`. */
    localities: localities.values.map((value) => JSON.parse(value)),
    rows,
  };
  await writeFile(opts.out, `${JSON.stringify(doc)}\n`);
  log(`wrote ${opts.out}`);
  log(JSON.stringify(stats));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
