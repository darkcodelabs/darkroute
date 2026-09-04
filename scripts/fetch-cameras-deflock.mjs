/**
 * Adapt one reviewed, first-party Overpass capture into the existing camera
 * builder. Despite the historical filename, the approved path does not fetch a
 * DeFlock PMTiles build. DeFlock's pinned MIT query/splitting implementation is
 * the starting point; DarkRoute runs the requests itself and retains auditable,
 * privacy-redacted evidence.
 *
 * `capture-deflock-source.mjs` queries the full case-insensitive ALPR/ANPR
 * predicate, binds the adaptive request topology and every accepted response,
 * records the minimum actual `osm3s.timestamp_osm_base`, and immediately drops
 * OSM contributor identity from the retained bodies. The raw transport hashes
 * remain in the ledger, while the raw transport bytes do not. The ledger also
 * binds the exact local capture files before the first request and refuses a
 * mid-run code change.
 *
 * `propose-deflock-source-review.mjs` validates those artifacts, applies the
 * strict Census 50-states/DC/PR polygon and staged tombstone ledger, computes
 * the exact output digest, and discovers the official hourly overlap. It emits
 * status `unapproved`; an operator must review and explicitly approve the receipt.
 * This adapter accepts only that exact approved receipt and matching checked-in
 * ledger, bundle, raw GeoJSON, implementation bytes, geofence, and tombstones.
 * Its only network reads are the receipt's numbered OSMF replication floor and
 * its next state, plus exact current-node reads for any one-time predecessor
 * reconciliation entries. Every URL is fixed by the reviewed contract and
 * redirects are forbidden.
 *
 * Historical PMTiles decoding helpers remain below for regression/forensic
 * tests. They are not reachable from the release main path. The old DeFlock
 * build receipt lacked constituent OSM watermarks and remains unapproved.
 *
 * No driver device contacts Overpass or DeFlock. Capture and adaptation happen
 * on a build machine; publication remains same-origin. OSM-derived artifacts
 * embed `Map data © OpenStreetMap contributors` and `ODbL-1.0`. The pinned
 * DeFlock-derived implementation retains its MIT notice separately.
 *
 *   # After a separately reviewed capture proposal has been approved:
 *   node scripts/fetch-cameras-deflock.mjs \
 *     --source-review=scripts/data/deflock-us-source-review.json \
 *     --out=/tmp/darkroute-camera-release/cameras \
 *     --overpass=/tmp/darkroute-camera-release/source-overpass.json
 *   node scripts/fetch-cameras.mjs \
 *     --target=/tmp/darkroute-camera-release/cameras \
 *     --input=/tmp/darkroute-camera-release/source-overpass.json
 *
 *   node scripts/fetch-cameras-deflock.mjs --source-review=FILE \
 *     --out=TOMBSTONE_ONLY_DIR --overpass=NEW_FILE [--dry]
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

import {
  CAMERA_SOURCE_GENERATOR,
  CAMERA_SOURCE_LABEL,
  CAMERA_SOURCE_REVIEW_SCHEMA,
  CAMERA_SOURCE_SCHEMA,
  CAMERA_SOURCE_TERRITORIES,
  DEFAULT_COUNTY_GEOFENCE,
  DEFAULT_RELEASE_TOMBSTONES,
  RELEASE_GEOFENCE_IDENTITY,
  RELEASE_TOMBSTONE_PATH,
  assertReleaseCameraMinimum,
  assertSafeCameraTarget,
  canonicalSourceTimestamp,
  reconcileTombstoneFloor,
  releaseGeofenceIdentity,
  releaseTombstoneIdentity,
  normaliseCoordinate,
  normalise,
  validateReleaseTombstoneLedger,
} from './fetch-cameras.mjs';
import { cameraCoreIdentity } from './camera-integrity.mjs';
import { loadCountiesBytes } from './counties.mjs';
import {
  PREDECESSOR_PATH,
  PREDECESSOR_TOMBSTONES_PATH,
  assertPredecessorCoverage,
  predecessorIdentity,
  validatePredecessorEvidence,
} from './camera-predecessor.mjs';
import {
  verifyCutoverReconciliation,
  verifyTombstoneLedgerAncestry,
} from './migrate-camera-tombstone-ledger.mjs';
import {
  OVERPASS_ENDPOINTS,
  PINNED_UPSTREAM,
  RAW_DATASET_PATH,
  RESPONSE_BUNDLE_PATH,
  RESPONSE_LEDGER_PATH,
  RESPONSE_LEDGER_SCHEMA,
  validateCaptureArtifacts,
} from './deflock-capture.mjs';

/** Self-identifying, with a contact. Never an AI-crawler UA - see the header. */
export const USER_AGENT = 'DarkRoute-archive/0.1 (+https://darkroute.ai; contact cory@darkcode.ai)';
const ROOT = resolve(import.meta.dirname, '..');
export { RESPONSE_LEDGER_PATH };

export const TILES_HOST = 'https://tiles.dontgetflocked.com';
/**
 * THE DOCUMENTED RELEASE FOOTPRINT, FROM ONE VERSIONED SOURCE ARCHIVE.
 *
 * The current `us` build includes the fifty states and Puerto Rico. The `ca`
 * build is a separate Canadian dataset and is deliberately not unioned into a
 * release whose public contract is US + Puerto Rico. The legacy implementation
 * added it after mistaking records missing from an old local archive for source
 * coverage gaps.
 *
 * This adapter also does not paper over source gaps with records from the
 * archive being replaced. Absence from a fresh source cannot distinguish a
 * missing record from a deletion, and the legacy archive has neither an
 * authoritative snapshot watermark nor OSM versions on those records.
 */
export const COUNTRIES = ['us'];
export const archiveUrl = (country) => `${TILES_HOST}/cameras-${country}-hourly.pmtiles`;
export const manifestUrl = (country) => `${TILES_HOST}/cameras-${country}-hourly-manifest.json`;
export const indexUrl = (country) => `${TILES_HOST}/cameras-${country}-hourly-index.json`;

// ---------------------------------------------------------------------------
// PMTiles, enough of it to read an archive
// ---------------------------------------------------------------------------

/**
 * The v3 header, by byte offset.
 *
 * Read by hand rather than by pulling the `pmtiles` package into a build
 * script: the app depends on it for the basemap, this needs six numbers out of
 * a 127-byte header, and the spec fixes every one of their offsets.
 */
