/**
 * DEAD DROP's read side - the queue, its bodies, and whether the chain holds.
 *
 * =============================================================================
 * THIS FILE VERIFIES. IT DOES NOT SIGN, HASH, LINK OR REPAIR.
 * =============================================================================
 * Every hash and every signature on this screen was produced at filing time by
 * `services/crypto/chain.ts` and stored by `services/db/repositories/`. This
 * module opens the database, reads both halves back, and asks `verifyChain()`
 * whether they still agree. It computes no hash of its own, it has no write
 * path, and there is nothing in it that could make a broken chain look intact.
 *
 * =============================================================================
 * TWO STORES, THREE QUESTIONS, ALL ASKED
 * =============================================================================
 * `reportChain` holds one row per report - the link, the signature and the
 * queue state - and it never deletes, so it always runs from genesis.
 * `pendingReports` holds the signed bodies, and `purgeSynced()` can remove
 * acknowledged ones on an explicit user action. So:
 *
 *   verifyLinkage()  over the ROWS - is the queue's ORDER still provable,
 *                                        including for drops whose body is gone?
 *   agreement()      row AGAINST body - do the two stores still carry the same
 *                                        signed bytes for the same drop?
 *   verifyChain()    over the BODIES - do the payload hashes, the chain
 *                                        hashes and every ECDSA signature check
 *                                        out against the keys the records carry?
 *
 * THE MIDDLE QUESTION IS NOT OPTIONAL. The card prints CAPTURED and both hashes
 * off the ROW and POSITION / HEADING / PHOTO out of the BODY. Verifying only
 * the bodies would let a coherently rewritten body - new payload, recomputed
 * hashes, re-signed under an attacker's own key, whose `publicKeyId` matches
 * its own SPKI - pass `verifyChain` and print the attacker's coordinates beside
 * the row's untouched sha256 under a green DEVICE KEY OK. The row and the body
 * are compared field for field on everything the signature covers, and the
 * first drop where they disagree is a break, ranked exactly like a linkage
 * break: that drop reads CHAIN BROKEN and everything after it reads UNVERIFIED.
 *
 * =============================================================================
 * A PURGE LEAVES HOLES, NOT TAMPERING
 * =============================================================================
 * `pendingReports.purgeSynced()` deletes EVERY body whose `syncState` is
 * `synced`, not only the oldest ones. As soon as one drop syncs while an older
 * one is still pending, refused or dead-lettered - the case `reportChain.ts`
 * says never goes away - the surviving bodies have a HOLE in the middle, and
 * the record after the hole legitimately links to a body that is gone.
 *
 * So the bodies are not verified as one array. They are split into RUNS: each
 * run is a maximal stretch of drops that are adjacent in the row order and
 * still hold their body, and each run is verified against its OWN
 * `startingChainHash` - the first record's own `previousChainHash`. Verifying
 * across a hole would report `broken-link` for evidence that is perfectly
 * intact, and verifying a purged queue against GENESIS would report
 * `bad-genesis` for the same reason.
 *
 * =============================================================================
 * VERIFICATION DOES NOT NEED THIS INSTALL'S KEY
 * =============================================================================
 * `verifyChain` is called directly rather than through `createEvidenceChain()`,
 * which would probe the key manager first. Every record carries the public key
 * that signed it, so a queue stays checkable after the signing key is gone -
 * cleared site data, a restored export, somebody else's drops. All this needs
 * is a digest implementation. When the platform has none, nothing is claimed to
 * be verified: the verdicts come back `unverified`, never `verified`, and
 * `verifiable` is false so the card can say why.
 * GAP: see docs/gaps-inbox/dead-drop.md#the-signing-key-is-not-pinned
 *
 * =============================================================================
 * NO NETWORK, NO LOGGING
 * =============================================================================
 * There is no `fetch` in this file and no upload path behind it - the queue is
 * the product. There is no `console` call either: a payload carries the
 * driver's exact coordinates, and a diagnostic that quoted one would put it
 * somewhere it was never meant to go.
 */

