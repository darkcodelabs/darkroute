import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVIDENCE_SCHEMA, GENESIS_CHAIN_HASH } from '../../crypto/chain.ts';
import { closeFwmDb, createRepositories, openFwmDb } from '../index.ts';
import { EVICTION_EXEMPT_STORES, MAX_REPORT_PHOTOS } from '../policy.ts';
import type { ReportPhotoRecord, SignedReportRecord, StoreName } from '../schema.ts';
import type { MemoryIndexedDB } from '../testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../testing/memory-idb.ts';
import { createReportPhotosRepository } from './reportPhotos.ts';
import type { FwmDatabase } from './support.ts';

let memory: MemoryIndexedDB;
let counter = 0;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

async function freshDb(): Promise<FwmDatabase> {
  return openFwmDb({ name: `fwm-photos-${String(++counter)}` });
}

const REPORT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

/**
 * Bytes shaped like what `preparePhoto()` hands over: a JPEG SOI marker and a
 * body. Real stripping is proven in `e2e/preparePhoto.spec.ts`, in a browser
 * that has `createImageBitmap` - this environment does not, so a storage test
 * that tried to prepare anything would only ever exercise the null branch.
 */
function jpegBytes(fill = 0x41, length = 64): Uint8Array {
  const bytes = new Uint8Array(length).fill(fill);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  return bytes;
}

function photoRecord(overrides: Partial<ReportPhotoRecord> = {}): ReportPhotoRecord {
  const bytes = overrides.bytes ?? jpegBytes();
  return {
    reportId: REPORT_ID,
    sha256: 'a'.repeat(64),
    mimeType: 'image/jpeg',
    sizeBytes: bytes.byteLength,
    width: 1600,
    height: 1200,
    ...overrides,
    bytes,
  };
}

function signedReport(reportId: string, syncState: SignedReportRecord['syncState']): SignedReportRecord {
  return {
    schema: EVIDENCE_SCHEMA,
    reportId,
    capturedAt: '2026-08-19T14:22:08.412Z',
    payload: { lat: 39.0997, lon: -84.5786, photo: 'a'.repeat(64) },
    payloadHash: 'f'.repeat(64),
    previousChainHash: GENESIS_CHAIN_HASH,
    chainHash: 'e'.repeat(64),
    signature: 'c2lnbmF0dXJl',
    publicKeyId: 'evidence-signing-public-v1',
    publicKeySpki: 'c3BraQ',
    gpsAccuracyM: 4,
    syncState,
    supersedes: null,
  };
}

describe('reportPhotos store', () => {
  it('carries no index, so nothing can order a driver\'s photographs', async () => {
    const db = await freshDb();
    const tx = db.transaction('reportPhotos', 'readonly');
    expect(tx.store.indexNames.length).toBe(0);
    await tx.done;
    closeFwmDb(db);
  });

  it('is exempt from eviction, because dropping bytes a signature names is not ours to do', () => {
    expect((EVICTION_EXEMPT_STORES as readonly StoreName[]).includes('reportPhotos')).toBe(true);
  });
});

