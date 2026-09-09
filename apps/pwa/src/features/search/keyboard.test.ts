/**
 * THE KEYBOARD-UP GEOMETRY, held to the two numbers the spec DECLARES.
 *
 * These are not assertions about a layout somebody liked. They are assertions
 * about arithmetic that closes, and the reason to write them is that both of
 * the numbers involved were reported as contradictions by two different
 * readings of the same document -- once as "218 disagrees with the 200px
 * reserve", once as "418 disagrees with the measured 416". Neither is a
 * disagreement, and a test is the only form of that answer that stays true.
 */

import { describe, expect, it } from 'vitest';

import {
  SPEC_FRAME_H,
  SPEC_INSET,
  SPEC_KEYBOARD_H,
  SPEC_PANEL_FULL_H,
  SPEC_PANEL_H,
  landscapeKeyboardCloses,
  landscapeKeyboardSpend,
  landscapePanelHeight,
} from './keyboard.ts';

describe('the landscape frame closes with the keyboard up', () => {
  it('spends the whole 434 on an inset, the panel, the gap and the keyboard', () => {
    /* 8 + 218 + 8 + 200. The gap is the thing every reading of this frame has
       dropped, and dropping it is what produces the phantom 224. */
    expect(landscapeKeyboardSpend()).toBe(SPEC_FRAME_H);
    expect(landscapeKeyboardCloses()).toBe(true);
  });

  it('leaves the gap equal to the inset every other edge takes', () => {
    const gap = SPEC_FRAME_H - SPEC_INSET - SPEC_PANEL_H - SPEC_KEYBOARD_H;
    expect(gap).toBe(SPEC_INSET);
  });
});

describe('one rule produces both of the published panel heights', () => {
  /*
   * THIS IS THE WHOLE ARGUMENT OF `keyboard.ts` IN TWO ASSERTIONS. The document
   * publishes 418 and declares 218 as though they were separate constants. They
   * are one subtraction at two viewport heights, and if that is true then
   * neither number has to be written down anywhere.
   */
  it('gives A4 its 418 when nothing is covering the viewport', () => {
    expect(landscapePanelHeight(SPEC_FRAME_H)).toBe(SPEC_PANEL_FULL_H);
  });

  it('gives A5 its declared 218 under the keyboard the spec draws', () => {
    expect(landscapePanelHeight(SPEC_FRAME_H - SPEC_KEYBOARD_H)).toBe(SPEC_PANEL_H);
  });

  it('shortens further under a taller keyboard instead of hiding rows behind it', () => {
    /* The reason the height is measured rather than written down. A suggestion
       strip or a third-party keyboard is not 200, and a panel pinned to 218
       under a 260px one keeps its last rows underneath it. */
    const tall = landscapePanelHeight(SPEC_FRAME_H - 260);
    expect(tall).toBe(158);
    expect(tall).toBeLessThan(SPEC_PANEL_H);
  });

  it('never returns a negative height for a viewport shorter than its own insets', () => {
    expect(landscapePanelHeight(4)).toBe(0);
  });

  it('takes the inset as an argument rather than assuming the landscape one', () => {
    /* Portrait insets at 12. The rule is the same rule; only the number moves,
       which is what keeps this from being a second implementation. */
    expect(landscapePanelHeight(SPEC_FRAME_H, 12)).toBe(410);
  });
});
