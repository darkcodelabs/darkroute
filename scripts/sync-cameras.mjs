/**
 * THE FRESHNESS PATROL - keep the camera table current from OSM replication diffs.
 *
 * =============================================================================
 * WHY NOT OVERPASS
 * =============================================================================
 * `fetch-cameras.mjs` REFUSES to run from a scheduled context, and it is right
 * to: the Overpass project's published usage policy names country-scale
 * scheduled polling as prohibited, in writing. So the repo has been correct
 * about not doing the wrong thing, and has had no way to do the right thing --
 * which is why the dataset is a manual snapshot rather than anything evergreen.
 *
 * OSM publishes replication diffs for automated consumers on OSMF-operated
 * infrastructure. The hourly stream is the supported scheduled path; its
 * sequence and publication timestamps define freshness, not a wall-clock SLA.
 * See `docs/public/AGGREGATION-POLICY.md#freshness-and-publication`.
 *
 * =============================================================================
 * THE TRAP THIS FILE EXISTS TO AVOID: AN ABSENT NODE IS NOT A DELETED NODE
 * =============================================================================
 * Two facts from the OsmChange specification make the obvious design impossible.
 *
 * ONE: deletions carry no tags. "for deletion, an element only needs its id,
 * changeset and version fields filled out. The position and tags should be
 * omitted." So a <delete> for a camera is indistinguishable from a <delete> for
 * a park bench, and any pipeline shaped `filter surveillance:type=ALPR → apply`
 * sees ZERO camera removals, forever. `osmium tags-filter`'s own manual says
 * flatly: "The command can not be used on change files."
 *
 * TWO: retagging is equally invisible. Actions apply at element level, not tag
 * level, so a mapper removing `surveillance:type=ALPR` arrives as a <modify>
 * whose new tags do not match the filter -- dropped by a tag filter, and the
 * camera lives in our database forever.
 *
 * The fix is to drive everything from OUR OWN ID SET rather than from tags: we
 * never need the delete record to tell us it was a camera, only to ask "is this
 * id one of ours". And the tempting shortcut -- re-fetch a region, delete what
 * is missing -- is the one that wipes the map, because a truncated response, a
 * bad bbox or an instance returning 200 with zero elements all look exactly
 * like "every camera here was removed."
 *
 *   RULE 0: absence is never evidence of deletion.
 *
 * =============================================================================
 * A DEGRADED REPLAY GUARD, STATED HONESTLY
 * =============================================================================
 * Rule 2 wants a stored `version` per camera so a replayed diff cannot move a
 * record backwards. The committed dataset has NONE -- sampling 5,159 records
 * found zero with `osmVersion`, because it was captured before the generator
 * asked Overpass for `out meta`.
 *
 * So the guard runs degraded until a re-bootstrap: an unknown stored version is
 * treated as 0, and any incoming version wins. That is safe in the normal path,
 * because diffs are applied strictly in sequence order and never replayed --
 * the guard is belt to the sequence watermark's braces. It is recorded in the
 * state file and printed on every run, because a safety rail that is quietly
 * off is worse than one that is loudly off.
 */

import { createGunzip } from 'node:zlib';
import { get as httpsGet } from 'node:https';
import { Readable } from 'node:stream';
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import sax from 'sax';

// The record shape and the tile placement are the FETCHER'S, imported rather
// than restated. Two definitions of "which tile does this camera belong in"
// is exactly the drift this project has been burned by -- and it would put a
// camera and the road it sits on in different tiles.
import {
  ATTRIBUTION,
  CARRIED_FORWARD,
  DEFAULT_COUNTY_GEOFENCE,
  DEFAULT_OUT_DIR,
  LICENCE,
  LICENCE_URL,
  US_BBOX,
  assertSafeCameraTarget,
  buildCameraOverview,
  latLonToTile,
  normalise,
  normaliseCoordinate,
  releaseGeofenceIdentity,
  resolveCameraTarget,
} from './fetch-cameras.mjs';
import { countyLabel, loadCountiesBytes } from './counties.mjs';

export const OSM_REPLICATION_ROOT =
  'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication';
const S3 = OSM_REPLICATION_ROOT;
const STREAM = 'hour';
export const DEFAULT_STATE_FILE = 'scripts/camera-sync-state.json';
export { DEFAULT_COUNTY_GEOFENCE };
const TILE_ZOOM = 11;

/**
 * The circuit breaker, grounded in measured churn.
 *
 * The patrol measured 0.83%/week, about 0.12%/day. A run that would tombstone
 * more than 1% of live cameras is therefore roughly 8x the daily churn and is
 * far more likely to be a bug in this file than a real event. Both numbers are
 * overridable, and the observed rate is logged every run so the threshold can
 * be tuned against reality rather than against one metro's sample.
 */
const MAX_TOMBSTONE_FRACTION = 0.01;
const MAX_TOMBSTONE_ABSOLUTE = 500;

/**
 * And a ceiling on ADDITIONS, because the breaker only ever watched removals.
 *
 * The bug it was written after was an ADDITION bug: with no geographic filter
 * the patrol ingested every ALPR camera on earth, 288 upserts in six hours with
 * the first one in Vancouver. A breaker that counts only tombstones would have
 * watched that happen and reported all clear.
 *
 * Sized well above real growth. Measured US churn is ~0.12%/day of a 131k
 * dataset, and a catch-up run may legitimately carry a day of diffs plus a bulk
 * city import, so this is deliberately loose -- it is a tripwire for a broken
 * filter, not a growth cap.
 */
const MAX_UPSERT_ABSOLUTE = 5_000;

/**
 * How far an existing camera may MOVE in one run before that is an anomaly.
 *
 * An upsert can relocate a record, and a bug that moves every camera is as
 * destructive as one that deletes them -- a driver is warned in the wrong place
 * and not warned in the right one -- while the breaker, which counts only
 * tombstones, sees nothing at all.
 *
 * Real edits do move nodes: a mapper correcting a position from imagery
 * routinely shifts one by tens of metres. Kilometres is not a correction, it is
 * a coordinate bug or a mismatched id.
 */
const MAX_MOVE_M = 2_000;
const MAX_MOVED_CAMERAS = 250;

/** Metres between two positions. Flat-earth is ample at this threshold. */
function metresBetween(aLat, aLon, bLat, bLon) {
  const latRad = ((aLat + bLat) / 2) * (Math.PI / 180);
  const x = (bLon - aLon) * (Math.PI / 180) * Math.cos(latRad);
  const y = (bLat - aLat) * (Math.PI / 180);
  return Math.hypot(x, y) * 6_378_137;
}

