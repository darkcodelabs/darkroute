/**
 * EVIDENCE CHAIN - fwm-evidence/v1
 * =============================================================================
 * "Reports are signed the moment you file them and held until you're on WiFi.
 *  Nothing is edited after the fact." - DEAD DROP, DarkRoute Screens II (B2)
 *
 * Each record commits to the record before it, so the ORDER of a queue held
 * offline for weeks is provable without a server. The rules below are normative;
 * a backend that follows them reproduces every hash byte for byte.
 *
 * -- payload_hash -------------------------------------------------------------
 *   payload_hash = SHA-256( canonicalBytes(payload) )
 * where canonicalBytes is fwm-canonical-json/v1, specified in canonicalize.ts.
 * Stored lowercase hex.
 *
 * -- chain_hash ---------------------------------------------------------------
 *   chain_hash = SHA-256( P || H || C || R )
 *     P = previous_chain_hash decoded from hex   -> exactly 32 raw bytes
 *     H = payload_hash        decoded from hex   -> exactly 32 raw bytes
 *     C = captured_at as UTF-8                   -> exactly 24 bytes
 *     R = report_id as UTF-8                     -> exactly 36 bytes
 *   Total preimage: 124 bytes. Concatenation is bare - no separators, no length
 *   prefixes, no JSON - and that is safe ONLY because all four fields have a
 *   fixed length, which is why the formats are validated before hashing:
 *     captured_at  ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$  (UTC, ms, "Z")
 *     report_id    ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
 *   Stored lowercase hex.
 *
 * -- genesis ------------------------------------------------------------------
 * The first record's previous_chain_hash is GENESIS_CHAIN_HASH, a fixed
 * constant = SHA-256(GENESIS_PREIMAGE) with the preimage written out below so
 * anyone can recompute it. It is domain-separated rather than all-zeros so a
 * genesis link can never be confused with a zeroed or truncated field.
 *
 * -- signature ----------------------------------------------------------------
 * The signed message is the 32 RAW BYTES of chain_hash (not its hex text).
 * WebCrypto's ECDSA applies SHA-256 to the message, so the value actually
 * signed is SHA-256(chain_hash_bytes). The signature is raw r||s, 64 bytes,
 * stored base64url unpadded. A server using a DER-expecting library must
 * convert r||s to DER before verifying.
 *
 * -- immutability -------------------------------------------------------------
 * A finalised record is deep-frozen and has NO update operation. A correction
 * is a NEW record whose `supersedes` names the record it replaces; the
 * superseded record stays in the chain forever. The single exception is
 * `syncState`, which is transport bookkeeping, is NOT part of any hash and NOT
 * covered by the signature, and moves only through `advanceSyncState`, which
 * returns a new frozen record and cannot touch a signed field.
 * =============================================================================
 */

import {
  canonicalBytes,
  isPlainObject,
  type CanonicalObject,
  type CanonicalValue,
} from './canonicalize';
import {
  concatBytes,
  fromBase64Url,
  fromHex,
  isHash256Hex,
  sha256Hex,
  toBase64Url,
  utf8,
} from './bytes';
import {
  CryptoUnavailableError,
  SIGNING_ALGORITHM,
  SIGNING_PARAMS,
  createKeyManager,
  type CryptoAvailability,
  type KeyManager,
} from './keys';

export const EVIDENCE_SCHEMA = 'fwm-evidence/v1';

/** The exact ASCII string hashed to produce GENESIS_CHAIN_HASH. */
export const GENESIS_PREIMAGE = 'flockyswatchingme/evidence-chain/v1/genesis';

/** SHA-256(GENESIS_PREIMAGE). The previous-hash of every first record. */
export const GENESIS_CHAIN_HASH =
  '066d33d6ca5f6ab67be623a05347a67090727da9298d92261592341685b8e0f0';

/** Field inside the payload that carries GPS accuracy in metres, or null. */
export const GPS_ACCURACY_FIELD = 'gps_accuracy_m';

export const CAPTURED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const REPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Transport bookkeeping. Never hashed, never signed.
 *   held     queued on the device, waiting for WiFi
 *   syncing  an upload attempt is in flight
 *   synced   the backend accepted it
 *   rejected dead-letter; the backend refused it and a human has to look
 */
export type SyncState = 'held' | 'syncing' | 'synced' | 'rejected';

const LEGAL_SYNC_MOVES: Readonly<Record<SyncState, readonly SyncState[]>> = {
  held: ['syncing', 'rejected'],
  syncing: ['synced', 'held', 'rejected'],
  synced: [],
  rejected: ['held'],
};

