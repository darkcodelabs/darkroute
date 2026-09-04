/**
 * "SEARCHES OFFLINE" IS A CLAIM ON THE SCREEN. THIS IS WHAT MAKES IT TRUE.
 *
 * v1's LOOK UP paints a `LOCAL` badge on its search field and tells the driver
 * it searched the copy of the archive on this phone. That is the entire reason
 * the screen is worth having rather than being a link to a map site.
 *
 * The failure mode is not a crash. Somebody adds a geocoder "just to resolve
 * the street name", or an index service "just for speed", and the screen still
 * works, still looks better, and has quietly started telling every search to a
 * server - from the one screen that promised it would not. Nothing else in the
 * repo would notice.
 *
 * Same test, same reasoning and the same call list as
 * `LookupScreen.source.test.ts`, which guards v0's screen against the mirrored
 * mistake.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceOf(relative: string): string {
  const found = [`src/${relative}`, `apps/pwa/src/${relative}`]
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found, `${relative} not found`).toBeDefined();
  return readFileSync(found as string, 'utf8');
}

/** Comments name the things they promise NOT to do; only code is checked. */
function codeOf(relative: string): string {
  return sourceOf(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('the v1 lookup screen', () => {
  it('NEVER reaches the network', () => {
    const code = [
      codeOf('features/lookup/LookupV1Screen.tsx'),
      codeOf('features/lookup/search.ts'),
      // The hand-off panel is part of this screen now, and it is the half that
      // touches another organisation's site. Their robots.txt refuses /api/.
      codeOf('features/lookup/PlateHandoffV1.tsx'),
    ].join('\n');
    for (const call of ['fetch(', 'XMLHttpRequest', 'axios', 'EventSource(', 'WebSocket(']) {
      expect(
        code,
        `v1 LOOKUP uses ${call}, and its own field says the search is LOCAL.`,
      ).not.toContain(call);
    }
  });

  it('keeps nothing that was typed', () => {
    // The query is component state and dies with the screen. A search history
    // on this product is a record of what a driver was looking for, which is
    // the exact class of record the app exists to reduce.
    const code = codeOf('features/lookup/LookupV1Screen.tsx');
    for (const store of ['localStorage', 'sessionStorage', 'indexedDB']) {
      expect(code, `v1 LOOKUP persists into ${store}`).not.toContain(store);
    }
  });
});
