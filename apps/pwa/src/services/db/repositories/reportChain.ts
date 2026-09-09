/**
 * The evidence chain and its sync queue.
 *
 * "Each drop hashes the one before it, so the queue's order is provable even
 * offline for weeks." (`Flockys Screens II.dc.html` B2 · DEAD DROP.) This
 * store is where that ordering lives, and `append()` is where it is enforced:
 * a row whose `previousChainHash` is not the current head's `chainHash` is
 * refused. A chain you can append to out of order is not a chain.
 *
 * The retry machinery is here rather than in a sync service because the two
 * cannot disagree: the state on disk IS the queue. `markFailed()` either
 * schedules the next attempt with jittered exponential backoff or moves the
 * row to `dead_letter` with a written reason. It never deletes.
 *
 * DEAD LETTER IS NOT DELETION. A dead-lettered report is still on disk, still
 * signed, still exportable, still part of the chain. What changed is that the
 * app stopped asking the network about it. That distinction is the difference
 * between "we gave up" and "we lost your evidence".
 */

import { GENESIS_CHAIN_HASH } from '../../crypto/chain.ts';
import type { QueueSyncState, ReportChainRecord } from '../schema.ts';
import { IMMUTABLE_CHAIN_FIELDS } from '../schema.ts';
import type { BackoffPolicy } from '../backoff.ts';
import { DEFAULT_BACKOFF_POLICY, backoffDelayMs, isExhausted, publishHoldMs } from '../backoff.ts';
import type { FwmDatabase, RepositoryDeps } from './support.ts';
import { RepositoryError, resolveDeps } from './support.ts';

export class ChainLinkageError extends RepositoryError {
  constructor(
    readonly reportId: string,
    readonly expectedPrevious: string,
    readonly actualPrevious: string,
  ) {
    super(
      `report ${reportId} does not link to the chain head: ` +
        `expected previousChainHash ${expectedPrevious}, got ${actualPrevious}`,
      'reportChain',
    );
  }
}

/** What a caller supplies. The queue fields are this store's to set. */
export type NewChainRow = Pick<
  ReportChainRecord,
  | 'reportId'
  | 'payloadHash'
  | 'previousChainHash'
  | 'chainHash'
  | 'signature'
  | 'publicKeyId'
  | 'capturedAt'
>;

export interface MarkFailedInput {
  readonly error: string;
  /** True when the server said "never", not "not now". Skips the backoff. */
  readonly permanent?: boolean;
}

/** The counts the dock REPORT bar renders as "2 QUEUED". */
export interface QueueCounts {
  readonly pending: number;
  readonly syncing: number;
  readonly synced: number;
  readonly rejected: number;
  readonly dead_letter: number;
  /** pending + syncing: the number a user would call "queued". */
  readonly queued: number;
}

export interface ReportChainRepository {
  append(row: NewChainRow): Promise<ReportChainRecord>;
  get(reportId: string): Promise<ReportChainRecord | undefined>;
  /** Every row in capture order. */
  all(): Promise<ReportChainRecord[]>;
  /** The chain hash a new record must link to. Genesis when empty. */
  headHash(): Promise<string>;
  byState(state: QueueSyncState): Promise<ReportChainRecord[]>;
  /** Rows that are runnable now: pending and past their next-attempt time. */
  due(limit?: number): Promise<ReportChainRecord[]>;
  markSyncing(reportId: string): Promise<ReportChainRecord>;
  markSynced(reportId: string): Promise<ReportChainRecord>;
  markFailed(reportId: string, input: MarkFailedInput): Promise<ReportChainRecord>;
  counts(): Promise<QueueCounts>;
  /** The selector the dock reads. Pending plus in-flight. */
  queuedCount(): Promise<number>;
  deadLetters(): Promise<ReportChainRecord[]>;
  /** Walk the stored chain and report the first break, if any. */
  verifyLinkage(): Promise<{ ok: true } | { ok: false; reportId: string; reason: string }>;
}

