/**
 * The encrypted plate vault. CIPHERTEXT ONLY, ENFORCED AT THE WRITE.
 *
 * A comment saying "never store a plate here" is not a control. This file is
 * the control: every write goes through `assertPlateVaultRecordSafe()`, which
 * refuses anything that is not exactly the sealed shape - an exact field
 * allowlist, a format check per field, and a plate-shaped-string check on top.
 * A field nobody anticipated is how a plate gets into a database in the clear,
 * so an unanticipated field is a rejected write, not a stored one.
 *
 * WHAT IS ACTUALLY IN A ROW
 *   plateId     a random UUID, never derived from the plate
 *   ciphertext  base64url AES-GCM output, tag included
 *   iv          base64url, 12 bytes, unique per record
 *   blindIndex  a keyed, truncated HMAC - useless without the vault key, and
 *               the only reason local equality matching is possible at all
 *   keyId       which non-exportable key sealed it. Never key material.
 *   counts and timestamps, which are not plates
 *
 * WHY NO INDEX ON THIS STORE. An index is an ordering an attacker with the
 * file can query. The vault is read by id or read whole; neither needs one.
 *
 * `createSealedPlateStore()` makes this repository a drop-in `SealedPlateStore`
 * for `createPlateVault()` in `services/crypto/plate.ts`, so the vault stores
 * into the `fwm` database and `clearLocalData()` can genuinely clear it.
 */

import { PLATE_SCHEMA } from '../../crypto/plate.ts';
import type { SealedPlate, SealedPlateStore } from '../../crypto/plate.ts';
import { PLATE_VAULT_KEY_ID } from '../../crypto/keys.ts';
import type { PlateVaultRecord } from '../schema.ts';
import { PLATE_VAULT_FIELDS } from '../schema.ts';
import type { FwmDatabase, RepositoryDeps } from './support.ts';
import { RepositoryError, resolveDeps } from './support.ts';

// ---------------------------------------------------------------------------
// The plate-shaped-string detector
// ---------------------------------------------------------------------------

/** One unbroken run of alphanumerics, with where it sat in the string. */
interface AlnumRun {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const ALNUM_RUN_RE = /[A-Z0-9]+/g;

function runsOf(upper: string): AlnumRun[] {
  const runs: AlnumRun[] = [];
  ALNUM_RUN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ALNUM_RUN_RE.exec(upper)) !== null) {
    runs.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return runs;
}

/**
 * Five to eight alphanumerics with at least one letter and at least one digit.
 *
 * The design's own examples set the shape: "HVK 8842", "471 TRB", "TR 90144"
 * (`Flockys Screens II.dc.html` B5 · WATCHLIST) compact to seven, six and
 * seven characters of mixed letters and digits, which is what North American
 * plates look like across essentially every jurisdiction.
 *
 * Letters-only is not a plate here (it matches too many ordinary words), and
 * nine or more is not either (that is a hash, a base64 chunk or a UUID).
 */
function isPlateShaped(compact: string): boolean {
  if (compact.length < 5 || compact.length > 8) return false;
  if (!/[A-Z]/.test(compact)) return false;
  if (!/[0-9]/.test(compact)) return false;
  return true;
}

/**
 * Does this string contain something shaped like a licence plate?
 *
 * Scans single alphanumeric runs and adjacent pairs joined by exactly one
 * space or hyphen - "HVK 8842" and "HVK-8842" are two runs, "HVK8842" is one,
 * and all three are the same plate. Pairs stop at two because three-group
 * candidates start swallowing ordinary hyphenated identifiers.
 *
 * KNOWN FALSE POSITIVE, ON PURPOSE. A bare UUID segment ("3f2504e0") is eight
 * mixed characters and trips this check. That is why identity fields are gated
 * by exact format patterns - `UUID_RE`, `HEX32_RE`, `BASE64URL_RE` - and this
 * heuristic is never the gate on them. It gates genuinely free text, where
 * biting too eagerly costs a user one retyped handle and biting too late costs
 * them the secret this product exists to protect.
 */
export function looksLikePlate(text: string): boolean {
  const upper = text.toUpperCase();
  const runs = runsOf(upper);
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run === undefined) continue;
    if (isPlateShaped(run.text)) return true;
    const next = runs[i + 1];
    if (next === undefined) continue;
    const gap = upper.slice(run.end, next.start);
    if (gap !== ' ' && gap !== '-') continue;
    if (isPlateShaped(run.text + next.text)) return true;
  }
  return false;
}

