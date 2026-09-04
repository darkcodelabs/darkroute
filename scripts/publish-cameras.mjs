/**
 * Publish one validated camera generation without exposing a mixed snapshot.
 *
 * Data is reconciled into the only slot not protected by the current pointer
 * and its previous generation. The manifest is written after all data, and
 * the pointer is changed last with a conditional write.
 *
 * USAGE
 *   node scripts/publish-cameras.mjs
 *   node scripts/publish-cameras.mjs --bootstrap
 *   node scripts/publish-cameras.mjs --dry
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import {
  CAMERA_SLOTS,
  LEASE_KEY,
  LEASE_SCHEMA,
  MAX_CONTROL_BYTES,
  MAX_FILES,
  MAX_MANIFEST_BYTES,
  POINTER_KEY,
  POINTER_SCHEMA,
  canonicalJson,
  createManifest,
  isTimestamp,
  jsonBytes,
  md5,
  parseManifestBytes,
  parsePointerBytes,
  readLocalGeneration,
  required,
  s3Credentials,
  selectCandidateSlot,
  sha256,
  slotDataPrefix,
  slotManifestKey,
  slotPrefix,
  validateArchiveBodies,
  validatePointer,
  validateLogicalKey,
} from './camera-generation.mjs';
import {
  PREDECESSOR_PATH,
  buildPredecessorEvidence,
  predecessorIdentity,
  r2DeploymentIdentity,
  validateLegacyFlatOverlay,
  validatePredecessorEvidence,
} from './camera-predecessor.mjs';
import {
  CAMERA_CONTINUITY_KEY,
  cameraContinuityBytes,
  parseCameraContinuityBytes,
} from './camera-integrity.mjs';
import { deriveCameraContinuity } from './attest-camera-continuity.mjs';
import { readValidatedCapture } from './propose-deflock-source-review.mjs';
import {
  DEFAULT_COUNTY_GEOFENCE,
  DEFAULT_RELEASE_TOMBSTONES,
  DEFAULT_SOURCE_REVIEW,
  assertApprovedCameraSourceMarker,
  assertReleaseTombstoneInput,
  releaseGeofenceIdentity,
} from './fetch-cameras.mjs';
import { loadCountiesBytes } from './counties.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_ARCHIVE = join(ROOT, 'apps/pwa/public/cameras');
const DEFAULT_STATE_FILE = join(ROOT, 'scripts/camera-sync-state.json');
const UPLOAD_CONCURRENCY = 8;
export const LEASE_MILLISECONDS = 180 * 60 * 1_000;
export const WRITE_DEADLINE_MILLISECONDS = 110 * 60 * 1_000;
const RELEASE_DEADLINE_MILLISECONDS = 10_000;
const SIMPLE_ETAG = /^"?([a-f\d]{32})"?$/i;

function localPredecessorIdentity(local) {
  if (!local.replication.versionsKnown) return null;
  const entry = local.entries.find(({ key }) => key === 'index.json');
  let index;
  try {
    index = JSON.parse(entry?.body.toString('utf8'));
  } catch {
    throw new Error('approved local camera index is not JSON');
  }
  const identity = index?.cameraSource?.review?.receipt?.releaseInputs?.predecessor;
  if (typeof identity !== 'object' || identity === null) {
    throw new Error('approved local camera source has no predecessor identity');
  }
  return identity;
}

async function verifiedParentContinuity(client, bucket, pointer, manifest, fence) {
  const identity = manifest.files.find((file) => file.key === CAMERA_CONTINUITY_KEY);
  if (identity === undefined) {
    throw new Error('current versionsKnown generation has no continuity sidecar');
  }
  const remote = await getObject(
    client,
    bucket,
    `${slotDataPrefix(pointer.slot)}${CAMERA_CONTINUITY_KEY}`,
    {
      maximum: identity.bytes,
      fence,
      phase: 'current camera continuity read',
    },
  );
  if (
    remote === null ||
    remote.body.length !== identity.bytes ||
    sha256(remote.body) !== identity.sha256 ||
    md5(remote.body) !== identity.md5
  ) {
    throw new Error('current camera continuity does not match its immutable manifest');
  }
  parseCameraContinuityBytes(remote.body, { replication: manifest.replication });
  return remote.body;
}

/** Independently rebuild the candidate from the approved baseline and official diffs. */
export async function verifyCandidateCameraContinuity({
  local,
  current,
  currentManifest,
  client,
  bucket,
  fence,
  trustedReviewBytes,
  captureDir = resolve(ROOT, 'scripts/data'),
  baselineTombstoneBytes,
  fetchImpl = fetch,
}) {
  if (local.replication.versionsKnown !== true) return null;
  const candidateEntry = local.entries.find(({ key }) => key === CAMERA_CONTINUITY_KEY);
  if (candidateEntry === undefined) throw new Error('candidate has no camera continuity sidecar');
  const candidate = parseCameraContinuityBytes(candidateEntry.body, {
    replication: local.replication,
  });
  const reviewBytes =
    trustedReviewBytes === undefined
      ? await readFile(DEFAULT_SOURCE_REVIEW)
      : Buffer.from(trustedReviewBytes);
  const geofenceBytes = await readFile(DEFAULT_COUNTY_GEOFENCE);
  releaseGeofenceIdentity(geofenceBytes);
  const capture = readValidatedCapture(captureDir);
  const indexEntry = local.entries.find(({ key }) => key === 'index.json');
  let index;
  try {
    index = JSON.parse(indexEntry?.body.toString('utf8'));
  } catch {
    throw new Error('approved local camera index is not JSON');
  }
  const marker = assertApprovedCameraSourceMarker(index?.cameraSource, reviewBytes);
  const baselineInput = assertReleaseTombstoneInput(
    baselineTombstoneBytes === undefined
      ? await readFile(DEFAULT_RELEASE_TOMBSTONES)
      : Buffer.from(baselineTombstoneBytes),
    marker.review.receipt.releaseInputs.tombstones,
  );

  let parentContinuity = null;
  let parentPointer = null;
  if (currentManifest?.replication?.versionsKnown === true) {
    if (current === null) throw new Error('versionsKnown current manifest has no pointer');
    parentContinuity = await verifiedParentContinuity(
      client,
      bucket,
      current,
      currentManifest,
      fence,
    );
    parentPointer = current;
    if (candidate.document.transition.kind !== 'replication') {
      throw new Error('versioned camera descendant must extend its current continuity parent');
    }
  } else if (candidate.document.transition.kind !== 'baseline-replay') {
    throw new Error('first approved camera generation must replay from its reviewed baseline');
  }

  const expected = await deriveCameraContinuity({
    local,
    trustedReviewBytes: reviewBytes,
    capture,
    countyIndex: loadCountiesBytes(geofenceBytes),
    baselineTombstones: baselineInput.ledger.tombstones,
    parentContinuity,
    parentPointer,
    fetchImpl,
  });
  if (!candidateEntry.body.equals(cameraContinuityBytes(expected))) {
    throw new Error('candidate camera continuity is not the independently reproduced transition');
  }
  return expected;
}

