/**
 * The local database: open it here, and get every repository from one place.
 *
 *   const db = await openFwmDb();
 *   const repos = createRepositories(db);
 *   await repos.alerts.record({ ... });
 *
 * WHAT THIS MODULE GUARANTEES
 *
 *  - Opening runs numbered migrations in order and then verifies that every
 *    store the app will read actually exists, so a forgotten migration fails
 *    at startup with a sentence rather than in a screen with a NotFoundError.
 *  - `estimateUsage()` capability-detects `navigator.storage.estimate()` and
 *    reports `supported: false` when it is absent. It never invents a number.
 *  - `clearLocalData()` removes the local-only secrets and the history, says
 *    exactly what it removed, and does not touch signed evidence - a "clear my
 *    data" button that silently shreds the reports somebody filed is not a
 *    privacy feature.
 *  - `pendingSyncCount()` is the selector behind the dock's queue badge. The
 *    design renders it as "2 QUEUED" (`Flockys App Screens.dc.html`, REPORT
 *    bar); the string is the UI's, the number is this module's.
 */

import { openDB } from 'idb';

import type { FwmDB, StoreName } from './schema.ts';
import { DB_NAME, STORE_NAMES } from './schema.ts';
import { DB_VERSION, applyMigrations, assertSchemaComplete } from './migrations.ts';
import type { Migration } from './migrations.ts';
import { EVICTION_EXEMPT_STORES, STORAGE_PRESSURE_RATIO, STORE_CAPS } from './policy.ts';
import type { FwmDatabase, RepositoryDeps } from './repositories/support.ts';
import { resolveDeps } from './repositories/support.ts';

import { createAlertsRepository } from './repositories/alerts.ts';
import { createCameraTilesRepository } from './repositories/cameraTiles.ts';
import { createPendingActionsRepository } from './repositories/pendingActions.ts';
import { createPendingReportsRepository } from './repositories/pendingReports.ts';
import { createPlateMatchesRepository } from './repositories/plateMatches.ts';
import { createPlateVaultRepository } from './repositories/plateVault.ts';
import { createReportChainRepository } from './repositories/reportChain.ts';
import { createReportPhotosRepository } from './repositories/reportPhotos.ts';
import { createSessionRepository } from './repositories/session.ts';
import { createSettingsRepository } from './repositories/settings.ts';
import { createTileMetaRepository } from './repositories/tileMeta.ts';
import { createTripsRepository } from './repositories/trips.ts';

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export interface OpenFwmDbOptions {
  /** Override the database name. Tests use a unique name per file. */
  readonly name?: string;
  /** Override the version. Only a test opening an older schema needs this. */
  readonly version?: number;
  /** Override the migration list. Only a migration test needs this. */
  readonly migrations?: readonly Migration[];
  /** Called with the migrations that ran, for an upgrade log. */
  readonly onUpgrade?: (applied: readonly string[], from: number, to: number) => void;
  /** Called when another tab holds an older connection open. */
  readonly onBlocked?: () => void;
  /** Called before this connection closes for a newer schema in another tab. */
  readonly onBlocking?: () => void;
}

export class DatabaseUnavailableError extends Error {
  override readonly name = 'DatabaseUnavailableError';
}

/** Is IndexedDB there at all? Private modes and old embedded webviews say no. */
export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

/**
 * Open `fwm`, migrate it, and verify the result.
 *
 * Throws `DatabaseUnavailableError` when the platform has no IndexedDB rather
 * than falling back to memory. A storage layer that silently degrades to a
 * Map is a storage layer that loses a driver's queued evidence at the next
 * reload without ever saying so.
 */
export async function openFwmDb(options: OpenFwmDbOptions = {}): Promise<FwmDatabase> {
  if (!hasIndexedDb()) {
    throw new DatabaseUnavailableError(
      'this browser exposes no IndexedDB, so nothing can be stored locally',
    );
  }
  const name = options.name ?? DB_NAME;
  const version = options.version ?? DB_VERSION;
  const migrations = options.migrations;

  const db = await openDB<FwmDB>(name, version, {
    upgrade(database, oldVersion, newVersion, tx) {
      const applied =
        migrations === undefined
          ? applyMigrations({ db: database, tx }, oldVersion)
          : applyMigrations({ db: database, tx }, oldVersion, migrations);
      options.onUpgrade?.(applied, oldVersion, newVersion ?? version);
    },
    blocked() {
      options.onBlocked?.();
    },
    blocking(_currentVersion, _blockedVersion, event) {
      // Release the version lock promptly. Without this, an older open tab can
      // strand the next deployment's migration (and its camera cache) until
      // the user happens to close every tab.
      (event.target as IDBDatabase | null)?.close();
      options.onBlocking?.();
    },
  });

  // Only check the stores this version was supposed to create. A test that
  // opens v1 deliberately has fewer.
  const expected =
    migrations === undefined && options.version === undefined
      ? STORE_NAMES
      : STORE_NAMES.filter((store) => db.objectStoreNames.contains(store));
  assertSchemaComplete(db, expected);

  return db;
}

