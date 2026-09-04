/**
 * PLATE VAULT - fwm-plate/v1
 * =============================================================================
 * A licence plate is a local-only secret. It never appears in a notification, a
 * URL, a log line, a crash report, telemetry, zustand persistence or any request
 * body. This module is the only place a plate string is allowed to exist, and
 * only in memory, only for the moment a local match is being computed.
 *
 * AT REST
 *   AES-GCM-256 under a per-install key generated with `extractable: false`.
 *   The key lives in IndexedDB as a CryptoKey and cannot be read out of the
 *   browser. A FRESH 12-byte random IV is drawn for every single encryption, so
 *   sealing the same plate twice produces different ciphertext.
 *   Additional authenticated data is `fwm-plate/v1:<record id>`, which binds the
 *   ciphertext to its record: a ciphertext copied onto another record's id fails
 *   to decrypt instead of silently succeeding.
 *
 * MATCHING WITHOUT DECRYPTING
 *   Each record also stores a blind index: the first 16 bytes of
 *   HMAC-SHA-256(indexKey, "fwm-plate-index/v1:" + normalisedPlate), hex. The
 *   HMAC key is a second non-exportable per-install key. This makes equality
 *   matching against the local trip log and the community camera map possible
 *   without decrypting anything, and comparisons run in constant time.
 *   What it deliberately leaks, locally: two records holding the same plate have
 *   the same index. That is the feature. Because the index is keyed and the key
 *   is non-exportable, the index is useless off the device - a plate's short
 *   alphabet would otherwise be trivially brute-forced from an unkeyed hash.
 *
 * NOT IMPLEMENTED, ON PURPOSE
 *   No passphrase, no account, no recovery, no cloud backup, no sync. None of
 *   those appear in the supplied screens, and inventing one would mean inventing
 *   a place the plate could travel to. Clearing site data destroys the vault and
 *   that is the documented behaviour, not a bug.
 * =============================================================================
 */

import { constantTimeEqualHex, fromBase64Url, toBase64Url, toHex, utf8 } from './bytes';
import {
  PLATE_STORE_NAME,
  createKeyManager,
  hasIndexedDb,
  openCryptoDb,
  type CryptoAvailability,
  type KeyManager,
} from './keys';
import { randomUuid } from './chain';

export const PLATE_SCHEMA = 'fwm-plate/v1';
export const PLATE_AAD_PREFIX = 'fwm-plate/v1:';
export const PLATE_INDEX_PREFIX = 'fwm-plate-index/v1:';
/** AES-GCM nonce length in bytes. 96 bits is the value GCM is specified for. */
export const IV_LENGTH = 12;
/** Bytes of HMAC output kept as the blind index. 128 bits of collision margin. */
export const BLIND_INDEX_BYTES = 16;

/** What is stored. Nothing here reveals the plate without the vault key. */
export interface SealedPlate {
  readonly id: string;
  readonly schema: typeof PLATE_SCHEMA;
  /** base64url, 12 bytes, unique per record. */
  readonly iv: string;
  /** base64url AES-GCM output (ciphertext plus 16-byte tag). */
  readonly ciphertext: string;
  /** Keyed, truncated HMAC of the normalised plate. Hex, 32 characters. */
  readonly blindIndex: string;
  readonly createdAt: string;
}

/** A local hit. Carries no plate text - callers get an id, not a secret. */
export interface PlateMatch {
  readonly id: string;
  readonly createdAt: string;
}

/** Summary safe to render in a list before the user asks to reveal one. */
export interface SealedPlateSummary {
  readonly id: string;
  readonly createdAt: string;
}

export interface PlateExportEntry {
  readonly id: string;
  readonly createdAt: string;
  /** Cleartext. This is the whole point of an export, and its whole danger. */
  readonly plate: string;
}

export interface PlateExport {
  readonly schema: typeof PLATE_SCHEMA;
  readonly exportedAt: string;
  readonly warning: string;
  readonly entries: readonly PlateExportEntry[];
}

