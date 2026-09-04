import assert from 'node:assert/strict';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { POINTER_KEY, POINTER_SCHEMA, jsonBytes, slotDataPrefix } from './camera-generation.mjs';
import {
  MemoryR2,
  fixtureGeneration,
  makeCameraFixture,
  seedGeneration,
} from './camera-generation-test-helpers.mjs';
import {
  hydrateGeneration,
  installHydratedSnapshot,
  main,
  parseArguments,
  runBounded,
  validateRemoteInventory,
  validateTargets,
} from './hydrate-cameras.mjs';

const silent = () => {};

function pointer(slot, generation) {
  return {
    schema: POINTER_SCHEMA,
    slot,
    generation: generation.manifest.generation,
    manifestSha256: generation.manifestSha256,
    previous: null,
    updatedAt: '2026-09-01T10:02:00.000Z',
  };
}

function listed(generation, slot = 'a') {
  const prefix = slotDataPrefix(slot);
  return generation.manifest.files.map((file) => ({
    Key: `${prefix}${file.key}`,
    Size: file.bytes,
    ETag: `"${file.md5}"`,
  }));
}

describe('pinned generation inventory', () => {
  it('rejects extra, missing, duplicate, wrong-size, and corrupt-MD5 inventories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-inventory-'));
    try {
      const fixture = await makeCameraFixture(root);
      const generation = await fixtureGeneration(fixture);
      const objects = listed(generation);
      const prefix = slotDataPrefix('a');
      assert.equal(
        validateRemoteInventory(objects, generation.manifest, prefix).length,
        generation.manifest.files.length,
      );
      assert.throws(
        () =>
          validateRemoteInventory(
            [...objects, { Key: `${prefix}extra.json`, Size: 1, ETag: `"${'a'.repeat(32)}"` }],
            generation.manifest,
            prefix,
          ),
        /extra or missing/,
      );
      assert.throws(
        () => validateRemoteInventory(objects.slice(1), generation.manifest, prefix),
        /extra or missing/,
      );
      assert.throws(
        () =>
          validateRemoteInventory([...objects.slice(1), objects[1]], generation.manifest, prefix),
        /repeats|missing|unexpected/,
      );
      assert.throws(
        () =>
          validateRemoteInventory(
            [{ ...objects[0], Size: objects[0].Size + 1 }, ...objects.slice(1)],
            generation.manifest,
            prefix,
          ),
        /wrong size/,
      );
      assert.throws(
        () =>
          validateRemoteInventory(
            [{ ...objects[0], ETag: `"${'a'.repeat(32)}"` }, ...objects.slice(1)],
            generation.manifest,
            prefix,
          ),
        /wrong MD5/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('camera generation hydration', () => {
  it('snapshots both destinations before credential derivation can use the network', async () => {
    const calls = [];
    const prepared = Object.freeze({
      target: '/prepared/cameras',
      stateFile: '/prepared/state.json',
    });
    const client = Object.freeze({ name: 'client' });
    let hydrated;

    await main(['--target=/requested/cameras', '--state-file=/requested/state.json'], {
      environment: {
        R2_CAMERA_BUCKET: 'camera-bucket',
        CLOUDFLARE_ACCOUNT_ID: 'account-id',
      },
      prepareTargets: async (target, stateFile) => {
        calls.push('prepare');
        assert.equal(target, '/requested/cameras');
        assert.equal(stateFile, '/requested/state.json');
        return prepared;
      },
      credentialsFactory: async () => {
        calls.push('credentials');
        assert.deepEqual(calls, ['prepare', 'credentials']);
        return { accessKeyId: 'read', secretAccessKey: 'only' };
      },
      clientFactory: (configuration) => {
        calls.push('client');
        assert.equal(configuration.endpoint, 'https://account-id.r2.cloudflarestorage.com');
        return client;
      },
      hydrate: async (options) => {
        calls.push('hydrate');
        hydrated = options;
      },
    });

    assert.deepEqual(calls, ['prepare', 'credentials', 'client', 'hydrate']);
    assert.equal(hydrated.client, client);
    assert.equal(hydrated.bucket, 'camera-bucket');
    assert.equal(hydrated.prepared, prepared);
  });

  it('rejects archive or state destinations with a symlink ancestor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-symlink-'));
    try {
      const real = join(root, 'real');
      const stateParent = join(root, 'state-parent');
      await mkdir(join(real, 'archive-parent'), { recursive: true });
      await mkdir(stateParent);
      await symlink(real, join(root, 'link'), 'dir');
      await assert.rejects(
        validateTargets(
          join(root, 'link', 'archive-parent', 'cameras'),
          join(stateParent, 'state.json'),
        ),
        /symlink component/,
      );

      await symlink(stateParent, join(root, 'state-link'), 'dir');
      await assert.rejects(
        validateTargets(
          join(real, 'archive-parent', 'cameras'),
          join(root, 'state-link', 'state.json'),
        ),
        /symlink component/,
      );

      const staged = join(root, 'staged-cameras');
      await mkdir(staged);
      await assert.rejects(
        installHydratedSnapshot(
          staged,
          join(root, 'link', 'archive-parent', 'cameras'),
          join(stateParent, 'state.json'),
          Buffer.from('{}\n'),
          { warn: silent },
        ),
        /symlink component/,
      );
      assert.equal((await lstat(staged)).isDirectory(), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts the deploy-shaped destinations after the workflow creates their parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-deploy-shape-'));
    try {
      const parent = join(root, 'camera-preflight');
      const target = join(parent, 'cameras');
      const stateFile = join(parent, 'state.json');
      await assert.rejects(validateTargets(target, stateFile), /ENOENT/);
      await mkdir(parent);
      const prepared = await validateTargets(target, stateFile);
      assert.equal(prepared.target, target);
      assert.equal(prepared.stateFile, stateFile);
      assert.equal(prepared.targetTree, null);
      assert.equal(prepared.state, null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores the exact archive and canonical manifest state', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'camera-hydrate-source-'));
    const destinationRoot = await mkdtemp(join(tmpdir(), 'camera-hydrate-destination-'));
    try {
      const fixture = await makeCameraFixture(sourceRoot);
      const generation = await fixtureGeneration(fixture);
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', generation);
      r2.set(POINTER_KEY, jsonBytes(pointer('a', generation)));

      const target = join(destinationRoot, 'cameras');
      const stateFile = join(destinationRoot, 'camera-sync-state.json');
      await mkdir(target);
      await writeFile(join(target, 'old.json'), '{}\n');
      await writeFile(stateFile, '{"old":true}\n');
      const result = await hydrateGeneration({
        client: r2,
        bucket: 'bucket',
        target,
        stateFile,
        log: silent,
        warn: silent,
        validation: { minTiles: 1, minCameras: 1 },
      });
      assert.equal(result.generation, generation.manifest.generation);
      assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), {
        ...generation.manifest.replication,
        basePointer: pointer('a', generation),
      });
      for (const entry of generation.local.entries) {
        assert.deepEqual(await readFile(join(target, entry.key)), entry.body);
      }
      await assert.rejects(readFile(join(target, 'old.json')), /ENOENT/);
      assert.equal(
        r2.events.filter((event) => event.type === 'GetObjectCommand' && event.key === POINTER_KEY)
          .length,
        1,
        'hydration must pin one pointer read',
      );
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(destinationRoot, { recursive: true, force: true });
    }
  });

  it('requires a pointer and never falls back to legacy flat objects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-pointer-'));
    try {
      const target = join(root, 'cameras');
      const stateFile = join(root, 'camera-sync-state.json');
      const r2 = new MemoryR2();
      r2.set('index.json', '{}\n');
      await assert.rejects(
        hydrateGeneration({
          client: r2,
          bucket: 'bucket',
          target,
          stateFile,
          log: silent,
          warn: silent,
          validation: { minTiles: 1, minCameras: 1 },
        }),
        /pointer is absent/,
      );
      assert.equal((await validateTargets(target, stateFile)).target, target);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a manifest whose exact bytes do not match the pointer hash', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'camera-hydrate-manifest-source-'));
    const destinationRoot = await mkdtemp(join(tmpdir(), 'camera-hydrate-manifest-dest-'));
    try {
      const fixture = await makeCameraFixture(sourceRoot);
      const generation = await fixtureGeneration(fixture);
      const r2 = new MemoryR2();
      seedGeneration(r2, 'a', generation);
      const badPointer = pointer('a', generation);
      badPointer.manifestSha256 = 'a'.repeat(64);
      r2.set(POINTER_KEY, jsonBytes(badPointer));
      await assert.rejects(
        hydrateGeneration({
          client: r2,
          bucket: 'bucket',
          target: join(destinationRoot, 'cameras'),
          stateFile: join(destinationRoot, 'camera-sync-state.json'),
          log: silent,
          warn: silent,
          validation: { minTiles: 1, minCameras: 1 },
        }),
        /does not match the pinned pointer hash/,
      );
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
      await rm(destinationRoot, { recursive: true, force: true });
    }
  });

  it('bounds concurrent downloads', async () => {
    let active = 0;
    let peak = 0;
    await runBounded([1, 2, 3, 4, 5], 2, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
    });
    assert.equal(peak, 2);
  });
});

