#!/usr/bin/env node

/**
 * Build a fail-closed review proposal from one completed direct capture.
 *
 * This script never approves a source and never writes camera tiles or sync
 * state. It validates the retained capture, applies the staged deletion ledger
 * and strict US/DC/PR geofence, discovers the exact official hourly overlap,
 * and writes a receipt whose status is deliberately `unapproved`. Human review
 * is the only operation allowed to promote that one field to `approved`.
 *
 * Usage:
 *   node scripts/propose-deflock-source-review.mjs \
 *     --capture-dir=/tmp/darkroute-source-capture \
 *     --camera-target=/tmp/darkroute-camera-release/cameras \
 *     --predecessor=/tmp/darkroute-predecessor/camera-predecessor.json \
 *     --out=/tmp/darkroute-source-capture/deflock-us-source-review.proposed.json
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, parse, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { loadCountiesBytes } from './counties.mjs';
import {
  PREDECESSOR_TOMBSTONES_PATH,
  assertPredecessorCoverage,
  predecessorIdentity,
  validatePredecessorEvidence,
} from './camera-predecessor.mjs';
import { captureImplementationFiles } from './capture-deflock-source.mjs';
import {
  PINNED_UPSTREAM,
  RAW_DATASET_PATH,
  RESPONSE_BUNDLE_PATH,
  RESPONSE_LEDGER_PATH,
  validateCaptureArtifacts,
} from './deflock-capture.mjs';
import {
  assertReviewedReplicationFloor,
  assertReviewedResponseLedger,
  assertTombstoneOnlyTarget,
  getExactUrl,
  parseReplicationState,
  readTombstoneLedger,
  replicationStateUrl,
  transformCapturedCollection,
  validateSourceReview,
} from './fetch-cameras-deflock.mjs';
import {
  CAMERA_SOURCE_REVIEW_SCHEMA,
  CAMERA_SOURCE_TERRITORIES,
  DEFAULT_COUNTY_GEOFENCE,
  DEFAULT_RELEASE_TOMBSTONES,
  assertReleaseTombstoneInput,
  canonicalSourceTimestamp,
  releaseGeofenceIdentity,
  releaseTombstoneIdentity,
} from './fetch-cameras.mjs';
import {
  assertCutoverReconciliationShape,
  assertTombstoneLedgerAncestry,
  verifyCutoverReconciliation,
  verifyTombstoneLedgerAncestry,
} from './migrate-camera-tombstone-ledger.mjs';

export const LATEST_REPLICATION_STATE_URL =
  'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/state.txt';

const ROOT = resolve(import.meta.dirname, '..');

const artifactPath = (captureDir, canonicalPath) => resolve(captureDir, basename(canonicalPath));

function rejectSymlinkComponents(path) {
  let component = resolve(path);
  while (component !== parse(component).root) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`review proposal path has a symlink component: ${component}`);
    }
    component = dirname(component);
  }
}

function readCaptureFile(captureDir, canonicalPath) {
  const path = artifactPath(captureDir, canonicalPath);
  rejectSymlinkComponents(path);
  const info = lstatSync(path);
  if (!info.isFile()) throw new Error(`capture artifact is not a regular file: ${path}`);
  return readFileSync(path);
}

export function parseProposalArgs(argv) {
  const parsed = { captureDir: null, cameraTarget: null, predecessor: null, out: null };
  const names = new Map([
    ['--capture-dir', 'captureDir'],
    ['--camera-target', 'cameraTarget'],
    ['--predecessor', 'predecessor'],
    ['--out', 'out'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equals = argument.indexOf('=');
    const option = equals < 0 ? argument : argument.slice(0, equals);
    const key = names.get(option);
    if (key === undefined) throw new Error(`unknown review proposal argument: ${argument}`);
    if (parsed[key] !== null) throw new Error(`${option} may be supplied only once`);
    const value = equals < 0 ? argv[++index] : argument.slice(equals + 1);
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
      throw new Error(`${option} requires a non-empty path`);
    }
    parsed[key] = value;
  }
  for (const [option, key] of names) {
    if (parsed[key] === null) throw new Error(`${option} is required`);
  }
  return parsed;
}

async function fetchReplicationState(url, fetchImpl) {
  const response = await getExactUrl(url, 'text', fetchImpl);
  return parseReplicationState(response.body, url);
}

/** Find the numbered hour whose [timestamp,next timestamp) contains osm_base. */
export async function findConservativeReplicationFloor(minimumOsmBase, fetchImpl = fetch) {
  const minimum = canonicalSourceTimestamp(minimumOsmBase, 'minimum capture OSM watermark');
  const target = Date.parse(minimum);
  const cache = new Map();
  const numbered = async (sequence) => {
    if (!cache.has(sequence)) {
      cache.set(sequence, fetchReplicationState(replicationStateUrl(sequence), fetchImpl));
    }
    return cache.get(sequence);
  };
  const latest = await fetchReplicationState(LATEST_REPLICATION_STATE_URL, fetchImpl);
  if (Date.parse(latest.timestamp) <= target) {
    throw new Error(
      'official hourly replication has not yet published a sequence after the capture minimum',
    );
  }

  let low = 0;
  let high = latest.sequence;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    const state = await numbered(middle);
    if (Date.parse(state.timestamp) <= target) low = middle;
    else high = middle - 1;
  }
  const floor = await numbered(low);
  const next = await numbered(low + 1);
  if (
    floor.sequence !== low ||
    next.sequence !== low + 1 ||
    !(Date.parse(floor.timestamp) <= target && target < Date.parse(next.timestamp))
  ) {
    throw new Error('official hourly states do not prove one exact capture overlap interval');
  }
  return {
    floor: {
      stream: 'hour',
      sequence: floor.sequence,
      timestamp: floor.timestamp,
      stateUrl: replicationStateUrl(floor.sequence),
    },
    next,
  };
}

