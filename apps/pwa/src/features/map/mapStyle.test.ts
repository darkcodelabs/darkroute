/**
 * THE STYLE BUILDER THE TWO MAPS SHARE.
 *
 * These functions lived inside `MapCanvas` and had no tests, because a style is
 * only ever handed to a GPU. They are shared with the INTEL card's mini map
 * now, and "the two maps agree about the cartography" is a claim worth
 * checking: a driver who picked WHITE because the sun is on the screen picked
 * it for every map on the screen.
 */

import { describe, expect, it } from 'vitest';

import { LIGHT_MODE, SLATE_MODE, flavorForMode, withoutLabels } from './mapStyle.ts';

describe('which cartography a map draws', () => {
  it('draws the custom navy cartography on slate', () => {
    expect(flavorForMode(SLATE_MODE)).toBe('slate');
  });

  it('draws the custom near-white cartography on refinement', () => {
    // This used to resolve to the stock `light`. The owner's reference for
    // this skin is a near-white map with a green arterial network, and no
    // flavour in the package has any green in it.
    expect(flavorForMode(LIGHT_MODE)).toBe('refinement');
  });

  it('leaves every other theme on black', () => {
    expect(flavorForMode('night-watch')).toBe('black');
    expect(flavorForMode('ember')).toBe('black');
    expect(flavorForMode('paper')).toBe('black');
  });

  it('lands somewhere sane on a mode it has never heard of', () => {
    // `null` is what `currentMode()` returns before `applyMode` has written
    // the attribute, and a style with an undefined flavour throws while
    // parsing - which takes the sources down with it rather than showing a
    // wrong colour.
    expect(flavorForMode(null)).toBe('black');
    expect(flavorForMode('')).toBe('black');
    expect(flavorForMode('a-theme-that-was-never-shipped')).toBe('black');
  });

  it('lets the driver outrank the theme, because sun is not a palette', () => {
    // The reason to pick white is that the sun is on the screen, which has
    // nothing to do with which palette the chrome is wearing.
    expect(flavorForMode('night-watch', 'white')).toBe('white');
    expect(flavorForMode(LIGHT_MODE, 'black')).toBe('black');
  });

  it('lets the driver outrank the two themes that now have their own', () => {
    // The regression this guards: `slate` and `refinement` reaching their
    // custom flavour through a branch that runs BEFORE the view is consulted
    // would silently trap those two drivers on one cartography.
    expect(flavorForMode(SLATE_MODE, 'white')).toBe('white');
    expect(flavorForMode(SLATE_MODE, 'grayscale')).toBe('grayscale');
    expect(flavorForMode(LIGHT_MODE, 'white')).toBe('white');
  });

  it('keeps all five stock flavours reachable', () => {
    for (const view of ['black', 'dark', 'grayscale', 'light', 'white'] as const) {
      expect(flavorForMode(SLATE_MODE, view)).toBe(view);
    }
  });
});

describe('withoutLabels', () => {
  const style = {
    version: 8,
    sources: { basemap: { type: 'vector' } },
    layers: [
      { id: 'earth', type: 'fill' },
      { id: 'roads', type: 'line' },
      { id: 'roads_label', type: 'symbol' },
      { id: 'places', type: 'symbol' },
    ],
  };

  it('drops the writing and keeps the map', () => {
    const trimmed = withoutLabels(style) as { layers: { id: string }[] };
    expect(trimmed.layers.map((l) => l.id)).toEqual(['earth', 'roads']);
  });

  it('leaves everything else about the style alone', () => {
    // The sources, the sprite, the glyphs and the version all still have to be
    // the scope's, or the two maps stop being the same map.
    const trimmed = withoutLabels(style) as typeof style;
    expect(trimmed.sources).toEqual(style.sources);
    expect(trimmed.version).toBe(8);
  });

  it('does not mutate the style it was given', () => {
    withoutLabels(style);
    expect(style.layers).toHaveLength(4);
  });

  it('hands back anything that is not a style unchanged', () => {
    // `styleFor` is typed `unknown` because MapLibre's own style type is not
    // worth reproducing here. That means this can be handed a bare style with
    // no layers at all -- the no-archive case -- and must not throw on it.
    expect(withoutLabels(null)).toBeNull();
    expect(withoutLabels({ version: 8 })).toEqual({ version: 8 });
  });
});