/**
 * How many diffs one run will attempt.
 *
 * Bounds the work so a run always terminates. Safe only because the watermark
 * now records what was APPLIED rather than the head -- with the old behaviour a
 * bounded run silently skipped everything it did not reach. Twenty-four hourly
 * diffs is a day of catch-up per run, which converges after any realistic
 * outage without risking the workflow's timeout.
 */
const MAX_DIFFS_PER_RUN = 24;
export const TOMBSTONE_REASONS = Object.freeze([
  'osm_delete',
  'osm_untag',
  'osm_out_of_scope',
  'cutover_reconciliation',
]);

/**
 * Coarse prefilter for the dataset's footprint.
 *
 * The replication stream is GLOBAL. Without this the patrol ingests every ALPR
 * camera on earth into a US dataset -- measured, before this existed: 288
 * upserts in six hours against a national churn of ~158 a day, the first one in
 * Vancouver. The cheap latitude band uses the full longitude range because the
 * Aleutians cross the antimeridian. It therefore contains Canada, Mexico, and
 * other countries; production combines it with the vendored Census county
 * polygon index below. Deletions are deliberately NOT filtered by either:
 * those are matched by id, which is the whole point of RULE 1.
 */
export function insideBoundingFootprint(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= US_BBOX.south && lat <= US_BBOX.north && lon >= US_BBOX.west && lon <= US_BBOX.east;
}

/**
 * Exact admission policy for qualifying upserts from the global stream.
 *
 * Every qualifying upsert, new or known, must fall inside a US
 * county/county-equivalent polygon. The reviewed baseline uses the same strict
 * rule, so there is no offshore identity exception that could become a passport
 * for a later move across an international border.
 */
export function createTerritorialFootprint(countyIndex) {
  if (
    typeof countyIndex !== 'object' ||
    countyIndex === null ||
    !Array.isArray(countyIndex.counties) ||
    countyIndex.counties.length === 0 ||
    typeof countyIndex.lookup !== 'function'
  ) {
    throw new Error('camera territorial geofence has no county polygons');
  }
  return (lat, lon) => {
    const canonicalLat = normaliseCoordinate(lat);
    const canonicalLon = normaliseCoordinate(lon);
    if (!insideBoundingFootprint(canonicalLat, canonicalLon)) return false;
    return countyIndex.lookup(canonicalLat, canonicalLon) !== null;
  };
}

/** What makes a node one of ours. Kept in step with `fetch-cameras.mjs`. */
export function qualifies(tags) {
  if (tags === undefined || tags === null) return false;
  if (tags.man_made !== 'surveillance') return false;
  const type = (tags['surveillance:type'] ?? '').toUpperCase();
  return type === 'ALPR' || type === 'ANPR';
}

/**
 * THE RULE TABLE, as a pure function.
 *
 * Extracted so it can be tested without a network. This is the
 * highest-consequence logic in the repo -- it decides what gets removed from a
 * counter-surveillance dataset -- and it had no tests at all, while a 165-line
 * street lookup next to it had 113 lines of them. Every bug found in the first
 * re-audit (a double-prefixed id, way ids colliding with node ids, a footprint
 * check that deleted Hawaii) is one fixture away from being caught here.
 *
 * `known` is the record we already hold for this id, or undefined.
 * Returns one of:
 *   { kind: 'ignore' }                    nothing to do
 *   { kind: 'upsert' }                    it is a camera in our footprint
 *   { kind: 'tombstone', reason }         it must be removed
 */
export function decide(element, known, inside = insideBoundingFootprint) {
  // NODES ONLY. OSM ids are unique only within an element type, and the stream
  // carries all three -- 210 camera ids fall inside the live WAY id range, so
  // a deleted building could tombstone a camera in another state.
  if (element.type !== 'node') return { kind: 'ignore' };

  const stored = Number(known?.osmVersion ?? 0);
  // RULE 2, replay guard. Degraded while stored versions are mostly absent.
  if (known !== undefined && element.version > 0 && element.version <= stored) {
    return { kind: 'ignore' };
  }

  if (element.action === 'delete') {
    // RULE 1: the delete record need not tell us it was a camera.
    return known === undefined ? { kind: 'ignore' } : { kind: 'tombstone', reason: 'osm_delete' };
  }

  if (
    (element.action !== 'create' && element.action !== 'modify') ||
    typeof element.lat !== 'number' ||
    !Number.isFinite(element.lat) ||
    element.lat < -90 ||
    element.lat > 90 ||
    typeof element.lon !== 'number' ||
    !Number.isFinite(element.lon) ||
    element.lon < -180 ||
    element.lon > 180
  ) {
    throw new Error('non-delete camera diff element has invalid action or coordinates');
  }

  const canonicalLat = normaliseCoordinate(element.lat);
  const canonicalLon = normaliseCoordinate(element.lon);
  const isCamera = qualifies(element.tags);
  const inTerritory = inside(canonicalLat, canonicalLon, known);

  if (isCamera && inTerritory) return { kind: 'upsert' };

  // An unknown foreign node is irrelevant. A newer version of a node we hold
  // that moved beyond the strict US/PR polygons is an ordered removal from this
  // dataset; ignoring it would preserve stale coordinates while advancing the
  // replication watermark past the only event that could correct them.
  if (isCamera && !inTerritory) {
    return known === undefined
      ? { kind: 'ignore' }
      : { kind: 'tombstone', reason: 'osm_out_of_scope' };
  }

  // A modify that no longer qualifies as a camera: the retagging case a tag
  // filter structurally cannot see.
  return known === undefined ? { kind: 'ignore' } : { kind: 'tombstone', reason: 'osm_untag' };
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

function carriedBasePointer(state) {
  return state?.basePointer === undefined ? {} : { basePointer: state.basePointer };
}

export function firstRunState(head, prior = null) {
  return {
    stream: STREAM,
    lastAppliedSeq: head.seq,
    lastAppliedTimestamp: head.timestamp,
    versionsKnown: false,
    ...carriedBasePointer(prior),
  };
}

export function advancedSyncState(state, appliedThrough, appliedTimestamp, lastRun) {
  return {
    stream: STREAM,
    lastAppliedSeq: appliedThrough,
    lastAppliedTimestamp: appliedTimestamp,
    versionsKnown: state.versionsKnown === true,
    lastRun,
    ...carriedBasePointer(state),
  };
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return false;
  return parsed.toISOString() === value || parsed.toISOString().replace('.000Z', 'Z') === value;
}

const sameTimestamp = (left, right) =>
  validTimestamp(left) && validTimestamp(right) && Date.parse(left) === Date.parse(right);

export function validateSyncState(state, label = 'camera sync state') {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new Error(`${label} is not an object`);
  }
  const allowed = new Set([
    'stream',
    'lastAppliedSeq',
    'lastAppliedTimestamp',
    'versionsKnown',
    'lastRun',
    'basePointer',
  ]);
  for (const key of Object.keys(state)) {
    if (!allowed.has(key)) throw new Error(`${label} has unexpected field ${key}`);
  }
  if (state.stream !== STREAM) throw new Error(`${label} stream must be ${STREAM}`);
  const firstRun = state.lastAppliedSeq === null && state.lastAppliedTimestamp === null;
  const established =
    Number.isSafeInteger(state.lastAppliedSeq) &&
    state.lastAppliedSeq >= 0 &&
    validTimestamp(state.lastAppliedTimestamp);
  if (!firstRun && !established) {
    throw new Error(`${label} has an invalid sequence/timestamp pair`);
  }
  if (typeof state.versionsKnown !== 'boolean') {
    throw new Error(`${label} versionsKnown must be boolean`);
  }
  if (Object.hasOwn(state, 'lastRun') && !validTimestamp(state.lastRun)) {
    throw new Error(`${label} lastRun is invalid`);
  }
  if (
    Object.hasOwn(state, 'basePointer') &&
    (typeof state.basePointer !== 'object' ||
      state.basePointer === null ||
      Array.isArray(state.basePointer))
  ) {
    throw new Error(`${label} basePointer must be an object`);
  }
  return state;
}

