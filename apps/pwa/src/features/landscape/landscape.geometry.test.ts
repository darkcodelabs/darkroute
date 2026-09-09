/**
 * THE LANDSCAPE STYLESHEET, RESOLVED THROUGH THE TOKENS.
 *
 * Every number asserted here was read out of Chromium against
 * `DarkRoute Landscape Mode.html` at real size with `getBoundingClientRect()`
 * and `getComputedStyle()`. This is the cheap guard that `landscape.css` still
 * resolves to them.
 *
 * IT READS THE FILES OFF DISK, and `searchPanel.geometry.test.ts` gives the two
 * reasons: vitest runs with `css: false`, so an assertion against an imported
 * stylesheet would pass on the empty string whatever the file said; and jsdom
 * neither lays out nor cascades custom properties, so `getComputedStyle` here
 * returns nothing to assert.
 *
 * WHY THIS IS WORTH A FILE. None of these fails loudly. A slot that grew to 88,
 * a column that started at 64, a rail that lost two pixels of padding -- none
 * throws, none is visible in a test that only renders, and every one of them is
 * the drawing being quietly wrong. The one that matters most is the last block:
 * the clear centre band is a REMAINDER, so it can be taken by any of the five
 * other numbers with no tell at all short of chrome sitting on the road.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ALERT_BAND_H,
  BOTTOM_FOOTER_H,
  BOTTOM_HEADER_H,
  BOTTOM_SLOT_H,
  CIRCLE,
  CIRCLE_GAP,
  CLEAR_BAND,
  COLUMN_LEFT,
  COLUMN_W,
  LANDSCAPE_FRAME_W,
  LANDSCAPE_INSET,
  RAIL_GAP,
  RAIL_PAD_X,
  RAIL_PAD_Y,
  RAIL_W,
  ROW_H,
  SCRIM_W,
  TOP_SLOT_H,
} from './geometry.ts';

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/** Comments blanked, so prose that quotes a value is never read as one. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '));
}

const CSS = blankComments(readFileSync(`${HERE}/landscape.css`, 'utf8'));
const TOKENS = blankComments(readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8'));

/**
 * One rule's body, by selector.
 *
 * `skip` because `.fwm-ls-right` appears as the LAST member of the shared
 * pointer-events rule before it appears on its own -- taking the first match
 * there would read `pointer-events: auto` and report that the right rail has no
 * geometry at all. `searchPanel.geometry.test.ts` carries the same parameter
 * for the same reason.
 */
