/**
 * WHERE THE PORTRAIT PANEL HANGS FROM -- owner correction, 2026-09-08.
 *
 * =============================================================================
 * WHAT WAS WRONG, AND WHOSE IT WAS
 * =============================================================================
 * `navigation mode search entry behavior.dc.html` draws the portrait panel as
 * 366 x 470 anchored to the BOTTOM of the phone with a field of its own at its
 * top. That drawing was made assuming the panel owns the input. It does not:
 * the portrait top bar is frozen and is already a text field, so a panel that
 * draws a second one puts two inputs on one screen 500px apart and mirrors the
 * typing between them, with the map hidden in between. That is a clone, not a
 * dropdown.
 *
 * The owner corrected the spec rather than the build:
 *
 *   "In portrait there is exactly ONE field, and it is the top search bar. The
 *    panel never renders a field in portrait ... The panel hangs from the bar.
 *    It is a dropdown, not a bottom sheet."
 *
 *   top     = the bar's bottom + 8
 *   left    = the bar's left, right = the bar's right, to the pixel
 *   height  = from there down to the top of the keyboard, minus 8
 *   the row list scrolls internally; the panel itself never grows or moves
 *
 * LANDSCAPE IS UNAFFECTED AND MUST NOT CHANGE. There is no bar in landscape, so
 * there the panel does own its field, at 336 x 418 in the left column. The
 * difference between the two is which surface holds the field, and that follows
 * the bar's existence -- so it is not a thing to "unify".
 *
 * =============================================================================
 * WHY THIS IS MEASURED AND NOT WRITTEN IN CSS
 * =============================================================================
 * The bar's own numbers exist as tokens -- `--fwm-drive-top-inset` for its top
 * band, `--fwm-search-h` for its 56, `--fwm-space-4` for its side insets -- and
 * the panel could add them up. It would be wrong four ways: the panel is
 * PORTALLED to the body and would be re-deriving a position its host already
 * has; `--fwm-drive-top-inset` carries `env(safe-area-inset-top)`, which is a
 * different number on every device and cannot be compared against a measured
 * rect in a test; the bar collapses when it is folded and the sum does not know
 * that; and any future move of the bar would silently leave the panel behind.
 *
 * `getBoundingClientRect` on the bar itself is the same answer with none of
 * that: it is exact by construction, it is already what the browser laid out,
 * and "line up with the bar exactly" stops being an arithmetic claim and
 * becomes a copied number.
 *
 * =============================================================================
 * THE KEYBOARD IS THE SAME MEASUREMENT `keyboard.ts` ALREADY MAKES
 * =============================================================================
 * That file measures `visualViewport` to size the LANDSCAPE panel, and says why
 * a written-down 200 is a guess wearing a measurement's clothes. Portrait needs
 * the same number from the other end -- not "how tall is the panel" but "how
 * much is the keyboard covering" -- so this file asks the same source and
 * publishes an INSET. Where nothing can be measured it is zero, which reduces
 * the panel's bottom edge to the same 8 every other edge takes.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

import { readVisualHeight, watchVisualHeight } from './keyboard.ts';

/** The gap between the bar and the panel, and the panel and the keyboard. */
export const ANCHOR_GAP = 8;

/** The bar's bottom edge, in px from the top of the layout viewport. */
export const ANCHOR_TOP_VAR = '--fwm-sp-anchor-t';
/** The bar's left edge, in px from the left of the layout viewport. */
export const ANCHOR_LEFT_VAR = '--fwm-sp-anchor-l';
/** The inset from the RIGHT of the viewport to the bar's right edge. */
export const ANCHOR_RIGHT_VAR = '--fwm-sp-anchor-r';
/** How much of the bottom of the layout viewport something is covering. */
export const KEYBOARD_INSET_VAR = '--fwm-sp-kb-inset';

/**
 * WHAT THE PANEL IS ANCHORED TO, from what the browser laid out.
 *
 * `top` is the bar's BOTTOM, because that is the edge the panel hangs from; the
 * 8 is added in the stylesheet so the number published here stays a measurement
 * of the bar and not a measurement of the arrangement.
 *
 * `right` is an INSET and not an edge, because the panel is positioned with
 * `left`/`right` rather than a width -- which is what makes "its edges line up
 * with the bar" true on any phone width without either side declaring one.
 *
 * Rounded, because sub-pixel rects are real -- a bar inside a flex column on a
 * fractional-DPR phone lands on 16.004 -- and the check that matters is that
 * the two edges agree, which a rounded pair does and a raw pair does not.
 */
