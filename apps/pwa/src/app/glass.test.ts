/**
 * THE GLASS AXES, and the rule that keeps them from fighting.
 *
 * Blur, transparency, tone and now relief are deliberately separate controls,
 * and the way a multi-control material goes wrong is that one of them quietly
 * becomes a synonym for another. The tests that matter here are the ones
 * asserting the axes stay orthogonal - in the stylesheet, not just in the type
 * system.
 *
 * This header said THREE for as long as there were four of them, which is the
 * small version of the same drift: liquid arrived without the count being
 * re-read. Flat is the fifth.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLEAR,
  DEFAULT_FLAT,
  DEFAULT_GLASS,
  DEFAULT_TONE,
  FLAT_ATTRIBUTE,
  FLAT_LABELS,
  FLAT_NOTES,
  FWM_CLEAR_LEVELS,
  FWM_FLAT_LEVELS,
  FWM_GLASS_LEVELS,
  FWM_GLASS_TONES,
  TONE_ATTRIBUTE,
  TONE_LABELS,
  TONE_NOTES,
  applyFlat,
  applyTone,
  isFlat,
  isTone,
  resolveFlat,
  resolveTone,
} from './glass.ts';

function tokens(): string {
  const found = ['src/styles/tokens.css', 'apps/pwa/src/styles/tokens.css']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => {
      try {
        readFileSync(path, 'utf8');
        return true;
      } catch {
        return false;
      }
    });
  expect(found, 'could not locate tokens.css').toBeDefined();
  return readFileSync(found as string, 'utf8');
}

describe('the tone axis', () => {
  it('offers exactly the two the material is described by', () => {
    expect([...FWM_GLASS_TONES]).toEqual(['clear', 'tinted']);
  });

  it('defaults to tinted, which is what the product ships as', () => {
    // `clear` held this on the argument that it looks most like the material
    // the control is named after. That is a nice argument and it is not the
    // decision: tinted is the shipping look, clear is one tap away.
    expect(DEFAULT_TONE).toBe('tinted');
  });

  it('describes both, because a control with no note is a mystery', () => {
    for (const tone of FWM_GLASS_TONES) {
      expect(TONE_LABELS[tone]).toBeTruthy();
      expect(TONE_NOTES[tone]).toBeTruthy();
    }
  });

  it('lands an unreadable stored value on the default rather than throwing', () => {
    expect(resolveTone('frosted')).toBe(DEFAULT_TONE);
    expect(resolveTone(undefined)).toBe(DEFAULT_TONE);
    expect(isTone('tinted')).toBe(true);
    expect(isTone('clear ')).toBe(false);
  });

  it('writes the attribute the stylesheet keys on', () => {
    const root = document.createElement('html');
    applyTone('tinted', root);
    expect(root.getAttribute(TONE_ATTRIBUTE)).toBe('tinted');
  });
});

describe('the flat axis', () => {
  it('offers exactly the two states a look is either in or not', () => {
    expect([...FWM_FLAT_LEVELS]).toEqual(['on', 'off']);
  });

  it('defaults to on, because flat is the shipping look', () => {
    // It shipped as `off` for one day, on the argument that an install which
    // predates this axis must not lose its rim on upgrade. The owner ruled the
    // other way on 2026-09-06: flat IS the look, and an old install gets it too
    // rather than being left on a material that depends on install date.
    expect(DEFAULT_FLAT).toBe('on');
  });

  it('describes both, because a control with no note is a mystery', () => {
    for (const level of FWM_FLAT_LEVELS) {
      expect(FLAT_LABELS[level]).toBeTruthy();
      expect(FLAT_NOTES[level]).toBeTruthy();
    }
  });

  it('lands an unreadable stored value on the default rather than throwing', () => {
    expect(resolveFlat('flat')).toBe(DEFAULT_FLAT);
    expect(resolveFlat(undefined)).toBe(DEFAULT_FLAT);
    expect(isFlat('on')).toBe(true);
    expect(isFlat('On')).toBe(false);
  });

  it('writes the attribute for EVERY value, the default included', () => {
    // The same specificity reason `applyGlass` records: a bare `:root` block
    // and a `[data-fwm-flat="off"]` block do not carry the same weight, so
    // leaving the attribute off for one value would make that one value the
    // only one an override cannot reach.
    for (const level of FWM_FLAT_LEVELS) {
      const root = document.createElement('html');
      applyFlat(level, root);
      expect(root.getAttribute(FLAT_ATTRIBUTE)).toBe(level);
    }
  });

  it('actually zeroes the rim, the sheen and the cast shadow', () => {
    const css = tokens();
    const on = blockFor(css, '[data-fwm-flat="on"]');
    expect(on, 'no block for flat=on').not.toBeNull();
    expect(on).toContain('--fwm-glass-rim: var(--fwm-shadow-flat);');
    expect(on).toContain('--fwm-liquid-edge: var(--fwm-shadow-flat);');
    expect(on).toContain('--fwm-card-shadow: var(--fwm-shadow-flat);');
    expect(on).toContain('--fwm-liquid-sheen: none;');

    /*
     * AND IT GIVES THE EDGE BACK, because with the rim gone the border is the
     * only thing left separating a panel from the map under it. 0.14 white -
     * what every floating control carries elsewhere - is very nearly nothing
     * over a dark moving map once the rim is not there beside it.
     *
     * `color-mix` against `--fwm-text` and NOT a literal: this block outranks
     * the `[data-fwm-mode]` blocks where `paper`, `refinement` and `e-ink` set
     * their own dark `rgba(0, 0, 0, 0.10)` border, so a fixed white here would
     * be invisible on exactly the three skins that already knew better.
     */
    expect(on).toMatch(/--fwm-glass-border:\s*color-mix\(in srgb, var\(--fwm-text\)/);
    expect(on, 'a literal border colour cannot follow the theme').not.toMatch(
      /--fwm-glass-border:\s*rgba?\(/,
    );
    // And the thing those three resolve to draws nothing.
    expect(blockFor(css, ':root')).toContain('--fwm-shadow-flat: 0 0 transparent;');
  });

  it('outranks the liquid block that would otherwise hand the sheen back', () => {
    // `[data-fwm-liquid="on"]` re-declares the sheen and the edge at the SAME
    // weight as a bare `[data-fwm-flat="on"]`, and it is the last block in the
    // file - so at equal specificity flat loses, in the one combination that
    // is the shipping default and the whole reason somebody turned flat on.
    // The `:root` in the selector is what settles it.
    expect(tokens()).toContain(':root[data-fwm-flat="on"] {');
  });

  it('sends the shadows to a transparent shadow rather than to `none`', () => {
    // `box-shadow: none, none` is invalid, and an invalid declaration is
    // DROPPED - the element then keeps whatever an earlier rule left on it,
    // which differs per element and per stylesheet order. Three surfaces
    // compose two of these tokens into one declaration, so this is not a
    // stylistic preference.
    const css = tokens();
    const on = blockFor(css, '[data-fwm-flat="on"]');
    expect(on).not.toMatch(/--fwm-glass-rim:\s*none/);
    expect(on).not.toMatch(/--fwm-card-shadow:\s*none/);
    expect(on).not.toMatch(/--fwm-liquid-edge:\s*none/);
  });
});

