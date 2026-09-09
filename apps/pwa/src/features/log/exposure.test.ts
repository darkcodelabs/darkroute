/**
 * The arithmetic behind `05 · LOG - EXPOSURE`, driven directly.
 *
 * Timestamps are built with the local-date constructor and bucketed with
 * `localDayStart`, so these assertions mean the same thing in every timezone
 * the app can run in. Nothing here asserts a UTC offset.
 */

import { describe, expect, it } from 'vitest';

import type { AlertLogEntry } from '../../stores';
import { NO_VALUE } from '../radar';

import {
  BAR_LEVELS,
  TREND_DAYS,
  addDays,
  barLevel,
  barRank,
  cameraEncounters,
  cameraPasses,
  dayLabel,
  formatClock,
  formatExposureTotal,
  formatRowMeta,
  formatRowName,
  formatSegmentDetail,
  formatSince,
  formatUniqueCaption,
  hottestSegment,
  isCameraPass,
  isEncounterState,
  isLogScope,
  localDayStart,
  openingLogScope,
  scopedEntries,
  sevenDayBars,
  todayExposure,
} from './exposure.ts';

/** 4 Mar 2026, 14:22:08 local -- the clock the timeline's first row renders. */
const MOMENT = new Date(2026, 2, 4, 14, 22, 8).getTime();
const TODAY = localDayStart(MOMENT);
/** Midday, so a 23- or 25-hour DST day still lands inside its own bucket. */
const MIDDAY = TODAY + 12 * 60 * 60 * 1000;

let nextId = 1;

function entry(over: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return {
    id: nextId++,
    cameraId: 'cam-1',
    label: 'Vine St & 7th',
    atMs: MOMENT,
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

/** N passes on one day, all on the same camera unless told otherwise. */
function passesOn(
  dayStartMs: number,
  count: number,
  over: Partial<AlertLogEntry> = {},
): AlertLogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    entry({ atMs: dayStartMs + 12 * 60 * 60 * 1000 + i * 1000, ...over }),
  );
}

describe('what counts as a camera pass', () => {
  it('counts the edge from a quiet state into an alerting one', () => {
    expect(isCameraPass(entry({ previousState: 'approaching', state: 'in_range' }))).toBe(true);
    expect(isCameraPass(entry({ previousState: 'clear', state: 'multiple' }))).toBe(true);
  });

  it('does not count an escalation inside an alert that is already running', () => {
    expect(isCameraPass(entry({ previousState: 'in_range', state: 'multiple' }))).toBe(false);
  });

  it('does not count dropping back to clear, or a transition with no camera', () => {
    expect(isCameraPass(entry({ previousState: 'in_range', state: 'clear' }))).toBe(false);
    expect(isCameraPass(entry({ cameraId: null, state: 'in_range' }))).toBe(false);
  });

  it('counts a muted pass exactly like an audible one', () => {
    const audible = entry({ muted: false });
    const silenced = entry({ ...audible, muted: true });
    expect(isCameraPass(silenced)).toBe(isCameraPass(audible));
    expect(cameraPasses([silenced])).toHaveLength(1);
  });
});

/**
 * A log, in the order the history slice keeps it: newest first. The arguments
 * are chronological, which is the order a drive happens in.
 */
function log(...chronological: readonly AlertLogEntry[]): readonly AlertLogEntry[] {
  return [...chronological].reverse();
}

/** One transition, as `stores/alert.ts` records it on a state change. */
function step(
  previousState: AlertLogEntry['state'],
  state: AlertLogEntry['state'],
  over: Partial<AlertLogEntry> = {},
): AlertLogEntry {
  return entry({ previousState, state, ...over });
}

