/**
 * The bytes of the photographs attached to reports.
 *
 * ONE ROW PER REPORT, keyed by `reportId`, holding the prepared JPEG that the
 * signed payload's `photo` digest names. The report body lives in
 * `pendingReports` and the picture lives here, because a `SignedReportRecord` is
 * frozen at signing time and its immutability check diffs every field by
 * `JSON.stringify` - which is neither a meaningful nor an affordable comparison
 * for half a megabyte of image data.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT HAVE
 *
 *  - `all()`. Nothing may enumerate a driver's photographs. Every legitimate
 *    reader already knows the `reportId` it wants, and a list method is how a
 *    future screen accidentally grows a gallery of everywhere somebody has been.
 *  - `trim()`. `reportPhotos` is in `EVICTION_EXEMPT_STORES`: evicting a
 *    photograph would leave a signed record citing a digest whose bytes the app
 *    itself deleted without being asked. `MAX_REPORT_PHOTOS` is enforced at the
 *    attach end instead, which is why `atCapacity()` exists and `trim()` does
 *    not.
 *  - the immutability machinery `pendingReports.ts` carries. `put` overwrites,
 *    because re-attaching a different photograph before pressing submit is
 *    ordinary use, and nothing here is evidence until a report is signed over
 *    its digest. After that point the digest, not this store, is what anybody
 *    verifies against.
 *
 * REMOVAL. Two paths delete from here and both delete by the same key they were
 * already deleting: `clearLocalData()` clears the store wholesale, and
 * `pendingReports.purgeSynced()` drops each photograph in the same transaction
 * as the body it belongs to. Without the second one the bytes would outlive the
 * only row that names them, and with no index and no `all()` an orphan here is
 * invisible to every screen and every count while still sitting on disk.
 */

import { MAX_REPORT_PHOTOS } from '../policy.ts';
import type { ReportPhotoRecord } from '../schema.ts';
import type { FwmDatabase } from './support.ts';

export interface ReportPhotosRepository {
  /**
   * Store or replace the photograph for a report.
   *
   * `put`, not `add`: re-attaching before submit is not an error. See the file
   * header for why this store carries no immutability check.
   */
  put(record: ReportPhotoRecord): Promise<void>;
  get(reportId: string): Promise<ReportPhotoRecord | undefined>;
  count(): Promise<number>;
  /** True when a new attachment would exceed `MAX_REPORT_PHOTOS`. */
  atCapacity(max?: number): Promise<boolean>;
  /** Remove one photograph. A missing key is a no-op, not an error. */
  delete(reportId: string): Promise<void>;
  /** Drop every photograph. Returns how many there were, counted before the delete. */
  clear(): Promise<number>;
}

export function createReportPhotosRepository(db: FwmDatabase): ReportPhotosRepository {
  return {
    async put(record) {
      await db.put('reportPhotos', record);
    },

    get(reportId) {
      return db.get('reportPhotos', reportId);
    },

    count() {
      return db.count('reportPhotos');
    },

    async atCapacity(max = MAX_REPORT_PHOTOS) {
      return (await db.count('reportPhotos')) >= max;
    },

    async delete(reportId) {
      await db.delete('reportPhotos', reportId);
    },

    async clear() {
      const total = await db.count('reportPhotos');
      await db.clear('reportPhotos');
      return total;
    },
  };
}
