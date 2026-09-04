/**
 * EXPORT JSON - fwm-evidence-export/v1
 * =============================================================================
 * "EXPORT JSON" is the second key on `B2 · DEAD DROP`. The panel draws the
 * button and names no format, so this file is the format, and it has exactly
 * one requirement: AN EXPORT MUST BE RE-VERIFIABLE BY SOMEBODY WHO DOES NOT
 * HAVE THIS DEVICE.
 *
 * That requirement decides every choice below.
 *
 * -- the records are verbatim ------------------------------------------------
 * `records` holds each `EvidenceRecord` field for field, under its own field
 * names. No renaming, no snake_casing, no pruning, no re-ordering of the
 * payload. A verifier of a whole queue does:
 *
 *     const doc = JSON.parse(text);
 *     await verifyChain(doc.records, { startingChainHash: doc.starting_chain_hash });
 *
 * and nothing else. Anything that had to be transformed on the way in is
 * something that can be transformed wrongly, and a signature check that depends
 * on a transformation is not a signature check.
 *
 * `publicKeySpki` travels with every record, which is what makes the export
 * self-contained: the chain verifies without a key directory, without this
 * install's key, and after this install's key is gone.
 *
 * -- runs, because a purge leaves holes --------------------------------------
 * `pendingReports.purgeSynced()` deletes EVERY body whose sync state is
 * `synced`, not only the oldest ones, so a queue that syncs a newer drop while
 * an older one is still pending, refused or dead-lettered ends up with a HOLE
 * in the middle of its bodies. The record after such a hole legitimately links
 * to a body that is gone.
 *
 * `runs` states where those holes are. Each entry names a contiguous stretch of
 * `records` and the hash it continues from, so a verifier does:
 *
 *     for (const run of doc.runs) {
 *       await verifyChain(
 *         doc.records.slice(run.first_index, run.first_index + run.count),
 *         { startingChainHash: run.starting_chain_hash },
 *       );
 *     }
 *
 * A queue with no holes - the ordinary case, and the purged-PREFIX case - has
 * exactly one run, its `starting_chain_hash` is the document's, and the
 * one-liner above still works unchanged. Without `runs`, an export of a holed
 * queue fails `verifyChain` with `broken-link` and reads as tampering when
 * nothing was tampered with, which is the one thing this format may not do.
 *
 * -- the text is canonical ---------------------------------------------------
 * The document is serialised with `canonicalize()` (`fwm-canonical-json/v1`),
 * not `JSON.stringify`. Two exports of the same queue are then byte-identical,
 * and - the part that actually matters - each embedded `payload` is written in
 * exactly the canonical form its own `payloadHash` covers, so a verifier can
 * re-hash it straight out of the file.
 *
 * -- what is NOT in here -----------------------------------------------------
 * No device identifier beyond the public key id the records already carry. No
 * handle. No plate - the payload schema has no plate field and the vault is a
 * different store.
 *
 * None of the QUEUE ROW's transport bookkeeping: no `syncedAt`, no
 * `nextAttemptAt`, no `attempts`, no `lastError`, no `deadLetterReason`. That
 * is this install's business, none of it is signed, and none of it is a fact
 * about the evidence.
 *
 * The RECORD's own `syncState` IS here, because `records` is verbatim and
 * `syncState` is a field of `EvidenceRecord`: dropping it would make the
 * exported objects something other than the records that were stored, and a
 * verifier re-hydrating them would be re-hydrating a shape this app never
 * signed. It is not covered by any hash or by the signature -
 * `chain.ts` is explicit about that - and `verifyChain` never reads it, so it
 * carries no weight in a verification either way.
 *
 * -- what this format cannot yet say -----------------------------------------
 * The export carries BODIES. The queue rows - which is where DEAD DROP reads
 * the hashes it prints, and what it compares each body against - are not in it,
 * so a device-local row/body disagreement is visible on the screen and not in
 * the file.
 * GAP: see docs/gaps-inbox/dead-drop.md#an-export-carries-bodies-not-rows
 *
 * -- this file does not send anything ----------------------------------------
 * There is no `fetch`, no clipboard, no share and no download here. It returns
 * a string. What happens to that string is the caller's decision and, on this
 * screen, the user's.
 * =============================================================================
 */

import { canonicalize, CANONICAL_FORM } from '../../services/crypto/canonicalize.ts';
import type { CanonicalObject, CanonicalValue } from '../../services/crypto/canonicalize.ts';
import {
  EVIDENCE_SCHEMA,
  GENESIS_CHAIN_HASH,
  chainHeadOf,
} from '../../services/crypto/chain.ts';
import type { EvidenceRecord } from '../../services/crypto/chain.ts';

export const EVIDENCE_EXPORT_SCHEMA = 'fwm-evidence-export/v1';

/**
 * A contiguous stretch of held bodies and the hash it continues from.
 *
 * Structurally the same shape `deadDropQueue.ts` produces, declared here so the
 * format does not depend on the screen that feeds it: a backend or an
 * independent checker reproduces this document from this file alone.
 */
