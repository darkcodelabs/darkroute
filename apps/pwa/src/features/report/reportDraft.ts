/**
 * THE REPORT DRAFT - every decision this screen makes, as pure functions.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, panel `06 · REPORT - SHEET FROM
 * THE DOCK KEY` (v1 titled the same panel `SHEET FROM ANY SCREEN`). The element
 * order, the copy and the values are transcribed from that panel: the
 * `NEW CAMERA` / `CONFIRM EXISTING` toggle, `POSITION · AUTO`,
 * `FACING · FROM COMPASS`, `PHOTO`, `MAKE / MODEL`, the four mount chips, the
 * queue line and `SUBMIT REPORT`.
 *
 * EVERY STRING IN THIS FILE SURVIVED v2 UNCHANGED. v2 redrew the sheet - flat,
 * borderless, 8px radius - and reworded exactly one thing, the heading, which
 * is `ReportView.tsx`'s `REPORT_TITLE` and not this file's. `HOLD REPORT BUTTON
 * 1s TO ONE-TAP DROP A PIN` still says "REPORT BUTTON" even though the button
 * is now a dock key; that is v2's own copy and it is not ours to modernise.
 *
 * =============================================================================
 * NOTHING IN THIS FILE TOUCHES A BROWSER, A STORE OR A DATABASE
 * =============================================================================
 * `ReportScreen.tsx` reads the stores, `reportQueue.ts` signs and queues. This
 * file turns facts into the strings and the payload the design asks for, which
 * is what makes every one of them assertable without a fix, a sensor or a
 * database.
 *
 * =============================================================================
 * A FREE-TEXT FIELD IS HOW A PLATE ESCAPES
 * =============================================================================
 * `MAKE / MODEL` is the only place in this product where a driver types into a
 * report. {@link makeModelIssue} runs the same `looksLikePlate` judgement the
 * plate vault and the persistence guard use, and a plate-shaped value blocks
 * the submit instead of being silently dropped - a value quietly discarded is
 * a value the user thinks they filed.
 */

import { looksLikePlate } from '../../services/db/repositories/plateVault.ts';
import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';
import {
  NO_VALUE,
  formatCoordinates,
  formatHeadingCardinal,
  formatHeadingDegrees,
  formatSatellites,
} from '../radar';

// ---------------------------------------------------------------------------
// The two modes
// ---------------------------------------------------------------------------

/** The toggle at the top of the sheet. `new` is the state the design draws. */
export type ReportMode = 'new' | 'confirm';

export const REPORT_MODES: readonly ReportMode[] = ['new', 'confirm'];

/** Exact copy from the panel. Do not re-word or re-case them. */
export const MODE_LABEL: Readonly<Record<ReportMode, string>> = {
  new: 'NEW CAMERA',
  confirm: 'CONFIRM EXISTING',
};

// ---------------------------------------------------------------------------
// The mount chips
// ---------------------------------------------------------------------------

/** `POLE MOUNT` · `SOLAR` · `TRAILER` · `UNSURE`, in the drawn order. */
export type MountKind = 'pole' | 'solar' | 'trailer' | 'unsure';

export const MOUNT_KINDS: readonly MountKind[] = ['pole', 'solar', 'trailer', 'unsure'];

export const MOUNT_LABEL: Readonly<Record<MountKind, string>> = {
  pole: 'POLE MOUNT',
  solar: 'SOLAR',
  trailer: 'TRAILER',
  unsure: 'UNSURE',
};

// ---------------------------------------------------------------------------
// Where the facing bearing came from
// ---------------------------------------------------------------------------

/**
 * The design draws one provenance - `FACING · FROM COMPASS` - because it draws
 * one state: a phone with a magnetometer, reporting a new camera. The other
 * three are authored, in the design's own `LABEL · SOURCE` idiom, because a
 * label that claims a compass when there is no compass is worse than a label
 * the design never drew.
 * GAP: see docs/gaps-inbox/report.md#facing-label-has-one-drawn-provenance
 */
export type FacingSource = 'compass' | 'record' | 'manual' | 'none';

