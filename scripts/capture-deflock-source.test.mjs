import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import {
  OVERPASS_ENDPOINTS,
  OVERPASS_USER_AGENT,
  OSM_ATTRIBUTION,
  OSM_LICENCE,
  OSM_LICENCE_URL,
  MAX_RETAINED_CAPTURE_DECODED_BYTES,
  RAW_DATASET_PATH,
  RAW_MIN_TOTAL,
  RESPONSE_BUNDLE_PATH,
  RESPONSE_LEDGER_PATH,
  captureSha256,
  assertDataBodyMatchesTile,
  assertDistinctSplitCoverage,
  assertSelectedElementSnapshots,
  assertRawCaptureMinimum,
  buildSeedTiles,
  countProbeIsConsistent,
  containsContactValue,
  countQuery,
  dataQuery,
  decodeResponseBundle,
  encodeResponseBundle,
  finalizeCapture,
  retainedResponseBytes,
  selectedFeatures,
  splitTile,
  subtractionQuery,
  tileId,
  tileSelector,
  validateCaptureArtifacts,
} from './deflock-capture.mjs';
import {
  captureImplementationFiles,
  parseCaptureArgs,
  prepareCaptureTarget,
  queryOverpassCandidate,
  writeCapture,
} from './capture-deflock-source.mjs';
import {
  LATEST_REPLICATION_STATE_URL,
  buildSourceReviewProposal,
  findConservativeReplicationFloor,
  readValidatedCapture,
  validateApprovedBaselineOffline,
} from './propose-deflock-source-review.mjs';
import { validateSourceReview } from './fetch-cameras-deflock.mjs';
import { releaseTombstoneIdentity } from './fetch-cameras.mjs';
import { buildPredecessorEvidence } from './camera-predecessor.mjs';

const IMPLEMENTATION_FILES = captureImplementationFiles();

it('removes conventional and disguised contact values from retained fields', () => {
  for (const value of [
    'privacy-camera.example.com',
    'privacy-camera dot example dot com',
    'tel:5551212',
    '555-1212',
    'alice [at] example dot com',
    'name [at] example [dot] com',
    'alice＠example.com',
    '202•555•0199',
  ]) {
    assert.equal(containsContactValue(value), true, value);
  }
  assert.equal(containsContactValue('St. Louis Police Department'), false);
  assert.equal(containsContactValue('Wyandotte Police Department'), false);
});

const osmBase = '2026-09-01T21:00:00Z';
const endpoint = OVERPASS_ENDPOINTS[0];

const bodyBytes = (elements, timestamp = osmBase) =>
  Buffer.from(JSON.stringify({ version: 0.6, osm3s: { timestamp_osm_base: timestamp }, elements }));

const countBody = (count) => bodyBytes([{ type: 'count', tags: { total: String(count) } }]);

const camera = (id, over = {}) => ({
  type: 'node',
  id,
  version: 1,
  timestamp: '2026-09-01T20:00:00Z',
  lat: 34.1597,
  lon: -118.1478,
  tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' },
  ...over,
});

function accepted(id, role, query, body, acceptedEndpoint = endpoint) {
  const retained = retainedResponseBytes(JSON.parse(body.toString('utf8')));
  return {
    id,
    role,
    query,
    endpoint: acceptedEndpoint,
    body: retained,
    transportSha256: captureSha256(body),
    transportBytes: body.length,
  };
}

let cachedFixture;