export async function buildSourceReviewProposal({
  capture,
  tombstoneLedger,
  geofenceBytes,
  predecessorBytes,
  predecessor,
  predecessorTombstoneBytes = null,
  floor,
  next,
  loadTombstoneSequence,
  fetchImpl = fetch,
}) {
  if (
    !Buffer.isBuffer(tombstoneLedger?.bytes) ||
    !Buffer.isBuffer(geofenceBytes) ||
    !Buffer.isBuffer(predecessorBytes)
  ) {
    throw new Error('review proposal requires exact predecessor, tombstone, and geofence bytes');
  }
  validatePredecessorEvidence(predecessor);
  releaseGeofenceIdentity(geofenceBytes);
  const countyIndex = loadCountiesBytes(geofenceBytes);
  await verifyTombstoneLedgerAncestry({
    predecessor,
    sourceBytes: predecessorTombstoneBytes,
    migratedBytes: tombstoneLedger.bytes,
    migratedLedger: tombstoneLedger,
    ...(loadTombstoneSequence === undefined ? {} : { loadSequence: loadTombstoneSequence }),
    countyIndex,
  });
  const { cameras, transformation } = transformCapturedCollection(
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
    fetchImpl,
  });
  assertPredecessorCoverage(
    predecessor,
    cameras.map((camera) => camera.id),
    tombstoneLedger.tombstones,
  );
  const ledger = capture.ledger;
  const review = {
    schema: CAMERA_SOURCE_REVIEW_SCHEMA,
    repository: PINNED_UPSTREAM.repository,
    headSha: PINNED_UPSTREAM.commit,
    territories: [...CAMERA_SOURCE_TERRITORIES],
    captureImplementation: {
      files: ledger.implementation.localFiles.map((file) => ({ ...file })),
    },
    releaseInputs: {
      geofence: { ...releaseGeofenceIdentity(geofenceBytes) },
      predecessor: predecessorIdentity(predecessorBytes, predecessor),
      tombstones: { ...tombstoneLedger.identity },
    },
    expectedSource: {
      country: 'us',
      build: capture.rawDataset.decodedSha256.slice(0, 16),
      capturedAt: ledger.capture.completedAt,
      total: capture.rawDataset.featureCount,
      rawDataset: { ...capture.rawDataset },
    },
    expectedTransformation: transformation,
    sourceWatermark: {
      status: 'unapproved',
      captureId: ledger.captureId,
      minimumOsmBase: capture.minimumOsmBase,
      responseLedger: {
        schema: ledger.schema,
        ...capture.ledgerIdentity,
        responseCount: capture.responseBundle.responseCount,
        roleCounts: { ...capture.roleCounts },
        endpoints: [...capture.endpoints],
        responseBundle: { ...capture.responseBundle },
      },
    },
    replicationFloor: { ...floor },
  };
  // This assertion deliberately validates continuity without accepting the
  // proposal as an approved trust root.
  assertReviewedReplicationFloor(review, floor, next);
  return review;
}

