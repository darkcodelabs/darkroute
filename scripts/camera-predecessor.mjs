/**
 * Bind the complete live-id set that an approved camera baseline replaces.
 *
 * A fresh capture cannot by itself prove incremental-removal continuity: an id
 * present in the predecessor and absent from both the new live set and the
 * deletion ledger would disappear without a tombstone. This module captures a
 * deeply validated predecessor inventory and makes that omission a hard error.
 */

import { existsSync, lstatSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { S3Client } from '@aws-sdk/client-s3';

import {
  MAX_ARCHIVE_BYTES,
  MAX_CONTROL_BYTES,
  MAX_FILES,
  MAX_OBJECT_BYTES,
  POINTER_KEY,
  canonicalJson,
  compareKeys,
  createManifest,
  md5,
  readLocalGeneration,
  required,
  s3Credentials,
  sha256,
  validateLogicalKey,
  validatePointer,
} from './camera-generation.mjs';
import {
  ATTRIBUTION,
  LICENCE,
  LICENCE_URL,
  TILE_ZOOM,
  canonicalSourceTimestamp,
  latLonToTile,
} from './fetch-cameras.mjs';
import {
  DOWNLOAD_CONCURRENCY,
  cleanEtag,
  getObject,
  listPrefix,
  runBounded,
} from './hydrate-cameras.mjs';

export const PREDECESSOR_SCHEMA = 'darkroute-camera-predecessor/v3';
export const PREDECESSOR_PATH = 'scripts/data/camera-predecessor.json';
export const PREDECESSOR_TOMBSTONES_PATH = 'scripts/data/camera-predecessor-tombstones.json';
export const PREDECESSOR_MODES = Object.freeze(['generation', 'legacy-flat-root', 'empty-r2']);

const exactKeys = (value, keys) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

const idsDigest = (ids) => sha256(Buffer.from(canonicalJson(ids)));

function parseJson(body, label) {
  try {
    return JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    throw new Error(`${label} is not JSON`);
  }
}

function inventoryIdentity(entries) {
  const files = entries
    .map(({ key, body }) => ({
      key,
      bytes: body.length,
      md5: md5(body),
      sha256: sha256(body),
    }))
    .sort((left, right) => compareKeys(left.key, right.key));
  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: sha256(Buffer.from(canonicalJson(files))),
    listingSha256: sha256(
      Buffer.from(
        canonicalJson(files.map(({ key, bytes, md5: digest }) => ({ key, bytes, md5: digest }))),
      ),
    ),
  };
}

export function r2DeploymentIdentity(accountId, bucket) {
  if (
    typeof accountId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) ||
    typeof bucket !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket)
  ) {
    throw new Error('camera predecessor has an invalid R2 deployment identity');
  }
  return { provider: 'cloudflare-r2', accountId, bucket };
}

function tombstoneSourceIdentity(entry) {
  if (entry === undefined) return null;
  const ledger = parseJson(entry.body, 'predecessor tombstones.json');
  if (!Array.isArray(ledger?.tombstones)) {
    throw new Error('camera predecessor tombstone source has no ledger');
  }
  return {
    path: PREDECESSOR_TOMBSTONES_PATH,
    bytes: entry.body.length,
    sha256: sha256(entry.body),
    count: ledger.tombstones.length,
  };
}

function liveIdsFromEntries(entries) {
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.key.startsWith(`${String(TILE_ZOOM)}/`)) continue;
    const tile = parseJson(entry.body, entry.key);
    for (const camera of tile.cameras ?? []) ids.add(camera.id);
  }
  const sorted = [...ids].sort();
  for (const id of sorted) {
    if (!/^osm:[1-9]\d*$/.test(id ?? '')) {
      throw new Error(`predecessor has a non-canonical live id: ${String(id)}`);
    }
  }
  return sorted;
}

