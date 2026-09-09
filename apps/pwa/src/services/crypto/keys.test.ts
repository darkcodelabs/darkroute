import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CryptoUnavailableError,
  createKeyManager,
  cryptoAvailability,
  hasIndexedDb,
  memoryKeyStore,
  type PersistentKeyStore,
} from './keys';
import { sha256Hex, fromBase64Url } from './bytes';
import { durableMemoryKeyStore, ephemeralMemoryKeyStore } from './testing';

const subtle = globalThis.crypto.subtle;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('availability probe', () => {
  it('reports available with a durable store, and names the storage kind', async () => {
    const status = await createKeyManager({ keyStore: durableMemoryKeyStore() }).availability();
    expect(status.status).toBe('available');
    if (status.status !== 'available') return;
    expect(status.storage).toBe('memory');
    expect(status.publicKeyId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an ephemeral store: a key that dies with the tab is not evidence', async () => {
    const status = await createKeyManager({ keyStore: ephemeralMemoryKeyStore() }).availability();
    expect(status).toMatchObject({ status: 'unavailable', reason: 'no-persistent-key-storage' });
  });

  it('reports no-web-crypto when globalThis.crypto is gone', async () => {
    vi.stubGlobal('crypto', undefined);
    const status = await createKeyManager({ keyStore: durableMemoryKeyStore() }).availability();
    expect(status).toMatchObject({ status: 'unavailable', reason: 'no-web-crypto' });
  });

  it('reports no-subtle-crypto when crypto exists without subtle', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const status = await createKeyManager({ keyStore: durableMemoryKeyStore() }).availability();
    expect(status).toMatchObject({ status: 'unavailable', reason: 'no-subtle-crypto' });
  });

  it('refuses an insecure context outright', async () => {
    vi.stubGlobal('isSecureContext', false);
    const status = await createKeyManager({ keyStore: durableMemoryKeyStore() }).availability();
    expect(status).toMatchObject({ status: 'unavailable', reason: 'insecure-context' });
  });

  it('reports key-not-cloneable when the store cannot structured-clone a CryptoKey', async () => {
    const exploding: PersistentKeyStore = {
      kind: 'indexeddb',
      durability: 'persistent',
      get: () => Promise.resolve(undefined),
      put: () => Promise.reject(new DOMException('cannot clone', 'DataCloneError')),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const status = await createKeyManager({ keyStore: exploding }).availability();
    expect(status).toMatchObject({ status: 'unavailable', reason: 'key-not-cloneable' });
  });

  it('reports key-not-cloneable when a write silently disappears', async () => {
    const blackHole: PersistentKeyStore = {
      kind: 'indexeddb',
      durability: 'persistent',
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const status = await createKeyManager({ keyStore: blackHole }).availability();
    expect(status).toMatchObject({ status: 'unavailable', reason: 'key-not-cloneable' });
  });

  it('describes this runtime honestly with no options at all', async () => {
    // Node has no IndexedDB. The probe must say so rather than sign anyway.
    const status = await cryptoAvailability();
    expect(hasIndexedDb()).toBe(false);
    expect(status).toMatchObject({ status: 'unavailable', reason: 'no-persistent-key-storage' });
  });
});

describe('signing keys', () => {
  it('generates a private key that cannot be exported', async () => {
    const keys = createKeyManager({ keyStore: durableMemoryKeyStore() });
    const signing = await keys.signing();
    expect(signing.privateKey.extractable).toBe(false);
    expect(signing.privateKey.algorithm.name).toBe('ECDSA');
    await expect(subtle.exportKey('pkcs8', signing.privateKey)).rejects.toThrow();
    await expect(subtle.exportKey('jwk', signing.privateKey)).rejects.toThrow();
  });

  it('derives publicKeyId as the sha-256 of the exported SPKI', async () => {
    const keys = createKeyManager({ keyStore: durableMemoryKeyStore() });
    const signing = await keys.signing();
    const spki = new Uint8Array(await subtle.exportKey('spki', signing.publicKey));
    expect(signing.publicKeyId).toBe(await sha256Hex(subtle, spki));
    expect(fromBase64Url(signing.publicKeySpki)).toEqual(spki);
  });

  it('reuses the stored key pair instead of minting a new one per session', async () => {
    const store = durableMemoryKeyStore();
    const first = await createKeyManager({ keyStore: store }).signing();
    const second = await createKeyManager({ keyStore: store }).signing();
    expect(second.publicKeyId).toBe(first.publicKeyId);
  });

  it('is a different install when the store is different', async () => {
    const a = await createKeyManager({ keyStore: durableMemoryKeyStore() }).signing();
    const b = await createKeyManager({ keyStore: durableMemoryKeyStore() }).signing();
    expect(b.publicKeyId).not.toBe(a.publicKeyId);
  });

  it('throws CryptoUnavailableError rather than returning a key when unavailable', async () => {
    const keys = createKeyManager({ keyStore: ephemeralMemoryKeyStore() });
    await expect(keys.signing()).rejects.toBeInstanceOf(CryptoUnavailableError);
    await expect(keys.requireDeps()).rejects.toBeInstanceOf(CryptoUnavailableError);
    await expect(keys.plateVaultKey()).rejects.toBeInstanceOf(CryptoUnavailableError);
  });
});

describe('symmetric keys', () => {
  it('creates the plate keys lazily and then reuses them', async () => {
    const store = durableMemoryKeyStore();
    const keys = createKeyManager({ keyStore: store });
    await keys.availability();
    expect(await store.get('plate-vault-aes-gcm-v1')).toBeUndefined();

    const vaultKey = await keys.plateVaultKey();
    expect(vaultKey.extractable).toBe(false);
    expect(vaultKey.algorithm.name).toBe('AES-GCM');
    expect(await keys.plateVaultKey()).toBe(vaultKey);

    const indexKey = await keys.plateIndexKey();
    expect(indexKey.extractable).toBe(false);
    expect(indexKey.algorithm.name).toBe('HMAC');
  });

  it('destroys plate keys without touching the signing key', async () => {
    const store = durableMemoryKeyStore();
    const keys = createKeyManager({ keyStore: store });
    const before = await keys.signing();
    const vaultKey = await keys.plateVaultKey();

    await keys.destroyPlateKeys();

    expect((await keys.signing()).publicKeyId).toBe(before.publicKeyId);
    expect(await keys.plateVaultKey()).not.toBe(vaultKey);
  });

  it('destroyAllKeys ends the install: the next probe mints a new identity', async () => {
    const store = durableMemoryKeyStore();
    const keys = createKeyManager({ keyStore: store });
    const before = await keys.signing();
    await keys.destroyAllKeys();
    expect((await keys.signing()).publicKeyId).not.toBe(before.publicKeyId);
  });
});

describe('memoryKeyStore', () => {
  it('is ephemeral unless a test explicitly claims otherwise', () => {
    expect(memoryKeyStore().durability).toBe('ephemeral');
    expect(memoryKeyStore({ claimDurability: 'persistent' }).durability).toBe('persistent');
  });
});
