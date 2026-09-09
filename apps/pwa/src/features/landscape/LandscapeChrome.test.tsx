/**
 * LANDSCAPE MODE, RENDERED. Behaviour only -- the markup was copied from a file
 * that renders at real size, and a test that re-asserted a class name would be
 * asserting the transcription rather than the product.
 *
 * The claims, and each is a rule from the spec or the brief that has a way of
 * going wrong silently:
 *
 *   ONE TAB COMPONENT, ONE ACTIVE-KEY RULE. The rail is `TabRow`, not a second
 *   nav, and the five tabs are the five `DOCK_TABS` in order with Exposure
 *   shortened to Expose.
 *   MONITOR RENDERS NO TOP SLOT, and navigation renders one.
 *   SLOT GEOMETRY DOES NOT MOVE WITH THE MODE -- both are the same two boxes.
 *   THE REPORT KEY IS THE SHARED COMPONENT, so its two gestures cannot fork.
 *   THERE IS NO SPEED GATE, and nothing on this surface is ever disabled.
 *   AN UNCOMPUTED COUNT IS PAINTED AS A DASH.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DOCK_TABS } from '../dock/dockState.ts';
import {
  LANDSCAPE_COLLAPSE,
  LANDSCAPE_EXPAND,
  LANDSCAPE_MARK,
  LANDSCAPE_RIGHT_RAIL_LABEL,
  LANDSCAPE_SEARCH,
  LandscapeChrome,
} from './LandscapeChrome.tsx';
import type { LandscapeChromeProps } from './LandscapeChrome.tsx';
import { COUNT_UNKNOWN, counted } from '../search/panel.ts';
import type { LandscapeSlots } from './slots.ts';

const MONITOR: LandscapeSlots = {
  mode: 'monitor',
  top: null,
  band: null,
  bottom: {
    kind: 'monitor',
    count: counted(14),
    statusText: 'cameras within 2 mi',
    subline: 'nearest 0.4 mi',
    around: 9,
  },
};

const NAVIGATION: LandscapeSlots = {
  mode: 'navigation',
  top: { figure: '0.4', unit: 'mi', sub: 'Right onto W 119th St', turn: 'right' },
  band: { text: 'ft · Flock on route', figure: '900', around: 9 },
  bottom: {
    kind: 'navigation',
    arrival: '10:03',
    minutes: '18',
    onRoute: counted(2),
    remaining: '7.2 mi remaining',
  },
};

function draw(overrides: Partial<LandscapeChromeProps> = {}): ReturnType<typeof render> {
  return render(
    <LandscapeChrome
      activeTab="map"
      onTab={() => undefined}
      slots={MONITOR}
      density="high"
      expanded={false}
      onExpand={() => undefined}
      onCollapse={() => undefined}
      markSrc="/brand/darkroute-logo.png"
      {...overrides}
    />,
  );
}

/* ------------------------------------------------------------------------ *
 * THE RAIL
 * ------------------------------------------------------------------------ */

