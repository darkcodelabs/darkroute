import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  COUNTRIES,
  assertNewOutputPath,
  assertTombstoneOnlyTarget,
  assertCaptureImplementation,
  assertReviewedReplicationFloor,
  assertSourceIndex,
  assertStableManifest,
  assertVersionedSourceRecords,
  cameraElementsSha256,
  capturedFeatureToRecord,
  getExactUrl,
  oldestSourceBuild,
  normaliseCapturedCameraPoint,
  parseDeflockArgs,
  parseReplicationState,
  recordOsmTimestamp,
  readTombstoneLedger,
  sourceHandoff,
  sourceProvenance,
  sourceTerritoryIncludes,
  toOverpassDump,
  toRecord,
  validateSourceReview,
  writeNewFileAtomic,
} from './fetch-cameras-deflock.mjs';
import {
  ATTRIBUTION,
  CAMERA_SOURCE_LABEL,
  DEFAULT_COUNTY_GEOFENCE,
  LICENCE,
  LICENCE_URL,
  RELEASE_GEOFENCE_IDENTITY,
  normalise,
} from './fetch-cameras.mjs';
import { loadCounties } from './counties.mjs';

const CAPTURE_IMPLEMENTATION_FILES = [
  'scripts/capture-deflock-source.mjs',
  'scripts/deflock-capture.mjs',
].map((path) => {
  const bytes = readFileSync(new URL(path.replace('scripts/', './'), import.meta.url));
  return {
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
});

const REVIEW = {
  schema: 'darkroute-deflock-source-review/v3',
  repository: 'flockhopper3/deflock-data',
  headSha: '8d156b24db7090e870af3f007b0caece9b3c0951',
  territories: ['US', 'PR'],
  captureImplementation: {
    files: CAPTURE_IMPLEMENTATION_FILES,
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
      sha256: 'd'.repeat(64),
      count: 1,
    },
  },
  expectedSource: {
    country: 'us',
    build: 'aaaaaaaaaaaaaaaa',
    capturedAt: '2026-09-01T14:05:00.000Z',
    total: 1,
    rawDataset: {
      path: 'scripts/data/deflock-us-source.geojson.gz',
      format: 'geojson',
      compression: 'gzip',
      bytes: 123,
      sha256: 'a'.repeat(64),
      decodedBytes: 456,
      decodedSha256: 'a'.repeat(64),
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
    elementsSha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    outputTombstones: 1,
    publishedLiveSha256: '5'.repeat(64),
    publishedTombstonesSha256: '6'.repeat(64),
  },
  sourceWatermark: {
    status: 'approved',
    captureId: '11111111-1111-4111-8111-111111111111',
    minimumOsmBase: '2026-09-01T13:30:00.000Z',
    responseLedger: {
      schema: 'deflock-overpass-response-ledger/v2',
      path: 'scripts/data/deflock-us-overpass-response-ledger.json',
      bytes: 789,
      sha256: 'b'.repeat(64),
      responseCount: 4,
      roleCounts: { count: 1, data: 1, subtraction: 2 },
      endpoints: ['https://overpass.deflock.org/api/interpreter'],
      responseBundle: {
        path: 'scripts/data/deflock-us-overpass-responses.bundle.gz',
        compression: 'gzip',
        bytes: 321,
        sha256: 'c'.repeat(64),
        responseCount: 4,
      },
    },
  },
  replicationFloor: {
    stream: 'hour',
    sequence: 10,
    timestamp: '2026-09-01T13:00:00.000Z',
    stateUrl:
      'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/000/000/010.state.txt',
  },
};

const LEGACY_REVIEW = {
  expectedSource: { manifestVersion: 'fixture-build', total: 1 },
};

const usManifest = (total = 1) => [
  { country: 'us', version: 'fixture-build', generatedAt: '2026-09-01T14:04:00.000Z', total },
];

const handoff = (cameras, total = 1) => {
  const transformation = {
    sourceFeatures: total,
    excludedNonNodes: 0,
    excludedTerritory: total - cameras.length,
    tombstonesBlocked: 0,
    tombstonesCleared: 0,
    outputElements: cameras.length,
    elementsSha256: cameraElementsSha256(cameras),
    outputTombstones: 1,
    publishedLiveSha256: '5'.repeat(64),
    publishedTombstonesSha256: '6'.repeat(64),
  };
  const expectedSource = {
    ...REVIEW.expectedSource,
    total,
    rawDataset: { ...REVIEW.expectedSource.rawDataset, featureCount: total },
  };
  return sourceHandoff({
    source: expectedSource,
    review: {
      ...REVIEW,
      expectedSource,
      expectedTransformation: transformation,
    },
    reviewSha256: 'c'.repeat(64),
    transformation,
  });
};

const provenance = sourceProvenance(REVIEW);

describe('DeFlock record metadata', () => {
  it('preserves the source OSM version and edit timestamp', () => {
    const record = toRecord(
      {
        properties: {
          osmId: '12345',
          osmType: 'node',
          osmVersion: '7',
          osmTimestamp: '2026-08-31T13:45:12Z',
          brand: 'Flock Safety',
          ref: 'CAM-42',
          startDate: '2024-05',
        },
        extent: 4096,
        loadGeometry: () => [[{ x: 2048, y: 2048 }]],
      },
      0,
      0,
      0,
    );

    assert.equal(record?.id, 'osm:12345');
    assert.equal(record?.osmVersion, 7);
    assert.equal(record?.osmTimestamp, '2026-08-31T13:45:12Z');
    assert.equal(record?.tags?.ref, 'CAM-42');
    assert.equal(record?.tags?.start_date, '2024-05');
  });

  it('emits those fields in their Overpass node names', () => {
    const cameras = [
      {
        id: 'osm:12345',
        lat: 38.9,
        lon: -94.7,
        directionDeg: 90,
        osmVersion: 7,
        osmTimestamp: '2026-08-31T13:45:12Z',
        tags: { manufacturer: 'Flock Safety' },
      },
    ];
    const dump = toOverpassDump(cameras, provenance, handoff(cameras));

    assert.equal(dump.baseUpstream, '2026-09-01T13:30:00.000Z');
    assert.equal(dump.upstream, '2026-09-01T13:30:00.000Z');
    assert.equal(dump.cameraSource.source.build, 'aaaaaaaaaaaaaaaa');
    assert.deepEqual(dump.elements[0], {
      type: 'node',
      id: 12345,
      lat: 38.9,
      lon: -94.7,
      version: 7,
      timestamp: '2026-08-31T13:45:12Z',
      tags: {
        man_made: 'surveillance',
        'surveillance:type': 'ALPR',
        direction: '90',
        manufacturer: 'Flock Safety',
      },
    });
  });

  it('carries a sync-normalised updatedAt millisecond stamp through the next rebuild', () => {
    const updatedAt = Date.parse('2026-09-01T13:45:12Z');
    assert.equal(recordOsmTimestamp({ updatedAt }), '2026-09-01T13:45:12.000Z');
    const cameras = [{ id: 'osm:12345', lat: 38.9, lon: -94.7, osmVersion: 3, updatedAt }];
    const dump = toOverpassDump(cameras, provenance, handoff(cameras));
    assert.equal(dump.elements[0].timestamp, '2026-09-01T13:45:12.000Z');
    assert.equal(recordOsmTimestamp({ updatedAt: Number.NaN }), null);
  });

  it('drops ways and preserves the primary bearing through the full hand-off', () => {
    const feature = (osmType) => ({
      properties: {
        osmId: '12345',
        osmType,
        osmVersion: 7,
        osmTimestamp: '2026-08-31T13:45:12Z',
        direction: 22.5,
        directions: '[22.5,180]',
      },
      extent: 4096,
      loadGeometry: () => [[{ x: 2048, y: 2048 }]],
    });
    assert.equal(toRecord(feature('way'), 0, 0, 0), null);

    const record = toRecord(feature('node'), 0, 0, 0);
    assert.equal(record?.directionDeg, 22.5);
    assert.equal(record?.tags?.direction, undefined);
    const dump = toOverpassDump([record], provenance, handoff([record]));
    assert.equal(dump.elements[0].tags.direction, '22.5');
    assert.equal(normalise(dump.elements[0]).directionDeg, 22.5);
  });

  it('preserves the mapper-written lowercase ANPR predicate through publication', () => {
    const record = capturedFeatureToRecord({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-94.7, 38.9] },
      properties: {
        osmId: 12345,
        osmType: 'node',
        osmVersion: 7,
        osmTimestamp: '2026-08-31T13:45:12Z',
        surveillanceType: 'anpr',
      },
    });
    const dump = toOverpassDump([record], provenance, handoff([record]));
    assert.equal(dump.elements[0].tags['surveillance:type'], 'anpr');
    assert.equal(normalise(dump.elements[0]).id, 'osm:12345');
  });

  it('refuses an unversioned or untimestamped authoritative source record', () => {
    assert.throws(
      () =>
        assertVersionedSourceRecords([
          { id: 'osm:12345', lat: 38.9, lon: -94.7, osmTimestamp: '2026-09-01T13:00:00Z' },
        ]),
      /unversioned, or untimestamped/,
    );
  });
});

