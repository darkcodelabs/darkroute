/**
 * Restore the exact current R2 camera generation and its bound sync state.
 *
 * The pointer is read once and pins an immutable manifest. Every object is
 * checked against the manifest's size, MD5, and SHA-256 before a deep archive
 * validation. The camera tree and explicit state file are then installed as
 * one rollback-capable transaction.
 *
 * USAGE
 *   node scripts/hydrate-cameras.mjs \
 *     --target=apps/pwa/public/cameras \
 *     --state-file=scripts/camera-sync-state.json
 */

import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

import {
  MAX_CONTROL_BYTES,
  MAX_FILES,
  MAX_MANIFEST_BYTES,
  MAX_OBJECT_BYTES,
  POINTER_KEY,
  canonicalJson,
  compareKeys,
  hydratedRuntimeState,
  jsonBytes,
  md5,
  parseManifestBytes,
  parsePointerBytes,
  s3Credentials,
  sha256,
  slotDataPrefix,
  slotManifestKey,
  validateArchiveBodies,
} from './camera-generation.mjs';

export const DOWNLOAD_CONCURRENCY = 8;
const SIMPLE_ETAG = /^"?([a-f\d]{32})"?$/i;

export function cleanEtag(etag, key) {
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

async function responseBytes(body, key, maximum) {
  if (body === undefined || body === null) throw new Error(`R2 returned no body for ${key}`);
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maximum) throw new Error(`R2 object ${key} is too large`);
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

export async function getObject(client, bucket, key, { ifMatch, maximum } = {}) {
  let response;
  try {
    response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, ...(ifMatch ? { IfMatch: ifMatch } : {}) }),
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const limit = maximum ?? MAX_OBJECT_BYTES;
  if (
    Number.isSafeInteger(response.ContentLength) &&
    (response.ContentLength < 1 || response.ContentLength > limit)
  ) {
    throw new Error(`R2 object ${key} has an invalid size`);
  }
  const body = await responseBytes(response.Body, key, limit);
  const etag = cleanEtag(response.ETag, key);
  if (md5(body) !== etag) throw new Error(`R2 object ${key} failed its response ETag check`);
  return { body, etag, quotedEtag: response.ETag };
}

export async function listPrefix(client, bucket, prefix) {
  const objects = [];
  const continuationTokens = new Set();
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const entry of page.Contents ?? []) {
      if (typeof entry.Key !== 'string' || !entry.Key.startsWith(prefix)) {
        throw new Error(`R2 returned an object outside requested prefix ${prefix}`);
      }
      objects.push(entry);
      if (objects.length > MAX_FILES) throw new Error('R2 camera generation has too many objects');
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
  return objects;
}

export function validateRemoteInventory(objects, manifest, prefix) {
  if (!Array.isArray(objects)) throw new Error('R2 camera inventory is not an array');
  if (objects.length !== manifest.files.length) {
    throw new Error('R2 camera inventory has extra or missing objects');
  }
  const expected = new Map(manifest.files.map((file) => [`${prefix}${file.key}`, file]));
  const seen = new Set();
  const validated = [];
  for (const entry of objects) {
    const file = expected.get(entry?.Key);
    if (file === undefined) throw new Error(`R2 camera inventory has unexpected key ${entry?.Key}`);
    if (seen.has(entry.Key)) throw new Error(`R2 camera inventory repeats ${entry.Key}`);
    seen.add(entry.Key);
    if (!Number.isSafeInteger(entry.Size) || entry.Size !== file.bytes) {
      throw new Error(`R2 camera inventory has wrong size for ${file.key}`);
    }
    const etag = cleanEtag(entry.ETag, entry.Key);
    if (etag !== file.md5) throw new Error(`R2 camera inventory has wrong MD5 for ${file.key}`);
    validated.push({
      key: file.key,
      remoteKey: entry.Key,
      bytes: file.bytes,
      md5: file.md5,
      sha256: file.sha256,
      quotedEtag: entry.ETag,
    });
  }
  for (const key of expected.keys()) {
    if (!seen.has(key)) throw new Error(`R2 camera inventory is missing ${key}`);
  }
  return validated.sort((a, b) => compareKeys(a.key, b.key));
}

