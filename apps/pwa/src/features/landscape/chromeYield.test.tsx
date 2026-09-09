/**
 * THE CHROME YIELDS -- section A5, "keyboard takes 200 px, chrome yields".
 *
 * Read off `landscape.css` rather than out of a rendered tree, for the reason
 * `TopBar.test.tsx` gives: vitest runs with `css: false`, so a stylesheet
 * import -- `?raw` included -- is stubbed to the empty string and an assertion
 * against one would pass on '' whatever the file said. jsdom also does not
 * cascade custom properties or lay anything out, so `getComputedStyle` on a
 * rail cannot tell whether it went.
 *
 * WHAT WOULD BREAK WITHOUT THIS. A landscape soft keyboard is full-width and
 * roughly 200px tall. If any of these five surfaces stops yielding, it does not
 * disappear and it does not throw -- it sits UNDER the keyboard, looking
 * pressable and doing nothing, which is the failure "NEVER CLIP EITHER RAIL"
 * exists to name.
 */

import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LandscapeChrome } from './LandscapeChrome.tsx';
import { LANDSCAPE_CHROME_LABEL, LANDSCAPE_SEARCH } from './LandscapeChrome.tsx';
import { counted } from '../search/panel.ts';
import type { LandscapeSlots } from './slots.ts';

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/**
 * COMMENTS BLANKED, and here it is load-bearing rather than tidy.
 *
 * The prose in section 9 quotes almost every selector and declaration this file
 * asserts the ABSENCE of -- it explains why the scrim stays, why `display` was
 * refused, and where the alert takeover actually lives. Read raw, the negative
 * assertions would all match their own explanations. `TopBar.test.tsx` blanks
 * its stylesheet for the same reason.
 */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '));
}

const CSS: string = blankComments(readFileSync(`${HERE}/landscape.css`, 'utf8'));

/** The block that hides them all. Matched as one rule so a surface dropped from
    the selector list fails here rather than quietly staying on screen. */
const YIELD_BLOCK = CSS.slice(CSS.indexOf(".fwm-ls[data-fwm-yield='true']"));

describe('everything in the chrome layer yields except the scrim', () => {
  it.each([
    ['the tab rail', '.fwm-ls-rail'],
    ['the right rail', '.fwm-ls-right'],
    ['both content slots', '.fwm-ls-slot'],
    ['the route advisory band', '.fwm-ls-band'],
    ['the expanded nearby panel', '.fwm-ls-panel'],
  ])('takes %s away while the field has focus', (_label, selector) => {
    expect(YIELD_BLOCK).toContain(`.fwm-ls[data-fwm-yield='true'] ${selector}`);
  });

  it('leaves the scrim, because it is a gradient over the map and takes no press', () => {
    expect(YIELD_BLOCK).not.toContain('.fwm-ls-scrim');
  });
});

describe('how they go', () => {
  it('uses visibility rather than display, so nothing loses its layout', () => {
    /*
     * `display: none` destroys layout: a tab row loses its scroll position and
     * a focused button drops focus on `<body>`. That is the exact failure this
     * whole surface is being careful about -- "ROTATING NEVER RESETS" -- and
     * `drive.css` already chose `visibility` over `display` for bare mode for
     * the same reason.
     */
    expect(YIELD_BLOCK).toContain('visibility: hidden');
    expect(YIELD_BLOCK).not.toContain('display: none');
  });

  it('takes the presses with them, so nothing invisible is still pressable', () => {
    expect(YIELD_BLOCK).toContain('pointer-events: none');
  });

  it('cross-fades rather than blinking out from under a thumb', () => {
    expect(CSS).toContain('opacity var(--fwm-dur-fast) var(--fwm-ease-out)');
  });
});

describe('the live camera warning is not in this layer and does not yield', () => {
  it('never names the alert takeover', () => {
    /*
     * "An app that hides the camera warning when you tidy the screen is an app
     * that has forgotten what it is for" -- `drive.css`, and it holds here. It
     * costs nothing to honour: the takeover is `App.tsx`'s own
     * `.fwm-shell-layer[data-fwm-layer='alert']`, a sibling of this whole
     * chrome. `.fwm-ls-band` is a ROUTE advisory in the content column --
     * "Reroute around 9" -- and not the warning.
     */
    expect(CSS).not.toContain('fwm-shell-layer');
    expect(CSS).not.toContain("data-fwm-layer='alert'");
  });
});

/* ========================================================================== *
 * THE PROP THAT DRIVES ALL OF THE ABOVE
 *
 * The stylesheet is only half the contract. If the flag stops reaching the root
 * element, every rule in section 9 is still correct and none of them ever
 * matches -- which is the silent half of this failure and the reason this case
 * renders rather than reads.
 * ========================================================================== */

const SLOTS: LandscapeSlots = {
  mode: 'monitor',
  top: null,
  band: null,
  bottom: { kind: 'monitor', count: counted(2) },
};

function draw(yielding?: boolean): void {
  render(
    <LandscapeChrome
      activeTab="map"
      onTab={() => undefined}
      slots={SLOTS}
      density="high"
      expanded={false}
      onExpand={() => undefined}
      onCollapse={() => undefined}
      markSrc="/brand/darkroute-logo.png"
      {...(yielding === undefined ? {} : { yielding })}
    />,
  );
}

describe('the flag reaches the root element', () => {
  it('marks the layer while the field has focus', () => {
    draw(true);
    expect(screen.getByLabelText(LANDSCAPE_CHROME_LABEL).dataset['fwmYield']).toBe('true');
  });

  it('leaves no attribute at all when it is not yielding, so the rules cannot half-match', () => {
    /* `undefined` rather than `'false'`: an attribute that is present and false
       is one typo in a selector away from hiding the whole chrome permanently. */
    draw(false);
    expect(screen.getByLabelText(LANDSCAPE_CHROME_LABEL).dataset['fwmYield']).toBeUndefined();
  });

  it('defaults to not yielding, so a host that never wired it still draws its rails', () => {
    draw();
    expect(screen.getByLabelText(LANDSCAPE_CHROME_LABEL).dataset['fwmYield']).toBeUndefined();
    /* And the opener is still there to be pressed. */
    expect(screen.getByLabelText(LANDSCAPE_SEARCH)).toBeTruthy();
  });
});
