import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';

import { attestCameraContinuity } from './attest-camera-continuity.mjs';
import { buildCompleteApprovedBaseline } from './camera-capture-test-helpers.mjs';
import {
  LEASE_KEY,
  LEASE_SCHEMA,
  POINTER_KEY,
  POINTER_SCHEMA,
  jsonBytes,
  parsePointerBytes,
  slotDataPrefix,
  slotManifestKey,
} from './camera-generation.mjs';
import {
  MemoryR2,
  approvedCameraSourceFixture,
  fixtureGeneration,
  makeCameraFixture,
  seedGeneration,
  setFixtureBasePointer,
} from './camera-generation-test-helpers.mjs';
import {
  buildPredecessorEvidence,
  captureLegacyFlatRoot,
  predecessorIdentity,
} from './camera-predecessor.mjs';
import { sourceHandoff } from './fetch-cameras-deflock.mjs';
import { ATTRIBUTION, LICENCE, LICENCE_URL, TILE_ZOOM, latLonToTile } from './fetch-cameras.mjs';
import {
  LEASE_MILLISECONDS,
  WRITE_DEADLINE_MILLISECONDS,
  assertGenerationPredecessorMatchesManifest,
  assertPublicationContinuity,
  parseArguments,
  publishGeneration,
} from './publish-cameras.mjs';
import { replayDiffUrl, replayStateUrl } from './camera-replay.mjs';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const silent = () => {};

function currentPointer(slot, generation, previous = null) {
  return {
    schema: POINTER_SCHEMA,
    slot,
    generation: generation.manifest.generation,
    manifestSha256: generation.manifestSha256,
    previous,
    updatedAt: '2026-09-01T11:00:00.000Z',
  };
}

function takeOverLease(store) {
  store.set(
    LEASE_KEY,
    jsonBytes({
      schema: LEASE_SCHEMA,
      owner: 'successor',
      acquiredAt: '2026-09-01T12:00:01.000Z',
      expiresAt: '2026-09-01T15:00:01.000Z',
    }),
  );
}

function leaseWrites(r2) {
  return r2.events.filter((event) => event.type === 'PutObjectCommand' && event.key === LEASE_KEY);
}

function assertLeaseRetained(r2, now = NOW) {
  const writes = leaseWrites(r2);
  assert.equal(writes.length, 1, 'an uncertain writer must not release its lease early');
  const lease = JSON.parse(r2.get(LEASE_KEY).toString('utf8'));
  assert.ok(new Date(lease.expiresAt) > now, 'the retained lease must remain live');
}

function forgeEqualCountPredecessorIds(evidence) {
  const forged = structuredClone(evidence);
  forged.liveIds = forged.liveIds.slice(0, -1).concat('osm:999999999999').sort();
  forged.liveIdsSha256 = createHash('sha256')
    .update(Buffer.from(JSON.stringify(forged.liveIds)))
    .digest('hex');
  return forged;
}

function validLegacyFlatEntries() {
  const cameras = Array.from({ length: 120_000 }, (_, index) => ({
    id: `osm:${String(1_000_000_000 + index)}`,
    lat: 34,
    lon: -118,
  }));
  const populated = latLonToTile(34, -118, TILE_ZOOM);
  const populatedKey = `${String(TILE_ZOOM)}/${String(populated.x)}/${String(populated.y)}.json`;
  const entries = [
    {
      key: 'index.json',
      body: jsonBytes({
        zoom: TILE_ZOOM,
        upstream: '2026-09-01T10:00:00.000Z',
        attribution: ATTRIBUTION,
        licence: LICENCE,
        cameras: cameras.length,
        tiles: 4_000,
      }),
    },
    {
      key: 'overview.json',
      body: jsonBytes({
        upstream: '2026-09-01T10:00:00.000Z',
        attribution: ATTRIBUTION,
        licence: LICENCE,
        cameras: cameras.length,
        coords: [],
      }),
    },
    {
      key: 'tombstones.json',
      body: jsonBytes({
        generatedAt: '2026-09-01T10:00:00.000Z',
        upstream: '2026-09-01T10:00:00.000Z',
        tombstones: [],
      }),
    },
    {
      key: populatedKey,
      body: jsonBytes({
        z: TILE_ZOOM,
        x: populated.x,
        y: populated.y,
        attribution: ATTRIBUTION,
        licence: LICENCE,
        cameras,
      }),
    },
  ];
  const tileKeys = new Set([populatedKey]);
  outer: for (let x = 0; x < 2 ** TILE_ZOOM; x += 1) {
    for (let y = 0; y < 2 ** TILE_ZOOM; y += 1) {
      if (tileKeys.size >= 4_000) break outer;
      const key = `${String(TILE_ZOOM)}/${String(x)}/${String(y)}.json`;
      if (tileKeys.has(key)) continue;
      tileKeys.add(key);
      entries.push({
        key,
        body: jsonBytes({
          z: TILE_ZOOM,
          x,
          y,
          attribution: ATTRIBUTION,
          licence: LICENCE,
          cameras: [],
        }),
      });
    }
  }
  return entries;
}

async function approvedBootstrapFixture(root, mode, entries = []) {
  const predecessor = buildPredecessorEvidence({
    mode,
    entries,
    deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
    capturedAt: '2026-09-01T10:06:00.000Z',
  });
  const predecessorBytes = jsonBytes(predecessor);
  const approved = approvedCameraSourceFixture((receipt) => {
    receipt.releaseInputs.predecessor = predecessorIdentity(predecessorBytes, predecessor);
  });
  const fixture = await makeCameraFixture(root, {
    versionsKnown: true,
    osmVersion: 1,
    cameraSource: approved.marker,
    baseUpstream: approved.minimumOsmBase,
  });
  return {
    fixture,
    predecessor,
    predecessorBytes,
    approved,
    publishOptions: {
      bootstrap: true,
      accountId: 'account',
      predecessorBytes,
      validation: {
        minTiles: 1,
        minCameras: 1,
        trustedReviewBytes: approved.trustedReviewBytes,
      },
    },
  };
}

