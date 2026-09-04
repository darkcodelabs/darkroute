/**
 * THE THEME SWATCHES MUST MATCH THE PALETTES THEY NAME.
 *
 * =============================================================================
 * WHY THIS IS A TEST AND NOT A COMMENT
 * =============================================================================
 * v1's SETTINGS draws every theme as a card carrying three dots of its own
 * palette, and a card cannot READ another mode's palette: `[data-fwm-mode]`
 * sits on `<html>`, so inside a running document there is exactly one live
 * palette and it is the one already applied.
 *
 * So the nine triples are transcribed into `--fwm-swatch-*` by hand, next to
 * the blocks they came from. Two sources for one fact, which is the setup that
 * drifts: somebody retunes `pursuit`'s crimson, the mode changes, the swatch
 * does not, and the theme picker quietly shows a colour the product stopped
 * using. Nobody notices, because the picker looks fine either way.
 *
 * This reads `tokens.css` and compares them. It is the same shape as
 * `threshold.test.tsx`, which compares the threshold stops against their CSS
 * transcription for the same reason.
 *
 * It checks v1's SEVEN, not every mode in the union: `V1_MODES` is what the v1
 * picker offers, and a v0-only theme has no card here to be wrong.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FwmMode } from '../../app/mode.ts';
import { V1_MODES } from './modes.ts';

function tokensCss(): string {
  const found = ['src/styles/tokens.css', 'apps/pwa/src/styles/tokens.css']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found, 'tokens.css not found').toBeDefined();
  return readFileSync(found as string, 'utf8');
}

/**
 * Every block for a selector, concatenated.
 *
 * `:root` is opened more than once in `tokens.css` - the palette near the top,
 * the swatch triples at the bottom - and reading only the first would miss
 * exactly the half this test exists to check.
 */
function blockFor(css: string, selector: string): string | null {
  const needle = `${selector} {`;
  const blocks: string[] = [];
  let at = css.indexOf(needle);
  while (at >= 0) {
    const end = css.indexOf('\n}', at);
    if (end < 0) break;
    blocks.push(css.slice(at, end));
    at = css.indexOf(needle, end);
  }
  return blocks.length === 0 ? null : blocks.join('\n');
}

/** The value of one declaration inside a block, or null. */
/**
 * THE LAST DECLARATION WINS, because that is what the cascade does.
 *
 * `blockFor` concatenates every block opened by the selector, and `tokens.css`
 * opens `[data-fwm-mode="X"]` twice for several modes: v0's palette in the
 * upper half of the file and the redesign's, further down, which overrides it.
 * Those two used to be told apart by a `[data-fwm-design="v1"]` prefix. v0 was
 * removed and the prefix went with it, so the ONLY thing separating them now is
 * file order - which means reading the first match would silently certify the
 * picker against the retired palette, the exact mistake this file exists to
 * catch. Reading the last match resolves it the way a browser does.
 */
function declaration(block: string, name: string): string | null {
  const all = [...block.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))];
  const last = all.at(-1);
  return last === undefined ? null : (last[1]?.trim().toUpperCase() ?? null);
}

/**
 * The palette a v1 theme actually renders in.
 *
 * The mode block first, then `:root` for the modes that do not override.
 *
 * Several modes are declared TWICE in `tokens.css` under this one selector -
 * v0's palette and, later in the file, the redesign's. `declaration` resolves
 * that the way the cascade does; see the note on it.
 */
function paletteValue(css: string, mode: FwmMode, token: string): string | null {
  for (const selector of [`[data-fwm-mode="${mode}"]`, ':root']) {
    const block = blockFor(css, selector);
    const value = block === null ? null : declaration(block, token);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Which palette token each swatch dot stands for.
 *
 * GROUND, CLEAR, ALERT. Not `--fwm-accent-scan`, which was the obvious pick
 * and the wrong one: six of the nine modes inherit it unchanged, so a swatch
 * built on it draws six identical cyan dots. These three are the ones a mode
 * actually retunes, which is what makes one theme recognisable from another.
 */
const DOTS = [
  { swatch: 'bg', palette: '--fwm-bg' },
  { swatch: 'clear', palette: '--fwm-alert-clear' },
  { swatch: 'alert', palette: '--fwm-alert-in-range' },
] as const;

describe('the mode swatches', () => {
  const css = tokensCss();
  const root = blockFor(css, ':root');

  it('declares a full triple for every mode', () => {
    expect(root).not.toBeNull();
    for (const mode of V1_MODES) {
      for (const dot of DOTS) {
        expect(
          declaration(root as string, `--fwm-swatch-${mode}-${dot.swatch}`),
          `no --fwm-swatch-${mode}-${dot.swatch}; the card would fall back to night watch`,
        ).not.toBeNull();
      }
    }
  });

  it('paints each swatch in the palette that mode actually renders in', () => {
    for (const mode of V1_MODES) {
      for (const dot of DOTS) {
        const swatch = declaration(root as string, `--fwm-swatch-${mode}-${dot.swatch}`);
        const palette = paletteValue(css, mode, dot.palette);
        expect(
          swatch,
          `--fwm-swatch-${mode}-${dot.swatch} says ${String(swatch)}, but ${mode} renders ` +
            `${dot.palette} as ${String(palette)}. The picker is showing a colour the ` +
            `product does not use.`,
        ).toBe(palette);
      }
    }
  });
});