export const FACING_LABEL: Readonly<Record<FacingSource, string>> = {
  /*
   * KEPT, AND NO LONGER PRODUCED BY THE SHEET.
   *
   * `ReportScreen` stopped seeding a NEW report's facing from `headingDeg`, so
   * nothing in the app mints this source today. The member stays because the
   * type is also the SHAPE OF EVERY REPORT ALREADY SIGNED AND HELD: payloads
   * queued before that change carry `facing_source: 'compass'`, and
   * `evidenceExport`, `deadDropQueue` and the dead-drop screens all read them
   * back. Narrowing the union would make the app unable to describe its own
   * unsynced evidence.
   */
  compass: 'FACING · FROM COMPASS',
  record: 'FACING · ON RECORD',
  manual: 'FACING · SET BY HAND',
  /*
   * WAS `FACING · NO COMPASS`, which named the wrong cause.
   *
   * The sheet no longer seeds a NEW report's facing from the phone at all - see
   * the long note on `seedBearing` in ReportScreen.tsx - so an unset arc is now
   * the NORMAL opening state of every new report, not a device failure. Telling
   * a driver their phone lacks a compass, when the product simply has not asked
   * them yet, blames the hardware for a question the app is about to put to
   * them.
   */
  none: 'FACING · NOT SET YET',
};

/** `TAP ARC TO ADJUST`, exactly as drawn. */
export const FACING_HINT = 'TAP ARC TO ADJUST';

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

/**
 * Everything the driver has decided so far.
 *
 * THERE IS STILL NO PHOTO FIELD, AND THE REASON CHANGED.
 *
 * It used to be that nothing could strip a photo's EXIF GPS, so the build
 * refused the attachment outright. `preparePhoto()` strips it now - by
 * re-encode, so the GPS block is not removed but never written - and the sheet
 * attaches one photo per report.
 *
 * The draft still does not carry it. A hash on the draft would be a hash whose
 * bytes this screen may not be holding: `emptyDraft()` would reset it for free,
 * but a remount or a refused re-attach would leave the draft naming a
 * photograph that is not in hand, and the app would sign a report claiming a
 * photo it cannot produce. The bytes and their digest live together in one
 * `ReportScreen` state value so the two cannot disagree, and the digest reaches
 * the payload as {@link reportPayload}'s third argument.
 */
export interface ReportDraft {
  readonly mode: ReportMode;
  /** Compass degrees the camera looks along, or null when nothing supplied one. */
  readonly facingDeg: number | null;
  readonly facingSource: FacingSource;
  readonly mount: MountKind | null;
  /** Raw text as typed. Validated by {@link makeModelIssue}, never trimmed away. */
  readonly makeModel: string;
}

export function emptyDraft(mode: ReportMode = 'new'): ReportDraft {
  return { mode, facingDeg: null, facingSource: 'none', mount: null, makeModel: '' };
}

/**
 * Seed the facing from whatever the platform offered, without overwriting a
 * bearing the driver set by hand - the arc is theirs once they have touched it.
 */
export function seedFacing(
  draft: ReportDraft,
  bearingDeg: number | null,
  source: FacingSource,
): ReportDraft {
  if (draft.facingSource === 'manual') return draft;
  if (bearingDeg === null || !Number.isFinite(bearingDeg)) {
    return draft.facingSource === 'none' && draft.facingDeg === null
      ? draft
      : { ...draft, facingDeg: null, facingSource: 'none' };
  }
  const normalised = normaliseDegrees(bearingDeg);
  if (draft.facingDeg === normalised && draft.facingSource === source) return draft;
  return { ...draft, facingDeg: normalised, facingSource: source };
}

/** A tap on the arc. From here on the bearing is the driver's, not the sensor's. */
export function withFacing(draft: ReportDraft, bearingDeg: number): ReportDraft {
  if (!Number.isFinite(bearingDeg)) return draft;
  return { ...draft, facingDeg: normaliseDegrees(bearingDeg), facingSource: 'manual' };
}

/**
 * The chips are one choice, not four switches: `UNSURE` and `POLE MOUNT`
 * cannot both be true. Pressing the pressed chip clears it, so a mis-tap is
 * undoable without a fifth "none" chip the design does not draw.
 */
