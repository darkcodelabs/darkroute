import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  BUILD_CHECKPOINT_SCHEMA,
  CHECKPOINT_SCHEMA,
  COVERAGE_SPOTS,
  EXTRACT_METRICS,
  EXPECTED_LAYERS,
  LEGACY_BUILD_PLAN_SHA256,
  OUTPUT_NAMES,
  RECEIPT_SCHEMA,
  REGION,
  RESOURCE_LIMITS,
  SOURCE,
  TOOL_PINS,
  Z14_NONEMPTY_SHARD_INDICES,
  Z14_SHARD_COUNT,
  archivePartitions,
  assertLogicalUnion,
  assertReceiptShape,
  assertResources,
  assertStepResources,
  buildPlan,
  buildPlanSha256,
  canonicalJson,
  checkCountyCoverage,
  checkCoverageSpots,
  commandPlan,
  exhaustiveVerify,
  logicalPartitionDigests,
  lonLatToTile,
  mergedShardMetadata,
  migrateLegacyBuildCheckpoint,
  parseArguments,
  readDirectory,
  tileIdToZxy,
  validateBuildDirectory,
  validateBuildCheckpoint,
  validateOutputMetadata,
  validateRegionBytes,
  validateSourceArchive,
  validateSourceRow,
  verifyCheckpointArtifacts,
  verifiedReceiptForPublish,
  z14RegionShardCoverage,
  zxyToTileId,
} from './build-basemap.mjs';

const GiB = 1024 ** 3;

function temporaryDirectory(name) {
  return mkdtempSync(join(tmpdir(), `${name}-`));
}

function validSourceRow(overrides = {}) {
  return {
    key: SOURCE.key,
    size: SOURCE.bytes,
    md5sum: SOURCE.md5Base64,
    b3sum: SOURCE.blake3,
    uploaded: SOURCE.uploaded,
    version: SOURCE.version,
    ...overrides,
  };
}

function validReceipt(identity) {
  const toolReceipt = Object.fromEntries(
    Object.entries(TOOL_PINS).map(([name, tool]) => [
      name,
      Object.fromEntries(Object.entries(tool).filter(([key]) => key !== 'env')),
    ]),
  );
  return {
    schema: RECEIPT_SCHEMA,
    archive: {
      ...identity,
      header: {
        specVersion: 3,
        clustered: true,
        internalCompression: 2,
        tileCompression: 2,
        tileType: 1,
        minZoom: 0,
        maxZoom: 14,
        numAddressedTiles: 7,
        numTileEntries: 7,
        numTileContents: 7,
        minLon: -180,
        minLat: 17,
        maxLon: 180,
        maxLat: 72,
        centerZoom: 3,
        centerLon: 0,
        centerLat: 40,
      },
      layers: EXPECTED_LAYERS,
      coverage: {
        spots: COVERAGE_SPOTS.map(({ id, lon, lat, layers }) => ({
          id,
          ...lonLatToTile(lon, lat, 14),
          layers,
        })),
        counties: {
          features: REGION.features,
          stateCodes: REGION.stateCodes,
          matchesSha256: 'b'.repeat(64),
        },
      },
      exhaustive: {
        complete: true,
        decodedEntries: 7,
        decodedFeatures: EXPECTED_LAYERS.length,
        geometryParts: EXPECTED_LAYERS.length,
        layerFeatures: Object.fromEntries(EXPECTED_LAYERS.map(({ id }) => [id, 1])),
      },
    },
    source: SOURCE,
    region: REGION,
    tools: toolReceipt,
    commands: commandPlan(),
    publish: {
      objectKey: OUTPUT_NAMES.archive,
      osm: SOURCE.osmTimestamp,
      suffix: 'full-us',
    },
  };
}

function fakePmtilesReader(records) {
  const entries = records
    .map(({ tileId, bytes }) => ({ tileId, runLength: 1, offset: 0, length: bytes.length, bytes }))
    .sort((left, right) => left.tileId - right.tileId);
  return {
    header: { numTileEntries: entries.length, numAddressedTiles: entries.length },
    *entries() {
      yield* entries;
    },
    tileForEntry(entry) {
      return entry.bytes;
    },
  };
}

function publicBuildTools() {
  return Object.fromEntries(
    Object.entries(TOOL_PINS).map(([name, tool]) => [
      name,
      Object.fromEntries(Object.entries(tool).filter(([key]) => key !== 'env')),
    ]),
  );
}

function logicalForStep(step) {
  const empty = logicalPartitionDigests(fakePmtilesReader([]));
  return Object.fromEntries(
    step.partitions.map((partitionId) => [partitionId, empty[partitionId]]),
  );
}