export function readValidatedCapture(
  captureDir,
  { implementationRoot = ROOT, retainedArtifactVisitor = null } = {},
) {
  const root = resolve(captureDir);
  rejectSymlinkComponents(root);
  if (!lstatSync(root).isDirectory()) throw new Error(`capture path is not a directory: ${root}`);
  const ledgerBytes = readCaptureFile(root, RESPONSE_LEDGER_PATH);
  let ledger;
  try {
    ledger = JSON.parse(ledgerBytes.toString('utf8'));
  } catch {
    throw new Error('capture response ledger is not JSON');
  }
  const responseBundle = readCaptureFile(root, RESPONSE_BUNDLE_PATH);
  const rawDataset = readCaptureFile(root, RAW_DATASET_PATH);
  return {
    ledger,
    artifacts: {
      ledgerBytes: Buffer.from(ledgerBytes),
      responseBundle: Buffer.from(responseBundle),
      rawDataset: Buffer.from(rawDataset),
    },
    ...validateCaptureArtifacts(ledger, {
      ledgerBytes,
      responseBundle,
      rawDataset,
      implementationFiles: captureImplementationFiles(implementationRoot),
      retainedArtifactVisitor,
    }),
  };
}

/**
 * Re-establish the complete approved baseline link without network access.
 *
 * This is the public-seed/audit counterpart to proposal-time network checks:
 * it binds every retained byte, the pinned geofence, exact predecessor source,
 * structurally valid ledger ancestry and reconciliation membership, then
 * recomputes the full reviewed transformation and predecessor coverage.
 */
export function validateApprovedBaselineOffline({
  review,
  capture,
  baselineTombstoneBytes,
  geofenceBytes,
  predecessorBytes,
  predecessor,
  predecessorTombstoneBytes = null,
}) {
  validateSourceReview(review);
  const boundCapture = assertReviewedResponseLedger(review, capture.artifacts);
  const baseline = assertReleaseTombstoneInput(
    baselineTombstoneBytes,
    review.releaseInputs.tombstones,
  );
  const checkedPredecessor = validatePredecessorEvidence(predecessor);
  if (
    !isDeepStrictEqual(
      predecessorIdentity(predecessorBytes, checkedPredecessor),
      review.releaseInputs.predecessor,
    )
  ) {
    throw new Error('predecessor evidence does not match the approved review');
  }
  releaseGeofenceIdentity(geofenceBytes);
  const countyIndex = loadCountiesBytes(geofenceBytes);
  assertTombstoneLedgerAncestry({
    predecessor: checkedPredecessor,
    sourceBytes: predecessorTombstoneBytes,
    migratedBytes: baseline.bytes,
    migratedLedger: baseline.ledger,
  });
  const { cameras, territorialCameras, transformation } = transformCapturedCollection(
    boundCapture.collection,
    baseline.ledger.tombstones,
    countyIndex,
  );
  if (!isDeepStrictEqual(transformation, review.expectedTransformation)) {
    throw new Error('retained approved inputs do not reproduce the reviewed transformation');
  }
  assertCutoverReconciliationShape({
    predecessor: checkedPredecessor,
    sourceBytes: predecessorTombstoneBytes,
    migratedBytes: baseline.bytes,
    migratedLedger: baseline.ledger,
    baselineLiveIds: cameras.map((camera) => camera.id),
  });
  assertPredecessorCoverage(
    checkedPredecessor,
    cameras.map((camera) => camera.id),
    baseline.ledger.tombstones,
  );
  return {
    capture: boundCapture,
    baseline,
    predecessor: checkedPredecessor,
    countyIndex,
    cameras,
    territorialCameras,
    transformation,
  };
}