describe('source-build provenance', () => {
  it('refuses redirects while fetching reviewed replication state', async () => {
    const requested = REVIEW.replicationFloor.stateUrl;
    let redirectMode = null;
    const response = (url) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from('sequenceNumber=10\n'),
    });
    const sameOrigin = await getExactUrl(requested, 'text', async (_url, options) => {
      redirectMode = options.redirect;
      return response(requested);
    });
    assert.equal(redirectMode, 'error');
    assert.equal(sameOrigin.body, 'sequenceNumber=10\n');
    await assert.rejects(
      () =>
        getExactUrl(requested, 'text', async () =>
          response('https://attacker.invalid/replication.state.txt'),
        ),
      /resolved to an unreviewed URL/,
    );
  });

  it('uses the oldest constituent build and rejects an unusable timestamp', () => {
    assert.equal(
      oldestSourceBuild(['2026-09-01T14:00:15Z', '2026-09-01T13:59:45Z']),
      '2026-09-01T13:59:45.000Z',
    );
    assert.throws(() => oldestSourceBuild([]), /no source-build timestamps/);
    assert.throws(() => oldestSourceBuild(['yesterday']), /invalid generatedAt/);
    assert.throws(() => oldestSourceBuild(['2026-02-30T00:00:00Z']), /invalid generatedAt/);
  });

  it('uses the minimum actual response watermark, never runner or build time', () => {
    assert.deepEqual(provenance, {
      source: CAMERA_SOURCE_LABEL,
      baseUpstream: '2026-09-01T13:30:00.000Z',
      upstream: '2026-09-01T13:30:00.000Z',
    });
    const dump = toOverpassDump([], provenance, handoff([]));
    assert.equal(dump.source, provenance.source);
    assert.equal(dump.baseUpstream, provenance.baseUpstream);
    assert.equal(dump.upstream, provenance.baseUpstream);
  });

  it('requires a body-bound retained response bundle in an approved receipt', () => {
    const missingBundle = structuredClone(REVIEW);
    delete missingBundle.sourceWatermark.responseLedger.responseBundle;
    assert.throws(() => validateSourceReview(missingBundle), /body-bound response ledger/);
  });

  it('rejects every legacy approved receipt and direct receipts missing required trust inputs', () => {
    const legacyApproved = structuredClone(REVIEW);
    legacyApproved.schema = 'darkroute-deflock-source-review/v2';
    delete legacyApproved.captureImplementation;
    delete legacyApproved.releaseInputs;
    assert.throws(() => validateSourceReview(legacyApproved), /not the approved US\/PR receipt/);

    const missingImplementation = structuredClone(REVIEW);
    delete missingImplementation.captureImplementation;
    assert.throws(() => validateSourceReview(missingImplementation), /pinned query implementation/);

    const missingReleaseInputs = structuredClone(REVIEW);
    delete missingReleaseInputs.releaseInputs;
    assert.throws(() => validateSourceReview(missingReleaseInputs), /pinned query implementation/);
  });

  it('binds approval to the exact checked-in capture implementation bytes', () => {
    assert.equal(assertCaptureImplementation(REVIEW), REVIEW.captureImplementation);
    const changed = structuredClone(REVIEW);
    changed.captureImplementation.files[0].sha256 = '0'.repeat(64);
    assert.throws(() => assertCaptureImplementation(changed), /does not match its receipt/);
  });

  it('pins the exact release geofence and tombstone input identities', () => {
    const changedGeofence = structuredClone(REVIEW);
    changedGeofence.releaseInputs.geofence.sha256 = '0'.repeat(64);
    assert.throws(
      () => validateSourceReview(changedGeofence),
      /does not bind its geofence and tombstone inputs/,
    );
    const changedTombstones = structuredClone(REVIEW);
    changedTombstones.releaseInputs.tombstones.count = 0;
    changedTombstones.expectedTransformation.tombstonesBlocked = 1;
    changedTombstones.expectedTransformation.outputElements = -1;
    assert.throws(() => validateSourceReview(changedTombstones), /expected transformation/);
  });

  it('binds the reviewed minimum watermark to one exact official hourly interval', () => {
    assert.equal(validateSourceReview(REVIEW), REVIEW);
    const floor = parseReplicationState(
      'sequenceNumber=10\ntimestamp=2026-09-01T13\\:00\\:00Z\n',
      'floor',
    );
    const next = parseReplicationState(
      'sequenceNumber=11\ntimestamp=2026-09-01T15\\:00\\:00Z\n',
      'next',
    );
    assert.equal(floor.timestamp, '2026-09-01T13:00:00.000Z');
    assert.equal(assertReviewedReplicationFloor(REVIEW, floor, next), REVIEW.replicationFloor);
    assert.throws(
      () =>
        assertReviewedReplicationFloor(REVIEW, floor, {
          sequence: 11,
          timestamp: '2026-09-01T13:20:00.000Z',
        }),
      /not in the replay overlap interval/,
    );
  });

  it('explicitly refuses the historical receipt whose response watermarks were not retained', () => {
    const blocked = JSON.parse(
      readFileSync(new URL('./data/deflock-us-source-review.json', import.meta.url), 'utf8'),
    );
    assert.equal(blocked.sourceWatermark.status, 'unapproved');
    assert.equal(blocked.replicationFloor, null);
    assert.throws(() => validateSourceReview(blocked), /explicitly unapproved.*osm3s/);
  });

  it('requires the companion index to agree with the reviewed manifest identity', () => {
    const manifest = usManifest()[0];
    const index = { version: 1, build: 'fixture-build', count: 1 };
    assert.equal(assertSourceIndex(index, manifest, LEGACY_REVIEW), index);
    assert.throws(
      () => assertSourceIndex({ ...index, count: 2 }, manifest, LEGACY_REVIEW),
      /do not identify the reviewed build/,
    );
  });

  it('rejects a manifest rollover or an unidentifiable source build', () => {
    const manifest = {
      version: 'abc123',
      generatedAt: '2026-09-01T14:00:00Z',
      total: 137_000,
    };
    assert.equal(assertStableManifest(manifest, structuredClone(manifest), 'us'), manifest);
    assert.throws(
      () => assertStableManifest(manifest, { ...manifest, version: 'def456' }, 'us'),
      /changed while its archive was being fetched/,
    );
    assert.throws(
      () => assertStableManifest({ ...manifest, version: '' }, manifest, 'us'),
      /no usable build identity/,
    );
  });
});

