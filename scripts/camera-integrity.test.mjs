import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  cameraCoreIdentity,
  cameraOsmCore,
  createCameraContinuity,
  decodeCameraCore,
  encodeCameraCore,
  parseCameraContinuityBytes,
  cameraContinuityBytes,
} from './camera-integrity.mjs';
import { assertExactReplayedCore } from './attest-camera-continuity.mjs';

const hash = (character) => character.repeat(64);
const replication = {
  stream: 'hour',
  lastAppliedSeq: 10,
  lastAppliedTimestamp: '2026-09-01T10:00:00.000Z',
  versionsKnown: true,
};
const camera = {
  id: 'osm:1',
  lat: 38.9,
  lon: -94.7,
  directionDeg: null,
  ownerType: 'unverified',
  confirmations: 1,
  countyFips: '20091',
  osmVersion: 1,
  updatedAt: Date.parse(replication.lastAppliedTimestamp),
  tags: {},
};

test('semantic camera core cannot hide an enumerable __proto__ field', () => {
  const forged = JSON.parse('{"id":"osm:1","lat":38.9,"lon":-94.7,"__proto__":{"omitted":true}}');
  const clean = { id: 'osm:1', lat: 38.9, lon: -94.7 };
  assert.ok(Object.hasOwn(forged, '__proto__'));
  assert.ok(Object.hasOwn(cameraOsmCore(forged), '__proto__'));
  assert.notEqual(
    cameraCoreIdentity([forged], []).liveSha256,
    cameraCoreIdentity([clean], []).liveSha256,
  );
});

test('camera core rejects noncanonical gzip members with identical decoded bytes', () => {
  const descriptor = structuredClone(encodeCameraCore([camera], []).descriptor);
  const compressed = Buffer.from(descriptor.data, 'base64');
  const empty = gzipSync(Buffer.alloc(0), { level: 9, mtime: 0 });
  const header = Buffer.from(empty.subarray(0, 10));
  header[3] |= 0x10;
  const changed = Buffer.concat([
    compressed,
    header,
    Buffer.from('hidden-comment\0'),
    empty.subarray(10),
  ]);
  descriptor.bytes = changed.length;
  descriptor.sha256 = createHash('sha256').update(changed).digest('hex');
  descriptor.data = changed.toString('base64');
  assert.throws(() => decodeCameraCore(descriptor), /core is not canonical deterministic gzip/);
});

test('continuity binds the baseline tombstone body and exact contiguous range', () => {
  const baselineTombstones = [{ id: 'osm:2', reason: 'osm_delete', seq: 9, osmVersion: 2 }];
  const baseline = cameraCoreIdentity([], baselineTombstones);
  const document = createCameraContinuity({
    reviewSha256: hash('a'),
    baseline: {
      sequence: 9,
      timestamp: '2026-09-01T09:00:00.000Z',
      liveSha256: hash('b'),
      tombstonesSha256: baseline.tombstonesSha256,
    },
    baselineTombstones,
    transition: {
      kind: 'baseline-replay',
      parent: null,
      fromSequence: 9,
      throughSequence: 10,
      diffs: [
        {
          sequence: 10,
          timestamp: replication.lastAppliedTimestamp,
          stateUrl:
            'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/000/000/010.state.txt',
          stateBytes: 10,
          stateSha256: hash('c'),
          diffUrl:
            'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/000/000/010.osc.gz',
          diffBytes: 10,
          diffSha256: hash('d'),
        },
      ],
    },
    replication,
    live: [camera],
    tombstones: baselineTombstones,
  });
  const checked = parseCameraContinuityBytes(cameraContinuityBytes(document), {
    replication,
    live: [camera],
    tombstones: baselineTombstones,
    reviewSha256: hash('a'),
  });
  assert.equal(checked.live.length, 1);

  const missingBaseline = structuredClone(document);
  missingBaseline.baselineTombstones = [];
  assert.throws(() => cameraContinuityBytes(missingBaseline), /baseline tombstones/);

  const skipped = structuredClone(document);
  skipped.transition.fromSequence = 8;
  assert.throws(() => cameraContinuityBytes(skipped), /approved baseline sequence/);
});

test('a zero-diff baseline proof must keep the approved floor timestamp', () => {
  const empty = cameraCoreIdentity([], []);
  assert.throws(
    () =>
      createCameraContinuity({
        reviewSha256: hash('a'),
        baseline: {
          sequence: 10,
          timestamp: '2026-09-01T10:00:00.000Z',
          liveSha256: empty.liveSha256,
          tombstonesSha256: empty.tombstonesSha256,
        },
        baselineTombstones: [],
        transition: {
          kind: 'baseline-replay',
          parent: null,
          fromSequence: 10,
          throughSequence: 10,
          diffs: [],
        },
        replication: {
          ...replication,
          lastAppliedTimestamp: '2026-09-01T10:01:00.000Z',
        },
        live: [],
        tombstones: [],
      }),
    /zero-diff baseline replay/,
  );
});

test('a count-matched fabricated generation cannot replace the independently replayed core', () => {
  const forged = { ...camera, id: 'osm:999', osmVersion: 999 };
  const entries = [
    {
      key: '11/485/782.json',
      body: Buffer.from(JSON.stringify({ cameras: [forged] })),
    },
    {
      key: 'tombstones.json',
      body: Buffer.from(JSON.stringify({ tombstones: [] })),
    },
  ];
  assert.throws(
    () => assertExactReplayedCore(entries, { live: [camera], tombstones: [] }),
    /not the exact approved baseline plus official replay/,
  );
});
