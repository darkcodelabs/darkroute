/**
 * HOW THIS APP BUILDS A MAPLIBRE MAP - the parts more than one map needs.
 *
 * =============================================================================
 * WHY THIS IS NOT INSIDE MapCanvas ANY MORE
 * =============================================================================
 * There is a second map now. The INTEL card draws a small, still picture of the
 * camera it is describing (`MiniMap.tsx`), and the two maps have to agree about
 * three things or the product contradicts itself:
 *
 *   THE CARTOGRAPHY.   A driver who picked WHITE because the sun is on the
 *                      screen picked it for every map on the screen. Two copies
 *                      of `flavorForMode` is how the card ends up black under a
 *                      white scope the first time one of them changes.
 *
 *   THE PROTOCOL.      `addProtocol('pmtiles', ...)` is global to MapLibre and
 *                      registering it twice REPLACES the live handler - see the
 *                      note on `ensurePmtilesProtocol`. A second map with its
 *                      own registration would silently stop the first map's
 *                      source from resolving.
 *
 *   THE STYLE.         One builder, so a fix to either map's ground is a fix to
 *                      both. The mini map draws the same OSM archive, from the
 *                      same origin, with the same sprite.
 *
 * Nothing here is new. It is `MapCanvas`'s own code, moved so the card can call
 * it rather than grow a parallel copy.
 */

import maplibregl from 'maplibre-gl';
import { layers, namedFlavor } from '@protomaps/basemaps';

import { bareStyle, osmStyle, spritePath } from './basemap.ts';
import type { Palette } from './palette.ts';

/** The five `@protomaps/basemaps` ships. */
export type FlavorName = 'black' | 'dark' | 'grayscale' | 'light' | 'white';

/**
 * Register the `pmtiles://` handler ONCE per application, not once per mount.
 *
 * Protomaps' own guidance is that `addProtocol` "works best if it is only
 * called once in the lifecycle of your application". The registration used to
 * live inside the build effect, which React runs twice on mount in strict mode
 * -- so a second `Protocol` instance replaced the first while a map built
 * against the first was still resolving its source, and the style never
 * finished loading. No error: a map that has simply stopped asking.
 *
 * The promise is memoised, so concurrent mounts await the same registration
 * rather than racing to redo it. That memo is doing a second job now: the INTEL
 * card's mini map opens while the scope behind it is live, and a card that
 * registered its own `Protocol` would take the scope's basemap down with it.
 */
let protocolReady: Promise<void> | null = null;

export function ensurePmtilesProtocol(): Promise<void> {
  protocolReady ??= import('pmtiles').then(({ Protocol }) => {
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
  });
  return protocolReady;
}

/**
 * WHICH PROTOMAPS FLAVOUR THIS MODE DRAWS ON.
 *
 * `refinement` is the one LIGHT theme in the set -- `--fwm-bg` is #EAF0EE
 * against #000000 everywhere else -- and it is documented in tokens.css as
 * deliberately contradicting the brief's "dark mode only". A light chrome over
 * a black map is the map ignoring the theme, which is what it did until now.
 *
 * The flavour, not just the ground colour, because BLACK's cartography is
 * tuned for a dark ground: `city_label` #999999, `roads_label_major` #5c5c5c,
 * `highway` #292929. On #EAF0EE every one of those is a low-contrast smear.
 * Overriding two ground keys makes a light rectangle; the labels stay unreadable.
 *
 * And the sprite has to travel with it -- the colours are baked into the
 * pixels, so black shields on a light ground are black artwork on a light
 * ground. See `spritePath`.
 */
export const LIGHT_MODE = 'refinement';

/**
 * The cartography to draw, from the driver's choice and the theme.
 *
 * `auto` is the old behaviour exactly: black everywhere, light on the one
 * light theme. Anything else is what the driver asked for, and it OUTRANKS the
 * theme on purpose - the reason to pick white is that the sun is on the screen,
 * and that has nothing to do with which palette the chrome is wearing.
 */
export function flavorForMode(
  mode: string | null,
  view: FlavorName | 'auto' = 'auto',
): FlavorName {
  if (view !== 'auto') return view;
  return mode === LIGHT_MODE ? 'light' : 'black';
}

/** What the DOM is actually painted as. `applyMode` is its only writer. */
export function currentMode(): string | null {
  return globalThis.document?.documentElement.getAttribute('data-fwm-mode') ?? null;
}

/**
 * THE WHOLE STYLE, for a palette and a mode.
 *
 * Built in one place because it is built several times -- when the scope is
 * created, whenever the mode changes, and once per INTEL card -- and the copies
 * diverging is how a light theme ends up with a dark map's shields.
 */
export function styleFor(
  url: string | null,
  palette: Palette,
  mode: string | null,
  view: FlavorName | 'auto' = 'auto',
): unknown {
  if (url === null) return bareStyle(palette);
  const flavor = flavorForMode(mode, view);
  return osmStyle(
    url,
    palette,
    layers(
      'basemap',
      {
        ...namedFlavor(flavor),
        background: palette['--fwm-map-earth'],
        earth: palette['--fwm-map-earth'],
        water: palette['--fwm-map-water'],
      },
      { lang: 'en' },
    ),
    spritePath(flavor),
  );
}

/**
 * THE SAME STYLE WITH THE WRITING TAKEN OUT, for a picture too small to read.
 *
 * A 112px thumbnail cannot show a street name: at that size a label is two or
 * three glyphs of noise across the road it is naming, and the reader already
 * has the street in words at the top of the card. So the symbol layers go --
 * and they are the expensive half of a Protomaps style, which is the real
 * reason this exists rather than a tidiness one.
 *
 * MEASURED, headless Chromium at 390x844 on software GL, twelve consecutive
 * card opens each way:
 *
 *   full style   ground painted 706 ms median, longest task inside an open 245 ms
 *   no labels    ground painted 569 ms median, longest task inside an open 134 ms
 *
 * A build with no archive at all costs 106 ms of that block, so dropping the
 * labels takes the map's own share of it from about 139 ms to about 28 ms. A
 * quarter-second main-thread freeze every time a driver taps a dot is the
 * "janks" this design was told not to ship. The saving is glyph fetches, label
 * collision and the symbol shaders, none of which draw anything legible at this
 * size.
 *
 * It is the SAME cartography either way -- same flavour, same colours, same
 * roads and water -- which is what keeps the card and the scope agreeing. The
 * precedent is `OMITTED_SOURCE_LAYERS` in `basemap.ts`, which drops buildings
 * and land use from the scope's style for exactly this kind of reason.
 */
export function withoutLabels(style: unknown): unknown {
  if (typeof style !== 'object' || style === null) return style;
  const source = style as { layers?: unknown };
  if (!Array.isArray(source.layers)) return style;
  return {
    ...source,
    layers: source.layers.filter((layer: unknown) => {
      if (typeof layer !== 'object' || layer === null) return true;
      return (layer as { type?: unknown }).type !== 'symbol';
    }),
  };
}
