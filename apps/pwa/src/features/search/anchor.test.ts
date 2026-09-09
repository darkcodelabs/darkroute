/**
 * THE PORTRAIT PANEL LINES UP WITH THE BAR, OR IT IS A SECOND WINDOW.
 *
 * The owner's correction of 2026-09-08 turned the portrait panel from a
 * bottom-anchored sheet with a field of its own into a dropdown hung off the
 * top bar -- "The panel hangs from the bar. It is a dropdown, not a bottom
 * sheet." A dropdown that is two pixels narrower than the thing it hangs from
 * does not read as a dropdown at all; it reads as a second, slightly wrong
 * window floating under the first. So the whole claim of `anchor.ts` is that
 * the four numbers it publishes are the BAR'S OWN numbers, copied rather than
 * re-derived, and these tests are that claim written down.
 *
 * The pure functions get the harder half, because that is where an off-by-one
 * turns into a visible seam and where a rect is the only evidence. The hook
 * gets the lifecycle: what it writes, that it re-measures when the bar moves,
 * and -- the one nobody notices until a rotation -- that it takes its numbers
 * back down rather than leaving the last surface's rect on the root.
 */

import type { RefObject } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SPEC_INSET } from './keyboard.ts';
import {
  ANCHOR_GAP,
  ANCHOR_LEFT_VAR,
  ANCHOR_RIGHT_VAR,
  ANCHOR_TOP_VAR,
  KEYBOARD_INSET_VAR,
  barAnchor,
  keyboardInset,
  useSearchAnchor,
} from './anchor.ts';

/* ========================================================================== *
 * WHAT A BAR LOOKS LIKE TO THIS MODULE
 * ========================================================================== */

/** The four edges `barAnchor` reads. jsdom lays nothing out, so every one is declared. */
interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * THE PORTRAIT BAR ON A 390pt PHONE: `--fwm-space-4` in from each side, under a
 * 47pt status band, 56 tall. The numbers are the tokens' own, so a failure here
 * is legible against `tokens.css` rather than against an invented rectangle.
 */
const BAR: Box = { top: 47, bottom: 103, left: 16, right: 374 };
const VIEWPORT_W = 390;
const VIEWPORT_H = 844;

const ALL_VARS = [
  ANCHOR_TOP_VAR,
  ANCHOR_LEFT_VAR,
  ANCHOR_RIGHT_VAR,
  KEYBOARD_INSET_VAR,
] as const;

/** Everything the hook has put on the root, as the stylesheet would find it. */
function published(): Record<string, string> {
  const root = document.documentElement;
  const out: Record<string, string> = {};
  for (const name of ALL_VARS) out[name] = root.style.getPropertyValue(name);
  return out;
}

/** All four gone -- what "unmeasured" looks like, and what the CSS fallbacks need. */
const NOTHING: Record<string, string> = {
  [ANCHOR_TOP_VAR]: '',
  [ANCHOR_LEFT_VAR]: '',
  [ANCHOR_RIGHT_VAR]: '',
  [KEYBOARD_INSET_VAR]: '',
};

/**
 * A BAR WHOSE RECT THIS TEST OWNS.
 *
 * `getBoundingClientRect` is stubbed rather than laid out because jsdom returns
 * all zeros for every element it has ever been asked about -- which would make
 * every anchor in this file `{top: 0, left: 0, right: 1024}` and every
 * assertion below vacuously true.
 */
function mountBar(box: Box = BAR): {
  readonly ref: RefObject<HTMLElement | null>;
  readonly element: HTMLDivElement;
  readonly moveTo: (next: Box) => void;
} {
  const element = document.createElement('div');
  element.className = 'fwm-topbar';
  document.body.append(element);
  let current = box;
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        ...current,
        x: current.left,
        y: current.top,
        width: current.right - current.left,
        height: current.bottom - current.top,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  return {
    ref: { current: element },
    element,
    moveTo: (next: Box): void => {
      current = next;
    },
  };
}

