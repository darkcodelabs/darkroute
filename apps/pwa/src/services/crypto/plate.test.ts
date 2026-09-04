import { describe, expect, it } from 'vitest';
import {
  EXPORT_WARNING,
  IV_LENGTH,
  InvalidPlateError,
  PlateExportNotConfirmedError,
  createPlateVault,
  memoryPlateStore,
  normalisePlate,
} from './plate';
import { CryptoUnavailableError, createKeyManager } from './keys';
import { fromBase64Url } from './bytes';
import { createTestInstall, ephemeralMemoryKeyStore } from './testing';

/** The watchlist plate rendered on watch face W11 in Flockys Watch.dc.html. */
const PLATE = 'HVK 8842';

describe('normalisePlate', () => {
  it('folds case, spacing and punctuation but keeps letters and digits', () => {
    expect(normalisePlate('hvk-8842')).toBe('HVK8842');
    expect(normalisePlate('  HVK 8842 ')).toBe('HVK8842');
    expect(normalisePlate(PLATE)).toBe('HVK8842');
  });

  it('rejects a string with nothing to match on, without echoing it', () => {
    expect(() => normalisePlate('   ')).toThrow(InvalidPlateError);
    expect(() => normalisePlate('---')).toThrow(InvalidPlateError);
    try {
      normalisePlate('!!!');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('!!!');
    }
  });
});

describe('sealing', () => {
  it('round-trips the plate exactly as the user typed it', async () => {
    const { plates } = createTestInstall();
    const sealed = await plates.seal('hvk-8842');
    await expect(plates.open(sealed)).resolves.toBe('hvk-8842');
    await expect(plates.openById(sealed.id)).resolves.toBe('hvk-8842');
  });

  it('stores nothing that reveals the plate', async () => {
    const { plates, plateStore } = createTestInstall();
    await plates.seal(PLATE);
    const stored = JSON.stringify(await plateStore.getAll());
    expect(stored).not.toContain('HVK');
    expect(stored).not.toContain('8842');
    expect(stored).not.toContain('hvk');
  });

  it('draws a fresh IV every time, so the same plate encrypts differently', async () => {
    const { plates } = createTestInstall();
    const first = await plates.seal(PLATE);
    const second = await plates.seal(PLATE);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(fromBase64Url(first.iv).length).toBe(IV_LENGTH);
    expect(fromBase64Url(second.iv).length).toBe(IV_LENGTH);

    // The blind index IS deterministic; that is what makes matching possible.
    expect(second.blindIndex).toBe(first.blindIndex);
    expect(first.blindIndex).toMatch(/^[0-9a-f]{32}$/);

    await expect(plates.open(first)).resolves.toBe(PLATE);
    await expect(plates.open(second)).resolves.toBe(PLATE);
  });

  it('binds ciphertext to its record id, so a copied ciphertext will not open', async () => {
    const { plates } = createTestInstall();
    const a = await plates.seal(PLATE);
    const b = await plates.seal('XYZ 1111');
    const swapped = { ...b, ciphertext: a.ciphertext, iv: a.iv };
    await expect(plates.open(swapped)).rejects.toThrow();
  });

  it('refuses to store a plate that has nothing to match on', async () => {
    const { plates, plateStore } = createTestInstall();
    await expect(plates.seal('   ')).rejects.toBeInstanceOf(InvalidPlateError);
    expect(await plateStore.getAll()).toHaveLength(0);
  });
});

