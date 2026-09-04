/**
 * The removal path, against the real repositories.
 *
 * The point of this file is one claim: pressing the button in SETTINGS empties
 * the stores it says it empties. Not "calls a function that is supposed to" --
 * the assertions below seed real rows through the real repositories, run the
 * real port, then reopen the database and count.
 *
 * `docs/plate-data-handling.md#removal` is the contract being tested:
 * plate ciphertext, the match index, trips, alerts and the vault key reference
 * go; signed evidence stays; a second press is idempotent.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { GENESIS_CHAIN_HASH } from '../../services/crypto/chain.ts';
import { createPlateVault } from '../../services/crypto/plate.ts';
import {
  closeFwmDb,
  createAlertsRepository,
  createCameraTilesRepository,
  createPlateMatchesRepository,
  createPlateVaultRepository,
  createPendingReportsRepository,
  createReportChainRepository,
  createReportPhotosRepository,
  createSettingsRepository,
  createTripsRepository,
  openFwmDb,
} from '../../services/db';
import type { FwmDatabase } from '../../services/db';
import { PLATE_SCHEMA } from '../../services/crypto/plate.ts';
import { PLATE_VAULT_KEY_ID } from '../../services/crypto/keys.ts';
import type {
  PlateVaultRecord,
  ReportPhotoRecord,
  SignedReportRecord,
} from '../../services/db/schema.ts';
import { EVIDENCE_SCHEMA } from '../../services/crypto/chain.ts';
import type { MemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';

import { NO_LOCAL_STORE, removeLocalData } from './removal.ts';
import { STORED_ITEMS } from './storage.ts';

let memory: MemoryIndexedDB;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

afterEach(async () => {
  // The no-IndexedDB test stubs the global away; vitest's own unstub runs after
  // this hook, so the cleanup below would fail on the stub rather than on a
  // real problem.
  vi.unstubAllGlobals();
  // `removeLocalData` opens the default `fwm` database by design -- it is the
  // production path, not a test-parameterised one -- so each test starts from
  // an empty one rather than from the previous test's leftovers.
  const db = await openFwmDb();
  await Promise.all([
    createPlateVaultRepository(db).clear(),
    createPlateMatchesRepository(db).clear(),
    createAlertsRepository(db).clear(),
    createTripsRepository(db).clear(),
    createSettingsRepository(db).clear(),
    createCameraTilesRepository(db).clear(),
    createReportPhotosRepository(db).clear(),
  ]);
  closeFwmDb(db);
});

/** A record shaped exactly as `createPlateVault().seal()` produces one. */
function sealedRecord(plateId: string): PlateVaultRecord {
  return {
    plateId,
    schema: PLATE_SCHEMA,
    iv: 'AAECAwQFBgcICQoL',
    ciphertext: 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0',
    blindIndex: '9f2c1a4e8b7d6c5a4f3e2d1c0b9a8f7e',
    createdAt: '2026-08-19T14:22:08.412Z',
    keyId: PLATE_VAULT_KEY_ID,
    updatedAt: 1_700_000_000_000,
    readCount: 0,
  };
}

/** The report the seeded photograph belongs to. */
const PHOTO_REPORT_ID = 'a1b2c3d4-0000-4000-8000-000000000f0f';

/** Fill every store the removal is supposed to empty. */
async function seed(db: FwmDatabase): Promise<void> {
  const vault = createPlateVaultRepository(db);
  await vault.put(sealedRecord('3f2504e0-4f89-41d3-9a0c-0305e82c3301'));
  await vault.put(sealedRecord('3f2504e0-4f89-41d3-9a0c-0305e82c3302'));

  const matches = createPlateMatchesRepository(db);
  await matches.record({
    matchId: 'm-1',
    plateId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    cameraId: 'cam-1',
    at: 1_760_000_000_000,
  });

  const alerts = createAlertsRepository(db);
  await alerts.record({
    cameraId: 'cam-1',
    state: 'in_range',
    distanceFt: 425,
    headingDeg: 41,
    speedMph: 47,
    at: 1_760_000_000_000,
    // A muted pass is still a pass, and it is still a row this button removes.
    muted: true,
    dismissed: false,
  });

  await createTripsRepository(db).start(1_760_000_000_000);

  await createSettingsRepository(db).set('plateVault.keyId', PLATE_VAULT_KEY_ID);

  await createReportPhotosRepository(db).put(photoRecord(PHOTO_REPORT_ID));
}

/**
 * Bytes shaped like what `preparePhoto()` hands over - a JPEG SOI marker and a
 * body. Nothing here decodes an image: `createImageBitmap` does not exist in
 * this environment, so a test that tried to prepare one would only ever take
 * `preparePhoto()`'s null branch. The real stripping is proven in a real
 * browser by `e2e/preparePhoto.spec.ts`; what this file proves is that the
 * bytes, however they were made, do not survive the removal button.
 */