export function readHeader(buf) {
  if (buf.length < 127) throw new Error('pmtiles: short header');
  const magic = buf.toString('ascii', 0, 7);
  if (magic !== 'PMTiles') throw new Error(`pmtiles: bad magic ${JSON.stringify(magic)}`);
  const version = buf.readUInt8(7);
  if (version !== 3) throw new Error(`pmtiles: unsupported version ${String(version)}`);
  // Offsets are the v3 spec's, and getting two of them wrong is how this first
  // failed: `metadata` sits at 24/32 and `leaf dirs` at 40/48, so reading leaf
  // dirs from 24 handed gunzip the metadata block and it threw Z_BUF_ERROR.
  // Verified against the real archive: rootDir 127+175, metadata 302+6151,
  // leafDirs 6453+217756, tileData 224209+48017617, z0-14, both compressions 2.
  return {
    rootDirOffset: Number(buf.readBigUInt64LE(8)),
    rootDirLength: Number(buf.readBigUInt64LE(16)),
    metadataOffset: Number(buf.readBigUInt64LE(24)),
    metadataLength: Number(buf.readBigUInt64LE(32)),
    leafDirOffset: Number(buf.readBigUInt64LE(40)),
    leafDirLength: Number(buf.readBigUInt64LE(48)),
    tileDataOffset: Number(buf.readBigUInt64LE(56)),
    tileDataLength: Number(buf.readBigUInt64LE(64)),
    numAddressedTiles: Number(buf.readBigUInt64LE(72)),
    internalCompression: buf.readUInt8(97),
    tileCompression: buf.readUInt8(98),
    minZoom: buf.readUInt8(100),
    maxZoom: buf.readUInt8(101),
  };
}

/** Protobuf-style varint reader over a Buffer. */
function readVarint(buf, state) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = buf[state.at];
    state.at += 1;
    if (byte === undefined) throw new Error('pmtiles: varint past end');
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return result;
    shift += 7;
  }
}

/**
 * A directory: delta-encoded tile ids, run lengths, lengths, then offsets.
 *
 * The offset column is the awkward one - a zero means "immediately after the
 * previous entry" rather than "offset zero", which is how the format avoids
 * storing a monotonically increasing number for every contiguous run.
 */
export function readDirectory(buf) {
  const state = { at: 0 };
  const count = readVarint(buf, state);
  const entries = [];

  let tileId = 0;
  for (let i = 0; i < count; i += 1) {
    tileId += readVarint(buf, state);
    entries.push({ tileId, runLength: 0, offset: 0, length: 0 });
  }
  for (let i = 0; i < count; i += 1) entries[i].runLength = readVarint(buf, state);
  for (let i = 0; i < count; i += 1) entries[i].length = readVarint(buf, state);
  for (let i = 0; i < count; i += 1) {
    const raw = readVarint(buf, state);
    if (raw === 0 && i > 0) {
      entries[i].offset = entries[i - 1].offset + entries[i - 1].length;
    } else {
      entries[i].offset = raw - 1;
    }
  }
  return entries;
}

/** Hilbert tile id -> z/x/y. The ordering PMTiles stores tiles in. */
export function tileIdToZxy(tileId) {
  let acc = 0;
  let z = 0;
  for (;;) {
    const numTiles = (1 << z) * (1 << z);
    if (acc + numTiles > tileId) break;
    acc += numTiles;
    z += 1;
    if (z > 30) throw new Error('pmtiles: tile id out of range');
  }
  let pos = tileId - acc;
  let x = 0;
  let y = 0;
  const n = 1 << z;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & (pos / 2);
    const ry = 1 & (pos ^ rx);
    // Hilbert rotation.
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
    x += s * rx;
    y += s * ry;
    pos = Math.floor(pos / 4);
  }
  return { z, x, y };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Web-mercator tile pixel -> lon/lat, for a feature inside tile z/x/y. */
export function unproject(z, x, y, px, py, extent) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n)));
  return { lon, lat: (latRad * 180) / Math.PI };
}

/**
 * One MVT feature -> our camera record.
 *
 * THE PROPERTIES ARE PLAIN STRINGS, which is not what I assumed. The manifest
 * ships `brands`, `operators`, `zones` and `mounts` dictionaries and the first
 * version of this looked features up in them - producing 137,485 cameras with
 * zero tags between them. Their tiles encode the labels directly. Measured over
 * a 4,000-feature sample:
 *
 *   osmId 100%   osmType 100%   osmTimestamp 100%   osmVersion 100%
 *   direction 99.4%   brand 97.3%   surveillanceZone 89.5%
 *   mountType 31.3%   operator 20.9%   directions 4.3%
 *
 * Those map onto the OSM tags our own records already carry, because they came
 * from the same tags: `brand` is `manufacturer`, `surveillanceZone` is
 * `surveillance:zone`, `mountType` is `camera:mount`, `operator` is `operator`.
 *
 * `directions` is a transport-only JSON array, not the OSM `direction` tag.
 * The separate numeric `direction` property is its primary bearing; preserving
 * that number avoids feeding array syntax to the downstream OSM-tag parser.
 */
export function toRecord(feature, z, x, y) {
  const props = feature.properties ?? {};
  if (props['osmType'] !== 'node') return null;
  const geom = feature.loadGeometry();
  const point = geom[0]?.[0];
  if (point === undefined) return null;

  const { lon, lat } = unproject(z, x, y, point.x, point.y, feature.extent);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const osmId = props['osmId'];
  if (osmId === undefined || osmId === null) return null;

  const dir = props['direction'];
  const directionDeg =
    typeof dir === 'number' && Number.isFinite(dir) ? ((dir % 360) + 360) % 360 : null;

  // Only what is actually present. An absent tag stays absent rather than
  // becoming an empty string: `schema.ts` documents absence as the majority
  // case for most keys, and every reader already treats it that way.
  const tags = {};
  const put = (key, value) => {
    if (typeof value === 'string' && value !== '') tags[key] = value;
  };
  put('manufacturer', props['brand']);
  put('operator', props['operator']);
  put('surveillance:zone', props['surveillanceZone']);
  put('camera:mount', props['mountType']);
  put('ref', props['ref']);
  put('start_date', props['startDate']);

  const rawVersion = props['osmVersion'];
  const osmVersion =
    typeof rawVersion === 'number'
      ? rawVersion
      : typeof rawVersion === 'string' && /^\d+$/.test(rawVersion)
        ? Number(rawVersion)
        : null;

  return {
    id: `osm:${String(osmId)}`,
    lat: Number(lat.toFixed(7)),
    lon: Number(lon.toFixed(7)),
    directionDeg,
    // Upstream's own edit stamp, so a stale record is visible per camera rather
    // than only per archive.
    ...(Number.isSafeInteger(osmVersion) && osmVersion > 0 ? { osmVersion } : {}),
    ...(typeof props['osmTimestamp'] === 'string' ? { osmTimestamp: props['osmTimestamp'] } : {}),
    ...(Object.keys(tags).length > 0 ? { tags } : {}),
  };
}

