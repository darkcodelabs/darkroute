/**
 * `CONFIRM STILL THERE` / `DISPUTE`, against the real queue.
 *
 * These run on the repository the sync layer drains, not on a double of it, so
 * a card that queued something the sender cannot read would fail here.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeFwmDb, createPendingActionsRepository, openFwmDb } from '../../services/db/index.ts';
import type { MemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';

import { createIntelQueue } from './intelActions.ts';

const NOW = 1_760_000_000_000;
let memory: MemoryIndexedDB;
let counter = 0;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

function dbName(): string {
  return `fwm-intel-${String(++counter)}`;
}

describe('queueing a statement about a camera', () => {
  it('writes a confirmation the sync layer can read back', async () => {
    const name = dbName();
    const queue = createIntelQueue({ dbName: name });

    await expect(queue.queue('confirm_camera', 'FWM-0442', NOW)).resolves.toBe(true);
    queue.close();

    const db = await openFwmDb({ name });
    const rows = await createPendingActionsRepository(db).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'confirm_camera',
      subjectId: 'FWM-0442',
      state: 'queued',
      createdAt: NOW,
    });
    closeFwmDb(db);
  });

  it('writes a dispute under its own kind', async () => {
    const name = dbName();
    const queue = createIntelQueue({ dbName: name });

    await queue.queue('dispute_camera', 'FWM-0442', NOW);
    queue.close();

    const db = await openFwmDb({ name });
    const rows = await createPendingActionsRepository(db).byState('queued');
    expect(rows[0]?.kind).toBe('dispute_camera');
    closeFwmDb(db);
  });

  it('carries no coordinate, no heading and no speed in the body', async () => {
    const name = dbName();
    const queue = createIntelQueue({ dbName: name });

    await queue.queue('confirm_camera', 'FWM-0442', NOW);
    queue.close();

    const db = await openFwmDb({ name });
    const rows = await createPendingActionsRepository(db).all();
    // The design asks the driver nothing when they confirm, so there is nothing
    // else to record -- and a field that is never written cannot leak.
    expect(rows[0]?.body).toEqual({});
    closeFwmDb(db);
  });

  it('is safe to close when nothing was ever opened', () => {
    const queue = createIntelQueue({ dbName: dbName() });
    expect(() => {
      queue.close();
    }).not.toThrow();
  });
});
