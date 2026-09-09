import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeFwmDb, openFwmDb } from './index.ts';
import { DB_VERSION, MIGRATIONS, assertSchemaComplete } from './migrations.ts';
import type { CameraTileRecord, ReportChainRecord } from './schema.ts';
import { STORE_NAMES } from './schema.ts';
import type { MemoryIndexedDB } from './testing/memory-idb.ts';
import { installMemoryIndexedDB } from './testing/memory-idb.ts';

let memory: MemoryIndexedDB;
let counter = 0;
const newName = (): string => `fwm-migrations-${String(++counter)}`;

const V1_ONLY = MIGRATIONS.filter((migration) => migration.version <= 1);

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

describe('migrations', () => {
  it('numbers every migration uniquely and in ascending order', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(DB_VERSION).toBe(versions[versions.length - 1]);
  });

  it('creates every declared store on a fresh v0 database', async () => {
    const db = await openFwmDb({ name: newName() });
    for (const store of STORE_NAMES) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
    expect(() => {
      assertSchemaComplete(db);
    }).not.toThrow();
    closeFwmDb(db);
  });

  it('v0 -> v1 -> latest preserves every record written at v1', async () => {
    const name = newName();

    // --- v0 -> v1, then write one row into every v1 store -----------------
    const v1 = await openFwmDb({ name, version: 1, migrations: V1_ONLY });
    expect(v1.version).toBe(1);
    expect(v1.objectStoreNames.contains('plateMatches')).toBe(false);

    const tile: CameraTileRecord = {
      z: 14,
      x: 4207,
      y: 6234,
      cameras: [{ id: 'FWM-0442', lat: 39.0997, lon: -84.5786, directionDeg: 223 }],
      fetchedAt: 1_000,
      source: 'network',
    };
    await v1.put('cameraTiles', tile);
    await v1.put('tileMeta', {
      z: 14,
      x: 4207,
      y: 6234,
      freshness: 'fresh',
      lastCheckedAt: 1_000,
      staleAfterMs: 60_000,
      cameraCount: 1,
    });
    const alertId = await v1.add('alerts', {
      cameraId: 'FWM-0442',
      state: 'in_range',
      distanceFt: 610,
      headingDeg: 223,
      speedMph: 47,
      at: 2_000,
      muted: true,
      dismissed: false,
    } as never);
    const tripId = await v1.add('trips', {
      startedAt: 500,
      endedAt: 3_000,
      distanceMi: 4.2,
      cameraIdsPassed: ['FWM-0442'],
      exposureCount: 1,
    } as never);
    await v1.put('settings', { name: 'sync.wifiOnly', value: true, updatedAt: 10 });
    await v1.put('session', {
      key: 'current',
      sessionId: '0f9d2b7a-6d0e-4c9a-9b4f-8f2b1a3c5d6e',
      handle: null,
      issuedAt: 11,
    });

    // A chain row written before the sync fields existed. This is the shape
    // migration v2's backfill is for, so it is written deliberately without
    // them rather than through the repository.
    const legacyChainRow = {
      reportId: 'a1b2c3d4-0000-4000-8000-000000000001',
      payloadHash: 'f'.repeat(64),
      previousChainHash: '0'.repeat(64),
      chainHash: 'e'.repeat(64),
      signature: 'sig',
      publicKeyId: 'evidence-signing-public-v1',
      capturedAt: '2026-08-19T14:22:08.412Z',
    };
    await v1.put('reportChain', legacyChainRow as unknown as ReportChainRecord);
    closeFwmDb(v1);

    // --- v1 -> v2 ---------------------------------------------------------
    const applied: string[] = [];
    const v2 = await openFwmDb({
      name,
      onUpgrade: (steps) => applied.push(...steps),
    });

    expect(v2.version).toBe(DB_VERSION);
    // Every migration above v1, not a fixed count: this assertion used to say
    // "exactly one" and broke the moment v3 was appended, which told us nothing
    // about the data. What matters is that the whole tail ran, in order, and
    // that the v2 backfill this test exercises was part of it.
    expect(applied).toHaveLength(DB_VERSION - 1);
    expect(applied[0]).toContain('v2');
    expect(applied.at(-1)).toContain(`v${DB_VERSION}`);

    // Nothing written at v1 was lost, altered, or rebuilt.
    await expect(v2.get('cameraTiles', [14, 4207, 6234])).resolves.toEqual(tile);
    await expect(v2.get('tileMeta', [14, 4207, 6234])).resolves.toMatchObject({ cameraCount: 1 });
    await expect(v2.get('alerts', alertId)).resolves.toMatchObject({
      cameraId: 'FWM-0442',
      muted: true,
    });
    await expect(v2.get('trips', tripId)).resolves.toMatchObject({ distanceMi: 4.2 });
    await expect(v2.get('settings', 'sync.wifiOnly')).resolves.toMatchObject({ value: true });
    await expect(v2.get('session', 'current')).resolves.toMatchObject({ handle: null });

    // The new store exists and is empty; the new index exists.
    expect(v2.objectStoreNames.contains('plateMatches')).toBe(true);
    expect(v2.objectStoreNames.contains('cameraCacheState')).toBe(true);
    await expect(v2.count('plateMatches')).resolves.toBe(0);
    const cameraTx = v2.transaction('cameraTiles', 'readonly');
    expect(cameraTx.store.indexNames.contains('by-generation')).toBe(true);
    await cameraTx.done;
    const tx = v2.transaction('reportChain', 'readonly');
    expect(tx.store.indexNames.contains('by-capturedAt')).toBe(true);
    await tx.done;

    // The backfill filled in the sync fields without touching a signed one.
    const chainRow = await v2.get('reportChain', legacyChainRow.reportId);
    expect(chainRow).toBeDefined();
    expect(chainRow?.payloadHash).toBe(legacyChainRow.payloadHash);
    expect(chainRow?.chainHash).toBe(legacyChainRow.chainHash);
    expect(chainRow?.signature).toBe(legacyChainRow.signature);
    expect(chainRow?.capturedAt).toBe(legacyChainRow.capturedAt);
    expect(chainRow?.syncState).toBe('pending');
    expect(chainRow?.attempts).toBe(0);
    expect(chainRow?.deadLetterReason).toBeNull();

    closeFwmDb(v2);
  });

  it('re-opening at the same version runs no migration at all', async () => {
    const name = newName();
    const first = await openFwmDb({ name });
    closeFwmDb(first);

    const applied: string[] = [];
    const second = await openFwmDb({ name, onUpgrade: (steps) => applied.push(...steps) });
    expect(applied).toEqual([]);
    closeFwmDb(second);
  });

  it('assertSchemaComplete names the store a migration forgot', async () => {
    const db = await openFwmDb({ name: newName(), version: 1, migrations: V1_ONLY });
    expect(() => {
      assertSchemaComplete(db);
    }).toThrow(/plateMatches/);
    closeFwmDb(db);
  });
});