export interface EvidenceRecord {
  readonly schema: typeof EVIDENCE_SCHEMA;
  readonly reportId: string;
  readonly capturedAt: string;
  readonly payload: CanonicalObject;
  readonly payloadHash: string;
  readonly previousChainHash: string;
  readonly chainHash: string;
  /** base64url, raw r||s, 64 bytes. */
  readonly signature: string;
  readonly publicKeyId: string;
  /** base64url SPKI DER, so the record verifies without a key directory. */
  readonly publicKeySpki: string;
  /** Projection of payload[GPS_ACCURACY_FIELD]; covered by payloadHash. */
  readonly gpsAccuracyM: number | null;
  readonly syncState: SyncState;
  /** reportId of the record this one corrects, or null. */
  readonly supersedes: string | null;
}

export interface FinalizeInput {
  readonly payload: CanonicalObject;
  /** Omit for the first record in the chain; defaults to GENESIS_CHAIN_HASH. */
  readonly previousChainHash?: string;
  /** Omit to stamp from the injected clock. */
  readonly capturedAt?: string;
  /** Omit to generate. */
  readonly reportId?: string;
  /** reportId of the record being corrected. */
  readonly supersedes?: string;
}

export type ChainFailureCode =
  | 'wrong-schema'
  | 'malformed-record'
  | 'bad-genesis'
  | 'broken-link'
  | 'payload-hash-mismatch'
  | 'chain-hash-mismatch'
  | 'bad-signature'
  | 'public-key-id-mismatch'
  | 'untrusted-public-key'
  | 'duplicate-report-id'
  | 'out-of-order-timestamp'
  | 'unknown-supersedes'
  | 'self-supersedes';

export interface ChainFailure {
  /** Position in the supplied array. The FIRST break, scanning forward. */
  readonly index: number;
  readonly reportId: string | null;
  readonly code: ChainFailureCode;
  readonly message: string;
}

export type ChainVerification =
  | { readonly ok: true; readonly count: number; readonly headChainHash: string }
  | { readonly ok: false; readonly failure: ChainFailure };

/** Thrown when a caller hands finalisation something that cannot be signed. */
export class EvidenceInputError extends Error {
  override readonly name = 'EvidenceInputError';
}

export interface EvidenceChainOptions {
  readonly keys?: KeyManager;
  /** Injected clock, epoch milliseconds. */
  readonly now?: () => number;
  /** Injected report-id generator. Must produce a lowercase UUID. */
  readonly newReportId?: () => string;
}

export interface EvidenceChain {
  availability(): Promise<CryptoAvailability>;
  /**
   * Signs and freezes one record. Throws CryptoUnavailableError when integrity
   * cannot be guaranteed - there is no unsigned fallback.
   */
  finalize(input: FinalizeInput): Promise<EvidenceRecord>;
  verify(records: readonly EvidenceRecord[]): Promise<ChainVerification>;
}

export function createEvidenceChain(options: EvidenceChainOptions = {}): EvidenceChain {
  const keys = options.keys ?? createKeyManager();
  const now = options.now ?? (() => Date.now());

  return {
    availability: () => keys.availability(),

    async finalize(input) {
      const status = await keys.availability();
      if (status.status === 'unavailable') throw new CryptoUnavailableError(status);
      const deps = await keys.requireDeps();
      const signing = await keys.signing();

      if (!isPlainObject(input.payload)) {
        throw new EvidenceInputError('payload must be a plain object');
      }

      const previousChainHash = input.previousChainHash ?? GENESIS_CHAIN_HASH;
      if (!isHash256Hex(previousChainHash)) {
        throw new EvidenceInputError('previousChainHash must be 64 lowercase hex characters');
      }

      const capturedAt = input.capturedAt ?? isoFromEpochMs(now());
      if (!CAPTURED_AT_RE.test(capturedAt) || !isRoundTripIso(capturedAt)) {
        throw new EvidenceInputError(
          'capturedAt must be UTC RFC 3339 with exactly three fractional digits, e.g. 2026-08-20T14:22:08.412Z',
        );
      }

      const reportId =
        input.reportId ?? (options.newReportId ?? (() => randomUuid(deps.randomBytes)))();
      if (!REPORT_ID_RE.test(reportId)) {
        throw new EvidenceInputError('reportId must be a lowercase RFC 4122 UUID');
      }

      const supersedes = input.supersedes ?? null;
      if (supersedes !== null && !REPORT_ID_RE.test(supersedes)) {
        throw new EvidenceInputError('supersedes must be a lowercase RFC 4122 UUID');
      }
      if (supersedes === reportId) {
        throw new EvidenceInputError('a record cannot supersede itself');
      }

      const gpsAccuracyM = readGpsAccuracy(input.payload);

      const payloadHash = await sha256Hex(deps.subtle, canonicalBytes(input.payload));
      const chainHash = await computeChainHash(deps.subtle, {
        previousChainHash,
        payloadHash,
        capturedAt,
        reportId,
      });
      const signature = await deps.subtle.sign(
        SIGNING_PARAMS,
        signing.privateKey,
        fromHex(chainHash) as BufferSource,
      );

      return deepFreezeRecord({
        schema: EVIDENCE_SCHEMA,
        reportId,
        capturedAt,
        payload: input.payload,
        payloadHash,
        previousChainHash,
        chainHash,
        signature: toBase64Url(new Uint8Array(signature)),
        publicKeyId: signing.publicKeyId,
        publicKeySpki: signing.publicKeySpki,
        gpsAccuracyM,
        syncState: 'held',
        supersedes,
      });
    },

    async verify(records) {
      // Verification deliberately does NOT require the local signing key: every
      // record carries the public key that signed it, so a chain stays checkable
      // after the install's own key is gone (cleared site data, a restored
      // export, someone else's queue). All it needs is a digest implementation.
      const status = await keys.availability();
      if (status.status !== 'available') return verifyChain(records);
      const deps = await keys.requireDeps();
      return verifyChain(records, { subtle: deps.subtle });
    },
  };
}

