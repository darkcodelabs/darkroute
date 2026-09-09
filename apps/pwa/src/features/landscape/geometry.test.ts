/**
 * THE LANDSCAPE ARRANGEMENT'S ARITHMETIC.
 *
 * These are not tests of a drawing. They are tests that the six horizontal
 * numbers the spec publishes are mutually consistent, and the reason that is
 * worth a file is section D's one hard rule:
 *
 *   "484 px between the two columns stays clear at all times. That band is the
 *    road ahead and the vehicle puck -- it is not available for chrome, ever."
 *
 * The clear band is not declared in any stylesheet. It is what is left over, so
 * the only way it can be wrong is for one of the other five to change and take
 * it silently. That failure has no visual tell short of chrome sitting on the
 * road, which is the one thing this layout exists not to do.
 */

import { describe, expect, it } from 'vitest';

import {
  BOTTOM_SLOT_H,
  CIRCLE,
  CIRCLE_COUNT,
  CLEAR_BAND,
  COLUMN_LEFT,
  COLUMN_W,
  LANDSCAPE_FRAME_H,
  LANDSCAPE_FRAME_W,
  LANDSCAPE_INSET,
  RAIL_PAD_X,
  RAIL_W,
  SPEC_MOCK_BEZEL,
  TAB_H,
  TAB_W,
  TOP_SLOT_H,
  columnMinViewportHeight,
  landscapeMockGap,
  landscapeWidthCloses,
  landscapeWidthSpend,
  railMinViewportHeight,
  railStackHeight,
} from './geometry.ts';

describe('the horizontal budget', () => {
  it('spends the frame exactly, with the clear band as the remainder', () => {
    expect(landscapeWidthSpend()).toBe(LANDSCAPE_FRAME_W);
    expect(landscapeWidthCloses()).toBe(true);
  });

  it('puts the content column one inset past the rail', () => {
    expect(COLUMN_LEFT).toBe(LANDSCAPE_INSET + RAIL_W + LANDSCAPE_INSET);
  });

  /**
   * THE RULE, RESTATED AS SUBTRACTION. If a future change narrows the band, this
   * is the assertion that names section D rather than the assertion that says
   * some sum is not 940.
   */
  it('leaves 484 between the content column and the right rail', () => {
    const columnRight = COLUMN_LEFT + COLUMN_W;
    const railLeft = LANDSCAPE_FRAME_W - LANDSCAPE_INSET - CIRCLE;
    expect(railLeft - columnRight).toBe(CLEAR_BAND);
  });
});

/**
 * THE BEZEL, ASSERTED SO THE NEXT PERSON TO MEASURE THE FILE DOES NOT SPEND AN
 * HOUR ON IT.
 *
 * Measuring `DarkRoute Landscape Mode.html` in Chromium gives 482 for the clear
 * band and 416 for the full-height panel, against a document that publishes 484
 * and 418. Both readings are right: the spec's frames are device mocks with a
 * 1px border, so every inset resolves against a 938 x 432 content box. On a
 * real viewport there is no bezel and the published numbers are what the same
 * declarations produce.
 */
describe('the spec mock is two pixels smaller than production', () => {
  it('accounts for the whole discrepancy with one bezel at each end', () => {
    expect(landscapeMockGap()).toBe(2);
    expect(SPEC_MOCK_BEZEL).toBe(1);
  });

  it('reproduces the 482 a measurement of the file returns', () => {
    const mockFrame = LANDSCAPE_FRAME_W - landscapeMockGap();
    const columnRight = COLUMN_LEFT + COLUMN_W;
    const railLeft = mockFrame - LANDSCAPE_INSET - CIRCLE;
    expect(railLeft - columnRight).toBe(CLEAR_BAND - landscapeMockGap());
  });

  it('reproduces the 416 the full-height panel measures in the file', () => {
    const mockFrame = LANDSCAPE_FRAME_H - landscapeMockGap();
    expect(mockFrame - LANDSCAPE_INSET * 2).toBe(416);
    /* And 418 on a real viewport, which is what section C publishes. */
    expect(LANDSCAPE_FRAME_H - LANDSCAPE_INSET * 2).toBe(418);
  });
});

describe('the rail', () => {
  /**
   * SECTION D SAYS 52 x 52 AND THE DRAWING SAYS 42 x 52. The drawing wins and
   * the disagreement is a fact about the rail's own box, not a rounding: 52
   * minus two hairlines minus 4px of padding each side is 42, and it cannot be
   * anything else while the rail is 52 wide.
   */
  it('is 42 wide inside a 52 rail, which is the prose disagreement', () => {
    expect(TAB_W).toBe(RAIL_W - SPEC_MOCK_BEZEL * 2 - RAIL_PAD_X * 2);
    expect(TAB_W).toBe(42);
    expect(TAB_H).toBe(52);
  });

  it('needs 268 for its five targets and four gaps', () => {
    expect(railStackHeight()).toBe(TAB_H * CIRCLE_COUNT + 2 * (CIRCLE_COUNT - 1));
    expect(railStackHeight()).toBe(268);
  });

  /**
   * NO MINIMUM IS STATED ANYWHERE IN THE SPEC. These two only publish the
   * arithmetic floor of the drawing as drawn, so the number exists in writing;
   * neither is an owner ruling about what happens below it.
   */
  it('fits the frame it is drawn in, with room to spare', () => {
    expect(railMinViewportHeight()).toBeLessThan(LANDSCAPE_FRAME_H);
    expect(columnMinViewportHeight()).toBeLessThan(LANDSCAPE_FRAME_H);
  });

  it('is the taller of the two floors, so it is the one that binds', () => {
    expect(railMinViewportHeight()).toBeGreaterThan(columnMinViewportHeight());
  });
});

describe('the slots', () => {
  /**
   * BOTH SLOTS AND THE BAND FIT WITH THE FOUR INSETS, which is the arithmetic
   * behind "an alert inserts a third 56 px band under the top slot rather than
   * growing it". If it did not close, the band would have to overlap something.
   */
  it('leaves room for the alert band between them', () => {
    expect(columnMinViewportHeight()).toBe(
      LANDSCAPE_INSET * 4 + TOP_SLOT_H + 56 + BOTTOM_SLOT_H,
    );
    expect(columnMinViewportHeight()).toBeLessThanOrEqual(LANDSCAPE_FRAME_H);
  });
});
