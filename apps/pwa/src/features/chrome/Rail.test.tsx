/**
 * THE RAIL, AND THE DECLARATIONS THAT MAKE IT THE DRAWING.
 *
 * Same two halves as `Chips.test.tsx`, and the source half is here for the same
 * two reasons: vitest runs with `css: false` so a stylesheet import is the
 * empty string, and jsdom neither lays out nor cascades custom properties, so
 * `getComputedStyle(key).width` is '' in this environment.
 *
 * WHAT THIS FILE IS REALLY GUARDING is the sentence "one button type only". A
 * rail is the easiest place in an app for a second kind of button to appear --
 * a theme tile with a word on it, a slightly larger gear, one key that got a
 * label when the others did not -- and every one of those reads as a design
 * that drifted rather than as a bug. So the count, the order, the diameter and
 * the fact that all five share ONE rule are all assertions here.
 */

import { readFileSync } from 'node:fs';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  RAIL_CODE,
  RAIL_HELP,
  RAIL_KEYS,
  RAIL_MAIL,
  RAIL_SETTINGS,
  RAIL_THEME,
  Rail,
} from './Rail.tsx';

/* ------------------------------------------------------------------------ *
 * THE STYLESHEET, AND A CALCULATOR FOR WHAT IT DECLARES
 * ------------------------------------------------------------------------ */

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/** Comments blanked, so prose that quotes a banned value is not read as one. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '));
}

const CSS: string = blankComments(readFileSync(`${HERE}/chrome.css`, 'utf8'));
const TOKENS: string = blankComments(readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8'));

/** One rule's body, by selector. */
function block(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector} in chrome.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

/** One declaration's value, from a rule body. */
function decl(body: string, property: string): string {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, 'u').exec(body);
  expect(found, `no ${property} declaration`).not.toBeNull();
  return (found?.[1] ?? '').trim();
}

/** Every custom property declared anywhere in a stylesheet, last one winning. */
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

const VARS: ReadonlyMap<string, string> = new Map([
  ...declaredVars(TOKENS),
  ...declaredVars(CSS),
]);

/** `var(--x)` replaced by what --x is, repeatedly, until none are left. */
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
 * Narrow on purpose, and it THROWS on a form it does not fully understand --
 * a resolver that quietly reads zero out of an expression it cannot parse is a
 * test that passes on a broken stylesheet. Never `new Function`.
 */
function px(expression: string): number {
  const flat = substitute(expression)
    .replace(/calc/giu, '')
    .replace(/px/giu, '')
    .replace(/[()]/gu, ' ')
    .trim();
  const parsed = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(?:\s*([*/])\s*(-?(?:\d+(?:\.\d+)?|\.\d+)))?$/u
    .exec(flat);
  expect(parsed, `${expression} did not resolve to a simple length (got "${flat}")`)
    .not.toBeNull();
  const left = Number(parsed?.[1]);
  if (parsed?.[2] === undefined) return left;
  const right = Number(parsed[3]);
  return parsed[2] === '*' ? left * right : left / right;
}

/* ------------------------------------------------------------------------ *
 * WHAT IT DRAWS
 * ------------------------------------------------------------------------ */

