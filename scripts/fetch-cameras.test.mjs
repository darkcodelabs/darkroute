/**
 * THE FETCH'S CIRCUIT BREAKER - that a failed read cannot publish a hole.
 *
 * THE INCIDENT THESE REPLAY
 *   A full sweep wrote 112,098 cameras over a 131,083-camera archive and exited
 *   zero. Chunk 14 of 40 -- Texas, Oklahoma, Kansas, Missouri, Arkansas,
 *   Louisiana -- retried against 429 and 502 and then received HTTP 200 with an
 *   empty `elements` array and NO `remark`, so the existing guard (which throws
 *   on a remark) saw a clean, successful answer meaning "there are no ALPR
 *   cameras in the south-central United States".
 *
 *   Every number in this file is from that run.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  CARRIED_FORWARD,
  CAMERA_SOURCE_GENERATOR,
  CAMERA_SOURCE_LABEL,
  CAMERA_SOURCE_SCHEMA,
  CHUNK_FLOOR,
  CHUNK_LOSS_RATIO,
  MAX_VANISHED_RATIO,
  MAX_VANISHED_VERIFIED,
  PRESERVED_SIDECARS,
  RELEASE_GEOFENCE_IDENTITY,
  RELEASE_CAMERA_MINIMUM,
  assertReleaseCameraMinimum,
  TOTAL_LOSS_RATIO,
  assertSafeCameraTarget,
  assertReleaseCameraSource,
  buildCameraOverview,
  chunkLooksTruncated,
  countWithin,
  inputSnapshotProvenance,
  inputSnapshotTimestamp,
  isStrictlyNewerOsmVersion,
  main,
  parseFetchArgs,
  reconcileTombstoneFloor,
  releaseTombstoneIdentity,
  resolveCameraTarget,
  sourceIndexFields,
  vanishedArchiveRecords,
} from './fetch-cameras.mjs';

const REVIEW_BYTES = readFileSync(new URL('./data/deflock-us-source-review.json', import.meta.url));
const BLOCKED_REVIEW = JSON.parse(REVIEW_BYTES.toString('utf8'));
const TEST_BASELINE_VALIDATION = { minimumBaselineOutput: 0 };
const REVIEW = {
  schema: 'darkroute-deflock-source-review/v3',
  repository: 'flockhopper3/deflock-data',
  headSha: '8d156b24db7090e870af3f007b0caece9b3c0951',
  territories: ['US', 'PR'],
  captureImplementation: {
    files: [
      { path: 'scripts/capture-deflock-source.mjs', bytes: 1, sha256: 'a'.repeat(64) },
      { path: 'scripts/deflock-capture.mjs', bytes: 1, sha256: 'b'.repeat(64) },
    ],
  },
  releaseInputs: {
    geofence: { ...RELEASE_GEOFENCE_IDENTITY },
    predecessor: {
      path: 'scripts/data/camera-predecessor.json',
      bytes: 123,
      sha256: 'e'.repeat(64),
      mode: 'empty-r2',
      liveCount: 0,
      liveIdsSha256: 'f'.repeat(64),
      deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
    },
    tombstones: {
      path: 'scripts/data/deflock-us-baseline-tombstones.json',
      bytes: 123,
      sha256: '2'.repeat(64),
      count: 1,
    },
  },
  expectedSource: {
    country: 'us',
    build: 'cccccccccccccccc',
    capturedAt: '2026-09-01T20:45:00.000Z',
    total: 1,
    rawDataset: {
      path: 'scripts/data/deflock-us-source.geojson.gz',
      format: 'geojson',
      compression: 'gzip',
      bytes: 123,
      sha256: 'd'.repeat(64),
      decodedBytes: 456,
      decodedSha256: 'c'.repeat(64),
      featureCount: 1,
    },
  },
  expectedTransformation: {
    sourceFeatures: 1,
    excludedNonNodes: 0,
    excludedTerritory: 1,
    tombstonesBlocked: 0,
    tombstonesCleared: 0,
    outputElements: 0,
    elementsSha256: createHash('sha256').update('[]').digest('hex'),
    outputTombstones: 1,
    publishedLiveSha256: '5'.repeat(64),
    publishedTombstonesSha256: '6'.repeat(64),
  },
  sourceWatermark: {
    status: 'approved',
    captureId: '11111111-1111-4111-8111-111111111111',
    minimumOsmBase: '2026-09-01T20:30:00.000Z',
    responseLedger: {
      schema: 'deflock-overpass-response-ledger/v2',
      path: 'scripts/data/deflock-us-overpass-response-ledger.json',
      bytes: 789,
      sha256: 'e'.repeat(64),
      responseCount: 4,
      roleCounts: { count: 1, data: 1, subtraction: 2 },
      endpoints: ['https://overpass.deflock.org/api/interpreter'],
      responseBundle: {
        path: 'scripts/data/deflock-us-overpass-responses.bundle.gz',
        compression: 'gzip',
        bytes: 321,
        sha256: 'f'.repeat(64),
        responseCount: 4,
      },
    },
  },
  replicationFloor: {
    stream: 'hour',
    sequence: 122461,
    timestamp: '2026-09-01T20:00:00.000Z',
    stateUrl:
      'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/000/122/461.state.txt',
  },
};

function releaseSourceFixture(elements = [], baselineTombstoneBytes = null) {
  const total = REVIEW.expectedSource.total;
  const excludedNonNodes = 0;
  const transformation = {
    sourceFeatures: total,
    excludedNonNodes,
    excludedTerritory: total - excludedNonNodes - elements.length,
    tombstonesBlocked: 0,
    tombstonesCleared: 0,
    outputElements: elements.length,
    elementsSha256: createHash('sha256').update(JSON.stringify(elements)).digest('hex'),
    outputTombstones: 1,
    publishedLiveSha256: '5'.repeat(64),
    publishedTombstonesSha256: '6'.repeat(64),
  };
  const receipt = structuredClone(REVIEW);
  if (baselineTombstoneBytes !== null) {
    const ledger = JSON.parse(Buffer.from(baselineTombstoneBytes).toString('utf8'));
    receipt.releaseInputs.tombstones = releaseTombstoneIdentity(
      Buffer.from(baselineTombstoneBytes),
      ledger,
    );
    transformation.outputTombstones = ledger.tombstones.length;
  }
  receipt.expectedTransformation = transformation;
  const trustedReviewBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const dump = {
    version: 0.6,
    generator: CAMERA_SOURCE_GENERATOR,
    source: CAMERA_SOURCE_LABEL,
    baseUpstream: REVIEW.sourceWatermark.minimumOsmBase,
    upstream: REVIEW.sourceWatermark.minimumOsmBase,
    cameraSource: {
      schema: CAMERA_SOURCE_SCHEMA,
      generator: CAMERA_SOURCE_GENERATOR,
      territories: ['US', 'PR'],
      source: receipt.expectedSource,
      review: {
        sha256: createHash('sha256').update(trustedReviewBytes).digest('hex'),
        receipt,
      },
      transformation,
    },
    elements,
  };
  return { dump, trustedReviewBytes };
}

describe('a chunk is judged against the archive, not against Overpass', () => {
  it('REFUSES THE ZERO THAT COST 19,000 CAMERAS', () => {
    // Chunk 14 returned 0. The archive holds roughly 19,000 in that box.
    const why = chunkLooksTruncated(0, 19_000);
    assert.notEqual(why, null);
    assert.match(why, /0 nodes/);
    assert.match(why, /19000/);
  });

  it('accepts a chunk that matches what is held', () => {
    assert.equal(chunkLooksTruncated(31_478, 31_000), null);
  });

  it('accepts ordinary churn in both directions', () => {
    // Cameras get added and removed. A few percent either way is a real day.
    assert.equal(chunkLooksTruncated(24_119, 24_500), null);
    assert.equal(chunkLooksTruncated(24_900, 24_500), null);
  });

  it('says nothing about a genuinely empty ocean square', () => {
    // Chunks 3, 4, 5, 9, 10, 11 are open Pacific and correctly return zero.
    // A breaker that failed the run on those would fail every run.
    assert.equal(chunkLooksTruncated(0, 0), null);
  });

  it('does not fire below the floor, where a ratio means nothing', () => {
    // Chunk 34 held two cameras. One being remapped is not an incident.
    assert.equal(chunkLooksTruncated(0, CHUNK_FLOOR - 1), null);
    assert.equal(chunkLooksTruncated(1, 2), null);
  });

  it('fires exactly at the ratio, so the threshold is the documented one', () => {
    const held = 1_000;
    assert.equal(chunkLooksTruncated(held * CHUNK_LOSS_RATIO, held), null);
    assert.notEqual(chunkLooksTruncated(held * CHUNK_LOSS_RATIO - 1, held), null);
  });
});

describe('countWithin', () => {
  const held = new Map([
    ['osm:1', { lat: 38.9183, lon: -94.692 }], // Overland Park -- inside chunk 14
    ['osm:2', { lat: 40.7128, lon: -74.006 }], // New York -- outside it
    ['osm:3', { lat: 29.76, lon: -95.37 }], // Houston -- inside
  ]);
  // Chunk 14's actual box.
  const CHUNK_14 = { south: 28.3, north: 39.1, west: -103.3, east: -90.4 };

  it('counts what is in the box and nothing else', () => {
    assert.equal(countWithin(held, CHUNK_14), 2);
  });

  it('is empty for a box holding nothing', () => {
    assert.equal(countWithin(held, { south: 0, north: 1, west: 0, east: 1 }), 0);
  });
});

describe('the fields a refresh must not destroy', () => {
  it('names street and cross, which this script cannot recompute', () => {
    // `fetch-street-names.mjs` was deleted during pre-public development. A
    // refresh that dropped these would take the street line off 103,000 camera
    // cards, silently.
    assert.deepEqual([...CARRIED_FORWARD].sort(), ['cross', 'street']);
  });

  it('does NOT carry lat/lon -- a camera that moved must move', () => {
    assert.equal(CARRIED_FORWARD.includes('lat'), false);
    assert.equal(CARRIED_FORWARD.includes('lon'), false);
  });
});

describe('the whole-run floor', () => {
  it('rejects a just-below-floor territorial baseline after filtering and tombstones', () => {
    assert.throws(
      () => assertReleaseCameraMinimum(RELEASE_CAMERA_MINIMUM - 1),
      /below the 120000 floor/,
    );
    assert.equal(assertReleaseCameraMinimum(RELEASE_CAMERA_MINIMUM), RELEASE_CAMERA_MINIMUM);
  });

  it('would have refused the incident', () => {
    // The check `writeTiles` performs, stated as arithmetic so the threshold
    // is pinned to the number that actually happened.
    assert.equal(112_098 < Math.round(131_083 * TOTAL_LOSS_RATIO), true);
  });

  it('permits a normal refresh', () => {
    assert.equal(131_200 < Math.round(131_083 * TOTAL_LOSS_RATIO), false);
  });
});

describe('identity, not just population', () => {
  /*
   * THE BLIND SPOT THE COUNT CHECKS LEFT.
   *
   * Measured against the Aug-20 Overpass dump: 130,684 nodes against an archive
   * of 131,083, and 443 of the archive's ids absent from it. Every count-based
   * check passes that with room to spare.
   */
  const HELD = 131_083;
  const DUMP = 130_684;
  const VANISHED = 443;

  it('the TOTAL check waves the dump through', () => {
    assert.equal(DUMP < Math.round(HELD * TOTAL_LOSS_RATIO), false);
  });

  it('and so would a plain ratio -- 443 of 131,083 is 0.3%', () => {
    assert.equal(VANISHED / HELD > MAX_VANISHED_RATIO, false);
  });

  it('THE PATROL-CONFIRMED COUNT IS WHAT CATCHES IT', () => {
    // All 443 carry `osmVersion`, which only sync-cameras.mjs writes -- they
    // are cameras the patrol found AFTER the dump was taken, and nothing would
    // put them back because those diffs are behind its watermark.
    assert.equal(VANISHED > MAX_VANISHED_VERIFIED, true);
  });

  it('tolerates a handful of genuine deletions between runs', () => {
    assert.equal(5 > MAX_VANISHED_VERIFIED, false);
  });

  it('does not count an id already removed by the tombstone ledger as vanished', () => {
    const carried = new Map([
      ['osm:1', { verified: true }],
      ['osm:2', { verified: true }],
      ['osm:3', { verified: false }],
    ]);
    const source = new Map([[1, { id: 1 }]]);
    assert.deepEqual(
      vanishedArchiveRecords(carried, source, [{ id: 'osm:2', reason: 'osm_delete', seq: 1 }]),
      { vanished: ['osm:3'], verified: 0 },
    );
  });
});

