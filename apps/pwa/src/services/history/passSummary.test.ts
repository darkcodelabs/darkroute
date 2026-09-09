/**
 * The monitor card's middle column, driven directly.
 *
 * Every timestamp is built with the local-date constructor and every day is
 * bucketed with `localDayStart`, so these assertions mean the same thing in
 * whatever timezone the machine running them happens to be in. Nothing here
 * asserts a UTC offset -- except the one case that is ABOUT the offset, which
 * pins the timezone itself and says so.
 *
 * The rows are full `AlertLogEntry` values rather than the narrower `PassRow`
 * the module accepts, because the card hands over the history slice's own array
 * and the tests should fail if that stops being assignable.
 */

import { describe, expect, it, vi } from 'vitest';

import type { AlertLogEntry } from '../../stores/history.ts';

import {
  DEFAULT_RECENT_LIMIT,
  WEEK_BUCKETS,
  byDay,
  hottest,
  isPass,
  localDayStart,
  passes,
  recent,
  relativeAgo,
  summarizePasses,
  type CameraLookup,
} from './passSummary.ts';

/** 4 Mar 2026, 14:22:08 local -- the clock the LOG's first row renders. */
const MOMENT = new Date(2026, 2, 4, 14, 22, 8).getTime();
const TODAY = localDayStart(MOMENT);
/** Midday, so a 23- or 25-hour day still lands inside its own bucket. */
const MIDDAY = TODAY + 12 * 60 * 60 * 1000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let nextId = 1;

function entry(over: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return {
    id: nextId++,
    cameraId: 'cam-1',
    label: 'W 111TH ST at COLLEGE BLVD',
    atMs: MIDDAY,
    state: 'in_range',
    previousState: 'clear',
    distanceFt: 380,
    speedMph: 47,
    headingDeg: 41,
    muted: false,
    outcome: null,
    ...over,
  };
}

/** The log in the order the history slice keeps it: newest first. */
function log(...chronological: readonly AlertLogEntry[]): readonly AlertLogEntry[] {
  return [...chronological].reverse();
}

/** One pass, at a given moment, by a given camera. */
function pass(atMs: number, over: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return entry({ atMs, previousState: 'clear', state: 'in_range', ...over });
}

/** A camera archive that knows about everything it is asked. */
const knowsEverything: CameraLookup = (cameraId) => ({
  label: `${cameraId.toUpperCase()} ST at COLLEGE BLVD`,
  operator: 'FLOCK SAFETY',
});

/** A camera archive whose tiles have all been evicted. */
const knowsNothing: CameraLookup = () => null;

describe('what counts as a pass', () => {
  it('counts the moment a camera came into range', () => {
    expect(isPass(entry({ previousState: 'clear', state: 'in_range' }))).toBe(true);
    expect(isPass(entry({ previousState: 'approaching', state: 'multiple' }))).toBe(true);
  });

  it('does not count an escalation inside an alert that was already running', () => {
    expect(isPass(entry({ previousState: 'in_range', state: 'multiple' }))).toBe(false);
  });

  it('does not count an approach that never got close enough to read a plate', () => {
    expect(isPass(entry({ previousState: 'clear', state: 'approaching' }))).toBe(false);
  });

  it('does not count the drive back out of range', () => {
    expect(isPass(entry({ previousState: 'in_range', state: 'clear' }))).toBe(false);
  });

  it('does not count a transition with no camera to be about', () => {
    expect(isPass(entry({ cameraId: null }))).toBe(false);
  });

  it('counts a muted pass exactly like an audible one', () => {
    const audible = pass(MIDDAY, { muted: false });
    const silenced = entry({ ...audible, muted: true });
    expect(isPass(silenced)).toBe(isPass(audible));
    expect(passes([silenced])).toHaveLength(1);
  });

  it('counts one drive past one camera once, not once per log row', () => {
    const drive = log(
      entry({ atMs: MIDDAY, previousState: 'clear', state: 'approaching' }),
      entry({ atMs: MIDDAY + 4000, previousState: 'approaching', state: 'in_range' }),
      entry({ atMs: MIDDAY + 9000, previousState: 'in_range', state: 'clear' }),
    );
    expect(passes(drive)).toHaveLength(1);
  });
});