describe('reportPhotosRepository', () => {
  it('round-trips the bytes as a real Uint8Array', async () => {
    const db = await freshDb();
    const repo = createReportPhotosRepository(db);
    const record = photoRecord({ bytes: jpegBytes(0x5a, 128) });

    await repo.put(record);
    const stored = await repo.get(REPORT_ID);

    expect(stored).toBeDefined();
    // The whole reason the schema says Uint8Array and not Blob: a Blob comes
    // back from this repository's clone step as an empty object with an
    // undefined size, and nothing here would have thrown.
    //
    // Checked by tag and by ArrayBuffer.isView rather than with `instanceof`,
    // and NOT because instanceof is fussy - because it is FALSE here. The
    // storage double clones with `structuredClone`, which is Node's, so the
    // value comes back built from Node's Uint8Array while the test file sees
    // jsdom's. Same bytes, same length, different constructor. Anything that
    // guards read-back photo bytes with `bytes instanceof Uint8Array` will pass
    // in a browser and fail in this suite.
    expect(Object.prototype.toString.call(stored?.bytes)).toBe('[object Uint8Array]');
    expect(ArrayBuffer.isView(stored?.bytes)).toBe(true);
    expect(stored?.bytes.byteLength).toBe(128);
    expect(Array.from(stored?.bytes.slice(0, 2) ?? [])).toEqual([0xff, 0xd8]);
    expect(stored?.sizeBytes).toBe(128);
    expect(stored?.sha256).toBe(record.sha256);
    expect(stored?.mimeType).toBe('image/jpeg');
    expect(stored?.width).toBe(1600);
    expect(stored?.height).toBe(1200);
    closeFwmDb(db);
  });

  it('hands back a copy, so a reader cannot mutate what is stored', async () => {
    const db = await freshDb();
    const repo = createReportPhotosRepository(db);
    await repo.put(photoRecord());

    const first = await repo.get(REPORT_ID);
    first?.bytes.fill(0);
    const second = await repo.get(REPORT_ID);

    expect(second?.bytes[0]).toBe(0xff);
    closeFwmDb(db);
  });

  it('replaces on re-attach rather than refusing, unlike the signed record', async () => {
    const db = await freshDb();
    const repo = createReportPhotosRepository(db);

    await repo.put(photoRecord({ sha256: 'a'.repeat(64), bytes: jpegBytes(0x41, 64) }));
    // A driver who takes a second photograph before submitting is not making an
    // immutability error - nothing has been signed over the first one yet.
    await repo.put(photoRecord({ sha256: 'b'.repeat(64), bytes: jpegBytes(0x42, 96) }));

    const stored = await repo.get(REPORT_ID);
    expect(stored?.sha256).toBe('b'.repeat(64));
    expect(stored?.bytes.byteLength).toBe(96);
    await expect(repo.count()).resolves.toBe(1);
    closeFwmDb(db);
  });

  it('answers undefined for a report that filed without a photograph', async () => {
    const db = await freshDb();
    const repo = createReportPhotosRepository(db);
    await expect(repo.get('no-such-report')).resolves.toBeUndefined();
    closeFwmDb(db);
  });

  it('treats deleting an absent key as a no-op, not an error', async () => {
    const db = await freshDb();
    const repo = createReportPhotosRepository(db);
    await repo.put(photoRecord());

    await expect(repo.delete('no-such-report')).resolves.toBeUndefined();
    await expect(repo.count()).resolves.toBe(1);

    await repo.delete(REPORT_ID);
    await expect(repo.count()).resolves.toBe(0);
    closeFwmDb(db);
  });

  it('reports capacity at the cap and never evicts to make room', async () => {
    const db = await freshDb();
    const repo = createReportPhotosRepository(db);
    // The cap itself is 50 rows of up to 600 KB; the boundary is what matters
    // here, so the test drives a small override rather than writing 30 MB.
    await expect(repo.atCapacity(2)).resolves.toBe(false);
    await repo.put(photoRecord({ reportId: 'r-1' }));
    await expect(repo.atCapacity(2)).resolves.toBe(false);
    await repo.put(photoRecord({ reportId: 'r-2' }));
    await expect(repo.atCapacity(2)).resolves.toBe(true);

    // At capacity, a write still succeeds if a caller makes one - refusing is
    // the attach path's job, and nothing in this store deletes to make room.
    await repo.put(photoRecord({ reportId: 'r-3' }));
    await expect(repo.count()).resolves.toBe(3);
    await expect(repo.atCapacity()).resolves.toBe(false);
    expect(MAX_REPORT_PHOTOS).toBe(50);
    closeFwmDb(db);
  });

  it('clears wholesale and reports the count it removed', async () => {
    const db = await freshDb();
    const repo = createReportPhotosRepository(db);
    await repo.put(photoRecord({ reportId: 'r-1' }));
    await repo.put(photoRecord({ reportId: 'r-2' }));

    await expect(repo.clear()).resolves.toBe(2);
    await expect(repo.count()).resolves.toBe(0);
    await expect(repo.clear()).resolves.toBe(0);
    closeFwmDb(db);
  });
});

describe('purgeSynced', () => {
  it('deletes a synced report\'s photograph in the same breath as its body', async () => {
    const db = await freshDb();
    const repos = createRepositories(db);

    await repos.pendingReports.add(signedReport('r-synced', 'synced'));
    await repos.pendingReports.add(signedReport('r-held', 'held'));
    await repos.reportPhotos.put(photoRecord({ reportId: 'r-synced' }));
    await repos.reportPhotos.put(photoRecord({ reportId: 'r-held' }));

    // The count is of REPORTS, not of deleted rows.
    await expect(repos.pendingReports.purgeSynced()).resolves.toBe(1);

    // Without the two-store transaction this row would survive the only record
    // that names it, and with no index and no all() nothing could ever find it.
    await expect(repos.reportPhotos.get('r-synced')).resolves.toBeUndefined();
    await expect(repos.reportPhotos.get('r-held')).resolves.toBeDefined();
    await expect(repos.reportPhotos.count()).resolves.toBe(1);
    closeFwmDb(db);
  });

  it('purges a synced report that filed without a photograph', async () => {
    const db = await freshDb();
    const repos = createRepositories(db);
    await repos.pendingReports.add(signedReport('r-synced', 'synced'));

    await expect(repos.pendingReports.purgeSynced()).resolves.toBe(1);
    await expect(repos.pendingReports.count()).resolves.toBe(0);
    closeFwmDb(db);
  });
});
