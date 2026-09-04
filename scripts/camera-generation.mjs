/**
 * Shared contract for atomic camera generations in R2.
 *
 * Publishers and hydrators intentionally depend on this module, never on one
 * another.  A generation is immutable once named by the pointer, and its
 * manifest binds every byte of the archive to one replication watermark.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  ATTRIBUTION,
  CAMERA_SOURCE_LABEL,
  DEFAULT_COUNTY_GEOFENCE,
  LICENCE,
  LICENCE_URL,
  RELEASE_CAMERA_MINIMUM,
  TILE_ZOOM,
  US_BBOX,
  assertApprovedCameraSourceMarker,
  containsContactValue,
  latLonToTile,
  ownerTypeFor,
  parseDirection,
  releaseGeofenceIdentity,
  RETAINED_TAG_KEYS,
} from './fetch-cameras.mjs';
import { countyLabel, loadCountiesBytes } from './counties.mjs';
import {
  CAMERA_CONTINUITY_KEY,
  validateCameraContinuity,
} from './camera-integrity.mjs';

export const POINTER_SCHEMA = 'darkroute-camera-pointer/v1';
export const MANIFEST_SCHEMA = 'darkroute-camera-generation/v1';
export const LEASE_SCHEMA = 'darkroute-camera-publish-lease/v1';

export const POINTER_KEY = '__camera/current.json';
export const LEASE_KEY = '__camera/publish-lease.json';
export const CAMERA_SLOTS = ['a', 'b', 'c'];

export const MIN_TILES = 4_000;
export const MIN_CAMERAS = RELEASE_CAMERA_MINIMUM;
export const MAX_FILES = 20_000;
export const MAX_OBJECT_BYTES = 16 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_CONTROL_BYTES = 64 * 1024;

export const SIDECARS = [
  'index.json',
  'overview.json',
  'tombstones.json',
  'places.json',
  'counties.json',
  CAMERA_CONTINUITY_KEY,
];
export const REQUIRED_SIDECARS = SIDECARS.filter((key) => key !== CAMERA_CONTINUITY_KEY);

const HASH_256 = /^[a-f\d]{64}$/;
const HASH_MD5 = /^[a-f\d]{32}$/;
const TILE_KEY = /^11\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.json$/;
const OSM_NODE_ID = /^osm:[1-9]\d*$/;
const MAX_TILE_COORD = 2 ** TILE_ZOOM - 1;
const VERSIONED_CAMERA_FIELDS = Object.freeze([
  'id',
  'lat',
  'lon',
  'directionDeg',
  'ownerType',
  'confirmations',
  'countyFips',
  'osmVersion',
  'updatedAt',
  'tags',
]);
const VERSIONED_TAG_KEYS = new Set(
  RETAINED_TAG_KEYS.filter((key) => !['man_made', 'surveillance:type', 'total'].includes(key)),
);
const OWNER_TYPES = new Set(['unverified', 'police', 'hoa', 'inter_agency', 'private']);

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is not set`);
  }
  return value.trim();
}

/** R2's documented S3 credential derivation for API tokens. */
export async function s3Credentials() {
  const direct = process.env['R2_ACCESS_KEY_ID'];
  if (typeof direct === 'string' && direct.trim() !== '') {
    return { accessKeyId: direct.trim(), secretAccessKey: required('R2_SECRET_ACCESS_KEY') };
  }
  const token = process.env['CLOUDFLARE_API_TOKEN'];
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('No R2 credentials: set R2_ACCESS_KEY_ID/SECRET or CLOUDFLARE_API_TOKEN.');
  }
  const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${token.trim()}` },
  });
  const body = await response.json();
  const id = body?.result?.id;
  if (body?.success !== true || typeof id !== 'string') {
    throw new Error('CLOUDFLARE_API_TOKEN did not verify; cannot derive S3 credentials.');
  }
  return {
    accessKeyId: id,
    secretAccessKey: createHash('sha256').update(token.trim()).digest('hex'),
  };
}

function exactKeys(value, requiredKeys, optionalKeys, name) {
  if (!object(value)) throw new Error(`${name} is not an object`);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${name} is missing ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${name} has unexpected field ${key}`);
  }
}

