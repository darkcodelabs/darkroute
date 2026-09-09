import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCK_TABS } from '../features/dock/dockState.ts';
import { positionActions, usePositionStore } from '../stores/position.ts';
import { useSettingsStore } from '../stores/settings.ts';

import { App } from './App.tsx';
import { ALWAYS_ON_MODE, DEFAULT_MODE } from './mode.ts';
import {
  disposeScreenState,
  getScreenState,
  initScreenState,
  interruptForAlert,
  onScreenReselected,
  openOverlay,
  openScreen,
  restoreAfterAlert,
} from './screenState.ts';

function Screen({ label }: { readonly label: string }): React.ReactNode {
  return <div data-testid={`screen-${label}`}>{label}</div>;
}

const SCREENS = {
  radar: () => <Screen label="radar" />,
  sweep: () => <Screen label="sweep" />,
};

const OVERLAYS = {
  report: () => <div data-testid="overlay-report">report sheet</div>,
};

function AlertLayer(): React.ReactNode {
  return <div data-testid="camera-alert">in range</div>;
}

function Banner(): React.ReactNode {
  return <div data-testid="offline-banner">offline</div>;
}

function renderShell() {
  return render(
    <App
      screens={SCREENS}
      overlays={OVERLAYS}
      alertLayer={AlertLayer}
      banners={<Banner />}
      serviceWorker={null}
      sensors={null}
      installPrompt={null}
      holdWakeLock={false}
    />,
  );
}

beforeEach(() => {
  // These tests describe an app PAST first run. Without this the first-run
  // gate correctly redirects to onboarding - a driver who has never granted
  // location has nothing to see on RADAR - and every shell assertion below
  // would be asserting against the wrong screen. `firstRun.test.ts` covers
  // the gate itself.
  useSettingsStore.setState({ hydrated: true, onboardingCompletedAtMs: 1_700_000_000_000 });

  // Explicit start screen: these tests share jsdom's real history, so a
  // previous test's `?screen=` would otherwise be adopted as this one's deep
  // link. `initScreenState` rewrites the URL, so this also cleans up.
  initScreenState({ initialScreen: 'radar' });
});

afterEach(() => {
  disposeScreenState();
  // The dock is mounted on every one of these tests now and it reads the
  // position store, so a fix left behind by one case would put the next one's
  // dock in the drive family.
  usePositionStore.getState().reset();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['fwmSurface'];
});