/** Thrown when an export is attempted without an explicit, literal confirmation. */
export class PlateExportNotConfirmedError extends Error {
  override readonly name = 'PlateExportNotConfirmedError';

  constructor() {
    super(
      'plate export requires { confirmed: true }; it decrypts every plate you have stored and hands them to the caller in cleartext',
    );
  }
}

/** Thrown when a plate string is empty once normalised. */
export class InvalidPlateError extends Error {
  override readonly name = 'InvalidPlateError';

  constructor() {
    // The message deliberately does not echo the input.
    super('plate contains no letters or digits');
  }
}

export interface SealedPlateStore {
  put(record: SealedPlate): Promise<void>;
  get(id: string): Promise<SealedPlate | undefined>;
  getAll(): Promise<SealedPlate[]>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Product store: the `plates` object store in the shared crypto database. */
export function indexedDbPlateStore(): SealedPlateStore {
  return {
    async put(record) {
      const db = await openCryptoDb();
      await db.put(PLATE_STORE_NAME, record);
    },
    async get(id) {
      const db = await openCryptoDb();
      const value: unknown = await db.get(PLATE_STORE_NAME, id);
      return value === undefined ? undefined : (value as SealedPlate);
    },
    async getAll() {
      const db = await openCryptoDb();
      const values: unknown = await db.getAll(PLATE_STORE_NAME);
      return Array.isArray(values) ? (values as SealedPlate[]) : [];
    },
    async remove(id) {
      const db = await openCryptoDb();
      await db.delete(PLATE_STORE_NAME, id);
    },
    async clear() {
      const db = await openCryptoDb();
      await db.clear(PLATE_STORE_NAME);
    },
  };
}

/** In-memory store. Used by tests, and by nothing else. */
export function memoryPlateStore(): SealedPlateStore {
  const rows = new Map<string, SealedPlate>();
  return {
    put: (record) => {
      rows.set(record.id, record);
      return Promise.resolve();
    },
    get: (id) => Promise.resolve(rows.get(id)),
    getAll: () => Promise.resolve([...rows.values()]),
    remove: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      rows.clear();
      return Promise.resolve();
    },
  };
}

export interface PlateVaultOptions {
  readonly keys?: KeyManager;
  readonly store?: SealedPlateStore;
  readonly now?: () => number;
  readonly newId?: () => string;
}

export interface PlateVault {
  availability(): Promise<CryptoAvailability>;
  /** Encrypt and store one plate. Returns the sealed record, never the plate. */
  seal(plate: string): Promise<SealedPlate>;
  /** Decrypt into memory. Callers must not persist, log or transmit the result. */
  open(sealed: SealedPlate): Promise<string>;
  openById(id: string): Promise<string | undefined>;
  /** Ids and timestamps only. Safe to render before the user reveals anything. */
  list(): Promise<SealedPlateSummary[]>;
  /** Local equality match by blind index. Returns ids, never plate text. */
  matchAgainst(candidate: string): Promise<PlateMatch[]>;
  /** Blind index for a candidate, so a caller can match a batch itself. */
  blindIndexOf(candidate: string): Promise<string>;
  remove(id: string): Promise<void>;
  /**
   * Decrypts every stored plate. Refuses to run without `{ confirmed: true }`,
   * so no code path can trigger an export as a side effect of something else.
   */
  exportPlatesWithWarning(options: { readonly confirmed: true }): Promise<PlateExport>;
  /** Deletes ciphertext, the vault key, the index key and the match indexes. */
  destroyVault(): Promise<void>;
}

/**
 * GAP: see DESIGN-GAPS.md#plate-export-warning-copy-unspecified
 *
 * No supplied screen draws a plate export, so no warning copy exists to quote.
 * `EXPORT JSON` / `EXPORT CSV` in Screens II belong to DEAD DROP (evidence),
 * not to the vault. This string is written in the product voice as a stand-in
 * and must be replaced with real copy before any export UI ships.
 */
export const EXPORT_WARNING =
  'this file holds your plates in the clear. anything that can read the file can read them. once it leaves the device the app cannot take it back.';

