/**
 * THE `DESTINATION HISTORY` SETTINGS GROUP.
 *
 * Rendered through `SettingsScreen`, not by hand, for the reason
 * `SettingsViewV1.test.tsx` gives: the container owns the hydration gate, and a
 * hand-built model would let this file agree with a mock while the product
 * disagreed.
 *
 * WHAT IS ASSERTED HERE AND NOWHERE ELSE. The rules live in `places.ts`, the
 * row lives in the repository, the wiring lives in the store, and all three
 * have their own tests. What only this file can catch is a group that draws a
 * number it has not read, or draws a control that quietly deletes on one tap,
 * or promises the wrong thing about which list a wipe takes.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { destinationsActions, resetAllStores, useDestinationsStore, useSettingsStore } from '../../../stores';
import { COUNT_DASH } from '../../search/panel.ts';
import { setDestinationsPort } from '../../../stores/destinations.ts';
import { SettingsScreen } from '../SettingsScreen.tsx';
import type { RemovalPort } from '../removal.ts';
import { SettingsViewV1 } from './SettingsViewV1.tsx';
import { FORGET_ARMED_LABEL, FORGET_LABEL, HISTORY_NOTE, keepLabel } from './DestinationHistoryV1.tsx';

function removedPort(): RemovalPort {
  return vi.fn<RemovalPort>().mockResolvedValue({ status: 'removed', lines: [] });
}

function drawV1(): void {
  render(<SettingsScreen surface="phone" removalPort={removedPort()} view={SettingsViewV1} />);
}

/** A book on screen, as though it had been read back off disk. */
function withBook(saved: number, recents: number): void {
  useDestinationsStore.setState({
    hydrated: true,
    durable: true,
    book: {
      saved: Array.from({ length: saved }, (_, i) => ({
        id: `s${String(i)}`,
        kind: i === 0 ? ('home' as const) : ('other' as const),
        name: i === 0 ? 'Home' : `Place ${String(i)}`,
        detail: '',
        lat: 39,
        lon: -94,
      })),
      recents: Array.from({ length: recents }, (_, i) => ({
        id: `r${String(i)}`,
        name: `Recent ${String(i)}`,
        detail: '',
        lat: 39,
        lon: -94,
        lastUsedMs: Date.now() - i,
        trips: 1,
      })),
    },
  });
}

beforeEach(() => {
  resetAllStores();
  setDestinationsPort(null);
  useSettingsStore.getState().markHydrated();
});

afterEach(() => {
  resetAllStores();
  setDestinationsPort(null);
});

describe('the counts', () => {
  it('shows a dash rather than a zero before the book has been read back', () => {
    // The panel's rule for camera counts, applied to a settings row for the
    // same reason: zero is a real and reassuring answer, so printing it before
    // you know is a lie rather than a placeholder. "0 saved places" shown to
    // somebody who has three is that lie wearing a settings row.
    expect(useDestinationsStore.getState().hydrated).toBe(false);
    drawV1();

    expect(screen.getByText(`on this phone · ${COUNT_DASH} places`)).toBeTruthy();
    expect(screen.getByTestId('settingsv1-saved-places').textContent).toContain(COUNT_DASH);
  });

  it('names the saved places once it knows them, because this row is what the wipe takes', () => {
    withBook(2, 3);
    drawV1();

    // A bare `2` would make somebody open the search panel to find out which
    // two addresses the red row two groups down is going to take.
    expect(screen.getByTestId('settingsv1-saved-places').textContent).toContain('2 · Home, Place 1');
    expect(screen.getByText('on this phone · 5 places')).toBeTruthy();
  });

  it('says none yet rather than zero when the book is genuinely empty', () => {
    withBook(0, 0);
    drawV1();

    expect(screen.getByTestId('settingsv1-saved-places').textContent).toContain('none yet');
  });
});

describe('Remember places', () => {
  it('spells its state out in words, not just as a switch position', () => {
    withBook(0, 0);
    drawV1();

    const row = screen.getByTestId('settingsv1-remember-places');
    expect(row.getAttribute('aria-checked')).toBe('true');
    // Brief 4's rule for every toggle on this screen, and the spec's own string.
    expect(row.textContent).toContain('on · never leaves the phone');
  });

  it('keeps the promise in the words when it is off, because that half is still true', () => {
    withBook(0, 0);
    useSettingsStore.getState().setRememberPlaces(false);
    drawV1();

    const row = screen.getByTestId('settingsv1-remember-places');
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(row.textContent).toContain('off · never leaves the phone');
  });
});

