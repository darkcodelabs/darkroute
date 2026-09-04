/**
 * fetch-cameras.mjs - the camera map, from OpenStreetMap.
 *
 * This is the thing every zero on every screen was waiting for. The app had a
 * tile cache, a tile repository, an alert engine and five screens that read
 * them, and nothing that ever put a camera in.
 *
 * WHERE THE DATA COMES FROM, AND WHY THIS SOURCE
 *   OpenStreetMap, queried through Overpass: `man_made=surveillance` plus a
 *   case-insensitive `surveillance:type=ALPR|ANPR`. Qualifying nodes can carry
 *   lat/lon, `direction`, `manufacturer`, `operator` and `surveillance:zone`.
 *
 *   DeFlock contributed the pinned adaptive query implementation; it is not a
 *   second factual source or release transport. DarkRoute retains and reviews
 *   its own first-party Overpass capture, while driver devices fetch only the
 *   resulting same-origin tiles. The records remain OSM identities under ODbL. See
 *   docs/public/AGGREGATION-POLICY.md#source-and-transport-roles.
 *
 * LICENCE - ODbL 1.0, AND IT ATTACHES TO US
 *   The moment we hold a table derived from these nodes, three obligations
 *   attach. The one that reaches the UI: **"Map data © OpenStreetMap
 *   contributors"** must appear on every surface that renders the points. Every
 *   tile this script writes carries the attribution string in its own body so
 *   it cannot be separated from the data, and `index.json` repeats it.
 *
 * WHY STATIC TILES AND NOT AN API
 *   A request to our own server keyed to where the driver is would be exactly
 *   the tracking this product exists to warn people about - the same objection
 *   that keeps SWEEP off a basemap. A static tile is fetched from a CDN, is
 *   cacheable, is identical for every driver in that square, and tells the
 *   origin nothing beyond "somebody wanted tile 11/462/771".
 *
 * ONE SUPPORTED INPUT
 *   --input=<file>  a versioned Overpass-shaped snapshot already on disk. The
 *                   reviewed release path creates it from the exact retained
 *                   first-party capture with `fetch-cameras-deflock.mjs`.
 *
 * Direct national Overpass fetching is disabled. Its Alaska-sized rectangle
 * also includes Canada and Mexico, and a rectangle is not a territorial
 * admission policy. Hourly freshness comes from ordered OSM replication.
 *
 * Run:  node scripts/fetch-cameras.mjs --input=/path/to/versioned-overpass.json
 *       Add --target=DIR to rebuild a pre-copied staging archive safely.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { countyLabel, loadCounties, loadCountiesBytes } from './counties.mjs';
import { buildIndex as buildPlaceIndex, placeLabel } from './places.mjs';
import { dirname, join, parse, relative, resolve } from 'node:path';
import { RETAINED_TAG_KEYS, containsContactValue } from './deflock-capture.mjs';
export { RETAINED_TAG_KEYS, containsContactValue } from './deflock-capture.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const DEFAULT_OUT_DIR = join(ROOT, 'apps/pwa/public/cameras');
export const DEFAULT_COUNTY_GEOFENCE = resolve(import.meta.dirname, 'data/us-counties.geojson');
export const DEFAULT_SOURCE_REVIEW = resolve(
  import.meta.dirname,
  'data/deflock-us-source-review.json',
);
export const RELEASE_GEOFENCE_IDENTITY = Object.freeze({
  path: 'scripts/data/us-counties.geojson',
  bytes: 3_216_816,
  sha256: 'e540149b7525e71ee6b6cab6dea2a95205f11e0c3e7374d27a7c9c47ea96e8c0',
  featureCount: 3_221,
});
/**
 * Immutable input ledger reviewed with the capture.  The runtime
 * `apps/pwa/public/cameras/tombstones.json` is rewritten by the baseline
 * transform and every subsequent replay, so it cannot be the trust root for
 * reproducing cleared or superseded entries.
 */
export const RELEASE_TOMBSTONE_PATH = 'scripts/data/deflock-us-baseline-tombstones.json';
export const DEFAULT_RELEASE_TOMBSTONES = resolve(ROOT, RELEASE_TOMBSTONE_PATH);

/** The tile zoom the client asks for. z11 is ~15 km across at 39°N - one tile
 *  plus its eight neighbours covers about 45 km, which is more road than a
 *  driver crosses between syncs. */
export const TILE_ZOOM = 11;

/** ODbL requires this string wherever the points are rendered. */
export const ATTRIBUTION = 'Map data © OpenStreetMap contributors';
export const LICENCE = 'ODbL-1.0';
export const LICENCE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

export function releaseGeofenceIdentity(bytes) {
  let collection;
  try {
    collection = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('release geofence is not JSON');
  }
  const identity = {
    path: RELEASE_GEOFENCE_IDENTITY.path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    featureCount: Array.isArray(collection?.features) ? collection.features.length : -1,
  };
  if (!isDeepStrictEqual(identity, RELEASE_GEOFENCE_IDENTITY)) {
    throw new Error('release geofence does not match the pinned US/DC/PR geometry');
  }
  return { ...identity };
}

export function validateReleaseTombstoneLedger(ledger, label = 'release tombstone ledger') {
  if (
    typeof ledger !== 'object' ||
    ledger === null ||
    Array.isArray(ledger) ||
    Object.keys(ledger).join(',') !==
      'attribution,licence,licenceUrl,generatedAt,upstream,tombstones' ||
    ledger.attribution !== ATTRIBUTION ||
    ledger.licence !== LICENCE ||
    ledger.licenceUrl !== LICENCE_URL ||
    canonicalSourceTimestamp(ledger.generatedAt, `${label} generatedAt`) !==
      new Date(Date.parse(ledger.generatedAt)).toISOString() ||
    canonicalSourceTimestamp(ledger.upstream, `${label} upstream`) === null ||
    !Array.isArray(ledger.tombstones)
  ) {
    throw new Error(`${label} does not have the full attributed schema`);
  }
  const ids = new Set();
  let previous = null;
  for (const tombstone of ledger.tombstones) {
    if (
      typeof tombstone !== 'object' ||
      tombstone === null ||
      Array.isArray(tombstone) ||
      Object.keys(tombstone).join(',') !== 'id,reason,seq,osmVersion' ||
      !/^osm:[1-9]\d*$/.test(tombstone.id ?? '') ||
      !['osm_delete', 'osm_untag', 'osm_out_of_scope', 'cutover_reconciliation'].includes(
        tombstone.reason,
      ) ||
      !Number.isSafeInteger(tombstone.seq) ||
      tombstone.seq < 0 ||
      !Number.isSafeInteger(tombstone.osmVersion) ||
      tombstone.osmVersion < 1 ||
      ids.has(tombstone.id) ||
      (previous !== null && previous >= tombstone.id)
    ) {
      throw new Error(`${label} has an invalid, duplicate, or unsorted tombstone`);
    }
    ids.add(tombstone.id);
    previous = tombstone.id;
  }
  return ledger;
}

export function releaseTombstoneIdentity(bytes, ledger) {
  validateReleaseTombstoneLedger(ledger);
  return {
    path: RELEASE_TOMBSTONE_PATH,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    count: ledger.tombstones.length,
  };
}

/** Parse one immutable reviewed baseline ledger and bind its exact bytes. */
export function assertReleaseTombstoneInput(bytes, expectedIdentity) {
  let ledger;
  try {
    ledger = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('retained baseline tombstone input is not JSON');
  }
  const identity = releaseTombstoneIdentity(Buffer.from(bytes), ledger);
  if (!isDeepStrictEqual(identity, expectedIdentity)) {
    throw new Error('retained baseline tombstone input does not match the approved review');
  }
  return { bytes: Buffer.from(bytes), ledger, identity };
}