async function approvedPredecessor(local, accountId, bucket, suppliedBytes) {
  const expected = localPredecessorIdentity(local);
  if (expected === null) return null;
  const deployment = r2DeploymentIdentity(accountId, bucket);
  const bytes =
    suppliedBytes === undefined
      ? await readFile(resolve(ROOT, PREDECESSOR_PATH))
      : Buffer.from(suppliedBytes);
  let evidence;
  try {
    evidence = validatePredecessorEvidence(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    throw new Error(`approved camera predecessor evidence is invalid: ${error.message}`, {
      cause: error,
    });
  }
  if (canonicalJson(predecessorIdentity(bytes, evidence)) !== canonicalJson(expected)) {
    throw new Error('local approved source does not match the camera predecessor evidence');
  }
  if (canonicalJson(evidence.source.deployment) !== canonicalJson(deployment)) {
    throw new Error('camera predecessor was captured from a different R2 deployment');
  }
  return evidence;
}

function generationInventoryIdentity(manifest) {
  return {
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
    sha256: sha256(Buffer.from(canonicalJson(manifest.files))),
    listingSha256: sha256(
      Buffer.from(
        canonicalJson(
          manifest.files.map(({ key, bytes, md5: digest }) => ({
            key,
            bytes,
            md5: digest,
          })),
        ),
      ),
    ),
  };
}

/** Bind a false-to-true cutover to the exact immutable predecessor generation. */
export function assertGenerationPredecessorMatchesManifest(evidence, manifest) {
  if (evidence?.source?.mode !== 'generation') {
    throw new Error(
      'approved legacy-to-versioned cutover requires generation predecessor evidence',
    );
  }
  const index = manifest.files.find((file) => file.key === 'index.json');
  const tombstones = manifest.files.find((file) => file.key === 'tombstones.json');
  if (
    evidence.source.versionsKnown !== manifest.replication.versionsKnown ||
    evidence.source.indexSha256 !== index?.sha256 ||
    evidence.source.tombstones?.bytes !== tombstones?.bytes ||
    evidence.source.tombstones?.sha256 !== tombstones?.sha256 ||
    evidence.source.tombstones?.count !== manifest.archive.tombstones ||
    evidence.liveCount !== manifest.archive.cameras ||
    canonicalJson(evidence.source.inventory) !==
      canonicalJson(generationInventoryIdentity(manifest))
  ) {
    throw new Error(
      'approved camera predecessor does not match the exact current generation manifest',
    );
  }
  return evidence;
}

function bootstrapFlatInventory(objects) {
  const flat = [];
  for (const entry of objects) {
    const key = entry.Key;
    if (key === POINTER_KEY) throw new Error('camera pointer appeared during bootstrap preflight');
    if (key?.startsWith('__camera/')) {
      if (key !== LEASE_KEY && !CAMERA_SLOTS.some((slot) => key.startsWith(slotPrefix(slot)))) {
        throw new Error(`unexpected camera control object during bootstrap: ${String(key)}`);
      }
      continue;
    }
    validateLogicalKey(key);
    flat.push({ key, bytes: entry.Size, md5: cleanEtag(entry.ETag, key) });
  }
  flat.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return {
    files: flat.length,
    bytes: flat.reduce((sum, entry) => sum + entry.bytes, 0),
    listingSha256: sha256(Buffer.from(canonicalJson(flat))),
  };
}

function assertObservedPredecessor(evidence, observed) {
  if (
    canonicalJson(observed.source) !== canonicalJson(evidence.source) ||
    observed.liveCount !== evidence.liveCount ||
    observed.liveIdsSha256 !== evidence.liveIdsSha256 ||
    canonicalJson(observed.liveIds) !== canonicalJson(evidence.liveIds)
  ) {
    throw new Error('camera predecessor live ids do not match the exact remote archive');
  }
  return evidence;
}

async function readFlatPredecessorEntries(client, bucket, listed, fence, phase) {
  const objects = listed.filter(({ Key: key }) => !key?.startsWith('__camera/'));
  const entries = new Array(objects.length);
  await runBounded(
    objects.map((object, index) => ({ object, index })),
    UPLOAD_CONCURRENCY,
    async ({ object, index }) => {
      const key = object.Key;
      validateLogicalKey(key);
      const expectedEtag = cleanEtag(object.ETag, key);
      const remote = await getObject(client, bucket, key, {
        ifMatch: object.ETag,
        maximum: object.Size,
        fence,
        phase,
      });
      if (remote === null || remote.body.length !== object.Size || remote.etag !== expectedEtag) {
        throw new Error(`legacy flat-root object changed while verified: ${key}`);
      }
      entries[index] = { key, body: remote.body };
    },
  );
  return entries;
}

async function assertBootstrapPredecessor(client, accountId, bucket, evidence, fence, phase) {
  if (!['legacy-flat-root', 'empty-r2'].includes(evidence.source.mode)) {
    throw new Error('bootstrap requires empty-R2 or legacy-flat-root predecessor evidence');
  }
  const listed = await listPrefix(client, bucket, '', MAX_FILES * 2 + 10, fence, phase);
  const current = bootstrapFlatInventory(listed);
  if (evidence.source.mode === 'empty-r2') {
    if (current.files !== 0 || current.bytes !== 0) {
      throw new Error('empty-R2 predecessor no longer matches the bootstrap deployment');
    }
    const confirmed = bootstrapFlatInventory(
      await listPrefix(client, bucket, '', MAX_FILES * 2 + 10, fence, phase),
    );
    if (confirmed.files !== 0 || confirmed.bytes !== 0) {
      throw new Error('empty-R2 predecessor changed while it was verified');
    }
    return;
  }
  const expected = evidence.source.inventory;
  if (
    current.files !== expected.files ||
    current.bytes !== expected.bytes ||
    current.listingSha256 !== expected.listingSha256
  ) {
    throw new Error('legacy flat-root inventory changed after predecessor capture');
  }
  const entries = await readFlatPredecessorEntries(client, bucket, listed, fence, phase);
  validateLegacyFlatOverlay(entries);
  const observed = buildPredecessorEvidence({
    mode: 'legacy-flat-root',
    entries,
    deployment: r2DeploymentIdentity(accountId, bucket),
    capturedAt: evidence.capturedAt,
  });
  assertObservedPredecessor(evidence, observed);
  const confirmed = bootstrapFlatInventory(
    await listPrefix(client, bucket, '', MAX_FILES * 2 + 10, fence, phase),
  );
  if (canonicalJson(confirmed) !== canonicalJson(current)) {
    throw new Error('legacy flat-root inventory changed while it was verified');
  }
}

async function assertRemoteGenerationPredecessor({
  client,
  accountId,
  bucket,
  pointer,
  manifest,
  evidence,
  fence,
  validation,
}) {
  const entries = new Array(manifest.files.length);
  const prefix = slotDataPrefix(pointer.slot);
  await runBounded(
    manifest.files.map((file, index) => ({ file, index })),
    UPLOAD_CONCURRENCY,
    async ({ file, index }) => {
      const remote = await getObject(client, bucket, `${prefix}${file.key}`, {
        ifMatch: `"${file.md5}"`,
        maximum: file.bytes,
        fence,
        phase: 'current predecessor generation verification',
      });
      if (
        remote === null ||
        remote.body.length !== file.bytes ||
        remote.etag !== file.md5 ||
        sha256(remote.body) !== file.sha256
      ) {
        throw new Error(`current predecessor object failed its manifest: ${file.key}`);
      }
      entries[index] = { key: file.key, body: remote.body };
    },
  );
  const measured = validateArchiveBodies(entries, manifest.replication, {
    minTiles: validation.minTiles,
    minCameras: validation.minCameras,
    requireLicenceUrl: manifest.replication.versionsKnown,
  });
  if (canonicalJson(measured) !== canonicalJson(manifest.archive)) {
    throw new Error('current predecessor archive disagrees with its immutable manifest');
  }
  const observed = buildPredecessorEvidence({
    mode: 'generation',
    entries,
    deployment: r2DeploymentIdentity(accountId, bucket),
    pointer,
    versionsKnown: manifest.replication.versionsKnown,
    capturedAt: evidence.capturedAt,
  });
  assertObservedPredecessor(evidence, observed);
}

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanEtag(etag, key) {
  if (typeof etag !== 'string') throw new Error(`R2 object ${key} has no ETag`);
  const match = SIMPLE_ETAG.exec(etag);
  if (match === null) throw new Error(`R2 object ${key} does not have a single-part MD5 ETag`);
  return match[1].toLowerCase();
}

function isNotFound(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    error?.name === 'NoSuchKey' ||
    error?.name === 'NotFound'
  );
}

