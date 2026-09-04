import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCK_V1_KEYS } from '../components/dock/DockV1.tsx';
import { useSettingsStore } from '../stores/settings.ts';

import { App } from './App.tsx';
import { ALWAYS_ON_MODE, DEFAULT_MODE } from './mode.ts';
import {
  disposeScreenState,
  initScreenState,
  interruptForAlert,
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

  it('renders the v1 dock by default -- v0’s six-key bar is deleted, not unselected', () => {
    // THIS IS A REVERSAL, and this test is named for it.
    //
    // `App`'s `dock` prop used to default to v0's `Dock`: one 58px bar with the
    // five destinations and REPORT folded in as a sixth key, marked up as
    // `.fwm-dock` > `.fwm-dock-panel` > `.fwm-dock-bar`. `main.tsx` substituted
    // `DockV1` whenever the design was v1 and passed `undefined` -- i.e. took
    // the v0 default -- whenever it was v0, which SETTINGS still offers.
    //
    // v0's dock is gone: the component, its key, its stylesheet and its hue
    // table. So an `<App>` with no `dock` renders the v1 pill, and a driver who
    // has V0 selected in SETTINGS gets the v1 dock over their v0 screens. That
    // is the intended consequence of the removal, not a fallback.
    renderShell();

    const dock = screen.getByRole('navigation');
    expect(dock.classList.contains('fwm-dockv1')).toBe(true);
    // v0's markup, asserted absent rather than merely not-looked-for.
    expect(document.querySelector('.fwm-dock')).toBeNull();
    expect(document.querySelector('.fwm-dock-bar')).toBeNull();
    expect(document.querySelector('.fwm-dock-panel')).toBeNull();

    // Four destinations, not five, and REPORT beside them rather than inside.
    expect(dock.querySelectorAll('.fwm-dockv1-key')).toHaveLength(DOCK_V1_KEYS.length);
    const report = dock.querySelector('.fwm-dock-report-key');
    expect(report).not.toBeNull();
    expect(report?.closest('.fwm-dockv1-report')).not.toBeNull();
  });

  it('follows the screen store', () => {
    renderShell();
    act(() => {
      openScreen('sweep');
    });
    expect(screen.getByTestId('screen-sweep')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-radar')).not.toBeInTheDocument();
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
