import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createManifest,
  jsonBytes,
  md5,
  readLocalGeneration,
  sha256,
  slotDataPrefix,
  slotManifestKey,
} from './camera-generation.mjs';
import {
  ATTRIBUTION,
  CAMERA_SOURCE_GENERATOR,
  CAMERA_SOURCE_LABEL,
  CAMERA_SOURCE_SCHEMA,
  DEFAULT_COUNTY_GEOFENCE,
  LICENCE,
  LICENCE_URL,
  RELEASE_GEOFENCE_IDENTITY,
  TILE_ZOOM,
  US_BBOX,
  latLonToTile,
  releaseTombstoneIdentity,
} from './fetch-cameras.mjs';
import {
  CAMERA_CONTINUITY_KEY,
  cameraContinuityBytes,
  createCameraContinuity,
} from './camera-integrity.mjs';
import { countyLabel, loadCountiesBytes } from './counties.mjs';

const fixtureCounties = loadCountiesBytes(readFileSync(DEFAULT_COUNTY_GEOFENCE));

export function approvedCameraSourceFixture(mutateReceipt = null) {
  const baselineTombstoneLedger = {
    attribution: ATTRIBUTION,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    generatedAt: '2026-09-01T09:00:00.000Z',
    upstream: '2026-09-01T09:00:00.000Z',
    tombstones: [],
  };
  const baselineTombstoneBytes = jsonBytes(baselineTombstoneLedger);
  const source = {
    country: 'us',
    build: 'aaaaaaaaaaaaaaaa',
    capturedAt: '2026-09-01T10:05:00.000Z',
    total: 120_000,
    rawDataset: {
      path: 'scripts/data/deflock-us-source.geojson.gz',
      format: 'geojson',
      compression: 'gzip',
      bytes: 123,
      sha256: 'b'.repeat(64),
      decodedBytes: 456,
      decodedSha256: 'a'.repeat(64),
      featureCount: 120_000,
    },
  };
  const transformation = {
    sourceFeatures: 120_000,
    excludedNonNodes: 0,
    excludedTerritory: 0,
    tombstonesBlocked: 0,
    tombstonesCleared: 0,
    outputElements: 120_000,
    elementsSha256: 'c'.repeat(64),
    outputTombstones: 0,
    publishedLiveSha256: '5'.repeat(64),
    publishedTombstonesSha256: createHash('sha256').update('[]').digest('hex'),
  };
  const receipt = {
    schema: 'darkroute-deflock-source-review/v3',
    repository: 'flockhopper3/deflock-data',
    headSha: '8d156b24db7090e870af3f007b0caece9b3c0951',
    territories: ['US', 'PR'],
    captureImplementation: {
      files: [
        { path: 'scripts/capture-deflock-source.mjs', bytes: 1, sha256: 'd'.repeat(64) },
        { path: 'scripts/deflock-capture.mjs', bytes: 1, sha256: 'e'.repeat(64) },
      ],
    },
    releaseInputs: {
      geofence: { ...RELEASE_GEOFENCE_IDENTITY },
      predecessor: {
        path: 'scripts/data/camera-predecessor.json',
        bytes: 123,
        sha256: 'f'.repeat(64),
        mode: 'empty-r2',
        liveCount: 0,
        liveIdsSha256: '1'.repeat(64),
        deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
      },
      tombstones: {
        ...releaseTombstoneIdentity(baselineTombstoneBytes, baselineTombstoneLedger),
      },
    },
    expectedSource: source,
    expectedTransformation: transformation,
    sourceWatermark: {
      status: 'approved',
      captureId: '11111111-1111-4111-8111-111111111111',
      minimumOsmBase: '2026-09-01T10:00:00.000Z',
      responseLedger: {
        schema: 'deflock-overpass-response-ledger/v2',
        path: 'scripts/data/deflock-us-overpass-response-ledger.json',
        bytes: 789,
        sha256: 'f'.repeat(64),
        responseCount: 4,
        roleCounts: { count: 1, data: 1, subtraction: 2 },
        endpoints: ['https://overpass.deflock.org/api/interpreter'],
        responseBundle: {
          path: 'scripts/data/deflock-us-overpass-responses.bundle.gz',
          compression: 'gzip',
          bytes: 321,
          sha256: '1'.repeat(64),
          responseCount: 4,
        },
      },
    },
    replicationFloor: {
      stream: 'hour',
      sequence: 9,
      timestamp: '2026-09-01T09:00:00.000Z',
      stateUrl:
        'https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/000/000/009.state.txt',
    },
  };
  if (mutateReceipt !== null) mutateReceipt(receipt);
  const trustedReviewBytes = jsonBytes(receipt);
  return {
    marker: {
      schema: CAMERA_SOURCE_SCHEMA,
      generator: CAMERA_SOURCE_GENERATOR,
      territories: ['US', 'PR'],
      source: structuredClone(receipt.expectedSource),
      review: {
        sha256: createHash('sha256').update(trustedReviewBytes).digest('hex'),
        receipt,
      },
      transformation: structuredClone(receipt.expectedTransformation),
    },
    trustedReviewBytes,
    minimumOsmBase: receipt.sourceWatermark.minimumOsmBase,
    baselineTombstoneBytes,
  };
}