/**
 * Normalisation used for matching and for the blind index: NFC, uppercase
 * (locale-independent), then everything that is not A-Z or 0-9 removed. The
 * ORIGINAL string is what gets encrypted, so nothing the user typed is lost.
 */
export function normalisePlate(plate: string): string {
  const normalised = plate.normalize('NFC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalised === '') throw new InvalidPlateError();
  return normalised;
}

export function createPlateVault(options: PlateVaultOptions = {}): PlateVault {
  const keys = options.keys ?? createKeyManager();
  const store = options.store ?? (hasIndexedDb() ? indexedDbPlateStore() : memoryPlateStore());
  const now = options.now ?? (() => Date.now());

  async function computeBlindIndex(candidate: string): Promise<string> {
    const deps = await keys.requireDeps();
    const indexKey = await keys.plateIndexKey();
    const message = utf8(`${PLATE_INDEX_PREFIX}${normalisePlate(candidate)}`);
    const mac = new Uint8Array(
      await deps.subtle.sign('HMAC', indexKey, message as BufferSource),
    ).slice(0, BLIND_INDEX_BYTES);
    return toHex(mac);
  }

  async function decrypt(sealed: SealedPlate): Promise<string> {
    const deps = await keys.requireDeps();
    const vaultKey = await keys.plateVaultKey();
    const plaintext = await deps.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64Url(sealed.iv) as BufferSource,
        additionalData: utf8(`${PLATE_AAD_PREFIX}${sealed.id}`) as BufferSource,
      },
      vaultKey,
      fromBase64Url(sealed.ciphertext) as BufferSource,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(plaintext));
  }

  return {
    availability: () => keys.availability(),

    async seal(plate) {
      const deps = await keys.requireDeps();
      const vaultKey = await keys.plateVaultKey();
      normalisePlate(plate); // reject an unusable plate before anything is stored

      const id = (options.newId ?? (() => randomUuid(deps.randomBytes)))();
      const iv = deps.randomBytes(IV_LENGTH);
      const ciphertext = await deps.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv as BufferSource,
          additionalData: utf8(`${PLATE_AAD_PREFIX}${id}`) as BufferSource,
        },
        vaultKey,
        utf8(plate) as BufferSource,
      );

      const record: SealedPlate = Object.freeze({
        id,
        schema: PLATE_SCHEMA,
        iv: toBase64Url(iv),
        ciphertext: toBase64Url(new Uint8Array(ciphertext)),
        blindIndex: await computeBlindIndex(plate),
        createdAt: new Date(now()).toISOString(),
      });
      await store.put(record);
      return record;
    },

    open: (sealed) => decrypt(sealed),

    async openById(id) {
      const sealed = await store.get(id);
      return sealed === undefined ? undefined : decrypt(sealed);
    },

    async list() {
      const rows = await store.getAll();
      return rows
        .map((row) => ({ id: row.id, createdAt: row.createdAt }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    },

    async matchAgainst(candidate) {
      const index = await computeBlindIndex(candidate);
      const rows = await store.getAll();
      return rows
        .filter((row) => constantTimeEqualHex(row.blindIndex, index))
        .map((row) => ({ id: row.id, createdAt: row.createdAt }));
    },

    blindIndexOf: (candidate) => computeBlindIndex(candidate),

    remove: (id) => store.remove(id),

    async exportPlatesWithWarning(exportOptions) {
      // Checked at runtime as well as in the type: a caller reaching this from
      // untyped code must still pass the literal.
      if (exportOptions.confirmed !== true) throw new PlateExportNotConfirmedError();
      const rows = await store.getAll();
      const entries: PlateExportEntry[] = [];
      for (const row of rows) {
        entries.push({ id: row.id, createdAt: row.createdAt, plate: await decrypt(row) });
      }
      return {
        schema: PLATE_SCHEMA,
        exportedAt: new Date(now()).toISOString(),
        warning: EXPORT_WARNING,
        entries,
      };
    },

    async destroyVault() {
      await store.clear();
      await keys.destroyPlateKeys();
    },
  };
}
