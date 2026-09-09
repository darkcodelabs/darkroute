/**
 * PASS SUMMARY - the four numbers on the monitor card's middle column, derived
 * once, from the record the app already keeps.
 * =============================================================================
 * The column draws an all-time total, a seven-bar week, a HOTTEST tile and a
 * RECENT list. Every one of them is a reading of the same rows, so they are
 * derived together here and the card renders what it is handed. Arithmetic done
 * inside a card is arithmetic that can disagree with the tile beside it about
 * the same day - `features/log/exposure.ts` says so at length about the two
 * counts on the LOG screen, and this module exists so the monitor card never
 * gets its own third answer.
 *
 * =============================================================================
 * NOTHING HERE LEAVES THE DEVICE OR IS WRITTEN DOWN
 * =============================================================================
 * This is a read over local history and nothing else. No fetch, no URL, no
 * storage, no console. The summary is computed for a render and thrown away.
 *
 * An `AlertLogEntry` deliberately carries no latitude: "a coordinate history IS
 * a movement history" (`stores/history.ts`). A SUMMARY of that history must not
 * reintroduce one, so this module reads five fields off a row - the camera id,
 * the logged place name, the clock and the two states - and cannot see a
 * coordinate even if one were added later. {@link PassRow} is that promise
 * written as a type: widening it is the change a reviewer should stop.
 *
 * =============================================================================
 * WHAT COUNTS AS A PASS, AND WHY IT IS NOT A ROW
 * =============================================================================
 * The log is a stream of state CHANGES. One drive past one camera writes
 * several rows - `clear -> approaching`, `approaching -> in_range`, then
 * `in_range -> clear` on the way out - so counting rows would report a single
 * camera three times and a busy corridor as a number nobody could reconcile
 * with the road.
 *
 * A PASS is the edge `stores/alert.ts` counts in EXPOSURE: a NON-ALERTING state
 * becoming an ALERTING one, about a camera. That file calls
 * `historyActions.notePass()` in exactly two places and both are that edge -
 * the per-camera loop, which records `clear -> in_range` for each camera that
 * newly came into range, and the screen-state branch, which counts a new
 * episode. `isAlertingState` there is `in_range || multiple`, which is why
 * {@link isAlerting} below is the same two states and not three.
 *
 * BEING NEAR A CAMERA IS NOT BEING FLOCKED. An encounter that only ever reached
 * `approaching` never read a plate and is not in any count on this card.
 *
 * MUTED PASSES COUNT. The word `muted` does not appear in a predicate below and
 * is not even in {@link PassRow}: "Muting only removes the alert - never the
 * record" (Screens II, B4 · ALERT TRIAGE).
 *
 * =============================================================================
 * WHY THIS FILE DUPLICATES A LITTLE OF features/log/exposure.ts
 * =============================================================================
 * `isCameraPass`, `localDayStart` and `addDays` exist there too, and this is a
 * deliberate copy rather than an import: `exposure.ts` is a FEATURE module that
 * imports the store barrel at runtime, and a service that reaches up into a
 * feature would drag zustand and eleven slices into a module whose whole point
 * is that it is pure. The two must agree on what a pass is, and both name
 * `stores/alert.ts` as the source of that answer, so a change to the edge is a
 * change to three files - which is the cost of the layering, stated out loud
 * rather than discovered later.
 */

import type { AlertLogEntry } from '../../stores/history.ts';

// ---------------------------------------------------------------------------
// What this module is allowed to see
// ---------------------------------------------------------------------------

/**
 * The fields of an `AlertLogEntry` this summary reads, and no others.
 *
 * A `Pick` rather than a hand-written shape, so a rename in the history slice
 * breaks this file at compile time instead of silently reading `undefined`.
 * A full `AlertLogEntry[]` is assignable to `PassRow[]`, so the card passes the
 * store's own array straight in.
 *
 * The import it is picked from is the only import in this module and it is
 * `import type`, which `verbatimModuleSyntax` erases outright: no zustand, no
 * store, nothing to mock. This file is a function of its arguments, and the one
 * way to keep that true is for the compiler to be the only thing that ever
 * reads that path.
 */
export type PassRow = Pick<
  AlertLogEntry,
  'cameraId' | 'label' | 'atMs' | 'state' | 'previousState'
>;

/** The alert states, named off the row rather than imported from the engine. */
type PassState = PassRow['state'];

/** A row that survived {@link isPass}: its camera id is known to be there. */
export type CameraPass = PassRow & { readonly cameraId: string };

