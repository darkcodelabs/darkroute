/**
 * EXPOSURE -- the arithmetic behind `05 · LOG - EXPOSURE`.
 *
 * SOURCE: `Flockys App Screens.dc.html`, panel `05 · LOG - EXPOSURE`
 * (`FLOCKED TODAY` / `12` / `CAMERAS · 4 UNIQUE`, the seven-bar week,
 * `HOTTEST SEGMENT` / `5 CAMS / 1.2 MI`, `ALL TIME` / `1,284` /
 * `SINCE MAR 2026`, `TIMELINE`), and `Flockys Watch.dc.html`, `W5 · TODAY -
 * EXPOSURE GLANCE`, which draws the same seven bars and names them
 * `7 DAY TREND`.
 *
 * =============================================================================
 * MUTED CAMERAS COUNT. NOTHING HERE READS `entry.muted`.
 * =============================================================================
 *   "They still draw on SWEEP in grey, still count in EXPOSURE, still log to
 *    LOOKUP. Muting only removes the alert - never the record."
 *      -- Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 * The word `muted` does not appear in any predicate below, and
 * `LogScreen.test.tsx` drives an identical drive twice -- muted and unmuted --
 * and asserts every number on this screen is the same both times.
 *
 * =============================================================================
 * TWO COUNTS, NAMED APART
 * =============================================================================
 * A PASS is the edge the alert slice counts in EXPOSURE: a camera that actually
 * put the driver in range. An ENCOUNTER is any camera the log recorded the
 * driver coming up on, including one that only ever reached `approaching`.
 * `FLOCKED TODAY` and the seven bars count passes; the `TIMELINE` and
 * `HOTTEST SEGMENT` draw encounters, which is the only way the design's amber
 * 760 FT row can exist. Both are counted off the recorded rows, so nothing on
 * this screen is a counter that some other file has to remember to reset.
 * GAP: see docs/gaps-inbox/log.md#timeline-draws-encounters-hero-counts-passes
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * An `AlertLogEntry` carries no latitude and no plate, and nothing here adds
 * one. `label` is the place name attached to the CAMERA record ("Vine St &
 * 7th"), which is a property of the camera and not a coordinate history of the
 * driver. Nothing in this module reaches a network, a URL or a log.
 *
 * =============================================================================
 * NO GEOSPATIAL MATHS
 * =============================================================================
 * Distances arrive already measured by `@fwm/core`. This module counts rows
 * and buckets timestamps; it never converts a coordinate into a distance, and
 * where the design prints a length nothing measured -- the hottest segment's
 * `1.2 MI` -- it prints an em dash instead of a guess.
 * GAP: see docs/gaps-inbox/log.md#hottest-segment-length-is-not-measured
 */

import { isAlertingState } from '../../stores';
import type { AlertLogEntry, AlertState, TripProgress } from '../../stores';
import { NO_VALUE, distanceUnit, formatDistanceValue, formatSpeedMph } from '../radar';

// ---------------------------------------------------------------------------
// Scope -- the TRIP / ALL TIME toggle
// ---------------------------------------------------------------------------

/**
 * The header toggle, in the order the design draws it.
 * GAP: see docs/gaps-inbox/log.md#what-the-trip-all-time-toggle-scopes
 */
export const LOG_SCOPES = ['trip', 'all-time'] as const;

export type LogScope = (typeof LOG_SCOPES)[number];

/** The exact strings on the two keys: `TRIP` and `ALL TIME`. */
export const SCOPE_LABELS: Readonly<Record<LogScope, string>> = Object.freeze({
  trip: 'TRIP',
  'all-time': 'ALL TIME',
});

/** TRIP is the key the design draws filled, so it is the one the screen opens on. */
export const DEFAULT_LOG_SCOPE: LogScope = 'trip';

/**
 * Which key is filled when the screen opens.
 *
 * The design draws TRIP filled and draws the panel only in that state, so a
 * driver with a drive in progress gets exactly the reference panel. With NO
 * trip open, TRIP is structurally empty ({@link scopedEntries} refuses to fall
 * back to the whole log under a key labelled TRIP), and opening there would
 * show an empty TIMELINE and an em-dashed HOTTEST SEGMENT on a device with a
 * full record. Nothing in this build starts a trip.
 * GAP: see docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner
 */