function inventoryFingerprint(entries) {
  return entries
    .map(({ key, bytes, md5: digest, sha256: strong }) => `${key}\0${bytes}\0${digest}\0${strong}`)
    .join('\n');
}

export async function runBounded(items, limit, operation) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('concurrency must be positive');
  let cursor = 0;
  let failure;
  async function worker() {
    while (failure === undefined && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await operation(items[index], index);
      } catch (error) {
        failure ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, worker));
  if (failure !== undefined) throw failure;
}

function pathComponents(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = [root];
  let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    components.push(current);
  }
  return components;
}

function entryIdentity(path, info) {
  return Object.freeze({
    path,
    device: info.dev,
    inode: info.ino,
    type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
  });
}

function sameIdentity(actual, expected) {
  return (
    actual.dev === expected.device &&
    actual.ino === expected.inode &&
    (actual.isDirectory() ? 'directory' : actual.isFile() ? 'file' : 'other') === expected.type
  );
}

async function snapshotPath(path, finalType, lstatFn = lstat) {
  const components = [];
  const paths = pathComponents(path);
  for (let index = 0; index < paths.length; index += 1) {
    const component = paths[index];
    let info;
    try {
      info = await lstatFn(component);
    } catch (error) {
      if (error?.code === 'ENOENT' && index === paths.length - 1) {
        components.push(Object.freeze({ path: component, exists: false }));
        continue;
      }
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`hydration destination contains a symlink component: ${component}`);
    }
    const isFinal = index === paths.length - 1;
    if (!isFinal && !info.isDirectory()) {
      throw new Error(`hydration destination component is not a directory: ${component}`);
    }
    if (
      isFinal &&
      ((finalType === 'directory' && !info.isDirectory()) ||
        (finalType === 'file' && !info.isFile()))
    ) {
      throw new Error(
        finalType === 'directory'
          ? `camera target must be a real directory: ${component}`
          : `camera state target must be a real file: ${component}`,
      );
    }
    components.push(Object.freeze({ ...entryIdentity(component, info), exists: true }));
  }
  return Object.freeze(components);
}

