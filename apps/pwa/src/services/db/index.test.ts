import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EVIDENCE_SCHEMA, GENESIS_CHAIN_HASH } from '../crypto/chain.ts';
import { PLATE_VAULT_KEY_ID } from '../crypto/keys.ts';
import { PLATE_SCHEMA } from '../crypto/plate.ts';
import {
  clearLocalData,
  closeFwmDb,
  createRepositories,
  estimateUsage,
  openFwmDb,
  pendingSyncCount,
} from './index.ts';
import { EvidenceImmutabilityError } from './repositories/pendingReports.ts';
import type { FwmDatabase } from './repositories/support.ts';
import type { PlateVaultRecord, SignedReportRecord } from './schema.ts';
import type { MemoryIndexedDB } from './testing/memory-idb.ts';
import { installMemoryIndexedDB } from './testing/memory-idb.ts';

let memory: MemoryIndexedDB;
let counter = 0;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

async function freshDb(): Promise<FwmDatabase> {
  return openFwmDb({ name: `fwm-index-${String(++counter)}` });
}

const PLATE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function sealedRecord(): PlateVaultRecord {
  return {
    plateId: PLATE_ID,
    schema: PLATE_SCHEMA,
    iv: 'AAECAwQFBgcICQoL',
    ciphertext: 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0',
    blindIndex: '9f2c1a4e8b7d6c5a4f3e2d1c0b9a8f7e',
    createdAt: '2026-08-19T14:22:08.412Z',
    keyId: PLATE_VAULT_KEY_ID,
    updatedAt: 1_700_000_000_000,
    readCount: 73,
  };
}

function signedReport(): SignedReportRecord {
  return {
    schema: EVIDENCE_SCHEMA,
    reportId: 'a1b2c3d4-0000-4000-8000-000000000001',
    capturedAt: '2026-08-19T14:22:08.412Z',
    payload: { lat: 39.0997, lon: -84.5786, gps_accuracy_m: 4 },
    payloadHash: 'f'.repeat(64),
    previousChainHash: GENESIS_CHAIN_HASH,
    chainHash: 'e'.repeat(64),
    signature: 'c2lnbmF0dXJl',
    publicKeyId: 'evidence-signing-public-v1',
    publicKeySpki: 'c3BraQ',
    gpsAccuracyM: 4,
    syncState: 'held',
    supersedes: null,
  };
}

/** Populate one row in each store clearLocalData is expected to touch. */
async function seed(db: FwmDatabase): Promise<void> {
  const repos = createRepositories(db, { now: () => 1_000 });
  await repos.plateVault.put(sealedRecord());
  await repos.plateMatches.record({
    matchId: 'm-1',
    plateId: PLATE_ID,
    cameraId: 'FWM-0442',
  });
  await repos.settings.set('plateVault.keyId', PLATE_VAULT_KEY_ID);
  await repos.settings.set('sync.wifiOnly', true);
  await repos.alerts.record({
    cameraId: 'FWM-0442',
    state: 'in_range',
    distanceFt: 610,
    headingDeg: 223,
    speedMph: 47,
    at: 2_000,
    muted: true,
    dismissed: false,
  });
  const tripId = await repos.trips.start(500);
  await repos.trips.finish(tripId, {
    endedAt: 3_000,
    distanceMi: 4.2,
    cameraIdsPassed: ['FWM-0442'],
    exposureCount: 1,
  });
  await repos.pendingReports.add(signedReport());
  await repos.reportPhotos.put({
    reportId: signedReport().reportId,
    sha256: 'a'.repeat(64),
    bytes: Uint8Array.of(0xff, 0xd8, 0x41, 0x41),
    mimeType: 'image/jpeg',
    sizeBytes: 4,
    width: 1600,
    height: 1200,
  });
}