export async function makeCameraFixture(
  root,
  {
    id = 'osm:1',
    lat = 38.9,
    lon = -94.7,
    sequence = 10,
    timestamp = '2026-09-01T10:00:00.000Z',
    tombstones = [],
    versionsKnown = false,
    osmVersion,
    basePointer,
    cameraSource,
    baseUpstream,
  } = {},
) {
  const archive = join(root, 'cameras');
  const stateFile = join(root, 'camera-sync-state.json');
  const { x, y } = latLonToTile(lat, lon, TILE_ZOOM);
  const fixtureCounty = versionsKnown ? fixtureCounties.lookup(lat, lon) : null;
  const tileKey = `${String(TILE_ZOOM)}/${String(x)}/${String(y)}.json`;
  const files = {
    [tileKey]: {
      z: TILE_ZOOM,
      x,
      y,
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      cameras: [
        versionsKnown
          ? {
              id,
              lat,
              lon,
              directionDeg: null,
              ownerType: 'unverified',
              confirmations: 1,
              countyFips: fixtureCounty?.fips ?? '00000',
              ...(osmVersion === undefined ? {} : { osmVersion }),
              updatedAt: Date.parse(timestamp),
              tags: {},
            }
          : { id, lat, lon, ...(osmVersion === undefined ? {} : { osmVersion }) },
      ],
    },
    'index.json': {
      zoom: TILE_ZOOM,
      generatedAt: timestamp,
      source: cameraSource === undefined ? 'fixture' : CAMERA_SOURCE_LABEL,
      upstream: timestamp,
      ...(baseUpstream === undefined ? {} : { baseUpstream }),
      ...(cameraSource === undefined ? {} : { cameraSource }),
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      cameras: 1,
      tiles: 1,
      ...(versionsKnown ? { bbox: US_BBOX } : {}),
    },
    'overview.json': {
      schema: 'fwm-overview/v1',
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      count: 1,
      coords: [lat, lon],
    },
    'tombstones.json': {
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      generatedAt: timestamp,
      upstream: timestamp,
      tombstones,
    },
    'places.json': {
      ...(versionsKnown
        ? {
            generatedAt: timestamp,
            source: 'No place enrichment in the approved direct-capture baseline',
          }
        : {}),
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      places: 0,
      ...(versionsKnown ? { inPlace: 0, unincorporated: 1 } : {}),
      rows: [],
    },
    'counties.json': {
      ...(versionsKnown
        ? {
            generatedAt: timestamp,
            source: 'US Census county polygons, joined point-in-polygon',
          }
        : {}),
      attribution: ATTRIBUTION,
      licence: LICENCE,
      licenceUrl: LICENCE_URL,
      counties: versionsKnown && fixtureCounty !== null ? 1 : 0,
      ...(versionsKnown
        ? { located: fixtureCounty === null ? 0 : 1, unlocated: fixtureCounty === null ? 1 : 0 }
        : {}),
      rows:
        versionsKnown && fixtureCounty !== null
          ? [
              {
                fips: fixtureCounty.fips,
                name: fixtureCounty.name,
                lsad: fixtureCounty.lsad,
                state: fixtureCounty.state,
                label: countyLabel(fixtureCounty),
                cameras: 1,
              },
            ]
          : [],
    },
  };
  if (versionsKnown && cameraSource?.review?.receipt?.replicationFloor !== undefined) {
    const floor = cameraSource.review.receipt.replicationFloor;
    const baselineTombstones = [];
    const baselineTombstonesSha256 = cameraSource.transformation.publishedTombstonesSha256;
    const diffCount = sequence - floor.sequence;
    const diffs = Array.from({ length: Math.max(0, diffCount) }, (_, index) => {
      const diffSequence = floor.sequence + index + 1;
      const path = String(diffSequence).padStart(9, '0').match(/.{3}/g).join('/');
      return {
        sequence: diffSequence,
        timestamp: index === diffCount - 1 ? timestamp : floor.timestamp,
        stateUrl: `https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/${path}.state.txt`,
        stateBytes: 1,
        stateSha256: '7'.repeat(64),
        diffUrl: `https://osm-planet-us-west-2.s3.amazonaws.com/planet/replication/hour/${path}.osc.gz`,
        diffBytes: 1,
        diffSha256: '8'.repeat(64),
      };
    });
    const live = files[tileKey].cameras;
    files[CAMERA_CONTINUITY_KEY] = createCameraContinuity({
      reviewSha256: cameraSource.review.sha256,
      baseline: {
        sequence: floor.sequence,
        timestamp: floor.timestamp,
        liveSha256: cameraSource.transformation.publishedLiveSha256,
        tombstonesSha256: baselineTombstonesSha256,
      },
      baselineTombstones,
      transition: {
        kind: 'baseline-replay',
        parent: null,
        fromSequence: floor.sequence,
        throughSequence: sequence,
        diffs,
      },
      replication: {
        stream: 'hour',
        lastAppliedSeq: sequence,
        lastAppliedTimestamp: timestamp,
        versionsKnown: true,
      },
      live,
      tombstones,
    });
  }
  for (const [key, value] of Object.entries(files)) {
    const path = join(archive, key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(
      path,
      key === CAMERA_CONTINUITY_KEY ? cameraContinuityBytes(value) : jsonBytes(value),
    );
  }
  await writeFile(
    stateFile,
    jsonBytes({
      stream: 'hour',
      lastAppliedSeq: sequence,
      lastAppliedTimestamp: timestamp,
      versionsKnown,
      lastRun: timestamp,
      ...(basePointer === undefined ? {} : { basePointer }),
    }),
  );
  return { archive, stateFile, tileKey };
}

export async function setFixtureBasePointer(fixture, basePointer) {
  const state = JSON.parse(await readFile(fixture.stateFile, 'utf8'));
  await writeFile(fixture.stateFile, jsonBytes({ ...state, basePointer }));
}

export async function fixtureGeneration(
  fixture,
  createdAt = '2026-09-01T10:01:00.000Z',
  validation = {},
) {
  const local = await readLocalGeneration(fixture.archive, fixture.stateFile, {
    minTiles: 1,
    minCameras: 1,
    ...validation,
  });
  const manifest = createManifest({
    createdAt,
    replication: local.replication,
    archive: local.archive,
    files: local.files,
  });
  const manifestBody = jsonBytes(manifest);
  return { local, manifest, manifestBody, manifestSha256: sha256(manifestBody) };
}

function error(name, status) {
  const value = new Error(name);
  value.name = name;
  value.$metadata = { httpStatusCode: status };
  return value;
}

export class MemoryR2 {
  constructor(fault = null) {
    this.objects = new Map();
    this.events = [];
    this.fault = fault;
  }

  set(key, body) {
    const bytes = Buffer.from(body);
    this.objects.set(key, { body: bytes, etag: md5(bytes) });
  }

  get(key) {
    return this.objects.get(key)?.body;
  }

  async send(command, requestOptions = {}) {
    const input = command.input;
    const type = command.constructor.name;
    const event = { type, key: input.Key, input, requestOptions };
    this.events.push(event);
    if (requestOptions.abortSignal?.aborted === true) {
      const aborted = new Error('AbortError');
      aborted.name = 'AbortError';
      throw aborted;
    }
    if (this.fault !== null) await this.fault(event, this);

    if (type === 'PutObjectCommand') {
      const held = this.objects.get(input.Key);
      if (input.IfNoneMatch === '*' && held !== undefined) throw error('PreconditionFailed', 412);
      if (input.IfMatch !== undefined && held?.etag !== input.IfMatch.replaceAll('"', '')) {
        throw error('PreconditionFailed', 412);
      }
      this.set(input.Key, input.Body);
      return { ETag: `"${this.objects.get(input.Key).etag}"` };
    }
    if (type === 'GetObjectCommand') {
      const held = this.objects.get(input.Key);
      if (held === undefined) throw error('NoSuchKey', 404);
      if (input.IfMatch !== undefined && input.IfMatch !== `"${held.etag}"`) {
        throw error('PreconditionFailed', 412);
      }
      return {
        Body: { transformToByteArray: async () => Uint8Array.from(held.body) },
        ContentLength: held.body.byteLength,
        ETag: `"${held.etag}"`,
      };
    }
    if (type === 'DeleteObjectCommand') {
      const held = this.objects.get(input.Key);
      if (
        input.IfMatch !== undefined &&
        held !== undefined &&
        held.etag !== input.IfMatch.replaceAll('"', '')
      ) {
        throw error('PreconditionFailed', 412);
      }
      this.objects.delete(input.Key);
      return {};
    }
    if (type === 'ListObjectsV2Command') {
      const contents = [...this.objects.entries()]
        .filter(([key]) => key.startsWith(input.Prefix ?? ''))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([Key, held]) => ({
          Key,
          Size: held.body.byteLength,
          ETag: `"${held.etag}"`,
        }));
      return { Contents: contents, IsTruncated: false };
    }
    throw new Error(`unsupported fake R2 command ${type}`);
  }
}

export function seedGeneration(r2, slot, generation) {
  const prefix = slotDataPrefix(slot);
  for (const entry of generation.local.entries) r2.set(`${prefix}${entry.key}`, entry.body);
  r2.set(slotManifestKey(slot), generation.manifestBody);
}