/** Make surface detection resolve to a round watch face. */
function stubRoundWatch(): void {
  const watchQueries = ['(max-width: 320px) and (max-height: 420px)', '(shape: round)'];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: watchQueries.includes(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('screen', { width: 384, height: 384 });
}

describe('the shell', () => {
  it('renders the current screen and the dock chrome', () => {
    renderShell();
    expect(screen.getByTestId('screen-radar')).toBeInTheDocument();
    // The dock is chrome. It is on every screen, REPORT included.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders ONE dock, and it is the new one -- the v1 pill is gone', () => {
    /*
     * THIS IS A REVERSAL, AND THIS TEST IS NAMED FOR IT.
     *
     * `App`'s `dock` prop defaulted to `DockV1`, and for a while the new dock
     * was ALSO on screen: DRIVE built one and portalled it into this file's own
     * `.fwm-shell-dock`, so the slot held three children - the v1 pill, the new
     * report key and the new bar - stacked on top of each other. Two docks is
     * not a styling problem; it is two answers to "where am I", and only one of
     * them followed the driver off DRIVE.
     *
     * So the default is `ShellDock` and the slot holds exactly what the dock
     * spec draws: the scrim, the 54px report key, then the pane. Asserted on
     * the SLOT rather than on the document, because "there is one dock" is a
     * claim about that row and nothing else can make it.
     *
     * THE SCRIM IS FIRST AND IT IS A SIBLING. 180px of gradient to 85% ink, so
     * street labels stop colliding with chrome -- it is full-bleed and the pane
     * is inset 10, so it cannot be a child of the pane, and it paints under
     * both the key and the pane, so it cannot be last.
     */
    renderShell();

    const slot = document.querySelector('.fwm-shell-dock');
    expect(slot).not.toBeNull();
    expect([...(slot?.children ?? [])].map((child) => child.className)).toEqual([
      'fwm-dock-scrim',
      'fwm-dock-report',
      'fwm-dock',
    ]);

    // v1's markup, asserted ABSENT rather than merely not-looked-for.
    expect(document.querySelector('.fwm-dockv1')).toBeNull();
    expect(document.querySelector('.fwm-dockv1-key')).toBeNull();
    expect(document.querySelector('.fwm-dockv1-report')).toBeNull();

    // The five destinations, in one nav, in the spec's order.
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveClass('fwm-dock-tabs');
    expect([...nav.querySelectorAll('.fwm-dock-tab')].map((tab) => tab.textContent)).toEqual(
      DOCK_TABS.map((tab) => tab.label),
    );

    // And REPORT beside them rather than among them: it is never a tab.
    expect(nav.querySelector('.fwm-dock-report')).toBeNull();
    expect(screen.getByRole('button', { name: 'Report camera' })).toBeInTheDocument();
  });

  it('says the road only over the map, and keeps the tab row either way', () => {
    /*
     * THIS TEST WAS ABOUT A RULE V3 DELETED, AND IT IS NOW ABOUT WHAT REPLACED
     * IT.
     *
     * V2's drive family drew NO TAB ROW, which is what made it a fourth height
     * and what left a rolling driver on MORE with the five destinations taken
     * off the bar. V3 merges the pane: the tab row is its floor, present in
     * every one of the nineteen states, so there is no family to stand down.
     *
     * The guard that survives is `overMap`, and it is about what the dock SAYS
     * rather than about the way out. Over the map, moving, the dock reads the
     * road - CRUISING. On MORE it falls back to its resting half, which is
     * still derived from the same live stores and still true, because a
     * maneuver row about a road the driver is not looking at is a stale answer.
     *
     * A MOVING FIX, not an empty store. Without one the ladder answers `idle`
     * on every screen and this test would pass against a dock that had no guard
     * at all - which is exactly the bug. 21 m/s is about 47 mph, comfortably
     * over `MIN_MOVING_MPH`. See `overMap` in `features/dock/useDockState.ts`.
     */
    const rolling = () => {
      positionActions.ingestFix({
        lat: 38.9181,
        lon: -94.6923,
        accuracyM: 8,
        altitudeM: null,
        altitudeAccuracyM: null,
        headingDeg: 0,
        speedMps: 21,
        timestamp: Date.now(),
      });
    };

    renderShell();
    act(rolling);

    // On the map, moving: the dock reads the road.
    expect(document.querySelector('.fwm-dock')?.getAttribute('data-fwm-state')).toBe('cruising');
    expect(screen.getByRole('navigation')).toBeInTheDocument();

    act(() => {
      openScreen('more');
    });

    // Still moving, still the same fix. Off the map it stops narrating a road
    // nobody is looking at - and the five destinations never went anywhere.
    expect(document.querySelector('.fwm-dock')?.getAttribute('data-fwm-state')).not.toBe(
      'cruising',
    );
    expect(document.querySelector('.fwm-dock')?.getAttribute('data-fwm-pane')).toBe('collapsed');
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('navigates from the tab row, and lights the tab it landed on', () => {
    // THE DOCK IS THE ONLY WAY TO FOUR OF THESE FIVE SCREENS. `SCREENS` here
    // registers neither `log` nor `more`, deliberately: what is under test is
    // where the press goes, not what draws when it arrives.
    renderShell();
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Exposure' }));

    expect(getScreenState().screen).toBe('log');
    expect(screen.getByRole('button', { name: 'Exposure' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Map' })).not.toHaveAttribute('aria-current');
  });

  it('treats a press on the tab you are already on as a RECENTRE, not a navigation', () => {
    // `openScreen` owns this rule - it notifies subscribers and pushes no
    // history - and the dock deliberately does not try to tell the two apart.
    // What this holds is that the press is still DELIVERED: a dock that
    // filtered it would silently break recentring on the map.
    const reselected: string[] = [];
    const stop = onScreenReselected((id) => reselected.push(id));
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));

    expect(reselected).toEqual(['radar']);
    expect(getScreenState().screen).toBe('radar');
    stop();
  });

  it('follows the screen store', () => {
    renderShell();
    act(() => {
      openScreen('sweep');
    });
    expect(screen.getByTestId('screen-sweep')).toBeInTheDocument();

    /*
     * THE MAP STAYS MOUNTED, PARKED.
     *
     * This used to assert the map screen was gone, which was true and was the
     * bug: unmounting it threw away MapLibre's WebGL context, every tile it
     * had fetched and the camera it was flying, so coming back showed a blank
     * map redrawing itself. It is kept in the tree and made invisible instead.
     *
     * What matters is that it is not PARTICIPATING: parked, inert, and not the
     * screen being shown.
     */
    const parked = document.querySelector('.fwm-shell-mapbed[data-fwm-map-parked="true"]');
    expect(parked).not.toBeNull();
    expect(parked?.contains(screen.getByTestId('screen-radar'))).toBe(true);
    expect(parked?.getAttribute('aria-hidden')).toBe('true');
    // And the active screen is not inside it.
    expect(parked?.contains(screen.getByTestId('screen-sweep'))).toBe(false);
  });

  it('does not mount the map twice when the map IS the screen', () => {
    renderShell();
    act(() => {
      openScreen('radar');
    });
    // One instance, and no parked bed: DriveScreen owns a map instance and two
    // of them on one screen is two WebGL contexts fighting over the same fix.
    expect(screen.getAllByTestId('screen-radar')).toHaveLength(1);
    expect(document.querySelector('.fwm-shell-mapbed')).toBeNull();
  });

  it('says so, rather than faking it, when a screen is not built', () => {
    renderShell();
    act(() => {
      openScreen('mesh');
    });
    expect(screen.getByText('screen not built')).toBeInTheDocument();
    expect(screen.getByText('MESH')).toBeInTheDocument();
  });
});

describe('global presentation priority', () => {
  it('a live camera alert wins over a sheet and over a banner', () => {
    renderShell();
    act(() => {
      openOverlay({ id: 'report', kind: 'sheet' });
    });
    expect(screen.getByTestId('overlay-report')).toBeInTheDocument();
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();

    act(() => {
      interruptForAlert();
    });

    expect(screen.getByTestId('camera-alert')).toBeInTheDocument();
    expect(screen.queryByTestId('overlay-report')).not.toBeInTheDocument();
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument();
  });

  it('never suppresses the REPORT bar or the dock during an alert', () => {
    renderShell();
    act(() => {
      interruptForAlert();
    });
    expect(screen.getByTestId('camera-alert')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('restores the interrupted sheet after the alert clears', () => {
    renderShell();
    act(() => {
      openOverlay({ id: 'report', kind: 'sheet' });
      interruptForAlert();
    });
    expect(screen.queryByTestId('overlay-report')).not.toBeInTheDocument();

    act(() => {
      restoreAfterAlert();
    });
    expect(screen.getByTestId('overlay-report')).toBeInTheDocument();
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('camera-alert')).not.toBeInTheDocument();
  });

  it('paints the alert last, so it is over the screen content', () => {
    renderShell();
    act(() => {
      interruptForAlert();
    });
    const main = screen.getByRole('main');
    const alert = screen.getByTestId('camera-alert');
    // Last child of the content area = painted last = on top.
    //
    // The alert is inside `.fwm-shell-layer` now rather than being a bare
    // sibling. It had to be: `.fwm-shell-screen > *` gives every child
    // `flex: 1`, so an overlay rendered beside the screen became a second flex
    // ROW - the screen took the top half of the viewport and the sheet took the
    // bottom half, both visible at once, and the map resized under it every
    // time one opened. The layer takes it out of flow. The ordering rule this
    // test exists for is unchanged: still last, still on top.
    const layer = main.lastElementChild;
    expect(layer).toHaveClass('fwm-shell-layer');
    expect(layer?.firstElementChild).toBe(alert);
  });

  it('keeps banners up when the build has no alert layer to draw', () => {
    // An alert with nothing registered to render it must not blank the screen.
    render(
      <App
        screens={SCREENS}
        banners={<Banner />}
        serviceWorker={null}
        installPrompt={null}
        holdWakeLock={false}
      />,
    );
    act(() => {
      interruptForAlert();
    });
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
  });
});

describe('surface and mode', () => {
  it('has applied the surface attribute by the time the shell is mounted', () => {
    renderShell();
    // jsdom's matchMedia stub answers false to everything, which resolves to
    // the phone surface.
    expect(document.documentElement.getAttribute('data-fwm-surface')).toBe('phone');
  });

  it('applies a mode attribute and nothing else to <html>', () => {
    const classBefore = document.documentElement.className;
    renderShell();
    // Bound to the constant, not the value it happened to hold. This asserted
    // 'night-watch' and broke the day the default became slate, on a test whose
    // actual subject is "a mode attribute lands, and no class does".
    expect(document.documentElement.getAttribute('data-fwm-mode')).toBe(DEFAULT_MODE);
    expect(document.documentElement.className).toBe(classBefore);
  });
});

describe('the watch surface', () => {
  it('renders no dock: "no bottom nav" is a watch rule, not a preference', () => {
    stubRoundWatch();
    renderShell();

    expect(document.documentElement.getAttribute('data-fwm-surface')).toBe('watch-round');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    // The screen itself still renders.
    expect(screen.getByTestId('screen-radar')).toBeInTheDocument();
  });

  it('forces night-watch, the only mode an always-on face may use', () => {
    stubRoundWatch();
    renderShell();
    // The WATCH rule, which is a power budget and not a preference: an always-on
    // face is forced to night watch whatever the default is. This is the
    // assertion that would have caught slate reaching a watch.
    expect(document.documentElement.getAttribute('data-fwm-mode')).toBe(ALWAYS_ON_MODE);
  });

  it('still lets a camera alert take the screen', () => {
    stubRoundWatch();
    renderShell();
    act(() => {
      interruptForAlert();
    });
    expect(screen.getByTestId('camera-alert')).toBeInTheDocument();
  });
});