export function openingLogScope(tripOpen: boolean): LogScope {
  return tripOpen ? DEFAULT_LOG_SCOPE : 'all-time';
}

export function isLogScope(value: unknown): value is LogScope {
  return typeof value === 'string' && (LOG_SCOPES as readonly string[]).includes(value);
}

/**
 * The rows a scope covers.
 *
 * `trip` with no trip open is genuinely empty -- not "everything". A driver who
 * has not started driving has no trip exposure, and showing the whole log under
 * a key labelled TRIP would be a lie about which drive those cameras were on.
 */
export function scopedEntries(
  entries: readonly AlertLogEntry[],
  scope: LogScope,
  trip: TripProgress | null,
): readonly AlertLogEntry[] {
  if (scope === 'all-time') return entries;
  if (trip === null) return [];
  const endedAtMs = trip.endedAtMs;
  return entries.filter(
    (entry) => entry.atMs >= trip.startedAtMs && (endedAtMs === null || entry.atMs <= endedAtMs),
  );
}

// ---------------------------------------------------------------------------
// What counts as a pass, and what draws a row
// ---------------------------------------------------------------------------

/**
 * How bad each state is, in the alert engine's own escalation order
 * (`packages/core` `deriveAlertState`). `clear` is 0; everything above it is a
 * camera the driver was up against.
 */
const STATE_SEVERITY: Readonly<Record<AlertState, number>> = Object.freeze({
  clear: 0,
  approaching: 1,
  in_range: 2,
  multiple: 3,
});

export function alertSeverity(state: AlertState): number {
  return STATE_SEVERITY[state];
}

/** Any state that is not `clear`. The timeline's admission test. */
export function isEncounterState(state: AlertState): boolean {
  return alertSeverity(state) > 0;
}

/**
 * One camera pass -- the same edge the exposure counters count.
 *
 * `stores/alert.ts` calls `historyActions.notePass()` exactly when a
 * NON-ALERTING state becomes an ALERTING one and there is a camera it is
 * about, and that same file defines alerting as `in_range || multiple`
 * (`isAlertingState`, alert.ts). This predicate is that condition, re-read off
 * the recorded row, and this screen derives FLOCKED TODAY and the seven bars
 * from it -- from the rows, not from a session counter that nothing rolls over
 * at midnight.
 *
 * BEING NEAR A CAMERA IS NOT BEING FLOCKED. An encounter that only ever reached
 * `approaching` is not a pass and is not in this count. It still draws a
 * timeline row, in the approaching hue, exactly as the design's middle row
 * draws `Reading Rd` at 760 FT against a 500 FT threshold.
 * GAP: see docs/gaps-inbox/log.md#timeline-draws-encounters-hero-counts-passes
 *
 * It does not look at `muted`.
 */
export function isCameraPass(entry: AlertLogEntry): boolean {
  return (
    entry.cameraId !== null && isAlertingState(entry.state) && !isAlertingState(entry.previousState)
  );
}

/** Passes only, newest first (the order the history slice already keeps). */
export function cameraPasses(entries: readonly AlertLogEntry[]): readonly AlertLogEntry[] {
  return entries.filter(isCameraPass);
}

/**
 * One row per ENCOUNTER, at the worst state that encounter reached.
 *
 * WHAT THE DESIGN DRAWS: three rows, three cameras, one of them amber --
 * `Reading Rd`, `14:09:51 · 38 MPH · 760 FT`, dot `#FFC02E`
 * (`--fwm-alert-approaching`) at 760 FT against a 500 FT threshold. That row is
 * an APPROACHING row: it can only exist if the timeline admits encounters that
 * never entered range. The design also draws exactly ONE row per camera, so a
 * camera first seen at 760 FT and then passed at 380 FT is one row and not two.
 *
 * Both fall out of the same rule. The log is a stream of state CHANGES, so an
 * encounter is a run of rows between `clear` states, and this returns the
 * HIGHEST-SEVERITY row of each run -- the moment the camera got closest to
 * mattering, with the distance and clock of that moment. A run that peaked at
 * `approaching` yields the amber row; a run that reached `in_range` yields that
 * row and not the approach that led into it.
 *
 * EVERY PASS STILL GETS ITS OWN ROW. A run can contain more than one pass (an
 * alert that sags to `approaching` and closes again is two passes to
 * `stores/alert.ts`, which counts episodes off `isAlertingState`), so a second
 * pass edge inside a run starts a second row rather than being folded into the
 * first. The result is therefore a superset of {@link cameraPasses}: one row
 * per pass, plus one row per encounter that never became a pass.
 *
 * Rows with no camera name no encounter and are skipped: a drop to `clear` with
 * the nearest camera two miles off is a real transition and not a place.
 *
 * It does not look at `muted`. A silenced encounter is an encounter.
 */