function evidenceSource(mode, entries, pointer, deployment, versionsKnown) {
  const index = entries.find((entry) => entry.key === 'index.json');
  const tombstones = entries.find((entry) => entry.key === 'tombstones.json');
  return {
    mode,
    deployment: r2DeploymentIdentity(deployment.accountId, deployment.bucket),
    pointer: mode === 'generation' ? validatePointer(pointer) : null,
    versionsKnown: mode === 'generation' ? versionsKnown : null,
    indexSha256: index === undefined ? null : sha256(index.body),
    tombstones: tombstoneSourceIdentity(tombstones),
    inventory: inventoryIdentity(entries),
  };
}

export function buildPredecessorEvidence({
  mode,
  entries,
  deployment,
  pointer = null,
  versionsKnown = mode === 'generation' ? true : null,
  capturedAt,
}) {
  if (!PREDECESSOR_MODES.includes(mode)) throw new Error('predecessor mode is invalid');
  if (!Array.isArray(entries)) throw new Error('predecessor entries are not an array');
  if (mode === 'empty-r2' && entries.length !== 0) {
    throw new Error('empty predecessor unexpectedly contains camera objects');
  }
  if (mode === 'generation' && typeof versionsKnown !== 'boolean') {
    throw new Error('generation predecessor requires its versionsKnown state');
  }
  if (mode !== 'generation' && versionsKnown !== null) {
    throw new Error('non-generation predecessor cannot claim versionsKnown');
  }
  const liveIds = liveIdsFromEntries(entries);
  const evidence = {
    schema: PREDECESSOR_SCHEMA,
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    capturedAt: canonicalSourceTimestamp(capturedAt, 'predecessor capture time'),
    source: evidenceSource(mode, entries, pointer, deployment, versionsKnown),
    liveCount: liveIds.length,
    liveIdsSha256: idsDigest(liveIds),
    liveIds,
  };
  return validatePredecessorEvidence(evidence);
}

export function validatePredecessorEvidence(evidence) {
  if (
    !exactKeys(evidence, [
      'schema',
      'attribution',
      'licence',
      'licenceUrl',
      'capturedAt',
      'source',
      'liveCount',
      'liveIdsSha256',
      'liveIds',
    ]) ||
    evidence.schema !== PREDECESSOR_SCHEMA ||
    evidence.attribution !== ATTRIBUTION ||
    evidence.licence !== LICENCE ||
    evidence.licenceUrl !== LICENCE_URL ||
    canonicalSourceTimestamp(evidence.capturedAt, 'predecessor capture time') !==
      evidence.capturedAt ||
    !PREDECESSOR_MODES.includes(evidence.source?.mode) ||
    !exactKeys(evidence.source, [
      'mode',
      'deployment',
      'pointer',
      'versionsKnown',
      'indexSha256',
      'tombstones',
      'inventory',
    ]) ||
    !exactKeys(evidence.source.inventory, ['files', 'bytes', 'sha256', 'listingSha256']) ||
    (evidence.source.mode === 'generation'
      ? typeof evidence.source.versionsKnown !== 'boolean'
      : evidence.source.versionsKnown !== null) ||
    !Number.isSafeInteger(evidence.source.inventory.files) ||
    evidence.source.inventory.files < 0 ||
    !Number.isSafeInteger(evidence.source.inventory.bytes) ||
    evidence.source.inventory.bytes < 0 ||
    !/^[0-9a-f]{64}$/.test(evidence.source.inventory.sha256 ?? '') ||
    !/^[0-9a-f]{64}$/.test(evidence.source.inventory.listingSha256 ?? '') ||
    !Number.isSafeInteger(evidence.liveCount) ||
    evidence.liveCount < 0 ||
    !Array.isArray(evidence.liveIds) ||
    evidence.liveIds.length !== evidence.liveCount ||
    !/^[0-9a-f]{64}$/.test(evidence.liveIdsSha256 ?? '')
  ) {
    throw new Error('camera predecessor evidence has an invalid schema');
  }
  r2DeploymentIdentity(evidence.source.deployment?.accountId, evidence.source.deployment?.bucket);
  if (
    !exactKeys(evidence.source.deployment, ['provider', 'accountId', 'bucket']) ||
    evidence.source.deployment.provider !== 'cloudflare-r2'
  ) {
    throw new Error('camera predecessor evidence has an invalid deployment identity');
  }
  const mode = evidence.source.mode;
  if (mode === 'generation') validatePointer(evidence.source.pointer);
  else if (evidence.source.pointer !== null) {
    throw new Error('non-generation predecessor cannot claim a base pointer');
  }
  if (
    (mode === 'empty-r2' &&
      (evidence.source.indexSha256 !== null || evidence.source.tombstones !== null)) ||
    (mode !== 'empty-r2' &&
      (!/^[0-9a-f]{64}$/.test(evidence.source.indexSha256 ?? '') ||
        !exactKeys(evidence.source.tombstones, ['path', 'bytes', 'sha256', 'count']) ||
        evidence.source.tombstones.path !== PREDECESSOR_TOMBSTONES_PATH ||
        !Number.isSafeInteger(evidence.source.tombstones.bytes) ||
        evidence.source.tombstones.bytes < 1 ||
        !/^[0-9a-f]{64}$/.test(evidence.source.tombstones.sha256 ?? '') ||
        !Number.isSafeInteger(evidence.source.tombstones.count) ||
        evidence.source.tombstones.count < 0))
  ) {
    throw new Error('camera predecessor has an invalid index identity');
  }
  if (
    mode === 'empty-r2' &&
    (evidence.liveCount !== 0 ||
      evidence.source.inventory.files !== 0 ||
      evidence.source.inventory.bytes !== 0)
  ) {
    throw new Error('empty predecessor contains camera evidence');
  }
  for (let index = 0; index < evidence.liveIds.length; index += 1) {
    const id = evidence.liveIds[index];
    if (!/^osm:[1-9]\d*$/.test(id ?? '') || (index > 0 && evidence.liveIds[index - 1] >= id)) {
      throw new Error('camera predecessor live ids are invalid, duplicate, or unsorted');
    }
  }
  if (idsDigest(evidence.liveIds) !== evidence.liveIdsSha256) {
    throw new Error('camera predecessor live-id digest does not match its ids');
  }
  return evidence;
}