/**
 * The single-run half of the check, for hyphenated machine identifiers.
 *
 * `plate-vault-aes-gcm-v1` contains the adjacent pair "gcm-v1", which is five
 * mixed characters and would trip `looksLikePlate`. A key id is not free text,
 * so it gets the narrower check: it catches `keyId: "HVK8842"` and leaves the
 * product's real key identifiers alone.
 */
export function looksLikePlateToken(text: string): boolean {
  return runsOf(text.toUpperCase()).some((run) => isPlateShaped(run.text));
}

// ---------------------------------------------------------------------------
// The write assertion
// ---------------------------------------------------------------------------

export class PlateVaultWriteError extends RepositoryError {
  constructor(
    message: string,
    readonly field: string,
  ) {
    // The message never echoes the offending value. An exception message is a
    // log line, a crash report and a bug ticket waiting to happen, and this
    // one is raised precisely when the value might be a plate.
    super(message, 'plateVault');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const HEX32_RE = /^[0-9a-f]{32}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const KEY_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** 12-byte IV, unpadded base64url, is exactly 16 characters. */
const IV_LENGTH_CHARS = 16;
/** Shortest possible AES-GCM output is a 16-byte tag: 22 base64url characters. */
const MIN_CIPHERTEXT_CHARS = 22;

function reject(field: string, why: string, value: unknown): never {
  const plateShaped = typeof value === 'string' && looksLikePlate(value);
  throw new PlateVaultWriteError(
    plateShaped
      ? `plateVault write rejected: ${field} ${why}, and its value is shaped like a licence plate. ` +
          'The vault stores ciphertext. Seal the plate first.'
      : `plateVault write rejected: ${field} ${why}`,
    field,
  );
}

/**
 * Reject any write that is not exactly a sealed record.
 *
 * Order matters. The field allowlist runs first, because an extra field is the
 * failure mode that actually happens - somebody adds `plate` "just for
 * debugging", or spreads a form object into the record. Format checks run
 * second. The plate-shaped-string check is folded into the rejection path so
 * that a value that is both malformed and plate-shaped says so.
 */
export function assertPlateVaultRecordSafe(value: unknown): asserts value is PlateVaultRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject('<record>', 'is not an object', value);
  }
  const record = value as Record<string, unknown>;

