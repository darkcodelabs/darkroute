/**
 * Per-install key material, and the honest capability probe that gates it.
 *
 * WHAT THIS FILE PROMISES
 *   - The evidence signing key is ECDSA P-256 and is generated with
 *     `extractable: false`. Its private half cannot leave the browser: there is
 *     no export path, no passphrase, no recovery, no backend copy. If the user
 *     clears site data the key is gone and a new chain starts at genesis.
 *   - The public half IS exportable (the WebCrypto spec forces this for
 *     generateKey) and is what the backend uses to verify a submitted chain.
 *   - Keys are persisted as live `CryptoKey` objects through IndexedDB's
 *     structured clone. That support is DETECTED by round-tripping a real key
 *     and then signing with the copy that came back - not assumed.
 *
 * WHAT THIS FILE REFUSES TO PROMISE
 *   If Web Crypto is missing, the algorithms are unsupported, the context is
 *   insecure, IndexedDB is absent, or a key cannot survive the round trip, the
 *   probe returns `{ status: 'unavailable', reason, detail }` and every method
 *   that would produce a signature throws `CryptoUnavailableError`. Nothing in
 *   this module ever degrades to "unsigned but shaped like signed".
 *
 * PRIVACY
 *   `publicKeyId` is a stable pseudonymous per-install identifier. It is safe to
 *   put in an evidence record (the record is the thing being attested) and
 *   unsafe to join against anything else. It is never a user id.
 */

import { openDB, type IDBPDatabase } from 'idb';
import { sha256Hex, toBase64Url } from './bytes';

/** IndexedDB database that holds key material and plate ciphertext. */
export const CRYPTO_DB_NAME = 'fwm-crypto';
export const CRYPTO_DB_VERSION = 1;
export const KEY_STORE_NAME = 'keys';
export const PLATE_STORE_NAME = 'plates';

export const SIGNING_PRIVATE_KEY_ID = 'evidence-signing-private-v1';
export const SIGNING_PUBLIC_KEY_ID = 'evidence-signing-public-v1';
export const PLATE_VAULT_KEY_ID = 'plate-vault-aes-gcm-v1';
export const PLATE_INDEX_KEY_ID = 'plate-blind-index-hmac-v1';

/** ECDSA over P-256. The signature is raw r||s, 64 bytes, never DER. */
export const SIGNING_ALGORITHM: EcKeyGenParams & EcKeyImportParams = {
  name: 'ECDSA',
  namedCurve: 'P-256',
};
export const SIGNING_PARAMS: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };
export const VAULT_ALGORITHM: AesKeyGenParams = { name: 'AES-GCM', length: 256 };
export const INDEX_ALGORITHM: HmacKeyGenParams = { name: 'HMAC', hash: 'SHA-256' };

/**
 * Whether a key store survives a page reload.
 *
 * `persistent` is a claim about the backing store, and only `indexedDbKeyStore`
 * makes it in product code. The key manager refuses to sign anything when the
 * store it was handed is `ephemeral`, because a signature made with a key that
 * dies at the end of the session cannot be verified against tomorrow's chain.
 */
export type KeyDurability = 'persistent' | 'ephemeral';

export type KeyStoreKind = 'indexeddb' | 'memory';

export interface PersistentKeyStore {
  readonly kind: KeyStoreKind;
  readonly durability: KeyDurability;
  get(id: string): Promise<CryptoKey | undefined>;
  put(id: string, key: CryptoKey): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type CryptoUnavailableReason =
  | 'no-web-crypto'
  | 'no-subtle-crypto'
  | 'insecure-context'
  | 'algorithm-unsupported'
  | 'key-generation-failed'
  | 'no-persistent-key-storage'
  | 'key-storage-failed'
  | 'key-not-cloneable';

export type CryptoAvailability =
  | {
      readonly status: 'available';
      readonly publicKeyId: string;
      readonly storage: KeyStoreKind;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: CryptoUnavailableReason;
      readonly detail: string;
    };

/**
 * Thrown by anything that would otherwise have to pretend. Carries the probe
 * result so the UI can render the exact unavailable state rather than "error".
 */
export class CryptoUnavailableError extends Error {
  override readonly name = 'CryptoUnavailableError';
  readonly reason: CryptoUnavailableReason;
  readonly detail: string;

