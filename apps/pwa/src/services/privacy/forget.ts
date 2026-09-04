/**
 * One removal path, so "delete my data" cannot half-work.
 *
 * A user's plate lives in two places that know nothing about each other:
 *
 *   - the ciphertext, the blind index and the key REFERENCE live in the `fwm`
 *     database, cleared by `clearLocalData()`
 *   - the actual non-exportable `CryptoKey` lives in the separate `fwm-crypto`
 *     database, cleared by the vault's `destroyVault()`
 *
 * Clearing one and not the other leaves either an orphaned key or orphaned
 * ciphertext on the device. Neither is exploitable on its own, but "we left
 * half of it behind" is not a sentence anyone wants to write in a breach
 * notice, and a user who pressed delete is entitled to have meant it.
 *
 * So the button calls this, and only this.
 *
 * WHAT THIS DELETES
 *   encrypted plate values, the vault key, the blind-index key, the local match
 *   index, the key reference, trip history, alert history, and the photographs
 *   attached to reports.
 *
 * WHAT THIS KEEPS, DELIBERATELY
 *   signed camera reports and their hash chain. They are evidence the user
 *   chose to create, each one commits to the one before it, and deleting a
 *   record in the middle breaks verification for every record after it. A
 *   "clear my data" control that silently shreds evidence would be the most
 *   destructive button in the product. The report says how many were kept so
 *   the user can deal with them as the separate, deliberate act it should be.
 *
 *   The PHOTOGRAPH attached to a kept report is not itself kept, which looks
 *   like an inconsistency and is not. A report is a link in the chain; a
 *   photograph is a leaf. What the chain committed to is the DIGEST, and the
 *   digest stays in the payload, so removing the bytes breaks no signature and
 *   no chain link - the retained report goes on saying truthfully "there was a
 *   photograph, this was its digest". Since it costs no integrity, and a
 *   picture of a real place is the artefact that most obviously puts a person
 *   somewhere, it goes. `describeForgetReport()` says so out loud rather than
 *   leaving the user to infer it from a report count.
 */

import type { PlateVault } from '../crypto/plate.ts'
import { clearLocalData } from '../db/index.ts'
import type { ClearLocalDataReport } from '../db/index.ts'
import type { FwmDatabase } from '../db/repositories/support.ts'

export interface ForgetLocalIdentityOptions {
  readonly db: FwmDatabase
  readonly vault: PlateVault
}

export interface ForgetLocalIdentityReport extends ClearLocalDataReport {
  /** True once the vault key and blind-index key are gone from the key store. */
  readonly vaultKeysDestroyed: boolean
  /**
   * Set when key destruction threw. The database side still completed - the
   * ciphertext is gone either way, which is the part that matters - but the
   * caller must surface this rather than reporting a clean wipe.
   */
  readonly vaultKeyError?: string
}

/**
 * Erase every local-only secret and the driving history, in both stores.
 *
 * Order matters. The database clear runs FIRST: if key destruction fails, the
 * user is left with an unreadable key and no ciphertext, which is harmless. The
 * reverse order would leave readable ciphertext with a live key if the database
 * clear failed - the exact state this function exists to prevent.
 *
 * Idempotent. Running it twice on an already-empty device reports zeroes and
 * throws nothing.
 */
export async function forgetLocalIdentity(
  options: ForgetLocalIdentityOptions,
): Promise<ForgetLocalIdentityReport> {
  const cleared = await clearLocalData(options.db)

  try {
    await options.vault.destroyVault()
    return { ...cleared, vaultKeysDestroyed: true }
  } catch (error) {
    // Never echo the cause verbatim into a user-facing report - it is raised
    // from the code path that handles plate material, and an error string is a
    // log line and a crash report waiting to happen.
    const message = error instanceof Error ? error.name : 'unknown error'
    return {
      ...cleared,
      vaultKeysDestroyed: false,
      vaultKeyError: `key store could not be cleared (${message}); ciphertext was removed`,
    }
  }
}

/**
 * Human-readable summary of what a removal actually did.
 *
 * Copy voice: lowercase, blunt, clinical about the numbers. Every figure is
 * counted before the delete, so this is the truth about the device rather than
 * a reassuring approximation.
 */
export function describeForgetReport(report: ForgetLocalIdentityReport): string[] {
  const lines = [
    `${String(report.plateCiphertextRows)} encrypted plate${report.plateCiphertextRows === 1 ? '' : 's'} deleted`,
    `${String(report.plateMatchRows)} match index${report.plateMatchRows === 1 ? '' : 'es'} deleted`,
    report.vaultKeysDestroyed
      ? 'encryption keys destroyed'
      : 'encryption keys could NOT be destroyed',
    `${String(report.trips)} trip${report.trips === 1 ? '' : 's'} and ${String(report.alerts)} alert${report.alerts === 1 ? '' : 's'} deleted`,
    `${String(report.photosRemoved)} attached photograph${report.photosRemoved === 1 ? '' : 's'} deleted`,
  ]

  if (report.signedReportsRetained > 0) {
    // The photo clause rides on THIS line, not on its own, because this is the
    // line that creates the misreading it corrects: told only that reports were
    // kept, a user reasonably assumes the pictures inside them were kept too.
    // A photograph cannot exist without a report to hang on, so whenever any
    // were removed there is a retained-report line here to carry the news.
    const kept =
      `${String(report.signedReportsRetained)} signed camera report${report.signedReportsRetained === 1 ? '' : 's'} kept - ` +
      'deleting one breaks the chain for the rest. clear them separately.'
    lines.push(
      report.photosRemoved > 0
        ? `${kept} the photographs they named are gone - the signature covers the digest, not the picture.`
        : kept,
    )
  }

  if (report.vaultKeyError !== undefined) {
    lines.push(report.vaultKeyError)
  }

  return lines
}