function checkpointResult(step) {
  return {
    outputs: step.outputs.map((filename) => ({
      filename,
      bytes: 1,
      sha256: 'a'.repeat(64),
    })),
    logical: logicalForStep(step),
  };
}

describe('pinned basemap inputs and command line', () => {
  it('accepts only the dated source metadata row and archive identity', () => {
    assert.deepEqual(validateSourceRow([validSourceRow()]), validSourceRow());
    assert.throws(
      () => validateSourceRow([validSourceRow({ b3sum: '0'.repeat(64) })]),
      /source metadata b3sum changed/,
    );
    assert.throws(
      () => validateSourceRow([validSourceRow({ version: '4.15.3' })]),
      /source metadata version changed/,
    );

    const header = { tile_compression: 'gzip', tile_type: 'mvt', minzoom: 0, maxzoom: 15 };
    const metadata = {
      version: SOURCE.version,
      'planetiler:osm:osmosisreplicationtime': SOURCE.osmTimestamp,
      vector_layers: [
        'water',
        'roads',
        'pois',
        'places',
        'landuse',
        'landcover',
        'earth',
        'buildings',
        'boundaries',
      ].map((id) => ({ id })),
    };
    assert.doesNotThrow(() => validateSourceArchive(header, metadata));
    assert.throws(
      () => validateSourceArchive({ ...header, maxzoom: 14 }, metadata),
      /source header maxzoom/,
    );
    assert.throws(
      () =>
        validateSourceArchive(header, {
          ...metadata,
          vector_layers: metadata.vector_layers.filter(({ id }) => id !== 'water'),
        }),
      /source layers changed/,
    );
  });

  it('binds the checked-in county file, all 52 codes, and both sides of Alaska', () => {
    const bytes = readFileSync(new URL('data/us-counties.geojson', import.meta.url));
    const result = validateRegionBytes(bytes);
    assert.equal(result.collection.features.length, 3_221);
    assert.equal(result.stateCodes.length, 52);
    assert.equal(result.alaskaPositiveLongitudes, 341);
    assert.deepEqual(result.bounds, REGION.bounds);

    const changed = Buffer.from(bytes);
    changed[changed.length - 2] ^= 1;
    assert.throws(() => validateRegionBytes(changed), /region SHA-256 changed/);
  });

  it('pins every sharded command/output and never passes an overwrite flag', () => {
    const commands = commandPlan();
    const plan = buildPlan();
    assert.deepEqual(commands[0].argv, [
      'extract',
      SOURCE.url,
      OUTPUT_NAMES.raw,
      `--region=$REPO/${REGION.repositoryPath}`,
      '--minzoom=0',
      '--maxzoom=14',
      '--download-threads=4',
      '--overfetch=0.05',
    ]);
    const firstFilter = commands.find(({ id }) => id === 'filter-z00-10');
    assert.deepEqual(firstFilter.argv, [
      '--no-tile-size-limit',
      '--no-tile-stats',
      '--exclude-layer=buildings',
      '--exclude-layer=pois',
      '--exclude-layer=landuse',
      '--output=intermediate-filtered-z00-10.pmtiles',
      'intermediate-raw-z00-10.pmtiles',
    ]);
    assert.equal(commands.filter(({ id }) => id.startsWith('partition-')).length, 15);
    assert.equal(commands.filter(({ id }) => id.startsWith('filter-')).length, 15);
    assert.equal(plan.filter(({ id }) => id.startsWith('partition-')).length, 35);
    assert.equal(plan.filter(({ id }) => id.startsWith('filter-')).length, 35);
    assert.equal(plan.filter(({ kind }) => kind === 'empty-partition').length, 20);
    assert.equal(plan.filter(({ kind }) => kind === 'empty-filter').length, 20);
    assert.equal(plan.length, 79);
    const knownEmpty = plan.find(({ id }) => id === 'partition-z14-x05632-06143');
    assert.deepEqual(
      {
        kind: knownEmpty.kind,
        tool: knownEmpty.tool,
        argv: knownEmpty.argv,
        inputs: knownEmpty.inputs,
        outputs: knownEmpty.outputs,
        preservedCandidates: knownEmpty.preservedCandidates,
      },
      {
        kind: 'empty-partition',
        tool: null,
        argv: [],
        inputs: [],
        outputs: [],
        preservedCandidates: ['intermediate-raw-z14-x05632-06143.pmtiles'],
      },
    );
    assert.equal(
      commands.some(({ id }) => id === 'partition-z14-x05632-06143'),
      false,
    );
    assert.equal(
      commands.some(({ id }) => id === 'partition-z14-x15872-16383'),
      true,
    );
    assert.ok(
      commands
        .filter(({ id }) => id.startsWith('merge-'))
        .every(({ argv }) => argv[0] === 'merge' && argv.length - 2 <= 4),
    );
    const levelOneInputs = commands
      .filter(({ id }) => id.startsWith('merge-l1-'))
      .flatMap(({ argv }) => argv.slice(1, -1));
    assert.equal(levelOneInputs.length, 3 + Z14_NONEMPTY_SHARD_INDICES.length);
    assert.equal(
      levelOneInputs.some((name) => name.includes('x05632-06143')),
      false,
    );
    assert.equal(
      levelOneInputs.some((name) => name.includes('x15872-16383')),
      true,
    );
    const outputs = commands.flatMap(({ outputs }) => outputs);
    assert.equal(new Set(outputs).size, outputs.length);
    assert.deepEqual(commands.at(-2), {
      id: 'finalize-metadata',
      tool: 'pmtiles',
      cwd: '$OUT',
      argv: ['edit', OUTPUT_NAMES.archive, `--metadata=${OUTPUT_NAMES.metadata}`],
      outputs: [OUTPUT_NAMES.metadata, OUTPUT_NAMES.archive],
      validators: [{ tool: 'pmtiles', argv: ['verify', OUTPUT_NAMES.archive] }],
    });
    assert.deepEqual(commands.at(-1).argv, ['verify', OUTPUT_NAMES.archive]);
    assert.equal(canonicalJson(commands).includes('--force'), false);
    assert.equal(canonicalJson(commands).includes('"-L"'), false);
  });

  it('requires explicit, non-conflicting modes and a heavy-build confirmation', () => {
    assert.equal(parseArguments(['--plan']).mode, 'plan');
    assert.deepEqual(
      parseArguments(['--verify=/tmp/archive.pmtiles', '--max-tiles=25', '--max-seconds=60']),
      {
        mode: 'verify',
        outDir: null,
        archive: '/tmp/archive.pmtiles',
        maxSteps: Infinity,
        maxTiles: 25,
        maxSeconds: 60,
      },
    );
    assert.throws(
      () => parseArguments(['--build', '--out-dir=/tmp/build']),
      /requires --confirm-heavy/,
    );
    assert.throws(() => parseArguments(['--plan', '--verify=/tmp/a.pmtiles']), /exactly one mode/);
    assert.throws(() => parseArguments(['--plan', '--max-tiles=1']), /valid only with --verify/);
    assert.equal(
      parseArguments([
        '--build',
        '--out-dir=/tmp/build',
        '--confirm-heavy=20260901',
        '--max-steps=4',
      ]).maxSteps,
      4,
    );
    assert.throws(() => parseArguments(['--plan', '--max-steps=1']), /valid only with --build/);
  });
});

