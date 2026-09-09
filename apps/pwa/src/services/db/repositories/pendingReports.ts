/**
 * The queue of signed reports - DEAD DROP's "3 HELD".
 *
 * WHAT THIS STORE PROMISES: a record that goes in comes out byte-identical, or
 * a write throws. "Reports are signed the moment you file them and held until
 * you're on WiFi. Nothing is edited after the fact."
 * (`Flockys Screens II.dc.html` B2 · DEAD DROP.)
 *
 * The one exception is `syncState`, and it is not really an exception: the
 * signature covers the canonical payload and the chain hash covers
 * `payloadHash` + `previousChainHash`, so the queue state is outside
 * everything anything committed to. `updateSyncState()` rewrites that single
 * field and diffs all twelve of the others against what is on disk first. A
 * caller that tries to "correct" a hash gets an exception, not a silent write.
 *
 * NOTHING IN THIS FILE EVICTS. There is no cap, no expiry and no LRU. If the
 * device runs out of storage with reports queued, the right answer is to tell
 * the user, not to delete the evidence they filed precisely because they
 * expected to still have it in a month. `purgeSynced()` exists and is the only
 * removal path - it drops only records the server has acknowledged, and only
 * when a human asks, and it drops the report's photograph in the same
 * transaction so the bytes can never outlive the row that names them.
 */

import { IMMUTABLE_REPORT_FIELDS } from '../schema.ts';
import type { SignedReportRecord } from '../schema.ts';
import type { FwmDatabase } from './support.ts';
import { RepositoryError } from './support.ts';

export class EvidenceImmutabilityError extends RepositoryError {
  constructor(
    readonly reportId: string,
    readonly field: string,
  ) {
    super(
      `report ${reportId} is finalised: ${field} cannot be changed. ` +
        'Corrections are new linked records, not edits.',
      'pendingReports',
    );
  }
}

export interface PendingReportsRepository {
  /** Store a finalised record. Re-adding an identical record is a no-op. */
  add(record: SignedReportRecord): Promise<void>;
  get(reportId: string): Promise<SignedReportRecord | undefined>;
  /** Every held record, in capture order - the DEAD DROP list. */
  all(): Promise<SignedReportRecord[]>;
  count(): Promise<number>;
  /** Advance the record's own sync state. The only mutable field. */
  updateSyncState(
    reportId: string,
    next: SignedReportRecord['syncState'],
  ): Promise<SignedReportRecord>;
  /** Remove acknowledged records only, and only on an explicit user action. */
  purgeSynced(): Promise<number>;
}

/** Field-by-field equality over the frozen half of a record. */
function firstChangedImmutableField(
  a: SignedReportRecord,
  b: SignedReportRecord,
): string | null {
  for (const field of IMMUTABLE_REPORT_FIELDS) {
    // The payload is a canonical object; comparing its canonical JSON is the
    // same comparison the signature made.
    const left = JSON.stringify(a[field]);
    const right = JSON.stringify(b[field]);
    if (left !== right) return field;
  }
  return null;
}

export function createPendingReportsRepository(db: FwmDatabase): PendingReportsRepository {
  return {
    async add(record) {
      const tx = db.transaction('pendingReports', 'readwrite');
      const existing = await tx.store.get(record.reportId);
      if (existing !== undefined) {
        const changed = firstChangedImmutableField(existing, record);
        await tx.done;
        if (changed !== null) throw new EvidenceImmutabilityError(record.reportId, changed);
        return; // identical re-add: idempotent, not an error
      }
      void tx.store.add(record);
      await tx.done;
    },

    get(reportId) {
      return db.get('pendingReports', reportId);
    },

    async all() {
      const rows = await db.getAll('pendingReports');
      // capturedAt is fixed-width ISO-8601 UTC, so lexical order is
      // chronological order and no date parsing is needed to sort evidence.
      return rows.sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0));
    },

    count() {
      return db.count('pendingReports');
    },

    async updateSyncState(reportId, next) {
      const tx = db.transaction('pendingReports', 'readwrite');
      const existing = await tx.store.get(reportId);
      if (existing === undefined) {
        await tx.done;
        throw new RepositoryError(`no report ${reportId}`, 'pendingReports');
      }
      const updated: SignedReportRecord = { ...existing, syncState: next };
      const changed = firstChangedImmutableField(existing, updated);
      if (changed !== null) {
        await tx.done;
        throw new EvidenceImmutabilityError(reportId, changed);
      }
      void tx.store.put(updated);
      await tx.done;
      return updated;
    },

    async purgeSynced() {
      const rows = await db.getAll('pendingReports');
      const doomed = rows.filter((row) => row.syncState === 'synced');
      if (doomed.length === 0) return 0;
      // Two stores, one transaction. A photograph is keyed on the reportId of
      // the body it belongs to, so deleting the body alone would leave the bytes
      // on disk with nothing naming them - and `reportPhotos` has no index and
      // no `all()`, so that orphan would be invisible to every screen and every
      // count while still being a picture of somewhere the driver has been.
      // `delete` on an absent key is a no-op, so a report filed without a photo
      // needs no existence check.
      const tx = db.transaction(['pendingReports', 'reportPhotos'], 'readwrite');
      for (const row of doomed) {
        void tx.objectStore('pendingReports').delete(row.reportId);
        void tx.objectStore('reportPhotos').delete(row.reportId);
      }
      await tx.done;
      // Still a count of REPORTS, not of rows deleted. Callers render it as
      // "2 dropped" against the drop list; widening it to include photographs
      // would make that number disagree with the list it labels.
      return doomed.length;
    },
  };
}
