/**
 * SETTINGS, wired to the real stores and the real mode module.
 *
 * Nothing here renders a hand-built view model. Every assertion goes through
 * the same path the app uses -- the settings slice, `app/mode.ts` and the
 * removal port -- so a screen that agreed with a mock and disagreed with the
 * product would fail here.
 *
 * The removal port is faked in this file ON PURPOSE: what the real one does to
 * a real database is asserted against the real repositories in
 * `removal.test.ts`, and repeating that here would test IndexedDB twice and the
 * screen's own behaviour once.
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MODE, applyMode } from '../../app/mode.ts';
import { SURFACE_ATTRIBUTE } from '../../app/surface.ts';
import {
  historyActions,
  ingestAlertTick,
  resetAllStores,
  useHistoryStore,
  useSettingsStore,
  useShouldSpeak,
  useShouldVibrate,
} from '../../stores';
import type { AlertTick, CameraAssessment } from '../../stores';

import { SettingsScreen } from './SettingsScreen.tsx';
import { FORCED_WATCH_NOTICE, MODE_CHOICES } from './modes.ts';
import { REMOVAL_CANCEL_LABEL, REMOVAL_LABELS } from './components/RemovalControl.tsx';
import { HYDRATING_NOTICE } from './components/SettingsView.tsx';
import type { RemovalPort } from './removal.ts';

const NOW = 1_760_000_000_000;

/** A port that reports a clean wipe, with the shape `describeForgetReport` has. */
function removedPort(lines: readonly string[] = ['1 encrypted plate deleted']): RemovalPort {
  return vi.fn<RemovalPort>().mockResolvedValue({ status: 'removed', lines });
}

/** One tick in the shape `@fwm/core` publishes it, with a camera in range. */
function tick(): AlertTick {
  const nearest: CameraAssessment = {
    id: 'cam-1',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 221,
    inRange: true,
    muted: false,
    mergedIds: ['cam-1'],
  };
  return {
    timestampMs: NOW,
    state: 'in_range',
    previousState: 'clear',
    changed: true,
    nearest,
    cameras: [nearest],
    countInRange: 1,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: true,
    hapticPulses: 1,
    notifyCameraIds: ['cam-1'],
    suppressedBy: [],
  };
}

beforeEach(() => {
  resetAllStores();
  // The persisted blob is read asynchronously. Every test below is about a
  // hydrated screen except the one that is not, which resets this itself.
  useSettingsStore.getState().markHydrated();
});

afterEach(() => {
  resetAllStores();
  // `applyMode` holds the last requested mode in module state and writes an
  // attribute on <html>. Put both back so one test cannot skin the next.
  applyMode(DEFAULT_MODE, 'phone');
  // The surface-following tests below write `data-fwm-surface` on <html>.
  delete document.documentElement.dataset['fwmSurface'];
});

/** Write the attribute the shell owns, the way `detectSurface()` writes it. */
function shellWritesSurface(value: string): void {
  document.documentElement.setAttribute(SURFACE_ATTRIBUTE, value);
}

describe('the alert threshold is the value the rest of the product reads', () => {
  it('writes a moved slider into the settings slice', () => {
    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);

    fireEvent.change(screen.getByRole('slider', { name: 'ALERT AT' }), {
      target: { value: '750' },
    });

    expect(useSettingsStore.getState().thresholdFt).toBe(750);
    expect(screen.getByRole('slider', { name: 'ALERT AT' })).toHaveValue('750');
  });

  it('renders the value the bezel would have set, in the same detents', () => {
    useSettingsStore.getState().stepThresholdFt(-2);
    const { container } = render(<SettingsScreen surface="phone" removalPort={removedPort()} />);

    // Two bezel steps down from 500 ft is 400 ft, and that is what is drawn.
    expect(
      container.querySelector('[data-fwm-settings-threshold="true"]')?.textContent,
    ).toBe('400 FT');
  });

  it('never lands on a value the engine would refuse', () => {
    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);

    // A browser that rounds a stepped range differently still lands on a detent.
    fireEvent.change(screen.getByRole('slider', { name: 'ALERT AT' }), {
      target: { value: '524' },
    });

    expect(useSettingsStore.getState().thresholdFt).toBe(500);
  });
});

describe('the two toggles reach the gate that honours them', () => {
  it('shuts the haptic channel when vibration is switched off', () => {
    ingestAlertTick(tick());
    const gate = renderHook(() => useShouldVibrate());
    expect(gate.result.current).toBe(true);

    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Vibration' }));

    expect(useSettingsStore.getState().vibration).toBe(false);
    gate.rerender();
    expect(gate.result.current).toBe(false);
  });

  it('shuts the spoken channel when audio is switched off', () => {
    ingestAlertTick(tick());
    const gate = renderHook(() => useShouldSpeak());
    expect(gate.result.current).toBe(true);

    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Audio' }));

    expect(useSettingsStore.getState().audio).toBe(false);
    gate.rerender();
    expect(gate.result.current).toBe(false);
  });
});