describe('the seven-day chart', () => {
  it('draws seven days, oldest first, ending on today', () => {
    const bars = byDay([], MOMENT);

    expect(bars).toHaveLength(WEEK_BUCKETS);
    expect(bars[0]?.dayStartMs).toBeLessThan(bars[WEEK_BUCKETS - 1]?.dayStartMs ?? 0);
    expect(bars[WEEK_BUCKETS - 1]?.dayStartMs).toBe(TODAY);
  });

  it('labels each day with its own weekday', () => {
    // 4 Mar 2026 is a Wednesday, so the week behind it reads THU..WED.
    expect(byDay([], MOMENT).map((bar) => bar.label)).toEqual([
      'THU',
      'FRI',
      'SAT',
      'SUN',
      'MON',
      'TUE',
      'WED',
    ]);
  });

  it('counts each pass on the local day it happened', () => {
    const entries = log(
      pass(MIDDAY - 2 * DAY),
      pass(MIDDAY),
      pass(MIDDAY + 60_000),
      pass(MIDDAY + 120_000),
    );

    const bars = byDay(entries, MOMENT);

    expect(bars[WEEK_BUCKETS - 1]?.count).toBe(3);
    expect(bars[WEEK_BUCKETS - 3]?.count).toBe(1);
  });

  it('keeps a day with no passes on the chart at zero rather than dropping it', () => {
    const bars = byDay(log(pass(MIDDAY)), MOMENT);

    expect(bars).toHaveLength(WEEK_BUCKETS);
    expect(bars.filter((bar) => bar.count === 0)).toHaveLength(WEEK_BUCKETS - 1);
  });

  it('leaves a pass older than the week off the chart instead of in the first bar', () => {
    const bars = byDay(log(pass(MIDDAY - 9 * DAY), pass(MIDDAY)), MOMENT);

    expect(bars[0]?.count).toBe(0);
    expect(bars.reduce((total, bar) => total + bar.count, 0)).toBe(1);
  });

  it('ignores the transitions that are not passes', () => {
    const entries = log(
      entry({ atMs: MIDDAY, previousState: 'clear', state: 'approaching' }),
      entry({ atMs: MIDDAY + 1000, previousState: 'approaching', state: 'clear' }),
    );

    expect(byDay(entries, MOMENT).reduce((total, bar) => total + bar.count, 0)).toBe(0);
  });

  it('still files a pass under its own day on the morning the clocks change', () => {
    // The one timezone-dependent test in the file, and it has to be: a 23-hour
    // day only exists somewhere that observes one. US Central springs forward
    // on 8 Mar 2026, so a week ending Monday the 9th contains it. Building the
    // buckets by adding 86_400_000 puts every boundary before the change an
    // hour out, and this Sunday pass falls through the gaps entirely.
    vi.stubEnv('TZ', 'America/Chicago');
    // Proof the runtime honored the stub. Without it the rest of this test
    // would pass on a UTC machine while proving nothing.
    expect(new Date(2026, 2, 8, 12).getTimezoneOffset()).toBe(300);

    const springForward = new Date(2026, 2, 8, 12, 0, 0).getTime();
    const monday = new Date(2026, 2, 9, 12, 0, 0).getTime();

    const bars = byDay(log(pass(springForward)), monday);

    expect(bars.map((bar) => bar.label)).toEqual(['TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON']);
    expect(bars.find((bar) => bar.label === 'SUN')?.count).toBe(1);
    // Every bar starts at a local midnight, in both offsets the week spans.
    for (const bar of bars) expect(new Date(bar.dayStartMs).getHours()).toBe(0);
  });
});