/**
 * What the card can tell you about a camera id.
 *
 * INJECTED, NOT IMPORTED. The place name and the operator live on the CAMERA
 * record, not on the log row, and reaching into the cameras store from here
 * would make this module unrenderable in a test and untestable without a store.
 * The card already holds those records; it passes a reader in, and this file
 * stays a function of its arguments.
 *
 * Returning null is normal, not exceptional: tiles are evicted, and the record
 * for a camera passed three days ago may simply not be in memory now.
 */
export interface CameraFacts {
  readonly label: string;
  readonly operator: string;
  /** The town, from the record's release context; absent on an old record. */
  readonly where?: string;
}

export type CameraLookup = (cameraId: string) => CameraFacts | null;

// ---------------------------------------------------------------------------
// The pass edge
// ---------------------------------------------------------------------------

/** The two states that mean a plate could have been read. See the header. */
function isAlerting(state: PassState): boolean {
  return state === 'in_range' || state === 'multiple';
}

/**
 * One camera pass - the same edge `stores/alert.ts` counts in EXPOSURE.
 *
 * A type predicate so the callers below get the non-null camera id for free
 * rather than re-asserting it: every count here is keyed by that id, and a
 * second null check would be a second place to get the rule wrong.
 */
export function isPass(row: PassRow): row is CameraPass {
  return row.cameraId !== null && isAlerting(row.state) && !isAlerting(row.previousState);
}

/** Passes only, in the order given - which the store keeps newest first. */
export function passes(entries: readonly PassRow[]): readonly CameraPass[] {
  return entries.filter(isPass);
}

// ---------------------------------------------------------------------------
// Local days
// ---------------------------------------------------------------------------

/** The axis labels, indexed by `Date.getDay()`. */
export const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

export type WeekdayLabel = (typeof WEEKDAY_LABELS)[number];

/** Seven bars, SUN..SAT on the reference render. */
export const WEEK_BUCKETS = 7;

