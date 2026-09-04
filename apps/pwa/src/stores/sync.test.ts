import { beforeEach, describe, expect, it } from 'vitest';

import { syncActions, useSyncStore, type QueuedDrop } from './sync.ts';

const DROP: QueuedDrop = {
  reportId: 'drop-03',
  label: 'Vine St',
  capturedAt: '2026-08-19T14:22:08.412Z',
  syncState: 'pending',
  attempts: 0,
  hasPhoto: true,
  nextAttemptAtMs: null,
};

beforeEach(() => {
  syncActions.reset();
});

describe('the badge', () => {
  it('counts reports and actions, and excludes dead letters', () => {
    // "2 QUEUED" on the REPORT bar. A dead letter is stuck, not queued -
    // folding it in would mean a number that never goes down.
    syncActions.setCounts({ reports: 2, actions: 1, total: 3, deadLettered: 4 });
    const state = useSyncStore.getState();
    expect(state.total).toBe(3);
    expect(state.deadLettered).toBe(4);
  });
});

describe('holding', () => {
  it('says why it is not moving, which is the part a driver needs', () => {
    // A queue holding on purpose looks exactly like a queue that is broken.
    syncActions.hold('wifi-only');
    expect(useSyncStore.getState().status).toBe('holding');
    expect(useSyncStore.getState().holdReason).toBe('wifi-only');

    syncActions.release();
    expect(useSyncStore.getState().status).toBe('idle');
    expect(useSyncStore.getState().holdReason).toBeNull();
  });

  it('does not release something that was not holding', () => {
    syncActions.beginSync();
    syncActions.release();
    expect(useSyncStore.getState().status).toBe('syncing');
  });
});

describe('a sync run', () => {
  it('clears the error on start and records the counts on finish', () => {
    syncActions.setDrops([DROP]);
    syncActions.failSync('backend refused the chain link', 1_000_000);
    expect(useSyncStore.getState().status).toBe('failed');
    expect(useSyncStore.getState().lastError).toContain('chain link');

    syncActions.beginSync();
    expect(useSyncStore.getState().lastError).toBeNull();

    syncActions.finishSync(1_000_500, { reports: 0, actions: 0, total: 0, deadLettered: 0 });
    const state = useSyncStore.getState();
    expect(state.status).toBe('idle');
    expect(state.total).toBe(0);
    expect(state.lastSyncAtMs).toBe(1_000_500);
  });
});
