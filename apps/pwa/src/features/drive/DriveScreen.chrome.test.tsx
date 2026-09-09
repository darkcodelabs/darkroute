/**
 * THE CHROME IS MOUNTED, AND EVERY KEY ON IT STILL GOES WHERE IT WENT.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS
 * =============================================================================
 * DRIVE's top row was `SearchBar` + `SearchPills`; it is now the chrome brief's
 * `TopBar`, `Chips` and `Rail`. Those three components decide nothing -- each
 * of them reports a press and this screen routes it -- so every behaviour that
 * used to be tested inside the bar is now a wire between two files, and a wire
 * is exactly the thing that goes missing in a swap without anything failing.
 *
 * WHAT IS GUARDED HERE is the routing, on the real screen:
 *
 *   the theme key      flips `data-fwm-mode` between slate and the light skin.
 *                      `applyMode` is the ONLY writer of that attribute in the
 *                      product, and this key is the only caller of it outside
 *                      SETTINGS. `SearchBar.test.tsx`'s four light/dark tests
 *                      were about the bar's own toggle; the toggle moved to the
 *                      rail and the closure did not move at all, so the
 *                      assertion moved here with it.
 *   the gear           opens SETTINGS.
 *   mail / code / help each raise the list `ContactKey` / `DeveloperKey` /
 *                      `FaqKey` used to own, and only one at a time.
 *   the chevron        sets `data-fwm-bare` on the DRIVE root, which is what
 *                      `drive.css` hides the rail, the chips and the dock off.
 *
 * `TopBar.test.tsx`, `Chips.test.tsx` and `Rail.test.tsx` hold what each of the
 * three DRAWS. This holds only that the screen wired them to the same places.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MODE } from '../../app/mode.ts';
import { initScreenState } from '../../app/screenState.ts';
import { RAIL_CODE, RAIL_HELP, RAIL_MAIL, RAIL_SETTINGS, RAIL_THEME } from '../chrome/Rail.tsx';
import { TOPBAR_FOLD, TOPBAR_UNFOLD } from '../chrome/TopBar.tsx';
import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';

import { CONTACT_WAYS } from './contactWays.ts';
import { DriveScreen } from './DriveScreen.tsx';

beforeEach(() => {
  initScreenState();
  useCamerasStore.setState(useCamerasStore.getInitialState(), true);
  useAlertStore.setState(useAlertStore.getInitialState(), true);
  usePositionStore.setState(usePositionStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  document.documentElement.removeAttribute('data-fwm-mode');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-fwm-mode');
});

/** The mode the app is actually wearing, as the DOM carries it. */
function mode(): string | null {
  return document.documentElement.getAttribute('data-fwm-mode');
}

describe('the rail, which absorbed four keys from two other surfaces', () => {
  /*
   * DARK IS SLATE, LIGHT IS REFINEMENT, and the key knows only those two.
   * Going "back to dark" returns to `DEFAULT_MODE` rather than to whatever the
   * driver had before: a one-press control with no memory cannot restore
   * `pursuit`, and pretending otherwise would need state that outlives the
   * press. SETTINGS is where a specific skin gets chosen.
   */
  it('flips the theme, and flips it back to slate rather than to a remembered skin', () => {
    render(<DriveScreen />);
    const key = screen.getByRole('button', { name: RAIL_THEME });

    fireEvent.click(key);
    expect(mode()).toBe('refinement');
    expect(useSettingsStore.getState().mode).toBe('refinement');

    fireEvent.click(key);
    expect(mode()).toBe(DEFAULT_MODE);
    expect(useSettingsStore.getState().mode).toBe(DEFAULT_MODE);
  });

  it('starts from a chosen skin and still lands on light, then on slate', () => {
    // A driver who has picked `pursuit` in SETTINGS presses this and gets
    // light; pressing again returns them to SLATE, not to `pursuit`. That is
    // the trade for a one-press control, and it is asserted rather than
    // assumed because it is the surprising half.
    useSettingsStore.getState().setMode('pursuit');
    render(<DriveScreen />);
    const key = screen.getByRole('button', { name: RAIL_THEME });

    fireEvent.click(key);
    expect(mode()).toBe('refinement');
    fireEvent.click(key);
    expect(mode()).toBe(DEFAULT_MODE);
  });

  it('opens settings from the gear', () => {
    render(<DriveScreen />);
    fireEvent.click(screen.getByRole('button', { name: RAIL_SETTINGS }));
    expect(globalThis.location.search).toContain('screen=settings');
  });

  /* THE THREE SHEETS. Each of them is a list the old rail's own components
     held; the keys are the spec's five circles now and only the lists moved. */
  it('raises contact, developers and FAQ, one at a time', () => {
    render(<DriveScreen />);

    fireEvent.click(screen.getByRole('button', { name: RAIL_MAIL }));
    const contact = screen.getByRole('group', { name: RAIL_MAIL });
    for (const way of CONTACT_WAYS) {
      expect(screen.getByText(way.label)).toBeInTheDocument();
    }
    expect(contact).toBeInTheDocument();

    /* ONE AT A TIME, and it is structural now rather than cooperative: the
       screen holds ONE open id, so there is nowhere for a second sheet to be.
       `RailSheet`'s module-level registry went with the keys. */
    fireEvent.click(screen.getByRole('button', { name: RAIL_CODE }));
    expect(screen.queryByRole('group', { name: RAIL_MAIL })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: RAIL_CODE })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: RAIL_HELP }));
    expect(screen.queryByRole('group', { name: RAIL_CODE })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: RAIL_HELP })).toBeInTheDocument();

    /* Pressing the open one shuts it, which is what the sheets' own keys did. */
    fireEvent.click(screen.getByRole('button', { name: RAIL_HELP }));
    expect(screen.queryByRole('group', { name: RAIL_HELP })).not.toBeInTheDocument();
  });

  it('shuts a sheet on Escape and puts focus back on the key that opened it', () => {
    // Without the ref, dismissing drops focus to `<body>`: the element holding
    // it is inside a sheet that is about to stop existing.
    render(<DriveScreen />);
    const key = screen.getByRole('button', { name: RAIL_HELP });
    fireEvent.click(key);
    expect(screen.getByRole('group', { name: RAIL_HELP })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: RAIL_HELP })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(key);
  });
});

describe('the chevron, which is the fold', () => {
  /*
   * The owner's read is that the chevron means "clear the screen", not "shrink
   * one control", so the attribute goes on the DRIVE ROOT and `drive.css`
   * hides the rail, the chip row and the dock off it. The dock is not inside
   * `.fwm-drive` at all -- it is `App.tsx`'s own row -- which is why that rule
   * is written `:root:has(...)`, and why this asserts the attribute rather
   * than a computed style jsdom does not cascade.
   */
  it('sets data-fwm-bare on the screen, and clears it again', () => {
    const { container } = render(<DriveScreen />);
    const drive = container.querySelector('.fwm-drive');
    expect(drive).toHaveAttribute('data-fwm-bare', 'false');

    fireEvent.click(screen.getByRole('button', { name: TOPBAR_FOLD }));
    expect(drive).toHaveAttribute('data-fwm-bare', 'true');

    fireEvent.click(screen.getByRole('button', { name: TOPBAR_UNFOLD }));
    expect(drive).toHaveAttribute('data-fwm-bare', 'false');
  });
});
