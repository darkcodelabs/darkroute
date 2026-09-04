/**
 * The DEAD DROP view model - a pure function of what came off the disk.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B2 · DEAD DROP - QUEUE + EVIDENCE
 * CHAIN`. Element order, copy and casing are the panel's:
 *
 *   header      `DEAD DROP`            + `3 HELD`
 *   notice      the signing statement, verbatim
 *   card        `DROP 03` + `HELD · 41 MIN`, the five fact rows in the panel's
 *               order, the sha256/prev block, the chaining note
 *   list        `DROP 02 · …` rows, newest first
 *   actions     `NOT SENT` · `EXPORT JSON`
 *
 * This module reads no store, opens no database, touches no browser API and
 * takes its clock as an argument. Everything it renders is a field of a signed
 * record or of the queue row beside it - there is no computed fact on this
 * screen and no fact that is not already on disk.
 *
 * =============================================================================
 * NOTHING IS FILTERED OUT OF THE QUEUE
 * =============================================================================
 * Every row `reportChain` holds appears, in chain order, whatever its state.
 * A dead-lettered drop is not deleted and must not be hidden: "DEAD LETTER IS
 * NOT DELETION. A dead-lettered report is still on disk, still signed, still
 * exportable, still part of the chain." (`reportChain.ts`.) A drop whose body
 * was purged after sync keeps its row, its number and its hashes.
 * GAP: see docs/gaps-inbox/dead-drop.md#only-two-queue-states-are-drawn
 */

import { formatHashForDisplay } from '../../services/crypto/chain.ts';
import type { QueueSyncState } from '../../services/db/schema.ts';

import type { DeadDropSnapshot, DropRecord, SignedVerdict } from './deadDropQueue.ts';
import {
  capturedClock,
  capturedShort,
  dropCameraId,
  dropHeading,
  dropNumber,
  dropPhoto,
  dropPosition,
  heldFor,
  photoWord,
} from './format.ts';

/**
 * The signing statement, verbatim from the panel. It is the promise the whole
 * screen exists to keep, so it is a constant and not a prop.
 */
export const SIGNING_STATEMENT =
  'Reports are signed the moment you file them and held on this phone. ' +
  'Nothing is edited after the fact. There is nowhere to send them yet.';

/** The note under the hash block, verbatim from the panel. */
export const CHAINING_NOTE =
  "Each drop hashes the one before it, so the queue's order is provable even offline for weeks.";

/** The send key names the actual state until a transport is injected. */
export const SYNC_LABEL = 'SEND NOW';
export const SYNC_UNAVAILABLE_LABEL = 'NOT SENT';
export const SYNC_UNAVAILABLE_REASON = 'No upload destination is configured in this build.';
export const EXPORT_LABEL = 'EXPORT JSON';

/** What an empty queue says. The panel draws no empty state. */
export const EMPTY_QUEUE = 'NOTHING QUEUED';

/** What the list says while the database is still opening. */
export const READING_QUEUE = 'READING THE QUEUE';

/**
 * What the card says when the platform has no WebCrypto.
 *
 * Every verdict on such a device reads UNVERIFIED, and UNVERIFIED with no
 * explanation looks like a queue full of suspect evidence. It is not: nothing
 * could be checked, which is an outage and not a finding. This is the sentence
 * that says so, and it is the only thing on the screen that distinguishes the
 * two.
 * GAP: see docs/gaps-inbox/dead-drop.md#a-device-with-no-webcrypto-says-so
 */
export const NO_SIGNATURE_CHECK = 'THIS DEVICE CANNOT CHECK A SIGNATURE';

/**
 * The right-hand badge. `HELD` and `SYNCED` are the panel's; the other three
 * are authored, because `QueueSyncState` has five members and hiding the ones
 * nobody drew would hide evidence.
 */
export const BADGE_LABELS: Readonly<Record<QueueSyncState, string>> = Object.freeze({
  pending: 'HELD',
  syncing: 'SYNCING',
  synced: 'SYNCED',
  rejected: 'REFUSED',
  dead_letter: 'STUCK',
});

/** The last term of the list meta line. `signed` and `accepted` are drawn. */
export const META_WORDS: Readonly<Record<QueueSyncState, string>> = Object.freeze({
  pending: 'signed',
  syncing: 'signed',
  synced: 'accepted',
  rejected: 'refused',
  dead_letter: 'stuck',
});