export interface VerifyChainOptions {
  readonly subtle?: SubtleCrypto;
  /**
   * Pin the chain to one install. When set, a record signed by any other key is
   * `untrusted-public-key` even if its own signature is valid.
   */
  readonly expectedPublicKeyId?: string;
  /** Omit for a chain that starts at genesis; set to continue a verified prefix. */
  readonly startingChainHash?: string;
}

/**
 * Verifies order, linkage and every signature, and returns the FIRST break.
 *
 * Detects, by construction:
 *   - a tampered payload            -> payload-hash-mismatch
 *   - a tampered hash or timestamp  -> chain-hash-mismatch
 *   - a deleted middle record       -> broken-link at the record after the hole
 *   - a reordered record            -> broken-link at the first record out of place
 *   - a forged or foreign signature -> bad-signature / public-key-id-mismatch
 */
export async function verifyChain(
  records: readonly EvidenceRecord[],
  options: VerifyChainOptions = {},
): Promise<ChainVerification> {
  const subtle = options.subtle ?? (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle === undefined) {
    throw new CryptoUnavailableError({
      status: 'unavailable',
      reason: 'no-subtle-crypto',
      detail: 'verifyChain needs crypto.subtle and none was supplied or found',
    });
  }

  const startingChainHash = options.startingChainHash ?? GENESIS_CHAIN_HASH;
  let expected = startingChainHash;
  let previousCapturedAt = '';
  const seenIds = new Set<string>();
  const importedKeys = new Map<string, CryptoKey>();

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record === undefined) {
      return fail(index, null, 'malformed-record', 'record is missing');
    }
    const shapeProblem = describeShapeProblem(record);
    if (shapeProblem !== null) {
      return fail(index, idOf(record), 'malformed-record', shapeProblem);
    }
    if (record.schema !== EVIDENCE_SCHEMA) {
      return fail(
        index,
        record.reportId,
        'wrong-schema',
        `record declares schema ${JSON.stringify(record.schema)}, expected ${JSON.stringify(EVIDENCE_SCHEMA)}`,
      );
    }

    if (seenIds.has(record.reportId)) {
      return fail(
        index,
        record.reportId,
        'duplicate-report-id',
        'this reportId already appears earlier in the chain',
      );
    }

    if (record.previousChainHash !== expected) {
      const code: ChainFailureCode = index === 0 ? 'bad-genesis' : 'broken-link';
      const detail =
        index === 0
          ? `first record must link to ${startingChainHash}, found ${record.previousChainHash}`
          : `record ${record.reportId} links to ${record.previousChainHash} but the record before it hashes to ${expected}; a record was deleted, reordered or inserted here`;
      return fail(index, record.reportId, code, detail);
    }

    if (previousCapturedAt !== '' && record.capturedAt < previousCapturedAt) {
      return fail(
        index,
        record.reportId,
        'out-of-order-timestamp',
        `capturedAt ${record.capturedAt} is earlier than the previous record's ${previousCapturedAt}`,
      );
    }

    let payloadHash: string;
    try {
      payloadHash = await sha256Hex(subtle, canonicalBytes(record.payload));
    } catch (cause) {
      return fail(
        index,
        record.reportId,
        'malformed-record',
        `payload has no canonical form: ${String(cause)}`,
      );
    }
    if (payloadHash !== record.payloadHash) {
      return fail(
        index,
        record.reportId,
        'payload-hash-mismatch',
        `payload hashes to ${payloadHash} but the record claims ${record.payloadHash}; the payload was edited after it was signed`,
      );
    }

    const chainHash = await computeChainHash(subtle, {
      previousChainHash: record.previousChainHash,
      payloadHash: record.payloadHash,
      capturedAt: record.capturedAt,
      reportId: record.reportId,
    });
    if (chainHash !== record.chainHash) {
      return fail(
        index,
        record.reportId,
        'chain-hash-mismatch',
        `recomputed chain hash ${chainHash} does not match the stored ${record.chainHash}`,
      );
    }

    if (
      options.expectedPublicKeyId !== undefined &&
      record.publicKeyId !== options.expectedPublicKeyId
    ) {
      return fail(
        index,
        record.reportId,
        'untrusted-public-key',
        `record is signed by ${record.publicKeyId}, not the pinned ${options.expectedPublicKeyId}`,
      );
    }

    // Every record re-proves that its own publicKeySpki hashes to its own
    // publicKeyId. Doing this per record rather than once per key id matters:
    // caching on the CLAIMED id would let a later record carry a key nobody
    // checked, and a self-verifying record has to verify itself.
    let spki: Uint8Array;
    try {
      spki = fromBase64Url(record.publicKeySpki);
    } catch (cause) {
      return fail(
        index,
        record.reportId,
        'malformed-record',
        `publicKeySpki is not base64url: ${String(cause)}`,
      );
    }
    const spkiId = await sha256Hex(subtle, spki);
    if (spkiId !== record.publicKeyId) {
      return fail(
        index,
        record.reportId,
        'public-key-id-mismatch',
        `publicKeySpki hashes to ${spkiId} but the record claims key id ${record.publicKeyId}`,
      );
    }

    let publicKey = importedKeys.get(record.publicKeySpki);
    if (publicKey === undefined) {
      try {
        publicKey = await subtle.importKey('spki', spki as BufferSource, SIGNING_ALGORITHM, true, [
          'verify',
        ]);
      } catch (cause) {
        return fail(
          index,
          record.reportId,
          'malformed-record',
          `publicKeySpki is not an importable P-256 key: ${String(cause)}`,
        );
      }
      importedKeys.set(record.publicKeySpki, publicKey);
    }

    let signatureOk = false;
    try {
      signatureOk = await subtle.verify(
        SIGNING_PARAMS,
        publicKey,
        fromBase64Url(record.signature) as BufferSource,
        fromHex(record.chainHash) as BufferSource,
      );
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) {
      return fail(
        index,
        record.reportId,
        'bad-signature',
        `signature does not verify against chain hash ${record.chainHash} under key ${record.publicKeyId}`,
      );
    }

    if (record.supersedes !== null) {
      if (record.supersedes === record.reportId) {
        return fail(index, record.reportId, 'self-supersedes', 'a record cannot supersede itself');
      }
      if (!seenIds.has(record.supersedes)) {
        return fail(
          index,
          record.reportId,
          'unknown-supersedes',
          `supersedes ${record.supersedes}, which does not appear earlier in this chain`,
        );
      }
    }

    seenIds.add(record.reportId);
    previousCapturedAt = record.capturedAt;
    expected = record.chainHash;
  }

  return { ok: true, count: records.length, headChainHash: expected };
}

