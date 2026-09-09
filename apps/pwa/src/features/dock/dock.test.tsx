/**
 * THE DOCK, RENDERED. One merged pane, three heights, one detour verb.
 *
 * `dockv3.dc.html` draws every state at real size with real values, and
 * `DOCK_FIXTURES` is that page's collapsed data transcribed once. These tests
 * render against the fixtures rather than against invented strings, so a
 * fixture and the component cannot disagree about what a state says without one
 * of them going red.
 *
 * WHY THE HEIGHTS ARE ASSERTED THROUGH THE STYLESHEET AND NOT THROUGH LAYOUT.
 * jsdom does not lay out and vitest runs with `css: false`, so `dock.css` is
 * never parsed here: `getComputedStyle(pane).height` is the empty string in
 * this environment and an assertion on it would pass on anything. So the test
 * asserts the two halves that do exist -- that the component stamps the right
 * `data-fwm-pane`, and that `dock.css` resolves that pane to the number
 * `DOCK_HEIGHT` publishes -- and reads the stylesheet off disk to do the
 * second half. `dockConformance.test.ts` does the same, for the same reason,
 * and takes the geometry much further; what is here is the half that is about
 * the COMPONENT rather than about the CSS.
 *
 * WHAT THIS FILE IS FOR, now that conformance exists. Three claims, and they
 * are all behaviour:
 *
 *   THE PANE IS ONE ELEMENT. Body, divider and tab row inside one box with one
 *   hairline, in every state, with no grab handle and no chevron anywhere -- so
 *   the whole body is the target.
 *   THE DETOUR VERB IS `Reroute around N`, on all three panes that can draw it,
 *   and there is no key at all where there is no count.
 *   COLOUR NEVER TRAVELS ALONE. Wherever the ramp colours a number, the tier
 *   word is beside it.
 */

import { readFileSync } from 'node:fs';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dock } from './Dock.tsx';
import {
  DOCK_COLLAPSED_STATE_IDS,
  DOCK_FIXTURE_TAB,
  DOCK_FIXTURES,
  DOCK_HEIGHT,
  DOCK_NAV_STATE_IDS,
  DOCK_TIER_WORD,
  dockDensityTier,
  dockRerouteLabel,
  dockRerouteSpoken,
  withDetourCount,
} from './dockState.ts';
import type {
  DockActionKey,
  DockCollapsedStateId,
  DockData,
  DockNavStateId,
  DockPane,
  DockTabKey,
} from './dockState.ts';
import type { DockNavData } from './DriveRows.tsx';
import type { DockNearbyData, DockTurnListData } from './ExpandedPanel.tsx';

/* ------------------------------------------------------------------------ *
 * THE STYLESHEET, READ AS TEXT
 * ------------------------------------------------------------------------ */

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/** Comments stripped, so a number quoted in prose cannot answer for a rule. */
const STRIP = /\/\*[\s\S]*?\*\//g;
const DOCK_CSS: string = readFileSync(`${HERE}/dock.css`, 'utf8').replace(STRIP, '');
const TOKENS_CSS: string = readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8').replace(
  STRIP,
  '',
);
const ALL_CSS = `${DOCK_CSS}\n${TOKENS_CSS}`;

/**
 * A custom property, substituted until nothing is left but arithmetic.
 *
 * `check-design-values.mjs` fails the build on a raw length as hard as on a raw
 * hex, so `height: 150px` is unwritable and the dock spells its three heights
 * as sums off the 4px step. Reading the number back therefore means doing the
 * substitution and then the sum, rather than matching on `150px`.
 */
function resolve(name: string): number | null {
  let expression = new RegExp(`${name}:\\s*([^;]+);`).exec(ALL_CSS)?.[1]?.trim() ?? null;
  if (expression === null) return null;
  for (let pass = 0; pass < 12 && expression.includes('var('); pass += 1) {
    expression = expression.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole: string, ref: string) => {
      const found = new RegExp(`${ref}:\\s*([^;]+);`).exec(ALL_CSS)?.[1];
      return found === undefined ? whole : `(${found.trim()})`;
    });
  }
  const arithmetic = expression.replace(/\bcalc\b/g, '').replace(/(\d*\.?\d+)px\b/g, '$1');
  if (!/^[\d\s.+\-*/()]+$/.test(arithmetic)) return null;
  return evaluate(arithmetic);
}