/** One retained direct-capture GeoJSON feature -> our versioned camera record. */
export function capturedFeatureToRecord(feature) {
  const props = feature?.properties ?? {};
  if (props.osmType !== 'node') return null;
  const coordinates = feature?.geometry?.coordinates;
  if (
    feature?.type !== 'Feature' ||
    feature?.geometry?.type !== 'Point' ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2
  ) {
    throw new Error('direct source capture contains a malformed point feature');
  }
  const [lon, lat] = coordinates;
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lon !== 'number' ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180 ||
    !Number.isSafeInteger(props.osmId) ||
    props.osmId < 1
  ) {
    throw new Error('direct source capture contains invalid coordinates or OSM id');
  }
  const tags = {};
  const put = (key, value) => {
    if (typeof value === 'string' && value !== '') tags[key] = value;
  };
  put('manufacturer', props.brand);
  put('surveillance:type', props.surveillanceType);
  put('operator', props.operator);
  put('surveillance:zone', props.surveillanceZone);
  put('camera:mount', props.mountType);
  put('ref', props.ref);
  put('start_date', props.startDate);
  const directionDeg =
    typeof props.direction === 'number' && Number.isFinite(props.direction)
      ? ((props.direction % 360) + 360) % 360
      : null;
  return {
    id: `osm:${String(props.osmId)}`,
    lat,
    lon,
    directionDeg,
    ...(Number.isSafeInteger(props.osmVersion) && props.osmVersion > 0
      ? { osmVersion: props.osmVersion }
      : {}),
    ...(typeof props.osmTimestamp === 'string' ? { osmTimestamp: props.osmTimestamp } : {}),
    ...(Object.keys(tags).length > 0 ? { tags } : {}),
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export function readTombstoneLedger(dir) {
  const path = join(dir, 'tombstones.json');
  if (!existsSync(path)) throw new Error(`${path}: required release tombstone ledger is missing`);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${path}: release tombstone ledger is not a regular file`);
  }
  const bytes = readFileSync(path);
  let ledger;
  try {
    ledger = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${path}: release tombstone ledger is not JSON`);
  }
  validateReleaseTombstoneLedger(ledger, path);
  return { ...ledger, bytes, identity: releaseTombstoneIdentity(bytes, ledger) };
}

export function assertTombstoneOnlyTarget(target) {
  assertSafeCameraTarget(target);
  if (
    !existsSync(target) ||
    !lstatSync(target).isDirectory() ||
    !isDeepStrictEqual(readdirSync(target).sort(), ['tombstones.json'])
  ) {
    throw new Error('release adapter requires a tombstone-only staging directory');
  }
  return target;
}

export function assertNewOutputPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('adapter output path must be non-empty');
  }
  const target = resolve(value);
  if (target === parse(target).root || existsSync(target)) {
    throw new Error(`adapter output must be a new file: ${target}`);
  }
  let component = dirname(target);
  while (component !== parse(component).root) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`adapter output has a symlink component: ${component}`);
    }
    component = dirname(component);
  }
  return target;
}

export function writeNewFileAtomic(value, body) {
  let target = assertNewOutputPath(value);
  mkdirSync(dirname(target), { recursive: true });
  target = assertNewOutputPath(target);
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  writeFileSync(temporary, body, { flag: 'wx' });
  try {
    // Publish a complete inode without ever following or replacing a path that
    // appeared after preflight.
    linkSync(temporary, target);
  } finally {
    unlinkSync(temporary);
  }
  return target;
}

/** The union is only as fresh as its oldest constituent source build. */
export function oldestSourceBuild(builds) {
  if (builds.length === 0) throw new Error('no source-build timestamps');
  let oldest = Number.POSITIVE_INFINITY;
  for (const value of builds) {
    let canonical;
    try {
      canonical = canonicalSourceTimestamp(value, 'source manifest generatedAt');
    } catch {
      throw new Error('source manifest carried an invalid generatedAt timestamp');
    }
    oldest = Math.min(oldest, Date.parse(canonical));
  }
  return new Date(oldest).toISOString();
}

/** The minimum actual OSM snapshot watermark across every contributing response. */
export function sourceProvenance(review) {
  validateSourceReview(review);
  const minimumOsmBase = review.sourceWatermark.minimumOsmBase;
  return {
    source: CAMERA_SOURCE_LABEL,
    baseUpstream: minimumOsmBase,
    upstream: minimumOsmBase,
  };
}

/** Re-reading after the archive prevents a manifest rollover from mixing builds. */
export function assertStableManifest(before, after, country = 'source') {
  for (const [label, manifest] of [
    ['initial', before],
    ['confirming', after],
  ]) {
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      typeof manifest.version !== 'string' ||
      manifest.version.trim() === '' ||
      !Number.isSafeInteger(manifest.total) ||
      manifest.total < 0
    ) {
      throw new Error(`${country} ${label} manifest has no usable build identity`);
    }
    oldestSourceBuild([manifest.generatedAt]);
  }
  if (!isDeepStrictEqual(before, after)) {
    throw new Error(`${country} manifest changed while its archive was being fetched`);
  }
  return before;
}

const exactTimestamp = (value, label) => {
  const canonical = canonicalSourceTimestamp(value, label);
  if (value !== canonical) throw new Error(`${label} is not canonical`);
  return canonical;
};

const sequencePath = (sequence) =>
  String(sequence)
    .padStart(9, '0')
    .replace(/(\d{3})(\d{3})(\d{3})/, '$1/$2/$3');

export function replicationStateUrl(sequence) {
  return `https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/${sequencePath(sequence)}.state.txt`;
}

export function parseReplicationState(text, label = 'replication state') {
  const values = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) throw new Error(`${label} contains a malformed line`);
    values.set(line.slice(0, split), line.slice(split + 1).replaceAll('\\:', ':'));
  }
  const sequence = Number(values.get('sequenceNumber'));
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error(`${label} has no valid sequenceNumber`);
  }
  return {
    sequence,
    timestamp: canonicalSourceTimestamp(values.get('timestamp'), `${label} timestamp`),
  };
}