/** Local midnight for an instant. The caller owns the clock; this owns the day. */
export function localDayStart(atMs: number): number {
  const date = new Date(atMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Local midnight `delta` days from `dayStartMs`.
 *
 * WALKED WITH `setDate`, NEVER BY ADDING 86_400_000. A day is 23 hours the
 * morning the clocks go forward and 25 the morning they go back, so a fixed
 * stride lands at 01:00 or 23:00 instead of on midnight and slides every
 * earlier bucket by an hour. The visible damage is quiet and twice a year: the
 * passes either side of a bucket boundary get filed under the neighbouring day,
 * so a driver's Sunday bar borrows from their Saturday and nothing about the
 * card looks wrong. `setDate` asks the calendar instead of the arithmetic, and
 * the second `setHours` re-anchors the answer to midnight in whichever offset
 * the new day ended up in.
 */
export function addDays(dayStartMs: number, delta: number): number {
  const date = new Date(dayStartMs);
  date.setDate(date.getDate() + delta);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** `SUN`..`SAT` for a day. `getDay()` is 0..6, so the fallback cannot fire. */
export function weekdayLabel(dayStartMs: number): WeekdayLabel {
  return WEEKDAY_LABELS[new Date(dayStartMs).getDay()] ?? 'SUN';
}

// ---------------------------------------------------------------------------
// The seven bars
// ---------------------------------------------------------------------------

export interface DayBucket {
  /** Local midnight the bucket starts at. */
  readonly dayStartMs: number;
  readonly label: WeekdayLabel;
  readonly count: number;
}

/**
 * Seven buckets, OLDEST FIRST, ending on the day `nowMs` falls in.
 *
 * Today is the last bucket because the render draws the last bar tallest and
 * darkest - it is the bar the driver is adding to right now, and a week that
 * ended yesterday would put their current drive off the end of the chart.
 *
 * A ROLLING WINDOW, not a calendar week. On a Saturday it prints exactly the
 * SUN..SAT axis the reference render draws, and on a Tuesday it still answers
 * "the last seven days", which is the question the panel is asking.
 *
 * Passes older than the window are dropped rather than folded into the first
 * bucket: a bar labelled SUN must mean that Sunday and not "Sunday and
 * everything before it".
 */
export function byDay(entries: readonly PassRow[], nowMs: number): readonly DayBucket[] {
  const today = localDayStart(nowMs);
  const starts: number[] = [];
  for (let back = WEEK_BUCKETS - 1; back >= 0; back--) starts.push(addDays(today, -back));

  const slotOf = new Map(starts.map((start, index) => [start, index]));
  const counts = starts.map(() => 0);
  for (const pass of passes(entries)) {
    const slot = slotOf.get(localDayStart(pass.atMs));
    if (slot === undefined) continue;
    counts[slot] = (counts[slot] ?? 0) + 1;
  }

  return starts.map((dayStartMs, index) => ({
    dayStartMs,
    label: weekdayLabel(dayStartMs),
    count: counts[index] ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// HOTTEST
// ---------------------------------------------------------------------------

export interface HottestCamera {
  readonly cameraId: string;
  /** The camera record's place name, or null when nothing can name it. */
  readonly label: string | null;
  readonly count: number;
  /**
   * False when the leader has been passed exactly once, which means every
   * camera has: there is a busiest row but no PATTERN yet, and the tile says
   * "nothing repeated yet" rather than crowning a camera the driver drove past
   * once. The count and the name are still returned, so the tile can show what
   * it does know while being honest about what it does not.
   */
  readonly repeated: boolean;
}

/**
 * The camera passed most often, or null when nothing has been passed at all.
 *
 * TIES GO TO THE MOST RECENT. `entries` is newest first, a `Map` iterates in
 * insertion order, and the comparison below is a strict `>` - so of two cameras
 * on three passes each, the leader is the one whose most recent pass is newer.
 * The alternative is a tile that flickers between two equal streets on every
 * render, and "the one you have been past most, most recently" is the reading a
 * driver would give the word HOTTEST anyway.
 */
export function hottest(entries: readonly PassRow[], lookup: CameraLookup): HottestCamera | null {
  const counts = new Map<string, number>();
  const loggedLabels = new Map<string, string | null>();

  for (const pass of passes(entries)) {
    counts.set(pass.cameraId, (counts.get(pass.cameraId) ?? 0) + 1);
    // The newest row that actually CARRIED a name wins, not simply the newest
    // row. A row's `label` is null whenever the alert loop could not resolve
    // the camera record at that instant, which is a gap in what was written
    // down rather than the app being told the camera has no name. Keying on
    // `has()` let one unresolved pass bury a street an earlier pass had
    // recorded, and the tile went blank for a camera the log could still name.
    // HOTTEST may reach across rows like this because it is an aggregate over
    // every pass at this camera; a RECENT row keeps its own snapshot, because
    // that row is about one moment and must not borrow a name from another.
    if ((loggedLabels.get(pass.cameraId) ?? null) === null) {
      loggedLabels.set(pass.cameraId, nonEmpty(pass.label));
    }
  }

  let cameraId: string | null = null;
  let count = 0;
  for (const [candidate, candidateCount] of counts) {
    if (candidateCount <= count) continue;
    cameraId = candidate;
    count = candidateCount;
  }
  if (cameraId === null) return null;

  return {
    cameraId,
    label: nameFor(lookup(cameraId), loggedLabels.get(cameraId) ?? null),
    count,
    repeated: count > 1,
  };
}

// ---------------------------------------------------------------------------
// RECENT
// ---------------------------------------------------------------------------

/** The design's five rows. */
export const DEFAULT_RECENT_LIMIT = 5;

export interface RecentPass {
  readonly atMs: number;
  /** "2 min ago" / "1 hr ago" / "3 days ago". See {@link relativeAgo}. */
  readonly ago: string;
  readonly label: string | null;
  /** "FLOCK SAFETY", or null - see {@link operatorFor}. */
  readonly operator: string | null;
  /** The town the camera is in, or null when the record did not say. */
  readonly where: string | null;
  readonly cameraId: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How long ago, in the card's own words.
 *
 * ELAPSED TIME, AND HERE A FIXED DAY IS THE RIGHT ANSWER - the opposite call
 * from {@link addDays}, for a reason worth writing down. That function buckets
 * CALENDAR days, where a DST day really is 23 or 25 hours long. This one
 * measures a DURATION, and a driver who passed a camera 24 hours ago passed it
 * "1 day ago" whether or not the clocks moved in between.
 *
 * Rounded DOWN at every step, so a row never claims to be older than it is.
 *
 * A row stamped in the future is clamped to "just now" rather than rendered as
 * a negative age: fixes arrive with the device's clock, an NTP correction can
 * move that clock backwards mid-drive, and "-3 min ago" is a bug report about
 * the log rather than about the clock.
 */
export function relativeAgo(atMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - atMs);
  if (elapsedMs < MINUTE_MS) return 'just now';
  if (elapsedMs < HOUR_MS) return `${String(Math.floor(elapsedMs / MINUTE_MS))} min ago`;
  if (elapsedMs < DAY_MS) return `${String(Math.floor(elapsedMs / HOUR_MS))} hr ago`;
  const days = Math.floor(elapsedMs / DAY_MS);
  return `${String(days)} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * The newest `limit` passes, ready to render.
 *
 * Passes, not rows, so the list matches the number above it: a RECENT list that
 * drew every transition would show three lines for the camera the big number
 * counted once.
 *
 * Relies on `entries` being newest first, which both sources guarantee - the
 * history slice prepends, and `repositories/alerts.ts` reverses on the way out
 * of IndexedDB. Nothing is re-sorted here, so a caller that hands over a
 * shuffled array gets a shuffled list rather than a silently corrected one.
 */
export function recent(
  entries: readonly PassRow[],
  nowMs: number,
  limit: number,
  lookup: CameraLookup,
): readonly RecentPass[] {
  if (limit <= 0) return NO_RECENT;
  const rows: RecentPass[] = [];
  for (const pass of passes(entries)) {
    if (rows.length >= limit) break;
    const facts = lookup(pass.cameraId);
    rows.push({
      atMs: pass.atMs,
      ago: relativeAgo(pass.atMs, nowMs),
      label: nameFor(facts, pass.label),
      operator: operatorFor(facts?.operator ?? null),
      where: facts?.where === undefined || facts.where === '' ? null : facts.where,
      cameraId: pass.cameraId,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The whole column, in one call
// ---------------------------------------------------------------------------

export interface PassSummaryInput {
  /** Newest first, as the history slice keeps them. */
  readonly entries: readonly PassRow[];
  readonly nowMs: number;
  /**
   * `history.allTimePasses`, passed straight through.
   *
   * NULL IS NOT ZERO and this file will not turn one into the other. The
   * durable count lives in IndexedDB and is null until `hydrate()` lands, so a
   * zero here would tell a driver with 1,284 recorded passes that they had
   * never been read - most visibly in the second or two after a cold start.
   * The card renders the absence; only the store can end it.
   */
  readonly allTimePasses: number | null;
  readonly lookup: CameraLookup;
  /** Defaults to {@link DEFAULT_RECENT_LIMIT}. */
  readonly limit?: number;
}

export interface PassSummary {
  readonly allTimePasses: number | null;
  readonly byDay: readonly DayBucket[];
  readonly hottest: HottestCamera | null;
  readonly recent: readonly RecentPass[];
}

/**
 * Everything the middle column shows, from one call.
 *
 * THREE READS OF THE SAME ARRAY, NOT ONE. `byDay`, `hottest` and `recent` each
 * apply {@link isPass} themselves rather than trusting a caller to have done
 * it, because each of them is also called on its own and a helper that counted
 * whatever it was handed would be a helper that silently miscounts the day it
 * is used alone. `entries` is capped by the history slice, so paying for the
 * rule three times is cheaper than having it live in one place and be assumed
 * in three.
 */
export function summarizePasses(input: PassSummaryInput): PassSummary {
  return {
    allTimePasses: input.allTimePasses,
    byDay: byDay(input.entries, input.nowMs),
    hottest: hottest(input.entries, input.lookup),
    recent: recent(input.entries, input.nowMs, input.limit ?? DEFAULT_RECENT_LIMIT, input.lookup),
  };
}

// ---------------------------------------------------------------------------
// Naming, and refusing to invent one
// ---------------------------------------------------------------------------

const NO_RECENT: readonly RecentPass[] = Object.freeze([]);

/** Blank and whitespace-only are absences, not names. */
function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * The camera record's name first, the logged one second, null last.
 *
 * The record is the source of truth - it is where the name came from, and it is
 * the copy that gets corrected. The row's own `label` is a snapshot the alert
 * loop wrote at the moment of the pass, and it is the only name left once the
 * tile holding that camera has been evicted, which is the ordinary state of a
 * camera passed three days ago.
 *
 * Null rather than a placeholder. "UNKNOWN" in a street column is a fabricated
 * street; the card draws its own absence and the driver can tell the difference.
 */
function nameFor(facts: CameraFacts | null, logged: string | null): string | null {
  return nonEmpty(facts?.label ?? null) ?? nonEmpty(logged);
}

/**
 * The operator, when there is one.
 *
 * `operator` is an OSM tag and `services/db/schema.ts` measures it at 17.69% of
 * records, so a missing operator is the common case rather than a data fault.
 * It comes back null and the row simply has no operator on it - printing
 * "FLOCK SAFETY" beside a camera nobody has attributed would be this app
 * inventing the one fact a driver would most reasonably act on.
 */
function operatorFor(operator: string | null): string | null {
  return nonEmpty(operator);
}
