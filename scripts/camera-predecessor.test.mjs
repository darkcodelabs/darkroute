import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  assertPredecessorCoverage,
  assertHydratedPredecessorGeneration,
  buildPredecessorEvidence,
  parsePredecessorArgs,
  predecessorIdentity,
  validateLegacyFlatOverlay,
  validatePredecessorEvidence,
} from './camera-predecessor.mjs';
import {
  fixtureGeneration,
  makeCameraFixture,
} from './camera-generation-test-helpers.mjs';
import { ATTRIBUTION, LICENCE, latLonToTile } from './fetch-cameras.mjs';

const capturedAt = '2026-09-01T21:00:00.000Z';
const deployment = { provider: 'cloudflare-r2', accountId: 'account', bucket: 'bucket' };
const legacyTombstones = Buffer.from(
  JSON.stringify({ generatedAt: capturedAt, upstream: capturedAt, tombstones: [] }),
);

function evidenceWith(ids) {
  return buildPredecessorEvidence({
    mode: 'legacy-flat-root',
    capturedAt,
    deployment,
    entries: [
      { key: 'index.json', body: Buffer.from('{}') },
      { key: 'tombstones.json', body: legacyTombstones },
      {
        key: '11/1/2.json',
        body: Buffer.from(JSON.stringify({ cameras: ids.map((id) => ({ id })) })),
      },
    ],
  });
}

describe('camera predecessor cutover evidence', () => {
  it('binds a canonical sorted live-id set and exact evidence bytes', () => {
    const evidence = evidenceWith(['osm:20', 'osm:10']);
    assert.deepEqual(evidence.liveIds, ['osm:10', 'osm:20']);
    assert.equal(validatePredecessorEvidence(evidence), evidence);
    const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
    const identity = predecessorIdentity(bytes, evidence);
    assert.equal(identity.mode, 'legacy-flat-root');
    assert.equal(identity.liveCount, 2);
    assert.equal(identity.liveIdsSha256, evidence.liveIdsSha256);
    assert.deepEqual(identity.deployment, deployment);
    assert.equal(evidence.source.tombstones.count, 0);
    assert.equal(evidence.source.tombstones.bytes, legacyTombstones.length);
  });

  it('rejects any predecessor live id absent from both new live and tombstones', () => {
    const evidence = evidenceWith(['osm:10', 'osm:20', 'osm:30']);
    assert.equal(
      assertPredecessorCoverage(evidence, ['osm:10'], [
        { id: 'osm:20', reason: 'osm_delete', seq: 1, osmVersion: 2 },
        { id: 'osm:30', reason: 'osm_untag', seq: 2, osmVersion: 3 },
      ]),
      evidence,
    );
    assert.throws(
      () => assertPredecessorCoverage(evidence, ['osm:10'], [{ id: 'osm:20' }]),
      /lose 1 predecessor live id.*osm:30/,
    );
  });

  it('requires explicit, mode-consistent CLI inputs', () => {
    assert.deepEqual(
      parsePredecessorArgs([
        '--mode=generation',
        '--out=/tmp/evidence',
        '--target=/tmp/cameras',
        '--state-file=/tmp/state.json',
      ]),
      {
        mode: 'generation',
        out: '/tmp/evidence',
        target: '/tmp/cameras',
        stateFile: '/tmp/state.json',
      },
    );
    assert.throws(
      () => parsePredecessorArgs(['--mode=legacy-flat-root', '--out=/tmp/evidence', '--target=x']),
      /reject --target/,
    );
  });

  it('validates the legacy no-delete overlay as an addressable union, not one generation', () => {
    const first = { lat: 34.1597, lon: -118.1478 };
    const second = { lat: 40.7128, lon: -74.006 };
    const firstTile = latLonToTile(first.lat, first.lon, 11);
    const secondTile = latLonToTile(second.lat, second.lon, 11);
    const tile = (at, cameras) => ({
      key: `11/${String(at.x)}/${String(at.y)}.json`,
      body: Buffer.from(
        JSON.stringify({
          z: 11,
          x: at.x,
          y: at.y,
          attribution: ATTRIBUTION,
          licence: LICENCE,
          cameras,
        }),
      ),
    });
    const entries = [
      {
        key: 'index.json',
        body: Buffer.from(
          JSON.stringify({
            zoom: 11,
            cameras: 2,
            tiles: 1,
            upstream: capturedAt,
            attribution: ATTRIBUTION,
            licence: LICENCE,
          }),
        ),
      },
      {
        key: 'tombstones.json',
        body: Buffer.from(
          JSON.stringify({
            generatedAt: capturedAt,
            upstream: capturedAt,
            tombstones: [{ id: 'osm:30', reason: 'osm_delete', seq: 1 }],
          }),
        ),
      },
      tile(firstTile, [{ id: 'osm:10', ...first }, { id: 'osm:20', ...first }]),
      // A stale historical key can repeat an id; the predecessor evidence uses
      // the union because both objects remain addressable in the flat root.
      tile(secondTile, [{ id: 'osm:20', ...second }]),
    ];
    const measured = validateLegacyFlatOverlay(entries, {
      minimumCameras: 1,
      minimumTiles: 1,
    });
    assert.equal(measured.tileCount, 2);
    assert.equal(measured.liveCount, 2);
  });

  it('rejects a locally altered generation that only claims a hydrated base pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-predecessor-generation-'));
    try {
      const fixture = await makeCameraFixture(root);
      const generation = await fixtureGeneration(fixture);
      const pointer = {
        schema: 'darkroute-camera-pointer/v1',
        slot: 'a',
        generation: generation.manifest.generation,
        manifestSha256: generation.manifestSha256,
        previous: null,
        updatedAt: '2026-09-01T20:00:00.000Z',
      };
      const local = { ...generation.local, basePointer: pointer };
      assert.equal(assertHydratedPredecessorGeneration(local), local);
      const altered = structuredClone(local);
      altered.files[0].sha256 = '0'.repeat(64);
      assert.throws(
        () => assertHydratedPredecessorGeneration(altered),
        /do not match their basePointer generation/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