describe('the left rail is the tab row, turned', () => {
  it('draws the same five tabs in the same order', () => {
    draw();
    const nav = screen.getByRole('navigation', { name: 'Dock' });
    const tabs = within(nav).getAllByRole('button');
    expect(tabs).toHaveLength(DOCK_TABS.length);
    expect(tabs.map((tab) => tab.dataset['fwmTab'])).toEqual(
      DOCK_TABS.map((tab) => tab.key),
    );
  });

  /**
   * "labels shortened to fit -- Expose, not Exposure" -- section D. It is a
   * WORD the owner chose and not a truncation, so it is also what a screen
   * reader says: two names for one key would be worse than a long one.
   */
  it('shortens Exposure to Expose and leaves the other four alone', () => {
    draw();
    const nav = screen.getByRole('navigation', { name: 'Dock' });
    expect(within(nav).getByRole('button', { name: 'Expose' })).toBeTruthy();
    expect(within(nav).queryByRole('button', { name: 'Exposure' })).toBeNull();
    for (const label of ['Map', 'Mesh', 'Lookup', 'More']) {
      expect(within(nav).getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('lights exactly one tab, and it is the one the caller named', () => {
    draw({ activeTab: 'mesh' });
    const lit = screen
      .getByRole('navigation', { name: 'Dock' })
      .querySelectorAll('[data-fwm-active]');
    expect(lit).toHaveLength(1);
    expect((lit[0] as HTMLElement).dataset['fwmTab']).toBe('mesh');
  });

  it('hands the press back by key', () => {
    const onTab = vi.fn();
    draw({ onTab });
    fireEvent.click(screen.getByRole('button', { name: 'Lookup' }));
    expect(onTab).toHaveBeenCalledWith('lookup');
  });

  /** Section B: "Logo only, 42 px". The wordmark and the read count do not fit. */
  it('draws the mark and no wordmark', () => {
    const { container } = draw();
    expect(screen.getByAltText(LANDSCAPE_MARK)).toBeTruthy();
    expect(container.querySelector('.fwm-topbar-wordmark')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * THE TWO SLOTS
 * ------------------------------------------------------------------------ */

describe('the mode changes the occupant and not the box', () => {
  /**
   * "the top slot is not empty, it does not exist". An 84px element rendered
   * blank would still shadow the map and still have to be explained.
   */
  it('renders no top slot at all in monitor mode', () => {
    const { container } = draw();
    expect(container.querySelector('[data-fwm-slot="top"]')).toBeNull();
    expect(container.querySelector('[data-fwm-slot="bottom"]')).not.toBeNull();
  });

  it('renders both in navigation mode', () => {
    const { container } = draw({ slots: NAVIGATION, density: 'unknown' });
    expect(container.querySelector('[data-fwm-slot="top"]')).not.toBeNull();
    expect(container.querySelector('[data-fwm-slot="bottom"]')).not.toBeNull();
  });

  /**
   * SLOT GEOMETRY IS FIXED ACROSS BOTH MODES. Nothing here can assert a height
   * -- jsdom does not lay out and vitest runs with `css: false` -- so what is
   * asserted is that the bottom slot is THE SAME ELEMENT in both modes, taking
   * its size from one rule rather than from a per-mode variant.
   */
  it('draws the bottom slot from one selector in both modes', () => {
    const monitor = draw().container.querySelector('[data-fwm-slot="bottom"]');
    const navigation = draw({ slots: NAVIGATION }).container.querySelector(
      '[data-fwm-slot="bottom"]',
    );
    expect(monitor?.className).toBe(navigation?.className);
  });

  /** Section C: an alert "inserts a third 56 px band" -- a separate element. */
  it('draws the band as a third element beside the maneuver, not instead of it', () => {
    const { container } = draw({ slots: NAVIGATION });
    expect(screen.getByText('Right onto W 119th St')).toBeTruthy();
    expect(screen.getByText('ft · Flock on route')).toBeTruthy();
    expect(container.querySelectorAll('.fwm-ls-band')).toHaveLength(1);
  });

  it('draws no band where there is no reader on the line', () => {
    const { container } = draw({ slots: { ...NAVIGATION, band: null } });
    expect(container.querySelector('.fwm-ls-band')).toBeNull();
    expect(container.querySelector('[data-fwm-slot="top"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * THE COUNT
 * ------------------------------------------------------------------------ */

describe('the count', () => {
  it('paints the tier the caller measured, as an attribute rather than a hue', () => {
    const { container } = draw({ density: 'high' });
    expect(
      (container.querySelector('[data-fwm-slot="bottom"]') as HTMLElement).dataset[
        'fwmDensity'
      ],
    ).toBe('high');
  });

  /**
   * NEVER A FAKE ZERO. The dash is `features/search/panel.ts`'s, imported
   * rather than respelled -- there is one dash in this product.
   */
  it('paints a dash and not a zero for an uncomputed count', () => {
    const { container } = draw({
      slots: { ...MONITOR, bottom: { kind: 'monitor', count: COUNT_UNKNOWN } },
      density: 'unknown',
    });
    const figure = container.querySelector('.fwm-ls-count');
    expect(figure?.textContent).toBe('–');
    expect(figure?.textContent).not.toBe('0');
  });

  it('paints a measured zero, because zero is a real answer', () => {
    const { container } = draw({
      slots: { ...MONITOR, bottom: { kind: 'monitor', count: counted(0) } },
      density: 'clear',
    });
    expect(container.querySelector('.fwm-ls-count')?.textContent).toBe('0');
  });
});

/* ------------------------------------------------------------------------ *
 * THE EXPANDED PANEL
 * ------------------------------------------------------------------------ */

describe('expansion is a panel and not a sheet', () => {
  it('raises the panel from the bottom slot’s own line', () => {
    const onExpand = vi.fn();
    draw({ onExpand });
    fireEvent.click(screen.getByRole('button', { name: LANDSCAPE_EXPAND }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('replaces both slots rather than covering them', () => {
    const { container } = draw({ expanded: true, nearby: [] });
    expect(container.querySelector('.fwm-ls-panel')).not.toBeNull();
    expect(container.querySelector('[data-fwm-slot="bottom"]')).toBeNull();
    expect(container.querySelector('[data-fwm-slot="top"]')).toBeNull();
  });

  it('lists what it was handed and hands a press back by id', () => {
    const onPickNearby = vi.fn();
    draw({
      expanded: true,
      onPickNearby,
      nearby: [
        {
          id: 'cam-1',
          where: 'Antioch Rd & W 119th St',
          who: 'Flock · inter-agency shared',
          owner: 'flock',
          distance: '0.4 mi',
        },
      ],
    });
    fireEvent.click(screen.getByText('Antioch Rd & W 119th St'));
    expect(onPickNearby).toHaveBeenCalledWith('cam-1');
  });

  it('closes again', () => {
    const onCollapse = vi.fn();
    draw({ expanded: true, onCollapse, nearby: [] });
    fireEvent.click(screen.getByRole('button', { name: LANDSCAPE_COLLAPSE }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------ *
 * THE RIGHT RAIL
 * ------------------------------------------------------------------------ */

describe('the right rail', () => {
  /** Section D: search is the first button, because the bar is deleted. */
  it('puts search first, of five controls', () => {
    draw();
    const rail = screen.getByRole('group', { name: LANDSCAPE_RIGHT_RAIL_LABEL });
    const keys = within(rail).getAllByRole('button');
    expect(keys).toHaveLength(5);
    expect(keys[0]?.getAttribute('aria-label')).toBe(LANDSCAPE_SEARCH);
  });

  /**
   * REPORT IS THE SHARED COMPONENT. `ReportKey` owns tap-opens-the-sheet and
   * hold-1s-drops-a-pin; a second pink circle drawn here would fork those two
   * gestures on the first change to either. There is exactly one of it.
   */
  it('reuses ReportKey rather than redrawing the circle', () => {
    const { container } = draw();
    expect(container.querySelectorAll('[data-fwm-dock-key="report"]')).toHaveLength(1);
  });

  it('marks an unwired control rather than pointing it somewhere plausible', () => {
    draw();
    const search = screen.getByRole('button', { name: LANDSCAPE_SEARCH });
    expect(search.dataset['fwmUnwired']).toBe('true');
  });

  it('drops the marker once the control has somewhere to go', () => {
    draw({ right: { onSearch: () => undefined } });
    expect(
      screen.getByRole('button', { name: LANDSCAPE_SEARCH }).dataset['fwmUnwired'],
    ).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ *
 * NO SPEED GATE
 * ------------------------------------------------------------------------ */

describe('no speed gate, ever', () => {
  /**
   * The spec asks for one twice -- section B's "keyboard locked in motion" and
   * section D's "a text field that locks above 5 mph" -- and the owner's
   * instruction is that neither is built. Passengers type; people at lights
   * type; the app does not decide who is driving.
   *
   * This asserts the shape that a gate would have to take: something on this
   * surface being disabled or aria-disabled. Nothing is, in either mode.
   */
  it('disables nothing, in either mode', () => {
    for (const slots of [MONITOR, NAVIGATION]) {
      const { container, unmount } = draw({ slots });
      expect(container.querySelectorAll('[disabled]')).toHaveLength(0);
      expect(container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0);
      unmount();
    }
  });
});
