import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_BACKOFF_POLICY } from '../backoff.ts';
import { closeFwmDb, openFwmDb, pendingSyncCount } from '../index.ts';
import { MAX_PENDING_ACTIONS } from '../policy.ts';
import type { NewPendingAction } from '../schema.ts';
import type { MemoryIndexedDB } from '../testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../testing/memory-idb.ts';
import { createPendingActionsRepository } from './pendingActions.ts';
import type { FwmDatabase } from './support.ts';

let memory: MemoryIndexedDB;
let counter = 0;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

async function freshDb(): Promise<FwmDatabase> {
  return openFwmDb({ name: `fwm-actions-${String(++counter)}` });
}

function confirmation(cameraId: string, createdAt: number): NewPendingAction {
  return {
    kind: 'confirm_camera',
    subjectId: cameraId,
    body: { stillThere: true },
    createdAt,
  };
}

describe('pendingActions repository', () => {
  it('queues an action and reports it as due immediately', async () => {
    const db = await freshDb();
    const actions = createPendingActionsRepository(db, { now: () => 1_000 });

    const queued = await actions.enqueue(confirmation('FWM-0442', 1_000));
    expect(queued.state).toBe('queued');
    expect(queued.attempts).toBe(0);
    await expect(actions.due()).resolves.toHaveLength(1);
    await expect(pendingSyncCount(db)).resolves.toMatchObject({ actions: 1, total: 1 });
    closeFwmDb(db);
  });

  it('dead-letters a permanently failing write and keeps it on disk', async () => {
    const db = await freshDb();
    const actions = createPendingActionsRepository(db, { now: () => 1_000 });
    const queued = await actions.enqueue(confirmation('FWM-0442', 1_000));

    await actions.markInFlight(queued.id);
    const dead = await actions.markFailed(queued.id, {
      error: 'HTTP 410 camera no longer exists',
      permanent: true,
    });

    expect(dead.state).toBe('dead_letter');
    expect(dead.deadLetterReason).toContain('server rejected permanently');
    await expect(actions.get(queued.id)).resolves.toBeDefined();
    await expect(actions.count()).resolves.toBe(1);
    await expect(actions.due()).resolves.toHaveLength(0);
    await expect(actions.deadLetters()).resolves.toHaveLength(1);
    await expect(pendingSyncCount(db)).resolves.toMatchObject({ total: 0, deadLettered: 1 });
    closeFwmDb(db);
  });

  it('dead-letters once the retry budget is spent, never silently', async () => {
    const db = await freshDb();
    let clock = 1_000;
    const actions = createPendingActionsRepository(db, {
      now: () => clock,
      random: () => 0.5,
    });
    const queued = await actions.enqueue(confirmation('FWM-0442', clock));

    for (let attempt = 0; attempt < DEFAULT_BACKOFF_POLICY.maxAttempts - 1; attempt++) {
      const retried = await actions.markFailed(queued.id, { error: 'offline' });
      expect(retried.state).toBe('queued');
      expect(retried.nextAttemptAt).toBeGreaterThan(clock);
      clock = retried.nextAttemptAt;
    }

    const dead = await actions.markFailed(queued.id, { error: 'offline' });
    expect(dead.state).toBe('dead_letter');
    expect(dead.attempts).toBe(DEFAULT_BACKOFF_POLICY.maxAttempts);
    expect(dead.deadLetterReason).toContain('retries exhausted');
    await expect(actions.count()).resolves.toBe(1);
    closeFwmDb(db);
  });

  it('dead-letters the oldest queued action on overflow rather than deleting it', async () => {
    const db = await freshDb();
    const actions = createPendingActionsRepository(db, { now: () => 1_000 });

    for (let i = 0; i <= MAX_PENDING_ACTIONS; i++) {
      await actions.enqueue(confirmation(`FWM-${String(i)}`, 1_000 + i));
    }

    // Everything is still on disk. Exactly one has been pushed out of the
    // send queue, and it is the oldest.
    await expect(actions.count()).resolves.toBe(MAX_PENDING_ACTIONS + 1);
    const dead = await actions.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0]?.subjectId).toBe('FWM-0');
    expect(dead[0]?.deadLetterReason).toContain('queue overflowed');
    await expect(actions.queuedCount()).resolves.toBe(MAX_PENDING_ACTIONS);
    closeFwmDb(db);
  });

  it('purges completed actions and leaves queued and dead-lettered ones alone', async () => {
    const db = await freshDb();
    const actions = createPendingActionsRepository(db, { now: () => 1_000 });

    const done = await actions.enqueue(confirmation('FWM-1', 1_000));
    const dead = await actions.enqueue(confirmation('FWM-2', 1_001));
    await actions.enqueue(confirmation('FWM-3', 1_002));

    await actions.markDone(done.id);
    await actions.markFailed(dead.id, { error: 'gone', permanent: true });

    await expect(actions.purgeDone()).resolves.toBe(1);
    await expect(actions.count()).resolves.toBe(2);
    await expect(actions.deadLetters()).resolves.toHaveLength(1);
    closeFwmDb(db);
  });
});
