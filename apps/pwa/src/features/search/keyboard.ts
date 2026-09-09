/**
 * WHAT THE SOFT KEYBOARD DOES TO THE PANEL -- `DarkRoute Landscape Mode.html`,
 * frame A5, "TYPING, KEYBOARD UP · the honest case · keyboard takes 200 px,
 * chrome yields".
 *
 * =============================================================================
 * ONE RULE PRODUCES BOTH OF THE SPEC'S PUBLISHED HEIGHTS
 * =============================================================================
 * The landscape panel is drawn twice at two different heights, and the document
 * publishes both as though they were two separate constants:
 *
 *   A4, keyboard down   `left: 68px; top: 8px; bottom: 8px; width: 336px`
 *                       -- no height declared. 418 on a real 434pt viewport.
 *   A5, keyboard up     `left: 8px; top: 8px; width: 336px; height: 218px`
 *                       -- height declared, and the keyboard under it is
 *                       `left: 0; right: 0; bottom: 0; height: 200px`.
 *
 * They are not two constants. They are one rule at two viewport heights, and
 * {@link landscapePanelHeight} is it:
 *
 *     panel height = the height actually available to the page, minus an inset
 *                    at the top and an inset at the bottom
 *
 *   no keyboard   434 - 8 - 8                    = 418   <- A4's published number
 *   200 keyboard  (434 - 200) - 8 - 8            = 218   <- A5's DECLARED number
 *
 * Both published numbers fall out of the same subtraction, which is the reason
 * to believe the subtraction rather than to hardcode the two results. And it
 * closes the frame exactly:
 *
 *     8      +  218   +  8    +  200      = 434
 *     inset     panel    gap     keyboard   the viewport
 *
 * {@link landscapeKeyboardCloses} asserts that, so a future edit to any one of
 * the four has to explain itself to a test rather than quietly overlap the
 * keyboard by the difference.
 *
 * =============================================================================
 * A DISAGREEMENT THAT ISN'T ONE, RECORDED BECAUSE IT WAS REPORTED AS ONE
 * =============================================================================
 * `searchPanel.css` currently carries this note against its 218:
 *
 *   "F. GEOMETRY also publishes 'keyboard reserve 200 landscape', which does
 *    not agree with it: a 200px reserve under a 432px frame at top 8 leaves
 *    224, not 218."
 *
 * 224 is 432 - 8 - 200, and it drops the GAP BETWEEN THE PANEL AND THE
 * KEYBOARD. That gap is drawn: A5's panel bottom is at 226 and the keyboard's
 * top edge is at 232, measured. Six in the spec's device mock, which is a 940 x
 * 434 border-box with a 1px bezel -- so eight on a real viewport, which is the
 * same inset every other edge in the layout takes. Put the gap back and the
 * arithmetic is exact at 218 with nothing left over.
 *
 * The reserve and the height agree. Neither number is wrong and the CSS note
 * should go; it is repeated in the run report so the owner's document does not
 * get "corrected" on the strength of it.
 *
 * =============================================================================
 * WHY THIS IS MEASURED AT RUNTIME AND NOT WRITTEN DOWN AS 200
 * =============================================================================
 * 200 is what the drawing reserves, and the drawing is one keyboard on one
 * device. A phone with a suggestion strip, a third-party keyboard, a language
 * with a candidate row, or a split/floating keyboard is not 200 -- and a panel
 * pinned to a 218px height under a 260px keyboard is a panel with its bottom
 * forty pixels underneath it, holding rows nobody can reach or read.
 *
 * `window.visualViewport` is the only thing on the platform that knows. It
 * reports the part of the page the user can actually SEE, with the keyboard
 * already subtracted, which is precisely the input this file's one rule wants.
 * So the height is derived from a measurement, and the spec's 200 survives only
 * as {@link SPEC_KEYBOARD_H} -- documentation of what the drawing assumed, and
 * the fallback used when there is nothing to measure.
 *
 * NO THRESHOLD, AND NO GUESS AT "IS THE KEYBOARD UP". Nothing here decides
 * that. A viewport shrinks for a keyboard, but it also shrinks for a collapsing
 * address bar, and picking a pixel count that separates the two would be
 * inventing a constant the spec does not contain. The panel learns the keyboard
 * is up from FOCUS -- the brief's own words, "WHILE THE FIELD HAS FOCUS" -- and
 * this file only answers "how much room is left", which is a question with a
 * real measurement behind it either way.
 */

import { useEffect } from 'react';

/**
 * THE DRAWING'S OWN FRAME, and it is a reference rather than a constraint.
 * Nothing in the stylesheet declares it; the layout is written in insets off
 * whatever viewport it lands in. It exists so the closure check below has a
 * size to close against.
 */
export const SPEC_FRAME_H = 434;

/** `left: 8`, `top: 8`, `bottom: 8` -- every edge, on every landscape surface. */
export const SPEC_INSET = 8;

/**
 * `height: 200px` on A5's keyboard, declared. The fallback when there is no
 * `visualViewport` to ask -- the spec's own number, used as the spec uses it,
 * rather than a constant invented here.
 */
export const SPEC_KEYBOARD_H = 200;

/** `height: 218px` on A5's panel, declared. What the rule must reproduce. */
export const SPEC_PANEL_H = 218;

/** No keyboard: `top: 8; bottom: 8` in a 434 viewport. What A4 publishes. */
export const SPEC_PANEL_FULL_H = 418;

