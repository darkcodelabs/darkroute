/**
 * Numbered migrations for the `fwm` database.
 *
 * RULES THIS FILE EXISTS TO ENFORCE
 *
 *  1. A migration is a pure function of the upgrade transaction. It reads and
 *     writes only through the `tx` it is handed. It never calls `openDB`,
 *     never touches `Date.now()` for anything it stores as data, and never
 *     reaches for a repository - repositories assume a finished schema.
 *  2. Migrations are numbered and run in ascending order, exactly once each,
 *     for versions strictly greater than the version already on disk. A user
 *     who skipped four releases runs four migrations in order, not one merged
 *     "latest schema" step.
 *  3. Adding a store or an index later must never require a destructive
 *     rebuild. There is no `deleteObjectStore` in this file and there is not
 *     meant to be one. If a store's shape has to change, the migration adds
 *     the new shape alongside the old and backfills it - the way v2 adds
 *     `plateMatches` and the `by-capturedAt` index without disturbing a single
 *     signed report already sitting in the queue.
 *
 *  A migration that would drop signed evidence is a bug, not a migration.
 */

import { unwrap } from 'idb';
import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';

import type { FwmDB, ReportChainRecord, StoreName } from './schema.ts';
import { STORE_NAMES } from './schema.ts';

/** The versionchange transaction, typed against our schema. */
export type UpgradeTransaction = IDBPTransaction<FwmDB, StoreNames<FwmDB>[], 'versionchange'>;

export interface MigrationContext {
  readonly db: IDBPDatabase<FwmDB>;
  readonly tx: UpgradeTransaction;
}

export interface Migration {
  /** The schema version this migration produces. */
  readonly version: number;
  /** One line, present tense, for the upgrade log and for the CHANGELOG. */
  readonly describe: string;
  /** Synchronous. See `rewriteStore()` for data moves that need a cursor. */
  up(ctx: MigrationContext): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rewrite every record in a store, in place, inside the upgrade transaction.
 *
 * Callback style on the raw `IDBTransaction` rather than `await`, on purpose.
 * A versionchange transaction stays alive only while requests are outstanding;
 * the moment a migration awaits something that is not an IDB request, the
 * transaction commits underneath it and the rest of the rewrite lands in a
 * transaction that no longer exists. Issuing the next request from the
 * previous request's success handler cannot get that wrong.
 *
 * `map` returns the replacement record, or `null` to leave the record alone.
 */
export function rewriteStore<Name extends StoreNames<FwmDB> & string, Value>(
  tx: UpgradeTransaction,
  storeName: Name,
  map: (value: Value) => Value | null,
): void {
  const raw = unwrap(tx);
  const request = raw.objectStore(storeName).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    const next = map(cursor.value as Value);
    if (next !== null) cursor.update(next);
    cursor.continue();
  };
}

/**
 * v1 - the shipping schema.
 *
 * Key shapes are chosen so the app's hot paths are index reads, not scans:
 * tiles are keyed by their slippy address `[z, x, y]` because that is what the
 * map asks for; alerts carry a `by-at` index because LOG renders newest-first;
 * `cameraTiles` carries `by-fetchedAt` because eviction has to find the oldest
 * tile without loading every tile body into memory to do it.
 */
