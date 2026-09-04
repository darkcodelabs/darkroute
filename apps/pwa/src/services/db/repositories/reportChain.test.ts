import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GENESIS_CHAIN_HASH } from '../../crypto/chain.ts';
import { DEFAULT_BACKOFF_POLICY, nominalDelayMs } from '../backoff.ts';
import { closeFwmDb, openFwmDb, pendingSyncCount } from '../index.ts';
import type { MemoryIndexedDB } from '../testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../testing/memory-idb.ts';
import { ChainLinkageError, createReportChainRepository } from './reportChain.ts';
import type { NewChainRow } from './reportChain.ts';
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
  return openFwmDb({ name: `fwm-chain-${String(++counter)}` });
}

function hash(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

function row(index: number, previousChainHash: string): NewChainRow {
  return {
    reportId: `a1b2c3d4-0000-4000-8000-${String(index).padStart(12, '0')}`,
    payloadHash: hash(String(index)),
    previousChainHash,
    chainHash: hash(String(index + 1)),
    signature: `sig-${String(index)}`,
    publicKeyId: 'evidence-signing-public-v1',
    capturedAt: `2026-08-19T14:2${String(index)}:08.412Z`,
  };
}

describe('reportChain repository', () => {
  it('starts at the genesis hash and refuses a row that does not link', async () => {
    const db = await freshDb();
    const chain = createReportChainRepository(db, { now: () => 1_000 });

    await expect(chain.headHash()).resolves.toBe(GENESIS_CHAIN_HASH);
    await chain.append(row(1, GENESIS_CHAIN_HASH));
    await expect(chain.headHash()).resolves.toBe(hash('2'));

    await expect(chain.append(row(2, hash('9')))).rejects.toThrow(ChainLinkageError);
    await expect(chain.verifyLinkage()).resolves.toEqual({ ok: true });
    closeFwmDb(db);
  });

  it('counts queued reports the way the dock badge reads them', async () => {
    const db = await freshDb();
    const chain = createReportChainRepository(db, { now: () => 1_000 });

    await chain.append(row(1, GENESIS_CHAIN_HASH));
    await chain.append(row(2, hash('2')));

    await expect(chain.queuedCount()).resolves.toBe(2);
    await expect(pendingSyncCount(db)).resolves.toMatchObject({
      reports: 2,
      actions: 0,
      total: 2,
      deadLettered: 0,
    });
    closeFwmDb(db);
  });

  it('backs off after a transient failure and keeps the row runnable', async () => {
    const db = await freshDb();
    let clock = 100_000;
    // A fixed draw of 1.0 would be out of contract; 0.999… is the top of the
    // window, which is the value that makes the assertion exact.
    const chain = createReportChainRepository(db, {
      now: () => clock,
      random: () => 0,
    });

    const appended = await chain.append(row(1, GENESIS_CHAIN_HASH));
    const failed = await chain.markFailed(appended.reportId, { error: 'network down' });

    expect(failed.syncState).toBe('pending');
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe('network down');
    expect(failed.deadLetterReason).toBeNull();
    // random() === 0 puts the delay at the bottom of the first window.
    expect(failed.nextAttemptAt).toBe(
      clock + nominalDelayMs(0) * (1 - DEFAULT_BACKOFF_POLICY.jitterRatio),
    );

    // Not due yet.
    await expect(chain.due()).resolves.toHaveLength(0);

    // THE BACKOFF EXPIRING IS NOT ENOUGH. `due()` gates on two independent
    // clocks and the privacy hold is the longer one, so a row whose transport
    // backoff has elapsed is still held. That is the property this whole
    // separation exists for: if `markFailed` could shorten the hold, this
    // assertion would be `1`.
    clock = (failed.nextAttemptAt ?? 0) + 1;
    await expect(chain.due()).resolves.toHaveLength(0);

    clock = (appended.publishableAt ?? 0) + 1;
    await expect(chain.due()).resolves.toHaveLength(1);
    closeFwmDb(db);
  });

  it('dead-letters a permanently rejected write instead of dropping it', async () => {
    const db = await freshDb();
    const chain = createReportChainRepository(db, { now: () => 1_000 });
    const appended = await chain.append(row(1, GENESIS_CHAIN_HASH));

    const dead = await chain.markFailed(appended.reportId, {
      error: 'HTTP 422 malformed report',
      permanent: true,
    });

    expect(dead.syncState).toBe('dead_letter');
    expect(dead.deadLetterReason).toContain('server rejected permanently');
    expect(dead.deadLetterReason).toContain('HTTP 422');
    expect(dead.nextAttemptAt).toBeNull();

    // NO SILENT DATA LOSS: the row is still on disk, still signed, still
    // linked, and still exportable - it has just stopped being retried.
    await expect(chain.get(appended.reportId)).resolves.toBeDefined();
    await expect(chain.verifyLinkage()).resolves.toEqual({ ok: true });
    await expect(chain.deadLetters()).resolves.toHaveLength(1);
    await expect(chain.due()).resolves.toHaveLength(0);
    await expect(chain.queuedCount()).resolves.toBe(0);
    await expect(pendingSyncCount(db)).resolves.toMatchObject({ total: 0, deadLettered: 1 });
    closeFwmDb(db);
  });

  it('dead-letters after the retry budget is spent, with the count in the reason', async () => {
    const db = await freshDb();
    const chain = createReportChainRepository(db, { now: () => 1_000, random: () => 0.5 });
    const appended = await chain.append(row(1, GENESIS_CHAIN_HASH));

    let last = appended;
    for (let attempt = 0; attempt < DEFAULT_BACKOFF_POLICY.maxAttempts; attempt++) {
      last = await chain.markFailed(appended.reportId, { error: 'timeout' });
    }

    expect(last.attempts).toBe(DEFAULT_BACKOFF_POLICY.maxAttempts);
    expect(last.syncState).toBe('dead_letter');
    expect(last.deadLetterReason).toContain('retries exhausted');
    expect(last.deadLetterReason).toContain(String(DEFAULT_BACKOFF_POLICY.maxAttempts));
    await expect(chain.get(appended.reportId)).resolves.toBeDefined();
    closeFwmDb(db);
  });

  it('refuses to rewrite a signed field through the sync path', async () => {
    const db = await freshDb();
    const chain = createReportChainRepository(db, { now: () => 1_000 });
    const appended = await chain.append(row(1, GENESIS_CHAIN_HASH));

    await chain.markSyncing(appended.reportId);
    const synced = await chain.markSynced(appended.reportId);
    expect(synced.chainHash).toBe(appended.chainHash);
    expect(synced.signature).toBe(appended.signature);
    expect(synced.syncedAt).toBe(1_000);
    closeFwmDb(db);
  });
});
