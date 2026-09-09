/**
 * WHAT OCCUPIES THE TWO SLOTS -- behaviour, not markup.
 *
 * Every claim here is one section C or section A2 makes about the arrangement,
 * and none of them is checkable by looking at the drawing:
 *
 *   MONITOR HAS NO TOP SLOT AT ALL, rather than an empty one.
 *   THE ALERT BAND APPEARS AT ONE STATE, and inserts rather than grows.
 *   AN UNCOMPUTED COUNT IS A DASH AND NEVER A ZERO, on both slots.
 *   THE MODE FOLLOWS THE DOCK'S OWN VERDICT, so the two surfaces cannot be
 *   describing different drives after a rotation.
 */

import { describe, expect, it } from 'vitest';

import { COUNT_DASH } from '../search/panel.ts';
import type { DockDerived } from '../dock/useDockState.ts';
import {
  arrivalClock,
  countFigure,
  landscapeMode,
  landscapeSlots,
  remainingDistance,
  remainingMinutes,
} from './slots.ts';

/* ------------------------------------------------------------------------ *
 * FIXTURES -- the spec's own values, so a test and the drawing agree.
 * ------------------------------------------------------------------------ */

/** A1, and the state that draws both the maneuver and the band: E3. */
const CAMERA_ON_ROUTE: DockDerived = {
  pane: 'navigating',
  state: 'camera-on-route',
  data: {
    figure: '0.4',
    unit: 'mi',
    sub: 'Right onto W 119th St',
    footer: 'ft · Flock on route',
    around: 9,
    turn: 'right',
  },
};

/** E2 -- a maneuver with no reader on the line. No band. */
const TURN_IMMINENT: DockDerived = {
  pane: 'navigating',
  state: 'turn-imminent',
  data: { figure: '900', unit: 'ft', sub: 'Right onto W 119th St', turn: 'right' },
};

/** A2 -- the exposure card, and the count the density ramp colours. */
const DENSE: DockDerived = {
  pane: 'collapsed',
  state: 'dense',
  data: {
    count: 14,
    statusText: 'cameras within 2 mi',
    subline: 'nearest 0.4 mi',
    around: 9,
  },
};

/** A state with no density reading at all. This is where a fake zero would go. */
const GPS_WEAK: DockDerived = {
  pane: 'collapsed',
  state: 'gps-weak',
  data: { statusText: 'GPS weak', statusTrailing: '±180 ft' },
};

/** A3 -- the same monitor reading with the list open under it. */
const EXPANDED_NEARBY: DockDerived = {
  pane: 'expanded',
  state: 'navigating-expanded',
  view: {
    view: 'nearby',
    data: {
      count: 14,
      headline: 'cameras within 2 mi',
      note: 'sorted by distance',
      around: 9,
      nearby: [],
    },
  },
};

const NO_ROUTE = { seconds: null, miles: null, onRoute: null, nowMs: 0 } as const;
/** 18 minutes and 7.2 miles -- A1's own bottom slot. */
const A_ROUTE = { seconds: 1080, miles: 7.2, onRoute: 2, nowMs: 0 } as const;

/* ------------------------------------------------------------------------ *
 * THE MODE
 * ------------------------------------------------------------------------ */

describe('the mode follows the dock and never re-decides', () => {
  it('is navigation whenever the dock is on its navigating pane', () => {
    expect(landscapeMode(CAMERA_ON_ROUTE)).toBe('navigation');
    expect(landscapeMode(TURN_IMMINENT)).toBe('navigation');
  });

  it('is monitor with no route', () => {
    expect(landscapeMode(DENSE)).toBe('monitor');
  });

  /** Section D: expanding is a panel over the same mode, not a third mode. */
  it('stays monitor while the nearby list is expanded over it', () => {
    expect(landscapeMode(EXPANDED_NEARBY)).toBe('monitor');
  });
});

/* ------------------------------------------------------------------------ *
 * THE TOP SLOT -- ABSENT, NOT EMPTY
 * ------------------------------------------------------------------------ */

describe('monitor mode has no top slot', () => {
  /**
   * "the top slot is not empty, it does not exist" -- the spec's own subtitle
   * for A2, and frame A2 has five direct children with no 336 x 84 box among
   * them. An 84px element rendered blank would still shadow the map.
   */
  it('returns null rather than an empty top slot', () => {
    expect(landscapeSlots(DENSE, NO_ROUTE).top).toBeNull();
    expect(landscapeSlots(EXPANDED_NEARBY, NO_ROUTE).top).toBeNull();
  });

  it('fills the top slot the moment a route is running', () => {
    const top = landscapeSlots(TURN_IMMINENT, A_ROUTE).top;
    expect(top).not.toBeNull();
    expect(top?.figure).toBe('900');
    expect(top?.unit).toBe('ft');
    expect(top?.sub).toBe('Right onto W 119th St');
    expect(top?.turn).toBe('right');
  });
});

/* ------------------------------------------------------------------------ *
 * THE ALERT BAND
 * ------------------------------------------------------------------------ */