  constructor(availability: Extract<CryptoAvailability, { status: 'unavailable' }>) {
    super(`crypto unavailable: ${availability.reason} - ${availability.detail}`);
    this.reason = availability.reason;
    this.detail = availability.detail;
  }
}

export interface SigningKeys {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  /** SHA-256 of the SPKI bytes, lowercase hex. Verifiable by anyone. */
  readonly publicKeyId: string;
  /** base64url of the SPKI DER. Travels with the record so it is self-verifying. */
  readonly publicKeySpki: string;
}

export interface CryptoDeps {
  readonly subtle: SubtleCrypto;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly keyStore: PersistentKeyStore;
}

export interface KeyManager {
  /** Cached capability probe. Call it before showing any "signed" affordance. */
  availability(): Promise<CryptoAvailability>;
  /** Throws CryptoUnavailableError unless availability() is 'available'. */
  requireDeps(): Promise<CryptoDeps>;
  /** Throws CryptoUnavailableError unless availability() is 'available'. */
  signing(): Promise<SigningKeys>;
  /** AES-GCM vault key. Created lazily, on first plate only. */
  plateVaultKey(): Promise<CryptoKey>;
  /** HMAC key for the blind index. Created lazily, on first plate only. */
  plateIndexKey(): Promise<CryptoKey>;
  /** Destroys plate keys only. The evidence chain is untouched. */
  destroyPlateKeys(): Promise<void>;
  /** Destroys every key, including the signing key. Ends the evidence chain. */
  destroyAllKeys(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Key stores
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase> | null = null;

/** Opens (and upgrades) the shared crypto database. */
export function openCryptoDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(CRYPTO_DB_NAME, CRYPTO_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) db.createObjectStore(KEY_STORE_NAME);
      if (!db.objectStoreNames.contains(PLATE_STORE_NAME)) {
        db.createObjectStore(PLATE_STORE_NAME, { keyPath: 'id' });
      }
    },
  });
  return dbPromise;
}

/** Forget the cached connection. Used after the database is deleted. */
export function resetCryptoDbHandle(): void {
  dbPromise = null;
}

/** True only when this runtime actually exposes IndexedDB. */
export function hasIndexedDb(): boolean {
  return typeof (globalThis as { indexedDB?: IDBFactory }).indexedDB !== 'undefined';
}

/** The product key store. CryptoKey values are stored by structured clone. */
export function indexedDbKeyStore(): PersistentKeyStore {
  return {
    kind: 'indexeddb',
    durability: 'persistent',
    async get(id) {
      const db = await openCryptoDb();
      const value: unknown = await db.get(KEY_STORE_NAME, id);
      return value === undefined ? undefined : (value as CryptoKey);
    },
    async put(id, key) {
      const db = await openCryptoDb();
      await db.put(KEY_STORE_NAME, key, id);
    },
    async remove(id) {
      const db = await openCryptoDb();
      await db.delete(KEY_STORE_NAME, id);
    },
    async clear() {
      const db = await openCryptoDb();
      await db.clear(KEY_STORE_NAME);
    },
  };
}

export interface MemoryKeyStoreOptions {
  /**
   * TEST HARNESS ONLY. Node has no IndexedDB, so the unit tests cannot exercise
   * the signing path through the real store; passing `'persistent'` lets an
   * in-memory store stand in. Product code must never pass this - grep for it:
   * it appears in this file and in `*.test.ts`, nowhere else.
   */
  readonly claimDurability?: KeyDurability;
}