async function main() {
  const options = parseProposalArgs(process.argv.slice(2));
  const capture = readValidatedCapture(options.captureDir);
  const cameraTarget = resolve(options.cameraTarget);
  assertTombstoneOnlyTarget(cameraTarget);
  const tombstoneLedger = readTombstoneLedger(cameraTarget);
  rejectSymlinkComponents(DEFAULT_RELEASE_TOMBSTONES);
  if (!lstatSync(DEFAULT_RELEASE_TOMBSTONES).isFile()) {
    throw new Error('retained baseline tombstone input is not a regular file');
  }
  const retainedTombstoneBytes = readFileSync(DEFAULT_RELEASE_TOMBSTONES);
  let retainedTombstoneLedger;
  try {
    retainedTombstoneLedger = JSON.parse(retainedTombstoneBytes.toString('utf8'));
  } catch {
    throw new Error('retained baseline tombstone input is not JSON');
  }
  if (
    !retainedTombstoneBytes.equals(tombstoneLedger.bytes) ||
    !isDeepStrictEqual(
      releaseTombstoneIdentity(retainedTombstoneBytes, retainedTombstoneLedger),
      tombstoneLedger.identity,
    )
  ) {
    throw new Error(
      'tombstone-only stage does not exactly match the retained baseline tombstone input',
    );
  }
  const predecessorPath = resolve(options.predecessor);
  rejectSymlinkComponents(predecessorPath);
  const predecessorInfo = lstatSync(predecessorPath);
  if (!predecessorInfo.isFile()) {
    throw new Error(`camera predecessor evidence is not a regular file: ${predecessorPath}`);
  }
  const predecessorBytes = readFileSync(predecessorPath);
  let predecessor;
  try {
    predecessor = JSON.parse(predecessorBytes.toString('utf8'));
  } catch {
    throw new Error('camera predecessor evidence is not JSON');
  }
  const predecessorTombstoneBytes =
    predecessor.source?.mode === 'empty-r2'
      ? null
      : readCaptureFile(dirname(predecessorPath), PREDECESSOR_TOMBSTONES_PATH);
  const geofenceBytes = readFileSync(DEFAULT_COUNTY_GEOFENCE);
  const overlap = await findConservativeReplicationFloor(capture.minimumOsmBase);
  const proposal = await buildSourceReviewProposal({
    capture,
    tombstoneLedger,
    geofenceBytes,
    predecessorBytes,
    predecessor,
    predecessorTombstoneBytes,
    ...overlap,
  });
  const out = resolve(options.out);
  rejectSymlinkComponents(dirname(out));
  await mkdir(dirname(out), { recursive: true });
  rejectSymlinkComponents(dirname(out));
  await writeFile(out, `${JSON.stringify(proposal, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(
    `wrote unapproved review proposal ${out}\n` +
      `capture ${proposal.sourceWatermark.captureId}\n` +
      `floor ${String(proposal.replicationFloor.sequence)} @ ${proposal.replicationFloor.timestamp}\n` +
      `release elements ${String(proposal.expectedTransformation.outputElements)}\n` +
      'human review is required before changing sourceWatermark.status to approved\n',
  );
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  await main();
}