/** Close a handle. Separate from `openFwmDb` so tests can be explicit. */
export function closeFwmDb(db: FwmDatabase): void {
  db.close();
}

/**
 * How long anything on a driving path may wait for this database.
 *
 * A version-change from another tab BLOCKS an open, and a blocked open does not
 * fail: `IDBOpenDBRequest` fires `blocked` and then simply never settles until
 * the other connection closes, which may be never. `openFwmDb` reports that
 * through `onBlocked` and keeps waiting, which is right for a caller that can
 * wait and wrong for every caller in this app.
 */
export const DB_OPEN_TIMEOUT_MS = 1_500;

/**
 * Open the database, or give up.
 *
 * Resolves `null` when the deadline passes - a caller that got null must
 * degrade rather than retry in a loop - and rejects with the database layer's
 * own error when the open genuinely fails, so a screen can say why.
 *
 * A late connection is CLOSED rather than kept. An open that was blocked for
 * eight seconds resolves eventually, and holding that handle would leave a
 * connection nobody is watching wired to a screen that has moved on.
 */
export async function openFwmDbWithin(
  timeoutMs: number = DB_OPEN_TIMEOUT_MS,
  options: OpenFwmDbOptions = {},
): Promise<FwmDatabase | null> {
  let expired = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const opened = openFwmDb(options).then((db) => {
    if (expired) {
      closeFwmDb(db);
      return null;
    }
    return db;
  });
  const deadline = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      expired = true;
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([opened, deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface Repositories {
  readonly cameraTiles: ReturnType<typeof createCameraTilesRepository>;
  readonly tileMeta: ReturnType<typeof createTileMetaRepository>;
  readonly alerts: ReturnType<typeof createAlertsRepository>;
  readonly trips: ReturnType<typeof createTripsRepository>;
  readonly pendingReports: ReturnType<typeof createPendingReportsRepository>;
  readonly reportChain: ReturnType<typeof createReportChainRepository>;
  readonly reportPhotos: ReturnType<typeof createReportPhotosRepository>;
  readonly pendingActions: ReturnType<typeof createPendingActionsRepository>;
  readonly settings: ReturnType<typeof createSettingsRepository>;
  readonly session: ReturnType<typeof createSessionRepository>;
  readonly plateVault: ReturnType<typeof createPlateVaultRepository>;
  readonly plateMatches: ReturnType<typeof createPlateMatchesRepository>;
}

export function createRepositories(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): Repositories {
  const deps = resolveDeps(overrides);
  return {
    cameraTiles: createCameraTilesRepository(db, deps),
    tileMeta: createTileMetaRepository(db, deps),
    alerts: createAlertsRepository(db, deps),
    trips: createTripsRepository(db, deps),
    pendingReports: createPendingReportsRepository(db),
    reportChain: createReportChainRepository(db, deps),
    reportPhotos: createReportPhotosRepository(db),
    pendingActions: createPendingActionsRepository(db, deps),
    settings: createSettingsRepository(db, deps),
    session: createSessionRepository(db, deps),
    plateVault: createPlateVaultRepository(db, deps),
    plateMatches: createPlateMatchesRepository(db, deps),
  };
}

// ---------------------------------------------------------------------------
// The queue badge
// ---------------------------------------------------------------------------

/**
 * What the dock's REPORT bar counts.
 *
 * The design renders the total as "2 QUEUED" and, on the OFFLINE screen, as
 * "2 REPORTS QUEUED · SYNC ON WIFI". Dead letters are reported separately and
 * are deliberately NOT in `total`: they are not queued, they are stuck, and
 * folding them into the badge would mean a number that never goes down.
 */
export interface PendingSyncCount {
  readonly reports: number;
  readonly actions: number;
  readonly total: number;
  readonly deadLettered: number;
}

export async function pendingSyncCount(db: FwmDatabase): Promise<PendingSyncCount> {
  const repos = createRepositories(db);
  const [reports, actions, deadReports, deadActions] = await Promise.all([
    repos.reportChain.queuedCount(),
    repos.pendingActions.queuedCount(),
    repos.reportChain.deadLetters(),
    repos.pendingActions.deadLetters(),
  ]);
  return {
    reports,
    actions,
    total: reports + actions,
    deadLettered: deadReports.length + deadActions.length,
  };
}

// ---------------------------------------------------------------------------
// Storage accounting
// ---------------------------------------------------------------------------

export interface StoreUsage {
  readonly store: StoreName;
  readonly rows: number;
  /** The documented ceiling, or null where this layer never evicts. */
  readonly cap: number | null;
  /** Rows over the cap, or 0. A positive number means eviction is overdue. */
  readonly over: number;
  readonly evictable: boolean;
}

export interface StorageUsage {
  /** False when `navigator.storage.estimate()` is not exposed. */
  readonly supported: boolean;
  /** Why the browser numbers are missing, when they are. */
  readonly unavailableReason: string | null;
  /** Bytes used across the origin, per the browser. Null when unsupported. */
  readonly usageBytes: number | null;
  /** Bytes the origin may use, per the browser. Null when unsupported. */
  readonly quotaBytes: number | null;
  /** usage / quota, or null. Compare against `STORAGE_PRESSURE_RATIO`. */
  readonly ratio: number | null;
  /** True when the origin is close enough to its quota to stop caching. */
  readonly underPressure: boolean;
  /** Row counts, which are always available because we count them ourselves. */
  readonly stores: readonly StoreUsage[];
}

/**
 * How much room is left, honestly.
 *
 * Two independent answers. The browser's `navigator.storage.estimate()` is
 * optional, coarse and sometimes padded - so it is capability-detected and
 * reported as unavailable rather than guessed. Row counts come from this
 * database and are always real, which is what makes the caps in `policy.ts`
 * enforceable even on a platform that reports no quota at all.
 */
export async function estimateUsage(db: FwmDatabase): Promise<StorageUsage> {
  const stores: StoreUsage[] = [];
  for (const store of STORE_NAMES) {
    if (!db.objectStoreNames.contains(store)) continue;
    const rows = await db.count(store);
    const cap = STORE_CAPS[store];
    stores.push({
      store,
      rows,
      cap,
      over: cap === null ? 0 : Math.max(0, rows - cap),
      evictable: !(EVICTION_EXEMPT_STORES as readonly StoreName[]).includes(store),
    });
  }

  const storage: StorageManager | undefined = globalThis.navigator?.storage;
  if (storage === undefined || typeof storage.estimate !== 'function') {
    return {
      supported: false,
      unavailableReason: 'navigator.storage.estimate() is not exposed by this browser',
      usageBytes: null,
      quotaBytes: null,
      ratio: null,
      underPressure: false,
      stores,
    };
  }

  try {
    const estimate = await storage.estimate();
    const usageBytes = estimate.usage ?? null;
    const quotaBytes = estimate.quota ?? null;
    const ratio =
      usageBytes !== null && quotaBytes !== null && quotaBytes > 0 ? usageBytes / quotaBytes : null;
    return {
      supported: true,
      unavailableReason: null,
      usageBytes,
      quotaBytes,
      ratio,
      underPressure: ratio !== null && ratio >= STORAGE_PRESSURE_RATIO,
      stores,
    };
  } catch (cause) {
    return {
      supported: false,
      unavailableReason: `navigator.storage.estimate() threw: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      usageBytes: null,
      quotaBytes: null,
      ratio: null,
      underPressure: false,
      stores,
    };
  }
}

// ---------------------------------------------------------------------------
// Clearing local data
// ---------------------------------------------------------------------------

/**
 * Exactly what `clearLocalData()` removed.
 *
 * Every number is counted before the delete, not estimated after it, so the
 * confirmation a user reads is the truth about their own device.
 */
export interface ClearLocalDataReport {
  /** Encrypted plate rows removed - ciphertext, IVs and blind indexes. */
  readonly plateCiphertextRows: number;
  /** Local match-index rows removed. */
  readonly plateMatchRows: number;
  /** Names of the secret settings removed, including the vault key reference. */
  readonly secretSettingsRemoved: readonly string[];
  /** True when the `plateVault.keyId` reference was present and is now gone. */
  readonly vaultKeyReferenceCleared: boolean;
  readonly alerts: number;
  readonly trips: number;
  /**
   * Attached photographs removed. Unlike the reports themselves, these DO go -
   * see the note on `clearLocalData()` for why the two are treated differently.
   */
  readonly photosRemoved: number;
  /** Always 0. Signed evidence is not cleared by this operation - see below. */
  readonly signedReportsRemoved: number;
  /** Reports still on disk after the clear, so the user is not surprised. */
  readonly signedReportsRetained: number;
}

/**
 * Remove the local-only secrets and the driving history.
 *
 * WHAT GOES: encrypted plate values, the local encryption key reference, the
 * match index, trips, alerts, and the photographs attached to reports.
 *
 * WHAT STAYS, AND WHY: signed reports and their chain. They are evidence the
 * user deliberately created, they are cryptographically linked, and deleting
 * one breaks the chain for every record after it. A "clear my data" button
 * that shreds them would be the single most destructive control in the app.
 * The report says how many were retained so the user can go and deal with
 * them explicitly - which is the correct, separate action.
 *
 * WHY THE PHOTOGRAPHS GO WHILE THE REPORTS STAY. A signed report is a link in a
 * chain and removing one breaks verification for everything after it. A
 * photograph is a leaf: what the chain committed to is the DIGEST, and the
 * digest stays in the payload, so deleting the bytes breaks no signature, no
 * payload hash and no chain link. The retained report goes on saying, truthfully,
 * "there was a photograph and this was its digest" - while the picture of a real
 * place, which is the artefact that most obviously puts a person somewhere, is
 * gone. It costs no integrity, so it is not a trade-off, and leaving it behind
 * would make this the one control in the app that half-works.
 *
 * The vault's non-exportable `CryptoKey` itself lives in the crypto service's
 * own key store; this clears the reference held here. Callers wiring the two
 * together should clear both, and the report names the reference so it is
 * obvious that is what happened.
 */
export async function clearLocalData(db: FwmDatabase): Promise<ClearLocalDataReport> {
  const repos = createRepositories(db);

  const [plateRows, matchRows, alertRows, tripRows, photoRows, keyIdBefore, retained] =
    await Promise.all([
      repos.plateVault.count(),
      repos.plateMatches.count(),
      repos.alerts.count(),
      repos.trips.count(),
      repos.reportPhotos.count(),
      repos.settings.get('plateVault.keyId'),
      repos.pendingReports.count(),
    ]);

  await repos.plateVault.clear();
  await repos.plateMatches.clear();
  await repos.alerts.clear();
  await repos.trips.clear();
  await repos.reportPhotos.clear();
  const secretSettingsRemoved = await repos.settings.clearSecrets();

  return {
    plateCiphertextRows: plateRows,
    plateMatchRows: matchRows,
    secretSettingsRemoved,
    vaultKeyReferenceCleared:
      keyIdBefore !== undefined && secretSettingsRemoved.includes('plateVault.keyId'),
    alerts: alertRows,
    trips: tripRows,
    photosRemoved: photoRows,
    signedReportsRemoved: 0,
    signedReportsRetained: retained,
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { DB_NAME, STORE_NAMES } from './schema.ts';
export { DB_VERSION, MIGRATIONS, MigrationError } from './migrations.ts';
export type { Migration, MigrationContext, UpgradeTransaction } from './migrations.ts';
export * from './policy.ts';
export * from './backoff.ts';
export type { FwmDatabase, RepositoryDeps, EvictionReport } from './repositories/support.ts';
export { RepositoryError, resolveDeps, systemDeps } from './repositories/support.ts';
export {
  assertPlateVaultRecordSafe,
  looksLikePlate,
  looksLikePlateToken,
  PlateVaultWriteError,
} from './repositories/plateVault.ts';
export { createCameraTilesRepository } from './repositories/cameraTiles.ts';
export type { CacheIncoherence, CameraCacheSnapshot } from './repositories/cameraTiles.ts';
export { createTileMetaRepository } from './repositories/tileMeta.ts';
export { createAlertsRepository } from './repositories/alerts.ts';
export { createTripsRepository } from './repositories/trips.ts';
export { createPendingReportsRepository } from './repositories/pendingReports.ts';
export { createReportChainRepository } from './repositories/reportChain.ts';
export { createReportPhotosRepository } from './repositories/reportPhotos.ts';
export { createPendingActionsRepository } from './repositories/pendingActions.ts';
export { createSettingsRepository } from './repositories/settings.ts';
export { createSessionRepository } from './repositories/session.ts';
export { createPlateVaultRepository } from './repositories/plateVault.ts';
export { createPlateMatchesRepository } from './repositories/plateMatches.ts';
export { EvidenceImmutabilityError } from './repositories/pendingReports.ts';
export { ChainLinkageError } from './repositories/reportChain.ts';
export type * from './schema.ts';
