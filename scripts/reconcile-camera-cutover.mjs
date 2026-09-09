#!/usr/bin/env node

/**
 * Add truthful one-time removal records for predecessor cameras which the new
 * strict baseline cannot retain.
 *
 * This never edits its inputs. Each uncovered predecessor id is read from the
 * official OSM multi-fetch API, rejected if it is still qualifying inside the
 * pinned US/DC/PR geometry, and otherwise recorded at its exact current OSM
 * version with a replication observation fence. Predecessor ids carry no
 * element type, so an id the node namespace has never held is re-asked of the
 * way namespace and judged there on the same two tests. Proposal and adapter later
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
  isWayCameraId,
  normaliseCoordinate,
  parseCameraId,
  releaseGeofenceIdentity,
  releaseTombstoneIdentity,
  validateReleaseTombstoneLedger,
} from './fetch-cameras.mjs';
import {
  fetchWayCentroid,
  officialElementTags,
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

const ELEMENT_NAMES = { node: 'nodes', way: 'ways' };

function currentFetchBatches(ids, plural) {
  const batches = [];
  let current = [];
  for (const id of ids) {
    // The element NUMBER, read out of the id. A way-namespaced id carries a
    // `w` that is ours and not OpenStreetMap's, and pasting it into a
    // multi-fetch URL would ask for an element that cannot exist.
    const value = String(parseCameraId(id).osmId);
    const candidate = [...current, value];
    if (`${OSM_API_ROOT}/${plural}.json?${plural}=${candidate.join(',')}`.length > 7_000) {
      batches.push(current);
      current = [value];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function fetchElementBatch(plural, batch, fetchImpl) {
  const url = `${OSM_API_ROOT}/${plural}.json?${plural}=${batch.join(',')}`;
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    redirect: 'error',
  });
  if (response.url !== undefined && response.url !== url) {
    throw new Error(`${url}: resolved to an unreviewed URL ${String(response.url)}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${url}: OSM ${plural} response is not JSON`);
  }
  if (!Array.isArray(body?.elements)) throw new Error(`${url}: OSM response has no elements`);
  return { url, elements: body.elements };
}

/**
 * Read the current elements of one namespace, reporting the ids that namespace
 * has never held rather than throwing on them.
 *
 * The multi-fetch endpoint answers 404 for the entire batch when a single
 * requested id was never that element type, and the 404 does not say which id
 * it objected to; bisecting the batch isolates it. A *deleted* element is not
 * absent -- it still comes back, with `visible: false` -- so this only reports
 * ids the namespace has genuinely never carried.
 */
async function fetchCurrentElements(kind, ids, fetchImpl = fetch) {
  const plural = ELEMENT_NAMES[kind];
  const expected = new Set(ids);
  // The wire carries element NUMBERS; our ids carry a namespace as well. Keep
  // the map both ways so a result is filed under the exact id that was asked
  // for -- `osm:w1516934727` must not come back filed as `osm:1516934727`.
  const requested = new Map(ids.map((id) => [String(parseCameraId(id).osmId), id]));
  const found = new Map();
  const absent = new Set();

  const collect = async (batch) => {
    const result = await fetchElementBatch(plural, batch, fetchImpl);
    if (result === null) {
      if (batch.length === 1) {
        absent.add(requested.get(batch[0]));
        return;
      }
      const middle = Math.floor(batch.length / 2);
      await collect(batch.slice(0, middle));
      await collect(batch.slice(middle));
      return;
    }
    for (const element of result.elements) {
      const id = requested.get(String(element?.id));
      if (
        element?.type !== kind ||
        id === undefined ||
        !expected.has(id) ||
        found.has(id) ||
        !Number.isSafeInteger(element.version) ||
        element.version < 1 ||
        Number.isNaN(Date.parse(element.timestamp))
      ) {
        throw new Error(
          `${result.url}: OSM response has an invalid, unexpected, or duplicate ${kind}`,
        );
      }
      found.set(id, element);
    }
  };

  for (const batch of currentFetchBatches(ids, plural)) {
    if (batch.length > 0) await collect(batch);
  }
  for (const id of expected) {
    if (!found.has(id) && !absent.has(id)) {
      throw new Error(`official OSM API omitted predecessor ${kind} ${String(id)}`);
    }
  }
  return { found, absent };
}