export function assertSafeStateFile(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('camera state path must be non-empty');
  }
  const stateFile = resolve(value);
  if (stateFile === parse(stateFile).root) {
    throw new Error(`refusing unsafe camera state path ${stateFile}`);
  }
  let component = stateFile;
  while (component !== parse(component).root) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`refusing symlink component in camera state path ${stateFile}`);
    }
    component = dirname(component);
  }
  if (existsSync(stateFile) && !lstatSync(stateFile).isFile()) {
    throw new Error(`camera state path is not a regular file: ${stateFile}`);
  }
  return stateFile;
}

function readState(stateFile) {
  const safeStateFile = assertSafeStateFile(stateFile);
  if (!existsSync(safeStateFile)) {
    return validateSyncState({
      stream: STREAM,
      lastAppliedSeq: null,
      lastAppliedTimestamp: null,
      versionsKnown: false,
    });
  }
  return validateSyncState(JSON.parse(readFileSync(safeStateFile, 'utf8')), safeStateFile);
}

function writeState(stateFile, state) {
  validateSyncState(state);
  const safeStateFile = assertSafeStateFile(stateFile);
  mkdirSync(dirname(safeStateFile), { recursive: true });
  assertSafeStateFile(safeStateFile);
  writeFileSync(safeStateFile, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * The published sequence for a stream.
 *
 * RULE 5: watermarks come from `state.txt`, never from arithmetic. The OSM wiki
 * warns verbatim that "it is not guaranteed that minutely replication files are
 * published every minute, so you cannot rely on simple arithmetic", and that
 * you must not "just fetch diffs by incrementing the sequence number as
 * incomplete diffs may be present beyond the one identified in the state file."
 */
const USER_AGENT = 'DarkRoute/patrol (+https://darkroute.ai)';

/** Parse one replication state file, requiring one usable sequence and timestamp. */
export function parseSequenceState(body, { expectedSeq = null, label = 'state.txt' } = {}) {
  if (typeof body !== 'string') throw new Error(`${label} was not text`);
  const sequences = [...body.matchAll(/^sequenceNumber=(\d+)\r?$/gm)];
  const timestamps = [...body.matchAll(/^timestamp=([^\r\n]+)\r?$/gm)];
  if (sequences.length !== 1) {
    throw new Error(`${label} must carry exactly one sequenceNumber`);
  }
  if (timestamps.length !== 1) {
    throw new Error(`${label} must carry exactly one timestamp`);
  }

  const seq = Number(sequences[0][1]);
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new Error(`${label} carried an invalid sequenceNumber`);
  }
  if (expectedSeq !== null && seq !== expectedSeq) {
    throw new Error(`${label} identified sequence ${String(seq)}, expected ${String(expectedSeq)}`);
  }

  const timestamp = timestamps[0][1].replaceAll('\\:', ':').trim();
  const timestampMs = Date.parse(timestamp);
  const canonicalTimestamp = Number.isNaN(timestampMs)
    ? null
    : new Date(timestampMs).toISOString().replace('.000Z', 'Z');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp) ||
    canonicalTimestamp !== timestamp
  ) {
    throw new Error(`${label} carried an invalid timestamp`);
  }
  // Runtime state, approved receipts, and continuity sidecars use one exact
  // millisecond UTC representation even though OSM state.txt omits `.000`.
  return { seq, timestamp: new Date(timestampMs).toISOString() };
}

export async function fetchSequenceState(url, expectedSeq, fetchFn = fetch) {
  const response = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  if (response.url !== url) {
    throw new Error(`${url}: resolved to an unreviewed URL ${String(response.url)}`);
  }
  return parseSequenceState(await response.text(), { expectedSeq, label: url });
}

export async function currentSequence(fetchFn = fetch) {
  return fetchSequenceState(`${S3}/${STREAM}/state.txt`, null, fetchFn);
}

function sequencePath(seq) {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('invalid replication sequence');
  const padded = String(seq).padStart(9, '0');
  return `${S3}/${STREAM}/${padded.slice(0, 3)}/${padded.slice(3, 6)}/${padded.slice(6)}`;
}

/** Sequence 122160 -> .../hour/000/122/160.state.txt */
export function sequenceStateUrl(seq) {
  return `${sequencePath(seq)}.state.txt`;
}

/** Fetch metadata for one exact numbered diff, rejecting a mismatched response. */
export async function sequenceState(seq, fetchFn = fetch) {
  return fetchSequenceState(sequenceStateUrl(seq), seq, fetchFn);
}

/** The applied sequence, never the moving head, owns the published timestamp. */
export async function resolveAppliedState(appliedThrough, head, fetchFn = fetch) {
  if (appliedThrough === head.seq) return head;
  return sequenceState(appliedThrough, fetchFn);
}

/**
 * Bind a snapshot baseline to the latest replication boundary at or before it.
 *
 * A mixed rebuild can carry records older than its fresh source. Starting the
 * replay after that oldest `index.upstream` silently leaves a deletion gap;
 * starting earlier replays changes the snapshot already incorporates. The
 * persisted sequence must therefore be the exact floor boundary.
 */
