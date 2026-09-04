import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MANIFEST_SCHEMA,
  POINTER_SCHEMA,
  createManifest,
  jsonBytes,
  readLocalGeneration,
  selectCandidateSlot,
  validateManifest,
  validatePointer,
  validateReplication,
} from './camera-generation.mjs';
import {
  approvedCameraSourceFixture,
  fixtureGeneration,
  makeCameraFixture,
  setFixtureBasePointer,
} from './camera-generation-test-helpers.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function pointer(slot, previous = null) {
  return {
    schema: POINTER_SCHEMA,
    slot,
    generation: HASH_A,
    manifestSha256: HASH_B,
    previous,
    updatedAt: '2026-09-01T10:02:00.000Z',
  };
}

describe('camera generation control schemas', () => {
  it('selects only the slot outside current and previous', () => {
    assert.equal(selectCandidateSlot(null), 'a');
    assert.equal(selectCandidateSlot(pointer('a')), 'b');
    assert.equal(
      selectCandidateSlot(pointer('a', { slot: 'b', generation: HASH_B, manifestSha256: HASH_A })),
      'c',
    );
  });

  it('rejects malformed pointers and a repeated protected slot', () => {
    assert.throws(
      () =>
        validatePointer(pointer('a', { slot: 'a', generation: HASH_B, manifestSha256: HASH_A })),
      /repeats its active slot/,
    );
    assert.throws(() => validatePointer({ ...pointer('a'), surprise: true }), /unexpected field/);
  });

  it('uses the Function-compatible millisecond format for pointer timestamps only', () => {
    assert.throws(
      () => validatePointer({ ...pointer('a'), updatedAt: '2026-09-01T10:02:00Z' }),
      /updatedAt is invalid/,
    );
    assert.equal(
      validateReplication({
        stream: 'hour',
        lastAppliedSeq: 10,
        lastAppliedTimestamp: '2026-09-01T10:00:00Z',
        versionsKnown: false,
      }).lastAppliedTimestamp,
      '2026-09-01T10:00:00Z',
    );
  });

  it('generation identity excludes createdAt but includes replication and file hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-hash-'));
    try {
      const fixture = await makeCameraFixture(root);
      const first = await fixtureGeneration(fixture, '2026-09-01T10:01:00.000Z');
      const second = createManifest({
        createdAt: '2026-09-01T10:02:00.000Z',
        replication: first.local.replication,
        archive: first.local.archive,
        files: first.local.files,
      });
      assert.equal(second.schema, MANIFEST_SCHEMA);
      assert.equal(second.generation, first.manifest.generation);
      const hydratedBase = pointer('a');
      await setFixtureBasePointer(fixture, hydratedBase);
      const withRuntimeBase = await fixtureGeneration(fixture, first.manifest.createdAt);
      assert.equal(withRuntimeBase.manifest.generation, first.manifest.generation);
      assert.deepEqual(withRuntimeBase.local.basePointer, hydratedBase);
      const changed = createManifest({
        createdAt: second.createdAt,
        replication: { ...first.local.replication, lastAppliedSeq: 11 },
        archive: first.local.archive,
        files: first.local.files,
      });
      assert.notEqual(changed.generation, first.manifest.generation);
      assert.equal(validateManifest(first.manifest), first.manifest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('deep local camera validation', () => {
  it('accepts a fully bound fixture and produces sorted hashed inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-local-'));
    try {
      const fixture = await makeCameraFixture(root);
      const generation = await readLocalGeneration(fixture.archive, fixture.stateFile, {
        minTiles: 1,
        minCameras: 1,
      });
      assert.equal(generation.archive.tiles, 1);
      assert.equal(generation.archive.cameras, 1);
      assert.deepEqual(
        generation.files.map((file) => file.key),
        [...generation.files.map((file) => file.key)].sort((a, b) => a.localeCompare(b)),
      );
      assert.ok(generation.files.every((file) => /^[a-f\d]{64}$/.test(file.sha256)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hydrates legacy false generations without a URI but requires it for publication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-legacy-notice-'));
    try {
      const fixture = await makeCameraFixture(root);
      for (const key of [
        fixture.tileKey,
        'index.json',
        'overview.json',
        'tombstones.json',
        'places.json',
        'counties.json',
      ]) {
        const path = join(fixture.archive, key);
        const document = JSON.parse(await readFile(path, 'utf8'));
        delete document.licenceUrl;
        await writeFile(path, jsonBytes(document));
      }
      await assert.doesNotReject(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
        }),
      );
      await assert.rejects(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
          requireLicenceUrl: true,
        }),
        /licence URI/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects index/state drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-state-'));
    try {
      const fixture = await makeCameraFixture(root);
      const indexPath = join(fixture.archive, 'index.json');
      const index = JSON.parse(await readFile(indexPath, 'utf8'));
      index.upstream = '2026-09-01T09:00:00Z';
      await writeFile(indexPath, jsonBytes(index));
      await assert.rejects(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
        }),
        /does not match the replication watermark/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires both serving-side gazetteer sidecars', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-gazetteers-'));
    try {
      const fixture = await makeCameraFixture(root);
      await rm(join(fixture.archive, 'places.json'));
      await assert.rejects(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
        }),
        /archive is missing places\.json/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects wrong tile placement and an inexact overview coordinate multiset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-placement-'));
    try {
      const fixture = await makeCameraFixture(root);
      const tilePath = join(fixture.archive, fixture.tileKey);
      const tile = JSON.parse(await readFile(tilePath, 'utf8'));
      tile.cameras[0].lon = 150;
      await writeFile(tilePath, jsonBytes(tile));
      await assert.rejects(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
        }),
        /stored in the wrong tile/,
      );

      await rm(root, { recursive: true, force: true });
      const nextRoot = await mkdtemp(join(tmpdir(), 'camera-generation-overview-'));
      try {
        const next = await makeCameraFixture(nextRoot);
        const overviewPath = join(next.archive, 'overview.json');
        const overview = JSON.parse(await readFile(overviewPath, 'utf8'));
        overview.coords = [1, 3];
        await writeFile(overviewPath, jsonBytes(overview));
        await assert.rejects(
          readLocalGeneration(next.archive, next.stateFile, {
            minTiles: 1,
            minCameras: 1,
          }),
          /coordinate multiset disagrees/,
        );
      } finally {
        await rm(nextRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects live/tombstone overlap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-tombstone-'));
    try {
      const fixture = await makeCameraFixture(root, {
        tombstones: [{ id: 'osm:1', reason: 'osm_delete', seq: 9 }],
      });
      await assert.rejects(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
        }),
        /still live/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('proves versionsKnown across every live record and tombstone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-versions-live-'));
    const tombstoneRoot = await mkdtemp(join(tmpdir(), 'camera-generation-versions-dead-'));
    const validRoot = await mkdtemp(join(tmpdir(), 'camera-generation-versions-valid-'));
    try {
      const approved = approvedCameraSourceFixture();
      const missingLive = await makeCameraFixture(root, { versionsKnown: true });
      await assert.rejects(
        readLocalGeneration(missingLive.archive, missingLive.stateFile, {
          minTiles: 1,
          minCameras: 1,
        }),
        /live camera osm:1 has no OSM version/,
      );

      const missingTombstone = await makeCameraFixture(tombstoneRoot, {
        versionsKnown: true,
        osmVersion: 3,
        tombstones: [{ id: 'osm:2', reason: 'osm_delete', seq: 9, osmVersion: 2 }],
        cameraSource: approved.marker,
        baseUpstream: approved.minimumOsmBase,
      });
      const missingTombstonePath = join(missingTombstone.archive, 'tombstones.json');
      const missingTombstoneLedger = JSON.parse(
        await readFile(missingTombstonePath, 'utf8'),
      );
      delete missingTombstoneLedger.tombstones[0].osmVersion;
      await writeFile(missingTombstonePath, jsonBytes(missingTombstoneLedger));
      await assert.rejects(
        readLocalGeneration(missingTombstone.archive, missingTombstone.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /tombstone osm:2 has no OSM version/,
      );

      const valid = await makeCameraFixture(validRoot, {
        versionsKnown: true,
        osmVersion: 3,
        tombstones: [{ id: 'osm:2', reason: 'osm_delete', seq: 9, osmVersion: 2 }],
        cameraSource: approved.marker,
        baseUpstream: approved.minimumOsmBase,
      });
      const generation = await readLocalGeneration(valid.archive, valid.stateFile, {
        minTiles: 1,
        minCameras: 1,
        trustedReviewBytes: approved.trustedReviewBytes,
      });
      assert.equal(generation.replication.versionsKnown, true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(tombstoneRoot, { recursive: true, force: true });
      await rm(validRoot, { recursive: true, force: true });
    }
  });

  it('binds versionsKnown to canonical OSM ids and the exact approved baseline marker', async () => {
    const approved = approvedCameraSourceFixture();
    const roots = await Promise.all(
      ['missing', 'forged', 'watermark', 'live-id', 'dead-id'].map((name) =>
        mkdtemp(join(tmpdir(), `camera-generation-trust-${name}-`)),
      ),
    );
    try {
      const missing = await makeCameraFixture(roots[0], {
        versionsKnown: true,
        osmVersion: 3,
        baseUpstream: approved.minimumOsmBase,
      });
      const missingIndexPath = join(missing.archive, 'index.json');
      const missingIndex = JSON.parse(await readFile(missingIndexPath, 'utf8'));
      missingIndex.source =
        'OpenStreetMap (ODbL), direct retained-response capture using DeFlock-derived queries';
      await writeFile(missingIndexPath, jsonBytes(missingIndex));
      await assert.rejects(
        readLocalGeneration(missing.archive, missing.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /missing cameraSource/,
      );

      const forgedMarker = structuredClone(approved.marker);
      forgedMarker.review.sha256 = '0'.repeat(64);
      const forged = await makeCameraFixture(roots[1], {
        versionsKnown: true,
        osmVersion: 3,
        cameraSource: forgedMarker,
        baseUpstream: approved.minimumOsmBase,
      });
      await assert.rejects(
        readLocalGeneration(forged.archive, forged.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /does not match the checked-in approved review/,
      );

      const wrongWatermark = await makeCameraFixture(roots[2], {
        versionsKnown: true,
        osmVersion: 3,
        cameraSource: approved.marker,
        baseUpstream: '2026-09-01T09:00:00.000Z',
      });
      await assert.rejects(
        readLocalGeneration(wrongWatermark.archive, wrongWatermark.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /baseline watermark does not match/,
      );

      const badLive = await makeCameraFixture(roots[3], {
        versionsKnown: true,
        osmVersion: 3,
        cameraSource: approved.marker,
        baseUpstream: approved.minimumOsmBase,
      });
      const badLiveTilePath = join(badLive.archive, badLive.tileKey);
      const badLiveTile = JSON.parse(await readFile(badLiveTilePath, 'utf8'));
      badLiveTile.cameras[0].id = 'legacy:1';
      await writeFile(badLiveTilePath, jsonBytes(badLiveTile));
      await assert.rejects(
        readLocalGeneration(badLive.archive, badLive.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /no canonical OSM node id/,
      );

      const badDead = await makeCameraFixture(roots[4], {
        versionsKnown: true,
        osmVersion: 3,
        tombstones: [{ id: 'osm:2', reason: 'osm_delete', seq: 9, osmVersion: 2 }],
        cameraSource: approved.marker,
        baseUpstream: approved.minimumOsmBase,
      });
      const badDeadPath = join(badDead.archive, 'tombstones.json');
      const badDeadLedger = JSON.parse(await readFile(badDeadPath, 'utf8'));
      badDeadLedger.tombstones[0].id = 'legacy:2';
      await writeFile(badDeadPath, jsonBytes(badDeadLedger));
      await assert.rejects(
        readLocalGeneration(badDead.archive, badDead.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /no canonical OSM node id/,
      );
    } finally {
      await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    }
  });

  it('rejects self-consistent receipts that violate direct-capture trust invariants', async () => {
    const variants = [
      {
        name: 'implementation',
        mutate: (receipt) => {
          receipt.captureImplementation = {};
        },
      },
      {
        name: 'floor-url',
        mutate: (receipt) => {
          receipt.replicationFloor.stateUrl = 'https://evil.example/009.state.txt';
        },
      },
      {
        name: 'endpoint',
        mutate: (receipt) => {
          receipt.sourceWatermark.responseLedger.endpoints = [
            'https://evil.example/api/interpreter',
          ];
        },
      },
      {
        name: 'timeline',
        mutate: (receipt) => {
          receipt.sourceWatermark.minimumOsmBase = '2026-09-01T10:06:00.000Z';
        },
      },
    ];
    for (const variant of variants) {
      const root = await mkdtemp(join(tmpdir(), `camera-generation-${variant.name}-`));
      try {
        const malicious = approvedCameraSourceFixture(variant.mutate);
        const fixture = await makeCameraFixture(root, {
          versionsKnown: true,
          osmVersion: 3,
          cameraSource: malicious.marker,
          baseUpstream: malicious.minimumOsmBase,
        });
        await assert.rejects(
          readLocalGeneration(fixture.archive, fixture.stateFile, {
            minTiles: 1,
            minCameras: 1,
            trustedReviewBytes: malicious.trustedReviewBytes,
          }),
          /approved|capture implementation|response ledger|replication floor|review receipt/,
          variant.name,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it('rejects forged or contact-bearing fields outside the replayed OSM core', async () => {
    const approved = approvedCameraSourceFixture();
    const roots = await Promise.all(
      ['county', 'contact', 'proto'].map((name) =>
        mkdtemp(join(tmpdir(), `camera-generation-enrichment-${name}-`)),
      ),
    );
    try {
      const fixtures = await Promise.all(
        roots.map((root) =>
          makeCameraFixture(root, {
            versionsKnown: true,
            osmVersion: 3,
            cameraSource: approved.marker,
            baseUpstream: approved.minimumOsmBase,
          }),
        ),
      );
      const mutateCamera = async (fixture, mutate) => {
        const path = join(fixture.archive, fixture.tileKey);
        const tile = JSON.parse(await readFile(path, 'utf8'));
        mutate(tile.cameras[0]);
        await writeFile(path, jsonBytes(tile));
      };

      await mutateCamera(fixtures[0], (camera) => {
        camera.countyFips = '99999';
      });
      await assert.rejects(
        readLocalGeneration(fixtures[0].archive, fixtures[0].stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /invalid versioned fields/,
      );

      await mutateCamera(fixtures[1], (camera) => {
        camera.street = 'victim@example.org';
      });
      await assert.rejects(
        readLocalGeneration(fixtures[1].archive, fixtures[1].stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /invalid versioned record schema/,
      );

      await mutateCamera(fixtures[2], (camera) => {
        Object.defineProperty(camera, '__proto__', {
          value: { omitted: true },
          enumerable: true,
          configurable: true,
        });
      });
      await assert.rejects(
        readLocalGeneration(fixtures[2].archive, fixtures[2].stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /invalid versioned record schema/,
      );
    } finally {
      await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    }
  });

  it('rejects unbound payloads in every approved public archive body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-generation-outer-schema-'));
    try {
      const approved = approvedCameraSourceFixture();
      const fixture = await makeCameraFixture(root, {
        versionsKnown: true,
        osmVersion: 3,
        cameraSource: approved.marker,
        baseUpstream: approved.minimumOsmBase,
      });
      for (const key of [
        fixture.tileKey,
        'index.json',
        'overview.json',
        'tombstones.json',
        'counties.json',
        'places.json',
      ]) {
        const path = join(fixture.archive, key);
        const original = await readFile(path);
        const value = JSON.parse(original.toString('utf8'));
        value.unbound = 'victim@example.org https://evil.example';
        await writeFile(path, jsonBytes(value));
        await assert.rejects(
          readLocalGeneration(fixture.archive, fixture.stateFile, {
            minTiles: 1,
            minCameras: 1,
            trustedReviewBytes: approved.trustedReviewBytes,
          }),
          /unexpected field unbound/,
          key,
        );
        await writeFile(path, original);
      }

      const placesPath = join(fixture.archive, 'places.json');
      const places = JSON.parse(await readFile(placesPath, 'utf8'));
      places.places = 1;
      places.inPlace = 1;
      places.unincorporated = 0;
      places.rows = [{ geoid: '0000000', name: 'victim@example.org' }];
      await writeFile(placesPath, jsonBytes(places));
      await assert.rejects(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /canonical disabled-enrichment sidecar/,
      );
      await makeCameraFixture(root, {
        versionsKnown: true,
        osmVersion: 3,
        cameraSource: approved.marker,
        baseUpstream: approved.minimumOsmBase,
      });
      const countiesPath = join(fixture.archive, 'counties.json');
      const counties = JSON.parse(await readFile(countiesPath, 'utf8'));
      counties.rows[0].cameras = 999_999;
      await writeFile(countiesPath, jsonBytes(counties));
      await assert.rejects(
        readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        }),
        /exactly describe the pinned territorial join/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('enforces the pinned US/DC/PR polygon on every versionsKnown live camera', async () => {
    const approved = approvedCameraSourceFixture();
    const cases = [
      { name: 'vancouver', lat: 49.2827, lon: -123.1207, accepted: false },
      { name: 'mexico', lat: 19.4326, lon: -99.1332, accepted: false },
      { name: 'usvi', lat: 18.3449583, lon: -64.9772912, accepted: false },
      { name: 'puerto-rico', lat: 18.2208, lon: -66.5901, accepted: true },
      { name: 'adak', lat: 51.88, lon: -176.65, accepted: true },
      { name: 'attu', lat: 52.9, lon: 173.2, accepted: true },
    ];
    for (const [index, item] of cases.entries()) {
      const root = await mkdtemp(join(tmpdir(), `camera-generation-geofence-${item.name}-`));
      try {
        const fixture = await makeCameraFixture(root, {
          id: `osm:${String(index + 10)}`,
          lat: item.lat,
          lon: item.lon,
          versionsKnown: true,
          osmVersion: 3,
          cameraSource: approved.marker,
          baseUpstream: approved.minimumOsmBase,
        });
        const attempt = readLocalGeneration(fixture.archive, fixture.stateFile, {
          minTiles: 1,
          minCameras: 1,
          trustedReviewBytes: approved.trustedReviewBytes,
        });
        if (item.accepted) {
          const generation = await attempt;
          assert.equal(generation.archive.cameras, 1, item.name);
        } else {
          await assert.rejects(attempt, /outside the approved US\/DC\/PR territory/, item.name);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