/**
 * A `ResizeObserver` THIS TEST FIRES BY HAND. jsdom has none at all, which is
 * also the older-browser path `anchor.ts` guards for, so the absence is a case
 * of its own below and the presence has to be built here.
 */
function stubResizeObserver(): {
  readonly fire: () => void;
  readonly observing: () => readonly Element[];
} {
  const callbacks: (() => void)[] = [];
  const targets: Element[] = [];
  class StubResizeObserver {
    constructor(callback: () => void) {
      callbacks.push(callback);
    }
    observe(target: Element): void {
      targets.push(target);
    }
    unobserve(): void {
      /* nothing observes conditionally here */
    }
    disconnect(): void {
      /* the hook calls this on cleanup; nothing to undo in a stub */
    }
  }
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  return {
    fire: (): void => {
      for (const callback of callbacks) callback();
    },
    observing: (): readonly Element[] => targets,
  };
}

/** A `visualViewport` of a declared height, which jsdom also does not have. */
function stubVisualViewport(height: number): { readonly resizeTo: (next: number) => void } {
  const listeners = new Set<() => void>();
  const viewport = {
    height,
    addEventListener: (_type: string, handler: () => void): void => {
      listeners.add(handler);
    },
    removeEventListener: (_type: string, handler: () => void): void => {
      listeners.delete(handler);
    },
  };
  vi.stubGlobal('visualViewport', viewport);
  return {
    resizeTo: (next: number): void => {
      viewport.height = next;
      for (const handler of [...listeners]) handler();
    },
  };
}

/** The phone this file measures against, unless a case says otherwise. */
function stubPhoneViewport(): void {
  vi.stubGlobal('innerWidth', VIEWPORT_W);
  vi.stubGlobal('innerHeight', VIEWPORT_H);
}

afterEach(() => {
  /* The root is one element shared by every test in this file, so a case that
     fails mid-assertion would otherwise hand its half-written anchor to the
     next one and fail it too. Assertions about removal are made in the tests
     themselves; this only stops a cascade. */
  for (const name of ALL_VARS) document.documentElement.style.removeProperty(name);
  document.body.replaceChildren();
});

/* ========================================================================== *
 * THE ANCHOR
 * ========================================================================== */

