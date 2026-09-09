/**
 * THE NAVIGATION FAMILY AND THE EXPANDED PANE, tested at their own seam.
 *
 * `dock.test.tsx` renders `Dock` and asks what a state puts on screen. This
 * file renders the bodies directly, because what it pins is not what any one
 * state says -- it is that all six navigation states say it in the SAME BOX.
 * V2 shipped one `navigating` row; v3 replaces it with six, and the entire
 * argument for six is that a driver mid-turn never sees the surface move. A
 * test that renders them one at a time through the shell cannot see that.
 *
 * WHAT IS BEING PINNED, in one sentence each.
 *
 *   ONE SKELETON.      All six draw exactly one maneuver row and one footer,
 *                      and no state adds a box of its own. The day a seventh
 *                      layout appears this goes red before it reaches a phone.
 *   ONE VERB EACH.     Six states, six actions, and never two keys in a
 *                      footer. A driver mid-turn holds one choice.
 *   THE WHOLE VERB.    Every detour key reads `Reroute around N`. A bare
 *                      `Around N` names a quantity without saying what happens
 *                      to it, and it shipped once.
 *   THE KEY DOES NOT   V3 makes the whole pane the tap target, so the one key
 *   OPEN THE PANE.     inside it has to stop the press it sits in.
 *   THE TILE IS DEAD.  A static inline drawing, sized 48 in a navigation row
 *                      and 56 in a drive row, and never a live map instance --
 *                      which is exactly what the build this replaces put in a
 *                      52px thumbnail.
 *   THE WORD RIDES     The density tier is never carried by colour alone.
 *   WITH THE COLOUR.
 *   NO DELETED CHROME. No grabber, no expand chevron, no tab row above the
 *                      divider, in any of the nine bodies.
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DOCK_NAV_STATE_IDS, DriveRows, NavigationBody, dockRerouteLabel } from './DriveRows.tsx';
import type { DockNavData, DockNavStateId } from './DriveRows.tsx';
import { dockDensityTier, ExpandedPanel } from './ExpandedPanel.tsx';
import type {
  DockNearbyData,
  DockRouteChoiceData,
  DockTurnListData,
} from './ExpandedPanel.tsx';
import { DOCK_INSET_DRIVE, DOCK_INSET_NAV, MapInset } from './MapInset.tsx';

/* ------------------------------------------------------------------------ *
 * THE SPEC'S OWN VALUES
 *
 * Section E and section F, transcribed once. Punctuation is the spec page's:
 * `·` is U+00B7 MIDDLE DOT and the em dash in E4 is U+2014 with a space either
 * side. These are FIXTURES -- the spec's example data -- and they belong in
 * `dockState.ts` beside `DOCK_FIXTURES` once the six ids land there.
 * ------------------------------------------------------------------------ */

const NAV_FIXTURES: Readonly<Record<DockNavStateId, DockNavData>> = {
  'route-proposed': {
    figure: '18',
    unit: 'min · 7.2 mi',
    sub: 'avoids 3 of 5 cameras',
    footer: '2 routes compared · pull up to switch',
  },
  'turn-imminent': {
    figure: '500',
    unit: 'ft',
    sub: 'Right onto W 119th St',
    footer: 'then 1.2 mi to Metcalf Ave',
    turn: 'right',
  },
  'camera-on-route': {
    figure: '0.4',
    unit: 'mi',
    sub: 'Right onto W 119th St',
    footer: '600 ft · Flock at the turn',
    around: 1,
    turn: 'right',
  },
  rerouting: {
    title: 'Finding a way around',
    sub: 'holding your destination',
    footer: 'keep driving — old route stays live',
  },
  'off-route': {
    title: 'Off route',
    sub: '0.3 mi from W 119th St',
    footer: 'still watching 4 cameras nearby',
  },
  arrived: {
    title: 'Arrived',
    sub: '11800 Overland Pkwy',
    footer: '18 min · avoided 3, passed 2',
  },
};

