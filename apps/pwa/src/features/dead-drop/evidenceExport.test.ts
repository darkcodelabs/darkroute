/**
 * EXPORT JSON, against the only thing that makes an export worth having:
 * SOMEBODY WHO DOES NOT HAVE THIS DEVICE CAN RE-VERIFY IT.
 *
 * Nothing here hand-builds a record. Every record is signed by
 * `services/crypto/chain.ts` with a real ECDSA key over real canonical bytes
 * (`services/crypto/testing.ts` supplies a key store node can persist; the
 * signatures it produces are genuine). The assertions then go the whole way
 * back out: serialise, `JSON.parse`, and hand the parsed array to
 * `verifyChain()` with no transformation at all.
 */

import { describe, expect, it } from 'vitest';

import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';
import { GENESIS_CHAIN_HASH, verifyChain } from '../../services/crypto/chain.ts';
import type { EvidenceRecord } from '../../services/crypto/chain.ts';
import { TEST_EPOCH_MS, createTestInstall } from '../../services/crypto/testing.ts';

import {
  EVIDENCE_EXPORT_SCHEMA,
  buildEvidenceExport,
  evidenceExportFilename,
  runOf,
} from './evidenceExport.ts';
import type { EvidenceRun } from './evidenceExport.ts';

const MINUTE = 60_000;

interface ParsedRun {
  readonly starting_chain_hash: string;
  readonly first_index: number;
  readonly count: number;
  readonly head_chain_hash: string;
}

interface ParsedExport {
  readonly schema: string;
  readonly canonical_form: string;
  readonly evidence_schema: string;
  readonly exported_at: string;
  readonly genesis_chain_hash: string;
  readonly starting_chain_hash: string;
  readonly head_chain_hash: string;
  readonly count: number;
  readonly run_count: number;
  readonly runs: ParsedRun[];
  readonly records: EvidenceRecord[];
}

/**
 * Exactly what an independent verifier does with a document it did not produce:
 * check every run against the hash that run says it continues from. A document
 * with one run reduces to the single `verifyChain` call in the file header.
 */
async function reverify(doc: ParsedExport): Promise<readonly boolean[]> {
  const results: boolean[] = [];
  for (const run of doc.runs) {
    const slice = doc.records.slice(run.first_index, run.first_index + run.count);
    const result = await verifyChain(slice, { startingChainHash: run.starting_chain_hash });
    results.push(result.ok);
  }
  return results;
}

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

/** Three genuinely signed, genuinely linked drops. */
async function threeDrops(): Promise<readonly EvidenceRecord[]> {
  const install = createTestInstall();
  const first = await install.chain.finalize({ payload: payload() });
  install.tick(20 * MINUTE);
  const second = await install.chain.finalize({
    payload: payload({ kind: 'confirm_existing', camera_id: 'FWM-0442' }),
    previousChainHash: first.chainHash,
  });
  install.tick(21 * MINUTE);
  const third = await install.chain.finalize({
    payload: payload({ mount: 'trailer' }),
    previousChainHash: second.chainHash,
  });
  return [first, second, third];
}

function parse(text: string): ParsedExport {
  return JSON.parse(text) as ParsedExport;
}

