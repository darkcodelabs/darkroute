/**
 * EXPOSURE HAS TWO STATES, AND THE EMPTY ONE IS THE REASON THIS FILE EXISTS.
 *
 * =============================================================================
 * THE DEFECT
 * =============================================================================
 * The screen had one layout and drew it whatever it knew. On a phone that had
 * never seen a camera that produced a 46px `0`, five em dashes and three
 * hundred pixels of nothing - the populated screen with every value missing.
 *
 * A ZERO IS A NUMBER. Telling somebody they were read zero times is a
 * measurement, and the app had not taken one; the honest statement is that
 * nothing has been recorded. Brief 4 replaces the layout rather than the
 * copy, and the first half of this file holds that replacement in place: no
 * figure, no dash, a sentence, a flat axis and one action.
 *
 * =============================================================================
 * AND THE ARITHMETIC UNDERNEATH IT, WHICH WAS ALSO WRONG
 * =============================================================================
 * The second half is the reason adopting `services/history/passSummary.ts` was
 * a correctness fix and not a tidy-up. The alert log is a stream of state
 * CHANGES: one drive past one camera writes `clear -> approaching`,
 * `approaching -> in_range` and `in_range -> clear`. This screen's own week memo
 * counted ROWS, so it drew three for that one pass, and the hero figure above
 * it - which comes from `today.passes` and counts the EDGE - drew one. Two
 * numbers about the same drive, on the same screen, disagreeing by 3x.
 *
 * The fixture below is exactly that drive, and the assertions are that the
 * chart and the tile now agree with the figure. It is written as three rows on
 * purpose: a fixture of one row per pass would pass against the old code too
 * and prove nothing.
 */

import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useCamerasStore } from '../../stores/cameras.ts';
import { useHistoryStore, historyActions } from '../../stores/history.ts';
import type { AlertLogEntry } from '../../stores/history.ts';
import type { CameraRecord } from '../../services/db/schema.ts';

import {
  ALL_TIME_KICKER,
  EMPTY_ACTION,
  EMPTY_BODY,
  EMPTY_LEARN,
  EMPTY_TITLE,
  ExposureScreen,
  HOTTEST_KICKER,
  NOTHING_REPEATED,
  NO_VALUE,
  barPercent,
  barTier,
} from './ExposureScreen.tsx';

const METCALF: CameraRecord = {
  id: 'osm:metcalf-119',
  lat: 38.91,
  lon: -94.67,
  directionDeg: 180,
  ownerType: 'police',
  street: 'METCALF AVE',
  cross: '119TH ST',
};

function putArchive(): void {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras: [METCALF],
      fetchedAtMs: 1_700_000_000_000,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
}

/**
 * ONE DRIVE PAST ONE CAMERA, as the alert engine actually writes it.
 *
 * Three rows, one pass. `isPass` in `passSummary.ts` is the middle one alone -
 * a non-alerting state becoming an alerting one, about a camera - and the two
 * either side of it are the approach and the departure. Being NEAR a camera is
 * not being flocked, so `clear -> approaching` never read a plate and is in no
 * count on this screen.
 *
 * Newest first, which is the order the history slice keeps and the order
 * `recent` relies on.
 */
function onePassAt(atMs: number): readonly AlertLogEntry[] {
  const row = (
    id: number,
    previousState: AlertLogEntry['previousState'],
    state: AlertLogEntry['state'],
    offsetMs: number,
  ): AlertLogEntry => ({
    id,
    cameraId: METCALF.id,
    label: 'METCALF AVE & 119TH ST',
    atMs: atMs + offsetMs,
    state,
    previousState,
    distanceFt: 420,
    speedMph: 41,
    headingDeg: 180,
    muted: false,
    outcome: null,
  });

  return [
    row(3, 'in_range', 'clear', 2_000),
    row(2, 'approaching', 'in_range', 1_000),
    row(1, 'clear', 'approaching', 0),
  ];
}

