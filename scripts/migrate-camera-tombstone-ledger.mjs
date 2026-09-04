#!/usr/bin/env node

/**
 * Produce one release-schema tombstone ledger from an immutable legacy input.
 *
 * The source file is never edited. Its bytes, SHA-256, and entry count must
 * match the deployment-bound predecessor evidence; every tombstone version is
 * then resolved or re-verified from the exact recorded hourly diff. The new
 * attributed ledger is canonical-sorted and written only to an explicit-new
 * output path.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { backfillTombstoneVersions } from './backfill-camera-tombstone-versions.mjs';
import { loadCountiesBytes } from './counties.mjs';
import { validatePredecessorEvidence } from './camera-predecessor.mjs';
import {
  ATTRIBUTION,
  DEFAULT_COUNTY_GEOFENCE,
  LICENCE,
  LICENCE_URL,
  canonicalSourceTimestamp,
  normaliseCoordinate,
  releaseGeofenceIdentity,
  releaseTombstoneIdentity,
  validateReleaseTombstoneLedger,
} from './fetch-cameras.mjs';
import { forEachElement, qualifies, sequenceDiffUrl, sequenceState } from './sync-cameras.mjs';

const sha256 = (body) => createHash('sha256').update(body).digest('hex');

const exactKeys = (value, keys) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function rejectSymlinkComponents(path) {
  let component = resolve(path);
  while (component !== parse(component).root) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`tombstone migration path has a symlink component: ${component}`);
    }
    component = dirname(component);
  }
}

export function parseLegacyTombstoneBytes(sourceBytes, expectedSha256) {
  const bytes = Buffer.from(sourceBytes);
  if (!/^[0-9a-f]{64}$/.test(expectedSha256 ?? '') || sha256(bytes) !== expectedSha256) {
    throw new Error('legacy tombstone bytes do not match --source-sha256');
  }
  let source;
  try {
    source = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('legacy tombstone source is not JSON');
  }
  const plain = exactKeys(source, ['generatedAt', 'upstream', 'tombstones']);
  const attributed = exactKeys(source, [
    'attribution',
    'licence',
    'generatedAt',
    'upstream',
    'tombstones',
  ]);
  const attributedWithUri = exactKeys(source, [
    'attribution',
    'licence',
    'licenceUrl',
    'generatedAt',
    'upstream',
    'tombstones',
  ]);
  const generatedAt = canonicalSourceTimestamp(source.generatedAt, 'legacy tombstone generatedAt');
  const upstream = canonicalSourceTimestamp(source.upstream, 'legacy tombstone upstream');
  if (
    (!plain && !attributed && !attributedWithUri) ||
    ((attributed || attributedWithUri) &&
      (source.attribution !== ATTRIBUTION || source.licence !== LICENCE)) ||
    (attributedWithUri && source.licenceUrl !== LICENCE_URL) ||
    !Array.isArray(source.tombstones)
  ) {
    throw new Error('legacy tombstone source has an invalid schema or provenance');
  }
  const ids = new Set();
  for (const entry of source.tombstones) {
    const allowed = Object.hasOwn(entry ?? {}, 'osmVersion')
      ? ['id', 'reason', 'seq', 'osmVersion']
      : ['id', 'reason', 'seq'];
    if (
      !exactKeys(entry, allowed) ||
      !/^osm:[1-9]\d*$/.test(entry.id ?? '') ||
      !['osm_delete', 'osm_untag', 'osm_out_of_scope'].includes(entry.reason) ||
      !Number.isSafeInteger(entry.seq) ||
      entry.seq < 0 ||
      (Object.hasOwn(entry, 'osmVersion') &&
        (!Number.isSafeInteger(entry.osmVersion) || entry.osmVersion < 1)) ||
      ids.has(entry.id)
    ) {
      throw new Error('legacy tombstone source has an invalid or duplicate entry');
    }
    ids.add(entry.id);
  }
  return { ...source, generatedAt, upstream };
}

function assertCapturedSourceIdentity(sourceBytes, predecessor) {
  const evidence = validatePredecessorEvidence(predecessor);
  const expected = evidence.source.tombstones;
  if (expected === null) {
    throw new Error('empty-R2 predecessor has no tombstone source to migrate');
  }
  const bytes = Buffer.from(sourceBytes);
  if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new Error('tombstone input does not match the captured predecessor bytes');
  }
  return { evidence, expected, bytes };
}

export function parseCapturedLegacyTombstoneBytes(sourceBytes, predecessor) {
  const { evidence, expected, bytes } = assertCapturedSourceIdentity(sourceBytes, predecessor);
  if (
    evidence.source.mode !== 'legacy-flat-root' &&
    !(evidence.source.mode === 'generation' && evidence.source.versionsKnown === false)
  ) {
    throw new Error('only a legacy or unversioned generation predecessor needs migration');
  }
  const source = parseLegacyTombstoneBytes(bytes, expected.sha256);
  if (source.tombstones.length !== expected.count) {
    throw new Error('captured predecessor tombstone count does not match its evidence');
  }
  return source;
}

function preservesCapturedTombstone(source, migrated) {
  return (
    source !== undefined &&
    migrated !== undefined &&
    migrated.id === source.id &&
    migrated.reason === source.reason &&
    migrated.seq === source.seq &&
    (!Object.hasOwn(source, 'osmVersion') || migrated.osmVersion === source.osmVersion)
  );
}

function isProvedCutoverReplacement(entry, predecessorLive) {
  return entry?.reason === 'cutover_reconciliation' && predecessorLive.has(entry.id);
}

/**
 * Prove that the release ledger is the exact captured deletion set with only
 * attribution and exact-diff osmVersion fields added. A versioned generation
 * is already release schema and must be copied byte-for-byte instead.
 */