/** The verb each state offers, and there is exactly one. */
const VERB: Readonly<Record<DockNavStateId, string>> = {
  'route-proposed': 'Start',
  'turn-imminent': 'End',
  'camera-on-route': 'Reroute around 1',
  rerouting: 'Cancel',
  'off-route': 'Recalculate',
  arrived: 'Save drive',
};

/** The four states that draw a tile, and the two that do not. */
const WITH_INSET: readonly DockNavStateId[] = [
  'route-proposed',
  'turn-imminent',
  'camera-on-route',
  'off-route',
];

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
    {
      id: 'n3',
      where: 'W 123rd St & Grant St',
      who: 'Private · retail lot',
      owner: 'private',
      distance: '1.2 mi',
    },
    {
      id: 'n4',
      where: 'Indian Creek Pkwy',
      who: 'Unverified report · 3 confirms',
      owner: 'unverified',
      distance: '1.6 mi',
    },
  ],
};

const TURN_LIST: DockTurnListData = {
  nav: {
    figure: '0.4',
    unit: 'mi',
    sub: 'Right onto W 119th St',
    footer: '18 min · 7.2 mi · 2 cameras on route',
    turn: 'right',
  },
  steps: [
    { id: 's1', distance: '0.4 mi', road: 'W 119th St', note: '1 camera at Antioch', tone: 'alert' },
    { id: 's2', distance: '1.2 mi', road: 'Metcalf Ave', note: 'clear', tone: 'quiet' },
    { id: 's3', distance: '3.8 mi', road: 'W 103rd St', note: '1 camera, PD fixed', tone: 'alert' },
    {
      id: 's5',
      distance: '7.2 mi',
      road: '11800 Overland Pkwy',
      note: 'destination',
      tone: 'clear',
    },
  ],
};

const ROUTE_CHOICE: DockRouteChoiceData = {
  nav: {
    figure: '18',
    unit: 'min · 7.2 mi',
    sub: 'avoids 3 of 5 cameras',
    footer: 'pick a route',
  },
  routes: [
    { id: 'r1', headline: '18 min · avoids 3 of 5', detail: '7.2 mi · recommended', chosen: true },
    { id: 'r2', headline: '16 min · passes all 5', detail: '6.8 mi · 2 min faster', chosen: false },
  ],
};

function renderNav(state: DockNavStateId, onAction = vi.fn()) {
  return render(<DriveRows state={state} data={NAV_FIXTURES[state]} onAction={onAction} />);
}

/* ------------------------------------------------------------------------ *
 * 1. ONE SKELETON, SIX STATES
 * ------------------------------------------------------------------------ */

describe('the navigation family', () => {
  it.each(DOCK_NAV_STATE_IDS)('draws %s on the one maneuver row and footer', (state) => {
    const { container } = renderNav(state);

    /* 12 pad + 56 maneuver + 32 footer + 4 pad. Exactly one of each, in every
       one of the six -- the spec's whole claim is that proposing, rerouting,
       going off route and arriving all fill the same 104px. */
    expect(container.querySelectorAll('.fwm-dock-maneuver')).toHaveLength(1);
    expect(container.querySelectorAll('.fwm-dock-footer')).toHaveLength(1);
    /* AND NO SPACER. The 12 above and the 4 below are `.fwm-dock-body`'s own
       padding in `dock.css`; a tail element here would draw four pixels twice
       and make the pane 174. */
    expect(container.querySelector('.fwm-dock-tail')).toBeNull();
  });

  it.each(DOCK_NAV_STATE_IDS)('offers exactly one action in %s, and it is the spec’s', (state) => {
    const { container, getByRole } = renderNav(state);

    expect(container.querySelectorAll('.fwm-dock-footer button')).toHaveLength(1);
    expect(getByRole('button', { name: VERB[state] })).toBeInTheDocument();
  });

  it.each(DOCK_NAV_STATE_IDS)('reads %s out of the data and never out of the state', (state) => {
    const { getByText } = renderNav(state);
    const data = NAV_FIXTURES[state];

    if (data.figure !== undefined) expect(getByText(data.figure)).toBeInTheDocument();
    if (data.title !== undefined) expect(getByText(data.title)).toBeInTheDocument();
    if (data.sub !== undefined) expect(getByText(data.sub)).toBeInTheDocument();
    if (data.footer !== undefined) expect(getByText(data.footer)).toBeInTheDocument();
  });

  it('sizes the readout off the shape rather than off the state', () => {
    /* MEASURED is a number with a unit on its baseline; TITLED is a phrase
       standing where the number would be. Two shapes, no third, and the
       stylesheet needs to be able to see which without knowing the state. */
    const measured = renderNav('turn-imminent');
    expect(measured.container.querySelector('.fwm-dock-stack')).toHaveAttribute(
      'data-fwm-shape',
      'measured',
    );

    const titled = renderNav('arrived');
    expect(titled.container.querySelector('.fwm-dock-stack')).toHaveAttribute(
      'data-fwm-shape',
      'titled',
    );
  });
});

