import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { attestCameraContinuity } from './attest-camera-continuity.mjs';
import { buildPredecessorEvidence } from './camera-predecessor.mjs';
import { jsonBytes } from './camera-generation.mjs';
import {
  OVERPASS_ENDPOINTS,
  buildSeedTiles,
  captureSha256,
  countQuery,
  dataQuery,
  decodeResponseBundle,
  finalizeCapture,
  RAW_DATASET_PATH,
  RESPONSE_BUNDLE_PATH,
  RESPONSE_LEDGER_PATH,
  retainedResponseBytes,
  splitTile,
  subtractionQuery,
  tileId,
  validateCaptureArtifacts,
} from './deflock-capture.mjs';
import { captureImplementationFiles } from './capture-deflock-source.mjs';
import {
  DEFAULT_COUNTY_GEOFENCE,
  main as buildCameraArchive,
  releaseTombstoneIdentity,
} from './fetch-cameras.mjs';
import {
  sourceHandoff,
  sourceProvenance,
  toOverpassDump,
  transformCapturedCollection,
} from './fetch-cameras-deflock.mjs';
import { loadCountiesBytes } from './counties.mjs';
import { buildSourceReviewProposal } from './propose-deflock-source-review.mjs';

const OSM_BASE = '2026-09-01T21:00:00Z';
const CAPTURE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERAS_PER_LEAF = 1_875;
const SPLIT_DEPTH = 3;

const bodyBytes = (elements, timestamp = OSM_BASE) =>
  Buffer.from(JSON.stringify({ version: 0.6, osm3s: { timestamp_osm_base: timestamp }, elements }));

const countBody = (count) => bodyBytes([{ type: 'count', tags: { total: String(count) } }]);

const camera = (id, lat, lon, surveillanceType = 'ALPR') => ({
  type: 'node',
  id,
  version: 1,
  timestamp: '2026-09-01T20:00:00Z',
  lat,
  lon,
  tags: {
    man_made: 'surveillance',
    'surveillance:type': surveillanceType,
  },
});

function accepted(id, role, query, body, endpoint) {
  const retained = retainedResponseBytes(JSON.parse(body.toString('utf8')));
  return {
    id,
    role,
    query,
    endpoint,
    body: retained,
    transportSha256: captureSha256(body),
    transportBytes: body.length,
  };
}

function countDescendantLeaves(depth) {
  return 4 ** (SPLIT_DEPTH - depth);
}

function addCaptureNode({ bbox, depth, responses, countNodes, dataLeaves, nextId }) {
  const id = tileId(bbox);
  const count = countDescendantLeaves(depth) * CAMERAS_PER_LEAF;
  const responseId = `count:${id}`;
  responses.set(
    responseId,
    accepted(responseId, 'count', countQuery(bbox), countBody(count), OVERPASS_ENDPOINTS[0]),
  );

  if (depth < SPLIT_DEPTH) {
    const children = splitTile(bbox);
    countNodes.push({
      id,
      bbox,
      responseId,
      count,
      resolution: 'split',
      children: children.map(tileId),
      confirmationResponseId: null,
    });
    for (const child of children) {
      addCaptureNode({
        bbox: child,
        depth: depth + 1,
        responses,
        countNodes,
        dataLeaves,
        nextId,
      });
    }
    return;
  }

  countNodes.push({
    id,
    bbox,
    responseId,
    count,
    resolution: 'data',
    children: [],
    confirmationResponseId: null,
  });
  const lat = (bbox.s + bbox.n) / 2;
  const lon = (bbox.w + bbox.e) / 2;
  const elements = Array.from({ length: count }, () => {
    const element = camera(nextId.value, lat, lon, nextId.value === 1 ? 'anpr' : 'ALPR');
    nextId.value += 1;
    return element;
  });
  const dataResponseId = `data:${id}`;
  responses.set(
    dataResponseId,
    accepted(dataResponseId, 'data', dataQuery(bbox), bodyBytes(elements), OVERPASS_ENDPOINTS[1]),
  );
  dataLeaves.push({
    id,
    bbox,
    countResponseId: responseId,
    dataResponseId,
    probed: count,
    featureCount: count,
  });
}

let cached;