describe('an export re-verifies without this device', () => {
  it('hands verifyChain the parsed records untransformed, and they pass', async () => {
    const records = await threeDrops();
    const bundle = buildEvidenceExport([runOf(records)], TEST_EPOCH_MS);

    const doc = parse(bundle.text);
    const result = await verifyChain(doc.records, {
      startingChainHash: doc.starting_chain_hash,
    });

    expect(result).toEqual({
      ok: true,
      count: 3,
      headChainHash: records[2]?.chainHash,
    });
  });

  it('carries the public key that signed each record, so no key directory is needed', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport([runOf(records)], TEST_EPOCH_MS).text);

    for (const record of doc.records) {
      expect(record.publicKeySpki).toEqual(expect.any(String));
      expect(record.publicKeySpki.length).toBeGreaterThan(0);
      expect(record.publicKeyId).toMatch(/^[0-9a-f]{64}$/);
    }

    // A second install has its own keys and its own store. Verification of the
    // first install's export must not consult either -- it reads the key out of
    // the record. `verifyChain` is the module function, not `chain.verify()`,
    // precisely so no key manager is in the path.
    const stranger = createTestInstall();
    await stranger.chain.finalize({ payload: payload() });

    await expect(
      verifyChain(doc.records, { startingChainHash: doc.starting_chain_hash }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('verifies a queue whose oldest bodies were purged after sync', async () => {
    const records = await threeDrops();
    // `pendingReports.purgeSynced()` removes acknowledged bodies from the FRONT.
    const remaining = records.slice(1);
    const bundle = buildEvidenceExport([runOf(remaining)], TEST_EPOCH_MS);

    const doc = parse(bundle.text);
    expect(doc.starting_chain_hash).toBe(records[0]?.chainHash);
    expect(doc.starting_chain_hash).not.toBe(GENESIS_CHAIN_HASH);

    await expect(
      verifyChain(doc.records, { startingChainHash: doc.starting_chain_hash }),
    ).resolves.toMatchObject({ ok: true, count: 2 });
  });
});

describe('a purge in the MIDDLE of the queue is not tampering', () => {
  /**
   * `pendingReports.purgeSynced()` deletes EVERY body whose sync state is
   * `synced`, not only the oldest. One drop syncing while an older one is still
   * pending, refused or dead-lettered leaves a hole in the middle - and the
   * record after that hole links to a body that is gone.
   */
  function holed(records: readonly EvidenceRecord[]): readonly EvidenceRun[] {
    const first = records[0];
    const third = records[2];
    if (first === undefined || third === undefined) throw new Error('the fixture lost a record');
    return [runOf([first]), runOf([third])];
  }

  it('re-verifies every surviving record, run by run', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport(holed(records), TEST_EPOCH_MS).text);

    expect(doc.count).toBe(2);
    expect(doc.run_count).toBe(2);
    await expect(reverify(doc)).resolves.toEqual([true, true]);
  });

  it('states where the hole is instead of hiding it', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport(holed(records), TEST_EPOCH_MS).text);

    expect(doc.runs.map((run) => run.first_index)).toEqual([0, 1]);
    expect(doc.runs.map((run) => run.count)).toEqual([1, 1]);
    // The second run continues from the PURGED drop's hash, which is exactly the
    // fact a verifier needs and cannot derive from the surviving bodies alone.
    expect(doc.runs[1]?.starting_chain_hash).toBe(records[1]?.chainHash);
    expect(doc.head_chain_hash).toBe(records[2]?.chainHash);
  });

  it('would fail as one array - which is why it is not emitted as one', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport(holed(records), TEST_EPOCH_MS).text);

    // The whole-array read that works for an unholed queue. It must fail here,
    // and the document must carry the runs that make it verifiable anyway.
    const naive = await verifyChain(doc.records, {
      startingChainHash: doc.starting_chain_hash,
    });
    expect(naive.ok).toBe(false);
    if (naive.ok) return;
    expect(naive.failure.code).toBe('broken-link');
    await expect(reverify(doc)).resolves.toEqual([true, true]);
  });

  it('drops no record on the floor when it splits the queue', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport(holed(records), TEST_EPOCH_MS).text);
    const covered = doc.runs.reduce((total, run) => total + run.count, 0);

    expect(covered).toBe(doc.records.length);
    expect(doc.records.map((record) => record.reportId)).toEqual([
      records[0]?.reportId,
      records[2]?.reportId,
    ]);
  });

  it('describes an unholed queue as exactly one run', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport([runOf(records)], TEST_EPOCH_MS).text);

    expect(doc.run_count).toBe(1);
    expect(doc.runs[0]?.starting_chain_hash).toBe(doc.starting_chain_hash);
    expect(doc.runs[0]?.count).toBe(doc.records.length);
    await expect(reverify(doc)).resolves.toEqual([true]);
  });

  it('describes an empty queue as no runs at all', () => {
    const doc = parse(buildEvidenceExport([], TEST_EPOCH_MS).text);
    expect(doc.run_count).toBe(0);
    expect(doc.runs).toEqual([]);
  });
});

