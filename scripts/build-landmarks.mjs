/**
 * WHAT EACH CAMERA IS NEXT TO.
 *
 * =============================================================================
 * THE PROBLEM
 * =============================================================================
 * "METCALF AVE" is not a location when a corridor carries a dozen readers. A
 * driver looking at a list of nine cameras, six of which say the same street,
 * cannot tell one from another - and somebody asking "which cameras are around
 * the Home Depot" has no way to ask it at all, because the archive holds
 * streets and cross streets and nothing a person would use as a landmark.
 *
 * This builds the missing half: for each camera, the named place it is beside.
 *
 * =============================================================================
 * WHY IT IS A SEPARATE FILE AND NOT A CAMERA FIELD
 * =============================================================================
 * `DATA-CONTRACTS.md` says the camera schema's ten keys are the complete
 * approved set, and the published archive is content-addressed: adding a field
 * changes every tile, changes the manifest hash, and forces a re-approval of a
 * capture whose provenance chain is the reason the archive is trustworthy.
 *
 * A landmark is not provenance. It is a convenience derived from a different
 * OpenStreetMap query at a different time, and it should be able to change
 * without disturbing a byte of the camera archive. So it ships as its own file
 * on the `/records/` route - the same route `county-index.json` already uses
 * for exactly this class of derived data.
 *
 * That also means it can be RE-DERIVED. Street and cross street are fossils:
 * they were baked in by a pipeline that no longer runs, so a wrong one stays
 * wrong. A landmark index is a retained artefact rebuilt from source on every
 * run, so a bad match gets fixed by running this again.
 *
 * =============================================================================
 * WHAT COUNTS AS A LANDMARK
 * =============================================================================
 * Not everything with a name. "Parking", "Bench", "Fire Hydrant" and the like
 * are noise that would make the feature actively worse - a chip reading NEAR
 * PARKING tells a driver nothing and costs the space something useful could
 * have used. The allowlist below is things a person would actually use to say
 * where they are, and a name is required: an unnamed supermarket is not a
 * landmark, it is a polygon.
 *
 *   node scripts/build-landmarks.mjs --bbox=w,s,e,n   one region
 *   node scripts/build-landmarks.mjs --all            every tile with cameras
 *   node scripts/build-landmarks.mjs --dry            report, write nothing
 *   node scripts/build-landmarks.mjs --all --refresh  ignore the cached answers
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OVERPASS_ENDPOINTS, OVERPASS_USER_AGENT } from './deflock-capture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'apps/pwa/public/records/landmarks.json');

/**
 * WHERE THE OVERPASS ANSWERS ARE KEPT, and why there is a cache at all.
 *
 * This script queried 5,318 regions over about twelve hours, matched 60,423
 * cameras, and then died on the size ceiling below - throwing every one of
 * those answers away. The next run would have re-asked a FREE, VOLUNTEER-RUN
 * service for the identical data, which is the rudest possible way to fix an
 * encoding bug.
 *
 * So each region's answer is written the moment it arrives, keyed by the cell
 * it covers. A rerun re-reads instead of re-asking, which makes iterating on
 * the payload format cost nothing and makes a crash mid-crawl survivable.
 *
 * `--refresh` ignores what is held, for when the source itself should be
 * re-read rather than the format changed.
 */
const CACHE = resolve(ROOT, '.cache/landmarks');


/**
 * HOW CLOSE COUNTS AS "NEXT TO".
 *
 * 120 m is about a block face. Wider and a camera at an intersection starts
 * claiming a shop it is nowhere near, which is worse than saying nothing:
 * a driver who is told the reader is at the supermarket and finds it two
 * junctions away stops believing the other fields too.
 */
const RADIUS_M = 120;

/**
 * The ceiling this file may not cross.
 *
 * It rides the `/records/` route beside `county-index.json`, which is already
 * about a megabyte. Doubling that budget for a convenience field is not a
 * trade worth making silently, so the build FAILS rather than shipping it and
 * hoping nobody measures.
 */
const MAX_BYTES = 1_600_000;

/**
 * Things a person would use to say where they are.
 *
 * Deliberately narrow. Every entry here is something with a sign on it that a
 * driver can see from the road.
 */