export function assertTombstoneLedgerAncestry({
  predecessor,
  sourceBytes = null,
  migratedBytes,
  migratedLedger,
}) {
  const evidence = validatePredecessorEvidence(predecessor);
  const releaseLedger = {
    attribution: migratedLedger?.attribution,
    licence: migratedLedger?.licence,
    licenceUrl: migratedLedger?.licenceUrl,
    generatedAt: migratedLedger?.generatedAt,
    upstream: migratedLedger?.upstream,
    tombstones: migratedLedger?.tombstones,
  };
  validateReleaseTombstoneLedger(releaseLedger, 'migrated release tombstone ledger');
  const outputBytes = Buffer.from(migratedBytes);
  releaseTombstoneIdentity(outputBytes, releaseLedger);

  if (evidence.source.mode === 'empty-r2') {
    if (sourceBytes !== null || evidence.source.tombstones !== null) {
      throw new Error('empty-R2 predecessor unexpectedly has tombstone source bytes');
    }
    if (releaseLedger.tombstones.length !== 0) {
      throw new Error('empty-R2 predecessor requires a canonical empty tombstone ledger');
    }
    return releaseLedger;
  }

  const captured = assertCapturedSourceIdentity(sourceBytes, evidence);
  const predecessorLive = new Set(evidence.liveIds);
  if (evidence.source.mode === 'generation' && evidence.source.versionsKnown) {
    let source;
    try {
      source = JSON.parse(captured.bytes.toString('utf8'));
    } catch {
      throw new Error('generation predecessor tombstone source is not JSON');
    }
    validateReleaseTombstoneLedger(source, 'generation predecessor tombstone ledger');
    const sourceById = new Map(source.tombstones.map((entry) => [entry.id, entry]));
    let replaced = 0;
    for (const entry of source.tombstones) {
      const migrated = releaseLedger.tombstones.find((candidate) => candidate.id === entry.id);
      if (preservesCapturedTombstone(entry, migrated)) continue;
      if (!isProvedCutoverReplacement(migrated, predecessorLive)) {
        throw new Error(`release tombstone ledger changes generation entry ${entry.id}`);
      }
      replaced += 1;
    }
    const added = releaseLedger.tombstones.filter((entry) => !sourceById.has(entry.id));
    for (const entry of added) {
      if (!isProvedCutoverReplacement(entry, predecessorLive)) {
        throw new Error(`release tombstone ledger has unproved extra entry ${entry.id}`);
      }
    }
    if (added.length === 0 && replaced === 0 && !captured.bytes.equals(outputBytes)) {
      throw new Error('generation predecessor tombstones must be copied byte-for-byte');
    }
    return releaseLedger;
  }

  const source = parseCapturedLegacyTombstoneBytes(captured.bytes, evidence);
  const migratedById = new Map(releaseLedger.tombstones.map((entry) => [entry.id, entry]));
  for (const entry of source.tombstones) {
    const migrated = migratedById.get(entry.id);
    if (preservesCapturedTombstone(entry, migrated)) continue;
    if (!isProvedCutoverReplacement(migrated, predecessorLive)) {
      throw new Error(`migrated tombstone ledger changes captured entry ${entry.id}`);
    }
  }
  const sourceIds = new Set(source.tombstones.map((entry) => entry.id));
  for (const entry of releaseLedger.tombstones) {
    if (!sourceIds.has(entry.id) && !isProvedCutoverReplacement(entry, predecessorLive)) {
      throw new Error(`migrated tombstone ledger has unproved extra entry ${entry.id}`);
    }
  }
  return releaseLedger;
}