describe('the rail', () => {
  /* THE ORDER IS THE CONTRACT. A driver reaches for the gear by position, in a
     mount, without looking. */
  it('stacks the five keys in the brief’s order, top to bottom', () => {
    render(<Rail />);
    expect(
      screen.getAllByRole('button').map((key) => key.getAttribute('aria-label')),
    ).toEqual([RAIL_THEME, RAIL_SETTINGS, RAIL_MAIL, RAIL_CODE, RAIL_HELP]);
  });

  it('draws the sun, the gear, the envelope, the brackets and the question mark', () => {
    render(<Rail />);
    expect(RAIL_KEYS.map((key) => key.icon)).toEqual([
      'sun',
      'gear',
      'mail',
      'code',
      'help',
    ]);
  });

  /* ONE BUTTON TYPE ONLY. The theme control is a plain round key like the rest
     -- no label, no bespoke tile -- so every key in the row carries the same
     class and no key carries visible text. */
  it('gives every key the same rule and none of them a word', () => {
    render(<Rail />);
    const keys = screen.getAllByRole('button');
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      expect(key.className).toBe('fwm-rail-key');
      expect(key.textContent).toBe('');
    }
  });

  /* THE SPEC DRAWS NO LABELS AT ALL, and five unnamed buttons in a column are
     five identical announcements. Every key is named. */
  it('names every key, because the drawing names none of them', () => {
    render(<Rail />);
    for (const label of [RAIL_THEME, RAIL_SETTINGS, RAIL_MAIL, RAIL_CODE, RAIL_HELP]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('reports the press and decides nothing itself', () => {
    const onSelect = vi.fn();
    render(<Rail onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: RAIL_SETTINGS }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('settings');
  });

  /* NO TEXT-CHARACTER GLYPHS, and in a rail with no words that is the whole
     rendered output: five 24-unit boxes and nothing else. */
  it('draws its marks as geometry rather than as characters', () => {
    const { container } = render(<Rail />);
    const marks = container.querySelectorAll('svg');
    expect(marks).toHaveLength(5);
    for (const mark of marks) {
      expect(mark).toHaveAttribute('viewBox', '0 0 24 24');
      expect(mark).toHaveAttribute('fill', 'none');
      expect(mark).toHaveAttribute('stroke', 'currentColor');
      expect(mark).toHaveAttribute('stroke-linecap', 'round');
      expect(mark).toHaveAttribute('stroke-linejoin', 'round');
      expect(mark).toHaveAttribute('aria-hidden', 'true');
    }
    expect(container.textContent).toBe('');
  });

  /* 18 px ON EVERY KEY, which is the brief's number and the spec's. */
  it('sizes every rail mark at 18 and strokes it inside the brief’s band', () => {
    const { container } = render(<Rail />);
    for (const mark of container.querySelectorAll('svg')) {
      expect(mark).toHaveAttribute('width', '18');
      expect(mark).toHaveAttribute('height', '18');
      const width = Number(mark.getAttribute('stroke-width'));
      expect(width).toBeGreaterThanOrEqual(1.6);
      expect(width).toBeLessThanOrEqual(1.75);
    }
  });

  /* THE SUN DOES NOT SWAP FOR A MOON. The spec renders the rail on both panels
     and draws the same mark in both, so there is one drawing and the key does
     not carry the current mode. */
  it('draws one theme mark and never a second one', () => {
    expect(RAIL_KEYS.filter((key) => key.icon === 'sun')).toHaveLength(1);
  });

  it('draws the moon on a light skin, because the key names where it goes', () => {
    /*
     * THE REGRESSION THIS PINS. `Rail.tsx` once argued the sun must NOT swap,
     * from a correct measurement of the spec page: it renders the rail twice,
     * on both panels, with the same sun in each. The measurement was right and
     * the conclusion was wrong - a page that shows both themes at once cannot
     * show a control that changes, so the sameness is a property of the PAGE.
     *
     * Nobody is ever in both themes. The glyph names where pressing it goes.
     */
    const dark = render(<Rail />);
    expect(dark.container.querySelector('[aria-label="Switch to light mode"]')).not.toBeNull();
    dark.unmount();

    const lit = render(<Rail light />);
    expect(lit.container.querySelector('[aria-label="Switch to dark mode"]')).not.toBeNull();
    expect(lit.container.querySelector('[aria-label="Switch to light mode"]')).toBeNull();
    /* And the union in `icons.tsx` has no moon in it, so a second theme mark
       cannot be added here without a drawing being added there first. */
    expect(RAIL_KEYS.map((railKey) => railKey.icon)).not.toContain('moon');
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT IT MEASURES
 * ------------------------------------------------------------------------ */

describe('the rail’s geometry, resolved through the tokens', () => {
  const rail = block('.fwm-rail');

  /* RIGHT-ALIGNED, and it matters: the keys are 40 wide in a column that may be
     wider than they are, and left-aligned keys drift off the edge the rail is
     pinned to. */
  it('stacks vertically, 10 apart, right-aligned', () => {
    expect(decl(rail, 'display')).toBe('grid');
    expect(decl(rail, 'justify-items')).toBe('end');
    expect(px(decl(rail, 'gap'))).toBe(10);
  });
});

describe('the rail key’s geometry, resolved through the tokens', () => {
  const key = block('.fwm-rail-key');

  it('is a 40px circle', () => {
    expect(px(decl(key, 'width'))).toBe(40);
    expect(px(decl(key, 'height'))).toBe(40);
    /* 999 on a 40px square is the circle `border-radius: 50%` would draw, and a
       percentage is a raw value the gate rejects. */
    expect(decl(key, 'border-radius')).toBe('var(--fwm-radius-full)');
    expect(px(VARS.get('--fwm-radius-full') ?? '')).toBeGreaterThan(40);
  });

  it('wears a 1px hairline over glass and no second edge', () => {
    const border = decl(key, 'border').split(/\s+/u);
    expect(px(border[0] ?? '')).toBe(1);
    expect(border[1]).toBe('solid');
    expect(border[2]).toBe('var(--dr-hairline)');
    expect(decl(key, 'background')).toBe('var(--dr-grain), var(--dr-surface-thin)');
    expect(decl(key, 'backdrop-filter')).toBe('var(--dr-blur)');
  });

  it('paints its mark at the same ink tier a resting chip’s mark uses', () => {
    expect(decl(key, 'color')).toBe('var(--dr-ink-3)');
    expect(decl(block('.fwm-chip .fwm-chrome-icon'), 'color')).toBe('var(--dr-ink-3)');
  });

  /* ONE RULE FOR ALL FIVE. If a second key type ever appears it will need a
     second selector, and this is where that shows up. */
  it('is the only kind of rail button the stylesheet knows', () => {
    expect(CSS.match(/\.fwm-rail-key\b/gu) ?? []).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT THE STYLESHEET MAY NOT CONTAIN
 * ------------------------------------------------------------------------ */

describe('the stylesheet’s own contract', () => {
  it('writes no raw colour', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|color-mix|oklch)\s*\(/iu);
  });

  it('writes no raw length', () => {
    expect(CSS).not.toMatch(/(?<![\w.#-])(?!0)(?:\d*\.)?\d+(?:px|rem|em)\b/u);
    expect(CSS).not.toMatch(/\d%/u);
  });

  /* TOUCH-FIRST. The spec draws a hover ground on every rail key; hover never
     fires on the target device and the gate rejects the selector outright. */
  it('states no hover', () => {
    expect(CSS).not.toMatch(/:hover/u);
  });

  it('lets no shadow do a hairline’s work', () => {
    expect(CSS).not.toMatch(/drop-shadow\s*\(/u);
    expect(CSS).not.toMatch(/box-shadow/u);
  });
});