/**
 * Classify one predecessor id the node namespace has never held.
 *
 * A predecessor id is bare: `osm:1516934727` names an element but not an
 * element type, and OpenStreetMap numbers nodes and ways in two independent
 * namespaces. A node-only prover therefore cannot say anything at all about an
 * id that was mapped as a way -- it looks in the node namespace, finds nothing,
 * and the batch 404s. Writing the tombstone by hand instead was refused,
 * because asserting a removal nothing verified is faking the proof. So the way
 * namespace gets asked in its own terms, and only its answer is trusted.
 *
 * A way that is still a qualifying camera inside the pinned territory has not
 * been removed from OpenStreetMap; the strict node-only baseline simply cannot
 * carry it. Recording that as a removal would publish a deletion that never
 * happened, so it is refused here rather than written down.
 */
async function classifyWayNamespaceId({ id, ways, after, countyIndex, fetchImpl }) {
  const way = ways.get(id);
  if (way === undefined) {
    throw new Error(
      `${String(id)} is held by neither the node nor the way namespace of OpenStreetMap`,
    );
  }
  if (Date.parse(way.timestamp) > Date.parse(after.timestamp)) {
    throw new Error(
      `official hourly replication has not reached current way ${id}; rerun after it catches up`,
    );
  }
  if (way.visible !== false) {
    if (qualifies(officialElementTags(way, `official OSM way ${id}`))) {
      const centre = await fetchWayCentroid(id, fetchImpl);
      if (countyIndex.lookup(centre.lat, centre.lon) !== null) {
        throw new Error(
          `${id} is still a qualifying in-scope camera mapped as an OSM way; ` +
            'the node-only baseline cannot carry it and it is not removed',
        );
      }
    }
  }
  return { id, reason: 'osm_out_of_scope', seq: after.seq, osmVersion: way.version };
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
  /*
   * WHICH NAMESPACE EACH UNCOVERED ID BELONGS TO.
   *
   * Two kinds arrive here. An id from a predecessor published under the
   * namespaced scheme SAYS it is a way (`osm:w<id>`) and is never asked of the
   * node endpoint at all. A type-less id from an older predecessor says
   * nothing, so it is asked of the node namespace first and only re-asked of
   * the way namespace if the node namespace has never held it -- which the
   * bisect in `fetchCurrentElements` is what isolates.
   */
  const statedWays = uncovered.filter((id) => isWayCameraId(id));
  const untyped = uncovered.filter((id) => !isWayCameraId(id));
  const { found: nodes, absent } =
    untyped.length === 0
      ? { found: new Map(), absent: new Set() }
      : await fetchCurrentElements('node', untyped, fetchImpl);
  // Ids the node namespace has never held are not evidence of anything yet: a
  // node-only prover cannot speak about a way. Ask the way namespace for those
  // ids before deciding, so each one is answered by the API that actually
  // holds it instead of by a hand-written tombstone.
  const wayQueries = [...statedWays, ...absent];
  const ways =
    wayQueries.length === 0
      ? new Map()
      : (await fetchCurrentElements('way', wayQueries, fetchImpl)).found;
  const after = await currentSequence(fetchImpl);
  if (after.seq < before.seq || Date.parse(after.timestamp) < Date.parse(before.timestamp)) {
    throw new Error('official replication head moved backwards during cutover reconciliation');
  }
  const entries = [];
  for (const id of uncovered) {
    const node = nodes.get(id);
    if (node === undefined) {
      entries.push(await classifyWayNamespaceId({ id, ways, after, countyIndex, fetchImpl }));
      continue;
    }
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
        node.lon > 180
      ) {
        throw new Error(`official OSM node ${id} has invalid geometry`);
      }
      // An UNTAGGED node is the commonest shape here and it is an answer, not
      // a fault: a camera whose tags a mapper stripped is a bare geometry
      // vertex, which is precisely a removal this ledger records. See
      // `officialElementTags`.
      if (
        qualifies(officialElementTags(node, `official OSM node ${id}`)) &&
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
