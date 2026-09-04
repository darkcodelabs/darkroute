/**
 * THE REPORT KEY STILL DRAWS ITS MARK.
 *
 * This file exists because the exact mistake it guards has already shipped
 * once. `ReportKey`'s eye is a MASK over a flat fill -- one brand image, tinted
 * by a token rather than shipped twice in two colours -- and the mask rules
 * lived in a stylesheet the key did not obviously own. When that stylesheet
 * stopped being loaded, the mask went with it: the key kept its size, its
 * background and both gestures, so nothing failed and nothing looked broken in
 * a test. The eye was simply not there, and it was found on a phone.
 *
 * WHY THIS IS A COMPUTED-STYLE TEST AND NOT A SOURCE READ.
 * `vitest.config.ts` sets `css: false`, so a component's `import './x.css'`
 * resolves to the empty string and the rendered tree carries no rules at all.
 * The other stylesheet tests in this repo answer that by reading the file off
 * disk and asserting on its TEXT, which proves a rule was written but not that
 * it reaches the element. So this one installs every stylesheet the dock
 * directory ships -- whatever they are called -- into the document the way a
 * browser would, renders the dock that actually ships, and asks the eye what it
 * computes to. jsdom does not resolve `var()`, but `mask-image` here is a
 * literal `url()`, which is precisely the declaration that went missing.
 *
 * Being name-blind about the stylesheets is the point: the regression is
 * "the rules moved and nobody re-imported them", and a test that named the file
 * would move with them and keep passing.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { disposeScreenState } from '../../app/screenState.ts';

import { DockV1 } from './DockV1.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

const MARK = 'url("/assets/darkroute-mark.png")';

/**
 * Every stylesheet in this directory, in the order the import graph loads
 * them: the base rules a component imports for itself, then `dockV1.css`,
 * which overrides them. Read from the directory rather than listed, so a
 * renamed or split file is still covered.
 */
function dockStylesheets(): readonly string[] {
  const files = readdirSync(HERE).filter((name) => name.endsWith('.css'));
  const overrides = files.filter((name) => name === 'dockV1.css');
  const base = files.filter((name) => name !== 'dockV1.css').sort();
  return [...base, ...overrides];
}

function installDockCss(): HTMLStyleElement {
  const sheets = dockStylesheets();
  // A directory with no stylesheet at all would make every assertion below
  // vacuous, which is the failure mode this whole file is about.
  expect(sheets.length).toBeGreaterThan(0);
  const style = document.createElement('style');
  style.textContent = sheets.map((name) => readFileSync(`${HERE}/${name}`, 'utf8')).join('\n');
  document.head.append(style);
  return style;
}

afterEach(() => {
  for (const style of document.head.querySelectorAll('style')) style.remove();
  disposeScreenState();
});

describe('the REPORT key in the shipped dock', () => {
  it('draws the brand eye: the mask reaches the element, not just the stylesheet', () => {
    installDockCss();
    const { container } = render(<DockV1 />);

    const eye = container.querySelector<HTMLElement>('.fwm-report-eye');
    expect(eye).not.toBeNull();

    const computed = getComputedStyle(eye as HTMLElement);
    // The mask itself. Both spellings: the unprefixed property is what the
    // standard says and the -webkit- one is what a WebView on the target
    // phones still needs.
    expect(computed.getPropertyValue('mask-image')).toBe(MARK);
    expect(computed.getPropertyValue('-webkit-mask-image')).toBe(MARK);
    // A mask that repeats, crops or sits in a corner is a different bug with
    // the same cause, so the whole set is pinned rather than just the image.
    expect(computed.getPropertyValue('mask-size')).toBe('contain');
    expect(computed.getPropertyValue('mask-repeat')).toBe('no-repeat');
    expect(computed.getPropertyValue('mask-position')).toBe('center');
  });

  it('has a fill for the mask to reveal, and a size to reveal it at', () => {
    installDockCss();
    const { container } = render(<DockV1 />);
    const computed = getComputedStyle(container.querySelector('.fwm-report-eye') as HTMLElement);

    // A mask over nothing paints nothing, and a mask on a zero-sized box paints
    // nothing either. jsdom does not resolve `var()`, so the token NAME is what
    // lands here -- which is all this test wants: proof that the base sizing
    // rule reaches the element rather than the span collapsing to `auto`.
    expect(computed.getPropertyValue('width')).toBe('var(--fwm-icon-size)');
    expect(computed.getPropertyValue('height')).toBe('var(--fwm-icon-size)');
    // The fill under the mask. v1 overrides which token it is, so this asserts
    // that SOMETHING paints the glyph, not which colour -- picking the colour
    // is a design question and `check-design-values.mjs` already owns it.
    expect(computed.getPropertyValue('background')).toMatch(/^var\(--fwm-/);
  });

  it('is a real key, not a bare <button>: the dock chrome reaches it too', () => {
    installDockCss();
    const { container } = render(<DockV1 />);
    const key = container.querySelector<HTMLElement>('.fwm-dock-report-key');
    expect(key).not.toBeNull();

    const computed = getComputedStyle(key as HTMLElement);
    // The reset that stops the platform drawing its own button chrome, and the
    // centring that puts the eye in the middle of the circle. These are plain
    // keywords, so jsdom computes them for real.
    expect(computed.getPropertyValue('display')).toBe('flex');
    expect(computed.getPropertyValue('align-items')).toBe('center');
    expect(computed.getPropertyValue('justify-content')).toBe('center');
    expect(computed.getPropertyValue('border')).toContain('none');
  });

  it('declares no hover state anywhere in the dock, on any surface', () => {
    // Carried over from the deleted `Dock.test.tsx`, which read v0's `dock.css`
    // off disk for exactly this. It is a touch-first product: a pointer hover
    // never fires on a phone in a car mount, so a hover-only affordance is an
    // affordance no driver ever gets.
    for (const name of dockStylesheets()) {
      const rules = readFileSync(`${HERE}/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(rules, name).not.toContain(':hover');
      expect(rules, name).not.toContain('hover:');
    }
  });
});
