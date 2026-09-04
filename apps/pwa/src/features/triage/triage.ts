/**
 * TRIAGE -- the arithmetic and the strings behind `B4 · ALERT TRIAGE - BY
 * OWNER TYPE`.
 *
 * SOURCE: `Flockys Screens II.dc.html`, panel `B4 · ALERT TRIAGE - BY OWNER
 * TYPE` (lines 497-546): the header `TRIAGE` / `ALERT FATIGUE CONTROL`, the
 * `ALERTS PER DRIVE - PROJECTED` card (`4`, `down from 19`, `with current
 * filters`), five owner rows, the `MUTED CAMERAS DON'T DISAPPEAR` card, and
 * the `RE-ALERT ON MUTED IF` / `closer than 150 ft` footer row.
 *
 * =============================================================================
 * MUTING REMOVES THE ALERT, NEVER THE RECORD -- AND NEITHER DOES A FILTER
 * =============================================================================
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *    count in EXPOSURE, still log to LOOKUP. Muting only removes the alert -
 *    never the record."
 *      -- Flockys Screens II.dc.html, B4
 *
 * This screen is where that sentence is printed, so it is the last place that
 * may contradict it. Two consequences are load-bearing here:
 *
 *   1. {@link projectAlerts} never reads `entry.muted`. The word does not
 *      appear in any predicate in this file. A muted pass is a pass.
 *   2. The BASELINE ("down from 19") counts EVERY recorded pass, including the
 *      owner classes whose switch is off. A number that shrank when a switch
 *      was flipped would be a filter erasing the record, which is the exact
 *      thing the card underneath forbids. Only the PROJECTED figure moves.
 *
 * =============================================================================
 * NOTHING HERE INVENTS A NUMBER
 * =============================================================================
 * Every figure is counted off rows the alert slice already wrote
 * (`stores/history.ts`), through the same `cameraPasses` predicate EXPOSURE
 * counts with, so TRIAGE and LOG can never disagree about what an alert was.
 * Where the design prints a figure this product has no field for -- the police
 * row's `shared to 412 agencies` -- an em dash is printed instead of a guess.
 * GAP: see docs/gaps-inbox/triage.md#no-agency-sharing-count-exists
 *
 * A number this device cannot stand behind is treated the same way, and PER
 * ROW: see {@link ownerCountIsResolvable}. A `0` on a class whose records may
 * simply have been evicted is a claim about the tile cache, not about the road
 * -- and it is a claim a driver would read as good news.
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * An `AlertLogEntry` carries no plate and no coordinate, and nothing here adds
 * one. The owner class of a camera is a property of the CAMERA record. Nothing
 * in this module reaches a network, a URL, a notification or a log.
 */

import { OWNER_TYPES } from '../../stores';
import type { AlertLogEntry, CameraOwnerType } from '../../stores';
import { NO_VALUE, distanceUnit, formatCount, formatDistanceValue } from '../radar';

export type { CameraOwnerType };

// ---------------------------------------------------------------------------
// The five rows
// ---------------------------------------------------------------------------

/**
 * Row order is `OWNER_TYPES` from the settings slice, which is already the
 * order the panel draws: police, inter-agency, HOA, private, unverified.
 * Re-declaring it here would be a second list to keep in step with the store.
 */
export const TRIAGE_OWNER_TYPES = OWNER_TYPES;

/** The row headlines, verbatim. */
export const OWNER_LABELS: Readonly<Record<CameraOwnerType, string>> = Object.freeze({
  police: 'POLICE / AGENCY',
  inter_agency: 'INTER-AGENCY SHARED',
  hoa: 'HOA / NEIGHBORHOOD',
  private: 'PRIVATE / BUSINESS',
  unverified: 'UNVERIFIED REPORTS',
});

/**
 * The three captions that describe a class rather than count anything.
 * Verbatim, and constant -- there is nothing to measure in "retail lots,
 * storage".
 */