export function isTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return false;
  const canonical = parsed.toISOString();
  return canonical === value || canonical.replace('.000Z', 'Z') === value;
}

/** Control-plane instants use the one encoding the serving Function accepts. */
export function isControlTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

export function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

export function md5(body) {
  return createHash('md5').update(body).digest('hex');
}

/** Locale-independent ordering for the ASCII object-key namespace. */
export function compareKeys(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable JSON for hashes which must not depend on insertion order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (object(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('cannot canonicalise undefined');
  return encoded;
}

export function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

export function slotPrefix(slot) {
  validateSlot(slot);
  return `__camera/slots/${slot}/`;
}

export function slotDataPrefix(slot) {
  return `${slotPrefix(slot)}data/`;
}

export function slotManifestKey(slot) {
  return `${slotPrefix(slot)}manifest.json`;
}

export function validateSlot(slot) {
  if (!CAMERA_SLOTS.includes(slot)) throw new Error(`invalid camera slot: ${String(slot)}`);
  return slot;
}

/** Reject anything that cannot map to one known archive path. */
export function validateLogicalKey(key) {
  if (typeof key !== 'string' || key === '') throw new Error('empty camera object key');
  if (key.includes('\\') || key.includes('\0') || key.startsWith('/') || key.includes('..')) {
    throw new Error(`unsafe camera object key: ${JSON.stringify(key)}`);
  }
  if (SIDECARS.includes(key)) return { kind: 'sidecar', key };
  const match = TILE_KEY.exec(key);
  if (match === null) throw new Error(`unexpected camera object key: ${JSON.stringify(key)}`);
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (x > MAX_TILE_COORD || y > MAX_TILE_COORD) {
    throw new Error(`out-of-range z${String(TILE_ZOOM)} tile key: ${key}`);
  }
  return { kind: 'tile', key, x, y };
}

export function validateReplication(value) {
  exactKeys(
    value,
    ['stream', 'lastAppliedSeq', 'lastAppliedTimestamp', 'versionsKnown'],
    [],
    'replication state',
  );
  if (value.stream !== 'hour') throw new Error('replication stream must be hour');
  if (!integer(value.lastAppliedSeq)) throw new Error('replication sequence is invalid');
  if (!isTimestamp(value.lastAppliedTimestamp)) {
    throw new Error('replication timestamp is invalid');
  }
  if (typeof value.versionsKnown !== 'boolean') {
    throw new Error('replication versionsKnown must be boolean');
  }
  return {
    stream: value.stream,
    lastAppliedSeq: value.lastAppliedSeq,
    lastAppliedTimestamp: value.lastAppliedTimestamp,
    versionsKnown: value.versionsKnown,
  };
}

/** Read the sync state while deliberately excluding non-canonical lastRun. */
export function normaliseState(value) {
  if (!object(value)) throw new Error('camera sync state is not an object');
  const replication = validateReplication({
    stream: value.stream,
    lastAppliedSeq: value.lastAppliedSeq,
    lastAppliedTimestamp: value.lastAppliedTimestamp,
    versionsKnown: value.versionsKnown,
  });
  const allowed = new Set([
    'stream',
    'lastAppliedSeq',
    'lastAppliedTimestamp',
    'versionsKnown',
    'lastRun',
    'basePointer',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`camera sync state has unexpected field ${key}`);
  }
  if (Object.hasOwn(value, 'lastRun') && !isTimestamp(value.lastRun)) {
    throw new Error('camera sync state lastRun is invalid');
  }
  const basePointer = Object.hasOwn(value, 'basePointer')
    ? validatePointer(value.basePointer)
    : null;
  return { replication, basePointer };
}

/** Runtime state written by hydration; basePointer is not replication data. */
export function hydratedRuntimeState(replication, basePointer) {
  return { ...validateReplication(replication), basePointer: validatePointer(basePointer) };
}

export function validateArchiveSummary(value) {
  exactKeys(
    value,
    ['zoom', 'tiles', 'cameras', 'tombstones', 'source', 'upstream'],
    ['baseUpstream'],
    'archive summary',
  );
  if (value.zoom !== TILE_ZOOM) throw new Error(`archive zoom must be ${String(TILE_ZOOM)}`);
  for (const key of ['tiles', 'cameras', 'tombstones']) {
    if (!integer(value[key])) throw new Error(`archive ${key} is invalid`);
  }
  if (typeof value.source !== 'string' || value.source.trim() === '') {
    throw new Error('archive source is invalid');
  }
  if (!isTimestamp(value.upstream)) throw new Error('archive upstream is invalid');
  if (Object.hasOwn(value, 'baseUpstream') && !isTimestamp(value.baseUpstream)) {
    throw new Error('archive baseUpstream is invalid');
  }
  return value;
}

export function validateInventory(files) {
  if (!Array.isArray(files)) throw new Error('manifest files is not an array');
  if (files.length > MAX_FILES) throw new Error('manifest has too many files');
  const seen = new Set();
  let totalBytes = 0;
  let previous = '';
  for (const [index, file] of files.entries()) {
    exactKeys(file, ['key', 'bytes', 'md5', 'sha256'], [], `manifest file ${String(index)}`);
    validateLogicalKey(file.key);
    if (seen.has(file.key)) throw new Error(`manifest repeats ${file.key}`);
    if (index > 0 && compareKeys(previous, file.key) >= 0) {
      throw new Error('manifest inventory is not strictly sorted');
    }
    seen.add(file.key);
    previous = file.key;
    if (!integer(file.bytes) || file.bytes < 1 || file.bytes > MAX_OBJECT_BYTES) {
      throw new Error(`manifest has invalid size for ${file.key}`);
    }
    if (typeof file.md5 !== 'string' || !HASH_MD5.test(file.md5)) {
      throw new Error(`manifest has invalid MD5 for ${file.key}`);
    }
    if (typeof file.sha256 !== 'string' || !HASH_256.test(file.sha256)) {
      throw new Error(`manifest has invalid SHA-256 for ${file.key}`);
    }
    totalBytes += file.bytes;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('manifest archive is too large');
  }
  for (const key of REQUIRED_SIDECARS) {
    if (!seen.has(key)) throw new Error(`manifest is missing ${key}`);
  }
  return files;
}

export function generationDigest({ replication, archive, files }) {
  validateReplication(replication);
  validateArchiveSummary(archive);
  validateInventory(files);
  return sha256(canonicalJson({ replication, archive, files }));
}

export function createManifest({ createdAt, replication, archive, files }) {
  if (!isTimestamp(createdAt)) throw new Error('manifest createdAt is invalid');
  const generation = generationDigest({ replication, archive, files });
  return {
    schema: MANIFEST_SCHEMA,
    generation,
    createdAt,
    replication,
    archive,
    files,
  };
}

export function validateManifest(value) {
  exactKeys(
    value,
    ['schema', 'generation', 'createdAt', 'replication', 'archive', 'files'],
    [],
    'camera manifest',
  );
  if (value.schema !== MANIFEST_SCHEMA) throw new Error('camera manifest schema is unsupported');
  if (typeof value.generation !== 'string' || !HASH_256.test(value.generation)) {
    throw new Error('camera manifest generation is invalid');
  }
  if (!isTimestamp(value.createdAt)) throw new Error('camera manifest createdAt is invalid');
  validateReplication(value.replication);
  validateArchiveSummary(value.archive);
  validateInventory(value.files);
  const expected = generationDigest(value);
  if (value.generation !== expected) throw new Error('camera manifest generation hash is wrong');
  if (value.archive.upstream !== value.replication.lastAppliedTimestamp) {
    throw new Error('camera manifest archive and replication timestamps disagree');
  }
  return value;
}

function validatePointerTarget(value, name, exact = true) {
  if (exact) exactKeys(value, ['slot', 'generation', 'manifestSha256'], [], name);
  validateSlot(value.slot);
  if (typeof value.generation !== 'string' || !HASH_256.test(value.generation)) {
    throw new Error(`${name} generation is invalid`);
  }
  if (typeof value.manifestSha256 !== 'string' || !HASH_256.test(value.manifestSha256)) {
    throw new Error(`${name} manifest hash is invalid`);
  }
}

export function validatePointer(value) {
  exactKeys(
    value,
    ['schema', 'slot', 'generation', 'manifestSha256', 'previous', 'updatedAt'],
    [],
    'camera pointer',
  );
  if (value.schema !== POINTER_SCHEMA) throw new Error('camera pointer schema is unsupported');
  validatePointerTarget(value, 'camera pointer', false);
  if (!isControlTimestamp(value.updatedAt)) throw new Error('camera pointer updatedAt is invalid');
  if (value.previous !== null) {
    validatePointerTarget(value.previous, 'camera pointer previous');
    if (value.previous.slot === value.slot)
      throw new Error('camera pointer repeats its active slot');
  }
  return value;
}

export function selectCandidateSlot(pointer) {
  if (pointer === null) return CAMERA_SLOTS[0];
  validatePointer(pointer);
  const protectedSlots = new Set([pointer.slot]);
  if (pointer.previous !== null) protectedSlots.add(pointer.previous.slot);
  const candidate = CAMERA_SLOTS.find((slot) => !protectedSlots.has(slot));
  if (candidate === undefined) throw new Error('camera pointer protects every generation slot');
  return candidate;
}

function parseJson(body, name) {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (error) {
    throw new Error(`invalid ${name}: ${error.message}`, { cause: error });
  }
}

function validateNotice(doc, key, requireLicenceUrl) {
  if (
    doc.attribution !== ATTRIBUTION ||
    doc.licence !== LICENCE ||
    ((requireLicenceUrl || Object.hasOwn(doc, 'licenceUrl')) && doc.licenceUrl !== LICENCE_URL)
  ) {
    throw new Error(`${key} does not carry the required OSM attribution and licence URI`);
  }
}

function coordinateKey(lat, lon) {
  return JSON.stringify([lat, lon]);
}

function validateVersionedCamera(camera, county, tileKey) {
  const keys = Object.keys(camera).sort();
  if (keys.join(',') !== [...VERSIONED_CAMERA_FIELDS].sort().join(',')) {
    throw new Error(`${tileKey} camera ${camera.id} has an invalid versioned record schema`);
  }
  if (
    Math.round(camera.lat * 1e5) / 1e5 !== camera.lat ||
    Math.round(camera.lon * 1e5) / 1e5 !== camera.lon ||
    (camera.directionDeg !== null &&
      (!Number.isFinite(camera.directionDeg) ||
        camera.directionDeg < 0 ||
        camera.directionDeg >= 360)) ||
    !OWNER_TYPES.has(camera.ownerType) ||
    camera.confirmations !== 1 ||
    camera.countyFips !== county.fips ||
    !Number.isSafeInteger(camera.updatedAt) ||
    camera.updatedAt < 1 ||
    !object(camera.tags)
  ) {
    throw new Error(`${tileKey} camera ${camera.id} has invalid versioned fields`);
  }
  for (const [key, value] of Object.entries(camera.tags)) {
    if (
      !VERSIONED_TAG_KEYS.has(key) ||
      typeof value !== 'string' ||
      value === '' ||
      containsContactValue(value)
    ) {
      throw new Error(`${tileKey} camera ${camera.id} has an unsafe or unapproved OSM tag`);
    }
  }
  if (
    camera.ownerType !== ownerTypeFor(camera.tags) ||
    camera.directionDeg !==
      parseDirection(camera.tags.direction, camera.tags['camera:direction'] ?? null)
  ) {
    throw new Error(`${tileKey} camera ${camera.id} disagrees with its retained OSM tags`);
  }
}

/** Deep archive validation shared by local publication and staged hydration. */
export function validateArchiveBodies(entries, replication, options = {}) {
  const minTiles = options.minTiles ?? MIN_TILES;
  const minCameras = options.minCameras ?? MIN_CAMERAS;
  validateReplication(replication);
  // Existing versionsKnown:false generations predate the embedded URI and
  // must remain hydratable solely to capture a cutover predecessor. Every
  // proven or newly published generation requires the URI in every body.
  const requireLicenceUrl = options.requireLicenceUrl ?? replication.versionsKnown;
  let approvedTerritory = null;
  if (replication.versionsKnown) {
    const geofenceBytes = readFileSync(DEFAULT_COUNTY_GEOFENCE);
    releaseGeofenceIdentity(geofenceBytes);
    approvedTerritory = loadCountiesBytes(geofenceBytes);
  }
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  if (byKey.size !== entries.length) throw new Error('archive repeats an object key');
  for (const key of REQUIRED_SIDECARS) {
    if (!byKey.has(key)) throw new Error(`archive is missing ${key}`);
  }

  const tiles = [];
  for (const entry of entries) {
    const parsed = validateLogicalKey(entry.key);
    if (!Buffer.isBuffer(entry.body)) throw new Error(`${entry.key} body is not a Buffer`);
    if (entry.body.byteLength < 1 || entry.body.byteLength > MAX_OBJECT_BYTES) {
      throw new Error(`${entry.key} has an invalid object size`);
    }
    if (parsed.kind === 'tile') tiles.push({ ...parsed, body: entry.body });
  }
  if (tiles.length < minTiles) {
    throw new Error(
      `archive has ${String(tiles.length)} tiles, below the ${String(minTiles)} floor`,
    );
  }

  let cameras = 0;
  const liveRecords = [];
  const liveIds = new Set();
  const coordinates = new Map();
  const expectedCounties = new Map();
  for (const tile of tiles) {
    const doc = parseJson(tile.body, tile.key);
    if (!object(doc) || doc.z !== TILE_ZOOM || doc.x !== tile.x || doc.y !== tile.y) {
      throw new Error(`${tile.key} body does not match its tile path`);
    }
    if (!Array.isArray(doc.cameras)) throw new Error(`${tile.key} has no cameras array`);
    validateNotice(doc, tile.key, requireLicenceUrl);
    if (replication.versionsKnown) {
      exactKeys(
        doc,
        ['z', 'x', 'y', 'attribution', 'licence', 'licenceUrl', 'cameras'],
        [],
        tile.key,
      );
    }
    for (const camera of doc.cameras) {
      if (
        !object(camera) ||
        typeof camera.id !== 'string' ||
        camera.id === '' ||
        !Number.isFinite(camera.lat) ||
        camera.lat < -90 ||
        camera.lat > 90 ||
        !Number.isFinite(camera.lon) ||
        camera.lon < -180 ||
        camera.lon > 180
      ) {
        throw new Error(`${tile.key} contains an invalid camera id or coordinate`);
      }
      if (liveIds.has(camera.id)) throw new Error(`duplicate live camera id: ${camera.id}`);
      if (
        Object.hasOwn(camera, 'osmVersion') &&
        (!Number.isSafeInteger(camera.osmVersion) || camera.osmVersion < 1)
      ) {
        throw new Error(`camera ${camera.id} has an invalid OSM version`);
      }
      if (replication.versionsKnown && !Number.isSafeInteger(camera.osmVersion)) {
        throw new Error(`versionsKnown is true but live camera ${camera.id} has no OSM version`);
      }
      if (replication.versionsKnown && !OSM_NODE_ID.test(camera.id)) {
        throw new Error(`versionsKnown is true but live camera ${camera.id} has no canonical OSM node id`);
      }
      if (replication.versionsKnown) {
        const county = approvedTerritory.lookup(camera.lat, camera.lon);
        if (county === null) {
          throw new Error(`versionsKnown camera ${camera.id} is outside the approved US/DC/PR territory`);
        }
        validateVersionedCamera(camera, county, tile.key);
        const held = expectedCounties.get(county.fips);
        if (held === undefined) {
          expectedCounties.set(county.fips, {
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
      const expected = latLonToTile(camera.lat, camera.lon, TILE_ZOOM);
      if (expected.x !== tile.x || expected.y !== tile.y) {
        throw new Error(`camera ${camera.id} is stored in the wrong tile ${tile.key}`);
      }
      liveIds.add(camera.id);
      liveRecords.push(camera);
      const key = coordinateKey(camera.lat, camera.lon);
      coordinates.set(key, (coordinates.get(key) ?? 0) + 1);
    }
    cameras += doc.cameras.length;
  }
  if (cameras < minCameras) {
    throw new Error(
      `archive has ${String(cameras)} cameras, below the ${String(minCameras)} floor`,
    );
  }

  const index = parseJson(byKey.get('index.json').body, 'index.json');
  if (!object(index)) throw new Error('index.json top level is not an object');
  validateNotice(index, 'index.json', requireLicenceUrl);
  if (replication.versionsKnown) {
    exactKeys(
      index,
      [
        'zoom',
        'generatedAt',
        'source',
        'baseUpstream',
        'upstream',
        'cameraSource',
        'attribution',
        'licence',
        'licenceUrl',
        'cameras',
        'tiles',
        'bbox',
      ],
      [],
      'index.json',
    );
    if (!isTimestamp(index.generatedAt) || canonicalJson(index.bbox) !== canonicalJson(US_BBOX)) {
      throw new Error('index.json has invalid approved release metadata');
    }
  }
  if (
    index.zoom !== TILE_ZOOM ||
    index.tiles !== tiles.length ||
    index.cameras !== cameras ||
    typeof index.source !== 'string' ||
    index.source.trim() === '' ||
    !isTimestamp(index.upstream)
  ) {
    throw new Error('index.json disagrees with the complete archive');
  }
  if (index.upstream !== replication.lastAppliedTimestamp) {
    throw new Error('index.json upstream does not match the replication watermark');
  }
  if (Object.hasOwn(index, 'baseUpstream') && !isTimestamp(index.baseUpstream)) {
    throw new Error('index.json baseUpstream is invalid');
  }

  const overview = parseJson(byKey.get('overview.json').body, 'overview.json');
  if (!object(overview)) throw new Error('overview.json top level is not an object');
  validateNotice(overview, 'overview.json', requireLicenceUrl);
  if (replication.versionsKnown) {
    exactKeys(
      overview,
      ['schema', 'attribution', 'licence', 'licenceUrl', 'count', 'coords'],
      [],
      'overview.json',
    );
  }
  if (
    overview.schema !== 'fwm-overview/v1' ||
    overview.count !== cameras ||
    !Array.isArray(overview.coords) ||
    overview.coords.length !== cameras * 2
  ) {
    throw new Error('overview.json does not describe the complete camera snapshot');
  }
  const remainingCoordinates = new Map(coordinates);
  for (let offset = 0; offset < overview.coords.length; offset += 2) {
    const lat = overview.coords[offset];
    const lon = overview.coords[offset + 1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`overview.json has an invalid coordinate at pair ${String(offset / 2)}`);
    }
    const key = coordinateKey(lat, lon);
    const remaining = remainingCoordinates.get(key) ?? 0;
    if (remaining < 1)
      throw new Error('overview.json coordinate multiset disagrees with the tiles');
    if (remaining === 1) remainingCoordinates.delete(key);
    else remainingCoordinates.set(key, remaining - 1);
  }
  if (remainingCoordinates.size !== 0) {
    throw new Error('overview.json coordinate multiset is missing tile coordinates');
  }

  const tombstones = parseJson(byKey.get('tombstones.json').body, 'tombstones.json');
  if (!object(tombstones)) throw new Error('tombstones.json top level is not an object');
  validateNotice(tombstones, 'tombstones.json', requireLicenceUrl);
  if (replication.versionsKnown) {
    exactKeys(
      tombstones,
      [
        'attribution',
        'licence',
        'licenceUrl',
        'generatedAt',
        'upstream',
        'tombstones',
      ],
      [],
      'tombstones.json',
    );
    if (
      !isTimestamp(tombstones.generatedAt) ||
      tombstones.upstream !== replication.lastAppliedTimestamp
    ) {
      throw new Error('tombstones.json does not match the replication watermark');
    }
  }
  if (!Array.isArray(tombstones.tombstones)) throw new Error('tombstones.json has no ledger');
  const tombstoneIds = new Set();
  for (const tombstone of tombstones.tombstones) {
    if (
      !object(tombstone) ||
      typeof tombstone.id !== 'string' ||
      tombstone.id === '' ||
      ![
        'osm_delete',
        'osm_untag',
        'osm_out_of_scope',
        'cutover_reconciliation',
      ].includes(tombstone.reason) ||
      !integer(tombstone.seq) ||
      tombstone.seq > replication.lastAppliedSeq
    ) {
      throw new Error('tombstones.json contains an invalid tombstone');
    }
    if (tombstoneIds.has(tombstone.id)) throw new Error(`duplicate tombstone id: ${tombstone.id}`);
    if (
      Object.hasOwn(tombstone, 'osmVersion') &&
      (!Number.isSafeInteger(tombstone.osmVersion) || tombstone.osmVersion < 1)
    ) {
      throw new Error(`tombstone ${tombstone.id} has an invalid OSM version`);
    }
    if (replication.versionsKnown && !Number.isSafeInteger(tombstone.osmVersion)) {
      throw new Error(`versionsKnown is true but tombstone ${tombstone.id} has no OSM version`);
    }
    if (replication.versionsKnown && !OSM_NODE_ID.test(tombstone.id)) {
      throw new Error(
        `versionsKnown is true but tombstone ${tombstone.id} has no canonical OSM node id`,
      );
    }
    if (liveIds.has(tombstone.id)) {
      throw new Error(`tombstoned camera is still live in the archive: ${tombstone.id}`);
    }
    tombstoneIds.add(tombstone.id);
  }

  if (replication.versionsKnown) {
    if (index.source !== CAMERA_SOURCE_LABEL) {
      throw new Error('versionsKnown is true but index source is not the approved direct capture');
    }
    if (!Object.hasOwn(index, 'baseUpstream')) {
      throw new Error('versionsKnown is true but index.json has no baseline watermark');
    }
    const marker = assertApprovedCameraSourceMarker(
      index.cameraSource,
      options.trustedReviewBytes,
    );
    const minimumOsmBase = marker.review.receipt.sourceWatermark.minimumOsmBase;
    if (index.baseUpstream !== minimumOsmBase) {
      throw new Error('index.json baseline watermark does not match the approved source receipt');
    }
    const continuityEntry = byKey.get(CAMERA_CONTINUITY_KEY);
    if (continuityEntry === undefined && options.requireContinuity !== false) {
      throw new Error(`versionsKnown archive is missing ${CAMERA_CONTINUITY_KEY}`);
    }
    if (continuityEntry !== undefined && options.requireContinuity !== false) {
      let continuity;
      try {
        continuity = JSON.parse(continuityEntry.body.toString('utf8'));
      } catch {
        throw new Error(`${CAMERA_CONTINUITY_KEY} is not JSON`);
      }
      const floor = marker.review.receipt.replicationFloor;
      const transformation = marker.transformation;
      const checked = validateCameraContinuity(continuity, {
        replication,
        live: liveRecords,
        tombstones: tombstones.tombstones,
        reviewSha256: marker.review.sha256,
      });
      if (
        checked.document.baseline.sequence !== floor.sequence ||
        checked.document.baseline.timestamp !== floor.timestamp ||
        checked.document.baseline.liveSha256 !== transformation.publishedLiveSha256 ||
        checked.document.baseline.tombstonesSha256 !== transformation.publishedTombstonesSha256
      ) {
        throw new Error('camera continuity does not match the approved baseline transformation');
      }
    }
  }

  for (const [key, countField] of [['places.json', 'places'], ['counties.json', 'counties']]) {
    const entry = byKey.get(key);
    if (entry === undefined) continue;
    const doc = parseJson(entry.body, key);
    if (!object(doc)) throw new Error(`${key} top level is not an object`);
    validateNotice(doc, key, requireLicenceUrl);
    if (!Array.isArray(doc.rows) || doc[countField] !== doc.rows.length) {
      throw new Error(`${key} has an invalid rows array or count`);
    }
    if (replication.versionsKnown && key === 'places.json') {
      exactKeys(
        doc,
        [
          'generatedAt',
          'source',
          'attribution',
          'licence',
          'licenceUrl',
          'places',
          'inPlace',
          'unincorporated',
          'rows',
        ],
        [],
        key,
      );
      if (
        !isTimestamp(doc.generatedAt) ||
        doc.source !== 'No place enrichment in the approved direct-capture baseline' ||
        doc.places !== 0 ||
        doc.inPlace !== 0 ||
        doc.unincorporated !== cameras ||
        doc.rows.length !== 0
      ) {
        throw new Error('places.json is not the canonical disabled-enrichment sidecar');
      }
    }
    if (replication.versionsKnown && key === 'counties.json') {
      exactKeys(
        doc,
        [
          'generatedAt',
          'source',
          'attribution',
          'licence',
          'licenceUrl',
          'counties',
          'located',
          'unlocated',
          'rows',
        ],
        [],
        key,
      );
      const expectedRows = [...expectedCounties.values()].sort(
        (left, right) => right.cameras - left.cameras || left.fips.localeCompare(right.fips),
      );
      if (
        !isTimestamp(doc.generatedAt) ||
        doc.source !== 'US Census county polygons, joined point-in-polygon' ||
        doc.counties !== expectedRows.length ||
        doc.located !== cameras ||
        doc.unlocated !== 0 ||
        canonicalJson(doc.rows) !== canonicalJson(expectedRows)
      ) {
        throw new Error('counties.json does not exactly describe the pinned territorial join');
      }
    }
  }

  const archive = {
    zoom: TILE_ZOOM,
    tiles: tiles.length,
    cameras,
    tombstones: tombstoneIds.size,
    source: index.source,
    ...(Object.hasOwn(index, 'baseUpstream') ? { baseUpstream: index.baseUpstream } : {}),
    upstream: index.upstream,
  };
  validateArchiveSummary(archive);
  return archive;
}

/** Read, bound, hash, and deeply validate one local archive generation. */
export async function readLocalGeneration(root, stateFile, options = {}) {
  const stateBody = await readFile(stateFile);
  if (stateBody.byteLength > MAX_CONTROL_BYTES) throw new Error('camera sync state is too large');
  const runtimeState = normaliseState(parseJson(stateBody, 'camera sync state'));
  const { replication, basePointer } = runtimeState;

  const entries = [];
  const stack = [root];
  let totalBytes = 0;
  while (stack.length > 0) {
    const at = stack.pop();
    const children = await readdir(at, { withFileTypes: true });
    for (const child of children) {
      const path = join(at, child.name);
      if (child.isSymbolicLink()) throw new Error(`camera archive contains symlink: ${path}`);
      if (child.isDirectory()) {
        stack.push(path);
        continue;
      }
      const info = await lstat(path);
      if (!info.isFile()) throw new Error(`camera archive contains non-file: ${path}`);
      const key = relative(root, path).split('\\').join('/');
      validateLogicalKey(key);
      if (entries.length >= MAX_FILES) throw new Error('camera archive has too many files');
      if (info.size < 1 || info.size > MAX_OBJECT_BYTES) {
        throw new Error(`${key} has an invalid object size`);
      }
      totalBytes += info.size;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('camera archive is too large');
      const body = await readFile(path);
      if (body.byteLength !== info.size) throw new Error(`${key} changed while being read`);
      entries.push({ key, body });
    }
  }
  entries.sort((a, b) => compareKeys(a.key, b.key));
  const archive = validateArchiveBodies(entries, replication, options);
  const files = entries.map(({ key, body }) => ({
    key,
    bytes: body.byteLength,
    md5: md5(body),
    sha256: sha256(body),
  }));
  validateInventory(files);
  return { entries, replication, basePointer, archive, files };
}

export function parseManifestBytes(body) {
  if (body.byteLength < 1 || body.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('camera manifest has an invalid size');
  }
  const manifest = validateManifest(parseJson(body, 'camera manifest'));
  if (!Buffer.from(body).equals(jsonBytes(manifest))) {
    throw new Error('camera manifest is not in canonical transport encoding');
  }
  return manifest;
}

export function parsePointerBytes(body) {
  if (body.byteLength < 1 || body.byteLength > MAX_CONTROL_BYTES) {
    throw new Error('camera pointer has an invalid size');
  }
  const pointer = validatePointer(parseJson(body, 'camera pointer'));
  if (!Buffer.from(body).equals(jsonBytes(pointer))) {
    throw new Error('camera pointer is not in canonical transport encoding');
  }
  return pointer;
}
