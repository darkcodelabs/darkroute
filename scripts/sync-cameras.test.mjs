/**
 * THE PATROL'S RULE TABLE - the logic that decides what gets DELETED.
 *
 * This is the highest-consequence code in the repo: it removes records from a
 * counter-surveillance dataset, and a wrong removal is a camera a driver is
 * never warned about. It shipped with no tests at all, while a street-name
 * lookup beside it had a full suite.
 *
 * Every case below is a bug that was actually in the file, found by audit
 * rather than by reasoning:
 *
 *   - an id prefixed twice, making 253 records invisible to their own patrol
 *   - way ids colliding with node ids, so a deleted building in Ohio would
 *     tombstone a camera in Texas
 *   - a footprint check that treated "outside the box" as "no longer a camera",
 *     which would have deleted every camera in Alaska, Hawaii and Puerto Rico
 *   - create-then-delete and untag-then-retag inside one batch publishing both
 *     an addition and a removal for the same id
 *
 * They are tests now because reasoning about them clearly did not work.
 */

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  normaliseState as normaliseGenerationState,
  readLocalGeneration,
} from './camera-generation.mjs';
import {
  approvedCameraSourceFixture,
  makeCameraFixture,
} from './camera-generation-test-helpers.mjs';
import { DEFAULT_OUT_DIR, latLonToTile, normaliseCoordinate } from './fetch-cameras.mjs';
import { loadCounties } from './counties.mjs';
import {
  DEFAULT_COUNTY_GEOFENCE,
  DEFAULT_STATE_FILE,
  advanceArchiveIndex,
  advancedSyncState,
  assertArchiveContinuity,
  assertCanCatchUp,
  assertHeadCompatible,
  assertSafeStateFile,
  createTerritorialFootprint,
  currentSequence,
  decide,
  firstRunState,
  forEachElement,
  indexTombstoneLedger,
  materialiseStagedUpsert,
  normaliseStagedUpsert,
  osmChangeElement,
  parseSequenceState,
  parseSyncArgs,
  reconcileTombstones,
  resolveAppliedState,
  sequenceState,
  sequenceStateUrl,
  stageElementChange,
  validateSyncState,
  writeCameraTile,
} from './sync-cameras.mjs';

test('large replication diffs use a fresh native HTTPS socket and parse completely', async () => {
  const xml =
    '<osmChange version="0.6"><modify><node id="7" version="3" lat="1" lon="2" ' +
    'timestamp="2026-09-01T20:00:00Z"><tag k="surveillance:type" v="ALPR"/>' +
    '</node></modify></osmChange>';
  let requestOptions;
  const request = (_url, options, callback) => {
    requestOptions = options;
    const pending = new EventEmitter();
    queueMicrotask(() => {
      const response = Readable.from([gzipSync(xml)]);
      response.statusCode = 200;
      callback(response);
    });
    return pending;
  };
  const elements = [];

  await forEachElement(
    'https://example.test/one.osc.gz',
    (element) => {
      elements.push(element);
    },
    request,
  );

  assert.equal(requestOptions.agent, false);
  assert.equal(requestOptions.headers['User-Agent'].includes('DarkRoute'), true);
  assert.deepEqual(elements, [
    {
      action: 'modify',
      type: 'node',
      id: '7',
      version: 3,
      lat: 1,
      lon: 2,
      timestamp: '2026-09-01T20:00:00Z',
      tags: { 'surveillance:type': 'ALPR' },
    },
  ]);
});

/** An OSM element as `forEachElement` yields it. */
function node(over = {}) {
  return {
    action: 'modify',
    type: 'node',
    id: '14111437001',
    version: 3,
    lat: 38.9183,
    lon: -94.692,
    tags: { 'surveillance:type': 'ALPR', man_made: 'surveillance' },
    ...over,
  };
}

/** A record we already hold. */
const KNOWN = { id: 'osm:14111437001', lat: 38.9183, lon: -94.692 };

test('a camera inside the footprint is upserted', () => {
  assert.equal(decide(node({ action: 'create' }), undefined).kind, 'upsert');
  assert.equal(decide(node(), KNOWN).kind, 'upsert');
});