const migration1: Migration = {
  version: 1,
  describe:
    'create cameraTiles, tileMeta, alerts, trips, pendingReports, reportChain, pendingActions, settings, session, plateVault',
  up({ db }) {
    if (!db.objectStoreNames.contains('cameraTiles')) {
      const tiles = db.createObjectStore('cameraTiles', { keyPath: ['z', 'x', 'y'] });
      // Eviction reads this index oldest-first and never touches a tile body.
      tiles.createIndex('by-fetchedAt', 'fetchedAt');
    }

    if (!db.objectStoreNames.contains('tileMeta')) {
      db.createObjectStore('tileMeta', { keyPath: ['z', 'x', 'y'] });
    }

    if (!db.objectStoreNames.contains('alerts')) {
      const alerts = db.createObjectStore('alerts', { keyPath: 'id', autoIncrement: true });
      alerts.createIndex('by-at', 'at');
      alerts.createIndex('by-cameraId', 'cameraId');
    }

    if (!db.objectStoreNames.contains('trips')) {
      const trips = db.createObjectStore('trips', { keyPath: 'id', autoIncrement: true });
      trips.createIndex('by-startedAt', 'startedAt');
    }

    // Signed evidence. No index: it is read by id, exported whole, and never
    // sorted by anything that is not already in the chain store.
    if (!db.objectStoreNames.contains('pendingReports')) {
      db.createObjectStore('pendingReports', { keyPath: 'reportId' });
    }

    if (!db.objectStoreNames.contains('reportChain')) {
      const chain = db.createObjectStore('reportChain', { keyPath: 'reportId' });
      chain.createIndex('by-syncState', 'syncState');
    }

    if (!db.objectStoreNames.contains('pendingActions')) {
      const actions = db.createObjectStore('pendingActions', {
        keyPath: 'id',
        autoIncrement: true,
      });
      actions.createIndex('by-state', 'state');
      actions.createIndex('by-nextAttemptAt', 'nextAttemptAt');
    }

    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'name' });
    }

    if (!db.objectStoreNames.contains('session')) {
      db.createObjectStore('session', { keyPath: 'key' });
    }

    // Ciphertext only. Keyed by an opaque id that is never derived from the
    // plate, and carrying no index at all - an index over this store is an
    // ordering an attacker can query.
    if (!db.objectStoreNames.contains('plateVault')) {
      db.createObjectStore('plateVault', { keyPath: 'plateId' });
    }
  },
};

/**
 * v2 - local plate matching, and ordering the drop queue by capture time.
 *
 * Two additions and one backfill, none of which reads or rewrites a signed
 * field:
 *
 *  - `plateMatches`, the on-device match index behind WATCHLIST's "73 reads".
 *  - `by-capturedAt` on `reportChain`, because DEAD DROP lists drops in capture
 *    order ("DROP 03 · DROP 02 · DROP 01") and v1 could only sort by sync
 *    state.
 *  - any chain row written before the sync fields existed gets them, so the
 *    queue selector never has to cope with `undefined`.
 */
const migration2: Migration = {
  version: 2,
  describe: 'add plateMatches, index reportChain by capturedAt, backfill chain sync fields',
  up({ db, tx }) {
    if (!db.objectStoreNames.contains('plateMatches')) {
      const matches = db.createObjectStore('plateMatches', { keyPath: 'matchId' });
      matches.createIndex('by-plateId', 'plateId');
      matches.createIndex('by-at', 'at');
    }

    const chain = tx.objectStore('reportChain');
    if (!chain.indexNames.contains('by-capturedAt')) {
      chain.createIndex('by-capturedAt', 'capturedAt');
    }

    rewriteStore<'reportChain', ReportChainRecord>(tx, 'reportChain', (record) => {
      if (typeof record.syncState === 'string') return null;
      return {
        ...record,
        syncState: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        deadLetterReason: null,
        syncedAt: null,
      };
    });
  },
};

/**
 * v3 - durable preferences.
 *
 * The zustand persist port had no durable implementation, so every store in
 * `src/stores` ran on the honest in-memory fallback: the theme mode, the alert
 * threshold, the text size and `onboarding.completedAt` all reset on reload,
 * and the first-run gate therefore re-ran onboarding on every cold start. The
 * settings screen said so out loud - "held in memory for this session only" -
 * which is exactly what that reason field is for, but saying it is not fixing
 * it.
 *
 * `storeBlobs` is that store. It is separate from `settings` because the two
 * have different shapes: `settings` is a typed table with a closed name list
 * and one guard per name, and zustand persists an opaque JSON string per slice.
 */
const migration3: Migration = {
  version: 3,
  describe: 'add storeBlobs, the durable backing store for persisted preferences',
  up({ db }) {
    if (!db.objectStoreNames.contains('storeBlobs')) {
      db.createObjectStore('storeBlobs', { keyPath: 'name' });
    }
  },
};

