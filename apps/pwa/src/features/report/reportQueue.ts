/**
 * SUBMIT - sign it, chain it, hold it. No network, ever, on this path.
 *
 * "Reports are signed the moment you file them and held until you're on WiFi.
 *  Nothing is edited after the fact."
 * - `Flockys Screens II.dc.html`, B2 · DEAD DROP
 *
 * =============================================================================
 * WHAT PRESSING `SUBMIT REPORT` ACTUALLY DOES
 * =============================================================================
 *   1. the attached photograph's digest is checked against the one already in
 *      the payload, BEFORE anything is written. See {@link submit}.
 *   2. `chain.finalize()` canonicalises the payload, hashes it, links it to the
 *      current head and signs the link with the install's non-exportable key.
 *   3. `pendingReports.add()` stores the signed body.
 *   4. `reportChain.append()` stores the row that proves its place in the order.
 *   5. `reportPhotos.put()` stores the photograph's bytes, last, and is allowed
 *      to fail without failing the report.
 *   6. `pendingSyncCount()` reads the queue back, so the line above the button
 *      is a number measured from disk and not one this module incremented.
 *
 * There is no `fetch` in this file and no upload path anywhere behind it. A
 * report filed in a tunnel is filed; the queue is the product - and that is as
 * true of the photograph as of the body: the bytes go into IndexedDB and stop
 * there.
 *
 * =============================================================================
 * BODY BEFORE CHAIN ROW, PHOTOGRAPH LAST
 * =============================================================================
 * These writes cannot be one transaction - they are different stores behind
 * different repositories, and `reportChain.append()` re-reads the head to
 * enforce linkage. If the second write fails, the order that survives is a
 * SIGNED BODY WITH NO ROW: recoverable, because the body carries its own
 * `previousChainHash` and can be re-linked. The other order would leave a chain
 * row pointing at evidence that does not exist, which is not recoverable.
 *
 * The photograph goes after both for the same kind of reason. Bytes written
 * before the record exists are an orphan: `reportPhotos` has no index and no
 * `all()`, so nothing could ever find them again to show them or to delete
 * them, and disk that remembers a place with no owner is exactly what that
 * store must not accumulate. Written last, the worst case is a signed record
 * naming a digest whose bytes are absent - which anything that can read the
 * payload can detect, and which {@link PHOTO_NOT_STORED} says out loud.
 *
 * =============================================================================
 * NOTHING HERE LOGS
 * =============================================================================
 * A payload carries the driver's exact coordinates. There is no `console` call
 * in this file, and {@link describeQueueFailure} returns fixed sentences that
 * never interpolate the error's message, let alone the payload.
 */

import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';
import { createEvidenceChain } from '../../services/crypto/chain.ts';
import type { EvidenceChain } from '../../services/crypto/chain.ts';
import { CryptoUnavailableError } from '../../services/crypto/keys.ts';
import {
  DatabaseUnavailableError,
  closeFwmDb,
  createRepositories,
  openFwmDb,
  pendingSyncCount,
} from '../../services/db/index.ts';
import type { PendingSyncCount } from '../../services/db/index.ts';
import { ChainLinkageError } from '../../services/db/repositories/reportChain.ts';
import type { FwmDatabase } from '../../services/db/repositories/support.ts';

/**
 * The photograph, as the queue takes it: prepared bytes and the digest the
 * payload already names. This is {@link ReportPhotoRecord} minus its key, so
 * `{ reportId, ...photo }` is the stored row.
 *
 * `Uint8Array`, never a `Blob`. The memory IndexedDB double clones through
 * `structuredClone`, which turns a Blob into a plain object with no `size`, so
 * a Blob here would round-trip to `{}` in every test in this repo while working
 * in a browser - the worst possible split between what is proven and what ships.
 */
export interface ReportPhotoBytes {
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

/** What a successful submit hands back. No payload, no signature, no bytes. */
export interface QueuedReceipt {
  readonly reportId: string;
  /** Lowercase hex. DEAD DROP renders the head of this as the chain proof. */
  readonly chainHash: string;
  /** Re-read from disk after the write, never incremented in memory. */
  readonly counts: PendingSyncCount;
  /**
   * False when a photograph was handed over and its bytes did not land.
   *
   * True when there was nothing to store, because "the queue holds everything
   * it was given" is the honest reading of a photo-less report. The sheet only
   * says anything when this is false.
   */
  readonly photoStored: boolean;
}

/**
 * Thrown when the payload's `photo` digest and the bytes handed over disagree.
 *
 * A wiring slip - hashing one file and attaching another, or forgetting to pass
 * the digest into `reportPayload()` - would otherwise produce a signed record
 * that names bytes it never received, which no later reader could tell from a
 * photograph that was deleted. Checked before the first write, so a mismatch
 * queues nothing at all rather than half a report.
 */
export class PhotoDigestMismatchError extends Error {
  override readonly name = 'PhotoDigestMismatchError';