async function snapshotTree(
  root,
  { lstatFn = lstat, readdirFn = readdir, readFileFn = readFile } = {},
) {
  const entries = [];
  async function visit(path, relative) {
    const before = await lstatFn(path);
    if (before.isSymbolicLink()) {
      throw new Error(`hydration archive contains a symlink: ${path}`);
    }
    if (before.isDirectory()) {
      const names = (await readdirFn(path)).sort();
      entries.push({
        path: relative,
        type: 'directory',
        device: before.dev,
        inode: before.ino,
        children: names,
      });
      for (const name of names)
        await visit(join(path, name), relative === '' ? name : `${relative}/${name}`);
      const after = await lstatFn(path);
      if (!sameIdentity(after, entryIdentity(path, before))) {
        throw new Error(`hydration archive changed while it was inspected: ${path}`);
      }
      return;
    }
    if (!before.isFile()) throw new Error(`hydration archive has an unsupported entry: ${path}`);
    const body = await readFileFn(path);
    const after = await lstatFn(path);
    if (!sameIdentity(after, entryIdentity(path, before))) {
      throw new Error(`hydration archive changed while it was inspected: ${path}`);
    }
    entries.push({
      path: relative,
      type: 'file',
      device: before.dev,
      inode: before.ino,
      bytes: body.byteLength,
      sha256: sha256(body),
    });
  }
  await visit(root, '');
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

function treeContents(snapshot) {
  return snapshot.map(({ path, type, children, bytes, sha256: digest }) => ({
    path,
    type,
    ...(type === 'directory' ? { children } : { bytes, sha256: digest }),
  }));
}

async function snapshotState(path, components, readFileFn = readFile) {
  if (components.at(-1)?.exists === false) return null;
  const body = await readFileFn(path);
  if (body.byteLength > MAX_CONTROL_BYTES) throw new Error('camera state target is too large');
  return Object.freeze({ bytes: body.byteLength, sha256: sha256(body) });
}

async function assertComponentSnapshot(snapshot, lstatFn = lstat) {
  for (const expected of snapshot) {
    let actual;
    try {
      actual = await lstatFn(expected.path);
    } catch (error) {
      if (error?.code === 'ENOENT' && expected.exists === false) continue;
      throw new Error(`hydration destination component changed: ${expected.path}`, {
        cause: error,
      });
    }
    if (expected.exists === false) {
      throw new Error(`hydration destination gained an unexpected entry: ${expected.path}`);
    }
    if (actual.isSymbolicLink()) {
      throw new Error(`hydration destination contains a symlink component: ${expected.path}`);
    }
    if (!sameIdentity(actual, expected)) {
      throw new Error(`hydration destination component changed: ${expected.path}`);
    }
  }
}

async function assertPreparedTargets(
  prepared,
  { lstatFn = lstat, readdirFn = readdir, readFileFn = readFile } = {},
) {
  if (
    typeof prepared !== 'object' ||
    prepared === null ||
    !Array.isArray(prepared.targetComponents) ||
    !Array.isArray(prepared.stateComponents)
  ) {
    throw new Error('hydration destinations were not prepared before network access');
  }
  await assertComponentSnapshot(prepared.targetComponents, lstatFn);
  await assertComponentSnapshot(prepared.stateComponents, lstatFn);
  if (prepared.targetTree !== null) {
    const current = await snapshotTree(prepared.target, { lstatFn, readdirFn, readFileFn });
    if (canonicalJson(current) !== canonicalJson(prepared.targetTree)) {
      throw new Error(`camera target changed after preparation: ${prepared.target}`);
    }
  }
  const currentState = await snapshotState(
    prepared.stateFile,
    prepared.stateComponents,
    readFileFn,
  );
  if (canonicalJson(currentState) !== canonicalJson(prepared.state)) {
    throw new Error(`camera state target changed after preparation: ${prepared.stateFile}`);
  }
}

/** Reject an existing symlink at any level of a destination path. */
export async function rejectSymlinkPathComponents(rawPath, lstatFn = lstat) {
  const absolute = resolve(rawPath);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    let info;
    try {
      info = await lstatFn(current);
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new Error(`hydration destination contains a symlink component: ${current}`);
    }
  }
  return absolute;
}

/** Require a narrow, non-symlink destination. */
export async function validateTargets(rawTarget, rawStateFile) {
  if (typeof rawTarget !== 'string' || rawTarget.trim() === '') {
    throw new Error('pass an explicit --target=<path-to-cameras-directory>');
  }
  if (typeof rawStateFile !== 'string' || rawStateFile.trim() === '') {
    throw new Error('pass an explicit --state-file=<path-to-camera-sync-state.json>');
  }
  const target = resolve(rawTarget);
  const stateFile = resolve(rawStateFile);
  if (basename(target) !== 'cameras' || dirname(target) === target) {
    throw new Error(`refusing camera hydration target: ${target}`);
  }
  if (stateFile === target || stateFile.startsWith(`${target}${sep}`)) {
    throw new Error('camera sync state file cannot be inside the hydrated archive');
  }

  await rejectSymlinkPathComponents(target);
  await rejectSymlinkPathComponents(stateFile);
  for (const parent of [dirname(target), dirname(stateFile)]) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`hydration parent must be a real directory: ${parent}`);
    }
  }
  const targetComponents = await snapshotPath(target, 'directory');
  const stateComponents = await snapshotPath(stateFile, 'file');
  const prepared = Object.freeze({
    target,
    stateFile,
    targetComponents,
    stateComponents,
    targetTree: targetComponents.at(-1)?.exists === false ? null : await snapshotTree(target),
    state: await snapshotState(stateFile, stateComponents),
  });
  await assertPreparedTargets(prepared);
  return prepared;
}

