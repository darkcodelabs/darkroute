/**
 * LANDSCAPE MODE'S GEOMETRY -- `DarkRoute Landscape Mode.html`, sections A to D.
 *
 * =============================================================================
 * EVERY NUMBER HERE WAS READ OUT OF CHROMIUM, NOT COPIED FROM THE PROSE
 * =============================================================================
 * The spec file renders five frames at real size. This module carries the CSS
 * DECLARATIONS those frames make -- `left: 8`, `width: 52`, `left: 68`,
 * `height: 84` -- rather than the pixel boxes `getBoundingClientRect()` reports,
 * and the difference between those two readings is the single most important
 * thing in this file. It is explained in full below because it decides four
 * numbers and it looked, on first measurement, like four arithmetic errors in
 * the owner's document.
 *
 * =============================================================================
 * THE BEZEL, AND WHY THE MEASURED BOX IS TWO PIXELS SHORT OF THE PUBLISHED ONE
 * =============================================================================
 * Each frame in the spec is a DEVICE MOCK: a 940 x 434 `border-box` div with
 * `border: 1px solid rgb(38,45,54)` and `border-radius: 26px`, drawn to look
 * like a head unit sitting on the page. Its CONTENT box is therefore 938 x 432,
 * and every `left`/`right`/`top`/`bottom` inside it resolves against 938 x 432.
 *
 * So a rail declared `left: 8; top: 8; bottom: 8` measures 416 tall in the
 * mock, and the clear band between the content column and the right rail
 * measures 482. Production has no bezel: on a real 940 x 434 viewport the same
 * declarations give 418 and 484 -- which are exactly the numbers section C and
 * section D publish ("336 x 418 full-height panel", "484 px between the two
 * columns stays clear at all times").
 *
 * THE DOCUMENT IS RIGHT AND THE MEASUREMENT IS RIGHT; they are measuring two
 * different boxes. The proof is that the horizontal budget closes to the pixel
 * only with 484, and {@link landscapeWidthCloses} asserts it:
 *
 *     8 + 52 + 8 + 336 + 484 + 44 + 8 = 940
 *   inset rail gap column clear right inset
 *
 * With the mock's 482 it closes to 938, which is the mock's content box. One
 * arrangement, two frames of reference. Nothing here is re-derived: the
 * constants below are the declarations, and the closure test is the check that
 * they are self-consistent at the size the drawing is drawn at.
 *
 * =============================================================================
 * WHAT IS NOT IN THIS FILE
 * =============================================================================
 * No colour. Not one hex, not one token name -- `scripts/check-design-values.mjs`
 * fails the build on a raw value outside `tokens.css`, and the deeper reason is
 * the one `dockState.ts` gives: the driver picked one of seventeen skins and
 * every surface follows all of them. Paint is in `landscape.css`.
 *
 * No React. This module is imported by the stylesheet's conformance test and by
 * the components, and a geometry contract that could not be read without a DOM
 * would be a contract nothing could check.
 */

/**
 * THE DRAWING'S OWN VIEWPORT. 940 x 434, and it is a REFERENCE rather than a
 * constraint: nothing in `landscape.css` declares either number, because the
 * layout is written entirely in insets off the viewport it lands in. These two
 * exist so the closure tests have a size to close against, and so a reader can
 * tell which frame the ratios below were drawn in.
 */
export const LANDSCAPE_FRAME_W = 940;
export const LANDSCAPE_FRAME_H = 434;

/**
 * The bezel on the spec's device mock. Not a production value -- it is here so
 * {@link landscapeMockGap} can state, in code, why a measurement of the file
 * disagrees with the file's own prose by exactly two.
 */
export const SPEC_MOCK_BEZEL = 1;

/** `left: 8; top: 8; right: 8; bottom: 8` -- every edge, on every surface. */
export const LANDSCAPE_INSET = 8;

/* ------------------------------------------------------------------------ *
 * THE LEFT RAIL -- section B, "Tab bar: rotates into the 52 px left rail"
 * ------------------------------------------------------------------------ */

