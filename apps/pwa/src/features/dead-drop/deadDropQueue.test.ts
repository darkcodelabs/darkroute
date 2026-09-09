/**
 * The verdict machinery - the one piece of DEAD DROP that decides whether a
 * driver is told DEVICE KEY OK or CHAIN BROKEN.
 *
 * Two halves, both here:
 *
 *   `verdictFor()` as a unit, every path, including the ones no screen test can
 *   reach: a break in the middle, a row-level break outranking intact bodies, a
 *   platform with no WebCrypto, and the `position === verifiedThrough`
 *   boundary. A hand-written verdict table would pass against any logic at all,
 *   so the inputs here are the real `ChainVerification` shapes.
 *
 *   `createDeadDropPort()` end to end, against the real repositories, the real
 *   memory-backed IndexedDB and real ECDSA signatures produced by
 *   `services/crypto/testing.ts`. Nothing is hand-built: drops are filed the way
 *   REPORT files them and then attacked the way a tampered store would attack
 *   them.
 *
 * THERE IS NO NETWORK IN THIS FILE.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';
import { GENESIS_CHAIN_HASH, verifyChain } from '../../services/crypto/chain.ts';
import type { ChainVerification, EvidenceRecord } from '../../services/crypto/chain.ts';
import { createTestInstall } from '../../services/crypto/testing.ts';
import type { TestInstall } from '../../services/crypto/testing.ts';
import { closeFwmDb, createRepositories, openFwmDb } from '../../services/db/index.ts';
import type { FwmDatabase } from '../../services/db/repositories/support.ts';
import type { MemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { createReportQueue } from '../report/reportQueue.ts';
import type { ReportQueuePort } from '../report/reportQueue.ts';

import { ROW_BODY_FIELDS, createDeadDropPort, rowBodyDisagreement, verdictFor } from './deadDropQueue.ts';
import type { ChainRun, DeadDropPort, DeadDropSnapshot, SignedVerdict } from './deadDropQueue.ts';
import { buildEvidenceExport } from './evidenceExport.ts';

const CAPTURES = [
  '2026-08-20T13:00:00.000Z',
  '2026-08-20T13:12:00.000Z',
  '2026-08-20T13:58:00.000Z',
  '2026-08-20T14:22:08.412Z',
] as const;

// ---------------------------------------------------------------------------
// verdictFor, as a unit
// ---------------------------------------------------------------------------

/**
 * A whole, correctly shaped record. `verdictFor` reads nothing off it but its
 * presence, and it is written out in full rather than cast so a field added to
 * `EvidenceRecord` fails here rather than being hidden behind an assertion.
 */
const BODY: EvidenceRecord = {
  schema: 'fwm-evidence/v1',
  reportId: '00000000-0000-4000-8000-000000000001',
  capturedAt: '2026-08-20T14:22:08.412Z',
  payload: { schema: 'fwm-report/v1' },
  payloadHash: 'a'.repeat(64),
  previousChainHash: GENESIS_CHAIN_HASH,
  chainHash: 'b'.repeat(64),
  signature: 'AAAA',
  publicKeyId: 'c'.repeat(64),
  publicKeySpki: 'AAAA',
  gpsAccuracyM: 4,
  syncState: 'held',
  supersedes: null,
};

function run(length: number, verification: ChainVerification | null): ChainRun {
  return {
    records: Array.from({ length }, () => BODY),
    startingChainHash: GENESIS_CHAIN_HASH,
    firstRowIndex: 0,
    verification,
  };
}

const OK: ChainVerification = { ok: true, count: 3, headChainHash: GENESIS_CHAIN_HASH };

function failedAt(index: number): ChainVerification {
  return {
    ok: false,
    failure: { index, reportId: BODY.reportId, code: 'bad-signature', message: 'no' },
  };
}

function verdictAt(
  index: number,
  over: Partial<Parameters<typeof verdictFor>[0]> = {},
): SignedVerdict {
  return verdictFor({
    index,
    breakAt: -1,
    body: BODY,
    run: run(3, OK),
    positionInRun: index,
    ...over,
  });
}

