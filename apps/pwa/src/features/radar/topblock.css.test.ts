/**
 * THE LADDER'S BARS ARE A BACKGROUND, AND A RESET CAN ERASE THEM.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * Making a bar tappable turned `<span class="fwm-topblock-mark">` into
 * `<button class="fwm-topblock-mark">`, which needed the usual button reset.
 * That reset was copied from the others in the file and included
 * `background: none`.
 *
 * `.fwm-topblock-mark`'s bar IS a background - a repeating radial-gradient
 * painting the dot lattice - and `button.fwm-topblock-mark` outranks
 * `.fwm-topblock-mark` on specificity. So the reset won and every bar drew
 * nothing.
 *
 * WHY NOTHING CAUGHT IT. `corridor.test.ts` proves the marks are COMPUTED -
 * right count, right bucket, right heat, right camera - and they all still
 * were. The failure was entirely in the paint, and the two washes underneath
 * kept rendering, so the panel looked alive and simply had no cameras on it.
 * On an instrument whose job is warning somebody, an empty ladder does not
 * read as broken. It reads as CLEAR ROAD.
 *
 * =============================================================================
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST
 * =============================================================================
 * `vitest.config.ts` sets `css: false`, so a component's own `import './x.css'`
 * resolves to the empty string and no render test in this repo can ask what
 * colour anything actually is. Reading the rules and asserting on them is what
 * `dock/reportKeyMark.test.tsx` also does -- it inherited the idiom from
 * `dock/Dock.test.tsx`, deleted with v0's dock -- and it catches this specific
 * class of mistake, a later rule quietly cancelling an earlier one, which is
 * exactly the kind that ships.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** cwd is `apps/pwa` under `pnpm test:unit` and the repo root under `--root`. */
function radarCss(): string {
  const found = ['src/features/radar/radar.css', 'apps/pwa/src/features/radar/radar.css']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found).toBeDefined();
  return readFileSync(found as string, 'utf8');
}

/** The body of one rule, comments stripped. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from radar.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the tappable mark', () => {
  /**
   * THE FOUR PROPERTIES THAT ARE THE BAR. Width and margin place it, height
   * comes from the `data-fwm-corridor-h` table, and `background` draws every
   * dot in it. A button reset may touch none of them.
   */
  const OWNED_BY_THE_BAR = ['background', 'width', 'margin-left', 'height'];

  it('never resets a property that the bar is drawn with', () => {
    const body = ruleBody(radarCss(), 'button.fwm-topblock-mark');
    for (const property of OWNED_BY_THE_BAR) {
      // Anchored to a declaration start so `background` does not match
      // `background-clip`, and `width` does not match `border-width`.
      const declared = new RegExp(`(^|;|\\s)${property}\\s*:`).test(body);
      expect(declared, `button.fwm-topblock-mark must not set ${property}`).toBe(false);
    }
  });

  it('still resets the things a button actually needs resetting', () => {
    // The other half: a reset that got too timid would leave the platform's
    // own border and padding on a 11px bar and bend the whole ladder.
    const body = ruleBody(radarCss(), 'button.fwm-topblock-mark');
    expect(body).toMatch(/padding\s*:\s*0/);
    expect(body).toMatch(/border\s*:\s*0/);
    expect(body).toMatch(/appearance\s*:\s*none/);
  });

  it('keeps the bar itself painting a gradient, which is the drawing', () => {
    // If this ever stops being true the test above is guarding nothing.
    expect(ruleBody(radarCss(), '.fwm-topblock-mark')).toMatch(/background:\s*\n?\s*radial-gradient/);
  });
});