describe('clearLocalData', () => {
  it('removes plate ciphertext, the key reference, matches, trips and alerts', async () => {
    const db = await freshDb();
    await seed(db);
    const repos = createRepositories(db);

    const report = await clearLocalData(db);

    expect(report.plateCiphertextRows).toBe(1);
    expect(report.plateMatchRows).toBe(1);
    expect(report.alerts).toBe(1);
    expect(report.trips).toBe(1);
    expect(report.vaultKeyReferenceCleared).toBe(true);
    expect(report.secretSettingsRemoved).toContain('plateVault.keyId');

    await expect(repos.plateVault.count()).resolves.toBe(0);
    await expect(repos.plateMatches.count()).resolves.toBe(0);
    await expect(repos.alerts.count()).resolves.toBe(0);
    await expect(repos.trips.count()).resolves.toBe(0);
    await expect(repos.settings.get('plateVault.keyId')).resolves.toBeUndefined();

    // Nothing that is not a secret was collateral damage.
    await expect(repos.settings.get('sync.wifiOnly')).resolves.toBe(true);
    closeFwmDb(db);
  });

  it('leaves no ciphertext behind anywhere in the plate stores', async () => {
    const db = await freshDb();
    await seed(db);
    await clearLocalData(db);

    const remainingVault = await db.getAll('plateVault');
    const remainingMatches = await db.getAll('plateMatches');
    expect(JSON.stringify(remainingVault)).toBe('[]');
    expect(JSON.stringify(remainingMatches)).toBe('[]');
    closeFwmDb(db);
  });

  it('removes attached photographs while retaining the reports that name them', async () => {
    const db = await freshDb();
    await seed(db);
    const repos = createRepositories(db);

    const report = await clearLocalData(db);

    // The photograph is a leaf, not a chain link: the payload keeps the digest,
    // so removing the bytes breaks no signature and no verification, and a
    // picture of a real place is the artefact that most obviously puts somebody
    // somewhere. The report body stays; the picture does not.
    expect(report.photosRemoved).toBe(1);
    await expect(repos.reportPhotos.count()).resolves.toBe(0);
    await expect(repos.reportPhotos.get(signedReport().reportId)).resolves.toBeUndefined();
    await expect(repos.pendingReports.count()).resolves.toBe(1);
    closeFwmDb(db);
  });

  it('retains signed evidence and reports how much it retained', async () => {
    const db = await freshDb();
    await seed(db);

    const report = await clearLocalData(db);
    expect(report.signedReportsRemoved).toBe(0);
    expect(report.signedReportsRetained).toBe(1);

    const repos = createRepositories(db);
    await expect(repos.pendingReports.count()).resolves.toBe(1);
    closeFwmDb(db);
  });

  it('is safe to run twice and reports zero the second time', async () => {
    const db = await freshDb();
    await seed(db);
    await clearLocalData(db);
    const second = await clearLocalData(db);

    expect(second.plateCiphertextRows).toBe(0);
    expect(second.secretSettingsRemoved).toEqual([]);
    expect(second.vaultKeyReferenceCleared).toBe(false);
    closeFwmDb(db);
  });
});

describe('pendingReports immutability', () => {
  it('refuses to change a signed field and allows only the sync state', async () => {
    const db = await freshDb();
    const repos = createRepositories(db);
    const record = signedReport();
    await repos.pendingReports.add(record);

    // Re-adding the identical record is idempotent, not an error.
    await expect(repos.pendingReports.add(record)).resolves.toBeUndefined();

    await expect(
      repos.pendingReports.add({ ...record, chainHash: '0'.repeat(64) }),
    ).rejects.toThrow(EvidenceImmutabilityError);

    const advanced = await repos.pendingReports.updateSyncState(record.reportId, 'syncing');
    expect(advanced.syncState).toBe('syncing');
    expect(advanced.chainHash).toBe(record.chainHash);
    expect(advanced.signature).toBe(record.signature);
    closeFwmDb(db);
  });
});

describe('estimateUsage', () => {
  it('says so, rather than guessing, when the browser exposes no estimate', async () => {
    const db = await freshDb();
    await seed(db);
    vi.stubGlobal('navigator', {});

    const usage = await estimateUsage(db);
    expect(usage.supported).toBe(false);
    expect(usage.unavailableReason).toContain('navigator.storage.estimate');
    expect(usage.usageBytes).toBeNull();
    expect(usage.quotaBytes).toBeNull();
    expect(usage.ratio).toBeNull();
    expect(usage.underPressure).toBe(false);

    // Row counts are ours, so they are always real.
    const plateVault = usage.stores.find((store) => store.store === 'plateVault');
    expect(plateVault).toMatchObject({ rows: 1, evictable: true });
    const reports = usage.stores.find((store) => store.store === 'pendingReports');
    expect(reports).toMatchObject({ rows: 1, cap: null, evictable: false });
    closeFwmDb(db);
  });

  it('reports pressure once the origin is near its quota', async () => {
    const db = await freshDb();
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ usage: 95, quota: 100 }) },
    });

    const usage = await estimateUsage(db);
    expect(usage.supported).toBe(true);
    expect(usage.usageBytes).toBe(95);
    expect(usage.ratio).toBeCloseTo(0.95);
    expect(usage.underPressure).toBe(true);
    closeFwmDb(db);
  });

  it('degrades to unsupported when estimate() throws', async () => {
    const db = await freshDb();
    vi.stubGlobal('navigator', {
      storage: {
        estimate: () => Promise.reject(new Error('quota unavailable in private mode')),
      },
    });

    const usage = await estimateUsage(db);
    expect(usage.supported).toBe(false);
    expect(usage.unavailableReason).toContain('quota unavailable in private mode');
    closeFwmDb(db);
  });
});

describe('pendingSyncCount', () => {
  it('is zero on an empty database', async () => {
    const db = await freshDb();
    await expect(pendingSyncCount(db)).resolves.toEqual({
      reports: 0,
      actions: 0,
      total: 0,
      deadLettered: 0,
    });
    closeFwmDb(db);
  });
});
