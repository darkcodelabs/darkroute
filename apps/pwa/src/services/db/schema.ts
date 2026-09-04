/**
 * DarkRoute local database - the typed schema.
 *
 * One IndexedDB database, `fwm`. Everything the app knows when the network is
 * gone lives here: the camera tiles it has already fetched, the alerts it has
 * already raised, the trips it has already driven, the reports it has signed
 * and not yet handed over, and the two things that must never leave the
 * device at all - the encrypted plate vault and the local match index.
 *
 * This file is types and policy constants only. It opens nothing, writes
 * nothing and imports no browser API, so it is safe to import from anywhere,
 * including a worker or a test that never touches storage.
 *
 * PRIVACY INVARIANTS ENFORCED BY THIS SCHEMA
 *
 *  1. No store has a licence plate as a key, an index, or a cleartext value.
 *     `plateVault` holds ciphertext, an IV, an opaque key id and numbers. It
 *     is keyed by an opaque `plateId` that carries no information about the
 *     plate. `assertPlateVaultRecordSafe()` is the runtime half of that
 *     promise and every write goes through it.
 *  2. No store records the vehicle's exact position for alerting purposes.
 *     `alerts` keeps distance and heading, never a latitude. The one place a
 *     coordinate is stored is a report the user deliberately filed, because a
 *     camera report without a position is not a report.
 *  3. Muting is a field on the alert record, not a filter on the write path.
 *     A muted camera still writes its alert row, still counts toward exposure
 *     and still shows on SWEEP. Muting removes the alert, never the record.
 *  4. `reportPhotos` is the only store holding a picture of a real place, and it
 *     holds nothing else: no capture time, no coordinates, no index, and bytes
 *     that were re-encoded before they arrived so the camera's own location tag
 *     is gone. It is keyed by the report it belongs to so that every path which
 *     deletes a report deletes the photograph in the same breath.
 */

import type { DBSchema } from 'idb';

import type { EvidenceRecord } from '../crypto/chain.ts';
import type { SealedPlate } from '../crypto/plate.ts';

// ---------------------------------------------------------------------------
// Database identity
// ---------------------------------------------------------------------------

/** The one database this app owns. */
export const DB_NAME = 'fwm';

// ---------------------------------------------------------------------------
// Store names
// ---------------------------------------------------------------------------

/**
 * Every store, as a value you can iterate. Adding a name here is not enough to
 * create it - a numbered migration in `migrations.ts` has to do that - but
 * every name here must be reachable from some migration or `openFwmDb()`
 * refuses to open, which is how a forgotten migration is caught at startup
 * instead of at the first read.
 */