export async function assertArchiveContinuity(state, index, stateFor = sequenceState) {
  if (state.lastAppliedSeq === null) return;
  if (!validTimestamp(index?.upstream)) {
    throw new Error('camera index has an invalid upstream baseline');
  }
  const exact = await stateFor(state.lastAppliedSeq);
  if (!sameTimestamp(exact.timestamp, state.lastAppliedTimestamp)) {
    throw new Error(
      `camera watermark timestamp ${state.lastAppliedTimestamp} disagrees with ` +
        `sequence ${String(state.lastAppliedSeq)} timestamp ${exact.timestamp}`,
    );
  }

  const baseline = new Date(index.upstream).valueOf();
  const watermark = new Date(state.lastAppliedTimestamp).valueOf();
  if (watermark > baseline) {
    throw new Error(
      `camera watermark ${state.lastAppliedTimestamp} starts after archive baseline ` +
        `${index.upstream}; replication continuity has a gap`,
    );
  }
  if (watermark < baseline) {
    const next = await stateFor(state.lastAppliedSeq + 1);
    if (new Date(next.timestamp).valueOf() <= baseline) {
      throw new Error(
        `camera watermark ${state.lastAppliedTimestamp} is not the latest replication ` +
          `boundary before archive baseline ${index.upstream}`,
      );
    }
  }
}

/** Refuse a stream head which contradicts the persisted watermark. */
export function assertHeadCompatible(state, head) {
  if (state.lastAppliedSeq === null) return;
  if (head.seq < state.lastAppliedSeq) {
    throw new Error(
      `replication head ${String(head.seq)} is behind watermark ${String(state.lastAppliedSeq)}`,
    );
  }
  if (
    head.seq === state.lastAppliedSeq &&
    !sameTimestamp(head.timestamp, state.lastAppliedTimestamp)
  ) {
    throw new Error(
      `replication head timestamp ${head.timestamp} disagrees with watermark timestamp ` +
        `${String(state.lastAppliedTimestamp)} at sequence ${String(head.seq)}`,
    );
  }
}

/** A publication run may demand that its configured bound reaches this head. */
export function assertCanCatchUp(state, head, limit, requireCaughtUp) {
  if (!requireCaughtUp) return;
  if (state.lastAppliedSeq === null) {
    throw new Error('--require-caught-up needs an established replication watermark');
  }
  const pending = head.seq - state.lastAppliedSeq;
  if (pending > limit) {
    throw new Error(
      `--require-caught-up cannot reach head ${String(head.seq)} from ` +
        `${String(state.lastAppliedSeq)} with --max ${String(limit)} (${String(pending)} pending)`,
    );
  }
}

/** Sequence 122160 -> .../hour/000/122/160.osc.gz */
export function sequenceDiffUrl(seq) {
  return `${sequencePath(seq)}.osc.gz`;
}

// ---------------------------------------------------------------------------
// the diff
// ---------------------------------------------------------------------------

/**
 * Stream one .osc.gz, calling back per element.
 *
 * Streamed rather than buffered: the hourly diff is 2.5 MB compressed but well
 * over 100 MB expanded, and the daily is far worse. A real XML parser rather
 * than a regex, because OsmChange is XML and pattern-matching it is the sort of
 * shortcut that works until an attribute order changes.
 */
export function osmChangeElement(action, type, attributes) {
  return {
    action,
    type,
    id: attributes.id,
    version: Number(attributes.version ?? 0),
    lat: attributes.lat === undefined ? null : Number(attributes.lat),
    lon: attributes.lon === undefined ? null : Number(attributes.lon),
    ...(attributes.timestamp === undefined ? {} : { timestamp: attributes.timestamp }),
    tags: {},
  };
}

function osmChangeParser(onElement) {
  const parser = sax.createStream(true, { trim: true });
  let action = null;
  let element = null;
  parser.on('opentag', (node) => {
    const name = node.name;
    if (name === 'create' || name === 'modify' || name === 'delete') {
      action = name;
      return;
    }
    if (name === 'node' || name === 'way' || name === 'relation') {
      element = osmChangeElement(action, name, node.attributes);
      return;
    }
    if (name === 'tag' && element !== null) element.tags[node.attributes.k] = node.attributes.v;
  });
  parser.on('closetag', (name) => {
    if (name === 'node' || name === 'way' || name === 'relation') {
      if (element !== null) onElement(element);
      element = null;
      return;
    }
    if (name === 'create' || name === 'modify' || name === 'delete') action = null;
  });
  return parser;
}

/** Parse already-fetched compressed diff bytes for independent publication proof. */
export async function forEachElementBytes(bytes, onElement) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new Error('OSM diff body is empty');
  const parser = osmChangeParser(onElement);
  await new Promise((resolveParse, reject) => {
    const gunzip = createGunzip();
    gunzip.on('error', reject);
    parser.on('error', reject);
    parser.on('end', resolveParse);
    Readable.from([bytes]).pipe(gunzip).pipe(parser);
  });
}

export async function forEachElement(url, onElement, request = httpsGet) {
  // A bootstrap can read hundreds of large diffs. Some intermediaries
  // terminate one long-lived HTTP connection after a fixed byte budget, so
  // each streamed diff gets its own socket instead of sharing fetch's pool.
  const response = await new Promise((resolve, reject) => {
    const pending = request(url, { headers: { 'User-Agent': USER_AGENT }, agent: false }, resolve);
    pending.on('error', reject);
  });
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`${url}: HTTP ${String(response.statusCode)}`);
  }

  const parser = osmChangeParser(onElement);

  await new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    response.on('error', reject);
    gunzip.on('error', reject);
    parser.on('error', reject);
    parser.on('end', resolve);
    response.pipe(gunzip).pipe(parser);
  });
}

// ---------------------------------------------------------------------------
// our table, read out of the tiles we already ship
// ---------------------------------------------------------------------------

function loadCameras(tileRoot = DEFAULT_OUT_DIR) {
  const byId = new Map();
  const root = join(tileRoot, String(TILE_ZOOM));
  if (!existsSync(root)) return byId;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      const tile = JSON.parse(readFileSync(path, 'utf8'));
      // The tile's own x/y travel with the record: a moved camera has to be
      // removed from the tile it WAS in, and only the tile knows which that is.
      for (const camera of tile.cameras ?? []) {
        byId.set(camera.id, { camera, path, x: tile.x, y: tile.y });
      }
    }
  };
  walk(root);
  return byId;
}

/** Recount the shipped tree, so the catalogue states what is actually there. */
function countTiles(tileRoot = DEFAULT_OUT_DIR) {
  let cameras = 0;
  let tiles = 0;
  const root = join(tileRoot, String(TILE_ZOOM));
  if (!existsSync(root)) return { cameras, tiles };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      tiles += 1;
      cameras += (JSON.parse(readFileSync(path, 'utf8')).cameras ?? []).length;
    }
  };
  walk(root);
  return { cameras, tiles };
}

