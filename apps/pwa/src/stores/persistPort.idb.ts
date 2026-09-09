/**
 * THE DURABLE PERSIST PORT.
 *
 * `persist.ts` defines the port and ships an honest in-memory fallback that
 * reports `durable: false`. Nothing ever installed a real one, so every store
 * in this directory ran on that fallback: the theme mode, the alert threshold,
 * the text size and `onboarding.completedAt` were all lost on reload, and the
 * first-run gate re-ran onboarding on every cold start as a result. This is the
 * implementation that was missing.
 *
 * WHY INDEXEDDB AND NOT localStorage
 *   `persist.ts` bans the global outright and the ESLint config enforces it:
 *   synchronous, unencrypted, readable by any script on the origin, trivially
 *   snapshotted. The app already opens an IndexedDB and already keeps its
 *   evidence chain and camera cache there, so a second storage technology
 *   would be a second thing to clear when a driver asks for their data to be
 *   removed - and `removeLocalData()` would silently miss it.
 *
 * WHY A SEPARATE OBJECT STORE FROM `settings`
 *   `settings` is a typed table: a closed `SettingName` union, one guard per
 *   name. zustand persists a whole slice as one opaque JSON string keyed by a
 *   store name it picks. Sharing the table would mean widening that union for
 *   every slice, or writing rows the typed accessors would refuse to read.
 *   `storeBlobs` (schema v3) is that store.
 *
 * WHAT IS ALLOWED TO BE IN HERE
 *   Whatever `assertPersistSafe` let through, and nothing else: no plate, no
 *   plate-shaped key, no field whose NAME implies plate custody. That guard
 *   runs in `createGuardedPersistStorage` BEFORE this port ever sees the
 *   string, which is why this file does no inspection of its own - one guard,
 *   in one place, is a control; two half-guards are a gap with a comment over
 *   it.
 *
 * FAILURE IS REPORTED, NOT SWALLOWED
 *   Private-mode browsers, a full quota, and a blocked upgrade all end with the
 *   same honest outcome as having no port at all: the memory fallback, with a
 *   reason the settings screen already knows how to print. What must never
 *   happen is a port that accepts writes and quietly loses them, because that
 *   is a promise the UI would repeat.
 */

import { DatabaseUnavailableError, hasIndexedDb, openFwmDb } from '../services/db/index.ts';
import type { FwmDatabase } from '../services/db/index.ts';

import { createMemoryPersistPort, installPersistPort } from './persist.ts';
import type { PersistPort } from './persist.ts';

const STORE = 'storeBlobs' as const;

export interface IdbPersistPortOptions {
  /** Injected in tests. The app lets the port open its own connection. */
  readonly db?: FwmDatabase;
  /** Injected in tests. */
  readonly now?: () => number;
}

/**
 * Open the database and build a durable port over it.
 *
 * Returns the memory port, with the reason, when IndexedDB is unavailable or
 * the open fails. Never throws: a preference store that takes the app down on
 * start is worse than a preference store that forgets.
 */
export async function createIdbPersistPort(
  options: IdbPersistPortOptions = {},
): Promise<PersistPort> {
  const now = options.now ?? Date.now;

  if (options.db === undefined && !hasIndexedDb()) {
    return createMemoryPersistPort(
      'this browser has no IndexedDB, so settings last only until the app is closed',
    );
  }

  let db: FwmDatabase;
  try {
    db = options.db ?? (await openFwmDb());
  } catch (cause) {
    const reason =
      cause instanceof DatabaseUnavailableError
        ? cause.message
        : 'the local database could not be opened, so settings last only until the app is closed';
    return createMemoryPersistPort(reason);
  }

  return {
    durable: true,

    async getItem(name: string): Promise<string | null> {
      try {
        const row = await db.get(STORE, name);
        return row?.value ?? null;
      } catch {
        // A read failure is "no stored value", which the stores already handle:
        // they fall back to defaults and mark themselves hydrated. Throwing
        // here would leave every store permanently un-hydrated, and every
        // control on SETTINGS permanently inert.
        return null;
      }
    },

    async setItem(name: string, value: string): Promise<void> {
      await db.put(STORE, { name, value, updatedAt: now() });
    },

    async removeItem(name: string): Promise<void> {
      await db.delete(STORE, name);
    },
  };
}

/**
 * Build the port and install it as the process-wide one.
 *
 * Called once, from the entry point, before the first render. Any store that
 * rehydrates before this resolves reads from the memory port and reports
 * itself non-durable - correct, and momentary.
 */
export async function installIdbPersistPort(
  options: IdbPersistPortOptions = {},
): Promise<PersistPort> {
  return installPersistPort(await createIdbPersistPort(options));
}