describe('what draws a timeline row', () => {
  it('draws the amber approaching row the design draws, which is not a pass', () => {
    // `Reading Rd`, 760 FT against a 500 FT threshold, dot #FFC02E.
    const approach = step('clear', 'approaching', {
      atMs: MIDDAY,
      distanceFt: 760,
      label: 'Reading Rd',
    });
    const entries = log(approach, step('approaching', 'clear', { atMs: MIDDAY + 1000 }));

    const rows = cameraEncounters(entries);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('approaching');
    expect(rows[0]?.distanceFt).toBe(760);
    expect(cameraPasses(entries)).toHaveLength(0);
  });

  it('draws ONE row for an approach that became a pass, at the in-range moment', () => {
    const entries = log(
      step('clear', 'approaching', { atMs: MIDDAY, distanceFt: 760 }),
      step('approaching', 'in_range', { atMs: MIDDAY + 4000, distanceFt: 380 }),
      step('in_range', 'clear', { atMs: MIDDAY + 9000, distanceFt: 900 }),
    );

    const rows = cameraEncounters(entries);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('in_range');
    expect(rows[0]?.distanceFt).toBe(380);
  });

  it('keeps the worst state of an encounter that escalated to multiple', () => {
    const entries = log(
      step('clear', 'in_range', { atMs: MIDDAY, distanceFt: 380 }),
      step('in_range', 'multiple', { atMs: MIDDAY + 2000, distanceFt: 210 }),
      step('multiple', 'clear', { atMs: MIDDAY + 8000 }),
    );

    const rows = cameraEncounters(entries);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('multiple');
  });

  it('gives every pass its own row, even inside one unbroken alert', () => {
    // The alert sags to `approaching` and closes again: two episodes to
    // `stores/alert.ts`, so two passes, so two rows.
    const entries = log(
      step('clear', 'in_range', { atMs: MIDDAY, distanceFt: 380 }),
      step('in_range', 'approaching', { atMs: MIDDAY + 3000, distanceFt: 620 }),
      step('approaching', 'in_range', { atMs: MIDDAY + 6000, distanceFt: 340 }),
      step('in_range', 'clear', { atMs: MIDDAY + 9000 }),
    );

    expect(cameraPasses(entries)).toHaveLength(2);
    expect(cameraEncounters(entries)).toHaveLength(2);
  });

  it('is a superset of the passes: every pass row is still there', () => {
    const entries = log(
      step('clear', 'approaching', { atMs: MIDDAY, distanceFt: 900, cameraId: 'cam-a' }),
      step('approaching', 'clear', { atMs: MIDDAY + 1000, cameraId: 'cam-a' }),
      step('clear', 'in_range', { atMs: MIDDAY + 5000, cameraId: 'cam-b' }),
      step('in_range', 'clear', { atMs: MIDDAY + 6000, cameraId: 'cam-b' }),
    );

    const rows = cameraEncounters(entries);
    expect(rows).toHaveLength(2);
    for (const pass of cameraPasses(entries)) expect(rows).toContain(pass);
  });

  it('never returns a row the screen would draw in the clear hue', () => {
    const entries = log(
      step('clear', 'in_range', { atMs: MIDDAY }),
      step('in_range', 'clear', { atMs: MIDDAY + 1000 }),
    );
    for (const row of cameraEncounters(entries)) expect(isEncounterState(row.state)).toBe(true);
  });

  it('names no encounter for a transition with no camera', () => {
    const entries = log(step('clear', 'in_range', { atMs: MIDDAY, cameraId: null }));
    expect(cameraEncounters(entries)).toHaveLength(0);
  });

  it('draws a muted encounter exactly like an audible one', () => {
    const audible = log(step('clear', 'approaching', { atMs: MIDDAY, muted: false }));
    const silenced = log(step('clear', 'approaching', { atMs: MIDDAY, muted: true }));
    expect(cameraEncounters(silenced)).toHaveLength(cameraEncounters(audible).length);
  });
});

describe('FLOCKED TODAY', () => {
  it('counts today only, never the whole log', () => {
    const entries = [...passesOn(TODAY, 3), ...passesOn(addDays(TODAY, -1), 9)];
    expect(todayExposure(entries, TODAY).passes).toBe(3);
  });

  it('cannot disagree with the last of the seven bars', () => {
    const entries = [
      ...passesOn(TODAY, 4),
      ...passesOn(addDays(TODAY, -1), 2),
      ...passesOn(addDays(TODAY, -30), 6),
    ];
    const bars = sevenDayBars(entries, MOMENT);

    expect(todayExposure(entries, TODAY).passes).toBe(bars[TREND_DAYS - 1]?.passes);
  });

  it('counts distinct cameras for the CAMERAS · N UNIQUE caption', () => {
    const entries = [
      ...passesOn(TODAY, 2, { cameraId: 'cam-a' }),
      ...passesOn(TODAY, 3, { cameraId: 'cam-b' }),
      ...passesOn(addDays(TODAY, -1), 4, { cameraId: 'cam-z' }),
    ];

    expect(todayExposure(entries, TODAY)).toEqual({ passes: 5, uniqueCameras: 2 });
  });

  it('counts passes, not encounters: an approach that never closed is not a flocking', () => {
    const entries = log(
      step('clear', 'approaching', { atMs: MIDDAY, distanceFt: 760 }),
      step('approaching', 'clear', { atMs: MIDDAY + 1000 }),
    );
    expect(cameraEncounters(entries)).toHaveLength(1);
    expect(todayExposure(entries, TODAY).passes).toBe(0);
  });

  it('counts a muted pass exactly like an audible one', () => {
    expect(todayExposure(passesOn(TODAY, 3, { muted: true }), TODAY).passes).toBe(3);
  });

  it('is a real zero on a day with no cameras, not an absence', () => {
    expect(todayExposure([], TODAY)).toEqual({ passes: 0, uniqueCameras: 0 });
  });
});

