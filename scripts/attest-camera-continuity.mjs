#!/usr/bin/env node

/**
 * Build the semantic proof which must accompany every versionsKnown camera
 * generation. The proof is useful only because publish-cameras independently
 * re-fetches the official numbered diffs and rebuilds it before any R2 write.
 */

import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  CAMERA_CONTINUITY_KEY,
  cameraContinuityBytes,
  cameraCoreFromArchiveEntries,
  cameraCoreIdentity,
  canonicalIntegrityJson,
  createCameraContinuity,
  parseCameraContinuityBytes,
} from './camera-integrity.mjs';
import { readLocalGeneration } from './camera-generation.mjs';
import { replayCameraCore } from './camera-replay.mjs';
import { readValidatedCapture } from './propose-deflock-source-review.mjs';
import {
  DEFAULT_COUNTY_GEOFENCE,
  DEFAULT_RELEASE_TOMBSTONES,
  DEFAULT_SOURCE_REVIEW,
  assertApprovedCameraSourceMarker,
  assertReleaseTombstoneInput,
  releaseGeofenceIdentity,
  validateReleaseTombstoneLedger,
} from './fetch-cameras.mjs';
import {
  assertReviewedResponseLedger,
  transformCapturedCollection,
} from './fetch-cameras-deflock.mjs';
import { loadCountiesBytes } from './counties.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function rejectSymlinkComponents(path) {
  let at = resolve(path);
  while (at !== parse(at).root) {
    if (existsSync(at) && lstatSync(at).isSymbolicLink()) {
      throw new Error(`camera continuity path has a symlink component: ${at}`);
    }
    at = dirname(at);
  }
}

function sourceMarker(local, trustedReviewBytes) {
  const entry = local.entries.find(({ key }) => key === 'index.json');
  let index;
  try {
    index = JSON.parse(entry?.body.toString('utf8'));
  } catch {
    throw new Error('camera continuity cannot parse index.json');
  }
  return assertApprovedCameraSourceMarker(index?.cameraSource, trustedReviewBytes);
}

function sameInstant(left, right) {
  return Date.parse(left) === Date.parse(right);
}

function pointerTarget(pointer) {
  if (pointer === null) return null;
  return {
    slot: pointer.slot,
    generation: pointer.generation,
    manifestSha256: pointer.manifestSha256,
  };
}

export function parseBaselineTombstoneBytes(bytes) {
  let ledger;
  try {
    ledger = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('baseline tombstone ledger is not JSON');
  }
  validateReleaseTombstoneLedger(ledger, 'baseline tombstone ledger');
  return ledger;
}

export function deriveApprovedBaseline({ capture, marker, baselineTombstones, countyIndex }) {
  if (
    typeof capture?.artifacts !== 'object' ||
    capture.artifacts === null ||
    !Buffer.isBuffer(capture.artifacts.ledgerBytes) ||
    !Buffer.isBuffer(capture.artifacts.responseBundle) ||
    !Buffer.isBuffer(capture.artifacts.rawDataset)
  ) {
    throw new Error('approved baseline capture does not expose its exact retained artifact bytes');
  }
  const boundCapture = assertReviewedResponseLedger(
    marker.review.receipt,
    capture.artifacts,
  );
  const { publishedRecords, resolved, transformation } = transformCapturedCollection(
    boundCapture.collection,
    baselineTombstones,
    countyIndex,
  );
  if (!isDeepStrictEqual(transformation, marker.review.receipt.expectedTransformation)) {
    throw new Error('approved source artifacts do not reproduce the reviewed transformation');
  }
  const identity = cameraCoreIdentity(publishedRecords, resolved.tombstones);
  if (
    identity.liveSha256 !== marker.transformation.publishedLiveSha256 ||
    identity.tombstonesSha256 !== marker.transformation.publishedTombstonesSha256
  ) {
    throw new Error('approved source artifacts do not reproduce the baseline semantic core');
  }
  return {
    ...identity,
    maximumOsmBase: boundCapture.maximumOsmBase,
    maximumTombstoneSequence: baselineTombstones.reduce(
      (maximum, tombstone) => Math.max(maximum, tombstone.seq),
      0,
    ),
  };
}

/**
 * A capture is a union of response snapshots, not one instant. The overlap
 * replay is exact only after it has crossed the newest constituent response and
 * every pre-seeded deletion observation.
 */