/**
 * v4 - the byte store for photographs attached to reports.
 *
 * The signed record cannot carry the bytes: it is frozen at signing time and
 * `IMMUTABLE_REPORT_FIELDS` diffs its fields by `JSON.stringify`. What the
 * signature commits to is the SHA-256 in the payload's `photo` field, which
 * until now was always null. `reportPhotos` holds the bytes that digest names,
 * keyed by the same `reportId` as the body so the two can never be separated by
 * accident.
 *
 * No index, matching `plateVault` and `pendingReports`: an index over this store
 * would be an ordering of somebody's photographs, and nothing needs one.
 *
 * No backfill. Every report written before this version carries `photo: null`,
 * and a report with no photo row is the ordinary case rather than a gap.
 */
const migration4: Migration = {
  version: 4,
  describe: 'add reportPhotos, the byte store for photographs attached to reports',
  up({ db }) {
    if (!db.objectStoreNames.contains('reportPhotos')) {
      db.createObjectStore('reportPhotos', { keyPath: 'reportId' });
    }
  },
};

/**
 * v5 - one transactional generation identity for the camera tile cache.
 *
 * Per-row generation fields cannot prevent two tabs from interleaving old and
 * new writes. This sentinel shares every camera write transaction, making the
 * browser's IndexedDB transaction ordering the cross-tab compare-and-swap.
 * Existing rows intentionally receive no guessed identity; the first online
 * generation replaces them atomically.
 */
const migration5: Migration = {
  version: 5,
  describe: 'add the DB-wide camera generation sentinel',
  up({ db, tx }) {
    if (!db.objectStoreNames.contains('cameraCacheState')) {
      db.createObjectStore('cameraCacheState', { keyPath: 'key' });
    }
    const tiles = tx.objectStore('cameraTiles');
    if (!tiles.indexNames.contains('by-generation')) {
      tiles.createIndex('by-generation', 'generation');
    }
  },
};

/** Every migration, ascending. Append only. */
export const MIGRATIONS: readonly Migration[] = [
  migration1,
  migration2,
  migration3,
  migration4,
  migration5,
];

/** The version `openFwmDb()` opens at: the highest migration number. */
export const DB_VERSION: number = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
  constructor(
    message: string,
    readonly version: number,
    options?: { cause: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Run every migration newer than what is on disk.
 *
 * Returns the descriptions that ran, so the caller can log an upgrade path
 * ("0 → 2") without this module importing a logger.
 *
 * `oldVersion` is 0 for a database that has never existed, which is why the
 * v0 → v1 path is not a special case: it is just "every migration".
 */
export function applyMigrations(
  ctx: MigrationContext,
  oldVersion: number,
  migrations: readonly Migration[] = MIGRATIONS,
): readonly string[] {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const applied: string[] = [];

  for (const migration of ordered) {
    if (migration.version <= oldVersion) continue;
    try {
      migration.up(ctx);
    } catch (cause) {
      throw new MigrationError(
        `migration v${String(migration.version)} failed: ${migration.describe}`,
        migration.version,
        { cause },
      );
    }
    applied.push(`v${String(migration.version)} ${migration.describe}`);
  }

  return applied;
}

/**
 * Fail loudly when the schema on disk is missing a store the app will read.
 *
 * Called once after the upgrade transaction commits. A store that is declared
 * in `STORE_NAMES` but created by no migration is the single most common way
 * this layer breaks, and it otherwise surfaces as a `NotFoundError` deep in
 * whichever screen happened to read first.
 */
export function assertSchemaComplete(
  db: IDBPDatabase<FwmDB>,
  expected: readonly StoreName[] = STORE_NAMES,
): void {
  const missing = expected.filter((name) => !db.objectStoreNames.contains(name));
  if (missing.length > 0) {
    throw new MigrationError(
      `schema is incomplete: no migration creates ${missing.join(', ')}`,
      db.version,
    );
  }
}
