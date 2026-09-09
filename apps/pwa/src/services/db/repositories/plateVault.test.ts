import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PLATE_VAULT_KEY_ID } from '../../crypto/keys.ts';
import { PLATE_SCHEMA } from '../../crypto/plate.ts';
import { closeFwmDb, openFwmDb } from '../index.ts';
import type { PlateVaultRecord } from '../schema.ts';
import type { MemoryIndexedDB } from '../testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../testing/memory-idb.ts';
import {
  PlateVaultWriteError,
  assertPlateVaultRecordSafe,
  createPlateVaultRepository,
  looksLikePlate,
  looksLikePlateToken,
} from './plateVault.ts';
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
  return openFwmDb({ name: `fwm-vault-${String(++counter)}` });
}

/** A record shaped exactly as `createPlateVault().seal()` produces one. */
function sealedRecord(overrides: Partial<PlateVaultRecord> = {}): PlateVaultRecord {
  return {
    plateId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    schema: PLATE_SCHEMA,
    iv: 'AAECAwQFBgcICQoL', // 12 bytes, unpadded base64url
    ciphertext: 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0',
    blindIndex: '9f2c1a4e8b7d6c5a4f3e2d1c0b9a8f7e',
    createdAt: '2026-08-19T14:22:08.412Z',
    keyId: PLATE_VAULT_KEY_ID,
    updatedAt: 1_700_000_000_000,
    readCount: 73,
    ...overrides,
  };
}

describe('looksLikePlate', () => {
  it('recognises the plates the design itself renders', () => {
    // Flockys Screens II.dc.html B5 · WATCHLIST
    expect(looksLikePlate('HVK 8842')).toBe(true);
    expect(looksLikePlate('471 TRB')).toBe(true);
    expect(looksLikePlate('TR 90144')).toBe(true);
    expect(looksLikePlate('hvk8842')).toBe(true);
    expect(looksLikePlate('my plate is HVK-8842 ok')).toBe(true);
  });

  it('does not flag the sealed material the vault legitimately stores', () => {
    const record = sealedRecord();
    expect(looksLikePlate(record.blindIndex)).toBe(false);
    expect(looksLikePlate(record.ciphertext)).toBe(false);
    expect(looksLikePlate(record.iv)).toBe(false);
    expect(looksLikePlate(record.schema)).toBe(false);
  });

  it('documents its known false positives rather than pretending it has none', () => {
    // A UUID segment is eight mixed characters, so the heuristic bites. This
    // is exactly why plateId is gated by UUID_RE and never by this function.
    expect(looksLikePlate(sealedRecord().plateId)).toBe(true);
    // A hyphenated key id contains the adjacent pair "gcm-v1", which is also
    // five mixed characters - so key ids get the narrower single-run check.
    expect(looksLikePlate(PLATE_VAULT_KEY_ID)).toBe(true);
    expect(looksLikePlateToken(PLATE_VAULT_KEY_ID)).toBe(false);
    expect(looksLikePlateToken('HVK8842')).toBe(true);
  });

  it('does not flag ordinary words or bare numbers', () => {
    expect(looksLikePlate('partner')).toBe(false);
    expect(looksLikePlate('trailer')).toBe(false);
    expect(looksLikePlate('1234567')).toBe(false);
  });
});