export function assertBaselineObservationCeiling(replication, baseline) {
  if (
    Date.parse(replication.lastAppliedTimestamp) < Date.parse(baseline.maximumOsmBase) ||
    replication.lastAppliedSeq < baseline.maximumTombstoneSequence
  ) {
    throw new Error(
      'candidate camera watermark has not crossed every approved baseline observation',
    );
  }
  return replication;
}

/** Reject any byte-coherent archive that is not the independently replayed set. */
export function assertExactReplayedCore(entries, replay) {
  const actual = cameraCoreFromArchiveEntries(entries);
  const expected = cameraCoreIdentity(replay.live, replay.tombstones);
  if (
    actual.liveSha256 !== expected.liveSha256 ||
    actual.tombstonesSha256 !== expected.tombstonesSha256 ||
    canonicalIntegrityJson(actual.live) !== canonicalIntegrityJson(expected.live) ||
    canonicalIntegrityJson(actual.tombstones) !== canonicalIntegrityJson(expected.tombstones)
  ) {
    throw new Error('candidate camera archive is not the exact approved baseline plus official replay');
  }
  return actual;
}

/** Build one expected proof from independently validated inputs and official diffs. */
export async function deriveCameraContinuity({
  local,
  trustedReviewBytes,
  capture,
  countyIndex,
  baselineTombstones,
  parentContinuity = null,
  parentPointer = null,
  fetchImpl = fetch,
}) {
  if (local.replication.versionsKnown !== true) {
    throw new Error('camera continuity can attest only versionsKnown generations');
  }
  const marker = sourceMarker(local, trustedReviewBytes);
  const floor = marker.review.receipt.replicationFloor;
  const baseline = deriveApprovedBaseline({ capture, marker, baselineTombstones, countyIndex });
  assertBaselineObservationCeiling(local.replication, baseline);
  const baselineIdentity = {
    sequence: floor.sequence,
    timestamp: floor.timestamp,
    liveSha256: baseline.liveSha256,
    tombstonesSha256: baseline.tombstonesSha256,
  };

  let kind;
  let parent;
  let fromSequence;
  let fromTimestamp;
  let startLive;
  let startTombstones;
  if (parentContinuity === null) {
    kind = 'baseline-replay';
    parent = null;
    fromSequence = floor.sequence;
    fromTimestamp = floor.timestamp;
    startLive = baseline.live;
    startTombstones = baseline.tombstones;
  } else {
    if (parentPointer === null) throw new Error('replication continuity requires a parent pointer');
    const checkedParent = parseCameraContinuityBytes(parentContinuity);
    if (
      checkedParent.document.reviewSha256 !== marker.review.sha256 ||
      canonicalIntegrityJson(checkedParent.document.baseline) !==
        canonicalIntegrityJson(baselineIdentity) ||
      canonicalIntegrityJson(checkedParent.document.baselineTombstones) !==
        canonicalIntegrityJson(baseline.tombstones)
    ) {
      throw new Error('parent camera continuity does not share the approved baseline');
    }
    kind = 'replication';
    parent = pointerTarget(parentPointer);
    fromSequence = checkedParent.document.replication.lastAppliedSeq;
    fromTimestamp = checkedParent.document.replication.lastAppliedTimestamp;
    startLive = checkedParent.live;
    startTombstones = checkedParent.tombstones;
  }
  if (local.replication.lastAppliedSeq < fromSequence) {
    throw new Error('candidate camera continuity moves behind its trusted base');
  }
  const replay = await replayCameraCore({
    live: startLive,
    tombstones: startTombstones,
    fromSequence,
    throughSequence: local.replication.lastAppliedSeq,
    countyIndex,
    fetchImpl,
  });
  const expectedTimestamp = replay.timestamp ?? fromTimestamp;
  if (!sameInstant(expectedTimestamp, local.replication.lastAppliedTimestamp)) {
    throw new Error('candidate camera watermark does not match the independently replayed state');
  }
  const actual = assertExactReplayedCore(local.entries, replay);
  return createCameraContinuity({
    reviewSha256: marker.review.sha256,
    baseline: baselineIdentity,
    baselineTombstones: baseline.tombstones,
    transition: {
      kind,
      parent,
      fromSequence,
      throughSequence: local.replication.lastAppliedSeq,
      diffs: replay.diffs,
    },
    replication: local.replication,
    live: actual.live,
    tombstones: actual.tombstones,
  });
}