test('ANPR counts as well as ALPR', () => {
  assert.equal(
    decide(node({ tags: { man_made: 'surveillance', 'surveillance:type': 'anpr' } }), undefined)
      .kind,
    'upsert',
  );
});

test('both source-query tags are required', () => {
  for (const tags of [
    { 'surveillance:type': 'ALPR' },
    { man_made: 'camera', 'surveillance:type': 'ALPR' },
    { man_made: 'surveillance' },
  ]) {
    assert.equal(decide(node({ tags }), undefined).kind, 'ignore');
    assert.deepEqual(decide(node({ tags }), KNOWN), { kind: 'tombstone', reason: 'osm_untag' });
  }
});

test('a delete of an id we hold is a tombstone, and needs no tags', () => {
  // Deletions carry no tags at all -- that is the whole reason the patrol is
  // driven by our own id set rather than by filtering the stream.
  const verdict = decide(node({ action: 'delete', tags: {}, lat: null, lon: null }), KNOWN);
  assert.equal(verdict.kind, 'tombstone');
  assert.equal(verdict.reason, 'osm_delete');
});

test('a delete of an id we do NOT hold is ignored', () => {
  assert.equal(decide(node({ action: 'delete', tags: {} }), undefined).kind, 'ignore');
});

test('create and modify require finite ranged coordinates before removal logic', () => {
  for (const coordinates of [
    { lat: null, lon: -94.692 },
    { lat: 38.9183, lon: null },
    { lat: Number.NaN, lon: -94.692 },
    { lat: 91, lon: -94.692 },
    { lat: 38.9183, lon: 181 },
  ]) {
    assert.throws(() => decide(node(coordinates), KNOWN), /invalid action or coordinates/);
    assert.throws(() => decide(node(coordinates), undefined), /invalid action or coordinates/);
  }
  assert.throws(() => decide(node({ action: 'unknown' }), KNOWN), /invalid action or coordinates/);
});

test('a modify that drops the ALPR tag tombstones -- the invisible retag', () => {
  const verdict = decide(node({ tags: { man_made: 'surveillance' } }), KNOWN);
  assert.equal(verdict.kind, 'tombstone');
  assert.equal(verdict.reason, 'osm_untag');
});

test('WAYS AND RELATIONS ARE IGNORED ENTIRELY', () => {
  // OSM ids are unique only WITHIN a type. 210 camera node ids fall inside the
  // live way id range, so without this a deleted building removes a camera.
  for (const type of ['way', 'relation']) {
    assert.equal(decide(node({ type, action: 'delete', tags: {} }), KNOWN).kind, 'ignore');
    assert.equal(decide(node({ type }), KNOWN).kind, 'ignore');
  }
});

test('an unknown camera outside the footprint is ignored; a known move is tombstoned', () => {
  // Guam, and anywhere else beyond the box, is irrelevant when unknown. A
  // newer version of an id we hold must remove the stale in-scope coordinates.
  const guam = node({ lat: 13.44, lon: 144.79 });
  assert.equal(decide(guam, undefined).kind, 'ignore');
  assert.deepEqual(decide(guam, KNOWN), {
    kind: 'tombstone',
    reason: 'osm_out_of_scope',
  });
  const tombstones = new Map();
  assert.deepEqual(stageElementChange(guam, 122_462, KNOWN, new Map(), tombstones), {
    kind: 'tombstone',
    reason: 'osm_out_of_scope',
  });
  assert.deepEqual(tombstones.get(KNOWN.id), {
    id: KNOWN.id,
    reason: 'osm_out_of_scope',
    seq: 122_462,
    osmVersion: 3,
  });
});

test('Alaska across the antimeridian, Hawaii and Puerto Rico are INSIDE the footprint', () => {
  // 315 committed cameras sit in these three, under an old box whose comment
  // claimed "enough margin for Alaska and Hawaii" while excluding both.
  for (const [lat, lon] of [
    [20.88, -156.67], // Maui
    [18.15, -65.44], // Vieques
    [18.48, -66.79], // Arecibo
    [61.19, -149.87], // Anchorage
    [51.88, -176.65], // Adak, Aleutian Islands
    [52.9, 173.2], // Attu, Aleutian Islands
  ]) {
    assert.equal(decide(node({ lat, lon }), undefined).kind, 'upsert', `${lat},${lon}`);
  }
});