describe('the theme mode', () => {
  it('applies the picked skin to the document and remembers it', () => {
    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'theme mode' }), {
      target: { value: 'pursuit' },
    });

    expect(useSettingsStore.getState().mode).toBe('pursuit');
    expect(document.documentElement.dataset['fwmMode']).toBe('pursuit');
  });

  it('reconciles a stored skin onto the document when the screen opens', () => {
    useSettingsStore.getState().setMode('cluster');

    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);

    expect(document.documentElement.dataset['fwmMode']).toBe('cluster');
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toHaveValue(
      'cluster',
    );
  });

  it('forces night watch on a watch face, whatever is stored', () => {
    // "Night Watch is the fallback and the only mode allowed on the always-on
    //  watch face." -- Flockys Design System.dc.html, section 05
    useSettingsStore.getState().setMode('pursuit');

    render(<SettingsScreen surface="watch-round" removalPort={removedPort()} />);

    expect(document.documentElement.dataset['fwmMode']).toBe('night-watch');
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toHaveValue(
      'night-watch',
    );
    // And there is no press that could put pursuit on a wrist.
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toBeDisabled();
  });

  it('forces night watch on a square watch too', () => {
    render(<SettingsScreen surface="watch-square" removalPort={removedPort()} />);

    expect(document.documentElement.dataset['fwmMode']).toBe('night-watch');
  });

  // The default stored mode IS night-watch (`stores/settings.ts`), so this is
  // the state of every watch on first run -- and the one where `resolveMode()`
  // reports `reason: 'requested'` rather than `'forced-watch'`. The picker must
  // still be locked: a lock read off that reason would leave all six rows live
  // in exactly the most common case.
  it('locks the picker on a watch whose stored mode is already night watch', () => {
    expect(useSettingsStore.getState().mode).toBe(DEFAULT_MODE);

    render(<SettingsScreen surface="watch-round" removalPort={removedPort()} />);

    expect(screen.getByText(FORCED_WATCH_NOTICE)).toBeInTheDocument();
    for (const choice of MODE_CHOICES) {
      // One disabled control covers every choice now; the loop is kept so a
      // new mode still has to be nameable in the picker.
      expect(screen.getByRole('option', { name: choice.name })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'theme mode' })).toBeDisabled();
    }
  });

  it('locks the picker on a square watch whose stored mode is already night watch', () => {
    render(<SettingsScreen surface="watch-square" removalPort={removedPort()} />);

    expect(screen.getByText(FORCED_WATCH_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toBeDisabled();
  });

  it('never lets a press from a wrist reach the persisted preference', () => {
    render(<SettingsScreen surface="watch-round" removalPort={removedPort()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'theme mode' }), {
      target: { value: 'pursuit' },
    });

    // Not swallowed *after* the write: never written at all.
    expect(useSettingsStore.getState().mode).toBe(DEFAULT_MODE);
    expect(document.documentElement.dataset['fwmMode']).toBe('night-watch');
  });
});

describe('the surface is followed, not sampled once', () => {
  it('reads the surface off the document when no surface prop is passed', () => {
    shellWritesSurface('watch-round');

    render(<SettingsScreen removalPort={removedPort()} />);

    expect(screen.getByText(FORCED_WATCH_NOTICE)).toBeInTheDocument();
  });

  it('locks the picker when the device becomes a watch while SETTINGS is open', async () => {
    shellWritesSurface('phone');
    useSettingsStore.getState().setMode('pursuit');

    render(<SettingsScreen removalPort={removedPort()} />);
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toHaveValue(
      'pursuit',
    );
    expect(screen.queryByText(FORCED_WATCH_NOTICE)).toBeNull();

    // `app/App.tsx`'s surface watch re-measures and writes the new surface.
    act(() => {
      shellWritesSurface('watch-round');
    });

    await waitFor(() => {
      expect(screen.getByText(FORCED_WATCH_NOTICE)).toBeInTheDocument();
    });
    // The picker now agrees with the document instead of contradicting it.
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toHaveValue(
      'night-watch',
    );
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toBeDisabled();
    expect(document.documentElement.dataset['fwmMode']).toBe('night-watch');
  });
});