describe('the hottest camera', () => {
  it('names the camera passed most often and says how many times', () => {
    const entries = log(
      pass(MIDDAY, { cameraId: 'cam-a' }),
      pass(MIDDAY + 1000, { cameraId: 'cam-b' }),
      pass(MIDDAY + 2000, { cameraId: 'cam-a' }),
    );

    const hot = hottest(entries, knowsEverything);

    expect(hot?.cameraId).toBe('cam-a');
    expect(hot?.count).toBe(2);
    expect(hot?.repeated).toBe(true);
  });

  it('says nothing repeated yet when every camera has been passed exactly once', () => {
    const entries = log(
      pass(MIDDAY, { cameraId: 'cam-a' }),
      pass(MIDDAY + 1000, { cameraId: 'cam-b' }),
    );

    const hot = hottest(entries, knowsEverything);

    expect(hot?.count).toBe(1);
    expect(hot?.repeated).toBe(false);
  });

  it('has nothing to report when no camera has been passed', () => {
    const approachOnly = log(entry({ previousState: 'clear', state: 'approaching' }));

    expect(hottest([], knowsEverything)).toBeNull();
    expect(hottest(approachOnly, knowsEverything)).toBeNull();
  });

  it('prefers the camera record name over the one the log wrote down', () => {
    const entries = log(pass(MIDDAY, { cameraId: 'cam-a', label: 'an older name' }));

    expect(hottest(entries, knowsEverything)?.label).toBe('CAM-A ST at COLLEGE BLVD');
  });

  it('falls back to the logged name when the camera record is no longer in memory', () => {
    const entries = log(pass(MIDDAY, { label: 'W 111TH ST at COLLEGE BLVD' }));

    expect(hottest(entries, knowsNothing)?.label).toBe('W 111TH ST at COLLEGE BLVD');
  });

  it('has no name rather than a made-up one when nothing can name the camera', () => {
    expect(hottest(log(pass(MIDDAY, { label: null })), knowsNothing)?.label).toBeNull();
    expect(hottest(log(pass(MIDDAY, { label: '  ' })), knowsNothing)?.label).toBeNull();
  });

  it('keeps a name an earlier pass recorded when the newest one resolved nothing', () => {
    const entries = log(
      pass(MIDDAY, { cameraId: 'cam-a', label: 'W 111TH ST at COLLEGE BLVD' }),
      pass(MIDDAY + 1000, { cameraId: 'cam-a', label: null }),
    );

    expect(hottest(entries, knowsNothing)?.label).toBe('W 111TH ST at COLLEGE BLVD');
  });

  it('gives a tie to the camera passed most recently', () => {
    const entries = log(
      pass(MIDDAY, { cameraId: 'cam-old' }),
      pass(MIDDAY + 1000, { cameraId: 'cam-old' }),
      pass(MIDDAY + 2000, { cameraId: 'cam-new' }),
      pass(MIDDAY + 3000, { cameraId: 'cam-new' }),
    );

    expect(hottest(entries, knowsEverything)?.cameraId).toBe('cam-new');
  });
});

describe('how long ago a pass was', () => {
  it('says just now until a whole minute has gone by', () => {
    expect(relativeAgo(MOMENT - 59_000, MOMENT)).toBe('just now');
  });

  it('starts counting minutes at exactly one minute', () => {
    expect(relativeAgo(MOMENT - MINUTE, MOMENT)).toBe('1 min ago');
    expect(relativeAgo(MOMENT - 2 * MINUTE, MOMENT)).toBe('2 min ago');
  });

  it('counts minutes up to the last one before the hour', () => {
    expect(relativeAgo(MOMENT - 59 * MINUTE, MOMENT)).toBe('59 min ago');
  });

  it('starts counting hours at exactly one hour', () => {
    expect(relativeAgo(MOMENT - HOUR, MOMENT)).toBe('1 hr ago');
  });

  it('counts hours up to the last one before the day', () => {
    expect(relativeAgo(MOMENT - 23 * HOUR, MOMENT)).toBe('23 hr ago');
  });

  it('starts counting days at exactly twenty-four hours', () => {
    expect(relativeAgo(MOMENT - DAY, MOMENT)).toBe('1 day ago');
    expect(relativeAgo(MOMENT - 3 * DAY, MOMENT)).toBe('3 days ago');
  });

  it('rounds down, so a row never claims to be older than it is', () => {
    expect(relativeAgo(MOMENT - (2 * MINUTE + 59_000), MOMENT)).toBe('2 min ago');
  });

  it('says just now for a row stamped after the clock it is being read against', () => {
    expect(relativeAgo(MOMENT + 5 * MINUTE, MOMENT)).toBe('just now');
  });
});