test('the vendored Census geofence admits US and Puerto Rico, not Vancouver or Mexico', () => {
  assert.equal(
    createHash('sha256').update(readFileSync(DEFAULT_COUNTY_GEOFENCE)).digest('hex'),
    'e540149b7525e71ee6b6cab6dea2a95205f11e0c3e7374d27a7c9c47ea96e8c0',
  );
  const inside = createTerritorialFootprint(loadCounties(DEFAULT_COUNTY_GEOFENCE));

  for (const [lat, lon] of [
    [34.1597, -118.1478], // Pasadena, California
    [18.15, -65.44], // Vieques, Puerto Rico
    [51.88, -176.65], // Adak, Alaska
    [52.9, 173.2], // Attu, Alaska
  ]) {
    assert.equal(decide(node({ lat, lon }), undefined, inside).kind, 'upsert');
  }
  for (const [lat, lon] of [
    [49.2827, -123.1207], // Vancouver, Canada
    [19.4223, -99.0948], // Mexico City, Mexico
  ]) {
    assert.equal(decide(node({ lat, lon }), undefined, inside).kind, 'ignore');
  }

  // The source baseline uses the same strict polygons; a nearby tile is not
  // evidence of territory for either a known or a new offshore point.
  const coastal = { ...KNOWN, lat: 27.6327, lon: -97.2352 };
  assert.deepEqual(decide(node({ lat: 27.63275, lon: -97.23525 }), coastal, inside), {
    kind: 'tombstone',
    reason: 'osm_out_of_scope',
  });
  assert.equal(decide(node({ lat: 27.6327, lon: -97.2352 }), undefined, inside).kind, 'ignore');

  // Existing membership is not a passport for an arbitrary international
  // move. Vancouver lies inside the coarse Alaska-sized rectangle.
  assert.deepEqual(decide(node({ lat: 49.2827, lon: -123.1207 }), KNOWN, inside), {
    kind: 'tombstone',
    reason: 'osm_out_of_scope',
  });
});

test('territory, county, stored point, and z11 tile use the same five-decimal coordinate', () => {
  const counties = loadCounties(DEFAULT_COUNTY_GEOFENCE);
  const inside = createTerritorialFootprint(counties);

  // This raw point is barely inside the simplified Alaska polygon, but the
  // point we actually publish is outside after five-decimal normalisation.
  const roundedOut = node({ lat: 60.516007, lon: -173.1169001 });
  assert.notEqual(counties.lookup(roundedOut.lat, roundedOut.lon), null);
  assert.equal(
    counties.lookup(normaliseCoordinate(roundedOut.lat), normaliseCoordinate(roundedOut.lon)),
    null,
  );
  assert.equal(decide(roundedOut, undefined, inside).kind, 'ignore');

  // The inverse edge is admitted because the exact published point is inside.
  const roundedIn = node({
    id: '14111437002',
    lat: 60.516002,
    lon: -173.1169099,
  });
  assert.equal(counties.lookup(roundedIn.lat, roundedIn.lon), null);
  assert.notEqual(
    counties.lookup(normaliseCoordinate(roundedIn.lat), normaliseCoordinate(roundedIn.lon)),
    null,
  );
  assert.equal(decide(roundedIn, undefined, inside).kind, 'upsert');

  // Monroe County straddles a z11 meridian at the rounding boundary. The raw
  // point maps to x=563, while the stored point maps to x=562.
  const tileBoundary = node({
    id: '14111437003',
    lat: 25.2,
    lon: -81.03515615,
  });
  const upserts = new Map();
  assert.equal(
    stageElementChange(tileBoundary, 122_462, undefined, upserts, new Map(), inside).kind,
    'upsert',
  );
  const staged = upserts.get('osm:14111437003');
  const materialised = materialiseStagedUpsert(staged, counties);
  assert.equal(staged.lon, -81.03516);
  assert.equal(materialised.record.lon, staged.lon);
  assert.equal(materialised.record.countyFips, counties.lookup(staged.lat, staged.lon).fips);
  assert.equal(latLonToTile(tileBoundary.lat, tileBoundary.lon, 11).x, 563);
  assert.equal(materialised.x, 562);
  assert.deepEqual(
    { z: materialised.z, x: materialised.x, y: materialised.y },
    latLonToTile(materialised.record.lat, materialised.record.lon, 11),
  );
});

