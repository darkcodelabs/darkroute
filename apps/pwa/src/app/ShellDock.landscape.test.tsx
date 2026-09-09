/**
 * THE LANDSCAPE RIGHT RAIL, PRESSED FROM THE SHELL.
 *
 * `LandscapeChrome.test.tsx` holds what the rail DRAWS - five circles, an
 * unwired marker on any key handed no handler. This file holds what the shell
 * WIRES those circles to, because a wire is the thing that goes missing without
 * anything failing: the gear was drawn on every landscape frame, looked exactly
 * like the wired keys beside it, and opened nothing. Found by pressing it after
 * the MAP VIEW panel's Wide layout switch, which is the one route a portrait
 * driver has onto this surface - and the surface where the portrait rail's own
 * gear is `display: none`.
 *
 * THE SURFACE IS DECLARED, NOT MEASURED. `setSurfaceOverride('dash')` is the
 * exact call `forceLandscape` makes on the switch, so this renders the branch
 * a driver reaches by pressing it rather than one a resize might reach.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LANDSCAPE_DAY_NIGHT,
  LANDSCAPE_LAYERS,
  LANDSCAPE_SETTINGS,
} from '../features/landscape/LandscapeChrome.tsx';
import { onLayersToggle, publishLayersOpen, resetDriveSignalsForTests } from '../features/drive/driveSignals.ts';
import { useAlertStore } from '../stores/alert.ts';
import { useCamerasStore } from '../stores/cameras.ts';
import { usePositionStore } from '../stores/position.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { initScreenState } from './screenState.ts';
import { ShellDock, stepPoint } from './ShellDock.tsx';
import { setSurfaceOverride } from './surface.ts';
import { resetSurfaceWatchForTests } from './useSurface.ts';

beforeEach(() => {
  initScreenState();
  useCamerasStore.setState(useCamerasStore.getInitialState(), true);
  useAlertStore.setState(useAlertStore.getInitialState(), true);
  usePositionStore.setState(usePositionStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  resetSurfaceWatchForTests();
  resetDriveSignalsForTests();
  setSurfaceOverride('dash');
});

afterEach(() => {
  setSurfaceOverride(null);
  resetSurfaceWatchForTests();
});

describe('the landscape right rail, wired by the shell', () => {
  it('opens settings from the gear, the same place every other gear goes', () => {
    render(<ShellDock />);
    const gear = screen.getByRole('button', { name: LANDSCAPE_SETTINGS });
    /* The marker is the drawing's own word for "nobody connected me". A wired
       key must not carry it, or the grep that finds dead keys finds this one. */
    expect(gear.dataset['fwmUnwired']).toBeUndefined();
    fireEvent.click(gear);
    expect(globalThis.location.search).toContain('screen=settings');
  });
});

describe('the two circles that used to carry the unwired marker', () => {
  it('leaves no circle on the rail unwired', () => {
    render(<ShellDock />);
    expect(document.querySelectorAll('.fwm-ls-circle[data-fwm-unwired]')).toHaveLength(0);
  });

  it('day/night flips the skin from the rail and writes it down', () => {
    render(<ShellDock />);
    expect(useSettingsStore.getState().mode).toBe('slate');
    fireEvent.click(screen.getByRole('button', { name: LANDSCAPE_DAY_NIGHT }));
    expect(useSettingsStore.getState().mode).toBe('refinement');
    expect(document.documentElement.getAttribute('data-fwm-mode')).toBe('refinement');
    fireEvent.click(screen.getByRole('button', { name: LANDSCAPE_DAY_NIGHT }));
    expect(useSettingsStore.getState().mode).toBe('slate');
  });

  it('layers asks DRIVE for its panel and draws lit while DRIVE says it is up', () => {
    const heard = vi.fn();
    const stop = onLayersToggle(heard);
    render(<ShellDock />);
    const layers = screen.getByRole('button', { name: LANDSCAPE_LAYERS });
    expect(layers.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(layers);
    expect(heard).toHaveBeenCalledTimes(1);
    act(() => {
      publishLayersOpen(true);
    });
    expect(layers.getAttribute('aria-pressed')).toBe('true');
    stop();
  });
});

describe('where a step row points', () => {
  const route = { shape: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] };
  it('reads the shape index off the front of the id', () => {
    expect(stepPoint('1-0', route)).toEqual({ lat: 3, lon: 4 });
    expect(stepPoint('0-5', route)).toEqual({ lat: 1, lon: 2 });
  });
  it('is null for no route, a bad id, or an index off the line', () => {
    expect(stepPoint('1-0', null)).toBeNull();
    expect(stepPoint('x-0', route)).toBeNull();
    expect(stepPoint('9-0', route)).toBeNull();
  });
});