/**
 * The SIGNED row. Only `DEVICE KEY OK` is drawn, and it is rendered only when a
 * signature actually verified against the key the record carries.
 * GAP: see docs/gaps-inbox/dead-drop.md#signed-row-is-a-verification-not-a-label
 */
export const VERDICT_LABELS: Readonly<Record<SignedVerdict, string>> = Object.freeze({
  verified: 'DEVICE KEY OK',
  broken: 'CHAIN BROKEN',
  unverified: 'UNVERIFIED',
  'no-body': 'BODY NOT HELD',
});

/** Header right slot while the queue is still being read, and when it cannot be. */
export const READING_LABEL = 'READING';
export const UNAVAILABLE_LABEL = 'UNAVAILABLE';

export type DeadDropStatus = 'loading' | 'ready' | 'unavailable';

/** One line in the scrolling list. */
export interface DropSummary {
  readonly reportId: string;
  readonly state: QueueSyncState;
  /** `DROP 02`, or `DROP 02 · FWM-0442` when the record names a camera. */
  readonly title: string;
  /** `13:58 · no photo · signed`, or `yesterday · accepted` once handed over. */
  readonly meta: string;
  readonly badge: string;
}

/** One fact row of the detail card. */
export interface DropFact {
  readonly key: string;
  readonly value: string;
}

/** The detail card - the newest drop, whatever state it is in. */
export interface DropDetail {
  readonly reportId: string;
  readonly state: QueueSyncState;
  /** `DROP 03` */
  readonly title: string;
  /** `HELD · 41 MIN` */
  readonly badge: string;
  readonly facts: readonly DropFact[];
  readonly verdict: SignedVerdict;
  /** `8f04·822f·b975·e932·0ddb·14d4` - six groups, as drawn. */
  readonly chainHash: string;
  readonly previousChainHash: string;
  /**
   * Why nothing on this device could be checked, or null when the check ran.
   * The panel draws no such line; a screen that renders UNVERIFIED without
   * saying why is worse than the line the design is missing.
   */
  readonly unverifiableReason: string | null;
}

export interface DeadDropViewModel {
  readonly status: DeadDropStatus;
  /** The panel's `3 HELD`. Null while loading - never a placeholder zero. */
  readonly heldCount: number | null;
  /** Null when there is nothing to feature. The card is then not drawn. */
  readonly detail: DropDetail | null;
  /** The list below the card: every other drop, newest first. */
  readonly drops: readonly DropSummary[];
  /** Something is actually held, so a future send path would have work to do. */
  readonly hasHeld: boolean;
  /** A body is actually present, so `EXPORT JSON` has bytes to write. */
  readonly hasExportable: boolean;
  /** False when this platform has no WebCrypto and no verdict could be earned. */
  readonly verifiable: boolean;
  /** Set when the queue could not be read at all. */
  readonly failure: string | null;
}

/**
 * What the list region says when it has no rows to draw, or null when it has
 * nothing to say.
 *
 * A queue holding exactly one drop is NOT empty -- that drop is in the card
 * above -- so the list stays silent rather than contradicting the card.
 * GAP: see docs/gaps-inbox/dead-drop.md#no-empty-or-loading-state-is-drawn
 */
export function listMessage(model: DeadDropViewModel): string | null {
  if (model.status === 'loading') return READING_QUEUE;
  if (model.status === 'unavailable') return model.failure;
  if (model.detail === null) return EMPTY_QUEUE;
  return null;
}

/** The header's right-hand slot. */
export function headerStatus(model: DeadDropViewModel): string {
  if (model.status === 'loading') return READING_LABEL;
  if (model.status === 'unavailable') return UNAVAILABLE_LABEL;
  return `${String(model.heldCount ?? 0)} HELD`;
}

/**
 * `DROP 02 · FWM-0442`.
 *
 * The panel draws a street name here. There is none on this device and getting
 * one would mean sending the driver's exact position to a geocoder, so the
 * suffix is the camera the report is about when it names one, and nothing at
 * all when it does not.
 * GAP: see docs/gaps-inbox/dead-drop.md#place-names-cannot-be-produced-without-a-geocoder
 */
export function dropTitle(drop: DropRecord, sequence: number): string {
  const number = dropNumber(sequence);
  const cameraId = dropCameraId(drop.body?.payload ?? null);
  return cameraId === null ? number : `${number} · ${cameraId}`;
}