describe('which scope the screen opens on', () => {
  it('opens on TRIP when a trip is running, which is the state the design draws', () => {
    expect(openingLogScope(true)).toBe('trip');
  });

  it('opens on ALL TIME when no trip is running, rather than on a scope that is empty by construction', () => {
    expect(openingLogScope(false)).toBe('all-time');
  });
});

describe('the seven-day trend', () => {
  it('ends on today and runs seven consecutive local days, oldest first', () => {
    const bars = sevenDayBars([], MOMENT);

    expect(bars).toHaveLength(TREND_DAYS);
    expect(bars[TREND_DAYS - 1]?.dayStartMs).toBe(TODAY);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]?.dayStartMs).toBe(addDays(bars[i - 1]?.dayStartMs ?? 0, 1));
    }
  });

  it('labels each bar with its own weekday', () => {
    const bars = sevenDayBars([], MOMENT);
    for (const bar of bars) expect(bar.label).toBe(dayLabel(bar.dayStartMs));
  });

  it('counts passes into the local day they happened on', () => {
    const bars = sevenDayBars([...passesOn(TODAY, 3), ...passesOn(addDays(TODAY, -2), 1)], MOMENT);

    expect(bars[TREND_DAYS - 1]?.passes).toBe(3);
    expect(bars[TREND_DAYS - 3]?.passes).toBe(1);
    expect(bars[0]?.passes).toBe(0);
  });

  it('fills the tallest day in the in-range hue and the next in the approaching hue', () => {
    const bars = sevenDayBars(
      [
        ...passesOn(TODAY, 5),
        ...passesOn(addDays(TODAY, -1), 3),
        ...passesOn(addDays(TODAY, -2), 1),
      ],
      MOMENT,
    );

    expect(bars[TREND_DAYS - 1]?.rank).toBe('peak');
    expect(bars[TREND_DAYS - 2]?.rank).toBe('second');
    expect(bars[TREND_DAYS - 3]?.rank).toBe('base');
  });

  it('marks every day that shares the top count as a peak rather than picking one', () => {
    const bars = sevenDayBars([...passesOn(TODAY, 4), ...passesOn(addDays(TODAY, -1), 4)], MOMENT);

    expect(bars[TREND_DAYS - 1]?.rank).toBe('peak');
    expect(bars[TREND_DAYS - 2]?.rank).toBe('peak');
  });

  it('scales the tallest bar to full height and never hides a day that had one', () => {
    const bars = sevenDayBars([...passesOn(TODAY, 40), ...passesOn(addDays(TODAY, -1), 1)], MOMENT);

    expect(bars[TREND_DAYS - 1]?.level).toBe(BAR_LEVELS);
    expect(bars[TREND_DAYS - 2]?.level).toBeGreaterThan(0);
  });

  it('gives an empty day level zero, which the stylesheet draws as a baseline', () => {
    expect(barLevel(0, 9)).toBe(0);
    expect(barRank(0, 0, 0)).toBe('base');
    expect(sevenDayBars([], MOMENT).every((bar) => bar.level === 0)).toBe(true);
  });

  it('ignores a pass that fell outside the window', () => {
    const bars = sevenDayBars(passesOn(addDays(TODAY, -30), 6), MOMENT);
    expect(bars.every((bar) => bar.passes === 0)).toBe(true);
  });

  it('counts muted passes into the bars', () => {
    const audible = sevenDayBars(passesOn(TODAY, 3, { muted: false }), MOMENT);
    const silenced = sevenDayBars(passesOn(TODAY, 3, { muted: true }), MOMENT);
    expect(silenced.map((bar) => bar.passes)).toEqual(audible.map((bar) => bar.passes));
    expect(silenced.map((bar) => bar.level)).toEqual(audible.map((bar) => bar.level));
  });
});

