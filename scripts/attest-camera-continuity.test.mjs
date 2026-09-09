import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertBaselineObservationCeiling,
  attestCameraContinuity,
  deriveApprovedBaseline,
  parseAttestationArgs,
} from './attest-camera-continuity.mjs';
import {
  approvedCameraSourceFixture,
  makeCameraFixture,
} from './camera-generation-test-helpers.mjs';
import { readLocalGeneration } from './camera-generation.mjs';
import {
  CAMERA_CONTINUITY_KEY,
  cameraContinuityBytes,
  parseCameraContinuityBytes,
} from './camera-integrity.mjs';
import {
  ATTRIBUTION,
  DEFAULT_COUNTY_GEOFENCE,
  LICENCE,
  LICENCE_URL,
  releaseTombstoneIdentity,
} from './fetch-cameras.mjs';

test('attestation CLI requires an explicit target and runtime state', () => {
  assert.deepEqual(
    parseAttestationArgs(['--target=/tmp/cameras', '--state-file=/tmp/state.json']),
    {
      target: '/tmp/cameras',
      stateFile: '/tmp/state.json',
      sourceReview: DEFAULT_SOURCE_REVIEW_FOR_TEST,
      captureDir: CAPTURE_DIR_FOR_TEST,
      baselineTombstones: null,
    },
  );
  assert.throws(() => parseAttestationArgs([]), /--target and --state-file are required/);
});

// Resolve defaults once without copying implementation paths into assertions.
const DEFAULT_SOURCE_REVIEW_FOR_TEST = parseAttestationArgs([
  '--target=/tmp/cameras',
  '--state-file=/tmp/state.json',
]).sourceReview;
const CAPTURE_DIR_FOR_TEST = parseAttestationArgs([
  '--target=/tmp/cameras',
  '--state-file=/tmp/state.json',
]).captureDir;

test('pointer-absent bootstrap re-attests from the retained receipt input, not its embedded resolved baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'camera-attest-bootstrap-'));
  try {
    const inputLedger = {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: '2026-09-01T09:00:00.000Z',
      upstream: '2026-09-01T09:00:00.000Z',
      tombstones: [
        { id: 'osm:999', reason: 'osm_delete', seq: 9, osmVersion: 1 },
      ],
    };
    const baselineTombstoneBytes = Buffer.from(`${JSON.stringify(inputLedger)}\n`);
    const approved = approvedCameraSourceFixture((receipt) => {
      receipt.releaseInputs.tombstones = releaseTombstoneIdentity(
        baselineTombstoneBytes,
        inputLedger,
      );
      receipt.expectedTransformation.outputTombstones = 1;
    });
    const fixture = await makeCameraFixture(root, {
      versionsKnown: true,
      osmVersion: 1,
      cameraSource: approved.marker,
      baseUpstream: approved.minimumOsmBase,
    });
    const local = await readLocalGeneration(fixture.archive, fixture.stateFile, {
      minTiles: 1,
      minCameras: 1,
      trustedReviewBytes: approved.trustedReviewBytes,
    });
    const existing = local.entries.find(({ key }) => key === CAMERA_CONTINUITY_KEY);
    const expected = parseCameraContinuityBytes(existing.body).document;
    let observed;
    await attestCameraContinuity(
      {
        target: fixture.archive,
        stateFile: fixture.stateFile,
        sourceReview: '/unused/review.json',
        captureDir: '/unused/capture',
        baselineTombstones: null,
      },
      {
        local,
        trustedReviewBytes: approved.trustedReviewBytes,
        baselineTombstoneBytes,
        geofenceBytes: readFileSync(DEFAULT_COUNTY_GEOFENCE),
        capture: {},
        deriveImpl: async (input) => {
          observed = input;
          return expected;
        },
      },
    );
    assert.equal(observed.parentContinuity, null);
    assert.equal(observed.parentPointer, null);
    assert.deepEqual(observed.baselineTombstones, inputLedger.tombstones);
    assert.deepEqual(expected.baselineTombstones, []);
    assert.deepEqual(
      await readFile(join(fixture.archive, CAMERA_CONTINUITY_KEY)),
      cameraContinuityBytes(expected),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('baseline derivation rejects a coherent semantic substitute for the reviewed capture bytes', () => {
  const approved = approvedCameraSourceFixture();
  assert.throws(
    () =>
      deriveApprovedBaseline({
        capture: {
          // Even an alternate capture which claims the same semantic set must
          // match the exact ledger, bundle, and raw-dataset identities in the
          // human-approved receipt.
          collection: { type: 'FeatureCollection', features: [] },
          artifacts: {
            ledgerBytes: Buffer.from('{}\n'),
            responseBundle: Buffer.from('coherent-but-unreviewed-bundle'),
            rawDataset: Buffer.from('coherent-but-unreviewed-raw-dataset'),
          },
        },
        marker: approved.marker,
        baselineTombstones: [],
        countyIndex: { lookup: () => null },
      }),
    /response ledger bytes do not match the reviewed receipt/,
  );
});

test('a mixed-snapshot baseline cannot attest before every source and tombstone observation', () => {
  const baseline = {
    maximumOsmBase: '2026-09-01T10:42:00.000Z',
    maximumTombstoneSequence: 12,
  };
  assert.throws(
    () =>
      assertBaselineObservationCeiling(
        { lastAppliedSeq: 12, lastAppliedTimestamp: '2026-09-01T10:00:00.000Z' },
        baseline,
      ),
    /has not crossed every approved baseline observation/,
  );
  assert.throws(
    () =>
      assertBaselineObservationCeiling(
        { lastAppliedSeq: 11, lastAppliedTimestamp: '2026-09-01T11:00:00.000Z' },
        baseline,
      ),
    /has not crossed every approved baseline observation/,
  );
  assert.doesNotThrow(() =>
    assertBaselineObservationCeiling(
      { lastAppliedSeq: 12, lastAppliedTimestamp: '2026-09-01T11:00:00.000Z' },
      baseline,
    ),
  );
});