describe('files this script does not own', () => {
  it('rescues the deletion ledger but regenerates the overview from final records', () => {
    // `writeTiles` removes OUT_DIR wholesale. Losing tombstones.json resurrects
    // every deletion; preserving overview.json would retain a stale set/count.
    assert.deepEqual(PRESERVED_SIDECARS, ['tombstones.json']);
  });
});

describe('the national overview', () => {
  it('is exact, count-matched, and deterministic when the rebuilt set changes', () => {
    const overview = buildCameraOverview([
      { id: 'osm:20', lat: 40.2, lon: -74.2 },
      { id: 'osm:3', lat: 38.3, lon: -94.3 },
    ]);

    assert.deepEqual(overview, {
      schema: 'fwm-overview/v1',
      attribution: 'Map data © OpenStreetMap contributors',
      licence: 'ODbL-1.0',
      licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      count: 2,
      // Canonical id ordering, independent of tile traversal or filesystem order.
      coords: [40.2, -74.2, 38.3, -94.3],
    });
    assert.equal(
      `${JSON.stringify(overview)}\n`,
      '{"schema":"fwm-overview/v1","attribution":"Map data © OpenStreetMap contributors","licence":"ODbL-1.0","licenceUrl":"https://opendatacommons.org/licenses/odbl/1-0/","count":2,"coords":[40.2,-74.2,38.3,-94.3]}\n',
    );
    assert.equal(buildCameraOverview([{ id: 'osm:3', lat: 38.3, lon: -94.3 }]).count, 1);
  });
});

