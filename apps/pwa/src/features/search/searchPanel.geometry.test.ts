/**
 * THE PANEL'S GEOMETRY, RESOLVED THROUGH THE TOKENS.
 *
 * Every number in this file was read out of Chromium against
 * `DarkRoute Search Entry.html` and `DarkRoute Landscape Mode.html` at real
 * size, with `getBoundingClientRect()` and `getComputedStyle()`. This is the
 * cheap guard that they are still what the stylesheet resolves to.
 *
 * IT HAS TO READ THE FILE OFF DISK, twice over: vitest runs with `css: false`,
 * which stubs every stylesheet import -- `?raw` included -- to the empty
 * string, so an assertion against an import would pass on '' whatever the file
 * said; and jsdom does not lay out and does not cascade custom properties, so
 * `getComputedStyle(panel).height` is '' in this environment. `TopBar.test.tsx`
 * and `dockConformance.test.ts` read their stylesheets the same way for the
 * same two reasons.
 *
 * WHY THIS IS WORTH A FILE. Not one of these fails loudly. A row that is 48
 * rather than 52, a badge that kept its portrait radius in landscape, a type
 * size that drifted half a pixel -- none of them throws, none of them is
 * visible in a test that only renders, and all of them are the drawing being
 * quietly wrong.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ANCHOR_GAP,
  ANCHOR_LEFT_VAR,
  ANCHOR_RIGHT_VAR,
  ANCHOR_TOP_VAR,
  KEYBOARD_INSET_VAR,
} from './anchor.ts';

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/** Comments blanked, so prose that quotes a value is not read as one. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '));
}

const CSS = blankComments(readFileSync(`${HERE}/searchPanel.css`, 'utf8'));
const TOKENS = blankComments(readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8'));

/**
 * One rule's body, by selector.
 *
 * `skip` because two selectors in this file appear in a shared rule BEFORE
 * their own: `.fwm-search-sub` picks up `overflow`, `white-space` and
 * `text-overflow` alongside `.fwm-search-name` and then sets its own colour and
 * size. Taking the first match would read the shared rule and report that the
 * sub-line has no font size at all.
 */