import { CryptoUnavailableError } from '../../services/crypto/keys.ts';
import { GENESIS_CHAIN_HASH, verifyChain } from '../../services/crypto/chain.ts';
import type { ChainVerification, EvidenceRecord } from '../../services/crypto/chain.ts';
import {
  DatabaseUnavailableError,
  closeFwmDb,
  createRepositories,
  openFwmDb,
  pendingSyncCount,
} from '../../services/db/index.ts';
import type { PendingSyncCount } from '../../services/db/index.ts';
import type { FwmDatabase } from '../../services/db/repositories/support.ts';
import type { QueueSyncState, ReportChainRecord } from '../../services/db/schema.ts';

/**
 * What the SIGNED row can honestly say about one drop.
 *
 *   verified    the body is here, it agrees with its row, and it checked out
 *   broken      the body is here and it is the FIRST break in the chain - a
 *               row-linkage break, a row/body disagreement, or a failed hash
 *               or signature
 *   unverified  nothing could be checked past the break, or this platform has
 *               no WebCrypto to check with. NOT a claim that it is bad.
 *   no-body     the signed body is no longer on the device; the row, its link
 *               and its hashes remain
 */
export type SignedVerdict = 'verified' | 'broken' | 'unverified' | 'no-body';

/** One drop: its queue row, its signed body if the device still holds it. */
export interface DropRecord {
  readonly row: ReportChainRecord;
  readonly body: EvidenceRecord | null;
  readonly verdict: SignedVerdict;
}

/**
 * A maximal stretch of held bodies that is contiguous in the row order.
 *
 * One run per unbroken stretch; a purged body ends the run before it and starts
 * the next one. Each run is a valid chain in its own right, continuing from
 * `startingChainHash`, and is verified on its own.
 */
export interface ChainRun {
  /** Bodies in chain order. Never empty. */
  readonly records: readonly EvidenceRecord[];
  /** The hash this run continues from - its first record's own previous link. */
  readonly startingChainHash: string;
  /** Index in the full row list of this run's first drop. */
  readonly firstRowIndex: number;
  /** This run's own verification, or null when nothing could be checked. */
  readonly verification: ChainVerification | null;
}

export interface DeadDropSnapshot {
  /** Chain order, oldest first - the order the links run in. */
  readonly drops: readonly DropRecord[];
  readonly counts: PendingSyncCount;
  /** pending + syncing. The panel's `3 HELD`. */
  readonly heldCount: number;
  /** Row-level order and linkage, genesis included. */
  readonly linkage: { readonly ok: true } | { readonly ok: false; readonly reportId: string };
  /** The held bodies, split at every hole a purge left, each verified alone. */
  readonly runs: readonly ChainRun[];
  /** False when this platform has no WebCrypto and no signature could be read. */
  readonly verifiable: boolean;
  /** Every body still on the device, in chain order. Holes are not filled. */
  readonly exportable: readonly EvidenceRecord[];
  /** The hash the first run continues from. Genesis for a whole chain. */
  readonly startingChainHash: string;
}

export interface DeadDropPort {
  load(): Promise<DeadDropSnapshot>;
  /** Release the database handle. Safe when nothing was opened. */
  close(): void;
}

export interface DeadDropPortOptions {
  /** Database name. Tests open their own so they never share a queue. */
  readonly dbName?: string;
}

const HELD_STATES: readonly QueueSyncState[] = ['pending', 'syncing'];

/**
 * Everything the signature covers, carried by BOTH stores under the same name.
 *
 * `syncState` is deliberately absent: the row's is a `QueueSyncState`
 * (`pending`) and the record's is a `SyncState` (`held`), they are two different
 * vocabularies for transport bookkeeping, and neither is hashed or signed.
 */
export const ROW_BODY_FIELDS = [
  'reportId',
  'capturedAt',
  'payloadHash',
  'previousChainHash',
  'chainHash',
  'signature',
  'publicKeyId',
] as const;

export type RowBodyField = (typeof ROW_BODY_FIELDS)[number];

/**
 * The first signed field the two stores disagree about, or null when they carry
 * the same bytes.
 *
 * A disagreement is not a repairable inconsistency and this never picks a
 * winner: it reports which field moved and lets the verdict say the chain is
 * broken.
 */
export function rowBodyDisagreement(
  row: ReportChainRecord,
  body: EvidenceRecord,
): RowBodyField | null {
  for (const field of ROW_BODY_FIELDS) {
    if (row[field] !== body[field]) return field;
  }
  return null;
}

