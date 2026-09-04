/**
 * THE LIGHT/DARK DEMO ON MORE.
 *
 * =============================================================================
 * WHY THIS IS TESTED AT ALL, GIVEN SETTINGS ALREADY HAS A MODE PICKER
 * =============================================================================
 * Because it is a SECOND writer of the same state, and `app/mode.ts` is
 * explicit that there must not be one: the mode attribute is written
 * synchronously by `applyMode` and nothing else may touch it. A control that
 * set `data-fwm-mode` itself would look correct on screen and leave the store
 * disagreeing with the DOM, which survives until the next reload and then
 * silently reverts. So what is asserted here is not "the button works" but
 * "the button goes through the same pair SETTINGS goes through".
 *
 * The watch case is the other half. `resolveMode` FORCES `night-watch` on an
 * always-on face, so these two buttons would paint nothing at all there - and a
 * control that does nothing is worse than one that says why it is absent.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MODE, MODE_ATTRIBUTE, applyMode } from '../../app/mode.ts';
import { SURFACE_ATTRIBUTE } from '../../app/surface.ts';
import { useSettingsStore } from '../../stores/index.ts';

import {
  MoreScreen,
  THEME_DEMO_DARK,
  THEME_DEMO_LIGHT,
  THEME_DEMO_MODES,
  THEME_DEMO_OTHER,
  THEME_DEMO_WATCH,
} from './MoreScreen.tsx';

function key(name: string): HTMLButtonElement {
  return screen.getByRole('radio', { name }) as HTMLButtonElement;
}

beforeEach(() => {
  document.documentElement.removeAttribute(SURFACE_ATTRIBUTE);
  useSettingsStore.getState().setMode(DEFAULT_MODE);
  applyMode(DEFAULT_MODE, null);
});

afterEach(() => {
  document.documentElement.removeAttribute(SURFACE_ATTRIBUTE);
});

describe('the light and dark demo on MORE', () => {
  it('repaints the app AND moves the stored preference, not one or the other', () => {
    render(<MoreScreen />);

    fireEvent.click(key(THEME_DEMO_LIGHT));

    // Both halves. Painting without storing reverts on the next launch;
    // storing without painting does nothing until then.
    expect(document.documentElement.getAttribute(MODE_ATTRIBUTE)).toBe(THEME_DEMO_MODES.light);
    expect(useSettingsStore.getState().mode).toBe(THEME_DEMO_MODES.light);
  });

  it('switches back to dark, so it is a comparison and not a one-way door', () => {
    render(<MoreScreen />);

    fireEvent.click(key(THEME_DEMO_LIGHT));
    fireEvent.click(key(THEME_DEMO_DARK));

    expect(document.documentElement.getAttribute(MODE_ATTRIBUTE)).toBe(THEME_DEMO_MODES.dark);
    expect(useSettingsStore.getState().mode).toBe(THEME_DEMO_MODES.dark);
  });

  it('marks the end that is on, for a screen reader and for the eye', () => {
    useSettingsStore.getState().setMode(THEME_DEMO_MODES.light);
    render(<MoreScreen />);

    expect(key(THEME_DEMO_LIGHT).getAttribute('aria-checked')).toBe('true');
    expect(key(THEME_DEMO_DARK).getAttribute('aria-checked')).toBe('false');
    expect(key(THEME_DEMO_LIGHT).getAttribute('data-fwm-selected')).toBe('true');
  });

  it('says a different skin is on rather than claiming one of its two ends is', () => {
    // SETTINGS offers fifteen other modes. Drawing neither end as selected and
    // saying nothing would read as "light is off and dark is off", which is not
    // a state this control can be in.
    useSettingsStore.getState().setMode('aurora');
    render(<MoreScreen />);

    expect(key(THEME_DEMO_LIGHT).getAttribute('aria-checked')).toBe('false');
    expect(key(THEME_DEMO_DARK).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(THEME_DEMO_OTHER)).toBeTruthy();
  });

  it('is inert on a watch, and says why instead of painting nothing', () => {
    // `resolveMode` forces night-watch on an always-on face, so pressing either
    // end would change the store and leave the screen exactly as it was.
    document.documentElement.setAttribute(SURFACE_ATTRIBUTE, 'watch-round');
    render(<MoreScreen />);

    expect(key(THEME_DEMO_LIGHT).disabled).toBe(true);
    expect(key(THEME_DEMO_DARK).disabled).toBe(true);
    expect(screen.getByText(THEME_DEMO_WATCH)).toBeTruthy();
  });

  it('refuses the WRITE on a watch too, not just the press', () => {
    // Second line of defence, exactly as `SettingsScreen.onModePick` keeps: a
    // disabled button is a UI fact, and the guard has to hold without it.
    document.documentElement.setAttribute(SURFACE_ATTRIBUTE, 'watch-round');
    render(<MoreScreen />);
    const before = useSettingsStore.getState().mode;

    fireEvent.click(key(THEME_DEMO_LIGHT));

    expect(useSettingsStore.getState().mode).toBe(before);
  });
});