export function withMount(draft: ReportDraft, mount: MountKind): ReportDraft {
  return { ...draft, mount: draft.mount === mount ? null : mount };
}

export function withMode(draft: ReportDraft, mode: ReportMode): ReportDraft {
  return draft.mode === mode ? draft : { ...draft, mode };
}

export function withMakeModel(draft: ReportDraft, makeModel: string): ReportDraft {
  return { ...draft, makeModel };
}

export function normaliseDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// ---------------------------------------------------------------------------
// POSITION · AUTO
// ---------------------------------------------------------------------------

/** `POSITION · AUTO`, exactly as drawn. */
export const POSITION_LABEL = 'POSITION · AUTO';

/**
 * The design's separator between the two coordinates on THIS panel.
 * `01 · RADAR` renders the same pair comma-separated; the report sheet renders
 * `39.0997 N · 84.5786 W`. One formatter, one separator swap, so the two
 * screens can never disagree about precision or hemisphere letters.
 */
const COORDINATE_SEPARATOR = ' · ';

export function reportCoordinates(lat: number | null, lon: number | null): string {
  const rendered = formatCoordinates(lat, lon);
  return rendered === NO_VALUE ? NO_VALUE : rendered.replace(', ', COORDINATE_SEPARATOR);
}

/** RADAR's word for a fix that is not there. Reused rather than re-authored. */
export const NO_FIX_DETAIL = 'NO FIX';

export interface PositionDetailInput {
  readonly accuracyM: number | null;
  readonly satellites: number | null;
  /**
   * The third segment of `±4 M · 9 SATS · Reading Rd`. A street name needs a
   * reverse geocode, which is a network request keyed to the driver's exact
   * position - the one request this product will not make. Confirm mode puts
   * the camera being confirmed in the slot instead; new mode leaves it empty.
   * GAP: see docs/gaps-inbox/report.md#no-street-name-without-a-reverse-geocode
   */
  readonly place: string | null;
}

/**
 * `±4 M · 9 SATS · Reading Rd`.
 *
 * Both instrument strings come from RADAR's `formatSatellites`, called once per
 * fact, so "±4 M" and "9 SATS" are formatted in exactly one place in the app.
 * A browser never supplies a satellite count, so on the web this line is
 * usually just the accuracy - the design's own row, minus a number no web API
 * has ever exposed.
 */
export function positionDetail(input: PositionDetailInput): string | null {
  const accuracy = formatSatellites(null, input.accuracyM);
  const satellites = formatSatellites(input.satellites, null);
  const parts = [accuracy, satellites, input.place ?? NO_VALUE].filter(
    (part) => part !== NO_VALUE,
  );
  return parts.length === 0 ? null : parts.join(' · ');
}

// ---------------------------------------------------------------------------
// FACING · FROM COMPASS
// ---------------------------------------------------------------------------

/** The four-point compass, in the order `Math.round(deg / 90)` indexes them. */
const LANE_WORDS: readonly string[] = ['north', 'east', 'south', 'west'];

/**
 * `covering the northbound lane`.
 *
 * A camera reads the traffic coming AT it, so the lane it covers runs along the
 * reciprocal of where the lens points. The design draws exactly one instance -
 * 223° -> "covering the northbound lane" - and this reproduces it: 223 + 180 =
 * 43, and 43° rounds to north on a four-point compass. Four points, not eight,
 * because "northeastbound lane" is not a thing anyone says.
 * GAP: see docs/gaps-inbox/report.md#lane-sentence-derived-from-one-example
 */
export function laneCovered(facingDeg: number | null): string | null {
  if (facingDeg === null || !Number.isFinite(facingDeg)) return null;
  const reciprocal = normaliseDegrees(facingDeg + 180);
  const word = LANE_WORDS[Math.round(reciprocal / 90) % LANE_WORDS.length];
  return word === undefined ? null : `covering the ${word}bound lane`;
}

/** The big cardinal beside the dial, as drawn: SW. RADAR's eight-point word. */
export function facingCardinal(facingDeg: number | null): string {
  return formatHeadingCardinal(facingDeg);
}

