/**
 * THE LADDER, AND ONLY THE LADDER.
 *
 * `deriveState` is the one place in the app that turns live stores into a pane
 * and a state, and it decides two things the spec does not draw: WHICH pane a
 * situation is in, and which state wins when two are true at once. Both are
 * behaviour, and behaviour with no test is how the expand defect shipped.
 * `dock.test.tsx` renders states it is handed and `dockConformance.test.ts`
 * reads source off disk; neither of them ever asks the ladder a question.
 *
 * IT IS A PURE FUNCTION AND IT IS TESTED AS ONE. No store, no hook, no render:
 * `DockLadderInput` is the whole world the ladder sees, and every case below is
 * that record with one or two fields moved off `RESTING`. A test that had to
 * stand a zustand store up to ask "does the pane open" would be testing the
 * store.
 *
 * WHAT IT PINS, in order of what would hurt most if it broke:
 *
 *   - A ROUTE MEANS THE 170px PANE, always. Section E is "the single source for
 *     every routed state", and rule 5 is that no height changes while a drive
 *     state is active. A camera alert mid-route is E3, not a drop to the 150px
 *     card, and that is the assertion that stops the pane resizing under a
 *     driver's thumb at 70mph.
 *   - THE FOUR TIERS OF THE EXPOSURE RAMP ARE REACHABLE, which is what the
 *     gate on the count is for.
 *   - THE THREE COLLAPSED STATES WITH A SHEET ALL OPEN IT, and the ones with
 *     nothing behind them ignore the flag entirely. The chevron is deleted and
 *     the whole pane is the target now, so a press that derives the state it
 *     was already in is a dead surface rather than one dead control.
 */

import { describe, expect, it } from 'vitest';

import { deriveState } from './useDockState.ts';
import type { DockLadderInput, DockLadderResult } from './useDockState.ts';
import { DOCK_HEIGHT, dockDensityTier } from './dockState.ts';
import type { DockCollapsedStateId, DockNavStateId } from './dockState.ts';

/**
 * Nothing is happening. Stopped, off route, clear, nothing cached, nothing
 * wrong -- `deriveState(RESTING)` is the collapsed IDLE card, and every case
 * below is this record with the one or two fields its state actually needs.
 */
const RESTING: DockLadderInput = {
  expanded: false,
  routeActive: false,
  routePlanning: false,
  hasManeuver: false,
  hasSteps: false,
  offRoute: false,
  arrived: false,
  cameraOnRoute: false,
  moving: false,
  alertState: 'clear',
  secondsToNearest: null,
  justCleared: false,
  entering: false,
  abuseZone: false,
  offline: false,
  gpsWeak: false,
  muted: false,
  syncing: false,
  exposed: false,
  armed: false,
};

/** A route is running and the driver has a position on it. The E-family floor. */
const ROUTED: Partial<DockLadderInput> = {
  routeActive: true,
  hasManeuver: true,
  hasSteps: true,
  moving: true,
};

function ladder(over: Partial<DockLadderInput>): DockLadderResult {
  return deriveState({ ...RESTING, ...over });
}

/** The pane and the state as one string, so a case reads as one claim. */
function reached(over: Partial<DockLadderInput>): string {
  const result = ladder(over);
  return result.pane === 'expanded'
    ? `expanded/${result.view}`
    : `${result.pane}/${result.state}`;
}

/* ------------------------------------------------------------------------ *
 * A ROUTE MEANS ONE OF THE SIX, AND IT MEANS 170px
 * ------------------------------------------------------------------------ */