describe('release territory', () => {
  it('keeps polygon-contained US/PR and drops coastal uncertainty and USVI', () => {
    const counties = loadCounties(DEFAULT_COUNTY_GEOFENCE);
    assert.equal(sourceTerritoryIncludes({ lat: 34.1597, lon: -118.1478 }, counties), true);
    assert.equal(sourceTerritoryIncludes({ lat: 18.15, lon: -65.44 }, counties), true);
    assert.equal(sourceTerritoryIncludes({ lat: 51.88, lon: -176.65 }, counties), true);
    assert.equal(sourceTerritoryIncludes({ lat: 52.9, lon: 173.2 }, counties), true);
    assert.equal(sourceTerritoryIncludes({ lat: 27.6327, lon: -97.2352 }, counties), false);
    assert.equal(sourceTerritoryIncludes({ lat: 17.7563859, lon: -64.6324396 }, counties), false);
    assert.equal(sourceTerritoryIncludes({ lat: 18.3449583, lon: -64.9772912 }, counties), false);
    assert.equal(sourceTerritoryIncludes({ lat: 49.2827, lon: -123.1207 }, counties), false);
    assert.equal(sourceTerritoryIncludes({ lat: 19.4223, lon: -99.0948 }, counties), false);
  });

  it('uses the builder five-decimal point before territorial admission', () => {
    const counties = loadCounties(DEFAULT_COUNTY_GEOFENCE);
    const raw = { lat: 60.516007, lon: -173.1169001 };
    const published = normaliseCapturedCameraPoint(raw);
    assert.equal(sourceTerritoryIncludes(raw, counties), true);
    assert.deepEqual(published, { lat: 60.51601, lon: -173.1169 });
    assert.equal(sourceTerritoryIncludes(published, counties), false);
  });
});