describe('the axes stay orthogonal in the stylesheet', () => {
  it('gives every axis its own attribute, and four different ones', () => {
    const css = tokens();
    expect(css).toContain('[data-fwm-glass="off"]');
    expect(css).toContain('[data-fwm-clear="solid"]');
    expect(css).toContain('[data-fwm-tone="clear"]');
    expect(css).toContain('[data-fwm-flat="on"]');
  });

  it('lets the FLAT block take the light away and nothing else', () => {
    // Flat is a modifier over the other four, not a fifth off switch for the
    // material: a flat panel is still frosted to the level, transparent to the
    // alpha and coloured by the channel the driver chose. Reaching for any of
    // those here would make "flat" a second, quieter way to set them.
    const css = tokens();
    const on = blockFor(css, '[data-fwm-flat="on"]');
    expect(on, 'flat must not set the blur').not.toContain('--fwm-glass-blur:');
    expect(on, 'flat must not set the alpha').not.toContain('--fwm-glass-a:');
    expect(on, 'flat must not set the channel').not.toContain('--fwm-glass-rgb:');
    expect(on, 'flat must not square the corners').not.toContain('--fwm-radius');
  });

  it('lets the BLUR blocks set only blur, never alpha or channel', () => {
    // A blur level that also moved the alpha would make the transparency
    // control jump whenever somebody changed the frost, which is the exact
    // confusion three axes exist to avoid.
    const css = tokens();
    for (const level of FWM_GLASS_LEVELS) {
      const block = blockFor(css, `[data-fwm-glass="${level}"]`);
      if (block === null) continue;
      expect(block, `glass=${level} must not set the alpha`).not.toContain('--fwm-glass-a:');
      expect(block, `glass=${level} must not set the channel`).not.toContain('--fwm-glass-rgb:');
    }
  });

  it('lets the TRANSPARENCY blocks set only alpha, never blur', () => {
    const css = tokens();
    for (const level of FWM_CLEAR_LEVELS) {
      const block = blockFor(css, `[data-fwm-clear="${level}"]`);
      if (block === null) continue;
      expect(block, `clear=${level} must not set the blur`).not.toContain('--fwm-glass-blur:');
    }
  });

  it('lets the TONE blocks change the material, never the amount of it', () => {
    // Tone decides WHICH channel the alpha lands on and how the optics are
    // driven. It must not set `--fwm-glass-a` or `--fwm-glass-blur`, or picking
    // Clear would silently undo the transparency and blur the driver chose.
    const css = tokens();
    for (const tone of FWM_GLASS_TONES) {
      const block = blockFor(css, `[data-fwm-tone="${tone}"]`);
      expect(block, `no block for tone=${tone}`).not.toBeNull();
      expect(block, `tone=${tone} must not set the alpha`).not.toContain('--fwm-glass-a:');
      expect(block, `tone=${tone} must not set the blur`).not.toContain('--fwm-glass-blur:');
    }
  });
});