describe('a running route puts the dock in the navigation family and keeps it there', () => {
  it.each<readonly [DockNavStateId, Partial<DockLadderInput>]>([
    ['rerouting', { routePlanning: true }],
    ['arrived', { arrived: true }],
    ['off-route', { offRoute: true }],
    ['camera-on-route', { cameraOnRoute: true }],
    ['turn-imminent', {}],
    ['route-proposed', { hasManeuver: false, hasSteps: false }],
  ])('reaches %s', (state, over) => {
    expect(reached({ ...ROUTED, ...over })).toBe(`navigating/${state}`);
  });

  /**
   * THE ONE THAT MATTERS MOST. V2 dropped to a 150px UNDER SURVEILLANCE card
   * the moment a reader came into range, which moved the pane -- and every key
   * on it -- twenty pixels mid-turn. Section E is the single source for every
   * routed state, so the camera reading rides in E3's own footer instead.
   */
  it.each<DockLadderInput['alertState']>(['approaching', 'in_range', 'multiple'])(
    'answers a %s reader with E3 rather than dropping to the collapsed alert',
    (alertState) => {
      const result = ladder({ ...ROUTED, alertState, cameraOnRoute: true });
      expect(result).toStrictEqual({ pane: 'navigating', state: 'camera-on-route' });
      expect(DOCK_HEIGHT[result.pane]).toBe(170);
    },
  );

  it('never lets a condition take a routed dock off the navigation family', () => {
    /* OFFLINE, GPS WEAK, MUTED and MESH SYNC are the resting half's own gates.
       A route running through any of them is still a route, and the line is
       still on the phone -- the cache is what planned it. */
    for (const condition of ['offline', 'gpsWeak', 'muted', 'syncing'] as const) {
      expect(reached({ ...ROUTED, [condition]: true })).toBe('navigating/turn-imminent');
    }
  });

  it('keeps a plan in flight above every other routed reading', () => {
    /* Everything under REROUTING is measured along a line that is about to be
       replaced. It is also the only routed state that can be reached with no
       route object at all, which is a first plan rather than a re-plan. */
    expect(reached({ ...ROUTED, routePlanning: true, offRoute: true, arrived: true })).toBe(
      'navigating/rerouting',
    );
    expect(reached({ routePlanning: true })).toBe('navigating/rerouting');
  });

  it('puts arrival above off route, so a car park is not a wrong turn', () => {
    expect(reached({ ...ROUTED, arrived: true, offRoute: true })).toBe('navigating/arrived');
  });

  it('puts off route above the reader, because the distance is measured on the line', () => {
    /* `announce.ts`'s own argument: a distance measured along a route the
       driver is not on is a fiction. E5 carries the reader count in its footer
       rather than losing it. */
    expect(reached({ ...ROUTED, offRoute: true, cameraOnRoute: true })).toBe(
      'navigating/off-route',
    );
  });

  it('falls to E1 only when no position on the line can be computed', () => {
    /* All that is left of "proposed" in a build with no start: a line exists
       and `nextManeuver` cannot say where you are on it. */
    expect(reached({ routeActive: true, hasManeuver: false })).toBe('navigating/route-proposed');
    expect(reached({ routeActive: true, hasManeuver: true })).toBe('navigating/turn-imminent');
  });
});

/* ------------------------------------------------------------------------ *
 * THE TURN LIST
 * ------------------------------------------------------------------------ */

describe('the navigation pane opens the turn list and nothing else', () => {
  it('grows the list from every routed state', () => {
    for (const over of [{}, { offRoute: true }, { arrived: true }, { cameraOnRoute: true }]) {
      expect(reached({ ...ROUTED, ...over, expanded: true })).toBe('expanded/turn-list');
    }
  });

  it('refuses to open a sheet the route has nothing to fill', () => {
    /* `PlannedRoute.maneuvers` may legitimately be empty -- a route from a
       fixture, or a router build that returns no turn list -- and 132px of
       empty sheet is worse than a pane that did not move. */
    expect(reached({ ...ROUTED, hasSteps: false, expanded: true })).toBe(
      'navigating/turn-imminent',
    );
  });

  it('opens the list even while a plan is in flight, because the old one is live', () => {
    expect(reached({ ...ROUTED, routePlanning: true, expanded: true })).toBe(
      'expanded/turn-list',
    );
  });
});

/* ------------------------------------------------------------------------ *
 * THE EXPOSURE RAMP
 * ------------------------------------------------------------------------ */

