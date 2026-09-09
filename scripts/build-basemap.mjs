/**
 * Build and verify the public US basemap without trusting a remembered bbox.
 *
 * The previous "US" archive was clipped to the contiguous-US bbox while its
 * filename implied nationwide coverage. This workflow binds the build to a
 * reviewed county FeatureCollection covering the 50 states, DC, and Puerto
 * Rico, then proves detailed tiles exist across that territory before it emits
 * the receipt required by `publish-basemap.mjs`.
 *
 * Planning performs only bounded metadata/header reads; it does not build or
 * write an archive. No live object is ever changed here. A large build requires
 * an explicit absolute output directory and a dated confirmation token. It
 * keeps one region extract, partitions z0-13 into three groups and z14 into 32
 * exact tile-column shards, filters one shard at a time, and merges with a
 * maximum fan-in of four:
 *
 *   node scripts/build-basemap.mjs --plan
 *   node scripts/build-basemap.mjs --build \
 *     --out-dir=/absolute/recoverable/workspace --confirm-heavy=20260901
 *
 * Every completed artifact is SHA-256 checkpointed. An interrupted candidate
 * is validated and adopted on the next invocation, or preserved under a
 * `.rejected-*` name before that one bounded step is retried. `--max-steps`
 * bounds how many plan steps one invocation may finish. The build command
 * stops after its final decoded-byte union gate; verification then emits the
 * receipt through the separately resumable path below.
 *
 * Verification is resumable. The mutable checkpoint is bound to the complete
 * archive SHA-256. `--max-tiles` and `--max-seconds` make one invocation
 * bounded; rerun the same command to continue:
 *
 *   node scripts/build-basemap.mjs \
 *     --verify=/absolute/basemap-us-20260901-full-us.pmtiles \
 *     --max-tiles=250000 --max-seconds=1800
 *
 * Tool paths may be supplied with PMTILES_BIN, TILE_JOIN_BIN, and
 * TIPPECANOE_DECODE_BIN. The resolved executables still have to match the
 * reviewed hashes below. No shell is involved in any build command.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  createReadStream,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statfsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { freemem } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export const RECEIPT_SCHEMA = 'darkroute-basemap-build/v1';
export const CHECKPOINT_SCHEMA = 'darkroute-basemap-verify-checkpoint/v1';
export const BUILD_CHECKPOINT_SCHEMA = 'darkroute-basemap-build-checkpoint/v1';
export const LOGICAL_DIGEST_SCHEMA = 'darkroute-pmtiles-logical-partitions/v1';

export const SOURCE = Object.freeze({
  metadataUrl: 'https://build-metadata.protomaps.dev/builds.json',
  url: 'https://build.protomaps.com/20260901.pmtiles',
  key: '20260901.pmtiles',
  version: '4.15.2',
  bytes: 137_684_510_455,
  md5Base64: '4ovsd6cRA6sZe+A1QkFQRg==',
  blake3: '0ca1c0cb1d711394d3dc458e51d5a7c9363f50f5d4fa9099b4f3a8690f4d7522',
  uploaded: '2026-09-01T09:08:29.959Z',
  osmTimestamp: '2026-09-01T04:00:00Z',
  license: 'OpenStreetMap ODbL 1.0 Produced Work; attribution required',
});

export const REGION = Object.freeze({
  repositoryPath: 'scripts/data/us-counties.geojson',
  bytes: 3_216_816,
  sha256: 'e540149b7525e71ee6b6cab6dea2a95205f11e0c3e7374d27a7c9c47ea96e8c0',
  features: 3_221,
  bounds: Object.freeze({
    minLon: -179.14734,
    minLat: 17.884813,
    maxLon: 179.77847,
    maxLat: 71.352561,
  }),
  stateCodes: Object.freeze([
    '01',
    '02',
    '04',
    '05',
    '06',
    '08',
    '09',
    '10',
    '11',
    '12',
    '13',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
    '28',
    '29',
    '30',
    '31',
    '32',
    '33',
    '34',
    '35',
    '36',
    '37',
    '38',
    '39',
    '40',
    '41',
    '42',
    '44',
    '45',
    '46',
    '47',
    '48',
    '49',
    '50',
    '51',
    '53',
    '54',
    '55',
    '56',
    '72',
  ]),
  license: 'MIT (plotly/datasets, commit 95672208c26b44a6e32363b17a35b8caa1b5d2ef)',
});

export const TOOL_PINS = Object.freeze({
  pmtiles: Object.freeze({
    env: 'PMTILES_BIN',
    command: 'pmtiles',
    version:
      'pmtiles 1.31.2, commit a3e4951ea6a0477b784c27c1dcbfd9c130878c5a, built at 2026-07-22T18:59:03Z',
    sha256: 'a7e9ae10184d109c83f456ccdf6df4f3e2a64ba6cf69d9ed0f9f1840305055c1',
    artifactUrl:
      'https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz',
    artifactSha256: '3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f',
    license: 'BSD-3-Clause',
  }),
  tileJoin: Object.freeze({
    env: 'TILE_JOIN_BIN',
    command: 'tile-join',
    version: 'tile-join v2.82.0',
    sha256: '8175b4792da76c1cd3fc55ef7ef4f6024569224fbe0393f2c22ce56a9903b3fd',
    sourceUrl: 'https://github.com/felt/tippecanoe.git',
    sourceCommit: '4f2621186acfec33b63ddf636f665623c0fef2dd',
    sourceTree: 'fec0968c6b6b8bc6e9c1e7c1b635f6b8b02041dc',
    buildPlatform: 'Ubuntu 24.04 x86-64; GCC 13.3.0-6ubuntu2~24.04.1',
    license: 'BSD-2-Clause',
  }),
  tippecanoeDecode: Object.freeze({
    env: 'TIPPECANOE_DECODE_BIN',
    command: 'tippecanoe-decode',
    version: 'tippecanoe v2.82.0 suite',
    sha256: '3c023ce3a137aab223b9329b7c3ae2963279e65362607ab03d8dd685ff417363',
    sourceUrl: 'https://github.com/felt/tippecanoe.git',
    sourceCommit: '4f2621186acfec33b63ddf636f665623c0fef2dd',
    sourceTree: 'fec0968c6b6b8bc6e9c1e7c1b635f6b8b02041dc',
    buildPlatform: 'Ubuntu 24.04 x86-64; GCC 13.3.0-6ubuntu2~24.04.1',
    license: 'BSD-2-Clause',
  }),
});

export const EXPECTED_LAYERS = Object.freeze([
  Object.freeze({ id: 'boundaries', minzoom: 0, maxzoom: 14 }),
  Object.freeze({ id: 'earth', minzoom: 0, maxzoom: 14 }),
  Object.freeze({ id: 'landcover', minzoom: 0, maxzoom: 7 }),
  Object.freeze({ id: 'places', minzoom: 1, maxzoom: 14 }),
  Object.freeze({ id: 'roads', minzoom: 3, maxzoom: 14 }),
  Object.freeze({ id: 'water', minzoom: 0, maxzoom: 14 }),
]);

const SOURCE_LAYERS = Object.freeze([
  'boundaries',
  'buildings',
  'earth',
  'landcover',
  'landuse',
  'places',
  'pois',
  'roads',
  'water',
]);

export const COVERAGE_SPOTS = Object.freeze([
  Object.freeze({ id: 'anchorage-ak', lon: -149.9003, lat: 61.2181, layers: ['roads'] }),
  Object.freeze({ id: 'dc', lon: -77.0365, lat: 38.8977, layers: ['roads'] }),
  Object.freeze({ id: 'honolulu-hi', lon: -157.8583, lat: 21.3069, layers: ['roads'] }),
  Object.freeze({ id: 'kansas-city-mo', lon: -94.5786, lat: 39.0997, layers: ['roads'] }),
  Object.freeze({ id: 'san-juan-pr', lon: -66.1057, lat: 18.4655, layers: ['roads'] }),
  Object.freeze({ id: 'adak-west-aleutians', lon: -176.6581, lat: 51.88, layers: ['roads'] }),
  Object.freeze({
    id: 'semisopochnoi-east-aleutians',
    lon: 179.6270195,
    lat: 51.9490155,
    layers: ['earth', 'water'],
  }),
]);

export const RESOURCE_LIMITS = Object.freeze({
  minimumFreeDiskBytes: 64 * 1024 ** 3,
  minimumAvailableMemoryBytes: 4 * 1024 ** 3,
  emergencyFreeDiskBytes: 8 * 1024 ** 3,
  emergencyAvailableMemoryBytes: 1024 ** 3,
  maximumStepRssBytes: 4 * 1024 ** 3,
  measuredTileJoinPeakRssBytes: 7_553_376 * 1024,
  expectedExtractTransferBytes: 8.3e9,
  expectedRawArchiveBytes: 7.9e9,
  expectedPeakWorkspaceBytes: 40e9,
  expectedWallSeconds: Object.freeze({ minimum: 14_400, maximum: 28_800 }),
});

export const OUTPUT_NAMES = Object.freeze({
  raw: 'basemap-us-20260901-50dcpr-raw.pmtiles',
  archive: 'basemap-us-20260901-full-us.pmtiles',
  uneditedArchive: 'basemap-us-20260901-full-us-unedited.pmtiles',
  metadata: 'basemap-us-20260901-full-us.metadata.json',
  buildCheckpoint: 'basemap-us-20260901.build-state.json',
});

export const Z14_SHARD_COUNT = 32;
export const SHARD_BOUNDARY_EPSILON = 0.0000001;
export const LEGACY_BUILD_PLAN_SHA256 =
  '622d7cb3a2b0b45959ea6b85f88b55edfd76ff148f7b69cf8291ca12f4a0c250';
const LEGACY_BUILD_PREFIX_SHA256 =
  'a5d11b9d7d0608674b176cc8a175b514cfeffce22ec61028e04e31de0297f267';
const SHARD_MERCATOR_LATITUDE = 85.0511287;
export const EXTRACT_METRICS = Object.freeze([
  Object.freeze({ id: 'z00-10', minZoom: 0, maxZoom: 10, entries: 20_859, bytes: 340e6 }),
  Object.freeze({ id: 'z11-12', minZoom: 11, maxZoom: 12, entries: 260_787, bytes: 1.3e9 }),
  Object.freeze({ id: 'z13', minZoom: 13, maxZoom: 13, entries: 759_472, bytes: 2.1e9 }),
  Object.freeze({ id: 'z14', minZoom: 14, maxZoom: 14, entries: 2_736_068, bytes: 4.2e9 }),
]);

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const CHECKPOINT_INTERVAL_TILES = 10_000;
const CHECKPOINT_INTERVAL_MS = 15_000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;
const MAX_TILE_BYTES = 64 * 1024 * 1024;
const MAX_MERCATOR_LAT = 85.05112878;

function usage() {
  return (
    'usage:\n' +
    '  node scripts/build-basemap.mjs --plan\n' +
    '  node scripts/build-basemap.mjs --build --out-dir=/absolute/path --confirm-heavy=20260901 [--max-steps=N]\n' +
    '  node scripts/build-basemap.mjs --verify=/absolute/archive.pmtiles [--max-tiles=N] [--max-seconds=N]\n'
  );
}

export function parseArguments(argv) {
  const result = {
    mode: null,
    outDir: null,
    archive: null,
    maxSteps: Infinity,
    maxTiles: Infinity,
    maxSeconds: Infinity,
  };
  let confirmed = false;
  for (const argument of argv) {
    if (argument === '--plan') {
      if (result.mode !== null) throw new Error('choose exactly one mode');
      result.mode = 'plan';
    } else if (argument === '--build') {
      if (result.mode !== null) throw new Error('choose exactly one mode');
      result.mode = 'build';
    } else if (argument.startsWith('--verify=')) {
      if (result.mode !== null) throw new Error('choose exactly one mode');
      result.mode = 'verify';
      result.archive = argument.slice('--verify='.length);
    } else if (argument.startsWith('--out-dir=')) {
      result.outDir = argument.slice('--out-dir='.length);
    } else if (argument === '--confirm-heavy=20260901') {
      confirmed = true;
    } else if (argument.startsWith('--max-steps=')) {
      result.maxSteps = positiveInteger(argument.slice('--max-steps='.length), '--max-steps');
    } else if (argument.startsWith('--max-tiles=')) {
      result.maxTiles = positiveInteger(argument.slice('--max-tiles='.length), '--max-tiles');
    } else if (argument.startsWith('--max-seconds=')) {
      result.maxSeconds = positiveInteger(argument.slice('--max-seconds='.length), '--max-seconds');
    } else if (argument === '--help') {
      return { ...result, mode: 'help' };
    } else {
      throw new Error(`unknown argument ${JSON.stringify(argument)}\n${usage()}`);
    }
  }

  if (result.mode === null) throw new Error(usage());
  if (result.mode === 'build') {
    if (!confirmed) throw new Error('heavy build requires --confirm-heavy=20260901');
    if (result.outDir === null || result.outDir === '')
      throw new Error('--build requires --out-dir');
    if (result.maxTiles !== Infinity || result.maxSeconds !== Infinity) {
      throw new Error('build mode does not accept verifier bounds; use --verify to resume');
    }
  } else if (result.outDir !== null || confirmed) {
    throw new Error('--out-dir and --confirm-heavy are valid only with --build');
  }
  if (
    result.mode !== 'verify' &&
    (result.maxTiles !== Infinity || result.maxSeconds !== Infinity)
  ) {
    throw new Error('--max-tiles and --max-seconds are valid only with --verify');
  }
  if (result.mode !== 'build' && result.maxSteps !== Infinity) {
    throw new Error('--max-steps is valid only with --build');
  }
  if (result.mode === 'verify' && (result.archive === null || result.archive === '')) {
    throw new Error('--verify needs an archive path');
  }
  return result;
}

function positiveInteger(value, flag) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${flag} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} is too large`);
  return parsed;
}

const FILTER_ARGUMENTS = Object.freeze([
  '--no-tile-size-limit',
  '--no-tile-stats',
  '--exclude-layer=buildings',
  '--exclude-layer=pois',
  '--exclude-layer=landuse',
]);

function fixedLongitude(value) {
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(7);
}

export function tileXToLongitude(x, zoom = 14) {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 26) throw new Error('invalid tile zoom');
  if (!Number.isInteger(x) || x < 0 || x > 2 ** zoom) {
    throw new Error('tile x boundary is outside zoom bounds');
  }
  return (x / 2 ** zoom) * 360 - 180;
}

export function archivePartitions(shardCount = Z14_SHARD_COUNT) {
  const columns = 2 ** 14;
  if (
    !Number.isInteger(shardCount) ||
    shardCount < 1 ||
    shardCount > columns ||
    columns % shardCount !== 0
  ) {
    throw new Error('z14 shard count must divide the z14 tile-column count');
  }
  const lower = EXTRACT_METRICS.slice(0, 3).map(({ id, minZoom, maxZoom }) => ({
    id,
    minZoom,
    maxZoom,
    xMin: null,
    xMax: null,
    bbox: null,
  }));
  const width = columns / shardCount;
  const z14 = Array.from({ length: shardCount }, (_, index) => {
    const xMin = index * width;
    const xMax = xMin + width - 1;
    const west = tileXToLongitude(xMin);
    const eastBoundary = tileXToLongitude(xMax + 1);
    const east = eastBoundary - SHARD_BOUNDARY_EPSILON;
    return {
      id: `z14-x${String(xMin).padStart(5, '0')}-${String(xMax).padStart(5, '0')}`,
      minZoom: 14,
      maxZoom: 14,
      xMin,
      xMax,
      bbox:
        `${fixedLongitude(west)},${fixedLongitude(-SHARD_MERCATOR_LATITUDE)},` +
        `${fixedLongitude(east)},${fixedLongitude(SHARD_MERCATOR_LATITUDE)}`,
    };
  });
  return [...lower, ...z14];
}

function longitudeRangesForPolygon(polygon) {
  let coordinateCount = 0;
  let rawMinimum = Infinity;
  let rawMaximum = -Infinity;
  let shiftedMinimum = Infinity;
  let shiftedMaximum = -Infinity;
  let hasNegative = false;
  let hasNonNegative = false;
  for (const [longitude] of coordinatePairs(polygon)) {
    if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new Error('region polygon has an invalid longitude coordinate');
    }
    coordinateCount += 1;
    rawMinimum = Math.min(rawMinimum, longitude);
    rawMaximum = Math.max(rawMaximum, longitude);
    const shifted = longitude < 0 ? longitude + 360 : longitude;
    shiftedMinimum = Math.min(shiftedMinimum, shifted);
    shiftedMaximum = Math.max(shiftedMaximum, shifted);
    hasNegative ||= longitude < 0;
    hasNonNegative ||= longitude >= 0;
  }
  if (coordinateCount === 0) throw new Error('region polygon has no longitude coordinates');
  const crossesAntimeridian =
    hasNegative &&
    hasNonNegative &&
    rawMaximum - rawMinimum > 180 &&
    shiftedMaximum - shiftedMinimum < rawMaximum - rawMinimum;
  if (!crossesAntimeridian) {
    return [[rawMinimum, rawMaximum]];
  }
  return [
    [-180, shiftedMaximum - 360],
    [shiftedMinimum, 180],
  ];
}

export function z14RegionShardCoverage(collection, shardCount = Z14_SHARD_COUNT) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('z14 shard coverage requires a GeoJSON FeatureCollection');
  }
  const shards = archivePartitions(shardCount).filter(({ minZoom }) => minZoom === 14);
  const occupied = new Set();
  const features = collection.features.map((feature) => {
    const polygons =
      feature?.geometry?.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature?.geometry?.type === 'MultiPolygon'
          ? feature.geometry.coordinates
          : null;
    if (!Array.isArray(polygons) || polygons.length === 0) {
      throw new Error(`region feature ${String(feature?.id ?? '')} has no polygons`);
    }
    const featureShards = new Set();
    for (const polygon of polygons) {
      for (const [minimumLongitude, maximumLongitude] of longitudeRangesForPolygon(polygon)) {
        const minimumX = lonLatToTile(minimumLongitude, 0, 14).x;
        const maximumX = lonLatToTile(maximumLongitude, 0, 14).x;
        for (let index = 0; index < shards.length; index += 1) {
          const shard = shards[index];
          if (shard.xMax >= minimumX && shard.xMin <= maximumX) {
            featureShards.add(index);
            occupied.add(index);
          }
        }
      }
    }
    if (featureShards.size === 0) {
      throw new Error(`region feature ${String(feature?.id ?? '')} intersects no z14 shard`);
    }
    return Object.freeze({
      id: String(feature.id),
      shardIndices: Object.freeze([...featureShards].sort((left, right) => left - right)),
    });
  });
  return Object.freeze({
    features: Object.freeze(features),
    shardIndices: Object.freeze([...occupied].sort((left, right) => left - right)),
  });
}

const PINNED_REGION_COLLECTION = validateRegionBytes(
  readFileSync(new URL('data/us-counties.geojson', import.meta.url)),
).collection;
const PINNED_Z14_SHARD_COVERAGE = z14RegionShardCoverage(PINNED_REGION_COLLECTION);
export const Z14_NONEMPTY_SHARD_INDICES = PINNED_Z14_SHARD_COVERAGE.shardIndices;

function maximumPartitionBytes(partition) {
  if (partition.id === 'z00-10') return 1024 ** 3;
  if (partition.id === 'z11-12') return 2 * 1024 ** 3;
  if (partition.id === 'z13') return 3 * 1024 ** 3;
  // The aggregate z14 extract is 4.2 GB, but its populated longitude shards
  // are geographically skewed. Keep a bounded 2 GiB cap for the densest shard
  // instead of assuming an even 32-way split.
  return 2 * 1024 ** 3;
}

function stepResources(kind, maximumOutputBytes) {
  const tileJoin = kind === 'filter';
  return {
    minimumFreeDiskBytes: Math.max(16 * 1024 ** 3, maximumOutputBytes + 8 * 1024 ** 3),
    minimumAvailableMemoryBytes: tileJoin ? 4 * 1024 ** 3 : 2 * 1024 ** 3,
    emergencyFreeDiskBytes: RESOURCE_LIMITS.emergencyFreeDiskBytes,
    emergencyAvailableMemoryBytes: RESOURCE_LIMITS.emergencyAvailableMemoryBytes,
    maximumRssBytes: tileJoin ? RESOURCE_LIMITS.maximumStepRssBytes : 2 * 1024 ** 3,
    maximumSeconds: kind === 'source' ? 14_400 : tileJoin ? 7_200 : 3_600,
    maximumOutputBytes,
  };
}

export function buildPlan(regionPath = `$REPO/${REGION.repositoryPath}`) {
  const partitions = archivePartitions();
  const rawByPartition = new Map();
  const filteredByPartition = new Map();
  const z14Partitions = partitions.filter(({ minZoom }) => minZoom === 14);
  const nonemptyZ14Ids = new Set(
    Z14_NONEMPTY_SHARD_INDICES.map((index) => z14Partitions[index].id),
  );
  const isEmptyZ14 = (partition) => partition.minZoom === 14 && !nonemptyZ14Ids.has(partition.id);
  const presentOutputs = (outputs) => [...outputs].filter((output) => output !== null);
  const steps = [];
  const add = (step) =>
    steps.push(
      Object.freeze({
        ...step,
        validators: step.outputs
          .filter((output) => output.endsWith('.pmtiles'))
          .map((output) => ({ tool: 'pmtiles', argv: ['verify', output] })),
      }),
    );
  add({
    id: 'extract-source',
    kind: 'source',
    tool: 'pmtiles',
    cwd: '$OUT',
    argv: [
      'extract',
      SOURCE.url,
      OUTPUT_NAMES.raw,
      `--region=${regionPath}`,
      '--minzoom=0',
      '--maxzoom=14',
      '--download-threads=4',
      '--overfetch=0.05',
    ],
    inputs: [],
    outputs: [OUTPUT_NAMES.raw],
    partitions: partitions.map(({ id }) => id),
    resources: stepResources('source', 12 * 1024 ** 3),
  });

  for (const partition of partitions) {
    const output = `intermediate-raw-${partition.id}.pmtiles`;
    if (isEmptyZ14(partition)) {
      rawByPartition.set(partition.id, null);
      add({
        id: `partition-${partition.id}`,
        kind: 'empty-partition',
        tool: null,
        cwd: '$OUT',
        argv: [],
        inputs: [],
        outputs: [],
        preservedCandidates: [output],
        partitions: [partition.id],
        resources: stepResources('validation', 0),
      });
      continue;
    }
    rawByPartition.set(partition.id, output);
    const argv = [
      'extract',
      OUTPUT_NAMES.raw,
      output,
      `--minzoom=${String(partition.minZoom)}`,
      `--maxzoom=${String(partition.maxZoom)}`,
    ];
    if (partition.bbox !== null) argv.push(`--bbox=${partition.bbox}`);
    argv.push('--download-threads=1', '--overfetch=0');
    add({
      id: `partition-${partition.id}`,
      kind: 'partition',
      tool: 'pmtiles',
      cwd: '$OUT',
      argv,
      inputs: [OUTPUT_NAMES.raw],
      outputs: [output],
      partitions: [partition.id],
      resources: stepResources('partition', maximumPartitionBytes(partition)),
    });
  }
  add({
    id: 'validate-raw-partitions',
    kind: 'logical-gate',
    tool: null,
    cwd: '$OUT',
    argv: [],
    inputs: [OUTPUT_NAMES.raw, ...presentOutputs(rawByPartition.values())],
    outputs: [],
    partitions: partitions.map(({ id }) => id),
    resources: stepResources('validation', 0),
  });

  for (const partition of partitions) {
    const input = rawByPartition.get(partition.id);
    const output = `intermediate-filtered-${partition.id}.pmtiles`;
    if (input === null) {
      filteredByPartition.set(partition.id, null);
      add({
        id: `filter-${partition.id}`,
        kind: 'empty-filter',
        tool: null,
        cwd: '$OUT',
        argv: [],
        inputs: [],
        outputs: [],
        preservedCandidates: [output],
        partitions: [partition.id],
        resources: stepResources('validation', 0),
      });
      continue;
    }
    filteredByPartition.set(partition.id, output);
    add({
      id: `filter-${partition.id}`,
      kind: 'filter',
      tool: 'tileJoin',
      cwd: '$OUT',
      argv: [...FILTER_ARGUMENTS, `--output=${output}`, input],
      inputs: [input],
      outputs: [output],
      partitions: [partition.id],
      resources: stepResources('filter', maximumPartitionBytes(partition)),
    });
  }

  const lowerMergeInputs = partitions
    .filter(({ maxZoom }) => maxZoom < 14)
    .map(({ id }) => filteredByPartition.get(id));
  const z14MergeInputs = partitions
    .filter(({ minZoom }) => minZoom === 14)
    .map(({ id }) => filteredByPartition.get(id))
    .filter((input) => input !== null);
  const continentalAnchor = filteredByPartition.get(z14Partitions[7].id);
  if (continentalAnchor === null) {
    throw new Error('pinned continental z14 merge anchor does not intersect the region');
  }
  const firstLevelGroups = [...lowerMergeInputs, continentalAnchor].map((input) => [input]);
  const remaining = z14MergeInputs.filter((input) => input !== continentalAnchor);
  for (let index = 0; index < remaining.length; index += 1) {
    firstLevelGroups[index % firstLevelGroups.length].push(remaining[index]);
  }
  let mergeInputs = [];
  for (let index = 0; index < firstLevelGroups.length; index += 1) {
    const inputs = firstLevelGroups[index];
    const output = `intermediate-merge-l1-${String(index).padStart(2, '0')}.pmtiles`;
    add({
      id: `merge-l1-${String(index).padStart(2, '0')}`,
      kind: 'merge',
      tool: 'pmtiles',
      cwd: '$OUT',
      argv: ['merge', ...inputs, output],
      inputs,
      outputs: [output],
      partitions: [],
      resources: stepResources('merge', 12 * 1024 ** 3),
    });
    mergeInputs.push(output);
  }
  let level = 2;
  while (mergeInputs.length > 1) {
    const next = [];
    for (let offset = 0; offset < mergeInputs.length; offset += 4) {
      const inputs = mergeInputs.slice(offset, offset + 4);
      const lastMerge = mergeInputs.length <= 4 && offset === 0;
      const output = lastMerge
        ? OUTPUT_NAMES.uneditedArchive
        : `intermediate-merge-l${String(level)}-${String(offset / 4).padStart(2, '0')}.pmtiles`;
      add({
        id: lastMerge
          ? 'merge-unedited-final'
          : `merge-l${String(level)}-${String(offset / 4).padStart(2, '0')}`,
        kind: 'merge',
        tool: 'pmtiles',
        cwd: '$OUT',
        argv: ['merge', ...inputs, output],
        inputs,
        outputs: [output],
        partitions: [],
        resources: stepResources('merge', 12 * 1024 ** 3),
      });
      next.push(output);
    }
    mergeInputs = next;
    level += 1;
  }

  add({
    id: 'finalize-metadata',
    kind: 'metadata',
    tool: 'pmtiles',
    cwd: '$OUT',
    argv: ['edit', OUTPUT_NAMES.archive, `--metadata=${OUTPUT_NAMES.metadata}`],
    inputs: [OUTPUT_NAMES.uneditedArchive, ...presentOutputs(filteredByPartition.values())],
    outputs: [OUTPUT_NAMES.metadata, OUTPUT_NAMES.archive],
    partitions: partitions.map(({ id }) => id),
    resources: stepResources('metadata', 12 * 1024 ** 3),
  });
  add({
    id: 'validate-final-union',
    kind: 'logical-gate',
    tool: null,
    cwd: '$OUT',
    argv: [],
    inputs: [OUTPUT_NAMES.archive, ...presentOutputs(filteredByPartition.values())],
    outputs: [],
    partitions: partitions.map(({ id }) => id),
    resources: stepResources('validation', 0),
  });
  return Object.freeze(steps);
}

export function commandPlan(regionPath = `$REPO/${REGION.repositoryPath}`) {
  const commands = buildPlan(regionPath)
    .filter(({ tool }) => tool !== null)
    .map(({ id, tool, cwd, argv, outputs, validators }) => ({
      id,
      tool,
      cwd,
      argv,
      outputs,
      validators,
    }));
  commands.push({
    id: 'verify-final',
    tool: 'pmtiles',
    cwd: '$OUT',
    argv: ['verify', OUTPUT_NAMES.archive],
    outputs: [],
    validators: [],
  });
  return Object.freeze(commands.map((command) => Object.freeze(command)));
}

export function validateSourceRow(rows) {
  if (!Array.isArray(rows)) throw new Error('Protomaps build metadata is not an array');
  const row = rows.find((candidate) => candidate?.key === SOURCE.key);
  if (row === undefined) throw new Error(`source metadata has no ${SOURCE.key}`);
  const expected = {
    key: SOURCE.key,
    size: SOURCE.bytes,
    md5sum: SOURCE.md5Base64,
    b3sum: SOURCE.blake3,
    uploaded: SOURCE.uploaded,
    version: SOURCE.version,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) {
      throw new Error(
        `source metadata ${key} changed: ${JSON.stringify(row[key])}, expected ${JSON.stringify(value)}`,
      );
    }
  }
  return expected;
}

export function validateSourceArchive(header, metadata) {
  const headerExpected = {
    tile_compression: 'gzip',
    tile_type: 'mvt',
    minzoom: 0,
    maxzoom: 15,
  };
  for (const [key, value] of Object.entries(headerExpected)) {
    if (header?.[key] !== value) {
      throw new Error(
        `source header ${key} is ${JSON.stringify(header?.[key])}, expected ${value}`,
      );
    }
  }
  if (metadata?.version !== SOURCE.version) {
    throw new Error(`source archive version is not ${SOURCE.version}`);
  }
  if (metadata?.['planetiler:osm:osmosisreplicationtime'] !== SOURCE.osmTimestamp) {
    throw new Error(`source archive OSM timestamp is not ${SOURCE.osmTimestamp}`);
  }
  const layers = metadata?.vector_layers?.map(({ id }) => id).sort();
  if (canonicalJson(layers) !== canonicalJson([...SOURCE_LAYERS].sort())) {
    throw new Error(`source layers changed: ${JSON.stringify(layers)}`);
  }
}

export function validateRegionBytes(bytes) {
  const regionBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (regionBytes.length !== REGION.bytes) {
    throw new Error(
      `region has ${String(regionBytes.length)} bytes, expected ${String(REGION.bytes)}`,
    );
  }
  const sha256 = createHash('sha256').update(regionBytes).digest('hex');
  if (sha256 !== REGION.sha256) throw new Error(`region SHA-256 changed: ${sha256}`);
  let collection;
  try {
    collection = JSON.parse(regionBytes.toString('utf8'));
  } catch (cause) {
    throw new Error(`region is not JSON: ${shortError(cause)}`);
  }
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('region is not a GeoJSON FeatureCollection');
  }
  if (collection.features.length !== REGION.features) {
    throw new Error(
      `region has ${String(collection.features.length)} features, expected ${String(REGION.features)}`,
    );
  }

  const ids = new Set();
  const states = new Set();
  let alaskaPositiveLongitudes = 0;
  let alaskaMinimumLongitude = Infinity;
  let alaskaMaximumLongitude = -Infinity;
  let minimumLongitude = Infinity;
  let minimumLatitude = Infinity;
  let maximumLongitude = -Infinity;
  let maximumLatitude = -Infinity;
  for (const feature of collection.features) {
    const id = String(feature?.id ?? '');
    if (!/^[0-9]{5}$/.test(id) || ids.has(id))
      throw new Error(`invalid or repeated county id ${id}`);
    ids.add(id);
    const state = id.slice(0, 2);
    if (feature?.properties?.STATE !== state) throw new Error(`county ${id} has mismatched STATE`);
    states.add(state);
    if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) {
      throw new Error(`county ${id} is not Polygon or MultiPolygon`);
    }
    let coordinateCount = 0;
    for (const [lon, lat] of coordinatePairs(feature.geometry.coordinates)) {
      coordinateCount += 1;
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        Math.abs(lon) > 180 ||
        Math.abs(lat) > 90
      ) {
        throw new Error(`county ${id} has an invalid coordinate`);
      }
      minimumLongitude = Math.min(minimumLongitude, lon);
      minimumLatitude = Math.min(minimumLatitude, lat);
      maximumLongitude = Math.max(maximumLongitude, lon);
      maximumLatitude = Math.max(maximumLatitude, lat);
      if (state === '02') {
        if (lon > 0) alaskaPositiveLongitudes += 1;
        alaskaMinimumLongitude = Math.min(alaskaMinimumLongitude, lon);
        alaskaMaximumLongitude = Math.max(alaskaMaximumLongitude, lon);
      }
    }
    if (coordinateCount === 0) throw new Error(`county ${id} has no coordinates`);
  }
  const stateCodes = [...states].sort();
  if (canonicalJson(stateCodes) !== canonicalJson(REGION.stateCodes)) {
    throw new Error(`region state codes changed: ${stateCodes.join(',')}`);
  }
  if (
    alaskaPositiveLongitudes !== 341 ||
    alaskaMinimumLongitude !== -179.14734 ||
    alaskaMaximumLongitude !== 179.77847
  ) {
    throw new Error(
      `Alaska dateline coverage changed: positive=${String(alaskaPositiveLongitudes)}, ` +
        `min=${String(alaskaMinimumLongitude)}, max=${String(alaskaMaximumLongitude)}`,
    );
  }
  const bounds = {
    minLon: minimumLongitude,
    minLat: minimumLatitude,
    maxLon: maximumLongitude,
    maxLat: maximumLatitude,
  };
  if (canonicalJson(bounds) !== canonicalJson(REGION.bounds)) {
    throw new Error(`region bounds changed: ${canonicalJson(bounds)}`);
  }
  return { collection, stateCodes, alaskaPositiveLongitudes, bounds, sha256 };
}

function* coordinatePairs(value) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    yield [value[0], value[1]];
    return;
  }
  for (const child of value) yield* coordinatePairs(child);
}

export function validateBuildDirectory(path, repositoryRoot = REPO_ROOT, limits = RESOURCE_LIMITS) {
  if (!isAbsolute(path)) throw new Error('output directory must be absolute');
  const resolved = resolve(path);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('output path must be a real directory, not a file or symlink');
  }
  const real = realpathSync(resolved);
  if (real !== resolved)
    throw new Error('output directory may not contain symlink path components');
  if (real === '/' || pathInside(real, repositoryRoot)) {
    throw new Error('output directory must be a dedicated directory outside the repository');
  }

  const paths = outputPaths(real);
  let names = readdirSync(real);
  const hasCheckpoint = names.includes(OUTPUT_NAMES.buildCheckpoint);
  if (!hasCheckpoint && names.includes(`${OUTPUT_NAMES.buildCheckpoint}.tmp`)) {
    const temporary = join(real, `${OUTPUT_NAMES.buildCheckpoint}.tmp`);
    const temporaryStat = lstatSync(temporary);
    if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
      throw new Error('stale build checkpoint temporary is unsafe');
    }
    preserveStaleTemporary(temporary);
    names = readdirSync(real);
  }
  const onlyPreservedCheckpointWrites = names.every((name) =>
    name.startsWith(`${OUTPUT_NAMES.buildCheckpoint}.tmp.rejected-stale-`),
  );
  if (!hasCheckpoint && names.length > 0 && !onlyPreservedCheckpointWrites) {
    throw new Error(`refusing to start in non-empty build directory ${real}`);
  }
  if (hasCheckpoint) {
    const plan = buildPlan();
    const planned = new Set(plan.flatMap(({ outputs }) => outputs));
    planned.add(OUTPUT_NAMES.buildCheckpoint);
    planned.add(`${OUTPUT_NAMES.buildCheckpoint}.tmp`);
    planned.add(`${OUTPUT_NAMES.archive}.verify-state.json`);
    planned.add(`${OUTPUT_NAMES.archive}.receipt.json`);
    const rejectedPrefixes = new Set([
      ...planned,
      ...plan.flatMap(({ preservedCandidates = [] }) => preservedCandidates),
    ]);
    for (const name of names) {
      const isRejected = [...rejectedPrefixes].some((candidate) =>
        name.startsWith(`${candidate}.rejected-`),
      );
      if (!planned.has(name) && !isRejected) {
        throw new Error(`unexpected file in dedicated build directory: ${name}`);
      }
      const candidate = join(real, name);
      const candidateStat = lstatSync(candidate);
      if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.nlink !== 1) {
        throw new Error(`build workspace entry is not a real regular file: ${candidate}`);
      }
    }
  }
  const resources = resourceSnapshot(real);
  if (!hasCheckpoint) assertResources(resources, limits);
  return { outDir: real, paths, resources };
}

function pathInside(path, root) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false;
    throw cause;
  }
}

function outputPaths(outDir) {
  const archive = join(outDir, OUTPUT_NAMES.archive);
  return {
    raw: join(outDir, OUTPUT_NAMES.raw),
    archive,
    uneditedArchive: join(outDir, OUTPUT_NAMES.uneditedArchive),
    metadata: join(outDir, OUTPUT_NAMES.metadata),
    buildCheckpoint: join(outDir, OUTPUT_NAMES.buildCheckpoint),
    receipt: `${archive}.receipt.json`,
    checkpoint: `${archive}.verify-state.json`,
  };
}

export function resourceSnapshot(path = '/var/tmp') {
  const disk = statfsSync(path, { bigint: true });
  const memory = linuxMemorySnapshot();
  return {
    freeDiskBytes: Number(disk.bavail * disk.bsize),
    availableMemoryBytes: memory.availableMemoryBytes,
    swapFreeBytes: memory.swapFreeBytes,
    swapTotalBytes: memory.swapTotalBytes,
  };
}

function linuxMemorySnapshot() {
  try {
    const text = readFileSync('/proc/meminfo', 'utf8');
    const values = new Map(
      text
        .split('\n')
        .map((line) => /^([^:]+):\s+([0-9]+)\s+kB$/.exec(line))
        .filter(Boolean)
        .map((match) => [match[1], Number(match[2]) * 1024]),
    );
    const availableMemoryBytes = values.get('MemAvailable');
    if (!Number.isSafeInteger(availableMemoryBytes)) throw new Error('MemAvailable missing');
    return {
      availableMemoryBytes,
      swapFreeBytes: values.get('SwapFree') ?? 0,
      swapTotalBytes: values.get('SwapTotal') ?? 0,
    };
  } catch {
    return { availableMemoryBytes: freemem(), swapFreeBytes: 0, swapTotalBytes: 0 };
  }
}

export function assertResources(snapshot, limits = RESOURCE_LIMITS) {
  const problems = [];
  if (snapshot.freeDiskBytes < limits.minimumFreeDiskBytes) {
    problems.push(
      `free disk ${formatGiB(snapshot.freeDiskBytes)} GiB < required ${formatGiB(limits.minimumFreeDiskBytes)} GiB`,
    );
  }
  if (snapshot.availableMemoryBytes < limits.minimumAvailableMemoryBytes) {
    problems.push(
      `available memory ${formatGiB(snapshot.availableMemoryBytes)} GiB < required ${formatGiB(limits.minimumAvailableMemoryBytes)} GiB`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `host is not safe for the measured basemap build:\n  ${problems.join('\n  ')}\n` +
        `tile-join previously peaked at ${formatGiB(limits.measuredTileJoinPeakRssBytes)} GiB RSS`,
    );
  }
}

export function assertStepResources(snapshot, limits) {
  const problems = [];
  if (snapshot.freeDiskBytes < limits.minimumFreeDiskBytes) {
    problems.push(
      `free disk ${formatGiB(snapshot.freeDiskBytes)} GiB < step requirement ${formatGiB(limits.minimumFreeDiskBytes)} GiB`,
    );
  }
  if (snapshot.availableMemoryBytes < limits.minimumAvailableMemoryBytes) {
    problems.push(
      `available memory ${formatGiB(snapshot.availableMemoryBytes)} GiB < step requirement ${formatGiB(limits.minimumAvailableMemoryBytes)} GiB`,
    );
  }
  if (problems.length > 0)
    throw new Error(`host is not safe for the next shard:\n  ${problems.join('\n  ')}`);
}

function formatGiB(bytes) {
  return (bytes / 1024 ** 3).toFixed(2);
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function resolveExecutable(pin, env = process.env) {
  const override = env[pin.env];
  if (typeof override === 'string' && override.trim() !== '') {
    if (!isAbsolute(override.trim())) throw new Error(`${pin.env} must be an absolute path`);
    return override.trim();
  }
  const paths = (env.PATH ?? '').split(':').filter(Boolean);
  for (const directory of paths) {
    const candidate = join(directory, pin.command);
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) {
        // access constants are intentionally tested through the mode bits here;
        // execution itself remains the final authority on ACLs/mount options.
        if ((stat.mode & (fsConstants.S_IXUSR | fsConstants.S_IXGRP | fsConstants.S_IXOTH)) !== 0) {
          return candidate;
        }
      }
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause;
    }
  }
  throw new Error(`${pin.command} not found; set ${pin.env} to the reviewed binary`);
}

export async function resolveAndValidateTools(env = process.env) {
  const tools = {};
  for (const [name, pin] of Object.entries(TOOL_PINS)) {
    const path = resolveExecutable(pin, env);
    const sha256 = await hashFile(path);
    if (sha256 !== pin.sha256) {
      throw new Error(`${pin.command} SHA-256 ${sha256}, expected ${pin.sha256}`);
    }
    tools[name] = { ...pin, path };
  }

  const version = (await runCaptured(tools.pmtiles, ['version'], { maximumBytes: 4096 })).trim();
  if (version !== TOOL_PINS.pmtiles.version) {
    throw new Error(
      `pmtiles version ${JSON.stringify(version)}, expected ${TOOL_PINS.pmtiles.version}`,
    );
  }
  return tools;
}

async function runCaptured(tool, args, { cwd = REPO_ROOT, maximumBytes = MAX_JSON_BYTES } = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(tool.path, args, {
      cwd,
      argv0: tool.command,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overLimit = false;
    const append = (target, chunk, current) => {
      const next = current + chunk.length;
      if (next > maximumBytes) {
        overLimit = true;
        child.kill('SIGTERM');
      } else {
        target.push(chunk);
      }
      return next;
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = append(stderr, chunk, stderrBytes);
    });
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      if (overLimit) {
        rejectPromise(new Error(`${tool.command} output exceeded ${String(maximumBytes)} bytes`));
        return;
      }
      const errorText = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0 || signal !== null) {
        rejectPromise(
          new Error(
            `${tool.command} ${args[0] ?? ''} failed (${signal ?? String(code)}): ${errorText.slice(0, 500)}`,
          ),
        );
        return;
      }
      resolvePromise(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

function processRssBytes(pid) {
  try {
    const match = /^VmRSS:\s+([0-9]+)\s+kB$/m.exec(
      readFileSync(`/proc/${String(pid)}/status`, 'utf8'),
    );
    return match === null ? 0 : Number(match[1]) * 1024;
  } catch (cause) {
    if (cause?.code === 'ENOENT') return 0;
    throw cause;
  }
}

async function runInherited(
  tool,
  args,
  cwd,
  { limits = null, outputPaths = [], shouldStop = () => false } = {},
) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(tool.path, args, { cwd, argv0: tool.command, stdio: 'inherit' });
    const started = Date.now();
    let termination = null;
    let forceTimer = null;
    const terminate = (reason, expectedStop = false) => {
      if (termination !== null) return;
      termination = { reason, expectedStop };
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      forceTimer.unref();
    };
    const monitor = setInterval(() => {
      try {
        if (shouldStop()) {
          terminate('stop requested; the current candidate will be checked on resume', true);
          return;
        }
        if (limits === null) return;
        const rss = processRssBytes(child.pid);
        if (rss > limits.maximumRssBytes) {
          terminate(
            `RSS ${formatGiB(rss)} GiB exceeded the ${formatGiB(limits.maximumRssBytes)} GiB step cap`,
          );
          return;
        }
        const elapsedSeconds = (Date.now() - started) / 1000;
        if (elapsedSeconds > limits.maximumSeconds) {
          terminate(`wall time exceeded the ${String(limits.maximumSeconds)} second step cap`);
          return;
        }
        const memory = linuxMemorySnapshot();
        if (memory.availableMemoryBytes < limits.emergencyAvailableMemoryBytes) {
          terminate(
            `host available memory fell below the ${formatGiB(limits.emergencyAvailableMemoryBytes)} GiB emergency floor`,
          );
          return;
        }
        const freeDiskBytes = resourceSnapshot(cwd).freeDiskBytes;
        if (freeDiskBytes < limits.emergencyFreeDiskBytes) {
          terminate(
            `host free disk fell below the ${formatGiB(limits.emergencyFreeDiskBytes)} GiB emergency floor`,
          );
          return;
        }
        let outputBytes = 0;
        for (const outputPath of outputPaths) {
          if (!pathExists(outputPath)) continue;
          const stat = lstatSync(outputPath);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            realpathSync(outputPath) !== resolve(outputPath)
          ) {
            terminate(`step produced an unsafe output path: ${outputPath}`);
            return;
          }
          outputBytes += stat.size;
        }
        if (outputBytes > limits.maximumOutputBytes) {
          terminate(
            `output ${formatGiB(outputBytes)} GiB exceeded the ${formatGiB(limits.maximumOutputBytes)} GiB step cap`,
          );
        }
      } catch (cause) {
        terminate(`resource monitor failed: ${shortError(cause)}`);
      }
    }, 1_000);
    monitor.unref();
    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      clearInterval(monitor);
      if (forceTimer !== null) clearTimeout(forceTimer);
      if (termination !== null) {
        const error = new Error(`${tool.command} stopped: ${termination.reason}`);
        error.expectedStop = termination.expectedStop;
        rejectPromise(error);
      } else if (code === 0 && signal === null) resolvePromise();
      else rejectPromise(new Error(`${tool.command} failed (${signal ?? String(code)})`));
    });
  });
}

async function exactJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store' });
  if (response.status !== 200 || response.redirected === true || response.url !== url) {
    await response.body?.cancel?.();
    throw new Error(
      `unexpected response for ${url}: status=${String(response.status)} final=${String(response.url)}`,
    );
  }
  const bytes = await boundedResponseBytes(response, MAX_JSON_BYTES);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new Error(`invalid JSON from ${url}: ${shortError(cause)}`);
  }
}

async function boundedResponseBytes(response, maximum) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel?.();
    throw new Error('remote JSON has an unsafe content-length');
  }
  if (typeof response.body?.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new Error('remote JSON exceeds the byte limit');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error('remote JSON exceeds the byte limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function validatePinnedInputs(tools, fetchImpl = fetch) {
  const regionPath = join(REPO_ROOT, REGION.repositoryPath);
  const [rows, sourceHeaderText, sourceMetadataText] = await Promise.all([
    exactJson(SOURCE.metadataUrl, fetchImpl),
    runCaptured(tools.pmtiles, ['show', SOURCE.url, '--header-json']),
    runCaptured(tools.pmtiles, ['show', SOURCE.url, '--metadata']),
  ]);
  validateSourceRow(rows);
  let sourceHeader;
  let sourceMetadata;
  try {
    sourceHeader = JSON.parse(sourceHeaderText);
    sourceMetadata = JSON.parse(sourceMetadataText);
  } catch (cause) {
    throw new Error(`pmtiles show returned invalid JSON: ${shortError(cause)}`);
  }
  validateSourceArchive(sourceHeader, sourceMetadata);
  const region = validateRegionBytes(readFileSync(regionPath));
  return { regionPath, region };
}

export function readPmtilesHeader(bytes) {
  if (bytes.length < 127) throw new Error('PMTiles header is short');
  if (bytes.toString('ascii', 0, 7) !== 'PMTiles') throw new Error('PMTiles magic is invalid');
  return {
    specVersion: bytes.readUInt8(7),
    rootDirectoryOffset: uint64(bytes, 8),
    rootDirectoryLength: uint64(bytes, 16),
    jsonMetadataOffset: uint64(bytes, 24),
    jsonMetadataLength: uint64(bytes, 32),
    leafDirectoryOffset: uint64(bytes, 40),
    leafDirectoryLength: uint64(bytes, 48),
    tileDataOffset: uint64(bytes, 56),
    tileDataLength: uint64(bytes, 64),
    numAddressedTiles: uint64(bytes, 72),
    numTileEntries: uint64(bytes, 80),
    numTileContents: uint64(bytes, 88),
    clustered: bytes.readUInt8(96) === 1,
    internalCompression: bytes.readUInt8(97),
    tileCompression: bytes.readUInt8(98),
    tileType: bytes.readUInt8(99),
    minZoom: bytes.readUInt8(100),
    maxZoom: bytes.readUInt8(101),
    minLon: bytes.readInt32LE(102) / 1e7,
    minLat: bytes.readInt32LE(106) / 1e7,
    maxLon: bytes.readInt32LE(110) / 1e7,
    maxLat: bytes.readInt32LE(114) / 1e7,
    centerZoom: bytes.readUInt8(118),
    centerLon: bytes.readInt32LE(119) / 1e7,
    centerLat: bytes.readInt32LE(123) / 1e7,
  };
}

function uint64(bytes, offset) {
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('PMTiles uint64 exceeds JS safety');
  return Number(value);
}

export function readDirectory(bytes) {
  const state = { offset: 0 };
  const count = readVarint(bytes, state);
  if (count > bytes.length) throw new Error('PMTiles directory count is impossible');
  const entries = [];
  let tileId = 0;
  for (let index = 0; index < count; index += 1) {
    tileId += readVarint(bytes, state);
    entries.push({ tileId, runLength: 0, length: 0, offset: 0 });
  }
  for (const entry of entries) entry.runLength = readVarint(bytes, state);
  for (const entry of entries) entry.length = readVarint(bytes, state);
  for (let index = 0; index < entries.length; index += 1) {
    const encoded = readVarint(bytes, state);
    entries[index].offset =
      encoded === 0 && index > 0
        ? entries[index - 1].offset + entries[index - 1].length
        : encoded - 1;
    if (entries[index].offset < 0 || entries[index].length <= 0) {
      throw new Error('PMTiles directory has an invalid offset or length');
    }
  }
  if (state.offset !== bytes.length) throw new Error('PMTiles directory has trailing bytes');
  return entries;
}

function readVarint(bytes, state) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = bytes[state.offset];
    if (byte === undefined) throw new Error('PMTiles varint runs past the directory');
    state.offset += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if (!Number.isSafeInteger(result)) throw new Error('PMTiles varint exceeds JS safety');
    if ((byte & 0x80) === 0) return result;
    shift += 7;
    if (shift > 49) throw new Error('PMTiles varint is too long');
  }
}

function findTile(entries, tileId) {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const comparison = tileId - entries[middle].tileId;
    if (comparison > 0) low = middle + 1;
    else if (comparison < 0) high = middle - 1;
    else return entries[middle];
  }
  if (high >= 0) {
    const entry = entries[high];
    if (entry.runLength === 0 || tileId - entry.tileId < entry.runLength) return entry;
  }
  return null;
}

function rotate(n, x, y, rx, ry) {
  if (ry !== 0) return [x, y];
  return rx !== 0 ? [n - 1 - y, n - 1 - x] : [y, x];
}

export function zxyToTileId(z, x, y) {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new Error('invalid tile zoom');
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  ) {
    throw new Error('tile x/y outside zoom bounds');
  }
  let tileId = (4 ** z - 1) / 3;
  let tx = x;
  let ty = y;
  let bit = z - 1;
  for (let scale = 2 ** bit; scale > 0; scale >>= 1) {
    const rx = tx & scale;
    const ry = ty & scale;
    tileId += ((3 * rx) ^ ry) * 2 ** bit;
    [tx, ty] = rotate(scale, tx, ty, rx, ry);
    bit -= 1;
  }
  return tileId;
}

export function tileIdToZxy(tileId) {
  if (!Number.isSafeInteger(tileId) || tileId < 0) throw new Error('invalid tile id');
  const magnitude = 3 * tileId + 1;
  const bit =
    magnitude < 0x1_0000_0000
      ? 31 - Math.clz32(magnitude)
      : 63 - Math.clz32(magnitude / 0x1_0000_0000);
  const zoom = bit >> 1;
  if (zoom > 26) throw new Error('tile id exceeds safe zoom');
  let position = tileId - (4 ** zoom - 1) / 3;
  let x = 0;
  let y = 0;
  for (let scale = 1; scale < 2 ** zoom; scale *= 2) {
    const rx = scale & (position / 2);
    const ry = scale & (position ^ rx);
    [x, y] = rotate(scale, x, y, rx, ry);
    position /= 2;
    x += rx;
    y += ry;
  }
  return { z: zoom, x, y };
}

export class LocalPmtilesReader {
  constructor(path, { cacheDirectories = true } = {}) {
    this.path = path;
    this.fd = openSync(path, 'r');
    this.fileBytes = statSync(path).size;
    this.header = readPmtilesHeader(this.read(0, 127, 127));
    this.assertSections();
    this.directoryCache = cacheDirectories ? new Map() : null;
    this.root = this.readDirectoryAt(
      this.header.rootDirectoryOffset,
      this.header.rootDirectoryLength,
      'root',
    );
  }

  close() {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  read(offset, length, maximum = MAX_TILE_BYTES) {
    if (
      this.fd === null ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > maximum ||
      offset + length > this.fileBytes
    ) {
      throw new Error(`unsafe PMTiles read offset=${String(offset)} length=${String(length)}`);
    }
    const result = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const count = readSync(this.fd, result, done, length - done, offset + done);
      if (count === 0) throw new Error('unexpected EOF in PMTiles archive');
      done += count;
    }
    return result;
  }

  assertSections() {
    const h = this.header;
    if (h.specVersion !== 3)
      throw new Error(`PMTiles spec version ${String(h.specVersion)}, expected 3`);
    if (!h.clustered) throw new Error('PMTiles archive is not clustered');
    if (h.internalCompression !== 2 || h.tileCompression !== 2 || h.tileType !== 1) {
      throw new Error('PMTiles must use gzip internal/tile compression and MVT tiles');
    }
    for (const [offset, length, label] of [
      [h.rootDirectoryOffset, h.rootDirectoryLength, 'root directory'],
      [h.jsonMetadataOffset, h.jsonMetadataLength, 'metadata'],
      [h.leafDirectoryOffset, h.leafDirectoryLength, 'leaf directories'],
      [h.tileDataOffset, h.tileDataLength, 'tile data'],
    ]) {
      if (offset < 127 || length < 0 || offset + length > this.fileBytes) {
        throw new Error(`PMTiles ${label} section is outside the file`);
      }
    }
  }

  inflate(bytes, compression = this.header.internalCompression) {
    if (compression !== 2)
      throw new Error(`unsupported PMTiles compression ${String(compression)}`);
    return gunzipSync(bytes, { maxOutputLength: MAX_DIRECTORY_BYTES });
  }

  metadata() {
    const raw = this.read(
      this.header.jsonMetadataOffset,
      this.header.jsonMetadataLength,
      MAX_DIRECTORY_BYTES,
    );
    const inflated = this.inflate(raw);
    if (inflated.length > MAX_JSON_BYTES) throw new Error('PMTiles metadata exceeds 1 MiB');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated));
  }

  readDirectoryAt(offset, length, key) {
    if (this.directoryCache?.has(key)) return this.directoryCache.get(key);
    const compressed = this.read(offset, length, MAX_DIRECTORY_BYTES);
    const directory = readDirectory(this.inflate(compressed));
    this.directoryCache?.set(key, directory);
    return directory;
  }

  leaf(entry) {
    const key = `${String(entry.offset)}:${String(entry.length)}`;
    return this.readDirectoryAt(this.header.leafDirectoryOffset + entry.offset, entry.length, key);
  }

  entryFor(z, x, y) {
    const tileId = zxyToTileId(z, x, y);
    let directory = this.root;
    for (let depth = 0; depth <= 3; depth += 1) {
      const entry = findTile(directory, tileId);
      if (entry === null) return null;
      if (entry.runLength > 0) return entry;
      directory = this.leaf(entry);
    }
    throw new Error('PMTiles directory depth exceeds 3');
  }

  hasTile(z, x, y) {
    return this.entryFor(z, x, y) !== null;
  }

  tile(z, x, y) {
    const entry = this.entryFor(z, x, y);
    if (entry === null) return null;
    return this.tileForEntry(entry);
  }

  tileForEntry(entry) {
    if (entry.length > MAX_TILE_BYTES || entry.offset + entry.length > this.header.tileDataLength) {
      throw new Error('PMTiles tile entry is outside the tile data section');
    }
    const raw = this.read(this.header.tileDataOffset + entry.offset, entry.length, MAX_TILE_BYTES);
    return this.inflate(raw, this.header.tileCompression);
  }

  *entries() {
    const seenDirectories = new Set();
    yield* this.entriesIn(this.root, 0, seenDirectories);
  }

  *entriesIn(directory, depth, seenDirectories) {
    if (depth > 3) throw new Error('PMTiles directory depth exceeds 3');
    for (const entry of directory) {
      if (entry.runLength > 0) {
        if (entry.offset + entry.length > this.header.tileDataLength) {
          throw new Error('PMTiles tile entry exceeds tile data section');
        }
        yield entry;
      } else {
        const key = `${String(entry.offset)}:${String(entry.length)}`;
        if (seenDirectories.has(key)) throw new Error(`PMTiles repeats leaf directory ${key}`);
        seenDirectories.add(key);
        yield* this.entriesIn(this.leaf(entry), depth + 1, seenDirectories);
      }
    }
  }
}

function compilePartitionLookup(partitions) {
  const zooms = [];
  for (let zoom = 0; zoom <= 14; zoom += 1) {
    const candidates = partitions.filter(
      ({ minZoom, maxZoom }) => zoom >= minZoom && zoom <= maxZoom,
    );
    if (candidates.length === 1 && candidates[0].xMin === null) {
      zooms[zoom] = candidates[0];
      continue;
    }
    const columns = Array(2 ** zoom).fill(null);
    for (const partition of candidates) {
      if (
        !Number.isInteger(partition.xMin) ||
        !Number.isInteger(partition.xMax) ||
        partition.xMin < 0 ||
        partition.xMax >= columns.length ||
        partition.xMin > partition.xMax
      ) {
        throw new Error(`partition ${partition.id} has invalid tile-column bounds at z${zoom}`);
      }
      for (let x = partition.xMin; x <= partition.xMax; x += 1) {
        if (columns[x] !== null) throw new Error(`build partitions overlap at z${zoom} x${x}`);
        columns[x] = partition;
      }
    }
    if (columns.some((partition) => partition === null)) {
      throw new Error(`build partitions have a tile-column gap at z${zoom}`);
    }
    zooms[zoom] = columns;
  }
  return (coordinate) => {
    const zoom = zooms[coordinate.z];
    const partition = Array.isArray(zoom) ? zoom[coordinate.x] : zoom;
    if (partition === undefined || partition === null) {
      throw new Error(
        `tile ${String(coordinate.z)}/${String(coordinate.x)}/${String(coordinate.y)} is outside the build partitions`,
      );
    }
    return partition;
  };
}

function startLogicalPartitionDigests(partitions) {
  const states = new Map(
    partitions.map((partition) => {
      const hash = createHash('sha256');
      hash.update(`${LOGICAL_DIGEST_SCHEMA}\0${canonicalJson(partition)}\0`);
      return [partition.id, { hash, addressedTiles: 0 }];
    }),
  );
  return {
    states,
    partitionForCoordinate: compilePartitionLookup(partitions),
    directoryEntries: 0,
    previousLastTileId: -1,
  };
}

function addLogicalEntry(context, reader, entry) {
  if (
    !Number.isSafeInteger(entry.tileId) ||
    !Number.isSafeInteger(entry.runLength) ||
    entry.runLength < 1 ||
    entry.tileId <= context.previousLastTileId
  ) {
    throw new Error('PMTiles logical entries overlap or are not strictly ordered');
  }
  const lastTileId = entry.tileId + entry.runLength - 1;
  if (!Number.isSafeInteger(lastTileId)) throw new Error('PMTiles tile run exceeds JS safety');
  const decodedSha256 = createHash('sha256').update(reader.tileForEntry(entry)).digest();
  for (let tileId = entry.tileId; tileId <= lastTileId; tileId += 1) {
    const partition = context.partitionForCoordinate(tileIdToZxy(tileId));
    const state = context.states.get(partition.id);
    const encodedTileId = Buffer.allocUnsafe(8);
    encodedTileId.writeBigUInt64LE(BigInt(tileId));
    state.hash.update(encodedTileId);
    state.hash.update(decodedSha256);
    state.addressedTiles += 1;
  }
  context.previousLastTileId = lastTileId;
  context.directoryEntries += 1;
}

function finishLogicalPartitionDigests(context, reader, partitions) {
  if (
    reader.header !== undefined &&
    (reader.header.numTileEntries !== context.directoryEntries ||
      reader.header.numAddressedTiles !==
        [...context.states.values()].reduce((total, state) => total + state.addressedTiles, 0))
  ) {
    throw new Error('PMTiles logical counts do not match the header');
  }
  return Object.fromEntries(
    partitions.map(({ id }) => {
      const state = context.states.get(id);
      return [id, { addressedTiles: state.addressedTiles, sha256: state.hash.digest('hex') }];
    }),
  );
}

export function logicalPartitionDigests(reader, partitions = archivePartitions()) {
  const context = startLogicalPartitionDigests(partitions);
  for (const entry of reader.entries()) addLogicalEntry(context, reader, entry);
  return finishLogicalPartitionDigests(context, reader, partitions);
}

function emptyStepResult(step) {
  if (!['empty-partition', 'empty-filter'].includes(step.kind)) {
    throw new Error(`step ${step.id} is not an explicit empty shard`);
  }
  const partitions = new Map(archivePartitions().map((partition) => [partition.id, partition]));
  const logical = Object.fromEntries(
    step.partitions.map((partitionId) => {
      const partition = partitions.get(partitionId);
      if (partition === undefined) {
        throw new Error(`empty step ${step.id} has an unknown partition ${partitionId}`);
      }
      const sha256 = createHash('sha256')
        .update(`${LOGICAL_DIGEST_SCHEMA}\0${canonicalJson(partition)}\0`)
        .digest('hex');
      return [partitionId, { addressedTiles: 0, sha256 }];
    }),
  );
  return { outputs: [], logical };
}

async function boundedLogicalPartitionDigests(reader, partitions, shouldStop) {
  const context = startLogicalPartitionDigests(partitions);
  for (const entry of reader.entries()) {
    addLogicalEntry(context, reader, entry);
    if (context.directoryEntries % 1_000 === 0) {
      await new Promise((resolvePromise) => setImmediate(resolvePromise));
      if (shouldStop()) {
        const error = new Error('logical archive validation stopped at a safe read boundary');
        error.expectedStop = true;
        throw error;
      }
    }
  }
  return finishLogicalPartitionDigests(context, reader, partitions);
}

export function assertLogicalUnion(whole, pieces, label = 'archive') {
  const combined = {};
  for (const piece of pieces) {
    for (const [partitionId, digest] of Object.entries(piece)) {
      if (combined[partitionId] !== undefined) {
        throw new Error(`${label} has overlapping logical partition ${partitionId}`);
      }
      combined[partitionId] = digest;
    }
  }
  if (canonicalJson(combined) !== canonicalJson(whole)) {
    throw new Error(`${label} logical union has a gap or changed decoded tile bytes`);
  }
  return whole;
}

export function validateOutputMetadata(header, metadata) {
  if (header.minZoom !== 0 || header.maxZoom !== 14) {
    throw new Error(
      `output zoom range is ${String(header.minZoom)}-${String(header.maxZoom)}, expected 0-14`,
    );
  }
  if (
    !Number.isFinite(header.minLon) ||
    !Number.isFinite(header.minLat) ||
    !Number.isFinite(header.maxLon) ||
    !Number.isFinite(header.maxLat) ||
    header.minLon > REGION.bounds.minLon ||
    header.minLat > REGION.bounds.minLat ||
    header.maxLon < REGION.bounds.maxLon ||
    header.maxLat < REGION.bounds.maxLat
  ) {
    throw new Error(
      `output bounds ${canonicalJson({
        minLon: header.minLon,
        minLat: header.minLat,
        maxLon: header.maxLon,
        maxLat: header.maxLat,
      })} do not cover the pinned 50-state/DC/PR region`,
    );
  }
  const layers = metadata?.vector_layers?.map(({ id, minzoom, maxzoom }) => ({
    id,
    minzoom,
    maxzoom,
  }));
  if (canonicalJson(layers) !== canonicalJson(EXPECTED_LAYERS)) {
    throw new Error(`output layers/ranges changed: ${JSON.stringify(layers)}`);
  }
  if (metadata?.generator !== TOOL_PINS.tileJoin.version) {
    throw new Error(`output generator is not ${TOOL_PINS.tileJoin.version}`);
  }
  const expectedOptions = shardedGeneratorOptions();
  if (metadata?.generator_options !== expectedOptions) {
    throw new Error(
      `output generator_options changed: ${JSON.stringify(metadata?.generator_options)}`,
    );
  }
  if (
    typeof metadata?.attribution !== 'string' ||
    !metadata.attribution.includes('openstreetmap.org/copyright') ||
    !metadata.attribution.includes('OpenStreetMap')
  ) {
    throw new Error('output does not carry OpenStreetMap attribution');
  }
  if (metadata?.['darkroute:build-plan-sha256'] !== buildPlanSha256()) {
    throw new Error('output metadata is not bound to the pinned sharded plan');
  }
  return layers;
}

export function lonLatToTile(lon, lat, z = 14) {
  const size = 2 ** z;
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const x = Math.min(size - 1, Math.max(0, Math.floor(((lon + 180) / 360) * size)));
  const radians = (clampedLat * Math.PI) / 180;
  const y = Math.min(
    size - 1,
    Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * size)),
  );
  return { z, x, y };
}

export function decodeVectorTile(bytes) {
  const tile = new VectorTile(new PbfReader(bytes));
  const layerFeatures = {};
  let features = 0;
  let geometryParts = 0;
  for (const name of Object.keys(tile.layers).sort()) {
    if (!EXPECTED_LAYERS.some(({ id }) => id === name)) {
      throw new Error(`tile contains excluded or unknown layer ${name}`);
    }
    const layer = tile.layers[name];
    layerFeatures[name] = layer.length;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      // Accessing properties and geometry forces PBF values, tags, and command
      // streams to be decoded; constructing VectorTile alone is lazy.
      void feature.properties;
      const geometry = feature.loadGeometry();
      if (!Array.isArray(geometry)) throw new Error('MVT feature geometry is not an array');
      geometryParts += geometry.length;
      features += 1;
    }
  }
  if (Object.keys(layerFeatures).length === 0) throw new Error('MVT tile has no layers');
  return { layerFeatures, features, geometryParts };
}

export function checkCoverageSpots(reader, spots = COVERAGE_SPOTS, decoder = decodeVectorTile) {
  const results = [];
  for (const spot of spots) {
    const coordinate = lonLatToTile(spot.lon, spot.lat, 14);
    const bytes = reader.tile(coordinate.z, coordinate.x, coordinate.y);
    if (bytes === null) throw new Error(`coverage spot ${spot.id} has no z14 tile`);
    const decoded = decoder(bytes);
    const present = Object.entries(decoded.layerFeatures)
      .filter(([, count]) => count > 0)
      .map(([name]) => name)
      .sort();
    if (!spot.layers.some((name) => present.includes(name))) {
      throw new Error(
        `coverage spot ${spot.id} lacks expected layer (${spot.layers.join(' or ')}); has ${present.join(',')}`,
      );
    }
    results.push({
      id: spot.id,
      z: coordinate.z,
      x: coordinate.x,
      y: coordinate.y,
      layers: present,
    });
  }
  return results;
}

const NEIGHBORS = Object.freeze([
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]);

export function checkCountyCoverage(reader, collection) {
  const matches = [];
  for (const feature of collection.features) {
    const attempted = new Set();
    let match = null;
    for (const [lon, lat] of coordinatePairs(feature.geometry.coordinates)) {
      const center = lonLatToTile(lon, lat, 14);
      const size = 2 ** center.z;
      for (const [dx, dy] of NEIGHBORS) {
        const x = (center.x + dx + size) % size;
        const y = center.y + dy;
        if (y < 0 || y >= size) continue;
        const key = `${String(x)}/${String(y)}`;
        if (attempted.has(key)) continue;
        attempted.add(key);
        if (reader.hasTile(14, x, y)) {
          match = { id: String(feature.id), state: String(feature.id).slice(0, 2), z: 14, x, y };
          break;
        }
      }
      if (match !== null) break;
    }
    if (match === null)
      throw new Error(`county ${String(feature.id)} has no detailed tile near its geometry`);
    matches.push(match);
  }
  const states = [...new Set(matches.map(({ state }) => state))].sort();
  if (
    matches.length !== REGION.features ||
    canonicalJson(states) !== canonicalJson(REGION.stateCodes)
  ) {
    throw new Error('county coverage did not prove all 50 states, DC, and Puerto Rico');
  }
  return {
    features: matches.length,
    stateCodes: states,
    matchesSha256: createHash('sha256').update(canonicalJson(matches)).digest('hex'),
  };
}

function checkpointPath(archivePath) {
  return `${archivePath}.verify-state.json`;
}

function loadCheckpoint(path, archive) {
  if (!pathExists(path)) {
    return {
      schema: CHECKPOINT_SCHEMA,
      archive,
      nextEntry: 0,
      decodedEntries: 0,
      decodedFeatures: 0,
      geometryParts: 0,
      layerFeatures: {},
      complete: false,
    };
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) {
    throw new Error('verification checkpoint is not a real regular file');
  }
  if (stat.size > MAX_JSON_BYTES) throw new Error('verification checkpoint is too large');
  const checkpoint = JSON.parse(readFileSync(path, 'utf8'));
  const expectedKeys = [
    'archive',
    'complete',
    'decodedEntries',
    'decodedFeatures',
    'geometryParts',
    'layerFeatures',
    'nextEntry',
    'schema',
  ];
  const layerCounts = checkpoint?.layerFeatures;
  const layerNames =
    layerCounts !== null && typeof layerCounts === 'object' && !Array.isArray(layerCounts)
      ? Object.keys(layerCounts)
      : [];
  const layerTotal = layerNames.reduce((total, name) => total + (layerCounts[name] ?? 0), 0);
  if (
    canonicalJson(Object.keys(checkpoint ?? {}).sort()) !== canonicalJson(expectedKeys) ||
    checkpoint?.schema !== CHECKPOINT_SCHEMA ||
    canonicalJson(checkpoint.archive) !== canonicalJson(archive) ||
    !Number.isSafeInteger(checkpoint.nextEntry) ||
    checkpoint.nextEntry < 0 ||
    checkpoint.decodedEntries !== checkpoint.nextEntry ||
    !nonNegativeSafeInteger(checkpoint.decodedFeatures) ||
    !nonNegativeSafeInteger(checkpoint.geometryParts) ||
    ![true, false].includes(checkpoint.complete) ||
    layerCounts === null ||
    typeof layerCounts !== 'object' ||
    Array.isArray(layerCounts) ||
    layerNames.some(
      (name) =>
        !EXPECTED_LAYERS.some(({ id }) => id === name) ||
        !nonNegativeSafeInteger(layerCounts[name]),
    ) ||
    !Number.isSafeInteger(layerTotal) ||
    layerTotal !== checkpoint.decodedFeatures
  ) {
    throw new Error('verification checkpoint does not match this archive');
  }
  return checkpoint;
}

function writeCheckpoint(path, checkpoint) {
  if (pathExists(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) {
      throw new Error('refusing to replace an unsafe verification checkpoint');
    }
  }
  const temporary = `${path}.tmp-${String(process.pid)}`;
  if (pathExists(temporary)) throw new Error(`stale checkpoint temporary file ${temporary}`);
  try {
    writeFileSync(temporary, `${canonicalJson(checkpoint, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } catch (cause) {
    try {
      if (pathExists(temporary)) unlinkSync(temporary);
    } catch {
      // Preserve the original failure; the leftover is in the explicit state path.
    }
    throw cause;
  }
}

export async function exhaustiveVerify(
  reader,
  {
    archiveIdentity,
    statePath,
    maxTiles = Infinity,
    maxSeconds = Infinity,
    shouldStop = () => false,
    decoder = decodeVectorTile,
    now = () => Date.now(),
  },
) {
  const checkpoint = loadCheckpoint(statePath, archiveIdentity);
  if (checkpoint.nextEntry > reader.header.numTileEntries) {
    throw new Error('verification checkpoint exceeds archive tile-entry count');
  }
  if (checkpoint.complete !== (checkpoint.nextEntry === reader.header.numTileEntries)) {
    throw new Error('verification checkpoint completion marker is inconsistent');
  }
  if (checkpoint.complete) return checkpoint;

  const started = now();
  let lastCheckpoint = started;
  let processedThisRun = 0;
  let ordinal = 0;
  for (const entry of reader.entries()) {
    if (ordinal < checkpoint.nextEntry) {
      ordinal += 1;
      continue;
    }
    if (processedThisRun >= maxTiles || (now() - started) / 1000 >= maxSeconds || shouldStop()) {
      writeCheckpoint(statePath, checkpoint);
      return checkpoint;
    }

    let decoded;
    try {
      decoded = decoder(reader.tileForEntry(entry));
    } catch (cause) {
      const coordinate = tileIdToZxy(entry.tileId);
      throw new Error(
        `MVT decode failed at entry ${String(ordinal)} tile ${String(coordinate.z)}/${String(coordinate.x)}/${String(coordinate.y)}: ${shortError(cause)}`,
      );
    }
    checkpoint.nextEntry += 1;
    checkpoint.decodedEntries += 1;
    checkpoint.decodedFeatures += decoded.features;
    checkpoint.geometryParts += decoded.geometryParts;
    for (const [layer, count] of Object.entries(decoded.layerFeatures)) {
      checkpoint.layerFeatures[layer] = (checkpoint.layerFeatures[layer] ?? 0) + count;
    }
    processedThisRun += 1;
    ordinal += 1;

    const current = now();
    if (
      checkpoint.nextEntry % CHECKPOINT_INTERVAL_TILES === 0 ||
      current - lastCheckpoint >= CHECKPOINT_INTERVAL_MS
    ) {
      writeCheckpoint(statePath, checkpoint);
      lastCheckpoint = current;
      process.stdout.write(
        `decode  : ${String(checkpoint.nextEntry)}/${String(reader.header.numTileEntries)} entries\n`,
      );
    }
  }

  if (ordinal !== reader.header.numTileEntries || checkpoint.nextEntry !== ordinal) {
    throw new Error(
      `directory yielded ${String(ordinal)} entries, header claims ${String(reader.header.numTileEntries)}`,
    );
  }
  checkpoint.complete = true;
  writeCheckpoint(statePath, checkpoint);
  return checkpoint;
}

function archiveIdentity(path, bytes, sha256) {
  return { filename: basename(path), bytes, sha256 };
}

function receiptFor({ identity, header, layers, spots, counties, exhaustive, tools }) {
  const publicTools = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, publicToolIdentity(tool)]),
  );
  return {
    schema: RECEIPT_SCHEMA,
    archive: {
      ...identity,
      header: {
        specVersion: header.specVersion,
        clustered: header.clustered,
        internalCompression: header.internalCompression,
        tileCompression: header.tileCompression,
        tileType: header.tileType,
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
        numAddressedTiles: header.numAddressedTiles,
        numTileEntries: header.numTileEntries,
        numTileContents: header.numTileContents,
        minLon: header.minLon,
        minLat: header.minLat,
        maxLon: header.maxLon,
        maxLat: header.maxLat,
        centerZoom: header.centerZoom,
        centerLon: header.centerLon,
        centerLat: header.centerLat,
      },
      layers,
      coverage: { spots, counties },
      exhaustive: {
        complete: exhaustive.complete,
        decodedEntries: exhaustive.decodedEntries,
        decodedFeatures: exhaustive.decodedFeatures,
        geometryParts: exhaustive.geometryParts,
        layerFeatures: exhaustive.layerFeatures,
      },
    },
    source: SOURCE,
    region: REGION,
    tools: publicTools,
    commands: commandPlan(),
    publish: {
      objectKey: OUTPUT_NAMES.archive,
      osm: SOURCE.osmTimestamp,
      suffix: 'full-us',
    },
  };
}

function writeReceipt(path, receipt) {
  const body = `${canonicalJson(receipt, 2)}\n`;
  if (pathExists(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) {
      throw new Error('existing receipt is unsafe');
    }
    if (readFileSync(path, 'utf8') !== body)
      throw new Error('existing receipt differs; refusing overwrite');
    return;
  }
  writeFileSync(path, body, { flag: 'wx', mode: 0o444 });
}

export async function verifyArchive(
  path,
  tools,
  region,
  { maxTiles = Infinity, maxSeconds = Infinity, shouldStop = () => false } = {},
) {
  validateArchivePath(path);
  const bytes = statSync(path).size;
  const sha256 = await hashFile(path);
  const identity = archiveIdentity(path, bytes, sha256);

  process.stdout.write(`verify  : pmtiles structure\n`);
  await runInherited(tools.pmtiles, ['verify', basename(path)], dirname(path));

  const reader = new LocalPmtilesReader(path);
  try {
    const metadata = reader.metadata();
    const layers = validateOutputMetadata(reader.header, metadata);
    const spots = checkCoverageSpots(reader);
    const counties = checkCountyCoverage(reader, region.collection);
    const exhaustive = await exhaustiveVerify(reader, {
      archiveIdentity: identity,
      statePath: checkpointPath(path),
      maxTiles,
      maxSeconds,
      shouldStop,
    });
    if (!exhaustive.complete) {
      return {
        complete: false,
        nextEntry: exhaustive.nextEntry,
        totalEntries: reader.header.numTileEntries,
      };
    }
    const receipt = receiptFor({
      identity,
      header: reader.header,
      layers,
      spots,
      counties,
      exhaustive,
      tools,
    });
    assertReceiptShape(receipt, identity);
    writeReceipt(`${path}.receipt.json`, receipt);
    return { complete: true, receipt };
  } finally {
    reader.close();
  }
}

function validateArchivePath(path) {
  if (!isAbsolute(path)) throw new Error('archive path must be absolute');
  const resolved = resolve(path);
  const stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(resolved) !== resolved) {
    throw new Error('archive must be a real regular file with no symlink components');
  }
  if (!resolved.endsWith('.pmtiles')) throw new Error('archive path must end in .pmtiles');
}

export function assertReceiptShape(receipt, identity) {
  if (receipt?.schema !== RECEIPT_SCHEMA) throw new Error('basemap receipt schema is invalid');
  assertExactObjectKeys(
    receipt,
    ['archive', 'commands', 'publish', 'region', 'schema', 'source', 'tools'],
    'basemap receipt',
  );
  assertExactObjectKeys(
    receipt.archive,
    ['bytes', 'coverage', 'exhaustive', 'filename', 'header', 'layers', 'sha256'],
    'basemap receipt archive',
  );
  assertExactObjectKeys(
    receipt.archive.header,
    [
      'centerLat',
      'centerLon',
      'centerZoom',
      'clustered',
      'internalCompression',
      'maxLat',
      'maxLon',
      'maxZoom',
      'minLat',
      'minLon',
      'minZoom',
      'numAddressedTiles',
      'numTileContents',
      'numTileEntries',
      'specVersion',
      'tileCompression',
      'tileType',
    ],
    'basemap receipt header',
  );
  assertExactObjectKeys(
    receipt.archive.coverage,
    ['counties', 'spots'],
    'basemap receipt coverage',
  );
  assertExactObjectKeys(
    receipt.archive.coverage.counties,
    ['features', 'matchesSha256', 'stateCodes'],
    'basemap receipt county coverage',
  );
  assertExactObjectKeys(
    receipt.archive.exhaustive,
    ['complete', 'decodedEntries', 'decodedFeatures', 'geometryParts', 'layerFeatures'],
    'basemap receipt exhaustive verification',
  );
  assertExactObjectKeys(receipt.publish, ['objectKey', 'osm', 'suffix'], 'basemap receipt publish');
  if (
    canonicalJson(
      receipt.archive && {
        filename: receipt.archive.filename,
        bytes: receipt.archive.bytes,
        sha256: receipt.archive.sha256,
      },
    ) !== canonicalJson(identity)
  ) {
    throw new Error('basemap receipt archive identity does not match');
  }
  const header = receipt.archive?.header;
  const exhaustive = receipt.archive?.exhaustive;
  const layerFeatureNames = Object.keys(exhaustive?.layerFeatures ?? {}).sort();
  const expectedLayerNames = EXPECTED_LAYERS.map(({ id }) => id).sort();
  const decodedFeatureTotal = layerFeatureNames.reduce(
    (total, name) => total + (exhaustive.layerFeatures[name] ?? 0),
    0,
  );
  const headerNumbers = [
    header?.numAddressedTiles,
    header?.numTileEntries,
    header?.numTileContents,
  ];
  if (
    identity?.filename !== OUTPUT_NAMES.archive ||
    !Number.isSafeInteger(identity?.bytes) ||
    identity.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(identity?.sha256 ?? '') ||
    header?.specVersion !== 3 ||
    header?.clustered !== true ||
    header?.internalCompression !== 2 ||
    header?.tileCompression !== 2 ||
    header?.tileType !== 1 ||
    header?.minZoom !== 0 ||
    header?.maxZoom !== 14 ||
    headerNumbers.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    header.numAddressedTiles < header.numTileEntries ||
    header.numTileContents > header.numTileEntries ||
    ![header.minLon, header.minLat, header.maxLon, header.maxLat].every(Number.isFinite) ||
    header.minLon < -180 ||
    header.maxLon > 180 ||
    header.minLat < -90 ||
    header.maxLat > 90 ||
    header.minLon > header.maxLon ||
    header.minLat > header.maxLat ||
    header.minLon > REGION.bounds.minLon ||
    header.minLat > REGION.bounds.minLat ||
    header.maxLon < REGION.bounds.maxLon ||
    header.maxLat < REGION.bounds.maxLat ||
    !Number.isSafeInteger(header.centerZoom) ||
    header.centerZoom < 0 ||
    header.centerZoom > 14 ||
    !Number.isFinite(header.centerLon) ||
    !Number.isFinite(header.centerLat) ||
    header.centerLon < -180 ||
    header.centerLon > 180 ||
    header.centerLat < -90 ||
    header.centerLat > 90 ||
    exhaustive?.complete !== true ||
    exhaustive.decodedEntries !== header.numTileEntries ||
    !nonNegativeSafeInteger(exhaustive.decodedFeatures) ||
    !nonNegativeSafeInteger(exhaustive.geometryParts) ||
    canonicalJson(layerFeatureNames) !== canonicalJson(expectedLayerNames) ||
    layerFeatureNames.some((name) => !nonNegativeSafeInteger(exhaustive.layerFeatures[name])) ||
    decodedFeatureTotal !== exhaustive.decodedFeatures ||
    receipt.archive?.coverage?.counties?.features !== REGION.features ||
    canonicalJson(receipt.archive?.coverage?.counties?.stateCodes) !==
      canonicalJson(REGION.stateCodes) ||
    !/^[a-f0-9]{64}$/.test(receipt.archive?.coverage?.counties?.matchesSha256 ?? '') ||
    canonicalJson(receipt.archive?.layers) !== canonicalJson(EXPECTED_LAYERS) ||
    canonicalJson(receipt.source) !== canonicalJson(SOURCE) ||
    canonicalJson(receipt.region) !== canonicalJson(REGION) ||
    receipt.publish?.objectKey !== OUTPUT_NAMES.archive ||
    receipt.publish?.osm !== SOURCE.osmTimestamp ||
    receipt.publish?.suffix !== 'full-us'
  ) {
    throw new Error('basemap receipt is incomplete or does not match the pinned build');
  }
  const spotIds = receipt.archive.coverage.spots.map(({ id }) => id).sort();
  if (canonicalJson(spotIds) !== canonicalJson(COVERAGE_SPOTS.map(({ id }) => id).sort())) {
    throw new Error('basemap receipt does not contain every coverage spot');
  }
  for (const expected of COVERAGE_SPOTS) {
    const spot = receipt.archive.coverage.spots.find(({ id }) => id === expected.id);
    assertExactObjectKeys(
      spot,
      ['id', 'layers', 'x', 'y', 'z'],
      `basemap receipt coverage spot ${expected.id}`,
    );
    const coordinate = lonLatToTile(expected.lon, expected.lat, 14);
    if (
      spot?.z !== coordinate.z ||
      spot?.x !== coordinate.x ||
      spot?.y !== coordinate.y ||
      !Array.isArray(spot.layers) ||
      spot.layers.length === 0 ||
      canonicalJson([...new Set(spot.layers)].sort()) !== canonicalJson([...spot.layers].sort()) ||
      spot.layers.some((name) => !EXPECTED_LAYERS.some(({ id }) => id === name)) ||
      !expected.layers.some((name) => spot.layers.includes(name))
    ) {
      throw new Error(`basemap receipt coverage spot ${expected.id} is invalid`);
    }
  }
  const expectedTools = Object.fromEntries(
    Object.entries(TOOL_PINS).map(([name, pin]) => [name, publicToolIdentity(pin)]),
  );
  if (canonicalJson(receipt.tools) !== canonicalJson(expectedTools)) {
    throw new Error('basemap receipt tools do not match');
  }
  if (canonicalJson(receipt.commands) !== canonicalJson(commandPlan())) {
    throw new Error('basemap receipt command plan does not match');
  }
  return receipt;
}

function assertExactObjectKeys(value, expectedKeys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expectedKeys].sort())) {
    throw new Error(`${label} has missing or unknown fields`);
  }
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function publicToolIdentity(tool) {
  return Object.fromEntries(
    Object.entries(tool).filter(([name]) => !['env', 'path'].includes(name)),
  );
}

export async function verifiedReceiptForPublish(path) {
  validateArchivePath(path);
  const receiptPath = `${path}.receipt.json`;
  if (!pathExists(receiptPath))
    throw new Error(`verified basemap receipt is missing: ${receiptPath}`);
  const stat = lstatSync(receiptPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    realpathSync(receiptPath) !== resolve(receiptPath)
  ) {
    throw new Error('verified basemap receipt is not a real regular file');
  }
  if (stat.size > MAX_JSON_BYTES) throw new Error('verified basemap receipt exceeds 1 MiB');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const identity = archiveIdentity(path, statSync(path).size, await hashFile(path));
  return assertReceiptShape(receipt, identity);
}

export function canonicalJson(value, indentation = 0) {
  return JSON.stringify(sortRecursively(value), null, indentation);
}

function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortRecursively(value[key])]),
    );
  }
  return value;
}

function shortError(cause) {
  return String(cause?.message ?? cause)
    .replaceAll(/\s+/g, ' ')
    .slice(0, 300);
}

export function buildPlanSha256() {
  return createHash('sha256').update(canonicalJson(buildPlan())).digest('hex');
}

function shardedGeneratorOptions(planSha256 = buildPlanSha256()) {
  return `darkroute sharded tile-join plan sha256:${planSha256}`;
}

function expectedLayersForPartition(partition) {
  return EXPECTED_LAYERS.filter(
    ({ minzoom, maxzoom }) => minzoom <= partition.maxZoom && maxzoom >= partition.minZoom,
  ).map(({ id, minzoom, maxzoom }) => ({
    id,
    minzoom: Math.max(minzoom, partition.minZoom),
    maxzoom: Math.min(maxzoom, partition.maxZoom),
  }));
}

function tileJoinGeneratorOptions(argv) {
  return [TOOL_PINS.tileJoin.command, ...argv]
    .map((argument) => (argument.includes('=') ? `'${argument}'` : argument))
    .join(' ');
}

function validateExtractMetadata(metadata) {
  if (
    metadata?.version !== SOURCE.version ||
    metadata?.['planetiler:osm:osmosisreplicationtime'] !== SOURCE.osmTimestamp
  ) {
    throw new Error('extracted archive metadata is not from the pinned source');
  }
  const layers = metadata?.vector_layers?.map(({ id }) => id).sort();
  if (canonicalJson(layers) !== canonicalJson([...SOURCE_LAYERS].sort())) {
    throw new Error(`extracted source layers changed: ${JSON.stringify(layers)}`);
  }
  if (
    typeof metadata?.attribution !== 'string' ||
    !metadata.attribution.includes('openstreetmap.org/copyright')
  ) {
    throw new Error('extracted archive lost OpenStreetMap attribution');
  }
}

function validateFilteredMetadata(step, metadata) {
  if (metadata?.generator !== TOOL_PINS.tileJoin.version) {
    throw new Error(`filtered shard generator is not ${TOOL_PINS.tileJoin.version}`);
  }
  if (metadata?.generator_options !== tileJoinGeneratorOptions(step.argv)) {
    throw new Error(`filtered shard generator_options changed for ${step.id}`);
  }
  if (
    typeof metadata?.attribution !== 'string' ||
    !metadata.attribution.includes('openstreetmap.org/copyright')
  ) {
    throw new Error(`filtered shard ${step.id} lost OpenStreetMap attribution`);
  }
  const partition = archivePartitions().find(({ id }) => id === step.partitions[0]);
  const layers = metadata?.vector_layers?.map(({ id, minzoom, maxzoom }) => ({
    id,
    minzoom,
    maxzoom,
  }));
  if (
    !Array.isArray(layers) ||
    (layers.length !== 0 &&
      canonicalJson(layers) !== canonicalJson(expectedLayersForPartition(partition)))
  ) {
    throw new Error(`filtered shard ${step.id} layers/ranges changed`);
  }
}

export function mergedShardMetadata(shards, planSha256 = buildPlanSha256()) {
  if (!Array.isArray(shards) || shards.length === 0) {
    throw new Error('cannot finalize metadata without filtered shards');
  }
  const expectedSteps = buildPlan().filter(({ kind }) => kind === 'filter');
  if (
    canonicalJson(shards.map(({ step }) => step?.id)) !==
    canonicalJson(expectedSteps.map(({ id }) => id))
  ) {
    throw new Error('metadata finalization requires every filtered shard in plan order');
  }
  const layerDetails = new Map();
  for (const { step, metadata } of shards) {
    validateFilteredMetadata(step, metadata);
    for (const layer of metadata.vector_layers) {
      let details = layerDetails.get(layer.id);
      if (details === undefined) {
        details = { descriptions: new Set(), fields: new Map() };
        layerDetails.set(layer.id, details);
      }
      details.descriptions.add(layer.description ?? '');
      for (const [name, type] of Object.entries(layer.fields ?? {})) {
        const previous = details.fields.get(name);
        if (previous !== undefined && previous !== type) {
          throw new Error(`layer ${layer.id} field ${name} changes type across shards`);
        }
        details.fields.set(name, type);
      }
    }
  }
  const missing = EXPECTED_LAYERS.filter(({ id }) => !layerDetails.has(id));
  if (missing.length > 0) {
    throw new Error(`filtered shards are missing layers: ${missing.map(({ id }) => id).join(',')}`);
  }
  const metadata = { ...shards[0].metadata };
  delete metadata.antimeridian_adjusted_bounds;
  metadata.generator = TOOL_PINS.tileJoin.version;
  metadata.generator_options = shardedGeneratorOptions(planSha256);
  metadata['darkroute:build-plan-sha256'] = planSha256;
  metadata.vector_layers = EXPECTED_LAYERS.map((expected) => {
    const details = layerDetails.get(expected.id);
    if (details.descriptions.size > 1) {
      throw new Error(`layer ${expected.id} description changes across shards`);
    }
    return {
      id: expected.id,
      description: [...details.descriptions][0],
      minzoom: expected.minzoom,
      maxzoom: expected.maxzoom,
      fields: Object.fromEntries(
        [...details.fields.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
    };
  });
  return metadata;
}

function expectedBuildTools(tools) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, publicToolIdentity(tool)]),
  );
}

function validateLogicalMap(value, expectedPartitionIds, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not a logical digest map`);
  }
  if (
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expectedPartitionIds].sort())
  ) {
    throw new Error(`${label} has missing or unknown logical partitions`);
  }
  for (const [partitionId, digest] of Object.entries(value)) {
    assertExactObjectKeys(digest, ['addressedTiles', 'sha256'], `${label} ${partitionId}`);
    if (!nonNegativeSafeInteger(digest.addressedTiles) || !/^[a-f0-9]{64}$/.test(digest.sha256)) {
      throw new Error(`${label} ${partitionId} is invalid`);
    }
  }
}

export function validateBuildCheckpoint(checkpoint, tools = TOOL_PINS) {
  const plan = buildPlan();
  assertExactObjectKeys(
    checkpoint,
    ['activeStep', 'completed', 'planSha256', 'regionSha256', 'schema', 'source', 'tools'],
    'basemap build checkpoint',
  );
  if (
    checkpoint.schema !== BUILD_CHECKPOINT_SCHEMA ||
    checkpoint.planSha256 !== buildPlanSha256() ||
    checkpoint.regionSha256 !== REGION.sha256 ||
    canonicalJson(checkpoint.source) !== canonicalJson(SOURCE) ||
    canonicalJson(checkpoint.tools) !== canonicalJson(expectedBuildTools(tools)) ||
    checkpoint.completed === null ||
    typeof checkpoint.completed !== 'object' ||
    Array.isArray(checkpoint.completed)
  ) {
    throw new Error('basemap build checkpoint does not match the pinned build');
  }
  let completedCount = 0;
  while (
    completedCount < plan.length &&
    checkpoint.completed[plan[completedCount].id] !== undefined
  ) {
    completedCount += 1;
  }
  if (Object.keys(checkpoint.completed).length !== completedCount) {
    throw new Error('basemap build checkpoint skips or invents a step');
  }
  for (let index = 0; index < completedCount; index += 1) {
    const step = plan[index];
    const result = checkpoint.completed[step.id];
    assertExactObjectKeys(result, ['logical', 'outputs'], `basemap build result ${step.id}`);
    if (!Array.isArray(result.outputs) || result.outputs.length !== step.outputs.length) {
      throw new Error(`basemap build result ${step.id} has the wrong outputs`);
    }
    for (let outputIndex = 0; outputIndex < step.outputs.length; outputIndex += 1) {
      const identity = result.outputs[outputIndex];
      assertExactObjectKeys(
        identity,
        ['bytes', 'filename', 'sha256'],
        `${step.id} output identity`,
      );
      if (
        identity.filename !== step.outputs[outputIndex] ||
        !Number.isSafeInteger(identity.bytes) ||
        identity.bytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(identity.sha256)
      ) {
        throw new Error(`basemap build result ${step.id} has an invalid output identity`);
      }
    }
    if (
      [
        'source',
        'metadata',
        'logical-gate',
        'partition',
        'filter',
        'empty-partition',
        'empty-filter',
      ].includes(step.kind)
    ) {
      validateLogicalMap(result.logical, step.partitions, `basemap build result ${step.id}`);
    } else if (result.logical !== null) {
      throw new Error(`basemap build result ${step.id} has an unexpected logical digest`);
    }
    if (['empty-partition', 'empty-filter'].includes(step.kind)) {
      const expected = emptyStepResult(step);
      if (canonicalJson(result) !== canonicalJson(expected)) {
        throw new Error(`basemap build result ${step.id} is not the pinned zero checkpoint`);
      }
    }
    if (step.kind === 'logical-gate') {
      const expected = logicalGateResult(step, checkpoint);
      if (canonicalJson(result) !== canonicalJson(expected)) {
        throw new Error(`basemap build result ${step.id} does not prove its logical union`);
      }
    }
  }
  const nextStep = plan[completedCount];
  if (checkpoint.activeStep !== null && checkpoint.activeStep !== nextStep?.id) {
    throw new Error('basemap build checkpoint active step is inconsistent');
  }
  return { checkpoint, completedCount, complete: completedCount === plan.length };
}

export function migrateLegacyBuildCheckpoint(checkpoint, tools = TOOL_PINS) {
  if (checkpoint?.planSha256 !== LEGACY_BUILD_PLAN_SHA256) {
    throw new Error('basemap build checkpoint is not the recognized legacy plan');
  }
  const plan = buildPlan();
  const migrationBoundary = plan.findIndex(({ kind }) => kind === 'empty-partition');
  const prefixSha256 = createHash('sha256')
    .update(canonicalJson(plan.slice(0, migrationBoundary)))
    .digest('hex');
  if (migrationBoundary !== 15 || prefixSha256 !== LEGACY_BUILD_PREFIX_SHA256) {
    throw new Error('legacy basemap checkpoint migration boundary changed');
  }
  const migrated = {
    ...checkpoint,
    planSha256: buildPlanSha256(),
    completed: { ...checkpoint.completed },
  };
  const progress = validateBuildCheckpoint(migrated, tools);
  if (progress.completedCount !== migrationBoundary) {
    throw new Error('legacy basemap checkpoint is not the exact completed prefix');
  }
  return migrated;
}

function preserveStaleTemporary(path) {
  if (!pathExists(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error('stale build checkpoint temporary is unsafe');
  }
  let index = 0;
  let destination;
  do {
    destination = `${path}.rejected-stale-${String(index).padStart(3, '0')}`;
    index += 1;
  } while (pathExists(destination));
  renameSync(path, destination);
}

function writeBuildCheckpoint(path, checkpoint) {
  if (pathExists(path)) {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      realpathSync(path) !== resolve(path)
    ) {
      throw new Error('refusing to replace an unsafe build checkpoint');
    }
  }
  const temporary = `${path}.tmp`;
  preserveStaleTemporary(temporary);
  writeFileSync(temporary, `${canonicalJson(checkpoint, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

async function loadBuildCheckpoint(path, tools, validated) {
  if (!pathExists(path)) {
    const checkpoint = {
      schema: BUILD_CHECKPOINT_SCHEMA,
      planSha256: buildPlanSha256(),
      source: SOURCE,
      regionSha256: REGION.sha256,
      tools: expectedBuildTools(tools),
      activeStep: null,
      completed: {},
    };
    writeBuildCheckpoint(path, checkpoint);
    return checkpoint;
  }
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    realpathSync(path) !== resolve(path)
  ) {
    throw new Error('basemap build checkpoint is not a real regular file');
  }
  if (stat.size > MAX_JSON_BYTES) throw new Error('basemap build checkpoint is too large');
  let checkpoint = JSON.parse(readFileSync(path, 'utf8'));
  if (checkpoint?.planSha256 === LEGACY_BUILD_PLAN_SHA256) {
    const migrated = migrateLegacyBuildCheckpoint(checkpoint, tools);
    process.stdout.write(
      'migration: revalidating all 15 legacy prefix artifacts before updating checkpoint\n',
    );
    await verifyCheckpointArtifacts(migrated, dirname(path), validated);
    writeBuildCheckpoint(path, migrated);
    process.stdout.write(
      `migration: adopted legacy plan ${LEGACY_BUILD_PLAN_SHA256} at step 15/79\n`,
    );
    checkpoint = migrated;
  }
  validateBuildCheckpoint(checkpoint, tools);
  return checkpoint;
}

async function fileIdentity(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    realpathSync(path) !== resolve(path)
  ) {
    throw new Error(`build artifact is not a real regular file: ${path}`);
  }
  return archiveIdentity(path, stat.size, await hashFile(path));
}

function completedOutputIdentity(checkpoint, filename) {
  for (const result of Object.values(checkpoint.completed)) {
    const identity = result.outputs.find((candidate) => candidate.filename === filename);
    if (identity !== undefined) return identity;
  }
  return null;
}

function assertCheckpointArtifactsPresent(checkpoint, outDir) {
  for (const result of Object.values(checkpoint.completed)) {
    for (const { filename } of result.outputs) {
      const path = join(outDir, filename);
      if (!pathExists(path)) {
        throw new Error(`checkpointed build artifact is missing or unsafe: ${filename}`);
      }
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        realpathSync(path) !== resolve(path)
      ) {
        throw new Error(`checkpointed build artifact is missing or unsafe: ${filename}`);
      }
    }
  }
}

export async function verifyCheckpointArtifacts(checkpoint, outDir, validated = new Set()) {
  assertCheckpointArtifactsPresent(checkpoint, outDir);
  for (const result of Object.values(checkpoint.completed)) {
    for (const expected of result.outputs) {
      const actual = await fileIdentity(join(outDir, expected.filename));
      if (canonicalJson(actual) !== canonicalJson(expected)) {
        throw new Error(`legacy checkpointed build artifact changed: ${expected.filename}`);
      }
      validated.add(expected.filename);
    }
  }
  return validated;
}

async function validateDependencies(step, checkpoint, outDir, validated) {
  for (const filename of step.inputs) {
    if (validated.has(filename)) continue;
    const expected = completedOutputIdentity(checkpoint, filename);
    if (expected === null) throw new Error(`step ${step.id} has no checkpointed input ${filename}`);
    const actual = await fileIdentity(join(outDir, filename));
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new Error(`checkpointed build input changed: ${filename}`);
    }
    validated.add(filename);
  }
}

function selectStepLogicalDigests(allDigests, step) {
  const selected = Object.fromEntries(step.partitions.map((id) => [id, allDigests[id]]));
  const unexpectedTiles = Object.entries(allDigests)
    .filter(([id]) => !step.partitions.includes(id))
    .reduce((total, [, digest]) => total + digest.addressedTiles, 0);
  if (unexpectedTiles !== 0)
    throw new Error(`archive for ${step.id} contains tiles outside its shard`);
  return selected;
}

function assertExpectedOccupancy(logical, step) {
  const z14 = archivePartitions().filter(({ minZoom }) => minZoom === 14);
  for (const [partitionId, digest] of Object.entries(logical)) {
    const z14Index = z14.findIndex(({ id }) => id === partitionId);
    const expectedNonempty = z14Index === -1 || Z14_NONEMPTY_SHARD_INDICES.includes(z14Index);
    if (expectedNonempty !== digest.addressedTiles > 0) {
      throw new Error(
        `${step.id} partition ${partitionId} occupancy changed from the pinned county region`,
      );
    }
  }
}

function assertArchiveZoom(reader, step) {
  if (reader.header.numAddressedTiles === 0 && step.kind === 'filter') return;
  const partitions = archivePartitions().filter(({ id }) => step.partitions.includes(id));
  const minZoom = Math.min(...partitions.map(({ minZoom: value }) => value));
  const maxZoom = Math.max(...partitions.map(({ maxZoom: value }) => value));
  if (reader.header.minZoom !== minZoom || reader.header.maxZoom !== maxZoom) {
    throw new Error(
      `${step.id} zoom range is ${String(reader.header.minZoom)}-${String(reader.header.maxZoom)}, expected ${String(minZoom)}-${String(maxZoom)}`,
    );
  }
}

async function validatePmtilesOutput(path, step, tools, shouldStop) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    realpathSync(path) !== resolve(path) ||
    stat.size <= 0 ||
    stat.size > step.resources.maximumOutputBytes
  ) {
    throw new Error(`unsafe or oversized output for ${step.id}`);
  }
  const validator = step.validators.find(
    ({ tool, argv }) => tool === 'pmtiles' && argv[0] === 'verify' && argv[1] === basename(path),
  );
  if (validator === undefined) throw new Error(`step ${step.id} has no pinned PMTiles validator`);
  await runInherited(tools[validator.tool], validator.argv, dirname(path), {
    limits: step.resources,
    shouldStop,
  });
  const reader = new LocalPmtilesReader(path, { cacheDirectories: false });
  try {
    if (step.kind === 'source' || step.kind === 'partition') {
      assertArchiveZoom(reader, step);
      validateExtractMetadata(reader.metadata());
      const logical = selectStepLogicalDigests(
        await boundedLogicalPartitionDigests(reader, archivePartitions(), shouldStop),
        step,
      );
      assertExpectedOccupancy(logical, step);
      return logical;
    }
    if (step.kind === 'filter') {
      assertArchiveZoom(reader, step);
      validateFilteredMetadata(step, reader.metadata());
      const logical = selectStepLogicalDigests(
        await boundedLogicalPartitionDigests(reader, archivePartitions(), shouldStop),
        step,
      );
      assertExpectedOccupancy(logical, step);
      return logical;
    }
    if (step.kind === 'metadata') {
      validateOutputMetadata(reader.header, reader.metadata());
      return await boundedLogicalPartitionDigests(reader, archivePartitions(), shouldStop);
    }
    return null;
  } finally {
    reader.close();
  }
}

async function quarantineOutputs(paths) {
  for (const path of paths) {
    if (!pathExists(path)) continue;
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      realpathSync(path) !== resolve(path)
    ) {
      throw new Error(`refusing to move unsafe interrupted output ${path}`);
    }
    const digest = await hashFile(path);
    let suffix = 0;
    let destination;
    do {
      destination = `${path}.rejected-${digest.slice(0, 16)}-${String(suffix).padStart(2, '0')}`;
      suffix += 1;
    } while (pathExists(destination));
    renameSync(path, destination);
    process.stderr.write(`preserved rejected candidate: ${destination}\n`);
  }
}

async function validateStepOutputs(step, outDir, tools, shouldStop) {
  if (step.kind === 'metadata') {
    const metadataPath = join(outDir, OUTPUT_NAMES.metadata);
    const metadataStat = lstatSync(metadataPath);
    if (
      !metadataStat.isFile() ||
      metadataStat.isSymbolicLink() ||
      metadataStat.nlink !== 1 ||
      realpathSync(metadataPath) !== resolve(metadataPath) ||
      metadataStat.size > MAX_JSON_BYTES
    ) {
      throw new Error('final metadata sidecar is unsafe');
    }
    const sidecar = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const archivePath = join(outDir, OUTPUT_NAMES.archive);
    const logical = await validatePmtilesOutput(archivePath, step, tools, shouldStop);
    const reader = new LocalPmtilesReader(archivePath, { cacheDirectories: false });
    try {
      if (canonicalJson(reader.metadata()) !== canonicalJson(sidecar)) {
        throw new Error('final archive metadata differs from the pinned sidecar');
      }
    } finally {
      reader.close();
    }
    return {
      outputs: [await fileIdentity(metadataPath), await fileIdentity(archivePath)],
      logical,
    };
  }
  const outputPath = join(outDir, step.outputs[0]);
  const logical = await validatePmtilesOutput(outputPath, step, tools, shouldStop);
  return { outputs: [await fileIdentity(outputPath)], logical };
}

function logicalGateResult(step, checkpoint) {
  const wholeStepId =
    step.id === 'validate-raw-partitions' ? 'extract-source' : 'finalize-metadata';
  const piecePrefix = step.id === 'validate-raw-partitions' ? 'partition-' : 'filter-';
  const whole = checkpoint.completed[wholeStepId].logical;
  const pieces = step.partitions.map(
    (partitionId) => checkpoint.completed[`${piecePrefix}${partitionId}`].logical,
  );
  assertLogicalUnion(whole, pieces, step.id);
  return { outputs: [], logical: whole };
}

async function writeFinalMetadata(step, outDir) {
  const shardSteps = buildPlan().filter(({ kind }) => kind === 'filter');
  const shards = shardSteps.map((shardStep) => {
    const reader = new LocalPmtilesReader(join(outDir, shardStep.outputs[0]), {
      cacheDirectories: false,
    });
    try {
      return { step: shardStep, metadata: reader.metadata() };
    } finally {
      reader.close();
    }
  });
  const metadata = mergedShardMetadata(shards);
  writeFileSync(join(outDir, OUTPUT_NAMES.metadata), `${canonicalJson(metadata, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  copyFileSync(
    join(outDir, OUTPUT_NAMES.uneditedArchive),
    join(outDir, OUTPUT_NAMES.archive),
    fsConstants.COPYFILE_EXCL,
  );
}

async function executeBuildStep(
  step,
  checkpoint,
  checkpointPath,
  tools,
  outDir,
  validated,
  shouldStop,
) {
  await validateDependencies(step, checkpoint, outDir, validated);
  const throwIfStopRequested = () => {
    if (!shouldStop()) return;
    const error = new Error('build stop requested at a checkpoint boundary');
    error.expectedStop = true;
    throw error;
  };
  throwIfStopRequested();
  if (checkpoint.activeStep === null) {
    checkpoint.activeStep = step.id;
    writeBuildCheckpoint(checkpointPath, checkpoint);
  }
  if (
    step.kind === 'logical-gate' ||
    step.kind === 'empty-partition' ||
    step.kind === 'empty-filter'
  ) {
    const result =
      step.kind === 'logical-gate' ? logicalGateResult(step, checkpoint) : emptyStepResult(step);
    checkpoint.completed[step.id] = result;
    checkpoint.activeStep = null;
    writeBuildCheckpoint(checkpointPath, checkpoint);
    if (step.kind !== 'logical-gate') {
      process.stdout.write(`zero     : ${step.id} (outside every pinned region polygon bbox)\n`);
    }
    return;
  }

  const outputPaths = step.outputs.map((name) => join(outDir, name));
  const existing = outputPaths.filter(pathExists);
  if (existing.length > 0) {
    if (existing.length === outputPaths.length) {
      try {
        const result = await validateStepOutputs(step, outDir, tools, shouldStop);
        checkpoint.completed[step.id] = result;
        checkpoint.activeStep = null;
        writeBuildCheckpoint(checkpointPath, checkpoint);
        for (const { filename } of result.outputs) validated.add(filename);
        process.stdout.write(`adopted  : ${step.id}\n`);
        return;
      } catch (cause) {
        if (cause?.expectedStop === true) throw cause;
        process.stderr.write(`candidate: ${step.id} failed validation (${shortError(cause)})\n`);
      }
    }
    await quarantineOutputs(existing);
  }

  throwIfStopRequested();
  const snapshot = resourceSnapshot(outDir);
  assertStepResources(snapshot, step.resources);
  process.stdout.write(
    `step     : ${step.id}\n` +
      `limits   : ${formatGiB(step.resources.maximumRssBytes)} GiB RSS; ` +
      `${String(step.resources.maximumSeconds)} seconds; one process\n`,
  );
  try {
    if (step.kind === 'metadata') {
      await writeFinalMetadata(step, outDir);
      throwIfStopRequested();
    }
    await runInherited(tools[step.tool], step.argv, outDir, {
      limits: step.resources,
      outputPaths,
      shouldStop,
    });
    const result = await validateStepOutputs(step, outDir, tools, shouldStop);
    checkpoint.completed[step.id] = result;
    checkpoint.activeStep = null;
    writeBuildCheckpoint(checkpointPath, checkpoint);
    for (const { filename } of result.outputs) validated.add(filename);
  } catch (cause) {
    if (cause?.expectedStop !== true) await quarantineOutputs(outputPaths);
    throw cause;
  }
}

async function printPlan(tools, inputs) {
  const resources = resourceSnapshot('/var/tmp');
  const publicTools = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [name, publicToolIdentity(tool)]),
  );
  const plan = {
    schema: BUILD_CHECKPOINT_SCHEMA,
    planSha256: buildPlanSha256(),
    source: SOURCE,
    region: {
      ...REGION,
      alaskaPositiveLongitudes: inputs.region.alaskaPositiveLongitudes,
    },
    tools: publicTools,
    partitions: archivePartitions(),
    measuredExtracts: EXTRACT_METRICS,
    steps: buildPlan(),
    commands: commandPlan(),
    resources: {
      measured: resources,
      required: RESOURCE_LIMITS,
      safe: true,
    },
  };
  try {
    assertResources(resources);
  } catch (cause) {
    plan.resources.safe = false;
    process.stdout.write(`${canonicalJson(plan, 2)}\n`);
    throw cause;
  }
  process.stdout.write(`${canonicalJson(plan, 2)}\n`);
}

async function build(options, tools, inputs) {
  const prepared = validateBuildDirectory(options.outDir);
  process.stdout.write(
    `workspace: ${prepared.outDir}\n` +
      `disk     : ${formatGiB(prepared.resources.freeDiskBytes)} GiB free\n` +
      `memory   : ${formatGiB(prepared.resources.availableMemoryBytes)} GiB available\n` +
      `expected : 4-8 hours; 8.3 GB transfer; 7.9 GB raw; ~40 GB peak workspace\n` +
      `shards   : 32 sequential z14 longitude slices; merge fan-in at most 4\n` +
      `safety   : 4.00 GiB per-process RSS ceiling; interrupted candidates are preserved\n`,
  );
  const validated = new Set();
  const checkpoint = await loadBuildCheckpoint(prepared.paths.buildCheckpoint, tools, validated);
  const symbolicPlan = buildPlan();
  const executablePlan = buildPlan(inputs.regionPath);
  let completedThisRun = 0;
  while (true) {
    const progress = validateBuildCheckpoint(checkpoint, tools);
    if (progress.complete) {
      assertCheckpointArtifactsPresent(checkpoint, prepared.outDir);
      const finalExpected = completedOutputIdentity(checkpoint, OUTPUT_NAMES.archive);
      const finalActual = await fileIdentity(prepared.paths.archive);
      if (canonicalJson(finalActual) !== canonicalJson(finalExpected)) {
        throw new Error('completed final archive changed after its checkpoint');
      }
      process.stdout.write(
        `built    : ${prepared.paths.archive}\n` +
          `state    : ${prepared.paths.buildCheckpoint}\n` +
          `raw kept : ${prepared.paths.raw}\n` +
          `next     : rerun --verify in bounded chunks to emit ${prepared.paths.receipt}\n`,
      );
      return { complete: true };
    }
    if (completedThisRun >= options.maxSteps || options.shouldStop()) {
      return {
        complete: false,
        completed: progress.completedCount,
        total: symbolicPlan.length,
        activeStep: checkpoint.activeStep,
      };
    }
    const executableStep = executablePlan[progress.completedCount];
    if (executableStep.id !== symbolicPlan[progress.completedCount].id) {
      throw new Error('executable build plan diverged from the receipt plan');
    }
    try {
      await executeBuildStep(
        executableStep,
        checkpoint,
        prepared.paths.buildCheckpoint,
        tools,
        prepared.outDir,
        validated,
        options.shouldStop,
      );
    } catch (cause) {
      if (cause?.expectedStop === true) {
        return {
          complete: false,
          completed: progress.completedCount,
          total: symbolicPlan.length,
          activeStep: checkpoint.activeStep,
        };
      }
      throw cause;
    }
    completedThisRun += 1;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.mode === 'help') {
    process.stdout.write(usage());
    return;
  }
  const tools = await resolveAndValidateTools();
  const inputs = await validatePinnedInputs(tools);
  if (options.mode === 'plan') {
    await printPlan(tools, inputs);
    return;
  }
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
    process.stderr.write('signal received; preserving progress at the current boundary\n');
  };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
  if (options.mode === 'build') {
    const result = await build({ ...options, shouldStop: () => stopRequested }, tools, inputs);
    if (!result.complete) {
      process.stdout.write(
        `incomplete: ${String(result.completed)}/${String(result.total)} build steps checkpointed` +
          `${result.activeStep === null ? '' : `; active=${result.activeStep}`}\n`,
      );
      process.exitCode = 2;
    }
    return;
  }
  const result = await verifyArchive(resolve(options.archive), tools, inputs.region, {
    maxTiles: options.maxTiles,
    maxSeconds: options.maxSeconds,
    shouldStop: () => stopRequested,
  });
  if (!result.complete) {
    process.stdout.write(
      `incomplete: checkpointed ${String(result.nextEntry)}/${String(result.totalEntries)} tile entries\n`,
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${canonicalJson(result.receipt, 2)}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${shortError(error)}\n`);
    process.exitCode = 1;
  });
}