describe('bounded shard topology and logical equality', () => {
  it('covers every z14 tile column exactly once with right-edge epsilon bboxes', () => {
    for (const shardCount of [16, 32]) {
      const partitions = archivePartitions(shardCount);
      assert.equal(partitions.length, shardCount + 3);
      assert.deepEqual(
        partitions.slice(0, 3).map(({ id, minZoom, maxZoom }) => ({ id, minZoom, maxZoom })),
        EXTRACT_METRICS.slice(0, 3).map(({ id, minZoom, maxZoom }) => ({
          id,
          minZoom,
          maxZoom,
        })),
      );
      const shards = partitions.slice(3);
      let nextX = 0;
      for (const shard of shards) {
        assert.equal(shard.xMin, nextX);
        assert.ok(shard.xMax >= shard.xMin);
        const [west, , east] = shard.bbox.split(',').map(Number);
        assert.equal(lonLatToTile(west, 40, 14).x, shard.xMin);
        assert.equal(lonLatToTile(east, 40, 14).x, shard.xMax);
        nextX = shard.xMax + 1;
      }
      assert.equal(nextX, 2 ** 14);
      for (let x = 0; x < 2 ** 14; x += 1) {
        assert.equal(shards.filter(({ xMin, xMax }) => x >= xMin && x <= xMax).length, 1);
      }
    }
    assert.equal(archivePartitions().length, Z14_SHARD_COUNT + 3);
    const countyCollection = JSON.parse(
      readFileSync(new URL('data/us-counties.geojson', import.meta.url), 'utf8'),
    );
    const coverage = z14RegionShardCoverage(countyCollection);
    assert.equal(coverage.features.length, 3_221);
    assert.equal(
      coverage.features.every(({ shardIndices }) => shardIndices.length > 0),
      true,
    );
    assert.deepEqual(coverage.shardIndices, [...Z14_NONEMPTY_SHARD_INDICES]);
    assert.deepEqual(coverage.features.find(({ id }) => id === '01001').shardIndices, [8]);
    assert.deepEqual(coverage.features.find(({ id }) => id === '02016').shardIndices, [0, 1, 31]);
    assert.equal(coverage.shardIndices.includes(11), false);
    assert.equal(coverage.shardIndices.includes(31), true);

    const gap = structuredClone(archivePartitions());
    gap[3].xMax -= 1;
    assert.throws(() => logicalPartitionDigests(fakePmtilesReader([]), gap), /gap/);
    const overlap = structuredClone(archivePartitions());
    overlap[4].xMin -= 1;
    assert.throws(() => logicalPartitionDigests(fakePmtilesReader([]), overlap), /overlap/);
  });

  it('matches a monolithic logical tileId+decoded-byte fixture to its exact shard union', () => {
    const partitions = archivePartitions();
    const records = [
      { tileId: zxyToTileId(0, 0, 0), bytes: Buffer.from('z0') },
      { tileId: zxyToTileId(11, 500, 800), bytes: Buffer.from('z11') },
      { tileId: zxyToTileId(13, 3_000, 4_000), bytes: Buffer.from('z13') },
      { tileId: zxyToTileId(14, 0, 6_000), bytes: Buffer.from('west-edge') },
      { tileId: zxyToTileId(14, 511, 6_001), bytes: Buffer.from('epsilon-left') },
      { tileId: zxyToTileId(14, 512, 6_001), bytes: Buffer.from('epsilon-right') },
      { tileId: zxyToTileId(14, 16_383, 6_002), bytes: Buffer.from('east-edge') },
    ];
    const whole = logicalPartitionDigests(fakePmtilesReader(records), partitions);
    const pieces = partitions.map((partition) => {
      const matching = records.filter(({ tileId }) => {
        const { z, x } = tileIdToZxy(tileId);
        return (
          z >= partition.minZoom &&
          z <= partition.maxZoom &&
          (partition.xMin === null || (x >= partition.xMin && x <= partition.xMax))
        );
      });
      const digests = logicalPartitionDigests(fakePmtilesReader(matching), partitions);
      return { [partition.id]: digests[partition.id] };
    });
    assert.deepEqual(assertLogicalUnion(whole, pieces, 'fixture'), whole);

    const changed = structuredClone(pieces);
    changed[3][partitions[3].id].sha256 = '0'.repeat(64);
    assert.throws(() => assertLogicalUnion(whole, changed, 'fixture'), /gap or changed/);
    assert.throws(
      () => assertLogicalUnion(whole, [...pieces, pieces[0]], 'fixture'),
      /overlapping logical partition/,
    );
    assert.throws(() => assertLogicalUnion(whole, pieces.slice(1), 'fixture'), /gap or changed/);
  });

  it('binds build resume state to an unskippable plan prefix, tools, and output hashes', () => {
    const checkpoint = {
      schema: BUILD_CHECKPOINT_SCHEMA,
      planSha256: buildPlanSha256(),
      source: SOURCE,
      regionSha256: REGION.sha256,
      tools: publicBuildTools(),
      activeStep: null,
      completed: {},
    };
    assert.equal(validateBuildCheckpoint(checkpoint).completedCount, 0);

    const plan = buildPlan();
    checkpoint.completed[plan[0].id] = {
      outputs: [{ filename: OUTPUT_NAMES.raw, bytes: 1, sha256: 'a'.repeat(64) }],
      logical: logicalPartitionDigests(fakePmtilesReader([])),
    };
    checkpoint.activeStep = plan[1].id;
    assert.equal(validateBuildCheckpoint(checkpoint).completedCount, 1);

    assert.throws(
      () => validateBuildCheckpoint({ ...checkpoint, planSha256: '0'.repeat(64) }),
      /does not match/,
    );
    assert.throws(
      () => validateBuildCheckpoint({ ...checkpoint, activeStep: plan[2].id }),
      /active step is inconsistent/,
    );
    assert.throws(
      () =>
        validateBuildCheckpoint({
          ...checkpoint,
          completed: {
            ...checkpoint.completed,
            [plan[2].id]: { outputs: [], logical: null },
          },
        }),
      /skips or invents/,
    );
  });

  it('migrates only the exact 15-step legacy prefix and pins explicit zero checkpoints', () => {
    const plan = buildPlan();
    const migrationBoundary = plan.findIndex(({ kind }) => kind === 'empty-partition');
    assert.equal(migrationBoundary, 15);
    assert.equal(plan[migrationBoundary].id, 'partition-z14-x05632-06143');
    const completed = Object.fromEntries(
      plan.slice(0, migrationBoundary).map((step) => [step.id, checkpointResult(step)]),
    );
    const legacy = {
      schema: BUILD_CHECKPOINT_SCHEMA,
      planSha256: LEGACY_BUILD_PLAN_SHA256,
      source: SOURCE,
      regionSha256: REGION.sha256,
      tools: publicBuildTools(),
      activeStep: plan[migrationBoundary].id,
      completed,
    };
    const migrated = migrateLegacyBuildCheckpoint(legacy);
    assert.equal(migrated.planSha256, buildPlanSha256());
    assert.equal(validateBuildCheckpoint(migrated).completedCount, 15);
    assert.equal(legacy.planSha256, LEGACY_BUILD_PLAN_SHA256);

    const zeroStep = plan[migrationBoundary];
    migrated.completed[zeroStep.id] = checkpointResult(zeroStep);
    migrated.activeStep = plan[migrationBoundary + 1].id;
    assert.equal(validateBuildCheckpoint(migrated).completedCount, 16);
    const forgedZero = structuredClone(migrated);
    forgedZero.completed[zeroStep.id].logical[zeroStep.partitions[0]].addressedTiles = 1;
    assert.throws(() => validateBuildCheckpoint(forgedZero), /pinned zero checkpoint/);

    assert.throws(
      () =>
        migrateLegacyBuildCheckpoint({
          ...legacy,
          completed: migrated.completed,
          activeStep: migrated.activeStep,
        }),
      /exact completed prefix/,
    );
    assert.throws(
      () => migrateLegacyBuildCheckpoint({ ...legacy, planSha256: '0'.repeat(64) }),
      /not the recognized legacy plan/,
    );
  });

  it('rehashes every legacy-prefix artifact before adoption and rejects same-size tampering', async () => {
    const directory = temporaryDirectory('basemap-legacy-artifacts');
    const plan = buildPlan();
    const migrationBoundary = plan.findIndex(({ kind }) => kind === 'empty-partition');
    const body = Buffer.from('x');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const completed = Object.fromEntries(
      plan.slice(0, migrationBoundary).map((step) => {
        const result = checkpointResult(step);
        result.outputs = result.outputs.map(({ filename }) => ({
          filename,
          bytes: body.length,
          sha256,
        }));
        for (const { filename } of result.outputs) writeFileSync(join(directory, filename), body);
        return [step.id, result];
      }),
    );
    const migrated = migrateLegacyBuildCheckpoint({
      schema: BUILD_CHECKPOINT_SCHEMA,
      planSha256: LEGACY_BUILD_PLAN_SHA256,
      source: SOURCE,
      regionSha256: REGION.sha256,
      tools: publicBuildTools(),
      activeStep: plan[migrationBoundary].id,
      completed,
    });
    const validated = await verifyCheckpointArtifacts(migrated, directory);
    assert.equal(validated.size, migrationBoundary);

    writeFileSync(join(directory, plan[1].outputs[0]), 'y');
    await assert.rejects(
      verifyCheckpointArtifacts(migrated, directory),
      /legacy checkpointed build artifact changed/,
    );
  });

  it('reconstructs complete metadata only from every exact filtered shard', () => {
    const partitions = new Map(archivePartitions().map((partition) => [partition.id, partition]));
    const filterSteps = buildPlan().filter(({ kind }) => kind === 'filter');
    const shards = filterSteps.map((step) => {
      const partition = partitions.get(step.partitions[0]);
      const vectorLayers = EXPECTED_LAYERS.filter(
        ({ minzoom, maxzoom }) => minzoom <= partition.maxZoom && maxzoom >= partition.minZoom,
      ).map(({ id, minzoom, maxzoom }) => ({
        id,
        description: '',
        minzoom: Math.max(minzoom, partition.minZoom),
        maxzoom: Math.min(maxzoom, partition.maxZoom),
        fields: { kind: 'String' },
      }));
      return {
        step,
        metadata: {
          generator: TOOL_PINS.tileJoin.version,
          generator_options: [TOOL_PINS.tileJoin.command, ...step.argv]
            .map((argument) => (argument.includes('=') ? `'${argument}'` : argument))
            .join(' '),
          attribution: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          vector_layers: vectorLayers,
        },
      };
    });
    const merged = mergedShardMetadata(shards);
    assert.deepEqual(
      merged.vector_layers.map(({ id, minzoom, maxzoom }) => ({ id, minzoom, maxzoom })),
      EXPECTED_LAYERS,
    );
    assert.equal(merged['darkroute:build-plan-sha256'], buildPlanSha256());
    assert.throws(() => mergedShardMetadata(shards.slice(1)), /every filtered shard/);

    const conflicting = structuredClone(shards);
    const roads = conflicting.at(-1).metadata.vector_layers.find(({ id }) => id === 'roads');
    roads.fields.kind = 'Number';
    assert.throws(() => mergedShardMetadata(conflicting), /changes type across shards/);
  });
});