export function cameraEncounters(entries: readonly AlertLogEntry[]): readonly AlertLogEntry[] {
  const rows: AlertLogEntry[] = [];
  let worst: AlertLogEntry | null = null;
  // `entries` is newest first and a run is a consecutive stretch, so the walk
  // has to be chronological. The result is reversed back at the end.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined) continue;
    if (!isEncounterState(entry.state)) {
      if (worst !== null) rows.push(worst);
      worst = null;
      continue;
    }
    if (entry.cameraId === null) continue;
    // A fresh pass while a pass is already on the books is a second row, not a
    // taller version of the first one.
    if (isCameraPass(entry) && worst !== null && isAlertingState(worst.state)) {
      rows.push(worst);
      worst = null;
    }
    if (worst === null || alertSeverity(entry.state) > alertSeverity(worst.state)) worst = entry;
  }
  // The encounter still running when the log ends is still an encounter.
  if (worst !== null) rows.push(worst);
  rows.reverse();
  return rows;
}

// ---------------------------------------------------------------------------
// FLOCKED TODAY
// ---------------------------------------------------------------------------

/** The hero count and its `CAMERAS · N UNIQUE` caption. */
export interface TodayExposure {
  readonly passes: number;
  readonly uniqueCameras: number;
}

/**
 * Today's passes, counted off today's rows.
 *
 * NOT `history.today.passes`. That counter is only ever zeroed by
 * `historyActions.rollDay()`, and nothing in this build calls it -- so it holds
 * passes since the store was created, which after midnight, after a
 * `clear()` or after a `hydrate()` is a different number from the one the seven
 * bars draw from the same rows. Two numbers on one card that disagree about the
 * same day is worse than either being slightly stale, so this screen counts the
 * record and the counter is not read here at all.
 * GAP: see docs/gaps-inbox/log.md#nothing-rolls-the-day-over
 *
 * `dayStartMs` is local midnight, supplied by the caller: the clock belongs to
 * the screen, not to the arithmetic.
 */
export function todayExposure(
  entries: readonly AlertLogEntry[],
  dayStartMs: number,
): TodayExposure {
  const cameras = new Set<string>();
  let passes = 0;
  for (const entry of cameraPasses(entries)) {
    if (localDayStart(entry.atMs) !== dayStartMs) continue;
    passes += 1;
    if (entry.cameraId !== null) cameras.add(entry.cameraId);
  }
  return { passes, uniqueCameras: cameras.size };
}

// ---------------------------------------------------------------------------
// The seven-day trend
// ---------------------------------------------------------------------------

/** The axis labels, indexed by `Date.getDay()`. Rendered `SUN`..`SAT`. */
export const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** Seven bars, as drawn on both the phone panel and the `W5` watch face. */
export const TREND_DAYS = 7;

/**
 * Bar heights are quantised into 5% steps because a screen in this app may not
 * carry an inline style, and a CSS class per step is the only way to express a
 * data-driven height without one.
 * GAP: see docs/gaps-inbox/log.md#bar-heights-are-quantised
 */
export const BAR_LEVELS = 20;

/** Which of the three bar hues a day gets. */
export type BarRank = 'peak' | 'second' | 'base';

export interface DayBar {
  /** Local midnight of the day this bar covers. */
  readonly dayStartMs: number;
  /** `SUN`..`SAT`. */
  readonly label: string;
  readonly passes: number;
  /** 0..{@link BAR_LEVELS}. 0 renders as a baseline tick, never as nothing. */
  readonly level: number;
  readonly rank: BarRank;
}

