/**
 * The DB-age warning: an amber left rule and one sentence.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED`, line 119 --
 * `border-left:2px solid #FFC02E; padding-left:12px`, 11px mono `#A7AFBD` at
 * `line-height:1.8`.
 *
 * It is a `role="note"`, not a `role="alert"`: it is the standing caveat on
 * everything above it, and a screen reader must not treat opening this screen
 * as an interruption. The camera alert is the only thing on this product that
 * interrupts.
 *
 * While the cache read is still in flight there is nothing honest to say about
 * the age of the database, so nothing is rendered. A sentence that guesses at
 * the freshness of a database it has not opened is the exact failure this
 * warning exists to prevent.
 *
 * The sentence is chosen from the same counts the counters above it are
 * printing, which is why the counts are props here: "Nothing is cached" over
 * `CACHED CAMS 4,182` is the same failure wearing a different coat.
 */

import type { ReactElement } from 'react';

import type { CacheIncoherence } from '../../../services/db';

import { dbAgeWarning } from '../format.ts';

export interface CacheNoticeProps {
  /** Age of the oldest cached tile check, or null when there is no check. */
  readonly ageMs: number | null;
  /** Age of the oldest tile fetch. The only age an unchecked cache has. */
  readonly cachedAgeMs: number | null;
  /**
   * Distinct cameras on disk. The sentence for "never checked" depends on it:
   * a cache with cameras in it may not be described as empty.
   */
  readonly cachedCameras: number | null;
  /** False when IndexedDB is missing or the open failed. */
  readonly storageAvailable: boolean;
  /** Why storage is gone, in the database layer's words. Rendered, not logged. */
  readonly storageReason: string | null;
  /** True until the cache read settles. Suppresses the whole line. */
  readonly pending: boolean;
  /** Why rows on disk are not being counted. See `cache.ts`. */
  readonly incoherence?: CacheIncoherence;
  /** True when the disk snapshot is older than the warnings running now. */
  readonly behindLiveGeneration?: boolean;
}

export function CacheNotice({
  ageMs,
  cachedAgeMs,
  cachedCameras,
  storageAvailable,
  storageReason,
  pending,
  incoherence,
  behindLiveGeneration,
}: CacheNoticeProps): ReactElement | null {
  if (pending) return null;
  const warning = dbAgeWarning({
    ageMs,
    cachedAgeMs,
    cachedCameras,
    storageAvailable,
    storageReason,
    ...(incoherence === undefined ? {} : { incoherence }),
    ...(behindLiveGeneration === undefined ? {} : { behindLiveGeneration }),
  });

  return (
    <p className="fwm-offline-notice" data-fwm-offline-notice={warning.kind} role="note">
      {warning.text}
      {warning.detail === null ? null : (
        <span className="fwm-offline-notice-detail" data-fwm-offline-notice-detail="true">
          {warning.detail}
        </span>
      )}
    </p>
  );
}