describe('the anchor is the bar, copied', () => {
  it('hangs off the bottom edge of the bar, which is the only edge a dropdown starts at', () => {
    /* `top` is the bar's BOTTOM and not its top. The 8 is added in the
       stylesheet, so what is published stays a measurement of the bar rather
       than a measurement of the arrangement -- and a future change to the gap
       is a one-line CSS edit rather than a change to this number's meaning. */
    expect(barAnchor(BAR, VIEWPORT_W)?.top).toBe(BAR.bottom);
  });

  it('gives a bar inset 16 each side a left of 16 and a right of 16', () => {
    /*
     * THE ONE ASSERTION THE WHOLE FILE EXISTS FOR. `right` is published as an
     * INSET from the right of the viewport, not as an edge, because the panel
     * is positioned with `left`/`right` and no width -- and that is what makes
     * "its edges line up with the bar exactly" true on any phone width without
     * either side declaring one. A `right` published as 374 would put the
     * panel's right edge 16px past the bar's on this phone and off the screen
     * on a narrower one.
     */
    const anchor = barAnchor(BAR, VIEWPORT_W);
    expect(anchor).toEqual({ top: 103, left: 16, right: 16 });
  });

  it('keeps the two side edges equal on a wider phone without either one moving', () => {
    /* The same bar on a 430pt phone is wider, not shifted. Left is still the
       bar's left and the inset is still the remainder, so a panel built from
       these two still ends exactly where the bar ends. */
    const wide = barAnchor({ ...BAR, right: 414 }, 430);
    expect(wide).toEqual({ top: 103, left: 16, right: 16 });
  });

  it('does not read the top of the bar, because nothing hangs off it', () => {
    /* Recorded so a future edit that starts publishing `rect.top` as the anchor
       -- an easy mistake to make from the property name alone -- fails here
       rather than showing up as a panel drawn over the bar. */
    const overlapping = barAnchor({ ...BAR, top: -400 }, VIEWPORT_W);
    expect(overlapping).toEqual(barAnchor(BAR, VIEWPORT_W));
  });

  it('rounds both side edges, so a sub-pixel bar still has two edges that agree', () => {
    /*
     * A bar inside a flex column on a fractional-DPR phone lands on 16.004, and
     * its right edge on 373.996. Raw, that is a left of 16.004 against an inset
     * of 16.004 -- equal, but two numbers no test can state and no stylesheet
     * can be read against. Rounded, both are 16, which is the check that
     * matters: the pair AGREES, at a value somebody can look up in `tokens.css`.
     */
    const anchor = barAnchor({ top: 47.2, bottom: 103.4, left: 16.004, right: 373.996 }, VIEWPORT_W);
    expect(anchor).toEqual({ top: 103, left: 16, right: 16 });
    expect(anchor?.left).toBe(anchor?.right);
  });

  it('rounds the subtraction rather than the raw edge, so the inset never inherits a half pixel', () => {
    /* 390 - 373.5 is 16.5, and the published inset has to be one integer.
       Rounding the RIGHT EDGE first and subtracting would publish 16 or 17
       depending on which side of the subtraction the rounding sat on; the
       published number is a rounding of the answer. */
    expect(barAnchor({ ...BAR, right: 373.5 }, VIEWPORT_W)?.right).toBe(17);
  });

  it('returns null for a rect nobody measured, because unmeasured is not the origin', () => {
    /*
     * A zeroed anchor is a REAL POSITION -- top 0, left 0, flush to the right
     * edge -- and publishing it would pin the panel to the top-left corner of
     * the phone the instant the bar went missing. Null is the only answer that
     * lets the caller fall back to the bar's own tokens instead.
     */
    expect(barAnchor(null, VIEWPORT_W)).toBeNull();
  });

  it('takes the same 8 the rest of the layout takes as its gap', () => {
    /* `ANCHOR_GAP` is documentation of the `--fwm-space-2` the stylesheet
       actually adds; it is here so the two cannot drift, and so the portrait
       dropdown's gap and the landscape frame's inset stay the one number. */
    expect(ANCHOR_GAP).toBe(8);
    expect(ANCHOR_GAP).toBe(SPEC_INSET);
  });
});

/* ========================================================================== *
 * THE KEYBOARD
 * ========================================================================== */

describe('how much of the page is covered from the bottom', () => {
  it('is the layout viewport less the part the user can still see', () => {
    expect(keyboardInset(844, 544)).toBe(300);
  });

  it('rounds, so the bottom edge lands on a whole pixel like the other three', () => {
    expect(keyboardInset(844, 543.6)).toBe(300);
  });

  it('is zero when nothing is covering the page, which reduces the panel to the same 8 as every other edge', () => {
    expect(keyboardInset(844, 844)).toBe(0);
  });

  it('is zero when either height is unmeasured, because an unknown keyboard is not a tall one', () => {
    /* The two-armed discipline `keyboard.ts` sets: `null` is "not measured" and
       is neither zero nor the layout height. Here the honest reduction is zero
       -- a panel that ends 8 above the bottom of the page, which is exactly
       what a browser with no `visualViewport` should draw. */
    expect(keyboardInset(null, 544)).toBe(0);
    expect(keyboardInset(844, null)).toBe(0);
    expect(keyboardInset(null, null)).toBe(0);
  });

  it('never goes negative for a visual viewport briefly taller than its layout box', () => {
    /* iOS reports this mid-rotation. Unclamped it becomes a NEGATIVE bottom
       inset, which pushes the panel's bottom edge off the screen and takes the
       last rows of the list with it. */
    expect(keyboardInset(844, 900)).toBe(0);
  });

  it('does not try to tell a keyboard from a collapsing address bar', () => {
    /*
     * DELIBERATELY NO THRESHOLD, for the reason `keyboard.ts` gives at length.
     * A 60px shrink is an address bar and a 300px shrink is a keyboard, and a
     * module that returned 0 for the first would have invented a constant the
     * spec does not contain. The question this answers is "how much is
     * covered", which is right either way: the panel ends 8px above whatever it
     * is, and the driver never sees a row underneath something.
     */
    expect(keyboardInset(844, 784)).toBe(60);
    expect(keyboardInset(844, 544)).toBe(300);
  });
});