/** Chain hash to link the next record to. GENESIS for an empty chain. */
export function chainHeadOf(records: readonly EvidenceRecord[]): string {
  const last = records.at(-1);
  return last === undefined ? GENESIS_CHAIN_HASH : last.chainHash;
}

/**
 * The ONLY mutation-shaped operation on a finalised record, and it returns a
 * new frozen record rather than editing one. It can move `syncState` along a
 * legal path and nothing else: every signed field is copied through unchanged.
 */
export function advanceSyncState(record: EvidenceRecord, next: SyncState): EvidenceRecord {
  const legal = LEGAL_SYNC_MOVES[record.syncState];
  if (!legal.includes(next)) {
    throw new EvidenceInputError(
      `sync state cannot move from ${record.syncState} to ${next}; legal moves are ${legal.length === 0 ? '(none, terminal)' : legal.join(', ')}`,
    );
  }
  return deepFreezeRecord({ ...record, syncState: next });
}

/**
 * `sha256 8f04·822f·b975·e932·0ddb·14d4` - the DEAD DROP readout in
 * DarkRoute Screens II (B2) shows six groups of four hex characters, middot
 * separated. This returns that string; it does not decide how it is styled.
 */
export function formatHashForDisplay(hash: string): string {
  const groups: string[] = [];
  for (let i = 0; i < 24 && i < hash.length; i += 4) groups.push(hash.slice(i, i + 4));
  return groups.join('·');
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ChainHashInput {
  readonly previousChainHash: string;
  readonly payloadHash: string;
  readonly capturedAt: string;
  readonly reportId: string;
}

/** SHA-256( prev(32B) || payload(32B) || captured_at(24B) || report_id(36B) ). */
export async function computeChainHash(
  subtle: SubtleCrypto,
  input: ChainHashInput,
): Promise<string> {
  if (!isHash256Hex(input.previousChainHash)) {
    throw new EvidenceInputError('previousChainHash must be 64 lowercase hex characters');
  }
  if (!isHash256Hex(input.payloadHash)) {
    throw new EvidenceInputError('payloadHash must be 64 lowercase hex characters');
  }
  if (!CAPTURED_AT_RE.test(input.capturedAt)) {
    throw new EvidenceInputError('capturedAt is not the fixed-length UTC form');
  }
  if (!REPORT_ID_RE.test(input.reportId)) {
    throw new EvidenceInputError('reportId is not a lowercase RFC 4122 UUID');
  }
  const preimage = concatBytes(
    fromHex(input.previousChainHash),
    fromHex(input.payloadHash),
    utf8(input.capturedAt),
    utf8(input.reportId),
  );
  return sha256Hex(subtle, preimage);
}

function readGpsAccuracy(payload: CanonicalObject): number | null {
  const raw: CanonicalValue | undefined = payload[GPS_ACCURACY_FIELD];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new EvidenceInputError(
      `payload.${GPS_ACCURACY_FIELD} must be a non-negative finite number or null`,
    );
  }
  return raw;
}