/**
 * The row meta line, term by term.
 *
 * The panel draws THREE terms on a held row (`13:58 · photo · signed`) and TWO
 * on the accepted one (`yesterday · accepted`). The middle term is what this
 * device is still holding to hand over, so it is drawn only when there is
 * something to say about it:
 *
 *   - a drop the backend already accepted has nothing left to hand over, and
 *     the panel drops the term for exactly that row;
 *   - a drop whose body was purged has no photo field to read, and `no photo`
 *     there would be a claim about evidence this device no longer holds.
 *
 * `dropPhoto`/`photoWord` never invent a count either way.
 * GAP: see docs/gaps-inbox/dead-drop.md#photo-row-has-nothing-to-count
 */
export function metaTerms(drop: DropRecord, nowMs: number): readonly string[] {
  const state = drop.row.syncState;
  const payload = drop.body?.payload ?? null;
  const when = capturedShort(drop.row.capturedAt, nowMs);
  if (payload === null || state === 'synced') return [when, META_WORDS[state]];
  return [when, photoWord(payload), META_WORDS[state]];
}

export function dropSummary(drop: DropRecord, sequence: number, nowMs: number): DropSummary {
  const state = drop.row.syncState;
  return {
    reportId: drop.row.reportId,
    state,
    title: dropTitle(drop, sequence),
    meta: metaTerms(drop, nowMs).join(' · '),
    badge: BADGE_LABELS[state],
  };
}

export function dropDetail(
  drop: DropRecord,
  sequence: number,
  nowMs: number,
  unverifiableReason: string | null = null,
): DropDetail {
  const state = drop.row.syncState;
  const payload = drop.body?.payload ?? null;
  return {
    reportId: drop.row.reportId,
    state,
    title: dropNumber(sequence),
    badge: `${BADGE_LABELS[state]} · ${heldFor(drop.row.capturedAt, nowMs)}`,
    facts: [
      { key: 'CAPTURED', value: capturedClock(drop.row.capturedAt) },
      { key: 'POSITION', value: dropPosition(payload) },
      { key: 'HEADING', value: dropHeading(payload) },
      { key: 'PHOTO', value: dropPhoto(payload) },
      { key: 'SIGNED', value: VERDICT_LABELS[drop.verdict] },
    ],
    verdict: drop.verdict,
    chainHash: formatHashForDisplay(drop.row.chainHash),
    previousChainHash: formatHashForDisplay(drop.row.previousChainHash),
    unverifiableReason,
  };
}

/** The model while the database is still opening. Renders no drop at all. */
export function loadingModel(): DeadDropViewModel {
  return {
    status: 'loading',
    heldCount: null,
    detail: null,
    drops: [],
    hasHeld: false,
    hasExportable: false,
    verifiable: true,
    failure: null,
  };
}

/** The model when the queue could not be read. Says so; renders nothing fake. */
export function unavailableModel(failure: string): DeadDropViewModel {
  return { ...loadingModel(), status: 'unavailable', failure };
}

/**
 * The loaded model.
 *
 * `snapshot.drops` arrives oldest first, which is the order the chain links
 * run in and therefore the order the drop numbers count in. The screen shows
 * the newest drop in the card and the rest below it, newest first, so the
 * sequence number is the index in the ORIGINAL order and the display order is
 * that array reversed. Numbering off the display order would renumber every
 * drop each time one syncs.
 */
export function readyModel(snapshot: DeadDropSnapshot, nowMs: number): DeadDropViewModel {
  const numbered = snapshot.drops.map((drop, index) => ({ drop, sequence: index }));
  const newest = numbered[numbered.length - 1];
  const rest = numbered.slice(0, -1).reverse();
  const unverifiableReason = snapshot.verifiable ? null : NO_SIGNATURE_CHECK;

  return {
    status: 'ready',
    heldCount: snapshot.heldCount,
    detail:
      newest === undefined
        ? null
        : dropDetail(newest.drop, newest.sequence, nowMs, unverifiableReason),
    drops: rest.map((entry) => dropSummary(entry.drop, entry.sequence, nowMs)),
    hasHeld: snapshot.heldCount > 0,
    hasExportable: snapshot.exportable.length > 0,
    verifiable: snapshot.verifiable,
    failure: null,
  };
}