describe('the hottest segment', () => {
  it('names the place with the most passes and counts its distinct cameras', () => {
    const segment = hottestSegment([
      ...passesOn(TODAY, 2, { label: 'Reading Rd', cameraId: 'cam-a' }),
      ...passesOn(TODAY, 1, { label: 'Reading Rd', cameraId: 'cam-b' }),
      ...passesOn(TODAY, 1, { label: 'Vine St & 7th', cameraId: 'cam-c' }),
    ]);

    expect(segment?.name).toBe('Reading Rd');
    expect(segment?.passes).toBe(3);
    expect(segment?.cameraCount).toBe(2);
  });

  it('skips rows the camera record could not name rather than inventing a street', () => {
    const segment = hottestSegment([
      ...passesOn(TODAY, 5, { label: null, cameraId: 'cam-x' }),
      ...passesOn(TODAY, 1, { label: 'Reading Rd', cameraId: 'cam-a' }),
    ]);

    expect(segment?.name).toBe('Reading Rd');
  });

  it('is null when nothing in scope carries a place name', () => {
    expect(hottestSegment([])).toBeNull();
    expect(hottestSegment(passesOn(TODAY, 3, { label: null }))).toBeNull();
  });

  it('counts muted passes towards the hottest segment', () => {
    const segment = hottestSegment(passesOn(TODAY, 4, { label: 'Reading Rd', muted: true }));
    expect(segment?.passes).toBe(4);
  });
});

describe('the TRIP / ALL TIME scope', () => {
  const open = {
    startedAtMs: MIDDAY,
    endedAtMs: null,
    distanceMi: 4,
    cameraIdsPassed: [],
    exposureCount: 0,
  };

  it('gives the whole log to ALL TIME', () => {
    const entries = [entry({ atMs: MIDDAY - 1 }), entry({ atMs: MIDDAY + 1 })];
    expect(scopedEntries(entries, 'all-time', null)).toHaveLength(2);
  });

  it('gives TRIP only what happened after the trip started', () => {
    const entries = [entry({ atMs: MIDDAY + 1 }), entry({ atMs: MIDDAY - 1 })];
    expect(scopedEntries(entries, 'trip', open)).toHaveLength(1);
  });

  it('closes the TRIP window at the end of a finished trip', () => {
    const finished = { ...open, endedAtMs: MIDDAY + 10 };
    const entries = [entry({ atMs: MIDDAY + 5 }), entry({ atMs: MIDDAY + 50 })];
    expect(scopedEntries(entries, 'trip', finished)).toHaveLength(1);
  });

  it('gives TRIP nothing at all when no trip has been started', () => {
    expect(scopedEntries([entry()], 'trip', null)).toHaveLength(0);
  });

  it('recognises only the two scopes the header draws', () => {
    expect(isLogScope('trip')).toBe(true);
    expect(isLogScope('all-time')).toBe(true);
    expect(isLogScope('week')).toBe(false);
  });
});

describe('the strings the panel renders', () => {
  it('groups the all-time total the way the design prints it', () => {
    expect(formatExposureTotal(1284)).toBe('1,284');
    expect(formatExposureTotal(1000000)).toBe('1,000,000');
    expect(formatExposureTotal(999)).toBe('999');
  });

  it('prints a real zero and an em dash for a total that has not loaded', () => {
    expect(formatExposureTotal(0)).toBe('0');
    expect(formatExposureTotal(null)).toBe(NO_VALUE);
  });

  it('prints the month the record starts in', () => {
    expect(formatSince(new Date(2026, 2, 1).getTime())).toBe('SINCE MAR 2026');
    expect(formatSince(null)).toBe(NO_VALUE);
  });

  it('prints a zero-padded 24-hour clock', () => {
    expect(formatClock(MOMENT)).toBe('14:22:08');
    expect(formatClock(new Date(2026, 2, 4, 9, 4, 5).getTime())).toBe('09:04:05');
  });

  it('prints the unique-camera caption and the segment detail as drawn', () => {
    expect(formatUniqueCaption(4)).toBe('CAMERAS · 4 UNIQUE');
    expect(formatSegmentDetail(5)).toBe(`5 CAMS / ${NO_VALUE} MI`);
  });

  it('prints a timeline row exactly as the panel draws it', () => {
    expect(formatRowMeta(entry())).toBe('14:22:08 · 47 MPH · 380 FT');
  });

  it('prints an em dash rather than a zero for a reading the sensors never took', () => {
    expect(formatRowMeta(entry({ speedMph: null, distanceFt: null }))).toBe(
      `14:22:08 · ${NO_VALUE} MPH · ${NO_VALUE} FT`,
    );
    expect(formatRowName(entry({ label: null }))).toBe(NO_VALUE);
  });
});
