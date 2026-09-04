/**
 * `ALL TIME` -- the one number on this screen that outlives the session.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `05 · LOG - EXPOSURE`, the right-hand
 * stat card: `ALL TIME` / `1,284` / `SINCE MAR 2026`.
 *
 * =============================================================================
 * WHERE THE NUMBER COMES FROM
 * =============================================================================
 * `services/db/repositories/trips.ts`, whose `totalExposure()` is documented in
 * that file as "All-time exposure, for the EXPOSURE comparison" -- this screen's
 * comparison, named there. It sums `exposureCount` across the recorded trips
 * rather than reading a stored total, so the card cannot drift from what the
 * database actually holds.
 *
 * `SINCE` is the start of the OLDEST trip still on the device. Trips are capped
 * (`MAX_TRIPS`), so it is the beginning of the record we still hold rather than
 * the beginning of time -- which is what the card claims and all it claims.
 *
 * =============================================================================
 * "NOT RECORDED" IS NOT "ZERO"
 * =============================================================================
 * A device with no trips in it has no measurement of all-time exposure at all;
 * it does not have a measured zero. That reads `unavailable` here and prints an
 * em dash on the card, which is the same rule the rest of this feature follows
 * for a figure nothing measured. A device WITH trips that read no cameras has a
 * real zero, and prints `0`.
 *
 * =============================================================================
 * THIS MODULE OPENS ITS OWN CONNECTION, CLOSES IT, AND NEVER WRITES
 * =============================================================================
 * Nothing in the app publishes a shared `FwmDatabase` handle, and a screen may
 * not add one -- `services/db` is not this feature's file. So the read opens
 * `fwm`, takes two numbers and closes again, exactly as
 * `features/offline/cache.ts` does. No eviction sweep, no trim, no write: a
 * driver looking at EXPOSURE must not have their history mutated by the act of
 * looking at it.
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * Two scalars leave this module: a count of camera passes and one epoch
 * millisecond. `TripRecord.cameraIdsPassed` is never read, no coordinate exists
 * in the trips store to begin with, and no plate exists anywhere near it.
 */

import { closeFwmDb, createTripsRepository, hasIndexedDb, openFwmDb } from '../../services/db';
import type { FwmDatabase } from '../../services/db';

/**
 * One read. `unavailable` carries a sentence for a maintainer and never carries
 * user data -- the only strings that can reach it are this module's own and an
 * `Error.message` raised by the database layer. Nothing renders it today; the
 * card renders an em dash.
 */
export type AllTimeExposureRead =
  | { readonly status: 'ready'; readonly passes: number; readonly sinceMs: number }
  | { readonly status: 'unavailable'; readonly reason: string };

/** Injected by the screen so a test never touches a real database. */
export type AllTimeExposurePort = () => Promise<AllTimeExposureRead>;

const NO_INDEXEDDB = 'this browser exposes no IndexedDB, so no trip was ever stored on this device';

const NO_TRIPS = 'no trip has been recorded on this device yet';

function reasonOf(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return 'the local database could not be opened';
}

/** The real read. Read-only, and it always closes what it opened. */
export async function readAllTimeExposure(): Promise<AllTimeExposureRead> {
  if (!hasIndexedDb()) return { status: 'unavailable', reason: NO_INDEXEDDB };

  let db: FwmDatabase | null = null;
  try {
    db = await openFwmDb();
    const trips = createTripsRepository(db);
    // `since(0)` is the whole store, oldest first, off the `by-startedAt`
    // index -- the cheapest way to the earliest start without a repository
    // method that does not exist.
    const recorded = await trips.since(0);
    const oldest = recorded[0];
    if (oldest === undefined) return { status: 'unavailable', reason: NO_TRIPS };
    return { status: 'ready', passes: await trips.totalExposure(), sinceMs: oldest.startedAt };
  } catch (cause) {
    return { status: 'unavailable', reason: reasonOf(cause) };
  } finally {
    if (db !== null) closeFwmDb(db);
  }
}

/** What the `ALL TIME` card renders. Either half may be absent. */
export interface AllTimeFigure {
  readonly passes: number | null;
  readonly sinceMs: number | null;
}

const UNKNOWN: AllTimeFigure = Object.freeze({ passes: null, sinceMs: null });

/**
 * Which of the two answers the card takes.
 *
 * The history slice wins when it has one: `historyActions.hydrate()` is the
 * documented door for the durable count, and once something has come through
 * it `notePass()` keeps it live for the rest of the drive. Until then -- which
 * is every run of this build, because nothing calls `hydrate` -- the card falls
 * back to what this module read off the database itself, which is a snapshot of
 * FINISHED trips and therefore does not tick up mid-drive.
 * GAP: see docs/gaps-inbox/log.md#nothing-hydrates-the-durable-counters
 *
 * Both halves come from the SAME source. Pairing a live total with a durable
 * `SINCE` would date one number with the other's record.
 */
export function resolveAllTime(
  storePasses: number | null,
  storeSinceMs: number | null,
  durable: AllTimeExposureRead | null,
): AllTimeFigure {
  if (storePasses !== null) return { passes: storePasses, sinceMs: storeSinceMs };
  if (durable !== null && durable.status === 'ready') {
    return { passes: durable.passes, sinceMs: durable.sinceMs };
  }
  return UNKNOWN;
}