/** Local midnight for an instant. The caller owns the clock; this owns the day. */
export function localDayStart(atMs: number): number {
  const date = new Date(atMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Local midnight `delta` days from `dayStartMs`.
 *
 * Goes through `Date.setDate` rather than adding 86.4e6, so the 23- and
 * 25-hour days either side of a DST change do not slide the whole week by an
 * hour and drop a day's passes into its neighbour.
 */
export function addDays(dayStartMs: number, delta: number): number {
  const date = new Date(dayStartMs);
  date.setDate(date.getDate() + delta);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function dayLabel(dayStartMs: number): string {
  return DAY_LABELS[new Date(dayStartMs).getDay()] ?? NO_VALUE;
}

/**
 * The seven bars, oldest first, ending on the day `nowMs` falls in.
 *
 * WHY ROLLING AND NOT A CALENDAR WEEK: the watch face names this `7 DAY TREND`.
 * The phone panel's fixed `SUN`..`SAT` axis is what a rolling window prints
 * when today is a Saturday, so the rolling reading reproduces the drawn panel
 * and still means something on a Tuesday.
 * GAP: see docs/gaps-inbox/log.md#seven-day-window-is-rolling
 *
 * HUE: the design fills the tallest bar in the in-range hue and the next
 * tallest in the approaching hue, and leaves the rest on the line colour. Ties
 * are not broken -- every day holding the top count is a peak, which is honest
 * about two equally bad days and renders identically to the reference, whose
 * seven values are all distinct.
 * GAP: see docs/gaps-inbox/log.md#bar-hue-rule-is-inferred
 */
export function sevenDayBars(entries: readonly AlertLogEntry[], nowMs: number): readonly DayBar[] {
  const today = localDayStart(nowMs);
  const starts: number[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) starts.push(addDays(today, -i));

  const counts = starts.map(() => 0);
  for (const entry of cameraPasses(entries)) {
    const day = localDayStart(entry.atMs);
    const index = starts.indexOf(day);
    if (index === -1) continue;
    counts[index] = (counts[index] ?? 0) + 1;
  }

  const peak = counts.reduce((max, value) => Math.max(max, value), 0);
  const second = counts.reduce((max, value) => (value < peak ? Math.max(max, value) : max), 0);

  return starts.map((dayStartMs, index) => {
    const passes = counts[index] ?? 0;
    return {
      dayStartMs,
      label: dayLabel(dayStartMs),
      passes,
      level: barLevel(passes, peak),
      rank: barRank(passes, peak, second),
    };
  });
}

/** 0 for an empty day, and never 0 for a day that had one. */
export function barLevel(passes: number, peak: number): number {
  if (passes <= 0 || peak <= 0) return 0;
  return Math.max(1, Math.min(BAR_LEVELS, Math.round((passes / peak) * BAR_LEVELS)));
}

export function barRank(passes: number, peak: number, second: number): BarRank {
  if (passes <= 0) return 'base';
  if (passes === peak) return 'peak';
  if (passes === second) return 'second';
  return 'base';
}

// ---------------------------------------------------------------------------
// The hottest segment
// ---------------------------------------------------------------------------

export interface HotSegment {
  /** The camera record's place name, e.g. `Reading Rd`. */
  readonly name: string;
  /** Distinct cameras on that segment -- the design's `5 CAMS`. */
  readonly cameraCount: number;
  /** Encounters at that place, which is what ranks it. */
  readonly passes: number;
}

/**
 * The named place with the most encounters in scope.
 *
 * Rows with no label are skipped rather than bucketed under a placeholder: a
 * camera whose record carries no place name cannot name a segment, and
 * "UNKNOWN · 5 CAMS" is a fabricated street.
 *
 * Ties go to the segment with more distinct cameras, then to the more recent
 * one -- `entries` is newest first, so the first survivor of a tie is the one
 * the driver passed most recently.
 *
 * It counts ENCOUNTERS, the same rows the TIMELINE below the card draws, so a
 * driver can count the rows and arrive at the card's own `5 CAMS`. The hero
 * above it counts PASSES, which is a narrower thing and says so.
 * GAP: see docs/gaps-inbox/log.md#timeline-draws-encounters-hero-counts-passes
 */
export function hottestSegment(entries: readonly AlertLogEntry[]): HotSegment | null {
  const passes = new Map<string, number>();
  const cameras = new Map<string, Set<string>>();

  for (const entry of cameraEncounters(entries)) {
    const name = entry.label;
    if (name === null || name === '') continue;
    passes.set(name, (passes.get(name) ?? 0) + 1);
    const seen = cameras.get(name) ?? new Set<string>();
    if (entry.cameraId !== null) seen.add(entry.cameraId);
    cameras.set(name, seen);
  }

  let best: HotSegment | null = null;
  for (const [name, count] of passes) {
    const cameraCount = cameras.get(name)?.size ?? 0;
    if (
      best === null ||
      count > best.passes ||
      (count === best.passes && cameraCount > best.cameraCount)
    ) {
      best = { name, cameraCount, passes: count };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

const GROUP_SIZE = 3;

/**
 * `1,284`. Grouped by hand rather than through `Intl`, because a locale that
 * groups on `.` would turn a four-figure exposure count into a decimal.
 *
 * `null` is "the durable count has not loaded yet" and renders an em dash. It
 * is not zero: zero passes is a real, and good, number.
 */
export function formatExposureTotal(total: number | null): string {
  if (total === null || !Number.isFinite(total)) return NO_VALUE;
  const digits = String(Math.max(0, Math.trunc(total)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i] ?? '';
    if (fromEnd > 1 && (fromEnd - 1) % GROUP_SIZE === 0) out += ',';
  }
  return out;
}

/** `SINCE MAR 2026`, as rendered under the all-time total. */
export function formatSince(sinceMs: number | null): string {
  if (sinceMs === null || !Number.isFinite(sinceMs)) return NO_VALUE;
  const date = new Date(sinceMs);
  const month = MONTH_LABELS[date.getMonth()] ?? NO_VALUE;
  return `SINCE ${month} ${String(date.getFullYear())}`;
}

/** `14:22:08` -- local, 24-hour, zero padded, exactly as the timeline draws it. */
export function formatClock(atMs: number): string {
  const date = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** `CAMERAS · 4 UNIQUE` -- the caption beside the hero count. */
export function formatUniqueCaption(uniqueCameras: number): string {
  return `CAMERAS · ${String(Math.max(0, Math.trunc(uniqueCameras)))} UNIQUE`;
}

/**
 * `5 CAMS / - MI`.
 *
 * The design prints `5 CAMS / 1.2 MI`. Nothing in this app measures the length
 * of a street: an `AlertLogEntry` deliberately carries no coordinates, so the
 * count is real and the length is an honest em dash rather than an invented
 * figure on a screen whose whole job is to be believed.
 * GAP: see docs/gaps-inbox/log.md#hottest-segment-length-is-not-measured
 */
export function formatSegmentDetail(cameraCount: number): string {
  return `${String(Math.max(0, Math.trunc(cameraCount)))} CAMS / ${NO_VALUE} MI`;
}

/**
 * `14:22:08 · 47 MPH · 380 FT` -- the second line of a timeline row.
 *
 * Speed and distance go through RADAR's formatters, not through a second set,
 * so a distance printed here and the same distance printed on the screen that
 * buzzed cannot round differently. A value the sensors never supplied prints
 * an em dash: the web reports no speed from a stationary device, and `0 MPH`
 * would be a reading this app never took.
 */
export function formatRowMeta(entry: AlertLogEntry): string {
  const clock = formatClock(entry.atMs);
  const speed = formatSpeedMph(entry.speedMph);
  const distance = formatDistanceValue(entry.distanceFt);
  return `${clock} · ${speed} MPH · ${distance} ${distanceUnit(entry.distanceFt)}`;
}

/** The row's headline: the camera's place name, or an em dash when it has none. */
export function formatRowName(entry: AlertLogEntry): string {
  return entry.label === null || entry.label === '' ? NO_VALUE : entry.label;
}