export function createReportChainRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps> & { readonly policy?: BackoffPolicy },
): ReportChainRepository {
  const deps = resolveDeps(overrides);
  const policy = overrides?.policy ?? DEFAULT_BACKOFF_POLICY;

  async function ordered(): Promise<ReportChainRecord[]> {
    return db.getAllFromIndex('reportChain', 'by-capturedAt');
  }

  async function patch(
    reportId: string,
    change: (existing: ReportChainRecord) => ReportChainRecord,
  ): Promise<ReportChainRecord> {
    const tx = db.transaction('reportChain', 'readwrite');
    const existing = await tx.store.get(reportId);
    if (existing === undefined) {
      await tx.done;
      throw new RepositoryError(`no chain row for ${reportId}`, 'reportChain');
    }
    const updated = change(existing);
    for (const field of IMMUTABLE_CHAIN_FIELDS) {
      if (updated[field] !== existing[field]) {
        await tx.done;
        throw new RepositoryError(
          `chain row ${reportId} is signed evidence: ${field} cannot be changed`,
          'reportChain',
        );
      }
    }
    void tx.store.put(updated);
    await tx.done;
    return updated;
  }

  return {
    async append(row) {
      const expected = await this.headHash();
      if (row.previousChainHash !== expected) {
        throw new ChainLinkageError(row.reportId, expected, row.previousChainHash);
      }
      const record: ReportChainRecord = {
        ...row,
        syncState: 'pending',
        attempts: 0,
        nextAttemptAt: deps.now(),
        // Set once, here, and never again. See `publishHoldMs`.
        publishableAt: deps.now() + publishHoldMs(deps.random),
        lastError: null,
        deadLetterReason: null,
        syncedAt: null,
      };
      const tx = db.transaction('reportChain', 'readwrite');
      const existing = await tx.store.get(row.reportId);
      if (existing !== undefined) {
        await tx.done;
        throw new RepositoryError(`chain row ${row.reportId} already exists`, 'reportChain');
      }
      void tx.store.add(record);
      await tx.done;
      return record;
    },

    get(reportId) {
      return db.get('reportChain', reportId);
    },

    all() {
      return ordered();
    },

    async headHash() {
      const rows = await ordered();
      const head = rows[rows.length - 1];
      return head === undefined ? GENESIS_CHAIN_HASH : head.chainHash;
    },

    byState(state) {
      return db.getAllFromIndex('reportChain', 'by-syncState', state);
    },

    async due(limit) {
      const now = deps.now();
      const rows = await db.getAllFromIndex('reportChain', 'by-syncState', 'pending');
      const runnable = rows
        // BOTH clocks, and the hold is the one that cannot be waived. A record
        // is runnable when the transport is ready for it AND the privacy hold
        // has expired; `nextAttemptAt: null` means "no retry pending", which is
        // not permission to publish early.
        .filter((row) => row.nextAttemptAt === null || row.nextAttemptAt <= now)
        .filter((row) => row.publishableAt === null || row.publishableAt <= now)
        .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0));
      return limit === undefined ? runnable : runnable.slice(0, Math.max(0, limit));
    },

    markSyncing(reportId) {
      return patch(reportId, (existing) => ({
        ...existing,
        syncState: 'syncing',
        nextAttemptAt: null,
      }));
    },

    markSynced(reportId) {
      const at = deps.now();
      return patch(reportId, (existing) => ({
        ...existing,
        syncState: 'synced',
        nextAttemptAt: null,
        lastError: null,
        deadLetterReason: null,
        syncedAt: at,
      }));
    },

    markFailed(reportId, input) {
      const now = deps.now();
      return patch(reportId, (existing) => {
        const attempts = existing.attempts + 1;
        const permanent = input.permanent === true;
        if (permanent || isExhausted(attempts, policy)) {
          return {
            ...existing,
            syncState: 'dead_letter',
            attempts,
            nextAttemptAt: null,
            lastError: input.error,
            deadLetterReason: permanent
              ? `server rejected permanently: ${input.error}`
              : `retries exhausted after ${String(attempts)} attempts: ${input.error}`,
          };
        }
        return {
          ...existing,
          syncState: 'pending',
          attempts,
          // `attempts - 1` because attempt n's delay is the one that precedes
          // retry n: the first failure waits `baseDelayMs`, not twice that.
          nextAttemptAt: now + backoffDelayMs(attempts - 1, policy, deps.random),
          lastError: input.error,
          deadLetterReason: null,
        };
      });
    },

    async counts() {
      const rows = await db.getAll('reportChain');
      const tally: Record<QueueSyncState, number> = {
        pending: 0,
        syncing: 0,
        synced: 0,
        rejected: 0,
        dead_letter: 0,
      };
      for (const row of rows) tally[row.syncState] += 1;
      return { ...tally, queued: tally.pending + tally.syncing };
    },

    async queuedCount() {
      const pending = await db.countFromIndex('reportChain', 'by-syncState', 'pending');
      const syncing = await db.countFromIndex('reportChain', 'by-syncState', 'syncing');
      return pending + syncing;
    },

    deadLetters() {
      return db.getAllFromIndex('reportChain', 'by-syncState', 'dead_letter');
    },

    async verifyLinkage() {
      const rows = await ordered();
      let expected = GENESIS_CHAIN_HASH;
      for (const row of rows) {
        if (row.previousChainHash !== expected) {
          return {
            ok: false,
            reportId: row.reportId,
            reason: `expected previousChainHash ${expected}, stored ${row.previousChainHash}`,
          };
        }
        expected = row.chainHash;
      }
      return { ok: true };
    },
  };
}