  const allowed = new Set<string>(PLATE_VAULT_FIELDS);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      reject(key, 'is not a field of a sealed plate record', record[key]);
    }
  }
  for (const field of PLATE_VAULT_FIELDS) {
    if (!(field in record)) reject(field, 'is missing', undefined);
  }

  // Nothing nested. A nested object or array is a place a plate can hide from
  // a field-by-field check.
  for (const [field, item] of Object.entries(record)) {
    if (item !== null && typeof item === 'object') {
      reject(field, 'must be a string or a number, not a nested value', item);
    }
  }

  const {
    plateId,
    schema,
    iv,
    ciphertext,
    blindIndex,
    createdAt,
    keyId,
    updatedAt,
    readCount,
  } = record;

  if (typeof plateId !== 'string' || !UUID_RE.test(plateId)) {
    reject('plateId', 'must be a lowercase UUID that is not derived from the plate', plateId);
  }
  if (schema !== PLATE_SCHEMA) {
    reject('schema', `must be ${PLATE_SCHEMA}`, schema);
  }
  if (typeof iv !== 'string' || !BASE64URL_RE.test(iv) || iv.length !== IV_LENGTH_CHARS) {
    reject('iv', 'must be a 12-byte base64url nonce', iv);
  }
  if (
    typeof ciphertext !== 'string' ||
    !BASE64URL_RE.test(ciphertext) ||
    ciphertext.length < MIN_CIPHERTEXT_CHARS
  ) {
    reject('ciphertext', 'must be base64url AES-GCM output including the tag', ciphertext);
  }
  if (typeof blindIndex !== 'string' || !HEX32_RE.test(blindIndex)) {
    reject('blindIndex', 'must be a 32-character hex blind index', blindIndex);
  }
  if (typeof createdAt !== 'string' || !ISO_RE.test(createdAt)) {
    reject('createdAt', 'must be an ISO-8601 UTC timestamp', createdAt);
  }
  if (typeof keyId !== 'string' || !KEY_ID_RE.test(keyId) || looksLikePlateToken(keyId)) {
    reject('keyId', 'must be an opaque key identifier', keyId);
  }
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    reject('updatedAt', 'must be a finite epoch-millisecond number', updatedAt);
  }
  if (typeof readCount !== 'number' || !Number.isInteger(readCount) || readCount < 0) {
    reject('readCount', 'must be a non-negative integer', readCount);
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface PlateVaultRepository {
  /** Validates, then writes. Throws `PlateVaultWriteError` on anything else. */
  put(record: PlateVaultRecord): Promise<void>;
  /** Store a sealed record from the crypto vault, preserving its read count. */
  putSealed(sealed: SealedPlate, keyId?: string): Promise<PlateVaultRecord>;
  get(plateId: string): Promise<PlateVaultRecord | undefined>;
  all(): Promise<PlateVaultRecord[]>;
  /** Ids and read counts only - enough for WATCHLIST, no ciphertext moved. */
  summaries(): Promise<{ plateId: string; createdAt: string; readCount: number }[]>;
  bumpReadCount(plateId: string, by?: number): Promise<PlateVaultRecord | undefined>;
  remove(plateId: string): Promise<boolean>;
  count(): Promise<number>;
  clear(): Promise<number>;
  /** A `SealedPlateStore` backed by this store, for `createPlateVault()`. */
  asSealedPlateStore(): SealedPlateStore;
}

export function createPlateVaultRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps> & { readonly keyId?: string },
): PlateVaultRepository {
  const deps = resolveDeps(overrides);
  const defaultKeyId = overrides?.keyId ?? PLATE_VAULT_KEY_ID;

  function toSealed(record: PlateVaultRecord): SealedPlate {
    return {
      id: record.plateId,
      schema: record.schema,
      iv: record.iv,
      ciphertext: record.ciphertext,
      blindIndex: record.blindIndex,
      createdAt: record.createdAt,
    };
  }

  const repository: PlateVaultRepository = {
    async put(record) {
      assertPlateVaultRecordSafe(record);
      await db.put('plateVault', record);
    },

    async putSealed(sealed, keyId = defaultKeyId) {
      const existing = await db.get('plateVault', sealed.id);
      const record: PlateVaultRecord = {
        plateId: sealed.id,
        schema: sealed.schema,
        iv: sealed.iv,
        ciphertext: sealed.ciphertext,
        blindIndex: sealed.blindIndex,
        createdAt: sealed.createdAt,
        keyId,
        updatedAt: deps.now(),
        readCount: existing?.readCount ?? 0,
      };
      await repository.put(record);
      return record;
    },

    get(plateId) {
      return db.get('plateVault', plateId);
    },

    all() {
      return db.getAll('plateVault');
    },

    async summaries() {
      const rows = await db.getAll('plateVault');
      return rows.map((row) => ({
        plateId: row.plateId,
        createdAt: row.createdAt,
        readCount: row.readCount,
      }));
    },

    async bumpReadCount(plateId, by = 1) {
      const tx = db.transaction('plateVault', 'readwrite');
      const existing = await tx.store.get(plateId);
      if (existing === undefined) {
        await tx.done;
        return undefined;
      }
      const updated: PlateVaultRecord = {
        ...existing,
        readCount: existing.readCount + by,
        updatedAt: deps.now(),
      };
      assertPlateVaultRecordSafe(updated);
      void tx.store.put(updated);
      await tx.done;
      return updated;
    },

    async remove(plateId) {
      const existed = (await db.get('plateVault', plateId)) !== undefined;
      await db.delete('plateVault', plateId);
      return existed;
    },

    count() {
      return db.count('plateVault');
    },

    async clear() {
      const total = await db.count('plateVault');
      await db.clear('plateVault');
      return total;
    },

    asSealedPlateStore(): SealedPlateStore {
      return {
        async put(sealed) {
          await repository.putSealed(sealed);
        },
        async get(id) {
          const row = await db.get('plateVault', id);
          return row === undefined ? undefined : toSealed(row);
        },
        async getAll() {
          const rows = await db.getAll('plateVault');
          return rows.map(toSealed);
        },
        async remove(id) {
          await repository.remove(id);
        },
        async clear() {
          await repository.clear();
        },
      };
    },
  };

  return repository;
}