export function buildApprovedGazetteers(records, countyIndex, generatedAt) {
  const counties = new Map();
  let cameras = 0;
  for (const record of records) {
    const county = countyIndex.lookup(record.lat, record.lon);
    if (county === null || record.countyFips !== county.fips) {
      throw new Error(`camera ${String(record.id)} does not match the pinned county join`);
    }
    cameras += 1;
    const held = counties.get(county.fips);
    if (held === undefined) {
      counties.set(county.fips, {
        fips: county.fips,
        name: county.name,
        lsad: county.lsad,
        state: county.state,
        label: countyLabel(county),
        cameras: 1,
      });
    } else {
      held.cameras += 1;
    }
  }
  const rows = [...counties.values()].sort(
    (left, right) => right.cameras - left.cameras || left.fips.localeCompare(right.fips),
  );
  return {
    counties: {
      generatedAt,
      source: 'US Census county polygons, joined point-in-polygon',
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      counties: rows.length,
      located: cameras,
      unlocated: 0,
      rows,
    },
    places: {
      generatedAt,
      source: 'No place enrichment in the approved direct-capture baseline',
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      places: 0,
      inPlace: 0,
      unincorporated: cameras,
      rows: [],
    },
  };
}

export function advanceArchiveIndex(index, appliedTimestamp, counted, generatedAt) {
  return {
    ...index,
    generatedAt,
    upstream: appliedTimestamp,
    cameras: counted.cameras,
    tiles: counted.tiles,
    bbox: US_BBOX,
  };
}

/** Every camera as a deterministic flat coordinate overview. See its call site. */
function writeOverview(tileRoot = DEFAULT_OUT_DIR) {
  const cameras = [];
  const root = join(tileRoot, String(TILE_ZOOM));
  if (!existsSync(root)) return;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      for (const camera of JSON.parse(readFileSync(path, 'utf8')).cameras ?? []) {
        cameras.push(camera);
      }
    }
  };
  walk(root);
  /*
   * ATTRIBUTION TRAVELS WITH THE DATA, INCLUDING HERE.
   *
   * `fetch-cameras.mjs` states the rule: every tile carries the attribution
   * string in its own body "so it cannot be separated from the data", and
   * `index.json` repeats it. This file was the one that did not - it shipped
   * `{schema, count, coords}` and nothing else, while being the LARGEST single
   * extract the project publishes: 132,068 points, one public URL, no notice
   * attached.
   *
   * That is the opposite way round from the rest of the system. A reader who
   * fetches one tile learns where the data came from; a reader who fetches all
   * of it learned nothing. ODbL attaches to the extract regardless of shape,
   * so the notice goes in the body here for exactly the reason it goes in the
   * tiles: whoever ends up holding this file should be able to tell.
   *
   * `schema` stays `fwm-overview/v1`. Added keys do not break the reader in
   * `MapCanvas.tsx`, which reads `coords` and ignores the rest, and bumping the
   * version would strand caches over a change that removes no field.
   */
  writeFileSync(
    join(tileRoot, 'overview.json'),
    `${JSON.stringify(buildCameraOverview(cameras))}\n`,
  );
}