describe('the removal takes two presses and then really removes', () => {
  it('destroys nothing on the first press', () => {
    const port = removedPort();
    render(<SettingsScreen surface="phone" removalPort={port} />);

    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.idle }));

    expect(port).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: REMOVAL_LABELS.armed })).toBeInTheDocument();
  });

  it('backs out cleanly when the driver cancels', () => {
    const port = removedPort();
    render(<SettingsScreen surface="phone" removalPort={port} />);

    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.idle }));
    fireEvent.click(screen.getByRole('button', { name: REMOVAL_CANCEL_LABEL }));

    expect(port).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: REMOVAL_LABELS.idle })).toBeInTheDocument();
  });

  it('runs the one removal path on the second press and prints the counts', async () => {
    const port = removedPort([
      '2 encrypted plates deleted',
      'encryption keys destroyed',
      '1 signed camera report kept - deleting one breaks the chain for the rest. clear them separately.',
    ]);
    render(<SettingsScreen surface="phone" removalPort={port} />);

    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.idle }));
    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.armed }));

    expect(await screen.findByText('2 encrypted plates deleted')).toBeInTheDocument();
    expect(screen.getByText('encryption keys destroyed')).toBeInTheDocument();
    expect(port).toHaveBeenCalledTimes(1);
  });

  it('empties the in-memory mirror too, so the wiped drive is not still on screen', async () => {
    historyActions.startTrip(NOW);
    historyActions.record({
      cameraId: 'cam-1',
      atMs: NOW,
      state: 'in_range',
      previousState: 'clear',
      distanceFt: 425,
      muted: true,
    });
    historyActions.notePass('cam-1');
    expect(useHistoryStore.getState().entries).toHaveLength(1);

    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);
    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.idle }));
    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.armed }));

    await waitFor(() => {
      expect(useHistoryStore.getState().entries).toHaveLength(0);
    });
    expect(useHistoryStore.getState().today.passes).toBe(0);
  });

  it('says nothing was removed rather than claiming a wipe that did not happen', async () => {
    const port = vi.fn<RemovalPort>().mockResolvedValue({
      status: 'unavailable',
      reason: 'nothing was removed: the local database could not be opened (TypeError)',
    });
    render(<SettingsScreen surface="phone" removalPort={port} />);

    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.idle }));
    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.armed }));

    expect(
      await screen.findByText(
        'nothing was removed: the local database could not be opened (TypeError)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'what was removed' })).toBeNull();
  });

  it('does not get stuck claiming work when the port throws outright', async () => {
    const port = vi.fn<RemovalPort>().mockRejectedValue(new Error('boom'));
    render(<SettingsScreen surface="phone" removalPort={port} />);

    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.idle }));
    fireEvent.click(screen.getByRole('button', { name: REMOVAL_LABELS.armed }));

    expect(
      await screen.findByText('nothing was removed: the removal did not complete'),
    ).toBeInTheDocument();
    // Never left disabled on `Forgetting…` with nothing happening.
    expect(screen.getByRole('button', { name: REMOVAL_LABELS.unavailable })).toBeEnabled();
  });
});

describe('before the stored settings have been read back', () => {
  it('says so, and refuses to write over a preference still in flight', () => {
    resetAllStores();
    useSettingsStore.setState({ hydrated: false });

    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);

    expect(screen.getByText(HYDRATING_NOTICE)).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: 'ALERT AT' });
    expect(slider).toBeDisabled();
    fireEvent.change(slider, { target: { value: '750' } });
    expect(useSettingsStore.getState().thresholdFt).toBe(500);
  });
});

describe('this screen asks the platform for nothing', () => {
  it('prompts for nothing, starts no sensor and sends nothing on mount', () => {
    // NARROWED, DELIBERATELY, WHEN PERMISSIONS MOVED ONTO THIS SCREEN.
    //
    // The guard used to assert `navigator.permissions.query` was never called,
    // under a spy named `requestPermission`. Those are not the same thing:
    // `query` is a passive READ that cannot raise a dialog, and `request()` is
    // the one that can. The permissions section has to read current state to
    // show it - the alternative is rendering a status from the store that the
    // OS may have changed since, i.e. the app telling the driver it has a
    // permission it does not.
    //
    // So the intent is kept and sharpened: no PROMPT, no sensor, no network,
    // no haptic. Those are the things that must never happen for opening a
    // screen. Reading is allowed and is asserted to be read-only below.
    const getCurrentPosition = vi.fn();
    const watchPosition = vi.fn();
    const vibrate = vi.fn();
    const permissionsQuery = vi.fn(async () => ({ state: 'prompt' }));
    const fetchSpy = vi.fn();
    const sendBeacon = vi.fn();

    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
      vibrate,
      sendBeacon,
      permissions: { query: permissionsQuery },
    });
    vi.stubGlobal('fetch', fetchSpy);

    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);

    // The prompting paths. `getCurrentPosition` and `watchPosition` are BOTH
    // permission prompts as well as sensor starts on every browser.
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();

    // And the read that IS allowed stays a read: query takes a descriptor and
    // returns state. If it is ever called with anything that could mutate, or
    // if a prompt appears above, this test fails.
    for (const call of permissionsQuery.mock.calls) {
      expect(call).toHaveLength(1);
    }
  });

  it('writes nothing to the url, not even its own screen id', () => {
    const before = window.location.search;

    render(<SettingsScreen surface="phone" removalPort={removedPort()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'theme mode' }), {
      target: { value: 'pursuit' },
    });

    expect(window.location.search).toBe(before);
  });
});