async function runPublish(r2, fixture, options = {}) {
  const validation = {
    minTiles: 1,
    minCameras: 1,
    continuityVerifier: async () => null,
    ...(options.validation ?? {}),
  };
  const { validation: _validation, ...rest } = options;
  return publishGeneration({
    client: r2,
    bucket: 'bucket',
    archive: fixture.archive,
    stateFile: fixture.stateFile,
    now: () => NOW,
    owner: 'test-publisher',
    log: silent,
    warn: silent,
    validation,
    ...rest,
  });
}

describe('atomic camera publication', () => {
  it('uses the real verifier for empty, legacy-flat, false-to-true, and descendant publication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-real-continuity-'));
    try {
      const approved = await buildCompleteApprovedBaseline(join(root, 'baseline'));
      const approvedCandidate = async (name, predecessor, predecessorBytes, basePointer = null) => {
        const candidateRoot = join(root, name);
        const target = join(candidateRoot, 'cameras');
        const stateFile = join(candidateRoot, 'camera-sync-state.json');
        await cp(approved.target, target, { recursive: true });
        const review = structuredClone(approved.review);
        review.releaseInputs.predecessor = predecessorIdentity(predecessorBytes, predecessor);
        const trustedReviewBytes = jsonBytes(review);
        const marker = sourceHandoff({
          source: review.expectedSource,
          review,
          reviewSha256: createHash('sha256').update(trustedReviewBytes).digest('hex'),
          transformation: review.expectedTransformation,
        });
        const indexPath = join(target, 'index.json');
        const index = JSON.parse(await readFile(indexPath, 'utf8'));
        index.cameraSource = marker;
        await writeFile(indexPath, jsonBytes(index));
        const state = JSON.parse(await readFile(approved.stateFile, 'utf8'));
        if (basePointer === null) delete state.basePointer;
        else state.basePointer = basePointer;
        await writeFile(stateFile, jsonBytes(state));
        await rm(join(target, 'continuity.json'));
        await attestCameraContinuity(
          {
            target,
            stateFile,
            sourceReview: 'unused-by-injected-review',
            captureDir: approved.captureDir,
            baselineTombstones: null,
          },
          {
            trustedReviewBytes,
            geofenceBytes: approved.geofenceBytes,
            capture: approved.capture,
            baselineTombstoneBytes: approved.baselineTombstoneBytes,
            validation: { minTiles: 1, minCameras: 1 },
          },
        );
        return {
          target,
          stateFile,
          trustedReviewBytes,
          validation: {
            minTiles: 1,
            minCameras: 1,
            trustedReviewBytes,
            captureDir: approved.captureDir,
            baselineTombstoneBytes: approved.baselineTombstoneBytes,
          },
        };
      };
      const r2 = new MemoryR2();
      const validation = {
        minTiles: 1,
        minCameras: 1,
        trustedReviewBytes: approved.trustedReviewBytes,
        captureDir: approved.captureDir,
        baselineTombstoneBytes: approved.baselineTombstoneBytes,
      };
      await publishGeneration({
        client: r2,
        bucket: 'bucket',
        archive: approved.target,
        stateFile: approved.stateFile,
        bootstrap: true,
        now: () => new Date('2026-09-02T00:00:00.000Z'),
        owner: 'real-verifier-bootstrap',
        log: silent,
        warn: silent,
        accountId: 'account',
        predecessorBytes: approved.predecessorBytes,
        validation,
      });
      const firstPointer = parsePointerBytes(r2.get(POINTER_KEY));

      const nextRoot = join(root, 'next');
      const nextTarget = join(nextRoot, 'cameras');
      const nextState = join(nextRoot, 'camera-sync-state.json');
      await cp(approved.target, nextTarget, { recursive: true });
      const nextTimestamp = '2026-09-01T22:00:00.000Z';
      for (const name of ['index.json', 'tombstones.json']) {
        const path = join(nextTarget, name);
        const document = JSON.parse(await readFile(path, 'utf8'));
        document.generatedAt = nextTimestamp;
        document.upstream = nextTimestamp;
        await writeFile(path, jsonBytes(document));
      }
      await writeFile(
        nextState,
        jsonBytes({
          stream: 'hour',
          lastAppliedSeq: 12,
          lastAppliedTimestamp: nextTimestamp,
          versionsKnown: true,
          lastRun: nextTimestamp,
          basePointer: firstPointer,
        }),
      );
      const stateBytes = Buffer.from('sequenceNumber=12\ntimestamp=2026-09-01T22\\:00\\:00Z\n');
      const diffBytes = gzipSync(
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<osmChange version="0.6" generator="fixture"></osmChange>',
        ),
        { mtime: 0 },
      );
      const requested = [];
      const continuityFetch = async (url) => {
        requested.push(url);
        const bytes =
          url === replayStateUrl(12) ? stateBytes : url === replayDiffUrl(12) ? diffBytes : null;
        if (bytes === null) throw new Error(`unexpected continuity URL ${url}`);
        return {
          ok: true,
          status: 200,
          url,
          headers: new Headers({ 'content-length': String(bytes.length) }),
          arrayBuffer: async () => bytes,
        };
      };
      await attestCameraContinuity(
        {
          target: nextTarget,
          stateFile: nextState,
          sourceReview: 'unused-by-injected-review',
          captureDir: approved.captureDir,
          baselineTombstones: null,
        },
        {
          trustedReviewBytes: approved.trustedReviewBytes,
          geofenceBytes: approved.geofenceBytes,
          capture: approved.capture,
          baselineTombstoneBytes: approved.baselineTombstoneBytes,
          validation: { minTiles: 1, minCameras: 1 },
          fetchImpl: continuityFetch,
        },
      );
      requested.length = 0;
      await publishGeneration({
        client: r2,
        bucket: 'bucket',
        archive: nextTarget,
        stateFile: nextState,
        now: () => new Date('2026-09-02T00:05:00.000Z'),
        owner: 'real-verifier-transition',
        log: silent,
        warn: silent,
        accountId: 'account',
        predecessorBytes: approved.predecessorBytes,
        validation: { ...validation, continuityFetch },
      });
      const secondPointer = parsePointerBytes(r2.get(POINTER_KEY));
      assert.notEqual(secondPointer.generation, firstPointer.generation);
      assert.equal(secondPointer.previous.generation, firstPointer.generation);
      assert.deepEqual(requested, [replayStateUrl(12), replayDiffUrl(12)]);

      const approvedGeneration = await fixtureGeneration(
        { archive: approved.target, stateFile: approved.stateFile },
        '2026-09-01T21:01:00.000Z',
        validation,
      );
      const legacyEntries = approvedGeneration.local.entries.map(({ key, body }) => ({
        key,
        body: Buffer.from(body),
      }));
      const tileKeys = new Set(
        legacyEntries
          .filter(({ key }) => key.startsWith(`${String(TILE_ZOOM)}/`))
          .map(({ key }) => key),
      );
      outer: for (let x = 0; x < 2 ** TILE_ZOOM; x += 1) {
        for (let y = 0; y < 2 ** TILE_ZOOM; y += 1) {
          if (tileKeys.size >= 4_000) break outer;
          const key = `${String(TILE_ZOOM)}/${String(x)}/${String(y)}.json`;
          if (tileKeys.has(key)) continue;
          tileKeys.add(key);
          legacyEntries.push({
            key,
            body: jsonBytes({
              z: TILE_ZOOM,
              x,
              y,
              attribution: ATTRIBUTION,
              licence: LICENCE,
              licenceUrl: LICENCE_URL,
              cameras: [],
            }),
          });
        }
      }
      const legacyIndexEntry = legacyEntries.find(({ key }) => key === 'index.json');
      const legacyIndex = JSON.parse(legacyIndexEntry.body.toString('utf8'));
      legacyIndex.tiles = tileKeys.size;
      legacyIndexEntry.body = jsonBytes(legacyIndex);
      const legacyR2 = new MemoryR2();
      for (const entry of legacyEntries) legacyR2.set(entry.key, entry.body);
      const { evidence: legacyPredecessor } = await captureLegacyFlatRoot({
        client: legacyR2,
        accountId: 'account',
        bucket: 'bucket',
        capturedAt: '2026-09-01T20:59:00.000Z',
      });
      const forgedLegacyPredecessor = forgeEqualCountPredecessorIds(legacyPredecessor);
      const forgedLegacyBytes = jsonBytes(forgedLegacyPredecessor);
      const forgedLegacyApproved = approvedCameraSourceFixture((receipt) => {
        receipt.releaseInputs.predecessor = predecessorIdentity(
          forgedLegacyBytes,
          forgedLegacyPredecessor,
        );
      });
      const forgedLegacyCandidate = await makeCameraFixture(join(root, 'legacy-forged'), {
        versionsKnown: true,
        osmVersion: 1,
        cameraSource: forgedLegacyApproved.marker,
        baseUpstream: forgedLegacyApproved.minimumOsmBase,
      });
      await assert.rejects(
        runPublish(legacyR2, forgedLegacyCandidate, {
          bootstrap: true,
          accountId: 'account',
          predecessorBytes: forgedLegacyBytes,
          validation: {
            minTiles: 1,
            minCameras: 1,
            trustedReviewBytes: forgedLegacyApproved.trustedReviewBytes,
          },
        }),
        /predecessor live ids do not match the exact remote archive/,
      );
      assert.equal(
        [...legacyR2.objects.keys()].some((key) => key.startsWith('__camera/slots/')),
        false,
      );
      const legacyPredecessorBytes = jsonBytes(legacyPredecessor);
      const legacyCandidate = await approvedCandidate(
        'legacy-flat',
        legacyPredecessor,
        legacyPredecessorBytes,
      );
      await publishGeneration({
        client: legacyR2,
        bucket: 'bucket',
        archive: legacyCandidate.target,
        stateFile: legacyCandidate.stateFile,
        bootstrap: true,
        now: () => new Date('2026-09-02T00:10:00.000Z'),
        owner: 'real-verifier-legacy-flat',
        log: silent,
        warn: silent,
        accountId: 'account',
        predecessorBytes: legacyPredecessorBytes,
        validation: legacyCandidate.validation,
      });
      assert.ok(legacyR2.get(POINTER_KEY));

      const legacyGenerationRoot = join(root, 'legacy-generation');
      const legacyGenerationFixture = await makeCameraFixture(legacyGenerationRoot);
      const legacyGeneration = await fixtureGeneration(legacyGenerationFixture);
      const legacyPointer = currentPointer('a', legacyGeneration);
      const generationPredecessor = buildPredecessorEvidence({
        mode: 'generation',
        entries: legacyGeneration.local.entries,
        deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
        pointer: legacyPointer,
        versionsKnown: false,
        capturedAt: '2026-09-01T20:59:00.000Z',
      });
      const generationPredecessorBytes = jsonBytes(generationPredecessor);
      const generationCandidate = await approvedCandidate(
        'false-to-true',
        generationPredecessor,
        generationPredecessorBytes,
        legacyPointer,
      );
      const generationR2 = new MemoryR2();
      seedGeneration(generationR2, 'a', legacyGeneration);
      generationR2.set(POINTER_KEY, jsonBytes(legacyPointer));
      await publishGeneration({
        client: generationR2,
        bucket: 'bucket',
        archive: generationCandidate.target,
        stateFile: generationCandidate.stateFile,
        now: () => new Date('2026-09-02T00:15:00.000Z'),
        owner: 'real-verifier-false-to-true',
        log: silent,
        warn: silent,
        accountId: 'account',
        predecessorBytes: generationPredecessorBytes,
        validation: generationCandidate.validation,
      });
      const cutoverPointer = parsePointerBytes(generationR2.get(POINTER_KEY));
      assert.equal(cutoverPointer.previous.generation, legacyPointer.generation);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs independent semantic continuity verification before candidate mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-continuity-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      const r2 = new MemoryR2();
      await assert.rejects(
        runPublish(r2, fixture, {
          ...publishOptions,
          validation: {
            ...publishOptions.validation,
            continuityVerifier: async () => {
              throw new Error('fabricated semantic generation');
            },
          },
        }),
        /fabricated semantic generation/,
      );
      assert.equal(
        [...r2.objects.keys()].some((key) => key.startsWith('__camera/slots/')),
        false,
      );
      assert.equal(r2.get(POINTER_KEY), undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never downgrades version proof or changes the approved baseline identity', () => {
    const current = {
      replication: {
        lastAppliedSeq: 10,
        lastAppliedTimestamp: '2026-09-01T10:00:00.000Z',
        versionsKnown: true,
      },
      archive: {
        source: 'approved direct capture',
        baseUpstream: '2026-09-01T09:30:00.000Z',
      },
    };
    const candidate = {
      replication: {
        lastAppliedSeq: 11,
        lastAppliedTimestamp: '2026-09-01T11:00:00.000Z',
        versionsKnown: true,
      },
      archive: { ...current.archive },
    };
    assert.equal(assertPublicationContinuity(candidate, current), candidate);
    assert.throws(
      () =>
        assertPublicationContinuity(
          { ...candidate, replication: { ...candidate.replication, versionsKnown: false } },
          current,
        ),
      /downgrade versionsKnown/,
    );
    assert.throws(
      () =>
        assertPublicationContinuity(
          { ...candidate, archive: { ...candidate.archive, source: 'forged source' } },
          current,
        ),
      /baseline source/,
    );
    assert.throws(
      () =>
        assertPublicationContinuity(
          {
            ...candidate,
            archive: { ...candidate.archive, baseUpstream: '2026-09-01T09:00:00.000Z' },
          },
          current,
        ),
      /baseline watermark/,
    );
    const noBase = structuredClone(candidate);
    delete noBase.archive.baseUpstream;
    assert.throws(() => assertPublicationContinuity(noBase, current), /baseline watermark/);

    const legacyCurrent = {
      replication: { ...current.replication, versionsKnown: false },
      archive: { source: 'legacy unversioned source' },
    };
    assert.equal(
      assertPublicationContinuity(candidate, legacyCurrent),
      candidate,
      'the deep-validated false-to-true generation is the one atomic baseline cutover',
    );
    assert.throws(
      () =>
        assertPublicationContinuity(
          {
            ...candidate,
            replication: { ...candidate.replication, versionsKnown: false },
          },
          legacyCurrent,
        ),
      /baseline source/,
    );
  });

  it('cross-binds generation predecessor evidence to every immutable manifest identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-predecessor-manifest-'));
    try {
      const fixture = await makeCameraFixture(root);
      const generation = await fixtureGeneration(fixture);
      const pointer = currentPointer('a', generation);
      const evidence = buildPredecessorEvidence({
        mode: 'generation',
        entries: generation.local.entries,
        deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
        pointer,
        versionsKnown: false,
        capturedAt: '2026-09-01T10:06:00.000Z',
      });
      assert.equal(
        assertGenerationPredecessorMatchesManifest(evidence, generation.manifest),
        evidence,
      );
      const mutations = [
        (value) => {
          value.source.versionsKnown = true;
        },
        (value) => {
          value.source.indexSha256 = 'a'.repeat(64);
        },
        (value) => {
          value.source.tombstones.sha256 = 'b'.repeat(64);
        },
        (value) => {
          value.source.inventory.sha256 = 'c'.repeat(64);
        },
        (value) => {
          value.liveCount += 1;
        },
      ];
      for (const mutate of mutations) {
        const changed = structuredClone(evidence);
        mutate(changed);
        assert.throws(
          () => assertGenerationPredecessorMatchesManifest(changed, generation.manifest),
          /does not match the exact current generation manifest/,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires explicit bootstrap and conditionally creates the pointer last', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-bootstrap-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      const r2 = new MemoryR2();
      await assert.rejects(
        runPublish(r2, fixture, { ...publishOptions, bootstrap: false }),
        /use --bootstrap/,
      );
      assert.equal(r2.get(POINTER_KEY), undefined);

      r2.events.length = 0;
      const result = await runPublish(r2, fixture, publishOptions);
      assert.equal(result.slot, 'a');
      const pointer = parsePointerBytes(r2.get(POINTER_KEY));
      assert.equal(pointer.slot, 'a');
      assert.equal(pointer.previous, null);

      const mutations = r2.events.filter(
        (event) =>
          ['PutObjectCommand', 'DeleteObjectCommand'].includes(event.type) &&
          event.key !== LEASE_KEY,
      );
      const pointerWrite = mutations.findIndex(
        (event) => event.type === 'PutObjectCommand' && event.key === POINTER_KEY,
      );
      const manifestWrite = mutations.findIndex(
        (event) => event.type === 'PutObjectCommand' && event.key === slotManifestKey('a'),
      );
      assert.ok(pointerWrite > manifestWrite);
      assert.equal(pointerWrite, mutations.length - 1);
      assert.equal(mutations[pointerWrite].input.IfNoneMatch, '*');
      assert.ok(
        [...r2.objects.keys()].some((key) => key.startsWith(slotDataPrefix('a'))),
        'bootstrap must seed the selected slot data',
      );
      const leaseMutations = leaseWrites(r2);
      const acquired = JSON.parse(leaseMutations[0].input.Body.toString('utf8'));
      assert.equal(
        new Date(acquired.expiresAt) - new Date(acquired.acquiredAt),
        LEASE_MILLISECONDS,
      );
      assert.ok(LEASE_MILLISECONDS > 120 * 60 * 1_000);
      assert.ok(WRITE_DEADLINE_MILLISECONDS < LEASE_MILLISECONDS);
      assert.ok(
        leaseMutations.some((event) => event.input.IfMatch !== undefined),
        'lease release must be a conditional replacement, not an unsafe delete',
      );
      assert.equal(
        r2.events.filter(
          (event) =>
            event.type === 'GetObjectCommand' &&
            event.key === LEASE_KEY &&
            event.input.IfMatch !== undefined,
        ).length,
        3,
        'candidate, manifest, and pointer phases must each revalidate the exact lease ETag',
      );
      assert.ok(
        r2.events.every((event) => event.requestOptions.abortSignal instanceof AbortSignal),
        'every R2 request must carry a deadline AbortSignal',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('binds the one-time false-to-true cutover to the exact current generation pointer', async () => {
    const currentRoot = await mkdtemp(join(tmpdir(), 'camera-publish-cutover-current-'));
    const nextRoot = await mkdtemp(join(tmpdir(), 'camera-publish-cutover-next-'));
    try {
      const currentFixture = await makeCameraFixture(currentRoot);
      const currentGeneration = await fixtureGeneration(currentFixture);
      const pointer = currentPointer('a', currentGeneration);
      const mismatchedPointer = { ...pointer, generation: '9'.repeat(64) };
      const predecessor = buildPredecessorEvidence({
        mode: 'generation',
        entries: currentGeneration.local.entries,
        deployment: { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' },
        pointer: mismatchedPointer,
        versionsKnown: false,
        capturedAt: '2026-09-01T10:06:00.000Z',
      });
      const predecessorBytes = jsonBytes(predecessor);
      const approved = approvedCameraSourceFixture((receipt) => {
        receipt.releaseInputs.predecessor = predecessorIdentity(predecessorBytes, predecessor);
      });
      const next = await makeCameraFixture(nextRoot, {
        id: 'osm:2',
        sequence: 11,
        timestamp: '2026-09-01T11:00:00.000Z',
        versionsKnown: true,
        osmVersion: 1,
        cameraSource: approved.marker,
        baseUpstream: approved.minimumOsmBase,
        basePointer: pointer,
      });
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', currentGeneration);
      r2.set(POINTER_KEY, jsonBytes(pointer));
      await assert.rejects(
        runPublish(r2, next, {
          accountId: 'account',
          predecessorBytes,
          validation: {
            minTiles: 1,
            minCameras: 1,
            trustedReviewBytes: approved.trustedReviewBytes,
          },
        }),
        /does not bind the exact current generation/,
      );
      assert.equal(
        r2.events.filter((event) => event.key?.startsWith('__camera/slots/b/')).length,
        0,
      );

      const forgedPredecessor = forgeEqualCountPredecessorIds(
        buildPredecessorEvidence({
          mode: 'generation',
          entries: currentGeneration.local.entries,
          deployment: {
            provider: 'cloudflare-r2',
            accountId: 'account',
            bucket: 'bucket',
          },
          pointer,
          versionsKnown: false,
          capturedAt: '2026-09-01T10:06:00.000Z',
        }),
      );
      const forgedBytes = jsonBytes(forgedPredecessor);
      const forgedApproved = approvedCameraSourceFixture((receipt) => {
        receipt.releaseInputs.predecessor = predecessorIdentity(forgedBytes, forgedPredecessor);
      });
      const forgedNext = await makeCameraFixture(join(nextRoot, 'forged-live-ids'), {
        id: 'osm:2',
        sequence: 11,
        timestamp: '2026-09-01T11:00:00.000Z',
        versionsKnown: true,
        osmVersion: 1,
        cameraSource: forgedApproved.marker,
        baseUpstream: forgedApproved.minimumOsmBase,
        basePointer: pointer,
      });
      r2.events.length = 0;
      await assert.rejects(
        runPublish(r2, forgedNext, {
          accountId: 'account',
          predecessorBytes: forgedBytes,
          validation: {
            minTiles: 1,
            minCameras: 1,
            trustedReviewBytes: forgedApproved.trustedReviewBytes,
          },
        }),
        /predecessor live ids do not match the exact remote archive/,
      );
      assert.equal(
        r2.events.filter((event) => event.key?.startsWith('__camera/slots/b/')).length,
        0,
      );
    } finally {
      await rm(currentRoot, { recursive: true, force: true });
      await rm(nextRoot, { recursive: true, force: true });
    }
  });

  it('binds approved bootstrap to the exact R2 deployment and empty predecessor state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-approved-empty-'));
    try {
      const { fixture, predecessorBytes, approved } = await approvedBootstrapFixture(
        root,
        'empty-r2',
      );
      const options = {
        bootstrap: true,
        accountId: 'account',
        predecessorBytes,
        validation: {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        },
      };
      const wrongDeployment = new MemoryR2();
      await assert.rejects(
        runPublish(wrongDeployment, fixture, { ...options, accountId: 'other' }),
        /different R2 deployment/,
      );
      assert.equal(wrongDeployment.events.length, 0);

      const nonempty = new MemoryR2();
      nonempty.set('index.json', '{}');
      await assert.rejects(
        runPublish(nonempty, fixture, options),
        /empty-R2 predecessor no longer matches/,
      );
      assert.equal(nonempty.get(POINTER_KEY), undefined);

      const empty = new MemoryR2();
      await assert.doesNotReject(runPublish(empty, fixture, options));
      assert.ok(empty.get(POINTER_KEY));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('checks a captured legacy flat inventory before writes and again before activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-approved-legacy-'));
    try {
      const legacyEntries = validLegacyFlatEntries();
      const { fixture, predecessorBytes, approved } = await approvedBootstrapFixture(
        root,
        'legacy-flat-root',
        legacyEntries,
      );
      let changed = false;
      const r2 = new MemoryR2((event, store) => {
        if (
          !changed &&
          event.type === 'PutObjectCommand' &&
          event.key?.endsWith('/manifest.json')
        ) {
          changed = true;
          const changedTile = legacyEntries.find(({ key }) => key.startsWith('11/'));
          store.set(changedTile.key, '{"legacy":"changed"}');
        }
      });
      for (const entry of legacyEntries) r2.set(entry.key, entry.body);
      await assert.rejects(
        runPublish(r2, fixture, {
          bootstrap: true,
          accountId: 'account',
          predecessorBytes,
          validation: {
            minTiles: 1,
            minCameras: 1,
            trustedReviewBytes: approved.trustedReviewBytes,
          },
        }),
        /legacy flat-root inventory changed/,
      );
      assert.equal(r2.get(POINTER_KEY), undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses bootstrap when a pointer exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-bootstrap-guard-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      const generation = await fixtureGeneration(fixture, undefined, publishOptions.validation);
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', generation);
      r2.set(POINTER_KEY, jsonBytes(currentPointer('a', generation)));
      await assert.rejects(runPublish(r2, fixture, publishOptions), /requires.*absent/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to publish through another owner's live lease", async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-lease-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      const r2 = new MemoryR2();
      r2.set(
        LEASE_KEY,
        jsonBytes({
          schema: LEASE_SCHEMA,
          owner: 'other-publisher',
          acquiredAt: '2026-09-01T11:50:00.000Z',
          expiresAt: '2026-09-01T12:35:00.000Z',
        }),
      );
      await assert.rejects(runPublish(r2, fixture, publishOptions), /leased by other-publisher/);
      assert.equal(r2.get(POINTER_KEY), undefined);
      assert.equal(r2.events.filter((event) => event.key?.startsWith('__camera/slots/')).length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires a valid exact hydrated base pointer for every normal publication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-base-current-'));
    const nextRoot = await mkdtemp(join(tmpdir(), 'camera-publish-base-next-'));
    const malformedRoot = await mkdtemp(join(tmpdir(), 'camera-publish-base-malformed-'));
    try {
      const fixture = await makeCameraFixture(root);
      const current = await fixtureGeneration(fixture);
      const next = await makeCameraFixture(nextRoot, {
        id: 'osm:2',
        sequence: 11,
        timestamp: '2026-09-01T11:00:00.000Z',
      });
      const malformed = await makeCameraFixture(malformedRoot, {
        id: 'osm:3',
        sequence: 11,
        timestamp: '2026-09-01T11:00:00.000Z',
      });
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', current);
      r2.set(POINTER_KEY, jsonBytes(currentPointer('a', current)));
      r2.events.length = 0;

      await assert.rejects(runPublish(r2, next), /requires the exact hydrated basePointer/);
      assert.equal(r2.events.filter((event) => event.key?.startsWith('__camera/slots/')).length, 0);

      await setFixtureBasePointer(malformed, { slot: 'a' });
      r2.events.length = 0;
      await assert.rejects(runPublish(r2, malformed), /camera pointer is missing/);
      assert.equal(r2.events.length, 0, 'malformed local runtime state must fail before R2 access');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(nextRoot, { recursive: true, force: true });
      await rm(malformedRoot, { recursive: true, force: true });
    }
  });

  it('refuses an intervening current pointer before any candidate mutation', async () => {
    const baseRoot = await mkdtemp(join(tmpdir(), 'camera-publish-base-old-'));
    const interveningRoot = await mkdtemp(join(tmpdir(), 'camera-publish-base-intervening-'));
    const localRoot = await mkdtemp(join(tmpdir(), 'camera-publish-base-local-'));
    try {
      const baseFixture = await makeCameraFixture(baseRoot);
      const baseGeneration = await fixtureGeneration(baseFixture);
      const basePointer = currentPointer('a', baseGeneration);
      const interveningFixture = await makeCameraFixture(interveningRoot, {
        id: 'osm:2',
        sequence: 11,
        timestamp: '2026-09-01T11:00:00.000Z',
      });
      const intervening = await fixtureGeneration(interveningFixture);
      const local = await makeCameraFixture(localRoot, {
        id: 'osm:3',
        sequence: 12,
        timestamp: '2026-09-01T12:00:00.000Z',
      });
      await setFixtureBasePointer(local, basePointer);

      const current = currentPointer('b', intervening, {
        slot: 'a',
        generation: baseGeneration.manifest.generation,
        manifestSha256: baseGeneration.manifestSha256,
      });
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', baseGeneration);
      seedGeneration(r2, 'b', intervening);
      r2.set(POINTER_KEY, jsonBytes(current));
      r2.events.length = 0;
      await assert.rejects(runPublish(r2, local), /pointer changed since hydration/);
      assert.equal(
        r2.events.filter(
          (event) =>
            event.key?.startsWith('__camera/slots/') &&
            ['PutObjectCommand', 'DeleteObjectCommand'].includes(event.type),
        ).length,
        0,
      );
    } finally {
      await rm(baseRoot, { recursive: true, force: true });
      await rm(interveningRoot, { recursive: true, force: true });
      await rm(localRoot, { recursive: true, force: true });
    }
  });

  it('cannot mutate a candidate after lease takeover before reconciliation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-takeover-candidate-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      let takeoverIndex = -1;
      const r2 = new MemoryR2((event, store) => {
        if (
          takeoverIndex === -1 &&
          event.type === 'GetObjectCommand' &&
          event.key === LEASE_KEY &&
          event.input.IfMatch !== undefined
        ) {
          takeOverLease(store);
          takeoverIndex = store.events.length - 1;
        }
      });
      await assert.rejects(
        runPublish(r2, fixture, publishOptions),
        /lease changed before candidate reconciliation/,
      );
      assert.ok(takeoverIndex >= 0);
      assert.equal(
        r2.events
          .slice(takeoverIndex + 1)
          .filter(
            (event) =>
              event.key?.startsWith('__camera/slots/') ||
              (event.type === 'PutObjectCommand' && event.key === POINTER_KEY),
          ).length,
        0,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cannot commit a manifest or pointer after takeover following data reconciliation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-takeover-manifest-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      let leaseChecks = 0;
      let takeoverIndex = -1;
      const r2 = new MemoryR2((event, store) => {
        if (
          event.type === 'GetObjectCommand' &&
          event.key === LEASE_KEY &&
          event.input.IfMatch !== undefined
        ) {
          leaseChecks += 1;
          if (leaseChecks === 2) {
            takeOverLease(store);
            takeoverIndex = store.events.length - 1;
          }
        }
      });
      await assert.rejects(
        runPublish(r2, fixture, publishOptions),
        /lease changed before manifest write/,
      );
      assert.ok(
        r2.events
          .slice(0, takeoverIndex)
          .some((event) => event.key?.startsWith(slotDataPrefix('a'))),
        'fixture must reach data reconciliation before the injected takeover',
      );
      assert.equal(
        r2.events
          .slice(takeoverIndex + 1)
          .filter(
            (event) =>
              event.key === slotManifestKey('a') ||
              event.key === POINTER_KEY ||
              (event.type !== 'GetObjectCommand' && event.key?.startsWith('__camera/slots/')),
          ).length,
        0,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cannot activate the pointer after takeover following manifest verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-takeover-pointer-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      let leaseChecks = 0;
      let takeoverIndex = -1;
      const r2 = new MemoryR2((event, store) => {
        if (
          event.type === 'GetObjectCommand' &&
          event.key === LEASE_KEY &&
          event.input.IfMatch !== undefined
        ) {
          leaseChecks += 1;
          if (leaseChecks === 3) {
            takeOverLease(store);
            takeoverIndex = store.events.length - 1;
          }
        }
      });
      await assert.rejects(
        runPublish(r2, fixture, publishOptions),
        /lease changed before pointer write/,
      );
      assert.ok(r2.get(slotManifestKey('a')), 'manifest must precede the injected takeover');
      assert.equal(r2.get(POINTER_KEY), undefined);
      assert.equal(
        r2.events
          .slice(takeoverIndex + 1)
          .filter((event) => event.type === 'PutObjectCommand' && event.key === POINTER_KEY).length,
        0,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hard-stops before lease expiry and cannot write a manifest or pointer afterward', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-deadline-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      let clock = NOW;
      let expiryIndex = -1;
      const r2 = new MemoryR2((event, store) => {
        if (
          expiryIndex === -1 &&
          event.type === 'ListObjectsV2Command' &&
          event.input.Prefix === slotDataPrefix('a')
        ) {
          clock = new Date(NOW.valueOf() + WRITE_DEADLINE_MILLISECONDS + 1);
          expiryIndex = store.events.length - 1;
        }
      });
      await assert.rejects(
        runPublish(r2, fixture, { ...publishOptions, now: () => clock }),
        /write deadline reached before manifest write/,
      );
      assert.ok(expiryIndex >= 0);
      assert.equal(
        r2.events
          .slice(expiryIndex + 1)
          .filter((event) => event.key === slotManifestKey('a') || event.key === POINTER_KEY)
          .length,
        0,
      );
      assertLeaseRetained(r2, clock);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains the live lease after an ambiguous candidate upload failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-ambiguous-candidate-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      let failed = false;
      const r2 = new MemoryR2((event, store) => {
        if (
          !failed &&
          event.type === 'PutObjectCommand' &&
          event.key?.startsWith(slotDataPrefix('a'))
        ) {
          failed = true;
          store.set(event.key, event.input.Body);
          throw new Error('socket closed after candidate upload');
        }
      });
      await assert.rejects(
        runPublish(r2, fixture, publishOptions),
        /socket closed after candidate upload/,
      );
      assert.equal(r2.get(POINTER_KEY), undefined);
      assertLeaseRetained(r2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains the live lease after an ambiguous pointer activation failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-ambiguous-pointer-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      const r2 = new MemoryR2((event, store) => {
        if (event.type === 'PutObjectCommand' && event.key === POINTER_KEY) {
          store.set(event.key, event.input.Body);
          throw new Error('socket closed after pointer upload');
        }
      });
      await assert.rejects(
        runPublish(r2, fixture, publishOptions),
        /socket closed after pointer upload/,
      );
      assert.ok(r2.get(POINTER_KEY), 'the ambiguous write fixture must commit the pointer');
      assertLeaseRetained(r2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves current and previous immutable while reconciling only the third slot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-slots-'));
    const nextRoot = await mkdtemp(join(tmpdir(), 'camera-publish-slots-next-'));
    try {
      const fixture = await makeCameraFixture(root);
      const current = await fixtureGeneration(fixture);
      const next = await makeCameraFixture(nextRoot, {
        id: 'osm:2',
        sequence: 11,
        timestamp: '2026-09-01T11:00:00.000Z',
      });
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', current);
      r2.set('__camera/slots/b/data/protected-sentinel', 'previous');
      r2.set('__camera/slots/c/data/extra.json', 'extra');
      const previous = {
        slot: 'b',
        generation: 'b'.repeat(64),
        manifestSha256: 'c'.repeat(64),
      };
      const basePointer = currentPointer('a', current, previous);
      r2.set(POINTER_KEY, jsonBytes(basePointer));
      await setFixtureBasePointer(next, basePointer);
      const protectedBefore = new Map(
        [...r2.objects].filter(([key]) => key.startsWith('__camera/slots/a/')),
      );
      const previousBefore = r2.get('__camera/slots/b/data/protected-sentinel');

      const result = await runPublish(r2, next);
      assert.equal(result.slot, 'c');
      assert.equal(r2.get('__camera/slots/c/data/extra.json'), undefined);
      assert.deepEqual(
        new Map([...r2.objects].filter(([key]) => key.startsWith('__camera/slots/a/'))),
        protectedBefore,
      );
      assert.deepEqual(r2.get('__camera/slots/b/data/protected-sentinel'), previousBefore);
      const pointer = parsePointerBytes(r2.get(POINTER_KEY));
      assert.equal(pointer.slot, 'c');
      assert.equal(pointer.previous.slot, 'a');
      const pointerPut = r2.events.findLast(
        (event) => event.type === 'PutObjectCommand' && event.key === POINTER_KEY,
      );
      assert.match(pointerPut.input.IfMatch, /^"[a-f\d]{32}"$/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(nextRoot, { recursive: true, force: true });
    }
  });

  it('does not activate a candidate when exact post-reconcile inventory gains an extra', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-extra-'));
    try {
      const { fixture, publishOptions } = await approvedBootstrapFixture(root, 'empty-r2');
      let candidateLists = 0;
      const r2 = new MemoryR2((event, store) => {
        if (event.type === 'ListObjectsV2Command' && event.input.Prefix === slotDataPrefix('a')) {
          candidateLists += 1;
          if (candidateLists === 1) store.set(`${slotDataPrefix('a')}unexpected.json`, 'bad');
        }
      });
      await assert.rejects(runPublish(r2, fixture, publishOptions), /extra or missing objects/);
      assert.equal(r2.get(POINTER_KEY), undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the old pointer active when its conditional final write fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-cas-old-'));
    const nextRoot = await mkdtemp(join(tmpdir(), 'camera-publish-cas-next-'));
    try {
      const fixture = await makeCameraFixture(root);
      const current = await fixtureGeneration(fixture);
      const next = await makeCameraFixture(nextRoot, {
        id: 'osm:2',
        sequence: 11,
        timestamp: '2026-09-01T11:00:00.000Z',
      });
      const r2 = new MemoryR2((event) => {
        if (event.type === 'PutObjectCommand' && event.key === POINTER_KEY) {
          const failure = new Error('PreconditionFailed');
          failure.name = 'PreconditionFailed';
          failure.$metadata = { httpStatusCode: 412 };
          throw failure;
        }
      });
      seedGeneration(r2, 'a', current);
      const basePointer = currentPointer('a', current);
      const oldPointer = jsonBytes(basePointer);
      r2.set(POINTER_KEY, oldPointer);
      await setFixtureBasePointer(next, basePointer);
      await assert.rejects(runPublish(r2, next), /pointer changed.*not activated/);
      assert.deepEqual(r2.get(POINTER_KEY), oldPointer);
      assert.ok(r2.get(slotManifestKey('b')), 'inactive candidate may remain fully committed');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(nextRoot, { recursive: true, force: true });
    }
  });

  it('does no slot or pointer writes for an already-current generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-publish-unchanged-'));
    try {
      const fixture = await makeCameraFixture(root);
      const current = await fixtureGeneration(fixture);
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', current);
      const basePointer = currentPointer('a', current);
      r2.set(POINTER_KEY, jsonBytes(basePointer));
      await setFixtureBasePointer(fixture, basePointer);
      r2.events.length = 0;
      const result = await runPublish(r2, fixture);
      assert.equal(result.unchanged, true);
      assert.equal(
        r2.events.filter(
          (event) =>
            event.type === 'PutObjectCommand' &&
            (event.key === POINTER_KEY || event.key.startsWith('__camera/slots/')),
        ).length,
        0,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('publisher CLI', () => {
  it('parses explicit target and state paths and rejects unknown arguments', () => {
    const parsed = parseArguments([
      '--bootstrap',
      '--target=tmp/cameras',
      '--state-file',
      'tmp/state.json',
    ]);
    assert.equal(parsed.bootstrap, true);
    assert.equal(parsed.archive, join(process.cwd(), 'tmp/cameras'));
    assert.equal(parsed.stateFile, join(process.cwd(), 'tmp/state.json'));
    assert.throws(() => parseArguments(['--legacy']), /unknown/);
  });
});