/** A complete 120k direct-capture fixture whose every selected point is in Census territory. */
export function completeTerritorialCaptureFixture() {
  if (cached !== undefined) return cached;
  const roots = buildSeedTiles();
  const populatedRoot = roots.find(
    (bbox) => bbox.s === 37 && bbox.w === -105.32 && bbox.n === 43.5,
  );
  if (populatedRoot === undefined) throw new Error('test capture cannot find its pinned seed root');

  const responses = new Map();
  const countNodes = [];
  const dataLeaves = [];
  const nextId = { value: 1 };
  for (const bbox of roots) {
    if (bbox === populatedRoot) {
      addCaptureNode({
        bbox,
        depth: 0,
        responses,
        countNodes,
        dataLeaves,
        nextId,
      });
      continue;
    }
    const id = tileId(bbox);
    const responseId = `count:${id}`;
    const confirmationResponseId = `zero:${id}`;
    responses.set(
      responseId,
      accepted(responseId, 'count', countQuery(bbox), countBody(0), OVERPASS_ENDPOINTS[0]),
    );
    responses.set(
      confirmationResponseId,
      accepted(
        confirmationResponseId,
        'data',
        dataQuery(bbox),
        bodyBytes([]),
        OVERPASS_ENDPOINTS[1],
      ),
    );
    countNodes.push({
      id,
      bbox,
      responseId,
      count: 0,
      resolution: 'zero',
      children: [],
      confirmationResponseId,
    });
  }

  const ca = Array.from({ length: 300 }, (_, index) => camera(1_000_000 + index, 49.5, -123.1));
  const subtractions = {
    CA: { iso: 'CA', responseId: 'subtraction:CA', featureCount: 300, minimum: 300 },
    MX: { iso: 'MX', responseId: 'subtraction:MX', featureCount: 0, minimum: 0 },
  };
  responses.set(
    'subtraction:CA',
    accepted(
      'subtraction:CA',
      'subtraction',
      subtractionQuery('CA'),
      bodyBytes(ca),
      OVERPASS_ENDPOINTS[0],
    ),
  );
  responses.set(
    'subtraction:MX',
    accepted(
      'subtraction:MX',
      'subtraction',
      subtractionQuery('MX'),
      bodyBytes([]),
      OVERPASS_ENDPOINTS[0],
    ),
  );

  const implementationFiles = captureImplementationFiles();
  const capture = finalizeCapture({
    captureId: CAPTURE_ID,
    startedAt: '2026-09-01T21:00:00.000Z',
    completedAt: '2026-09-01T21:05:00.000Z',
    countNodes,
    dataLeaves,
    subtractions,
    responses,
    implementationFiles,
  });
  const validated = validateCaptureArtifacts(capture.ledger, {
    ledgerBytes: capture.ledgerBytes,
    responseBundle: capture.responseBundle,
    rawDataset: capture.rawGzip,
    implementationFiles,
  });
  cached = {
    ledger: capture.ledger,
    ...validated,
    collection: validated.collection,
    artifacts: {
      ledgerBytes: capture.ledgerBytes,
      responseBundle: capture.responseBundle,
      rawDataset: capture.rawGzip,
    },
  };
  return cached;
}

/** A coherent capture whose private marker exists only in retained gzip evidence. */
export function captureWithRetainedOnlyValue(value) {
  const base = completeTerritorialCaptureFixture();
  const bodies = decodeResponseBundle(base.artifacts.responseBundle);
  const queryByResponse = new Map();
  for (const node of base.ledger.topology.countNodes) {
    queryByResponse.set(node.responseId, countQuery(node.bbox));
    if (node.confirmationResponseId !== null) {
      queryByResponse.set(node.confirmationResponseId, dataQuery(node.bbox));
    }
  }
  for (const leaf of base.ledger.topology.dataLeaves) {
    queryByResponse.set(leaf.dataResponseId, dataQuery(leaf.bbox));
  }
  for (const iso of ['CA', 'MX']) {
    queryByResponse.set(base.ledger.topology.subtractions[iso].responseId, subtractionQuery(iso));
  }

  const responses = new Map();
  for (const record of base.ledger.responses) {
    let body = bodies.get(record.id);
    if (record.id === base.ledger.topology.subtractions.CA.responseId) {
      const parsed = JSON.parse(body.toString('utf8'));
      parsed.elements.push({
        type: 'node',
        id: 2_000_000,
        version: 1,
        timestamp: '2026-09-01T20:00:00Z',
        lat: 49.5,
        lon: -123.1,
        tags: { manufacturer: value },
      });
      body = retainedResponseBytes(parsed);
    }
    const query = queryByResponse.get(record.id);
    if (query === undefined || body === undefined) {
      throw new Error(`test capture cannot reconstruct response ${record.id}`);
    }
    responses.set(record.id, {
      id: record.id,
      role: record.role,
      query,
      endpoint: record.endpoint,
      body,
      transportSha256: captureSha256(body),
      transportBytes: body.length,
    });
  }
  const built = finalizeCapture({
    captureId: '22222222-2222-4222-8222-222222222222',
    startedAt: base.ledger.capture.startedAt,
    completedAt: base.ledger.capture.completedAt,
    countNodes: base.ledger.topology.countNodes,
    dataLeaves: base.ledger.topology.dataLeaves,
    subtractions: base.ledger.topology.subtractions,
    responses,
    implementationFiles: captureImplementationFiles(),
  });
  return {
    ledger: built.ledger,
    artifacts: {
      ledgerBytes: built.ledgerBytes,
      responseBundle: built.responseBundle,
      rawDataset: built.rawGzip,
    },
    collection: built.collection,
  };
}

