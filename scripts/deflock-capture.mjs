import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const CAPTURE_SCHEMA = 'darkroute-deflock-direct-capture/v2';
export const RESPONSE_LEDGER_SCHEMA = 'deflock-overpass-response-ledger/v2';
export const RESPONSE_BUNDLE_MAGIC = 'DROPRSP2';
export const RESPONSE_LEDGER_PATH = 'scripts/data/deflock-us-overpass-response-ledger.json';
export const RESPONSE_BUNDLE_PATH = 'scripts/data/deflock-us-overpass-responses.bundle.gz';
export const RAW_DATASET_PATH = 'scripts/data/deflock-us-source.geojson.gz';
export const CAPTURE_IMPLEMENTATION_PATHS = Object.freeze([
  'scripts/capture-deflock-source.mjs',
  'scripts/deflock-capture.mjs',
]);

export const PINNED_UPSTREAM = Object.freeze({
  repository: 'flockhopper3/deflock-data',
  commit: '8d156b24db7090e870af3f007b0caece9b3c0951',
  files: Object.freeze([
    Object.freeze({
      path: 'data/cameras/lib.mjs',
      sha256: 'b2164ebe2ed8c23da8f9cf442f890f29e1cc648ecf17424e93fb847b2b190e0a',
    }),
    Object.freeze({
      path: 'data/cameras/tiled-fetch.mjs',
      sha256: 'e5b083b32ae1dceb641adb0ca7f445abcc8065f02a9084a7484c979a2c235a04',
    }),
  ]),
});

/**
 * The mirrors this capture is allowed to ask.
 *
 * ORDER IS PREFERENCE. `queryOverpassCandidate` walks this list and takes the
 * first endpoint that answers, so the most trustworthy instance is first.
 *
 * `maps.mail.ru` WAS HERE AND IS DELIBERATELY GONE, on two grounds that agree.
 * It is a third-party proxy operated by a Russian internet company rather than
 * an OSM-community instance, which is a supply-chain question a surveillance-
 * avoidance tool should not have to hand-wave; and it is the endpoint that
 * actually broke a capture run - it returned HTTP 200 with a TRUNCATED body,
 * 206 features where its own count query said 566, which is worse than a
 * refusal because it looks like data. Removed by owner decision 2026-09-03.
 *
 * `overpass.osm.ch` WAS ADDED 2026-09-06 BY OWNER APPROVAL AND REMOVED THE SAME
 * DAY, on evidence rather than taste. It is the Swiss OSM chapter's instance and
 * it was the only approved-list candidate answering while two of the three below
 * were down - but it reports `osm3s.timestamp_osm_base` as a SEQUENCE NUMBER:
 *
 *     osm.ch    "timestamp_osm_base": "116939"
 *     deflock   "timestamp_osm_base": "2026-09-06T14:07:21Z"
 *
 * That field is not incidental. It is the entire replication floor - the reason
 * the upstream receipt in `deflock-us-source-review.json` is unapprovable is
 * that its run failed to retain exactly this value. A mirror that cannot emit a
 * UTC timestamp here can never contribute to a provable floor, so adding it
 * bought availability at the cost of the one property the capture exists to
 * establish. The capture rejected it on the first tile - "osm_base is not an
 * exact UTC timestamp" - which is the guard working.
 *
 * ANY FUTURE MIRROR MUST BE CHECKED FOR THIS BEFORE IT IS ADDED. Answering 200
 * is not the bar; emitting an ISO 8601 `timestamp_osm_base` is.
 *
 * `overpass-api.de` stays despite the TLD: it is the REFERENCE instance, run by
 * the author of Overpass, and is the most canonical endpoint available. It is
 * kept for rotation depth, which the capture genuinely needs - the count and
 * the data for a tile must come from DIFFERENT mirrors
 * (`excludeEndpoints: [countEndpoint]`), so two live mirrors is the bare floor
 * and a third is what lets a bad response be retried somewhere else.
 */
export const OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass.deflock.org/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]);

/**
 * THE ENDPOINTS THIS RUN MAY USE - a SUBSET of the list above, never more.
 *
 * =============================================================================
 * WHY A RUN NEEDS TO NARROW IT
 * =============================================================================
 * These are volunteer-run mirrors and they go down. Observed here: kumi.systems
 * answering 504 to every request for half an hour, and - worse - once returning
 * a TRUNCATED body that still parsed as JSON, 44 features where both healthy
 * mirrors said 62. The count guard caught that, which is exactly its job, but
 * the capture then retried onto the same sick mirror and failed the whole
 * national run on one leaf.
 *
 * A capture that cannot proceed because one of three mirrors is down is
 * fragile in a way that has nothing to do with data integrity.
 *
 * =============================================================================
 * IT CAN ONLY EVER REMOVE
 * =============================================================================
 * `FWM_OVERPASS_SKIP` is a comma-separated list of endpoints to sit out. The
 * result is filtered FROM the frozen list above, so a recorded response can
 * never name an endpoint that is not already approved - which is what
 * `validateCaptureArtifacts` checks, and it keeps checking it unchanged.
 *
 * ONE ENDPOINT IS ALLOWED, AND IT IS A DELIBERATE DEGRADATION.
 *
 * This used to refuse fewer than two, because a tile's count and its data are
 * meant to come from different mirrors so no single stale mirror can certify
 * itself. That floor is the stronger position and it is still what a healthy
 * run gets.
 *
 * It is not what the mirrors have been offering. Over 2026-09-05/06 the three
 * approved instances were down or rate-limited in every combination, the app
 * sat in a permanently failed sync, and a check that makes the capture
 * impossible to run protects nothing: the data does not get fresher by not
 * being captured, it just gets older with a guard standing over it.
 *
 * So a single-mirror run is permitted by owner decision, 2026-09-06, and
 * `singleMirror()` reports it so the artifact records that the independence
 * check did not happen. What that costs is exact and worth naming: with one
 * mirror the count and the data come from the SAME instance, so a mirror
 * serving a stale or truncated view agrees with itself and
 * `countProbeIsConsistent` passes on both halves of a wrong answer. Every other
 * guard still applies - the geofence, the tile-body check, the exact-count
 * rule, and above all `timestamp_osm_base` having to be a real UTC timestamp.
 *
 * A REVIEWER MUST SEE THIS BEFORE APPROVING. It is the difference between a
 * receipt whose freshness two independent mirrors agree on and one that rests
 * on a single instance's word.
 */