function isPreconditionFailed(error) {
  return error?.$metadata?.httpStatusCode === 412 || error?.name === 'PreconditionFailed';
}

function createWriteFence(now, duration = WRITE_DEADLINE_MILLISECONDS) {
  const controller = new AbortController();
  const deadline = now().valueOf() + duration;
  const timer = setTimeout(
    () => controller.abort(new Error('camera publication deadline')),
    duration,
  );
  timer.unref?.();
  return {
    signal: controller.signal,
    deadline,
    assert(phase) {
      if (controller.signal.aborted || now().valueOf() >= deadline) {
        controller.abort(new Error('camera publication deadline'));
        throw new Error(`camera publication write deadline reached before ${phase}`);
      }
    },
    close() {
      clearTimeout(timer);
    },
  };
}

async function sendCommand(client, command, fence, phase) {
  fence.assert(phase);
  try {
    return await client.send(command, { abortSignal: fence.signal });
  } catch (error) {
    if (fence.signal.aborted) {
      throw new Error(`camera publication write deadline reached during ${phase}`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function bodyBytes(body, key, maximum) {
  if (body === undefined || body === null) throw new Error(`R2 returned no body for ${key}`);
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let size = 0;
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maximum) throw new Error(`R2 object ${key} is too large`);
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
  if (typeof body.transformToByteArray !== 'function') {
    throw new Error(`R2 returned an unreadable body for ${key}`);
  }
  const transformed = Buffer.from(await body.transformToByteArray());
  if (transformed.byteLength > maximum) throw new Error(`R2 object ${key} is too large`);
  return transformed;
}

async function getObject(
  client,
  bucket,
  key,
  { ifMatch, maximum = MAX_CONTROL_BYTES, fence, phase = `GET ${key}` } = {},
) {
  let response;
  try {
    response = await sendCommand(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key, ...(ifMatch ? { IfMatch: ifMatch } : {}) }),
      fence,
      phase,
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (
    Number.isSafeInteger(response.ContentLength) &&
    (response.ContentLength < 1 || response.ContentLength > maximum)
  ) {
    throw new Error(`R2 object ${key} has an invalid size`);
  }
  const body = await bodyBytes(response.Body, key, maximum);
  const etag = cleanEtag(response.ETag, key);
  if (md5(body) !== etag) throw new Error(`R2 object ${key} failed its response ETag check`);
  return { body, etag, quotedEtag: response.ETag };
}

async function listPrefix(
  client,
  bucket,
  prefix,
  maximum = MAX_FILES + 1,
  fence,
  phase = `LIST ${prefix}`,
) {
  const found = [];
  const continuationTokens = new Set();
  let token;
  do {
    const page = await sendCommand(
      client,
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      fence,
      phase,
    );
    for (const entry of page.Contents ?? []) {
      if (typeof entry.Key !== 'string' || !entry.Key.startsWith(prefix)) {
        throw new Error(`R2 returned an object outside requested prefix ${prefix}`);
      }
      if (!Number.isSafeInteger(entry.Size) || entry.Size < 0) {
        throw new Error(`R2 object ${entry.Key} has an invalid size`);
      }
      found.push(entry);
      if (found.length > maximum) throw new Error(`R2 prefix ${prefix} contains too many objects`);
    }
    if (page.IsTruncated === true && typeof page.NextContinuationToken !== 'string') {
      throw new Error('R2 returned a truncated LIST page without a continuation token');
    }
    const next = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    if (next !== undefined && continuationTokens.has(next)) {
      throw new Error('R2 repeated a LIST continuation token');
    }
    if (next !== undefined) continuationTokens.add(next);
    token = next;
  } while (token !== undefined);
  return found;
}

async function runBounded(items, limit, operation) {
  let cursor = 0;
  let failure;
  async function worker() {
    while (failure === undefined && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await operation(items[index]);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, worker));
  if (failure !== undefined) throw failure;
}

async function putJson(client, bucket, key, body, condition, fence, phase = `PUT ${key}`) {
  const digest = md5(body);
  return sendCommand(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
      ContentMD5: Buffer.from(digest, 'hex').toString('base64'),
      ...condition,
    }),
    fence,
    phase,
  );
}

function parseLease(body) {
  if (body.byteLength < 1 || body.byteLength > MAX_CONTROL_BYTES) {
    throw new Error('camera publish lease has an invalid size');
  }
  let lease;
  try {
    lease = JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid camera publish lease: ${error.message}`, { cause: error });
  }
  const keys = Object.keys(lease ?? {})
    .sort()
    .join(',');
  if (
    !object(lease) ||
    keys !== 'acquiredAt,expiresAt,owner,schema' ||
    lease.schema !== LEASE_SCHEMA ||
    typeof lease.owner !== 'string' ||
    lease.owner === '' ||
    !isTimestamp(lease.acquiredAt) ||
    !isTimestamp(lease.expiresAt) ||
    new Date(lease.expiresAt) < new Date(lease.acquiredAt) ||
    !body.equals(jsonBytes(lease))
  ) {
    throw new Error('camera publish lease is malformed');
  }
  return lease;
}

async function acquireLease(client, bucket, { owner, now, fence }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const acquiredAt = now().toISOString();
    const lease = {
      schema: LEASE_SCHEMA,
      owner,
      acquiredAt,
      expiresAt: new Date(new Date(acquiredAt).valueOf() + LEASE_MILLISECONDS).toISOString(),
    };
    const body = jsonBytes(lease);
    try {
      await putJson(
        client,
        bucket,
        LEASE_KEY,
        body,
        { IfNoneMatch: '*' },
        fence,
        'lease acquisition',
      );
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
      const held = await getObject(client, bucket, LEASE_KEY, {
        fence,
        phase: 'existing lease inspection',
      });
      if (held === null) continue;
      const prior = parseLease(held.body);
      if (new Date(prior.expiresAt) > now()) {
        throw new Error(`camera publication is leased by ${prior.owner} until ${prior.expiresAt}`);
      }
      try {
        await putJson(
          client,
          bucket,
          LEASE_KEY,
          body,
          { IfMatch: held.quotedEtag },
          fence,
          'expired lease takeover',
        );
      } catch (replaceError) {
        if (isPreconditionFailed(replaceError)) continue;
        throw replaceError;
      }
    }
    const verified = await getObject(client, bucket, LEASE_KEY, {
      fence,
      phase: 'lease acquisition verification',
    });
    if (verified === null || !verified.body.equals(body)) {
      throw new Error('camera publish lease could not be verified after acquisition');
    }
    if (fence.deadline >= new Date(lease.expiresAt).valueOf()) {
      throw new Error('camera publication deadline is not strictly inside its lease');
    }
    return {
      owner,
      body,
      etag: verified.quotedEtag,
      etagDigest: verified.etag,
      expiresAt: lease.expiresAt,
    };
  }
  throw new Error('camera publish lease changed repeatedly; retry later');
}

async function releaseLease(client, bucket, lease, now, warn) {
  const releaseFence = createWriteFence(now, RELEASE_DEADLINE_MILLISECONDS);
  try {
    const releasedAt = now().toISOString();
    const released = {
      schema: LEASE_SCHEMA,
      owner: lease.owner,
      acquiredAt: releasedAt,
      expiresAt: releasedAt,
    };
    // R2 documents conditional PUT, but not conditional DELETE. Replacing the
    // held ETag with an already-expired marker releases safely without risking
    // deletion of a successor's lease.
    await putJson(
      client,
      bucket,
      LEASE_KEY,
      jsonBytes(released),
      { IfMatch: lease.etag },
      releaseFence,
      'lease release',
    );
  } catch (error) {
    warn(`warning: could not release camera publish lease: ${error.message}`);
  } finally {
    releaseFence.close();
  }
}

async function verifyLease(client, bucket, lease, now, fence, phase) {
  fence.assert(phase);
  if (now().valueOf() >= new Date(lease.expiresAt).valueOf()) {
    throw new Error(`camera publish lease expired before ${phase}`);
  }
  let held;
  try {
    held = await getObject(client, bucket, LEASE_KEY, {
      ifMatch: lease.etag,
      fence,
      phase: `lease verification before ${phase}`,
    });
  } catch (error) {
    if (isPreconditionFailed(error)) {
      throw new Error(`camera publish lease changed before ${phase}`, { cause: error });
    }
    throw error;
  }
  if (
    held === null ||
    held.etag !== lease.etagDigest ||
    held.quotedEtag !== lease.etag ||
    !held.body.equals(lease.body)
  ) {
    throw new Error(`camera publish lease changed before ${phase}`);
  }
  fence.assert(phase);
  if (now().valueOf() >= new Date(lease.expiresAt).valueOf()) {
    throw new Error(`camera publish lease expired before ${phase}`);
  }
}

async function readPointer(client, bucket, fence) {
  const remote = await getObject(client, bucket, POINTER_KEY, {
    fence,
    phase: 'camera pointer read',
  });
  if (remote === null) return null;
  return { pointer: parsePointerBytes(remote.body), ...remote };
}

async function readPinnedManifest(client, bucket, pointer, fence) {
  const remote = await getObject(client, bucket, slotManifestKey(pointer.slot), {
    maximum: MAX_MANIFEST_BYTES,
    fence,
    phase: 'current manifest read',
  });
  if (remote === null) throw new Error('current camera pointer names a missing manifest');
  if (sha256(remote.body) !== pointer.manifestSha256) {
    throw new Error('current camera manifest does not match the pointer hash');
  }
  const manifest = parseManifestBytes(remote.body);
  if (manifest.generation !== pointer.generation) {
    throw new Error('current camera manifest does not match the pointer generation');
  }
  return manifest;
}

function protectCandidate(candidate, pointer) {
  if (pointer === null) return;
  const protectedSlots = [pointer.slot, pointer.previous?.slot].filter(Boolean);
  if (protectedSlots.includes(candidate)) {
    throw new Error(`refusing to mutate protected camera slot ${candidate}`);
  }
}

async function reconcileCandidate(client, bucket, candidate, generation, fence) {
  protectCandidate(candidate, generation.pointer);
  const prefix = slotPrefix(candidate);
  const dataPrefix = slotDataPrefix(candidate);
  const manifestKey = slotManifestKey(candidate);
  const remote = await listPrefix(
    client,
    bucket,
    prefix,
    MAX_FILES + 1,
    fence,
    'candidate inventory read',
  );
  const oldManifest = remote.find((entry) => entry.Key === manifestKey);
  if (oldManifest !== undefined) {
    await sendCommand(
      client,
      new DeleteObjectCommand({ Bucket: bucket, Key: manifestKey }),
      fence,
      'old candidate manifest removal',
    );
  }

  const expected = new Map(
    generation.local.files.map((file) => [`${dataPrefix}${file.key}`, file]),
  );
  const localBodies = new Map(generation.local.entries.map((entry) => [entry.key, entry.body]));
  const deleteKeys = [];
  const uploadFiles = [];
  const seen = new Set();
  for (const entry of remote) {
    if (entry.Key === manifestKey) continue;
    const file = expected.get(entry.Key);
    if (file === undefined) {
      deleteKeys.push(entry.Key);
      continue;
    }
    if (seen.has(entry.Key)) throw new Error(`R2 listed duplicate object ${entry.Key}`);
    seen.add(entry.Key);
    const etag = typeof entry.ETag === 'string' ? SIMPLE_ETAG.exec(entry.ETag)?.[1] : undefined;
    if (entry.Size !== file.bytes || etag?.toLowerCase() !== file.md5) uploadFiles.push(file);
  }
  for (const file of generation.local.files) {
    if (!seen.has(`${dataPrefix}${file.key}`)) uploadFiles.push(file);
  }

  await runBounded(deleteKeys, UPLOAD_CONCURRENCY, (key) =>
    sendCommand(
      client,
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      fence,
      `candidate extra removal ${key}`,
    ),
  );
  await runBounded(uploadFiles, UPLOAD_CONCURRENCY, (file) => {
    const body = localBodies.get(file.key);
    if (body === undefined) throw new Error(`missing local body for ${file.key}`);
    return putJson(
      client,
      bucket,
      `${dataPrefix}${file.key}`,
      body,
      {},
      fence,
      `candidate data upload ${file.key}`,
    );
  });

  const relisted = await listPrefix(
    client,
    bucket,
    dataPrefix,
    MAX_FILES,
    fence,
    'candidate inventory verification',
  );
  if (relisted.length !== generation.local.files.length) {
    throw new Error('candidate R2 inventory has extra or missing objects after reconciliation');
  }
  const remoteByKey = new Map();
  for (const entry of relisted) {
    if (remoteByKey.has(entry.Key)) throw new Error(`R2 listed duplicate object ${entry.Key}`);
    remoteByKey.set(entry.Key, entry);
  }
  for (const file of generation.local.files) {
    const key = `${dataPrefix}${file.key}`;
    const entry = remoteByKey.get(key);
    if (
      entry === undefined ||
      entry.Size !== file.bytes ||
      cleanEtag(entry.ETag, key) !== file.md5
    ) {
      throw new Error(`candidate R2 inventory did not verify ${file.key}`);
    }
  }

  return { uploaded: uploadFiles.length, deleted: deleteKeys.length, manifestKey };
}

function pointerFor(candidate, manifest, manifestSha256, current, updatedAt) {
  const pointer = {
    schema: POINTER_SCHEMA,
    slot: candidate,
    generation: manifest.generation,
    manifestSha256,
    previous:
      current === null
        ? null
        : {
            slot: current.slot,
            generation: current.generation,
            manifestSha256: current.manifestSha256,
          },
    updatedAt,
  };
  return validatePointer(pointer);
}

/** A normal generation may advance replication, never weaken its trust root. */
export function assertPublicationContinuity(local, currentManifest) {
  if (local.replication.lastAppliedSeq < currentManifest.replication.lastAppliedSeq) {
    throw new Error('refusing to publish an older replication sequence');
  }
  if (
    new Date(local.replication.lastAppliedTimestamp) <
    new Date(currentManifest.replication.lastAppliedTimestamp)
  ) {
    throw new Error('refusing to publish an older replication timestamp');
  }
  if (currentManifest.replication.versionsKnown && !local.replication.versionsKnown) {
    throw new Error('refusing to downgrade versionsKnown from true to false');
  }
  const approvedCutover =
    !currentManifest.replication.versionsKnown && local.replication.versionsKnown;
  if (!approvedCutover && local.archive.source !== currentManifest.archive.source) {
    throw new Error('refusing to change the camera baseline source during normal publication');
  }
  const localHasBase = Object.hasOwn(local.archive, 'baseUpstream');
  const currentHasBase = Object.hasOwn(currentManifest.archive, 'baseUpstream');
  if (
    !approvedCutover &&
    (localHasBase !== currentHasBase ||
      (localHasBase && local.archive.baseUpstream !== currentManifest.archive.baseUpstream))
  ) {
    throw new Error('refusing to change the camera baseline watermark during normal publication');
  }
  return local;
}

/** Atomic publication entry point, dependency-injectable for fault tests. */
export async function publishGeneration({
  client,
  bucket,
  archive,
  stateFile,
  bootstrap = false,
  now = () => new Date(),
  owner = randomUUID(),
  log = (message) => process.stdout.write(`${message}\n`),
  warn = (message) => process.stderr.write(`${message}\n`),
  validation = {},
  accountId,
  predecessorBytes,
}) {
  const local = await readLocalGeneration(archive, stateFile, {
    ...validation,
    requireLicenceUrl: true,
  });
  const predecessor = await approvedPredecessor(local, accountId, bucket, predecessorBytes);
  const createdAt = now().toISOString();
  const manifest = createManifest({
    createdAt,
    replication: local.replication,
    archive: local.archive,
    files: local.files,
  });
  const manifestBody = jsonBytes(manifest);
  if (manifestBody.byteLength > MAX_MANIFEST_BYTES) throw new Error('camera manifest is too large');
  const manifestSha256 = sha256(manifestBody);
  log(`${String(local.archive.tiles)} tiles / ${String(local.archive.cameras)} cameras validated`);

  const fence = createWriteFence(now);
  let lease;
  let candidateMutationMayHaveStarted = false;
  let publicationVerified = false;
  try {
    lease = await acquireLease(client, bucket, { owner, now, fence });
    const currentRemote = await readPointer(client, bucket, fence);
    if (bootstrap && currentRemote !== null) {
      throw new Error('--bootstrap requires __camera/current.json to be absent');
    }
    if (bootstrap && predecessor === null) {
      throw new Error('--bootstrap requires a versionsKnown approved predecessor-bound generation');
    }
    if (bootstrap && local.basePointer !== null) {
      throw new Error('--bootstrap rejects a hydrated basePointer');
    }
    if (!bootstrap && currentRemote === null) {
      throw new Error(
        'camera generation pointer is absent; use --bootstrap for a reviewed first seed',
      );
    }
    const current = currentRemote?.pointer ?? null;
    if (bootstrap && predecessor !== null) {
      await assertBootstrapPredecessor(
        client,
        accountId,
        bucket,
        predecessor,
        fence,
        'bootstrap predecessor preflight',
      );
    }
    if (!bootstrap) {
      if (local.basePointer === null) {
        throw new Error('normal camera publication requires the exact hydrated basePointer');
      }
      if (canonicalJson(local.basePointer) !== canonicalJson(current)) {
        throw new Error(
          'camera pointer changed since hydration; refusing to extend a different base generation',
        );
      }
    }
    let currentManifest = null;
    if (current !== null) {
      currentManifest = await readPinnedManifest(client, bucket, current, fence);
      if (manifest.generation === current.generation) {
        log(`generation ${manifest.generation} is already current`);
        return { unchanged: true, generation: manifest.generation, slot: current.slot };
      }
      assertPublicationContinuity(local, currentManifest);
      if (!currentManifest.replication.versionsKnown && local.replication.versionsKnown) {
        if (
          predecessor?.source.mode !== 'generation' ||
          canonicalJson(predecessor.source.pointer) !== canonicalJson(current) ||
          canonicalJson(predecessor.source.pointer) !== canonicalJson(local.basePointer)
        ) {
          throw new Error(
            'approved legacy-to-versioned cutover does not bind the exact current generation',
          );
        }
        assertGenerationPredecessorMatchesManifest(predecessor, currentManifest);
        await assertRemoteGenerationPredecessor({
          client,
          accountId,
          bucket,
          pointer: current,
          manifest: currentManifest,
          evidence: predecessor,
          fence,
          validation,
        });
      }
    }

    const continuityVerifier = validation.continuityVerifier ?? verifyCandidateCameraContinuity;
    await continuityVerifier({
      local,
      current,
      currentManifest,
      client,
      bucket,
      fence,
      trustedReviewBytes: validation.trustedReviewBytes,
      captureDir: validation.captureDir,
      baselineTombstoneBytes: validation.baselineTombstoneBytes,
      fetchImpl: validation.continuityFetch ?? fetch,
    });

    const candidate = selectCandidateSlot(current);
    if (!CAMERA_SLOTS.includes(candidate)) throw new Error('candidate slot selection failed');
    protectCandidate(candidate, current);
    const generation = { local, manifest, manifestBody, manifestSha256, pointer: current };
    await verifyLease(client, bucket, lease, now, fence, 'candidate reconciliation');
    // From this point on, a failed or aborted R2 request may have committed even
    // when the client never received an acknowledgement. Keep the lease live
    // until its natural expiry unless the complete publication is verified.
    candidateMutationMayHaveStarted = true;
    const { manifestKey, ...reconciled } = await reconcileCandidate(
      client,
      bucket,
      candidate,
      generation,
      fence,
    );

    await verifyLease(client, bucket, lease, now, fence, 'manifest write');
    await putJson(client, bucket, manifestKey, manifestBody, {}, fence, 'candidate manifest write');
    const committed = await getObject(client, bucket, manifestKey, {
      maximum: MAX_MANIFEST_BYTES,
      fence,
      phase: 'candidate manifest verification',
    });
    if (committed === null || sha256(committed.body) !== manifestSha256) {
      throw new Error('candidate camera manifest failed its post-upload verification');
    }
    const parsed = parseManifestBytes(committed.body);
    if (parsed.generation !== manifest.generation) {
      throw new Error('candidate camera manifest generation failed verification');
    }

    const pointer = pointerFor(candidate, manifest, manifestSha256, current, now().toISOString());
    const pointerBody = jsonBytes(pointer);
    const condition =
      currentRemote === null ? { IfNoneMatch: '*' } : { IfMatch: currentRemote.quotedEtag };
    await verifyLease(client, bucket, lease, now, fence, 'pointer write');
    if (bootstrap && predecessor !== null) {
      await assertBootstrapPredecessor(
        client,
        accountId,
        bucket,
        predecessor,
        fence,
        'bootstrap predecessor final verification',
      );
    }
    try {
      await putJson(
        client,
        bucket,
        POINTER_KEY,
        pointerBody,
        condition,
        fence,
        'camera pointer activation',
      );
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new Error('camera pointer changed during publication; candidate was not activated', {
          cause: error,
        });
      }
      throw error;
    }
    const activated = await getObject(client, bucket, POINTER_KEY, {
      fence,
      phase: 'camera pointer activation verification',
    });
    if (activated === null || !activated.body.equals(pointerBody)) {
      throw new Error('camera pointer failed post-write verification');
    }
    parsePointerBytes(activated.body);
    publicationVerified = true;
    log(`activated generation ${manifest.generation} in slot ${candidate}`);
    return {
      unchanged: false,
      generation: manifest.generation,
      slot: candidate,
      ...reconciled,
    };
  } finally {
    fence.close();
    if (lease !== undefined) {
      if (!candidateMutationMayHaveStarted || publicationVerified) {
        await releaseLease(client, bucket, lease, now, warn);
      } else {
        warn(
          `warning: camera publication may have mutated its candidate; retaining lease until ${lease.expiresAt}`,
        );
      }
    }
  }
}

function optionValue(argv, index, name) {
  const arg = argv[index];
  if (arg === name) {
    if (argv[index + 1] === undefined || argv[index + 1].startsWith('--')) {
      throw new Error(`${name} needs a path`);
    }
    return { value: argv[index + 1], consumed: 2 };
  }
  if (arg.startsWith(`${name}=`)) {
    const value = arg.slice(name.length + 1);
    if (value === '') throw new Error(`${name} needs a path`);
    return { value, consumed: 1 };
  }
  return null;
}

export function parseArguments(argv) {
  let dry = false;
  let bootstrap = false;
  let archive = DEFAULT_ARCHIVE;
  let stateFile = DEFAULT_STATE_FILE;
  const seen = new Set();
  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    if (arg === '--dry') {
      if (seen.has('--dry')) throw new Error('--dry may be passed only once');
      seen.add('--dry');
      dry = true;
      index += 1;
      continue;
    }
    if (arg === '--bootstrap') {
      if (seen.has('--bootstrap')) throw new Error('--bootstrap may be passed only once');
      seen.add('--bootstrap');
      bootstrap = true;
      index += 1;
      continue;
    }
    const state = optionValue(argv, index, '--state-file');
    if (state !== null) {
      if (seen.has('--state-file')) throw new Error('--state-file may be passed only once');
      seen.add('--state-file');
      stateFile = resolve(state.value);
      index += state.consumed;
      continue;
    }
    const target = optionValue(argv, index, '--target');
    if (target !== null) {
      if (seen.has('--target')) throw new Error('--target may be passed only once');
      seen.add('--target');
      archive = resolve(target.value);
      index += target.consumed;
      continue;
    }
    throw new Error(`unknown publish-cameras argument: ${arg}`);
  }
  return { dry, bootstrap, archive, stateFile };
}

export async function main(argv) {
  const options = parseArguments(argv);
  if (options.dry) {
    const local = await readLocalGeneration(options.archive, options.stateFile, {
      requireLicenceUrl: true,
    });
    const manifest = createManifest({
      createdAt: new Date().toISOString(),
      replication: local.replication,
      archive: local.archive,
      files: local.files,
    });
    process.stdout.write(
      `DRY -- ${String(local.archive.tiles)} tiles / ${String(local.archive.cameras)} cameras; ` +
        `generation ${manifest.generation}; nothing uploaded\n`,
    );
    return;
  }

  const bucket = required('R2_CAMERA_BUCKET');
  const account = process.env['R2_ACCOUNT_ID']?.trim() || required('CLOUDFLARE_ACCOUNT_ID');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: await s3Credentials(),
  });
  await publishGeneration({
    client,
    bucket,
    archive: options.archive,
    stateFile: options.stateFile,
    bootstrap: options.bootstrap,
    accountId: account,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