/** `223° · covering the northbound lane`. Null when no bearing is known. */
export function facingDetail(facingDeg: number | null): string | null {
  const lane = laneCovered(facingDeg);
  if (lane === null) return null;
  return `${formatHeadingDegrees(facingDeg)} · ${lane}`;
}

// ---------------------------------------------------------------------------
// MAKE / MODEL
// ---------------------------------------------------------------------------

/** Why a typed make/model cannot be filed. Null when it is fine. */
export type MakeModelIssue = 'plate-shaped';

/**
 * Refuse anything plate-shaped.
 *
 * KNOWN COST, ACCEPTED: `looksLikePlate` is five to eight mixed alphanumerics,
 * so a genuine model name with a number in it ("Falcon 2") trips it. Biting too
 * eagerly costs a driver one rephrased entry; biting too late puts a licence
 * plate into a submission bound for a community server.
 * GAP: see docs/gaps-inbox/report.md#make-model-plate-guard-false-positives
 */
export function makeModelIssue(makeModel: string): MakeModelIssue | null {
  const text = makeModel.trim();
  if (text === '') return null;
  return looksLikePlate(text) ? 'plate-shaped' : null;
}

// ---------------------------------------------------------------------------
// Can this be filed?
// ---------------------------------------------------------------------------

/**
 * Why `SUBMIT REPORT` is not pressable.
 *
 *   no-position   a report with no coordinates reports nothing.
 *   no-camera     confirm mode with no known camera nearby to confirm.
 *   plate-shaped  the free-text field looks like a licence plate.
 *   submitting    a submission is already in flight.
 */
export type SubmitBlocker =
  | 'no-position'
  | 'no-camera'
  | 'plate-shaped'
  | 'demo-active'
  | 'submitting';

export interface SubmitInput {
  readonly draft: ReportDraft;
  readonly hasPosition: boolean;
  readonly cameraId: string | null;
  readonly submitting: boolean;
  /**
   * True while the scripted demo drive owns the position store.
   *
   * The demo is a real feature - it is how somebody sees what the app does
   * without driving - so it stays. What does not stay is being able to file a
   * report from inside it. The report sheet opens from ANY screen, including
   * mid-demo, and the fix underneath it is fabricated: Michigan Avenue in
   * Chicago, at a 4 m accuracy that reads as excellent to every downstream
   * check. A curious person pressing SUBMIT during a demo is not doing anything
   * wrong, so the app has to be the thing that knows better.
   */
  readonly demoActive?: boolean;
}

export function submitBlocker(input: SubmitInput): SubmitBlocker | null {
  if (input.submitting) return 'submitting';
  // BEFORE the position check, because during a demo there IS a position and it
  // is the problem. Ordering it after would let the sheet report "ready".
  if (input.demoActive === true) return 'demo-active';
  if (!input.hasPosition) return 'no-position';
  if (input.draft.mode === 'confirm' && input.cameraId === null) return 'no-camera';
  if (makeModelIssue(input.draft.makeModel) !== null) return 'plate-shaped';
  return null;
}

// ---------------------------------------------------------------------------
// The queue line
// ---------------------------------------------------------------------------

/** How the line above `SUBMIT REPORT` is reading. */
export type ReportStatusTone = 'queued' | 'blocked' | 'failed';

export interface ReportStatus {
  readonly tone: ReportStatusTone;
  readonly text: string;
}

/**
 * `2 REPORTS QUEUED · SYNC ON WIFI`.
 *
 * The plural is the design's; the singular is derived, because "1 REPORTS" is
 * not a sentence. The tail states the queue's actual policy: the design's
 * string is true while `wifiOnlySync` is on, which is the default, and says
 * something else when the driver has turned that off.
 * GAP: see docs/gaps-inbox/report.md#queue-line-plural-and-tail-derived
 */
export function queueLine(queuedReports: number, wifiOnly: boolean): string | null {
  const count = Math.max(0, Math.trunc(queuedReports));
  if (count === 0) return null;
  const noun = count === 1 ? 'REPORT' : 'REPORTS';
  const tail = wifiOnly ? 'SYNC ON WIFI' : 'SYNC WHEN ONLINE';
  return `${String(count)} ${noun} QUEUED · ${tail}`;
}