function readTombstones(tileRoot = DEFAULT_OUT_DIR) {
  const path = join(tileRoot, 'tombstones.json');
  if (!existsSync(path)) return { generatedAt: null, tombstones: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function indexTombstoneLedger(tombstones) {
  if (!Array.isArray(tombstones)) throw new Error('tombstone ledger is not an array');
  const byId = new Map();
  for (const tombstone of tombstones) {
    if (
      typeof tombstone?.id !== 'string' ||
      tombstone.id === '' ||
      !TOMBSTONE_REASONS.includes(tombstone.reason) ||
      !Number.isSafeInteger(tombstone.seq) ||
      tombstone.seq < 0 ||
      (Object.hasOwn(tombstone, 'osmVersion') &&
        (!Number.isSafeInteger(tombstone.osmVersion) || tombstone.osmVersion < 1))
    ) {
      throw new Error(`invalid tombstone ledger entry for ${String(tombstone?.id)}`);
    }
    if (byId.has(tombstone.id)) {
      throw new Error(`duplicate tombstone ledger entry for ${tombstone.id}`);
    }
    byId.set(tombstone.id, tombstone);
  }
  return byId;
}

/**
 * Fold this run into the deletion ledger.
 *
 * A tombstone describes the latest qualifying state we observed; it is not a
 * permanent ban on an OSM id. A node can be untagged and later tagged as a
 * camera again, so a later live upsert supersedes and removes its old ledger
 * entry. A tombstone produced later in this same run still wins.
 */
export function reconcileTombstones(existing, tombstones, upserts) {
  const merged = new Map(existing.map((tombstone) => [tombstone.id, tombstone]));
  for (const id of upserts.keys()) merged.delete(id);
  for (const [id, tombstone] of tombstones) merged.set(id, tombstone);
  return [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Fold one element into this run's pending state.
 *
 * Pending state wins over the tile snapshot. That ordering matters when two
 * consecutive diffs touch an id which did not exist at the start of the run:
 * a create followed by a delete/untag must finish tombstoned, not live. Keeping
 * the OSM version on the tombstone also lets a later full snapshot prove that a
 * restored live node is strictly newer before clearing the deletion ledger.
 */
export function stageElementChange(
  element,
  seq,
  baseKnown,
  upserts,
  tombstones,
  inside = insideBoundingFootprint,
) {
  if (!Number.isSafeInteger(element.version) || element.version < 1) {
    throw new Error(`OSM element ${String(element.id)} carried an invalid version`);
  }
  if (element.timestamp !== undefined && !validTimestamp(element.timestamp)) {
    throw new Error(`OSM element ${String(element.id)} carried an invalid timestamp`);
  }
  const id = `osm:${element.id}`;
  const known = upserts.get(id) ?? tombstones.get(id) ?? baseKnown;

  // An unknown-version deletion is still ordered by the replication stream.
  // It may be cleared by a qualifying event from a later diff, never by the
  // same or an older sequence replayed against the ledger.
  if (known?.reason !== undefined && Number.isSafeInteger(known.seq)) {
    if (seq < known.seq) return { kind: 'ignore' };
    // One hourly .osc can contain several versions of the same node. Equal
    // sequence is therefore not a replay by itself: a strictly greater OSM
    // version later in the file must be allowed to clear a pending tombstone.
    // An old unversioned ledger cannot prove that within-sequence order and
    // remains fail-closed.
    if (seq === known.seq && !Number.isSafeInteger(known.osmVersion)) {
      return { kind: 'ignore' };
    }
  }
  const verdict = decide(element, known, inside);

  if (verdict.kind === 'ignore') return verdict;

  if (verdict.kind === 'tombstone') {
    upserts.delete(id);
    tombstones.set(id, {
      id,
      reason: verdict.reason,
      seq,
      osmVersion: element.version,
    });
    return verdict;
  }

  tombstones.delete(id);
  upserts.set(id, {
    // The RAW OSM id: `normalise()` adds the `osm:` namespace exactly once.
    id: element.id,
    // Territory, county assignment, tile placement, and the stored record all
    // operate on this exact published 5-decimal point.
    lat: normaliseCoordinate(element.lat),
    lon: normaliseCoordinate(element.lon),
    osmVersion: element.version,
    tags: element.tags,
    ...(element.timestamp === undefined ? {} : { timestamp: element.timestamp }),
    seq,
  });
  return verdict;
}

export function normaliseStagedUpsert(upsert, county = null) {
  return normalise(
    {
      id: upsert.id,
      lat: upsert.lat,
      lon: upsert.lon,
      tags: upsert.tags,
      version: upsert.osmVersion,
      ...(upsert.timestamp === undefined ? {} : { timestamp: upsert.timestamp }),
    },
    county,
  );
}

/** Materialise one replay upsert using only its canonical published point. */
export function materialiseStagedUpsert(upsert, countyIndex) {
  const canonical = {
    ...upsert,
    lat: normaliseCoordinate(upsert.lat),
    lon: normaliseCoordinate(upsert.lon),
  };
  const county = countyIndex.lookup(canonical.lat, canonical.lon);
  if (county === null) {
    throw new Error(
      `accepted camera osm:${String(upsert.id)} is outside the pinned county geofence`,
    );
  }
  const record = normaliseStagedUpsert(canonical, county);
  return { record, county, ...latLonToTile(record.lat, record.lon, TILE_ZOOM) };
}

/** Serialize one dirty tile with the exact notice required for publication. */
export function writeCameraTile(path, tile) {
  mkdirSync(dirname(path), { recursive: true });
  tile.cameras.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body = {
    z: tile.z,
    x: tile.x,
    y: tile.y,
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    cameras: tile.cameras,
  };
  if (tile.streetSource !== undefined) body.streetSource = tile.streetSource;
  writeFileSync(path, `${JSON.stringify(body)}\n`);
  return body;
}

/** Parse invocation controls without coupling tests to networked `main()`. */
export function parseSyncArgs(args) {
  const parsed = {
    dryRun: false,
    geofence: DEFAULT_COUNTY_GEOFENCE,
    limit: MAX_DIFFS_PER_RUN,
    requireCaughtUp: false,
    stateFile: DEFAULT_STATE_FILE,
    target: DEFAULT_OUT_DIR,
  };
  const seen = new Set();

  const once = (name) => {
    if (seen.has(name)) throw new Error(`${name} may be supplied only once`);
    seen.add(name);
  };
  const option = (index, name) => {
    const arg = args[index];
    if (arg === name) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${name} requires a value`);
      }
      return { value, consumed: 2 };
    }
    if (arg.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      if (value.trim() === '') throw new Error(`${name} requires a non-empty value`);
      return { value, consumed: 1 };
    }
    return null;
  };

  for (let index = 0; index < args.length;) {
    const arg = args[index];
    if (arg === '--dry-run') {
      once('--dry-run');
      parsed.dryRun = true;
      index += 1;
      continue;
    }
    if (arg === '--require-caught-up') {
      once('--require-caught-up');
      parsed.requireCaughtUp = true;
      index += 1;
      continue;
    }
    const max = option(index, '--max');
    if (max !== null) {
      once('--max');
      const value = Number(max.value);
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error('--max requires a positive integer');
      }
      parsed.limit = value;
      index += max.consumed;
      continue;
    }
    if (arg === '--geofence' || arg.startsWith('--geofence=')) {
      throw new Error('--geofence is pinned for release sync and cannot be overridden');
    }
    const state = option(index, '--state-file');
    if (state !== null) {
      once('--state-file');
      parsed.stateFile = state.value;
      index += state.consumed;
      continue;
    }
    const target = option(index, '--target');
    if (target !== null) {
      once('--target');
      parsed.target = resolveCameraTarget(target.value);
      index += target.consumed;
      continue;
    }
    throw new Error(`unknown sync-cameras argument: ${arg}`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const { dryRun, geofence, limit, requireCaughtUp, stateFile, target } = parseSyncArgs(args);
  assertSafeCameraTarget(target);
  const geofenceBytes = readFileSync(geofence);
  releaseGeofenceIdentity(geofenceBytes);
  const countyIndex = loadCountiesBytes(geofenceBytes);
  const inside = createTerritorialFootprint(countyIndex);

  const safeStateFile = assertSafeStateFile(stateFile);
  const state = readState(safeStateFile);
  const indexPath = join(target, 'index.json');
  if (!existsSync(indexPath)) throw new Error(`camera archive has no index.json at ${indexPath}`);
  const archiveIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
  await assertArchiveContinuity(state, archiveIndex);
  const head = await currentSequence();
  assertHeadCompatible(state, head);
  assertCanCatchUp(state, head, limit, requireCaughtUp);

  const cameras = loadCameras(target);
  const existing = readTombstones(target);
  const ledger = indexTombstoneLedger(existing.tombstones);
  process.stdout.write(
    `stream    : ${STREAM}\n` +
      `local     : ${String(cameras.size)} cameras\n` +
      `geofence  : ${String(countyIndex.counties.length)} US county polygons\n` +
      `watermark : ${state.lastAppliedSeq === null ? 'none (first run)' : String(state.lastAppliedSeq)}\n` +
      `head      : ${String(head.seq)} @ ${head.timestamp}\n`,
  );

  if (state.versionsKnown !== true) {
    process.stdout.write(
      'guard     : REPLAY GUARD DEGRADED -- no stored OSM versions in the camera\n' +
        '            table, so an unknown version is treated as 0 and any incoming\n' +
        '            version wins. Safe while diffs are applied in sequence order and\n' +
        '            never replayed. A re-bootstrap with `out meta` clears this.\n',
    );
  }

  if (state.lastAppliedSeq === null) {
    // RULE 5 again: with no watermark we cannot prove continuity, and without
    // continuity we have no basis for ANY deletion. Adopt the head as the
    // starting point and apply nothing -- the snapshot is whatever it is.
    if (!dryRun) {
      writeState(stateFile, firstRunState(head, state));
    }
    process.stdout.write(
      '\nfirst run: watermark set to head, no diffs applied.\n' +
        'There is no proven continuity with the snapshot on disk, and a gap is a\n' +
        'hard error rather than something to paper over. Subsequent runs apply.\n',
    );
    return;
  }

  if (head.seq <= state.lastAppliedSeq) {
    process.stdout.write('\nup to date.\n');
    return;
  }

  const pending = [];
  for (let seq = state.lastAppliedSeq + 1; seq <= head.seq && pending.length < limit; seq += 1) {
    pending.push(seq);
  }
  process.stdout.write(`pending   : ${String(pending.length)} diff(s)\n\n`);

  const upserts = new Map();
  const tombstones = new Map();
  let scanned = 0;
  /**
   * The last sequence actually APPLIED, which is not always the head.
   *
   * RULE 5 says the watermark comes from state.txt, and this used to write
   * `head.seq` unconditionally -- so a run bounded by `--max` applied a handful
   * of diffs and then advanced the watermark past every one it had NOT applied.
   * Those changes are gone: the next run starts after them and no later run
   * ever revisits them, which is precisely the silent skip the sequence
   * watermark exists to make impossible.
   */
  let appliedThrough = state.lastAppliedSeq;

  for (const seq of pending) {
    const url = sequenceDiffUrl(seq);
    process.stdout.write(`  ${String(seq)} ...`);
    let touched = 0;
    await forEachElement(url, (element) => {
      scanned += 1;
      const id = `osm:${element.id}`;
      const verdict = stageElementChange(
        element,
        seq,
        ledger.get(id) ?? cameras.get(id)?.camera,
        upserts,
        tombstones,
        inside,
      );
      if (verdict.kind === 'ignore') return;
      touched += 1;
    });
    process.stdout.write(` ${String(touched)} relevant\n`);
    // Advanced only after the whole diff parsed without throwing. A diff that
    // 404s or truncates mid-stream leaves the watermark where it was, so the
    // next run reconsiders it rather than stepping over it.
    appliedThrough = seq;
  }

  /*
   * A bounded catch-up normally stops behind the moving stream head. The
   * timestamp beside the watermark must describe the exact diff we applied,
   * not whichever newer head happened to be visible when this run started.
   * Fetching that numbered state file also fails closed before any tile is
   * written if OSM cannot prove the sequence/timestamp pair.
   */
  const appliedState = await resolveAppliedState(appliedThrough, head);
  const appliedTimestamp = appliedState.timestamp;

  const live = cameras.size;
  const wouldTombstone = tombstones.size;
  /**
   * AN EMPTY TABLE IS AN ANOMALY, NOT A CLEAN BILL.
   *
   * This read `live === 0 ? 0 : ...`, so a run that loaded no cameras at all --
   * a wrong TILE_ROOT, a branch without tiles -- evaluated the fraction guard
   * to zero and passed it. The one state where nothing can be trusted was the
   * one state that always cleared.
   */
  if (live === 0) {
    process.stderr.write(
      '\nCIRCUIT BREAKER: the camera table is EMPTY.\n' +
        'Either the tile tree is missing or TILE_ROOT is wrong. Refusing to\n' +
        'apply diffs against nothing, and the watermark was not advanced.\n',
    );
    process.exitCode = 2;
    return;
  }
  const fraction = wouldTombstone / live;

  process.stdout.write(
    `\nscanned   : ${String(scanned)} elements\n` +
      `upserts   : ${String(upserts.size)}\n` +
      `tombstones: ${String(wouldTombstone)} (${(fraction * 100).toFixed(3)}% of ${String(live)} live)\n`,
  );

  // RULE 4. A run that would remove more than ~8x the measured daily churn is
  // far likelier to be a bug in this file than a real event. Halt, and do NOT
  // advance the watermark -- so the next run reconsiders the same diffs rather
  // than skipping past them.
  // MOVES, which no ceiling on counts can see.
  const moved = [];
  for (const [id, up] of upserts) {
    const known = cameras.get(id)?.camera;
    if (known === undefined || up.lat === null || up.lon === null) continue;
    const distance = metresBetween(known.lat, known.lon, up.lat, up.lon);
    if (distance > MAX_MOVE_M) moved.push({ id, distance });
  }
  if (moved.length > 0) {
    moved.sort((a, b) => b.distance - a.distance);
    process.stdout.write(
      `moved     : ${String(moved.length)} camera(s) further than ` +
        `${String(MAX_MOVE_M)} m (furthest ${String(Math.round(moved[0].distance))} m)\n`,
    );
  }
  if (moved.length > MAX_MOVED_CAMERAS) {
    process.stderr.write(
      `\nCIRCUIT BREAKER: ${String(moved.length)} cameras would move more than ` +
        `${String(MAX_MOVE_M)} m.\n` +
        'A run that relocates cameras in bulk is a coordinate or id bug, and it\n' +
        'is as harmful as deleting them -- a driver warned in the wrong place is\n' +
        'not warned in the right one. Nothing was written; the watermark stands.\n',
    );
    process.exitCode = 2;
    return;
  }

  if (upserts.size > MAX_UPSERT_ABSOLUTE) {
    process.stderr.write(
      `\nCIRCUIT BREAKER: ${String(upserts.size)} upserts exceeds ` +
        `${String(MAX_UPSERT_ABSOLUTE)}.\n` +
        'That many additions at once means a filter is broken, not that the\n' +
        'country grew. Nothing was written and the watermark was not advanced.\n',
    );
    process.exitCode = 2;
    return;
  }

  if (wouldTombstone > MAX_TOMBSTONE_ABSOLUTE || fraction > MAX_TOMBSTONE_FRACTION) {
    process.stderr.write(
      `\nCIRCUIT BREAKER: ${String(wouldTombstone)} tombstones exceeds the limit ` +
        `(${String(MAX_TOMBSTONE_ABSOLUTE)} absolute / ` +
        `${String(MAX_TOMBSTONE_FRACTION * 100)}% of live).\n` +
        'Measured national churn is ~0.12%/day. Nothing was written and the\n' +
        'watermark was NOT advanced. A human should look before this proceeds.\n',
    );
    process.exitCode = 2;
    return;
  }

  if (dryRun) {
    process.stdout.write('\n--dry-run: nothing written, watermark not advanced\n');
    return;
  }

  // ---- write the changes into the tiles ---------------------------------
  //
  // Only the tiles that actually changed are rewritten. Touching all 8,561 to
  // apply a handful of edits would produce the unreviewable diff that the
  // `generatedAt` fix exists to prevent.
  const dirty = new Map();

  const tilePathFor = (lat, lon) => {
    const { x, y } = latLonToTile(lat, lon, TILE_ZOOM);
    return join(target, String(TILE_ZOOM), String(x), `${String(y)}.json`);
  };

  const loadTile = (path, x, y) => {
    if (dirty.has(path)) return dirty.get(path);
    const tile = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : {
          z: TILE_ZOOM,
          x,
          y,
          attribution: ATTRIBUTION,
          licence: LICENCE,
          licenceUrl: LICENCE_URL,
          cameras: [],
        };
    dirty.set(path, tile);
    return tile;
  };

  for (const id of tombstones.keys()) {
    const known = cameras.get(id);
    if (known === undefined) continue;
    const tile = loadTile(known.path, known.x, known.y);
    tile.cameras = tile.cameras.filter((c) => c.id !== id);
  }

  for (const [id, up] of upserts) {
    if (up.lat === null || up.lon === null) continue;
    // `up.id` is the RAW OSM id; normalise() is what adds the `osm:` prefix.
    const { record, x, y } = materialiseStagedUpsert(up, countyIndex);
    const known = cameras.get(id);
    // A MOVED camera leaves its old tile. Without this it would exist twice,
    // and the stale copy would alert from a place it no longer is.
    if (known !== undefined) {
      const old = loadTile(known.path, known.x, known.y);
      old.cameras = old.cameras.filter((c) => c.id !== id);
    }
    /**
     * WHAT OSM NEVER TOLD US, KEPT.
     *
     * `normalise()` builds a record from the OSM node alone, and four of the
     * most useful fields on a record do not come from OSM: `street` and `cross`
     * are reverse-geocoded, `countyFips` and `placeGeoid` are point-in-polygon
     * joins against Census polygons. So every hourly upsert REPLACED a fully
     * enriched record with a bare one - the patrol was quietly stripping the
     * road name off any camera a mapper touched.
     *
     * Narrow, named fields rather than a record merge, for the reason the
     * fetcher spells out at `CARRIED_FORWARD`: a blanket merge resurrects a tag
     * a mapper deleted. The rule is only ever "carry what OSM never said".
     *
     * NOT CARRIED WHEN THE CAMERA MOVED. A street name is a fact about a place,
     * and a node that changed coordinates is somewhere else - the old road name
     * would be a confident wrong answer rather than a missing one. The tile
     * change is the test: same tile, same neighbourhood.
     */
    if (state.versionsKnown !== true && known !== undefined && known.x === x && known.y === y) {
      for (const field of CARRIED_FORWARD) {
        const held = known.camera[field];
        if (typeof held === 'string' && held !== '') record[field] = held;
      }
    }

    const path = tilePathFor(up.lat, up.lon);
    const tile = loadTile(path, x, y);
    tile.cameras = [...tile.cameras.filter((c) => c.id !== id), record];
  }

  for (const [path, tile] of dirty) {
    // Sorted by id, and serialised exactly as the fetcher does -- byte-stable,
    // so a tile only changes when its DATA changed.
    writeCameraTile(path, tile);
  }
  process.stdout.write(`tiles rewritten: ${String(dirty.size)}\n`);

  const generatedAt = new Date().toISOString();

  /**
   * THE CATALOGUE HAS TO FOLLOW THE DATA.
   *
   * `fetch-cameras.mjs` justifies stripping `generatedAt` from tile bodies on
   * the grounds that "it lives in index.json now, which is the one file that
   * legitimately changes every run" -- and then the thing that changes the data
   * every hour never touched it. Measured before this: index.json claimed
   * 130,684 cameras across 8,508 tiles while the disk held 131,054 across
   * 8,575, drifting further every hour.
   *
   * That is not a cosmetic gap. `services/cameras/catalogue.ts` fetches this
   * file and `RadarHeader` renders the count as the size of the whole published
   * set, and its frozen `generatedAt` meant the dataset could no longer state
   * its own age -- exactly the failure removing the per-tile timestamps was
   * meant to fix.
   */
  /**
   * THE NATIONAL OVERVIEW.
   *
   * Camera tiles are fetched around the VEHICLE, so pulling the map back to
   * look at a state showed one cluster and an empty country -- "why TF are all
   * the camera data points not showing". The per-tile scheme is right for
   * driving and cannot answer a question about the whole map.
   *
   * So the whole set also ships as one flat array of coordinates: no ids, no
   * tags, five decimals. 131k cameras in 2.5 MB raw and 0.83 MB gzipped, which
   * is smaller than a single photograph, and it is only ever fetched when the
   * driver zooms out past the point where individual markers mean anything.
   */
  writeOverview(target);

  const counted = countTiles(target);
  if (state.versionsKnown === true) {
    const gazetteers = buildApprovedGazetteers(
      [...loadCameras(target).values()].map(({ camera }) => camera),
      countyIndex,
      generatedAt,
    );
    writeFileSync(
      join(target, 'counties.json'),
      `${JSON.stringify(gazetteers.counties, null, 2)}\n`,
    );
    writeFileSync(join(target, 'places.json'), `${JSON.stringify(gazetteers.places, null, 2)}\n`);
  }
  if (existsSync(indexPath)) {
    writeFileSync(
      indexPath,
      `${JSON.stringify(
        advanceArchiveIndex(archiveIndex, appliedTimestamp, counted, generatedAt),
        null,
        2,
      )}\n`,
    );
    process.stdout.write(
      `index.json: ${String(counted.cameras)} cameras across ${String(counted.tiles)} tiles\n`,
    );
  }

  // RULE 3: tombstones, never DELETE. A client that only ever merges additions
  // never forgets anything, so removals have to be published explicitly.
  const merged = reconcileTombstones(existing.tombstones, tombstones, upserts);
  writeFileSync(
    join(target, 'tombstones.json'),
    `${JSON.stringify(
      {
        attribution: ATTRIBUTION,
        licence: LICENCE,
        licenceUrl: LICENCE_URL,
        generatedAt,
        upstream: appliedTimestamp,
        tombstones: merged,
      },
      null,
      0,
    )}\n`,
  );

  writeState(stateFile, advancedSyncState(state, appliedThrough, appliedTimestamp, generatedAt));

  process.stdout.write(
    `\napplied through ${String(appliedThrough)} (${appliedTimestamp})` +
      `${appliedThrough === head.seq ? ' -- caught up' : ' -- MORE PENDING'}\n` +
      `tombstones written: ${String(merged.length)} total\n` +
      'Every live camera was rejoined to the pinned Census county geofence;\n' +
      'place/street enrichment is deliberately absent from approved generations.\n',
  );
}

/**
 * Run only when invoked as a script.
 *
 * Without this, importing the module to test `decide()` executes the whole
 * patrol -- network, tile writes and all. The same guard `fetch-cameras.mjs`
 * already uses, and the reason its rule table was testable while this one was
 * not.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  });
}
