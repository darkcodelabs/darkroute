/**
 * THE TWO CUSTOM FLAVOURS ARE COMPLETE, AND THEIR COLOURS EXIST.
 *
 * =============================================================================
 * WHY THE INTERESTING TEST IS ABOUT TOKEN NAMES
 * =============================================================================
 * A flavour is handed to `layers()`, which reads 74 keys off it and builds a
 * MapLibre style. Both failure modes are silent:
 *
 *   A MISSING KEY becomes `undefined` in a paint property. MapLibre does not
 *   reject the layer; it draws it with whatever it falls back to, so a road
 *   class quietly disappears into the ground.
 *
 *   A MISSPELT TOKEN resolves to the empty string, `readTokens` substitutes
 *   `FALLBACK_COLOUR`, and one road class ships mid-grey on a navy map.
 *   `check-design-values.mjs` cannot catch this one: it verifies that a
 *   `var(--fwm-*)` written in CSS resolves, and these names are strings built
 *   in TypeScript that never appear in a stylesheet.
 *
 * So this file checks the SHAPE against the package's own flavours, and checks
 * every token name against `tokens.css` itself. The same shape as
 * `settings/swatches.test.ts`, which reads the stylesheet for the same reason:
 * two sources for one fact is the setup that drifts.
 *
 * It deliberately does NOT assert on colour VALUES. In jsdom there is no
 * stylesheet, so every token falls back to one grey - which `palette.ts`
 * documents as the correct way for a missing document to fail. Pinning hexes
 * here would only mean editing this file every time the owner retunes a road.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { namedFlavor } from '@protomaps/basemaps';
import { describe, expect, it } from 'vitest';

import {
  CARTO_ROLES,
  CARTO_TOKENS,
  cartoToken,
  flavorFor,
  isCustomFlavor,
  spriteFlavor,
} from './flavors.ts';
import type { CustomFlavorName, StockFlavorName } from './flavors.ts';

const CUSTOM: readonly CustomFlavorName[] = ['slate', 'refinement'];

function tokensCss(): string {
  const found = ['src/styles/tokens.css', 'apps/pwa/src/styles/tokens.css']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found, 'tokens.css not found').toBeDefined();
  return readFileSync(found as string, 'utf8');
}

describe('the colours the custom flavours are built from', () => {
  it('defines every token the two flavours ask for', () => {
    const css = tokensCss();
    const missing = CARTO_TOKENS.filter((token) => !css.includes(`${token}:`));
    expect(missing).toEqual([]);
  });

  it('gives both flavours the same set of roles, so neither is half-tuned', () => {
    expect(CARTO_TOKENS).toHaveLength(CARTO_ROLES.length * CUSTOM.length);
    expect(new Set(CARTO_TOKENS).size).toBe(CARTO_TOKENS.length);
  });

  it('binds each theme map water to its own flavour rather than repeating it', () => {
    // The seam this prevents: `styleFor` paints these UNDER the archive, so a
    // value that disagrees with the flavour's own shows as a band wherever a
    // tile has not landed yet.
    const css = tokensCss();
    for (const flavor of CUSTOM) {
      expect(css).toContain(`--fwm-map-water: var(${cartoToken(flavor, 'water')})`);
    }
  });

  it('binds each default skin to its own ground, and the rest to the shared one', () => {
    /*
     * THE LIGHT SKIN DRAWS THE LIGHT MAP - owner call, 2026-09-09: "the
     * Google Maps colors should be the defaults for light and dark mode".
     * Slate binds `--fwm-map-earth` to slate's earth and refinement to
     * refinement's, so the plate the app paints under the archive and the
     * cartography's own `earth` cannot disagree within a theme -- which is the
     * seam this test has always guarded. The 2026-09-08 call that put the
     * dark ground under both is withdrawn.
     *
     * `--fwm-map-earth-default` stays: it is what every theme WITHOUT a
     * cartography of its own inherits, and the indirection SETTINGS overrides.
     */
    const css = tokensCss();
    expect(css).toContain('--fwm-map-earth-default:');
    expect(css).toContain('--fwm-map-earth: var(--fwm-map-earth-default)');
    for (const flavor of CUSTOM) {
      expect(css).toContain(`${cartoToken(flavor, 'earth')}:`);
      expect(css).toContain(`--fwm-map-earth: var(${cartoToken(flavor, 'earth')})`);
    }
  });
});

describe('the shape of a custom flavour', () => {
  it('carries every key its upstream flavour carries', () => {
    // Derived from `dark` and `light` precisely so a key nobody has an opinion
    // about keeps a sane value instead of becoming undefined.
    for (const [name, base] of [
      ['slate', 'dark'],
      ['refinement', 'light'],
    ] as const) {
      const built = flavorFor(name);
      for (const key of Object.keys(namedFlavor(base))) {
        expect(built, `${name} is missing ${key}`).toHaveProperty(key);
      }
    }
  });

  it('leaves no key undefined', () => {
    for (const name of CUSTOM) {
      const built = flavorFor(name);
      const empty = Object.entries(built)
        .filter(([, value]) => value === undefined || value === '')
        .map(([key]) => key);
      expect(empty).toEqual([]);
    }
  });

  it('keeps landcover an object of kinds, because it is the ground past z7', () => {
    // `MIN_ZOOM` is 3 and landcover fades out between z5 and z7, so a driver
    // who pinches out to see the country is looking at this and nothing else.
    // Flattening it to a string would make `layers()` build a broken match.
    for (const name of CUSTOM) {
      const built = flavorFor(name);
      expect(built.landcover).toBeTypeOf('object');
      for (const kind of ['grassland', 'barren', 'urban_area', 'farmland', 'scrub', 'forest']) {
        expect(built.landcover).toHaveProperty(kind);
      }
    }
  });

  it('hands a stock flavour straight back from the package', () => {
    expect(flavorFor('white')).toEqual(namedFlavor('white'));
    expect(isCustomFlavor('white')).toBe(false);
    expect(isCustomFlavor('slate')).toBe(true);
  });
});

describe('which sprite sheet a flavour travels with', () => {
  it('gives the navy flavour a sheet whose shields are dark', () => {
    // `roads_label_major` paints the road name AND the number inside the
    // shield. On navy the road names must be light, so the shield artwork has
    // to be dark or the number vanishes into it.
    expect(spriteFlavor('slate')).toBe('black');
  });

  it('gives the near-white flavour a sheet whose shields are light', () => {
    expect(spriteFlavor('refinement')).toBe('light');
  });

  it('only ever names a sheet that exists on disk', () => {
    // The five stock names are the whole vendored matrix. A custom name
    // reaching `spritePath` would 404 the sprite, and MapLibre treats a failed
    // sprite as a failed style.
    const onDisk: readonly StockFlavorName[] = ['black', 'dark', 'grayscale', 'light', 'white'];
    for (const name of [...CUSTOM, ...onDisk]) {
      expect(onDisk).toContain(spriteFlavor(name));
    }
  });

  it('leaves every stock flavour on its own sheet', () => {
    for (const name of ['black', 'dark', 'grayscale', 'light', 'white'] as const) {
      expect(spriteFlavor(name)).toBe(name);
    }
  });
});