function photoRecord(reportId: string): ReportPhotoRecord {
  const bytes = new Uint8Array(96).fill(0x41);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  return {
    reportId,
    sha256: 'a'.repeat(64),
    bytes,
    mimeType: 'image/jpeg',
    sizeBytes: bytes.byteLength,
    width: 1600,
    height: 1200,
  };
}

/** A signed body, so the photograph under test hangs off a real report. */
function signedReport(reportId: string): SignedReportRecord {
  return {
    schema: EVIDENCE_SCHEMA,
    reportId,
    capturedAt: '2026-08-19T14:22:08.412Z',
    payload: { lat: 39.0997, lon: -84.5786, photo: 'a'.repeat(64) },
    payloadHash: 'f'.repeat(64),
    previousChainHash: GENESIS_CHAIN_HASH,
    chainHash: 'd'.repeat(64),
    signature: 'c2lnbmF0dXJl',
    publicKeyId: 'evidence-signing-public-v1',
    publicKeySpki: 'c3BraQ',
    gpsAccuracyM: 4,
    syncState: 'held',
    supersedes: null,
  };
}

interface Counts {
  readonly plates: number;
  readonly matches: number;
  readonly alerts: number;
  readonly trips: number;
  readonly photos: number;
  readonly keyId: string | null | undefined;
}

async function counts(): Promise<Counts> {
  const db = await openFwmDb();
  const result = {
    plates: await createPlateVaultRepository(db).count(),
    matches: await createPlateMatchesRepository(db).count(),
    alerts: await createAlertsRepository(db).count(),
    trips: await createTripsRepository(db).count(),
    photos: await createReportPhotosRepository(db).count(),
    keyId: await createSettingsRepository(db).get('plateVault.keyId'),
  };
  closeFwmDb(db);
  return result;
}

describe('the removal empties the stores it names', () => {
  it('leaves no plate ciphertext, no match index, no trips and no alerts', async () => {
    const db = await openFwmDb();
    await seed(db);
    closeFwmDb(db);

    const before = await counts();
    // The assertion after the wipe is only meaningful if there was something
    // to wipe, so prove there was.
    expect(before).toMatchObject({ plates: 2, matches: 1, alerts: 1, trips: 1, photos: 1 });
    expect(before.keyId).toBe(PLATE_VAULT_KEY_ID);

    const outcome = await removeLocalData();

    expect(outcome.status).toBe('removed');
    expect(await counts()).toMatchObject({
      plates: 0,
      matches: 0,
      alerts: 0,
      trips: 0,
      photos: 0,
      keyId: undefined,
    });
  });

  it('destroys the keys as well as the ciphertext', async () => {
    const vault = createPlateVault();
    const sealed = await vault.seal('HVK 8842');
    expect(await vault.open(sealed)).toBe('HVK 8842');

    const outcome = await removeLocalData();
    expect(outcome.status).toBe('removed');

    // Ciphertext gone from the vault's own store...
    expect(await vault.openById(sealed.id)).toBeUndefined();
    // ...and a caller holding a stale copy of the record cannot read it either,
    // because the key it was sealed under no longer exists. A removal that
    // leaves recoverable data is worse than no removal.
    await expect(vault.open(sealed)).rejects.toThrow();
  });

  it('reports the counts it removed, not a reassurance', async () => {
    const db = await openFwmDb();
    await seed(db);
    closeFwmDb(db);

    const outcome = await removeLocalData();

    expect(outcome.status).toBe('removed');
    if (outcome.status !== 'removed') return;
    expect(outcome.lines).toContain('2 encrypted plates deleted');
    expect(outcome.lines).toContain('1 match index deleted');
    expect(outcome.lines).toContain('encryption keys destroyed');
    expect(outcome.lines).toContain('1 trip and 1 alert deleted');
  });

  it('is idempotent: a second press reports zeroes and throws nothing', async () => {
    const db = await openFwmDb();
    await seed(db);
    closeFwmDb(db);

    await removeLocalData();
    const second = await removeLocalData();

    expect(second.status).toBe('removed');
    if (second.status !== 'removed') return;
    expect(second.lines).toContain('0 encrypted plates deleted');
    expect(await counts()).toMatchObject({ plates: 0, matches: 0, alerts: 0, trips: 0 });
  });
});