describe('an export that was edited stops verifying', () => {
  it('catches a payload changed after signing', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport([runOf(records)], TEST_EPOCH_MS).text);

    const target = doc.records[1];
    if (target === undefined) throw new Error('the fixture lost a record');
    const tampered = doc.records.map((record, index) =>
      index === 1
        ? { ...record, payload: { ...record.payload, mount: 'wall' } }
        : record,
    );

    const result = await verifyChain(tampered, {
      startingChainHash: doc.starting_chain_hash,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('payload-hash-mismatch');
    expect(result.failure.reportId).toBe(target.reportId);
  });

  it('catches a re-ordered queue', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport([runOf(records)], TEST_EPOCH_MS).text);
    const swapped = [doc.records[0], doc.records[2], doc.records[1]].filter(
      (record): record is EvidenceRecord => record !== undefined,
    );

    const result = await verifyChain(swapped, {
      startingChainHash: doc.starting_chain_hash,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('broken-link');
  });

  it('catches a dropped record in the middle', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport([runOf(records)], TEST_EPOCH_MS).text);
    const hole = [doc.records[0], doc.records[2]].filter(
      (record): record is EvidenceRecord => record !== undefined,
    );

    const result = await verifyChain(hole, { startingChainHash: doc.starting_chain_hash });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe('broken-link');
    expect(result.failure.index).toBe(1);
  });
});

describe('the document', () => {
  it('names its own format, the canonical form and the evidence schema', async () => {
    const records = await threeDrops();
    const doc = parse(buildEvidenceExport([runOf(records)], TEST_EPOCH_MS).text);

    expect(doc.schema).toBe(EVIDENCE_EXPORT_SCHEMA);
    expect(doc.canonical_form).toBe('fwm-canonical-json/v1');
    expect(doc.evidence_schema).toBe('fwm-evidence/v1');
    expect(doc.genesis_chain_hash).toBe(GENESIS_CHAIN_HASH);
    expect(doc.count).toBe(3);
    expect(doc.head_chain_hash).toBe(records[2]?.chainHash);
    expect(doc.exported_at).toBe('2026-08-20T14:22:08.412Z');
  });

  it('exports every field of the signed record, under the record’s own names', async () => {
    const records = await threeDrops();
    const source = records[0];
    if (source === undefined) throw new Error('the fixture lost a record');

    const doc = parse(buildEvidenceExport([runOf(records)], TEST_EPOCH_MS).text);
    const exported = doc.records[0];
    if (exported === undefined) throw new Error('the export lost a record');

    expect(Object.keys(exported).sort()).toEqual(Object.keys(source).sort());
    expect(exported).toEqual(source);
  });

  it('is byte-identical between two exports of the same queue', async () => {
    const records = await threeDrops();
    const first = buildEvidenceExport([runOf(records)], TEST_EPOCH_MS);
    const second = buildEvidenceExport([runOf(records)], TEST_EPOCH_MS);
    expect(first.text).toBe(second.text);
  });

  it('writes canonical JSON, not pretty JSON', async () => {
    const records = await threeDrops();
    const bundle = buildEvidenceExport([runOf(records)], TEST_EPOCH_MS);
    expect(bundle.text).not.toContain('\n');
    expect(bundle.text.startsWith('{"canonical_form"')).toBe(true);
  });

  it('carries no transport bookkeeping beyond the record’s own syncState', async () => {
    const records = await threeDrops();
    const bundle = buildEvidenceExport([runOf(records)], TEST_EPOCH_MS);
    for (const field of [
      'attempts',
      'nextAttemptAt',
      'lastError',
      'deadLetterReason',
      'syncedAt',
    ]) {
      expect(bundle.text).not.toContain(field);
    }
  });

  it('exports an empty queue as an empty chain rather than throwing', () => {
    const bundle = buildEvidenceExport([], TEST_EPOCH_MS);
    const doc = parse(bundle.text);
    expect(doc.count).toBe(0);
    expect(doc.records).toEqual([]);
    expect(doc.starting_chain_hash).toBe(GENESIS_CHAIN_HASH);
    expect(doc.head_chain_hash).toBe(GENESIS_CHAIN_HASH);
  });
});

describe('the suggested file name', () => {
  it('is a UTC stamp and says nothing about the driver', () => {
    const name = evidenceExportFilename('2026-08-20T14:22:08.412Z');
    expect(name).toBe('darkroute-evidence-2026-08-20T14-22-08-412Z.json');
    expect(name).not.toMatch(/\d\d\.\d{4}/);
  });
});