/** Local midday today, so a bucket cannot straddle a day boundary in CI. */
function middayToday(): number {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

afterEach(() => {
  useCamerasStore.getState().reset();
  useHistoryStore.getState().reset();
});

describe('EXPOSURE with nothing recorded', () => {
  it('says a sentence rather than drawing a zero', () => {
    render(<ExposureScreen />);

    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    // THE WHOLE POINT. Neither a figure nor the absence of one.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(NO_VALUE)).not.toBeInTheDocument();
  });

  it('says what will fill it and that it never leaves the phone', () => {
    render(<ExposureScreen />);

    const body = screen.getByText(EMPTY_BODY);

    expect(body).toBeInTheDocument();
    // The promise is the half a driver is entitled to have in writing.
    expect(body.textContent).toMatch(/kept on this phone/i);
    expect(body.textContent).toMatch(/nothing uploaded/i);
  });

  it('draws the week as a flat baseline, not seven bars of nothing', () => {
    render(<ExposureScreen />);

    const week = screen.getByRole('list', { name: 'this week' });
    const bars = [...week.querySelectorAll('.fwm-exposure-bar')];

    // Seven, because the axis is worth showing - and every one of them flat,
    // because a chart of zero-height bars claims seven measurements that were
    // never taken.
    expect(bars).toHaveLength(7);
    for (const bar of bars) expect(bar).toHaveAttribute('data-fwm-tier', 'flat');
    // And no bar carries a computed height: nothing here is a reading.
    for (const bar of bars) expect(bar.getAttribute('style')).toBeNull();
  });

  it('offers exactly one action, and it is the one that fills the screen', () => {
    render(<ExposureScreen />);

    expect(screen.getByRole('button', { name: EMPTY_ACTION })).toBeInTheDocument();
    // The nav row is a second destination, not a second action: it explains
    // what is recorded rather than starting anything.
    expect(screen.getByText(EMPTY_LEARN)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'passes' })).not.toBeInTheDocument();
  });

  it('is not entered by a phone whose durable count has not loaded yet', () => {
    /*
     * THE FLASH THIS PREVENTS. `entries` is empty until `hydrate()` lands, so
     * an in-memory-only check would tell a driver with a year of history that
     * nothing had ever been recorded, for as long as IndexedDB took to answer.
     * A durable count is enough to know this is not day one.
     */
    act(() => {
      historyActions.hydrate([], 87, null);
    });
    render(<ExposureScreen />);

    expect(screen.queryByText(EMPTY_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
  });
});

describe('EXPOSURE counts passes, not log rows', () => {
  it('draws one pass for a drive that wrote three transitions', () => {
    /*
     * The defect, stated as a number. The old private `week` memo counted rows
     * and would put 3 on today's bar for this fixture, against a hero figure
     * of 1 from `today.passes` - which counts the same edge `isPass` does.
     */
    putArchive();
    act(() => {
      historyActions.hydrate(onePassAt(middayToday()), 1, null);
    });
    render(<ExposureScreen />);

    const rows = screen.getByRole('list', { name: 'passes' });

    expect(within(rows).getAllByRole('button')).toHaveLength(1);
    expect(within(rows).getByText('METCALF AVE & 119TH ST')).toBeInTheDocument();
  });

  it('does not crown a camera it has been past exactly once', () => {
    putArchive();
    act(() => {
      historyActions.hydrate(onePassAt(middayToday()), 1, null);
    });
    render(<ExposureScreen />);

    // There is a busiest camera and there is no PATTERN, and the tile says the
    // second rather than the first. Counting rows would have made this "3
    // passes" for one drive.
    expect(screen.getByText(HOTTEST_KICKER)).toBeInTheDocument();
    expect(screen.getByText(NOTHING_REPEATED)).toBeInTheDocument();
    expect(screen.queryByText(/passes$/)).not.toBeInTheDocument();
  });

  it('keeps the durable all-time count as an absence rather than a zero', () => {
    /*
     * `stores/history.ts` is explicit that null is not zero: the count lives in
     * IndexedDB and is null until it comes back. This is the ONE place on the
     * screen an em dash may still appear, and it is a real "not known yet"
     * beside real numbers rather than an empty state in disguise.
     */
    putArchive();
    act(() => {
      historyActions.hydrate(onePassAt(middayToday()), null, null);
    });
    render(<ExposureScreen />);

    const allTime = screen.getByText(ALL_TIME_KICKER).parentElement;

    expect(allTime).not.toBeNull();
    expect(allTime && within(allTime).getByText(NO_VALUE)).toBeInTheDocument();
    // And the screen is emphatically not the empty state: it has a list.
    expect(screen.getByRole('list', { name: 'passes' })).toBeInTheDocument();
  });
});

describe('the bar scale', () => {
  it('colours by an absolute count, not by the week it is in', () => {
    /*
     * A quiet week must not promote its busiest day to amber. Amber means
     * "eight or more passes", and a hue that meant "a lot for you lately"
     * would change meaning week to week on the one screen whose subject is
     * how much you are being read.
     */
    expect(barTier(9)).toBe('high');
    expect(barTier(8)).toBe('high');
    expect(barTier(7)).toBe('mid');
    expect(barTier(5)).toBe('mid');
    expect(barTier(4)).toBe('low');
    expect(barTier(0)).toBe('low');
  });

  it('scales against the week peak and never divides by zero', () => {
    expect(barPercent(9, 9)).toBe('100%');
    expect(barPercent(4, 8)).toBe('50%');
    // A week of nothing. The floor is `min-height` in the stylesheet, so the
    // fraction is allowed to be zero here.
    expect(barPercent(0, 0)).toBe('0%');
  });
});