const WANTED = [
  ['shop', ['supermarket', 'department_store', 'doityourself', 'hardware', 'convenience', 'car', 'furniture', 'electronics', 'wholesale', 'mall']],
  ['amenity', ['fuel', 'restaurant', 'fast_food', 'cafe', 'bank', 'pharmacy', 'hospital', 'school', 'university', 'police', 'fire_station', 'library', 'townhall', 'cinema', 'place_of_worship']],
  ['leisure', ['stadium', 'park', 'sports_centre', 'golf_course']],
  ['tourism', ['hotel', 'motel', 'museum', 'attraction']],
  ['aeroway', ['aerodrome', 'terminal']],
  ['railway', ['station']],
  ['landuse', ['retail', 'industrial']],
  ['building', ['retail', 'commercial', 'stadium']],
];

/**
 * Names that are categories rather than places.
 *
 * OpenStreetMap carries plenty of `name=Parking` and `name=Entrance`. A chip
 * reading NEAR PARKING is worse than no chip: it occupies the slot and answers
 * nothing.
 */
const USELESS = new Set(
  [
    'parking', 'parking lot', 'car park', 'entrance', 'exit', 'bench', 'toilets',
    'restroom', 'restrooms', 'atm', 'bus stop', 'shelter', 'drinking water',
    'picnic table', 'playground', 'trail', 'path', 'sidewalk', 'crossing',
    'driveway', 'service road', 'access road', 'alley', 'unnamed', 'unknown',
    'building', 'garage', 'storage', 'office', 'store', 'shop', 'gas station',
  ].map((s) => s.toLowerCase()),
);

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const refresh = args.has('--refresh');
const all = args.has('--all');
const bboxArg = [...args].find((a) => a.startsWith('--bbox='))?.slice('--bbox='.length) ?? null;

function say(message) {
  process.stdout.write(`${message}\n`);
}

function die(message) {
  process.stderr.write(`\nbuild-landmarks failed: ${message}\n`);
  process.exit(1);
}

/** Metres between two points. Equirectangular is plenty inside 120 m. */
function distanceM(aLat, aLon, bLat, bLon) {
  const R = 6371008.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = (((bLon - aLon) * Math.PI) / 180) * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon) * R;
}

/**
 * IS THIS NAME USABLE?
 *
 * Three refusals, and the third is a build-gate problem rather than a taste
 * one: `check-design-values.mjs` treats a `#` followed by three hex characters
 * as a colour literal, and that rule is scoped away from the camera directory
 * but NOT from `/records/`. A place called "#1 Cochran" would fail the design
 * gate on a data file, which is a confusing way to break a build.
 */
function usableName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 48) return null;
  if (USELESS.has(trimmed.toLowerCase())) return null;
  if (trimmed.includes('#')) return null;
  // A name that is only digits is a plot number, not a landmark.
  if (/^[\d\s.-]+$/.test(trimmed)) return null;
  return trimmed;
}

function overpassQuery(box) {
  const [west, south, east, north] = box;
  const bbox = `${south},${west},${north},${east}`;
  const clauses = WANTED.flatMap(([key, values]) =>
    values.map((value) => `nwr["${key}"="${value}"]["name"](${bbox});`),
  ).join('\n  ');
  return `[out:json][timeout:180];\n(\n  ${clauses}\n);\nout center tags;`;
}

/**
 * ASK, AND FALL BACK.
 *
 * A single Overpass instance answers 504 under load often enough that a
 * national run would lose whole regions to it - and a region lost is a silent
 * hole in coverage, not an error anybody sees later. Three endpoints, each
 * tried in turn, and the failure is only real when all three refuse.
 */
async function fetchPlaces(box) {
  let last = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return await fetchPlacesFrom(endpoint, box);
    } catch (error) {
      last = error;
    }
  }
  throw last ?? new Error('every overpass endpoint refused');
}

