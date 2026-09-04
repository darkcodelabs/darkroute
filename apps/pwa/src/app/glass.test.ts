/**
 * THE THREE GLASS AXES, and the rule that keeps them from fighting.
 *
 * Blur, transparency and tone are deliberately separate controls, and the way
 * a three-control material goes wrong is that one of them quietly becomes a
 * synonym for another. The tests that matter here are the ones asserting the
 * axes stay orthogonal - in the stylesheet, not just in the type system.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLEAR,
  DEFAULT_GLASS,
  DEFAULT_TONE,
  FWM_CLEAR_LEVELS,
  FWM_GLASS_LEVELS,
  FWM_GLASS_TONES,
  TONE_ATTRIBUTE,
  TONE_LABELS,
  TONE_NOTES,
  applyTone,
  isTone,
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

describe('the axes stay orthogonal in the stylesheet', () => {
  it('gives every axis its own attribute, and three different ones', () => {
    const css = tokens();
    expect(css).toContain('[data-fwm-glass="off"]');
    expect(css).toContain('[data-fwm-clear="solid"]');
    expect(css).toContain('[data-fwm-tone="clear"]');
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