describe('the photograph goes even though the report it belongs to stays', () => {
  // This is the one asymmetry in the removal, so it is asserted rather than
  // trusted. `reportPhotos` has no index and no `all()`, which means a
  // photograph the wipe missed would be invisible to every screen and every
  // count in the app while still sitting on disk - the failure could not be
  // noticed by using the product, only by a test that goes and looks.
  it('deletes the attached photograph, keeps the signed body, and says both', async () => {
    const db = await openFwmDb();
    await seed(db);
    await createPendingReportsRepository(db).add(signedReport(PHOTO_REPORT_ID));
    closeFwmDb(db);

    const before = await openFwmDb();
    expect(await createReportPhotosRepository(before).get(PHOTO_REPORT_ID)).toBeDefined();
    closeFwmDb(before);

    const outcome = await removeLocalData();
    expect(outcome.status).toBe('removed');
    if (outcome.status !== 'removed') return;

    const after = await openFwmDb();
    // The picture is gone...
    expect(await createReportPhotosRepository(after).get(PHOTO_REPORT_ID)).toBeUndefined();
    expect(await createReportPhotosRepository(after).count()).toBe(0);
    // ...and the evidence the driver deliberately filed is not, so this is a
    // removal of the leaf and not a quiet shredding of the chain.
    const kept = await createPendingReportsRepository(after).get(PHOTO_REPORT_ID);
    expect(kept).toBeDefined();
    // The digest survives in the retained payload, which is exactly why
    // deleting the bytes breaks no signature: the record still says truthfully
    // that there was a photograph and what its digest was.
    expect(kept?.payload['photo']).toBe('a'.repeat(64));
    closeFwmDb(after);

    // Counted, not claimed. SETTINGS prints these lines verbatim, so a wipe
    // that silently dropped a photograph without saying so would be the same
    // class of defect as a privacy note that no longer matches the behaviour.
    expect(outcome.lines).toContain('1 attached photograph deleted');
    expect(
      outcome.lines.some(
        (line) =>
          line.includes('signed camera report') &&
          line.includes('the photographs they named are gone'),
      ),
    ).toBe(true);
  });

  it('says zero photographs rather than staying silent when none were attached', async () => {
    const outcome = await removeLocalData();
    expect(outcome.status).toBe('removed');
    if (outcome.status !== 'removed') return;
    // The line is unconditional, like every other count on this list: a missing
    // line reads as "not handled", a zero reads as "checked, there were none".
    expect(outcome.lines).toContain('0 attached photographs deleted');
  });
});

describe('the removal leaves alone every store the list says it leaves alone', () => {
  // `storage.ts#STORED_ITEMS` is what SETTINGS PRINTS: one row per kind, tagged
  // `REMOVED`, `KEPT` or `STAYS`. Its own comment says that if somebody changes
  // `clearLocalData()` this list is wrong and this file fails -- which was only
  // half true while the assertions above covered the `REMOVED` rows alone. A
  // change that started shredding signed evidence, or the public camera cache,
  // would have printed `KEPT` / `STAYS` next to a store it had just emptied.
  it('keeps the signed report chain and the public camera cache, and the non-secret settings', async () => {
    const db = await openFwmDb();
    await seed(db);

    const chain = createReportChainRepository(db);
    // Link onto whatever head this database already has: the chain never
    // deletes, by design, so it cannot be reset between tests.
    const head = await chain.headHash();
    await chain.append({
      reportId: 'a1b2c3d4-0000-4000-8000-00000000beef',
      payloadHash: 'b'.repeat(64),
      previousChainHash: head === '' ? GENESIS_CHAIN_HASH : head,
      chainHash: 'c'.repeat(64),
      signature: 'sig-kept',
      publicKeyId: 'evidence-signing-public-v1',
      capturedAt: '2026-08-19T14:22:08.412Z',
    });

    await createCameraTilesRepository(db).put({
      z: 14,
      x: 4_370,
      y: 6_302,
      cameras: [],
      source: 'network',
      fetchedAt: 1_760_000_000_000,
    });

    // A non-secret setting: `SECRET_SETTING_NAMES` is the list `clearSecrets()`
    // drops, and this is not on it.
    await createSettingsRepository(db).set('alert.thresholdFt', 750);
    closeFwmDb(db);

    const outcome = await removeLocalData();
    expect(outcome.status).toBe('removed');

    const after = await openFwmDb();
    // KEPT.
    expect(await createReportChainRepository(after).get('a1b2c3d4-0000-4000-8000-00000000beef')).toBeDefined();
    // STAYS.
    expect(await createCameraTilesRepository(after).count()).toBe(1);
    expect(await createSettingsRepository(after).get('alert.thresholdFt')).toBe(750);
    // ...and the REMOVED rows really did go, so this is not passing by inertia.
    expect(await createPlateVaultRepository(after).count()).toBe(0);
    closeFwmDb(after);

    // The three dispositions this asserts are the three the screen prints.
    expect(new Set(STORED_ITEMS.map((item) => item.disposition))).toEqual(
      new Set(['removed', 'kept', 'untouched']),
    );
  });
});

describe('a platform with nowhere to store anything', () => {
  it('says nothing was ever stored rather than claiming a failed wipe', async () => {
    vi.stubGlobal('indexedDB', undefined);

    const outcome = await removeLocalData();

    expect(outcome).toEqual({ status: 'unavailable', reason: NO_LOCAL_STORE });
  });
});