describe('destructive-path and resource breakers', () => {
  it('rejects relative paths, symlink components, repo paths, and every existing target', () => {
    const root = temporaryDirectory('basemap-paths');
    const repository = join(root, 'repo');
    const outside = join(root, 'outside');
    mkdirSync(repository);
    mkdirSync(outside);
    const limits = { ...RESOURCE_LIMITS, minimumFreeDiskBytes: 0, minimumAvailableMemoryBytes: 0 };

    assert.equal(validateBuildDirectory(outside, repository, limits).outDir, outside);
    assert.throws(() => validateBuildDirectory('relative', repository, limits), /must be absolute/);
    assert.throws(
      () => validateBuildDirectory(repository, repository, limits),
      /outside the repository/,
    );

    const link = join(root, 'linked');
    symlinkSync(outside, link);
    assert.throws(() => validateBuildDirectory(link, repository, limits), /file or symlink/);

    writeFileSync(join(outside, OUTPUT_NAMES.raw), 'partial');
    assert.throws(
      () => validateBuildDirectory(outside, repository, limits),
      /refusing to start in non-empty build directory/,
    );
  });

  it('preserves rejected evidence for a newly explicit empty shard without admitting it live', () => {
    const root = temporaryDirectory('basemap-empty-evidence');
    const repository = join(root, 'repo');
    const outside = join(root, 'outside');
    mkdirSync(repository);
    mkdirSync(outside);
    const limits = { ...RESOURCE_LIMITS, minimumFreeDiskBytes: 0, minimumAvailableMemoryBytes: 0 };
    writeFileSync(join(outside, OUTPUT_NAMES.buildCheckpoint), '{}');
    const legacyCandidate = 'intermediate-raw-z14-x05632-06143.pmtiles';
    const rejected = `${legacyCandidate}.rejected-38d654ac030e8a6e-00`;
    writeFileSync(join(outside, rejected), 'preserved empty PMTiles evidence');
    assert.equal(validateBuildDirectory(outside, repository, limits).outDir, outside);

    writeFileSync(join(outside, legacyCandidate), 'uncheckpointed live candidate');
    assert.throws(
      () => validateBuildDirectory(outside, repository, limits),
      /unexpected file in dedicated build directory/,
    );
  });

  it('enforces the measured disk and available-memory floors independently', () => {
    assert.doesNotThrow(() =>
      assertResources({ freeDiskBytes: 64 * GiB, availableMemoryBytes: 4 * GiB }),
    );
    assert.throws(
      () => assertResources({ freeDiskBytes: 63 * GiB, availableMemoryBytes: 20 * GiB }),
      /free disk/,
    );
    assert.throws(
      () => assertResources({ freeDiskBytes: 100 * GiB, availableMemoryBytes: 3 * GiB }),
      /available memory/,
    );
    const limits = buildPlan().find(({ id }) => id === 'filter-z13').resources;
    assert.doesNotThrow(() =>
      assertStepResources({ freeDiskBytes: 20 * GiB, availableMemoryBytes: 4 * GiB }, limits),
    );
    assert.throws(
      () => assertStepResources({ freeDiskBytes: 20 * GiB, availableMemoryBytes: 3 * GiB }, limits),
      /next shard/,
    );
  });
});