function body(selector: string, skip = 0): string {
  let at = -1;
  for (let n = 0; n <= skip; n += 1) at = CSS.indexOf(`\n${selector} {`, at + 1);
  expect(at, `no rule ${String(skip)} for ${selector} in landscape.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

function decl(rule: string, property: string): string {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, 'u').exec(rule);
  expect(found, `no ${property} declaration`).not.toBeNull();
  return (found?.[1] ?? '').trim();
}

/** Every custom property declared anywhere, last one winning. */
function declaredVars(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/giu;
  let match = pattern.exec(css);
  while (match !== null) {
    out.set(match[1] ?? '', (match[2] ?? '').trim());
    match = pattern.exec(css);
  }
  return out;
}

/**
 * The scale, then the layer's own locals over it.
 *
 * FLAT AND LAST-WINS, which is what the cascade actually does with the tokens
 * this file reads: `--fwm-space-1` is declared once at `:root` and re-cut by no
 * skin, which is the whole reason the geometry can be resolved here at all.
 */
const VARS = new Map([...declaredVars(TOKENS), ...declaredVars(body('.fwm-ls'))]);

/** `var(--x)` replaced by what `--x` is, until none are left. */
function substitute(expression: string): string {
  let out = expression;
  for (let pass = 0; pass < 8 && out.includes('var('); pass += 1) {
    out = out.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/giu, (whole, name: string) => {
      const value = VARS.get(name);
      expect(value, `${name} is declared nowhere -- it would resolve to nothing`).toBeDefined();
      return value ?? whole;
    });
  }
  return out;
}

/**
 * A length in px, resolved through the tokens and the arithmetic.
 *
 * Arithmetic only -- digits, `* /` and `+ -` -- evaluated left to right with
 * multiplication binding tighter, and never by `new Function`: a test that
 * pulls a string out of a stylesheet must not be able to run it.
 */
function px(expression: string): number {
  const flat = substitute(expression).replace(/calc/giu, '').replace(/px/giu, '');
  const tokens = flat.match(/\d*\.\d+|\d+|[()+\-*/]/gu) ?? [];
  expect(tokens.join(''), `${expression} has a leftover unit or name`).toBe(
    flat.replace(/\s+/gu, ''),
  );

  let cursor = 0;
  const peek = (): string | undefined => tokens[cursor];
  const unary = (): number => {
    if (peek() === '(') {
      cursor += 1;
      const inner = sum();
      cursor += 1;
      return inner;
    }
    if (peek() === '-') {
      cursor += 1;
      return -unary();
    }
    cursor += 1;
    return Number(tokens[cursor - 1]);
  };
  const product = (): number => {
    let value = unary();
    while (peek() === '*' || peek() === '/') {
      const op = peek();
      cursor += 1;
      const right = unary();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  };
  function sum(): number {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const op = peek();
      cursor += 1;
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  const answer = sum();
  expect(cursor, `${expression} did not parse to the end`).toBe(tokens.length);
  return answer;
}

const local = (name: string): number => px(`var(${name})`);

/* ------------------------------------------------------------------------ *
 * THE ARRANGEMENT
 * ------------------------------------------------------------------------ */

describe('the left rail -- 52 wide, full height, inset 8', () => {
  const rail = body('.fwm-ls-rail');

  it('is 52 wide at the spec’s own inset on three edges', () => {
    expect(px(decl(rail, 'width'))).toBe(RAIL_W);
    expect(px(decl(rail, 'top'))).toBe(LANDSCAPE_INSET);
    expect(px(decl(rail, 'bottom'))).toBe(LANDSCAPE_INSET);
    expect(px(decl(rail, 'left'))).toBe(LANDSCAPE_INSET);
  });

  it('pads 6 and 4 and gaps 2, which is what leaves a 42px target', () => {
    expect(local('--fwm-ls-rail-pad-y')).toBe(RAIL_PAD_Y);
    expect(local('--fwm-ls-rail-pad-x')).toBe(RAIL_PAD_X);
    expect(local('--fwm-ls-rail-gap')).toBe(RAIL_GAP);
    expect(px(decl(rail, 'gap'))).toBe(RAIL_GAP);
  });
});

describe('the content column -- 336 at left 68', () => {
  const slot = body('.fwm-ls-slot');
  const top = body(".fwm-ls-slot[data-fwm-slot='top']");
  const bottom = body(".fwm-ls-slot[data-fwm-slot='bottom']");
  const band = body('.fwm-ls-band');
  const panel = body('.fwm-ls-panel');

  it('starts one inset past the rail and is 336 wide', () => {
    expect(px(decl(slot, 'left'))).toBe(COLUMN_LEFT);
    expect(px(decl(slot, 'width'))).toBe(COLUMN_W);
    expect(COLUMN_LEFT).toBe(LANDSCAPE_INSET + RAIL_W + LANDSCAPE_INSET);
  });

  /** Section C: "top slot 84 . bottom slot 96 . both locked". */
  it('locks both slot heights', () => {
    expect(px(decl(top, 'height'))).toBe(TOP_SLOT_H);
    expect(px(decl(bottom, 'height'))).toBe(BOTTOM_SLOT_H);
  });

  /**
   * "an alert inserts a third 56 px band UNDER the top slot rather than growing
   * it" -- so the band's top has to be the inset plus the whole top slot plus
   * one more inset, and the top slot's height has to be untouched by it.
   */
  it('inserts the band clear of the top slot rather than growing it', () => {
    expect(px(decl(band, 'height'))).toBe(ALERT_BAND_H);
    expect(px(decl(band, 'top'))).toBe(LANDSCAPE_INSET + TOP_SLOT_H + LANDSCAPE_INSET);
    expect(px(decl(band, 'left'))).toBe(COLUMN_LEFT);
    expect(px(decl(band, 'width'))).toBe(COLUMN_W);
  });

  /** The bottom slot's interior: 58 + hairline + 36 inside 96. */
  it('splits the bottom slot into a header, a hairline and a footer', () => {
    expect(px(decl(body('.fwm-ls-head'), 'height'))).toBe(BOTTOM_HEADER_H);
    expect(px(decl(body('.fwm-ls-foot'), 'height'))).toBe(BOTTOM_FOOTER_H);
    expect(BOTTOM_HEADER_H + 1 + BOTTOM_FOOTER_H).toBe(BOTTOM_SLOT_H - 1);
  });

  /** A3 takes the column's full height at the same left and the same width. */
  it('gives the expanded panel the same column, top to bottom', () => {
    expect(px(decl(panel, 'left'))).toBe(COLUMN_LEFT);
    expect(px(decl(panel, 'width'))).toBe(COLUMN_W);
    expect(px(decl(panel, 'top'))).toBe(LANDSCAPE_INSET);
    expect(px(decl(panel, 'bottom'))).toBe(LANDSCAPE_INSET);
  });

  it('draws a 44px list row', () => {
    expect(px(decl(body('.fwm-ls-row'), 'height'))).toBe(ROW_H);
  });
});

describe('the right rail -- 44px circles, 7px gaps, centred', () => {
  const rail = body('.fwm-ls-right', 1);
  const circle = body('.fwm-ls-circle');

  it('is inset 8 from the right and centred on the frame', () => {
    expect(px(decl(rail, 'right'))).toBe(LANDSCAPE_INSET);
    expect(decl(rail, 'top')).toBe('50%');
    expect(decl(rail, 'transform')).toBe('translateY(-50%)');
  });

  it('draws 44px circles seven apart', () => {
    expect(px(decl(rail, 'gap'))).toBe(CIRCLE_GAP);
    expect(px(decl(circle, 'width'))).toBe(CIRCLE);
    expect(px(decl(circle, 'height'))).toBe(CIRCLE);
  });

  /**
   * MEASURED, and it is the one surface in this layout with no lift: the five
   * circles carry the glass and the hairline and nothing else. Over the clear
   * band a dropped shadow would be five smudges on the road.
   */
  it('carries no box-shadow', () => {
    expect(/box-shadow/u.test(circle)).toBe(false);
  });
});

describe('the map underneath is still a map', () => {
  /*
   * THE CLEAR CENTRE BAND IS THE PRODUCT. 484px of live map is where the pan,
   * the pinch and the vehicle puck live, and the chrome over it is a layer that
   * has to be transparent to the pointer everywhere it is not drawing a
   * control.
   *
   * IT SHIPPED OPAQUE TO THE POINTER, and nothing here caught it because the
   * declaration was right: `.fwm-ls { pointer-events: none }` is in the file,
   * three lines under a section header explaining why. It lost a specificity
   * argument at runtime to `global.css`'s `:root .fwm-shell-dock > *`, which
   * gives every direct child of the dock wrapper its presses back so the dock
   * can be pressed -- and `LandscapeChrome` is one of those children. The whole
   * map was dead in landscape.
   *
   * So the assertion is not "the property is declared" any more. It is "the
   * declaration that WINS is declared", which is a different string.
   */
  it('takes no press on the layer itself, at a specificity that survives the dock wrapper', () => {
    expect(CSS).toMatch(/:root\s+\.fwm-shell-dock\s*>\s*\.fwm-ls\s*\{[^}]*pointer-events:\s*none/u);
  });

  it('hands presses back to the surfaces that draw controls, and to nothing else', () => {
    /* Four surfaces, named. A fifth would be a fifth thing over the map that
       eats a gesture, and it should have to be added here to happen. */
    const back = /\.fwm-ls-rail,\s*\.fwm-ls-slot,\s*\.fwm-ls-panel,\s*\.fwm-ls-right\s*\{[^}]*pointer-events:\s*auto/u;
    expect(CSS).toMatch(back);
  });

  it('takes the portrait round-key rail off this surface, so the right edge has one column', () => {
    /* Section D draws its own right rail. With `.fwm-drive-rail` still painting
       behind it the edge carried ten keys in two overlapping columns, settings
       and the theme key each appearing twice. */
    const DRIVE = blankComments(readFileSync(`${HERE}/../drive/drive.css`, 'utf8'));
    expect(DRIVE).toMatch(
      /\[data-fwm-surface='dash'\]\s*\.fwm-drive-rail\s*\{[^}]*display:\s*none/u,
    );
  });
});

describe('the side scrim, and not a bottom one', () => {
  const scrim = body('.fwm-ls-scrim');

  it('runs down the left 470 and takes no press', () => {
    expect(px(decl(scrim, 'width'))).toBe(SCRIM_W);
    expect(px(decl(scrim, 'left'))).toBe(0);
    expect(decl(scrim, 'pointer-events').split('/')[0]?.trim()).toBe('none');
  });
});

/* ------------------------------------------------------------------------ *
 * THE RULE THE STYLESHEET NEVER DECLARES
 * ------------------------------------------------------------------------ */

describe('nothing crosses the centre', () => {
  /**
   * "484 px between the two columns stays clear at all times. That band is the
   *  road ahead and the vehicle puck -- it is not available for chrome, ever."
   *                                                            -- section D
   *
   * The band is a REMAINDER and is declared nowhere, which is exactly why it
   * needs a test: any of the five numbers around it can take a slice with no
   * visible tell short of chrome sitting on the road. This resolves the four
   * that the stylesheet owns and subtracts.
   */
  it('leaves 484 clear at the size the drawing is drawn at', () => {
    const columnRight = px(decl(body('.fwm-ls-slot'), 'left')) + px(decl(body('.fwm-ls-slot'), 'width'));
    const railLeft =
      LANDSCAPE_FRAME_W -
      px(decl(body('.fwm-ls-right', 1), 'right')) -
      px(decl(body('.fwm-ls-circle'), 'width'));
    expect(railLeft - columnRight).toBe(CLEAR_BAND);
  });

  /** And the chrome layer itself is transparent to the pointer, so the band is
   *  live map rather than a hole in a full-bleed overlay. */
  it('makes the chrome layer transparent to the pointer', () => {
    expect(decl(body('.fwm-ls'), 'pointer-events').split('/')[0]?.trim()).toBe('none');
  });
});