describe('Keep for', () => {
  it('offers the four the spec names, with the spec’s own words for them', () => {
    withBook(0, 0);
    drawV1();

    const group = screen.getByRole('radiogroup', { name: /keep for/i });
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent);
    // "Configurable to 30, 90, a year or never" - and `a year` rather than
    // `365 days`, which is the spec's phrasing.
    expect(labels).toEqual(['30 days', '90 days', 'a year', 'never']);
  });

  it('starts at ninety, which is the spec’s stated default', () => {
    withBook(0, 0);
    drawV1();

    expect(keepLabel(useSettingsStore.getState().keepPlacesDays)).toBe('90 days');
    expect(screen.getByRole('radio', { name: '90 days', checked: true })).toBeTruthy();
  });

  it('draws never as a selectable choice and not as an absence', () => {
    withBook(0, 0);
    useSettingsStore.getState().setKeepPlacesDays(null);
    drawV1();

    expect(screen.getByRole('radio', { name: 'never', checked: true })).toBeTruthy();
  });
});

describe('Forget all recent places', () => {
  it('takes two presses, and the first one deletes nothing', () => {
    withBook(1, 3);
    const forget = vi.spyOn(destinationsActions, 'forgetAllRecentPlaces');
    drawV1();

    fireEvent.click(screen.getByTestId('settingsv1-forget-recents'));

    // The spec draws one row with no armed state. This follows the app's own
    // rule for the only other irreversible local deletion instead: a mis-tap
    // here costs nine places with no undo and no server copy to restore from.
    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByTestId('settingsv1-forget-recents').textContent).toContain(
      FORGET_ARMED_LABEL,
    );
  });

  it('goes back to idle when the confirm is declined', () => {
    withBook(1, 3);
    const forget = vi.spyOn(destinationsActions, 'forgetAllRecentPlaces');
    drawV1();

    fireEvent.click(screen.getByTestId('settingsv1-forget-recents'));
    fireEvent.click(screen.getByText('Keep them'));

    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByTestId('settingsv1-forget-recents').textContent).toContain(FORGET_LABEL);
  });

  it('carries the size of what it destroys, which is the number worth reading', () => {
    withBook(1, 7);
    drawV1();

    expect(screen.getByTestId('settingsv1-forget-recents').textContent).toContain('7');
  });

  it('is inert when there is nothing to forget, rather than offering a press that does nothing', () => {
    withBook(2, 0);
    drawV1();

    expect(screen.getByTestId('settingsv1-forget-recents').hasAttribute('disabled')).toBe(true);
  });

  it('is inert before the book has been read back, so it cannot delete a count it has not seen', () => {
    drawV1();

    expect(screen.getByTestId('settingsv1-forget-recents').hasAttribute('disabled')).toBe(true);
  });
});

describe('the note under the group', () => {
  it('states which list this control keeps and which the wipe takes, verbatim', () => {
    withBook(1, 1);
    drawV1();

    // The one sentence that distinguishes this red row from the red row two
    // groups down. Getting it wrong in either direction is a broken promise
    // rather than a copy nit, so it is asserted as an exact string.
    expect(screen.getByText(HISTORY_NOTE)).toBeTruthy();
    expect(HISTORY_NOTE).toBe(
      'Saved places survive a history wipe. Wipe everything on this phone takes both.',
    );
  });
});

describe('the group is drawn where the wipe row can be read against it', () => {
  it('appears before This phone, whose wipe its note is about', () => {
    withBook(1, 1);
    const { container } = render(
      <SettingsScreen surface="phone" removalPort={removedPort()} view={SettingsViewV1} />,
    );

    const labels = [...container.querySelectorAll('.fwm-settingsv1-group-label')].map(
      (el) => el.textContent,
    );
    const history = labels.indexOf('Destination history');
    const phone = labels.indexOf('This phone');
    expect(history).toBeGreaterThanOrEqual(0);
    // A reader who meets the wipe first has already been told the wrong half.
    expect(history).toBeLessThan(phone);
  });
});