/* ========================================================================== *
 * PUBLISHING IT
 * ========================================================================== */

describe('the hook publishes the bar while the panel is open', () => {
  it('writes all four properties on the root, where a portalled panel can read them', () => {
    stubPhoneViewport();
    const bar = mountBar();
    renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    expect(published()).toEqual({
      [ANCHOR_TOP_VAR]: '103px',
      [ANCHOR_LEFT_VAR]: '16px',
      [ANCHOR_RIGHT_VAR]: '16px',
      [KEYBOARD_INSET_VAR]: '0px',
    });
  });

  it('publishes exactly what barAnchor computes from the rect the bar reports', () => {
    /* The hook must not do arithmetic of its own. Same rect, same viewport, and
       the three published lengths are the pure function's three numbers -- so a
       future edit that adds the 8 here instead of in the stylesheet, or reads
       `clientWidth` instead of the width it measured against, fails. */
    stubPhoneViewport();
    const box: Box = { top: 47, bottom: 121.4, left: 12.6, right: 377.2 };
    const bar = mountBar(box);
    renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    const expected = barAnchor(box, VIEWPORT_W);
    expect(expected).not.toBeNull();
    expect(published()).toEqual({
      [ANCHOR_TOP_VAR]: `${String(expected?.top)}px`,
      [ANCHOR_LEFT_VAR]: `${String(expected?.left)}px`,
      [ANCHOR_RIGHT_VAR]: `${String(expected?.right)}px`,
      [KEYBOARD_INSET_VAR]: '0px',
    });
  });

  it('publishes the covered height when the platform reports a visible viewport', () => {
    stubPhoneViewport();
    stubVisualViewport(544);
    const bar = mountBar();
    renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    expect(published()[KEYBOARD_INSET_VAR]).toBe('300px');
  });

  it('publishes nothing at all while the panel is closed', () => {
    stubPhoneViewport();
    const bar = mountBar();
    renderHook(() => {
      useSearchAnchor(false, bar.ref);
    });
    expect(published()).toEqual(NOTHING);
  });

  it('publishes nothing for a bar that is not mounted, rather than throwing', () => {
    /* Landscape has no top bar, and portrait has none for the frame between the
       panel opening and the bar's ref being filled. Either way there is nothing
       to measure and the stylesheet's token fallbacks are the right answer. */
    stubPhoneViewport();
    const empty: RefObject<HTMLElement | null> = { current: null };
    expect(() => {
      renderHook(() => {
        useSearchAnchor(true, empty);
      });
    }).not.toThrow();
    expect(published()).toEqual(NOTHING);
  });
});

describe('the hook takes its numbers back down', () => {
  it('removes all four on unmount rather than leaving the last rect on the root', () => {
    /*
     * A STALE RECT IS WORSE THAN NO RECT. The stylesheet's fallbacks are the
     * bar's own tokens, which are always approximately right; a rect measured
     * before a rotation is a bar from the OTHER surface, and in landscape there
     * is no bar at all -- so leaving it would hang the panel off a position
     * nothing on screen occupies.
     */
    stubPhoneViewport();
    const bar = mountBar();
    const view = renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    expect(published()[ANCHOR_TOP_VAR]).toBe('103px');
    view.unmount();
    expect(published()).toEqual(NOTHING);
  });

  it('removes all four when the panel closes, for the same reason', () => {
    stubPhoneViewport();
    const bar = mountBar();
    const view = renderHook(
      ({ active }: { active: boolean }) => {
        useSearchAnchor(active, bar.ref);
      },
      { initialProps: { active: true } },
    );
    expect(published()[ANCHOR_LEFT_VAR]).toBe('16px');
    view.rerender({ active: false });
    expect(published()).toEqual(NOTHING);
  });
});