export function predecessorIdentity(bytes, evidence = null) {
  const body = Buffer.from(bytes);
  const parsed = validatePredecessorEvidence(evidence ?? parseJson(body, PREDECESSOR_PATH));
  return {
    path: PREDECESSOR_PATH,
    bytes: body.length,
    sha256: sha256(body),
    mode: parsed.source.mode,
    liveCount: parsed.liveCount,
    liveIdsSha256: parsed.liveIdsSha256,
    deployment: { ...parsed.source.deployment },
  };
}

export function uncoveredPredecessorIds(evidence, liveIds, tombstones) {
  const predecessor = validatePredecessorEvidence(evidence);
  const live = new Set(liveIds);
  const removed = new Set(tombstones.map((entry) => entry.id));
  return predecessor.liveIds.filter((id) => !live.has(id) && !removed.has(id));
}

/**
 * Return every predecessor-live id absent from the candidate live set, even if
 * an older inherited tombstone names it. A live/tombstone overlap is possible
 * in the no-delete legacy overlay; that historical tombstone cannot prove the
 * node's current state at the new baseline cutover.
 */
export function predecessorIdsMissingFromLiveSet(evidence, liveIds) {
  const predecessor = validatePredecessorEvidence(evidence);
  const live = new Set(liveIds);
  return predecessor.liveIds.filter((id) => !live.has(id));
}

export function assertPredecessorCoverage(evidence, liveIds, tombstones) {
  const missing = uncoveredPredecessorIds(evidence, liveIds, tombstones);
  if (missing.length > 0) {
    throw new Error(
      `camera cutover would lose ${String(missing.length)} predecessor live id(s) without ` +
        `a tombstone; first uncovered id is ${missing[0]}`,
    );
  }
  return evidence;
}

