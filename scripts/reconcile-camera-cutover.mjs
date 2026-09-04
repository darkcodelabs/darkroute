#!/usr/bin/env node

/**
 * Add truthful one-time removal records for predecessor cameras which the new
 * strict baseline cannot retain.
 *
 * This never edits its inputs. Each uncovered predecessor id is read from the
 * official OSM multi-fetch API, rejected if it is still qualifying inside the
 * pinned US/DC/PR geometry, and otherwise recorded at its exact current OSM
 * version with a replication observation fence. Proposal and adapter later
 * re-fetch the current node and require that exact version before trusting the
 * result; a later edit therefore invalidates the staged reconciliation.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadCountiesBytes } from './counties.mjs';
import {
  PREDECESSOR_TOMBSTONES_PATH,
  predecessorIdsMissingFromLiveSet,
  validatePredecessorEvidence,
} from './camera-predecessor.mjs';
import { readValidatedCapture } from './propose-deflock-source-review.mjs';
import {
  assertTombstoneOnlyTarget,
  readTombstoneLedger,
  transformCapturedCollection,
} from './fetch-cameras-deflock.mjs';
import {
  ATTRIBUTION,
  DEFAULT_COUNTY_GEOFENCE,
  LICENCE,
  LICENCE_URL,
  normaliseCoordinate,
  releaseGeofenceIdentity,
  releaseTombstoneIdentity,
  validateReleaseTombstoneLedger,
} from './fetch-cameras.mjs';
import {
  verifyCutoverReconciliation,
  verifyTombstoneLedgerAncestry,
} from './migrate-camera-tombstone-ledger.mjs';
import { currentSequence, qualifies } from './sync-cameras.mjs';

const OSM_API_ROOT = 'https://api.openstreetmap.org/api/0.6';
const USER_AGENT = 'DarkRoute-camera-cutover/0.1 (+https://darkroute.ai; contact cory@darkcode.ai)';

function rejectSymlinkComponents(path) {
  let component = resolve(path);
  while (component !== parse(component).root) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`camera cutover path has a symlink component: ${component}`);
    }
    component = dirname(component);
  }
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

export function parseCutoverArgs(argv) {
  const parsed = {
    captureDir: null,
    cameraTarget: null,
    predecessor: null,
    out: null,
  };
  const options = new Map([
    ['--capture-dir', 'captureDir'],
    ['--camera-target', 'cameraTarget'],
    ['--predecessor', 'predecessor'],
    ['--out', 'out'],
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
    if (!found) throw new Error(`unknown camera cutover argument: ${argv[index]}`);
  }
  for (const [name, key] of options) {
    if (parsed[key] === null) throw new Error(`${name} is required`);
  }
  return parsed;
}

function currentFetchBatches(ids) {
  const batches = [];
  let current = [];
  for (const id of ids) {
    const value = id.slice(4);
    const candidate = [...current, value];
    if (`${OSM_API_ROOT}/nodes.json?nodes=${candidate.join(',')}`.length > 7_000) {
      batches.push(current);
      current = [value];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function fetchCurrentNodes(ids, fetchImpl = fetch) {
  const expected = new Set(ids);
  const nodes = new Map();
  for (const batch of currentFetchBatches(ids)) {
    const url = `${OSM_API_ROOT}/nodes.json?nodes=${batch.join(',')}`;
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
    if (response.url !== url) {
      throw new Error(`${url}: resolved to an unreviewed URL ${String(response.url)}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error(`${url}: OSM node response is not JSON`);
    }
    if (!Array.isArray(body?.elements)) throw new Error(`${url}: OSM response has no elements`);
    for (const node of body.elements) {
      const id = `osm:${String(node?.id)}`;
      if (
        node?.type !== 'node' ||
        !expected.has(id) ||
        nodes.has(id) ||
        !Number.isSafeInteger(node.version) ||
        node.version < 1 ||
        Number.isNaN(Date.parse(node.timestamp))
      ) {
        throw new Error(`${url}: OSM response has an invalid, unexpected, or duplicate node`);
      }
      nodes.set(id, node);
    }
  }
  if (nodes.size !== expected.size) {
    const missing = [...expected].find((id) => !nodes.has(id));
    throw new Error(`official OSM API omitted predecessor node ${String(missing)}`);
  }
  return nodes;
}

export async function buildCutoverLedger({
  capture,
  tombstoneLedger,
  predecessor,
  predecessorTombstoneBytes,
  geofenceBytes,
  fetchImpl = fetch,
  now = () => new Date(),
  transformCollection = transformCapturedCollection,
  loadTombstoneSequence,
}) {
  const evidence = validatePredecessorEvidence(predecessor);
  releaseGeofenceIdentity(geofenceBytes);
  const countyIndex = loadCountiesBytes(geofenceBytes);
  await verifyTombstoneLedgerAncestry({
    predecessor: evidence,
    sourceBytes: predecessorTombstoneBytes,
    migratedBytes: tombstoneLedger.bytes,
    migratedLedger: tombstoneLedger,
    countyIndex,
    ...(loadTombstoneSequence === undefined ? {} : { loadSequence: loadTombstoneSequence }),
  });
  const { cameras } = transformCollection(
    capture.collection,
    tombstoneLedger.tombstones,
    countyIndex,
  );
  const baselineLiveIds = cameras.map((camera) => camera.id);
  const uncovered = predecessorIdsMissingFromLiveSet(evidence, baselineLiveIds);
  if (uncovered.length === 0) {
    const ledger = {
      attribution: tombstoneLedger.attribution,
      licence: tombstoneLedger.licence,
      licenceUrl: tombstoneLedger.licenceUrl,
      generatedAt: tombstoneLedger.generatedAt,
      upstream: tombstoneLedger.upstream,
      tombstones: tombstoneLedger.tombstones,
    };
    validateReleaseTombstoneLedger(ledger, 'unchanged release tombstone ledger');
    const bytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
    await verifyCutoverReconciliation({
      predecessor: evidence,
      sourceBytes: predecessorTombstoneBytes,
      migratedBytes: bytes,
      migratedLedger: ledger,
      baselineLiveIds,
      countyIndex,
      fetchImpl,
    });
    return {
      ledger,
      bytes,
      identity: releaseTombstoneIdentity(bytes, ledger),
      entries: [],
      after: null,
    };
  }

  const before = await currentSequence(fetchImpl);
  const nodes = await fetchCurrentNodes(uncovered, fetchImpl);
  const after = await currentSequence(fetchImpl);
  if (after.seq < before.seq || Date.parse(after.timestamp) < Date.parse(before.timestamp)) {
    throw new Error('official replication head moved backwards during cutover reconciliation');
  }
  const entries = [];
  for (const id of uncovered) {
    const node = nodes.get(id);
    if (Date.parse(node.timestamp) > Date.parse(after.timestamp)) {
      throw new Error(
        `official hourly replication has not reached current node ${id}; rerun after it catches up`,
      );
    }
    if (node.visible !== false) {
      if (
        !Number.isFinite(node.lat) ||
        node.lat < -90 ||
        node.lat > 90 ||
        !Number.isFinite(node.lon) ||
        node.lon < -180 ||
        node.lon > 180 ||
        typeof node.tags !== 'object' ||
        node.tags === null ||
        Array.isArray(node.tags)
      ) {
        throw new Error(`official OSM node ${id} has invalid geometry or tags`);
      }
      if (
        qualifies(node.tags) &&
        countyIndex.lookup(normaliseCoordinate(node.lat), normaliseCoordinate(node.lon)) !== null
      ) {
        throw new Error(
          `${id} is still a qualifying in-scope camera; the source capture missed it`,
        );
      }
    }
    entries.push({
      id,
      reason: 'cutover_reconciliation',
      seq: after.seq,
      osmVersion: node.version,
    });
  }

  const replacementIds = new Set(entries.map((entry) => entry.id));
  const ledger = {
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    generatedAt: now().toISOString(),
    upstream: after.timestamp,
    tombstones: [
      ...tombstoneLedger.tombstones.filter((entry) => !replacementIds.has(entry.id)),
      ...entries,
    ].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  };
  validateReleaseTombstoneLedger(ledger, 'reconciled release tombstone ledger');
  const bytes = Buffer.from(`${JSON.stringify(ledger)}\n`);
  await verifyCutoverReconciliation({
    predecessor: evidence,
    sourceBytes: predecessorTombstoneBytes,
    migratedBytes: bytes,
    migratedLedger: ledger,
    baselineLiveIds,
    countyIndex,
    fetchImpl,
  });
  return { ledger, bytes, identity: releaseTombstoneIdentity(bytes, ledger), entries, after };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCutoverArgs(argv);
  const predecessorPath = resolve(options.predecessor);
  const cameraTarget = resolve(options.cameraTarget);
  const out = resolve(options.out);
  for (const path of [predecessorPath, cameraTarget, dirname(out)]) {
    rejectSymlinkComponents(path);
  }
  if (existsSync(out)) throw new Error(`camera cutover output already exists: ${out}`);
  assertTombstoneOnlyTarget(cameraTarget);
  const tombstoneLedger = readTombstoneLedger(cameraTarget);
  const predecessor = validatePredecessorEvidence(
    JSON.parse(readFileSync(predecessorPath, 'utf8')),
  );
  const predecessorTombstoneBytes =
    predecessor.source.mode === 'empty-r2'
      ? null
      : readFileSync(resolve(dirname(predecessorPath), basename(PREDECESSOR_TOMBSTONES_PATH)));
  const result = await buildCutoverLedger({
    capture: readValidatedCapture(options.captureDir),
    tombstoneLedger,
    predecessor,
    predecessorTombstoneBytes,
    geofenceBytes: readFileSync(DEFAULT_COUNTY_GEOFENCE),
  });
  await writeFile(out, result.bytes, { flag: 'wx' });
  process.stdout.write(
    result.after === null
      ? `wrote unchanged canonical tombstone ledger; sha256 ${result.identity.sha256}\n`
      : `wrote ${String(result.entries.length)} cutover reconciliation tombstones at ` +
          `seq ${String(result.after.seq)}; sha256 ${result.identity.sha256}\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
