#!/usr/bin/env node

/**
 * Capture the pinned DeFlock adaptive Overpass query as a first-party,
 * replay-auditable source artifact.
 *
 * The query topology and feature conversion derive from deflock-data commit
 * 8d156b24db7090e870af3f007b0caece9b3c0951 (MIT). DarkRoute adds a positive-
 * longitude Aleutian seed, the documented ALPR/ANPR predicate, retained response
 * bodies, and deterministic validation. See scripts/data/DEFLOCK-DATA-LICENSE.txt.
 *
 * Usage:
 *   node scripts/capture-deflock-source.mjs --out=/tmp/darkroute-source-capture
 */

import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { link, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';

import {
  CA_AREA_MIN_COUNT,
  CAPTURE_IMPLEMENTATION_PATHS,
  MX_AREA_MIN_COUNT,
  OVERPASS_ENDPOINTS,
  OVERPASS_USER_AGENT,
  RAW_DATASET_PATH,
  RESPONSE_BUNDLE_PATH,
  RESPONSE_LEDGER_PATH,
  SPLIT_THRESHOLD,
  TILE_CONCURRENCY,
  TILE_RETRIES,
  TILE_RETRY_DELAY_MS,
  MIN_TILE_SPAN,
  buildSeedTiles,
  assertDataBodyMatchesTile,
  canonicalTimestamp,
  captureSha256,
  countProbeIsConsistent,
  countQuery,
  dataQuery,
  finalizeCapture,
  requestBytes,
  retainedResponseBytes,
  selectedFeatures,
  splitTile,
  subtractionQuery,
  tileId,
  validateCaptureArtifacts,
} from './deflock-capture.mjs';

const TIMEOUT_MS = 55_000;
const ROOT = resolve(import.meta.dirname, '..');

export function captureImplementationFiles(root = ROOT) {
  return CAPTURE_IMPLEMENTATION_PATHS.map((path) => {
    const bytes = readFileSync(resolve(root, path));
    return {
      path,
      bytes: bytes.length,
      sha256: captureSha256(bytes),
    };
  });
}

export function parseCaptureArgs(argv) {
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let value;
    if (argument === '--out') {
      value = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--out=')) {
      value = argument.slice('--out='.length);
    } else {
      throw new Error(`unknown capture argument: ${argument}`);
    }
    if (out !== null) throw new Error('--out may be supplied only once');
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
      throw new Error('--out requires a non-empty path');
    }
    out = value;
  }
  if (out === null) throw new Error('--out is required');
  return { out };
}

function targetComponents(path) {
  const components = [];
  let current = resolve(path);
  const root = parse(current).root;
  while (true) {
    components.push(current);
    if (current === root) break;
    current = dirname(current);
  }
  return components.reverse();
}