describe('the exposure count is the resting reading, at every tier', () => {
  /**
   * THE GATE IS ONE READER AND NOT TEN, AND THIS IS WHY.
   *
   * V2 fired DENSE AREA at ten within two miles. B2 publishes a four-tier ramp
   * over the same count -- 0 clear, 1-5 low, 6-12 moderate, 13+ high -- and a
   * state that cannot exist below ten leaves the bottom half of that ramp
   * unreachable and the ramp saying only "bad" and "worse".
   */
  it.each([1, 5, 6, 12, 13, 60])('draws the card at %i readers', (count) => {
    expect(reached({ exposed: count > 0, armed: true })).toBe('collapsed/dense');
    expect(dockDensityTier(count)).not.toBe('clear');
  });

  it('falls to ARMED when nothing is inside two miles but something is inside five', () => {
    expect(reached({ exposed: false, armed: true })).toBe('collapsed/armed');
  });

  it('falls to IDLE when nothing is inside either', () => {
    expect(reached({})).toBe('collapsed/idle');
  });

  it('reads zero as the ramp does, so the two agree on what clear means', () => {
    expect(dockDensityTier(0)).toBe('clear');
  });
});

/* ------------------------------------------------------------------------ *
 * THE COLLAPSED SHEET
 * ------------------------------------------------------------------------ */

/**
 * The three collapsed states with something behind them, and the condition that
 * raises each.
 *
 * `armed` rides along with the other two on purpose: readers inside two miles
 * are also readers inside five, and a documented county is found through the
 * nearest camera's own record. The ladder's order is what separates them, and
 * the collapsed cases assert it still does.
 */
const SHEET: readonly (readonly [DockCollapsedStateId, Partial<DockLadderInput>])[] = [
  ['armed', { armed: true }],
  ['dense', { exposed: true, armed: true }],
  ['abuse-zone', { abuseZone: true, exposed: true, armed: true }],
];

describe('the pane press opens on all three states that have a sheet', () => {
  it.each(SHEET)('collapses to %s', (state, over) => {
    expect(reached({ ...over, expanded: false })).toBe(`collapsed/${state}`);
  });

  it.each(SHEET)('expands %s to the one collapsed sheet the spec draws', (_state, over) => {
    /* ONE SHEET, THREE DOORS. Section C is the only collapsed-family sheet --
       the readers within two miles, sorted by distance -- and it is the honest
       answer to all three questions: which fourteen, which reader, and what is
       around me in a county with a record. */
    expect(reached({ ...over, expanded: true })).toBe('expanded/nearby');
  });
});

/**
 * The collapsed states that have nothing behind them. Each has something in the
 * right-hand slot instead -- a cache date, an accuracy, a countdown -- and
 * nothing worth opening.
 */
const SILENT: readonly (readonly [DockCollapsedStateId, Partial<DockLadderInput>])[] = [
  ['idle', {}],
  ['offline', { offline: true, armed: true, exposed: true }],
  ['gps-weak', { gpsWeak: true, armed: true, exposed: true }],
  ['muted', { muted: true, armed: true, exposed: true }],
  ['mesh-sync', { syncing: true, armed: true, exposed: true }],
];

describe('a state with nothing behind it ignores the press entirely', () => {
  it.each(SILENT)('leaves %s where it is when the flag is set', (state, over) => {
    /* THE HALF OF THE FIX MOST LIKELY TO BREAK. `expanded` is one boolean on
       one component and it survives a state change -- a driver opens the sheet,
       walks out of range, and the flag is still true. If OFFLINE or MUTED
       honoured it, a dock reporting a fault would answer with a camera list. */
    expect(reached({ ...over, expanded: true })).toBe(`collapsed/${state}`);
    expect(reached({ ...over, expanded: false })).toBe(`collapsed/${state}`);
  });
});

/* ------------------------------------------------------------------------ *
 * MOVING, WITH NO ROUTE
 * ------------------------------------------------------------------------ */