function isoFromEpochMs(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    throw new EvidenceInputError('clock returned a non-finite time');
  }
  return new Date(epochMs).toISOString();
}

function isRoundTripIso(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** RFC 4122 v4 from a CSPRNG. Used when crypto.randomUUID is absent. */
export function randomUuid(randomBytes: (length: number) => Uint8Array): string {
  const ambient = (globalThis as { crypto?: Crypto }).crypto;
  if (ambient !== undefined && typeof ambient.randomUUID === 'function') {
    return ambient.randomUUID().toLowerCase();
  }
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'));
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function idOf(record: unknown): string | null {
  if (typeof record === 'object' && record !== null) {
    const value: unknown = (record as { reportId?: unknown }).reportId;
    if (typeof value === 'string') return value;
  }
  return null;
}

function describeShapeProblem(record: EvidenceRecord): string | null {
  if (!REPORT_ID_RE.test(record.reportId)) return 'reportId is not a lowercase RFC 4122 UUID';
  if (!CAPTURED_AT_RE.test(record.capturedAt)) return 'capturedAt is not the fixed-length UTC form';
  if (!isHash256Hex(record.previousChainHash)) return 'previousChainHash is not a 256-bit hex hash';
  if (!isHash256Hex(record.payloadHash)) return 'payloadHash is not a 256-bit hex hash';
  if (!isHash256Hex(record.chainHash)) return 'chainHash is not a 256-bit hex hash';
  if (!isHash256Hex(record.publicKeyId)) return 'publicKeyId is not a 256-bit hex hash';
  if (typeof record.signature !== 'string' || record.signature === '') return 'signature is missing';
  if (typeof record.publicKeySpki !== 'string' || record.publicKeySpki === '') {
    return 'publicKeySpki is missing';
  }
  if (!isPlainObject(record.payload)) return 'payload is not a plain object';
  if (record.supersedes !== null && !REPORT_ID_RE.test(record.supersedes)) {
    return 'supersedes is neither null nor a lowercase RFC 4122 UUID';
  }
  return null;
}

function fail(
  index: number,
  reportId: string | null,
  code: ChainFailureCode,
  message: string,
): ChainVerification {
  return { ok: false, failure: { index, reportId, code, message } };
}

function deepFreezeRecord(record: EvidenceRecord): EvidenceRecord {
  deepFreeze(record.payload);
  return Object.freeze(record);
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}