function snapshotTargetComponents(path) {
  return targetComponents(path).map((component) => {
    if (!existsSync(component)) {
      throw new Error(`capture output component disappeared: ${component}`);
    }
    const stat = lstatSync(component);
    if (stat.isSymbolicLink()) {
      throw new Error(`capture output has a symlink component: ${component}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`capture output component is not a directory: ${component}`);
    }
    return Object.freeze({ path: component, device: stat.dev, inode: stat.ino });
  });
}

function rejectSymlinkComponents(path) {
  for (const component of targetComponents(path)) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`capture output has a symlink component: ${component}`);
    }
  }
}

async function revalidateCaptureTarget(prepared, expectedEntries) {
  if (
    typeof prepared !== 'object' ||
    prepared === null ||
    typeof prepared.path !== 'string' ||
    !Array.isArray(prepared.components)
  ) {
    throw new Error('capture output was not prepared before network access');
  }
  const paths = targetComponents(prepared.path);
  if (paths.length !== prepared.components.length) {
    throw new Error('capture output component snapshot is incomplete');
  }
  for (let index = 0; index < paths.length; index += 1) {
    const expected = prepared.components[index];
    const component = paths[index];
    if (expected?.path !== component || !existsSync(component)) {
      throw new Error(`capture output component changed: ${component}`);
    }
    const stat = lstatSync(component);
    if (stat.isSymbolicLink()) {
      throw new Error(`capture output has a symlink component: ${component}`);
    }
    if (!stat.isDirectory() || stat.dev !== expected.device || stat.ino !== expected.inode) {
      throw new Error(`capture output component changed: ${component}`);
    }
  }
  const actualEntries = (await readdir(prepared.path)).sort();
  const expectedSorted = [...expectedEntries].sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedSorted)) {
    throw new Error(`capture output changed after preparation: ${prepared.path}`);
  }
  return prepared.path;
}

export async function prepareCaptureTarget(path) {
  const target = resolve(path);
  const root = parse(target).root;
  if (target === root || target === resolve('.') || target === resolve(import.meta.dirname, '..')) {
    throw new Error(`unsafe capture output: ${target}`);
  }
  rejectSymlinkComponents(target);
  await mkdir(target, { recursive: true });
  rejectSymlinkComponents(target);
  if ((await readdir(target)).length !== 0) {
    throw new Error(`capture output must be empty: ${target}`);
  }
  return Object.freeze({
    path: target,
    components: Object.freeze(snapshotTargetComponents(target)),
  });
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function retry(operation) {
  let last;
  for (let attempt = 1; attempt <= TILE_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (attempt < TILE_RETRIES) await delay(TILE_RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw last;
}

export async function queryOverpassCandidate(
  id,
  role,
  query,
  fetchImpl = fetch,
  { excludeEndpoints = [] } = {},
) {
  const errors = [];
  const body = requestBytes(query);
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (excludeEndpoints.includes(endpoint)) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      if (response.url !== endpoint) {
        throw new Error(`response resolved to unapproved URL ${String(response.url)}`);
      }
      const responseBody = Buffer.from(await response.arrayBuffer());
      let parsed;
      try {
        parsed = JSON.parse(responseBody.toString('utf8'));
      } catch {
        throw new Error(`non-JSON response: ${responseBody.toString('utf8', 0, 200)}`);
      }
      if (typeof parsed.remark === 'string') throw new Error(`Overpass remark: ${parsed.remark}`);
      if (!Array.isArray(parsed.elements)) throw new Error('response has no elements array');
      canonicalTimestamp(parsed.osm3s?.timestamp_osm_base, `${id} osm_base`);
      const retained = retainedResponseBytes(parsed);
      const retainedParsed = JSON.parse(retained.toString('utf8'));
      return {
        id,
        role,
        query,
        endpoint,
        body: retained,
        parsed: retainedParsed,
        transportSha256: captureSha256(responseBody),
        transportBytes: responseBody.length,
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      errors.push(`${endpoint}: ${failure}`);
      process.stderr.write(`  ${id} ${endpoint} failed: ${failure}\n`);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${id}: all allowed Overpass endpoints failed: ${errors.join('; ')}`);
}

const accept = (responses, candidate) => {
  if (responses.has(candidate.id)) throw new Error(`accepted response id repeats: ${candidate.id}`);
  responses.set(candidate.id, {
    id: candidate.id,
    role: candidate.role,
    query: candidate.query,
    endpoint: candidate.endpoint,
    body: candidate.body,
    transportSha256: candidate.transportSha256,
    transportBytes: candidate.transportBytes,
  });
};

async function captureCount(tile, responses, fetchImpl) {
  const id = tileId(tile);
  return retry(async () => {
    const candidate = await queryOverpassCandidate(
      `count:${id}`,
      'count',
      countQuery(tile),
      fetchImpl,
    );
    if (candidate.parsed.elements.length !== 1) {
      throw new Error(`${id}: count response did not contain exactly one element`);
    }
    const count = Number(candidate.parsed.elements[0]?.tags?.total);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${id}: count response has no nonnegative integer total`);
    }
    accept(responses, candidate);
    return { count, responseId: candidate.id, endpoint: candidate.endpoint };
  });
}

async function captureZeroConfirmation(tile, countEndpoint, responses, fetchImpl) {
  const id = tileId(tile);
  return retry(async () => {
    const candidate = await queryOverpassCandidate(
      `zero:${id}`,
      'data',
      dataQuery(tile),
      fetchImpl,
      { excludeEndpoints: [countEndpoint] },
    );
    assertDataBodyMatchesTile(candidate.parsed, tile);
    const selected = selectedFeatures(candidate.parsed).size;
    if (selected !== 0) {
      throw new Error(`${id}: zero count contradicted by ${String(selected)} selected features`);
    }
    accept(responses, candidate);
    return candidate.id;
  });
}

export async function planCapture(seed, responses, fetchImpl = fetch) {
  const countNodes = [];
  const leaves = [];
  const queue = [...seed];
  while (queue.length > 0) {
    const batch = queue.splice(0, TILE_CONCURRENCY);
    const counts = await Promise.all(batch.map((tile) => captureCount(tile, responses, fetchImpl)));
    for (let index = 0; index < batch.length; index += 1) {
      const bbox = batch[index];
      const id = tileId(bbox);
      const { count, responseId, endpoint } = counts[index];
      const span = Math.min(bbox.n - bbox.s, bbox.e - bbox.w);
      if (count === 0) {
        const confirmationResponseId = await captureZeroConfirmation(
          bbox,
          endpoint,
          responses,
          fetchImpl,
        );
        countNodes.push({
          id,
          bbox,
          responseId,
          count,
          resolution: 'zero',
          children: [],
          confirmationResponseId,
        });
      } else if (count > SPLIT_THRESHOLD && span > MIN_TILE_SPAN) {
        const children = splitTile(bbox);
        countNodes.push({
          id,
          bbox,
          responseId,
          count,
          resolution: 'split',
          children: children.map(tileId),
          confirmationResponseId: null,
        });
        queue.push(...children);
      } else {
        countNodes.push({
          id,
          bbox,
          responseId,
          count,
          resolution: 'data',
          children: [],
          confirmationResponseId: null,
        });
        leaves.push({ id, bbox, countResponseId: responseId, probed: count });
      }
    }
    process.stdout.write(
      `planned ${String(countNodes.length)} count nodes; ${String(queue.length)} pending; ` +
        `${String(leaves.length)} leaves\n`,
    );
  }
  return { countNodes, leaves };
}

async function captureDataLeaf(leaf, countEndpoint, fetchImpl) {
  return retry(async () => {
    const candidate = await queryOverpassCandidate(
      `data:${leaf.id}`,
      'data',
      dataQuery(leaf.bbox),
      fetchImpl,
      { excludeEndpoints: [countEndpoint] },
    );
    assertDataBodyMatchesTile(candidate.parsed, leaf.bbox);
    const featureCount = selectedFeatures(candidate.parsed).size;
    if (!countProbeIsConsistent(leaf.probed, featureCount, leaf.bbox)) {
      throw new Error(
        `${leaf.id}: data response has ${String(featureCount)} features; ` +
          `probe promised ${String(leaf.probed)}`,
      );
    }
    return { candidate, featureCount };
  });
}

export async function captureDataLeaves(leaves, responses, fetchImpl = fetch) {
  const dataLeaves = [];
  const queue = [...leaves];
  while (queue.length > 0) {
    const batch = queue.splice(0, TILE_CONCURRENCY);
    const captured = await Promise.all(
      batch.map((leaf) => {
        const countEndpoint = responses.get(leaf.countResponseId)?.endpoint;
        if (!OVERPASS_ENDPOINTS.includes(countEndpoint)) {
          throw new Error(`${leaf.id}: count response has no allowed endpoint`);
        }
        return captureDataLeaf(leaf, countEndpoint, fetchImpl);
      }),
    );
    for (let index = 0; index < batch.length; index += 1) {
      const leaf = batch[index];
      const { candidate, featureCount } = captured[index];
      accept(responses, candidate);
      dataLeaves.push({
        ...leaf,
        dataResponseId: candidate.id,
        featureCount,
      });
    }
    process.stdout.write(
      `captured ${String(dataLeaves.length)}/${String(leaves.length)} accepted data leaves\n`,
    );
  }
  return dataLeaves;
}

async function captureSubtraction(iso, minimum, responses, fetchImpl) {
  const candidate = await retry(async () => {
    const response = await queryOverpassCandidate(
      `subtraction:${iso}`,
      'subtraction',
      subtractionQuery(iso),
      fetchImpl,
    );
    const featureCount = selectedFeatures(response.parsed).size;
    if (featureCount < minimum) {
      throw new Error(
        `${iso} subtraction has ${String(featureCount)} features; minimum ${String(minimum)}`,
      );
    }
    return { response, featureCount };
  });
  accept(responses, candidate.response);
  return {
    iso,
    responseId: candidate.response.id,
    featureCount: candidate.featureCount,
    minimum,
  };
}

export async function runCapture(fetchImpl = fetch) {
  const startedAt = new Date().toISOString();
  const captureId = randomUUID();
  // Snapshot before the first request. A capture must bind the code that began
  // the run, and it must fail rather than attest to files changed mid-capture.
  const implementationFiles = captureImplementationFiles();
  const responses = new Map();
  process.stdout.write(
    `capture ${captureId}\n` +
      `user-agent ${OVERPASS_USER_AGENT}\n` +
      `seed roots ${String(buildSeedTiles().length)} (including +longitude Aleutians)\n`,
  );
  const { countNodes, leaves } = await planCapture(buildSeedTiles(), responses, fetchImpl);
  const dataLeaves = await captureDataLeaves(leaves, responses, fetchImpl);
  const CA = await captureSubtraction('CA', CA_AREA_MIN_COUNT, responses, fetchImpl);
  const MX = await captureSubtraction('MX', MX_AREA_MIN_COUNT, responses, fetchImpl);
  if (JSON.stringify(captureImplementationFiles()) !== JSON.stringify(implementationFiles)) {
    throw new Error('capture implementation changed while the capture was running');
  }
  return finalizeCapture({
    captureId,
    startedAt,
    completedAt: new Date().toISOString(),
    countNodes,
    dataLeaves,
    subtractions: { CA, MX },
    responses,
    implementationFiles,
  });
}

const artifactName = (path) => basename(path);

export async function writeCapture(preparedTarget, capture, { beforeLink } = {}) {
  if (beforeLink !== undefined && typeof beforeLink !== 'function') {
    throw new Error('capture install hook must be a function');
  }
  const target = await revalidateCaptureTarget(preparedTarget, []);
  const summary = validateCaptureArtifacts(capture.ledger, {
    ledgerBytes: capture.ledgerBytes,
    responseBundle: capture.responseBundle,
    rawDataset: capture.rawGzip,
    implementationFiles: capture.implementationFiles,
  });
  const files = [
    [artifactName(RESPONSE_LEDGER_PATH), capture.ledgerBytes],
    [artifactName(RESPONSE_BUNDLE_PATH), capture.responseBundle],
    [artifactName(RAW_DATASET_PATH), capture.rawGzip],
  ];
  const receiptSummary = {
    schema: 'darkroute-deflock-capture-summary/v1',
    captureId: capture.ledger.captureId,
    capturedAt: capture.ledger.capture.completedAt,
    minimumOsmBase: summary.minimumOsmBase,
    sourceBuild: summary.rawDataset.decodedSha256.slice(0, 16),
    sourceFeatures: summary.rawDataset.featureCount,
    ledger: summary.ledgerIdentity,
    responseBundle: summary.responseBundle,
    rawDataset: summary.rawDataset,
    roleCounts: summary.roleCounts,
    endpoints: summary.endpoints,
  };
  files.push([
    'deflock-us-capture-summary.json',
    Buffer.from(`${JSON.stringify(receiptSummary, null, 2)}\n`),
  ]);
  const temporaryNames = new Set();
  const installedNames = new Set();
  for (const [name, bytes] of files) {
    await revalidateCaptureTarget(preparedTarget, [...temporaryNames, ...installedNames]);
    const temporaryName = `.${name}.${captureSha256(bytes).slice(0, 12)}.${randomUUID()}.tmp`;
    const temporary = join(target, temporaryName);
    await writeFile(temporary, bytes, { flag: 'wx' });
    temporaryNames.add(temporaryName);
  }
  await revalidateCaptureTarget(preparedTarget, [...temporaryNames]);
  for (const [name] of files) {
    const temporaryName = [...temporaryNames].find((entry) => entry.startsWith(`.${name}.`));
    if (temporaryName === undefined) throw new Error(`capture staging file is missing for ${name}`);
    await revalidateCaptureTarget(preparedTarget, [...temporaryNames, ...installedNames]);
    // A hard link is atomic and, unlike rename(), cannot replace a file which
    // appeared after the empty-directory preflight.
    if (beforeLink !== undefined) await beforeLink({ name, target });
    await link(join(target, temporaryName), join(target, name));
    installedNames.add(name);
    await revalidateCaptureTarget(preparedTarget, [...temporaryNames, ...installedNames]);
    await unlink(join(target, temporaryName));
    temporaryNames.delete(temporaryName);
  }
  await revalidateCaptureTarget(
    preparedTarget,
    files.map(([name]) => name),
  );
  return receiptSummary;
}

async function main() {
  const { out } = parseCaptureArgs(process.argv.slice(2));
  const target = await prepareCaptureTarget(out);
  const capture = await runCapture();
  const summary = await writeCapture(target, capture);
  process.stdout.write(
    `capture complete: ${String(summary.sourceFeatures)} features\n` +
      `minimum osm_base: ${summary.minimumOsmBase}\n` +
      `ledger: ${join(target.path, artifactName(RESPONSE_LEDGER_PATH))}\n` +
      `raw source sha256: ${summary.rawDataset.decodedSha256}\n`,
  );
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  await main();
}