export function parseAttestationArgs(argv) {
  const parsed = {
    target: null,
    stateFile: null,
    sourceReview: DEFAULT_SOURCE_REVIEW,
    captureDir: resolve(ROOT, 'scripts/data'),
    baselineTombstones: null,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const split = argument.indexOf('=');
    const name = split < 0 ? argument : argument.slice(0, split);
    const value = split < 0 ? argv[++index] : argument.slice(split + 1);
    const field = {
      '--target': 'target',
      '--state-file': 'stateFile',
      '--source-review': 'sourceReview',
      '--capture-dir': 'captureDir',
      '--baseline-tombstones': 'baselineTombstones',
    }[name];
    if (field === undefined) throw new Error(`unknown camera continuity argument: ${argument}`);
    if (seen.has(name)) throw new Error(`${name} may be supplied only once`);
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
      throw new Error(`${name} requires a path`);
    }
    seen.add(name);
    parsed[field] = value;
  }
  if (parsed.target === null || parsed.stateFile === null) {
    throw new Error('--target and --state-file are required');
  }
  return parsed;
}

export async function attestCameraContinuity(options, dependencies = {}) {
  const target = resolve(options.target);
  const stateFile = resolve(options.stateFile);
  const reviewBytes =
    dependencies.trustedReviewBytes === undefined
      ? readFileSync(resolve(options.sourceReview))
      : Buffer.from(dependencies.trustedReviewBytes);
  const geofenceBytes =
    dependencies.geofenceBytes === undefined
      ? readFileSync(DEFAULT_COUNTY_GEOFENCE)
      : Buffer.from(dependencies.geofenceBytes);
  releaseGeofenceIdentity(geofenceBytes);
  const countyIndex = loadCountiesBytes(geofenceBytes);
  const capture =
    dependencies.capture ?? readValidatedCapture(resolve(options.captureDir));
  const local =
    dependencies.local ??
    (await readLocalGeneration(target, stateFile, {
      ...(dependencies.validation ?? {}),
      trustedReviewBytes: reviewBytes,
      requireLicenceUrl: true,
      requireContinuity: false,
    }));
  const marker = sourceMarker(local, reviewBytes);
  const baselinePath = resolve(options.baselineTombstones ?? DEFAULT_RELEASE_TOMBSTONES);
  if (dependencies.baselineTombstoneBytes === undefined) {
    rejectSymlinkComponents(baselinePath);
  }
  const baselineBytes =
    dependencies.baselineTombstoneBytes === undefined
      ? readFileSync(baselinePath)
      : Buffer.from(dependencies.baselineTombstoneBytes);
  const baselineInput = assertReleaseTombstoneInput(
    baselineBytes,
    marker.review.receipt.releaseInputs.tombstones,
  );
  const baselineTombstones = baselineInput.ledger.tombstones;
  const continuityEntry = local.entries.find(({ key }) => key === CAMERA_CONTINUITY_KEY);
  let parentContinuity = null;
  if (continuityEntry !== undefined) {
    parseCameraContinuityBytes(continuityEntry.body);
    // A reviewed bootstrap tree can already carry a baseline proof before a
    // pointer exists. After catch-up, rebuild that proof from its embedded,
    // independently derived baseline rather than pretending it has an
    // immutable R2 parent. A hydrated generation does have such a parent and
    // must extend it normally. In both cases the transform starts from the
    // exact retained receipt input above, never from candidate-embedded
    // resolved tombstones.
    parentContinuity = local.basePointer === null ? null : continuityEntry.body;
  }
  const derive = dependencies.deriveImpl ?? deriveCameraContinuity;
  const document = await derive({
    local,
    trustedReviewBytes: reviewBytes,
    capture,
    countyIndex,
    baselineTombstones,
    parentContinuity,
    parentPointer: parentContinuity === null ? null : local.basePointer,
    fetchImpl: dependencies.fetchImpl ?? fetch,
  });
  const output = join(target, CAMERA_CONTINUITY_KEY);
  rejectSymlinkComponents(output);
  const bytes = cameraContinuityBytes(document);
  const temporary = `${output}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes, { flag: 'wx' });
  renameSync(temporary, output);
  return document;
}

async function main() {
  const options = parseAttestationArgs(process.argv.slice(2));
  const document = await attestCameraContinuity(options);
  process.stdout.write(
    `attested ${String(document.liveCount)} cameras through sequence ` +
      `${String(document.replication.lastAppliedSeq)} in ${join(resolve(options.target), CAMERA_CONTINUITY_KEY)}\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