describe('the tombstone floor', () => {
  it('orders older, equal, and newer source versions strictly', () => {
    assert.equal(isStrictlyNewerOsmVersion(6, 7), false);
    assert.equal(isStrictlyNewerOsmVersion(7, 7), false);
    assert.equal(isStrictlyNewerOsmVersion(8, 7), true);
    assert.equal(isStrictlyNewerOsmVersion(undefined, 7), false);
    assert.equal(isStrictlyNewerOsmVersion(8, undefined), false);
  });

  it('keeps blocked tombstones and clears only a provably newer live source record', () => {
    const records = [
      { id: 1, version: 6 },
      { id: 2, version: 7 },
      { id: 3, version: 8 },
      { id: 4, version: 9 },
    ];
    const tombstones = [
      { id: 'osm:1', osmVersion: 7 },
      { id: 'osm:2', osmVersion: 7 },
      { id: 'osm:3', osmVersion: 7 },
      { id: 'osm:4' },
    ];
    const resolved = reconcileTombstoneFloor(records, tombstones);

    assert.deepEqual(
      resolved.live.map((record) => record.id),
      [3],
    );
    assert.deepEqual(resolved.cleared, ['osm:3']);
    assert.deepEqual(
      resolved.blocked.map(({ id }) => id),
      ['osm:1', 'osm:2', 'osm:4'],
    );
    assert.deepEqual(
      resolved.tombstones.map(({ id }) => id),
      ['osm:1', 'osm:2', 'osm:4'],
    );
  });

  it('repairs the five verified re-additions through exact version ordering', () => {
    const deleted = new Map([
      ['osm:13334763702', 4],
      ['osm:13363740201', 2],
      ['osm:13892577535', 2],
      ['osm:13937545890', 3],
      ['osm:14054915701', 2],
    ]);
    const live = new Map([
      ['osm:13334763702', 5],
      ['osm:13363740201', 3],
      ['osm:13892577535', 3],
      ['osm:13937545890', 4],
      ['osm:14054915701', 3],
    ]);
    const resolved = reconcileTombstoneFloor(
      [...live].map(([id, osmVersion]) => ({ id, osmVersion })),
      [...deleted].map(([id, osmVersion]) => ({ id, osmVersion })),
    );

    assert.equal(resolved.live.length, 5);
    assert.deepEqual(resolved.cleared, [...live.keys()].sort());
    assert.deepEqual(resolved.tombstones, []);
  });
});