const OWNER_DESCRIPTIONS: Readonly<Record<CameraOwnerType, string | null>> = Object.freeze({
  police: null,
  inter_agency: 'any owner, shared feed',
  hoa: null,
  private: 'retail lots, storage',
  unverified: '1 confirmation only',
});

// ---------------------------------------------------------------------------
// Attributing a recorded pass to an owner class
// ---------------------------------------------------------------------------

/**
 * Resolve a camera id to its owner class, or null when this device cannot.
 *
 * Null is a real answer and it is common: the camera tile that carried the
 * record can be evicted long after the pass was logged.
 */
export type OwnerLookup = (cameraId: string) => CameraOwnerType | null;

/** What a window of passes turned out to be made of. */
export interface OwnerSummary {
  /** Distinct cameras seen, per owner class. */
  readonly distinctCameras: Readonly<Record<CameraOwnerType, number>>;
  /** Passes whose camera record resolved to an owner class. */
  readonly attributedPasses: number;
  /** Passes whose camera record is no longer on the device. */
  readonly unattributedPasses: number;
  readonly totalPasses: number;
}

function emptyOwnerCounts(): Record<CameraOwnerType, number> {
  const out = {} as Record<CameraOwnerType, number>;
  for (const owner of TRIAGE_OWNER_TYPES) out[owner] = 0;
  return out;
}

/**
 * Count a window of camera passes by owner class.
 *
 * Distinct cameras, not passes: the design's `11 on your usual routes` is a
 * count of cameras out there, and driving the same street twice does not put a
 * twelfth camera on the road.
 */
export function summariseOwners(
  passes: readonly AlertLogEntry[],
  ownerOf: OwnerLookup,
): OwnerSummary {
  const counts = emptyOwnerCounts();
  const seen = new Set<string>();
  let attributed = 0;
  let unattributed = 0;

  for (const pass of passes) {
    const cameraId = pass.cameraId;
    if (cameraId === null) continue;
    const owner = ownerOf(cameraId);
    if (owner === null) {
      unattributed++;
      continue;
    }
    attributed++;
    if (seen.has(cameraId)) continue;
    seen.add(cameraId);
    counts[owner] += 1;
  }

  return {
    distinctCameras: Object.freeze(counts),
    attributedPasses: attributed,
    unattributedPasses: unattributed,
    totalPasses: passes.length,
  };
}

/**
 * Can this device say anything at all about owner classes right now?
 *
 * False means every recorded pass points at a camera record the device no
 * longer holds, so no per-class count means anything. This is the WHOLE-LOG
 * question; a ROW asks {@link ownerCountIsResolvable} instead, because total
 * eviction is the rare case and partial eviction is the normal one.
 */
export function ownersAreResolvable(summary: OwnerSummary): boolean {
  return summary.attributedPasses > 0 || summary.totalPasses === 0;
}

/**
 * Can this device print a NUMBER on THIS row right now?
 *
 * Tile eviction is partial far more often than it is total: a device that still
 * holds the tile one police camera came from resolves that pass and loses the
 * rest. A whole-log guard answers "yes, owners are resolvable" in that state,
 * and HOA then prints `0 on your usual routes` -- a confident zero that is a
 * statement about the cache wearing the clothes of a statement about the road.
 * That is the exact failure the em dash was written to prevent.
 *
 * So a row asks the narrower question:
 *
 *   count > 0                  a real count of records this device is holding.
 *                              It can be an undercount after an eviction, but
 *                              every camera it names was actually driven past.
 *   count === 0, nothing lost  a real zero. No pass went unattributed, so there
 *                              was no camera of this class on the record.
 *   count === 0, passes lost   unknowable. The missing records could be exactly
 *                              this class. Prints an em dash.
 *
 * GAP: see docs/gaps-inbox/triage.md#usual-routes-is-the-recorded-log
 */
export function ownerCountIsResolvable(
  ownerType: CameraOwnerType,
  summary: OwnerSummary,
): boolean {
  if (summary.distinctCameras[ownerType] > 0) return true;
  return summary.unattributedPasses === 0;
}