async function fetchPlacesFrom(endpoint, box) {
  const response = await fetch(endpoint, {
    method: 'POST',
    /*
     * Overpass answers 406 without a real User-Agent. It is a free service run
     * by volunteers and it asks callers to identify themselves; the same string
     * the camera capture uses is reused so one operator is one name in their
     * logs rather than two anonymous ones.
     */
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': OVERPASS_USER_AGENT,
      Accept: 'application/json',
    },
    body: new URLSearchParams({ data: overpassQuery(box) }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`overpass HTTP ${String(response.status)}`);
  const body = await response.json();
  const out = [];
  for (const element of body.elements ?? []) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const tags = element.tags ?? {};
    /*
     * BRAND BEFORE NAME.
     *
     * OpenStreetMap records "The Home Depot #2304" as `name` and "The Home
     * Depot" as `brand`. The brand is what somebody would say out loud, and it
     * is what makes two branches of one chain group together in a search.
     */
    const name = usableName(tags.brand) ?? usableName(tags.name);
    if (name === null) continue;
    out.push({ lat, lon, name, qid: typeof tags['brand:wikidata'] === 'string' ? tags['brand:wikidata'] : null });
  }
  return out;
}

/**
 * Every camera in the published archive, walked off disk.
 *
 * From the DIRECTORY, not from `index.json`: that file's `tiles` is a COUNT,
 * not a manifest, and treating it as a map silently yields zero cameras and a
 * landmark file full of nothing.
 */
function readCameras() {
  const base = resolve(ROOT, 'apps/pwa/public/cameras/11');
  const keys = [];
  for (const x of readdirSync(base)) {
    let inner;
    try {
      inner = readdirSync(resolve(base, x));
    } catch {
      continue;
    }
    for (const y of inner) {
      if (y.endsWith('.json')) keys.push(`11/${x}/${y}`);
    }
  }
  const cameras = [];
  for (const key of keys) {
    let tile;
    try {
      tile = JSON.parse(readFileSync(resolve(ROOT, 'apps/pwa/public/cameras', key), 'utf8'));
    } catch {
      continue;
    }
    for (const camera of tile.cameras ?? []) {
      if (typeof camera.lat === 'number' && typeof camera.lon === 'number') {
        cameras.push({ id: camera.id, lat: camera.lat, lon: camera.lon });
      }
    }
  }
  return cameras;
}

const cameras = readCameras();
if (cameras.length === 0) {
  die('no cameras on disk — the archive is served from R2, so run this where the tiles are');
}
say(`cameras on disk: ${cameras.length.toLocaleString('en-US')}`);

let selected = cameras;
if (bboxArg !== null) {
  const [w, s, e, n] = bboxArg.split(',').map(Number);
  if ([w, s, e, n].some((v) => !Number.isFinite(v))) die('--bbox needs four numbers: west,south,east,north');
  selected = cameras.filter((c) => c.lon >= w && c.lon <= e && c.lat >= s && c.lat <= n);
} else if (!all) {
  die('pass --bbox=w,s,e,n for one region or --all for every camera');
}
say(`in scope: ${selected.length.toLocaleString('en-US')}`);
if (selected.length === 0) die('no cameras in that box');

/*
 * QUERY BY REGION, NOT BY CAMERA.
 *
 * One Overpass request per camera would be 139,918 requests against a public
 * service that asks people not to do that. Bucketing into ~0.25 degree cells
 * and asking once per occupied cell is two orders of magnitude fewer requests
 * for the same answer, and it is polite to an endpoint nobody is paying for.
 */
const CELL = 0.25;
const cells = new Map();
for (const camera of selected) {
  const key = `${Math.floor(camera.lon / CELL)}/${Math.floor(camera.lat / CELL)}`;
  const bucket = cells.get(key);
  if (bucket === undefined) cells.set(key, [camera]);
  else bucket.push(camera);
}
say(`regions to query: ${cells.size}`);

const landmarks = {};
/** The distinct landmark names, as `[name]` or `[name, brandWikidataId]`. */
const names = [];
/** `name\u0000qid` -> its index in `names`. Build-time only. */
const nameIndex = new Map();
let matched = 0;
let queried = 0;
let failed = 0;

