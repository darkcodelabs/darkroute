/**
 * THE INSTALLER IS RETIRED, AND ITS SCAFFOLDING MUST GO WITH IT.
 *
 * =============================================================================
 * WHAT THIS GUARDED, AND WHERE IT MOVED
 * =============================================================================
 * The node screen once led with INSTALL FIRMWARE. On a phone that section could
 * never do anything - Chrome on Android exposes Web Serial only for Bluetooth
 * serial ports, never for USB - so a `data-fwm-node-flashable="false"` attribute
 * reordered four flex children to push it last, and the original of this file
 * asserted those `order` rules existed.
 *
 * The app no longer builds or writes firmware. It pairs with whatever Meshtastic
 * release is already on the node and marks it as a darkroute participant by
 * writing a channel over the Bluetooth link.
 *
 * This file used to read `features/node/node.css` and `features/node/NodeScreen.tsx`.
 * Both were v0's, and both went with v0. So the guard moved rather than died:
 * the same strings are banned, now across the `mesh` feature that replaced them,
 * plus an assertion that the v0 files really are gone rather than merely
 * unrendered. A screen nothing routes to is still a screen somebody can wire
 * back up.
 *
 * jsdom does not resolve stylesheets, so no render test in this repo can ask
 * what order anything is in. Reading the rules is what `topblock.css.test.ts`
 * and `dock/Dock.test.tsx` already do, for the same reason.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** cwd is `apps/pwa` under `pnpm test:unit` and the repo root under `--root`. */
function underSrc(relative: string): string | undefined {
  return [`src/${relative}`, `apps/pwa/src/${relative}`]
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
}

/** Every mesh source and stylesheet, concatenated. */
function meshText(): string {
  const dir = underSrc('features/mesh');
  expect(dir, 'features/mesh not found').toBeDefined();
  return readdirSync(dir as string)
    .filter((n) => /\.(css|ts|tsx)$/.test(n) && !n.includes('.test.'))
    .map((n) => readFileSync(resolve(dir as string, n), 'utf8'))
    .join('\n');
}

describe('the retired installer leaves nothing behind', () => {
  it('has no rules or markup keyed to the flashable attribute', () => {
    // The attribute is gone. Anything still keyed to it is dead weight that
    // reorders a screen the day the name is reused.
    expect(meshText()).not.toContain('data-fwm-node-flashable');
  });

  it('has no install part left to order', () => {
    expect(meshText()).not.toContain('data-fwm-node-part="install"');
  });

  it('stops claiming the screen can put firmware on a board', () => {
    // The strings were the promise. `catalog.ts` and `flash.ts` are deleted, so
    // anything left saying INSTALL is a screen offering what it cannot do.
    const text = meshText();
    expect(text).not.toContain('INSTALL FIRMWARE');
    expect(text).not.toContain('INSTALL OVER USB');
  });

  it('imports none of the deleted firmware modules', () => {
    const text = meshText();
    expect(text).not.toContain("from './flash.ts'");
    expect(text).not.toContain("from './catalog.ts'");
    expect(text).not.toContain("from './firmware.ts'");
  });
});

describe('v0 node screen is gone, not merely unrouted', () => {
  it('has no NodeScreen and no node stylesheet left to reach', () => {
    // Both were removed with v0. Dead code holding a Bluetooth session is
    // exactly the shape of thing that gets wired back up by accident.
    expect(underSrc('features/node/NodeScreen.tsx')).toBeUndefined();
    expect(underSrc('features/node/node.css')).toBeUndefined();
  });
});