test('the replay guard drops a version we already have', () => {
  const held = { ...KNOWN, osmVersion: 7 };
  assert.equal(decide(node({ version: 7 }), held).kind, 'ignore');
  assert.equal(decide(node({ version: 6 }), held).kind, 'ignore');
  assert.equal(decide(node({ version: 8 }), held).kind, 'upsert');
});

test('an unknown stored version does not block anything', () => {
  // The degraded case: essentially every committed record lacks osmVersion.
  assert.equal(decide(node({ version: 1 }), KNOWN).kind, 'upsert');
});

test('a non-camera we have never seen is ignored, not tombstoned', () => {
  assert.equal(decide(node({ tags: { amenity: 'bench' } }), undefined).kind, 'ignore');
});

test('a later live retag removes the id from the tombstone ledger', () => {
  const removed = decide(node({ tags: { man_made: 'surveillance' } }), KNOWN);
  assert.deepEqual(removed, { kind: 'tombstone', reason: 'osm_untag' });

  // After removal the live table no longer holds the record. A later modify
  // that restores the qualifying tag is therefore an upsert against undefined.
  assert.deepEqual(decide(node({ version: 4 }), undefined), { kind: 'upsert' });

  const prior = [
    { id: KNOWN.id, reason: removed.reason, seq: 100 },
    { id: 'osm:still-gone', reason: 'osm_delete', seq: 99 },
  ];
  const restored = new Map([[KNOWN.id, { seq: 101 }]]);
  assert.deepEqual(reconcileTombstones(prior, new Map(), restored), [
    { id: 'osm:still-gone', reason: 'osm_delete', seq: 99 },
  ]);
});

test('a higher version later in the same hourly diff clears a pending tombstone', () => {
  const upserts = new Map();
  const tombstones = new Map();
  const untagged = node({ version: 6, tags: { man_made: 'surveillance' } });
  const restored = node({ version: 7 });

  assert.deepEqual(stageElementChange(untagged, 122_462, KNOWN, upserts, tombstones), {
    kind: 'tombstone',
    reason: 'osm_untag',
  });
  assert.deepEqual(stageElementChange(restored, 122_462, KNOWN, upserts, tombstones), {
    kind: 'upsert',
  });
  assert.equal(tombstones.size, 0);
  assert.equal(upserts.get(KNOWN.id)?.osmVersion, 7);
});

test('a tombstone later in the same run still wins over an upsert', () => {
  const latest = { id: KNOWN.id, reason: 'osm_delete', seq: 102 };
  assert.deepEqual(
    reconcileTombstones([], new Map([[KNOWN.id, latest]]), new Map([[KNOWN.id, {}]])),
    [latest],
  );
});

test('pending create followed by a later delete finishes tombstoned with its OSM version', () => {
  const upserts = new Map();
  const tombstones = new Map();

  assert.equal(
    stageElementChange(node({ action: 'create', version: 3 }), 100, undefined, upserts, tombstones)
      .kind,
    'upsert',
  );
  assert.equal(
    stageElementChange(
      node({ action: 'delete', version: 4, tags: {}, lat: null, lon: null }),
      101,
      undefined,
      upserts,
      tombstones,
    ).kind,
    'tombstone',
  );

  assert.equal(upserts.size, 0);
  assert.deepEqual(tombstones.get(KNOWN.id), {
    id: KNOWN.id,
    reason: 'osm_delete',
    seq: 101,
    osmVersion: 4,
  });
});

test('a diff element without a usable OSM version fails closed', () => {
  assert.throws(
    () => stageElementChange(node({ version: 0 }), 100, KNOWN, new Map(), new Map()),
    /invalid version/,
  );
});

test('pending create followed by a later untag also finishes tombstoned', () => {
  const upserts = new Map();
  const tombstones = new Map();

  stageElementChange(node({ action: 'create', version: 8 }), 200, undefined, upserts, tombstones);
  stageElementChange(
    node({ version: 9, tags: { man_made: 'surveillance' } }),
    201,
    undefined,
    upserts,
    tombstones,
  );

  assert.equal(upserts.size, 0);
  assert.deepEqual(tombstones.get(KNOWN.id), {
    id: KNOWN.id,
    reason: 'osm_untag',
    seq: 201,
    osmVersion: 9,
  });
});

