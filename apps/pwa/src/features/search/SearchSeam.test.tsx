/**
 * THE SEAM: what happens when the field is tapped, and what survives a rotation.
 *
 * =============================================================================
 * WHY THESE ARE THE TESTS AND THE GEOMETRY IS NOT
 * =============================================================================
 * The panel's markup was copied from a document that renders at real size and
 * its sizes are asserted by `searchPanel.geometry.test.ts` against the
 * stylesheet. Re-asserting them here would be testing a transcription twice.
 *
 * What is NOT written down anywhere, and what breaks silently, is the wiring:
 * a panel that opens with a keyboard over the list it opened to show, a
 * rotation that quietly rebuilds the panel and drops the caret, a rail that
 * stays hidden after the keyboard has gone. Every one of those renders
 * perfectly and is wrong, and none of them throws.
 *
 * `data-fwm-orient` IS ASSERTED, but as a fact about IDENTITY rather than about
 * size: the point of the assertion is that the attribute changed on an element
 * that is the same object it was before the rotation.
 *
 * =============================================================================
 * AND ONE THING IS COUNTED RATHER THAN DESCRIBED: HOW MANY FIELDS THERE ARE
 * =============================================================================
 * The owner's correction of 2026-09-08 -- "in portrait there is exactly ONE
 * field, and it is the top search bar ... delete the panel's field element on
 * that path, do not hide it, do not sync it, do not keep it as a mirror" -- is
 * a claim about the WHOLE SCREEN and not about either component, so neither
 * `TopBar.test.tsx` nor `SearchPanel.test.tsx` can hold it. Each of those sees
 * one half, and each half was already correct on its own: the bar drew a field
 * because the bar IS a field, the panel drew a field because its spec page
 * draws one, and what was wrong was the pair -- two inputs 500px apart,
 * mirroring each other, with the map hidden between them. A count is the only
 * assertion that can see that, and this file is the only place both halves are
 * mounted, so the count lives here.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOPBAR_FOLD, TOPBAR_PLACEHOLDER, TopBar } from '../chrome/TopBar.tsx';
import { counted } from './panel.ts';
import { rememberOnStart } from './places.ts';
import { dismissSearch, raiseSearch, resetSearchRaiseForTests } from './searchRaise.ts';
import { resetSearchPortalForTests } from './useSearchPortal.ts';
import { SEARCH_PORTAL_CLASS } from './useSearchPortal.ts';
import type { RouteOption } from './panel.ts';
import type { PlaceBook, SavedPlace } from './places.ts';
import type { Place } from '../../services/route/planRoute.ts';

/* Both are module state and both survive `cleanup()`. Left un-reset, the first
   test that opens the panel leaves it open for every test after it -- and the
   portal container outlives its host and is found by the next test's queries. */
afterEach(() => {
  cleanup();
  resetSearchRaiseForTests();
  resetSearchPortalForTests();
});

beforeEach(() => {
  /* The promise this surface is not allowed to break, carried over from
     `TopBar.test.tsx`: TYPING SENDS NOTHING. Asserted in its own case below. */
  vi.stubGlobal('fetch', vi.fn());
});

function bar(orientation?: 'portrait' | 'landscape'): void {
  render(<TopBar total={0} {...(orientation === undefined ? {} : { orientation })} />);
}

/**
 * A BOOK WITH SOMETHING IN IT, because three of the states counted below are
 * only reachable through a row: history opens on the list, a query filters it,
 * and PICKED is a row somebody pressed. The bar's own default is `EMPTY_BOOK`,
 * which draws first run -- a card and two keys, and no rows at all.
 */
const NOW = 1_760_000_000_000;