const hasExactKeys = (value, keys) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function validateDirectSourceReview(review) {
  if (
    Object.keys(review).sort().join(',') !==
      'captureImplementation,expectedSource,expectedTransformation,headSha,releaseInputs,replicationFloor,repository,schema,sourceWatermark,territories' ||
    review.repository !== PINNED_UPSTREAM.repository ||
    review.headSha !== PINNED_UPSTREAM.commit
  ) {
    throw new Error('direct source review does not identify the pinned query implementation');
  }

  const releaseInputs = review.releaseInputs;
  const tombstoneInput = releaseInputs?.tombstones;
  const predecessorInput = releaseInputs?.predecessor;
  if (
    !hasExactKeys(releaseInputs, ['geofence', 'predecessor', 'tombstones']) ||
    !isDeepStrictEqual(releaseInputs.geofence, RELEASE_GEOFENCE_IDENTITY) ||
    !hasExactKeys(predecessorInput, [
      'path',
      'bytes',
      'sha256',
      'mode',
      'liveCount',
      'liveIdsSha256',
      'deployment',
    ]) ||
    predecessorInput.path !== PREDECESSOR_PATH ||
    !Number.isSafeInteger(predecessorInput.bytes) ||
    predecessorInput.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(predecessorInput.sha256 ?? '') ||
    !['generation', 'legacy-flat-root', 'empty-r2'].includes(predecessorInput.mode) ||
    !Number.isSafeInteger(predecessorInput.liveCount) ||
    predecessorInput.liveCount < 0 ||
    !/^[0-9a-f]{64}$/.test(predecessorInput.liveIdsSha256 ?? '') ||
    !hasExactKeys(predecessorInput.deployment, ['provider', 'accountId', 'bucket']) ||
    predecessorInput.deployment.provider !== 'cloudflare-r2' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(predecessorInput.deployment.accountId ?? '') ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(predecessorInput.deployment.bucket ?? '') ||
    !hasExactKeys(tombstoneInput, ['path', 'bytes', 'sha256', 'count']) ||
    tombstoneInput.path !== RELEASE_TOMBSTONE_PATH ||
    !Number.isSafeInteger(tombstoneInput.bytes) ||
    tombstoneInput.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(tombstoneInput.sha256 ?? '') ||
    !Number.isSafeInteger(tombstoneInput.count) ||
    tombstoneInput.count < 0
  ) {
    throw new Error('direct source review does not bind its geofence and tombstone inputs');
  }

  const implementation = review.captureImplementation;
  const implementationFiles = implementation?.files;
  const requiredImplementationPaths = [
    'scripts/capture-deflock-source.mjs',
    'scripts/deflock-capture.mjs',
  ];
  if (
    !hasExactKeys(implementation, ['files']) ||
    !Array.isArray(implementationFiles) ||
    implementationFiles.length !== requiredImplementationPaths.length ||
    implementationFiles.some(
      (file, index) =>
        !hasExactKeys(file, ['path', 'bytes', 'sha256']) ||
        file.path !== requiredImplementationPaths[index] ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        !/^[0-9a-f]{64}$/.test(file.sha256 ?? ''),
    )
  ) {
    throw new Error('direct source review does not bind the checked-in capture implementation');
  }

  const source = review.expectedSource;
  const raw = source?.rawDataset;
  if (
    !hasExactKeys(source, ['country', 'build', 'capturedAt', 'total', 'rawDataset']) ||
    source.country !== 'us' ||
    typeof source.build !== 'string' ||
    source.build !== raw?.decodedSha256?.slice(0, 16) ||
    exactTimestamp(source.capturedAt, 'capture completion') !== source.capturedAt ||
    !Number.isSafeInteger(source.total) ||
    source.total < 1 ||
    !hasExactKeys(raw, [
      'path',
      'format',
      'compression',
      'bytes',
      'sha256',
      'decodedBytes',
      'decodedSha256',
      'featureCount',
    ]) ||
    raw.path !== RAW_DATASET_PATH ||
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
    throw new Error('direct source review has no exact raw dataset identity');
  }

  const watermark = review.sourceWatermark;
  const ledger = watermark?.responseLedger;
  const bundle = ledger?.responseBundle;
  const roleCounts = ledger?.roleCounts;
  const endpoints = ledger?.endpoints;
  if (
    !hasExactKeys(watermark, ['status', 'captureId', 'minimumOsmBase', 'responseLedger']) ||
    watermark.status !== 'approved' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      watermark.captureId ?? '',
    ) ||
    exactTimestamp(watermark.minimumOsmBase, 'minimum source OSM watermark') !==
      watermark.minimumOsmBase ||
    !hasExactKeys(ledger, [
      'schema',
      'path',
      'bytes',
      'sha256',
      'responseCount',
      'roleCounts',
      'endpoints',
      'responseBundle',
    ]) ||
    ledger.schema !== RESPONSE_LEDGER_SCHEMA ||
    ledger.path !== RESPONSE_LEDGER_PATH ||
    !Number.isSafeInteger(ledger.bytes) ||
    ledger.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(ledger.sha256 ?? '') ||
    !Number.isSafeInteger(ledger.responseCount) ||
    ledger.responseCount < 4 ||
    !hasExactKeys(roleCounts, ['count', 'data', 'subtraction']) ||
    !Number.isSafeInteger(roleCounts.count) ||
    roleCounts.count < 1 ||
    !Number.isSafeInteger(roleCounts.data) ||
    roleCounts.data < 1 ||
    roleCounts.subtraction !== 2 ||
    roleCounts.count + roleCounts.data + roleCounts.subtraction !== ledger.responseCount ||
    !Array.isArray(endpoints) ||
    endpoints.length < 1 ||
    !isDeepStrictEqual(endpoints, [...new Set(endpoints)].sort()) ||
    endpoints.some((endpoint) => !OVERPASS_ENDPOINTS.includes(endpoint)) ||
    !hasExactKeys(bundle, ['path', 'compression', 'bytes', 'sha256', 'responseCount']) ||
    bundle.path !== RESPONSE_BUNDLE_PATH ||
    bundle.compression !== 'gzip' ||
    !Number.isSafeInteger(bundle.bytes) ||
    bundle.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(bundle.sha256 ?? '') ||
    bundle.responseCount !== ledger.responseCount
  ) {
    throw new Error('direct source review has no approved, body-bound response ledger');
  }

  const transformation = review.expectedTransformation;
  if (
    !hasExactKeys(transformation, [
      'sourceFeatures',
      'excludedNonNodes',
      'excludedTerritory',
      'tombstonesBlocked',
      'tombstonesCleared',
      'outputElements',
      'elementsSha256',
      'outputTombstones',
      'publishedLiveSha256',
      'publishedTombstonesSha256',
    ]) ||
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
    transformation.outputElements !==
      transformation.sourceFeatures -
        transformation.excludedNonNodes -
        transformation.excludedTerritory -
        transformation.tombstonesBlocked ||
    transformation.tombstonesBlocked > tombstoneInput.count ||
    transformation.tombstonesCleared > tombstoneInput.count ||
    !Number.isSafeInteger(transformation.outputTombstones) ||
    transformation.outputTombstones !== tombstoneInput.count - transformation.tombstonesCleared ||
    !/^[0-9a-f]{64}$/.test(transformation.elementsSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(transformation.publishedLiveSha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(transformation.publishedTombstonesSha256 ?? '')
  ) {
    throw new Error('direct source review has no exact expected transformation');
  }

  const floor = review.replicationFloor;
  if (
    !hasExactKeys(floor, ['stream', 'sequence', 'timestamp', 'stateUrl']) ||
    floor.stream !== 'hour' ||
    !Number.isSafeInteger(floor.sequence) ||
    floor.sequence < 0 ||
    floor.stateUrl !== replicationStateUrl(floor.sequence) ||
    exactTimestamp(floor.timestamp, 'replication floor timestamp') !== floor.timestamp ||
    Date.parse(floor.timestamp) > Date.parse(watermark.minimumOsmBase) ||
    Date.parse(watermark.minimumOsmBase) > Date.parse(source.capturedAt)
  ) {
    throw new Error('direct source review has no valid conservative replication floor');
  }
  return review;
}

/** Validate the checked-in receipt before it influences source or continuity. */
export function validateSourceReview(review) {
  // This one checked-in v2 receipt records why the superseded PMTiles path is
  // blocked. Recognising its unapproved shape only improves the diagnostic; no
  // v2 receipt, including a synthetically "approved" one, is a trust root.
  if (
    review?.schema === 'darkroute-deflock-source-review/v2' &&
    review.sourceWatermark?.status === 'unapproved' &&
    hasExactKeys(review.sourceWatermark, [
      'status',
      'reason',
      'minimumOsmBase',
      'responseLedger',
    ]) &&
    typeof review.sourceWatermark.reason === 'string' &&
    review.sourceWatermark.reason.trim() !== '' &&
    review.sourceWatermark.minimumOsmBase === null &&
    review.sourceWatermark.responseLedger === null &&
    review.replicationFloor === null
  ) {
    throw new Error(`source review is explicitly unapproved: ${review.sourceWatermark.reason}`);
  }

  if (
    typeof review !== 'object' ||
    review === null ||
    Array.isArray(review) ||
    review.schema !== CAMERA_SOURCE_REVIEW_SCHEMA ||
    review.repository !== 'flockhopper3/deflock-data' ||
    !/^[0-9a-f]{40}$/.test(review.headSha ?? '') ||
    !Array.isArray(review.territories) ||
    review.territories.length !== CAMERA_SOURCE_TERRITORIES.length ||
    review.territories.some((territory, index) => territory !== CAMERA_SOURCE_TERRITORIES[index])
  ) {
    throw new Error('source review is not the approved US/PR receipt');
  }

  return validateDirectSourceReview(review);
}

/**
 * Verify the upstream ledger bytes, then derive its minimum watermark,
 * successful endpoints, and role counts rather than trusting summary fields.
 */
export function assertReviewedResponseLedger(review, { ledgerBytes, responseBundle, rawDataset }) {
  validateSourceReview(review);
  const expected = review.sourceWatermark.responseLedger;
  let ledger;
  try {
    ledger = JSON.parse(ledgerBytes.toString('utf8'));
  } catch {
    throw new Error('Overpass response ledger bytes do not match the reviewed receipt');
  }
  if (
    ledgerBytes.length !== expected.bytes ||
    createHash('sha256').update(ledgerBytes).digest('hex') !== expected.sha256
  ) {
    throw new Error('Overpass response ledger bytes do not match the reviewed receipt');
  }
  const validated = validateCaptureArtifacts(ledger, {
    ledgerBytes,
    responseBundle,
    rawDataset,
    implementationFiles: review.captureImplementation.files,
  });
  if (!isDeepStrictEqual(ledger.implementation.localFiles, review.captureImplementation.files)) {
    throw new Error('Overpass capture ledger does not bind the reviewed local implementation');
  }
  if (
    ledger.captureId !== review.sourceWatermark.captureId ||
    ledger.capture.completedAt !== review.expectedSource.capturedAt ||
    validated.minimumOsmBase !== review.sourceWatermark.minimumOsmBase ||
    !isDeepStrictEqual(validated.ledgerIdentity, {
      path: expected.path,
      bytes: expected.bytes,
      sha256: expected.sha256,
    }) ||
    validated.responseBundle.responseCount !== expected.responseCount ||
    !isDeepStrictEqual(validated.responseBundle, expected.responseBundle) ||
    !isDeepStrictEqual(validated.roleCounts, expected.roleCounts) ||
    !isDeepStrictEqual(validated.endpoints, expected.endpoints) ||
    !isDeepStrictEqual(validated.rawDataset, review.expectedSource.rawDataset)
  ) {
    throw new Error('Overpass capture artifacts do not match the approved source receipt');
  }
  return validated;
}

/** Bind an approved receipt to the exact local capture code before network I/O. */
export function assertCaptureImplementation(review, root = ROOT) {
  validateSourceReview(review);
  for (const expected of review.captureImplementation.files) {
    const bytes = readFileSync(resolve(root, expected.path));
    if (
      bytes.length !== expected.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== expected.sha256
    ) {
      throw new Error(`capture implementation ${expected.path} does not match its receipt`);
    }
  }
  return review.captureImplementation;
}

export function assertReviewedRun(actual, review, kind) {
  const expected = kind === 'fetch' ? review.fetchRun : review.buildRun;
  if (
    actual?.id !== expected.id ||
    actual?.path !== expected.workflowPath ||
    actual?.head_sha !== review.headSha ||
    actual?.status !== 'completed' ||
    actual?.conclusion !== 'success' ||
    actual?.html_url !== expected.url ||
    canonicalSourceTimestamp(actual?.run_started_at, `${kind} API run start`) !==
      expected.runStartedAt
  ) {
    throw new Error(`${kind} source workflow run does not match its reviewed receipt`);
  }
  return actual;
}

export function assertReviewedReplicationFloor(review, floor, next) {
  const expected = review.replicationFloor;
  if (floor.sequence !== expected.sequence || floor.timestamp !== expected.timestamp) {
    throw new Error('official replication floor does not match the reviewed receipt');
  }
  if (next.sequence !== floor.sequence + 1) {
    throw new Error('official replication floor has no exact next sequence');
  }
  const sourceWatermark = Date.parse(review.sourceWatermark.minimumOsmBase);
  if (!(
    Date.parse(floor.timestamp) <= sourceWatermark && sourceWatermark < Date.parse(next.timestamp)
  )) {
    throw new Error('reviewed minimum OSM watermark is not in the replay overlap interval');
  }
  return expected;
}

export function assertSourceIndex(index, manifest, review) {
  if (
    typeof index !== 'object' ||
    index === null ||
    index.version !== 1 ||
    index.build !== review.expectedSource.manifestVersion ||
    index.count !== review.expectedSource.total ||
    manifest.version !== index.build ||
    manifest.total !== index.count
  ) {
    throw new Error('source manifest and companion index do not identify the reviewed build');
  }
  return index;
}

/** The exact manifest identity bound into the adapter/fetcher hand-off. */
export function sourceManifestIdentity(country, manifest, artifact) {
  if (
    !COUNTRIES.includes(country) ||
    typeof manifest !== 'object' ||
    manifest === null ||
    typeof manifest.version !== 'string' ||
    manifest.version.trim() === '' ||
    !Number.isSafeInteger(manifest.total) ||
    manifest.total < 1 ||
    typeof artifact !== 'object' ||
    artifact === null ||
    typeof artifact.url !== 'string' ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')
  ) {
    throw new Error('source manifest has no usable US build identity');
  }
  return {
    country,
    version: manifest.version,
    generatedAt: canonicalSourceTimestamp(manifest.generatedAt, 'source manifest generatedAt'),
    total: manifest.total,
    url: artifact.url,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
  };
}

export function sourceHandoff({ source, review, reviewSha256, transformation }) {
  if (
    typeof source !== 'object' ||
    source === null ||
    !/^[0-9a-f]{64}$/.test(reviewSha256 ?? '') ||
    typeof transformation !== 'object' ||
    transformation === null ||
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
    !/^[0-9a-f]{64}$/.test(transformation.publishedTombstonesSha256 ?? '')
  ) {
    throw new Error('camera source hand-off must pin the reviewed direct source capture');
  }
  validateSourceReview(review);
  if (!isDeepStrictEqual(source, review.expectedSource)) {
    throw new Error('camera source hand-off does not match its reviewed raw source artifact');
  }
  if (!isDeepStrictEqual(transformation, review.expectedTransformation)) {
    throw new Error('camera source hand-off does not match its reviewed transformation');
  }
  return {
    schema: CAMERA_SOURCE_SCHEMA,
    generator: CAMERA_SOURCE_GENERATOR,
    territories: [...CAMERA_SOURCE_TERRITORIES],
    source,
    review: { sha256: reviewSha256, receipt: review },
    transformation,
  };
}

/**
 * The release source contract is 50 states + DC + Puerto Rico, not every US
 * territory that can appear inside the capture seed rectangles.
 *
 * The vendored Census file contains exactly those 52 state-equivalent FIPS
 * groups. Source admission is strict polygon containment. A prior reviewed
 * source sample contained US Virgin Islands and offshore/coastline points;
 * those measurements are evidence for the gate, not promised release counts.
 */
export function sourceTerritoryIncludes(camera, countyIndex) {
  if (
    typeof countyIndex !== 'object' ||
    countyIndex === null ||
    !Array.isArray(countyIndex.counties) ||
    countyIndex.counties.length === 0 ||
    typeof countyIndex.lookup !== 'function'
  ) {
    throw new Error('release source territory has no US/PR county polygons');
  }
  return countyIndex.lookup(camera.lat, camera.lon) !== null;
}

export function recordOsmTimestamp(camera) {
  const stringValue = camera.osmTimestamp ?? camera.timestamp;
  if (typeof stringValue === 'string') {
    try {
      canonicalSourceTimestamp(stringValue, 'camera OSM timestamp');
      return stringValue.trim();
    } catch {
      return null;
    }
  }
  if (
    Number.isSafeInteger(camera.updatedAt) &&
    camera.updatedAt > 0 &&
    !Number.isNaN(new Date(camera.updatedAt).valueOf())
  ) {
    return new Date(camera.updatedAt).toISOString();
  }
  return null;
}

export function assertVersionedSourceRecords(cameras, label = 'source archive') {
  for (const camera of cameras) {
    if (
      typeof camera.id !== 'string' ||
      !/^osm:[1-9]\d*$/.test(camera.id) ||
      typeof camera.lat !== 'number' ||
      !Number.isFinite(camera.lat) ||
      typeof camera.lon !== 'number' ||
      !Number.isFinite(camera.lon) ||
      !Number.isSafeInteger(camera.osmVersion) ||
      camera.osmVersion < 1 ||
      recordOsmTimestamp(camera) === null
    ) {
      throw new Error(`${label} contains an invalid, unversioned, or untimestamped OSM node`);
    }
  }
  return cameras;
}

/** Canonical point used by both territorial admission and the tile builder. */
export function normaliseCapturedCameraPoint(camera) {
  return {
    ...camera,
    lat: normaliseCoordinate(camera.lat),
    lon: normaliseCoordinate(camera.lon),
  };
}

export function toOverpassElements(cameras) {
  assertVersionedSourceRecords(cameras);
  return [...cameras]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((camera) => {
      const timestamp = recordOsmTimestamp(camera);
      return {
        type: 'node',
        id: Number(camera.id.slice(4)),
        lat: camera.lat,
        lon: camera.lon,
        version: camera.osmVersion,
        timestamp,
        tags: {
          man_made: 'surveillance',
          'surveillance:type': 'ALPR',
          ...(camera.tags ?? {}),
          ...(typeof camera.directionDeg === 'number' && Number.isFinite(camera.directionDeg)
            ? { direction: String(camera.directionDeg) }
            : {}),
        },
      };
    });
}

export function cameraElementsSha256(cameras) {
  return createHash('sha256')
    .update(JSON.stringify(toOverpassElements(cameras)))
    .digest('hex');
}

/** Deterministically derive the reviewed release set from one validated capture. */
export function transformCapturedCollection(collection, tombstones, countyIndex) {
  if (!Array.isArray(collection?.features) || !Array.isArray(tombstones)) {
    throw new Error('direct capture transformation requires features and tombstones');
  }
  const byId = new Map();
  const decoded = collection.features.length;
  let excludedTerritory = 0;
  let excludedNonNodes = 0;
  const sourceRecords = [];
  for (const feature of collection.features) {
    if (feature?.properties?.osmType !== 'node') {
      excludedNonNodes += 1;
      continue;
    }
    const capturedCamera = capturedFeatureToRecord(feature);
    if (capturedCamera === null) {
      throw new Error('direct capture node did not produce a camera record');
    }
    // Territory is evaluated at the exact five-decimal point that the builder
    // publishes. Checking a higher-precision source point first can disagree at
    // a polygon edge and produce a receipt that its own deterministic build
    // later rejects.
    const camera = normaliseCapturedCameraPoint(capturedCamera);
    sourceRecords.push(camera);
    if (!sourceTerritoryIncludes(camera, countyIndex)) {
      excludedTerritory += 1;
      continue;
    }
    if (byId.has(camera.id)) throw new Error(`direct source repeats ${camera.id}`);
    byId.set(camera.id, camera);
  }
  assertVersionedSourceRecords(sourceRecords, 'direct source capture');

  const extracted = byId.size;
  const territorialCameras = [...byId.values()];
  const resolved = reconcileTombstoneFloor(territorialCameras, tombstones);
  const cameras = [...resolved.live];
  const publishedRecords = toOverpassElements(cameras).map((element) => normalise(element));
  const publishedIdentity = cameraCoreIdentity(publishedRecords, resolved.tombstones);
  const transformation = {
    sourceFeatures: decoded,
    excludedNonNodes,
    excludedTerritory,
    tombstonesBlocked: resolved.blocked.length,
    tombstonesCleared: resolved.cleared.length,
    outputElements: cameras.length,
    elementsSha256: cameraElementsSha256(cameras),
    outputTombstones: resolved.tombstones.length,
    publishedLiveSha256: publishedIdentity.liveSha256,
    publishedTombstonesSha256: publishedIdentity.tombstonesSha256,
  };
  assertReleaseCameraMinimum(transformation.outputElements);
  return { cameras, territorialCameras, transformation, extracted, resolved, publishedRecords };
}

/** Build a self-describing Overpass-shaped hand-off for `fetch-cameras.mjs`. */
export function toOverpassDump(cameras, provenance, cameraSource) {
  const elements = toOverpassElements(cameras);
  if (
    typeof provenance !== 'object' ||
    provenance === null ||
    provenance.source !== CAMERA_SOURCE_LABEL ||
    provenance.baseUpstream !== cameraSource?.review?.receipt?.sourceWatermark?.minimumOsmBase ||
    provenance.upstream !== provenance.baseUpstream
  ) {
    throw new Error('camera source hand-off does not match conservative source provenance');
  }
  const elementsSha256 = createHash('sha256').update(JSON.stringify(elements)).digest('hex');
  if (
    cameraSource.transformation?.outputElements !== elements.length ||
    cameraSource.transformation?.elementsSha256 !== elementsSha256
  ) {
    throw new Error('camera source hand-off does not bind its exact output elements');
  }
  return {
    version: 0.6,
    generator: CAMERA_SOURCE_GENERATOR,
    cameraSource,
    ...provenance,
    elements,
  };
}

export async function getExactUrl(url, mode, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-cache' },
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${String(res.status)}`);
  if (res.url !== url) {
    throw new Error(`${url} resolved to an unreviewed URL: ${String(res.url)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const body =
    mode === 'json'
      ? JSON.parse(bytes.toString('utf8'))
      : mode === 'text'
        ? bytes.toString('utf8')
        : bytes;
  return {
    body,
    etag: res.headers.get('etag') ?? '',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url,
  };
}

export async function extract(archive) {
  const header = readHeader(archive);
  const { gunzipSync } = await import('node:zlib');
  const inflate = (buf, compression) => (compression === 2 ? gunzipSync(buf) : buf);

  const dirs = [
    readDirectory(
      inflate(
        archive.subarray(header.rootDirOffset, header.rootDirOffset + header.rootDirLength),
        header.internalCompression,
      ),
    ),
  ];

  const byId = new Map();
  const sourceFeatures = new Set();
  const nonNodeFeatures = new Set();
  let tilesRead = 0;

  while (dirs.length > 0) {
    for (const entry of dirs.pop()) {
      if (entry.runLength === 0) {
        // A leaf directory, not a tile.
        dirs.push(
          readDirectory(
            inflate(
              archive.subarray(
                header.leafDirOffset + entry.offset,
                header.leafDirOffset + entry.offset + entry.length,
              ),
              header.internalCompression,
            ),
          ),
        );
        continue;
      }
      // Only the deepest zoom: shallower tiles are the same cameras, clustered.
      const { z, x, y } = tileIdToZxy(entry.tileId);
      if (z !== header.maxZoom) continue;

      const raw = archive.subarray(
        header.tileDataOffset + entry.offset,
        header.tileDataOffset + entry.offset + entry.length,
      );
      const tile = new VectorTile(new PbfReader(inflate(raw, header.tileCompression)));
      tilesRead += 1;

      for (const name of Object.keys(tile.layers)) {
        const layer = tile.layers[name];
        for (let i = 0; i < layer.length; i += 1) {
          const feature = layer.feature(i);
          const props = feature.properties ?? {};
          const featureKey = `${String(props['osmType'])}:${String(props['osmId'])}`;
          sourceFeatures.add(featureKey);
          if (props['osmType'] !== 'node') nonNodeFeatures.add(featureKey);
          const record = toRecord(feature, z, x, y);
          // Deduped by OSM id: a camera on a tile boundary is encoded twice.
          if (record !== null && !byId.has(record.id)) byId.set(record.id, record);
        }
      }
    }
  }

  return {
    cameras: [...byId.values()],
    tilesRead,
    maxZoom: header.maxZoom,
    sourceFeatures: sourceFeatures.size,
    nonNodeFeatures: nonNodeFeatures.size,
  };
}

export function parseDeflockArgs(argv) {
  const parsed = {
    dry: false,
    out: null,
    overpass: null,
    sourceReview: null,
  };
  const seen = new Set();
  const once = (name) => {
    if (seen.has(name)) throw new Error(`${name} may be supplied only once`);
    seen.add(name);
  };
  const option = (index, name) => {
    const arg = argv[index];
    if (arg === name) {
      const value = argv[index + 1];
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

  for (let index = 0; index < argv.length;) {
    if (argv[index] === '--dry') {
      once('--dry');
      parsed.dry = true;
      index += 1;
      continue;
    }
    const out = option(index, '--out');
    if (out !== null) {
      once('--out');
      parsed.out = out.value;
      index += out.consumed;
      continue;
    }
    const overpass = option(index, '--overpass');
    if (overpass !== null) {
      once('--overpass');
      parsed.overpass = overpass.value;
      index += overpass.consumed;
      continue;
    }
    const sourceReview = option(index, '--source-review');
    if (sourceReview !== null) {
      once('--source-review');
      parsed.sourceReview = sourceReview.value;
      index += sourceReview.consumed;
      continue;
    }
    if (
      argv[index] === '--carry-existing' ||
      argv[index] === '--carry-base-upstream' ||
      argv[index].startsWith('--carry-base-upstream=')
    ) {
      throw new Error(
        'local archive carry is unsupported; use a current, versioned authoritative source',
      );
    }
    throw new Error(`unknown fetch-cameras-deflock argument: ${argv[index]}`);
  }
  if (parsed.out === null) throw new Error('--out is required for a tombstone-only stage');
  if (parsed.overpass === null) throw new Error('--overpass is required and must be a new file');
  return parsed;
}

async function main() {
  const { dry, out, overpass, sourceReview } = parseDeflockArgs(process.argv.slice(2));
  if (sourceReview === null) {
    throw new Error('--source-review is required for a release source hand-off');
  }
  const reviewPath = resolve(sourceReview);
  const reviewBytes = readFileSync(reviewPath);
  const review = validateSourceReview(JSON.parse(reviewBytes.toString('utf8')));
  const reviewSha256 = createHash('sha256').update(reviewBytes).digest('hex');
  const outputPath = assertNewOutputPath(overpass);

  // All local trust roots are verified before the first network request.
  assertTombstoneOnlyTarget(out);
  assertCaptureImplementation(review);
  const responseLedgerBytes = readFileSync(resolve(ROOT, RESPONSE_LEDGER_PATH));
  const responseBundle = readFileSync(resolve(ROOT, RESPONSE_BUNDLE_PATH));
  const rawDataset = readFileSync(resolve(ROOT, RAW_DATASET_PATH));
  const capture = assertReviewedResponseLedger(review, {
    ledgerBytes: responseLedgerBytes,
    responseBundle,
    rawDataset,
  });
  const tombstoneLedger = readTombstoneLedger(out);
  const retainedTombstoneBytes = readFileSync(DEFAULT_RELEASE_TOMBSTONES);
  let retainedTombstoneLedger;
  try {
    retainedTombstoneLedger = JSON.parse(retainedTombstoneBytes.toString('utf8'));
  } catch {
    throw new Error('retained baseline tombstone input is not JSON');
  }
  const retainedTombstoneIdentity = releaseTombstoneIdentity(
    retainedTombstoneBytes,
    retainedTombstoneLedger,
  );
  if (
    !retainedTombstoneBytes.equals(tombstoneLedger.bytes) ||
    !isDeepStrictEqual(retainedTombstoneIdentity, tombstoneLedger.identity)
  ) {
    throw new Error(
      'tombstone-only stage does not exactly match the retained baseline tombstone input',
    );
  }
  const predecessorBytes = readFileSync(resolve(ROOT, PREDECESSOR_PATH));
  const predecessor = validatePredecessorEvidence(JSON.parse(predecessorBytes.toString('utf8')));
  const predecessorTombstoneBytes =
    predecessor.source.mode === 'empty-r2'
      ? null
      : readFileSync(resolve(ROOT, PREDECESSOR_TOMBSTONES_PATH));
  const geofenceBytes = readFileSync(DEFAULT_COUNTY_GEOFENCE);
  const releaseInputs = {
    geofence: releaseGeofenceIdentity(geofenceBytes),
    predecessor: predecessorIdentity(predecessorBytes, predecessor),
    tombstones: retainedTombstoneIdentity,
  };
  if (!isDeepStrictEqual(releaseInputs, review.releaseInputs)) {
    throw new Error('release geofence or tombstone bytes do not match the approved review');
  }
  const countyIndex = loadCountiesBytes(geofenceBytes);
  await verifyTombstoneLedgerAncestry({
    predecessor,
    sourceBytes: predecessorTombstoneBytes,
    migratedBytes: tombstoneLedger.bytes,
    migratedLedger: tombstoneLedger,
    countyIndex,
  });

  const floorResponse = await getExactUrl(review.replicationFloor.stateUrl, 'text');
  const nextResponse = await getExactUrl(
    replicationStateUrl(review.replicationFloor.sequence + 1),
    'text',
  );
  assertReviewedReplicationFloor(
    review,
    parseReplicationState(floorResponse.body, 'reviewed replication floor'),
    parseReplicationState(nextResponse.body, 'next replication sequence'),
  );

  const { cameras, transformation, extracted, resolved } = transformCapturedCollection(
    capture.collection,
    tombstoneLedger.tombstones,
    countyIndex,
  );
  await verifyCutoverReconciliation({
    predecessor,
    sourceBytes: predecessorTombstoneBytes,
    migratedBytes: tombstoneLedger.bytes,
    migratedLedger: tombstoneLedger,
    baselineLiveIds: cameras.map((camera) => camera.id),
    countyIndex,
  });
  assertPredecessorCoverage(
    predecessor,
    cameras.map((camera) => camera.id),
    tombstoneLedger.tombstones,
  );
  if (resolved.blocked.length > 0 || resolved.cleared.length > 0) {
    console.log(
      `  tombstone floor: ${String(resolved.blocked.length)} blocked, ` +
        `${String(resolved.cleared.length)} cleared by newer source versions`,
    );
  }
  const provenance = sourceProvenance(review);
  const cameraSource = sourceHandoff({
    source: review.expectedSource,
    review,
    reviewSha256,
    transformation,
  });
  console.log(
    `  ${String(transformation.sourceFeatures)} decoded; ` +
      `${String(transformation.excludedNonNodes)} non-nodes and ` +
      `${String(transformation.excludedTerritory)} points outside 50 states/DC/PR excluded; ` +
      `${String(extracted)} territorial cameras; ${String(cameras.length)} after the tombstone floor`,
  );

  if (transformation.sourceFeatures !== review.expectedSource.total) {
    throw new Error('decoded source count does not match its exact raw dataset');
  }

  if (dry) {
    console.log('dry run: nothing written');
    return;
  }

  /*
   * Emit only the explicit-new Overpass handoff. `fetch-cameras.mjs` consumes
   * it beside the tombstone-only stage, so no old live annotation can be
   * carried outside the reviewed transformation digest.
   */
  const path = outputPath;
  const dump = toOverpassDump(cameras, provenance, cameraSource);
  writeNewFileAtomic(path, `${JSON.stringify(dump)}\n`);
  console.log(`wrote ${path} (${String(dump.elements.length)} elements)`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main();
}