/**
 * The caption under a row headline.
 *
 * Three of the five are prose the design states outright. The other two are
 * counts:
 *
 *   `shared to 412 agencies`   there is no agency-sharing field anywhere in
 *                              this product's data model, so the count prints
 *                              an em dash rather than a plausible number.
 *                              GAP: docs/gaps-inbox/triage.md#no-agency-sharing-count-exists
 *   `11 on your usual routes`  distinct HOA cameras in the recorded alert log
 *                              -- the roads this driver has actually been down.
 *                              A zero this device cannot stand behind prints an
 *                              em dash: see {@link ownerCountIsResolvable}, and
 *                              note that PARTIAL eviction is enough to trigger
 *                              it, not only total eviction.
 *                              GAP: docs/gaps-inbox/triage.md#usual-routes-is-the-recorded-log
 */
export function ownerCaption(ownerType: CameraOwnerType, summary: OwnerSummary): string {
  const described = OWNER_DESCRIPTIONS[ownerType];
  if (described !== null) return described;
  if (ownerType === 'police') return `shared to ${NO_VALUE} agencies`;
  const count = ownerCountIsResolvable(ownerType, summary)
    ? formatCount(summary.distinctCameras[ownerType])
    : NO_VALUE;
  return `${count} on your usual routes`;
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

export interface AlertProjection {
  /** Drives the history slice can actually see. 0 means nothing to divide by. */
  readonly drives: number;
  /**
   * True when the one drive being divided by has not ended yet.
   *
   * It changes no figure. It changes what the figures may be CALLED: over an
   * open drive both halves are running counts of a drive still happening, so
   * the caption says `this drive so far` rather than implying a rate over
   * finished drives that nothing here has measured.
   * GAP: see docs/gaps-inbox/triage.md#drive-count-is-not-in-the-store
   */
  readonly driveInProgress: boolean;
  /** Alerts per drive under the current switches. Null when `drives` is 0. */
  readonly projected: number | null;
  /** Alerts per drive with every switch on. Null when `drives` is 0. */
  readonly baseline: number | null;
  /** Passes that survive the current switches. */
  readonly filteredPasses: number;
  /** Every recorded pass in the window. Switches do not change this. */
  readonly totalPasses: number;
  readonly attributedPasses: number;
  readonly unattributedPasses: number;
}

export interface ProjectionInput {
  /** Camera passes in the window, from `cameraPasses()`. */
  readonly passes: readonly AlertLogEntry[];
  readonly ownerOf: OwnerLookup;
  readonly enabled: Readonly<Record<CameraOwnerType, boolean>>;
  /** How many drives those passes span. */
  readonly drives: number;
  /** True when the drive those passes came from is still being driven. */
  readonly driveInProgress: boolean;
}

/**
 * `4`, and the `19` it is down from.
 *
 * A pass survives the switches when its owner class is switched on, OR when
 * this device cannot resolve its owner class at all. The second half of that is
 * deliberate and matches how the rest of the product treats an unknown: an
 * unknown-facing camera "reads every plate it can see, so it stays in every
 * list, every count and every alert" (`services/db/schema.ts`). Guessing the
 * other way would silence cameras on the strength of a missing tile.
 *
 * `entry.muted` is not read. A muted pass counts on both sides of the figure.
 */
export function projectAlerts(input: ProjectionInput): AlertProjection {
  const { passes, ownerOf, enabled, drives, driveInProgress } = input;
  let filtered = 0;
  let attributed = 0;
  let unattributed = 0;

  for (const pass of passes) {
    const cameraId = pass.cameraId;
    const owner = cameraId === null ? null : ownerOf(cameraId);
    if (owner === null) unattributed++;
    else attributed++;
    if (owner === null || enabled[owner]) filtered++;
  }

  const usable = Number.isFinite(drives) && drives > 0 ? Math.trunc(drives) : 0;
  return {
    drives: usable,
    driveInProgress: usable > 0 && driveInProgress,
    projected: usable === 0 ? null : perDrive(filtered, usable),
    baseline: usable === 0 ? null : perDrive(passes.length, usable),
    filteredPasses: filtered,
    totalPasses: passes.length,
    attributedPasses: attributed,
    unattributedPasses: unattributed,
  };
}

/**
 * Passes divided by drives, to the nearest whole alert.
 *
 * The design prints whole numbers on both halves of the comparison, and half an
 * alert is not a thing a driver experiences.
 */
function perDrive(passes: number, drives: number): number {
  return Math.round(passes / drives);
}

/** `4`, or an em dash when there is no drive to divide by. */
export function formatProjection(value: number | null): string {
  return value === null ? NO_VALUE : formatCount(value);
}

/**
 * The two caption lines beside the hero figure.
 *
 * The design draws `down from 19` / `with current filters`, which is the case
 * where the switches actually remove something over a drive that is over. The
 * other cases are not drawn, and each says what it is instead of printing a
 * comparison that is not true.
 * GAP: see docs/gaps-inbox/triage.md#projection-caption-when-nothing-is-filtered
 *
 * =============================================================================
 * AN OPEN DRIVE IS A RUNNING COUNT, AND THE CAPTION SAYS SO
 * =============================================================================
 * The denominator this screen can honestly use is the one recorded trip, so
 * while that trip is open the hero is "alerts SO FAR on this drive": it starts
 * at zero and climbs, and the baseline beside it is the same partial window
 * unfiltered. That is a true number and a useful one -- it is not a rate over
 * drives, which is what an unqualified `ALERTS PER DRIVE - PROJECTED` would
 * claim. The second line names the window rather than letting the eyebrow
 * imply one, and reverts to the design's `with current filters` once the drive
 * has ended and the figure is a whole drive's worth.
 * GAP: see docs/gaps-inbox/triage.md#drive-count-is-not-in-the-store
 */
export function projectionLines(projection: AlertProjection): readonly [string, string] {
  const { projected, baseline, driveInProgress } = projection;
  if (projected === null || baseline === null) {
    return ['no drives on record', 'nothing to project yet'];
  }
  // Which window the two figures were counted over. `this drive so far` is the
  // truth while the trip is open; `with current filters` is the design's, and
  // is true once the drive it counted is a whole drive.
  const qualifier = driveInProgress ? 'this drive so far' : 'with current filters';
  if (projection.totalPasses === 0) {
    const none = driveInProgress ? 'no cameras yet this drive' : 'no cameras this drive';
    return [none, 'nothing to filter yet'];
  }
  if (projected < baseline) return [`down from ${formatCount(baseline)}`, qualifier];
  return ['nothing filtered out', qualifier];
}

// ---------------------------------------------------------------------------
// RE-ALERT ON MUTED IF
// ---------------------------------------------------------------------------

/**
 * The distance that means "never pierce a mute".
 *
 * `mutePierces()` in `stores/alert.ts` is `nearestDistanceFt < threshold`, so
 * zero can never be true and is the off position. The design draws the row as a
 * switch and states one distance under it; the model stores the distance, so
 * off has to be expressed as a distance too.
 * GAP: see docs/gaps-inbox/triage.md#re-alert-is-a-switch-over-a-distance
 */
export const RE_ALERT_OFF_FT = 0;

export function isReAlertOn(distanceFt: number): boolean {
  return Number.isFinite(distanceFt) && distanceFt > RE_ALERT_OFF_FT;
}

/**
 * `closer than 150 ft`, through RADAR's own distance formatter so a distance
 * printed here and the same distance printed on the screen that buzzed cannot
 * round differently.
 */
export function reAlertCaption(distanceFt: number): string {
  if (!isReAlertOn(distanceFt)) return 'muted stays muted';
  const unit = distanceUnit(distanceFt).toLowerCase();
  return `closer than ${formatDistanceValue(distanceFt)} ${unit}`;
}
