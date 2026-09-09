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
  tileConcurrency,
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
  rawDatasetFromBodies,
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

it('reads a bare decimal as the measurement it is, and still catches a phone', () => {
  // `direction=0.009999999999990905` is a real tag on a real ALPR node, and it
  // was matching the phone heuristic: nineteen digits, with `.` inside the
  // separator class. The filter dropped `direction` from the retained tags, the
  // builder still derived `directionDeg` from the raw element, and attestation
  // then refused the whole national generation over one node -- "camera
  // osm:13271087144 disagrees with its retained OSM tags".
  for (const value of ['0.009999999999990905', '0.01', '359.5', '-12.5', '42']) {
    assert.equal(containsContactValue(value), false, value);
  }
  // The exemption is one decimal point with digits either side and at most six
  // before it, so none of these stop being phone-like.
  for (const value of ['8165551234', '816.555.1234', '+1 816 555 1234', '8165551234.0']) {
    assert.equal(containsContactValue(value), true, value);
  }
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

/**
 * @param {object} [variant]
 * @param {boolean} [variant.falseZero] one zero tile whose confirmation returns a camera.
 * @param {boolean} [variant.unobtainedSubtractions] no areas-capable mirror answered CA or MX.
 * @param {boolean} [variant.zeroConfirmedByItsCounter] one zero tile confirmed by the instance
 *   that counted it, which is what a real run gets when the other mirrors 504 on one tile.
 */
function captureFixture({
  falseZero = false,
  unobtainedSubtractions = false,
  zeroConfirmedByItsCounter = false,
} = {}) {
  const plain = !falseZero && !unobtainedSubtractions && !zeroConfirmedByItsCounter;
  if (plain && cachedFixture !== undefined) return cachedFixture;
  const roots = buildSeedTiles();
  const directLeaves = roots.slice(0, 24);
  const split = roots[24];
  const splitChildren = splitTile(split);
  const responses = new Map();
  const countNodes = [];
  let contradictedZero = false;
  let sameInstanceZero = null;

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
      // `endpoint` is what every count response above used, so naming it here is
      // exactly the tile whose zero was confirmed by its own counting instance.
      const confirmationEndpoint =
        zeroConfirmedByItsCounter && sameInstanceZero === null ? endpoint : OVERPASS_ENDPOINTS[1];
      if (confirmationEndpoint === endpoint) sameInstanceZero = id;
      responses.set(
        confirmationResponseId,
        accepted(
          confirmationResponseId,
          'data',
          dataQuery(root),
          bodyBytes(elements),
          confirmationEndpoint,
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
  /* The 2026-09-06/07 shape: `overpass.deflock.org` has no areas database at
     all and the two instances that do were 504ing under the capture's own load,
     so both cross-checks are recorded as unobtained and contribute no body. */
  const subtractions = unobtainedSubtractions
    ? {
        CA: {
          iso: 'CA',
          responseId: null,
          featureCount: null,
          minimum: 300,
          unavailable: 'all allowed Overpass endpoints failed: HTTP 504; osm3s_areas is not defined',
        },
        MX: {
          iso: 'MX',
          responseId: null,
          featureCount: null,
          minimum: 0,
          unavailable: 'all allowed Overpass endpoints failed: HTTP 504; osm3s_areas is not defined',
        },
      }
    : {
        CA: {
          iso: 'CA',
          responseId: 'subtraction:CA',
          featureCount: 300,
          minimum: 300,
          unavailable: null,
        },
        MX: { iso: 'MX', responseId: 'subtraction:MX', featureCount: 0, minimum: 0, unavailable: null },
      };
  if (!unobtainedSubtractions) {
    responses.set(
      'subtraction:CA',
      accepted('subtraction:CA', 'subtraction', subtractionQuery('CA'), bodyBytes(ca)),
    );
    responses.set(
      'subtraction:MX',
      accepted('subtraction:MX', 'subtraction', subtractionQuery('MX'), bodyBytes([])),
    );
  }

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
  const result = { ...fixture, sameInstanceZero };
  if (plain) cachedFixture = result;
  return result;
}

let cachedApprovedProposal;

/** The plain fixture carried all the way to an approved reviewer receipt. */
async function approvedProposalFixture() {
  if (cachedApprovedProposal !== undefined) return cachedApprovedProposal;
  const fixture = captureFixture();
  const validated = validateCaptureArtifacts(fixture.ledger, {
    ledgerBytes: fixture.ledgerBytes,
    responseBundle: fixture.responseBundle,
    rawDataset: fixture.rawGzip,
    implementationFiles: IMPLEMENTATION_FILES,
  });
  // Every fixture camera sits at a tile centre, most of them in open ocean, so
  // the real geofence keeps 66k of 125k and the proposal builder refuses the
  // run. Move them all onto one Los Angeles point: this receipt exists to
  // exercise the review document's own structural rules, and the raw artifact
  // it claims is deliberately not reproducible from it - `validateApprovedBaselineOffline`
  // re-opens the bound bytes and says so, which the test below relies on.
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
    deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
    capturedAt: '2026-09-01T20:59:00.000Z',
  });
  const predecessorBytes = Buffer.from(`${JSON.stringify(predecessor, null, 2)}\n`);
  const proposal = await buildSourceReviewProposal({
    capture: {
      ledger: fixture.ledger,
      ...validated,
      collection,
      artifacts: {
        ledgerBytes: fixture.ledgerBytes,
        responseBundle: fixture.responseBundle,
        rawDataset: fixture.rawGzip,
      },
    },
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
  proposal.sourceWatermark.status = 'approved';
  cachedApprovedProposal = proposal;
  return proposal;
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

  it('scales tiles-in-flight to the mirrors that are actually up', () => {
    // The data query excludes the endpoint that answered the count, so with n
    // endpoints every data request lands on one of n - 1. A fixed 5 was tuned
    // for three healthy mirrors; when kumi.systems went down and
    // FWM_OVERPASS_SKIP correctly dropped it to two, that same 5 funnelled onto
    // the ONE remaining data mirror and drew seven HTTP 429s. This is the guard
    // for that: the number has to follow the endpoint count.
    assert.equal(tileConcurrency(3), 4);
    assert.equal(tileConcurrency(2), 2);
    // Never zero, whatever it is handed - a batch size of 0 spins forever.
    assert.equal(tileConcurrency(1), 2);
    assert.equal(tileConcurrency(0), 2);
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

  /**
   * A LEAF SERVED BY ONE INSTANCE IS RECORDED, NOT REFUSED.
   *
   * This asserted a throw. Cross-mirror independence is the better answer and is
   * still what a healthy run gets, but as a HARD GATE at the final step it threw
   * away completed captures: on 2026-09-06 a run finished the entire United
   * States - every seed, every leaf, both subtractions - and was rejected at
   * `writeCapture` because ONE tile in the US Virgin Islands had been served by
   * the instance that counted it, the other mirror having 504'd. The archive on
   * the site was five days stale at the time.
   *
   * Owner's ruling, 2026-09-06: if one mirror gives us the data then we have the
   * data; a second source is validation, not a freshness gate. So the fact is
   * carried out to the receipt for a reviewer to weigh, which is where a
   * judgement about trust belongs.
   */
  /**
   * AN UNOBTAINED CROSS-CHECK IS RECORDED, AND THE COUNT GOES NULL RATHER THAN
   * ZERO.
   *
   * The CA/MX subtractions do not decide which cameras ship - the Census county
   * geofence does. They are the corroborating measurement, and four separate
   * captures on 2026-09-06/07 finished every seed and every leaf and then died
   * on one of these two queries because no areas-capable mirror was healthy.
   * Owner's ruling: United States only for now, and a second source is
   * validation rather than a gate.
   *
   * The zero is the part that matters. `foreignCandidateMatches: 0` reads as
   * "we compared the border overlap against Canada and Mexico and found nothing
   * foreign", which is a claim about the world. `null` says we did not look.
   */
  it('an unobtained subtraction reports null matches, never zero', () => {
    // The zero is the whole point. `foreignCandidateMatches: 0` reads as "we
    // compared the border overlap against Canada and Mexico and found nothing
    // foreign in it", which is a claim about the world. `null` says we did not
    // look, which is a claim about our data - the same distinction the monitor
    // card makes when it prints "not counted yet" instead of 0.
    // Parsed bodies, not bytes: `rawDatasetFromBodies` reads elements off the
    // object the ledger already decoded.
    const bodies = [JSON.parse(bodyBytes([camera(1, { lat: 48.9, lon: -122.5 })]).toString('utf8'))];

    const obtained = rawDatasetFromBodies(bodies, [], true);
    assert.equal(obtained.foreignCandidateMatches, 0, 'a check that ran should report a number');

    const missed = rawDatasetFromBodies(bodies, [], false);
    assert.equal(missed.foreignCandidateMatches, null, 'an absent check reported as a number');
    // And the archive itself is unaffected either way - the Census county
    // geofence is what filters, and it runs regardless of this cross-check.
    assert.equal(missed.rawTotal, obtained.rawTotal);
  });

  it('refuses an unobtained subtraction that still claims a count', () => {
    const fixture = captureFixture();
    const ledger = structuredClone(fixture.ledger);
    // The shape that would let a missing check masquerade as a clean one.
    ledger.topology.subtractions.MX = {
      iso: 'MX',
      responseId: null,
      featureCount: 0,
      minimum: 0,
      unavailable: 'unreachable',
    };
    const bytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(ledger, {
          ledgerBytes: bytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /invalid unavailable MX subtraction record/,
    );
  });

  /**
   * THE RELAXATION WAS IMPLEMENTED IN THREE PLACES OUT OF FOUR.
   *
   * `unobtainedSubtraction` records a CA/MX cross-check that no mirror would
   * answer with `responseId: null`, so by construction it puts NO body in the
   * bundle. `validateTopology` tolerates that. The response-role census did not:
   * it demanded exactly two subtraction RESPONSES, three lines away from the
   * check that had just accepted their absence, and it ran at write time - after
   * every request of a national capture had already been spent.
   *
   * More than two is still impossible; there are two neighbours. What keeps the
   * correspondence honest is not this count but the evidence: `validateTopology`
   * demands `subtraction:<iso>` carrying the exact subtraction query for every
   * iso whose `unavailable` is null, and the referenced-response census refuses
   * a bundle holding a subtraction body the topology does not claim. A ledger
   * cannot drop a real subtraction to dodge a check.
   */
  it('does not refuse an unobtained subtraction for contributing no response', () => {
    const fixture = captureFixture({ unobtainedSubtractions: true });
    assert.equal(fixture.ledger.roleCounts.subtraction, 0, 'fixture did not drop both cross-checks');

    let thrown = null;
    try {
      validateCaptureArtifacts(fixture.ledger, {
        ledgerBytes: fixture.ledgerBytes,
        responseBundle: fixture.responseBundle,
        rawDataset: fixture.rawGzip,
        implementationFiles: IMPLEMENTATION_FILES,
      });
    } catch (error) {
      thrown = error;
    }
    assert.doesNotMatch(
      String(thrown?.message ?? ''),
      /response roles or minimum watermark are incomplete/,
      'the role census refused a capture whose topology check had already accepted it',
    );
  });

  it('accepts a reviewed ledger whose cross-checks were never obtained', async () => {
    // The SECOND arm of the same rule. `fetch-cameras-deflock` re-counts the
    // roles when a receipt is reviewed, so leaving it at "exactly two" means a
    // capture that survives the writer still cannot be approved - and neither
    // can a hand-edited ledger, which is the point.
    const approved = await approvedProposalFixture();

    const unobtained = structuredClone(approved);
    const ledger = unobtained.sourceWatermark.responseLedger;
    ledger.roleCounts.subtraction = 0;
    ledger.responseCount = ledger.roleCounts.count + ledger.roleCounts.data;
    ledger.responseBundle.responseCount = ledger.responseCount;
    assert.doesNotThrow(() => validateSourceReview(unobtained));

    const one = structuredClone(unobtained);
    one.sourceWatermark.responseLedger.roleCounts.subtraction = 1;
    one.sourceWatermark.responseLedger.responseCount += 1;
    one.sourceWatermark.responseLedger.responseBundle.responseCount += 1;
    assert.doesNotThrow(() => validateSourceReview(one));

    // Two neighbours, so three is still nonsense and still refused.
    const three = structuredClone(unobtained);
    three.sourceWatermark.responseLedger.roleCounts.subtraction = 3;
    three.sourceWatermark.responseLedger.responseCount += 3;
    three.sourceWatermark.responseLedger.responseBundle.responseCount += 3;
    assert.throws(
      () => validateSourceReview(three),
      /no approved, body-bound response ledger/,
      'more subtractions than there are neighbours was accepted',
    );
  });

  /**
   * THE REBUILD HAS TO MAKE THE SAME DECISION THE CAPTURE MADE.
   *
   * `finalizeCapture` passes `subtractionsObtained: false` and writes
   * `foreignCandidateMatches: null` - we did not look, which is a claim about
   * our data rather than about the world. The validator rebuilt the same dataset
   * while omitting that argument, so it defaulted to true, computed 0, compared
   * 0 against null and threw. A completed national capture with an unobtained
   * cross-check was unwritable for that one missing parameter.
   */
  it('rebuilds an unobtained subtraction as null matches rather than zero', () => {
    const fixture = captureFixture({ unobtainedSubtractions: true });
    assert.equal(
      fixture.ledger.counts.foreignCandidateMatches,
      null,
      'the capture itself should record an absent check as absent',
    );

    const validated = validateCaptureArtifacts(fixture.ledger, {
      ledgerBytes: fixture.ledgerBytes,
      responseBundle: fixture.responseBundle,
      rawDataset: fixture.rawGzip,
      implementationFiles: IMPLEMENTATION_FILES,
    });

    // And the archive itself is unaffected: the Census county geofence is what
    // filters, and it runs regardless of whether this cross-check was answered.
    assert.equal(validated.rawDataset.featureCount, 125_001);
    assert.equal(validated.roleCounts.subtraction, 0);
    assert.equal(fixture.ledger.counts.caFeatures, null);
    assert.equal(fixture.ledger.counts.mxFeatures, null);
  });

  /**
   * A ZERO CONFIRMED BY ITS OWN COUNTER IS RECORDED, NOT REFUSED.
   *
   * The 2026-09-06 ruling was applied to data leaves and not to this arm, and
   * the two halves then disagreed at opposite ends of a run:
   * `queryOverpassCandidate` DEMOTES the counting endpoint rather than filtering
   * it, so `captureZeroConfirmation`'s exclusion falls back silently at capture
   * time and the ledger detonated at write time. One ocean tile out of ~28 seeds
   * is enough, with every mirror up.
   *
   * The zero itself is still proved the same way: a real data query over the
   * same bbox that returns no selected feature. Only the identity of the mirror
   * that answered it has stopped being a veto.
   */
  it('records a zero confirmed by its counting instance rather than refusing it', () => {
    const fixture = captureFixture({ zeroConfirmedByItsCounter: true });
    assert.ok(fixture.sameInstanceZero, 'fixture did not produce a same-instance zero tile');

    const validated = validateCaptureArtifacts(fixture.ledger, {
      ledgerBytes: fixture.ledgerBytes,
      responseBundle: fixture.responseBundle,
      rawDataset: fixture.rawGzip,
      implementationFiles: IMPLEMENTATION_FILES,
    });

    // AND IT IS NOT SILENT. Recording instead of refusing is only defensible if
    // the receipt says which tiles rest on one instance's word.
    assert.ok(
      validated.sameInstanceLeaves.includes(fixture.sameInstanceZero),
      'the zero confirmed by its own counter was not reported',
    );
  });

  it('still refuses a zero its own counting instance contradicts', () => {
    // The relaxation is about WHICH mirror answered, never about what it said.
    const fixture = captureFixture({ falseZero: true, zeroConfirmedByItsCounter: true });
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

  it('records a leaf served by its own counting endpoint rather than refusing it', () => {
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

    const result = validateCaptureArtifacts(sameEndpoint, {
      ledgerBytes: sameEndpointBytes,
      responseBundle: fixture.responseBundle,
      rawDataset: fixture.rawGzip,
      implementationFiles: IMPLEMENTATION_FILES,
    });

    // AND IT IS NOT SILENT. A capture that rests on one instance's word for a
    // tile has to say so, or the change from gate to record is just a weakening.
    assert.ok(
      result.sameInstanceLeaves.includes(leaf.id),
      'the leaf served by its own counter was not reported',
    );
  });

  it('accepts a leaf whose stale planning count was re-probed before the data', () => {
    /*
     * THE SHAPE THAT THREW AWAY A FINISHED NATIONAL CAPTURE, 2026-09-08.
     *
     * `captureDataLeaf` re-probes a leaf whose planning count no longer matches
     * the data it just fetched, and accepts the data against that fresh count.
     * The leaf loop above deliberately admits a `recount:` id; the traversal
     * demanded identity with the planning node anyway, so ninety-one of
     * ninety-one leaves and both subtractions were discarded at write time on
     * one tile in Maine whose count moved while the run was in flight.
     */
    const fixture = captureFixture();
    const ledger = structuredClone(fixture.ledger);
    const leaf = ledger.topology.dataLeaves[0];
    const node = ledger.topology.countNodes.find((entry) => entry.id === leaf.id);
    assert.ok(node);

    // The tile gained one camera between the planning probe and the data, so
    // the data answered 5001 where the plan had promised 5000. Both counts are
    // retained; the leaf names the one that authorised its data.
    const reprobeId = `recount:1:${leaf.id}`;
    const reprobeBody = retainedResponseBytes(
      JSON.parse(countBody(leaf.probed).toString('utf8')),
    );
    const entries = decodeResponseBundle(fixture.responseBundle);
    entries.set(reprobeId, reprobeBody);
    const bundle = encodeResponseBundle([...entries].map(([id, body]) => ({ id, body })));
    const planning = ledger.responses.find((entry) => entry.id === node.responseId);
    ledger.responses.push({
      ...structuredClone(planning),
      id: reprobeId,
      responseBytes: reprobeBody.length,
      responseSha256: captureSha256(reprobeBody),
    });
    ledger.responses.sort((left, right) => left.id.localeCompare(right.id));
    ledger.roleCounts.count += 1;
    leaf.countResponseId = reprobeId;
    // The planning node keeps the number ITS body proves; only the leaf moves.
    node.count = leaf.probed;
    ledger.artifacts.responseBundle.bytes = bundle.length;
    ledger.artifacts.responseBundle.sha256 = captureSha256(bundle);
    ledger.artifacts.responseBundle.responseCount = ledger.responses.length;
    const ledgerBytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`);

    const result = validateCaptureArtifacts(ledger, {
      ledgerBytes,
      responseBundle: bundle,
      rawDataset: fixture.rawGzip,
      implementationFiles: IMPLEMENTATION_FILES,
    });
    // AND IT IS NOT SILENT: a tile that moved mid-run is named in the receipt.
    assert.deepEqual(result.reprobedLeaves, [leaf.id]);
  });

  it('refuses a re-probe that does not prove the number its leaf claims', () => {
    const fixture = captureFixture();
    const ledger = structuredClone(fixture.ledger);
    const leaf = ledger.topology.dataLeaves[0];
    const node = ledger.topology.countNodes.find((entry) => entry.id === leaf.id);
    const reprobeId = `recount:1:${leaf.id}`;
    // A retained count body that says something other than the leaf's own
    // `probed`. The re-probe path is a second OBSERVATION, not a licence for
    // the leaf to name a number nothing returned.
    const reprobeBody = retainedResponseBytes(
      JSON.parse(countBody(leaf.probed + 7).toString('utf8')),
    );
    const entries = decodeResponseBundle(fixture.responseBundle);
    entries.set(reprobeId, reprobeBody);
    const bundle = encodeResponseBundle([...entries].map(([id, body]) => ({ id, body })));
    const planning = ledger.responses.find((entry) => entry.id === node.responseId);
    ledger.responses.push({
      ...structuredClone(planning),
      id: reprobeId,
      responseBytes: reprobeBody.length,
      responseSha256: captureSha256(reprobeBody),
    });
    ledger.responses.sort((left, right) => left.id.localeCompare(right.id));
    ledger.roleCounts.count += 1;
    leaf.countResponseId = reprobeId;
    ledger.artifacts.responseBundle.bytes = bundle.length;
    ledger.artifacts.responseBundle.sha256 = captureSha256(bundle);
    ledger.artifacts.responseBundle.responseCount = ledger.responses.length;
    const ledgerBytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`);

    assert.throws(
      () =>
        validateCaptureArtifacts(ledger, {
          ledgerBytes,
          responseBundle: bundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /re-probed leaf .* disagrees with its retained count body/,
    );
  });

  it('still refuses a leaf whose own planning count node disagrees with it', () => {
    const fixture = captureFixture();
    const ledger = structuredClone(fixture.ledger);
    const leaf = ledger.topology.dataLeaves[0];
    const node = ledger.topology.countNodes.find((entry) => entry.id === leaf.id);
    node.count = leaf.probed + 1;
    const ledgerBytes = Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`);
    assert.throws(
      () =>
        validateCaptureArtifacts(ledger, {
          ledgerBytes,
          responseBundle: fixture.responseBundle,
          rawDataset: fixture.rawGzip,
          implementationFiles: IMPLEMENTATION_FILES,
        }),
      /disagrees with its retained body|disagrees with its own count node/,
    );
  });

  it('reports no same-instance leaves for a run where every leaf was independent', () => {
    const fixture = captureFixture();
    const result = validateCaptureArtifacts(fixture.ledger, {
      ledgerBytes: fixture.ledgerBytes,
      responseBundle: fixture.responseBundle,
      rawDataset: fixture.rawGzip,
      implementationFiles: IMPLEMENTATION_FILES,
    });
    assert.deepEqual(result.sameInstanceLeaves, []);
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
      // `singleMirror()` is documented as the thing that records that the
      // independence check did not happen, and it had no caller at all - the
      // artifact recorded nothing. A reviewer cannot tell a one-endpoint run
      // from a three-endpoint run whose other two were down without it.
      assert.equal(summary.singleMirror, false);
      assert.equal(
        JSON.parse(await readFile(join(target, 'deflock-us-capture-summary.json'), 'utf8'))
          .singleMirror,
        false,
      );
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