for (const [key, group] of cells) {
  const [cx, cy] = key.split('/').map(Number);
  // A margin so a camera at a cell edge can still match a place just outside.
  const margin = 0.01;
  const box = [cx * CELL - margin, cy * CELL - margin, (cx + 1) * CELL + margin, (cy + 1) * CELL + margin];

  queried += 1;
  const cached = resolve(CACHE, `${key.replace('/', '_')}.json`);
  let places;
  let fromCache = false;
  if (!refresh && existsSync(cached)) {
    try {
      places = JSON.parse(readFileSync(cached, 'utf8'));
      fromCache = true;
    } catch {
      // A truncated cache entry is worth re-asking for, not worth dying on.
      places = null;
    }
  }
  if (!places) {
    try {
      places = await fetchPlaces(box);
    } catch (error) {
      failed += 1;
      say(`  region ${String(queried)}/${String(cells.size)} FAILED: ${String(error.message ?? error)}`);
      continue;
    }
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, JSON.stringify(places));
  }

  for (const camera of group) {
    let best = null;
    let bestM = RADIUS_M;
    for (const place of places) {
      const metres = distanceM(camera.lat, camera.lon, place.lat, place.lon);
      if (metres < bestM) {
        bestM = metres;
        best = place;
      }
    }
    if (best !== null) {
      /*
       * THE NAME GOES IN A DICTIONARY, not in the record.
       *
       * "Walmart" appeared verbatim thousands of times in v1, and so did every
       * other chain, which is most of what this index IS. Storing each distinct
       * name once and an integer per camera took the payload from 2.78 MB - over
       * the ceiling, refused - to comfortably under it, with not one record
       * dropped and no radius narrowed. Losing coverage to save bytes that
       * repetition was wasting would have been the wrong trade.
       *
       * The brand id travels WITH the name because it is a property of the
       * brand, not of the camera: every "Walmart" shares one wikidata id, so
       * repeating it per record repeated the same mistake one column over.
       */
      const dictKey = `${best.name}\u0000${best.qid ?? ''}`;
      let index = nameIndex.get(dictKey);
      if (index === undefined) {
        index = names.length;
        nameIndex.set(dictKey, index);
        names.push(best.qid === null ? [best.name] : [best.name, best.qid]);
      }
      landmarks[camera.id] = [index, Math.round(bestM)];
      matched += 1;
    }
  }

  say(
    `  region ${String(queried)}/${String(cells.size)} · ${String(places.length)} places · ` +
      `${String(matched)} matched so far`,
  );

  // Overpass asks for a pause between heavy queries and it is a free service.
  // A cached region asked it nothing, so it waits for nothing.
  if (!fromCache && queried < cells.size) await new Promise((r) => { setTimeout(r, 2000); });
}

const coverage = (matched / selected.length) * 100;
const payload = {
  /*
   * v2 is the DICTIONARY encoding. v1 stored the landmark's name in every
   * record, which for an index that is mostly chains meant storing "Walmart"
   * thousands of times and blowing the size ceiling. The client reads both.
   */
  schema: 'darkroute-landmarks/v2',
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap (ODbL) via Overpass',
  attribution: 'Map data © OpenStreetMap contributors',
  licence: 'ODbL-1.0',
  radiusM: RADIUS_M,
  cameras: selected.length,
  matched,
  /** `[name]` or `[name, brandWikidataId]`. Records point in here by index. */
  names,
  /** `[nameIndex, metres]`, keyed by camera id. */
  landmarks,
};
const text = `${JSON.stringify(payload)}\n`;
const bytes = Buffer.byteLength(text);

/*
 * THE REAL NUMBERS, PRINTED.
 *
 * Not an estimate and not a gzip figure measured on a concatenation - the
 * bytes that will actually be written. A build that reports a size it did not
 * measure is how a budget gets blown quietly.
 */
say('');
say(`matched      ${matched.toLocaleString('en-US')} of ${selected.length.toLocaleString('en-US')}`);
say(`names        ${names.length.toLocaleString('en-US')} distinct`);
say(`coverage     ${coverage.toFixed(1)}%`);
say(`regions      ${String(queried)} queried, ${String(failed)} failed`);
say(`size         ${bytes.toLocaleString('en-US')} bytes (ceiling ${MAX_BYTES.toLocaleString('en-US')})`);

if (bytes > MAX_BYTES) {
  die(
    `landmarks.json is ${bytes.toLocaleString('en-US')} bytes, over the ${MAX_BYTES.toLocaleString('en-US')} ceiling.\n` +
      '  narrow the tag allowlist or the radius rather than raising this quietly.',
  );
}

if (dry) {
  say('\n--dry: nothing written');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  say(`\nwrote ${OUT}`);
}