/* ------------------------------------------------------------------------ *
 * 2. THE DELETED CHROME STAYS DELETED
 * ------------------------------------------------------------------------ */

describe('what v3 removed', () => {
  it.each(DOCK_NAV_STATE_IDS)('draws no grabber, chevron or tab row in %s', (state) => {
    const { container } = renderNav(state);

    /* The chevron collided with the pane's corner and the grab bar duplicated
       the system gesture bar; the tab row moved to the shell, where a row that
       is byte-identical in nineteen states belongs. Reintroducing any of the
       three is a regression the handoff names twice. */
    expect(container.querySelector('.fwm-dock-grabber')).toBeNull();
    expect(container.querySelector('.fwm-dock-expand')).toBeNull();
    expect(container.querySelector('.fwm-dock-tabs')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * 3. THE DETOUR KEY SAYS WHAT IT DOES
 * ------------------------------------------------------------------------ */

describe('the detour key', () => {
  it('spells the whole verb, in both places that draw it', () => {
    expect(dockRerouteLabel(1)).toBe('Reroute around 1');
    expect(dockRerouteLabel(9)).toBe('Reroute around 9');

    const nav = renderNav('camera-on-route');
    expect(nav.getByRole('button', { name: 'Reroute around 1' })).toBeInTheDocument();

    const expanded = render(
      <ExpandedPanel view="nearby" data={NEARBY} onPick={vi.fn()} onAction={vi.fn()} />,
    );
    expect(expanded.getByRole('button', { name: 'Reroute around 9' })).toBeInTheDocument();
  });

  it.each([...DOCK_NAV_STATE_IDS, 'nearby' as const])('never says a bare Around in %s', (view) => {
    const { container } =
      view === 'nearby'
        ? render(<ExpandedPanel view="nearby" data={NEARBY} onPick={vi.fn()} onAction={vi.fn()} />)
        : renderNav(view);

    /* `Around 3` reads as a fragment: a preposition and a number, with nothing
       saying what happens to the number. The whole string is asserted rather
       than the label helper, so a second spelling introduced anywhere in the
       markup fails here. */
    expect(container.textContent).not.toMatch(/(^|[^e])Around \d/);
  });

  it('takes the key off the pane when the count is unknown', () => {
    /* A key offering to route around an unstated number of readers is a
       promise the dock cannot keep. Absent field, absent key -- not a blank
       face and not a zero. */
    const { around: _dropped, ...noCount } = NAV_FIXTURES['camera-on-route'];
    const { container } = render(
      <DriveRows state="camera-on-route" data={noCount} onAction={vi.fn()} />,
    );

    expect(container.querySelector('.fwm-dock-detour')).toBeNull();
    expect(container.querySelectorAll('.fwm-dock-footer button')).toHaveLength(0);
  });

  it('does not open the pane it sits inside', () => {
    /* The whole pane is the tap target in v3. Without `stopPropagation` the
       driver who asks for a detour also expands the dock, and the two gestures
       are one press apart. */
    const onPane = vi.fn();
    const onAction = vi.fn();
    const { getByRole } = render(
      <div onClick={onPane}>
        <DriveRows
          state="camera-on-route"
          data={NAV_FIXTURES['camera-on-route']}
          onAction={onAction}
        />
      </div>,
    );

    fireEvent.click(getByRole('button', { name: 'Reroute around 1' }));

    expect(onAction).toHaveBeenCalledExactlyOnceWith('around');
    expect(onPane).not.toHaveBeenCalled();
  });

  it.each(DOCK_NAV_STATE_IDS)('reports %s’s own action and no other', (state) => {
    const onAction = vi.fn();
    const { getByRole } = renderNav(state, onAction);

    fireEvent.click(getByRole('button', { name: VERB[state] }));

    expect(onAction).toHaveBeenCalledOnce();
  });
});

/* ------------------------------------------------------------------------ *
 * 4. THE MAP INSET IS A DRAWING
 * ------------------------------------------------------------------------ */

describe('the map inset', () => {
  it.each(WITH_INSET)('draws a static tile in %s', (state) => {
    const { container } = renderNav(state);
    const inset = container.querySelector('.fwm-dock-inset');

    expect(inset).not.toBeNull();
    /* STATIC, AND THAT IS THE POINT. One inline `<svg>`, no canvas, no
       `<img>`, no map container -- the build this replaces put a live MiniMap
       in a 52px thumbnail, which is a MapLibre instance and a tile fetch per
       dock row on a phone already drawing the real map behind the dock. */
    expect(inset?.querySelectorAll('svg')).toHaveLength(1);
    expect(inset?.querySelector('canvas')).toBeNull();
    expect(inset?.querySelector('img')).toBeNull();
    expect(container.querySelector('.fwm-minimap')).toBeNull();
  });

  it.each(['rerouting', 'arrived'] as const)('draws none in %s, which has nowhere to point', (state) => {
    const { container } = renderNav(state);
    expect(container.querySelector('.fwm-dock-inset')).toBeNull();
  });

  it('is 48 in a navigation row and 56 in a drive row, and nothing between', () => {
    expect(DOCK_INSET_NAV).toBe(48);
    expect(DOCK_INSET_DRIVE).toBe(56);

    const nav = renderNav('turn-imminent');
    const tile = nav.container.querySelector('.fwm-dock-inset svg');
    expect(tile).toHaveAttribute('width', String(DOCK_INSET_NAV));
    expect(tile).toHaveAttribute('viewBox', `0 0 ${String(DOCK_INSET_NAV)} ${String(DOCK_INSET_NAV)}`);

    const drive = render(<MapInset variant="camera" size={DOCK_INSET_DRIVE} />);
    expect(drive.container.querySelector('svg')).toHaveAttribute(
      'width',
      String(DOCK_INSET_DRIVE),
    );
  });

  it('points the cone at the facing it was given', () => {
    /* The one number in the tile that becomes geometry. A cone that ignores
       its bearing is a picture of a reader watching the wrong side of the
       road, and nothing about it looks broken. */
    const east = render(<MapInset variant="camera" size={DOCK_INSET_DRIVE} facingDeg={90} />);
    const west = render(<MapInset variant="camera" size={DOCK_INSET_DRIVE} facingDeg={270} />);

    const cone = (r: ReturnType<typeof render>) =>
      r.container.querySelector('.fwm-dock-inset-cone')?.getAttribute('d');

    expect(cone(east)).not.toBeUndefined();
    expect(cone(east)).not.toBe(cone(west));
  });

  it('mirrors the corner for a left turn rather than drawing a right one', () => {
    const right = render(<MapInset variant="turn" size={DOCK_INSET_NAV} turn="right" />);
    const left = render(<MapInset variant="turn" size={DOCK_INSET_NAV} turn="left" />);

    const route = (r: ReturnType<typeof render>) =>
      r.container.querySelector('.fwm-dock-inset-route')?.getAttribute('d');

    expect(route(right)).toBe('M24 48V22H48');
    expect(route(left)).toBe('M24 48V22H0');
  });

  it('says nothing to a screen reader that the row above it has not said', () => {
    const { container } = render(<MapInset variant="route" size={DOCK_INSET_NAV} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

/* ------------------------------------------------------------------------ *
 * 5. THE MANEUVER MARK
 * ------------------------------------------------------------------------ */

describe('the maneuver arrow', () => {
  it.each(['right', 'left'] as const)('draws the %s turn', (turn) => {
    const { container } = render(
      <NavigationBody
        state="turn-imminent"
        data={{ ...NAV_FIXTURES['turn-imminent'], turn }}
        onAction={vi.fn()}
      />,
    );

    expect(container.querySelector(`[data-fwm-icon="maneuver-${turn}"]`)).not.toBeNull();
  });

  it.each(['up', 'end'] as const)('draws no mark for %s, which the spec never drew', (turn) => {
    /* A turn the spec never drew renders nothing rather than the wrong thing.
       The row starts at the readout and loses a picture; a borrowed arrow
       would lose the driver a turn. */
    const { container } = render(
      <NavigationBody
        state="turn-imminent"
        data={{ ...NAV_FIXTURES['turn-imminent'], turn }}
        onAction={vi.fn()}
      />,
    );

    expect(container.querySelector('.fwm-dock-lead')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * 6. THE DENSITY RAMP
 * ------------------------------------------------------------------------ */

describe('the density ramp', () => {
  it.each([
    [0, 'clear'],
    [1, 'low'],
    [5, 'low'],
    [6, 'moderate'],
    [12, 'moderate'],
    [13, 'high'],
    [60, 'high'],
  ] as const)('puts %i in the %s tier', (count, tier) => {
    /* No fifth tier. A downtown grid reading 60 still says high -- escalating
       past it would cost a hue that alerting needs. */
    expect(dockDensityTier(count)).toBe(tier);
  });

  it('never lets the colour travel alone', () => {
    const { container, getByText } = render(
      <ExpandedPanel view="nearby" data={NEARBY} onPick={vi.fn()} onAction={vi.fn()} />,
    );

    /* The tier is on the number AND spelled beside it. Hue says how exposed
       this area is, and a driver who cannot use hue reads the same thing. */
    expect(getByText('exposure high')).toBeInTheDocument();
    expect(getByText('exposure high')).toHaveClass('fwm-dock-tier');
    /* AND THE HUE IS NOT SET HERE. `dock.css` scopes the ramp to
       `.fwm-dock-body[data-fwm-density]`, so the shell tags the body off the
       same function and one number colours the figure, the glyph and the word
       together. A second attribute on the head would be a second source. */
    expect(container.querySelector('[data-fwm-density]')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * 7. THE THREE EXPANDED VIEWS
 * ------------------------------------------------------------------------ */

describe('the expanded pane', () => {
  it('grows the nearby list under the collapsed header, without redrawing it', () => {
    const { container, getByText } = render(
      <ExpandedPanel view="nearby" data={NEARBY} onPick={vi.fn()} onAction={vi.fn()} />,
    );

    expect(getByText('14')).toBeInTheDocument();
    expect(getByText('cameras within 2 mi')).toBeInTheDocument();
    /* The collapsed pane's own 84px head, drawn out of its own classes rather
       than out of copies of them, with the list flexing under it. */
    expect(container.querySelector('.fwm-dock-head')).toHaveAttribute('data-fwm-head', 'nearby');
    expect(container.querySelectorAll('.fwm-dock-lede')).toHaveLength(1);
    expect(container.querySelectorAll('.fwm-dock-meta')).toHaveLength(1);
    expect(container.querySelectorAll('[data-fwm-list="nearby"] .fwm-dock-row')).toHaveLength(4);
  });

  it('opens a reader rather than drawing a chevron that does nothing', () => {
    const onPick = vi.fn();
    const { container } = render(
      <ExpandedPanel view="nearby" data={NEARBY} onPick={onPick} onAction={vi.fn()} />,
    );
    const rows = container.querySelectorAll('[data-fwm-list="nearby"] .fwm-dock-row');

    expect(rows[0]?.tagName).toBe('BUTTON');
    fireEvent.click(rows[0] as Element);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('n1');
  });

  it('carries operator identity only as the dot, and only where a name sits beside it', () => {
    const { container } = render(
      <ExpandedPanel view="nearby" data={NEARBY} onPick={vi.fn()} onAction={vi.fn()} />,
    );
    const dots = [...container.querySelectorAll('.fwm-dock-dot')].map((d) =>
      d.getAttribute('data-fwm-owner'),
    );

    expect(dots).toEqual(['flock', 'police', 'private', 'unverified']);
  });

  it('keeps the maneuver row and the footer exactly where they were', () => {
    /* F1 is the navigation dock with a list grown underneath. Same skeleton,
       same one function -- so the header cannot drift half a pixel from the
       170px row it expanded from. */
    const { container, getByRole } = render(
      <ExpandedPanel view="turn-list" data={TURN_LIST} onStep={vi.fn()} onAction={vi.fn()} />,
    );

    expect(container.querySelectorAll('.fwm-dock-maneuver')).toHaveLength(1);
    expect(container.querySelectorAll('.fwm-dock-footer')).toHaveLength(1);
    expect(getByRole('button', { name: 'End' })).toBeInTheDocument();
    /* 12 + 56 + 32 of head, and the list takes the rest of the 302. */
    expect(container.querySelector('.fwm-dock-head')).toHaveAttribute(
      'data-fwm-head',
      'navigating',
    );
  });

  it('gives every step its camera count in the route’s own hue', () => {
    const { container, getByText } = render(
      <ExpandedPanel view="turn-list" data={TURN_LIST} onStep={vi.fn()} onAction={vi.fn()} />,
    );

    expect(getByText('1 camera at Antioch')).toHaveAttribute('data-fwm-tone', 'alert');
    expect(getByText('clear')).toHaveAttribute('data-fwm-tone', 'quiet');
    expect(getByText('destination')).toHaveAttribute('data-fwm-tone', 'clear');
    /* V3 drops the per-step arrow: the row leads with its distance instead. */
    expect(container.querySelector('[data-fwm-icon^="turn-"]')).toBeNull();
  });

  it('offers the faster route without hiding it and without scolding it', () => {
    const onChoose = vi.fn();
    const { getAllByRole, getByText } = render(
      <ExpandedPanel view="route-choice" data={ROUTE_CHOICE} onChoose={onChoose} onAction={vi.fn()} />,
    );
    const options = getAllByRole('radio');

    expect(options).toHaveLength(2);
    expect(options[0]).toBeChecked();
    expect(options[1]).not.toBeChecked();
    /* It states its cost in cameras and lets the driver decide. */
    expect(getByText('16 min · passes all 5')).toBeInTheDocument();

    fireEvent.click(options[1] as Element);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('r2');
  });

  it.each(['nearby', 'turn-list', 'route-choice'] as const)(
    'draws one list and one divider in %s, and no tab row',
    (view) => {
      const { container } =
        view === 'nearby'
          ? render(<ExpandedPanel view="nearby" data={NEARBY} onPick={vi.fn()} onAction={vi.fn()} />)
          : view === 'turn-list'
            ? render(
                <ExpandedPanel view="turn-list" data={TURN_LIST} onStep={vi.fn()} onAction={vi.fn()} />,
              )
            : render(
                <ExpandedPanel
                  view="route-choice"
                  data={ROUTE_CHOICE}
                  onChoose={vi.fn()}
                  onAction={vi.fn()}
                />,
              );

      expect(container.querySelectorAll('.fwm-dock-list')).toHaveLength(1);
      expect(container.querySelectorAll('.fwm-dock-head')).toHaveLength(1);
      /* THE RULE ABOVE THE LIST IS THE LIST'S OWN `border-top`. A hairline
         element as well would put two rules a pixel apart under every header. */
      expect(container.querySelector('.fwm-dock-divider')).toBeNull();
      expect(container.querySelector('.fwm-dock-tabs')).toBeNull();
      expect(container.querySelector('.fwm-dock-grabber')).toBeNull();
    },
  );
});