describe('the recent list', () => {
  it('gives the newest passes first, no more than the limit asked for', () => {
    const entries = log(
      pass(MOMENT - 3 * DAY, { cameraId: 'cam-a' }),
      pass(MOMENT - HOUR, { cameraId: 'cam-b' }),
      pass(MOMENT - 2 * MINUTE, { cameraId: 'cam-c' }),
    );

    const rows = recent(entries, MOMENT, 2, knowsEverything);

    expect(rows.map((row) => row.cameraId)).toEqual(['cam-c', 'cam-b']);
    expect(rows.map((row) => row.ago)).toEqual(['2 min ago', '1 hr ago']);
  });

  it('leaves out the transitions the chart above it does not count either', () => {
    const entries = log(
      entry({ atMs: MOMENT - HOUR, previousState: 'clear', state: 'approaching' }),
      pass(MOMENT - MINUTE),
    );

    expect(recent(entries, MOMENT, 5, knowsEverything)).toHaveLength(1);
  });

  it('says who operates the camera', () => {
    const rows = recent(log(pass(MOMENT - MINUTE)), MOMENT, 5, knowsEverything);

    expect(rows[0]?.operator).toBe('FLOCK SAFETY');
  });

  it('leaves the operator out rather than guessing when nobody has attributed it', () => {
    const unattributed: CameraLookup = () => ({ label: 'METCALF AVE at W 111TH ST', operator: '' });

    expect(recent(log(pass(MOMENT)), MOMENT, 5, unattributed)[0]?.operator).toBeNull();
    expect(recent(log(pass(MOMENT)), MOMENT, 5, knowsNothing)[0]?.operator).toBeNull();
  });

  it('returns nothing when there is no room for a row', () => {
    expect(recent(log(pass(MOMENT)), MOMENT, 0, knowsEverything)).toHaveLength(0);
  });

  it('has no rows to show before the first camera has been passed', () => {
    expect(recent([], MOMENT, DEFAULT_RECENT_LIMIT, knowsEverything)).toHaveLength(0);
  });
});

describe('the summary the card renders', () => {
  const entries = log(
    pass(MIDDAY, { cameraId: 'cam-a' }),
    pass(MOMENT - MINUTE, { cameraId: 'cam-a' }),
  );

  // The state the card is in on a cold start, before a fix has landed and
  // before the durable count has come back from IndexedDB -- which is the
  // first thing a driver sees and was the one case nothing here drove.
  it('draws an empty chart and no camera at all before the first pass', () => {
    const summary = summarizePasses({
      entries: [],
      nowMs: MOMENT,
      allTimePasses: null,
      lookup: knowsEverything,
    });

    expect(summary.byDay).toHaveLength(WEEK_BUCKETS);
    expect(summary.byDay.every((bar) => bar.count === 0)).toBe(true);
    expect(summary.hottest).toBeNull();
    expect(summary.recent).toHaveLength(0);
    expect(summary.allTimePasses).toBeNull();
  });

  it('passes the all-time count through untouched', () => {
    const summary = summarizePasses({
      entries,
      nowMs: MOMENT,
      allTimePasses: 87,
      lookup: knowsEverything,
    });

    expect(summary.allTimePasses).toBe(87);
  });

  it('says the all-time count is absent, not zero, until the durable copy loads', () => {
    const summary = summarizePasses({
      entries,
      nowMs: MOMENT,
      allTimePasses: null,
      lookup: knowsEverything,
    });

    expect(summary.allTimePasses).toBeNull();
  });

  it('fills the chart, the hottest tile and the recent list from one call', () => {
    const summary = summarizePasses({
      entries,
      nowMs: MOMENT,
      allTimePasses: 87,
      lookup: knowsEverything,
    });

    expect(summary.byDay).toHaveLength(WEEK_BUCKETS);
    expect(summary.hottest?.count).toBe(2);
    expect(summary.recent.map((row) => row.ago)).toEqual(['1 min ago', '2 hr ago']);
  });

  it('draws the five recent rows the card has room for unless told otherwise', () => {
    const busy = log(...Array.from({ length: 9 }, (_, i) => pass(MOMENT - (9 - i) * MINUTE)));

    const summary = summarizePasses({
      entries: busy,
      nowMs: MOMENT,
      allTimePasses: 87,
      lookup: knowsEverything,
    });

    expect(summary.recent).toHaveLength(DEFAULT_RECENT_LIMIT);
    expect(recent(busy, MOMENT, 9, knowsEverything)).toHaveLength(9);
  });
});
