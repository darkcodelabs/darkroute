/**
 * THE CHIP ROW, AND THE DECLARATIONS THAT MAKE IT THE DRAWING.
 *
 * Two halves, checking different kinds of thing.
 *
 * THE RENDERED HALF asks what the row draws and what it reports. jsdom has a
 * DOM, so that much is real.
 *
 * THE SOURCE HALF reads `chrome.css` off disk and resolves what it declares. It
 * has to, twice over: vitest runs with `css: false`, which stubs every
 * stylesheet import -- `?raw` included -- to the empty string, so an assertion
 * against an import would pass on '' whatever the file said; and jsdom does not
 * lay out and does not cascade custom properties, so `getComputedStyle(chip)
 * .height` is '' here. `TopBar.test.tsx` reads its stylesheet the same way for
 * the same two reasons, and `dockConformance.test.ts` before it.
 *
 * EVERY ONE OF THESE FAILS SILENTLY IF IT BREAKS. A chip that is 34 tall, a
 * radius that stops being half the height so the pill grows shoulders, a label
 * that lost `nowrap` and bursts a fixed-height button, an active chip that
 * became a solid fill -- not one of them throws, and not one is visible in a
 * test that only renders. The browser measurement that proves the layout is in
 * the report this file was written beside; this is the guard that fails in CI
 * when somebody tidies a declaration away.
 */

import { readFileSync } from 'node:fs';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CHIPS, Chips } from './Chips.tsx';

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