describe('local matching', () => {
  it('matches across formatting differences and returns ids, never plate text', async () => {
    const { plates } = createTestInstall();
    const sealed = await plates.seal('hvk-8842');

    for (const candidate of ['HVK 8842', 'hvk8842', 'h v k 8 8 4 2']) {
      const matches = await plates.matchAgainst(candidate);
      expect(matches.map((m) => m.id)).toEqual([sealed.id]);
      expect(JSON.stringify(matches)).not.toContain('8842');
    }
  });

  it('finds every record holding the same plate', async () => {
    const { plates } = createTestInstall();
    const a = await plates.seal(PLATE);
    const b = await plates.seal('hvk 8842');
    await plates.seal('ABC 0001');
    const matches = await plates.matchAgainst(PLATE);
    expect(matches.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('does not match a different plate', async () => {
    const { plates } = createTestInstall();
    await plates.seal(PLATE);
    await expect(plates.matchAgainst('HVK 8843')).resolves.toEqual([]);
  });

  it('exposes the blind index so a caller can match a batch itself', async () => {
    const { plates } = createTestInstall();
    const sealed = await plates.seal(PLATE);
    await expect(plates.blindIndexOf('hvk8842')).resolves.toBe(sealed.blindIndex);
  });

  it('gives a different install a different index for the same plate', async () => {
    const a = createTestInstall();
    const b = createTestInstall();
    const indexA = await a.plates.blindIndexOf(PLATE);
    const indexB = await b.plates.blindIndexOf(PLATE);
    expect(indexB).not.toBe(indexA);
  });
});

describe('listing', () => {
  it('returns ids and timestamps only, newest first', async () => {
    const install = createTestInstall();
    const first = await install.plates.seal('AAA 1111');
    install.tick(60_000);
    const second = await install.plates.seal('BBB 2222');

    const listed = await install.plates.list();
    expect(listed.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(Object.keys(listed[0] ?? {})).toEqual(['id', 'createdAt']);
  });

  it('removes a single record', async () => {
    const { plates, plateStore } = createTestInstall();
    const sealed = await plates.seal(PLATE);
    await plates.remove(sealed.id);
    expect(await plateStore.getAll()).toHaveLength(0);
    await expect(plates.openById(sealed.id)).resolves.toBeUndefined();
  });
});

describe('export', () => {
  it('cannot happen as a side effect: it demands an explicit confirmation', async () => {
    const { plates } = createTestInstall();
    await plates.seal(PLATE);
    await expect(
      plates.exportPlatesWithWarning({ confirmed: false } as unknown as { confirmed: true }),
    ).rejects.toBeInstanceOf(PlateExportNotConfirmedError);
    await expect(
      plates.exportPlatesWithWarning({} as unknown as { confirmed: true }),
    ).rejects.toBeInstanceOf(PlateExportNotConfirmedError);
  });

  it('returns cleartext with the warning attached when confirmed', async () => {
    const { plates } = createTestInstall();
    await plates.seal('hvk-8842');
    await plates.seal('ABC 0001');
    const exported = await plates.exportPlatesWithWarning({ confirmed: true });
    expect(exported.warning).toBe(EXPORT_WARNING);
    expect(exported.entries.map((entry) => entry.plate).sort()).toEqual(['ABC 0001', 'hvk-8842']);
  });
});

describe('destroyVault', () => {
  it('leaves nothing decryptable, not even a record captured beforehand', async () => {
    const install = createTestInstall();
    const sealed = await install.plates.seal(PLATE);
    await expect(install.plates.open(sealed)).resolves.toBe(PLATE);

    await install.plates.destroyVault();

    expect(await install.plateStore.getAll()).toHaveLength(0);
    await expect(install.plates.list()).resolves.toEqual([]);
    // The key is gone, so a copy of the ciphertext kept elsewhere is inert:
    // the next call mints a brand new vault key that cannot open it.
    await expect(install.plates.open(sealed)).rejects.toThrow();
    await expect(install.plates.matchAgainst(PLATE)).resolves.toEqual([]);
  });

  it('drops the match index too: the same plate indexes differently afterwards', async () => {
    const install = createTestInstall();
    const before = await install.plates.blindIndexOf(PLATE);
    await install.plates.destroyVault();
    await expect(install.plates.blindIndexOf(PLATE)).resolves.not.toBe(before);
  });

  it('does not end the evidence chain', async () => {
    const install = createTestInstall();
    const identity = (await install.keys.signing()).publicKeyId;
    await install.plates.destroyVault();
    expect((await install.keys.signing()).publicKeyId).toBe(identity);
  });
});

describe('without integrity', () => {
  it('refuses every operation and says why', async () => {
    const vault = createPlateVault({
      keys: createKeyManager({ keyStore: ephemeralMemoryKeyStore() }),
      store: memoryPlateStore(),
    });
    await expect(vault.availability()).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'no-persistent-key-storage',
    });
    await expect(vault.seal(PLATE)).rejects.toBeInstanceOf(CryptoUnavailableError);
    await expect(vault.matchAgainst(PLATE)).rejects.toBeInstanceOf(CryptoUnavailableError);
    await expect(vault.blindIndexOf(PLATE)).rejects.toBeInstanceOf(CryptoUnavailableError);
  });
});
