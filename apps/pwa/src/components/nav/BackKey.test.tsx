/**
 * THE BACK KEY, AS A CONTROL.
 *
 * The bug this component was written for is not a rendering bug and would not
 * have been caught by a snapshot: eight screens were reachable and had nothing
 * on them that went anywhere. So these assert the three things that make the
 * control an exit rather than a decoration -
 *
 *   it NAVIGATES, through the app's own adapter and to a named screen;
 *   it has a NAME a screen reader can read, which a bare `‹` does not;
 *   it is the whole 44px target, not a glyph with a hit box around it.
 *
 * The size is asserted from the token rather than the layout: jsdom has no
 * layout engine, so `getBoundingClientRect` is 0x0 here for everything and a
 * test that read it would pass on a broken build. The real measurement is in
 * the headless render - see `scripts/` usage in the commit message - and what
 * is checkable here is that the rule the browser applies is the token one.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SCREEN,
  disposeScreenState,
  getScreenState,
  initScreenState,
} from '../../app/screenState.ts';

import { BACK_GLYPH, BACK_TO_MORE, BackKey } from './BackKey.tsx';

beforeEach(() => {
  // No port: the store runs without touching `window.history`, which is what
  // every other screen-state test does. `openScreen` still moves the store,
  // and the store is what the shell renders from.
  initScreenState({ initialScreen: 'settings' });
});

afterEach(() => {
  disposeScreenState();
});

describe('BackKey', () => {
  it('navigates to the named screen through the screen-state adapter', () => {
    render(<BackKey to="more" label={BACK_TO_MORE} />);

    expect(getScreenState().screen, 'starts on the screen it was mounted over').toBe('settings');

    fireEvent.click(screen.getByRole('button', { name: BACK_TO_MORE }));

    expect(getScreenState().screen, 'openScreen moved the store, not history.back()').toBe('more');
  });

  it('is named after the destination, not after the direction', () => {
    render(<BackKey to="more" label={BACK_TO_MORE} />);

    // "back" alone tells a screen-reader user that something will move and not
    // what to, which is the state MISUSE shipped in before this existed.
    const key = screen.getByRole('button', { name: BACK_TO_MORE });
    expect(key.getAttribute('aria-label')).toBe(BACK_TO_MORE);
    expect(key.getAttribute('aria-label')).not.toBe('back');
  });

  it('keeps the glyph out of the accessibility tree', () => {
    render(<BackKey to="more" label={BACK_TO_MORE} />);

    const key = screen.getByRole('button', { name: BACK_TO_MORE });
    // The name is the label, so the punctuation must not be read beside it.
    expect(key.textContent).toBe(BACK_GLYPH);
    expect(key.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('runs a handler instead of navigating when one is given', () => {
    // INTEL's case: the card is a modal over DRIVE as often as it is a screen,
    // and only `closeIntelCard` knows which. A screen id cannot say that.
    const onBack = vi.fn();
    render(<BackKey label="close the camera card" onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'close the camera card' }));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(getScreenState().screen, 'a handler must not also navigate').toBe('settings');
  });

  it('publishes its destination on the element', () => {
    // `data-fwm-back-to` is what the headless pass reads to prove every screen's
    // arrow points at a real screen id without having to click all of them.
    render(<BackKey to={DEFAULT_SCREEN} label="back to drive" />);

    expect(
      screen.getByRole('button', { name: 'back to drive' }).getAttribute('data-fwm-back-to'),
    ).toBe(DEFAULT_SCREEN);
  });
});