export function assertHydratedPredecessorGeneration(local) {
  const pointer = validatePointer(local?.basePointer);
  const manifest = createManifest({
    createdAt: '1970-01-01T00:00:00.000Z',
    replication: local.replication,
    archive: local.archive,
    files: local.files,
  });
  if (manifest.generation !== pointer.generation) {
    throw new Error('hydrated predecessor bytes/state do not match their basePointer generation');
  }
  return local;
}

/**
 * Validate the legacy flat root as the no-delete overlay it really is.
 *
 * That publisher overwrote changed keys but never removed stale tile keys, so
 * the bucket is intentionally not one coherent generation. Every listed tile
 * remains addressable by clients and therefore participates in predecessor
 * continuity. We validate each object and require the union to cover at least
 * the catalogue counts; duplicate ids across historical/current tiles collapse
 * only in the evidence set.
 */
export function validateLegacyFlatOverlay(
  entries,
  { minimumCameras = 120_000, minimumTiles = 4_000 } = {},
) {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  if (byKey.size !== entries.length) throw new Error('legacy flat-root repeats an object key');
  const index = parseJson(byKey.get('index.json')?.body, 'index.json');
  if (
    index.zoom !== TILE_ZOOM ||
    index.attribution !== ATTRIBUTION ||
    index.licence !== LICENCE ||
    !Number.isSafeInteger(index.cameras) ||
    index.cameras < minimumCameras ||
    !Number.isSafeInteger(index.tiles) ||
    index.tiles < minimumTiles
  ) {
    throw new Error('legacy flat-root index is invalid');
  }
  canonicalSourceTimestamp(index.upstream, 'legacy index upstream');

  const tombstones = parseJson(byKey.get('tombstones.json')?.body, 'tombstones.json');
  if (!Array.isArray(tombstones.tombstones)) {
    throw new Error('legacy flat-root tombstone ledger is invalid');
  }
  if (
    (Object.hasOwn(tombstones, 'attribution') && tombstones.attribution !== ATTRIBUTION) ||
    (Object.hasOwn(tombstones, 'licence') && tombstones.licence !== LICENCE)
  ) {
    throw new Error('legacy flat-root tombstone notice is invalid');
  }
  const tombstoneIds = new Set();
  for (const entry of tombstones.tombstones) {
    if (
      !/^osm:[1-9]\d*$/.test(entry?.id ?? '') ||
      !['osm_delete', 'osm_untag', 'osm_out_of_scope', 'cutover_reconciliation'].includes(
        entry.reason,
      ) ||
      !Number.isSafeInteger(entry.seq) ||
      entry.seq < 0 ||
      tombstoneIds.has(entry.id)
    ) {
      throw new Error('legacy flat-root tombstone ledger has an invalid or duplicate entry');
    }
    tombstoneIds.add(entry.id);
  }

  let tileCount = 0;
  const liveIds = new Set();
  for (const entry of entries) {
    const logical = validateLogicalKey(entry.key);
    if (logical.kind !== 'tile') continue;
    tileCount += 1;
    const tile = parseJson(entry.body, entry.key);
    if (
      tile.z !== TILE_ZOOM ||
      tile.x !== logical.x ||
      tile.y !== logical.y ||
      tile.attribution !== ATTRIBUTION ||
      tile.licence !== LICENCE ||
      !Array.isArray(tile.cameras)
    ) {
      throw new Error(`legacy flat-root tile is invalid: ${entry.key}`);
    }
    for (const camera of tile.cameras) {
      if (
        !/^osm:[1-9]\d*$/.test(camera?.id ?? '') ||
        !Number.isFinite(camera.lat) ||
        !Number.isFinite(camera.lon)
      ) {
        throw new Error(`legacy flat-root tile has an invalid camera: ${entry.key}`);
      }
      const expected = latLonToTile(camera.lat, camera.lon, TILE_ZOOM);
      if (expected.x !== logical.x || expected.y !== logical.y) {
        throw new Error(`legacy flat-root camera is in the wrong tile: ${entry.key}`);
      }
      liveIds.add(camera.id);
    }
  }
  if (tileCount < index.tiles || liveIds.size < index.cameras) {
    throw new Error('legacy flat-root overlay does not cover its catalogue counts');
  }
  return { index, tombstones, tileCount, liveCount: liveIds.size };
}