export async function loadOfficialTombstoneSequence(sequence, ids) {
  const events = [];
  await forEachElement(sequenceDiffUrl(sequence), (event) => {
    if (event.type === 'node' && ids.has(String(event.id))) events.push(event);
  });
  return events;
}

export async function verifyTombstoneLedgerAncestry({
  predecessor,
  sourceBytes = null,
  migratedBytes,
  migratedLedger,
  loadSequence = loadOfficialTombstoneSequence,
  countyIndex = null,
}) {
  const releaseLedger = assertTombstoneLedgerAncestry({
    predecessor,
    sourceBytes,
    migratedBytes,
    migratedLedger,
  });
  const evidence = validatePredecessorEvidence(predecessor);
  if (
    evidence.source.mode !== 'legacy-flat-root' &&
    !(evidence.source.mode === 'generation' && evidence.source.versionsKnown === false)
  ) {
    return releaseLedger;
  }

  const source = parseCapturedLegacyTombstoneBytes(sourceBytes, evidence);
  const exact = await backfillTombstoneVersions(source.tombstones, loadSequence, {
    countyIndex,
  });
  const exactVersions = new Map(exact.tombstones.map((entry) => [entry.id, entry.osmVersion]));
  const predecessorLive = new Set(evidence.liveIds);
  for (const [id, version] of exactVersions) {
    const entry = releaseLedger.tombstones.find((candidate) => candidate.id === id);
    if (isProvedCutoverReplacement(entry, predecessorLive)) continue;
    if (entry?.osmVersion !== version) {
      throw new Error(`migrated tombstone ${id} has no exact-diff OSM version proof`);
    }
  }
  return releaseLedger;
}

const OSM_API_ROOT = 'https://api.openstreetmap.org/api/0.6';
const RECONCILIATION_USER_AGENT =
  'DarkRoute-camera-cutover/0.1 (+https://darkroute.ai; contact cory@darkcode.ai)';

function sourceTombstones(predecessor, sourceBytes) {
  if (predecessor.source.mode === 'empty-r2') return [];
  if (
    predecessor.source.mode === 'legacy-flat-root' ||
    (predecessor.source.mode === 'generation' && predecessor.source.versionsKnown === false)
  ) {
    return parseCapturedLegacyTombstoneBytes(sourceBytes, predecessor).tombstones;
  }
  const captured = assertCapturedSourceIdentity(sourceBytes, predecessor);
  let ledger;
  try {
    ledger = JSON.parse(captured.bytes.toString('utf8'));
  } catch {
    throw new Error('generation predecessor tombstone source is not JSON');
  }
  validateReleaseTombstoneLedger(ledger, 'generation predecessor tombstone ledger');
  return ledger.tombstones;
}