function captureFixture({ falseZero = false } = {}) {
  if (!falseZero && cachedFixture !== undefined) return cachedFixture;
  const roots = buildSeedTiles();
  const directLeaves = roots.slice(0, 24);
  const split = roots[24];
  const splitChildren = splitTile(split);
  const responses = new Map();
  const countNodes = [];
  let contradictedZero = false;

  for (const root of roots) {
    const id = tileId(root);
    const count = directLeaves.includes(root) ? 5_000 : root === split ? 5_001 : 0;
    const responseId = `count:${id}`;
    responses.set(responseId, accepted(responseId, 'count', countQuery(root), countBody(count)));
    const confirmationResponseId = count === 0 ? `zero:${id}` : null;
    if (confirmationResponseId !== null) {
      const elements =
        falseZero && !contradictedZero
          ? [
              camera(900_000, {
                lat: (root.s + root.n) / 2,
                lon: (root.w + root.e) / 2,
              }),
            ]
          : [];
      contradictedZero ||= elements.length > 0;
      responses.set(
        confirmationResponseId,
        accepted(
          confirmationResponseId,
          'data',
          dataQuery(root),
          bodyBytes(elements),
          OVERPASS_ENDPOINTS[1],
        ),
      );
    }
    countNodes.push({
      id,
      bbox: root,
      responseId,
      count,
      resolution: count === 0 ? 'zero' : root === split ? 'split' : 'data',
      children: root === split ? splitChildren.map(tileId) : [],
      confirmationResponseId,
    });
  }

  const childCounts = [1_250, 1_250, 1_250, 1_251];
  for (const [index, child] of splitChildren.entries()) {
    const id = tileId(child);
    const responseId = `count:${id}`;
    const count = childCounts[index];
    responses.set(responseId, accepted(responseId, 'count', countQuery(child), countBody(count)));
    countNodes.push({
      id,
      bbox: child,
      responseId,
      count,
      resolution: 'data',
      children: [],
      confirmationResponseId: null,
    });
  }

  const dataLeaves = [];
  let nextCameraId = 1;
  for (const [bbox, count] of [
    ...directLeaves.map((root) => [root, 5_000]),
    ...splitChildren.map((child, index) => [child, childCounts[index]]),
  ]) {
    const id = tileId(bbox);
    const dataResponseId = `data:${id}`;
    const lat = (bbox.s + bbox.n) / 2;
    const lon = (bbox.w + bbox.e) / 2;
    const cameras = Array.from({ length: count }, (_, index) =>
      camera(nextCameraId++, {
        lat,
        lon,
        ...(nextCameraId === 2 && index === 0
          ? { tags: { man_made: 'surveillance', 'surveillance:type': 'anpr' } }
          : {}),
      }),
    );
    responses.set(
      dataResponseId,
      accepted(dataResponseId, 'data', dataQuery(bbox), bodyBytes(cameras), OVERPASS_ENDPOINTS[1]),
    );
    dataLeaves.push({
      id,
      bbox,
      countResponseId: `count:${id}`,
      dataResponseId,
      probed: count,
      featureCount: count,
    });
  }

  const ca = Array.from({ length: 300 }, (_, index) =>
    camera(100_000 + index, { lat: 49.5, lon: -123.1 }),
  );
  const subtractions = {
    CA: { iso: 'CA', responseId: 'subtraction:CA', featureCount: 300, minimum: 300 },
    MX: { iso: 'MX', responseId: 'subtraction:MX', featureCount: 0, minimum: 0 },
  };
  responses.set(
    'subtraction:CA',
    accepted('subtraction:CA', 'subtraction', subtractionQuery('CA'), bodyBytes(ca)),
  );
  responses.set(
    'subtraction:MX',
    accepted('subtraction:MX', 'subtraction', subtractionQuery('MX'), bodyBytes([])),
  );

  const fixture = finalizeCapture({
    captureId: '11111111-1111-4111-8111-111111111111',
    startedAt: '2026-09-01T21:00:00.000Z',
    completedAt: '2026-09-01T21:05:00.000Z',
    countNodes,
    dataLeaves,
    subtractions,
    responses,
    implementationFiles: IMPLEMENTATION_FILES,
  });
  if (!falseZero) cachedFixture = fixture;
  return fixture;
}