describe('archive/state installation transaction', () => {
  it('restores both old values when state installation fails after archive installation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-rollback-'));
    const target = join(root, 'cameras');
    const staged = join(root, '.cameras-hydrate-test');
    const stateFile = join(root, 'camera-sync-state.json');
    try {
      await mkdir(target);
      await mkdir(staged);
      await writeFile(join(target, 'old'), 'old archive');
      await writeFile(join(staged, 'new'), 'new archive');
      await writeFile(stateFile, 'old state');
      const prepared = await validateTargets(target, stateFile);
      await assert.rejects(
        installHydratedSnapshot(staged, target, stateFile, Buffer.from('new state'), {
          beforeStateInstall: async () => {
            throw new Error('injected state install failure');
          },
          prepared,
          warn: silent,
        }),
        /injected state install failure/,
      );
      assert.equal(await readFile(join(target, 'old'), 'utf8'), 'old archive');
      assert.equal(await readFile(stateFile, 'utf8'), 'old state');
      assert.equal(await readFile(join(staged, 'new'), 'utf8'), 'new archive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an archive entry added after preparation without replacing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-late-entry-'));
    try {
      const target = join(root, 'cameras');
      const staged = join(root, '.cameras-hydrate-test');
      const stateFile = join(root, 'state.json');
      await mkdir(target);
      await mkdir(staged);
      await writeFile(join(target, 'old'), 'old archive');
      await writeFile(join(staged, 'new'), 'new archive');
      await writeFile(stateFile, 'old state');
      const prepared = await validateTargets(target, stateFile);
      await writeFile(join(target, 'late'), 'must survive');
      await assert.rejects(
        installHydratedSnapshot(staged, target, stateFile, Buffer.from('new state'), {
          prepared,
          warn: silent,
        }),
        /changed after preparation/,
      );
      assert.equal(await readFile(join(target, 'old'), 'utf8'), 'old archive');
      assert.equal(await readFile(join(target, 'late'), 'utf8'), 'must survive');
      assert.equal(await readFile(stateFile, 'utf8'), 'old state');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses no-replace installation when an archive or state destination races in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-no-replace-'));
    try {
      const archiveParent = join(root, 'archive-race');
      await mkdir(archiveParent);
      const target = join(archiveParent, 'cameras');
      const staged = join(archiveParent, '.cameras-hydrate-test');
      const stateFile = join(archiveParent, 'state.json');
      await mkdir(staged);
      await writeFile(join(staged, 'new'), 'new archive');
      const prepared = await validateTargets(target, stateFile);
      await assert.rejects(
        installHydratedSnapshot(staged, target, stateFile, Buffer.from('new state'), {
          beforeArchiveInstall: async () => {
            await mkdir(target);
            await writeFile(join(target, 'raced'), 'won archive race');
          },
          prepared,
          warn: silent,
        }),
        /unexpected entry|EEXIST/,
      );
      assert.equal(await readFile(join(target, 'raced'), 'utf8'), 'won archive race');

      const stateParent = join(root, 'state-race');
      await mkdir(stateParent);
      const stateTarget = join(stateParent, 'cameras');
      const stateStaged = join(stateParent, '.cameras-hydrate-test');
      const racedState = join(stateParent, 'state.json');
      await mkdir(stateTarget);
      await mkdir(stateStaged);
      await writeFile(join(stateTarget, 'old'), 'old archive');
      await writeFile(join(stateStaged, 'new'), 'new archive');
      const statePrepared = await validateTargets(stateTarget, racedState);
      await assert.rejects(
        installHydratedSnapshot(stateStaged, stateTarget, racedState, Buffer.from('new state'), {
          beforeStateInstall: async () => {
            await writeFile(racedState, 'won state race', { flag: 'wx' });
          },
          prepared: statePrepared,
          warn: silent,
        }),
        /unexpected entry|EEXIST/,
      );
      assert.equal(await readFile(racedState, 'utf8'), 'won state race');
      assert.equal(await readFile(join(stateTarget, 'old'), 'utf8'), 'old archive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never records or deletes a successor raced in after the state link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-linked-state-race-'));
    try {
      const target = join(root, 'cameras');
      const staged = join(root, '.cameras-hydrate-test');
      const stateFile = join(root, 'state.json');
      await mkdir(target);
      await mkdir(staged);
      await writeFile(join(target, 'old'), 'old archive');
      await writeFile(join(staged, 'new'), 'new archive');
      const prepared = await validateTargets(target, stateFile);

      await assert.rejects(
        installHydratedSnapshot(staged, target, stateFile, Buffer.from('new state'), {
          linkFn: async (source, destination) => {
            await link(source, destination);
            if (destination === stateFile) {
              await unlink(destination);
              await writeFile(destination, 'raced successor', { flag: 'wx' });
            }
          },
          prepared,
          warn: silent,
        }),
        /destination changed|rollback was incomplete/,
      );

      assert.equal(await readFile(stateFile, 'utf8'), 'raced successor');
      assert.equal(await readFile(join(target, 'old'), 'utf8'), 'old archive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an ancestor replaced after preparation before any backup rename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'camera-hydrate-ancestor-race-'));
    try {
      const ancestor = join(root, 'destination');
      const target = join(ancestor, 'cameras');
      const staged = join(ancestor, '.cameras-hydrate-test');
      const stateFile = join(ancestor, 'state.json');
      await mkdir(target, { recursive: true });
      await mkdir(staged);
      await writeFile(join(target, 'old'), 'old archive');
      await writeFile(join(staged, 'new'), 'new archive');
      await writeFile(stateFile, 'old state');
      const prepared = await validateTargets(target, stateFile);
      const original = join(root, 'original-destination');
      await rename(ancestor, original);
      await symlink(original, ancestor, 'dir');
      await assert.rejects(
        installHydratedSnapshot(staged, target, stateFile, Buffer.from('new state'), {
          prepared,
          warn: silent,
        }),
        /symlink component|component changed/,
      );
      assert.equal(await readFile(join(original, 'cameras', 'old'), 'utf8'), 'old archive');
      assert.equal(await readFile(join(original, 'state.json'), 'utf8'), 'old state');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('hydrator CLI', () => {
  it('requires both explicit paths and accepts equals or separate values', () => {
    assert.deepEqual(parseArguments(['--target=cameras', '--state-file', 'state.json']), {
      target: 'cameras',
      stateFile: 'state.json',
    });
    assert.throws(() => parseArguments(['--target=cameras']), /usage/);
    assert.throws(
      () => parseArguments(['--target=cameras', '--state-file=state.json', '--legacy']),
      /unknown/,
    );
  });
});