function versionFetchBatches(entries) {
  const batches = [];
  let current = [];
  for (const entry of entries) {
    const value = entry.id.slice(4);
    const candidate = [...current, value];
    const url = `${OSM_API_ROOT}/nodes.json?nodes=${candidate.join(',')}`;
    if (url.length > 7_000 && current.length > 0) {
      batches.push(current);
      current = [value];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function fetchExactNodeVersions(entries, fetchImpl) {
  const found = new Map();
  const expected = new Map(entries.map((entry) => [entry.id, entry.osmVersion]));
  for (const batch of versionFetchBatches(entries)) {
    const url = `${OSM_API_ROOT}/nodes.json?nodes=${batch.join(',')}`;
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': RECONCILIATION_USER_AGENT,
      },
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
        !/^osm:[1-9]\d*$/.test(id) ||
        !expected.has(id) ||
        !Number.isSafeInteger(node.version) ||
        node.version < 1 ||
        node.version !== expected.get(id) ||
        found.has(id)
      ) {
        throw new Error(`${url}: OSM response is not the exact current node version`);
      }
      found.set(id, node);
    }
  }
  if (found.size !== expected.size) {
    const missing = [...expected.keys()].find((id) => !found.has(id));
    throw new Error(`official OSM API omitted current cutover node ${String(missing)}`);
  }
  return found;
}

/**
 * Every tombstone added solely for the one-time cutover must name an immutable
 * official OSM node version which is deleted, unqualified, or outside the
 * pinned territory. Its observation sequence is a replication state at or
 * after that version timestamp; it is not represented as a historical diff.
 */
export function assertCutoverReconciliationShape({
  predecessor,
  sourceBytes = null,
  migratedBytes,
  migratedLedger,
  baselineLiveIds,
}) {
  const evidence = validatePredecessorEvidence(predecessor);
  const ledger = assertTombstoneLedgerAncestry({
    predecessor: evidence,
    sourceBytes,
    migratedBytes,
    migratedLedger,
  });
  if (
    !Array.isArray(baselineLiveIds) ||
    baselineLiveIds.some((id) => !/^osm:[1-9]\d*$/.test(id ?? '')) ||
    new Set(baselineLiveIds).size !== baselineLiveIds.length
  ) {
    throw new Error('cutover baseline live ids are invalid or duplicate');
  }
  const inherited = new Map(
    sourceTombstones(evidence, sourceBytes).map((entry) => [entry.id, entry]),
  );
  const live = new Set(baselineLiveIds);
  // A migration-only osmVersion augmentation still preserves the captured
  // entry. A new id, or replacement of an inherited live/tombstone overlap,
  // is a one-time reconciliation and must receive the exact-current proof.
  const extras = ledger.tombstones.filter(
    (entry) => !preservesCapturedTombstone(inherited.get(entry.id), entry),
  );
  if (evidence.source.mode === 'empty-r2') {
    if (extras.some((entry) => entry.reason === 'cutover_reconciliation')) {
      throw new Error('empty-R2 cutover cannot claim predecessor reconciliation tombstones');
    }
    return { ledger, extras: [] };
  }
  const predecessorLive = new Set(evidence.liveIds);
  const expectedExtraIds = evidence.liveIds.filter((id) => !live.has(id));
  const actualExtraIds = extras.map((entry) => entry.id).sort();
  if (
    expectedExtraIds.length !== actualExtraIds.length ||
    expectedExtraIds.some((id, index) => id !== actualExtraIds[index])
  ) {
    throw new Error('cutover reconciliation does not exactly cover the absent predecessor ids');
  }
  for (const entry of extras) {
    if (
      entry.reason !== 'cutover_reconciliation' ||
      !predecessorLive.has(entry.id) ||
      live.has(entry.id)
    ) {
      throw new Error(`cutover tombstone ${entry.id} is not an uncovered predecessor camera`);
    }
  }
  return { ledger, extras };
}

export async function verifyCutoverReconciliation({
  predecessor,
  sourceBytes = null,
  migratedBytes,
  migratedLedger,
  baselineLiveIds,
  countyIndex,
  fetchImpl = fetch,
}) {
  const { ledger, extras } = assertCutoverReconciliationShape({
    predecessor,
    sourceBytes,
    migratedBytes,
    migratedLedger,
    baselineLiveIds,
  });
  if (extras.length === 0) return ledger;

  const states = new Map();
  for (const seq of new Set(extras.map((entry) => entry.seq))) {
    states.set(seq, await sequenceState(seq, fetchImpl));
  }
  const nodes = await fetchExactNodeVersions(extras, fetchImpl);
  for (const entry of extras) {
    const node = nodes.get(entry.id);
    if (node === undefined) {
      throw new Error(`official OSM API did not return ${entry.id}v${String(entry.osmVersion)}`);
    }
    const timestamp = canonicalSourceTimestamp(
      node.timestamp,
      `cutover node ${entry.id} timestamp`,
    );
    if (Date.parse(states.get(entry.seq).timestamp) < Date.parse(timestamp)) {
      throw new Error(`cutover tombstone ${entry.id} predates its official OSM version`);
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
        throw new Error(`cutover node ${entry.id} has invalid current geometry or tags`);
      }
      if (
        qualifies(node.tags) &&
        countyIndex.lookup(normaliseCoordinate(node.lat), normaliseCoordinate(node.lon)) !== null
      ) {
        throw new Error(
          `cutover node ${entry.id} is still a qualifying in-scope camera; capture is incomplete`,
        );
      }
    }
  }
  return ledger;
}