async function removeAfterSuccess(path, options, warn, rmFn = rm) {
  try {
    await rmFn(path, options);
  } catch (error) {
    warn(`warning: hydration installed but could not remove ${path}: ${error.message}`);
  }
}

async function hardLinkTree(
  source,
  destination,
  expected,
  {
    linkFn = link,
    lstatFn = lstat,
    mkdirFn = mkdir,
    onRootCreated = () => {},
    readdirFn = readdir,
    readFileFn = readFile,
  } = {},
) {
  await mkdirFn(destination);
  const rootInfo = await lstatFn(destination);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`hydration install root is not a real directory: ${destination}`);
  }
  onRootCreated(entryIdentity(destination, rootInfo));
  for (const entry of expected) {
    if (entry.path === '') continue;
    const sourcePath = join(source, ...entry.path.split('/'));
    const destinationPath = join(destination, ...entry.path.split('/'));
    if (entry.type === 'directory') await mkdirFn(destinationPath);
    else await linkFn(sourcePath, destinationPath);
  }
  const installed = await snapshotTree(destination, { lstatFn, readdirFn, readFileFn });
  if (canonicalJson(treeContents(installed)) !== canonicalJson(treeContents(expected))) {
    throw new Error(`hydration installed an unexpected archive tree: ${destination}`);
  }
}

async function assertPreparedState(prepared, { lstatFn = lstat, readFileFn = readFile } = {}) {
  await assertComponentSnapshot(prepared.stateComponents, lstatFn);
  const current = await snapshotState(prepared.stateFile, prepared.stateComponents, readFileFn);
  if (canonicalJson(current) !== canonicalJson(prepared.state)) {
    throw new Error(`camera state target changed after preparation: ${prepared.stateFile}`);
  }
}

async function assertAbsent(path, lstatFn = lstat) {
  if ((await infoOrNullWith(path, lstatFn)) !== null) {
    throw new Error(`hydration destination gained an unexpected entry: ${path}`);
  }
}