/** One deterministic national overview, shared by rebuilds and delta syncs. */
export function buildCameraOverview(records) {
  const ordered = [...records].sort((a, b) => {
    const aId = String(a.id);
    const bId = String(b.id);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
  const coords = [];
  for (const camera of ordered) coords.push(camera.lat, camera.lon);
  return {
    schema: 'fwm-overview/v1',
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    count: ordered.length,
    coords,
  };
}

/**
 * A full snapshot may supersede a tombstone only with a strictly newer OSM
 * version. Unknown or equal ordering fails closed: keeping a deletion is safer
 * than resurrecting a stale record carried in an older snapshot.
 */
export function isStrictlyNewerOsmVersion(liveVersion, tombstoneVersion) {
  return (
    Number.isSafeInteger(liveVersion) &&
    liveVersion > 0 &&
    Number.isSafeInteger(tombstoneVersion) &&
    tombstoneVersion > 0 &&
    liveVersion > tombstoneVersion
  );
}

function canonicalCameraId(record) {
  const raw = String(record.id);
  return raw.startsWith('osm:') ? raw : `osm:${raw}`;
}

/**
 * Apply the deletion ledger to source records before a full rebuild.
 *
 * The result keeps the original records intact, names every blocked id for
 * diagnostics, and removes a tombstone only when the live source's version is
 * provably later. Callers can therefore update the ledger and the tiles as one
 * operation instead of publishing an id in both states.
 */
export function reconcileTombstoneFloor(records, tombstones) {
  const ledger = new Map(tombstones.map((tombstone) => [tombstone.id, tombstone]));
  const live = [];
  const blocked = [];
  const cleared = new Set();

  for (const record of records) {
    const id = canonicalCameraId(record);
    const tombstone = ledger.get(id);
    if (tombstone === undefined) {
      live.push(record);
      continue;
    }

    const liveVersion = record.version ?? record.osmVersion;
    if (isStrictlyNewerOsmVersion(liveVersion, tombstone.osmVersion)) {
      live.push(record);
      cleared.add(id);
      continue;
    }

    blocked.push({
      id,
      liveVersion: Number.isSafeInteger(liveVersion) ? liveVersion : null,
      tombstoneVersion: Number.isSafeInteger(tombstone.osmVersion) ? tombstone.osmVersion : null,
    });
  }

  return {
    live,
    blocked,
    cleared: [...cleared].sort(),
    tombstones: tombstones.filter((tombstone) => !cleared.has(tombstone.id)),
  };
}

/** Overpass mirrors, tried in order. The first is the reference instance. */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/**
 * A coarse numeric prefilter, not the dataset's territorial boundary.
 *
 * Latitude cheaply excludes most of the global stream. Longitude spans the
 * globe because Alaska's Aleutians cross the antimeridian; a single ordinary
 * west/east interval cannot retain both Adak and Attu otherwise. This box also
 * contains Canada, Mexico, and other non-US points. New replication ids require
 * the Census county geofence in `sync-cameras.mjs`; release snapshots require
 * that same strict US/PR geometry. This rectangle is never proof of territory.
 */
export const US_BBOX = { south: 17.5, west: -180, north: 72, east: 180 };

export const CAMERA_SOURCE_SCHEMA = 'darkroute-camera-source/v2';
export const CAMERA_SOURCE_REVIEW_SCHEMA = 'darkroute-deflock-source-review/v3';
export const CAMERA_SOURCE_RESPONSE_LEDGER_SCHEMA = 'deflock-overpass-response-ledger/v2';
export const CAMERA_SOURCE_GENERATOR = 'darkroute/fetch-cameras-deflock';
export const CAMERA_SOURCE_TERRITORIES = Object.freeze(['US', 'PR']);
export const CAMERA_SOURCE_LABEL =
  'OpenStreetMap (ODbL), direct retained-response capture using DeFlock-derived queries';
export const RELEASE_CAMERA_MINIMUM = 120_000;
export function assertReleaseCameraMinimum(count, minimum = RELEASE_CAMERA_MINIMUM) {
  if (!Number.isSafeInteger(count) || count < minimum) {
    throw new Error(
      `reviewed territorial camera output ${String(count)} is below the ${String(minimum)} floor`,
    );
  }
  return count;
}
const CAMERA_CAPTURE_ENDPOINTS = Object.freeze([
  'https://overpass.deflock.org/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]);
const CAMERA_CAPTURE_FILES = Object.freeze([
  'scripts/capture-deflock-source.mjs',
  'scripts/deflock-capture.mjs',
]);

/**
 * Politeness. Overpass is a donated public service and this script is not
 * entitled to it: one request at a time, a pause between chunks, and a real
 * User-Agent that says who to complain to.
 */
const PAUSE_MS = 4_000;
const USER_AGENT = 'DarkRoute/0.1 (ALPR transparency; cory@darkcode.ai) overpass-client';

// ---------------------------------------------------------------------------
// Slippy tiles
// ---------------------------------------------------------------------------

export function latLonToTile(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

// ---------------------------------------------------------------------------
// Normalising an OSM node
// ---------------------------------------------------------------------------

/**
 * `direction` is degrees clockwise from north, and a camera covering two
 * approaches writes both: `120;45`. The engine's `CameraRecord` holds ONE
 * bearing, so the first is kept and the rest are dropped rather than averaged -
 * an average of 120 and 45 is 82, which is a direction the camera does not
 * face. Filed in docs/gaps-inbox/cameras-ingest.md.
 */
export function parseDirection(raw, fallback = null) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? raw : fallback;
  if (typeof value !== 'string') return null;
  const first = value.split(';')[0]?.trim();
  if (first === undefined || first === '') return null;
  const CARDINALS = {
    N: 0,
    NNE: 22.5,
    NE: 45,
    ENE: 67.5,
    E: 90,
    ESE: 112.5,
    SE: 135,
    SSE: 157.5,
    S: 180,
    SSW: 202.5,
    SW: 225,
    WSW: 247.5,
    W: 270,
    WNW: 292.5,
    NW: 315,
    NNW: 337.5,
  };
  const cardinal = CARDINALS[first.toUpperCase()];
  if (cardinal !== undefined) return cardinal;

  /**
   * A COVERED ARC, written `from-to` clockwise from north.
   *
   * `338-23` is a 45 degree arc across north. Its bisector is 0.5, and the
   * naive midpoint (338+23)/2 = 180.5 is due SOUTH -- the reciprocal, a
   * direction the camera provably does not face. 15.39% of the arc records in
   * the archive wrap past north, so the wrap is not an edge case.
   *
   * This fell through to `Number("338-23")`, got NaN, and returned null: a dash
   * where the mapper had recorded exactly what the camera covers. 4,263 records
   * (3.2279% of the archive) are written this way.
   */
  const arc = /^(\d{1,3}(?:\.\d+)?)-(\d{1,3}(?:\.\d+)?)$/.exec(first);
  if (arc !== null) {
    const from = Number(arc[1]);
    const to = Number(arc[2]);
    if (from > 360 || to > 360) return null;
    // `0-360` is the mapper saying OMNIDIRECTIONAL. It has no facing, and a
    // bisector of 180 would be a fabricated one.
    if (from === to || (from === 0 && to === 360)) return null;
    const span = (((to - from) % 360) + 360) % 360;
    return (((from + span / 2) % 360) + 360) % 360;
  }

  const deg = Number(first);
  if (!Number.isFinite(deg)) return null;
  return ((deg % 360) + 360) % 360;
}

/**
 * Owner class, as TRIAGE groups alerts.
 *
 * OSM carries `operator` on only about 1.4% of these nodes, so almost every
 * camera is honestly `unverified`. That is the correct answer, not a
 * placeholder: guessing "police" from a manufacturer would put a made-up fact
 * behind a filter a driver uses to decide what alerts them.
 */
export function ownerTypeFor(tags) {
  const operator = (tags.operator ?? '').toLowerCase();
  if (operator === '') return 'unverified';
  if (/police|sheriff|patrol|dept|department of|city of|county|state of|dot\b/.test(operator)) {
    return 'police';
  }
  if (/hoa|homeowner|association|neighborhood|community/.test(operator)) return 'hoa';
  if (/flock safety|genetec|motorola/.test(operator)) return 'inter_agency';
  return 'private';
}

/**
 * OSM tags that are ours to interpret rather than to carry.
 *
 * `man_made` and `surveillance:type` are the QUERY -- every node here is
 * `surveillance` + `ALPR`/`ANPR` by definition, so storing them on every record says
 * nothing and costs about 4 MB. `total` is an Overpass count-response field.
 * Every other retained key comes from one fixed public release allowlist;
 * arbitrary OSM free-form/contact keys never enter tiles or replay state.
 */
const REDUNDANT_TAGS = new Set(['man_made', 'surveillance:type', 'total']);

/**
 * The selected release tag surface, minus keys the query already guarantees.
 *
 * =============================================================================
 * WHY SELECTED VALUES STAY VERBATIM
 * =============================================================================
 * This used to read exactly two tags -- `direction`, and `operator` collapsed
 * into a four-way bucket -- and throw the rest away. What went in the bin was
 * most of what a driver would actually want to know, and all of it was already
 * on the node:
 *
 *   manufacturer         Flock Safety / Motorola / Genetec. The BRAND.
 *   operator             "Dallas Police Department" -- reduced to the string
 *                        `police`, with the name discarded.
 *   camera:type          fixed / dome / panning.
 *   camera:mount         pole / mast / wall.
 *   surveillance         public / outdoor.
 *   surveillance:zone    traffic / parking.
 *   ref, start_date, height, name, operator:type, *:wikidata ...
 *
 * The same policy is used by baseline conversion and hourly replay. Values
 * resembling email addresses, phone numbers or URLs are omitted; the evidence
 * bundle keeps the raw transport hash but never the contact value.
 */
export function osmTags(node) {
  const tags = node.tags ?? {};
  const kept = {};
  for (const key of RETAINED_TAG_KEYS) {
    if (REDUNDANT_TAGS.has(key)) continue;
    const value = tags[key];
    if (typeof value !== 'string' || value === '' || containsContactValue(value)) continue;
    kept[key] = value;
  }
  return kept;
}

/** The one coordinate precision used by territory checks, tiles, and replay. */
export function normaliseCoordinate(value) {
  return Math.round(value * 1e5) / 1e5;
}

export function normalise(node, county = null, place = null) {
  const tags = node.tags ?? {};
  return {
    // `osm:` prefixed so a camera id can never be mistaken for a plate, an
    // internal id, or a report id anywhere downstream.
    id: `osm:${String(node.id)}`,
    // Five decimals is ~1.1 m. More would be false precision on a node a
    // volunteer placed from aerial imagery, and it costs bytes per tile.
    lat: normaliseCoordinate(node.lat),
    lon: normaliseCoordinate(node.lon),
    // `camera:direction` is the OSM-documented key for where a CAMERA looks;
    // bare `direction` is the generic one. Reading only the generic key left a
    // resolvable facing unread on 1,816 records (1.375%).
    directionDeg: parseDirection(tags.direction, tags['camera:direction'] ?? null),
    ownerType: ownerTypeFor(tags),
    // One OSM node is one contributor's placement. Anything more is our own
    // confirmations, which do not exist yet.
    confirmations: 1,
    // The county FIPS, not its name: five characters against ~20, on every one
    // of 130k records. `counties.json` carries the names once.
    ...(county === null ? {} : { countyFips: county.fips }),
    // The place GEOID, same reasoning as the county FIPS: seven characters
    // against a name, on every one of 130k records.
    ...(place === null ? {} : { placeGeoid: place.geoid }),
    /**
     * THE NODE'S OWN VERSION AND EDIT TIME.
     *
     * These are what make "stay in sync with OSM" a thing that can actually be
     * done rather than a thing that gets re-downloaded wholesale. A replication
     * diff names a node id and a version; comparing it against what we hold is
     * how a refresh knows whether a record moved, changed hands, or was
     * retagged -- and the timestamp is what the INTEL CARD can honestly print
     * as "last edited", instead of a confirmation count of 1 that means
     * nothing.
     *
     * Deletion is deliberately NOT inferable from either: an absent node is not
     * a deleted node, only a node that was not in this answer. See
     * `docs/public/AGGREGATION-POLICY.md#removals-and-tombstones`.
     */
    ...(typeof node.version === 'number' ? { osmVersion: node.version } : {}),
    ...(typeof node.timestamp === 'string' ? { updatedAt: Date.parse(node.timestamp) } : {}),
    // The fixed mapper-written release allowlist. See `osmTags`; arbitrary and
    // contact-like upstream values are deliberately absent.
    tags: osmTags(node),
  };
}

// ---------------------------------------------------------------------------
// Overpass
// ---------------------------------------------------------------------------

function query(bbox) {
  // `out meta` rather than `out body`: it adds the node's VERSION and
  // TIMESTAMP, which are the only things that let a later run tell what
  // actually changed upstream. Without them a refresh is all-or-nothing and
  // there is no way to reconcile against replication diffs, which is the
  // supported path for staying in sync -- see `refuseIfScheduled`.
  return `[out:json][timeout:180];
node["man_made"="surveillance"]["surveillance:type"="ALPR"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out meta;`;
}

const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

/**
 * THE OVERPASS PATH MAY NOT BE SCHEDULED. THIS REFUSES TO LET IT BE.
 *
 * `docs/public/AGGREGATION-POLICY.md#freshness-and-publication` separates a
 * manual bootstrap from the supported scheduled delta path.
 *
 * A one-off refresh by a human is fine and is what this path is for. A cron job
 * is the thing that gets a project blocked, and it is exactly what somebody
 * reaches for six months from now when the map goes stale. So the script says
 * no rather than relying on a comment nobody reads.
 *
 * The automated path is OSM replication diffs from the OSMF S3 mirror. See the
 * same policy, and note its central warning: an ABSENT node is not a DELETED
 * node, so deletion has to be driven by ID-set membership and tombstones,
 * never by absence from a fetch.
 */
function refuseIfScheduled() {
  const env = globalThis.process?.env ?? {};
  const scheduled =
    env.GITHUB_EVENT_NAME === 'schedule' || env.CI === 'true' || env.FWM_SCHEDULED === '1';
  if (!scheduled) return;
  process.stderr.write(
    'fetch-cameras: refusing to query Overpass from a scheduled/CI run.\n' +
      '  The Overpass usage policy prohibits exactly this. See\n' +
      '  docs/public/AGGREGATION-POLICY.md#freshness-and-publication - the\n' +
      '  supported automated path is\n' +
      '  OSM replication diffs from the OSMF S3 mirror.\n' +
      '  Use --input=<dump.json> here, or run it by hand.\n',
  );
  process.exit(3);
}

async function fetchChunk(bbox, attempt = 0) {
  const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
  const body = new URLSearchParams({ data: query(bbox) });
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      body,
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    const json = await res.json();

    /**
     * AN EMPTY ANSWER IS NOT AN EMPTY REGION.
     *
     * Overpass reports a timeout or an out-of-memory as HTTP **200** with an
     * empty `elements` array and a `remark` explaining itself. Read naively
     * that is indistinguishable from "there are no ALPRs in this square", and
     * the difference is the whole dataset.
     *
     * It has already happened once, and the shape of the failure is why this
     * check exists rather than a comment: a full-US sweep came back with 24 of
     * its 40 chunks empty, wrote 60,276 cameras over a 130,684-camera tile set,
     * and EXITED ZERO. A 54 % data loss that reports success is the worst thing
     * a fetch can do, because nothing downstream has any reason to look.
     *
     * Throwing puts it back into the retry-and-back-off path, and if it still
     * cannot be read after five tries the run fails loudly instead of quietly
     * publishing a hole. Same rule the deletion path already follows: absence
     * of an answer is never evidence of absence.
     */
    const remark = typeof json.remark === 'string' ? json.remark : '';
    if (remark !== '') throw new Error(`overpass remark: ${remark.slice(0, 120)}`);

    return json.elements ?? [];
  } catch (cause) {
    if (attempt >= 5)
      throw new Error(`overpass failed after ${String(attempt + 1)} tries: ${cause.message}`);
    // Overpass answers "too busy" with a 429 or a 504 and expects a back-off,
    // not a retry storm. Doubling, and a different mirror each time.
    const wait = PAUSE_MS * 2 ** attempt;
    process.stdout.write(
      `    retry ${String(attempt + 1)} in ${String(Math.round(wait / 1000))}s (${cause.message})\n`,
    );
    await sleep(wait);
    return fetchChunk(bbox, attempt + 1);
  }
}

/** Split a bbox into a grid small enough that one query does not time out. */
export function chunks(bbox, rows, cols) {
  const out = [];
  const dLat = (bbox.north - bbox.south) / rows;
  const dLon = (bbox.east - bbox.west) / cols;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({
        south: bbox.south + r * dLat,
        north: bbox.south + (r + 1) * dLat,
        west: bbox.west + c * dLon,
        east: bbox.west + (c + 1) * dLon,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function resolveCameraTarget(value = DEFAULT_OUT_DIR) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('--target requires a non-empty path');
  }
  const target = resolve(ROOT, value);
  const filesystemRoot = parse(target).root;
  const repoRelative = relative(target, ROOT);
  if (
    target === filesystemRoot ||
    target === ROOT ||
    (repoRelative !== '' && !repoRelative.startsWith('..') && !repoRelative.includes(':'))
  ) {
    throw new Error(`refusing unsafe camera target ${target}`);
  }
  let component = target;
  while (component !== parse(component).root) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`refusing symlink component in camera target ${target}`);
    }
    component = dirname(component);
  }
  return target;
}

/** Only replace a camera archive (or a new/empty staging directory). */
export function assertSafeCameraTarget(target) {
  resolveCameraTarget(target);
  if (!existsSync(target)) return;
  const info = lstatSync(target);
  if (!info.isDirectory()) throw new Error(`camera target is not a directory: ${target}`);
  const names = readdirSync(target);
  if (names.length === 0) return;
  const allowed = new Set([
    '11',
    'index.json',
    'overview.json',
    'tombstones.json',
    'counties.json',
    'places.json',
    'continuity.json',
  ]);
  const unexpected = names.filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    throw new Error(`camera target has unexpected top-level entry ${unexpected.sort()[0]}`);
  }

  const rejectUnsafeDescendants = (directory) => {
    for (const child of readdirSync(directory)) {
      const path = join(directory, child);
      const childInfo = lstatSync(path);
      if (childInfo.isSymbolicLink()) {
        throw new Error(`camera target contains symlink: ${path}`);
      }
      if (childInfo.isDirectory()) rejectUnsafeDescendants(path);
      else if (!childInfo.isFile()) {
        throw new Error(`camera target contains non-file entry: ${path}`);
      }
    }
  };
  rejectUnsafeDescendants(target);

  const readObject = (name) => {
    const path = join(target, name);
    const fileInfo = lstatSync(path);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new Error(`camera target has an unsafe ${name}`);
    }
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`camera target has an invalid ${name}`);
    }
    return value;
  };
  const validateTombstones = () => {
    const ledger = readObject('tombstones.json');
    if (!Array.isArray(ledger.tombstones)) {
      throw new Error('camera target has an invalid tombstones.json');
    }
  };

  // A fresh release staging directory deliberately starts with only the
  // reviewed deletion ledger. Everything else must be a coherent archive,
  // never a directory that merely happens to contain one sentinel filename.
  if (names.length === 1 && names[0] === 'tombstones.json') {
    validateTombstones();
    return;
  }
  if (!['11', 'index.json', 'tombstones.json'].every((name) => names.includes(name))) {
    throw new Error(`refusing to replace non-camera directory ${target}`);
  }
  const tiles = lstatSync(join(target, '11'));
  if (!tiles.isDirectory() || tiles.isSymbolicLink()) {
    throw new Error('camera target has an unsafe z11 tile directory');
  }
  const index = readObject('index.json');
  if (
    index.zoom !== TILE_ZOOM ||
    !Number.isSafeInteger(index.cameras) ||
    index.cameras < 0 ||
    !Number.isSafeInteger(index.tiles) ||
    index.tiles < 0
  ) {
    throw new Error('camera target has an incoherent index.json');
  }
  validateTombstones();
}