describe('assertPlateVaultRecordSafe', () => {
  it('accepts a properly sealed record', () => {
    expect(() => {
      assertPlateVaultRecordSafe(sealedRecord());
    }).not.toThrow();
  });

  it('rejects a cleartext plate smuggled in as an extra field', () => {
    const smuggled = { ...sealedRecord(), plate: 'HVK 8842' };
    expect(() => {
      assertPlateVaultRecordSafe(smuggled);
    }).toThrow(PlateVaultWriteError);
    expect(() => {
      assertPlateVaultRecordSafe(smuggled);
    }).toThrow(/shaped like a licence plate/);
  });

  it('rejects a cleartext plate written into the ciphertext field', () => {
    expect(() => {
      assertPlateVaultRecordSafe(sealedRecord({ ciphertext: 'HVK8842' }));
    }).toThrow(/ciphertext/);
  });

  it('never echoes the offending value in the error message', () => {
    // An exception message is a log line, a crash report and a bug ticket
    // waiting to happen - and this one is raised exactly when the value might
    // be the secret the whole product protects.
    try {
      assertPlateVaultRecordSafe({ ...sealedRecord(), plate: 'HVK 8842' });
      expect.unreachable('the assertion should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(PlateVaultWriteError);
      expect((thrown as Error).message).not.toContain('HVK');
      expect((thrown as Error).message).not.toContain('8842');
    }
  });

  it('rejects a plateId derived from the plate instead of randomly generated', () => {
    expect(() => {
      assertPlateVaultRecordSafe(sealedRecord({ plateId: 'HVK8842' }));
    }).toThrow(/plateId/);
  });

  it('rejects a nested value, where a plate could hide from a field check', () => {
    const nested = { ...sealedRecord(), readCount: { value: 73, plate: 'HVK 8842' } };
    expect(() => {
      assertPlateVaultRecordSafe(nested);
    }).toThrow(/nested/);
  });

  it('rejects a missing or malformed sealed field', () => {
    const { blindIndex: _dropped, ...missing } = sealedRecord();
    expect(() => {
      assertPlateVaultRecordSafe(missing);
    }).toThrow(/blindIndex is missing/);
    expect(() => {
      assertPlateVaultRecordSafe(sealedRecord({ iv: 'short' }));
    }).toThrow(/iv/);
    expect(() => {
      assertPlateVaultRecordSafe(sealedRecord({ readCount: -1 }));
    }).toThrow(/readCount/);
  });
});

describe('plateVault repository', () => {
  it('stores and returns a sealed record, and never a plate', async () => {
    const db = await freshDb();
    const vault = createPlateVaultRepository(db, { now: () => 2_000 });

    await vault.put(sealedRecord());
    const stored = await vault.get('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(stored?.ciphertext).toBe(sealedRecord().ciphertext);
    expect(JSON.stringify(stored)).not.toMatch(/HVK/i);

    await expect(vault.summaries()).resolves.toEqual([
      { plateId: sealedRecord().plateId, createdAt: sealedRecord().createdAt, readCount: 73 },
    ]);
    closeFwmDb(db);
  });

  it('refuses the write at the repository boundary, not just in the assertion', async () => {
    const db = await freshDb();
    const vault = createPlateVaultRepository(db);
    const smuggled = { ...sealedRecord(), plate: 'HVK 8842' } as unknown as PlateVaultRecord;

    await expect(vault.put(smuggled)).rejects.toThrow(PlateVaultWriteError);
    await expect(vault.count()).resolves.toBe(0);
    closeFwmDb(db);
  });

  it('serves as a SealedPlateStore for the crypto vault, preserving read counts', async () => {
    const db = await freshDb();
    const vault = createPlateVaultRepository(db, { now: () => 3_000 });
    const store = vault.asSealedPlateStore();

    const record = sealedRecord();
    await store.put({
      id: record.plateId,
      schema: record.schema,
      iv: record.iv,
      ciphertext: record.ciphertext,
      blindIndex: record.blindIndex,
      createdAt: record.createdAt,
    });

    await expect(store.get(record.plateId)).resolves.toEqual({
      id: record.plateId,
      schema: record.schema,
      iv: record.iv,
      ciphertext: record.ciphertext,
      blindIndex: record.blindIndex,
      createdAt: record.createdAt,
    });

    await vault.bumpReadCount(record.plateId, 5);
    await expect(vault.get(record.plateId)).resolves.toMatchObject({ readCount: 5 });

    // Re-sealing the same id must not reset the count the WATCHLIST renders.
    await store.put({
      id: record.plateId,
      schema: record.schema,
      iv: record.iv,
      ciphertext: record.ciphertext,
      blindIndex: record.blindIndex,
      createdAt: record.createdAt,
    });
    await expect(vault.get(record.plateId)).resolves.toMatchObject({ readCount: 5 });

    await expect(store.getAll()).resolves.toHaveLength(1);
    await store.clear();
    await expect(vault.count()).resolves.toBe(0);
    closeFwmDb(db);
  });
});