async function infoOrNullWith(path, lstatFn) {
  try {
    return await lstatFn(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function unlinkIfIdentity(path, expected, { lstatFn = lstat, unlinkFn = unlink } = {}) {
  const actual = await infoOrNullWith(path, lstatFn);
  if (actual === null) return;
  if (!sameIdentity(actual, expected)) {
    throw new Error(`refusing to remove a raced hydration entry: ${path}`);
  }
  await unlinkFn(path);
}

/** Install archive and state together; restore both old values on any failure. */
export async function installHydratedSnapshot(
  staged,
  target,
  stateFile,
  stateBody,
  {
    beforeArchiveInstall,
    beforeStateInstall,
    beforeTransaction,
    linkFn = link,
    lstatFn = lstat,
    mkdirFn = mkdir,
    prepared,
    readdirFn = readdir,
    readFileFn = readFile,
    renameFn = rename,
    rmFn = rm,
    unlinkFn = unlink,
    writeFileFn = writeFile,
    warn = (message) => process.stderr.write(`${message}\n`),
  } = {},
) {
  const destinations = prepared ?? (await validateTargets(target, stateFile));
  if (destinations.target !== resolve(target) || destinations.stateFile !== resolve(stateFile)) {
    throw new Error('hydration destination snapshot does not match the requested paths');
  }
  await assertPreparedTargets(destinations, { lstatFn, readdirFn, readFileFn });
  const stagedComponents = await snapshotPath(staged, 'directory', lstatFn);
  const stagedSnapshot = await snapshotTree(staged, { lstatFn, readdirFn, readFileFn });
  const nonce = randomUUID();
  const transaction = await mkdtemp(join(dirname(target), `.${basename(target)}-transaction-`));
  const transactionInfo = entryIdentity(transaction, await lstatFn(transaction));
  const targetBackup = join(transaction, 'original-cameras');
  const failedTarget = join(transaction, 'failed-new-cameras');
  const stateBackup = join(dirname(stateFile), `.${basename(stateFile)}-backup-${nonce}`);
  const stagedState = join(dirname(stateFile), `.${basename(stateFile)}-hydrate-${nonce}`);
  await writeFileFn(stagedState, stateBody, { flag: 'wx' });
  const stagedStateInfo = entryIdentity(stagedState, await lstatFn(stagedState));

  let targetBackedUp = false;
  let stateBackedUp = false;
  let installedTargetIdentity = null;
  let installedStateIdentity = null;
  try {
    if (beforeTransaction !== undefined) await beforeTransaction();
    // This is the last operation before the first backup rename. It checks the
    // root-to-destination device/inode chain, the original archive inventory,
    // and exact state bytes captured before any network access.
    await assertPreparedTargets(destinations, { lstatFn, readdirFn, readFileFn });
    await assertComponentSnapshot(stagedComponents, lstatFn);
    const stagedAgain = await snapshotTree(staged, { lstatFn, readdirFn, readFileFn });
    if (canonicalJson(stagedAgain) !== canonicalJson(stagedSnapshot)) {
      throw new Error(`hydration staging archive changed before installation: ${staged}`);
    }
    if (destinations.targetTree !== null) {
      await renameFn(target, targetBackup);
      targetBackedUp = true;
      const backedUp = await snapshotTree(targetBackup, { lstatFn, readdirFn, readFileFn });
      if (canonicalJson(backedUp) !== canonicalJson(destinations.targetTree)) {
        throw new Error('camera target changed during its backup rename');
      }
    }
    await assertPreparedState(destinations, { lstatFn, readFileFn });
    if (destinations.state !== null) {
      await linkFn(stateFile, stateBackup);
      stateBackedUp = true;
      await assertPreparedState(destinations, { lstatFn, readFileFn });
      await unlinkFn(stateFile);
    }
    if (beforeArchiveInstall !== undefined) await beforeArchiveInstall();
    await assertAbsent(target, lstatFn);
    await hardLinkTree(staged, target, stagedSnapshot, {
      linkFn,
      lstatFn,
      mkdirFn,
      onRootCreated: (identity) => {
        installedTargetIdentity = identity;
      },
      readdirFn,
      readFileFn,
    });
    if (beforeStateInstall !== undefined) await beforeStateInstall();
    await assertAbsent(stateFile, lstatFn);
    await linkFn(stagedState, stateFile);
    // The successful link installed this already-known inode. Record that
    // identity before inspecting the destination so a same-UID replacement in
    // the link-to-lstat window can never become rollback's deletion target.
    installedStateIdentity = stagedStateInfo;
    if (!sameIdentity(await lstatFn(stagedState), installedStateIdentity)) {
      throw new Error('hydrated state was not installed from the staged inode');
    }
    if (!sameIdentity(await lstatFn(stateFile), installedStateIdentity)) {
      throw new Error('hydrated state destination changed after installation');
    }
  } catch (error) {
    const rollbackErrors = [];
    async function rollback(operation) {
      try {
        await operation();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (installedStateIdentity !== null) {
      await rollback(() =>
        unlinkIfIdentity(stateFile, installedStateIdentity, { lstatFn, unlinkFn }),
      );
    }
    if (stateBackedUp) {
      await rollback(async () => {
        await assertAbsent(stateFile, lstatFn);
        await linkFn(stateBackup, stateFile);
        const restored = await readFileFn(stateFile);
        if (
          restored.byteLength !== destinations.state.bytes ||
          sha256(restored) !== destinations.state.sha256
        ) {
          throw new Error('camera state rollback did not restore the prepared bytes');
        }
      });
    }
    if (installedTargetIdentity !== null) {
      await rollback(async () => {
        const actual = await infoOrNullWith(target, lstatFn);
        if (actual === null) return;
        if (!sameIdentity(actual, installedTargetIdentity)) {
          throw new Error(`refusing to replace a raced camera target: ${target}`);
        }
        await assertAbsent(failedTarget, lstatFn);
        await renameFn(target, failedTarget);
      });
    }
    if (targetBackedUp) {
      await rollback(async () => {
        await assertAbsent(target, lstatFn);
        await hardLinkTree(targetBackup, target, destinations.targetTree, {
          linkFn,
          lstatFn,
          mkdirFn,
          readdirFn,
          readFileFn,
        });
      });
    }
    await rollback(() => unlinkIfIdentity(stagedState, stagedStateInfo, { lstatFn, unlinkFn }));
    warn(`warning: hydration recovery artifacts retained at ${transaction}`);
    if (stateBackedUp) warn(`warning: hydration state backup retained at ${stateBackup}`);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'camera archive/state install failed and rollback was incomplete',
      );
    }
    throw error;
  }

  await removeAfterSuccess(staged, { recursive: true, force: true }, warn, rmFn);
  await removeAfterSuccess(stagedState, { force: true }, warn, rmFn);
  if (targetBackedUp) {
    await removeAfterSuccess(targetBackup, { recursive: true, force: true }, warn, rmFn);
  }
  if (stateBackedUp) await removeAfterSuccess(stateBackup, { force: true }, warn, rmFn);
  const currentTransaction = await infoOrNullWith(transaction, lstatFn);
  if (currentTransaction !== null && sameIdentity(currentTransaction, transactionInfo)) {
    await removeAfterSuccess(transaction, { recursive: true, force: true }, warn, rmFn);
  } else if (currentTransaction !== null) {
    warn(`warning: hydration installed but transaction directory changed: ${transaction}`);
  }
}

async function readPinnedControl(client, bucket) {
  const pointerRemote = await getObject(client, bucket, POINTER_KEY, {
    maximum: MAX_CONTROL_BYTES,
  });
  if (pointerRemote === null) {
    throw new Error('camera generation pointer is absent; hydration has no canonical snapshot');
  }
  const pointer = parsePointerBytes(pointerRemote.body);
  const manifestKey = slotManifestKey(pointer.slot);
  const manifestRemote = await getObject(client, bucket, manifestKey, {
    maximum: MAX_MANIFEST_BYTES,
  });
  if (manifestRemote === null) throw new Error('camera pointer names a missing manifest');
  if (sha256(manifestRemote.body) !== pointer.manifestSha256) {
    throw new Error('camera manifest does not match the pinned pointer hash');
  }
  const manifest = parseManifestBytes(manifestRemote.body);
  if (manifest.generation !== pointer.generation) {
    throw new Error('camera manifest does not match the pinned pointer generation');
  }
  return { pointer, manifest, manifestBody: manifestRemote.body };
}

/** Hydration entry point, dependency-injectable for transport fault tests. */
export async function hydrateGeneration({
  client,
  bucket,
  target,
  stateFile,
  prepared,
  log = (message) => process.stdout.write(`${message}\n`),
  warn = (message) => process.stderr.write(`${message}\n`),
  validation = {},
}) {
  const destinations = prepared ?? (await validateTargets(target, stateFile));
  if (destinations.target !== resolve(target) || destinations.stateFile !== resolve(stateFile)) {
    throw new Error('hydration destination snapshot does not match the requested paths');
  }
  // The CLI takes this snapshot before token verification. Recheck it before
  // the first R2 read so a credential-fetch delay cannot move the destination
  // boundary that the final installation transaction will enforce again.
  await assertPreparedTargets(destinations);
  const staged = await mkdtemp(
    join(dirname(destinations.target), `.${basename(destinations.target)}-hydrate-`),
  );
  const stagedIdentity = entryIdentity(staged, await lstat(staged));
  let installed = false;
  try {
    const control = await readPinnedControl(client, bucket);
    const prefix = slotDataPrefix(control.pointer.slot);
    const listed = validateRemoteInventory(
      await listPrefix(client, bucket, prefix),
      control.manifest,
      prefix,
    );
    const listedFingerprint = inventoryFingerprint(listed);
    const bodies = new Array(listed.length);
    await runBounded(listed, DOWNLOAD_CONCURRENCY, async (entry, index) => {
      const response = await getObject(client, bucket, entry.remoteKey, {
        ifMatch: entry.quotedEtag,
        maximum: entry.bytes,
      });
      if (response === null) throw new Error(`camera object vanished: ${entry.key}`);
      if (
        response.body.byteLength !== entry.bytes ||
        response.etag !== entry.md5 ||
        sha256(response.body) !== entry.sha256
      ) {
        throw new Error(`camera object failed manifest verification: ${entry.key}`);
      }
      const destination = join(staged, entry.key);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, response.body, { flag: 'wx' });
      bodies[index] = { key: entry.key, body: response.body };
    });

    const measured = validateArchiveBodies(bodies, control.manifest.replication, validation);
    if (canonicalJson(measured) !== canonicalJson(control.manifest.archive)) {
      throw new Error('downloaded camera archive disagrees with its manifest summary');
    }

    const relisted = validateRemoteInventory(
      await listPrefix(client, bucket, prefix),
      control.manifest,
      prefix,
    );
    if (inventoryFingerprint(relisted) !== listedFingerprint) {
      throw new Error('camera generation changed while it was being hydrated');
    }
    const manifestAgain = await getObject(client, bucket, slotManifestKey(control.pointer.slot), {
      maximum: MAX_MANIFEST_BYTES,
    });
    if (
      manifestAgain === null ||
      sha256(manifestAgain.body) !== control.pointer.manifestSha256 ||
      !manifestAgain.body.equals(control.manifestBody)
    ) {
      throw new Error('camera manifest changed while it was being hydrated');
    }

    await installHydratedSnapshot(
      staged,
      destinations.target,
      destinations.stateFile,
      jsonBytes(hydratedRuntimeState(control.manifest.replication, control.pointer)),
      { prepared: destinations, warn },
    );
    installed = true;
    log(
      `hydrated generation ${control.manifest.generation}: ` +
        `${String(measured.tiles)} tiles / ${String(measured.cameras)} cameras`,
    );
    return { generation: control.manifest.generation, ...measured };
  } finally {
    if (!installed) {
      const current = await infoOrNullWith(staged, lstat);
      if (current !== null && sameIdentity(current, stagedIdentity)) {
        await rm(staged, { recursive: true, force: true });
      } else if (current !== null) {
        warn(`warning: refusing to remove a changed hydration staging tree: ${staged}`);
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
  let target;
  let stateFile;
  for (let index = 0; index < argv.length;) {
    const targetOption = optionValue(argv, index, '--target');
    if (targetOption !== null) {
      if (target !== undefined) throw new Error('--target may be passed only once');
      target = targetOption.value;
      index += targetOption.consumed;
      continue;
    }
    const stateOption = optionValue(argv, index, '--state-file');
    if (stateOption !== null) {
      if (stateFile !== undefined) throw new Error('--state-file may be passed only once');
      stateFile = stateOption.value;
      index += stateOption.consumed;
      continue;
    }
    throw new Error(`unknown hydrate-cameras argument: ${argv[index]}`);
  }
  if (target === undefined || stateFile === undefined) {
    throw new Error(
      'usage: node scripts/hydrate-cameras.mjs --target=<cameras> --state-file=<state.json>',
    );
  }
  return { target, stateFile };
}

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

export async function main(
  argv,
  {
    clientFactory = (configuration) => new S3Client(configuration),
    credentialsFactory = s3Credentials,
    environment = process.env,
    hydrate = hydrateGeneration,
    prepareTargets = validateTargets,
  } = {},
) {
  const options = parseArguments(argv);
  // Capture the complete destination identity before any credential helper can
  // perform network I/O. hydrateGeneration rechecks this exact object before
  // R2 access and the installer rechecks it immediately before mutation.
  const prepared = await prepareTargets(options.target, options.stateFile);
  const bucket = requiredEnvironment(environment, 'R2_CAMERA_BUCKET');
  const account =
    environment['R2_ACCOUNT_ID']?.trim() ||
    requiredEnvironment(environment, 'CLOUDFLARE_ACCOUNT_ID');
  const client = clientFactory({
    region: 'auto',
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: await credentialsFactory(),
  });
  await hydrate({ client, bucket, ...options, prepared });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
