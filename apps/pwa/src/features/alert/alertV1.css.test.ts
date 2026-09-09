/**
 * THE TAKEOVER'S MATERIAL, AND THE ONE SURFACE ON IT THAT MUST NOT HAVE ANY.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * `alertV1.css` contained the word `glass` nowhere at all. The card, the two
 * disclosure panels and the two chips over the picture each painted a fixed
 * fill - `--fwm-surface-1`, `--fwm-surface-control`, `--fwm-surface-card-over` -
 * and none of those answers to a single one of the material axes. So the four
 * controls in SETTINGS moved every other v1 surface and left this one exactly
 * as it was: a driver who turned the blur off, went clear, or flattened the
 * relief got the change everywhere except on the screen that interrupts them.
 *
 * NOTHING WOULD HAVE CAUGHT THAT. `AlertV1.test.tsx` asserts what the takeover
 * says and refuses to say, which is the important half and is entirely
 * unaffected: the screen kept warning, kept withholding the side with no
 * heading, kept dropping both panels for a camera whose record had expired. The
 * failure was only ever in the paint, and a surface with the wrong fill does not
 * look broken. It looks like a decision somebody made.
 *
 * =============================================================================
 * AND THE OPPOSITE FAILURE, WHICH IS WORSE
 * =============================================================================
 * `.fwm-alertv1` itself is the exception. It is the layer that covers the
 * screen, and it is opaque on purpose - a translucent takeover puts the screen
 * it interrupted back into the driver's eye, which is the one thing a takeover
 * exists not to do. That makes it look exactly like the surface a material
 * sweep missed, and the next such sweep is the likeliest thing ever to break
 * this screen. So the exemption is pinned here as hard as the rule is.
 *
 * =============================================================================
 * WHY THIS IS A SOURCE TEST AND NOT A RENDER TEST
 * =============================================================================
 * `vitest.config.ts` sets `css: false`, so a component's own `import './x.css'`
 * resolves to the empty string and no render test in this repo can ask what
 * colour anything actually is. Reading the rules and asserting on them is the
 * idiom `radar/topblock.css.test.ts` and `dock/reportKeyMark.test.tsx` already
 * use, and it catches this class of mistake - a fill that is a perfectly good
 * colour and the wrong token - which is exactly the kind that ships.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** cwd is `apps/pwa` under `pnpm test:unit` and the repo root under `--root`. */
function alertCss(): string {
  const found = ['src/features/alert/alertV1.css', 'apps/pwa/src/features/alert/alertV1.css']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found).toBeDefined();
  // Comments first, and the whole file rather than one body: this stylesheet
  // argues at length in prose about the very tokens being asserted on, so a
  // search over the raw text would find `--fwm-surface-card-over` in the note
  // explaining why it was removed.
  return readFileSync(found as string, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The body of one rule, from a stylesheet already stripped of comments. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is missing from alertV1.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/**
 * EVERY FLOATING SURFACE ON THE TAKEOVER. The card, the two disclosure panels,
 * and the compass badge and location chip that sit over the picture. Not the
 * layer - see the block below, which is the whole point of listing these by
 * name rather than sweeping the file.
 */
const FLOATING = [
  '.fwm-alertv1-card',
  '.fwm-alertv1-panel',
  '.fwm-alertv1-north',
  '.fwm-alertv1-you',
];

/** The three fills these rules used to carry. None of them is reachable by any
 *  of the material controls, which is the whole complaint. */
const FIXED_FILLS = ['--fwm-surface-1', '--fwm-surface-control', '--fwm-surface-card-over'];

describe('the takeover material', () => {
  it.each(FLOATING)('draws %s from the shared glass tokens', (selector) => {
    const body = ruleBody(alertCss(), selector);
    expect(body).toContain('background: var(--fwm-surface-glass)');
    expect(body).toContain('backdrop-filter: var(--fwm-glass-filter)');
    expect(body).toContain('--fwm-glass-rim');
  });

  it.each(FLOATING)('leaves %s no fixed fill for the material controls to miss', (selector) => {
    const body = ruleBody(alertCss(), selector);
    for (const token of FIXED_FILLS) {
      expect(body, `${selector} still paints itself with ${token}`).not.toContain(token);
    }
  });

  it('gives every floating surface a hairline, because a fill is not an edge', () => {
    // `--fwm-glass-a` runs down to 0.3 and flat is the shipping relief, so
    // neither the tint nor the rim can be relied on to bound a panel. The
    // location chip had no border at all and was the first thing to dissolve.
    for (const selector of FLOATING) {
      const body = ruleBody(alertCss(), selector);
      expect(body, `${selector} has no border`).toMatch(/\n\s*border:/);
    }
  });

  it('keeps the card edge in the state hue rather than in the glass hairline', () => {
    // This border is the alert speaking, not chrome. The material axes move
    // everything else on the card and must not be able to wash this out.
    const body = ruleBody(alertCss(), '.fwm-alertv1-card');
    expect(body).toContain('border: var(--fwm-rule-w) solid var(--fwm-alertv1-hue)');
  });

  it('composes the card rim and its cast shadow into a single declaration', () => {
    // `box-shadow` does not accumulate. Two rules each setting one of them
    // leaves the card either flat or unlit depending on which sheet loaded
    // last, which is the bug `drive.css` records for its own two cards.
    const body = ruleBody(alertCss(), '.fwm-alertv1-card');
    expect(body.match(/box-shadow:/g)).toHaveLength(1);
    expect(body).toContain('box-shadow: var(--fwm-glass-rim), var(--fwm-card-shadow)');
  });
});

describe('the takeover layer itself', () => {
  it('stays opaque however the material is set', () => {
    // Everything under this loses. A translucent takeover puts the screen it
    // interrupted back into the driver's eye.
    const body = ruleBody(alertCss(), '.fwm-alertv1');
    expect(body).toContain('background: var(--fwm-bg)');
    expect(body).not.toContain('--fwm-surface-glass');
  });

  it('never reads back what is behind it', () => {
    // The layer covers the whole screen, so a backdrop-filter here would be a
    // full-viewport read-back that buys a blur of something already hidden.
    const body = ruleBody(alertCss(), '.fwm-alertv1');
    expect(body).not.toContain('backdrop-filter');
  });
});