function remoteInventory(objects) {
  const seen = new Set();
  const result = [];
  for (const object of objects) {
    if (object.Key?.startsWith('__camera/')) continue;
    const key = object?.Key;
    validateLogicalKey(key);
    if (seen.has(key)) throw new Error(`legacy flat-root inventory repeats ${key}`);
    seen.add(key);
    if (!Number.isSafeInteger(object.Size) || object.Size < 1 || object.Size > MAX_OBJECT_BYTES) {
      throw new Error(`legacy flat-root object ${String(key)} has an invalid size`);
    }
    result.push({
      key,
      bytes: object.Size,
      md5: cleanEtag(object.ETag, key),
      quotedEtag: object.ETag,
    });
  }
  if (result.length > MAX_FILES) throw new Error('legacy flat-root archive has too many files');
  return result.sort((left, right) => compareKeys(left.key, right.key));
}

const remoteFingerprint = (entries) =>
  entries.map((entry) => `${entry.key}\0${String(entry.bytes)}\0${entry.md5}`).join('\n');

export async function captureLegacyFlatRoot({
  client,
  accountId,
  bucket,
  capturedAt = new Date().toISOString(),
}) {
  const pointerBefore = await getObject(client, bucket, POINTER_KEY, {
    maximum: MAX_CONTROL_BYTES,
  });
  if (pointerBefore !== null)
    throw new Error('legacy flat-root capture requires the pointer to be absent');
  const listed = remoteInventory(await listPrefix(client, bucket, ''));
  if (listed.length === 0) throw new Error('legacy flat-root capture found no camera archive');
  let totalBytes = 0;
  const entries = new Array(listed.length);
  await runBounded(listed, DOWNLOAD_CONCURRENCY, async (remote, index) => {
    totalBytes += remote.bytes;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('legacy flat-root archive is too large');
    const response = await getObject(client, bucket, remote.key, {
      ifMatch: remote.quotedEtag,
      maximum: remote.bytes,
    });
    if (
      response === null ||
      response.body.length !== remote.bytes ||
      response.etag !== remote.md5
    ) {
      throw new Error(`legacy flat-root object changed while captured: ${remote.key}`);
    }
    entries[index] = { key: remote.key, body: response.body };
  });
  validateLegacyFlatOverlay(entries);
  const relisted = remoteInventory(await listPrefix(client, bucket, ''));
  if (remoteFingerprint(relisted) !== remoteFingerprint(listed)) {
    throw new Error('legacy flat-root inventory changed while captured');
  }
  const pointerAfter = await getObject(client, bucket, POINTER_KEY, { maximum: MAX_CONTROL_BYTES });
  if (pointerAfter !== null)
    throw new Error('camera generation pointer appeared during legacy capture');
  const tombstoneBody = entries.find((entry) => entry.key === 'tombstones.json')?.body;
  if (!Buffer.isBuffer(tombstoneBody))
    throw new Error('legacy flat-root archive has no tombstones');
  return {
    evidence: buildPredecessorEvidence({
      mode: 'legacy-flat-root',
      entries,
      deployment: r2DeploymentIdentity(accountId, bucket),
      capturedAt,
    }),
    tombstoneBody,
  };
}

export async function captureEmptyR2({
  client,
  accountId,
  bucket,
  capturedAt = new Date().toISOString(),
}) {
  const pointerBefore = await getObject(client, bucket, POINTER_KEY, {
    maximum: MAX_CONTROL_BYTES,
  });
  const firstList = await listPrefix(client, bucket, '');
  const secondList = await listPrefix(client, bucket, '');
  const pointerAfter = await getObject(client, bucket, POINTER_KEY, {
    maximum: MAX_CONTROL_BYTES,
  });
  if (
    pointerBefore !== null ||
    pointerAfter !== null ||
    firstList.length !== 0 ||
    secondList.length !== 0
  ) {
    throw new Error('empty-R2 predecessor requires a genuinely empty bucket and no pointer');
  }
  return buildPredecessorEvidence({
    mode: 'empty-r2',
    entries: [],
    deployment: r2DeploymentIdentity(accountId, bucket),
    capturedAt,
  });
}