/**
 * Authored, because the design draws no blocked, empty or failed state for this
 * sheet. Each one names the thing the driver has to change.
 * GAP: see docs/gaps-inbox/report.md#no-blocked-or-failed-state-is-drawn
 */
const BLOCKER_TEXT: Readonly<Record<SubmitBlocker, string | null>> = {
  'no-position': 'NO POSITION FIX · A REPORT NEEDS ONE',
  'no-camera': 'NO KNOWN CAMERA NEARBY TO CONFIRM',
  'plate-shaped': 'MAKE / MODEL LOOKS LIKE A PLATE · NOT QUEUED',
  // Says which thing is fake and what to do, rather than "unavailable".
  'demo-active': 'DEMO DRIVE · THIS POSITION IS NOT REAL · STOP THE DEMO TO REPORT',
  submitting: null,
};

export interface ReportStatusInput {
  readonly blocker: SubmitBlocker | null;
  readonly queuedReports: number;
  readonly wifiOnly: boolean;
  /** A submission or a queue read that failed, in words. Never a coordinate. */
  readonly failure: string | null;
}

/**
 * What the line says, in priority order: a failure first, then whatever is
 * blocking the submit, then the queue count. Null means it has nothing to say -
 * an empty queue with a fileable report draws no line at all, exactly as the
 * REPORT bar draws no `0 QUEUED`.
 */
export function reportStatus(input: ReportStatusInput): ReportStatus | null {
  if (input.failure !== null) return { tone: 'failed', text: input.failure };
  if (input.blocker !== null) {
    const text = BLOCKER_TEXT[input.blocker];
    if (text !== null) return { tone: 'blocked', text };
  }
  const line = queueLine(input.queuedReports, input.wifiOnly);
  return line === null ? null : { tone: 'queued', text: line };
}

// ---------------------------------------------------------------------------
// The signed payload
// ---------------------------------------------------------------------------

/**
 * Names the shape a backend has to know to read one of these.
 *
 * v2 SPLIT ONE COORDINATE INTO TWO, because v1's single `position` was two
 * different facts wearing one name. It was written from `useCurrentFix()` -
 * the PHONE's location - and then read as though it were the camera's. On a
 * divided road those are ten to forty metres apart, and on a two-lane road
 * they are still never the same point, because the driver is on the road and
 * the camera is beside it.
 *
 * That mattered in three directions at once:
 *
 *   WRONG DATA     a camera filed at the driver's position is filed in the
 *                  traffic lane, with a bias that is consistent across every
 *                  report the app ever produces.
 *   WRONG ANSWER   `nearbyExisting()` measures the duplicate radius from this
 *                  field. Fed the driver's position it compares a road point
 *                  against pole points, so two drivers on opposite carriageways
 *                  report the same camera forty metres apart and BOTH pass the
 *                  25 m check.
 *   OVERSHARE      it is a seven-decimal record of where a specific person's
 *                  car was. `services/adapters/geolocation.ts` calls its own
 *                  `redact()` at three decimals "the ONLY safe way to turn a
 *                  fix into something loggable"; this was four orders of
 *                  magnitude finer and, for anything that ever leaves the
 *                  device, permanent.
 *
 * So v2 names them separately and refuses to guess:
 *
 *   observer_position  where the phone was. Always present. Provenance for the
 *                      accuracy figure, and nothing else.
 *   subject_position   where the CAMERA is. `null` until somebody establishes
 *                      it, and null is the honest answer rather than a copy of
 *                      the observer fix.
 *
 * v1 records stay valid and stay verifiable: the chain hashes each payload as
 * it was written, so nothing re-signs. Readers branch on `schema`.
 */
export const REPORT_PAYLOAD_SCHEMA = 'fwm-report/v2';

/** Every payload shape this build can read. Ordered oldest first. */
export const KNOWN_REPORT_SCHEMAS = ['fwm-report/v1', 'fwm-report/v2'] as const;