export function parseFetchArgs(argv) {
  const opts = {
    bbox: US_BBOX,
    zoom: TILE_ZOOM,
    dry: false,
    force: false,
    rows: 5,
    cols: 8,
    input: null,
    counties: null,
    places: null,
    source: null,
    upstream: null,
    baseUpstream: null,
    target: DEFAULT_OUT_DIR,
    topologyOverride: false,
  };
  const seen = new Set();
  const once = (name) => {
    if (seen.has(name)) throw new Error(`${name} may be supplied only once`);
    seen.add(name);
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry') {
      once('--dry');
      opts.dry = true;
    }
    // For the day a mass removal is real. It has to be typed by a person who
    // has looked at why the number dropped.
    else if (arg === '--force') {
      once('--force');
      opts.force = true;
    } else if (arg === '--target' || arg.startsWith('--target=')) {
      once('--target');
      const value = arg === '--target' ? argv[++index] : arg.slice(9);
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--target requires a non-empty path');
      }
      opts.target = resolveCameraTarget(value);
    } else if (arg.startsWith('--input=')) {
      once('--input');
      opts.input = arg.slice(8);
    } else if (arg.startsWith('--source=')) {
      once('--source');
      opts.source = arg.slice(9);
    } else if (arg.startsWith('--upstream=')) {
      once('--upstream');
      opts.upstream = arg.slice(11);
    } else if (arg.startsWith('--base-upstream=')) {
      once('--base-upstream');
      opts.baseUpstream = arg.slice(16);
    } else if (arg.startsWith('--counties=')) {
      once('--counties');
      opts.counties = arg.slice(11);
    } else if (arg.startsWith('--places=')) {
      once('--places');
      opts.places = arg.slice(9);
    } else if (arg.startsWith('--zoom=')) {
      once('--zoom');
      opts.zoom = Number(arg.slice(7));
      opts.topologyOverride = true;
    } else if (arg.startsWith('--rows=')) {
      once('--rows');
      opts.rows = Number(arg.slice(7));
      opts.topologyOverride = true;
    } else if (arg.startsWith('--cols=')) {
      once('--cols');
      opts.cols = Number(arg.slice(7));
      opts.topologyOverride = true;
    } else if (arg.startsWith('--bbox=')) {
      once('--bbox');
      const [south, west, north, east] = arg.slice(7).split(',').map(Number);
      opts.bbox = { south, west, north, east };
      opts.topologyOverride = true;
    } else {
      throw new Error(`unknown fetch-cameras argument: ${arg}`);
    }
  }
  return opts;
}