function optionValue(argv, index, name) {
  const argument = argv[index];
  if (argument === name) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return { value, consumed: 2 };
  }
  if (argument.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1);
    if (value === '') throw new Error(`${name} needs a value`);
    return { value, consumed: 1 };
  }
  return null;
}

export function parsePredecessorArgs(argv) {
  const parsed = { mode: null, out: null, target: null, stateFile: null };
  const options = new Map([
    ['--mode', 'mode'],
    ['--out', 'out'],
    ['--target', 'target'],
    ['--state-file', 'stateFile'],
  ]);
  for (let index = 0; index < argv.length;) {
    let found = false;
    for (const [name, key] of options) {
      const option = optionValue(argv, index, name);
      if (option === null) continue;
      if (parsed[key] !== null) throw new Error(`${name} may be passed only once`);
      parsed[key] = option.value;
      index += option.consumed;
      found = true;
      break;
    }
    if (!found) throw new Error(`unknown predecessor argument: ${argv[index]}`);
  }
  if (!PREDECESSOR_MODES.includes(parsed.mode)) throw new Error('--mode is required and invalid');
  if (parsed.out === null) throw new Error('--out is required');
  if (parsed.mode === 'generation' && (parsed.target === null || parsed.stateFile === null)) {
    throw new Error('generation predecessor requires --target and --state-file');
  }
  if (parsed.mode !== 'generation' && (parsed.target !== null || parsed.stateFile !== null)) {
    throw new Error('R2 predecessor modes reject --target and --state-file');
  }
  return parsed;
}

function prepareOutputDirectory(path) {
  const target = resolve(path);
  if (target === parse(target).root || existsSync(target)) {
    throw new Error(`predecessor output must be a new directory: ${target}`);
  }
  let component = dirname(target);
  while (component !== parse(component).root) {
    const info = lstatSync(component);
    if (info.isSymbolicLink())
      throw new Error(`predecessor output has a symlink parent: ${target}`);
    component = dirname(component);
  }
  return target;
}

async function main(argv = process.argv.slice(2)) {
  const options = parsePredecessorArgs(argv);
  const out = prepareOutputDirectory(options.out);
  const bucket = required('R2_CAMERA_BUCKET');
  const account = process.env['R2_ACCOUNT_ID']?.trim() || required('CLOUDFLARE_ACCOUNT_ID');
  let evidence;
  let tombstoneBody = null;
  if (options.mode === 'generation') {
    const local = await readLocalGeneration(resolve(options.target), resolve(options.stateFile));
    if (local.basePointer === null) throw new Error('generation predecessor has no base pointer');
    assertHydratedPredecessorGeneration(local);
    evidence = buildPredecessorEvidence({
      mode: 'generation',
      entries: local.entries,
      deployment: r2DeploymentIdentity(account, bucket),
      pointer: local.basePointer,
      versionsKnown: local.replication.versionsKnown,
      capturedAt: new Date().toISOString(),
    });
    tombstoneBody = local.entries.find((entry) => entry.key === 'tombstones.json')?.body ?? null;
  } else {
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: await s3Credentials(),
    });
    if (options.mode === 'legacy-flat-root') {
      ({ evidence, tombstoneBody } = await captureLegacyFlatRoot({
        client,
        accountId: account,
        bucket,
      }));
    } else {
      evidence = await captureEmptyR2({ client, accountId: account, bucket });
    }
  }
  await mkdir(out);
  await writeFile(
    resolve(out, 'camera-predecessor.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: 'wx' },
  );
  if (tombstoneBody !== null) {
    await writeFile(resolve(out, 'camera-predecessor-tombstones.json'), tombstoneBody, {
      flag: 'wx',
    });
  }
  process.stdout.write(
    `captured ${evidence.source.mode} predecessor: ${String(evidence.liveCount)} live ids\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