function block(selector: string, skip = 0): string {
  let at = -1;
  for (let n = 0; n <= skip; n += 1) at = CSS.indexOf(`\n${selector} {`, at + 1);
  expect(at, `no rule ${String(skip)} for ${selector} in searchPanel.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

/** One declaration's value, from a rule body. */
function decl(body: string, property: string): string {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, 'u').exec(body);
  expect(found, `no ${property} declaration`).not.toBeNull();
  return (found?.[1] ?? '').trim();
}

/**
 * Every custom property declared anywhere, last one winning.
 *
 * Flat and last-wins, which is what the cascade does INSIDE ONE CUT: the panel's
 * own locals are read from its shared block, then the landscape block's re-cuts
 * are layered over them for the second half. It is not what the cascade does
 * across a whole token file, which is why `rootCut` below hands this only the
 * `:root` blocks -- see the note there.
 */
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
 * THE TOKEN FILE'S `:root` BLOCKS, AND ONLY THOSE.
 *
 * `declaredVars` is flat and last-wins, and for most of what this file reads
 * that IS the cascade: `--fwm-space-1`, `-2`, `-3` and `-12` are declared once
 * and re-cut by no skin and no surface. TWO OF THE TOKENS THE PORTRAIT ANCHOR
 * FALLS BACK ON ARE NOT LIKE THAT. `--fwm-space-4` is 16 at `:root` and 12 on
 * both watch surfaces; `--fwm-touch-min`, which `--fwm-search-h` is built out
 * of, is 44 at `:root`, 48 on the watches and 68 on the dash. Read flat, the
 * last block in the file wins and the panel's fallbacks come out as 12 and 120
 * -- the numbers a watch would get, on a phone that is not one.
 *
 * `:root` is the cut a phone reads, so `:root` is the cut this reads. Every
 * number below is therefore the unskinned one, which is what the spec drew.
 */
function rootCut(css: string): string {
  const bodies: string[] = [];
  const pattern = /(?:^|\n):root\s*\{/gu;
  let match = pattern.exec(css);
  while (match !== null) {
    const open = css.indexOf('{', match.index);
    bodies.push(css.slice(open + 1, css.indexOf('}', open)));
    match = pattern.exec(css);
  }
  expect(bodies.length, 'tokens.css declares no :root block').toBeGreaterThan(0);
  return bodies.join('\n');
}

const SCALE = declaredVars(rootCut(TOKENS));
const PORTRAIT = new Map([...SCALE, ...declaredVars(block('.fwm-search-panel'))]);
const LANDSCAPE = new Map([
  ...PORTRAIT,
  ...declaredVars(block(".fwm-search-panel[data-fwm-orient='landscape']")),
]);

/**
 * ONE `var()` REPLACED BY WHAT IT RESOLVES TO -- including its FALLBACK.
 *
 * Scanned rather than matched with a regex, because a fallback can itself
 * contain a `calc()` holding another `var()` and the close paren a pattern
 * finds first is then the wrong one.
 *
 * WHY THE FALLBACK ARM EXISTS. `--fwm-sp-kb-h` is written at RUNTIME by
 * `features/search/keyboard.ts`, from `window.visualViewport`, and is declared
 * in no stylesheet -- so a browser that cannot measure, and this test, both
 * resolve it to the fallback. That is the point rather than a workaround: the
 * fallback is the height the SPEC DRAWS, and holding it here is what keeps the
 * measurement an enhancement instead of a replacement for the drawing.
 */
function expandOnce(source: string, vars: ReadonlyMap<string, string>): string {
  const at = source.indexOf('var(');
  if (at === -1) return source;

  let depth = 0;
  let end = -1;
  let comma = -1;
  for (let i = at + 3; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    } else if (ch === ',' && depth === 1 && comma === -1) comma = i;
  }
  expect(end, `unbalanced var() in ${source}`).toBeGreaterThan(-1);

  const name = source.slice(at + 4, comma === -1 ? end : comma).trim();
  const fallback = comma === -1 ? null : source.slice(comma + 1, end).trim();
  const declared = vars.get(name);
  if (declared === undefined && fallback === null) {
    expect(declared, `${name} is declared nowhere -- it would resolve to nothing`).toBeDefined();
  }
  return source.slice(0, at) + (declared ?? fallback ?? '') + source.slice(end + 1);
}

/** `var(--x)` replaced by what --x is, repeatedly, until none are left. */
function substitute(expression: string, vars: ReadonlyMap<string, string>): string {
  let out = expression;
  for (let pass = 0; pass < 16 && out.includes('var('); pass += 1) {
    out = expandOnce(out, vars);
  }
  return out;
}

/**
 * A length in px, resolved through the tokens and the arithmetic.
 *
 * Arithmetic only -- digits, `+ - * /`, parentheses -- evaluated by a parser
 * and never by `new Function`: a test that pulls a string out of a stylesheet
 * should not be able to run it.
 */
function px(expression: string, vars: ReadonlyMap<string, string> = PORTRAIT): number {
  const flat = substitute(expression, vars).replace(/calc/giu, '').replace(/px/giu, '');
  const tokens = flat.match(/\d*\.\d+|\d+|[()+\-*/]/gu);
  expect(tokens, `${expression} is not arithmetic`).not.toBeNull();
  expect((tokens ?? []).join(''), `${expression} has a leftover unit or name`).toBe(
    flat.replace(/\s+/gu, ''),
  );

  const list = tokens ?? [];
  let cursor = 0;
  const peek = (): string | undefined => list[cursor];

  function unary(): number {
    const token = peek();
    if (token === '-') {
      cursor += 1;
      return -unary();
    }
    if (token === '(') {
      cursor += 1;
      const value = sum();
      cursor += 1; /* the ')' */
      return value;
    }
    cursor += 1;
    return Number(token);
  }

  function product(): number {
    let value = unary();
    for (;;) {
      const token = peek();
      if (token !== '*' && token !== '/') return value;
      cursor += 1;
      const right = unary();
      value = token === '*' ? value * right : value / right;
    }
  }

  function sum(): number {
    let value = product();
    for (;;) {
      const token = peek();
      if (token !== '+' && token !== '-') return value;
      cursor += 1;
      const right = product();
      value = token === '+' ? value + right : value - right;
    }
  }

  const answer = sum();
  expect(cursor, `${expression} did not parse to the end`).toBe(list.length);
  return answer;
}

/** A panel local, in either orientation. */
function local(name: string, vars: ReadonlyMap<string, string> = PORTRAIT): number {
  return px(`var(${name})`, vars);
}

/**
 * `env(safe-area-inset-*)` STANDING AT A GIVEN DEPTH.
 *
 * `env()` is not arithmetic and no stylesheet can say how deep a home indicator
 * is, so the test has to name the phone it is reading the edge on. Zero is the
 * one with nothing on that edge, which is what the landscape assertions below
 * assume when they delete the term instead.
 */
function withSafeArea(expression: string, inset: number): string {
  return expression.replace(/env\([^()]*\)/gu, `${String(inset)}px`);
}

/**
 * `max(a, b)` COLLAPSED TO ITS LONGER ARM.
 *
 * Also not arithmetic, and the portrait bottom edge is made of one on purpose:
 * the keyboard covers the safe area it is drawn over, so the edge has to clear
 * whichever is deeper rather than clear both. Resolving it rather than deleting
 * it is the whole of the bottom-edge test -- a sum reads the same as a `max()`
 * when both arms are zero, and only differs once something is measured.
 */
function collapseMax(expression: string): string {
  let out = expression;
  for (let pass = 0; pass < 8 && out.includes('max('); pass += 1) {
    const at = out.indexOf('max(');
    let depth = 0;
    let end = -1;
    const commas: number[] = [];
    for (let i = at + 3; i < out.length; i += 1) {
      const ch = out[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      } else if (ch === ',' && depth === 1) commas.push(i);
    }
    expect(end, `unbalanced max() in ${expression}`).toBeGreaterThan(-1);

    const starts = [at + 4, ...commas.map((comma) => comma + 1)];
    const ends = [...commas, end];
    const arms = starts.map((start, n) => out.slice(start, ends[n] ?? end));
    const longest = Math.max(...arms.map((arm) => px(arm)));
    out = `${out.slice(0, at)}${String(longest)}px${out.slice(end + 1)}`;
  }
  return out;
}

/**
 * ONE OF THE PANEL'S FOUR EDGES, IN PX.
 *
 * Substituted first, so a token that carries an `env()` of its own -- and
 * `--fwm-drive-top-inset` does -- has it flattened with the rest; then the
 * `max()`, which by then has arms that are lengths; then the arithmetic.
 */
function edge(
  expression: string,
  vars: ReadonlyMap<string, string> = PORTRAIT,
  safeArea = 0,
): number {
  return px(collapseMax(withSafeArea(substitute(expression, vars), safeArea)), vars);
}

/**
 * THE ROOT WITH `anchor.ts` HAVING MEASURED, so every edge can be read twice.
 *
 * The four properties are written on `document.documentElement` at runtime and
 * are declared in no stylesheet, so a map without them is the FIRST PAINT --
 * and the browser with no `ResizeObserver`, and the unit test that renders the
 * panel with no bar. Both readings are load-bearing: the fallback is what the
 * panel hangs off until the effect runs, the measurement is what it hangs off
 * for the rest of the session, and a regression in either is invisible.
 *
 * The left edge and the right INSET are deliberately unequal -- a bar with a
 * fold key on one side is not centred -- so a panel that read one published
 * number for both of its side edges cannot pass this.
 */
/**
 * A PHONE'S WORTH OF VIEWPORT, so `100dvh` in the portrait ceiling resolves.
 *
 * 844 is the frame every production reading in this file was taken on, which is
 * what lets the ceiling test assert 740 rather than a shape.
 */
const VIEWPORT_H = 844;

function ceilingPx(
  expression: string,
  vars: ReadonlyMap<string, string> = PORTRAIT,
  safeArea = 0,
): number {
  return edge(expression.replace('100dvh', `${String(VIEWPORT_H)}px`), vars, safeArea);
}

const MEASURED: ReadonlyMap<string, string> = new Map([
  ...PORTRAIT,
  [ANCHOR_TOP_VAR, '104px'],
  [ANCHOR_LEFT_VAR, '17px'],
  [ANCHOR_RIGHT_VAR, '19px'],
  [KEYBOARD_INSET_VAR, '300px'],
]);

/** Every rule's selector, whitespace flattened, in the order they are written. */
const HEADERS: readonly string[] = CSS.split('}').map((chunk) =>
  (chunk.split('{')[0] ?? '').replace(/\s+/gu, ' ').trim(),
);

describe('the cut both orientations are made from', () => {
  const panel = block('.fwm-search-panel');

  it('is radius 22 with 10 of padding, a 1px hairline and the panel shadow', () => {
    expect(px(decl(panel, 'border-radius'))).toBe(22);
    expect(px(decl(panel, 'padding'))).toBe(10);
    expect(decl(panel, 'border')).toContain('var(--fwm-rule-w)');
    /* THE LIFT IS A SHADOW AND NOT A LENGTH, so it is asserted as the token it
       names: the panel takes its OWN shadow -- `0 16px 44px rgba(0,0,0,0.55)`,
       which `--dr-lift` is not -- and the specular edge rides in the same
       declaration because `box-shadow` does not accumulate. */
    expect(decl(panel, 'box-shadow')).toBe('var(--fwm-sp-lift), var(--dr-specular)');
    expect(decl(panel, '--fwm-sp-lift')).toBe('var(--dr-panel-lift)');
  });

  it('holds the field at 46 on radius 14, padded 0 13 with a gap of 10', () => {
    /*
     * ONLY LANDSCAPE DRAWS THIS NOW -- the owner's 2026-09-08 correction took
     * the field off the portrait path, because the portrait top bar is already
     * the input. Its numbers stay in the shared cut and this test stays here
     * rather than moving into the landscape block, because section 3 is written
     * ONCE and reads nothing but the locals. Moving it would be the first step
     * towards a second set of field rules for the orientation that has one.
     */
    const field = block('.fwm-search-field');
    expect(local('--fwm-sp-field-h')).toBe(46);
    expect(px(decl(field, 'height'))).toBe(46);
    expect(px(decl(field, 'border-radius'))).toBe(14);
    /* NOT off the radius scale, which three skins re-cut. */
    expect(decl(field, 'border-radius')).toBe('var(--fwm-sp-field-radius)');
    expect(px(decl(field, 'padding').split(/\s+/u)[1] ?? '')).toBe(13);
    expect(px(decl(field, 'gap'))).toBe(10);
  });

  it('draws a 52 row with a 30 badge at radius 9', () => {
    const row = block('.fwm-search-row');
    const badge = block('.fwm-search-badge');
    expect(px(decl(row, 'height'))).toBe(52);
    expect(px(decl(row, 'border-radius'))).toBe(12);
    expect(px(decl(row, 'gap'))).toBe(11);
    expect(px(decl(row, 'padding').split(/\s+/u)[1] ?? '')).toBe(8);
    expect(px(decl(badge, 'width'))).toBe(30);
    expect(px(decl(badge, 'height'))).toBe(30);
    expect(px(decl(badge, 'border-radius'))).toBe(9);
  });

  it('sets the name at 15, the sub-line at 12.5 and the count at 13.5', () => {
    expect(px(decl(block('.fwm-search-name'), 'font-size'))).toBe(15);
    expect(px(decl(block('.fwm-search-sub', 1), 'font-size'))).toBe(12.5);
    expect(px(decl(block('.fwm-search-count'), 'font-size'))).toBe(13.5);
    expect(local('--fwm-sp-badge-text')).toBe(12);
    expect(local('--fwm-sp-field-text')).toBe(14);
  });

  it('rules the list off with 1px and 4 of air, over a 40px footer', () => {
    const divider = block('.fwm-search-divider');
    const footer = block('.fwm-search-footer');
    expect(px(decl(divider, 'height'))).toBe(1);
    expect(px(decl(divider, 'margin').split(/\s+/u)[0] ?? '')).toBe(4);
    expect(px(decl(footer, 'height'))).toBe(40);
    expect(px(decl(footer, 'gap'))).toBe(12);
  });
});

/*
 * PORTRAIT IS A DROPDOWN HUNG OFF THE BAR, and this block used to say it was a
 * 366 x 470 bottom sheet with a field of its own at the top. That was faithfully
 * copied from `navigation mode search entry behavior.dc.html`, which was written
 * assuming the panel owns the input -- and the portrait bar IS the input, so the
 * copy put a second text field 500px under the first with the map hidden between
 * them. Owner correction, 2026-09-08, superseding that page FOR PORTRAIT ONLY:
 *
 *   "The panel hangs from the bar. It is a dropdown, not a bottom sheet."
 *   "In portrait there is exactly ONE field, and it is the top search bar."
 *
 * What the two deleted tests asserted is gone rather than loosened: there is no
 * 470, so nothing closes on a 347px list, because the list is whatever is left
 * between a bar that can fold and a keyboard that can be any height. The four
 * edges are the drawing now, and they are what is asserted here.
 *
 * LANDSCAPE IS UNAFFECTED. The describe below is untouched.
 */
describe('portrait -- the dropdown hung off the bar', () => {
  const panel = block('.fwm-search-panel');
  const anchor = block(".fwm-search-panel[data-fwm-orient='portrait']");

  it('declares no width and no height, so its four edges decide both', () => {
    /*
     * THE WIDTH ARGUMENT, NOW MADE TWICE. The old block already refused to
     * declare a width, because the spec's 366 is its own 390px frame less a
     * bezel and two insets and writing either number is right on one phone.
     * `--fwm-sp-h: 470` was exactly that mistake in the other axis, and it
     * survived longer because a bottom sheet can afford a fixed height and a
     * dropdown between a foldable bar and a 260px keyboard cannot.
     */
    expect(anchor).not.toMatch(/(?:^|;)\s*width\s*:/u);
    expect(decl(anchor, 'height')).toBe('auto');
    /* And nothing is inherited from the shared cut either. */
    expect(panel).not.toMatch(/(?:^|;)\s*(?:width|height|max-height)\s*:/u);
  });

  it('is as tall as its rows, with the gap as a ceiling rather than a height', () => {
    /*
     * THE BRIEF SAID "it fills the gap" AND TAKING THAT LITERALLY WAS WRONG.
     * Anchoring `bottom` as well as `top` made the height BE the gap, so three
     * search results drew a 740px sheet with 600px of empty glass under them
     * and no map. Owner, on seeing it: "why is that search box taking up the
     * full screen?"
     *
     * The gap is a CEILING now. Nine recents still reach it and the list
     * scrolls inside it -- which is the case the sentence was written for --
     * and three results are three results tall.
     */
    expect(decl(anchor, 'bottom')).toBe('auto');
    const ceiling = decl(anchor, 'max-height');
    expect(ceiling).toContain('100dvh');
    /* 740 is the number production measured on a 390x844 phone with the bar at
       32 and nothing covering the bottom: 844 - (32 + 56 + 8) - 8. */
    expect(ceilingPx(ceiling)).toBe(VIEWPORT_H - (32 + 56 + ANCHOR_GAP) - ANCHOR_GAP);
  });

  it('hangs 8 under the bar, and under the tokens it is laid out from until it is measured', () => {
    const top = decl(anchor, 'top');
    /*
     * THE MEASUREMENT IS PREFERRED AND THE TOKENS ARE THE FALLBACK, in that
     * order, because the sum of the tokens is only nearly right: it carries
     * `env(safe-area-inset-top)`, which differs per device, and it cannot see
     * the bar fold. `anchor.ts` publishes the bar's laid-out bottom instead,
     * and the 8 is added HERE so the published number stays a measurement of
     * the bar rather than of the arrangement.
     */
    expect(top).toContain(`var(${ANCHOR_TOP_VAR}`);
    expect(edge(top, MEASURED)).toBe(104 + ANCHOR_GAP);
    /* Unmeasured: the bar's top band, 32, plus its own 56, plus the gap. */
    expect(edge(top)).toBe(96);
    expect(px('var(--fwm-space-2)')).toBe(ANCHOR_GAP);
  });

  it('lines its two side edges up with the bar, to the pixel rather than nearly', () => {
    /*
     * TWO PUBLISHED NUMBERS AND NOT ONE INSET. `right` is an inset from the
     * right of the viewport and `left` is an edge, which is what lets the panel
     * be positioned without a width -- and a bar with a fold key on one side is
     * not centred, so a single number for both sides would be wrong on the side
     * the key is on. `--fwm-space-4` is the bar's own side inset and stands in
     * until the rect arrives, so the first paint is never unanchored.
     */
    expect(decl(anchor, 'left')).toBe(`var(${ANCHOR_LEFT_VAR}, var(--fwm-space-4))`);
    expect(decl(anchor, 'right')).toBe(`var(${ANCHOR_RIGHT_VAR}, var(--fwm-space-4))`);
    expect(edge(decl(anchor, 'left'), MEASURED)).toBe(17);
    expect(edge(decl(anchor, 'right'), MEASURED)).toBe(19);
    expect(edge(decl(anchor, 'left'))).toBe(16);
    expect(edge(decl(anchor, 'right'))).toBe(16);
  });

  it('ends 8 above whatever covers the page, clearing the deeper of the two and not their sum', () => {
    /*
     * `max()` AND NOT `+`, AND THIS IS THE TEST THAT CAN TELL. The keyboard is
     * drawn OVER the home indicator it covers, so a sum clears a safe area that
     * is underneath a keyboard and takes 34px off the panel for nothing. Both
     * arms are zero until something is measured, which is why only the measured
     * reading catches it.
     *
     * The clearance moved from `bottom` to the ceiling when the panel stopped
     * filling the gap; it is the same arithmetic and the same trap.
     */
    const ceiling = decl(anchor, 'max-height');
    expect(ceiling).toContain('max(');
    /* Measured: bar bottom 104, a 300px keyboard over a 34px indicator.
       844 - (104 + 8) - (300 + 8) = 424. A sum would give 390. */
    expect(ceilingPx(ceiling, MEASURED, 34)).toBe(VIEWPORT_H - (104 + ANCHOR_GAP) - (300 + ANCHOR_GAP));
    /* An indicator and no keyboard: the safe area is the deeper arm and wins. */
    expect(ceilingPx(ceiling, PORTRAIT, 34)).toBe(
      VIEWPORT_H - (32 + 34 + 56 + ANCHOR_GAP) - (34 + ANCHOR_GAP),
    );
  });

  it('leaves the list the only thing that flexes, so the panel fills the gap and never grows', () => {
    /*
     * "The row list scrolls internally; the panel itself never grows or moves."
     * That is one rule and three: the list takes the leftover, the three things
     * around it are `flex: none` at a stated height, and the list is the only
     * scroll port in the stylesheet. A second `overflow-y` anywhere below would
     * give the panel a nested scroller and the last rows of the outer one would
     * be unreachable under the keyboard.
     */
    const list = block('.fwm-search-list');
    expect(decl(list, 'flex')).toBe('1 1 auto');
    expect(decl(list, 'overflow-y')).toMatch(/^(?:auto|scroll)$/u);
    expect(decl(list, 'min-height')).toBe('0');
    for (const sibling of ['.fwm-search-field', '.fwm-search-divider', '.fwm-search-footer']) {
      expect(decl(block(sibling), 'flex'), `${sibling} must not flex`).toBe('none');
    }
    expect(CSS.match(/overflow-y\s*:/gu) ?? []).toHaveLength(1);
    /* And the panel clips, so a row's press feedback cannot paint over a 22px
       corner on its way past. Landscape has clipped since it was written. */
    expect(decl(anchor, 'overflow')).toContain('hidden');
  });

  it('keeps no --fwm-sp-h: a dead length is a length somebody re-introduces', () => {
    /*
     * The 470 is gone from the declarations and DELIBERATELY still in the prose
     * -- section 1 explains what used to sit there and why it went, and `CSS`
     * has its comments blanked before this reads it, so the history costs
     * nothing and a re-declaration costs the test.
     */
    expect(CSS).not.toMatch(/--fwm-sp-h(?![a-z-])/u);
  });
});

describe('landscape -- 336 x 418 in the left column', () => {
  const panel = block(".fwm-search-panel[data-fwm-orient='landscape']");

  it('is 336 wide at left 68, which is 8 + the 52 rail + 8', () => {
    expect(px(decl(panel, 'width'), LANDSCAPE)).toBe(336);
    /* `env()` is not arithmetic, so the safe-area term is dropped before the
       sum -- which is the right reading anyway: on a phone with no notch on
       that edge it is zero and the panel sits at 68. */
    expect(px(decl(panel, 'left').replace(/\+\s*env\([^)]*\)/gu, ''), LANDSCAPE)).toBe(68);
    expect(local('--fwm-sp-inset', LANDSCAPE)).toBe(8);
  });

  it('DECLARES NO HEIGHT, so it is 418 on a 434pt phone and not 416', () => {
    /* The same off-by-the-bezel as the portrait width, in the same document. */
    expect(decl(panel, 'height')).toBe('auto');
  });

  it('compresses the row to 44 and the badge to 26 at radius 8', () => {
    expect(local('--fwm-sp-row-h', LANDSCAPE)).toBe(44);
    expect(local('--fwm-sp-badge', LANDSCAPE)).toBe(26);
    expect(local('--fwm-sp-badge-radius', LANDSCAPE)).toBe(8);
  });

  it('scales the type down with it -- 13.5, 11.5, 12.5 and an 11px badge glyph', () => {
    /* NOT ON THE BRIEF'S LIST OF SIX LEGAL DIFFERENCES, and drawn in both spec
       files. See `docs/gaps-inbox/search-panel.md`. */
    expect(local('--fwm-sp-name', LANDSCAPE)).toBe(13.5);
    expect(local('--fwm-sp-sub', LANDSCAPE)).toBe(11.5);
    expect(local('--fwm-sp-count', LANDSCAPE)).toBe(12.5);
    expect(local('--fwm-sp-badge-text', LANDSCAPE)).toBe(11);
  });

  it('keeps the field at 46 on radius 14, which is the one thing that does NOT scale', () => {
    expect(local('--fwm-sp-field-h', LANDSCAPE)).toBe(46);
    expect(local('--fwm-sp-field-text', LANDSCAPE)).toBe(14);
  });

  it('takes the shorter, softer shadow and clips, both of which the spec draws', () => {
    expect(decl(panel, '--fwm-sp-lift')).toBe('var(--dr-panel-lift-tight)');
    expect(decl(panel, 'overflow')).toContain('hidden');
  });

  it('reflows to 218 with the keyboard up, at left 8', () => {
    const up = block(".fwm-search-panel[data-fwm-orient='landscape'][data-fwm-keyboard='up']");
    /* 218 IS THE FALLBACK, AND THE MEASUREMENT IS PREFERRED TO IT.
       `features/search/keyboard.ts` publishes `--fwm-sp-kb-h` off the visible
       viewport while this state is up, because 200 is what ONE keyboard on ONE
       device reserves and a panel pinned to 218 under a taller one keeps its
       last rows underneath it. The drawn height stays as what a browser with no
       `visualViewport` gets, which is what this line holds. */
    expect(decl(up, 'height')).toContain('var(--fwm-sp-kb-h');
    expect(px(decl(up, 'height'), LANDSCAPE)).toBe(218);
    expect(px(decl(up, 'left').replace(/\+\s*env\([^)]*\)/gu, ''), LANDSCAPE)).toBe(8);
    expect(decl(up, 'bottom')).toContain('auto');
  });
});

describe('the clamp that only landscape reads', () => {
  /*
   * IT WAS DELETED BY ACCIDENT AND THE COMMENT SAID IT WAS DEAD.
   *
   * Section 1 used to carry a `max-height` off the frame, written for the
   * portrait bottom sheet. Section 2 declares none, so it applied to landscape
   * as well -- and removing it un-clamped that panel in one reachable state:
   * keyboard up on a phone with a home indicator, where the height comes from
   * `--fwm-sp-kb-h` (taken on FOCUS, not from a measured keyboard) rather than
   * from the two insets. 397 became 418 and the lower edge went under the
   * indicator.
   */
  it('keeps the landscape panel inside the frame it is inset into', () => {
    const landscape = block(".fwm-search-panel[data-fwm-orient='landscape']");
    expect(landscape).toMatch(/max-height:\s*calc\(/u);
    expect(landscape).toMatch(/safe-area-inset-top/u);
    expect(landscape).toMatch(/safe-area-inset-bottom/u);
  });

  it('does not carry the dead host hook over with it', () => {
    /* `--fwm-search-keyboard` was the old expression's last term and had zero
       references in `src`. The keyboard is measured now; see `keyboard.ts`. */
    expect(CSS).not.toMatch(/--fwm-search-keyboard/u);
  });
});

/*
 * THE FOUR THINGS THAT ARE NOT THE PANEL, THE FIELD OR A ROW.
 *
 * Every number below was read out of the two files the same way as the block
 * above, and every one of them had drifted: the header was set at a row's
 * padding and at 13px, the two-line stack was gapped with `--fwm-mark-w` under
 * a comment saying 1 when that token is 3, the camera row's verb was 13 at the
 * pill tracking, and the first-run key was borrowing the field's accent pair.
 * None of them threw and none of them showed up in a render test, which is
 * this file's whole reason for existing.
 */
describe('the parts of the panel that are not a row', () => {
  it('gaps a name off its sub-line by one pixel and not by a mark', () => {
    /* `--fwm-mark-w` is `--fwm-space-1 * 3 / 4`, which is 3. Both stacks --
       the name over its sub-line, and a camera's distance over its verb --
       are drawn at 1 in every frame in both files. */
    expect(px(decl(block('.fwm-search-text'), 'gap'))).toBe(1);
    expect(px(decl(block('.fwm-search-meta'), 'gap'))).toBe(1);
    expect(CSS).not.toMatch(/--fwm-mark-w/u);
  });

  it('sets the group header at 30 on a header padding of 6 and a gap of 9', () => {
    /* NOT the row's 8 and 11. D pulls the caption out past the badges under
       it, which is what makes the two read as different kinds of line. */
    const head = block('.fwm-search-head');
    expect(px(decl(head, 'height'))).toBe(30);
    expect(px(decl(head, 'padding').split(/\s+/u)[1] ?? '')).toBe(6);
    expect(px(decl(head, 'gap'))).toBe(9);
  });

  it('captions the group at 10.5, tracked wide for the label and tight for the verb', () => {
    /* The shared rule carries the size and the weight; each selector's own
       rule carries its colour and its tracking. `block(selector, 1)` is the
       second one, the way `.fwm-search-sub` is read above. */
    const shared = block('.fwm-search-head-verb');
    expect(px(decl(shared, 'font-size'))).toBe(10.5);
    expect(decl(shared, 'font-weight')).toBe('700');
    expect(decl(block('.fwm-search-head-label'), 'letter-spacing')).toBe(
      'var(--fwm-card-track-caps)',
    );
    expect(decl(block('.fwm-search-head-verb', 1), 'letter-spacing')).toBe(
      'var(--fwm-card-track-verb)',
    );
    /* Tracking is an em and `px()` is arithmetic, so the two are read as the
       token file declares them. 0.14 over 0.1 is what section D draws. */
    expect(SCALE.get('--fwm-card-track-caps')).toBe('0.14em');
    expect(SCALE.get('--fwm-card-track-verb')).toBe('0.1em');
  });

  it("rules the header off in the group's 7% and not the divider's 8%", () => {
    expect(decl(block('.fwm-search-head-rule'), 'background')).toBe('var(--dr-group-line)');
    expect(decl(block('.fwm-search-divider'), 'background')).toBe('var(--dr-divider)');
  });

  it('draws a camera row a bold distance over a 10px verb', () => {
    const far = block('.fwm-search-far');
    const verb = block('.fwm-search-verb');
    expect(decl(far, 'font-weight')).toBe('700');
    expect(px(decl(verb, 'font-size'))).toBe(10);
    expect(decl(verb, 'letter-spacing')).toBe('var(--fwm-card-track-verb)');
  });

  it('sets the word that replaces the mic at 11.5, under the footer sentence', () => {
    /* Section B draws the field's key a step SMALLER than the footer's 12.5:
       a key inside the field is not the sentence under the list. */
    expect(px(decl(block('.fwm-search-undo'), 'font-size'))).toBe(11.5);
    expect(px(decl(block('.fwm-search-note'), 'font-size'))).toBe(12.5);
  });

  it('spaces first run 5 apart with a 3 step above the one accent key', () => {
    /* Section C: a 5px grid with a 3px step over Set home, so the key sits 8
       clear of the card and the two keys sit 5 apart. */
    expect(px(decl(block('.fwm-search-first'), 'gap'))).toBe(5);
    expect(px(decl(block(".fwm-search-set[data-fwm-kind='home']"), 'margin-top'))).toBe(3);
  });

  it('draws Set home a step quieter than a focused field, and Set work at 500', () => {
    /* 0.35 over 0.10, which is NOT the field's 0.42 over 0.13. The one accent
       thing on an empty surface is drawn down from a focus edge, not up. */
    const home = block(".fwm-search-set[data-fwm-kind='home']");
    expect(decl(home, 'border-color')).toBe('var(--dr-first-key-line)');
    expect(decl(home, 'background')).toBe('var(--dr-first-key-fill)');
    expect(decl(home, 'font-weight')).toBe('700');
    /* The weight is on the KEY. On the label it would win over the home rule
       by specificity and flatten both keys to one weight. */
    expect(decl(block('.fwm-search-set'), 'font-weight')).toBe('500');
    expect(block('.fwm-search-set-label')).not.toMatch(/font-weight/u);
  });

  it('strokes the work pin a step under its own label, which is the one row that differs', () => {
    /* Section C draws the two 17px pins separately from the runs beside them:
         home  <svg stroke="#2fd4d4">   <span color: #2fd4d4>
         work  <svg stroke="#c3cbd3">   <span color: #e8ecf0>
       Home's agree, so the key's `color` carries both. Work's do not, and the
       pin paints in `currentColor`. `--dr-ink-3` is #c3cbd3 and the key's own
       `--dr-ink-2` is #e8ecf0 -- the file's own pair. */
    expect(decl(block(".fwm-search-set[data-fwm-kind='work'] .fwm-chrome-icon"), 'color')).toBe(
      'var(--dr-ink-3)',
    );
    expect(decl(block('.fwm-search-set'), 'color')).toBe('var(--dr-ink-2)');
    expect(decl(block(".fwm-search-set[data-fwm-kind='home']"), 'color')).toBe('var(--dr-accent)');
    expect(SCALE.get('--dr-ink-3')).toBe('#c3cbd3');
    expect(SCALE.get('--dr-ink-2')).toBe('#e8ecf0');
    expect(SCALE.get('--dr-accent')).toBe('#2fd4d4');
  });

  it('never repaints a drawn ink because nothing wired the press', () => {
    /* TWO RULES THAT SHIPPED THE WHOLE FIRST-RUN PANEL IN #8d97a1.

       `.fwm-search-set:disabled` set `--dr-ink-muted` and, at the same (0,2,0)
       as `[data-fwm-kind='home']` but later in the file, won -- and BOTH keys
       are `disabled` in every install, because `SearchPanel.tsx` disables them
       when no host passes `onSetSaved` and nothing in this app passes it.
       `.fwm-search-pin-note` did the same to the footer key, whose `<span>`
       branch is likewise the only one this app ever renders.

       Section B and section C each draw ONE appearance for these three runs and
       no second, greyed one. The appearance follows the drawing; `disabled` and
       the missing `onClick` are what say the press is not wired. */
    expect(block('.fwm-search-set:disabled')).not.toMatch(/(^|;)\s*color\s*:/u);
    expect(decl(block('.fwm-search-set:disabled'), 'cursor')).toBe('default');
    /* The class is NAMED ONCE in the whole file -- in the shared selector
       above. A second, solo rule for it is what used to grey the run out. */
    expect(CSS.match(/\.fwm-search-pin-note/gu)).toHaveLength(1);
    /* Both branches of the footer key take the accent, at 12.5 / 700. */
    const foot = block('.fwm-search-pin,\n.fwm-search-pin-note');
    expect(decl(foot, 'color')).toBe('var(--dr-accent)');
    expect(decl(foot, 'font-weight')).toBe('700');
    expect(px(decl(foot, 'font-size'))).toBe(12.5);
  });
});

describe('the contract the stylesheet keeps', () => {
  it('writes no raw colour', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(CSS).not.toMatch(/\brgba?\s*\(/iu);
  });

  it('writes no raw length', () => {
    const lengths = CSS.match(/(?<![\w.#])-?(?:\d+(?:\.\d+)?|\.\d+)(px|rem|em)(?![\w-])/gu) ?? [];
    expect(lengths.filter((value) => !value.startsWith('0'))).toEqual([]);
  });

  it('states no hover -- this is a touch product', () => {
    expect(CSS).not.toMatch(/:hover/u);
  });

  it('anchors on the orientation twice, re-cuts on it once, and reads it nowhere below', () => {
    /*
     * IT USED TO BE ONE PLACE AND IT IS HONESTLY TWO. The owner's correction
     * gave the two orientations anchors with nothing in common -- portrait
     * hangs off a bar that landscape does not have -- so there is a portrait
     * block and a landscape block and there is no honest way to write them as
     * one. What the old "ONE place" name was really guarding is the line below
     * it: the branch ENDS at the top of the file. Everything after it -- the
     * field, the rows, the badges, the divider, the footer -- is written once
     * and re-cut through the locals, so the two surfaces still cannot drift
     * apart in a rule somebody forgot to write twice.
     *
     * The third and fourth selectors are the landscape KEYBOARD state, not a
     * third orientation: they qualify the landscape anchor rather than adding a
     * branch, and they are listed rather than counted so that a fifth reader
     * has to be added here on purpose.
     */
    const reading = HEADERS.filter((header) => header.includes('data-fwm-orient'));
    expect(reading).toEqual([
      ".fwm-search-panel[data-fwm-orient='portrait']",
      ".fwm-search-panel[data-fwm-orient='landscape']",
      ".fwm-search-panel[data-fwm-orient='landscape'][data-fwm-keyboard='up']",
      ".fwm-search-panel[data-fwm-orient='landscape'][data-fwm-keyboard='up'] " +
        ".fwm-search-divider, .fwm-search-panel[data-fwm-orient='landscape']" +
        "[data-fwm-keyboard='up'] .fwm-search-footer",
    ]);
    /* Exactly one of them is the portrait anchor, and exactly one is the
       landscape one: the other two carry a keyboard state as well. */
    expect(reading.filter((header) => header.includes('data-fwm-keyboard') === false)).toEqual([
      ".fwm-search-panel[data-fwm-orient='portrait']",
      ".fwm-search-panel[data-fwm-orient='landscape']",
    ]);
    /* AND THE BRANCH IS ABOVE THE COMPONENT. Nothing from the field down. */
    expect(CSS.lastIndexOf('data-fwm-orient')).toBeLessThan(CSS.indexOf('\n.fwm-search-field {'));
  });
});