/**
 * `+ - * /` and parentheses, and nothing else.
 *
 * Written out rather than reached for through `Function`, because a test that
 * evals a file off disk is a test that runs whatever the file says.
 */
function evaluate(source: string): number | null {
  const found = source.match(/\d*\.?\d+|[+\-*/()]/g);
  if (found === null) return null;
  const tokens: readonly string[] = found;
  let at = 0;
  const peek = (): string | undefined => tokens[at];

  function primary(): number {
    const token = tokens[at];
    at += 1;
    if (token === '(') {
      const value = sum();
      at += 1; // ')'
      return value;
    }
    if (token === '-') return -primary();
    return Number(token);
  }
  function product(): number {
    let value = primary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[at];
      at += 1;
      const right = primary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function sum(): number {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[at];
      at += 1;
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  const total = sum();
  return Number.isFinite(total) ? total : null;
}

const CSS_HEIGHT: Readonly<Record<DockPane, number | null>> = {
  collapsed: resolve('--fwm-dk-h-collapsed'),
  navigating: resolve('--fwm-dk-h-navigating'),
  expanded: resolve('--fwm-dk-h-expanded'),
};

/* ------------------------------------------------------------------------ *
 * RENDERING ONE PANE
 * ------------------------------------------------------------------------ */

interface Handlers {
  readonly onTab?: (key: DockTabKey) => void;
  readonly onReport?: () => void;
  readonly onExpand?: () => void;
  readonly onCollapse?: () => void;
}

/**
 * The shell half of `DockProps`, supplied in full every time.
 *
 * Every handler is given even where a test ignores it: the props are optional
 * and `exactOptionalPropertyTypes` is on, so passing `undefined` explicitly is
 * a type error while omitting a prop entirely changes what is under test.
 */
function shell(state: DockCollapsedStateId | null, handlers: Handlers) {
  return {
    activeTab: state === null ? ('map' as const) : DOCK_FIXTURE_TAB[state],
    onTab: handlers.onTab ?? vi.fn(),
    onReport: handlers.onReport ?? vi.fn(),
    onExpand: handlers.onExpand ?? vi.fn(),
    onCollapse: handlers.onCollapse ?? vi.fn(),
  };
}

describe('the way back out of a mute', () => {
  /*
   * BOTH HALVES OF THIS SHIPPED BROKEN AT ONCE, which is how a driver ended up
   * with no control anywhere in the application that would unmute them. The key
   * was painted over by the detour count while a route was live, and the press
   * behind it was never wired. Reported by the owner: "there is no way to
   * unmute". One test per half.
   */
  it('draws Undo on MUTED even while a detour is on offer', () => {
    /* There is ONE key slot. The detour count claims it in every other state
       and comes back on its own a state later; a mute has exactly one door and
       until it lapses the app is quiet about readers it can see. */
    const muted = { ...DOCK_FIXTURES.muted, around: 9 };
    const { getByRole, queryByRole } = renderCollapsed('muted', {}, muted);

    expect(getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(queryByRole('button', { name: /Reroute around/u })).toBeNull();
  });

  it('reports the press as undo, which is the action that ends the mute', () => {
    const onAction = vi.fn();
    const { getByRole } = renderCollapsed('muted', {}, undefined, onAction);

    fireEvent.click(getByRole('button', { name: 'Undo' }));

    expect(onAction).toHaveBeenCalledWith('undo');
  });

  it('leaves the detour key alone in every state that is not MUTED', () => {
    /* The precedence is one state wide on purpose. CLEARED's `Wrong?` disputes
       a pass that will still be disputable afterwards, so it stays below the
       count. */
    const cleared = { ...DOCK_FIXTURES.cleared, around: 4 };
    const { getByRole } = renderCollapsed('cleared', {}, cleared);

    expect(getByRole('button', { name: /Reroute around 4/u })).toBeInTheDocument();
  });
});

function renderCollapsed(
  state: DockCollapsedStateId,
  handlers: Handlers = {},
  data?: DockData,
  onAction: ((action: DockActionKey) => void) | undefined = vi.fn(),
) {
  return render(
    <Dock
      {...shell(state, handlers)}
      pane="collapsed"
      state={state}
      data={data ?? DOCK_FIXTURES[state]}
      onAction={onAction}
    />,
  );
}

/**
 * Section E and F, transcribed once, as `dockRows.test.tsx` transcribes them.
 *
 * Only what this file asserts: the shape of the pane, the verb on the key and
 * the count behind it. `dockRows.test.tsx` owns the rest of the six.
 */
const NAV_FIXTURE: Readonly<Record<DockNavStateId, DockNavData>> = {
  'route-proposed': { figure: '18', unit: 'min · 7.2 mi', sub: 'avoids 3 of 5 cameras' },
  'turn-imminent': { figure: '500', unit: 'ft', sub: 'Right onto W 119th St', turn: 'right' },
  'camera-on-route': {
    figure: '0.4',
    unit: 'mi',
    sub: 'Right onto W 119th St',
    footer: '600 ft · Flock at the turn',
    around: 1,
    turn: 'right',
  },
  rerouting: { title: 'Finding a way around', sub: 'holding your destination' },
  'off-route': { title: 'Off route', sub: '0.3 mi from W 119th St' },
  arrived: { title: 'Arrived', sub: '11800 Overland Pkwy' },
};

function renderNav(state: DockNavStateId, handlers: Handlers = {}, data?: DockNavData) {
  return render(
    <Dock
      {...shell(null, handlers)}
      pane="navigating"
      state={state}
      data={data ?? NAV_FIXTURE[state]}
      onAction={vi.fn()}
    />,
  );
}

const NEARBY: DockNearbyData = {
  count: 14,
  headline: 'cameras within 2 mi',
  note: 'sorted by distance',
  around: 9,
  nearby: [
    {
      id: 'n1',
      where: 'Antioch Rd & W 119th St',
      who: 'Flock · inter-agency shared',
      owner: 'flock',
      distance: '0.4 mi',
    },
    {
      id: 'n2',
      where: 'Overland Pkwy at I-435',
      who: 'Overland Park PD',
      owner: 'police',
      distance: '0.9 mi',
    },
  ],
};

const TURN_LIST: DockTurnListData = {
  nav: NAV_FIXTURE['turn-imminent'],
  steps: [
    { id: 's1', distance: '0.4 mi', road: 'W 119th St', note: '1 camera at Antioch', tone: 'alert' },
    { id: 's2', distance: '1.2 mi', road: 'Metcalf Ave', note: 'clear', tone: 'quiet' },
  ],
};

function renderNearby(handlers: Handlers = {}, onPick = vi.fn(), data: DockNearbyData = NEARBY) {
  return render(
    <Dock
      {...shell(null, handlers)}
      pane="expanded"
      state="armed-expanded"
      view={{ view: 'nearby', data, onPick, onAction: vi.fn() }}
    />,
  );
}

function renderTurnList(handlers: Handlers = {}) {
  return render(
    <Dock
      {...shell(null, handlers)}
      pane="expanded"
      state="navigating-expanded"
      view={{ view: 'turn-list', data: TURN_LIST, onStep: vi.fn(), onAction: vi.fn() }}
    />,
  );
}

/* ------------------------------------------------------------------------ *
 * THE THREE HEIGHTS
 * ------------------------------------------------------------------------ */

describe('the three heights', () => {
  it('publishes 150, 170 and 302 and nothing else', () => {
    expect(DOCK_HEIGHT).toStrictEqual({ collapsed: 150, navigating: 170, expanded: 302 });
    expect(new Set(Object.values(DOCK_HEIGHT)).size).toBe(3);
  });

  it('resolves each one to the same number in the stylesheet', () => {
    /* The component stamps the pane; the stylesheet turns it into a number.
       Both halves, or the assertion proves only that a string was copied. */
    expect(CSS_HEIGHT).toStrictEqual(DOCK_HEIGHT);
  });

  it.each(DOCK_COLLAPSED_STATE_IDS)('draws %s in the collapsed pane', (state) => {
    const { container } = renderCollapsed(state);
    const pane = container.querySelector('.fwm-dock');
    expect(pane).toHaveAttribute('data-fwm-pane', 'collapsed');
    expect(pane).toHaveAttribute('data-fwm-state', state);
  });

  it.each(DOCK_NAV_STATE_IDS)('draws %s in the navigating pane', (state) => {
    /* ESCALATION IS COLOUR, WEIGHT AND THE NUMBER, NEVER SIZE. Six states,
       one height, and a driver mid-turn whose pane does not move. */
    const { container } = renderNav(state);
    const pane = container.querySelector('.fwm-dock');
    expect(pane).toHaveAttribute('data-fwm-pane', 'navigating');
    expect(pane).toHaveAttribute('data-fwm-state', state);
  });

  it('draws both sheets at the one expanded height', () => {
    for (const draw of [renderNearby, renderTurnList]) {
      const { container, unmount } = draw();
      expect(container.querySelector('.fwm-dock')).toHaveAttribute('data-fwm-pane', 'expanded');
      unmount();
    }
  });
});

/* ------------------------------------------------------------------------ *
 * ONE MERGED PANE
 * ------------------------------------------------------------------------ */

describe('the pane is one element', () => {
  it('keeps the body, the divider and the tab row inside one box', () => {
    /* V2 shipped two slabs with two fills and a visible seam. V3's whole
       argument is that they are one surface whose floor is the tab row, split
       off by a 1px rule -- so the tab row must be a CHILD of the pane and not
       a sibling of it. */
    const { container } = renderCollapsed('dense');
    const pane = container.querySelector('.fwm-dock');

    expect(pane?.querySelector('.fwm-dock-body')).not.toBeNull();
    expect(pane?.querySelector('.fwm-dock-divider')).not.toBeNull();
    expect(pane?.querySelector('.fwm-dock-tabs')).not.toBeNull();
    expect(pane?.querySelectorAll('.fwm-dock-divider')).toHaveLength(1);
  });

  it('draws no grab handle and no expand chevron, in any pane', () => {
    /* Both deleted. The chevron collided with the pane's corner and the report
       key; the bar under the tab row duplicated the system gesture bar three
       pixels below it. The whole body is the target instead. */
    const draws = [
      () => renderCollapsed('dense'),
      () => renderNav('turn-imminent'),
      () => renderNearby(),
    ];
    for (const draw of draws) {
      const { container, unmount } = draw();
      expect(container.querySelector('.fwm-dock-grabber')).toBeNull();
      expect(container.querySelector('.fwm-dock-expand')).toBeNull();
      expect(container.querySelector('.fwm-dock-home')).toBeNull();
      unmount();
    }
  });

  it('puts a scrim behind the pane and the report key, not inside them', () => {
    /* 180px of gradient to 85% ink is full-bleed and the pane is inset 10, so
       it cannot be a child of the pane. It is `aria-hidden` because a gradient
       is not content. */
    const { container } = renderCollapsed('idle');
    const scrim = container.querySelector('.fwm-dock-scrim');

    expect(scrim).not.toBeNull();
    expect(scrim?.closest('.fwm-dock')).toBeNull();
    expect(scrim).toHaveAttribute('aria-hidden', 'true');
  });
});

/* ------------------------------------------------------------------------ *
 * THE WHOLE PANE IS THE TARGET
 * ------------------------------------------------------------------------ */

describe('the pane press', () => {
  it.each(['armed', 'dense', 'abuse-zone'] as const)('opens the sheet from %s', (state) => {
    const onExpand = vi.fn();
    const { container } = renderCollapsed(state, { onExpand });
    const target = container.querySelector('.fwm-dock-tap');

    expect(target).not.toBeNull();
    expect(target).toHaveAccessibleName();
    expect(target).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(target as Element);

    expect(onExpand).toHaveBeenCalledOnce();
  });

  it.each(DOCK_NAV_STATE_IDS)('offers the turn list from %s', (state) => {
    /* Every routed state has a turn list behind it, so the whole family offers
       the press -- unlike the collapsed half, where four states have nothing. */
    const onExpand = vi.fn();
    const { container } = renderNav(state, { onExpand });
    fireEvent.click(container.querySelector('.fwm-dock-tap') as Element);
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('closes a sheet from anywhere on its body', () => {
    for (const draw of [renderNearby, renderTurnList]) {
      const onCollapse = vi.fn();
      const { container, unmount } = draw({ onCollapse });
      const target = container.querySelector('.fwm-dock-tap');

      expect(target).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(target as Element);
      expect(onCollapse).toHaveBeenCalledOnce();
      unmount();
    }
  });

  it.each(['idle', 'offline', 'gps-weak', 'mesh-sync'] as const)(
    'draws no target at all on %s, which has nothing behind it',
    (state) => {
      /* A pressable pane that derives the state it was already in is a dead
         surface, which is worse than one dead control -- the chevron at least
         showed you where the dead thing was. */
      const { container } = renderCollapsed(state);
      expect(container.querySelector('.fwm-dock-tap')).toBeNull();
    },
  );
});

/* ------------------------------------------------------------------------ *
 * THE TAB ROW
 * ------------------------------------------------------------------------ */

describe('the tab row', () => {
  it('is Map, Exposure, Mesh, Lookup, More, in that order', () => {
    const { container } = renderCollapsed('idle');
    const tabs = Array.from(container.querySelectorAll('.fwm-dock-tab'));
    expect(tabs.map((tab) => tab.textContent)).toStrictEqual([
      'Map',
      'Exposure',
      'Mesh',
      'Lookup',
      'More',
    ]);
  });

  it('is drawn in every state, routed and expanded included', () => {
    /* THE ROW IS PERMANENT CHROME. V2's drive family drew none, which is what
       made it a fourth height and what left a rolling driver on EXPOSURE with
       no way back. All three published heights count its 63px. */
    const draws = [
      ...DOCK_COLLAPSED_STATE_IDS.map((state) => () => renderCollapsed(state)),
      ...DOCK_NAV_STATE_IDS.map((state) => () => renderNav(state)),
      () => renderNearby(),
      () => renderTurnList(),
    ];
    for (const draw of draws) {
      const { container, unmount } = draw();
      expect(container.querySelectorAll('.fwm-dock-tab')).toHaveLength(5);
      unmount();
    }
  });

  it('lights one tab and only one', () => {
    const { container } = renderCollapsed('mesh-sync');
    const lit = Array.from(container.querySelectorAll('.fwm-dock-tab[data-fwm-active]'));

    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveTextContent('Mesh');
  });

  it.each(['map', 'exposure', 'mesh', 'lookup', 'more'] as const)(
    'calls onTab with %s when that tab is pressed',
    (key) => {
      const onTab = vi.fn();
      const { container } = renderCollapsed('idle', { onTab });
      fireEvent.click(container.querySelector(`.fwm-dock-tab[data-fwm-tab='${key}']`) as Element);

      expect(onTab).toHaveBeenCalledOnce();
      expect(onTab).toHaveBeenCalledWith(key);
    },
  );

  it('still calls onTab when the tab already lit is pressed', () => {
    /* `app/screenState.ts` treats re-selecting the screen you are on as a
       RESELECT -- no history push, subscribers notified, which is how the map
       recenters. The dock cannot tell recenter from navigate without owning a
       second copy of that rule, so it reports every press and the caller
       decides. A dock that swallowed this press would break recentering. */
    const onTab = vi.fn();
    const { container } = renderCollapsed('idle', { onTab });
    const active = container.querySelector('.fwm-dock-tab[data-fwm-active]');

    expect(active).toHaveTextContent('Map');
    fireEvent.click(active as Element);

    expect(onTab).toHaveBeenCalledOnce();
    expect(onTab).toHaveBeenCalledWith('map');
  });

  it('does not let a tab press open the pane it sits in', () => {
    /* The stretched target is the body's first child and the tab row is the
       pane's floor, outside it. A tab that also expanded would put a driver on
       EXPOSURE under 302px of camera list. */
    const onExpand = vi.fn();
    const { container } = renderCollapsed('dense', { onExpand });
    fireEvent.click(container.querySelector(".fwm-dock-tab[data-fwm-tab='mesh']") as Element);
    expect(onExpand).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * THE REPORT KEY
 * ------------------------------------------------------------------------ */

describe('the Report key', () => {
  it('is present in every state, and never inside the pane', () => {
    /* The spec laps it over the pane's top-right corner as a SIBLING. Inside
       the pane it would eat one of the three locked heights and put a sixth
       destination in a five-column grid. */
    for (const state of DOCK_COLLAPSED_STATE_IDS) {
      const { container, unmount } = renderCollapsed(state);
      const report = container.querySelector('.fwm-dock-report');

      expect(report).not.toBeNull();
      expect(report).toHaveAccessibleName();
      expect(report?.closest('.fwm-dock')).toBeNull();
      unmount();
    }
  });

  it('is not one of the five tabs', () => {
    const { container } = renderCollapsed('idle');
    const row = container.querySelector('.fwm-dock-tabs');

    expect(row?.querySelector('.fwm-dock-report')).toBeNull();
    expect(row?.querySelectorAll('button')).toHaveLength(5);
    expect(within(row as HTMLElement).queryByText(/report/i)).toBeNull();
  });

  it('calls onReport when pressed', () => {
    const onReport = vi.fn();
    const { container } = renderCollapsed('passing', { onReport });
    fireEvent.click(container.querySelector('.fwm-dock-report') as Element);
    expect(onReport).toHaveBeenCalledOnce();
  });
});

/* ------------------------------------------------------------------------ *
 * THE DETOUR KEY
 * ------------------------------------------------------------------------ */

describe('the detour key says what it does', () => {
  it('spells one sentence, and it is never a bare count', () => {
    /* Rule 7. `Around 3` names a quantity without saying what happens to it,
       and a driver reading four characters at 70mph gets a number and no verb. */
    expect(dockRerouteLabel(3)).toBe('Reroute around 3');
    expect(dockRerouteSpoken(1)).toBe('Reroute around 1 reader');
    expect(dockRerouteSpoken(9)).toBe('Reroute around 9 readers');
  });

  it('draws that sentence on the collapsed pane', () => {
    const onAction = vi.fn();
    const { container } = renderCollapsed(
      'dense',
      {},
      withDetourCount(DOCK_FIXTURES.dense, 9),
      onAction,
    );
    const key = container.querySelector("[data-fwm-action='around']");

    expect(key?.tagName).toBe('BUTTON');
    expect(key).toHaveTextContent('Reroute around 9');
    expect(key).toHaveAccessibleName(dockRerouteSpoken(9));

    fireEvent.click(key as Element);
    expect(onAction).toHaveBeenCalledExactlyOnceWith('around');
  });

  it('draws the same sentence on the navigation pane', () => {
    const { container } = renderNav('camera-on-route');
    const key = container.querySelector("[data-fwm-action='around']");
    expect(key).toHaveTextContent(dockRerouteLabel(1));
  });

  it('draws the same sentence in the nearby sheet', () => {
    const { container } = renderNearby();
    const key = container.querySelector("[data-fwm-action='around']");
    expect(key).toHaveTextContent(dockRerouteLabel(9));
  });

  it('is absent everywhere once there is no count', () => {
    /* A KEY OFFERING TO ROUTE AROUND NOTHING IS A KEY THAT REFUSES. All five of
       `planDriveDetour`'s refusals land here, and the answer to all five is
       that the affordance is not drawn rather than drawn and apologetic. */
    const collapsed = renderCollapsed('dense', {}, withDetourCount(DOCK_FIXTURES.dense, null));
    expect(collapsed.container.querySelector("[data-fwm-action='around']")).toBeNull();
    collapsed.unmount();

    const { around: _dropped, ...noCount } = NAV_FIXTURE['camera-on-route'];
    const nav = renderNav('camera-on-route', {}, noCount);
    expect(nav.container.querySelector("[data-fwm-action='around']")).toBeNull();
    nav.unmount();

    const { around: _also, ...noOffer } = NEARBY;
    const sheet = renderNearby({}, vi.fn(), noOffer);
    expect(sheet.container.querySelector("[data-fwm-action='around']")).toBeNull();
  });

  it('deletes the field rather than blanking it', () => {
    /* ABSENT, NOT UNDEFINED. Every pane draws the key on `!== undefined`, and
       `exactOptionalPropertyTypes` makes the two spellings different types --
       so this asserts the key is GONE from the object, not set to nothing. */
    const stripped = withDetourCount(DOCK_FIXTURES.dense, null);

    expect('around' in stripped).toBe(false);
    /* And nothing else on the state moved: the exposure card still says how
       many readers are within two miles, which is a fact about the road rather
       than an offer about a route. */
    expect(stripped.count).toBe(DOCK_FIXTURES.dense.count);
    expect(stripped.statusText).toBe(DOCK_FIXTURES.dense.statusText);
  });

  it('reads the count it was given, not the one the state counts', () => {
    /* Fourteen readers within two miles, nine of them on the line a detour
       would take. The numeral and the key disagree, and that is correct. */
    const { container } = renderCollapsed('dense', {}, withDetourCount(DOCK_FIXTURES.dense, 3));

    expect(container.querySelector("[data-fwm-action='around']")).toHaveTextContent(
      'Reroute around 3',
    );
    expect(screen.getByText(String(DOCK_FIXTURES.dense.count))).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * THE DENSITY RAMP
 * ------------------------------------------------------------------------ */

describe('colour never travels alone', () => {
  it.each([
    [0, 'clear'],
    [1, 'low'],
    [5, 'low'],
    [6, 'moderate'],
    [12, 'moderate'],
    [13, 'high'],
    [60, 'high'],
  ] as const)('puts %i in the %s tier', (count, tier) => {
    /* B2's own boundaries, and there is deliberately no fifth tier: a downtown
       grid reading sixty still says high, because escalating past it would cost
       a hue that alerting needs. */
    expect(dockDensityTier(count)).toBe(tier);
  });

  it('stamps the tier for the colour and prints the word beside it', () => {
    const { container } = renderCollapsed('dense');
    const body = container.querySelector('.fwm-dock-body');
    const tier = dockDensityTier(DOCK_FIXTURES.dense.count ?? 0);

    expect(body).toHaveAttribute('data-fwm-density', tier);
    expect(container.querySelector('.fwm-dock-tier')).toHaveTextContent(DOCK_TIER_WORD[tier]);
  });

  it('carries the word into the sheet the count opens', () => {
    const { container } = renderNearby();
    expect(container.querySelector('.fwm-dock-tier')).toHaveTextContent(
      DOCK_TIER_WORD[dockDensityTier(NEARBY.count)],
    );
  });

  it('never runs the ramp on a count that is not cameras', () => {
    /* ABUSE ZONE's three sourced misconduct reports sit in the same 30px slot
       as the exposure count, and they are an accountability reading. Running
       the ramp on them would paint an accountability number in the density hue
       and print `exposure low` under the words `abuse reports` -- hue carrying
       two meanings, and a tier word that is not about the thing beside it. */
    const { container } = renderCollapsed('abuse-zone');

    expect(container.querySelector('.fwm-dock-body')).not.toHaveAttribute('data-fwm-density');
    expect(container.querySelector('.fwm-dock-tier')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * THE SHEETS
 * ------------------------------------------------------------------------ */

describe('the sheets', () => {
  it('opens a reader from the nearby list', () => {
    const onPick = vi.fn();
    const { container } = renderNearby({}, onPick);
    const rows = Array.from(container.querySelectorAll('.fwm-dock-row'));

    expect(rows).toHaveLength(NEARBY.nearby.length);
    fireEvent.click(rows[0] as Element);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('n1');
  });

  it('keeps the maneuver row it expanded from, rather than drawing a second one', () => {
    /* F1 grows a list UNDER the row and changes nothing about it. Drawing it
       twice is how an expanded sheet ends up half a pixel or one weight away
       from the row it came from. */
    const { container } = renderTurnList();

    expect(container.querySelector('.fwm-dock-maneuver')).not.toBeNull();
    expect(container.querySelectorAll('.fwm-dock-list [class*="fwm-dock-row"]')).toHaveLength(
      TURN_LIST.steps.length,
    );
  });
});

/* ------------------------------------------------------------------------ *
 * THE STRINGS
 * ------------------------------------------------------------------------ */

/** Every string a collapsed fixture puts on screen, in no particular slot. */
function renderedStrings(data: DockData): readonly string[] {
  const out: string[] = [];
  const add = (value: string | undefined): void => {
    if (value !== undefined) out.push(value);
  };

  add(data.statusText);
  add(data.statusTrailing);
  add(data.distance);
  add(data.figure);
  add(data.subline);
  add(data.secondaryText);
  add(data.secondaryTrailing);
  add(data.keyLabel);
  if (data.count !== undefined) out.push(String(data.count));

  return out;
}

describe('the spec strings', () => {
  it.each(DOCK_COLLAPSED_STATE_IDS)('%s renders what its fixture carries', (state) => {
    renderCollapsed(state);
    const data = DOCK_FIXTURES[state];
    /* THE COLLAPSED PANE HAS FOUR TEXT SLOTS AND SOME STATES CARRY MORE
       CANDIDATES THAN THAT -- `BrowseRow.sentences` spends them in a fixed
       order and the surplus truncates rather than growing the row, which is
       rule 5. So this asserts nothing is INVENTED and the lede is drawn, not
       that every candidate found a slot. */
    const drawn = renderedStrings(data).filter(
      (text) => screen.queryAllByText(text).length > 0,
    );
    expect(drawn.length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent('undefined');
  });

  it('joins the two lines of UNDER SURVEILLANCE into the one the v3 lede draws', () => {
    /* V2 hard-broke it at 26px because it drew a 71px row. The 44px lede sets
       the whole phrase at 19, and the tuple survives in the data so the two
       spellings cannot drift. */
    renderCollapsed('passing');
    const lines = DOCK_FIXTURES.passing.figureLines;

    expect(lines).toBeDefined();
    expect(screen.getByText(`${lines?.[0] ?? ''} ${lines?.[1] ?? ''}`)).toBeInTheDocument();
  });

  it('lights Map everywhere except MESH SYNC, which lights Mesh', () => {
    const lit = DOCK_COLLAPSED_STATE_IDS.map(
      (state) => [state, DOCK_FIXTURE_TAB[state]] as const,
    );
    expect(lit.filter(([, tab]) => tab !== 'map')).toStrictEqual([['mesh-sync', 'mesh']]);
  });
});

/* ------------------------------------------------------------------------ *
 * THE SPEC'S OWN PUNCTUATION
 * ------------------------------------------------------------------------ */

/**
 * WHY THIS BLOCK EXISTS, AND WHAT IT CANNOT DO.
 *
 * `DOCK_FIXTURES` is the spec page transcribed once, and the tests above render
 * against it -- which means a fixture that drifts from `dockv3.dc.html` drags
 * the assertion along with it and stays green. The obvious fix, transcribing
 * the states a second time here, is the exact thing the fixture exists to
 * prevent; and the spec page is not in this repo, so no test may read it.
 *
 * So this asserts the CLASS of drift instead: the character-level rules the
 * transcription flags as gotchas, none of which restates a string.
 */
const MIDDLE_DOT = String.fromCodePoint(0x00b7);
const EM_DASH = String.fromCodePoint(0x2014);
const PLUS_MINUS = String.fromCodePoint(0x00b1);

const ALL_FIXTURE_TEXT: readonly string[] = DOCK_COLLAPSED_STATE_IDS.flatMap((state) => [
  ...renderedStrings(DOCK_FIXTURES[state]),
  ...(DOCK_FIXTURES[state].figureLines ?? []),
]);

describe("the spec's own punctuation", () => {
  it('joins clauses with the middle dot and never with a hyphen or a pipe', () => {
    expect(ALL_FIXTURE_TEXT.filter((text) => /\s[-|]\s/.test(text))).toStrictEqual([]);
  });

  it('spaces the middle dot and the em dash on both sides', () => {
    const offenders = ALL_FIXTURE_TEXT.filter((text) =>
      new RegExp(`[${MIDDLE_DOT}${EM_DASH}]`).test(
        text.split(` ${MIDDLE_DOT} `).join('').split(` ${EM_DASH} `).join(''),
      ),
    );
    expect(offenders).toStrictEqual([]);
  });

  it('keeps the thousands separator on the mapped-reader count', () => {
    expect(DOCK_FIXTURES.idle.statusTrailing).toMatch(/^\d{1,3}(?:,\d{3})+ /);
  });

  it('writes the accuracy with a real plus-minus sign', () => {
    expect((DOCK_FIXTURES['gps-weak'].statusTrailing ?? '').startsWith(PLUS_MINUS)).toBe(true);
  });

  it('is sentence case, never a tracked all-caps label', () => {
    /* Uppercase is reserved for 11-12px tracked labels and the dock paints
       none: even the 11px tab labels are drawn `Map`, not `MAP`. */
    const shouting = ALL_FIXTURE_TEXT.filter((text) => /[A-Z]/.test(text) && !/[a-z]/.test(text));
    expect(shouting).toStrictEqual([]);
  });

  it('carries no string that is empty or padded', () => {
    expect(ALL_FIXTURE_TEXT.filter((text) => text.trim() !== text || text === '')).toStrictEqual(
      [],
    );
  });

  it('gives every collapsed state something to say', () => {
    const silent = DOCK_COLLAPSED_STATE_IDS.filter(
      (state) =>
        renderedStrings(DOCK_FIXTURES[state]).length === 0 &&
        DOCK_FIXTURES[state].figureLines === undefined,
    );
    expect(silent).toStrictEqual([]);
  });
});
