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

import { LIGHT_MODE, flavorForMode, withoutLabels } from './mapStyle.ts';

describe('which cartography a map draws', () => {
  it('follows the theme when the driver has not chosen', () => {
    expect(flavorForMode(LIGHT_MODE)).toBe('light');
    expect(flavorForMode('night-watch')).toBe('black');
    expect(flavorForMode(null)).toBe('black');
  });

  it('lets the driver outrank the theme, because sun is not a palette', () => {
    // The reason to pick white is that the sun is on the screen, which has
    // nothing to do with which palette the chrome is wearing.
    expect(flavorForMode('night-watch', 'white')).toBe('white');
    expect(flavorForMode(LIGHT_MODE, 'black')).toBe('black');
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