export function createDeadDropPort(options: DeadDropPortOptions = {}): DeadDropPort {
  let handle: FwmDatabase | null = null;

  async function database(): Promise<FwmDatabase> {
    if (handle !== null) return handle;
    // Not cached as a promise: a failed open must be retryable, because the
    // usual reason is another tab holding an upgrade, and that clears.
    const opened = await openFwmDb(options.dbName === undefined ? {} : { name: options.dbName });
    handle = opened;
    return opened;
  }

  return {
    async load() {
      const db = await database();
      const repos = createRepositories(db);

      const [rows, bodies, counts, linkage] = await Promise.all([
        repos.reportChain.all(),
        repos.pendingReports.all(),
        pendingSyncCount(db),
        repos.reportChain.verifyLinkage(),
      ]);

      const byId = new Map<string, EvidenceRecord>();
      for (const body of bodies) byId.set(body.reportId, body);

      // Ordered by the CHAIN rows, not by the body store: the rows are the
      // authority on order, and a body store that sorted differently would
      // hand `verifyChain` a re-ordering it would correctly call tampering.
      const plan = planRuns(rows, byId);
      const { runs, verifiable } = await verifyRuns(plan);

      // A row-level break outranks anything the bodies say. `verifyLinkage`
      // walks every row from genesis, including rows whose body was purged, so
      // it is the only check that can see a hole the body verification cannot
      // even reach. A row/body disagreement ranks with it: both mean the
      // evidence moved after it was signed.
      const linkageBreakAt = linkage.ok
        ? -1
        : rows.findIndex((row) => row.reportId === linkage.reportId);
      const disagreementAt = rows.findIndex((row) => {
        const body = byId.get(row.reportId);
        return body !== undefined && rowBodyDisagreement(row, body) !== null;
      });
      const breakAt = earliest(linkageBreakAt, disagreementAt);

      const drops: DropRecord[] = rows.map((row, index) => {
        const body = byId.get(row.reportId) ?? null;
        const placement = plan.placement.get(row.reportId);
        const run = placement === undefined ? null : (runs[placement.run] ?? null);
        return {
          row,
          body,
          verdict: verdictFor({
            index,
            breakAt,
            body,
            run,
            positionInRun: placement === undefined ? -1 : placement.position,
          }),
        };
      });

      const firstRun = runs[0];
      return {
        drops,
        counts,
        heldCount: rows.filter((row) => HELD_STATES.includes(row.syncState)).length,
        linkage: linkage.ok ? { ok: true } : { ok: false, reportId: linkage.reportId },
        runs,
        verifiable,
        exportable: runs.flatMap((run) => run.records),
        startingChainHash:
          firstRun === undefined ? GENESIS_CHAIN_HASH : firstRun.startingChainHash,
      };
    },

    close() {
      if (handle === null) return;
      closeFwmDb(handle);
      handle = null;
    },
  };
}

/** Where one drop's body sits: which run, and how far into it. */
interface RunPlacement {
  readonly run: number;
  readonly position: number;
}

interface RunPlan {
  readonly segments: readonly (readonly [number, readonly EvidenceRecord[]])[];
  readonly placement: ReadonlyMap<string, RunPlacement>;
}

/**
 * Cut the held bodies into contiguous runs, walking the ROWS.
 *
 * A row whose body is gone ends the run before it. Nothing here inspects a
 * hash: the split is by presence alone, so a run that fails to verify fails for
 * a real reason and not because this function guessed where a chain restarts.
 */
function planRuns(
  rows: readonly ReportChainRecord[],
  byId: ReadonlyMap<string, EvidenceRecord>,
): RunPlan {
  const segments: [number, EvidenceRecord[]][] = [];
  const placement = new Map<string, RunPlacement>();
  // -1 means "no run is open": the previous row held no body, or this is the
  // first row. A hole is what closes a run, and nothing else does.
  let openIndex = -1;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    const body = byId.get(row.reportId);
    if (body === undefined) {
      openIndex = -1;
      continue;
    }
    if (openIndex < 0) {
      segments.push([index, [body]]);
      openIndex = segments.length - 1;
    } else {
      segments[openIndex]?.[1].push(body);
    }
    const open = segments[openIndex];
    if (open === undefined) continue;
    placement.set(row.reportId, { run: openIndex, position: open[1].length - 1 });
  }

  return { segments, placement };
}