describe('verdictFor', () => {
  it('says verified only for a drop inside a run that actually verified', () => {
    expect(verdictAt(0)).toBe('verified');
    expect(verdictAt(1)).toBe('verified');
    expect(verdictAt(2)).toBe('verified');
  });

  it('claims nothing at all for a drop whose body is no longer on the device', () => {
    expect(verdictAt(1, { body: null, run: null, positionInRun: -1 })).toBe('no-body');
  });

  it('claims nothing when the platform could not check a signature', () => {
    // A null verification is an outage, not a finding: never `verified`, and
    // never `broken` either.
    expect(verdictAt(0, { run: run(3, null) })).toBe('unverified');
    expect(verdictAt(2, { run: run(3, null) })).toBe('unverified');
  });

  it('marks the FIRST failing record broken and everything after it unverified', () => {
    const broken = run(3, failedAt(1));
    expect(verdictFor({ index: 0, breakAt: -1, body: BODY, run: broken, positionInRun: 0 })).toBe(
      'verified',
    );
    expect(verdictFor({ index: 1, breakAt: -1, body: BODY, run: broken, positionInRun: 1 })).toBe(
      'broken',
    );
    expect(verdictFor({ index: 2, breakAt: -1, body: BODY, run: broken, positionInRun: 2 })).toBe(
      'unverified',
    );
  });

  it('never says verified for the record AT the boundary', () => {
    // `position === verifiedThrough` is the record the failure names. It is the
    // one index where an off-by-one would print DEVICE KEY OK over a bad
    // signature.
    for (const at of [0, 1, 2]) {
      expect(
        verdictFor({ index: at, breakAt: -1, body: BODY, run: run(3, failedAt(at)), positionInRun: at }),
      ).toBe('broken');
    }
  });

  it('lets a row-level break outrank bodies that verified perfectly well', () => {
    // The rows are the only check that can see past a purged body, so a break
    // there wins even when every body present passed.
    expect(verdictAt(1, { breakAt: 1 })).toBe('broken');
    expect(verdictAt(2, { breakAt: 1 })).toBe('unverified');
    expect(verdictAt(0, { breakAt: 1 })).toBe('verified');
  });

  it('reports a row-level break even on a drop that holds no body', () => {
    expect(verdictFor({ index: 2, breakAt: 2, body: null, run: null, positionInRun: -1 })).toBe(
      'broken',
    );
  });

  it('numbers positions inside the run, not inside the row list', () => {
    // A drop that is third in the queue but FIRST in its run verifies against
    // position 0. Reading the row index here is exactly the bug an interior
    // purge triggers.
    expect(verdictFor({ index: 2, breakAt: -1, body: BODY, run: run(1, OK), positionInRun: 0 })).toBe(
      'verified',
    );
  });
});

describe('rowBodyDisagreement', () => {
  it('compares every field the signature covers', () => {
    expect([...ROW_BODY_FIELDS]).toEqual([
      'reportId',
      'capturedAt',
      'payloadHash',
      'previousChainHash',
      'chainHash',
      'signature',
      'publicKeyId',
    ]);
  });

  it('does not compare sync state, which is a different vocabulary in each store', () => {
    expect([...ROW_BODY_FIELDS]).not.toContain('syncState');
  });
});

// ---------------------------------------------------------------------------
// The port, against the real chain and the real database
// ---------------------------------------------------------------------------

let memory: MemoryIndexedDB;
let install: TestInstall;
let counter = 0;
let dbName = '';
let filing: ReportQueuePort | null = null;
let reading: DeadDropPort | null = null;
const fetchSpy = vi.fn();

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

beforeEach(() => {
  counter += 1;
  install = createTestInstall({ startAt: Date.parse(CAPTURES[0]) });
  dbName = `fwm-dead-drop-queue-${String(counter)}`;
  filing = createReportQueue({ chain: install.chain, dbName });
  reading = createDeadDropPort({ dbName });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  filing?.close();
  reading?.close();
  filing = null;
  reading = null;
  fetchSpy.mockClear();
});

function payload(over: Partial<Record<string, unknown>> = {}): CanonicalObject {
  return {
    schema: 'fwm-report/v1',
    kind: 'new_camera',
    camera_id: null,
    position: { lat: 39.0997, lon: -84.5786 },
    gps_accuracy_m: 4,
    satellites: null,
    facing_deg: 223,
    facing_source: 'compass',
    mount: 'pole',
    make_model: null,
    photo: null,
    ...over,
  } as CanonicalObject;
}

async function withDatabase<T>(action: (db: FwmDatabase) => Promise<T>): Promise<T> {
  const db = await openFwmDb({ name: dbName });
  try {
    return await action(db);
  } finally {
    closeFwmDb(db);
  }
}

