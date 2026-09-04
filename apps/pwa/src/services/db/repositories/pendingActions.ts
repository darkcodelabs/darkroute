/**
 * Queued confirmations and disputes - "CONFIRM STILL THERE" and "DISPUTE"
 * pressed with no network.
 *
 * These are not evidence. They are small, idempotent, replayable statements
 * about a camera, which is why they retry on a schedule and why the queue has
 * a ceiling at all. Reports do not live here; they live in `pendingReports`
 * and they are never evicted.
 *
 * OVERFLOW DOES NOT DELETE. When the queue is over `MAX_PENDING_ACTIONS`, the
 * oldest queued rows move to `dead_letter` with the reason written into the
 * row. The user can see what was dropped and why. An action that vanishes
 * because a counter hit a number is a bug report nobody can ever file.
 */

import type {
  NewPendingAction,
  PendingActionRecord,
  PendingActionState,
} from '../schema.ts';
import { MAX_PENDING_ACTIONS } from '../policy.ts';
import type { BackoffPolicy } from '../backoff.ts';
import { DEFAULT_BACKOFF_POLICY, backoffDelayMs, isExhausted } from '../backoff.ts';
import type { FwmDatabase, RepositoryDeps } from './support.ts';
import { RepositoryError, resolveDeps } from './support.ts';

export interface ActionFailureInput {
  readonly error: string;
  /** True when the server said "never". Goes straight to dead_letter. */
  readonly permanent?: boolean;
}

export interface PendingActionsRepository {
  enqueue(action: NewPendingAction): Promise<PendingActionRecord>;
  get(id: number): Promise<PendingActionRecord | undefined>;
  all(): Promise<PendingActionRecord[]>;
  byState(state: PendingActionState): Promise<PendingActionRecord[]>;
  /** Queued rows whose next-attempt time has passed, oldest first. */
  due(limit?: number): Promise<PendingActionRecord[]>;
  markInFlight(id: number): Promise<PendingActionRecord>;
  markDone(id: number): Promise<PendingActionRecord>;
  markFailed(id: number, input: ActionFailureInput): Promise<PendingActionRecord>;
  deadLetters(): Promise<PendingActionRecord[]>;
  /** The count the dock shows alongside queued reports. */
  queuedCount(): Promise<number>;
  count(): Promise<number>;
  /** Drop completed rows. Never touches queued or dead-lettered ones. */
  purgeDone(): Promise<number>;
  clear(): Promise<number>;
}

export function createPendingActionsRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps> & { readonly policy?: BackoffPolicy },
): PendingActionsRepository {
  const deps = resolveDeps(overrides);
  const policy = overrides?.policy ?? DEFAULT_BACKOFF_POLICY;

  async function patch(
    id: number,
    change: (existing: PendingActionRecord) => PendingActionRecord,
  ): Promise<PendingActionRecord> {
    const tx = db.transaction('pendingActions', 'readwrite');
    const existing = await tx.store.get(id);
    if (existing === undefined) {
      await tx.done;
      throw new RepositoryError(`no pending action ${String(id)}`, 'pendingActions');
    }
    const updated = change(existing);
    void tx.store.put(updated);
    await tx.done;
    return updated;
  }

  /**
   * Hold the queue under its cap by dead-lettering, never by deleting.
   *
   * Oldest queued rows go first: a confirmation from four days ago has already
   * been overtaken by whatever the world did since, while the one made this
   * morning is still worth sending.
   */
  async function enforceCap(max: number): Promise<number> {
    const queued = await db.getAllFromIndex('pendingActions', 'by-state', 'queued');
    const excess = queued.length - max;
    if (excess <= 0) return 0;
    const doomed = [...queued]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, excess);
    const tx = db.transaction('pendingActions', 'readwrite');
    for (const row of doomed) {
      void tx.store.put({
        ...row,
        state: 'dead_letter',
        deadLetterReason: `queue overflowed ${String(max)} actions; oldest dropped from the send queue but kept on disk`,
      });
    }
    await tx.done;
    return doomed.length;
  }

  return {
    async enqueue(action) {
      const now = deps.now();
      const record: Omit<PendingActionRecord, 'id'> = {
        ...action,
        attempts: 0,
        nextAttemptAt: now,
        state: 'queued',
        lastError: null,
        deadLetterReason: null,
      };
      const id = await db.add('pendingActions', record as PendingActionRecord);
      await enforceCap(MAX_PENDING_ACTIONS);
      const stored = await db.get('pendingActions', id);
      if (stored === undefined) {
        throw new RepositoryError(`action ${String(id)} vanished after write`, 'pendingActions');
      }
      return stored;
    },

    get(id) {
      return db.get('pendingActions', id);
    },

    all() {
      return db.getAll('pendingActions');
    },

    byState(state) {
      return db.getAllFromIndex('pendingActions', 'by-state', state);
    },

    async due(limit) {
      const now = deps.now();
      const rows = await db.getAllFromIndex('pendingActions', 'by-state', 'queued');
      const runnable = rows
        .filter((row) => row.nextAttemptAt <= now)
        .sort((a, b) => a.createdAt - b.createdAt);
      return limit === undefined ? runnable : runnable.slice(0, Math.max(0, limit));
    },

    markInFlight(id) {
      return patch(id, (existing) => ({ ...existing, state: 'in_flight' }));
    },

    markDone(id) {
      return patch(id, (existing) => ({
        ...existing,
        state: 'done',
        lastError: null,
        deadLetterReason: null,
      }));
    },

    markFailed(id, input) {
      const now = deps.now();
      return patch(id, (existing) => {
        const attempts = existing.attempts + 1;
        const permanent = input.permanent === true;
        if (permanent || isExhausted(attempts, policy)) {
          return {
            ...existing,
            state: 'dead_letter',
            attempts,
            lastError: input.error,
            deadLetterReason: permanent
              ? `server rejected permanently: ${input.error}`
              : `retries exhausted after ${String(attempts)} attempts: ${input.error}`,
          };
        }
        return {
          ...existing,
          state: 'queued',
          attempts,
          nextAttemptAt: now + backoffDelayMs(attempts - 1, policy, deps.random),
          lastError: input.error,
          deadLetterReason: null,
        };
      });
    },

    deadLetters() {
      return db.getAllFromIndex('pendingActions', 'by-state', 'dead_letter');
    },

    async queuedCount() {
      const queued = await db.countFromIndex('pendingActions', 'by-state', 'queued');
      const inFlight = await db.countFromIndex('pendingActions', 'by-state', 'in_flight');
      return queued + inFlight;
    },

    count() {
      return db.count('pendingActions');
    },

    async purgeDone() {
      const done = await db.getAllFromIndex('pendingActions', 'by-state', 'done');
      if (done.length === 0) return 0;
      const tx = db.transaction('pendingActions', 'readwrite');
      for (const row of done) void tx.store.delete(row.id);
      await tx.done;
      return done.length;
    },

    async clear() {
      const total = await db.count('pendingActions');
      await db.clear('pendingActions');
      return total;
    },
  };
}