/**
 * Verify each run against its own starting hash.
 *
 * A platform with no `crypto.subtle` cannot check a signature, so its runs come
 * back with a null verification rather than an `ok` nobody earned, and
 * `verifiable` is false. Every other failure - a real break - comes back as a
 * `ChainVerification` with the failure in it, because that is a finding and not
 * an outage.
 */
async function verifyRuns(
  plan: RunPlan,
): Promise<{ readonly runs: readonly ChainRun[]; readonly verifiable: boolean }> {
  const runs: ChainRun[] = [];
  let verifiable = true;

  for (const [firstRowIndex, records] of plan.segments) {
    const first = records[0];
    const startingChainHash = first === undefined ? GENESIS_CHAIN_HASH : first.previousChainHash;
    let verification: ChainVerification | null = null;
    try {
      verification = await verifyChain(records, { startingChainHash });
    } catch (error: unknown) {
      if (!(error instanceof CryptoUnavailableError)) throw error;
      verifiable = false;
    }
    runs.push({ records, startingChainHash, firstRowIndex, verification });
  }

  return { runs, verifiable };
}

/** The earliest non-negative index of the two, or -1 when neither fired. */
function earliest(left: number, right: number): number {
  if (left < 0) return right;
  if (right < 0) return left;
  return Math.min(left, right);
}

export interface VerdictInput {
  /** Position in the full row list. */
  readonly index: number;
  /**
   * Index of the first row-level break - a linkage hole or a row/body
   * disagreement - or -1 when the rows are intact and agree with their bodies.
   */
  readonly breakAt: number;
  readonly body: EvidenceRecord | null;
  /** The run this drop's body belongs to, or null when it holds no body. */
  readonly run: ChainRun | null;
  /** Position within that run, or -1 when there is no body. */
  readonly positionInRun: number;
}

/**
 * What the SIGNED row is allowed to say about one drop.
 *
 * The order of these tests is the whole safety argument:
 *   1. a row-level break outranks everything the bodies say, because it is the
 *      only check that can see past a purged body;
 *   2. a drop with no body claims nothing at all;
 *   3. a run nobody could check claims nothing at all;
 *   4. `verified` is reachable ONLY from a run that actually verified past this
 *      drop's own position.
 * There is no path that returns `verified` from a null verification, and none
 * that returns it for a drop at or after a break.
 */
export function verdictFor(input: VerdictInput): SignedVerdict {
  if (input.breakAt >= 0) {
    if (input.index === input.breakAt) return 'broken';
    if (input.index > input.breakAt) return 'unverified';
  }
  if (input.body === null || input.run === null) return 'no-body';
  const verification = input.run.verification;
  if (verification === null) return 'unverified';
  const verifiedThrough = verification.ok ? input.run.records.length : verification.failure.index;
  if (input.positionInRun < verifiedThrough) return 'verified';
  // Equality can only be reached on a failed run: an `ok` run verified through
  // its full length, and no position equals it.
  if (input.positionInRun === verifiedThrough) return 'broken';
  return 'unverified';
}

/**
 * A load failure, in words the screen can render.
 *
 * Fixed sentences chosen by the error's TYPE, exactly as `reportQueue.ts` does
 * it. The thrown message is never shown: it is written for a developer and on
 * this path it could quote a payload field.
 *
 * There is deliberately NO `CryptoUnavailableError` branch. A device with no
 * WebCrypto still reads its queue perfectly well - it just cannot check a
 * signature - so that is not a load failure and must not blank the screen.
 * `verifyRuns` catches it, `snapshot.verifiable` carries it, and the card says
 * `THIS DEVICE CANNOT CHECK A SIGNATURE` beside verdicts that all read
 * UNVERIFIED.
 * GAP: see docs/gaps-inbox/dead-drop.md#no-empty-or-loading-state-is-drawn
 */
export function describeLoadFailure(error: unknown): string {
  if (error instanceof DatabaseUnavailableError) {
    return 'NO LOCAL STORAGE · NOTHING IS QUEUED HERE';
  }
  return 'THE QUEUE COULD NOT BE READ';
}