describe('input snapshot provenance', () => {
  it('requires the exact pinned US/PR adapter hand-off marker', () => {
    const fixture = releaseSourceFixture();
    const valid = fixture.dump;
    assert.equal(
      assertReleaseCameraSource(valid, fixture.trustedReviewBytes, TEST_BASELINE_VALIDATION),
      valid.cameraSource,
    );
    assert.throws(() => assertReleaseCameraSource(valid), /explicitly unapproved.*osm3s/);
    assert.throws(() => assertReleaseCameraSource({}), /missing the required US\/PR/);

    const canada = structuredClone(valid);
    canada.cameraSource.territories = ['US', 'PR', 'CA'];
    assert.throws(
      () => assertReleaseCameraSource(canada, fixture.trustedReviewBytes, TEST_BASELINE_VALIDATION),
      /not the reviewed US\/PR/,
    );

    const oldGenerator = structuredClone(valid);
    oldGenerator.generator = 'meridian/overpass-bbox';
    assert.throws(
      () =>
        assertReleaseCameraSource(
          oldGenerator,
          fixture.trustedReviewBytes,
          TEST_BASELINE_VALIDATION,
        ),
      /not the reviewed US\/PR/,
    );

    const redated = structuredClone(valid);
    redated.cameraSource.source.capturedAt = '2026-09-01T13:00:00.000Z';
    assert.throws(
      () =>
        assertReleaseCameraSource(redated, fixture.trustedReviewBytes, TEST_BASELINE_VALIDATION),
      /checked-in approved review/,
    );

    const substituted = structuredClone(valid);
    substituted.elements.push({ type: 'node', id: 1 });
    assert.throws(
      () =>
        assertReleaseCameraSource(
          substituted,
          fixture.trustedReviewBytes,
          TEST_BASELINE_VALIDATION,
        ),
      /bound reviewed archive identity/,
    );

    assert.deepEqual(BLOCKED_REVIEW.expectedTransformation, {
      sourceFeatures: 137_707,
      excludedNonNodes: 18,
      excludedTerritory: 218,
      tombstonesBlocked: 0,
      tombstonesCleared: 5,
      outputElements: 137_471,
      elementsSha256: 'bdd501207473ee30151b810684b91d398c91dee8dfdcf486cc155c0c1a67b63d',
    });
  });

  it('reads and canonicalises the standard Overpass snapshot watermark', () => {
    assert.equal(
      inputSnapshotTimestamp({ osm3s: { timestamp_osm_base: '2026-09-01T14:00:00Z' } }),
      '2026-09-01T14:00:00.000Z',
    );
    assert.equal(inputSnapshotTimestamp({}), null);
    assert.throws(
      () => inputSnapshotTimestamp({ osm3s: { timestamp_osm_base: 'not-a-date' } }),
      /invalid timestamp/,
    );
    assert.throws(
      () => inputSnapshotTimestamp({ osm3s: { timestamp_osm_base: '2026-02-30T00:00:00Z' } }),
      /invalid timestamp/,
    );
  });

  it('carries an honest mixed source and conservative base into index fields', () => {
    const dump = {
      source: 'OpenStreetMap via fresh archive plus locally carried coverage gaps',
      baseUpstream: '2026-08-20T10:00:00.000Z',
      osm3s: { timestamp_osm_base: '2026-08-20T10:00:00.000Z' },
    };
    const embedded = inputSnapshotProvenance(dump);
    assert.deepEqual(embedded, {
      source: dump.source,
      baseUpstream: dump.baseUpstream,
      upstream: dump.osm3s.timestamp_osm_base,
    });
    assert.deepEqual(
      sourceIndexFields(
        {
          source: embedded.source,
          baseUpstream: embedded.baseUpstream,
          upstream: embedded.upstream,
        },
        '2026-09-01T19:00:00.000Z',
      ),
      {
        source: dump.source,
        baseUpstream: dump.baseUpstream,
        upstream: dump.osm3s.timestamp_osm_base,
      },
    );
    assert.throws(
      () =>
        inputSnapshotProvenance({
          baseUpstream: '2026-09-02T00:00:00Z',
          osm3s: { timestamp_osm_base: '2026-09-01T00:00:00Z' },
        }),
      /newer than/,
    );
  });
});

