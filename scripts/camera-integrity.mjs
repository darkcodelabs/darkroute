import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { ATTRIBUTION, LICENCE, LICENCE_URL } from './fetch-cameras.mjs';

export const CAMERA_CONTINUITY_KEY = 'continuity.json';
export const CAMERA_CONTINUITY_SCHEMA = 'darkroute-camera-continuity/v1';
export const CAMERA_CORE_SCHEMA = 'darkroute-camera-osm-core/v1';
export const CAMERA_CORE_ENCODING = 'gzip+base64';
export const MAX_CAMERA_CORE_BYTES = 256 * 1024 * 1024;

const HASH = /^[0-9a-f]{64}$/;
const OSM_ID = /^osm:[1-9]\d*$/;
const ENRICHMENT_FIELDS = new Set(['street', 'cross', 'countyFips', 'placeGeoid']);

const object = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function canonicalIntegrityJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalIntegrityJson).join(',')}]`;
  if (object(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalIntegrityJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('camera continuity cannot canonicalise undefined');
  return encoded;
}

function exactKeys(value, required, name) {
  if (!object(value) || Object.keys(value).sort().join(',') !== [...required].sort().join(',')) {
    throw new Error(`${name} has an invalid schema`);
  }
}

function timestamp(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} is not a timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} is not a timestamp`);
  const canonical = new Date(parsed).toISOString();
  if (value !== canonical && value !== canonical.replace('.000Z', 'Z')) {
    throw new Error(`${name} is not a canonical timestamp`);
  }
  return value;
}

/**
 * Preserve every published field except the four deterministic local
 * enrichments. This makes a replay check sensitive to every OSM-derived value
 * without pretending that reverse-geocoded street/cross or Census joins came
 * from an OSM diff.
 */
export function cameraOsmCore(camera) {
  if (!object(camera) || !OSM_ID.test(camera.id ?? '')) {
    throw new Error('camera continuity encountered a non-canonical camera id');
  }
  // A normal object would invoke the legacy __proto__ setter when a hostile
  // JSON record carries that key, silently dropping it from the digest.  A
  // null-prototype object makes every own key ordinary data.
  const core = Object.create(null);
  for (const key of Object.keys(camera).sort()) {
    if (!ENRICHMENT_FIELDS.has(key)) core[key] = camera[key];
  }
  return core;
}

export function canonicalLiveCore(cameras) {
  if (!Array.isArray(cameras)) throw new Error('camera continuity live set is not an array');
  const live = cameras
    .map(cameraOsmCore)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (let index = 1; index < live.length; index += 1) {
    if (live[index - 1].id === live[index].id) {
      throw new Error(`camera continuity repeats live id ${live[index].id}`);
    }
  }
  return live;
}

export function canonicalTombstoneCore(tombstones) {
  if (!Array.isArray(tombstones)) throw new Error('camera continuity tombstones are not an array');
  const sorted = tombstones
    .map((entry) => {
      exactKeys(entry, ['id', 'reason', 'seq', 'osmVersion'], 'camera continuity tombstone');
      if (
        !OSM_ID.test(entry.id ?? '') ||
        !['osm_delete', 'osm_untag', 'osm_out_of_scope', 'cutover_reconciliation'].includes(
          entry.reason,
        ) ||
        !Number.isSafeInteger(entry.seq) ||
        entry.seq < 0 ||
        !Number.isSafeInteger(entry.osmVersion) ||
        entry.osmVersion < 1
      ) {
        throw new Error(`camera continuity has invalid tombstone ${String(entry.id)}`);
      }
      return { ...entry };
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].id === sorted[index].id) {
      throw new Error(`camera continuity repeats tombstone id ${sorted[index].id}`);
    }
  }
  return sorted;
}

export function cameraCoreIdentity(live, tombstones) {
  const canonicalLive = canonicalLiveCore(live);
  const canonicalTombstones = canonicalTombstoneCore(tombstones);
  return {
    live: canonicalLive,
    tombstones: canonicalTombstones,
    liveSha256: sha256(Buffer.from(canonicalIntegrityJson(canonicalLive))),
    tombstonesSha256: sha256(Buffer.from(canonicalIntegrityJson(canonicalTombstones))),
  };
}

export function cameraCoreFromArchiveEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('camera archive entries are not an array');
  const live = [];
  let tombstones = null;
  for (const entry of entries) {
    if (!object(entry) || typeof entry.key !== 'string' || !Buffer.isBuffer(entry.body)) {
      throw new Error('camera archive has an invalid entry for continuity');
    }
    if (/^11\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\.json$/.test(entry.key)) {
      let tile;
      try {
        tile = JSON.parse(entry.body.toString('utf8'));
      } catch {
        throw new Error(`camera continuity cannot parse ${entry.key}`);
      }
      if (!Array.isArray(tile?.cameras)) throw new Error(`${entry.key} has no camera array`);
      live.push(...tile.cameras);
    } else if (entry.key === 'tombstones.json') {
      let ledger;
      try {
        ledger = JSON.parse(entry.body.toString('utf8'));
      } catch {
        throw new Error('camera continuity cannot parse tombstones.json');
      }
      if (!Array.isArray(ledger?.tombstones)) {
        throw new Error('camera continuity found no tombstone ledger');
      }
      tombstones = ledger.tombstones;
    }
  }
  if (tombstones === null) throw new Error('camera continuity found no tombstones.json');
  return cameraCoreIdentity(live, tombstones);
}

export function parseCameraContinuityBytes(bytes, options = {}) {
  let value;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('camera continuity sidecar is not JSON');
  }
  const checked = validateCameraContinuity(value, options);
  if (!Buffer.from(bytes).equals(cameraContinuityBytes(value))) {
    throw new Error('camera continuity sidecar is not canonical transport JSON');
  }
  return checked;
}

export function encodeCameraCore(live, tombstones) {
  const identity = cameraCoreIdentity(live, tombstones);
  const decoded = Buffer.from(
    canonicalIntegrityJson({
      schema: CAMERA_CORE_SCHEMA,
      live: identity.live,
      tombstones: identity.tombstones,
    }),
  );
  if (decoded.length > MAX_CAMERA_CORE_BYTES)
    throw new Error('camera continuity core is too large');
  const compressed = gzipSync(decoded, { level: 9, mtime: 0 });
  return {
    identity,
    descriptor: {
      encoding: CAMERA_CORE_ENCODING,
      bytes: compressed.length,
      sha256: sha256(compressed),
      decodedBytes: decoded.length,
      decodedSha256: sha256(decoded),
      data: compressed.toString('base64'),
    },
  };
}

export function decodeCameraCore(descriptor) {
  exactKeys(
    descriptor,
    ['encoding', 'bytes', 'sha256', 'decodedBytes', 'decodedSha256', 'data'],
    'camera continuity core descriptor',
  );
  if (
    descriptor.encoding !== CAMERA_CORE_ENCODING ||
    !Number.isSafeInteger(descriptor.bytes) ||
    descriptor.bytes < 1 ||
    !HASH.test(descriptor.sha256 ?? '') ||
    !Number.isSafeInteger(descriptor.decodedBytes) ||
    descriptor.decodedBytes < 1 ||
    descriptor.decodedBytes > MAX_CAMERA_CORE_BYTES ||
    !HASH.test(descriptor.decodedSha256 ?? '') ||
    typeof descriptor.data !== 'string'
  ) {
    throw new Error('camera continuity core descriptor is invalid');
  }
  const compressed = Buffer.from(descriptor.data, 'base64');
  if (
    compressed.toString('base64') !== descriptor.data ||
    compressed.length !== descriptor.bytes ||
    sha256(compressed) !== descriptor.sha256
  ) {
    throw new Error('camera continuity compressed core identity is invalid');
  }
  let decoded;
  try {
    decoded = gunzipSync(compressed, { maxOutputLength: MAX_CAMERA_CORE_BYTES });
  } catch {
    throw new Error('camera continuity core is not valid bounded gzip data');
  }
  if (decoded.length !== descriptor.decodedBytes || sha256(decoded) !== descriptor.decodedSha256) {
    throw new Error('camera continuity decoded core identity is invalid');
  }
  if (!gzipSync(decoded, { level: 9, mtime: 0 }).equals(compressed)) {
    throw new Error('camera continuity core is not canonical deterministic gzip');
  }
  let value;
  try {
    value = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw new Error('camera continuity core is not JSON');
  }
  exactKeys(value, ['schema', 'live', 'tombstones'], 'camera continuity core');
  if (
    value.schema !== CAMERA_CORE_SCHEMA ||
    decoded.toString('utf8') !== canonicalIntegrityJson(value)
  ) {
    throw new Error('camera continuity core is not canonical');
  }
  return cameraCoreIdentity(value.live, value.tombstones);
}