  constructor() {
    // No digests in the message: it would be interpolated into a log one day.
    super('the payload names a different photograph from the one supplied');
  }
}

export interface ReportQueuePort {
  /** The queue as it stands. Used on mount to render a real count. */
  counts(): Promise<PendingSyncCount>;
  /**
   * True when `MAX_REPORT_PHOTOS` photographs are already held.
   *
   * Asked by the report sheet BEFORE it opens the camera, because the cap is
   * enforced at the attach end: `reportPhotos` is eviction-exempt, so nothing
   * may delete a photograph to make room for another. It lives on the port
   * rather than in the screen so that `ReportScreen` keeps its rule of never
   * opening a database itself.
   */
  photosAtCapacity(): Promise<boolean>;
  submit(payload: CanonicalObject, photo?: ReportPhotoBytes): Promise<QueuedReceipt>;
  /** Release the database handle. Safe to call when nothing was opened. */
  close(): void;
}

export interface ReportQueueOptions {
  /**
   * The evidence chain to sign with. Defaults to the install's own. Injected by
   * tests, which use the sanctioned harness in `services/crypto/testing.ts` so
   * a real ECDSA signature is produced against a deterministic clock.
   */
  readonly chain?: EvidenceChain;
  /** Database name. Tests open their own so they never share a queue. */
  readonly dbName?: string;
}

export function createReportQueue(options: ReportQueueOptions = {}): ReportQueuePort {
  const chain = options.chain ?? createEvidenceChain();
  let handle: FwmDatabase | null = null;

  async function database(): Promise<FwmDatabase> {
    if (handle !== null) return handle;
    // Not cached as a promise: a failed open must be retryable, because the
    // reason is often "another tab is holding an upgrade" and that clears.
    const opened = await openFwmDb(options.dbName === undefined ? {} : { name: options.dbName });
    handle = opened;
    return opened;
  }

  return {
    async counts() {
      return pendingSyncCount(await database());
    },

    async photosAtCapacity() {
      return createRepositories(await database()).reportPhotos.atCapacity();
    },

    async submit(payload, photo) {
      // FIRST, and before anything is written. See PhotoDigestMismatchError.
      if (
    (photo !== undefined && payload['photo'] !== photo.sha256) ||
    (photo === undefined && payload['photo'] !== null)
  ) {
        throw new PhotoDigestMismatchError();
      }

      const db = await database();
      const repos = createRepositories(db);
      const previousChainHash = await repos.reportChain.headHash();
      const record = await chain.finalize({ payload, previousChainHash });

      await repos.pendingReports.add(record);
      await repos.reportChain.append({
        reportId: record.reportId,
        payloadHash: record.payloadHash,
        previousChainHash: record.previousChainHash,
        chainHash: record.chainHash,
        signature: record.signature,
        publicKeyId: record.publicKeyId,
        capturedAt: record.capturedAt,
      });

      /*
       * THE PHOTOGRAPH DOES NOT FAIL THE REPORT.
       *
       * By this line the report is filed, signed and chained. Rethrowing here
       * would surface as "not queued" on the sheet, and a driver acting on that
       * would file the same camera twice - so the failure is reported as what
       * it is, a report that was filed without its picture, and the caller
       * decides what to say. `PHOTO_NOT_STORED` is that sentence.
       */
      let photoStored = true;
      if (photo !== undefined) {
        try {
          await repos.reportPhotos.put({ reportId: record.reportId, ...photo });
        } catch {
          photoStored = false;
        }
      }

      return {
        reportId: record.reportId,
        chainHash: record.chainHash,
        counts: await pendingSyncCount(db),
        photoStored,
      };
    },

    close() {
      if (handle === null) return;
      closeFwmDb(handle);
      handle = null;
    },
  };
}

/**
 * What the sheet says when `photoStored` came back false.
 *
 * Authored, like every string in this block, because the design draws no
 * failure state for the sheet. It leads with `REPORT FILED` because that is the
 * part the driver needs first: the camera IS reported, and refiling would
 * duplicate it. GAP: see docs/gaps-inbox/report.md#no-blocked-or-failed-state-is-drawn
 */
export const PHOTO_NOT_STORED = 'REPORT FILED · PHOTO NOT STORED';

/**
 * A failure, in words the sheet can render.
 *
 * Fixed sentences, chosen by the error's TYPE. The thrown message is never
 * shown: it is written for a developer, and on this screen it could quote a
 * payload field. Authored, because the design draws no failure state for this
 * sheet. GAP: see docs/gaps-inbox/report.md#no-blocked-or-failed-state-is-drawn
 */
export function describeQueueFailure(error: unknown): string {
  if (error instanceof CryptoUnavailableError) {
    return 'THIS DEVICE CANNOT SIGN A REPORT · NOT QUEUED';
  }
  if (error instanceof DatabaseUnavailableError) {
    return 'NO LOCAL STORAGE · NOTHING CAN BE QUEUED HERE';
  }
  if (error instanceof ChainLinkageError) {
    return 'QUEUE MOVED WHILE FILING · TRY AGAIN';
  }
  if (error instanceof PhotoDigestMismatchError) {
    // Nothing was written: the check runs before the first store. Saying "not
    // queued" is therefore accurate, and the photo is named so the driver can
    // remove it and file the report they came to file.
    return 'PHOTO DOES NOT MATCH THE REPORT · NOT QUEUED';
  }
  return 'REPORT NOT QUEUED · TRY AGAIN';
}
