/**
 * THE SEARCH ENTRY PANEL, RENDERED.
 *
 * `panel.test.ts` holds the ranking and the count; this file holds the things
 * that are only true once the component is on a screen -- what it does on open,
 * what survives a rotation, what a press writes down, and the four states.
 *
 * FIVE OF THESE ARE PROMISES RATHER THAN FEATURES, and they are the reason the
 * file exists:
 *
 *   NO SPEED GATE, EVER. The field is usable at any speed. There is no motion
 *   lock, no disabled state, no nag, and this component is handed no speed to
 *   gate on -- which is asserted against the SOURCE as well as the DOM, because
 *   a prop somebody adds later is how it would come back.
 *
 *   ONE FIELD, AND IN PORTRAIT IT IS NOT THIS COMPONENT'S. Owner correction,
 *   2026-09-08: the portrait top bar is frozen and is already a text input, so
 *   the panel draws NO field there and hangs off the bar as a dropdown. Every
 *   claim in this file about a field, a mic or a change key is therefore a
 *   LANDSCAPE claim -- landscape has no bar, so there the panel owns the field
 *   the spec draws at 336 x 418 -- and each one has a portrait half asserting
 *   the opposite: there is no input here AT ALL. Deleted, not hidden. A
 *   `display: none` input is still an input, still counted as a field by a
 *   screen reader, still offered to a password manager and still focusable,
 *   and focusing one on a phone raises a keyboard for a control nobody can
 *   see. So the portrait halves count elements and ask the accessibility tree;
 *   none of them looks for a class name, because a class name is exactly what
 *   a "hide it instead" regression would leave in place.
 *
 *   THE KEYBOARD IS DOWN ON OPEN. Most trips are somewhere the user has already
 *   been, so the panel's job on open is to show those.
 *
 *   ROTATING NEVER RESETS. A reflow, not a remount -- and mounting the field on
 *   the way into landscape is not a remount either: the panel node, the list
 *   node, the scroll offset and the picked destination are all the same ones
 *   afterwards.
 *
 *   NOTHING IS WRITTEN TO HISTORY UNTIL A ROUTE STARTS. A destination looked at
 *   and abandoned leaves no trace.
 */

import { readFileSync } from 'node:fs';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FIRST_RUN_BODY,
  FIRST_RUN_HEADING,
  FIRST_RUN_HOME,
  FIRST_RUN_WORK,
  SEARCH_CHANGE,
  SEARCH_DROP_PIN,
  SEARCH_FOOTER_NOTE,
  SEARCH_PROMPT,
  SEARCH_RESULTS,
  SEARCH_VOICE,
  SearchPanel,
} from './SearchPanel.tsx';
import {
  BADGE_RECENT,
  BADGE_SAVED_HOME,
  COUNT_DASH,
  COUNT_UNKNOWN,
  counted,
} from './panel.ts';
import { EMPTY_BOOK, rememberOnStart } from './places.ts';
import type { RouteOption } from './panel.ts';
import type { PlaceBook, SavedPlace } from './places.ts';
import type { Place } from '../../services/route/planRoute.ts';

const NOW = 1_760_000_000_000;

const HOME: SavedPlace = {
  id: 'home',
  kind: 'home',
  name: 'Home',
  detail: '14 min · 7.2 mi',
  lat: 39.01,
  lon: -94.66,
};

const ANTIOCH: Place = {
  name: '119th & Antioch',
  detail: 'Overland Park, KS',
  lat: 38.92,
  lon: -94.68,
};

const BOOK: PlaceBook = rememberOnStart({ saved: [HOME], recents: [] }, ANTIOCH, NOW);

const OPTIONS: readonly RouteOption[] = [
  { kind: 'fastest', detail: '6 min · 2.4 mi', count: counted(1) },
  { kind: 'fewest-cameras', detail: '8 min · 2.9 mi', count: counted(0) },
  { kind: 'avoid-abuse', detail: '11 min · 3.6 mi', count: counted(0) },
];

/** The panel with the props every test needs and none it does not. */
function panel(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  return (
    <SearchPanel book={BOOK} query="" onQueryChange={() => undefined} {...overrides} />
  );
}

/**
 * THE SAME PANEL IN LANDSCAPE, WHICH IS THE ORIENTATION THAT HAS A FIELD.
 *
 * Not a second component and not a variant -- the same tree with the attribute
 * flipped. It exists so a field test reads as "this is the landscape claim"
 * rather than as three lines of props, and so the portrait half of the same
 * claim is the one that says `panel()`.
 */