export const STORE_NAMES = [
  'cameraTiles',
  'cameraCacheState',
  'tileMeta',
  'alerts',
  'trips',
  'pendingReports',
  'reportChain',
  'pendingActions',
  'settings',
  'session',
  'plateVault',
  'plateMatches',
  'storeBlobs',
  'reportPhotos',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

// ---------------------------------------------------------------------------
// Camera tiles
// ---------------------------------------------------------------------------

/**
 * Where a tile's contents came from. `fixture` exists because the PWA ships a
 * drive simulator and the simulator's cameras must never be mistaken for
 * cameras somebody actually reported.
 */
export type TileSource = 'network' | 'fixture' | 'user';

/**
 * A camera as it is cached locally.
 *
 * Structurally compatible with `CameraLike` in `packages/core` (id, lat, lon,
 * directionDeg) so the alert engine can consume a cached record directly.
 * `@fwm/core` is deliberately not imported: it is not yet a dependency of
 * `apps/pwa`, and the storage layer must not be the thing that wires it in.
 *
 * `directionDeg` is the compass direction the lens points TOWARD, or `null`
 * when the facing is genuinely unknown. `null` never means "not facing you" -
 * an unknown-facing camera reads every plate it can see, so it stays in every
 * list, every count and every alert.
 */
export interface CameraRecord {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly directionDeg: number | null;
  /** Owner class, as the TRIAGE screen groups them. */
  readonly ownerType?: CameraOwnerType;
  /** How many independent confirmations the record has. */
  readonly confirmations?: number;
  /**
   * The street the camera stands on, upper-cased, and the nearest DIFFERENT
   * named road if one is close enough to call an intersection.
   *
   * Historical output of the deleted `scripts/fetch-street-names.mjs` TIGER
   * pipeline. Current refreshes can only carry these fossil fields forward;
   * they cannot recompute them. Absent when the old pipeline found no road
   * within 40 m: a confident wrong street is worse than no street.
   */
  readonly street?: string;
  readonly cross?: string;
  /** Server-side last-modified stamp, epoch ms, when the source supplies one. */
  readonly updatedAt?: number;
  /**
   * Census county FIPS, five characters. Absent for 2,621 cameras (1.98%) that
   * fall outside every county polygon - offshore nodes and coastline gaps -
   * which get no county rather than the nearest one.
   */
  readonly countyFips?: string;
  /**
   * The mapper's own OSM tags, verbatim, minus the ones that are the query.
   *
   * Written by `scripts/enrich-cameras.mjs` from a complete US sweep.
   *
   * COVERAGE, RE-MEASURED 2026-08-31 by decoding all 8,605 shipped tiles rather
   * than by reading it off the last run. Across 132,068 records: `manufacturer`
   * 91.99%, `camera:type` 96.07%, `surveillance:zone` 87.41%, `camera:mount`
   * 30.56%, `operator` 17.69%.
   *
   * The previous figures said "all 131,083 records" and were roughly half a
   * point low on each rate. Not a bug in anything, but this file is where
   * somebody checks whether a key is worth reading, and a stale denominator
   * quietly answers that question wrong. These are measured against the copy in
   * `apps/pwa/public/cameras`; the archive R2 serves is fresher and moves
   * hourly, so re-measure rather than trusting this line a year from now.
   *
   * A flat string map BY DEFINITION -- OSM tags are untyped key/value pairs and
   * a mapper may invent one tomorrow. Anything that reads a specific key has to
   * treat its absence as normal, because for most keys absence is the majority
   * case.
   */
  readonly tags?: Readonly<Record<string, string>>;
  /**
   * Census place GEOID, seven characters. Absent for the 28,062 cameras on
   * unincorporated land, which is most of the country's area. "Near Overland
   * Park" and "in Overland Park" are different claims and only one is in the
   * data, so the absence is rendered rather than filled in.
   */
  readonly placeGeoid?: string;
}

/** TRIAGE groups alerts by owner: police, inter-agency, HOA, private, unverified. */
export type CameraOwnerType = 'police' | 'inter_agency' | 'hoa' | 'private' | 'unverified';

/** One cached slippy tile of cameras. Key is `[z, x, y]`. */
export interface CameraTileRecord {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly cameras: readonly CameraRecord[];
  /** Immutable archive identity. Absent only on caches written before generation-aware sync. */
  readonly generation?: string;
  /** Epoch ms the tile body was fetched. Also the eviction ordering key. */
  readonly fetchedAt: number;
  /** HTTP validator, when the source gave one. Absent is normal, not an error. */
  readonly etag?: string;
  readonly source: TileSource;
}

/** One DB-wide identity guarding every row in `cameraTiles`. */
export interface CameraCacheStateRecord {
  readonly key: 'current';
  readonly generation: string;
}

export const CAMERA_CACHE_STATE_KEY = 'current';

/**
 * How much a tile can be trusted right now.
 *
 * `unknown` is not a synonym for `stale`: it is the state before anything has
 * ever checked, and the OFFLINE screen says "treat clear as probably clear"
 * precisely because the app must not present an unchecked tile as a clean one.
 */
export type TileFreshness = 'fresh' | 'stale' | 'unknown';

/** Freshness bookkeeping for one tile, kept apart from the tile body. Key `[z, x, y]`. */
export interface TileMetaRecord {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly freshness: TileFreshness;
  /** Epoch ms of the last freshness check - not the last body fetch. */
  readonly lastCheckedAt: number;
  /** Age in ms after which this tile is considered stale. */
  readonly staleAfterMs: number;
  readonly cameraCount: number;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * The alert state machine, mirrored from `packages/core`.
 *
 * Hue means state and nothing else:
 *   clear · approaching · in_range · multiple
 */
export type AlertState = 'clear' | 'approaching' | 'in_range' | 'multiple';

/**
 * One alert as it happened.
 *
 * `muted` and `dismissed` are recorded, never applied. A muted alert is still
 * an alert that occurred: it counts in EXPOSURE, it appears in LOG, and the
 * camera still draws on SWEEP. The only thing `muted` suppressed was the
 * delivery - the sound, the haptic and the takeover.
 *
 * There is no latitude here on purpose. A trip's exposure is a count and a
 * distance, and neither needs the coordinates that produced them.
 */
export interface AlertRecord {
  /** Auto-assigned. Callers pass `NewAlert`, which has no id. */
  readonly id: number;
  readonly cameraId: string;
  readonly state: AlertState;
  readonly distanceFt: number;
  /** Vehicle heading in compass degrees at the moment of the alert. */
  readonly headingDeg: number | null;
  readonly speedMph: number | null;
  /** Epoch ms. */
  readonly at: number;
  readonly muted: boolean;
  readonly dismissed: boolean;
}

export type NewAlert = Omit<AlertRecord, 'id'>;

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

/** One drive. `endedAt` is null while the trip is still running. */
export interface TripRecord {
  readonly id: number;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly distanceMi: number;
  readonly cameraIdsPassed: readonly string[];
  /** How many camera passes the trip produced. Muted passes count. */
  readonly exposureCount: number;
}

export type NewTrip = Omit<TripRecord, 'id'>;

// ---------------------------------------------------------------------------
// Signed reports and the evidence chain
// ---------------------------------------------------------------------------

/**
 * The immutable signed record, exactly as the crypto service produced it.
 *
 * `EvidenceRecord` is imported rather than restated. A storage layer that
 * redeclares the shape of a signed record is a storage layer that will one day
 * round-trip it through a slightly different type and turn a valid signature
 * into a forged-looking one.
 *
 * Everything in it is frozen at capture except `syncState`, which is outside
 * the signed envelope: the signature covers the canonical payload and the
 * chain hash covers `payloadHash` + `previousChainHash`, so advancing the
 * queue state changes no byte that anything committed to.
 * `pendingReportsRepository` enforces exactly that, field by field.
 */
export type SignedReportRecord = EvidenceRecord;

/**
 * The fields of a stored report that no write path may change, ever.
 *
 * `syncState` is the deliberate omission and the only one.
 */
export const IMMUTABLE_REPORT_FIELDS = [
  'schema',
  'reportId',
  'capturedAt',
  'payload',
  'payloadHash',
  'previousChainHash',
  'chainHash',
  'signature',
  'publicKeyId',
  'publicKeySpki',
  'gpsAccuracyM',
  'supersedes',
] as const satisfies readonly (keyof EvidenceRecord)[];

/**
 * Where a queued item stands with the server.
 *
 * Five states, not the crypto module's four. The evidence chain models the
 * record's own opinion of itself (`held` · `syncing` · `synced` · `rejected`);
 * the queue additionally has to model "we have stopped trying", which is what
 * `dead_letter` is. Without it, the only way to express "this will never
 * succeed" is to delete the row, and deleting a signed report to tidy up a
 * queue is the one thing this layer must never do.
 *
 * `pending` is the queue's name for the chain's `held`. `queueStateFromChain`
 * and `chainStateFromQueue` are the only places the two vocabularies meet.
 */
export type QueueSyncState = 'pending' | 'syncing' | 'synced' | 'rejected' | 'dead_letter';

/** Queue vocabulary from the record's own. */
export function queueStateFromChain(state: EvidenceRecord['syncState']): QueueSyncState {
  return state === 'held' ? 'pending' : state;
}

/**
 * Record vocabulary from the queue's.
 *
 * `dead_letter` collapses to `rejected`, because the record's state means
 * "the backend refused it" and a dead-lettered record is, from the record's
 * point of view, refused. The reason it stopped being retried lives in
 * `ReportChainRecord.deadLetterReason`, where a human can read it.
 */
export function chainStateFromQueue(state: QueueSyncState): EvidenceRecord['syncState'] {
  if (state === 'pending') return 'held';
  if (state === 'dead_letter') return 'rejected';
  return state;
}

/**
 * The hash chain, one row per report, keyed the same as `pendingReports`.
 *
 * Kept separate from the report body so the chain can be walked, verified and
 * exported without loading a payload, and so a sync-state write never touches
 * a byte of signed evidence.
 *
 * `capturedAt` is the ISO-8601 UTC string the signed record carries, not an
 * epoch number. It is stored verbatim so the row and the record can never
 * disagree, and because a fixed-width UTC timestamp sorts lexicographically in
 * exactly chronological order - which is what the `by-capturedAt` index needs
 * to render DEAD DROP's "DROP 03 · DROP 02 · DROP 01".
 */
export interface ReportChainRecord {
  readonly reportId: string;
  readonly payloadHash: string;
  /** `GENESIS_CHAIN_HASH` for the first drop; never null. */
  readonly previousChainHash: string;
  readonly chainHash: string;
  readonly signature: string;
  readonly publicKeyId: string;
  /** ISO-8601 UTC with milliseconds, matching `CAPTURED_AT_RE`. */
  readonly capturedAt: string;
  readonly syncState: QueueSyncState;
  /** Attempts made against the server so far. */
  readonly attempts: number;
  /** Epoch ms the next attempt becomes due, or null when nothing is scheduled. */
  readonly nextAttemptAt: number | null;
  /**
   * Earliest epoch ms this record may LEAVE THE DEVICE. Null means no hold.
   *
   * SEPARATE FROM `nextAttemptAt` ON PURPOSE, and the separation is the whole
   * point. `nextAttemptAt` is transport bookkeeping - it is overwritten by
   * `markFailed` on every retry and nulled by `markSyncing`. A privacy hold
   * stored there is deleted by the first 429, the first closed changeset, the
   * first dropped tunnel: a jitter measured in days collapses to a backoff
   * measured in seconds, and the record uploads at a time tightly correlated
   * with where its author was.
   *
   * That failure is silent, lives in the error path, and defeats the single
   * mitigation everything else leans on. So the hold gets a field that the
   * retry scheduler does not own and CANNOT write - it is deliberately absent
   * from `ReportSyncPatch`, so a transport that tries to touch it does not
   * compile.
   */
  readonly publishableAt: number | null;
  /** Last failure, for the UI and the dead-letter reason. Never a plate. */
  readonly lastError: string | null;
  /** Why this became terminal. Set only with `dead_letter` or `rejected`. */
  readonly deadLetterReason: string | null;
  /** Epoch ms the server acknowledged it. */
  readonly syncedAt: number | null;
}

/** The mutable half of a chain row. The signed half is never in here. */
export type ReportSyncPatch = Partial<
  Pick<
    ReportChainRecord,
    'syncState' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'deadLetterReason' | 'syncedAt'
  >
>;

/**
 * The signed fields, which no update path may touch.
 *
 * Used by `reportChainRepository` to diff an incoming write against what is
 * already stored, so an attempt to "fix" a hash fails loudly instead of
 * quietly rewriting evidence.
 */
export const IMMUTABLE_CHAIN_FIELDS = [
  'reportId',
  'payloadHash',
  'previousChainHash',
  'chainHash',
  'signature',
  'publicKeyId',
  'capturedAt',
] as const satisfies readonly (keyof ReportChainRecord)[];

// ---------------------------------------------------------------------------
// Pending actions
// ---------------------------------------------------------------------------

/**
 * A confirmation or a dispute the user made while the network was gone.
 *
 * These are cheap, idempotent and replayable, which is why they retry. Reports
 * are not in here: a report is signed evidence and lives in `pendingReports`.
 */
export type PendingActionKind = 'confirm_camera' | 'dispute_camera' | 'claim_handle';

export type PendingActionState = 'queued' | 'in_flight' | 'done' | 'dead_letter';

export interface PendingActionRecord {
  readonly id: number;
  readonly kind: PendingActionKind;
  /** The subject of the action. A camera id or a handle - never a plate. */
  readonly subjectId: string;
  /** Small JSON-serialisable body. Validated by the caller, never a plate. */
  readonly body: Readonly<Record<string, string | number | boolean | null>>;
  readonly createdAt: number;
  readonly attempts: number;
  /** Epoch ms this becomes due. `queued` items with a past due time are runnable. */
  readonly nextAttemptAt: number;
  readonly state: PendingActionState;
  readonly lastError: string | null;
  readonly deadLetterReason: string | null;
}

export type NewPendingAction = Omit<
  PendingActionRecord,
  'id' | 'attempts' | 'nextAttemptAt' | 'state' | 'lastError' | 'deadLetterReason'
>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Single-value settings, keyed by name.
 *
 * Note what is NOT here: a default alert threshold. The engine's default lives
 * in `packages/core` as `DEFAULT_ALERT_THRESHOLD_FT` and duplicating it here
 * would create a second place for a design value to drift. Readers pass their
 * own fallback with `getOr()`; the store answers "not set" honestly.
 */
export interface SettingsValueMap {
  /** Alert threshold in feet. Range and step are the engine's business. */
  'alert.thresholdFt': number;
  /** Epoch ms the global mute expires, or null when nothing is muted. */
  'alert.mutedUntil': number | null;
  /** Per-camera mutes: camera id → epoch ms the mute expires. */
  'alert.mutedCameras': Readonly<Record<string, number>>;
  /** TRIAGE toggles, by owner type. Absent means "alert on it". */
  'triage.enabledOwnerTypes': Readonly<Record<CameraOwnerType, boolean>>;
  /** TRIAGE: suppress cameras with only one confirmation. */
  'triage.hideUnverified': boolean;
  /** Only sync queued evidence when the connection is unmetered. */
  'sync.wifiOnly': boolean;
  /** Opaque id of the AES-GCM vault key held as a non-exportable CryptoKey. */
  'plateVault.keyId': string | null;
  /** Epoch ms the user last exported the vault. Audit trail for the user. */
  'plateVault.lastExportAt': number | null;
  /** Onboarding completion, so the app does not re-ask for permissions. */
  'onboarding.completedAt': number | null;
}

export type SettingName = keyof SettingsValueMap;

export interface SettingsRecord {
  readonly name: SettingName;
  /**
   * The stored value.
   *
   * `unknown` rather than a union: IndexedDB gives back whatever was put in,
   * and the typed accessors in `repositories/settings.ts` are the only place
   * that decides what a name means. Widening here would let a caller read a
   * boolean out of a numeric setting without a cast.
   */
  readonly value: unknown;
  readonly updatedAt: number;
}

/**
 * One serialized store blob, written by the zustand persist port.
 *
 * SEPARATE FROM `settings` ON PURPOSE. That store is a typed key-value table
 * with a closed name list and one guard per name - a deliberate design, and
 * the wrong shape for zustand, which persists a whole slice as one opaque JSON
 * string under a store name it chooses. Sharing the table would mean either
 * widening the name union every time a slice is added, or writing rows the
 * typed accessors would refuse to read back.
 *
 * The blob has already passed `assertPersistSafe` before it arrives: no plate,
 * no plate-shaped key, no field whose NAME implies plate custody. This store
 * therefore holds preferences and nothing that identifies a vehicle.
 */
export interface StoreBlobRecord {
  /** The zustand store name, e.g. `fwm.settings`. */
  readonly name: string;
  readonly value: string;
  readonly updatedAt: number;
}

/** Settings whose value is a local-only secret and must be dropped by clearLocalData(). */
export const SECRET_SETTING_NAMES = [
  'plateVault.keyId',
  'plateVault.lastExportAt',
] as const satisfies readonly SettingName[];

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** The single session row. Anonymous, server-issued, no login of any kind. */
export interface SessionRecord {
  readonly key: 'current';
  /** Server-issued anonymous UUID. Not derived from anything on the device. */
  readonly sessionId: string;
  /** Optional, validated, unique display handle. Null until claimed. */
  readonly handle: string | null;
  readonly issuedAt: number;
}

export const SESSION_KEY = 'current';

// ---------------------------------------------------------------------------
// Plate vault
// ---------------------------------------------------------------------------

/**
 * An encrypted watchlist plate. CIPHERTEXT ONLY.
 *
 * This is `SealedPlate` from the crypto service - same `id`, `iv`,
 * `ciphertext`, `blindIndex`, `createdAt` - carrying `plateId` as the primary
 * key alias plus the three fields storage needs and cryptography does not:
 * which vault key sealed it, when the row was last touched, and the "73 reads"
 * the WATCHLIST screen renders next to each plate.
 *
 * `plateVaultRepository` is a drop-in `SealedPlateStore`, so `createPlateVault`
 * can be pointed at the `fwm` database instead of the separate crypto one and
 * `clearLocalData()` can actually clear it. Duplicating the sealed shape here
 * would have created a second, diverging vault.
 *
 * WHY THE KEY IS AN OPAQUE UUID. `plateId` is never derived from the plate -
 * not a hash, not a prefix, not a normalised form. A keyspace derived from the
 * secret leaks the secret to anyone who can enumerate it. Equality matching
 * uses `blindIndex`, a keyed HMAC that is useless without the vault key.
 *
 * WHY THERE IS NO LABEL FIELD. The WATCHLIST screen shows labels - "mine",
 * "partner", "trailer". A label is free text, and free text is exactly where
 * somebody writes the plate a second time in the clear. When labels are
 * implemented they get sealed like everything else; they do not get a column
 * here.
 */
export interface PlateVaultRecord {
  /** `SealedPlate.id`: a random lowercase UUID. Opaque, never derived. */
  readonly plateId: string;
  readonly schema: SealedPlate['schema'];
  /** base64url, 12 bytes, unique per record. */
  readonly iv: string;
  /** base64url AES-GCM output - ciphertext plus tag. */
  readonly ciphertext: string;
  /** Keyed, truncated HMAC of the normalised plate. Hex, 32 characters. */
  readonly blindIndex: string;
  /** ISO-8601, from the sealed record. */
  readonly createdAt: string;
  /** Opaque id of the non-exportable AES-GCM key. Never key material. */
  readonly keyId: string;
  /** Epoch ms this row was last written. Storage bookkeeping, not evidence. */
  readonly updatedAt: number;
  /** How many camera reads have matched this plate locally. A count is not a plate. */
  readonly readCount: number;
}

/**
 * The only fields a plateVault record may carry.
 *
 * A strict allowlist rather than a denylist: a field nobody anticipated is
 * exactly how a plate ends up in this store in the clear, so an unanticipated
 * field is a rejected write. See `assertPlateVaultRecordSafe`.
 */
export const PLATE_VAULT_FIELDS = [
  'plateId',
  'schema',
  'iv',
  'ciphertext',
  'blindIndex',
  'createdAt',
  'keyId',
  'updatedAt',
  'readCount',
] as const satisfies readonly (keyof PlateVaultRecord)[];

/**
 * A local match between a watched plate and a camera read.
 *
 * Added in schema v2. Holds no plate: `plateId` is the opaque vault key, so a
 * dump of this store tells an attacker which cameras matched *something*, and
 * nothing about what.
 */
export interface PlateMatchRecord {
  readonly matchId: string;
  readonly plateId: string;
  readonly cameraId: string;
  readonly at: number;
  /** How the match was made. `local` is the only one that exists today. */
  readonly source: 'local';
}

// ---------------------------------------------------------------------------
// Report photographs
// ---------------------------------------------------------------------------

/**
 * The bytes of the one photograph a driver may attach to a report.
 *
 * SEPARATE FROM THE SIGNED RECORD ON PURPOSE. `SignedReportRecord` is frozen
 * the moment it is signed, and `IMMUTABLE_REPORT_FIELDS` compares its fields by
 * `JSON.stringify` - a `Uint8Array` round-tripped through that comparison is
 * both meaningless and enormous. What the signature commits to is the digest:
 * the canonical payload's `photo` field carries the lowercase-hex SHA-256 of
 * exactly these bytes. The record and the photograph are two rows in two stores
 * joined by one key that neither of them can rewrite.
 *
 * WHY THE KEY IS `reportId` AND NOT THE CONTENT HASH. Content addressing dedupes,
 * which sounds free and is not: two reports carrying the same image would share
 * one row, and purging the first would delete bytes the second still names. It
 * would also make the key itself a stable fingerprint of the picture. Keyed by
 * `reportId` the store is 1:1 with the body, so every erase path is "delete the
 * key you are already deleting".
 *
 * WHY THERE IS NO TIMESTAMP HERE. `PreparedPhoto` knows the shutter time and the
 * signed record already carries the submit time. Storing the shutter time as
 * well would add a second, finer record of when a specific person stood in a
 * specific place, and nothing reads it - no eviction path may order this store,
 * so an ordering key would be a fingerprint with no consumer.
 */
export interface ReportPhotoRecord {
  /** The `pendingReports` key this photograph belongs to. Exactly one per report. */
  readonly reportId: string;
  /** Lowercase hex SHA-256 of `bytes`, 64 characters. Equals the payload's `photo`. */
  readonly sha256: string;
  /**
   * The prepared JPEG.
   *
   * A `Uint8Array` and NEVER a `Blob`. `structuredClone` of a Blob in this
   * repository's test environment yields a plain object with `size: undefined`
   * rather than throwing, and the in-memory IndexedDB double's deep-copy
   * fallback has no Blob branch either - so a Blob would silently round-trip to
   * an empty object in every storage test while appearing to work in a browser.
   */
  readonly bytes: Uint8Array;
  /** The encoder's output type, `image/jpeg`. Stored so a reader need not guess. */
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// The idb schema
// ---------------------------------------------------------------------------

/** Tile keys are `[z, x, y]`, which is also the order the index sorts in. */
export type TileKey = [number, number, number];

export interface FwmDB extends DBSchema {
  cameraTiles: {
    key: TileKey;
    value: CameraTileRecord;
    indexes: { 'by-fetchedAt': number; 'by-generation': string };
  };
  cameraCacheState: {
    key: 'current';
    value: CameraCacheStateRecord;
  };
  tileMeta: {
    key: TileKey;
    value: TileMetaRecord;
  };
  alerts: {
    key: number;
    value: AlertRecord;
    indexes: { 'by-at': number; 'by-cameraId': string };
  };
  trips: {
    key: number;
    value: TripRecord;
    indexes: { 'by-startedAt': number };
  };
  pendingReports: {
    key: string;
    value: SignedReportRecord;
  };
  reportChain: {
    key: string;
    value: ReportChainRecord;
    indexes: { 'by-syncState': string; 'by-capturedAt': string };
  };
  pendingActions: {
    key: number;
    value: PendingActionRecord;
    indexes: { 'by-state': string; 'by-nextAttemptAt': number };
  };
  settings: {
    key: string;
    value: SettingsRecord;
  };
  storeBlobs: {
    key: string;
    value: StoreBlobRecord;
  };
  session: {
    key: string;
    value: SessionRecord;
  };
  plateVault: {
    key: string;
    value: PlateVaultRecord;
  };
  plateMatches: {
    key: string;
    value: PlateMatchRecord;
    indexes: { 'by-plateId': string; 'by-at': number };
  };
  // No indexes, for the same reason plateVault has none: an index over this
  // store is an ordering an attacker can query, and nothing needs one - it is
  // read by report id and cleared wholesale.
  reportPhotos: {
    key: string;
    value: ReportPhotoRecord;
  };
}