let approvedCached;

/** Exact approved empty-predecessor evidence for real publisher/seed integration tests. */
export async function completeApprovedCaptureFixture() {
  if (approvedCached !== undefined) return approvedCached;
  const capture = completeTerritorialCaptureFixture();
  const baselineLedger = {
    attribution: 'Map data © OpenStreetMap contributors',
    licence: 'ODbL-1.0',
    licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    generatedAt: '2026-09-01T21:05:00.000Z',
    upstream: '2026-09-01T21:00:00.000Z',
    tombstones: [],
  };
  const baselineTombstoneBytes = jsonBytes(baselineLedger);
  const predecessor = buildPredecessorEvidence({
    mode: 'empty-r2',
    entries: [],
    deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
    capturedAt: '2026-09-01T20:59:00.000Z',
  });
  const predecessorBytes = jsonBytes(predecessor);
  const geofenceBytes = readFileSync(DEFAULT_COUNTY_GEOFENCE);
  const proposal = await buildSourceReviewProposal({
    capture,
    tombstoneLedger: {
      ...baselineLedger,
      bytes: baselineTombstoneBytes,
      identity: releaseTombstoneIdentity(baselineTombstoneBytes, baselineLedger),
    },
    geofenceBytes,
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
  const trustedReviewBytes = jsonBytes(proposal);
  approvedCached = {
    capture,
    review: proposal,
    trustedReviewBytes,
    baselineLedger,
    baselineTombstoneBytes,
    predecessor,
    predecessorBytes,
    geofenceBytes,
  };
  return approvedCached;
}

/** Build and attest the real release adapter output at the approved floor. */
export async function buildCompleteApprovedBaseline(root) {
  const approved = await completeApprovedCaptureFixture();
  const target = join(root, 'cameras');
  const stateFile = join(root, 'camera-sync-state.json');
  const dumpPath = join(root, 'source-overpass.json');
  const captureDir = join(root, 'capture');
  await mkdir(target, { recursive: true });
  await mkdir(captureDir, { recursive: true });
  await writeFile(join(target, 'tombstones.json'), approved.baselineTombstoneBytes);
  await writeFile(
    join(captureDir, RESPONSE_LEDGER_PATH.split('/').at(-1)),
    approved.capture.artifacts.ledgerBytes,
  );
  await writeFile(
    join(captureDir, RESPONSE_BUNDLE_PATH.split('/').at(-1)),
    approved.capture.artifacts.responseBundle,
  );
  await writeFile(
    join(captureDir, RAW_DATASET_PATH.split('/').at(-1)),
    approved.capture.artifacts.rawDataset,
  );

  const transformed = transformCapturedCollection(
    approved.capture.collection,
    approved.baselineLedger.tombstones,
    loadCountiesBytes(approved.geofenceBytes),
  );
  const marker = sourceHandoff({
    source: approved.review.expectedSource,
    review: approved.review,
    reviewSha256: createHash('sha256').update(approved.trustedReviewBytes).digest('hex'),
    transformation: transformed.transformation,
  });
  const dump = toOverpassDump(transformed.cameras, sourceProvenance(approved.review), marker);
  await writeFile(dumpPath, jsonBytes(dump));
  await buildCameraArchive([`--input=${dumpPath}`, `--target=${target}`], {
    trustedReviewBytes: approved.trustedReviewBytes,
    baselineTombstoneBytes: approved.baselineTombstoneBytes,
  });
  await writeFile(
    stateFile,
    jsonBytes({
      stream: 'hour',
      lastAppliedSeq: approved.review.replicationFloor.sequence,
      lastAppliedTimestamp: approved.review.replicationFloor.timestamp,
      versionsKnown: true,
      lastRun: '2026-09-01T21:05:00.000Z',
    }),
  );
  await attestCameraContinuity(
    {
      target,
      stateFile,
      sourceReview: 'unused-by-injected-review',
      captureDir: 'unused-by-injected-capture',
      baselineTombstones: null,
    },
    {
      trustedReviewBytes: approved.trustedReviewBytes,
      geofenceBytes: approved.geofenceBytes,
      capture: approved.capture,
      baselineTombstoneBytes: approved.baselineTombstoneBytes,
      validation: { minTiles: 1, minCameras: 1 },
    },
  );
  return { ...approved, target, stateFile, dumpPath, captureDir, marker };
}