/**
 * Every custom property declared anywhere in a stylesheet, last one winning.
 *
 * Flat and last-wins because that is what the cascade does with the tokens this
 * file reads: `--fwm-space-1`, `--fwm-space-2`, `--fwm-rule-w` and
 * `--fwm-text-label` are declared once at `:root` and re-cut by no skin, which
 * is exactly why the geometry can be resolved here at all.
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
 * Deliberately narrow: this file writes `var(--x)` and `calc(var(--x) * n)` and
 * nothing else, so the evaluator handles a number and one multiply or divide,
 * and THROWS on anything it does not fully understand. A resolver that quietly
 * reads zero out of a form it cannot parse is a test that passes on a broken
 * stylesheet. Never `new Function`: a string pulled out of a stylesheet should
 * not be runnable.
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

describe('the chip row', () => {
  it('draws the spec’s three chips, in the spec’s order, with the spec’s words', () => {
    render(<Chips active="layers" />);
    expect(screen.getAllByRole('button').map((chip) => chip.textContent)).toEqual([
      'Abuse',
      'Layers',
      'Map view',
    ]);
  });

  /* THE SET IS THE SPEC'S AND NOT THE APP'S. The brief says so in as many
     words, and a fourth chip arriving from somewhere else is exactly the drift
     it is guarding against. */
  it('carries three chips and no fourth', () => {
    expect(CHIPS).toHaveLength(3);
    expect(CHIPS.map((chip) => chip.id)).toEqual(['abuse', 'layers', 'map-view']);
  });

  /* ONE ACTIVE CHIP. The spec draws exactly one, and the prop is one id rather
     than a set so it cannot silently become two. */
  it('marks one chip on and the rest off', () => {
    render(<Chips active="layers" />);
    expect(screen.getByRole('button', { name: 'Layers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Abuse' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Map view' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('draws every chip off when none is active', () => {
    render(<Chips active={null} />);
    for (const chip of screen.getAllByRole('button')) {
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('reports the press and decides nothing itself', () => {
    const onSelect = vi.fn();
    render(<Chips active={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Map view' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('map-view');
  });

  /* NO TEXT-CHARACTER GLYPHS. Each mark is a 24-unit box of paths, and the only
     characters in the row are the three labels. */
  it('draws its marks as geometry rather than as characters', () => {
    const { container } = render(<Chips active="layers" />);
    const marks = container.querySelectorAll('svg');
    expect(marks).toHaveLength(3);
    for (const mark of marks) {
      expect(mark).toHaveAttribute('viewBox', '0 0 24 24');
      expect(mark).toHaveAttribute('fill', 'none');
      expect(mark).toHaveAttribute('stroke', 'currentColor');
      expect(mark).toHaveAttribute('stroke-linecap', 'round');
      expect(mark).toHaveAttribute('stroke-linejoin', 'round');
      expect(mark).toHaveAttribute('aria-hidden', 'true');
    }
    expect(container.textContent).toBe('AbuseLayersMap view');
  });

  /* 16 px, WHICH IS THE BRIEF'S NUMBER AND THE SPEC'S. They agree; this is the
     assertion that keeps them agreeing. */
  it('sizes every chip mark at 16 and strokes it at 1.7', () => {
    const { container } = render(<Chips active="layers" />);
    for (const mark of container.querySelectorAll('svg')) {
      expect(mark).toHaveAttribute('width', '16');
      expect(mark).toHaveAttribute('height', '16');
      expect(mark).toHaveAttribute('stroke-width', '1.7');
    }
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT IT MEASURES
 * ------------------------------------------------------------------------ */

describe('the chip row’s geometry, resolved through the tokens', () => {
  const row = block('.fwm-chip-row');

  /* CENTRED UNDER THE BAR. The brief states it and it is one declaration; if
     it goes, the row silently left-aligns and nobody files a bug about it. */
  it('centres the row and spaces it 8, 14 under the bar', () => {
    expect(decl(row, 'display')).toBe('flex');
    expect(decl(row, 'justify-content')).toBe('center');
    expect(px(decl(row, 'gap'))).toBe(8);
    expect(px(decl(row, 'margin-top'))).toBe(14);
  });

  /* A fourth chip has to fall to a second line rather than push the first one
     off the screen. `wrap` on the row, `nowrap` on the label -- opposite
     values, different jobs. */
  it('wraps the row while the labels never wrap', () => {
    expect(decl(row, 'flex-wrap')).toBe('wrap');
    expect(decl(block('.fwm-chip'), 'white-space')).toBe('nowrap');
  });
});

describe('the chip’s geometry, resolved through the tokens', () => {
  const chip = block('.fwm-chip');

  it('is 36 tall on a radius of 18, padded 0 14, with 8 between mark and word', () => {
    expect(px(decl(chip, 'height'))).toBe(36);
    expect(px(decl(chip, 'border-radius'))).toBe(18);
    expect(px(decl(chip, 'gap'))).toBe(8);
    const padding = decl(chip, 'padding').split(/\s+/u);
    expect(padding).toHaveLength(2);
    expect(padding[0]).toBe('0');
    expect(px(padding[1] ?? '')).toBe(14);
  });

  /* A TRUE PILL. Half the height IS the radius; any other pair and the ends
     stop being semicircles. */
  it('sets the radius to exactly half the height', () => {
    expect(px(decl(chip, 'border-radius')) * 2).toBe(px(decl(chip, 'height')));
  });

  it('wears a 1px hairline over glass and no second edge', () => {
    const border = decl(chip, 'border').split(/\s+/u);
    expect(px(border[0] ?? '')).toBe(1);
    expect(border[1]).toBe('solid');
    expect(border[2]).toBe('var(--dr-hairline)');
    expect(decl(chip, 'background')).toBe('var(--dr-grain), var(--dr-surface-thin)');
    expect(decl(chip, 'backdrop-filter')).toBe('var(--dr-blur)');
  });

  it('sets the label at 14 and weight 500', () => {
    expect(decl(chip, 'font-size')).toBe('var(--fwm-text-label)');
    expect(decl(chip, 'font-weight')).toBe('500');
    /* AND 14 IS WHAT THAT TOKEN IS. `.875rem` against the 16px root, declared
       once at `:root` and re-cut by no skin -- so the chip reads 14 on all
       seventeen surfaces rather than only on the default one. */
    expect(VARS.get('--fwm-text-label')).toBe('.875rem');
    expect(0.875 * 16).toBe(14);
  });

  /* THE MARK IS A TIER DIMMER THAN THE WORD, which is what the spec strokes. */
  it('paints the resting mark one ink tier below the label', () => {
    expect(decl(chip, 'color')).toBe('var(--dr-ink-2)');
    expect(decl(block('.fwm-chip .fwm-chrome-icon'), 'color')).toBe('var(--dr-ink-3)');
  });
});

describe('the active chip, which is never a solid pill', () => {
  const active = block(".fwm-chip[aria-pressed='true']");

  it('escalates in colour and weight and in nothing else', () => {
    expect(decl(active, 'border-color')).toBe('var(--dr-accent-line)');
    expect(decl(active, 'background')).toBe('var(--dr-accent-fill)');
    expect(decl(active, 'color')).toBe('var(--dr-accent)');
    expect(decl(active, 'font-weight')).toBe('700');
    /* NOT ONE PIXEL MOVES. Height, radius, padding and gap belong to the
       resting chip; escalation is colour and weight, never size. */
    for (const property of ['height', 'border-radius', 'padding', 'gap', 'font-size']) {
      expect(active, `the active chip must not restate ${property}`).not.toMatch(
        new RegExp(`(?:^|;)\\s*${property}\\s*:`, 'u'),
      );
    }
  });

  /* THE FILL IS A TINT, NOT A PILL. `--dr-accent-fill` is 0.13 alpha on dark
     and 0.10 on light -- glass with accent behind it, which is the whole of
     "never a solid pill". A raw colour here would be a solid one. */
  it('fills with the accent TINT rather than with the accent', () => {
    expect(decl(active, 'background')).not.toBe('var(--dr-accent)');
    expect(VARS.get('--dr-accent-fill')).toMatch(/^rgba\(/u);
  });

  it('takes the mark up to the label’s own colour', () => {
    expect(decl(block(".fwm-chip[aria-pressed='true'] .fwm-chrome-icon"), 'color')).toBe(
      'inherit',
    );
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT THE STYLESHEET MAY NOT CONTAIN
 * ------------------------------------------------------------------------ */

describe('the stylesheet’s own contract', () => {
  /* The gate says this too. It is repeated here because the gate is a separate
     command and a component that can only be checked by remembering to run
     something else is one that gets shipped unchecked. */
  it('writes no raw colour', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|color-mix|oklch)\s*\(/iu);
  });

  it('writes no raw length', () => {
    /* `calc(... * 9)` and `var(--fwm-space-2)`, never `36px`. Zero carries no
       design decision and `padding: 0 ...` needs it. */
    expect(CSS).not.toMatch(/(?<![\w.#-])(?!0)(?:\d*\.)?\d+(?:px|rem|em)\b/u);
    /* And no percentage either -- `border-radius: 50%` is the raw value the
       rail key would otherwise have reached for. */
    expect(CSS).not.toMatch(/\d%/u);
  });

  /* TOUCH-FIRST. The spec draws a hover ground on every chip; hover never fires
     on the target device and the gate rejects the selector outright. Dropped,
     not translated into an `:active` the spec never drew. */
  it('states no hover', () => {
    expect(CSS).not.toMatch(/:hover/u);
  });

  /* THE ONE RULE: if you can see an edge, it is a hairline. The spec gives the
     lift and the specular rim to the BAR and to nothing in this file. */
  it('lets no shadow do a hairline’s work', () => {
    expect(CSS).not.toMatch(/drop-shadow\s*\(/u);
    expect(CSS).not.toMatch(/box-shadow/u);
  });
});