test('a still-later live version clears a pending tombstone, but an older replay cannot', () => {
  const upserts = new Map();
  const tombstones = new Map();

  stageElementChange(
    node({ action: 'delete', version: 6, tags: {} }),
    300,
    KNOWN,
    upserts,
    tombstones,
  );
  assert.equal(
    stageElementChange(node({ version: 5 }), 301, KNOWN, upserts, tombstones).kind,
    'ignore',
  );
  assert.equal(tombstones.get(KNOWN.id)?.osmVersion, 6);

  assert.equal(
    stageElementChange(node({ version: 7 }), 302, KNOWN, upserts, tombstones).kind,
    'upsert',
  );
  assert.equal(tombstones.has(KNOWN.id), false);
  assert.equal(upserts.get(KNOWN.id)?.osmVersion, 7);
});

test('the existing tombstone ledger participates in version and sequence ordering', () => {
  const upserts = new Map();
  const pendingTombstones = new Map();
  const versioned = { id: KNOWN.id, reason: 'osm_delete', seq: 100, osmVersion: 7 };

  assert.equal(
    stageElementChange(node({ version: 7 }), 101, versioned, upserts, pendingTombstones).kind,
    'ignore',
  );
  assert.equal(
    stageElementChange(node({ version: 6 }), 102, versioned, upserts, pendingTombstones).kind,
    'ignore',
  );
  assert.equal(
    stageElementChange(node({ version: 8 }), 103, versioned, upserts, pendingTombstones).kind,
    'upsert',
  );

  upserts.clear();
  const unknown = { id: KNOWN.id, reason: 'osm_delete', seq: 200 };
  assert.equal(
    stageElementChange(node({ version: 1 }), 200, unknown, upserts, pendingTombstones).kind,
    'ignore',
  );
  assert.equal(
    stageElementChange(node({ version: 1 }), 201, unknown, upserts, pendingTombstones).kind,
    'upsert',
  );
});

test('the tombstone ledger rejects malformed and duplicate ordering records', () => {
  assert.equal(
    indexTombstoneLedger([{ id: KNOWN.id, reason: 'osm_delete', seq: 10, osmVersion: 2 }]).get(
      KNOWN.id,
    )?.osmVersion,
    2,
  );
  assert.throws(
    () => indexTombstoneLedger([{ id: KNOWN.id, reason: 'osm_delete', seq: -1 }]),
    /invalid tombstone/,
  );
  assert.throws(
    () =>
      indexTombstoneLedger([
        { id: KNOWN.id, reason: 'osm_delete', seq: 1 },
        { id: KNOWN.id, reason: 'osm_untag', seq: 2 },
      ]),
    /duplicate tombstone/,
  );
});

test('a valid OsmChange timestamp survives staging and normalisation', () => {
  const upserts = new Map();
  const parsed = osmChangeElement('modify', 'node', {
    id: KNOWN.id.slice(4),
    version: '3',
    lat: '38.9183',
    lon: '-94.692',
    timestamp: '2026-09-01T18:04:05Z',
  });
  parsed.tags = { 'surveillance:type': 'ALPR', man_made: 'surveillance' };
  stageElementChange(parsed, 300, undefined, upserts, new Map());
  const staged = upserts.get(KNOWN.id);
  assert.equal(staged?.timestamp, '2026-09-01T18:04:05Z');
  assert.equal(normaliseStagedUpsert(staged).updatedAt, Date.parse('2026-09-01T18:04:05Z'));
  assert.throws(
    () =>
      stageElementChange(
        node({ timestamp: 'not-a-timestamp' }),
        301,
        undefined,
        new Map(),
        new Map(),
      ),
    /invalid timestamp/,
  );
});