describe('the hook re-measures when the bar moves', () => {
  it('re-reads the bar when the viewport resizes', () => {
    /* Rotation, and a desktop window drag. The bar's side insets are a token
       that changes with the surface, so a panel holding the pre-resize numbers
       is one that no longer lines up with the thing it hangs from. */
    stubPhoneViewport();
    const bar = mountBar();
    renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    bar.moveTo({ top: 47, bottom: 91, left: 12, right: 418 });
    vi.stubGlobal('innerWidth', 430);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(published()).toEqual({
      [ANCHOR_TOP_VAR]: '91px',
      [ANCHOR_LEFT_VAR]: '12px',
      [ANCHOR_RIGHT_VAR]: '12px',
      [KEYBOARD_INSET_VAR]: '0px',
    });
  });

  it('re-reads the bar when the visible viewport changes under it', () => {
    /* The keyboard opening, and iOS panning a focused field into view above it.
       Neither fires a window `resize`, and both change how much of the page is
       covered -- which is the panel's bottom edge. */
    stubPhoneViewport();
    const viewport = stubVisualViewport(844);
    const bar = mountBar();
    renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    expect(published()[KEYBOARD_INSET_VAR]).toBe('0px');
    act(() => {
      viewport.resizeTo(508);
    });
    expect(published()[KEYBOARD_INSET_VAR]).toBe('336px');
  });

  it('re-reads the bar when its own box changes, which no window event reports', () => {
    /*
     * FOLDING THE BAR IS THIS CASE. The chevron takes the field, the rule and
     * the count row out and nothing resizes the window; so does the clear key
     * coming and going with the query. Without the `ResizeObserver` the panel
     * stays eight pixels under where the bar used to end, which is a gap or an
     * overlap depending on which way the bar went.
     */
    stubPhoneViewport();
    const observer = stubResizeObserver();
    const bar = mountBar();
    renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    expect(observer.observing()).toEqual([bar.element]);
    bar.moveTo({ top: 47, bottom: 79, left: 16, right: 374 });
    act(() => {
      observer.fire();
    });
    expect(published()[ANCHOR_TOP_VAR]).toBe('79px');
  });

  it('runs on a browser with no ResizeObserver and no visualViewport at all', () => {
    /*
     * This is jsdom's own shape, and it is also a real older browser. The hook
     * must still publish the anchor it CAN measure and must not throw
     * constructing an observer that does not exist -- the panel loses its
     * response to a fold, not its position.
     */
    stubPhoneViewport();
    expect(globalThis.ResizeObserver).toBeUndefined();
    expect(window.visualViewport).toBeUndefined();
    const bar = mountBar();
    const view = renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    expect(published()).toEqual({
      [ANCHOR_TOP_VAR]: '103px',
      [ANCHOR_LEFT_VAR]: '16px',
      [ANCHOR_RIGHT_VAR]: '16px',
      [KEYBOARD_INSET_VAR]: '0px',
    });
    expect(() => {
      view.unmount();
    }).not.toThrow();
    expect(published()).toEqual(NOTHING);
  });

  it('stops listening on unmount, so a resize after the panel closed republishes nothing', () => {
    /* The removal on cleanup is only half of it: a `resize` handler left
       subscribed would put the whole anchor back on the root moments after it
       was taken off, and the panel is gone by then. */
    stubPhoneViewport();
    const viewport = stubVisualViewport(844);
    const bar = mountBar();
    const view = renderHook(() => {
      useSearchAnchor(true, bar.ref);
    });
    view.unmount();
    act(() => {
      window.dispatchEvent(new Event('resize'));
      viewport.resizeTo(508);
    });
    expect(published()).toEqual(NOTHING);
  });
});