/** The rail's own width. Section D calls it "a full-height rail". */
export const RAIL_W = 52;
/** `border-radius: 22px`, the same card radius every other surface takes. */
export const RAIL_RADIUS = 22;
/** `padding: 6px 4px`. */
export const RAIL_PAD_Y = 6;
export const RAIL_PAD_X = 4;
/** `gap: 2px`, between the logo cell and the stack and between the tabs. */
export const RAIL_GAP = 2;

/**
 * THE TAB TARGET IS 42 x 52 AND NOT 52 x 52, and this is a real disagreement
 * with the document rather than another bezel artefact.
 *
 * Section D says "Five items at 52 x 52 in a full-height rail". All five
 * measure 42.00 x 52.00 in every frame, and they cannot be anything else: the
 * rail is 52 wide with a 1px hairline each side and 4px of horizontal padding,
 * which leaves 42 for a stretched child. The 52 in that sentence is the RAIL's
 * width, which the item inside it cannot also have.
 *
 * A genuine 52px-square target needs a 62px rail, and that moves the content
 * column, the clear band and the whole horizontal budget. It is not a change
 * this file can make on its own reading of one sentence, so the DRAWING wins
 * and the disagreement is reported. See the run notes.
 */
export const TAB_W = RAIL_W - SPEC_MOCK_BEZEL * 2 - RAIL_PAD_X * 2;
export const TAB_H = 52;
/** `border-radius: 14px` on every tab, active or idle. */
export const TAB_RADIUS = 14;
/** The 19px glyph. Portrait's tab row draws 21; the rail is a narrower column. */
export const TAB_GLYPH = 19;
/** The 9px label under it. Portrait draws 11. */
export const TAB_LABEL = 9;

/** The logo cell at the top of the rail: a 52px row holding a 42px mark. */
export const LOGO_CELL_H = 52;
export const LOGO_PX = 42;

/* ------------------------------------------------------------------------ *
 * THE CONTENT COLUMN -- section C, "336 px wide, top slot 84, bottom slot 96"
 * ------------------------------------------------------------------------ */

/**
 * `left: 68px`. Not declared as a sum anywhere in the spec, but it is one:
 * the inset, the rail and one more inset. {@link landscapeWidthCloses} checks
 * that this is still true if any of the three is ever re-cut.
 */
export const COLUMN_LEFT = 68;
/** `width: 336px`, in both modes and in the expanded panel. */
export const COLUMN_W = 336;

/** Section C: "top slot 84 . bottom slot 96 . both locked". */
export const TOP_SLOT_H = 84;
export const BOTTOM_SLOT_H = 96;
/**
 * "an alert inserts a third 56 px band under the top slot rather than growing
 * it" -- section C. The band is a THIRD element, which is why the top slot's
 * height is a constant and not a range.
 */
export const ALERT_BAND_H = 56;

/** Card radius 22, alert band 18, tab 14 -- the spec's own caption in A1. */
export const SLOT_RADIUS = 22;
export const ALERT_RADIUS = 18;

/** `padding: 0 16px` on both slots; the alert band is tighter at 14. */
export const SLOT_PAD_X = 16;
export const ALERT_PAD_X = 14;

/** The bottom slot is a header, a hairline and a footer, and they are locked. */
export const BOTTOM_HEADER_H = 58;
export const BOTTOM_FOOTER_H = 36;
/** A3's footer is 44 rather than 36 -- it is the panel's floor, not a slot's. */
export const PANEL_FOOTER_H = 44;
/** `padding: 5px 10px` on the scrolling body of A3. */
export const PANEL_BODY_PAD_Y = 5;
export const PANEL_BODY_PAD_X = 10;

/* ------------------------------------------------------------------------ *
 * THE NEARBY LIST -- A3
 * ------------------------------------------------------------------------ */

/** 314 x 44, `padding: 0 8px`, `gap: 11px`, radius 12. */
export const ROW_H = 44;
export const ROW_RADIUS = 12;
export const ROW_PAD_X = 8;
export const ROW_GAP = 11;
/** The 9px owner dot that leads every row. */
export const OWNER_DOT = 9;