describe('adapter CLI', () => {
  it('uses only the documented US and Puerto Rico source archive', () => {
    assert.deepEqual(COUNTRIES, ['us']);
  });

  it('never carries the archive being replaced, even with the obsolete migration flag', () => {
    assert.deepEqual(
      parseDeflockArgs([
        '--dry',
        '--out=/tmp/cameras',
        '--overpass',
        '/tmp/osm.json',
        '--source-review=/tmp/review.json',
      ]),
      {
        dry: true,
        out: '/tmp/cameras',
        overpass: '/tmp/osm.json',
        sourceReview: '/tmp/review.json',
      },
    );
    assert.throws(() => parseDeflockArgs(['--out=a', '--out', 'b']), /may be supplied only once/);
    assert.throws(
      () => parseDeflockArgs(['--carry-base-upstream=2026-08-20T17:15:07.451Z']),
      /local archive carry is unsupported/,
    );
    assert.throws(
      () => parseDeflockArgs(['--carry-existing']),
      /local archive carry is unsupported/,
    );
    assert.throws(() => parseDeflockArgs(['--unknown']), /unknown fetch-cameras-deflock/);
    assert.throws(
      () => parseDeflockArgs(['--source-review=x', '--overpass=y']),
      /--out is required/,
    );
    assert.throws(
      () => parseDeflockArgs(['--source-review=x', '--out=y']),
      /--overpass is required/,
    );
  });
});