export function barAnchor(
  rect: { top: number; bottom: number; left: number; right: number } | null,
  viewportWidth: number,
): { readonly top: number; readonly left: number; readonly right: number } | null {
  if (rect === null) return null;
  return {
    top: Math.round(rect.bottom),
    left: Math.round(rect.left),
    right: Math.round(viewportWidth - rect.right),
  };
}

/**
 * HOW MUCH OF THE PAGE SOMETHING IS COVERING FROM THE BOTTOM.
 *
 * The soft keyboard, on every platform that reports one: the layout viewport
 * keeps its height and the VISUAL viewport shrinks, and the difference is what
 * is over the page. Zero when there is nothing to measure or nothing covering,
 * clamped so a visual viewport briefly taller than its layout box -- which
 * happens mid-rotation on iOS -- cannot push the panel's bottom edge off the
 * screen.
 *
 * NO THRESHOLD, AND NO GUESS AT "IS THE KEYBOARD UP", for the reason
 * `keyboard.ts` gives at length: a viewport also shrinks for a collapsing
 * address bar, and a panel that ends 8px above whatever is covering the page is
 * correct in both cases without having to tell them apart.
 */
export function keyboardInset(layoutHeight: number | null, visualHeight: number | null): number {
  if (layoutHeight === null || visualHeight === null) return 0;
  return Math.max(0, Math.round(layoutHeight - visualHeight));
}

function readLayoutHeight(): number | null {
  if (typeof window === 'undefined') return null;
  return window.innerHeight;
}

function readViewportWidth(): number | null {
  if (typeof window === 'undefined') return null;
  return window.innerWidth;
}

/**
 * MEASURE THE BAR AND THE KEYBOARD AND PUBLISH BOTH, while `active`.
 *
 * `active` is "portrait, and the panel is open". The properties are written on
 * the ROOT and not on the panel for the same reason `KEYBOARD_HEIGHT_VAR` is:
 * the panel is portalled, so an ancestor-scoped variable would have to follow
 * it through the reparenting the portal exists to do.
 *
 * THEY ARE REMOVED WHEN INACTIVE rather than left at their last values. The
 * stylesheet's fallbacks are the bar's own tokens, and a stale rect from before
 * a rotation is a worse answer than the tokens: it would anchor the panel to
 * where the bar was on the other surface.
 *
 * FOUR THINGS MOVE THE BAR and all four are subscribed: the viewport resizing
 * (rotation, a desktop window), the visual viewport resizing or panning (the
 * keyboard opening, iOS scrolling a focused field into view), and the bar's own
 * box changing without either -- which is what folding it does. The last one is
 * a `ResizeObserver`, because no window event fires for it.
 */
export function useSearchAnchor(
  active: boolean,
  bar: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const root = document.documentElement;

    const clear = (): void => {
      root.style.removeProperty(ANCHOR_TOP_VAR);
      root.style.removeProperty(ANCHOR_LEFT_VAR);
      root.style.removeProperty(ANCHOR_RIGHT_VAR);
      root.style.removeProperty(KEYBOARD_INSET_VAR);
    };

    const apply = (): void => {
      const element = bar.current;
      const width = readViewportWidth();
      const anchor =
        element === null || width === null
          ? null
          : barAnchor(element.getBoundingClientRect(), width);
      if (anchor === null) {
        clear();
        return;
      }
      root.style.setProperty(ANCHOR_TOP_VAR, `${String(anchor.top)}px`);
      root.style.setProperty(ANCHOR_LEFT_VAR, `${String(anchor.left)}px`);
      root.style.setProperty(ANCHOR_RIGHT_VAR, `${String(anchor.right)}px`);
      root.style.setProperty(
        KEYBOARD_INSET_VAR,
        `${String(keyboardInset(readLayoutHeight(), readVisualHeight()))}px`,
      );
    };

    apply();

    const onResize = (): void => {
      apply();
    };
    window.addEventListener('resize', onResize);
    const visual = watchVisualHeight(() => {
      apply();
    });

    /* THE BAR'S OWN BOX, WHICH NO WINDOW EVENT REPORTS. Folding it takes the
       field, the rule and the count row out and the bar keeps its 56 -- but the
       clear key comes and goes with the query, and a future edit to the bar
       that changes its height must not leave the panel eight pixels under
       where the bar used to end. */
    const element = bar.current;
    const observer =
      typeof ResizeObserver === 'undefined' || element === null
        ? null
        : new ResizeObserver(() => {
            apply();
          });
    if (element !== null) observer?.observe(element);

    return () => {
      window.removeEventListener('resize', onResize);
      visual.stop();
      observer?.disconnect();
      clear();
    };
  }, [active, bar]);
}