const HOME: SavedPlace = {
  id: 'home',
  kind: 'home',
  name: 'Home',
  detail: '14 min \u00b7 7.2 mi',
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

/* HANDED TO THE BAR SO A ROW PRESS STOPS AT PICKED. Without a `routes` prop the
   panel treats a chosen destination as a drive to start and goes straight
   through PICKED to ROUTING, which draws nothing -- and a state that draws
   nothing cannot be counted. */
const ROUTES: readonly RouteOption[] = [
  { kind: 'fastest', detail: '6 min \u00b7 2.4 mi', count: counted(1) },
  { kind: 'fewest-cameras', detail: '8 min \u00b7 2.9 mi', count: counted(0) },
  { kind: 'avoid-abuse', detail: '11 min \u00b7 3.6 mi', count: counted(0) },
];

/** The panel, wherever it has been parented. */
function panel(): HTMLElement | null {
  return document.querySelector('.fwm-search-panel');
}

/** The bar's own field -- the frozen one, not the panel's. */
function barField(): HTMLElement {
  const found = document.querySelector('.fwm-topbar-field');
  if (found === null) throw new Error('the bar has no field');
  return found as HTMLElement;
}

/** The panel's own field, which exists in landscape and nowhere else. */
function panelField(): HTMLInputElement | null {
  return panel()?.querySelector('input') ?? null;
}

/**
 * EVERY ELEMENT IN THE DOCUMENT THAT WOULD TAKE A KEYSTROKE, HIDDEN ONES TOO.
 *
 * The rule is "DELETE the panel's field element on that path -- do not hide it,
 * do not sync it, do not keep it as a mirror", so the check that enforces it
 * has to be one no stylesheet can satisfy. `querySelectorAll` is exactly that:
 * it returns a `display: none` input the same as a painted one, which is the
 * right answer here rather than a limitation, because an invisible second field
 * is still counted by the accessibility tree, still offered a password
 * manager's fill, still in `document.forms`, and can still be handed focus --
 * which on a phone is a soft keyboard for a control nobody can see.
 *
 * THE WHOLE DOCUMENT, not the render container: the panel is portalled out of
 * the bar's subtree, so a container-scoped query would miss the very field this
 * exists to look for.
 *
 * The three roles are here because a field does not have to be an `<input>` to
 * be one -- a `contenteditable` div announced as a textbox is the shape a
 * "rich" search box arrives in, and it would pass a count that only knew about
 * tags.
 */
function textInputs(): readonly HTMLElement[] {
  const typed = ['text', 'search', 'email', 'tel', 'url', 'password', 'number'];
  return [
    ...document.querySelectorAll<HTMLElement>(
      [
        'input',
        'textarea',
        '[contenteditable]:not([contenteditable="false"])',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
      ].join(', '),
    ),
  ].filter((element) => !(element instanceof HTMLInputElement) || typed.includes(element.type));
}

/**
 * THE SAME COUNT, AS NAMES, so a failure says WHICH second field came back
 * rather than `expected 2 to be 1`. The class is the identity in this file --
 * `barField` and `panelField` both query by it -- and the whole point of the
 * assertion is which surface owns the field, not how many there are.
 */
function inputNames(): readonly string[] {
  return textInputs().map((element) => element.className.trim() || element.tagName.toLowerCase());
}

/* ========================================================================== *
 * 1. THE PANEL OPENS WITH THE KEYBOARD DOWN
 * ========================================================================== */

describe('tapping the field opens the panel with the keyboard down', () => {
  it('raises the panel and leaves the field unfocused', () => {
    /*
     * "THE PANEL OPENS WITH THE KEYBOARD DOWN in both orientations. The field
     * is focusable, not focused. Most trips are somewhere the user has already
     * been, so the panel's job on open is to show those."
     *
     * A tap on a text input focuses it, and a focused input on a phone is a
     * soft keyboard over half the screen -- so the panel would have opened onto
     * a list with two rows showing and the keyboard covering the seven that are
     * the reason it opened. The press is answered instead of the focus, which
     * is why this asserts `activeElement` and not just that the panel exists.
     */
    bar();
    expect(panel()).toBeNull();

    fireEvent.pointerDown(barField());

    expect(panel()).not.toBeNull();
    expect(document.activeElement).not.toBe(barField());
    expect(panel()?.dataset['fwmKeyboard']).toBe('down');
  });

  it('does not stop a deliberate focus from reaching the field', () => {
    /* NOTHING IS DISABLED. Tab still lands here, and a keyboard user who gets
       there is not using a soft keyboard at all -- so focus is honoured, the
       panel opens, and the chrome is told to yield. */
    bar();
    fireEvent.focus(barField());
    expect(panel()?.dataset['fwmKeyboard']).toBe('up');
  });

  it('sends nothing while somebody types', () => {
    bar();
    fireEvent.pointerDown(barField());
    fireEvent.change(barField(), { target: { value: 'metcalf' } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

/* ========================================================================== *
 * 2. ONE FIELD, AND IN PORTRAIT IT IS THE BAR'S
 * ========================================================================== */

describe('how many fields are on the screen', () => {
  it('only one text input exists on screen in portrait at any time', () => {
    /*
     * THE CORRECTION THIS CASE EXISTS FOR, owner, 2026-09-08:
     *
     *   "In portrait there is exactly ONE field, and it is the top search bar.
     *    The panel never renders a field in portrait. Delete the panel's field
     *    element on that path -- do not hide it, do not sync it, do not keep it
     *    as a mirror. The bar is the input; the panel is only the result list."
     *
     * AND IT IS ASSERTED IN EVERY STATE RATHER THAN ONCE, which is the whole
     * design of this case. A second field is not a thing a component either has
     * or does not have: the panel draws different chrome in each of its four
     * states -- the mic in IDLE and TYPING, the word `change` in PICKED,
     * nothing at all in ROUTING -- so a field that came back in one of them
     * would pass any assertion made in another. The states below are the ones a
     * person actually moves through, in the order they move through them, and
     * the rotation at the end is there because the field is drawn from a branch
     * on the orientation and coming back from landscape is the path that branch
     * is most likely to leave a field behind on.
     *
     * The count is over the DOCUMENT and it includes hidden elements -- see
     * `textInputs` -- because the rule is delete rather than hide.
     */
    const view = render(<TopBar total={0} orientation="portrait" book={BOOK} routes={ROUTES} />);

    /* SHUT. The bar is already a field before anything has been opened, which
       is the fact the whole correction turns on. */
    expect(panel()).toBeNull();
    expect(inputNames()).toEqual(['fwm-topbar-field']);

    /* OPEN ON HISTORY. The panel that arrives is a list and nothing else. */
    fireEvent.pointerDown(barField());
    expect(panel()?.dataset['fwmState']).toBe('idle');
    expect(panelField()).toBeNull();
    expect(inputNames()).toEqual(['fwm-topbar-field']);

    /* MID-TYPING. The state a mirror would have been added to keep in sync,
       and the one the two-field screen was reported from. */
    fireEvent.change(barField(), { target: { value: '11' } });
    expect(panel()?.dataset['fwmState']).toBe('typing');
    expect(inputNames()).toEqual(['fwm-topbar-field']);

    /* WITH RESULTS UNDER IT. Rows are what the panel is FOR, so a count taken
       on an empty list would be a count taken on the easy case. */
    fireEvent.change(barField(), { target: { value: '119th' } });
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    expect(inputNames()).toEqual(['fwm-topbar-field']);

    /* PICKED, with a destination chosen and three route options showing. The
       panel swaps the mic for `change` here, so this is the state where a
       field would be redrawn rather than merely left in place. */
    const [first] = screen.getAllByRole('option');
    expect(first).toBeDefined();
    fireEvent.click(first as HTMLElement);
    expect(panel()?.dataset['fwmState']).toBe('picked');
    expect(inputNames()).toEqual(['fwm-topbar-field']);

    /* AND AFTER A ROUND TRIP THROUGH LANDSCAPE. The panel is the same element
       across both rotations -- section 4 holds that -- so a field created for
       landscape is a field that has to be taken away again, and this is where
       one that was hidden instead of removed would still be sitting. */
    view.rerender(<TopBar total={0} orientation="landscape" book={BOOK} routes={ROUTES} />);
    view.rerender(<TopBar total={0} orientation="portrait" book={BOOK} routes={ROUTES} />);
    expect(panel()?.dataset['fwmOrient']).toBe('portrait');
    expect(panelField()).toBeNull();
    expect(inputNames()).toEqual(['fwm-topbar-field']);
  });

  it('gives landscape its field on the panel, and the bar keeps drawing one this seam cannot remove', () => {
    /*
     * THE OTHER HALF OF THE SAME RULE, AND IT IS NOT THE SAME ASSERTION.
     *
     *   "LANDSCAPE IS UNAFFECTED AND MUST NOT CHANGE. There is no top bar in
     *    landscape, so there the panel DOES own its field, at 336 x 418 in the
     *    left column, exactly as specified. Don't unify these."
     *
     * The first half of that is asserted below and it holds: the panel draws a
     * real 46px field in landscape and it is the one the spec draws.
     *
     * THE SECOND HALF IS NOT THIS COMPONENT'S TO DELIVER, AND IT IS NOT
     * DELETED. `TopBar` draws its own field in BOTH orientations -- the only
     * thing it gates the field on is the fold -- and what takes the bar off the
     * landscape screen is DRIVE's container rule,
     * `[data-fwm-surface='dash'] .fwm-drive-top { display: none }`. That is a
     * HIDE, and by the standard the portrait half of this rule is written to --
     * "a `display: none` input is still an input" -- the landscape screen
     * therefore carries two fields, one of them invisible. It is also a rule no
     * test here can evaluate: `vitest.config.ts` sets `css: false`, so nothing
     * in jsdom applies it and the bar's field is not merely present but
     * painted.
     *
     * So the count is asserted AS IT IS rather than as the correction assumes
     * it to be, and both members are named. Nothing is loosened by that -- this
     * is the strictest statement available -- and the day the bar stops drawing
     * a field it cannot use, this case fails and points at the sentence above.
     */
    render(<TopBar total={0} orientation="landscape" book={BOOK} />);
    act(() => {
      raiseSearch();
    });

    const field = panelField();
    expect(field).not.toBeNull();
    expect(field?.className).toBe('fwm-search-input');
    expect(panel()?.contains(field)).toBe(true);

    expect(inputNames()).toEqual(['fwm-topbar-field', 'fwm-search-input']);
  });
});

/* ========================================================================== *
 * 3. NO SPEED GATE, EVER
 * ========================================================================== */

describe('no speed gate', () => {
  it('leaves the field usable with nothing disabled, readonly or inert', () => {
    /*
     * "The field is usable at any speed - no motion lock, no disabled state, no
     * nag. Passengers type. People at lights type. The app does not decide who
     * is driving."
     *
     * There was nothing to delete: the gate exists only in two stale sentences
     * of the landscape spec's prose, which its own A4 body and both of the
     * search spec's rules contradict. This is the guard that stops one being
     * added later -- and it is on the SEAM rather than in `SearchPanel.test.tsx`
     * because the seam is where a speed would have to arrive from.
     *
     * WHICH FIELD IT IS DEPENDS ON THE ORIENTATION, and that is all the owner's
     * correction changed about this case. The claim is unchanged -- whatever is
     * on the screen accepts typing at any speed -- but in portrait the field on
     * the screen is the BAR's, and in landscape it is the PANEL's, so both are
     * checked against all four of the ways a gate could arrive. Checking only
     * one of them would leave the surface a motion lock would be easiest to add
     * to untested, and after the correction that surface changed.
     */
    const view = render(<TopBar total={0} orientation="portrait" />);
    const field = barField() as HTMLInputElement;
    expect(field.disabled).toBe(false);
    expect(field.readOnly).toBe(false);
    expect(field.getAttribute('aria-disabled')).toBeNull();
    /* `inert` is a property jsdom does not implement, so the ATTRIBUTE is
       what can be asserted here -- which is the thing a motion lock would have
       had to set anyway. */
    expect(field.getAttribute('inert')).toBeNull();

    /* AND OPENING THE PANEL IN PORTRAIT ADDS NOTHING TO GATE. This used to
       reach for the panel's own input and check the same four things on it;
       there is no such input any more, and "there is nothing here to disable"
       is a stronger answer to the same question than "it is not disabled". */
    fireEvent.pointerDown(field);
    expect(panel()).not.toBeNull();
    expect(panelField()).toBeNull();

    /* LANDSCAPE, WHERE THE FIELD IS THE PANEL'S. Rotated rather than mounted
       fresh, because a gate that arrived with the rotation -- the moment the
       app decides it is on a dash in a moving car -- is exactly the one worth
       catching. */
    view.rerender(<TopBar total={0} orientation="landscape" />);
    const wide = panelField();
    expect(wide).not.toBeNull();
    expect(wide?.disabled).toBe(false);
    expect(wide?.readOnly).toBe(false);
    expect(wide?.getAttribute('aria-disabled')).toBeNull();
    expect(wide?.getAttribute('inert')).toBeNull();
  });
});

/* ========================================================================== *
 * 4. ROTATING NEVER RESETS
 * ========================================================================== */

describe('rotation is a reflow, not a remount', () => {
  it('keeps the same element, the query and the caret across an orientation change', () => {
    /*
     * THE ASSERTION THAT MATTERS IS `toBe`, not `toEqual`. Caret position,
     * scroll offset and focus are properties of a LIVE DOM NODE: they do not
     * survive being re-created, and a component that re-mounted would still
     * pass every assertion about the query, which is React state. So the test
     * holds the node's identity.
     *
     * This is also why the panel is portalled. `drive.css` puts
     * `display: none` on the bar's container in landscape, and a hidden subtree
     * has no layout -- a scrolled list returns to the top and the browser moves
     * focus to `<body>`. `useSearchPortal.ts` argues it in full.
     */
    const view = render(<TopBar total={0} orientation="portrait" />);
    const field = barField() as HTMLInputElement;
    fireEvent.pointerDown(field);
    fireEvent.change(field, { target: { value: '119th and Ant' } });

    const before = panel();
    expect(before).not.toBeNull();
    expect(before?.dataset['fwmOrient']).toBe('portrait');
    /* THE CARET IS IN THE BAR, BECAUSE IN PORTRAIT THAT IS THE ONLY FIELD. This
       used to reach into the panel for it. */
    expect(panelField()).toBeNull();
    /* `act`, because focusing the bar's field is a state change in `TopBar` --
       its `onFocus` reports the keyboard -- and an unwrapped one leaves React
       warning on stderr through a passing run. */
    act(() => {
      field.focus();
    });
    field.setSelectionRange(3, 3);

    /* THE ROTATION. One attribute changes; nothing is keyed on it. */
    view.rerender(<TopBar total={0} orientation="landscape" />);

    const after = panel();
    expect(after).toBe(before); // the SAME object, not an equal one
    expect(after?.dataset['fwmOrient']).toBe('landscape');

    /*
     * AND THE QUERY SURVIVES THE HANDOVER BETWEEN THE TWO FIELDS.
     *
     * This is what the correction turned this rotation into: portrait types
     * into the bar, landscape types into the panel, so rotating does not merely
     * reflow one field -- it moves the query from a field that is about to
     * leave the screen to one that has just arrived. It arrives already holding
     * the string because there is ONE query and the host owns it; a panel that
     * kept its own copy would arrive empty and take the driver's typing with
     * it, and it would render perfectly while doing so.
     */
    expect(panelField()?.value).toBe('119th and Ant');

    /*
     * THE CARET IS STILL ASSERTED ON THE BAR'S FIELD, and deliberately not on
     * the panel's. `toBe` is the point of this case -- a live node's selection
     * is the one thing a remount cannot fake -- and the panel's field did not
     * exist a moment ago, so a selection on it would be evidence of nothing.
     * The bar's field is the node that spans the rotation, so it is the node
     * that can carry the claim.
     *
     * (On the real landscape surface `drive.css` hides the bar and the browser
     * moves focus to the body -- that stylesheet states the cost itself. What
     * is asserted here is the half this tree is responsible for: nothing in it
     * rebuilt the bar under the caret.)
     */
    expect(barField()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(3);
  });

  it('keeps the list scrolled where it was', () => {
    /* The offset is a property of the element, so this passes only because the
       element was never hidden, detached or rebuilt. jsdom does not lay out, so
       the value is set by hand -- what is under test is that nothing throws it
       away, which is a wiring question rather than a layout one. */
    const view = render(<TopBar total={0} orientation="portrait" />);
    fireEvent.pointerDown(barField());
    const list = panel()?.querySelector('.fwm-search-list') as HTMLElement;
    list.scrollTop = 96;

    view.rerender(<TopBar total={0} orientation="landscape" />);

    expect(panel()?.querySelector('.fwm-search-list')).toBe(list);
    expect(list.scrollTop).toBe(96);
  });
});

/* ========================================================================== *
 * 5. ONE COMPONENT, AND IT IS PARENTED OUT OF THE BAR
 * ========================================================================== */

describe('one panel, parented where no surface rule can hide it', () => {
  it('draws exactly one panel in either orientation', () => {
    /* "If a second search component exists in the codebase when you are done,
       the task failed." The cheap runtime half of that rule. */
    const view = render(<TopBar total={0} orientation="portrait" />);
    fireEvent.pointerDown(barField());
    expect(document.querySelectorAll('.fwm-search-panel')).toHaveLength(1);
    view.rerender(<TopBar total={0} orientation="landscape" />);
    expect(document.querySelectorAll('.fwm-search-panel')).toHaveLength(1);
  });

  it('parents the panel outside the bar, so hiding the bar cannot hide it', () => {
    bar();
    fireEvent.pointerDown(barField());
    const host = document.querySelector(`.${SEARCH_PORTAL_CLASS}`);
    expect(host).not.toBeNull();
    expect(host?.contains(panel())).toBe(true);
    /* The thing `[data-fwm-surface='dash'] .fwm-drive-top { display: none }`
       would otherwise take with it. */
    expect(document.querySelector('.fwm-topbar-shell')?.contains(panel())).toBe(false);
  });
});

/* ========================================================================== *
 * 6. THE OTHER OPENER, AND DISMISSAL
 * ========================================================================== */

describe('the landscape right-rail button, and putting it away', () => {
  it('opens from outside the bar entirely', () => {
    /*
     * Section D: "Search becomes the first right-rail button and opens the
     * destination panel in section A4." That button is in `ShellDock`'s tree,
     * not this one, so it cannot be pressed from here -- what is asserted is
     * the seam it presses: `raiseSearch()` raises the bar's panel with nobody
     * having touched the bar.
     */
    bar('landscape');
    expect(panel()).toBeNull();
    act(() => {
      raiseSearch();
    });
    expect(panel()).not.toBeNull();
    expect(panel()?.dataset['fwmOrient']).toBe('landscape');
    expect(panel()?.dataset['fwmKeyboard']).toBe('down');
  });

  it('takes the panel away again, and its container with it', () => {
    /* "Everything returns the instant the field is dismissed." */
    bar('landscape');
    act(() => {
      raiseSearch();
    });
    expect(panel()).not.toBeNull();
    act(() => {
      dismissSearch();
    });
    expect(panel()).toBeNull();
  });

  it('is not refused by a fold made in the other orientation', () => {
    /*
     * The fold is the BAR's, and landscape has no bar. Left as it was, a
     * chevron pressed in portrait travelled through a rotation and silently
     * refused the right-rail button, which is the only opener landscape has.
     */
    const view = render(<TopBar total={0} orientation="portrait" />);
    fireEvent.click(screen.getByLabelText(TOPBAR_FOLD));
    view.rerender(<TopBar total={0} orientation="landscape" />);
    act(() => {
      raiseSearch();
    });
    expect(panel()).not.toBeNull();
  });
});

/* Kept honest: the placeholder the bar draws is the one the panel names itself
   with, and a rename that split them would make the two fields read as two
   different features. */
it('the bar and the panel ask the same question', () => {
  bar();
  fireEvent.pointerDown(barField());
  expect(screen.getAllByLabelText(TOPBAR_PLACEHOLDER).length).toBeGreaterThan(0);
});

/* ========================================================================== *
 * 6. A TAP ANYWHERE ELSE PUTS THE PORTRAIT DROPDOWN AWAY
 * ========================================================================== */
describe('a press outside the portrait dropdown', () => {
  /*
   * "There is no way to close this if you accidentally open it. Just allow
   * clicking out of it to close it" -- owner, 2026-09-09. The press is fired
   * on `document.body` because that is what the map canvas is to the panel:
   * something that is neither the bar nor the list.
   */
  it('shuts the panel', () => {
    bar('portrait');
    fireEvent.pointerDown(barField());
    expect(panel()).not.toBeNull();

    fireEvent.pointerDown(document.body);

    expect(panel()).toBeNull();
  });

  it('leaves it up when the press is on the panel itself', () => {
    render(<TopBar total={0} orientation="portrait" book={BOOK} routes={ROUTES} />);
    fireEvent.pointerDown(barField());
    const list = panel();
    if (list === null) throw new Error('the panel did not open');

    fireEvent.pointerDown(list);

    expect(panel()).toBe(list);
  });

  it('leaves it up when the press is on the bar', () => {
    bar('portrait');
    fireEvent.pointerDown(barField());
    const list = panel();

    fireEvent.pointerDown(barField());

    expect(panel()).toBe(list);
  });

  it('changes nothing in landscape, whose panel the right-rail key puts away', () => {
    bar('landscape');
    act(() => {
      raiseSearch();
    });
    expect(panel()).not.toBeNull();

    fireEvent.pointerDown(document.body);

    expect(panel()).not.toBeNull();
  });
});