describe('the unrouted drive states, live camera first', () => {
  it.each<readonly [DockCollapsedStateId, Partial<DockLadderInput>]>([
    ['passing', { moving: true, alertState: 'in_range' }],
    ['passing', { moving: true, alertState: 'multiple' }],
    ['cleared', { moving: true, justCleared: true }],
    ['abuse-entering', { moving: true, entering: true, abuseZone: true }],
    [
      'approaching',
      { moving: true, alertState: 'approaching', secondsToNearest: 45 },
    ],
    ['cruising', { moving: true, exposed: true, armed: true }],
  ])('reaches %s', (state, over) => {
    expect(reached(over)).toBe(`collapsed/${state}`);
  });

  it('treats APPROACHING as a window and not a band', () => {
    /* 30 to 90 seconds. Outside it the dock says how far, not how soon, and
       CRUISING is the state that says how far. */
    const engaged = { moving: true, alertState: 'approaching' } as const;
    expect(reached({ ...engaged, secondsToNearest: 29 })).toBe('collapsed/cruising');
    expect(reached({ ...engaged, secondsToNearest: 30 })).toBe('collapsed/approaching');
    expect(reached({ ...engaged, secondsToNearest: 90 })).toBe('collapsed/approaching');
    expect(reached({ ...engaged, secondsToNearest: 91 })).toBe('collapsed/cruising');
    expect(reached({ ...engaged, secondsToNearest: null })).toBe('collapsed/cruising');
  });

  it.each<readonly [DockCollapsedStateId, Partial<DockLadderInput>]>([
    ['passing', { moving: true, alertState: 'in_range' }],
    ['cleared', { moving: true, justCleared: true }],
    ['abuse-entering', { moving: true, entering: true, abuseZone: true }],
    ['cruising', { moving: true, armed: true, exposed: true }],
  ])('never lets the press reach a sheet from %s', (state, over) => {
    /* An alarm is not a sheet, and there is no expanded drawing of any of the
       four. A flag left over from a collapsed gesture must not find one. */
    expect(reached({ ...over, expanded: true })).toBe(`collapsed/${state}`);
  });
});

/* ------------------------------------------------------------------------ *
 * THE ORDER, WRITTEN DOWN
 * ------------------------------------------------------------------------ */

describe('the order between the resting states is the order the ladder writes down', () => {
  it('puts a documented county over an exposure count, and both over a single reader', () => {
    expect(reached({ abuseZone: true, exposed: true, armed: true })).toBe('collapsed/abuse-zone');
    expect(reached({ exposed: true, armed: true })).toBe('collapsed/dense');
    expect(reached({ armed: true })).toBe('collapsed/armed');
  });

  it('keeps the four conditions above all three, pressed or not', () => {
    /* OFFLINE, GPS WEAK, MUTED and MESH SYNC come first because each one
       changes what an exposure count would MEAN. Opening the sheet does not
       promote a camera list over a stale cache or a 180 ft fix. */
    for (const expanded of [false, true]) {
      expect(
        reached({ offline: true, abuseZone: true, exposed: true, armed: true, expanded }),
      ).toBe('collapsed/offline');
      expect(reached({ gpsWeak: true, exposed: true, armed: true, expanded })).toBe(
        'collapsed/gps-weak',
      );
      expect(reached({ muted: true, armed: true, expanded })).toBe('collapsed/muted');
      expect(reached({ syncing: true, armed: true, expanded })).toBe('collapsed/mesh-sync');
    }
  });

  it('answers with one of the three heights and never a fourth', () => {
    const seen = new Set<number>();
    for (const over of [
      {},
      { armed: true },
      { exposed: true },
      { moving: true, alertState: 'in_range' as const },
      { ...ROUTED },
      { ...ROUTED, expanded: true },
      { armed: true, expanded: true },
    ]) {
      seen.add(DOCK_HEIGHT[ladder(over).pane]);
    }
    expect([...seen].sort((a, b) => a - b)).toStrictEqual([150, 170, 302]);
  });
});