/**
 * THE RULE. How tall the landscape panel is, given how much of the page the
 * user can actually see.
 *
 * Clamped at zero rather than allowed to go negative: a viewport shorter than
 * its own two insets is a device state this layout has no drawing for, and a
 * negative height is an exception thrown out of a stylesheet rather than a
 * layout anybody can look at.
 */
export function landscapePanelHeight(visualHeight: number, inset: number = SPEC_INSET): number {
  return Math.max(0, Math.round(visualHeight - inset * 2));
}

/**
 * The frame A5 draws, spent: an inset, the panel, the gap, the keyboard.
 *
 * Returns the TOTAL rather than a boolean so a failing test can print what the
 * arrangement actually came to instead of only that it was not 434.
 */
export function landscapeKeyboardSpend(): number {
  return SPEC_INSET + SPEC_PANEL_H + SPEC_INSET + SPEC_KEYBOARD_H;
}

/** True when the drawn arrangement fits the frame it is drawn in, exactly. */
export function landscapeKeyboardCloses(): boolean {
  return landscapeKeyboardSpend() === SPEC_FRAME_H;
}

/**
 * HOW TALL THE VISIBLE PAGE IS, or `null` when the platform will not say.
 *
 * `null` is not zero and it is not the layout height: it is "not measured",
 * and every caller here has to have an answer for it -- which is the same
 * two-armed discipline `panel.ts` applies to a camera count, for the same
 * reason. A panel sized from a number the browser never gave us is a panel
 * whose geometry is a guess wearing a measurement's clothes.
 */
export function readVisualHeight(): number | null {
  if (typeof window === 'undefined') return null;
  const viewport = window.visualViewport;
  return viewport === null || viewport === undefined ? null : viewport.height;
}

/**
 * The panel's height right now, or `null` when nothing can be measured.
 *
 * The caller writes this onto the panel as a custom property and the stylesheet
 * keeps the spec's drawn 218 as the fallback, so a browser with no
 * `visualViewport` still gets the layout the document draws.
 */
export function measuredLandscapePanelHeight(inset: number = SPEC_INSET): number | null {
  const visual = readVisualHeight();
  return visual === null ? null : landscapePanelHeight(visual, inset);
}

/**
 * WATCH IT. `resize` fires when the keyboard opens, closes or changes size;
 * `scroll` fires when the visual viewport is panned within the layout viewport,
 * which happens on iOS whenever a focused field is scrolled into view above the
 * keyboard and which changes nothing about the height but does change when a
 * stale reading gets noticed.
 *
 * Returns a stopper rather than taking an AbortSignal, matching
 * `app/surface.ts`'s `watchSurface` -- the other module in this application
 * that subscribes to a viewport question on behalf of a layout.
 */
export function watchVisualHeight(onChange: (height: number | null) => void): {
  readonly stop: () => void;
} {
  if (typeof window === 'undefined') {
    return { stop: () => undefined };
  }
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) {
    /* Nothing to subscribe to. The caller already has `null` from the initial
       read and there is no event that will ever change it. */
    return { stop: () => undefined };
  }
  const fire = (): void => {
    onChange(viewport.height);
  };
  viewport.addEventListener('resize', fire);
  viewport.addEventListener('scroll', fire);
  return {
    stop: () => {
      viewport.removeEventListener('resize', fire);
      viewport.removeEventListener('scroll', fire);
    },
  };
}

/* ========================================================================== *
 * PUBLISHING IT
 * ========================================================================== */

/**
 * The custom property the stylesheet reads for the keyboard-up panel's height.
 *
 * Written on the ROOT rather than on the panel, for one reason: the panel is
 * portalled (`useSearchPortal.ts`), so the element that hosts it is not fixed
 * and an ancestor-scoped variable would have to follow it. Custom properties
 * inherit from `:root` to every parenting this application could give it.
 */
export const KEYBOARD_HEIGHT_VAR = '--fwm-sp-kb-h';

/**
 * MEASURE THE VISIBLE VIEWPORT AND PUBLISH THE PANEL'S HEIGHT, while `active`.
 *
 * `active` is "landscape, and the field has focus" -- the one state that needs
 * an explicit height. Everywhere else the panel is sized by its own two insets,
 * which is what the spec declares and what already produces 418 and 470.
 *
 * THE PROPERTY IS REMOVED WHEN INACTIVE, not left at its last value. The
 * stylesheet's fallback is the spec's drawn 218, and a stale measurement from
 * the last time a keyboard was up is a worse answer than the drawing -- it
 * would be a height taken while a DIFFERENT keyboard was showing, applied to a
 * frame that has since rotated or resized.
 *
 * AND THE DRAWN 218 IS THE FALLBACK, NOT THE RULE. A browser with no
 * `visualViewport` gets exactly the layout the document draws; a phone with a
 * 260px keyboard gets a panel that ends above it instead of forty pixels
 * underneath it. See this file's header for why 218 cannot simply be written
 * down.
 */
export function useLandscapePanelHeight(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const apply = (visual: number | null): void => {
      if (visual === null) {
        root.style.removeProperty(KEYBOARD_HEIGHT_VAR);
        return;
      }
      root.style.setProperty(
        KEYBOARD_HEIGHT_VAR,
        `${String(landscapePanelHeight(visual))}px`,
      );
    };
    apply(readVisualHeight());
    const watch = watchVisualHeight(apply);
    return () => {
      watch.stop();
      root.style.removeProperty(KEYBOARD_HEIGHT_VAR);
    };
  }, [active]);
}