/** Four drops through the real submit path, one per capture time. */
async function fourDrops(): Promise<readonly string[]> {
  if (filing === null) throw new Error('the filing port was not opened');
  const ids: string[] = [];
  for (let step = 0; step < CAPTURES.length; step++) {
    const receipt = await filing.submit(payload({ mount: `pole-${String(step)}` }));
    ids.push(receipt.reportId);
    const here = CAPTURES[step];
    const next = CAPTURES[step + 1];
    if (here !== undefined && next !== undefined) {
      install.tick(Date.parse(next) - Date.parse(here));
    }
  }
  return ids;
}

/**
 * Hand one drop over and purge it, exactly as a completed sync would: the queue
 * row acknowledged, the record's transport state advanced with it, then
 * `purgeSynced()` - which deletes EVERY synced body, wherever it sits.
 */
async function syncAndPurge(reportId: string): Promise<number> {
  return withDatabase(async (db) => {
    const repos = createRepositories(db);
    await repos.reportChain.markSyncing(reportId);
    await repos.reportChain.markSynced(reportId);
    await repos.pendingReports.updateSyncState(reportId, 'syncing');
    await repos.pendingReports.updateSyncState(reportId, 'synced');
    return repos.pendingReports.purgeSynced();
  });
}

async function snapshot(): Promise<DeadDropSnapshot> {
  if (reading === null) throw new Error('the reading port was not opened');
  return reading.load();
}

function verdicts(loaded: DeadDropSnapshot): readonly SignedVerdict[] {
  return loaded.drops.map((drop) => drop.verdict);
}

describe('a body purged from the MIDDLE of the queue', () => {
  it('leaves every surviving drop verified, not broken', async () => {
    const ids = await fourDrops();
    const middle = ids[1];
    if (middle === undefined) throw new Error('the fixture lost a drop');
    expect(await syncAndPurge(middle)).toBe(1);

    const loaded = await snapshot();

    // DROP 01's body is gone. DROP 02 legitimately links to it, and DROP 02 and
    // DROP 03 are perfectly intact evidence: nothing here is tampering.
    expect(verdicts(loaded)).toEqual(['verified', 'no-body', 'verified', 'verified']);
  });

  it('splits the bodies into runs rather than verifying across the hole', async () => {
    const ids = await fourDrops();
    const middle = ids[1];
    if (middle === undefined) throw new Error('the fixture lost a drop');
    await syncAndPurge(middle);

    const loaded = await snapshot();
    expect(loaded.runs).toHaveLength(2);
    expect(loaded.runs.map((entry) => entry.records.length)).toEqual([1, 2]);
    expect(loaded.runs.map((entry) => entry.firstRowIndex)).toEqual([0, 2]);
    expect(loaded.runs.every((entry) => entry.verification?.ok === true)).toBe(true);
    expect(loaded.exportable).toHaveLength(3);
  });

  it('exports a document that still re-verifies, run by run', async () => {
    const ids = await fourDrops();
    const middle = ids[1];
    if (middle === undefined) throw new Error('the fixture lost a drop');
    await syncAndPurge(middle);

    const loaded = await snapshot();
    const bundle = buildEvidenceExport(loaded.runs, Date.parse(CAPTURES[3]));
    const doc = JSON.parse(bundle.text) as {
      readonly count: number;
      readonly run_count: number;
      readonly runs: readonly { readonly first_index: number; readonly count: number; readonly starting_chain_hash: string }[];
      readonly records: readonly EvidenceRecord[];
    };

    expect(doc.count).toBe(3);
    expect(doc.run_count).toBe(2);
    for (const entry of doc.runs) {
      const slice = doc.records.slice(entry.first_index, entry.first_index + entry.count);
      await expect(
        verifyChain(slice, { startingChainHash: entry.starting_chain_hash }),
      ).resolves.toMatchObject({ ok: true });
    }
  });

  it('still repairs a purged PREFIX, which is the case that already worked', async () => {
    const ids = await fourDrops();
    const oldest = ids[0];
    if (oldest === undefined) throw new Error('the fixture lost a drop');
    await syncAndPurge(oldest);

    const loaded = await snapshot();
    expect(verdicts(loaded)).toEqual(['no-body', 'verified', 'verified', 'verified']);
    expect(loaded.runs).toHaveLength(1);
    expect(loaded.startingChainHash).not.toBe(GENESIS_CHAIN_HASH);
  });
});