test('state file selection is explicit for automation and backward-compatible for manual runs', () => {
  assert.deepEqual(parseSyncArgs([]), {
    dryRun: false,
    geofence: DEFAULT_COUNTY_GEOFENCE,
    limit: 24,
    requireCaughtUp: false,
    stateFile: DEFAULT_STATE_FILE,
    target: DEFAULT_OUT_DIR,
  });
  assert.deepEqual(
    parseSyncArgs([
      '--dry-run',
      '--require-caught-up',
      '--max=3',
      '--state-file',
      '.state/generation.json',
      '--target=/tmp/camera-sync-stage',
    ]),
    {
      dryRun: true,
      geofence: DEFAULT_COUNTY_GEOFENCE,
      limit: 3,
      requireCaughtUp: true,
      stateFile: '.state/generation.json',
      target: '/tmp/camera-sync-stage',
    },
  );
  assert.equal(parseSyncArgs(['--max', '7', '--state-file=x.json']).limit, 7);
  assert.equal(
    parseSyncArgs(['--target', '/tmp/camera-sync-other']).target,
    '/tmp/camera-sync-other',
  );
  assert.throws(() => parseSyncArgs(['--state-file=']), /non-empty value/);
  assert.throws(() => parseSyncArgs(['--state-file']), /requires a value/);
  assert.throws(() => parseSyncArgs(['--state-file=a.json', '--state-file=b.json']), /only once/);
  assert.throws(() => parseSyncArgs(['--max=2', '--max', '3']), /only once/);
  assert.throws(
    () => parseSyncArgs(['--geofence=/tmp/us-counties.geojson']),
    /pinned.*cannot be overridden/,
  );
  assert.throws(() => parseSyncArgs(['--target=a', '--target', 'b']), /only once/);
  assert.throws(() => parseSyncArgs(['--dry-run', '--dry-run']), /only once/);
  assert.throws(() => parseSyncArgs(['--max', '0']), /positive integer/);
  assert.throws(() => parseSyncArgs(['--surprise']), /unknown sync-cameras argument/);
});