/**
 * How the camera's own position was arrived at.
 *
 *   projected  the driver said which side of the car and how far over, and
 *              `subjectPosition.ts` resolved that against the observer fix and
 *              the heading. An estimate from a stated observation.
 *   placed     put on a map by hand. Nothing does this yet; the member exists
 *              so a future map does not have to relabel every record that came
 *              before it.
 *   record     carried over from the camera being confirmed, which already had
 *              a position that somebody else established.
 *
 * There is deliberately no `observer` member. "The camera is where the driver
 * was" is the v1 bug, and giving it a name would make it expressible again.
 *
 * The distinction is not bookkeeping: it is what a reviewer needs to judge an
 * edit, and it is the difference between an estimate offered as an estimate and
 * a GPS fix passed off as a survey.
 */
export type SubjectPositionSource = 'projected' | 'placed' | 'record';

export interface SubjectPosition {
  readonly lat: number;
  readonly lon: number;
  readonly source: SubjectPositionSource;
}

export interface ReportSubject {
  /** Confirm mode only: the camera this report is about. */
  readonly cameraId: string | null;
  /** The PHONE's fix. Not the camera. See {@link REPORT_PAYLOAD_SCHEMA}. */
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number | null;
  readonly satellites: number | null;
  /**
   * Where the camera actually is, when that has been established: placed by
   * the driver, or carried over from the record being confirmed. Omitted or
   * null means not established, which is a fact rather than a gap to fill.
   */
  readonly subject?: SubjectPosition | null;
  /**
   * True when the fix came from the scripted demo drive rather than a radio.
   *
   * The demo is reachable from Settings in a PRODUCTION build and writes
   * fabricated fixes into the same position store the report screen reads,
   * starting on Michigan Avenue in Chicago at a 4 m accuracy. Nothing else
   * downstream can tell that record from a real one - it is signed by the same
   * key, it clears any accuracy gate as HIGH confidence, and its tile source is
   * `network` rather than `fixture`. The only place the distinction still
   * exists is the moment of capture, so it is captured here and signed with
   * the rest of the payload.
   */
  readonly synthetic?: boolean;
}

/**
 * The object that gets canonicalised, hashed, signed and queued.
 *
 * `gps_accuracy_m` is spelled the way `services/crypto/chain.ts` projects it
 * (`GPS_ACCURACY_FIELD`), so the record's `gpsAccuracyM` is the same number the
 * signature covers rather than a second copy that could drift.
 *
 * `photo` IS THE DIGEST, NOT THE PICTURE. It used to be `null` unconditionally,
 * because nothing could strip a photo's metadata; it is now the lowercase-hex
 * SHA-256 of the prepared JPEG that `reportPhotos` holds under the same
 * `reportId`, and `null` when the driver attached nothing.
 *
 * The key set is unchanged, so {@link REPORT_PAYLOAD_SCHEMA} does NOT move: the
 * field was always the reserved slot for exactly this and has only stopped
 * being permanently empty. A reader that branched on `photo === null` still
 * reads every record ever written.
 *
 * Defaulted rather than required, so a caller with nothing to attach - and
 * every existing test - passes two arguments as before.
 */
export function reportPayload(
  draft: ReportDraft,
  subject: ReportSubject,
  photoSha256: string | null = null,
): CanonicalObject {
  const makeModel = draft.makeModel.trim();
  const placed = subject.subject ?? null;
  return {
    schema: REPORT_PAYLOAD_SCHEMA,
    kind: draft.mode === 'new' ? 'new_camera' : 'confirm_existing',
    camera_id: draft.mode === 'confirm' ? subject.cameraId : null,
    // THE PHONE. Named for what it is, so no reader can mistake it again.
    observer_position: { lat: subject.lat, lon: subject.lon },
    // THE CAMERA, or null. Never silently the line above.
    subject_position: placed === null ? null : { lat: placed.lat, lon: placed.lon },
    subject_position_source: placed === null ? null : placed.source,
    // Signed, so a demo record cannot be laundered into a real one by editing
    // the queue: changing it breaks the payload hash and the signature with it.
    synthetic: subject.synthetic === true,
    gps_accuracy_m: subject.accuracyM,
    satellites: subject.satellites,
    facing_deg: draft.facingDeg,
    facing_source: draft.facingDeg === null ? null : draft.facingSource,
    mount: draft.mount,
    make_model: makeModel === '' || makeModelIssue(makeModel) !== null ? null : makeModel,
    photo: photoSha256,
  };
}