describe('the alert band inserts, and only where there is a reader on the line', () => {
  it('is absent at a plain maneuver', () => {
    expect(landscapeSlots(TURN_IMMINENT, A_ROUTE).band).toBeNull();
  });

  it('is absent in monitor mode, where there is no line to be on', () => {
    expect(landscapeSlots(DENSE, NO_ROUTE).band).toBeNull();
  });

  /**
   * AND THE TOP SLOT KEEPS THE MANEUVER WHILE IT IS UP. This is the whole
   * reason the band is a third element: the portrait pane has one body and has
   * to choose between the turn and the reader; the landscape column shows both.
   */
  it('draws the reader beside the maneuver, not instead of it', () => {
    const slots = landscapeSlots(CAMERA_ON_ROUTE, A_ROUTE);
    expect(slots.top?.sub).toBe('Right onto W 119th St');
    expect(slots.band?.text).toBe('ft · Flock on route');
    expect(slots.band?.around).toBe(9);
  });
});

/* ------------------------------------------------------------------------ *
 * NEVER A FAKE ZERO
 * ------------------------------------------------------------------------ */

describe('an uncomputed count is a dash and never a zero', () => {
  /**
   * THE SAFETY RULE, and it is not a style preference. Zero readers within two
   * miles is a real and reassuring answer; drawing it before anything has
   * counted tells a driver the road is clear on a number nobody took.
   */
  it('draws a dash for a state that has no density reading', () => {
    const bottom = landscapeSlots(GPS_WEAK, NO_ROUTE).bottom;
    expect(bottom.kind).toBe('monitor');
    if (bottom.kind !== 'monitor') return;
    expect(bottom.count.state).toBe('unknown');
    expect(countFigure(bottom.count)).toBe(COUNT_DASH);
  });

  it('draws a real zero when a real zero was measured', () => {
    const clear: DockDerived = { ...DENSE, data: { ...DENSE.data, count: 0 } };
    const bottom = landscapeSlots(clear, NO_ROUTE).bottom;
    if (bottom.kind !== 'monitor') throw new Error('expected the monitor slot');
    expect(countFigure(bottom.count)).toBe('0');
  });

  it('draws a dash for readers on a route nobody has planned', () => {
    const bottom = landscapeSlots(TURN_IMMINENT, NO_ROUTE).bottom;
    if (bottom.kind !== 'navigation') throw new Error('expected the navigation slot');
    expect(countFigure(bottom.onRoute)).toBe(COUNT_DASH);
    expect(bottom.arrival).toBeNull();
    expect(bottom.minutes).toBeNull();
    expect(bottom.remaining).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * A3 KEEPS THE COUNT
 * ------------------------------------------------------------------------ */

describe('expanding the list does not blank the reading it was opened from', () => {
  /**
   * The dock's ladder moves the count from `DockData` to `DockNearbyData` when
   * the sheet opens, because the portrait sheet draws a different composition.
   * Reading only the collapsed shape would blank the header exactly when a
   * driver is looking at it.
   */
  it('reads the count off the expanded pane too', () => {
    const bottom = landscapeSlots(EXPANDED_NEARBY, NO_ROUTE).bottom;
    if (bottom.kind !== 'monitor') throw new Error('expected the monitor slot');
    expect(countFigure(bottom.count)).toBe('14');
    expect(bottom.statusText).toBe('cameras within 2 mi');
    expect(bottom.subline).toBe('sorted by distance');
    expect(bottom.around).toBe(9);
  });
});

/* ------------------------------------------------------------------------ *
 * THE BOTTOM SLOT'S FOUR FIGURES
 * ------------------------------------------------------------------------ */

describe('the navigation bottom slot', () => {
  it('draws A1’s own numbers from A1’s own route', () => {
    const bottom = landscapeSlots(TURN_IMMINENT, A_ROUTE).bottom;
    if (bottom.kind !== 'navigation') throw new Error('expected the navigation slot');
    expect(bottom.minutes).toBe('18');
    expect(bottom.remaining).toBe('7.2 mi remaining');
    expect(countFigure(bottom.onRoute)).toBe('2');
  });

  /**
   * THE CLOCK'S FORMATTER IS INJECTED, so a test asserts arithmetic rather than
   * the machine's time zone -- the same code prints 10:03 in Kansas and 16:03
   * in Berlin and both are correct.
   */
  it('adds the remaining duration to now', () => {
    const at = arrivalClock(0, 1080, (date) => String(date.getTime()));
    expect(at).toBe(String(1080 * 1000));
  });

  it('refuses a negative or non-finite duration rather than drawing one', () => {
    expect(arrivalClock(0, -1)).toBeNull();
    expect(arrivalClock(0, Number.NaN)).toBeNull();
    expect(remainingMinutes(-1)).toBeNull();
    expect(remainingDistance(-1)).toBeNull();
  });

  it('rounds minutes and gives distance one decimal', () => {
    expect(remainingMinutes(1049)).toBe('17');
    expect(remainingMinutes(1050)).toBe('18');
    expect(remainingDistance(7.24)).toBe('7.2 mi remaining');
  });
});

/* ------------------------------------------------------------------------ *
 * OFFLINE
 * ------------------------------------------------------------------------ */

describe('working from cache', () => {
  /**
   * IT WINS OVER BOTH MODES because it is a statement about whether either can
   * be trusted -- section C draws it as a bottom-slot variant rather than as a
   * banner for that reason.
   */
  it('replaces the bottom slot without disturbing the top one', () => {
    const slots = landscapeSlots(TURN_IMMINENT, A_ROUTE, {
      statusText: 'Working from cache',
      detail: '1010 cameras stored',
      subline: 'last synced 14 min ago',
    });
    expect(slots.bottom.kind).toBe('offline');
    expect(slots.mode).toBe('navigation');
    expect(slots.top?.figure).toBe('900');
  });
});
