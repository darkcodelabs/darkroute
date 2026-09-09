/**
 * The removal path. One function, wired to the real repositories.
 *
 * =============================================================================
 * WHY THIS FILE IS SIX LINES OF LOGIC AND FIFTY OF REASONS
 * =============================================================================
 * `services/privacy/forget.ts#forgetLocalIdentity` is the single removal path
 * in this product, and `docs/plate-data-handling.md#removal` says so in
 * writing: "the UI must call this and nothing else." A screen that cleared the
 * database itself would clear one of the two stores a plate lives in -- the
 * ciphertext in `fwm`, the non-exportable `CryptoKey` in `fwm-crypto` -- and
 * leave the other behind. A removal that leaves recoverable data is worse than
 * no removal, because the user has been told it is gone.
 *
 * So this module opens the two things `forgetLocalIdentity` needs, hands them
 * over, and closes what it opened. It contains no `clear()` call of its own,
 * and it must not grow one.
 *
 * =============================================================================
 * WHAT COMES BACK IS COUNTED, NOT CLAIMED
 * =============================================================================
 * `describeForgetReport()` turns the report into the lines SETTINGS renders,
 * and every figure in it was counted BEFORE the delete. That is why the screen
 * shows a list of numbers instead of a toast that says "done": the same doc
 * asks for "the real counts, not a toast". When key destruction fails, those
 * lines say so -- this module never upgrades a partial wipe to a clean one.
 *
 * =============================================================================
 * NOTHING LEAVES THE DEVICE, INCLUDING THE ERROR
 * =============================================================================
 * No network call, no log line, no URL parameter, no analytics event. The
 * failure branch reports the error's CONSTRUCTOR NAME and never its message:
 * this code path handles plate material, and an error string that got near it
 * is the kind of thing that ends up in a crash report.
 */

import { createPlateVault } from '../../services/crypto/plate.ts';
import { closeFwmDb, hasIndexedDb, openFwmDb } from '../../services/db';
import type { FwmDatabase } from '../../services/db';
import { describeForgetReport, forgetLocalIdentity } from '../../services/privacy/forget.ts';

/**
 * The result of one press.
 *
 * `removed` carries the counted lines -- including, when key destruction
 * failed, the line that says so. `unavailable` means nothing was attempted.
 */
export type RemovalOutcome =
  | { readonly status: 'removed'; readonly lines: readonly string[] }
  | { readonly status: 'unavailable'; readonly reason: string };

/** Injected by the screen so a test never touches a real database. */
export type RemovalPort = () => Promise<RemovalOutcome>;

/**
 * Said when the platform has no IndexedDB at all.
 *
 * This is not a failure to delete. A browser with no IndexedDB never stored a
 * plate, a trip or an alert in the first place, and telling the user "removal
 * failed" would be alarming and untrue.
 */
export const NO_LOCAL_STORE =
  'this browser exposes no IndexedDB, so nothing was ever stored on this device';

function failureReason(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : 'unknown error';
  return `nothing was removed: the local database could not be opened (${name})`;
}

/**
 * Erase every local-only secret and the driving history, in both stores.
 *
 * Idempotent: pressing it twice on an already-empty device reports zeroes and
 * throws nothing. That is `forgetLocalIdentity`'s guarantee, not this file's.
 */
export const removeLocalData: RemovalPort = async () => {
  if (!hasIndexedDb()) return { status: 'unavailable', reason: NO_LOCAL_STORE };

  let db: FwmDatabase | null = null;
  try {
    db = await openFwmDb();
    // The default vault is the real one: `indexedDbPlateStore()` over the
    // separate `fwm-crypto` database, and a key manager that refuses an
    // ephemeral key store. Passing anything else here would be a test double
    // shipped to production.
    const report = await forgetLocalIdentity({ db, vault: createPlateVault() });
    return { status: 'removed', lines: describeForgetReport(report) };
  } catch (cause) {
    return { status: 'unavailable', reason: failureReason(cause) };
  } finally {
    if (db !== null) closeFwmDb(db);
  }
};