test('state file writes reject symlink components and non-file targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'camera-state-safety-'));
  try {
    const real = join(root, 'real');
    mkdirSync(real);
    const linked = join(root, 'linked');
    symlinkSync(real, linked);
    assert.throws(() => assertSafeStateFile(join(linked, 'state.json')), /symlink component/);
    assert.throws(() => assertSafeStateFile(real), /not a regular file/);
    assert.equal(assertSafeStateFile(join(root, 'state.json')), join(root, 'state.json'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('caught-up publication bounds and replication head contradictions fail before writes', () => {
  const state = {
    stream: 'hour',
    lastAppliedSeq: 100,
    lastAppliedTimestamp: '2026-09-01T10:00:00Z',
    versionsKnown: false,
  };
  const head = { seq: 125, timestamp: '2026-09-02T11:00:00Z' };
  assert.doesNotThrow(() => assertCanCatchUp(state, head, 25, true));
  assert.throws(() => assertCanCatchUp(state, head, 24, true), /cannot reach head/);
  assert.doesNotThrow(() => assertCanCatchUp(state, head, 1, false));
  assert.throws(
    () => assertCanCatchUp({ ...state, lastAppliedSeq: null }, head, 25, true),
    /established replication watermark/,
  );

  assert.throws(
    () => assertHeadCompatible(state, { seq: 99, timestamp: '2026-09-01T09:00:00Z' }),
    /behind watermark/,
  );
  assert.throws(
    () => assertHeadCompatible(state, { seq: 100, timestamp: '2026-09-01T10:01:00Z' }),
    /disagrees with watermark timestamp/,
  );
  assert.doesNotThrow(() =>
    assertHeadCompatible(state, { seq: 100, timestamp: state.lastAppliedTimestamp }),
  );
});

test('archive baseline and replication watermark form one exact continuity boundary', async () => {
  const state = {
    stream: 'hour',
    lastAppliedSeq: 122170,
    lastAppliedTimestamp: '2026-08-20T17:00:00Z',
    versionsKnown: false,
  };
  const states = new Map([
    [122170, { seq: 122170, timestamp: '2026-08-20T17:00:00Z' }],
    [122171, { seq: 122171, timestamp: '2026-08-20T18:00:00Z' }],
  ]);
  const stateFor = async (seq) => states.get(seq);

  await assert.doesNotReject(
    assertArchiveContinuity(state, { upstream: '2026-08-20T17:15:07.451Z' }, stateFor),
  );
  await assert.doesNotReject(
    assertArchiveContinuity(state, { upstream: '2026-08-20T17:00:00Z' }, stateFor),
  );
  await assert.doesNotReject(
    assertArchiveContinuity(
      { ...state, lastAppliedTimestamp: '2026-08-20T17:00:00.000Z' },
      { upstream: '2026-08-20T17:00:00.000Z' },
      stateFor,
    ),
  );
  await assert.rejects(
    assertArchiveContinuity(
      { ...state, lastAppliedTimestamp: '2026-08-20T16:00:00Z' },
      { upstream: '2026-08-20T17:15:07.451Z' },
      stateFor,
    ),
    /disagrees with sequence/,
  );
  await assert.rejects(
    assertArchiveContinuity(state, { upstream: '2026-08-20T16:59:59.000Z' }, stateFor),
    /continuity has a gap/,
  );
  await assert.rejects(
    assertArchiveContinuity(state, { upstream: '2026-08-20T18:00:00.000Z' }, stateFor),
    /not the latest replication boundary/,
  );
});

test('first-run state is directly consumable by the generation schema', () => {
  const state = firstRunState({ seq: 122459, timestamp: '2026-09-01T18:00:00Z' });
  assert.deepEqual(state, {
    stream: 'hour',
    lastAppliedSeq: 122459,
    lastAppliedTimestamp: '2026-09-01T18:00:00Z',
    versionsKnown: false,
  });
  assert.equal(validateSyncState(state), state);
  assert.deepEqual(normaliseGenerationState(state), { replication: state, basePointer: null });
  assert.throws(
    () => validateSyncState({ ...state, note: 'not part of the generation schema' }),
    /unexpected field note/,
  );
  assert.equal(Object.hasOwn(state, 'basePointer'), false);
});

test('sync preserves the hydrated base pointer as an opaque publication token', () => {
  const basePointer = {
    schema: 'darkroute-camera-pointer/v1',
    slot: 'a',
    generation: 'a'.repeat(64),
    manifestSha256: 'b'.repeat(64),
    previous: null,
    updatedAt: '2026-09-01T18:00:00.000Z',
  };
  const prior = {
    stream: 'hour',
    lastAppliedSeq: 10,
    lastAppliedTimestamp: '2026-09-01T10:00:00Z',
    versionsKnown: false,
    basePointer,
  };
  const advanced = advancedSyncState(
    validateSyncState(prior),
    11,
    '2026-09-01T11:00:00Z',
    '2026-09-01T11:01:00.000Z',
  );
  assert.deepEqual(advanced.basePointer, basePointer);
  assert.deepEqual(normaliseGenerationState(advanced).basePointer, basePointer);
  assert.deepEqual(
    firstRunState({ seq: 11, timestamp: '2026-09-01T11:00:00Z' }, prior).basePointer,
    basePointer,
  );
  assert.throws(() => validateSyncState({ ...prior, basePointer: [] }), /must be an object/);
});

test('delta sync advances operational upstream without erasing baseline provenance', () => {
  const updated = advanceArchiveIndex(
    {
      source: 'fresh archive plus locally carried coverage gaps',
      baseUpstream: '2026-08-20T12:00:00.000Z',
      upstream: '2026-09-01T10:00:00Z',
    },
    '2026-09-02T11:00:00Z',
    { cameras: 100, tiles: 12 },
    '2026-09-02T11:01:00.000Z',
  );
  assert.equal(updated.baseUpstream, '2026-08-20T12:00:00.000Z');
  assert.equal(updated.upstream, '2026-09-02T11:00:00Z');
  assert.equal(updated.source, 'fresh archive plus locally carried coverage gaps');
});

test('replication state parsing requires one exact sequence and timestamp', () => {
  const body =
    '#Mon Aug 31 14:02:08 UTC 2026\n' +
    'sequenceNumber=122431\n' +
    'timestamp=2026-08-31T14\\:00\\:00Z\n';
  assert.deepEqual(parseSequenceState(body, { expectedSeq: 122431 }), {
    seq: 122431,
    timestamp: '2026-08-31T14:00:00.000Z',
  });
  assert.throws(
    () => parseSequenceState(body, { expectedSeq: 122432 }),
    /identified sequence 122431, expected 122432/,
  );
  assert.throws(
    () => parseSequenceState(`${body}sequenceNumber=122431\n`),
    /exactly one sequenceNumber/,
  );
  assert.throws(
    () => parseSequenceState('sequenceNumber=122431\ntimestamp=yesterday\n'),
    /invalid timestamp/,
  );
  assert.throws(
    () => parseSequenceState('sequenceNumber=122431\ntimestamp=2026-02-30T14\\:00\\:00Z\n'),
    /invalid timestamp/,
  );
  assert.throws(() => parseSequenceState('sequenceNumber=122431\n'), /exactly one timestamp/);
});

test('bounded catch-up resolves metadata for appliedThrough, never the moving head', async () => {
  const head = { seq: 122459, timestamp: '2026-09-01T18:00:00Z' };
  let request;
  const applied = await resolveAppliedState(122431, head, async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      status: 200,
      url,
      text: async () => 'sequenceNumber=122431\n' + 'timestamp=2026-08-31T14\\:00\\:00Z\n',
    };
  });

  assert.equal(request.url, sequenceStateUrl(122431));
  assert.equal(request.init.headers['User-Agent'], 'DarkRoute/patrol (+https://darkroute.ai)');
  assert.equal(request.init.redirect, 'error');
  assert.deepEqual(applied, { seq: 122431, timestamp: '2026-08-31T14:00:00.000Z' });

  let fetched = false;
  assert.equal(
    await resolveAppliedState(head.seq, head, async () => {
      fetched = true;
      throw new Error('head metadata should already be exact');
    }),
    head,
  );
  assert.equal(fetched, false);
});

test('exact sequence metadata fails closed on HTTP and identity errors', async () => {
  await assert.rejects(
    sequenceState(122431, async (url) => ({ ok: false, status: 503, url })),
    /HTTP 503/,
  );
  await assert.rejects(
    sequenceState(122431, async (url) => ({
      ok: true,
      status: 200,
      url,
      text: async () => 'sequenceNumber=122432\ntimestamp=2026-08-31T15\\:00\\:00Z\n',
    })),
    /identified sequence 122432, expected 122431/,
  );
  await assert.rejects(
    sequenceState(122431, async () => ({
      ok: true,
      status: 200,
      url: 'https://attacker.invalid/state.txt',
      text: async () => 'sequenceNumber=122431\ntimestamp=2026-08-31T14\\:00\\:00Z\n',
    })),
    /resolved to an unreviewed URL/,
  );
});

test('moving-head state rejects redirects and disables automatic redirect following', async () => {
  let request;
  const head = await currentSequence(async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      status: 200,
      url,
      text: async () => 'sequenceNumber=122500\ntimestamp=2026-09-04T11\\:00\\:00Z\n',
    };
  });
  assert.deepEqual(head, { seq: 122500, timestamp: '2026-09-04T11:00:00.000Z' });
  assert.equal(request.init.redirect, 'error');
  await assert.rejects(
    currentSequence(async () => ({
      ok: true,
      status: 200,
      url: 'https://attacker.invalid/head.txt',
      text: async () => 'sequenceNumber=122500\ntimestamp=2026-09-04T11\\:00\\:00Z\n',
    })),
    /resolved to an unreviewed URL/,
  );
});

test('a sync-rewritten tile retains the ODbL URI and passes deep generation validation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'camera-sync-notice-'));
  try {
    const approved = approvedCameraSourceFixture();
    const fixture = await makeCameraFixture(root, {
      versionsKnown: true,
      osmVersion: 1,
      cameraSource: approved.marker,
      baseUpstream: approved.minimumOsmBase,
    });
    const path = join(fixture.archive, fixture.tileKey);
    const tile = JSON.parse(readFileSync(path, 'utf8'));
    delete tile.licenceUrl;
    const body = writeCameraTile(path, tile);
    assert.equal(body.licenceUrl, 'https://opendatacommons.org/licenses/odbl/1-0/');
    await assert.doesNotReject(
      readLocalGeneration(fixture.archive, fixture.stateFile, {
        minTiles: 1,
        minCameras: 1,
        trustedReviewBytes: approved.trustedReviewBytes,
        requireLicenceUrl: true,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