describe('archive structure and geographic gates', () => {
  it('round-trips PMTiles Hilbert ids at representative edges', () => {
    for (const coordinate of [
      { z: 0, x: 0, y: 0 },
      { z: 1, x: 0, y: 0 },
      { z: 1, x: 1, y: 1 },
      { z: 14, x: 152, y: 5420 },
      { z: 14, x: 16_367, y: 5_415 },
    ]) {
      assert.deepEqual(
        tileIdToZxy(zxyToTileId(coordinate.z, coordinate.x, coordinate.y)),
        coordinate,
      );
    }
  });

  it('rejects truncated, trailing, and invalid PMTiles directory data', () => {
    // one entry: delta id 7, run 1, length 3, offset encoded as 1 => offset 0
    assert.deepEqual(readDirectory(Buffer.from([1, 7, 1, 3, 1])), [
      { tileId: 7, runLength: 1, length: 3, offset: 0 },
    ]);
    assert.throws(() => readDirectory(Buffer.from([1, 7, 1, 3])), /past the directory/);
    assert.throws(() => readDirectory(Buffer.from([1, 7, 1, 3, 1, 0])), /trailing bytes/);
    assert.throws(() => readDirectory(Buffer.from([1, 7, 1, 0, 1])), /invalid offset or length/);
  });

  it('pins all six output layers, ranges, generator argv, and attribution', () => {
    const metadata = {
      vector_layers: EXPECTED_LAYERS,
      generator: TOOL_PINS.tileJoin.version,
      generator_options: `darkroute sharded tile-join plan sha256:${buildPlanSha256()}`,
      'darkroute:build-plan-sha256': buildPlanSha256(),
      attribution: '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    };
    assert.deepEqual(
      validateOutputMetadata(
        { minZoom: 0, maxZoom: 14, minLon: -180, minLat: 17, maxLon: 180, maxLat: 72 },
        metadata,
      ),
      EXPECTED_LAYERS,
    );
    assert.throws(
      () =>
        validateOutputMetadata(
          { minZoom: 0, maxZoom: 14, minLon: -180, minLat: 17, maxLon: 180, maxLat: 72 },
          {
            ...metadata,
            vector_layers: [...EXPECTED_LAYERS, { id: 'pois', minzoom: 0, maxzoom: 14 }],
          },
        ),
      /layers\/ranges changed/,
    );
    assert.throws(
      () =>
        validateOutputMetadata(
          { minZoom: 0, maxZoom: 14, minLon: -180, minLat: 17, maxLon: 180, maxLat: 72 },
          { ...metadata, generator_options: 'tile-join -f' },
        ),
      /generator_options changed/,
    );
  });

  it('requires a decoded expected layer at every representative spot', () => {
    const reader = { tile: () => Buffer.from([1]) };
    const decoder = () => ({ layerFeatures: { roads: 1 }, features: 1, geometryParts: 1 });
    const spots = [{ id: 'test', lon: -77, lat: 39, layers: ['roads'] }];
    assert.equal(checkCoverageSpots(reader, spots, decoder)[0].id, 'test');
    assert.throws(
      () =>
        checkCoverageSpots(reader, spots, () => ({
          layerFeatures: { water: 1 },
          features: 1,
          geometryParts: 1,
        })),
      /lacks expected layer/,
    );
    assert.throws(
      () => checkCoverageSpots({ tile: () => null }, spots, decoder),
      /has no z14 tile/,
    );
  });

  it('fails county coverage when any county has no neighboring z14 tile', () => {
    const collection = {
      features: [
        { id: '01001', geometry: { coordinates: [[[-86.6, 32.5]]] } },
        { id: '72001', geometry: { coordinates: [[[-66.7, 18.3]]] } },
      ],
    };
    const seen = [];
    const reader = {
      hasTile(z, x, y) {
        seen.push({ z, x, y });
        return x > 5_000 && x < 6_000;
      },
    };
    assert.throws(() => checkCountyCoverage(reader, collection), /county 01001/);
    assert.ok(seen.every(({ z }) => z === 14));
  });
});

describe('resumable exhaustive decode and publish receipt', () => {
  it('checkpoints a bounded pass and resumes at the next directory entry', async () => {
    const directory = temporaryDirectory('basemap-resume');
    const statePath = join(directory, 'state.json');
    const entries = [
      { tileId: 1, runLength: 1, offset: 0, length: 1 },
      { tileId: 2, runLength: 1, offset: 1, length: 1 },
      { tileId: 3, runLength: 1, offset: 2, length: 1 },
    ];
    const decoded = [];
    const reader = {
      header: { numTileEntries: entries.length },
      *entries() {
        yield* entries;
      },
      tileForEntry(entry) {
        return Buffer.from([entry.tileId]);
      },
    };
    const decoder = (bytes) => {
      decoded.push(bytes[0]);
      return { layerFeatures: { roads: 1 }, features: 1, geometryParts: 1 };
    };
    const archiveIdentity = { filename: 'test.pmtiles', bytes: 3, sha256: 'a'.repeat(64) };

    const first = await exhaustiveVerify(reader, {
      archiveIdentity,
      statePath,
      maxTiles: 1,
      decoder,
    });
    assert.equal(first.complete, false);
    assert.equal(first.nextEntry, 1);
    assert.deepEqual(decoded, [1]);

    const final = await exhaustiveVerify(reader, { archiveIdentity, statePath, decoder });
    assert.equal(final.complete, true);
    assert.equal(final.decodedEntries, 3);
    assert.deepEqual(decoded, [1, 2, 3]);
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).schema, CHECKPOINT_SCHEMA);
  });

  it('rejects a checkpoint for different bytes or inconsistent progress', async () => {
    const directory = temporaryDirectory('basemap-bad-state');
    const statePath = join(directory, 'state.json');
    const identity = { filename: 'a.pmtiles', bytes: 1, sha256: 'a'.repeat(64) };
    writeFileSync(
      statePath,
      JSON.stringify({
        schema: CHECKPOINT_SCHEMA,
        archive: identity,
        nextEntry: 2,
        decodedEntries: 1,
        decodedFeatures: 1,
        geometryParts: 1,
        layerFeatures: {},
        complete: false,
      }),
    );
    const reader = { header: { numTileEntries: 2 }, *entries() {} };
    await assert.rejects(
      exhaustiveVerify(reader, { archiveIdentity: identity, statePath }),
      /checkpoint does not match/,
    );
  });

  it('rejects forged completion, counter drift, unknown layers, and negative statistics', async () => {
    const directory = temporaryDirectory('basemap-adversarial-state');
    const statePath = join(directory, 'state.json');
    const identity = { filename: 'a.pmtiles', bytes: 1, sha256: 'a'.repeat(64) };
    const reader = { header: { numTileEntries: 2 }, *entries() {} };
    const base = {
      schema: CHECKPOINT_SCHEMA,
      archive: identity,
      nextEntry: 1,
      decodedEntries: 1,
      decodedFeatures: 1,
      geometryParts: 1,
      layerFeatures: { roads: 1 },
      complete: false,
    };
    for (const changed of [
      { ...base, complete: true },
      { ...base, decodedFeatures: 2 },
      { ...base, geometryParts: -1 },
      { ...base, layerFeatures: { roads: 1, pois: 0 } },
      { ...base, unexpected: true },
    ]) {
      writeFileSync(statePath, JSON.stringify(changed));
      await assert.rejects(
        exhaustiveVerify(reader, { archiveIdentity: identity, statePath }),
        /checkpoint (?:does not match|completion marker is inconsistent)/,
      );
    }
  });

  it('binds a publishable receipt to exact archive bytes and refuses tampering', async () => {
    const directory = temporaryDirectory('basemap-receipt');
    const archive = join(directory, OUTPUT_NAMES.archive);
    const body = Buffer.from('tiny archive fixture');
    writeFileSync(archive, body);
    const identity = {
      filename: OUTPUT_NAMES.archive,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
    const receipt = validReceipt(identity);
    assert.doesNotThrow(() => assertReceiptShape(receipt, identity));
    writeFileSync(`${archive}.receipt.json`, `${canonicalJson(receipt, 2)}\n`);
    assert.equal((await verifiedReceiptForPublish(archive)).publish.suffix, 'full-us');

    writeFileSync(archive, 'changed');
    await assert.rejects(verifiedReceiptForPublish(archive), /archive identity does not match/);
    assert.throws(
      () => assertReceiptShape({ ...receipt, commands: [] }, identity),
      /command plan does not match/,
    );
    assert.throws(
      () =>
        assertReceiptShape(
          {
            ...receipt,
            archive: {
              ...receipt.archive,
              coverage: {
                ...receipt.archive.coverage,
                counties: {
                  ...receipt.archive.coverage.counties,
                  matchesSha256: 'not-a-digest',
                },
              },
            },
          },
          identity,
        ),
      /receipt is incomplete/,
    );
    assert.throws(
      () =>
        assertReceiptShape(
          { ...receipt, source: { ...SOURCE, bytes: SOURCE.bytes + 1 } },
          identity,
        ),
      /receipt is incomplete/,
    );
    assert.throws(
      () =>
        assertReceiptShape(
          { ...receipt, tools: { ...receipt.tools, unexpectedTool: { sha256: 'a'.repeat(64) } } },
          identity,
        ),
      /receipt tools do not match/,
    );
    assert.throws(
      () =>
        assertReceiptShape(
          {
            ...receipt,
            tools: {
              ...receipt.tools,
              pmtiles: { ...receipt.tools.pmtiles, unexpected: true },
            },
          },
          identity,
        ),
      /receipt tools do not match/,
    );
    assert.throws(
      () =>
        assertReceiptShape(
          {
            ...receipt,
            archive: {
              ...receipt.archive,
              header: { ...receipt.archive.header, unexpected: true },
            },
          },
          identity,
        ),
      /receipt header has missing or unknown fields/,
    );
    assert.throws(
      () =>
        assertReceiptShape(
          {
            ...receipt,
            archive: {
              ...receipt.archive,
              header: { ...receipt.archive.header, maxLon: 181 },
            },
          },
          identity,
        ),
      /receipt is incomplete/,
    );
  });

  it('canonicalizes receipt objects independently of insertion order', () => {
    assert.equal(
      canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
      canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
    );
  });
});