describe('a body rewritten coherently under another key', () => {
  /**
   * The attack the body-only verification cannot see: take the newest drop,
   * write a NEW payload, recompute its hashes, and re-sign the whole thing with
   * a key whose `publicKeyId` matches its own SPKI. `verifyChain` returns ok -
   * there is no next record to break the link and no key is pinned - so the
   * card would print the attacker's coordinates beside the ROW's untouched
   * sha256 under a green DEVICE KEY OK.
   */
  async function forgeNewest(): Promise<EvidenceRecord> {
    const ids = await fourDrops();
    const target = ids[3];
    if (target === undefined) throw new Error('the fixture lost a drop');

    const original = await withDatabase((db) =>
      createRepositories(db).pendingReports.get(target),
    );
    if (original === undefined) throw new Error('nothing to forge over');

    const attacker = createTestInstall({ startAt: Date.parse(CAPTURES[3]) });
    const forged = await attacker.chain.finalize({
      payload: payload({ position: { lat: 12.3456, lon: 65.4321 }, facing_deg: 11 }),
      previousChainHash: original.previousChainHash,
      capturedAt: original.capturedAt,
      reportId: original.reportId,
    });

    await withDatabase(async (db) => {
      const tx = db.transaction('pendingReports', 'readwrite');
      void tx.store.put(forged);
      await tx.done;
    });
    return forged;
  }

  it('verifies on its own - which is exactly why the row is checked too', async () => {
    const forged = await forgeNewest();
    const loaded = await snapshot();

    // The body half really does pass. Nothing about this record is internally
    // wrong; it is simply not the record this device signed.
    expect(loaded.runs).toHaveLength(1);
    expect(loaded.runs[0]?.verification?.ok).toBe(true);
    expect(forged.publicKeyId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is reported as CHAIN BROKEN, never as a signed drop', async () => {
    await forgeNewest();
    const loaded = await snapshot();
    expect(verdicts(loaded)).toEqual(['verified', 'verified', 'verified', 'broken']);
  });

  it('is caught because the row and the body no longer carry the same bytes', async () => {
    const forged = await forgeNewest();
    const loaded = await snapshot();
    const drop = loaded.drops[3];
    if (drop === undefined || drop.body === null) throw new Error('the queue lost a drop');

    expect(rowBodyDisagreement(drop.row, drop.body)).toBe('payloadHash');
    // The card reads its hashes off the ROW, which the forgery never touched.
    expect(drop.row.chainHash).not.toBe(forged.chainHash);
    expect(drop.row.publicKeyId).not.toBe(forged.publicKeyId);
  });

  it('marks a forged drop in the MIDDLE broken and everything after it unverified', async () => {
    const ids = await fourDrops();
    const target = ids[1];
    if (target === undefined) throw new Error('the fixture lost a drop');
    const original = await withDatabase((db) =>
      createRepositories(db).pendingReports.get(target),
    );
    if (original === undefined) throw new Error('nothing to forge over');

    const attacker = createTestInstall({ startAt: Date.parse(CAPTURES[1]) });
    const forged = await attacker.chain.finalize({
      payload: payload({ mount: 'wall' }),
      previousChainHash: original.previousChainHash,
      capturedAt: original.capturedAt,
      reportId: original.reportId,
    });
    await withDatabase(async (db) => {
      const tx = db.transaction('pendingReports', 'readwrite');
      void tx.store.put(forged);
      await tx.done;
    });

    const loaded = await snapshot();
    expect(verdicts(loaded)).toEqual(['verified', 'broken', 'unverified', 'unverified']);
  });
});

describe('the queue itself', () => {
  it('opens no network path to read a drop back', async () => {
    await fourDrops();
    await snapshot();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('verifies an untouched queue as one run from genesis', async () => {
    await fourDrops();
    const loaded = await snapshot();

    expect(loaded.verifiable).toBe(true);
    expect(loaded.runs).toHaveLength(1);
    expect(loaded.startingChainHash).toBe(GENESIS_CHAIN_HASH);
    expect(verdicts(loaded)).toEqual(['verified', 'verified', 'verified', 'verified']);
  });

  it('keeps every row when every body is gone', async () => {
    const ids = await fourDrops();
    for (const id of ids) await syncAndPurge(id);

    const loaded = await snapshot();
    expect(loaded.drops).toHaveLength(4);
    expect(verdicts(loaded)).toEqual(['no-body', 'no-body', 'no-body', 'no-body']);
    expect(loaded.runs).toEqual([]);
    expect(loaded.startingChainHash).toBe(GENESIS_CHAIN_HASH);
  });
});
