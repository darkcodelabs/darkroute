/**
 * THE LOG SURVIVES A RELOAD.
 *
 * =============================================================================
 * THE BUG
 * =============================================================================
 * `history.ts` says its durable copy "lives in IndexedDB
 * (`services/db/repositories/alerts.ts`, `trips.ts`) and is loaded back through
 * `hydrate`". Both repositories were written and tested. Neither was ever
 * wired up.
 *
 * Nothing called `historyActions.hydrate()` - a comment in `intelState.ts`
 * says so outright - and nothing wrote an alert to the repository either. So
 * the timeline, the trip and the exposure counters were RAM only. A refresh
 * mid-drive, a tab eviction, or the phone reclaiming memory at a traffic light
 * threw away everything collected so far, and the screen came back reading
 * zero as though the drive had not happened.
 *
 * Reported as: "every time I am driving around, this loses what I collected if
 * I refresh."
 *
 * =============================================================================
 * WRITE-THROUGH, NOT WRITE-BEHIND
 * =============================================================================
 * Each alert is written as it is recorded rather than flushed on some interval
 * or on `beforeunload`. A driving app does not get a clean shutdown: the tab is
 * killed by the OS, the phone is unplugged, the browser is swiped away. Any
 * design that batches loses exactly the window it was meant to protect.
 *
 * The write is FIRE AND FORGET against the store, deliberately. `record()` is
 * called from the alert path, which runs on every position fix, and making it
 * async would put IndexedDB latency between a camera coming into range and the
 * driver being told. A failed write costs one row from the durable copy; a
 * slow alert costs the entire point of the product.
 *
 * =============================================================================
 * WHAT DOES NOT PERSIST, AND WHY
 * =============================================================================
 * `AlertRecord.cameraId` is a non-nullable string, but an `AlertLogEntry` may
 * have a null one - dropping back to `clear` with the nearest camera two miles
 * off is a real transition about no camera in particular. Those rows stay in
 * RAM only rather than being given a fabricated camera id or forcing a schema
 * migration mid-drive. The consequence is stated rather than hidden: after a
 * reload the timeline holds every camera encounter and not the clear
 * transitions between them, and the exposure counts - which only ever counted
 * camera passes - are exact.
 */

import { openFwmDb } from '../services/db/index.ts';
import { createAlertsRepository } from '../services/db/index.ts';
import { createTripsRepository } from '../services/db/index.ts';
import type { AlertsRepository } from '../services/db/repositories/alerts.ts';
import type { TripsRepository } from '../services/db/repositories/trips.ts';
import { DEFAULT_MAX_HISTORY_ENTRIES } from './fwmCore.ts';
import { historyActions } from './history.ts';
import type { AlertLogEntry } from './history.ts';

interface Repos {
  readonly alerts: AlertsRepository;
  readonly trips: TripsRepository;
}

let repos: Repos | null = null;
let opening: Promise<Repos | null> | null = null;

/**
 * Open once, share the handle.
 *
 * Returns null rather than throwing when IndexedDB is unavailable - private
 * browsing, a storage-blocked context, a quota refusal. The app runs fine
 * without a durable log; it just forgets, which is what it did before this
 * file existed.
 */
async function open(): Promise<Repos | null> {
  if (repos !== null) return repos;
  opening ??= (async () => {
    try {
      const db = await openFwmDb();
      repos = { alerts: createAlertsRepository(db), trips: createTripsRepository(db) };
      return repos;
    } catch {
      return null;
    }
  })();
  return opening;
}

/**
 * Write one alert through to disk.
 *
 * Not awaited by the caller. See the header: the alert path runs on every
 * position fix and must not wait on storage.
 */
export function persistAlert(entry: AlertLogEntry): void {
  if (entry.cameraId === null) return;
  const cameraId = entry.cameraId;
  void (async () => {
    const open_ = await open();
    if (open_ === null) return;
    try {
      await open_.alerts.record({
        cameraId,
        state: entry.state,
        // The repository's contract is a number; an entry with no measured
        // distance is recorded at zero rather than dropped, because the fact
        // that the camera was passed is the part that matters to a count.
        distanceFt: entry.distanceFt ?? 0,
        headingDeg: entry.headingDeg,
        speedMph: entry.speedMph,
        at: entry.atMs,
        muted: entry.muted,
        dismissed: false,
      });
    } catch {
      // A dropped row is survivable. A thrown promise on the alert path is not.
    }
  })();
}

/**
 * Load the log back into the store.
 *
 * Called from `bootStores`, after the persist port is installed, so it cannot
 * race the settings rehydrate that decides whether storage works at all.
 */
export async function hydrateHistory(): Promise<boolean> {
  const open_ = await open();
  if (open_ === null) return false;
  try {
    const [records, allTime] = await Promise.all([
      open_.alerts.recent(DEFAULT_MAX_HISTORY_ENTRIES),
      open_.trips.totalExposure(),
    ]);
    const entries: AlertLogEntry[] = records.map((record, index) => ({
      // The store's ids are session-local and monotonic; the durable id is
      // IndexedDB's. Re-numbering here keeps `record()` from ever colliding
      // with a restored row.
      id: index + 1,
      cameraId: record.cameraId,
      // Not stored: `label` is a property of the CAMERA, so the screen reads it
      // from the camera record rather than from a copy that could go stale.
      label: null,
      atMs: record.at,
      state: record.state,
      // Not stored either. A restored row is a fact that a camera was passed,
      // not a replay of the transition that produced it.
      previousState: 'clear',
      distanceFt: record.distanceFt,
      speedMph: record.speedMph,
      headingDeg: record.headingDeg,
      muted: record.muted,
      outcome: record.dismissed ? 'dismissed' : null,
    }));
    historyActions.hydrate(entries, allTime === 0 ? null : allTime, null);
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget the cached handle. */
export function resetHistoryPersistence(): void {
  repos = null;
  opening = null;
}