describe('release adapter filesystem safety', () => {
  const tombstoneLedger = (tombstones = []) => ({
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    generatedAt: '2026-09-01T20:00:00.000Z',
    upstream: '2026-09-01T20:00:00Z',
    tombstones,
  });

  it('requires one full-schema, unique tombstone ledger and no live archive', () => {
    const root = mkdtempSync(join(tmpdir(), 'camera-adapter-stage-'));
    const stage = join(root, 'cameras');
    mkdirSync(stage);
    try {
      assert.throws(() => readTombstoneLedger(stage), /required.*ledger is missing/);
      const duplicate = tombstoneLedger([
        { id: 'osm:1', reason: 'osm_delete', seq: 10, osmVersion: 2 },
        { id: 'osm:1', reason: 'osm_delete', seq: 11, osmVersion: 3 },
      ]);
      writeFileSync(join(stage, 'tombstones.json'), JSON.stringify(duplicate));
      assert.throws(() => readTombstoneLedger(stage), /duplicate, or unsorted/);

      const valid = tombstoneLedger([
        { id: 'osm:1', reason: 'osm_delete', seq: 10, osmVersion: 2 },
      ]);
      writeFileSync(join(stage, 'tombstones.json'), JSON.stringify(valid));
      assert.equal(readTombstoneLedger(stage).identity.count, 1);
      assert.equal(assertTombstoneOnlyTarget(stage), stage);
      mkdirSync(join(stage, '11'));
      assert.throws(() => assertTombstoneOnlyTarget(stage), /tombstone-only|non-camera/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('publishes only to a new non-symlink output path without overwriting', () => {
    const root = mkdtempSync(join(tmpdir(), 'camera-adapter-output-'));
    try {
      const output = join(root, 'source.json');
      assert.equal(writeNewFileAtomic(output, 'first'), output);
      assert.equal(readFileSync(output, 'utf8'), 'first');
      assert.throws(() => writeNewFileAtomic(output, 'second'), /must be a new file/);
      assert.equal(readFileSync(output, 'utf8'), 'first');

      const real = join(root, 'real');
      const linked = join(root, 'linked');
      mkdirSync(real);
      symlinkSync(real, linked, 'dir');
      assert.throws(() => assertNewOutputPath(join(linked, 'escape.json')), /symlink component/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