/** Non-durable key store. Signing with it is refused unless a test says otherwise. */
export function memoryKeyStore(options: MemoryKeyStoreOptions = {}): PersistentKeyStore {
  const map = new Map<string, CryptoKey>();
  return {
    kind: 'memory',
    durability: options.claimDurability ?? 'ephemeral',
    get: (id) => Promise.resolve(map.get(id)),
    put: (id, key) => {
      map.set(id, key);
      return Promise.resolve();
    },
    remove: (id) => {
      map.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      map.clear();
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Key manager
// ---------------------------------------------------------------------------

export interface KeyManagerOptions {
  readonly subtle?: SubtleCrypto;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly keyStore?: PersistentKeyStore;
}

function unavailable(
  reason: CryptoUnavailableReason,
  detail: string,
): Extract<CryptoAvailability, { status: 'unavailable' }> {
  return { status: 'unavailable', reason, detail };
}

function ambientCrypto(): Crypto | undefined {
  return (globalThis as { crypto?: Crypto }).crypto;
}

export function createKeyManager(options: KeyManagerOptions = {}): KeyManager {
  let probe: Promise<CryptoAvailability> | null = null;
  let resolved: { deps: CryptoDeps; signing: SigningKeys } | null = null;

  function resolveSubtle(): SubtleCrypto | Extract<CryptoAvailability, { status: 'unavailable' }> {
    if (options.subtle !== undefined) return options.subtle;
    const ambient = ambientCrypto();
    if (ambient === undefined) {
      return unavailable('no-web-crypto', 'globalThis.crypto is not present in this runtime');
    }
    const subtle: SubtleCrypto | undefined = (ambient as { subtle?: SubtleCrypto }).subtle;
    if (subtle === undefined) {
      return unavailable(
        'no-subtle-crypto',
        'crypto.subtle is not present; browsers expose it only in a secure context',
      );
    }
    return subtle;
  }

  function resolveRandom(): ((length: number) => Uint8Array) | null {
    if (options.randomBytes !== undefined) return options.randomBytes;
    const ambient = ambientCrypto();
    if (ambient === undefined || typeof ambient.getRandomValues !== 'function') return null;
    return (length: number) => ambient.getRandomValues(new Uint8Array(length));
  }

  function resolveStore(): PersistentKeyStore | null {
    if (options.keyStore !== undefined) return options.keyStore;
    if (!hasIndexedDb()) return null;
    return indexedDbKeyStore();
  }

  async function runProbe(): Promise<CryptoAvailability> {
    const secureContext = (globalThis as { isSecureContext?: boolean }).isSecureContext;
    if (secureContext === false) {
      return unavailable(
        'insecure-context',
        'the page is not a secure context; Web Crypto keys must not be trusted here',
      );
    }

    const subtleOrFailure = resolveSubtle();
    if ('status' in subtleOrFailure) return subtleOrFailure;
    const subtle = subtleOrFailure;

    const randomBytes = resolveRandom();
    if (randomBytes === null) {
      return unavailable('no-web-crypto', 'crypto.getRandomValues is not available');
    }

    const keyStore = resolveStore();
    if (keyStore === null) {
      return unavailable(
        'no-persistent-key-storage',
        'IndexedDB is not available, so a signing key cannot outlive this page',
      );
    }
    if (keyStore.durability !== 'persistent') {
      return unavailable(
        'no-persistent-key-storage',
        `key store "${keyStore.kind}" does not survive a reload; a signature made with it is not evidence`,
      );
    }

    let signing: SigningKeys;
    try {
      signing = await loadOrCreateSigningKeys(subtle, keyStore);
    } catch (cause) {
      return classifyKeyFailure(cause);
    }

    // Prove the stored key still works after the round trip, rather than
    // trusting that a CryptoKey came back intact.
    try {
      const probeBytes = randomBytes(32);
      const signature = await subtle.sign(
        SIGNING_PARAMS,
        signing.privateKey,
        probeBytes as BufferSource,
      );
      const ok = await subtle.verify(
        SIGNING_PARAMS,
        signing.publicKey,
        signature,
        probeBytes as BufferSource,
      );
      if (!ok) {
        return unavailable(
          'key-not-cloneable',
          'the persisted key pair no longer verifies its own signature',
        );
      }
    } catch (cause) {
      return unavailable('key-storage-failed', `stored key is unusable: ${String(cause)}`);
    }

    resolved = { deps: { subtle, randomBytes, keyStore }, signing };
    return { status: 'available', publicKeyId: signing.publicKeyId, storage: keyStore.kind };
  }

  async function availability(): Promise<CryptoAvailability> {
    probe ??= runProbe();
    const result = await probe;
    if (result.status === 'unavailable') probe = null; // let the caller retry after a fix
    return result;
  }

  async function requireReady(): Promise<{ deps: CryptoDeps; signing: SigningKeys }> {
    const status = await availability();
    if (status.status === 'unavailable') throw new CryptoUnavailableError(status);
    if (resolved === null) {
      throw new CryptoUnavailableError(
        unavailable('key-storage-failed', 'probe reported available but produced no key material'),
      );
    }
    return resolved;
  }

  async function symmetricKey(
    id: string,
    create: (subtle: SubtleCrypto) => Promise<CryptoKey>,
  ): Promise<CryptoKey> {
    const { deps } = await requireReady();
    const existing = await deps.keyStore.get(id);
    if (existing !== undefined) return existing;
    const created = await create(deps.subtle);
    await deps.keyStore.put(id, created);
    const stored = await deps.keyStore.get(id);
    if (stored === undefined) {
      throw new CryptoUnavailableError(
        unavailable('key-storage-failed', `key ${id} did not survive being written`),
      );
    }
    return stored;
  }

  return {
    availability,
    requireDeps: async () => (await requireReady()).deps,
    signing: async () => (await requireReady()).signing,
    plateVaultKey: () =>
      symmetricKey(PLATE_VAULT_KEY_ID, (subtle) =>
        subtle.generateKey(VAULT_ALGORITHM, false, ['encrypt', 'decrypt']),
      ),
    plateIndexKey: () =>
      symmetricKey(PLATE_INDEX_KEY_ID, (subtle) =>
        subtle.generateKey(INDEX_ALGORITHM, false, ['sign']),
      ),
    async destroyPlateKeys() {
      const store = resolveStore();
      if (store === null) return;
      await store.remove(PLATE_VAULT_KEY_ID);
      await store.remove(PLATE_INDEX_KEY_ID);
    },
    async destroyAllKeys() {
      const store = resolveStore();
      probe = null;
      resolved = null;
      if (store === null) return;
      await store.clear();
    },
  };
}

async function loadOrCreateSigningKeys(
  subtle: SubtleCrypto,
  keyStore: PersistentKeyStore,
): Promise<SigningKeys> {
  const existingPrivate = await keyStore.get(SIGNING_PRIVATE_KEY_ID);
  const existingPublic = await keyStore.get(SIGNING_PUBLIC_KEY_ID);
  if (existingPrivate !== undefined && existingPublic !== undefined) {
    return describeSigningKeys(subtle, existingPrivate, existingPublic);
  }

  const pair = await subtle.generateKey(SIGNING_ALGORITHM, false, ['sign', 'verify']);
  // `extractable: false` applies to the private half only; the WebCrypto spec
  // forces publicKey.extractable to true, which is what lets us export SPKI.
  if (pair.privateKey.extractable) {
    throw new CryptoUnavailableError(
      unavailable(
        'key-generation-failed',
        'the runtime produced an extractable private key; refusing to use it',
      ),
    );
  }
  await keyStore.put(SIGNING_PRIVATE_KEY_ID, pair.privateKey);
  await keyStore.put(SIGNING_PUBLIC_KEY_ID, pair.publicKey);

  const storedPrivate = await keyStore.get(SIGNING_PRIVATE_KEY_ID);
  const storedPublic = await keyStore.get(SIGNING_PUBLIC_KEY_ID);
  if (storedPrivate === undefined || storedPublic === undefined) {
    throw new CryptoUnavailableError(
      unavailable('key-not-cloneable', 'the key pair could not be read back after being stored'),
    );
  }
  return describeSigningKeys(subtle, storedPrivate, storedPublic);
}

async function describeSigningKeys(
  subtle: SubtleCrypto,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<SigningKeys> {
  const spki = new Uint8Array(await subtle.exportKey('spki', publicKey));
  return {
    privateKey,
    publicKey,
    publicKeyId: await sha256Hex(subtle, spki),
    publicKeySpki: toBase64Url(spki),
  };
}

function classifyKeyFailure(
  cause: unknown,
): Extract<CryptoAvailability, { status: 'unavailable' }> {
  if (cause instanceof CryptoUnavailableError) {
    return unavailable(cause.reason, cause.detail);
  }
  // DOMException is not an `instanceof Error` in every runtime, and the name is
  // the only thing that distinguishes "cannot clone a CryptoKey" from "this
  // browser has no P-256". Read it structurally.
  const name =
    typeof cause === 'object' && cause !== null && typeof (cause as { name?: unknown }).name === 'string'
      ? (cause as { name: string }).name
      : '';
  const detail = String(cause);
  if (name === 'DataCloneError') {
    return unavailable(
      'key-not-cloneable',
      `this browser cannot structured-clone a CryptoKey into IndexedDB: ${detail}`,
    );
  }
  if (name === 'NotSupportedError') {
    return unavailable('algorithm-unsupported', `ECDSA P-256 is not supported here: ${detail}`);
  }
  return unavailable('key-generation-failed', detail);
}

/**
 * Ambient capability probe with no options: what a fresh install would get.
 * Prefer `createKeyManager().availability()` when you already hold a manager.
 */
export function cryptoAvailability(options: KeyManagerOptions = {}): Promise<CryptoAvailability> {
  return createKeyManager(options).availability();
}