/* ------------------------------------------------------------------------ *
 * THE RIGHT RAIL -- section B, "44 px circles, 7 px gaps"
 * ------------------------------------------------------------------------ */

export const CIRCLE = 44;
export const CIRCLE_GAP = 7;
export const CIRCLE_GLYPH = 19;
/** How many controls the rail holds: search, layers, day/night, report, gear. */
export const CIRCLE_COUNT = 5;

/* ------------------------------------------------------------------------ *
 * THE SCRIM AND THE BAND
 * ------------------------------------------------------------------------ */

/**
 * "The gradient runs left-to-right across the left 470 px" -- section D. A SIDE
 * scrim and never a bottom one, because "a bottom scrim in landscape would dim
 * the horizon, which is where the next turn appears".
 */
export const SCRIM_W = 470;

/**
 * "484 px between the two columns stays clear at all times. That band is the
 * road ahead and the vehicle puck -- it is not available for chrome, ever."
 *
 * PUBLISHED, NOT DERIVED, and then checked against the derivation. If a future
 * change to any of the five other horizontal numbers stops the budget closing,
 * the failure should name THIS rule rather than silently narrowing the road.
 */
export const CLEAR_BAND = 484;

/* ------------------------------------------------------------------------ *
 * THE CHECKS
 * ------------------------------------------------------------------------ */

/**
 * The horizontal budget, as the drawing spends it. Returns the total so a
 * failing test can print what it came to rather than just that it was not 940.
 */
export function landscapeWidthSpend(): number {
  return (
    LANDSCAPE_INSET +
    RAIL_W +
    (COLUMN_LEFT - LANDSCAPE_INSET - RAIL_W) +
    COLUMN_W +
    CLEAR_BAND +
    CIRCLE +
    LANDSCAPE_INSET
  );
}

/** True when the arrangement fits the frame it is drawn in, exactly. */
export function landscapeWidthCloses(): boolean {
  return landscapeWidthSpend() === LANDSCAPE_FRAME_W;
}

/**
 * How far a reading taken inside the spec's device mock falls short of the
 * published number, for a length measured between two opposite insets.
 *
 * Two, always -- one bezel at each end. Stated as a function rather than as a
 * literal so the reason travels with the number: anyone who measures the file
 * and gets 482 or 416 can find this and stop looking for the missing pixels.
 */
export function landscapeMockGap(): number {
  return SPEC_MOCK_BEZEL * 2;
}

/**
 * The rail's tab stack, as a height. Five targets and four gaps -- the number
 * the rail needs before the stack starts clipping, which is the floor nothing
 * in the spec states and every short landscape viewport is going to test.
 */
export function railStackHeight(): number {
  return TAB_H * CIRCLE_COUNT + RAIL_GAP * (CIRCLE_COUNT - 1);
}

/**
 * The shortest viewport the rail fits in: the stack, the logo cell and its
 * trailing gap, the rail's own padding and hairlines, and the two insets.
 *
 * NO MINIMUM IS STATED ANYWHERE IN THE SPEC. This is the arithmetic floor of
 * the drawing as drawn, published so the number is at least written down; it is
 * not an owner ruling about what happens below it, and nothing here invents a
 * behaviour for that case.
 */
export function railMinViewportHeight(): number {
  return (
    railStackHeight() +
    LOGO_CELL_H +
    RAIL_GAP +
    RAIL_PAD_Y * 2 +
    SPEC_MOCK_BEZEL * 2 +
    LANDSCAPE_INSET * 2
  );
}

/**
 * The shortest viewport the NAVIGATION column fits in: both slots, the alert
 * band, the three gaps between them and the two insets. The taller of this and
 * {@link railMinViewportHeight} is the layout's real floor.
 */
export function columnMinViewportHeight(): number {
  return (
    LANDSCAPE_INSET +
    TOP_SLOT_H +
    LANDSCAPE_INSET +
    ALERT_BAND_H +
    LANDSCAPE_INSET +
    BOTTOM_SLOT_H +
    LANDSCAPE_INSET
  );
}