function validateSnapshotRef(value, name) {
  exactKeys(value, ['slot', 'generation', 'manifestSha256'], name);
  if (
    !['a', 'b', 'c'].includes(value.slot) ||
    !HASH.test(value.generation) ||
    !HASH.test(value.manifestSha256)
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

export function validateTransition(value, replication, baseline) {
  exactKeys(
    value,
    ['kind', 'parent', 'fromSequence', 'throughSequence', 'diffs'],
    'camera continuity transition',
  );
  if (!['baseline-replay', 'replication'].includes(value.kind)) {
    throw new Error('camera continuity transition kind is invalid');
  }
  if (value.kind === 'baseline-replay') {
    if (value.parent !== null) throw new Error('baseline replay cannot claim a versioned parent');
    if (value.fromSequence !== baseline.sequence) {
      throw new Error('baseline replay does not start at the approved baseline sequence');
    }
  } else {
    validateSnapshotRef(value.parent, 'camera continuity parent');
  }
  if (
    !Number.isSafeInteger(value.fromSequence) ||
    value.fromSequence < 0 ||
    !Number.isSafeInteger(value.throughSequence) ||
    value.throughSequence < value.fromSequence ||
    value.throughSequence !== replication.lastAppliedSeq ||
    !Array.isArray(value.diffs) ||
    value.diffs.length !== value.throughSequence - value.fromSequence
  ) {
    throw new Error('camera continuity transition range is invalid');
  }
  if (
    value.kind === 'baseline-replay' &&
    value.diffs.length === 0 &&
    replication.lastAppliedTimestamp !== baseline.timestamp
  ) {
    throw new Error('zero-diff baseline replay has the wrong replication timestamp');
  }
  for (let index = 0; index < value.diffs.length; index += 1) {
    const diff = value.diffs[index];
    exactKeys(
      diff,
      [
        'sequence',
        'timestamp',
        'stateUrl',
        'stateBytes',
        'stateSha256',
        'diffUrl',
        'diffBytes',
        'diffSha256',
      ],
      'camera continuity diff',
    );
    const sequence = value.fromSequence + index + 1;
    const path = String(sequence).padStart(9, '0').match(/.{3}/g).join('/');
    if (
      diff.sequence !== sequence ||
      diff.stateUrl !==
        `https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/${path}.state.txt` ||
      diff.diffUrl !==
        `https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/${path}.osc.gz` ||
      !Number.isSafeInteger(diff.stateBytes) ||
      diff.stateBytes < 1 ||
      !HASH.test(diff.stateSha256 ?? '') ||
      !Number.isSafeInteger(diff.diffBytes) ||
      diff.diffBytes < 1 ||
      !HASH.test(diff.diffSha256 ?? '')
    ) {
      throw new Error('camera continuity diff identity is invalid');
    }
    timestamp(diff.timestamp, 'camera continuity diff timestamp');
  }
  if (value.diffs.length > 0 && value.diffs.at(-1).timestamp !== replication.lastAppliedTimestamp) {
    throw new Error('camera continuity final diff does not own the replication timestamp');
  }
  return value;
}

export function createCameraContinuity({
  reviewSha256,
  baseline,
  baselineTombstones,
  transition,
  replication,
  live,
  tombstones,
}) {
  if (!HASH.test(reviewSha256 ?? '')) throw new Error('camera continuity review hash is invalid');
  exactKeys(
    baseline,
    ['sequence', 'timestamp', 'liveSha256', 'tombstonesSha256'],
    'camera continuity baseline',
  );
  if (
    !Number.isSafeInteger(baseline.sequence) ||
    baseline.sequence < 0 ||
    !HASH.test(baseline.liveSha256 ?? '') ||
    !HASH.test(baseline.tombstonesSha256 ?? '')
  ) {
    throw new Error('camera continuity baseline identity is invalid');
  }
  timestamp(baseline.timestamp, 'camera continuity baseline timestamp');
  const canonicalBaselineTombstones = canonicalTombstoneCore(baselineTombstones);
  if (
    sha256(Buffer.from(canonicalIntegrityJson(canonicalBaselineTombstones))) !==
    baseline.tombstonesSha256
  ) {
    throw new Error('camera continuity baseline tombstones do not match the approved digest');
  }
  const encoded = encodeCameraCore(live, tombstones);
  const document = {
    schema: CAMERA_CONTINUITY_SCHEMA,
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    reviewSha256,
    baseline: { ...baseline },
    baselineTombstones: canonicalBaselineTombstones,
    transition: { ...transition },
    replication: { ...replication },
    liveCount: encoded.identity.live.length,
    tombstoneCount: encoded.identity.tombstones.length,
    liveSha256: encoded.identity.liveSha256,
    tombstonesSha256: encoded.identity.tombstonesSha256,
    core: encoded.descriptor,
  };
  validateCameraContinuity(document, { replication, live, tombstones, reviewSha256 });
  return document;
}

export function validateCameraContinuity(
  value,
  { replication, live, tombstones, reviewSha256 } = {},
) {
  exactKeys(
    value,
    [
      'schema',
      'attribution',
      'licence',
      'licenceUrl',
      'reviewSha256',
      'baseline',
      'baselineTombstones',
      'transition',
      'replication',
      'liveCount',
      'tombstoneCount',
      'liveSha256',
      'tombstonesSha256',
      'core',
    ],
    'camera continuity document',
  );
  if (
    value.schema !== CAMERA_CONTINUITY_SCHEMA ||
    value.attribution !== ATTRIBUTION ||
    value.licence !== LICENCE ||
    value.licenceUrl !== LICENCE_URL ||
    !HASH.test(value.reviewSha256 ?? '') ||
    (reviewSha256 !== undefined && value.reviewSha256 !== reviewSha256)
  ) {
    throw new Error('camera continuity document has invalid trust metadata');
  }
  const effectiveReplication = replication ?? value.replication;
  if (canonicalIntegrityJson(value.replication) !== canonicalIntegrityJson(effectiveReplication)) {
    throw new Error('camera continuity replication does not match the generation');
  }
  const baseline = value.baseline;
  exactKeys(
    baseline,
    ['sequence', 'timestamp', 'liveSha256', 'tombstonesSha256'],
    'camera continuity baseline',
  );
  if (
    !Number.isSafeInteger(baseline.sequence) ||
    baseline.sequence < 0 ||
    !HASH.test(baseline.liveSha256 ?? '') ||
    !HASH.test(baseline.tombstonesSha256 ?? '')
  ) {
    throw new Error('camera continuity baseline identity is invalid');
  }
  timestamp(baseline.timestamp, 'camera continuity baseline timestamp');
  const baselineTombstones = canonicalTombstoneCore(value.baselineTombstones);
  if (
    canonicalIntegrityJson(baselineTombstones) !==
      canonicalIntegrityJson(value.baselineTombstones) ||
    sha256(Buffer.from(canonicalIntegrityJson(baselineTombstones))) !== baseline.tombstonesSha256
  ) {
    throw new Error('camera continuity baseline tombstones do not match their approved digest');
  }
  validateTransition(value.transition, effectiveReplication, baseline);
  const decoded = decodeCameraCore(value.core);
  if (
    value.liveCount !== decoded.live.length ||
    value.tombstoneCount !== decoded.tombstones.length ||
    value.liveSha256 !== decoded.liveSha256 ||
    value.tombstonesSha256 !== decoded.tombstonesSha256
  ) {
    throw new Error('camera continuity document disagrees with its core payload');
  }
  if (live !== undefined || tombstones !== undefined) {
    const measured = cameraCoreIdentity(live ?? [], tombstones ?? []);
    if (
      measured.liveSha256 !== value.liveSha256 ||
      measured.tombstonesSha256 !== value.tombstonesSha256 ||
      canonicalIntegrityJson(measured.live) !== canonicalIntegrityJson(decoded.live) ||
      canonicalIntegrityJson(measured.tombstones) !== canonicalIntegrityJson(decoded.tombstones)
    ) {
      throw new Error('camera continuity core disagrees with the published archive');
    }
  }
  return { document: value, ...decoded };
}

export function cameraContinuityBytes(document) {
  validateCameraContinuity(document);
  return Buffer.from(`${JSON.stringify(document)}\n`);
}