describe('explicit rebuild target', () => {
  it('fails closed before a direct national Overpass fetch', async () => {
    await assert.rejects(
      main(['--dry']),
      /direct Overpass fetching is disabled.*Canada and Mexico/,
    );
    await assert.rejects(
      main(['--input=does-not-matter.json', '--bbox=1,2,3,4']),
      /rejects --bbox\/--zoom\/--rows\/--cols/,
    );
  });

  it('rejects an old generic bbox dump without the US/PR adapter marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-unmarked-input-'));
    const target = join(root, 'cameras');
    const input = join(root, 'old-meridian.json');
    try {
      await mkdir(target);
      await writeFile(
        input,
        `${JSON.stringify({
          generator: 'meridian/overpass-bbox',
          osm3s: { timestamp_osm_base: '2026-08-20T17:15:07.451Z' },
          elements: [],
        })}\n`,
      );
      await assert.rejects(
        main([`--input=${input}`, `--target=${target}`]),
        /missing the required US\/PR camera source marker/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe, missing, duplicate, and unknown target arguments', () => {
    assert.throws(() => resolveCameraTarget('.'), /unsafe camera target/);
    assert.throws(() => resolveCameraTarget('/'), /unsafe camera target/);
    assert.throws(() => parseFetchArgs(['--target']), /non-empty path/);
    assert.throws(
      () => parseFetchArgs(['--target=one', '--target=two']),
      /may be supplied only once/,
    );
    assert.throws(() => parseFetchArgs(['--wat']), /unknown fetch-cameras argument/);
    assert.equal(parseFetchArgs(['--input=x', '--bbox=1,2,3,4']).topologyOverride, true);
  });

  it('requires a coherent archive and rejects a symlink anywhere in the target path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-target-safety-'));
    const fake = join(root, 'fake');
    const real = join(root, 'real');
    const link = join(root, 'linked');
    try {
      await mkdir(fake);
      await writeFile(join(fake, 'index.json'), '{}\n');
      assert.throws(() => assertSafeCameraTarget(fake), /non-camera directory/);

      await mkdir(real);
      await symlink(real, link);
      assert.throws(() => resolveCameraTarget(join(link, 'cameras')), /symlink component/);

      const staging = join(root, 'staging');
      await mkdir(staging);
      await writeFile(join(staging, 'tombstones.json'), '{"tombstones":[]}\n');
      assert.doesNotThrow(() => assertSafeCameraTarget(staging));
      const unexpected = join(staging, 'notes.txt');
      await writeFile(unexpected, 'not camera data\n');
      assert.throws(() => assertSafeCameraTarget(staging), /unexpected top-level entry/);
      await rm(unexpected);
      await mkdir(join(staging, '11'));
      await symlink(real, join(staging, '11', 'linked'));
      assert.throws(() => assertSafeCameraTarget(staging), /contains symlink/);

      const hydrated = join(root, 'hydrated');
      await mkdir(join(hydrated, '11'), { recursive: true });
      await writeFile(join(hydrated, 'index.json'), '{"zoom":11,"cameras":1,"tiles":1}\n');
      await writeFile(join(hydrated, 'tombstones.json'), '{"tombstones":[]}\n');
      await writeFile(join(hydrated, 'continuity.json'), '{"schema":"fixture"}\n');
      assert.doesNotThrow(() => assertSafeCameraTarget(hydrated));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rebuilds a pre-copied staging archive without writing the default target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-baseline-target-'));
    const target = join(root, 'cameras');
    const input = join(root, 'input.json');
    try {
      await mkdir(join(target, '11', '1'), { recursive: true });
      await writeFile(
        join(target, '11', '1', '1.json'),
        `${JSON.stringify({
          z: 11,
          x: 1,
          y: 1,
          attribution: 'Map data © OpenStreetMap contributors',
          licence: 'ODbL-1.0',
          licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
          cameras: [],
        })}\n`,
      );
      const baselineTombstoneBytes = Buffer.from(
        `${JSON.stringify({
          attribution: 'Map data © OpenStreetMap contributors',
          licence: 'ODbL-1.0',
          licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
          generatedAt: '2026-09-01T09:00:00.000Z',
          upstream: '2026-09-01T09:00:00.000Z',
          tombstones: [],
        })}\n`,
      );
      await writeFile(join(target, 'tombstones.json'), baselineTombstoneBytes);
      await writeFile(
        join(target, 'index.json'),
        `${JSON.stringify({ zoom: 11, cameras: 0, tiles: 1 })}\n`,
      );
      const sourceFixture = releaseSourceFixture(
        [
          {
            type: 'node',
            id: 7,
            lat: 38.9,
            lon: -94.7,
            version: 2,
            timestamp: '2026-09-01T08:00:00Z',
            tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' },
          },
        ],
        baselineTombstoneBytes,
      );
      await writeFile(input, `${JSON.stringify(sourceFixture.dump)}\n`);

      assert.doesNotThrow(() => assertSafeCameraTarget(target));
      await main([`--input=${input}`, '--target', target, '--force'], {
        trustedReviewBytes: sourceFixture.trustedReviewBytes,
        minimumBaselineOutput: 0,
        baselineTombstoneBytes,
      });
      const index = JSON.parse(await readFile(join(target, 'index.json'), 'utf8'));
      assert.equal(index.cameras, 1);
      assert.equal(index.source, CAMERA_SOURCE_LABEL);
      assert.equal(index.baseUpstream, REVIEW.sourceWatermark.minimumOsmBase);
      assert.equal(index.upstream, REVIEW.sourceWatermark.minimumOsmBase);
      assert.equal(index.cameraSource.schema, CAMERA_SOURCE_SCHEMA);
      assert.equal(index.cameraSource.transformation.outputElements, 1);
      assert.equal(
        index.cameraSource.review.sha256,
        createHash('sha256').update(sourceFixture.trustedReviewBytes).digest('hex'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