export async function migrateLegacyTombstoneLedger(
  source,
  loadSequence,
  { countyIndex = null } = {},
) {
  const resolved = await backfillTombstoneVersions(source.tombstones, loadSequence, {
    countyIndex,
  });
  const tombstones = resolved.tombstones
    .map(({ id, reason, seq, osmVersion }) => ({ id, reason, seq, osmVersion }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const migrated = {
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    generatedAt: source.generatedAt,
    upstream: source.upstream,
    tombstones,
  };
  validateReleaseTombstoneLedger(migrated, 'migrated release tombstone ledger');
  return { ledger: migrated, resolution: resolved };
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

export function parseMigrationArgs(argv) {
  const parsed = { input: null, out: null, predecessor: null, dry: false };
  const options = new Map([
    ['--input', 'input'],
    ['--out', 'out'],
    ['--predecessor', 'predecessor'],
  ]);
  for (let index = 0; index < argv.length;) {
    if (argv[index] === '--dry') {
      if (parsed.dry) throw new Error('--dry may be passed only once');
      parsed.dry = true;
      index += 1;
      continue;
    }
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
    if (!found) throw new Error(`unknown tombstone migration argument: ${argv[index]}`);
  }
  for (const [name, key] of options) {
    if (parsed[key] === null) throw new Error(`${name} is required`);
  }
  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseMigrationArgs(argv);
  const input = resolve(options.input);
  const out = resolve(options.out);
  const predecessorPath = resolve(options.predecessor);
  rejectSymlinkComponents(input);
  rejectSymlinkComponents(predecessorPath);
  rejectSymlinkComponents(dirname(out));
  const inputInfo = lstatSync(input);
  if (!inputInfo.isFile()) throw new Error(`legacy tombstone input is not a file: ${input}`);
  if (existsSync(out)) throw new Error(`tombstone migration output already exists: ${out}`);
  const predecessorInfo = lstatSync(predecessorPath);
  if (!predecessorInfo.isFile()) {
    throw new Error(`camera predecessor evidence is not a file: ${predecessorPath}`);
  }
  let predecessor;
  try {
    predecessor = JSON.parse(readFileSync(predecessorPath, 'utf8'));
  } catch {
    throw new Error('camera predecessor evidence is not JSON');
  }
  const sourceBytes = readFileSync(input);
  const source = parseCapturedLegacyTombstoneBytes(sourceBytes, predecessor);
  const geofenceBytes = readFileSync(DEFAULT_COUNTY_GEOFENCE);
  releaseGeofenceIdentity(geofenceBytes);
  const countyIndex = loadCountiesBytes(geofenceBytes);
  const { ledger, resolution } = await migrateLegacyTombstoneLedger(
    source,
    loadOfficialTombstoneSequence,
    { countyIndex },
  );
  const body = Buffer.from(`${JSON.stringify(ledger)}\n`);
  assertTombstoneLedgerAncestry({
    predecessor,
    sourceBytes,
    migratedBytes: body,
    migratedLedger: ledger,
    countyIndex,
  });
  const identity = releaseTombstoneIdentity(body, ledger);
  process.stdout.write(
    `migrated ${String(identity.count)} tombstones: ${String(resolution.added)} versions added, ` +
      `${String(resolution.verified)} verified; sha256 ${identity.sha256}\n`,
  );
  if (options.dry) {
    process.stdout.write('--dry: nothing written\n');
    return;
  }
  await writeFile(out, body, { flag: 'wx' });
  process.stdout.write(`wrote ${out}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