function wide(overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) {
  return panel({ orientation: 'landscape', ...overrides });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  /* Not a mock of a search client -- the global. If any path under this
     component reaches the network, whatever it uses to do it, this catches it.
     `TopBar.test.tsx` carries the same spy for the same reason. */
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

describe('what the panel does on open', () => {
  it('opens to places rather than to a cursor, with the keyboard down', () => {
    render(wide());
    const field = screen.getByRole('searchbox', { name: SEARCH_PROMPT });
    /* Focusable, not focused. Nothing in the component calls focus(). */
    expect(document.activeElement).not.toBe(field);
    expect(field).not.toHaveAttribute('autofocus');
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('draws saved places above recents, which is the order the list opens in', () => {
    render(panel());
    const names = screen.getAllByRole('option').map((row) => row.textContent ?? '');
    expect(names[0]).toContain('Home');
    expect(names[1]).toContain('119th & Antioch');
  });

  it('puts the mic INSIDE the field, at the same end as the prompt it answers', () => {
    const { container } = render(wide({ onVoice: () => undefined }));
    const mic = screen.getByRole('button', { name: SEARCH_VOICE });
    expect(mic.closest('.fwm-search-field')).toBe(container.querySelector('.fwm-search-field'));
    /* A peer, not a fallback: it is there with an empty field and no results. */
    expect(mic).toBeVisible();
  });

  it('still DRAWS the mic when no host has wired voice, as a mark rather than a dead key', () => {
    const { container } = render(wide());
    expect(screen.queryByRole('button', { name: SEARCH_VOICE })).toBeNull();
    expect(container.querySelector('.fwm-search-mic')).toBeInTheDocument();
  });

  it('carries the footer sentence that says what the numbers mean', () => {
    render(panel({ onDropPin: () => undefined }));
    expect(screen.getByText(SEARCH_FOOTER_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SEARCH_DROP_PIN })).toBeInTheDocument();
  });

  it('sends nothing while somebody types', () => {
    const onQueryChange = vi.fn();
    render(wide({ onQueryChange }));
    const field = screen.getByRole('searchbox', { name: SEARCH_PROMPT });
    for (const text of ['1', '11', '119', '119t', '119th']) {
      fireEvent.change(field, { target: { value: text } });
    }
    expect(onQueryChange).toHaveBeenCalledTimes(5);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('in portrait the bar is the field, and the panel is only the list', () => {
  it('renders no input of its own -- not a hidden one, not a mirror of the bar', () => {
    const { container } = render(panel({ query: '119th', places: [ANTIOCH] }));
    /* THE ACCESSIBILITY TREE FIRST, because "one field on screen" is a claim
       about what a person or a screen reader can find, and all three of these
       roles are ways an input announces itself. */
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    /* THEN THE COUNT, and it is zero rather than hidden. `display: none` was
       the cheap fix and it is not one: a hidden input is still in the count of
       fields, is still offered a saved password, and can still be focused --
       which on a phone raises the keyboard for a control nobody can see. The
       only way for there to be one field is for there to be one field. */
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('draws neither the mic nor the change key, which are parts of the field it has not got', () => {
    const { container } = render(
      panel({ routes: OPTIONS, query: 'home', onVoice: () => undefined }),
    );
    expect(screen.queryByRole('button', { name: SEARCH_VOICE })).toBeNull();
    /* NOT JUST THE CONTROL, THE MARK. Landscape draws the mic even with no
       host wired to it, so "no voice button" would pass with a mic still
       sitting in a field that should not be here. The panel draws no other
       glyph in this state, so the honest assertion is that it draws none. */
    expect(container.querySelectorAll('svg')).toHaveLength(0);

    fireEvent.click(screen.getByText('Home'));
    expect(screen.queryByText(SEARCH_CHANGE)).toBeNull();
    /* And PICKED leaves nothing pressable but the three route rows: the way
       out of the preview in portrait is the bar, which is the describe below. */
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('is the list, the hairline and the footer, in the order and with the badges it always had', () => {
    const { container } = render(panel({ onDropPin: () => undefined }));
    const list = screen.getByRole('listbox', { name: SEARCH_RESULTS });
    /* NOTHING ABOVE THE LIST. The field used to be the panel's first child;
       the list is now, and that is the dropdown's whole shape. */
    const sheet = container.querySelector('.fwm-search-panel');
    expect(sheet?.firstElementChild?.contains(list)).toBe(true);

    const rows = screen.getAllByRole('option').map((row) => row.textContent ?? '');
    expect(rows[0]).toBe(`${BADGE_SAVED_HOME}Home14 min · 7.2 mi${COUNT_DASH}`);
    expect(rows[1]).toBe(`${BADGE_RECENT}119th & Antiochrecent${COUNT_DASH}`);
    /* The hairline and the footer are still under it, unchanged by the field
       going away -- the footer is what explains the column of dashes above. */
    expect(screen.getByText(SEARCH_FOOTER_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SEARCH_DROP_PIN })).toBeInTheDocument();
  });

  it('reaches the network for nothing while the bar reports what is being typed', () => {
    const { rerender } = render(panel({ query: '1' }));
    for (const text of ['11', '119', '119t', '119th']) {
      rerender(panel({ query: text }));
    }
    /* The same promise as the landscape test above, arriving the other way
       round: in portrait the keystrokes are the bar's and reach this component
       as a prop, and a prop must not start a lookup either. */
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('typing in the bar is how portrait leaves the preview', () => {
  it('drops the picked route when the query moves, because that is a change of mind', () => {
    const onPicked = vi.fn();
    const { container, rerender } = render(panel({ routes: OPTIONS, query: 'home', onPicked }));
    fireEvent.click(screen.getByText('Home'));
    expect(onPicked).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.fwm-search-panel')).toHaveAttribute(
      'data-fwm-state',
      'picked',
    );

    rerender(panel({ routes: OPTIONS, query: 'ho', onPicked }));

    /* WITHOUT THIS THERE IS NO WAY OUT. The panel's own field answers a change
       of mind inline and portrait has not got one, so a person who picked a
       destination and then went back up to the bar would be left looking at
       three route options for the place they just changed their mind about. */
    expect(onPicked).toHaveBeenCalledTimes(2);
    expect(onPicked).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('.fwm-search-panel')).toHaveAttribute(
      'data-fwm-state',
      'typing',
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('holds the preview when the query has not moved, because a rerender is not typing', () => {
    const onPicked = vi.fn();
    const { container, rerender } = render(panel({ routes: OPTIONS, query: 'home', onPicked }));
    fireEvent.click(screen.getByText('Home'));

    /* A host re-rendering for any other reason -- here the keyboard coming up
       -- must not read as a keystroke. The effect keys on the QUERY, not on
       the render, and a pick that cleared itself on the next paint would make
       state 3 unreachable. */
    rerender(panel({ routes: OPTIONS, query: 'home', onPicked, keyboard: true }));

    expect(onPicked).toHaveBeenCalledTimes(1);
    expect(onPicked).not.toHaveBeenCalledWith(null);
    expect(container.querySelector('.fwm-search-panel')).toHaveAttribute(
      'data-fwm-state',
      'picked',
    );
  });

  it('leaves landscape to its own field, which already reports the change itself', () => {
    const onPicked = vi.fn();
    const { container, rerender } = render(wide({ routes: OPTIONS, query: 'home', onPicked }));
    fireEvent.click(screen.getByText('Home'));

    /* THE HOST'S QUERY MOVING IS NOT AN EVENT IN LANDSCAPE. The field is this
       panel's, so a change of mind arrives through its `onChange` -- and
       honouring the prop as well would drop the pick a second time, on a
       render the person did not cause. */
    rerender(wide({ routes: OPTIONS, query: 'ho', onPicked }));
    expect(onPicked).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.fwm-search-panel')).toHaveAttribute(
      'data-fwm-state',
      'picked',
    );

    fireEvent.change(screen.getByRole('searchbox', { name: SEARCH_PROMPT }), {
      target: { value: 'oak' },
    });
    expect(onPicked).toHaveBeenLastCalledWith(null);
  });
});

describe('no speed gate, ever', () => {
  it('leaves the field usable with nothing in the component able to stop it', () => {
    render(wide({ query: '119th' }));
    const field = screen.getByRole('searchbox', { name: SEARCH_PROMPT });
    expect(field).toBeEnabled();
    expect(field).not.toHaveAttribute('readonly');
    expect(field).not.toHaveAttribute('aria-disabled');
  });

  it('locks nothing in portrait either, where every row stays pressable', () => {
    const { container } = render(panel({ query: '119th', places: [ANTIOCH] }));
    /* The portrait half cannot be about a field -- there is not one -- so it
       is about the only things this surface owns: the rows. A motion lock
       would have to land on one of them, and nothing in the panel is disabled
       in any state a moving car can produce. */
    for (const row of screen.getAllByRole('option')) {
      expect(row).toBeEnabled();
      expect(row).not.toHaveAttribute('aria-disabled');
    }
    expect(container.querySelectorAll('[disabled], [aria-disabled]')).toHaveLength(0);
  });

  it('is handed no speed to gate on, and names none', () => {
    /*
     * THE DOM CANNOT PROVE THIS AND THE SOURCE CAN. A motion lock would arrive
     * as a prop, and a prop that does not exist cannot be read. Both spec files
     * and the brief forbid the behaviour; the LANDSCAPE spec still carries two
     * stale sentences promising it, which is exactly why this is a build
     * failure rather than a comment.
     */
    const here = (import.meta as unknown as { readonly dirname: string }).dirname;
    const src = readFileSync(`${here}/SearchPanel.tsx`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    expect(src).not.toMatch(/\bspeed\b|\bvelocity\b|\bmph\b|\bmoving\b|motionLock/i);
    expect(src).not.toMatch(/disabled=\{[^}]*\}[\s\S]{0,80}fwm-search-input/);
  });
});

describe('rotating never resets', () => {
  it('is a reflow: the same panel, the same picked route, the same scroll offset', () => {
    const onPicked = vi.fn();
    const { container, rerender } = render(
      panel({ query: '119th', onPicked, places: [ANTIOCH], routes: OPTIONS }),
    );
    fireEvent.click(screen.getByText('119th & Antioch'));
    const before = container.querySelector('.fwm-search-panel');
    const list = screen.getByRole('listbox', { name: SEARCH_RESULTS });
    list.scrollTop = 40;

    rerender(
      panel({
        query: '119th',
        onPicked,
        places: [ANTIOCH],
        routes: OPTIONS,
        orientation: 'landscape',
      }),
    );

    /* THE SAME DOM NODES. Not equal ones -- the same ones, which is what
       "reflow, not remount" means and is the only way a scroll offset can
       survive a rotation. Mounting the field landscape is owed is not a
       remount of anything else. */
    expect(container.querySelector('.fwm-search-panel')).toBe(before);
    expect(screen.getByRole('listbox', { name: SEARCH_RESULTS })).toBe(list);
    expect(list.scrollTop).toBe(40);
    /* And the panel is still in PICKED, holding the destination it was given
       -- the rotation is not a change of mind and must not clear it. */
    expect(before).toHaveAttribute('data-fwm-state', 'picked');
    expect(onPicked).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('searchbox', { name: SEARCH_PROMPT })).toHaveValue(
      '119th & Antioch',
    );
  });

  it('mounts the field on the way into landscape and takes it away on the way back', () => {
    const { container, rerender } = render(panel({ query: '119th', places: [ANTIOCH] }));
    const before = container.querySelector('.fwm-search-panel');
    expect(container.querySelectorAll('input')).toHaveLength(0);

    rerender(panel({ query: '119th', places: [ANTIOCH], orientation: 'landscape' }));
    /* Landscape has no top bar, so the panel is the only surface that could
       hold an input and it holds the one the spec draws -- already carrying
       the query the bar was holding a moment ago. */
    expect(screen.getByRole('searchbox', { name: SEARCH_PROMPT })).toHaveValue('119th');

    rerender(panel({ query: '119th', places: [ANTIOCH] }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(container.querySelectorAll('input')).toHaveLength(0);
    /* Twice through the field and the panel was never rebuilt. */
    expect(container.querySelector('.fwm-search-panel')).toBe(before);
  });

  it('changes nothing but the orientation attribute and the field that attribute owes it', () => {
    const { container, rerender } = render(panel({ query: '119th', places: [ANTIOCH] }));
    const portrait = container.innerHTML;

    rerender(panel({ query: '119th', places: [ANTIOCH], orientation: 'landscape' }));

    /* ONE TREE, AND THE FIELD IS THE ONLY BRANCH IN IT. Take the field back
       out of the rotated document -- by its input rather than by a class, so a
       renamed wrapper cannot quietly pass this -- and the two are the same
       string. Every other difference between the orientations is resolved in
       `searchPanel.css` off `data-fwm-orient` and none of them is a branch
       here, which is why the row order, the badges and the counts cannot drift
       apart between the two. */
    const rotated = container.cloneNode(true) as HTMLElement;
    rotated.querySelector('input')?.parentElement?.remove();
    expect(rotated.innerHTML).toBe(
      portrait.replace('data-fwm-orient="portrait"', 'data-fwm-orient="landscape"'),
    );
  });
});

describe('the count on every row', () => {
  it('draws a dash rather than a blank or a zero when nobody has measured', () => {
    render(panel());
    const counts = screen.getAllByText(COUNT_DASH);
    expect(counts.length).toBe(2);
    expect(screen.queryByText('0 cams')).toBeNull();
  });

  it('says out loud that it has not measured, because a dash has no reading', () => {
    render(panel());
    expect(screen.getAllByLabelText('camera count not measured yet')).toHaveLength(2);
  });

  it('reports the rows it could not count, so a host can go and measure them', () => {
    const onCountsNeeded = vi.fn();
    render(panel({ onCountsNeeded }));
    expect(onCountsNeeded).toHaveBeenCalledTimes(1);
    expect(onCountsNeeded.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('draws the measured count in its tier once one arrives', () => {
    render(panel({ counts: (place) => (place.name === 'Home' ? counted(2) : COUNT_UNKNOWN) }));
    const cams = screen.getByText('2 cams');
    expect(cams).toHaveAttribute('data-fwm-tier', 'some');
  });
});

describe('3 · PICKED, and 4 · ROUTING', () => {
  it('previews the routes rather than driving, and writes NOTHING to history', () => {
    const onRemember = vi.fn();
    const onStart = vi.fn();
    const onPicked = vi.fn();
    render(panel({ routes: OPTIONS, onRemember, onStart, onPicked }));

    fireEvent.click(screen.getByText('Home'));

    expect(onPicked).toHaveBeenCalledTimes(1);
    /* THE POINT OF STATE 3: a destination looked at and abandoned leaves no
       trace. Neither of these has fired. */
    expect(onRemember).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Fewest cameras')).toBeInTheDocument();
  });

  it('offers the three options fewest-cameras first, with that one as the default', () => {
    render(panel({ routes: OPTIONS }));
    fireEvent.click(screen.getByText('Home'));
    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.textContent ?? '')[0]).toContain('Fewest cameras');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('puts the destination in the field and offers a way back out of the preview', () => {
    render(wide({ routes: OPTIONS, query: 'home' }));
    fireEvent.click(screen.getByText('Home'));
    expect(screen.getByRole('searchbox', { name: SEARCH_PROMPT })).toHaveValue('Home');

    fireEvent.click(screen.getByRole('button', { name: SEARCH_CHANGE }));
    expect(screen.getByRole('searchbox', { name: SEARCH_PROMPT })).toHaveValue('home');
  });

  it('writes the destination to history exactly once, on route start, and dismisses', () => {
    const onRemember = vi.fn();
    const onStart = vi.fn();
    const { container } = render(panel({ routes: OPTIONS, onRemember, onStart }));

    fireEvent.click(screen.getByText('Home'));
    fireEvent.click(screen.getByText('Fewest cameras'));

    expect(onRemember).toHaveBeenCalledTimes(1);
    expect(onRemember.mock.calls[0]?.[0]).toMatchObject({ name: 'Home' });
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'Home' }), 'fewest-cameras');
    /* THE PANEL DISMISSES AND THE DOCK TAKES OVER. */
    expect(container.querySelector('.fwm-search-panel')).toBeNull();
  });

  it('comes back on the next query, so a host that keeps it mounted has no dead panel', () => {
    const { container, rerender } = render(panel({ routes: OPTIONS, query: 'home' }));
    fireEvent.click(screen.getByText('Home'));
    fireEvent.click(screen.getByText('Fewest cameras'));
    expect(container.querySelector('.fwm-search-panel')).toBeNull();

    rerender(panel({ routes: OPTIONS, query: 'oak' }));
    expect(container.querySelector('.fwm-search-panel')).toHaveAttribute(
      'data-fwm-state',
      'typing',
    );
  });

  it('drives straight away when the host offers no preview, the way it always did', () => {
    const onStart = vi.fn();
    const onRemember = vi.fn();
    render(panel({ onStart, onRemember }));
    fireEvent.click(screen.getByText('Home'));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'Home' }), null);
    expect(onRemember).toHaveBeenCalledTimes(1);
  });
});

describe('first run is a sentence', () => {
  it('says what is true, what fills the list, and offers the two actions', () => {
    const onSetSaved = vi.fn();
    render(panel({ book: EMPTY_BOOK, onSetSaved }));

    expect(screen.getByText(FIRST_RUN_HEADING)).toBeInTheDocument();
    expect(screen.getByText(FIRST_RUN_BODY)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: FIRST_RUN_HOME }));
    expect(onSetSaved).toHaveBeenCalledWith('home');
    expect(screen.getByRole('button', { name: FIRST_RUN_WORK })).toBeInTheDocument();
  });

  it('draws no zero, no em dash and no empty list', () => {
    const { container } = render(panel({ book: EMPTY_BOOK }));
    const text = container.textContent ?? '';
    expect(text).not.toContain('—');
    expect(text).not.toContain('0 cams');
    expect(screen.queryByRole('listbox')).toBeNull();
    /* And it says where the list lives, which is the half of the sentence that
       is a promise about the product rather than a prompt to the user. */
    expect(FIRST_RUN_BODY).toContain('on this phone');
  });
});