export function activeOverpassEndpoints(env = process.env) {
  const skip = String(env['FWM_OVERPASS_SKIP'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (skip.length === 0) return [...OVERPASS_ENDPOINTS];

  const unknown = skip.filter((entry) => !OVERPASS_ENDPOINTS.includes(entry));
  if (unknown.length > 0) {
    throw new Error(`FWM_OVERPASS_SKIP names endpoints that are not approved: ${unknown.join(', ')}`);
  }
  const active = OVERPASS_ENDPOINTS.filter((endpoint) => !skip.includes(endpoint));
  if (active.length < 1) {
    throw new Error('FWM_OVERPASS_SKIP would leave no endpoints at all');
  }
  return active;
}

/** True when this run has no second mirror to cross-check against. */
export function singleMirror(env = process.env) {
  return activeOverpassEndpoints(env).length < 2;
}

export const OVERPASS_USER_AGENT =
  'DarkRoute-source-capture/1.0 (+https://darkroute.ai; contact cory@darkcode.ai)';
export const SPLIT_THRESHOLD = 5_000;
export const MIN_TILE_SPAN = 0.05;
/**
 * HOW MANY TILES ARE IN FLIGHT AT ONCE, and why it is not a constant.
 *
 * =============================================================================
 * IT HAS TO SCALE WITH THE MIRRORS THAT ARE ACTUALLY UP
 * =============================================================================
 * A tile's DATA query deliberately excludes the endpoint that answered its
 * COUNT probe, so that the two come from different mirrors and a single stale
 * mirror cannot certify itself. The consequence is arithmetic: with `n`
 * approved endpoints, every data query lands on one of `n - 1`.
 *
 * `5` was tuned when all three approved endpoints were healthy - two of them
 * carrying data, so about 2.5 requests in flight each. When
 * `overpass.kumi.systems` went down, `FWM_OVERPASS_SKIP` correctly dropped it
 * to two endpoints and the SAME 5 then funnelled onto the ONE remaining data
 * mirror, which answered with seven HTTP 429s and killed the capture. The skip
 * lever worked; the concurrency behind it did not follow.
 *
 * So it is derived from the endpoints in play, holding the per-mirror load
 * roughly where it was: two in flight per data mirror. Three endpoints gives 4,
 * two gives 2. Slightly gentler than the old 5 on a full house, which is the
 * right side to err on for a donated public service that this project does not
 * pay for and cannot page.
 */
export const TILE_CONCURRENCY_PER_DATA_ENDPOINT = 2;

export function tileConcurrency(activeEndpointCount) {
  const dataMirrors = Math.max(1, activeEndpointCount - 1);
  return Math.max(1, dataMirrors * TILE_CONCURRENCY_PER_DATA_ENDPOINT);
}
export const TILE_RETRIES = 3;
export const TILE_RETRY_DELAY_MS = 1_000;
export const TILE_FETCH_TOLERANCE = 0;
// Recent independently decoded US transports hold roughly 137k–140k features.
// 120k is deliberately conservative while still rejecting a severely partial
// but internally self-consistent mirror.
export const RAW_MIN_TOTAL = 120_000;
// Retained evidence is expected to be tens of MiB. Bound inflation before any
// semantic/hash check so a corrupt or hostile gzip cannot exhaust a CI runner.
export const MAX_RETAINED_CAPTURE_DECODED_BYTES = 512 * 1024 * 1024;
export const CA_AREA_MIN_COUNT = 300;
export const MX_AREA_MIN_COUNT = 0;
export const OSM_ATTRIBUTION = 'Map data © OpenStreetMap contributors';
export const OSM_LICENCE = 'ODbL-1.0';
export const OSM_LICENCE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';
export const responseBundleNotice = Object.freeze({
  attribution: OSM_ATTRIBUTION,
  licence: OSM_LICENCE,
  licenceUrl: OSM_LICENCE_URL,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function canonicalTimestamp(value, label = 'timestamp') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is missing`);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`${label} is invalid`);
  const canonical = new Date(millis).toISOString();
  if (value !== canonical && value !== canonical.replace('.000Z', 'Z')) {
    throw new Error(`${label} is not an exact UTC timestamp`);
  }
  return canonical;
}

const cloneBox = ({ s, w, n, e }) => ({ s, w, n, e });

export function buildSeedTiles() {
  const tiles = [];
  for (let s = 24; s < 50; s += 6.5) {
    for (let w = -125; w < -66; w += 9.84) {
      tiles.push({ s, w, n: Math.min(s + 6.5, 50), e: Math.min(w + 9.84, -66) });
    }
  }
  tiles.push({ s: 51, w: -180, n: 72, e: -129 });
  // The pinned source covered only negative longitudes. This explicit sibling
  // covers Attu and the Aleutians east of +170; the strict Census polygon is
  // still the final territorial authority, so nearby foreign points cannot pass.
  tiles.push({ s: 51, w: 170, n: 72, e: 180 });
  tiles.push({ s: 18, w: -161, n: 23, e: -154 });
  // Include Mayagüez, Mona, and Monito. The reviewed Census polygon reaches
  // -67.954119, so -67.5 would leave part of the declared Puerto Rico scope
  // outside every capture root.
  tiles.push({ s: 17.5, w: -68, n: 18.7, e: -64.5 });
  return tiles;
}

export function tileId(tile) {
  return `tile:${JSON.stringify([tile.s, tile.w, tile.n, tile.e])}`;
}

export function splitTile(tile) {
  const my = (tile.s + tile.n) / 2;
  const mx = (tile.w + tile.e) / 2;
  return [
    { s: tile.s, w: tile.w, n: my, e: mx },
    { s: tile.s, w: mx, n: my, e: tile.e },
    { s: my, w: tile.w, n: tile.n, e: mx },
    { s: my, w: mx, n: tile.n, e: tile.e },
  ];
}

/**
 * Count and data queries must agree exactly. Any churn or mirror skew retries
 * the leaf; accepting a percentage delta would make thousands of omissions
 * indistinguishable from a complete release baseline.
 */
export function countProbeIsConsistent(probed, actual, bbox) {
  if (!Number.isSafeInteger(probed) || probed < 1 || !Number.isSafeInteger(actual) || actual < 0) {
    return false;
  }
  const span = Math.min(bbox.n - bbox.s, bbox.e - bbox.w);
  return actual === probed && !(span > MIN_TILE_SPAN && actual > SPLIT_THRESHOLD);
}

export function assertRawCaptureMinimum(total) {
  if (!Number.isSafeInteger(total) || total < RAW_MIN_TOTAL) {
    throw new Error(`raw capture has only ${String(total)} features`);
  }
  return total;
}

export function tileSelector(tile) {
  const bbox = `${tile.s},${tile.w},${tile.n},${tile.e}`;
  return (
    `node["man_made"="surveillance"]["surveillance:type"~"^(ALPR|ANPR)$",i](${bbox});` +
    `way["man_made"="surveillance"]["surveillance:type"~"^(ALPR|ANPR)$",i](${bbox});`
  );
}

export const countQuery = (tile) => `[out:json][timeout:60];(${tileSelector(tile)});out count;`;

export const dataQuery = (tile) =>
  `[out:json][timeout:60];(${tileSelector(tile)});out meta;>;out skel qt;`;

export const subtractionQuery = (iso) =>
  `[out:json][timeout:90];area["ISO3166-1"="${iso}"]["admin_level"="2"]->.a;` +
  `(node["man_made"="surveillance"]["surveillance:type"~"^(ALPR|ANPR)$",i](area.a);` +
  `way["man_made"="surveillance"]["surveillance:type"~"^(ALPR|ANPR)$",i](area.a););` +
  'out meta;>;out skel qt;';

export const requestBytes = (query) => Buffer.from(new URLSearchParams({ data: query }).toString());

const RETAINED_ELEMENT_FIELDS = Object.freeze([
  'type',
  'id',
  'version',
  'timestamp',
  'lat',
  'lon',
  'nodes',
]);

/**
 * The public evidence bundle retains only tags used by the capture predicate or
 * the published camera record.  `out meta` can return arbitrary free-form OSM
 * tags, including contact details; keeping the entire map would turn an audit
 * artefact into an unnecessary contact-data export.
 */
export const RETAINED_TAG_KEYS = Object.freeze([
  'brand',
  'camera:direction',
  'camera:mount',
  'direction',
  'man_made',
  'manufacturer',
  'operator',
  'ref',
  'start_date',
  'surveillance:type',
  'surveillance:zone',
  'total',
]);

const EMAIL_VALUE =
  /(?:^|[^\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}(?:$|[^\p{L}\p{N}.-])/iu;
const WEB_VALUE = /(?:https?:\/\/|www\.)\S+/iu;
const BARE_DOMAIN_VALUE =
  /(?:^|[^\p{L}\p{N}-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}(?:$|[^\p{L}\p{N}-])/iu;

export function containsContactValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = value
    .normalize('NFKC')
    .replace(/[•·‧∙]/gu, '-')
    .replace(/\s*(?:\[\s*at\s*\]|\(\s*at\s*\))\s*/giu, '@')
    .replace(/\s+at\s+/giu, '@')
    .replace(/\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\))\s*/giu, '.')
    .replace(/\s+dot\s+/giu, '.');
  const digitCount = (normalized.match(/\d/g) ?? []).length;
  /*
   * A BARE DECIMAL IS A MEASUREMENT, NOT A PHONE NUMBER.
   *
   * `direction=0.009999999999990905` is a real tag on a real ALPR node, and the
   * phone heuristic below matched it: nineteen digits clears `digitCount >= 10`,
   * and `.` is inside the separator class, so `\+?\d[\d().\s-]{7,}\d` reads a
   * long decimal as a grouped phone number.
   *
   * WHAT THAT COST WAS THE WHOLE NATIONAL PUBLICATION, not one tag. The filter
   * dropped `direction` from the retained tags; the archive builder still
   * derived `directionDeg` from the raw element; and `validateVersionedCamera`
   * then re-derived the direction from the RETAINED tags, got null, and refused
   * the generation -- "camera osm:13271087144 disagrees with its retained OSM
   * tags". One node in 139,401 blocked every camera in the country.
   *
   * THE SHAPE OF THE EXEMPTION IS THE ARGUMENT. Phone numbers are not written
   * with a decimal fraction, so a single decimal point with digits on both
   * sides is the discriminator -- and the integer part is capped at six digits
   * so `8165551234.0` is still caught, while every angle, height and speed a
   * retained tag can carry passes. Two dots (`816.555.1234`), a leading `+`
   * with spaces, or a bare ten-digit run are all still phone-like.
   *
   * Only the phone arm is exempted: an email, a URL and a bare domain all
   * require a letter, and this pattern permits none.
   */
  const bareMeasurement = /^[+-]?\d{1,6}\.\d+$/u.test(normalized.trim());
  const phoneLike =
    !bareMeasurement &&
    (digitCount >= 10 && /(?:^|\D)\+?\d[\d().\s-]{7,}\d(?:$|\D)/u.test(` ${normalized} `)) ||
    (digitCount >= 7 &&
      (/(?:^|\s)tel:\s*\+?\d[\d().\s-]{5,}\d(?:$|\s)/iu.test(` ${normalized} `) ||
        /(?:^|\D)\d{3}[-.\s]\d{4}(?:$|\D)/u.test(` ${normalized} `)));
  return (
    EMAIL_VALUE.test(` ${normalized} `) ||
    WEB_VALUE.test(normalized) ||
    BARE_DOMAIN_VALUE.test(` ${normalized} `) ||
    phoneLike
  );
}

export function retainedTags(tags) {
  if (tags === undefined) return undefined;
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
    throw new Error('Overpass element tags are not a string map');
  }
  const retained = {};
  for (const key of RETAINED_TAG_KEYS) {
    if (!Object.hasOwn(tags, key)) continue;
    const value = tags[key];
    if (typeof value !== 'string') throw new Error(`Overpass tag ${key} is not a string`);
    // Contact-like values are deliberately omitted even when they appear in a
    // generally useful field such as operator or ref. The raw transport hash
    // still proves which response was received without publishing the value.
    if (containsContactValue(value)) continue;
    retained[key] = value;
  }
  return retained;
}

function qualifiesElement(element) {
  const tags = element?.tags ?? {};
  const surveillanceType = String(tags['surveillance:type'] ?? '').toUpperCase();
  return (
    tags.man_made === 'surveillance' && (surveillanceType === 'ALPR' || surveillanceType === 'ANPR')
  );
}

/**
 * Bind every qualifying element to the snapshot watermark carried by its own
 * response. A retained body with a future or missing element version could
 * otherwise seed a version which the real replication stream can never
 * replace: all lower genuine versions would look like stale replay.
 */
export function assertSelectedElementSnapshots(body, label = 'Overpass response') {
  if (!Array.isArray(body?.elements)) throw new Error(`${label} has no elements array`);
  const osmBase = canonicalTimestamp(body.osm3s?.timestamp_osm_base, `${label} osm_base`);
  for (const element of body.elements) {
    if (!qualifiesElement(element)) continue;
    const elementTimestamp = canonicalTimestamp(
      element.timestamp,
      `${label} selected ${String(element.type)}/${String(element.id)} timestamp`,
    );
    if (
      !['node', 'way'].includes(element.type) ||
      !Number.isSafeInteger(element.id) ||
      element.id < 1 ||
      !Number.isSafeInteger(element.version) ||
      element.version < 1 ||
      Date.parse(elementTimestamp) > Date.parse(osmBase) ||
      (element.type === 'node' &&
        (!Number.isFinite(element.lat) ||
          element.lat < -90 ||
          element.lat > 90 ||
          !Number.isFinite(element.lon) ||
          element.lon < -180 ||
          element.lon > 180))
    ) {
      throw new Error(
        `${label} selected ${String(element.type)}/${String(element.id)} is not ordered within its response snapshot`,
      );
    }
  }
  return body;
}

/** Deep privacy assertion shared by capture validation and public-seed audit. */
export function assertNoRetainedContactData(body, label = 'retained capture body') {
  if (!Array.isArray(body?.elements)) throw new Error(`${label} has no elements array`);
  for (const element of body.elements) {
    if (
      Object.hasOwn(element, 'user') ||
      Object.hasOwn(element, 'uid') ||
      Object.hasOwn(element, 'changeset')
    ) {
      throw new Error(`${label} retains OSM contributor identity`);
    }
    const tags = element.tags;
    if (tags === undefined) continue;
    if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
      throw new Error(`${label} has a non-object tag map`);
    }
    for (const [key, value] of Object.entries(tags)) {
      if (!RETAINED_TAG_KEYS.includes(key))
        throw new Error(`${label} retains unapproved tag ${key}`);
      if (typeof value !== 'string' || containsContactValue(value)) {
        throw new Error(`${label} retains contact-like data in ${key}`);
      }
    }
  }
  return body;
}

/**
 * Keep only evidence required to reconstruct and order the source. `out meta`
 * also returns mapper user/uid/changeset; those are hashed as transport but
 * deliberately never copied into the public response bundle.
 */
export function retainedResponseBody(body) {
  if (!Array.isArray(body?.elements)) throw new Error('Overpass body has no elements array');
  const osmBase = canonicalTimestamp(body.osm3s?.timestamp_osm_base, 'response osm_base');
  assertSelectedElementSnapshots(body);
  const elements = body.elements.map((element) => {
    const retained = {};
    for (const field of RETAINED_ELEMENT_FIELDS) {
      if (Object.hasOwn(element, field)) retained[field] = element[field];
    }
    const tags = retainedTags(element.tags);
    if (tags !== undefined && Object.keys(tags).length > 0) retained.tags = tags;
    return retained;
  });
  return assertNoRetainedContactData({
    version: body.version ?? 0.6,
    osm3s: { timestamp_osm_base: osmBase },
    elements,
  });
}

export const retainedResponseBytes = (body) =>
  Buffer.from(JSON.stringify(retainedResponseBody(body)));

const CARDINALS = Object.freeze({
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
});
const SPELLED_CARDINALS = Object.freeze({
  NORTH: 0,
  NORTHEAST: 45,
  EAST: 90,
  SOUTHEAST: 135,
  SOUTH: 180,
  SOUTHWEST: 225,
  WEST: 270,
  NORTHWEST: 315,
});
const BOUND_DIRECTIONS = Object.freeze({ NB: 0, EB: 90, SB: 180, WB: 270 });
const normalizeDegrees = (degrees) => ((degrees % 360) + 360) % 360;

function resolveDirectionToken(token) {
  const upper = token.trim().toUpperCase();
  if (upper === '') return null;
  if (upper in CARDINALS) return CARDINALS[upper];
  if (upper in SPELLED_CARDINALS) return SPELLED_CARDINALS[upper];
  if (upper in BOUND_DIRECTIONS) return BOUND_DIRECTIONS[upper];
  const number = Number(upper);
  return Number.isNaN(number) ? null : number;
}

function parseDirectionToken(token) {
  const trimmed = token.trim();
  const simple = resolveDirectionToken(trimmed);
  if (simple !== null) return normalizeDegrees(simple);
  const dash = trimmed.indexOf('-', 1);
  if (dash < 1) return null;
  const start = resolveDirectionToken(trimmed.slice(0, dash));
  const finish = resolveDirectionToken(trimmed.slice(dash + 1));
  if (start === null || finish === null) return null;
  const rawArc = finish - start;
  const arc = normalizeDegrees(rawArc);
  return normalizeDegrees(start + (arc === 0 && rawArc !== 0 ? 180 : arc / 2));
}

export function parseDirections(value) {
  if (typeof value !== 'string' || value.trim() === '') return [];
  const directions = [];
  for (const token of value.split(/[;,]/)) {
    const parsed = parseDirectionToken(token);
    if (parsed !== null) directions.push(parsed);
  }
  return directions;
}

/** The pinned DeFlock Overpass-element to GeoJSON transformation. */
export function addElementsToFeatures(elements, featureMap) {
  const nodesById = new Map();
  for (const element of elements) {
    if (
      element.type === 'node' &&
      typeof element.lat === 'number' &&
      typeof element.lon === 'number'
    ) {
      nodesById.set(element.id, { lat: element.lat, lon: element.lon });
    }
  }

  for (const element of elements) {
    const tags = element.tags ?? {};
    const surveillanceType = String(tags['surveillance:type'] ?? '').toUpperCase();
    if (
      tags.man_made !== 'surveillance' ||
      (surveillanceType !== 'ALPR' && surveillanceType !== 'ANPR')
    ) {
      continue;
    }
    let lat = element.lat;
    let lon = element.lon;
    if (element.type === 'way' && Array.isArray(element.nodes)) {
      const nodes = element.nodes.map((id) => nodesById.get(id)).filter(Boolean);
      if (nodes.length > 0) {
        lat = nodes.reduce((sum, node) => sum + node.lat, 0) / nodes.length;
        lon = nodes.reduce((sum, node) => sum + node.lon, 0) / nodes.length;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const directionTag = tags.direction || tags['camera:direction'];
    const directions = parseDirections(directionTag);
    const firstToken = directionTag?.split(/[;,]/)[0]?.trim();
    const properties = {
      osmId: element.id,
      osmType: element.type,
      surveillanceType: tags['surveillance:type'],
    };
    if (tags.operator) properties.operator = tags.operator;
    if (tags.brand || tags.manufacturer) properties.brand = tags.brand || tags.manufacturer;
    if (directions.length > 0) properties.direction = directions[0];
    if (directions.length > 1) properties.directions = directions;
    if (firstToken && firstToken.toUpperCase() in CARDINALS) {
      properties.directionCardinal = firstToken;
    }
    if (tags['surveillance:zone']) properties.surveillanceZone = tags['surveillance:zone'];
    if (tags['camera:mount']) properties.mountType = tags['camera:mount'];
    if (tags.ref) properties.ref = tags.ref;
    if (tags.start_date) properties.startDate = tags.start_date;
    if (element.timestamp) properties.osmTimestamp = element.timestamp;
    if (element.version) properties.osmVersion = element.version;

    featureMap.set(`${element.type}/${String(element.id)}`, {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties,
    });
  }
  return featureMap;
}

export function selectedFeatures(body) {
  if (!Array.isArray(body?.elements)) throw new Error('Overpass body has no elements array');
  return addElementsToFeatures(body.elements, new Map());
}

const pointInTile = (lat, lon, tile) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= tile.s &&
  lat <= tile.n &&
  lon >= tile.w &&
  lon <= tile.e;

/** Prove each selected node could have been returned by this exact bbox. */
export function assertDataBodyMatchesTile(body, tile) {
  if (!Array.isArray(body?.elements)) throw new Error('Overpass body has no elements array');
  for (const element of body.elements) {
    const tags = element.tags ?? {};
    const surveillanceType = String(tags['surveillance:type'] ?? '').toUpperCase();
    if (
      element.type !== 'node' ||
      tags.man_made !== 'surveillance' ||
      (surveillanceType !== 'ALPR' && surveillanceType !== 'ANPR')
    ) {
      continue;
    }
    if (!pointInTile(element.lat, element.lon, tile)) {
      throw new Error(`selected node/${String(element.id)} does not fall in its requested tile`);
    }
  }
  return body;
}

const sortedFeatureCollection = (features) => ({
  type: 'FeatureCollection',
  attribution: OSM_ATTRIBUTION,
  licence: OSM_LICENCE,
  licenceUrl: OSM_LICENCE_URL,
  features: [...features].sort(
    (a, b) =>
      Number(a.properties.osmId) - Number(b.properties.osmId) ||
      String(a.properties.osmType).localeCompare(String(b.properties.osmType)),
  ),
});

export function rawDatasetFromBodies(dataBodies, subtractionBodies, subtractionsObtained = true) {
  const merged = new Map();
  for (const body of dataBodies) {
    for (const [key, feature] of selectedFeatures(body)) merged.set(key, feature);
  }
  const neighboringAreaIds = new Set();
  for (const body of subtractionBodies) {
    for (const key of selectedFeatures(body).keys()) neighboringAreaIds.add(key);
  }
  /*
   * NULL WHEN THE CHECK DID NOT RUN, AND NEVER ZERO.
   *
   * With no subtraction bodies the filter below matches nothing and returns 0,
   * and 0 here reads as "we compared the border overlap against Canada and
   * Mexico and found nothing foreign in it". That is a claim about the world.
   * What is true is that we did not look, which is a claim about our data, and
   * this project's whole promise is knowing the difference - it is the same
   * reason `IntelFacts` draws an em dash rather than a confident value, and the
   * same reason the monitor card says "not counted yet" instead of 0.
   *
   * The release is still US-only by construction either way: the Census county
   * geofence in `sourceTerritoryIncludes` is what filters, and it runs
   * regardless. This number is the independent confirmation of that filter, and
   * an absent confirmation has to look absent.
   */
  const foreignCandidateMatches = subtractionsObtained
    ? [...merged.keys()].filter((key) => neighboringAreaIds.has(key)).length
    : null;
  const features = [...merged.values()];
  return {
    collection: sortedFeatureCollection(features),
    rawTotal: merged.size,
    foreignCandidateMatches,
  };
}

export function encodeResponseBundle(entries) {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const notice = Buffer.from(JSON.stringify(responseBundleNotice));
  const noticeLength = Buffer.alloc(4);
  noticeLength.writeUInt32LE(notice.length);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(sorted.length);
  const parts = [Buffer.from(RESPONSE_BUNDLE_MAGIC), noticeLength, notice, count];
  for (const entry of sorted) {
    const id = Buffer.from(entry.id);
    if (id.length > 0xffff) throw new Error('response id is too long');
    if (!Buffer.isBuffer(entry.body)) throw new Error(`response ${entry.id} body is not bytes`);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(id.length, 0);
    header.writeUInt32LE(entry.body.length, 2);
    parts.push(header, id, entry.body);
  }
  return gzipSync(Buffer.concat(parts), { level: 9, mtime: 0 });
}

export function decodeResponseBundle(
  compressed,
  { maximumDecodedBytes = MAX_RETAINED_CAPTURE_DECODED_BYTES } = {},
) {
  if (
    !Number.isSafeInteger(maximumDecodedBytes) ||
    maximumDecodedBytes < 1 ||
    maximumDecodedBytes > MAX_RETAINED_CAPTURE_DECODED_BYTES
  ) {
    throw new Error('response bundle decoded-byte limit is invalid');
  }
  let bytes;
  try {
    bytes = gunzipSync(compressed, { maxOutputLength: maximumDecodedBytes });
  } catch {
    throw new Error('response bundle is invalid gzip data or exceeds its decoded-byte limit');
  }
  if (bytes.subarray(0, RESPONSE_BUNDLE_MAGIC.length).toString() !== RESPONSE_BUNDLE_MAGIC) {
    throw new Error('response bundle has invalid magic');
  }
  let offset = RESPONSE_BUNDLE_MAGIC.length;
  if (offset + 4 > bytes.length) throw new Error('response bundle is truncated');
  const noticeLength = bytes.readUInt32LE(offset);
  offset += 4;
  if (offset + noticeLength + 4 > bytes.length) throw new Error('response bundle is truncated');
  let notice;
  try {
    notice = JSON.parse(bytes.subarray(offset, offset + noticeLength).toString('utf8'));
  } catch {
    throw new Error('response bundle has invalid attribution metadata');
  }
  if (!sameJson(notice, responseBundleNotice)) {
    throw new Error('response bundle lacks exact OSM attribution and ODbL identity');
  }
  offset += noticeLength;
  const count = bytes.readUInt32LE(offset);
  offset += 4;
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (offset + 6 > bytes.length) throw new Error('response bundle header is truncated');
    const idLength = bytes.readUInt16LE(offset);
    const bodyLength = bytes.readUInt32LE(offset + 2);
    offset += 6;
    if (offset + idLength + bodyLength > bytes.length) {
      throw new Error('response bundle entry is truncated');
    }
    const id = bytes.subarray(offset, offset + idLength).toString();
    offset += idLength;
    if (entries.has(id) || id === '') throw new Error('response bundle repeats an invalid id');
    entries.set(id, Buffer.from(bytes.subarray(offset, offset + bodyLength)));
    offset += bodyLength;
  }
  if (offset !== bytes.length) throw new Error('response bundle has trailing bytes');
  return entries;
}

function parseResponseBody(bytes, id) {
  let body;
  try {
    body = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`response ${id} is not JSON`);
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray(body.elements) ||
    typeof body.remark === 'string'
  ) {
    throw new Error(`response ${id} is not an accepted Overpass result`);
  }
  const osmBase = canonicalTimestamp(body.osm3s?.timestamp_osm_base, `response ${id} osm_base`);
  assertSelectedElementSnapshots(body, `response ${id}`);
  return { body, osmBase };
}

const responseMetadata = (entry) => {
  const { body, osmBase } = parseResponseBody(entry.body, entry.id);
  return {
    id: entry.id,
    role: entry.role,
    endpoint: entry.endpoint,
    requestSha256: sha256(requestBytes(entry.query)),
    transportSha256: entry.transportSha256,
    transportBytes: entry.transportBytes,
    responseSha256: sha256(entry.body),
    responseBytes: entry.body.length,
    osmBase,
    elementCount: body.elements.length,
  };
};

function exactCaptureImplementationFiles(files) {
  if (
    !Array.isArray(files) ||
    files.length !== CAPTURE_IMPLEMENTATION_PATHS.length ||
    files.some(
      (file, index) =>
        !exactKeys(file, ['path', 'bytes', 'sha256']) ||
        file.path !== CAPTURE_IMPLEMENTATION_PATHS[index] ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        !/^[0-9a-f]{64}$/.test(file.sha256 ?? ''),
    )
  ) {
    throw new Error('capture has no exact local implementation identity');
  }
  return files.map((file) => ({ ...file }));
}

const captureImplementation = (localFiles) => ({
  upstream: {
    repository: PINNED_UPSTREAM.repository,
    commit: PINNED_UPSTREAM.commit,
    files: PINNED_UPSTREAM.files.map((file) => ({ ...file })),
  },
  localFiles: exactCaptureImplementationFiles(localFiles),
  semanticChanges: [
    'add-positive-longitude-aleutian-seed',
    'expand-puerto-rico-seed-west-from-minus-67.5-to-minus-68',
    'include-case-insensitive-alpr-and-anpr-predicate',
    'retain-and-reparse-every-accepted-response-body',
    'redact-contributor-identity-from-retained-response-bodies',
    'project-retained-tags-to-the-release-field-allowlist',
    'omit-contact-like-values-from-retained-tags',
    'enforce-exact-count-data-probe-consistency',
    'require-distinct-terminal-descendant-union-to-cover-split-parent-count',
    'separate-every-leaf-count-and-data-endpoint',
    'independently-confirm-every-zero-count-with-a-data-query',
    'bind-selected-node-coordinates-to-requested-leaf',
    'retain-canada-and-mexico-area-overlaps-for-census-geofence-adjudication',
    'sort-final-features-by-osm-id-and-type',
  ],
});

const capturePolicy = () => ({
  endpoints: [...OVERPASS_ENDPOINTS],
  splitThreshold: SPLIT_THRESHOLD,
  minimumTileSpan: MIN_TILE_SPAN,
  tileFetchTolerance: TILE_FETCH_TOLERANCE,
  splitCountConservation: 'distinct-terminal-descendant-element-union-gte-parent',
  rawMinimum: RAW_MIN_TOTAL,
  countryMinimums: { CA: CA_AREA_MIN_COUNT, MX: MX_AREA_MIN_COUNT },
  retainedTagKeys: [...RETAINED_TAG_KEYS],
  retainedValuePolicy: 'omit-email-phone-and-url-like-values',
  seedRoots: buildSeedTiles().map((bbox) => ({ id: tileId(bbox), bbox: cloneBox(bbox) })),
});

/**
 * BOTH NEIGHBOURS ANSWERED. The one place that decides it.
 *
 * `finalizeCapture` and `validateCaptureArtifacts` must agree exactly, because
 * this is what separates `foreignCandidateMatches: null` - we did not look -
 * from `0`, which claims we looked at the border overlap and found nothing
 * foreign. They were computed independently and drifted; now they cannot.
 */
const subtractionsWereObtained = (subtractions) =>
  ['CA', 'MX'].every((iso) => subtractions[iso].unavailable === null);

export function finalizeCapture({
  captureId,
  startedAt,
  completedAt,
  countNodes,
  dataLeaves,
  subtractions,
  responses,
  implementationFiles,
}) {
  const start = canonicalTimestamp(startedAt, 'capture start');
  const finish = canonicalTimestamp(completedAt, 'capture completion');
  if (Date.parse(finish) < Date.parse(start)) throw new Error('capture timeline is reversed');
  const responseEntries = [...responses.values()];
  const responseRecords = responseEntries
    .map(responseMetadata)
    .sort((a, b) => a.id.localeCompare(b.id));
  const bodies = new Map(
    responseEntries.map((entry) => [entry.id, parseResponseBody(entry.body, entry.id).body]),
  );
  const sortedDataLeaves = [...dataLeaves].sort((a, b) => a.id.localeCompare(b.id));
  const dataBodies = sortedDataLeaves.map((leaf) => bodies.get(leaf.dataResponseId));
  const subtractionsObtained = subtractionsWereObtained(subtractions);
  const subtractionBodies = ['CA', 'MX']
    .filter((iso) => subtractions[iso].responseId !== null)
    .map((iso) => bodies.get(subtractions[iso].responseId));
  const { collection, rawTotal, foreignCandidateMatches } = rawDatasetFromBodies(
    dataBodies,
    subtractionBodies,
    subtractionsObtained,
  );
  assertRawCaptureMinimum(rawTotal);
  const rawBytes = Buffer.from(JSON.stringify(collection));
  const rawGzip = gzipSync(rawBytes, { level: 9, mtime: 0 });
  const responseBundle = encodeResponseBundle(responseEntries);
  const minimumOsmBase = new Date(
    Math.min(...responseRecords.map((record) => Date.parse(record.osmBase))),
  ).toISOString();
  const roleCounts = { count: 0, data: 0, subtraction: 0 };
  for (const record of responseRecords) roleCounts[record.role] += 1;

  const ledger = {
    schema: RESPONSE_LEDGER_SCHEMA,
    captureId,
    implementation: captureImplementation(implementationFiles),
    capture: { startedAt: start, completedAt: finish, userAgent: OVERPASS_USER_AGENT },
    dataset: 'cameras-us',
    policy: capturePolicy(),
    topology: {
      countNodes: [...countNodes].sort((a, b) => a.id.localeCompare(b.id)),
      dataLeaves: sortedDataLeaves,
      subtractions,
    },
    responses: responseRecords,
    minimumOsmBase,
    roleCounts,
    artifacts: {
      responseBundle: {
        path: RESPONSE_BUNDLE_PATH,
        compression: 'gzip',
        bytes: responseBundle.length,
        sha256: sha256(responseBundle),
        responseCount: responseRecords.length,
      },
      rawDataset: {
        path: RAW_DATASET_PATH,
        format: 'geojson',
        compression: 'gzip',
        bytes: rawGzip.length,
        sha256: sha256(rawGzip),
        decodedBytes: rawBytes.length,
        decodedSha256: sha256(rawBytes),
        featureCount: collection.features.length,
      },
    },
    counts: {
      rawCandidateFeatures: rawTotal,
      caFeatures: subtractions.CA.featureCount,
      mxFeatures: subtractions.MX.featureCount,
      foreignCandidateMatches,
      outputFeatures: collection.features.length,
    },
  };
  const ledgerBytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`);
  return {
    ledger,
    ledgerBytes,
    responseBundle,
    rawGzip,
    rawBytes,
    collection,
    implementationFiles: exactCaptureImplementationFiles(implementationFiles),
  };
}

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validateResponseRecords(ledger, bundleEntries) {
  if (!Array.isArray(ledger.responses) || ledger.responses.length !== bundleEntries.size) {
    throw new Error('capture ledger response inventory does not match its body bundle');
  }
  const responses = new Map();
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  const roles = { count: 0, data: 0, subtraction: 0 };
  const endpoints = new Set();
  for (const record of ledger.responses) {
    if (
      !exactKeys(record, [
        'id',
        'role',
        'endpoint',
        'requestSha256',
        'transportSha256',
        'transportBytes',
        'responseSha256',
        'responseBytes',
        'osmBase',
        'elementCount',
      ]) ||
      responses.has(record.id) ||
      !['count', 'data', 'subtraction'].includes(record.role) ||
      !OVERPASS_ENDPOINTS.includes(record.endpoint) ||
      !/^[0-9a-f]{64}$/.test(record.requestSha256 ?? '') ||
      !/^[0-9a-f]{64}$/.test(record.transportSha256 ?? '') ||
      !Number.isSafeInteger(record.transportBytes) ||
      record.transportBytes < 1 ||
      !/^[0-9a-f]{64}$/.test(record.responseSha256 ?? '')
    ) {
      throw new Error('capture ledger has an invalid response record');
    }
    const bytes = bundleEntries.get(record.id);
    if (
      !bytes ||
      bytes.length !== record.responseBytes ||
      sha256(bytes) !== record.responseSha256
    ) {
      throw new Error(`capture response ${String(record.id)} does not match its retained body`);
    }
    const parsed = parseResponseBody(bytes, record.id);
    const canonicalRetained = retainedResponseBytes(parsed.body);
    if (
      !bytes.equals(canonicalRetained) ||
      parsed.osmBase !== record.osmBase ||
      parsed.body.elements.length !== record.elementCount ||
      Date.parse(parsed.osmBase) > Date.parse(ledger.capture.completedAt)
    ) {
      throw new Error(`capture response ${record.id} metadata was not derived from its body`);
    }
    responses.set(record.id, { record, body: parsed.body });
    roles[record.role] += 1;
    endpoints.add(record.endpoint);
    minimum = Math.min(minimum, Date.parse(parsed.osmBase));
    maximum = Math.max(maximum, Date.parse(parsed.osmBase));
  }
  /*
   * A SUBTRACTION THAT WAS NEVER OBTAINED CONTRIBUTES NO RESPONSE.
   *
   * This demanded exactly two, and that made the 2026-09-07 ruling unreachable:
   * `unobtainedSubtraction` records a CA/MX cross-check no mirror would answer
   * with `responseId: null`, which by construction puts nothing in the bundle.
   * `validateTopology` accepts exactly that record - and then this census, forty
   * lines earlier in the same validation, refused the capture for the absence
   * the other check had just allowed. The two halves of one rule disagreed, and
   * the disagreement was only discoverable at write time, after every request of
   * a national run had been spent. Four runs died that way in two days.
   *
   * MORE than two is still impossible: there are two neighbours, and a third
   * subtraction response is either a duplicate or a query the topology cannot
   * account for. What holds the correspondence together is not this number but
   * the evidence itself - `validateTopology` demands `subtraction:<iso>` bearing
   * the exact subtraction query for every iso whose `unavailable` is null, and
   * the referenced-response census there refuses a bundle carrying a subtraction
   * body the topology does not claim. So a ledger still cannot drop a real
   * subtraction to escape a check, and an unobtained one still cannot pretend to
   * be a zero: `foreignCandidateMatches` goes null, never 0.
   */
  if (
    roles.count < 1 ||
    roles.data < 1 ||
    roles.subtraction > 2 ||
    !sameJson(roles, ledger.roleCounts) ||
    new Date(minimum).toISOString() !== ledger.minimumOsmBase
  ) {
    throw new Error('capture ledger response roles or minimum watermark are incomplete');
  }
  return {
    responses,
    roles,
    endpoints: [...endpoints].sort(),
    maximumOsmBase: new Date(maximum).toISOString(),
  };
}

function responseFor(responses, id, role, query) {
  const found = responses.get(id);
  if (
    !found ||
    found.record.role !== role ||
    found.record.requestSha256 !== sha256(requestBytes(query))
  ) {
    throw new Error(`capture topology has no exact ${role} response for ${id}`);
  }
  return found.body;
}

/** Inclusive child boundaries cannot inflate this distinct-element proof. */
export function assertDistinctSplitCoverage(id, parentCount, descendantFeatureMaps) {
  const distinct = new Set();
  for (const features of descendantFeatureMaps) {
    for (const key of features.keys()) distinct.add(key);
  }
  if (distinct.size < parentCount) {
    throw new Error(`split count node ${id} loses distinct candidates across its descendants`);
  }
  return distinct;
}

/**
 * WHICH COUNT RESPONSE A LEAF IS ALLOWED TO NAME.
 *
 * `count:<tile>` is the planning probe. `recount:<n>:<tile>` is a re-probe: when
 * a leaf's data disagreed with its count, the capture takes a FRESH count so the
 * next attempt compares against a contemporaneous number rather than a frozen
 * one, and that becomes the leaf's count of record.
 *
 * This used to demand `count:<tile>` exactly, which meant a leaf that had ever
 * needed a re-probe could not be written at all - the retry path and the
 * validator disagreed about what a valid capture looks like, and the retry path
 * was the one that had already spent the requests.
 */
function isCountResponseIdFor(responseId, leafId) {
  if (responseId === `count:${leafId}`) return true;
  const reprobe = /^recount:(\d+):(.+)$/.exec(String(responseId));
  return reprobe !== null && reprobe[2] === leafId;
}

function validateTopology(ledger, responses) {
  /* Leaves whose data came from the instance that counted them. Reported, not
     refused - see the note at the push below. */
  const sameInstanceLeaves = [];
  /* Leaves whose planning count had gone stale and was re-probed before the
     data was accepted. Reported for the same reason - see the nonzero-leaf
     arm of the traversal below. */
  const reprobedLeaves = [];
  const countNodes = new Map();
  for (const node of ledger.topology?.countNodes ?? []) {
    if (
      !exactKeys(node, [
        'id',
        'bbox',
        'responseId',
        'count',
        'resolution',
        'children',
        'confirmationResponseId',
      ]) ||
      !exactKeys(node.bbox, ['s', 'w', 'n', 'e']) ||
      Object.values(node.bbox).some((coordinate) => !Number.isFinite(coordinate)) ||
      node.id !== tileId(node.bbox) ||
      node.responseId !== `count:${node.id}` ||
      countNodes.has(node.id) ||
      !Number.isSafeInteger(node.count) ||
      node.count < 0 ||
      !Array.isArray(node.children)
    ) {
      throw new Error('capture count topology contains an invalid node');
    }
    const body = responseFor(responses, node.responseId, 'count', countQuery(node.bbox));
    const total = Number(body.elements?.[0]?.tags?.total);
    if (
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total !== node.count ||
      body.elements.length !== 1
    ) {
      throw new Error(`capture count node ${node.id} disagrees with its retained body`);
    }
    countNodes.set(node.id, node);
  }

  const dataLeaves = new Map();
  const dataLeafFeatures = new Map();
  for (const leaf of ledger.topology?.dataLeaves ?? []) {
    if (
      !exactKeys(leaf, [
        'id',
        'bbox',
        'countResponseId',
        'dataResponseId',
        'probed',
        'featureCount',
      ]) ||
      !exactKeys(leaf.bbox, ['s', 'w', 'n', 'e']) ||
      Object.values(leaf.bbox).some((coordinate) => !Number.isFinite(coordinate)) ||
      leaf.id !== tileId(leaf.bbox) ||
      !isCountResponseIdFor(leaf.countResponseId, leaf.id) ||
      leaf.dataResponseId !== `data:${leaf.id}` ||
      dataLeaves.has(leaf.id) ||
      !Number.isSafeInteger(leaf.probed) ||
      leaf.probed < 1 ||
      !Number.isSafeInteger(leaf.featureCount) ||
      leaf.featureCount < 0
    ) {
      throw new Error('capture data topology contains an invalid leaf');
    }
    const body = responseFor(responses, leaf.dataResponseId, 'data', dataQuery(leaf.bbox));
    const countResponse = responses.get(leaf.countResponseId);
    const dataResponse = responses.get(leaf.dataResponseId);
    /*
     * A LEAF SERVED BY ONE INSTANCE IS RECORDED, NOT REFUSED.
     *
     * This threw. A tile's count and its data are meant to come from different
     * mirrors so no single stale instance can certify itself, and that is still
     * the better answer and still what a healthy run gets - the capture tries
     * the other endpoints first and only falls back when they cannot answer.
     *
     * But refusing here made independence a HARD GATE at the last step, after
     * every request had already been made. On 2026-09-06 a run completed the
     * entire United States - every seed, every leaf, both subtractions - and was
     * then thrown away at `writeCapture` because ONE tile in the US Virgin
     * Islands had been served by the instance that counted it, the other mirror
     * having 504'd. Meanwhile the archive on the site was five days stale.
     *
     * The owner's ruling, 2026-09-06: if one mirror gives us the data then we
     * have the data; a second source is validation, not a freshness gate. So the
     * fact is carried into the receipt for a reviewer to weigh, which is where a
     * judgement about trust belongs, instead of being spent as a veto here.
     *
     * What it costs is exact: for these leaves the exact-count rule below
     * becomes self-consistency rather than cross-mirror agreement, so an
     * instance serving a truncated view agrees with itself. Every other guard
     * still applies - the geofence, the tile-body check, the exact count, and
     * `timestamp_osm_base` having to be a real UTC timestamp.
     */
    if (countResponse?.record.endpoint === dataResponse?.record.endpoint) {
      sameInstanceLeaves.push(leaf.id);
    }
    assertDataBodyMatchesTile(body, leaf.bbox);
    const features = selectedFeatures(body);
    if (
      features.size !== leaf.featureCount ||
      !countProbeIsConsistent(leaf.probed, features.size, leaf.bbox)
    ) {
      throw new Error(`capture data leaf ${leaf.id} fails its retained count probe`);
    }
    dataLeaves.set(leaf.id, leaf);
    dataLeafFeatures.set(leaf.id, features);
  }

  const reachable = new Set();
  const pending = ledger.policy.seedRoots.map((root) => root.id);
  while (pending.length > 0) {
    const id = pending.pop();
    if (reachable.has(id)) throw new Error(`capture topology reaches ${id} more than once`);
    reachable.add(id);
    const node = countNodes.get(id);
    if (!node) throw new Error(`capture topology omits count node ${id}`);
    const span = Math.min(node.bbox.n - node.bbox.s, node.bbox.e - node.bbox.w);
    const shouldSplit = node.count > SPLIT_THRESHOLD && span > MIN_TILE_SPAN;
    if (node.count === 0) {
      const confirmationId = `zero:${node.id}`;
      const confirmation = responses.get(confirmationId);
      const countResponse = responses.get(node.responseId);
      const confirmationBody = responseFor(responses, confirmationId, 'data', dataQuery(node.bbox));
      assertDataBodyMatchesTile(confirmationBody, node.bbox);
      /*
       * A ZERO CONFIRMED BY ITS OWN COUNTER IS RECORDED, NOT REFUSED.
       *
       * The same relaxation as the data leaves above, which is the point: the
       * 2026-09-06 ruling was applied there and not here, and the two halves of
       * the capture then contradicted each other at opposite ends of a run.
       * `queryOverpassCandidate` DEMOTES the counting endpoint rather than
       * filtering it - deliberately, because filtering is what killed the run
       * that had a healthy primary forbidden from answering - so
       * `captureZeroConfirmation` asks for an independent mirror, silently falls
       * back to the counting one when nothing else answers, and the ledger then
       * detonated here at write time with every request already spent. One
       * unlucky ocean tile out of about 28 seeds was enough, with all mirrors up.
       *
       * WHAT IS UNCHANGED IS THE PROOF ITSELF. A zero still has to be confirmed
       * by a real data query over the same bbox that returns no selected
       * feature, and `assertDataBodyMatchesTile` still binds that body to this
       * tile. Only the identity of the mirror that answered has stopped being a
       * veto, and it is carried out to the receipt so a reviewer weighs it -
       * `sameInstanceLeaves` covers count/data pairs and count/zero pairs alike,
       * because they are the same fact: this tile rests on one instance's word.
       */
      if (confirmation?.record.endpoint === countResponse?.record.endpoint) {
        sameInstanceLeaves.push(node.id);
      }
      if (
        node.resolution !== 'zero' ||
        node.children.length !== 0 ||
        dataLeaves.has(id) ||
        node.confirmationResponseId !== confirmationId ||
        selectedFeatures(confirmationBody).size !== 0
      ) {
        throw new Error(`zero count node ${id} has an invalid resolution`);
      }
    } else if (shouldSplit) {
      const children = splitTile(node.bbox).map(tileId);
      if (
        node.resolution !== 'split' ||
        node.confirmationResponseId !== null ||
        !sameJson(node.children, children) ||
        dataLeaves.has(id)
      ) {
        throw new Error(`split count node ${id} does not resolve to exact quadrants`);
      }
      // The four child boxes cover their parent and share inclusive borders.
      // Their sum can exceed the parent when a point lies on a split line, but
      // a smaller sum proves that at least one retained count response lost
      // candidates. Churn or mirror skew must restart a release capture rather
      // than turn that loss into an approved baseline.
      const childTotal = children.reduce((total, childId) => {
        const child = countNodes.get(childId);
        if (child === undefined) {
          throw new Error(`capture topology omits split child ${childId}`);
        }
        return total + BigInt(child.count);
      }, 0n);
      if (childTotal < BigInt(node.count)) {
        throw new Error(`split count node ${id} loses candidates across its children`);
      }
      pending.push(...children);
    } else {
      const leaf = dataLeaves.get(id);
      if (
        node.resolution !== 'data' ||
        node.confirmationResponseId !== null ||
        node.children.length !== 0 ||
        !leaf
      ) {
        throw new Error(`nonzero leaf ${id} has no exact accepted data response`);
      }
      /*
       * THE COUNT THAT AUTHORISED THE DATA, WHICH IS NOT ALWAYS THE PLANNING ONE.
       *
       * `captureDataLeaf` RE-PROBES a leaf whose planning count no longer
       * matches the data it just fetched, and accepts the data on the next
       * attempt against that fresh count -- which is the honest ordering, since
       * a count taken before the data cannot speak for churn that happened in
       * between. The leaf then records the re-probe's number and response id,
       * and `isCountResponseIdFor` above deliberately admits a `recount:` id.
       *
       * This arm demanded identity with the PLANNING node anyway. The two
       * halves of one validator therefore disagreed about the same shape, and
       * the disagreement was only reachable after every request in a national
       * run had been spent: 2026-09-08, ninety-one of ninety-one leaves
       * captured, both subtractions obtained, discarded at `writeCapture` on
       * one tile in Maine whose count moved while the run was in flight. That
       * is the same failure as the three in `fix(capture)` #46 and it is fixed
       * the same way -- by making the check say what the capture actually
       * promises.
       *
       * WHAT IS UNCHANGED IS THE PROOF. The authorising count must still be a
       * retained `out count` response over EXACTLY this tile's bbox, and the
       * number the leaf claims must still be the number that response returned;
       * `countProbeIsConsistent` above already required the data to equal it
       * exactly. A re-probe is a second observation, not a licence to disagree,
       * and it is carried to the receipt so a reviewer can see which tiles
       * moved.
       */
      if (leaf.countResponseId === node.responseId) {
        if (leaf.probed !== node.count) {
          throw new Error(`nonzero leaf ${id} disagrees with its own count node`);
        }
      } else {
        const reprobe = responseFor(responses, leaf.countResponseId, 'count', countQuery(node.bbox));
        const total = Number(reprobe.elements?.[0]?.tags?.total);
        if (
          reprobe.elements.length !== 1 ||
          !Number.isSafeInteger(total) ||
          total !== leaf.probed
        ) {
          throw new Error(`re-probed leaf ${id} disagrees with its retained count body`);
        }
        reprobedLeaves.push(id);
      }
    }
  }
  if (
    reachable.size !== countNodes.size ||
    dataLeaves.size !== [...countNodes.values()].filter((node) => node.resolution === 'data').length
  ) {
    throw new Error('capture topology contains unreachable or extra nodes');
  }

  const descendantFeatures = new Map();
  const collectDescendantFeatures = (id) => {
    if (descendantFeatures.has(id)) return descendantFeatures.get(id);
    const node = countNodes.get(id);
    let features;
    if (node.resolution === 'zero') {
      features = new Map();
    } else if (node.resolution === 'data') {
      features = dataLeafFeatures.get(id);
    } else {
      features = assertDistinctSplitCoverage(
        id,
        node.count,
        node.children.map((childId) => collectDescendantFeatures(childId)),
      );
    }
    descendantFeatures.set(id, features);
    return features;
  };
  for (const root of ledger.policy.seedRoots) collectDescendantFeatures(root.id);

  const subtractions = ledger.topology?.subtractions;
  if (!exactKeys(subtractions, ['CA', 'MX'])) throw new Error('capture omits CA/MX subtraction');
  const subtractionBodies = [];
  for (const [iso, minimum] of [
    ['CA', CA_AREA_MIN_COUNT],
    ['MX', MX_AREA_MIN_COUNT],
  ]) {
    const entry = subtractions[iso];
    if (
      !exactKeys(entry, ['iso', 'responseId', 'featureCount', 'minimum', 'unavailable']) ||
      entry.iso !== iso ||
      entry.minimum !== minimum
    ) {
      throw new Error(`capture has an invalid ${iso} subtraction record`);
    }
    /*
     * AN UNOBTAINED CROSS-CHECK IS A RECORDED FACT, NOT A REFUSAL.
     *
     * The subtraction does not decide which cameras ship - the Census county
     * geofence does, in `sourceTerritoryIncludes`. This is the corroborating
     * measurement, and on 2026-09-06/07 it was the only thing standing between
     * a five-day-stale archive and a completed capture: four separate runs
     * finished every seed and every leaf and then died on one of these two
     * queries, because the only areas-capable mirrors were variously absent,
     * serving a quarter of the truth, or 504ing under the capture's own load.
     *
     * Owner's ruling, 2026-09-07: United States only for now; a second source
     * is validation, not a gate. So `unavailable` carries the endpoint's own
     * sentence and the receipt says the check did not happen. It is deliberately
     * NOT possible to record an unavailable subtraction as a zero count - that
     * would read as "we looked at the border overlap and found nothing
     * foreign", which is a claim about the world rather than about our data.
     */
    if (entry.unavailable !== null) {
      if (
        typeof entry.unavailable !== 'string' ||
        entry.unavailable.length === 0 ||
        entry.responseId !== null ||
        entry.featureCount !== null
      ) {
        throw new Error(`capture has an invalid unavailable ${iso} subtraction record`);
      }
      continue;
    }
    if (entry.responseId !== `subtraction:${iso}`) {
      throw new Error(`capture has an invalid ${iso} subtraction record`);
    }
    const body = responseFor(responses, entry.responseId, 'subtraction', subtractionQuery(iso));
    const count = selectedFeatures(body).size;
    if (count !== entry.featureCount || count < minimum) {
      throw new Error(`capture ${iso} subtraction disagrees with its response body`);
    }
    subtractionBodies.push(body);
  }

  const referenced = new Set();
  for (const node of countNodes.values()) {
    referenced.add(node.responseId);
    if (node.confirmationResponseId !== null) referenced.add(node.confirmationResponseId);
  }
  for (const leaf of dataLeaves.values()) {
    referenced.add(leaf.dataResponseId);
    /*
     * AND THE COUNT THAT AUTHORISED IT, WHICH IS NOT ALWAYS THE PLANNING ONE.
     *
     * A re-probe is `accept()`ed into the ledger like any other observation, so
     * leaving it out of this set made every re-probed capture fail as "bundle
     * has unreferenced or missing responses" -- the same stale-count shape the
     * nonzero-leaf arm above refused, caught by a second guard a few lines
     * later. When the leaf was authorised by its planning count this adds an id
     * the loop above already holds and the set is unchanged.
     */
    referenced.add(leaf.countResponseId);
  }
  /* A subtraction that was never obtained references no response. */
  if (subtractions.CA.responseId !== null) referenced.add(subtractions.CA.responseId);
  if (subtractions.MX.responseId !== null) referenced.add(subtractions.MX.responseId);
  if (
    referenced.size !== responses.size ||
    [...responses.keys()].some((id) => !referenced.has(id))
  ) {
    throw new Error('capture response bundle has unreferenced or missing responses');
  }
  return {
    dataBodies: [...dataLeaves.values()].map((leaf) => responses.get(leaf.dataResponseId).body),
    subtractionBodies,
    subtractions,
    /*
     * WHETHER THE CROSS-CHECK RAN, DERIVED HERE AND NOWHERE ELSE.
     *
     * `finalizeCapture` computes this identically from the same two records and
     * hands it to `rawDatasetFromBodies`; the validator rebuilding the dataset
     * has to reach the same answer or the two disagree about whether a null
     * `foreignCandidateMatches` was earned. It is returned rather than
     * recomputed at the call site so the pair cannot drift apart again.
     */
    subtractionsObtained: subtractionsWereObtained(subtractions),
    /* For the receipt, and therefore for whoever reviews it. */
    sameInstanceLeaves: [...sameInstanceLeaves].sort(),
    reprobedLeaves: [...reprobedLeaves].sort(),
  };
}

export function validateCaptureArtifacts(
  ledger,
  { ledgerBytes, responseBundle, rawDataset, implementationFiles, retainedArtifactVisitor = null },
) {
  if (retainedArtifactVisitor !== null && typeof retainedArtifactVisitor !== 'function') {
    throw new Error('retained capture artifact visitor must be a function');
  }
  if (
    !exactKeys(ledger, [
      'schema',
      'captureId',
      'implementation',
      'capture',
      'dataset',
      'policy',
      'topology',
      'responses',
      'minimumOsmBase',
      'roleCounts',
      'artifacts',
      'counts',
    ]) ||
    ledger.schema !== RESPONSE_LEDGER_SCHEMA ||
    typeof ledger.captureId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      ledger.captureId,
    ) ||
    ledger.dataset !== 'cameras-us' ||
    !sameJson(ledger.implementation, captureImplementation(implementationFiles)) ||
    !exactKeys(ledger.capture, ['startedAt', 'completedAt', 'userAgent']) ||
    ledger.capture.userAgent !== OVERPASS_USER_AGENT ||
    canonicalTimestamp(ledger.capture.startedAt) !== ledger.capture.startedAt ||
    canonicalTimestamp(ledger.capture.completedAt) !== ledger.capture.completedAt ||
    Date.parse(ledger.capture.completedAt) < Date.parse(ledger.capture.startedAt) ||
    !sameJson(ledger.policy, capturePolicy()) ||
    !Buffer.from(ledgerBytes).equals(Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`))
  ) {
    throw new Error('capture ledger does not identify the pinned query implementation');
  }

  const ledgerIdentity = {
    path: RESPONSE_LEDGER_PATH,
    bytes: ledgerBytes.length,
    sha256: sha256(ledgerBytes),
  };
  const expectedBundle = ledger.artifacts?.responseBundle;
  if (
    !exactKeys(expectedBundle, ['path', 'compression', 'bytes', 'sha256', 'responseCount']) ||
    expectedBundle.path !== RESPONSE_BUNDLE_PATH ||
    expectedBundle.compression !== 'gzip' ||
    expectedBundle.bytes !== responseBundle.length ||
    expectedBundle.sha256 !== sha256(responseBundle)
  ) {
    throw new Error('capture response bundle does not match its ledger identity');
  }
  const bundleEntries = decodeResponseBundle(responseBundle);
  if (bundleEntries.size !== expectedBundle.responseCount) {
    throw new Error('capture response bundle count does not match its ledger');
  }
  const canonicalBundle = encodeResponseBundle(
    [...bundleEntries].map(([id, body]) => ({ id, body })),
  );
  if (!canonicalBundle.equals(responseBundle)) {
    throw new Error('capture response bundle is not canonical deterministic gzip');
  }
  const { responses, roles, endpoints, maximumOsmBase } = validateResponseRecords(
    ledger,
    bundleEntries,
  );
  const topology = validateTopology(ledger, responses);
  /*
   * THE THIRD ARGUMENT IS NOT OPTIONAL HERE, WHATEVER ITS DEFAULT SAYS.
   *
   * It was omitted, so this defaulted to `subtractionsObtained: true` and
   * computed `foreignCandidateMatches: 0` for a run that never obtained the
   * cross-check. `finalizeCapture` had written `null` - we did not look - and
   * the comparison below found 0 !== null and threw "not exactly reproducible"
   * on a capture that was perfectly reproducible. A finished national run was
   * unwritable for one missing parameter.
   */
  const rebuilt = rawDatasetFromBodies(
    topology.dataBodies,
    topology.subtractionBodies,
    topology.subtractionsObtained,
  );
  assertRawCaptureMinimum(rebuilt.rawTotal);
  if (
    rebuilt.collection.attribution !== OSM_ATTRIBUTION ||
    rebuilt.collection.licence !== OSM_LICENCE ||
    rebuilt.collection.licenceUrl !== OSM_LICENCE_URL
  ) {
    throw new Error('capture raw dataset lacks embedded OSM attribution or ODbL identity');
  }
  const expectedRaw = ledger.artifacts?.rawDataset;
  if (
    !exactKeys(expectedRaw, [
      'path',
      'format',
      'compression',
      'bytes',
      'sha256',
      'decodedBytes',
      'decodedSha256',
      'featureCount',
    ]) ||
    expectedRaw.path !== RAW_DATASET_PATH ||
    expectedRaw.format !== 'geojson' ||
    expectedRaw.compression !== 'gzip' ||
    expectedRaw.bytes !== rawDataset.length ||
    expectedRaw.sha256 !== sha256(rawDataset) ||
    !Number.isSafeInteger(expectedRaw.decodedBytes) ||
    expectedRaw.decodedBytes < 1 ||
    expectedRaw.decodedBytes > MAX_RETAINED_CAPTURE_DECODED_BYTES ||
    !/^[0-9a-f]{64}$/.test(expectedRaw.decodedSha256 ?? '') ||
    !Number.isSafeInteger(expectedRaw.featureCount) ||
    expectedRaw.featureCount < RAW_MIN_TOTAL
  ) {
    throw new Error('capture raw dataset has an invalid bounded identity');
  }
  const rebuiltBytes = Buffer.from(JSON.stringify(rebuilt.collection));
  let decodedRaw;
  try {
    decodedRaw = gunzipSync(rawDataset, {
      maxOutputLength: expectedRaw.decodedBytes,
    });
  } catch {
    throw new Error('capture raw dataset is invalid gzip data or exceeds its decoded-byte limit');
  }
  if (
    expectedRaw.decodedBytes !== decodedRaw.length ||
    expectedRaw.decodedSha256 !== sha256(decodedRaw) ||
    !decodedRaw.equals(rebuiltBytes) ||
    expectedRaw.featureCount !== rebuilt.collection.features.length ||
    !sameJson(ledger.counts, {
      rawCandidateFeatures: rebuilt.rawTotal,
      caFeatures: topology.subtractions.CA.featureCount,
      mxFeatures: topology.subtractions.MX.featureCount,
      foreignCandidateMatches: rebuilt.foreignCandidateMatches,
      outputFeatures: rebuilt.collection.features.length,
    })
  ) {
    throw new Error('capture raw dataset is not exactly reproducible from retained responses');
  }
  if (!gzipSync(rebuiltBytes, { level: 9, mtime: 0 }).equals(rawDataset)) {
    throw new Error('capture raw dataset is not canonical deterministic gzip');
  }
  if (retainedArtifactVisitor !== null) {
    for (const [id, bytes] of bundleEntries) {
      retainedArtifactVisitor(`${RESPONSE_BUNDLE_PATH}#${id}`, bytes);
    }
    retainedArtifactVisitor(`${RAW_DATASET_PATH}#decoded`, decodedRaw);
  }
  return {
    ledgerIdentity,
    minimumOsmBase: ledger.minimumOsmBase,
    maximumOsmBase,
    roleCounts: roles,
    endpoints,
    /* Tiles whose data came from the instance that counted them. Empty on a
       healthy run. A reviewer weighs this; it is no longer a veto. */
    sameInstanceLeaves: topology.sameInstanceLeaves,
    /* Tiles whose count moved while the run was in flight and were re-probed
       before their data was accepted. Also weighed, not vetoed. */
    reprobedLeaves: topology.reprobedLeaves,
    responseBundle: { ...expectedBundle },
    rawDataset: { ...expectedRaw },
    collection: rebuilt.collection,
  };
}

export const captureSha256 = sha256;