/** Read the standard Overpass snapshot watermark carried by an input dump. */
export function canonicalSourceTimestamp(value, label = 'source timestamp') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} carried an invalid timestamp`);
  }
  const candidate = value.trim();
  const timestamp = Date.parse(candidate);
  if (Number.isNaN(timestamp)) throw new Error(`${label} carried an invalid timestamp`);
  const canonical = new Date(timestamp).toISOString();
  if (candidate !== canonical && candidate !== canonical.replace('.000Z', 'Z')) {
    throw new Error(`${label} carried an invalid timestamp`);
  }
  return canonical;
}

export function inputSnapshotTimestamp(dump) {
  const value = dump?.osm3s?.timestamp_osm_base ?? dump?.upstream;
  if (value === undefined) return null;
  return canonicalSourceTimestamp(value, 'input snapshot upstream');
}

export function inputSnapshotProvenance(dump) {
  const upstream = inputSnapshotTimestamp(dump);
  const baseUpstream =
    dump?.baseUpstream === undefined
      ? upstream
      : canonicalSourceTimestamp(dump.baseUpstream, 'input baseUpstream');
  if (
    upstream !== null &&
    baseUpstream !== null &&
    Date.parse(baseUpstream) > Date.parse(upstream)
  ) {
    throw new Error('input baseUpstream is newer than its upstream watermark');
  }
  return {
    upstream,
    baseUpstream,
    source:
      typeof dump?.source === 'string' && dump.source.trim() !== '' ? dump.source.trim() : null,
  };
}

function approvedSourceWatermark(receipt) {
  const watermark = receipt?.sourceWatermark;
  const ledger = watermark?.responseLedger;
  const bundle = ledger?.responseBundle;
  const roles = ledger?.roleCounts;
  let minimum;
  try {
    minimum = canonicalSourceTimestamp(
      watermark?.minimumOsmBase,
      'input minimum source OSM watermark',
    );
  } catch {
    return null;
  }
  if (
    typeof watermark !== 'object' ||
    watermark === null ||
    Object.keys(watermark).sort().join(',') !== 'captureId,minimumOsmBase,responseLedger,status' ||
    watermark.status !== 'approved' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      watermark.captureId ?? '',
    ) ||
    watermark.minimumOsmBase !== minimum ||
    typeof ledger !== 'object' ||
    ledger === null ||
    Object.keys(ledger).sort().join(',') !==
      'bytes,endpoints,path,responseBundle,responseCount,roleCounts,schema,sha256' ||
    ledger.schema !== CAMERA_SOURCE_RESPONSE_LEDGER_SCHEMA ||
    ledger.path !== 'scripts/data/deflock-us-overpass-response-ledger.json' ||
    !Number.isSafeInteger(ledger.bytes) ||
    ledger.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(ledger.sha256 ?? '') ||
    !Number.isSafeInteger(ledger.responseCount) ||
    ledger.responseCount < 4 ||
    typeof roles !== 'object' ||
    roles === null ||
    Object.keys(roles).sort().join(',') !== 'count,data,subtraction' ||
    [roles.count, roles.data, roles.subtraction].some(
      (count) => !Number.isSafeInteger(count) || count < 0,
    ) ||
    roles.count < 1 ||
    roles.data < 1 ||
    roles.subtraction !== 2 ||
    roles.count + roles.data + roles.subtraction !== ledger.responseCount ||
    typeof bundle !== 'object' ||
    bundle === null ||
    Object.keys(bundle).sort().join(',') !== 'bytes,compression,path,responseCount,sha256' ||
    bundle.path !== 'scripts/data/deflock-us-overpass-responses.bundle.gz' ||
    bundle.compression !== 'gzip' ||
    !Number.isSafeInteger(bundle.bytes) ||
    bundle.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(bundle.sha256 ?? '') ||
    bundle.responseCount !== ledger.responseCount ||
    !Array.isArray(ledger.endpoints) ||
    ledger.endpoints.length < 1 ||
    !isDeepStrictEqual(ledger.endpoints, [...new Set(ledger.endpoints)].sort()) ||
    ledger.endpoints.some((endpoint) => !CAMERA_CAPTURE_ENDPOINTS.includes(endpoint))
  ) {
    return null;
  }
  return minimum;
}

/**
 * Validate the immutable baseline trust marker independently of today's live
 * element set. Replication may change live elements, but it may not change the
 * reviewed source receipt or its baseline transformation identity.
 */
export function assertApprovedCameraSourceMarker(
  marker,
  trustedReviewBytes = readFileSync(DEFAULT_SOURCE_REVIEW),
  { minimumBaselineOutput = RELEASE_CAMERA_MINIMUM } = {},
) {
  if (
    typeof marker !== 'object' ||
    marker === null ||
    Array.isArray(marker) ||
    Object.keys(marker).sort().join(',') !==
      'generator,review,schema,source,territories,transformation' ||
    marker.schema !== CAMERA_SOURCE_SCHEMA ||
    marker.generator !== CAMERA_SOURCE_GENERATOR ||
    !Array.isArray(marker.territories) ||
    marker.territories.length !== CAMERA_SOURCE_TERRITORIES.length ||
    marker.territories.some((territory, index) => territory !== CAMERA_SOURCE_TERRITORIES[index])
  ) {
    throw new Error('camera source marker is not the reviewed US/PR baseline');
  }

  const source = marker.source;
  const raw = source?.rawDataset;
  if (
    typeof source !== 'object' ||
    source === null ||
    Object.keys(source).sort().join(',') !== 'build,capturedAt,country,rawDataset,total' ||
    source.country !== 'us' ||
    source.build !== raw?.decodedSha256?.slice(0, 16) ||
    canonicalSourceTimestamp(source.capturedAt, 'camera source capture completion') !==
      source.capturedAt ||
    !Number.isSafeInteger(source.total) ||
    source.total < 1 ||
    typeof raw !== 'object' ||
    raw === null ||
    Object.keys(raw).sort().join(',') !==
      'bytes,compression,decodedBytes,decodedSha256,featureCount,format,path,sha256' ||
    raw.path !== 'scripts/data/deflock-us-source.geojson.gz' ||
    raw.format !== 'geojson' ||
    raw.compression !== 'gzip' ||
    !Number.isSafeInteger(raw.bytes) ||
    raw.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(raw.sha256 ?? '') ||
    !Number.isSafeInteger(raw.decodedBytes) ||
    raw.decodedBytes < 1 ||
    !/^[0-9a-f]{64}$/.test(raw.decodedSha256 ?? '') ||
    raw.featureCount !== source.total
  ) {
    throw new Error('camera source marker has no pinned direct US source identity');
  }

  let trustedReview;
  try {
    trustedReview = JSON.parse(trustedReviewBytes.toString('utf8'));
  } catch {
    throw new Error('checked-in camera source review is not valid JSON');
  }
  if (trustedReview?.sourceWatermark?.status === 'unapproved') {
    throw new Error(
      `checked-in camera source review is explicitly unapproved: ${String(
        trustedReview.sourceWatermark.reason ?? 'missing constituent OSM watermarks',
      )}`,
    );
  }
  const review = marker.review;
  const receipt = review?.receipt;
  const transformation = marker.transformation;
  const minimumOsmBase = approvedSourceWatermark(receipt);
  const implementationFiles = receipt?.captureImplementation?.files;
  const releaseInputs = receipt?.releaseInputs;
  const predecessorInput = releaseInputs?.predecessor;
  const tombstoneInput = releaseInputs?.tombstones;
  const floor = receipt?.replicationFloor;
  const floorPath = Number.isSafeInteger(floor?.sequence)
    ? String(floor.sequence).padStart(9, '0').match(/.{3}/g)?.join('/')
    : null;
  if (
    typeof review !== 'object' ||
    review === null ||
    Object.keys(review).sort().join(',') !== 'receipt,sha256' ||
    !/^[0-9a-f]{64}$/.test(review.sha256 ?? '') ||
    typeof receipt !== 'object' ||
    receipt === null ||
    Object.keys(receipt).sort().join(',') !==
      'captureImplementation,expectedSource,expectedTransformation,headSha,releaseInputs,replicationFloor,repository,schema,sourceWatermark,territories' ||
    receipt.schema !== CAMERA_SOURCE_REVIEW_SCHEMA ||
    receipt.repository !== 'flockhopper3/deflock-data' ||
    receipt.headSha !== '8d156b24db7090e870af3f007b0caece9b3c0951' ||
    !Array.isArray(receipt.territories) ||
    !isDeepStrictEqual(receipt.territories, CAMERA_SOURCE_TERRITORIES) ||
    !isDeepStrictEqual(receipt.expectedSource, source) ||
    typeof receipt.captureImplementation !== 'object' ||
    receipt.captureImplementation === null ||
    Object.keys(receipt.captureImplementation).sort().join(',') !== 'files' ||
    !Array.isArray(implementationFiles) ||
    implementationFiles.length !== CAMERA_CAPTURE_FILES.length ||
    implementationFiles.some(
      (file, index) =>
        typeof file !== 'object' ||
        file === null ||
        Object.keys(file).sort().join(',') !== 'bytes,path,sha256' ||
        file.path !== CAMERA_CAPTURE_FILES[index] ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        !/^[0-9a-f]{64}$/.test(file.sha256 ?? ''),
    ) ||
    typeof releaseInputs !== 'object' ||
    releaseInputs === null ||
    Object.keys(releaseInputs).sort().join(',') !== 'geofence,predecessor,tombstones' ||
    !isDeepStrictEqual(releaseInputs.geofence, RELEASE_GEOFENCE_IDENTITY) ||
    typeof predecessorInput !== 'object' ||
    predecessorInput === null ||
    Object.keys(predecessorInput).sort().join(',') !==
      'bytes,deployment,liveCount,liveIdsSha256,mode,path,sha256' ||
    predecessorInput.path !== 'scripts/data/camera-predecessor.json' ||
    !Number.isSafeInteger(predecessorInput.bytes) ||
    predecessorInput.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(predecessorInput.sha256 ?? '') ||
    !['generation', 'legacy-flat-root', 'empty-r2'].includes(predecessorInput.mode) ||
    !Number.isSafeInteger(predecessorInput.liveCount) ||
    predecessorInput.liveCount < 0 ||
    !/^[0-9a-f]{64}$/.test(predecessorInput.liveIdsSha256 ?? '') ||
    typeof predecessorInput.deployment !== 'object' ||
    predecessorInput.deployment === null ||
    Object.keys(predecessorInput.deployment).sort().join(',') !== 'accountId,bucket,provider' ||
    predecessorInput.deployment.provider !== 'cloudflare-r2' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(predecessorInput.deployment.accountId ?? '') ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(predecessorInput.deployment.bucket ?? '') ||
    typeof tombstoneInput !== 'object' ||
    tombstoneInput === null ||
    Object.keys(tombstoneInput).sort().join(',') !== 'bytes,count,path,sha256' ||
    tombstoneInput.path !== RELEASE_TOMBSTONE_PATH ||
    !Number.isSafeInteger(tombstoneInput.bytes) ||
    tombstoneInput.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(tombstoneInput.sha256 ?? '') ||
    !Number.isSafeInteger(tombstoneInput.count) ||
    tombstoneInput.count < 0 ||
    minimumOsmBase === null ||
    floor?.stream !== 'hour' ||
    !Number.isSafeInteger(floor?.sequence) ||
    floor.sequence < 0 ||
    floor.stateUrl !==
      `https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/${String(floorPath)}.state.txt` ||
    canonicalSourceTimestamp(floor?.timestamp, 'camera source replication floor') !==
      floor.timestamp ||
    typeof transformation !== 'object' ||
    transformation === null ||
    Object.keys(transformation).sort().join(',') !==
      'elementsSha256,excludedNonNodes,excludedTerritory,outputElements,outputTombstones,publishedLiveSha256,publishedTombstonesSha256,sourceFeatures,tombstonesBlocked,tombstonesCleared' ||
    transformation.sourceFeatures !== source.total ||
    !Number.isSafeInteger(transformation.excludedNonNodes) ||
    transformation.excludedNonNodes < 0 ||
    !Number.isSafeInteger(transformation.excludedTerritory) ||
    transformation.excludedTerritory < 0 ||
    !Number.isSafeInteger(transformation.tombstonesBlocked) ||
    transformation.tombstonesBlocked < 0 ||
    !Number.isSafeInteger(transformation.tombstonesCleared) ||
    transformation.tombstonesCleared < 0 ||
    transformation.tombstonesBlocked > tombstoneInput.count ||
    transformation.tombstonesCleared > tombstoneInput.count ||
    !Number.isSafeInteger(transformation.outputTombstones) ||
    transformation.outputTombstones !== tombstoneInput.count - transformation.tombstonesCleared ||
    !Number.isSafeInteger(transformation.outputElements) ||
    transformation.outputElements < minimumBaselineOutput ||
    transformation.outputElements !==
      transformation.sourceFeatures -
        transformation.excludedNonNodes -
        transformation.excludedTerritory -
        transformation.tombstonesBlocked ||
    !/^[0-9a-f]{64}$/.test(transformation.elementsSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(transformation.publishedLiveSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(transformation.publishedTombstonesSha256 ?? '') ||
    !isDeepStrictEqual(transformation, receipt.expectedTransformation)
  ) {
    throw new Error('camera source marker does not carry an exact approved review receipt');
  }
  const trustedReviewSha256 = createHash('sha256').update(trustedReviewBytes).digest('hex');
  if (
    review.sha256 !== trustedReviewSha256 ||
    !isDeepStrictEqual(receipt, trustedReview) ||
    Date.parse(floor.timestamp) > Date.parse(minimumOsmBase) ||
    Date.parse(minimumOsmBase) > Date.parse(source.capturedAt)
  ) {
    throw new Error('camera source marker does not match the checked-in approved review');
  }
  return marker;
}

/**
 * Require the adapter's exact US/PR hand-off contract.
 *
 * The old meridian dump and an arbitrary rectangular Overpass export have no
 * marker and fail here. The marker is not a signature; it is a stable schema
 * boundary that makes a source or territory change explicit and reviewable.
 */
export function assertReleaseCameraSource(
  dump,
  trustedReviewBytes = readFileSync(DEFAULT_SOURCE_REVIEW),
  validation = {},
) {
  const marker = dump?.cameraSource;
  if (typeof marker !== 'object' || marker === null || Array.isArray(marker)) {
    throw new Error('input is missing the required US/PR camera source marker');
  }
  assertApprovedCameraSourceMarker(marker, trustedReviewBytes, validation);
  const markerKeys = Object.keys(marker).sort();
  if (
    markerKeys.join(',') !== 'generator,review,schema,source,territories,transformation' ||
    marker.schema !== CAMERA_SOURCE_SCHEMA ||
    marker.generator !== CAMERA_SOURCE_GENERATOR ||
    dump.version !== 0.6 ||
    dump.generator !== CAMERA_SOURCE_GENERATOR ||
    dump.source !== CAMERA_SOURCE_LABEL ||
    !Array.isArray(marker.territories) ||
    marker.territories.length !== CAMERA_SOURCE_TERRITORIES.length ||
    marker.territories.some((territory, index) => territory !== CAMERA_SOURCE_TERRITORIES[index]) ||
    typeof marker.source !== 'object' ||
    marker.source === null
  ) {
    throw new Error('input camera source marker is not the reviewed US/PR adapter hand-off');
  }

  const source = marker.source;
  const raw = source.rawDataset;
  if (
    Object.keys(source).sort().join(',') !== 'build,capturedAt,country,rawDataset,total' ||
    source.country !== 'us' ||
    typeof source.build !== 'string' ||
    source.build !== raw?.decodedSha256?.slice(0, 16) ||
    !Number.isSafeInteger(source.total) ||
    source.total < 1 ||
    typeof raw !== 'object' ||
    raw === null ||
    Object.keys(raw).sort().join(',') !==
      'bytes,compression,decodedBytes,decodedSha256,featureCount,format,path,sha256' ||
    raw.path !== 'scripts/data/deflock-us-source.geojson.gz' ||
    raw.format !== 'geojson' ||
    raw.compression !== 'gzip' ||
    !Number.isSafeInteger(raw.bytes) ||
    raw.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(raw.sha256 ?? '') ||
    !Number.isSafeInteger(raw.decodedBytes) ||
    raw.decodedBytes < 1 ||
    !/^[0-9a-f]{64}$/.test(raw.decodedSha256 ?? '') ||
    raw.featureCount !== source.total
  ) {
    throw new Error('input camera source marker has no pinned direct US source identity');
  }

  const capturedAt = canonicalSourceTimestamp(source.capturedAt, 'input capture completion');
  if (source.capturedAt !== capturedAt) {
    throw new Error('input source capture timestamp is not canonical');
  }
  const review = marker.review;
  const receipt = review?.receipt;
  const transformation = marker.transformation;
  const trustedReview = JSON.parse(trustedReviewBytes.toString('utf8'));
  if (trustedReview?.sourceWatermark?.status === 'unapproved') {
    throw new Error(
      `checked-in camera source review is explicitly unapproved: ${String(
        trustedReview.sourceWatermark.reason ?? 'missing constituent OSM watermarks',
      )}`,
    );
  }
  const minimumOsmBase = approvedSourceWatermark(receipt);
  if (
    typeof review !== 'object' ||
    review === null ||
    Object.keys(review).sort().join(',') !== 'receipt,sha256' ||
    !/^[0-9a-f]{64}$/.test(review.sha256 ?? '') ||
    typeof receipt !== 'object' ||
    receipt === null ||
    receipt.schema !== CAMERA_SOURCE_REVIEW_SCHEMA ||
    receipt.repository !== 'flockhopper3/deflock-data' ||
    !/^[0-9a-f]{40}$/.test(receipt.headSha ?? '') ||
    !Array.isArray(receipt.territories) ||
    receipt.territories.length !== CAMERA_SOURCE_TERRITORIES.length ||
    receipt.territories.some(
      (territory, index) => territory !== CAMERA_SOURCE_TERRITORIES[index],
    ) ||
    !isDeepStrictEqual(receipt.expectedSource, source) ||
    minimumOsmBase === null ||
    receipt.replicationFloor?.stream !== 'hour' ||
    !Number.isSafeInteger(receipt.replicationFloor?.sequence) ||
    receipt.replicationFloor.sequence < 0 ||
    typeof transformation !== 'object' ||
    transformation === null ||
    Object.keys(transformation).sort().join(',') !==
      'elementsSha256,excludedNonNodes,excludedTerritory,outputElements,outputTombstones,publishedLiveSha256,publishedTombstonesSha256,sourceFeatures,tombstonesBlocked,tombstonesCleared' ||
    !Number.isSafeInteger(transformation.sourceFeatures) ||
    transformation.sourceFeatures !== source.total ||
    !Number.isSafeInteger(transformation.excludedNonNodes) ||
    transformation.excludedNonNodes < 0 ||
    !Number.isSafeInteger(transformation.excludedTerritory) ||
    transformation.excludedTerritory < 0 ||
    !Number.isSafeInteger(transformation.tombstonesBlocked) ||
    transformation.tombstonesBlocked < 0 ||
    !Number.isSafeInteger(transformation.tombstonesCleared) ||
    transformation.tombstonesCleared < 0 ||
    !Number.isSafeInteger(transformation.outputElements) ||
    transformation.outputElements < 0 ||
    transformation.outputElements !==
      transformation.sourceFeatures -
        transformation.excludedNonNodes -
        transformation.excludedTerritory -
        transformation.tombstonesBlocked ||
    !Number.isSafeInteger(transformation.outputTombstones) ||
    transformation.outputTombstones < 0 ||
    !/^[0-9a-f]{64}$/.test(transformation.elementsSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(transformation.publishedLiveSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(transformation.publishedTombstonesSha256 ?? '') ||
    !Array.isArray(dump.elements) ||
    dump.elements.length !== transformation.outputElements ||
    createHash('sha256').update(JSON.stringify(dump.elements)).digest('hex') !==
      transformation.elementsSha256
  ) {
    throw new Error('input camera source marker has no bound reviewed archive identity');
  }

  const trustedReviewSha256 = createHash('sha256').update(trustedReviewBytes).digest('hex');
  if (review.sha256 !== trustedReviewSha256 || !isDeepStrictEqual(receipt, trustedReview)) {
    throw new Error('input camera source marker does not match the checked-in review receipt');
  }
  if (!isDeepStrictEqual(transformation, trustedReview.expectedTransformation)) {
    throw new Error('input camera source marker does not match the reviewed transformation');
  }

  const floorTimestamp = canonicalSourceTimestamp(
    receipt.replicationFloor.timestamp,
    'input replication floor timestamp',
  );
  if (Date.parse(floorTimestamp) > Date.parse(minimumOsmBase)) {
    throw new Error('input source review has an invalid conservative replication boundary');
  }
  const provenance = inputSnapshotProvenance(dump);
  if (provenance.upstream !== minimumOsmBase || provenance.baseUpstream !== minimumOsmBase) {
    throw new Error('input provenance does not match its reviewed minimum OSM watermark');
  }
  return marker;
}

export function sourceIndexFields(opts, generatedAt) {
  const upstream = canonicalSourceTimestamp(opts.upstream ?? generatedAt, 'upstream');
  const baseUpstream = canonicalSourceTimestamp(opts.baseUpstream ?? upstream, 'baseUpstream');
  if (Date.parse(baseUpstream) > Date.parse(upstream)) {
    throw new Error('baseUpstream is newer than upstream');
  }
  const source = opts.source ?? CAMERA_SOURCE_LABEL;
  if (typeof source !== 'string' || source.trim() === '') {
    throw new Error('source must be a non-empty string');
  }
  return {
    source: source.trim(),
    baseUpstream,
    upstream,
    ...(opts.cameraSource === undefined || opts.cameraSource === null
      ? {}
      : { cameraSource: opts.cameraSource }),
  };
}

export async function main(
  argv,
  { trustedReviewBytes, minimumBaselineOutput, baselineTombstoneBytes } = {},
) {
  const opts = parseFetchArgs(argv);
  if (opts.input === null) {
    throw new Error(
      'direct Overpass fetching is disabled: US_BBOX also admits Canada and Mexico; ' +
        'use --input=<versioned snapshot> (release builds use fetch-cameras-deflock.mjs)',
    );
  }
  if (opts.source !== null || opts.upstream !== null || opts.baseUpstream !== null) {
    throw new Error(
      'release input provenance is pinned by its source marker and cannot be overridden',
    );
  }
  if (opts.topologyOverride) {
    throw new Error('release --input rejects --bbox/--zoom/--rows/--cols topology overrides');
  }
  if (opts.places !== null) {
    throw new Error('approved release input forbids unpinned place enrichment');
  }
  if (opts.counties === null) opts.counties = DEFAULT_COUNTY_GEOFENCE;
  if (resolve(ROOT, opts.counties) !== DEFAULT_COUNTY_GEOFENCE) {
    throw new Error('approved release input requires the exact pinned county geofence');
  }
  assertSafeCameraTarget(opts.target);
  const byId = new Map();

  if (opts.input !== null) {
    const path = resolve(ROOT, opts.input);
    process.stdout.write(`reading ${path}\n`);
    const dump = JSON.parse(readFileSync(path, 'utf8'));
    const sourceMarker = assertReleaseCameraSource(
      dump,
      trustedReviewBytes ?? readFileSync(DEFAULT_SOURCE_REVIEW),
      {
        minimumBaselineOutput: minimumBaselineOutput ?? RELEASE_CAMERA_MINIMUM,
      },
    );
    opts.cameraSource = sourceMarker;
    const retainedTombstones = assertReleaseTombstoneInput(
      baselineTombstoneBytes ?? readFileSync(DEFAULT_RELEASE_TOMBSTONES),
      sourceMarker.review.receipt.releaseInputs.tombstones,
    );
    const stagedTombstoneBytes = readFileSync(join(opts.target, 'tombstones.json'));
    if (!stagedTombstoneBytes.equals(retainedTombstones.bytes)) {
      throw new Error(
        'tombstone-only stage does not exactly match the retained baseline tombstone input',
      );
    }
    const releaseGeofenceBytes = readFileSync(DEFAULT_COUNTY_GEOFENCE);
    releaseGeofenceIdentity(releaseGeofenceBytes);
    const releaseTerritory = loadCountiesBytes(releaseGeofenceBytes);
    const embedded = inputSnapshotProvenance(dump);
    if (opts.upstream === null && embedded.upstream !== null) opts.upstream = embedded.upstream;
    if (opts.baseUpstream === null && embedded.baseUpstream !== null) {
      opts.baseUpstream = embedded.baseUpstream;
    }
    if (opts.source === null && embedded.source !== null) opts.source = embedded.source;
    if (!Array.isArray(dump.elements)) throw new Error('release input has no elements array');
    for (const node of dump.elements) {
      if (
        node.type !== 'node' ||
        !Number.isSafeInteger(node.id) ||
        node.id < 1 ||
        typeof node.lat !== 'number' ||
        !Number.isFinite(node.lat) ||
        typeof node.lon !== 'number' ||
        !Number.isFinite(node.lon) ||
        !Number.isSafeInteger(node.version) ||
        node.version < 1
      ) {
        throw new Error('release input contains an invalid or unversioned OSM node');
      }
      canonicalSourceTimestamp(node.timestamp, `OSM node ${String(node.id)} timestamp`);
      // Trust the adapter's filter, but verify both tags: a modified hand-off
      // must not put other surveillance devices on a driver's dial.
      const tags = node.tags ?? {};
      const surveillanceType = String(tags['surveillance:type'] ?? '').toUpperCase();
      if (
        tags.man_made !== 'surveillance' ||
        (surveillanceType !== 'ALPR' && surveillanceType !== 'ANPR')
      ) {
        throw new Error(`release input node ${String(node.id)} does not qualify as ALPR/ANPR`);
      }
      if (releaseTerritory.lookup(node.lat, node.lon) === null) {
        throw new Error(
          `release input node ${String(node.id)} is outside the reviewed US/PR territory`,
        );
      }
      if (byId.has(node.id)) throw new Error(`release input repeats OSM node ${String(node.id)}`);
      byId.set(node.id, node);
    }
    process.stdout.write(`  ${String(byId.size)} ALPR nodes\n`);
    return writeTiles(byId, opts);
  }

  refuseIfScheduled();

  const grid = chunks(opts.bbox, opts.rows, opts.cols);
  process.stdout.write(
    `fetching ALPR nodes in ${String(grid.length)} chunks, z${String(opts.zoom)} tiles\n`,
  );

  // Read ONCE, before any fetching: this is the control the chunks are judged
  // against, and it is also what `writeTiles` carries forward.
  const existing = readExistingAnnotations(opts.target);
  if (existing.size > 0) {
    process.stdout.write(
      `  ${String(existing.size)} cameras already on disk, used as the control\n`,
    );
  }

  for (const [i, box] of grid.entries()) {
    const label = `${String(i + 1)}/${String(grid.length)}`;
    const nodes = await fetchChunk(box);

    /*
     * JUDGED AGAINST THE ARCHIVE, not against Overpass's opinion of itself.
     * A 200 with an empty body and no remark is a well-formed wrong answer,
     * and the only thing that can contradict it is knowing what is there.
     */
    const held = existing.size === 0 ? 0 : countWithin(existing, box);
    const truncated = opts.force ? null : chunkLooksTruncated(nodes.length, held);
    if (truncated !== null) {
      throw new Error(
        `chunk ${label} (${box.south.toFixed(1)},${box.west.toFixed(1)} to ` +
          `${box.north.toFixed(1)},${box.east.toFixed(1)}) ${truncated}\n` +
          '  Nothing has been written -- the existing archive is untouched.\n' +
          '  Re-run, or pass --force if the removal is real and you have checked it.',
      );
    }

    for (const node of nodes) {
      if (typeof node.lat !== 'number' || typeof node.lon !== 'number') continue;
      // Chunks share edges, so the same node can arrive twice. Keyed by OSM id.
      byId.set(node.id, node);
    }
    process.stdout.write(
      `  ${label} ${box.south.toFixed(1)},${box.west.toFixed(1)} -> ${String(nodes.length).padStart(6)} nodes` +
        `${held > 0 ? ` (held ${String(held)})` : ''} (${String(byId.size)} unique)\n`,
    );
    if (i < grid.length - 1) await sleep(PAUSE_MS);
  }

  return writeTiles(byId, opts, existing);
}

/**
 * FIELDS THIS FETCHER DOES NOT OWN, AND MUST THEREFORE NOT DESTROY.
 *
 * =============================================================================
 * THE BUG THIS EXISTS TO PREVENT
 * =============================================================================
 * `street` and `cross` are on 83% and 70% of the records respectively, and this
 * script cannot produce either: they were computed by `fetch-street-names.mjs`,
 * which snapped every camera to TIGER All Roads -- and which was deleted
 * during pre-public development when the app started reading street names off
 * the basemap instead.
 *
 * So a refresh run had become quietly destructive. `writeTiles` rebuilds the
 * whole directory from `normalise()` output, `normalise()` emits no `street`,
 * and the previous tiles are `rmSync`-ed three lines later. Re-running this to
 * pick up the OSM tags -- which is exactly why somebody would run it -- would
 * have taken the street line off 108,000 camera cards to do it, with no error
 * and nothing in the diff that reads as a loss.
 *
 * Naming the fields is deliberate rather than merging whole records: this
 * script IS the authority on everything else, and a blanket merge would
 * resurrect a tag a mapper had removed or an owner that had been corrected.
 * The rule is narrow -- carry forward what OSM never told us in the first
 * place.
 */
export const CARRIED_FORWARD = ['street', 'cross'];

/**
 * =============================================================================
 * THE CIRCUIT BREAKER - the archive we already hold is the control group.
 * =============================================================================
 *
 * WHAT HAPPENED
 *   A full sweep wrote 112,098 cameras over a 131,083-camera archive and exited
 *   zero. Chunk 14 of 40 -- latitude 28.3 to 39.1, longitude -103.3 to -90.4,
 *   which is Texas, Oklahoma, Kansas, Missouri, Arkansas and Louisiana --
 *   retried twice against 429 and 502, and then received HTTP 200 with an empty
 *   `elements` array AND NO `remark`. So the one existing guard, which throws on
 *   a remark, saw a clean successful answer meaning "there are no ALPR cameras
 *   in the south-central United States", and believed it.
 *
 *   Nineteen thousand cameras, including every one in the Kansas City metro,
 *   were deleted by a run whose only symptom was a smaller number in a log
 *   nobody had a reason to read.
 *
 * WHY A REMARK CHECK CANNOT BE THE GUARD
 *   It asks Overpass whether Overpass thinks it failed. That works when the
 *   server knows; it cannot work when the server believes it answered. No
 *   amount of tightening the response check fixes a well-formed wrong answer.
 *
 * WHAT ACTUALLY DISCRIMINATES
 *   We are not fetching this blind. There is a 131,083-camera archive on disk
 *   that was built the same way, and cameras are hardware bolted to poles: the
 *   count in a given box changes by fractions of a percent between runs. A
 *   chunk that returns a small fraction of what that box already holds has not
 *   discovered a mass decommissioning -- it has failed to read.
 *
 *   So the run compares, chunk by chunk, and REFUSES TO WRITE ANYTHING if any
 *   box collapses. Not "writes a warning": a partial dataset published over a
 *   whole one is the failure, so the only safe outcome is to leave the previous
 *   archive exactly where it is and exit non-zero. The same rule the deletion
 *   path already follows -- absence of an answer is never evidence of absence.
 *
 *   `--force` exists for the day a removal is real, and it has to be typed by a
 *   person who has looked.
 */

/**
 * =============================================================================
 * COUNTING IS NOT ENOUGH. THE BLIND SPOT THE CHUNK BREAKER LEFT.
 * =============================================================================
 * The chunk and total checks below both compare NUMBERS, and a number can be
 * healthy while the records underneath it are not the same records.
 *
 * Measured against the Aug-20 Overpass dump: it holds 130,684 ALPR nodes and
 * the archive holds 131,083, which clears the 95% floor with room to spare --
 * and 443 of the archive's ids ARE NOT IN IT. Rebuilding from it would have
 * deleted all 443 and reported a healthy total while doing it.
 *
 * Those 443 are not noise. Every one of them carries `osmVersion`, and only
 * `sync-cameras.mjs` writes that field -- they are cameras the hourly patrol
 * independently discovered and confirmed AFTER the dump was taken. Nothing
 * would put them back: the patrol only reacts to diffs newer than its
 * watermark, and those additions are behind it.
 *
 * So identity is checked, not just population.
 */

/** Ids that vanish, as a share of what is held. */
export const MAX_VANISHED_RATIO = 0.01;

/**
 * How many PATROL-CONFIRMED records may vanish before the run refuses.
 *
 * A record carrying `osmVersion` was seen in a replication diff, so it existed
 * upstream at a known version. A handful genuinely being deleted between runs
 * is ordinary; hundreds is a stale or partial source.
 */
export const MAX_VANISHED_VERIFIED = 25;

/**
 * STATE IN THE TILE DIRECTORY THAT THIS SCRIPT MUST PRESERVE.
 *
 * `writeTiles` replaces its selected target recursively, and the deletion
 * ledger lives there too:
 *
 *   tombstones.json   written by `sync-cameras.mjs`; a full rebuild may remove
 *                     an entry only when a strictly newer source version proves
 *                     the camera is live again. Losing the ledger resurrects
 *                     every deletion whose diff is behind the watermark.
 *
 * It is read into memory before the directory goes and written back before the
 * new tiles. `overview.json` is not preserved: the rebuild deterministically
 * regenerates it from the final normalised camera set.
 */
export const PRESERVED_SIDECARS = ['tombstones.json'];

/** Below this, a box is too sparse for a ratio to mean anything. */
export const CHUNK_FLOOR = 50;

/** A chunk holding fewer than this share of what the archive has is a failure. */
export const CHUNK_LOSS_RATIO = 0.5;

/** And the whole run, against the whole archive. */
export const TOTAL_LOSS_RATIO = 0.95;

/** How many of the existing cameras fall inside this box. */
export function countWithin(cameras, bbox) {
  let n = 0;
  for (const c of cameras.values()) {
    if (c.lat >= bbox.south && c.lat <= bbox.north && c.lon >= bbox.west && c.lon <= bbox.east) {
      n += 1;
    }
  }
  return n;
}

/**
 * Is this chunk's answer credible against what we already hold?
 *
 * Returns null when it is, or a sentence saying why not.
 */
export function chunkLooksTruncated(got, held) {
  if (held < CHUNK_FLOOR) return null;
  if (got >= held * CHUNK_LOSS_RATIO) return null;
  return (
    `returned ${String(got)} nodes for a box the current archive has ${String(held)} in ` +
    `(under ${String(Math.round(CHUNK_LOSS_RATIO * 100))}%). Overpass can answer 200 with an ` +
    'empty body and no remark; a region does not lose its cameras between runs.'
  );
}

/** Missing source ids, excluding cameras already removed by the ledger. */
export function vanishedArchiveRecords(carried, sourceById, tombstones) {
  const tombstoned = new Set(tombstones.map((tombstone) => tombstone.id));
  const vanished = [];
  let verified = 0;
  for (const [id, held] of carried) {
    if (tombstoned.has(id)) continue;
    const raw = id.startsWith('osm:') ? id.slice(4) : id;
    const numeric = /^\d+$/.test(raw) ? Number(raw) : null;
    if (
      sourceById.has(raw) ||
      sourceById.has(id) ||
      (numeric !== null && sourceById.has(numeric))
    ) {
      continue;
    }
    vanished.push(id);
    if (held.verified === true) verified += 1;
  }
  return { vanished, verified };
}

/**
 * What the tiles already on disk hold, keyed by camera id.
 *
 * Returns an empty map when there is nothing there, which is the first-run
 * case and is not an error.
 */
export function readExistingAnnotations(dir = DEFAULT_OUT_DIR) {
  const held = new Map();
  if (!existsSync(dir)) return held;
  const stack = [dir];
  while (stack.length > 0) {
    const at = stack.pop();
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      let body;
      try {
        body = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        // A truncated tile is not worth failing a refresh over; it is about to
        // be rewritten from the source of truth anyway.
        continue;
      }
      // `index.json` also has a `cameras` key and it is a COUNT, not a list --
      // `counties.json` and `places.json` sit in the same tree. Checking the
      // shape rather than the filename means a new sidecar cannot break this.
      if (!Array.isArray(body.cameras)) continue;
      for (const camera of body.cameras) {
        // `osmVersion` is written ONLY by sync-cameras.mjs, so its presence
        // means the patrol saw this node in a replication diff.
        const kept = {
          lat: camera.lat,
          lon: camera.lon,
          verified: camera.osmVersion !== undefined,
        };
        for (const field of CARRIED_FORWARD) {
          if (typeof camera[field] === 'string' && camera[field] !== '') {
            kept[field] = camera[field];
          }
        }
        held.set(camera.id, kept);
      }
    }
  }
  return held;
}

function readTombstoneLedger(dir = DEFAULT_OUT_DIR) {
  const path = join(dir, 'tombstones.json');
  if (!existsSync(path)) return null;
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(ledger.tombstones)) {
    throw new Error('tombstones.json does not contain a tombstones array');
  }
  return ledger;
}

function writeTiles(sourceById, opts, existing = null) {
  const outDir = opts.target;
  /*
   * THE DELETION LEDGER IS A FLOOR, INCLUDING DURING A FULL REBUILD.
   *
   * Preserving tombstones.json while blindly rewriting a tombstoned id into a
   * tile publishes two contradictory states. Filter first, and clear a ledger
   * entry only when the source record carries a strictly greater OSM version.
   */
  const tombstoneLedger = readTombstoneLedger(outDir);
  const resolved = reconcileTombstoneFloor(
    [...sourceById.values()],
    tombstoneLedger?.tombstones ?? [],
  );
  const accepted = new Set(resolved.live);
  const byId = new Map([...sourceById].filter(([, record]) => accepted.has(record)));
  if (resolved.blocked.length > 0 || resolved.cleared.length > 0) {
    process.stdout.write(
      `  tombstone floor: ${String(resolved.blocked.length)} blocked, ` +
        `${String(resolved.cleared.length)} cleared by newer OSM versions\n`,
    );
  }

  // READ BEFORE THE DIRECTORY IS REMOVED. `writeTiles` replaces outDir further
  // down, so anything this needs from the previous generation has to be in
  // memory before that happens.
  const carried = existing ?? readExistingAnnotations(outDir);

  /*
   * THE LAST GATE, AND THE ONE THAT WOULD HAVE CAUGHT THE 19,000.
   *
   * The per-chunk check upstream only sees the chunks; this sees the run. Both
   * are needed: a single collapsed chunk is caught by the first, and a slow
   * bleed spread over many chunks -- each individually above the ratio -- is
   * only visible here.
   *
   * It refuses rather than warns. `writeTiles` is about to `rmSync` the whole
   * directory, so by the time a warning were read the archive would be gone.
   */
  if (carried.size > 0 && !opts.force) {
    const floor = Math.round(carried.size * TOTAL_LOSS_RATIO);
    if (byId.size < floor) {
      throw new Error(
        `REFUSING TO WRITE: this run found ${String(byId.size)} cameras, and the archive on ` +
          `disk holds ${String(carried.size)}.\n` +
          `  That is a loss of ${String(carried.size - byId.size)} ` +
          `(${String(Math.round((1 - byId.size / carried.size) * 100))}%), below the ` +
          `${String(Math.round(TOTAL_LOSS_RATIO * 100))}% floor.\n` +
          '  Cameras are bolted to poles; a drop this size is a failed read, not a removal.\n' +
          '  Nothing has been written -- the existing archive is untouched.\n' +
          '  Re-run, or pass --force if the removal is real and you have checked it.',
      );
    }
  }

  /*
   * IDENTITY, NOT JUST POPULATION.
   *
   * The total check above compares two numbers and passes when they are close.
   * The Aug-20 dump is 130,684 against an archive of 131,083 -- comfortably
   * inside the floor -- while 443 of the archive's ids are simply absent from
   * it. Counting cannot see that. See the note on MAX_VANISHED_* above.
   */
  if (carried.size > 0 && !opts.force) {
    const { vanished, verified: vanishedVerified } = vanishedArchiveRecords(
      carried,
      byId,
      tombstoneLedger?.tombstones ?? [],
    );
    const ratio = vanished.length / carried.size;
    if (vanishedVerified > MAX_VANISHED_VERIFIED || ratio > MAX_VANISHED_RATIO) {
      throw new Error(
        `REFUSING TO WRITE: ${String(vanished.length)} cameras on disk are absent from this ` +
          `run (${String(Math.round(ratio * 1000) / 10)}% of ${String(carried.size)}), ` +
          `${String(vanishedVerified)} of them confirmed by the hourly patrol.\n` +
          '  A patrol-confirmed record was seen in a replication diff at a known version, so\n' +
          '  it existed upstream. Hundreds vanishing at once is a stale or partial source, not\n' +
          '  a mass decommissioning -- and nothing would put them back, because the diffs that\n' +
          '  added them are behind the patrol watermark.\n' +
          `  e.g. ${vanished.slice(0, 3).join(', ')}\n` +
          '  Nothing has been written -- the existing archive is untouched.\n' +
          '  Pass --force only if the removal is real and you have checked it.',
      );
    }
  }

  /*
   * THE LEDGER COMES OUT BEFORE THE DIRECTORY DOES. See PRESERVED_SIDECARS --
   * replacing outDir below would otherwise erase deletion history. The
   * overview is intentionally rebuilt from the final records below.
   */
  const sidecars = new Map();
  for (const name of PRESERVED_SIDECARS) {
    const at = join(outDir, name);
    if (!existsSync(at)) continue;
    if (name === 'tombstones.json' && tombstoneLedger !== null && resolved.cleared.length > 0) {
      sidecars.set(
        name,
        Buffer.from(
          `${JSON.stringify({
            ...tombstoneLedger,
            generatedAt: new Date().toISOString(),
            tombstones: resolved.tombstones,
          })}\n`,
        ),
      );
      continue;
    }
    sidecars.set(name, readFileSync(at));
  }
  if (sidecars.size > 0) {
    process.stdout.write(`  preserving ${[...sidecars.keys()].join(', ')}\n`);
  }

  if (carried.size > 0) {
    process.stdout.write(
      `  carrying forward ${CARRIED_FORWARD.join('/')} where held (${String(carried.size)} known cameras)\n`,
    );
  }
  const index = opts.counties === null ? null : loadCounties(resolve(ROOT, opts.counties));
  if (index !== null) {
    process.stdout.write(`  ${String(index.counties.length)} county polygons\n`);
  }
  const placeIndex =
    opts.places === null
      ? null
      : buildPlaceIndex(resolve(ROOT, `${opts.places}.shp`), resolve(ROOT, `${opts.places}.dbf`));
  if (placeIndex !== null) {
    process.stdout.write(`  ${String(placeIndex.places.length)} place polygons\n`);
  }
  const places = new Map();
  let inPlace = 0;

  const tiles = new Map();
  const counties = new Map();
  let located = 0;

  for (const node of byId.values()) {
    const rounded = normalise(node);
    const county = index === null ? null : index.lookup(rounded.lat, rounded.lon);
    if (opts.cameraSource !== undefined && opts.cameraSource !== null && county === null) {
      throw new Error(`release camera osm:${String(node.id)} escaped the pinned county geofence`);
    }
    if (county !== null) {
      located += 1;
      const seen = counties.get(county.fips);
      if (seen === undefined) {
        counties.set(county.fips, {
          fips: county.fips,
          name: county.name,
          lsad: county.lsad,
          state: county.state,
          label: countyLabel(county),
          cameras: 1,
        });
      } else {
        seen.cameras += 1;
      }
    }
    const place = placeIndex === null ? null : placeIndex.lookup(rounded.lat, rounded.lon);
    if (place !== null) {
      inPlace += 1;
      const seen = places.get(place.geoid);
      if (seen === undefined) {
        places.set(place.geoid, {
          geoid: place.geoid,
          name: place.name,
          label: placeLabel(place),
          lsad: place.lsad,
          stateFips: place.stateFips,
          cameras: 1,
        });
      } else {
        seen.cameras += 1;
      }
    }
    // The OSM-derived record, then ONLY the named annotations OSM never
    // supplied. Spreading the whole held record would carry its `lat`/`lon`
    // over the fresh ones and pin a camera that has been MOVED in OSM to where
    // it used to be -- which is the one kind of staleness this dataset cannot
    // afford, because the app measures distance to it.
    const previous = carried.get(`osm:${String(node.id)}`);
    const camera = normalise(node, county, place);
    if (previous !== undefined) {
      for (const field of CARRIED_FORWARD) {
        if (previous[field] !== undefined) camera[field] = previous[field];
      }
    }
    const { x, y } = latLonToTile(camera.lat, camera.lon, opts.zoom);
    const key = `${String(x)}/${String(y)}`;
    const list = tiles.get(key) ?? [];
    list.push(camera);
    tiles.set(key, list);
  }

  process.stdout.write(
    `\n${String(byId.size)} cameras -> ${String(tiles.size)} populated z${String(opts.zoom)} tiles\n`,
  );
  const generatedAt = new Date().toISOString();
  // Validate every provenance claim before the first destructive target write.
  const provenance = sourceIndexFields(opts, generatedAt);
  if (opts.dry) return { cameras: byId.size, tiles: tiles.size, written: 0 };

  assertSafeCameraTarget(outDir);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  // Straight back in, before anything else is written: an interrupted run
  // should not be able to leave the tree without its deletion ledger.
  if (sidecars.size > 0) {
    mkdirSync(outDir, { recursive: true });
    for (const [name, bytes] of sidecars) writeFileSync(join(outDir, name), bytes);
  }
  /**
   * ONE TIMESTAMP, IN ONE PLACE.
   *
   * This used to be written into the body of EVERY tile, which quietly defeated
   * the byte-stability sort three lines below it: a re-run with identical camera
   * data still rewrote all 8,561 files, so every refresh was a full re-commit of
   * ~25 MB into history and produced a diff no human reviews. A fetch
   * regression -- like the 54% Overpass loss this file has a 23-line comment
   * about -- is invisible in a diff nobody reads.
   *
   * Worse, it made the dataset unable to state its own age: sampling the
   * committed tiles turned up TWO distinct values, so the tree on disk was a
   * mixture of two generation runs and there was no single answer to "when was
   * this generated".
   *
   * It lives in `index.json` now, which is the one file that legitimately
   * changes every run.
   */
  let written = 0;
  const tileIndex = [];

  for (const [key, cameras] of tiles) {
    const [x, y] = key.split('/');
    const path = join(outDir, String(opts.zoom), String(x), `${String(y)}.json`);
    mkdirSync(dirname(path), { recursive: true });
    // Sorted by id so the file is byte-stable between runs when the data has
    // not changed, which keeps the deploy diff honest.
    cameras.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    writeFileSync(
      path,
      `${JSON.stringify({
        z: opts.zoom,
        x: Number(x),
        y: Number(y),
        attribution: ATTRIBUTION,
        licence: LICENCE,
        licenceUrl: LICENCE_URL,
        cameras,
      })}\n`,
    );
    tileIndex.push({ x: Number(x), y: Number(y), count: cameras.length });
    written += 1;
  }

  const overview = buildCameraOverview([...tiles.values()].flat());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'overview.json'), `${JSON.stringify(overview)}\n`);

  if (counties.size > 0) {
    const rows = [...counties.values()].sort(
      (a, b) => b.cameras - a.cameras || a.fips.localeCompare(b.fips),
    );
    writeFileSync(
      join(outDir, 'counties.json'),
      `${JSON.stringify(
        {
          generatedAt,
          source: 'US Census county polygons, joined point-in-polygon',
          attribution: ATTRIBUTION,
          licence: LICENCE,
          licenceUrl: LICENCE_URL,
          counties: rows.length,
          located,
          unlocated: byId.size - located,
          rows,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(
      `${String(rows.length)} counties, ${String(located)} cameras located, ${String(byId.size - located)} outside every polygon\n`,
    );
  }

  if (places.size > 0) {
    const rows = [...places.values()].sort((a, b) => b.cameras - a.cameras);
    writeFileSync(
      join(outDir, 'places.json'),
      `${JSON.stringify(
        {
          generatedAt,
          source:
            'US Census cartographic boundary places (cb_2023_us_place_500k), point-in-polygon',
          attribution: ATTRIBUTION,
          licence: LICENCE,
          licenceUrl: LICENCE_URL,
          places: rows.length,
          inPlace,
          // Most of the country's AREA is unincorporated. A camera outside
          // every place polygon gets no city rather than the nearest one.
          unincorporated: byId.size - inPlace,
          rows,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(
      `${String(rows.length)} places, ${String(inPlace)} cameras inside one, ${String(byId.size - inPlace)} outside every place\n`,
    );
  } else if (opts.cameraSource !== undefined && opts.cameraSource !== null) {
    writeFileSync(
      join(outDir, 'places.json'),
      `${JSON.stringify(
        {
          generatedAt,
          source: 'No place enrichment in the approved direct-capture baseline',
          attribution: ATTRIBUTION,
          licence: LICENCE,
          licenceUrl: LICENCE_URL,
          places: 0,
          inPlace: 0,
          unincorporated: byId.size,
          rows: [],
        },
        null,
        2,
      )}\n`,
    );
  }

  tileIndex.sort((a, b) => a.x - b.x || a.y - b.y);
  writeFileSync(
    join(outDir, 'index.json'),
    `${JSON.stringify(
      {
        zoom: opts.zoom,
        generatedAt,
        /*
         * WHICH READ OF OSM THIS ARCHIVE CAME FROM, and WHEN that read was
         * true. Both are arguments now rather than constants, because they are
         * no longer always the same: `--input` can carry a dump built by
         * `fetch-cameras-deflock.mjs` from the reviewed first-party retained
         * Overpass capture, so provenance comes from its bound source marker.
         *
         * `upstream` matters more than it looks: INTEL's DATA AS OF row reads
         * it, so leaving it null on an --input run made a freshly rebuilt
         * archive report its own age as unknown.
         */
        ...provenance,
        attribution: ATTRIBUTION,
        licence: LICENCE,
        licenceUrl: LICENCE_URL,
        cameras: byId.size,
        tiles: tileIndex.length,
        bbox: opts.bbox,
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(`wrote ${String(written)} tiles + index.json to ${outDir}\n`);
  return { cameras: byId.size, tiles: tiles.size, written };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`fetch-cameras failed: ${err.message}\n`);
    process.exit(1);
  });
}