export interface EvidenceRun {
  /** Bodies in chain order. */
  readonly records: readonly EvidenceRecord[];
  /** The first record's own `previousChainHash`. */
  readonly startingChainHash: string;
}

/** What `EXPORT JSON` hands to whatever is wired to receive it. */
export interface EvidenceExportBundle {
  /** The canonical JSON text. This is the export. */
  readonly text: string;
  /** The same document before serialisation, for a caller that wants fields. */
  readonly document: CanonicalObject;
  /** Total records across every run. */
  readonly count: number;
  /** How many unbroken stretches the queue is in. More than one means a purge. */
  readonly runCount: number;
  /** Suggested file name. Contains a UTC stamp and nothing about the driver. */
  readonly filename: string;
}

/**
 * One run, from a plain array of records that are known to be contiguous.
 *
 * The starting hash is READ off the first record rather than chosen, so this
 * cannot make a chain look like it starts somewhere it does not.
 */
export function runOf(records: readonly EvidenceRecord[]): EvidenceRun {
  const first = records[0];
  return {
    records,
    startingChainHash: first === undefined ? GENESIS_CHAIN_HASH : first.previousChainHash,
  };
}

/**
 * One record, restated as a canonical object.
 *
 * Written out field by field rather than spread, so a reader can see exactly
 * what leaves the device. `payload` is passed through untouched: it is already
 * the canonical object that was hashed, and re-building it would be the one way
 * to change the bytes the signature covers.
 *
 * `evidenceExport.test.ts` asserts, against a genuinely signed record, that the
 * key set below is the record's key set - so a field added to `EvidenceRecord`
 * and forgotten here fails a test rather than silently vanishing from exports.
 */
export function recordToCanonical(record: EvidenceRecord): CanonicalObject {
  const exported: CanonicalObject = {
    schema: record.schema,
    reportId: record.reportId,
    capturedAt: record.capturedAt,
    payload: record.payload,
    payloadHash: record.payloadHash,
    previousChainHash: record.previousChainHash,
    chainHash: record.chainHash,
    signature: record.signature,
    publicKeyId: record.publicKeyId,
    publicKeySpki: record.publicKeySpki,
    gpsAccuracyM: record.gpsAccuracyM,
    syncState: record.syncState,
    supersedes: record.supersedes,
  };
  return exported;
}

/**
 * The export document.
 *
 * The records inside a run must be in chain order - the order `reportChain`'s
 * `by-capturedAt` index returns and the order the chain links them in. This
 * function does not sort: re-ordering signed evidence to make it look tidy is
 * precisely the tampering `verifyChain` exists to catch, so an out-of-order
 * argument produces an export that fails verification, loudly, which is the
 * correct outcome.
 *
 * An empty run is dropped rather than described: a run with no records states
 * nothing and would only give a verifier an empty slice to check.
 */
export function evidenceExportDocument(
  runs: readonly EvidenceRun[],
  exportedAt: string,
): CanonicalObject {
  const present = runs.filter((run) => run.records.length > 0);
  const records = present.flatMap((run) => [...run.records]);

  let firstIndex = 0;
  const described: CanonicalValue[] = present.map((run) => {
    const entry: CanonicalObject = {
      starting_chain_hash: run.startingChainHash,
      first_index: firstIndex,
      count: run.records.length,
      head_chain_hash: chainHeadOf(run.records),
    };
    firstIndex += run.records.length;
    return entry;
  });

  const first = present[0];
  return {
    schema: EVIDENCE_EXPORT_SCHEMA,
    canonical_form: CANONICAL_FORM,
    evidence_schema: EVIDENCE_SCHEMA,
    exported_at: exportedAt,
    genesis_chain_hash: GENESIS_CHAIN_HASH,
    starting_chain_hash: first === undefined ? GENESIS_CHAIN_HASH : first.startingChainHash,
    head_chain_hash: chainHeadOf(records),
    count: records.length,
    run_count: described.length,
    runs: described,
    records: records.map(recordToCanonical),
  };
}

/** `darkroute-evidence-2026-08-20T14-22-08-412Z.json` - UTC, and nothing else. */
export function evidenceExportFilename(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, '-');
  return `darkroute-evidence-${stamp}.json`;
}

/**
 * Build the bundle. `nowMs` is injected rather than read, so an export is
 * reproducible in a test and so this module owns no clock.
 */
export function buildEvidenceExport(
  runs: readonly EvidenceRun[],
  nowMs: number,
): EvidenceExportBundle {
  const exportedAt = new Date(nowMs).toISOString();
  const document = evidenceExportDocument(runs, exportedAt);
  const present = runs.filter((run) => run.records.length > 0);
  return {
    text: canonicalize(document),
    document,
    count: present.reduce((total, run) => total + run.records.length, 0),
    runCount: present.length,
    filename: evidenceExportFilename(exportedAt),
  };
}