describe('the optics are what make it liquid glass rather than frosted', () => {
  it('rides saturation and brightness in the same backdrop-filter pass', () => {
    // A blur alone DESATURATES - it averages neighbours - so a vivid map behind
    // a panel comes out grey. Real glass concentrates light. These two ops are
    // effectively free: the expensive part is the read-back blit, which happens
    // once regardless of how many ops ride on it.
    const css = tokens();
    expect(css).toContain('--fwm-glass-saturate');
    expect(css).toContain('--fwm-glass-brightness');
    // The declaration wraps across lines and blur() nests a var(), so this
    // cannot be a tidy single-line pattern.
    expect(css).toMatch(/--fwm-glass-filter:[\s\S]*?blur\([\s\S]*?saturate\([\s\S]*?brightness\(/);
  });

  it('keeps a specular rim that costs no read-back at all', () => {
    const css = tokens();
    expect(css).toContain('--fwm-glass-rim');
    expect(css).toMatch(/--fwm-glass-rim:[\s\S]*?inset/);
  });

  it('still removes the whole filter when glass is off', () => {
    // The saturate and brightness must not resurrect the cost that
    // `glass=off` exists to remove: `blur(0px) saturate(200%)` is still a
    // per-frame read-back.
    const css = tokens();
    const off = blockFor(css, '[data-fwm-glass="off"]');
    expect(off).not.toBeNull();
    expect(off).toContain('--fwm-glass-filter: none');
  });

  it('uses the medium setting for both defaults', () => {
    expect(DEFAULT_GLASS).toBe('medium');
    expect(DEFAULT_CLEAR).toBe('medium');
  });
});

describe('the default night clear-panel contrast', () => {
  it('keeps the 11px muted drive labels at WCAG AA', () => {
    // Explicit audit inputs. CSS legacy colours alpha-composite in encoded
    // sRGB; WCAG contrast then uses linearised relative luminance.
    const mapGround: Rgb = [14, 17, 22];
    const clearVeil: Rgb = [255, 255, 255];
    const mediumAlpha = 0.6;
    const clearScale = 0.42;
    const nightMuted: Rgb = [188, 196, 209];

    const panel = compositeSrgb(clearVeil, mapGround, mediumAlpha * clearScale);
    const ratio = contrastRatio(nightMuted, panel);

    expect(ratio).toBeCloseTo(4.83, 2);
    expect(ratio).toBeGreaterThanOrEqual(4.5);

    // Tie every numeric input that this test owns back to the shipped tokens.
    const css = tokens();
    expect(blockFor(css, ':root')).toContain('--fwm-glass-clear-scale: 0.42;');
    expect(blockFor(css, '[data-fwm-clear="medium"]')).toContain(
      '--fwm-glass-a: 0.6;',
    );
    expect(
      hexDeclaration(
        blockFor(css, '[data-fwm-mode="night-watch"]'),
        '--fwm-text-muted',
      ),
    ).toEqual(nightMuted);
  });
});

type Rgb = readonly [number, number, number];

function compositeSrgb(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
  ];
}

function linearChannel(channel: number): number {
  const encoded = channel / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function hexDeclaration(block: string | null, property: string): Rgb | null {
  if (block === null) return null;
  const match = new RegExp(`${property}:\\s*#([0-9a-f]{6})`, 'i').exec(block);
  if (match?.[1] === undefined) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/** The body of the first rule whose selector list contains `selector`. */
/**
 * EVERY BLOCK THIS SELECTOR OPENS, concatenated - the same helper, and the same
 * reason, as `features/settings/swatches.test.ts`.
 *
 * These selectors used to carry a `[data-fwm-design="v1"]` prefix that made each
 * one unique in the file. v0 was removed and the prefix went with it, so `:root`
 * is now opened three times in `tokens.css` - the base palette near the top, the
 * redesign's layer in the middle, the swatch triples at the bottom - and reading
 * only one of them misses whichever half a given assertion is about.
 *
 * Matched as a whole selector (` {` must follow) so `[data-fwm-mode="e-ink"]`
 * never matches `[data-fwm-mode="e-ink"][data-fwm-glass]`.
 */
function blockFor(css: string, selector: string): string | null {
  const needle = `${selector} {`;
  const blocks: string[] = [];
  let at = css.indexOf(needle);
  while (at >= 0) {
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    if (open === -1 || close === -1) break;
    blocks.push(css.slice(open + 1, close));
    at = css.indexOf(needle, close);
  }
  return blocks.length === 0 ? null : blocks.join('\n');
}