describe('pinned query topology', () => {
  it('covers both Aleutian longitude sides and queries the documented ALPR/ANPR predicate', () => {
    const seeds = buildSeedTiles();
    assert.ok(seeds.some((tile) => tile.w === -180 && tile.e === -129));
    assert.ok(seeds.some((tile) => tile.w === 170 && tile.e === 180));
    assert.match(tileSelector(seeds[0]), /\^\(ALPR\|ANPR\)\$/);
    assert.match(tileSelector(seeds[0]), /,i\]/);
  });

  it('covers every vertex in the admitted 50 states/DC/PR county geometry', () => {
    const seeds = buildSeedTiles();
    const counties = JSON.parse(
      readFileSync(new URL('./data/us-counties.geojson', import.meta.url), 'utf8'),
    );
    let vertices = 0;
    const visit = (coordinates) => {
      if (
        Array.isArray(coordinates) &&
        coordinates.length >= 2 &&
        Number.isFinite(coordinates[0]) &&
        Number.isFinite(coordinates[1])
      ) {
        const [lon, lat] = coordinates;
        assert.ok(
          seeds.some(({ s, w, n, e }) => lat >= s && lat <= n && lon >= w && lon <= e),
          `county vertex ${String(lon)},${String(lat)} is outside every capture seed`,
        );
        vertices += 1;
        return;
      }
      for (const child of coordinates ?? []) visit(child);
    };
    for (const feature of counties.features) visit(feature.geometry.coordinates);
    assert.ok(vertices > 10_000);
    assert.ok(seeds.some(({ w }) => w === -68));
  });

  it('rejects a count probe that undercounts a leaf which should have split', () => {
    assert.equal(countProbeIsConsistent(1, 50_000, buildSeedTiles()[0]), false);
    assert.equal(countProbeIsConsistent(5_000, 4_500, buildSeedTiles()[0]), false);
    assert.equal(countProbeIsConsistent(5_000, 5_000, buildSeedTiles()[0]), true);
  });

  it('rejects a just-below-floor partial mirror even when its leaves agree', () => {
    assert.throws(() => assertRawCaptureMinimum(RAW_MIN_TOTAL - 1), /raw capture has only/);
    assert.equal(assertRawCaptureMinimum(RAW_MIN_TOTAL), RAW_MIN_TOTAL);
  });

  it('binds every selected element version and timestamp to its response snapshot', () => {
    const valid = JSON.parse(bodyBytes([camera(7)]).toString('utf8'));
    assert.doesNotThrow(() => assertSelectedElementSnapshots(valid));

    for (const changed of [
      camera(7, { version: 0 }),
      camera(7, { version: undefined }),
      camera(7, { timestamp: '2026-09-01T22:00:00Z' }),
      camera(7, { timestamp: 'not-a-time' }),
    ]) {
      const body = JSON.parse(bodyBytes([changed]).toString('utf8'));
      assert.throws(
        () => assertSelectedElementSnapshots(body),
        /timestamp|ordered within its response snapshot/,
      );
      assert.throws(
        () => retainedResponseBytes(body),
        /timestamp|ordered within its response snapshot/,
      );
    }
  });

  it('rejects a false zero even when the national raw minimum still passes', () => {
    const fixture = captureFixture({ falseZero: true });
    assert.throws(
      () =>
        validateCaptureArtifacts(fixture.ledger, {
          ledgerBytes: fixture.ledgerBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /zero count node .* invalid resolution/,
    );
  });

  it('binds every selected node to the exact requested leaf before ways are excluded', () => {
    const bbox = { s: 30, w: -100, n: 40, e: -90 };
    assert.throws(
      () => assertDataBodyMatchesTile({ elements: [camera(1)] }, bbox),
      /does not fall in its requested tile/,
    );
    assert.doesNotThrow(() =>
      assertDataBodyMatchesTile(
        {
          elements: [
            { type: 'node', id: 10, lat: 25, lon: -105 },
            {
              type: 'way',
              id: 20,
              nodes: [10],
              tags: { man_made: 'surveillance', 'surveillance:type': 'ALPR' },
            },
          ],
        },
        bbox,
      ),
    );
  });

  it('requires every nonzero leaf count and data body to come from different endpoints', () => {
    const fixture = captureFixture();
    const sameEndpoint = structuredClone(fixture.ledger);
    const leaf = sameEndpoint.topology.dataLeaves[0];
    const countResponse = sameEndpoint.responses.find(
      (response) => response.id === leaf.countResponseId,
    );
    const dataResponse = sameEndpoint.responses.find(
      (response) => response.id === leaf.dataResponseId,
    );
    dataResponse.endpoint = countResponse.endpoint;
    const sameEndpointBytes = Buffer.from(`${JSON.stringify(sameEndpoint, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(sameEndpoint, {
          ledgerBytes: sameEndpointBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /reuses its count endpoint/,
    );
  });

  it('rejects a split whose four retained child counts lose parent candidates', () => {
    const fixture = captureFixture();
    const ledger = structuredClone(fixture.ledger);
    const parent = ledger.topology.countNodes.find((node) => node.resolution === 'split');
    assert.ok(parent);
    parent.count = 10_002;

    const entries = decodeResponseBundle(fixture.responseBundle);
    const changedBody = retainedResponseBytes(JSON.parse(countBody(parent.count).toString('utf8')));
    entries.set(parent.responseId, changedBody);
    const changedBundle = encodeResponseBundle([...entries].map(([id, body]) => ({ id, body })));
    const response = ledger.responses.find((entry) => entry.id === parent.responseId);
    response.responseBytes = changedBody.length;
    response.responseSha256 = captureSha256(changedBody);
    ledger.artifacts.responseBundle.bytes = changedBundle.length;
    ledger.artifacts.responseBundle.sha256 = captureSha256(changedBundle);
    const ledgerBytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`);

    assert.throws(
      () =>
        validateCaptureArtifacts(ledger, {
          ledgerBytes,
          responseBundle: changedBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /split count node .* loses candidates across its children/,
    );
  });

  it('counts shared-boundary descendant ids only once when conserving a split', () => {
    const [southWest, southEast] = splitTile(buildSeedTiles()[24]);
    const shared = Array.from({ length: 2_501 }, (_, index) =>
      camera(800_000 + index, {
        lat: (southWest.s + southWest.n) / 2,
        lon: southWest.e,
      }),
    );
    const body = { elements: shared };
    assert.doesNotThrow(() => assertDataBodyMatchesTile(body, southWest));
    assert.doesNotThrow(() => assertDataBodyMatchesTile(body, southEast));
    const features = selectedFeatures(body);
    assert.equal(features.size, 2_501);

    assert.throws(
      () =>
        assertDistinctSplitCoverage('shared-boundary-parent', 5_001, [
          features,
          features,
          new Map(),
          new Map(),
        ]),
      /loses distinct candidates across its descendants/,
    );
  });

  it('reparses every body and proves roots, splits, leaves, subtraction, and raw bytes', () => {
    const fixture = captureFixture();
    const validated = validateCaptureArtifacts(fixture.ledger, {
      ledgerBytes: fixture.ledgerBytes,
      responseBundle: fixture.responseBundle,
      rawDataset: fixture.rawGzip,
      implementationFiles: IMPLEMENTATION_FILES,
    });
    assert.equal(validated.rawDataset.featureCount, 125_001);
    assert.equal(fixture.ledger.counts.foreignCandidateMatches, 300);
    assert.equal(fixture.ledger.counts.outputFeatures, 125_001);
    assert.ok(
      validated.collection.features.some((feature) => Number(feature.properties.osmId) === 100_000),
      'a seed candidate also named by the CA audit response remains for Census adjudication',
    );
    assert.equal(validated.collection.attribution, OSM_ATTRIBUTION);
    assert.equal(validated.collection.licence, OSM_LICENCE);
    assert.equal(validated.collection.licenceUrl, OSM_LICENCE_URL);
    assert.equal(validated.collection.features[0].properties.surveillanceType, 'anpr');
    const bundleText = gunzipSync(fixture.responseBundle).toString('utf8');
    assert.match(bundleText, /Map data © OpenStreetMap contributors/);
    assert.match(bundleText, /ODbL-1\.0/);
    assert.match(bundleText, /opendatacommons\.org\/licenses\/odbl\/1-0/);
    assert.equal(validated.roleCounts.subtraction, 2);
    assert.ok(validated.roleCounts.count > buildSeedTiles().length);
    assert.equal(validated.minimumOsmBase, '2026-09-01T21:00:00.000Z');
    assert.deepEqual(fixture.ledger.implementation.localFiles, IMPLEMENTATION_FILES);
  });

  it('bounds retained gzip inflation before parsing or hashing decoded evidence', () => {
    const fixture = captureFixture();
    assert.throws(
      () => decodeResponseBundle(fixture.responseBundle, { maximumDecodedBytes: 32 }),
      /exceeds its decoded-byte limit/,
    );
    assert.throws(
      () =>
        decodeResponseBundle(fixture.responseBundle, {
          maximumDecodedBytes: MAX_RETAINED_CAPTURE_DECODED_BYTES + 1,
        }),
      /decoded-byte limit is invalid/,
    );

    const oversizedIdentity = structuredClone(fixture.ledger);
    oversizedIdentity.artifacts.rawDataset.decodedBytes = MAX_RETAINED_CAPTURE_DECODED_BYTES + 1;
    const oversizedBytes = Buffer.from(`${JSON.stringify(oversizedIdentity, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(oversizedIdentity, {
          ledgerBytes: oversizedBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /invalid bounded identity/,
    );
  });

  it('rejects extra gzip members and header comments with identical decoded evidence', () => {
    const fixture = captureFixture();
    const empty = gzipSync(Buffer.alloc(0), { level: 9, mtime: 0 });
    const header = Buffer.from(empty.subarray(0, 10));
    header[3] |= 0x10;
    const hiddenMember = Buffer.concat([
      header,
      Buffer.from('hidden-comment\0'),
      empty.subarray(10),
    ]);

    const changedBundle = Buffer.concat([fixture.responseBundle, hiddenMember]);
    const bundleLedger = structuredClone(fixture.ledger);
    bundleLedger.artifacts.responseBundle.bytes = changedBundle.length;
    bundleLedger.artifacts.responseBundle.sha256 = captureSha256(changedBundle);
    const bundleLedgerBytes = Buffer.from(`${JSON.stringify(bundleLedger, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(bundleLedger, {
          ledgerBytes: bundleLedgerBytes,
          responseBundle: changedBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /response bundle is not canonical deterministic gzip/,
    );

    const changedRaw = Buffer.concat([fixture.rawGzip, hiddenMember]);
    const rawLedger = structuredClone(fixture.ledger);
    rawLedger.artifacts.rawDataset.bytes = changedRaw.length;
    rawLedger.artifacts.rawDataset.sha256 = captureSha256(changedRaw);
    const rawLedgerBytes = Buffer.from(`${JSON.stringify(rawLedger, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(rawLedger, {
          ledgerBytes: rawLedgerBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: changedRaw,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /raw dataset is not canonical deterministic gzip/,
    );
  });

  it('rejects a self-attested minimum, a broken plan graph, or changed raw bytes', () => {
    const fixture = captureFixture();
    const forgedMinimum = structuredClone(fixture.ledger);
    forgedMinimum.minimumOsmBase = '2026-09-01T20:00:00.000Z';
    const forgedMinimumBytes = Buffer.from(`${JSON.stringify(forgedMinimum, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(forgedMinimum, {
          ledgerBytes: forgedMinimumBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /minimum watermark/,
    );

    const brokenTopology = structuredClone(fixture.ledger);
    brokenTopology.topology.countNodes.pop();
    const brokenTopologyBytes = Buffer.from(`${JSON.stringify(brokenTopology, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(brokenTopology, {
          ledgerBytes: brokenTopologyBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /omits count node|omits split child|unreachable/,
    );

    const changedRaw = Buffer.from(fixture.rawGzip);
    changedRaw[changedRaw.length - 1] ^= 1;
    assert.throws(
      () =>
        validateCaptureArtifacts(fixture.ledger, {
          ledgerBytes: fixture.ledgerBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: changedRaw,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /raw dataset|incorrect data check|invalid distance/i,
    );

    const changedImplementation = structuredClone(fixture.ledger);
    changedImplementation.implementation.localFiles[0].sha256 = '0'.repeat(64);
    const changedImplementationBytes = Buffer.from(
      `${JSON.stringify(changedImplementation, null, 2)}\n`,
    );
    assert.throws(
      () =>
        validateCaptureArtifacts(changedImplementation, {
          ledgerBytes: changedImplementationBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /pinned query implementation/,
    );
  });
});

describe('fail-closed source review proposal', () => {
  const replicationBody = (sequence) => {
    const timestamp = new Date(Date.parse('2026-09-01T10:00:00Z') + sequence * 3_600_000)
      .toISOString()
      .replace('.000Z', 'Z')
      .replaceAll(':', '\\:');
    return Buffer.from(`sequenceNumber=${String(sequence)}\ntimestamp=${timestamp}\n`);
  };

  it('finds the exact official hourly overlap using non-redirecting state reads', async () => {
    const requested = [];
    const fetchImpl = async (url, options) => {
      requested.push({ url, redirect: options.redirect });
      const match = url.match(/(\d{3})\/(\d{3})\/(\d{3})\.state\.txt$/);
      const sequence = url === LATEST_REPLICATION_STATE_URL ? 20 : Number(match.slice(1).join(''));
      const bytes = replicationBody(sequence);
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        arrayBuffer: async () => bytes,
      };
    };
    const overlap = await findConservativeReplicationFloor('2026-09-01T21:00:00.000Z', fetchImpl);
    assert.equal(overlap.floor.sequence, 11);
    assert.equal(overlap.floor.timestamp, '2026-09-01T21:00:00.000Z');
    assert.equal(overlap.next.sequence, 12);
    assert.ok(requested.every(({ redirect }) => redirect === 'error'));
  });

  it('derives the transformation but cannot approve itself', async () => {
    const fixture = captureFixture();
    const validated = validateCaptureArtifacts(fixture.ledger, {
      ledgerBytes: fixture.ledgerBytes,
      responseBundle: fixture.responseBundle,
      rawDataset: fixture.rawGzip,
      implementationFiles: IMPLEMENTATION_FILES,
    });
    const collection = structuredClone(validated.collection);
    for (const feature of collection.features) feature.geometry.coordinates = [-118.1478, 34.1597];
    const tombstoneBody = {
      attribution: OSM_ATTRIBUTION,
      licence: OSM_LICENCE,
      licenceUrl: OSM_LICENCE_URL,
      generatedAt: '2026-09-01T21:05:00.000Z',
      upstream: '2026-09-01T21:00:00.000Z',
      tombstones: [],
    };
    const tombstoneBytes = Buffer.from(`${JSON.stringify(tombstoneBody)}\n`);
    const predecessor = buildPredecessorEvidence({
      mode: 'empty-r2',
      entries: [],
      deployment: {
        provider: 'cloudflare-r2',
        accountId: 'account',
        bucket: 'bucket',
      },
      capturedAt: '2026-09-01T20:59:00.000Z',
    });
    const predecessorBytes = Buffer.from(`${JSON.stringify(predecessor, null, 2)}\n`);
    const capture = {
      ledger: fixture.ledger,
      ...validated,
      collection,
      artifacts: {
        ledgerBytes: fixture.ledgerBytes,
        responseBundle: fixture.responseBundle,
        rawDataset: fixture.rawGzip,
      },
    };
    const proposal = await buildSourceReviewProposal({
      capture,
      tombstoneLedger: {
        ...tombstoneBody,
        bytes: tombstoneBytes,
        identity: releaseTombstoneIdentity(tombstoneBytes, tombstoneBody),
      },
      geofenceBytes: readFileSync(new URL('./data/us-counties.geojson', import.meta.url)),
      predecessorBytes,
      predecessor,
      floor: {
        stream: 'hour',
        sequence: 11,
        timestamp: '2026-09-01T21:00:00.000Z',
        stateUrl:
          'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/000/000/011.state.txt',
      },
      next: { sequence: 12, timestamp: '2026-09-01T22:00:00.000Z' },
    });
    assert.equal(proposal.sourceWatermark.status, 'unapproved');
    assert.equal(proposal.expectedTransformation.outputElements, 125_001);
    assert.deepEqual(proposal.captureImplementation.files, IMPLEMENTATION_FILES);
    assert.throws(() => validateSourceReview(proposal), /no approved, body-bound response ledger/);

    const approved = structuredClone(proposal);
    approved.sourceWatermark.status = 'approved';
    assert.throws(
      () =>
        validateApprovedBaselineOffline({
          review: approved,
          capture,
          baselineTombstoneBytes: tombstoneBytes,
          geofenceBytes: readFileSync(new URL('./data/us-counties.geojson', import.meta.url)),
          predecessorBytes,
          predecessor,
        }),
      // The proposal above deliberately substituted every feature coordinate
      // after validation. Offline public-seed validation re-opens the exact
      // bound raw artifact instead, so that self-consistent proposal cannot
      // masquerade as the approved capture.
      /below the 120000 floor/,
    );
  });
});

describe('first-party capture I/O', () => {
  it('uses only allowed endpoints and the DarkRoute-identifying request', async () => {
    const calls = [];
    let successfulRaw;
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return {
          ok: false,
          status: 503,
          url,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      const bytes = Buffer.from(
        JSON.stringify({
          version: 0.6,
          osm3s: { timestamp_osm_base: osmBase },
          elements: [
            {
              ...camera(42, {
                tags: {
                  man_made: 'surveillance',
                  'surveillance:type': 'ALPR',
                  manufacturer: 'Safe Camera Co',
                  operator: 'alice [at] example dot com',
                  ref: '202•555•0199',
                  'contact:email': 'victim@example.org',
                  note: 'unreviewed free text',
                },
              }),
              user: 'identity-must-not-be-retained',
              uid: 123,
              changeset: 456,
            },
          ],
        }),
      );
      successfulRaw = bytes;
      return {
        ok: true,
        status: 200,
        url,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      };
    };
    const candidate = await queryOverpassCandidate('fixture', 'data', '[out:json];out;', fetchImpl);
    assert.equal(candidate.endpoint, OVERPASS_ENDPOINTS[1]);
    assert.equal(calls[0].init.headers['User-Agent'], OVERPASS_USER_AGENT);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(candidate.transportSha256, captureSha256(successfulRaw));
    assert.equal(candidate.transportBytes, successfulRaw.length);
    assert.doesNotMatch(
      candidate.body.toString('utf8'),
      /identity-must-not-be-retained|"uid"|"changeset"/,
    );
    assert.doesNotMatch(
      candidate.body.toString('utf8'),
      /victim|alice|example|555|contact:email|unreviewed free text|"note"/i,
    );
    assert.match(candidate.body.toString('utf8'), /Safe Camera Co/);
    assert.deepEqual(
      calls.map((call) => call.url),
      OVERPASS_ENDPOINTS.slice(0, 2),
    );
  });

  it('requires an explicit empty non-symlink target and writes all bound artifacts', async () => {
    assert.deepEqual(parseCaptureArgs(['--out=/tmp/source']), { out: '/tmp/source' });
    assert.throws(() => parseCaptureArgs([]), /--out is required/);
    assert.throws(() => parseCaptureArgs(['--wat']), /unknown capture argument/);

    const root = await mkdtemp(join(tmpdir(), 'deflock-capture-test-'));
    const target = join(root, 'output');
    try {
      const prepared = await prepareCaptureTarget(target);
      assert.equal(prepared.path, target);
      const fixture = captureFixture();
      const summary = await writeCapture(prepared, fixture);
      assert.equal(summary.sourceFeatures, 125_001);
      assert.equal(readValidatedCapture(target).rawDataset.featureCount, 125_001);
      for (const path of [RESPONSE_LEDGER_PATH, RESPONSE_BUNDLE_PATH, RAW_DATASET_PATH]) {
        assert.ok((await readFile(join(target, path.split('/').at(-1)))).length > 0);
      }
      const occupied = join(root, 'occupied');
      await prepareCaptureTarget(occupied);
      await writeFile(join(occupied, 'sentinel'), 'x');
      await assert.rejects(prepareCaptureTarget(occupied), /must be empty/);

      const lateFileTarget = join(root, 'late-file');
      const lateFilePrepared = await prepareCaptureTarget(lateFileTarget);
      const ledgerName = RESPONSE_LEDGER_PATH.split('/').at(-1);
      await writeFile(join(lateFileTarget, ledgerName), 'must-not-be-replaced');
      await assert.rejects(
        writeCapture(lateFilePrepared, fixture),
        /capture output changed after preparation/,
      );
      assert.equal(
        await readFile(join(lateFileTarget, ledgerName), 'utf8'),
        'must-not-be-replaced',
      );

      const racedFileTarget = join(root, 'raced-file');
      const racedFilePrepared = await prepareCaptureTarget(racedFileTarget);
      await assert.rejects(
        writeCapture(racedFilePrepared, fixture, {
          beforeLink: async ({ name }) => {
            if (name === ledgerName) {
              await writeFile(join(racedFileTarget, name), 'won-the-race', { flag: 'wx' });
            }
          },
        }),
        /EEXIST/,
      );
      assert.equal(await readFile(join(racedFileTarget, ledgerName), 'utf8'), 'won-the-race');

      const ancestor = join(root, 'ancestor');
      const swappedTarget = join(ancestor, 'output');
      const swappedPrepared = await prepareCaptureTarget(swappedTarget);
      const originalAncestor = join(root, 'original-ancestor');
      await rename(ancestor, originalAncestor);
      await symlink(originalAncestor, ancestor, 'dir');
      await assert.rejects(
        writeCapture(swappedPrepared, fixture),
        /capture output has a symlink component/,
      );
      assert.deepEqual(await readdir(join(originalAncestor, 'output')), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
