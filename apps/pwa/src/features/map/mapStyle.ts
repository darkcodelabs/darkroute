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

import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { layers } from '@protomaps/basemaps';

/**
 * TELL MAPLIBRE 6 WHERE ITS WORKER IS, BECAUSE IT CANNOT FIND IT ITSELF.
 *
 * =============================================================================
 * THIS IS THE BUG THAT KEPT THIS APP ON MAPLIBRE 5
 * =============================================================================
 * The note this replaces said 6.x read the archive header and then made NOT ONE
 * tile request, with no error on the map, the console or any request, and that
 * it stayed pinned "until that interop is understood". It is understood now.
 *
 * MapLibre 5 inlined its web worker into the main bundle and started it from a
 * blob URL, so a bundler had nothing to do. MapLibre 6 ships the worker as a
 * SEPARATE file and resolves it at run time:
 *
 *     new URL(`./maplibre-gl-worker.mjs`, import.meta.url)      web_worker.ts
 *
 * The name is computed, not a literal, so no bundler can see it. Vite therefore
 * never emits `maplibre-gl-worker.mjs`, and after bundling `import.meta.url` is
 * our own chunk -- so the map asks for `/assets/maplibre-gl-worker.mjs`, the SPA
 * fallback answers with `index.html`, and the module worker dies parsing it.
 *
 * Nothing reports that. The dead worker still accepts messages: measured, the
 * map posted eleven `loadTile` messages and received zero replies, every tile
 * sat in `state: "loading"` for ever, `isStyleLoaded()` stayed false, and the
 * only trace anywhere was one empty `error` event on the Worker object.
 *
 * `?worker&url` is the bundler's half: it compiles the worker as its own entry
 * -- which is what resolves the `./maplibre-gl-shared.mjs` sibling it imports --
 * and hands back the emitted URL. `setWorkerUrl` is MapLibre's own public
 * override, checked before the guess above, and it is set HERE, at module
 * scope, because both maps import this file and it has to be set before either
 * of them constructs a Map.
 *
 * IT COSTS 514 KiB. The worker entry carries its own copy of MapLibre's shared
 * chunk, which is already inlined in the map chunk, and there is no bundler
 * setting that lets one worker and one window share a module graph. Precache
 * went from 47 entries / 5,090 KiB to 48 / 5,605 KiB. It is not on the critical
 * path -- `LazyMapCanvas` keeps the whole map behind a dynamic import -- and it
 * cannot be excluded from the precache either, because a worker fetched from
 * the network is a map that does not draw in the dead zone this app is for.
 *
 * `scripts/check-map-render.mjs` is what proves it: 0 road features before this
 * line, 978 decoded and 866 painted after it -- the same numbers 5.6.1 gives.
 */
maplibregl.setWorkerUrl(maplibreWorkerUrl);

import { bareStyle, osmStyle, spritePath } from './basemap.ts';
import { flavorFor, spriteFlavor } from './flavors.ts';
import type { Palette } from './palette.ts';

export type { CustomFlavorName, FlavorName, StockFlavorName } from './flavors.ts';
import type { FlavorName, StockFlavorName } from './flavors.ts';

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
 * BUILD A MAP, OR THROW THE WAY MAPLIBRE 5 THREW.
 *
 * Both maps are written against a constructor that fails loudly: MiniMap wraps
 * `new Map()` in a try/catch and falls back to its bare state, which is the
 * caption a driver gets in a dead zone or in a browser with no WebGL at all.
 *
 * MapLibre 5 honoured that. `_setupPainter` threw `Failed to initialize WebGL`
 * when `getContext('webgl2')` came back null, from inside the constructor, so
 * there was no instance to mishandle.
 *
 * MapLibre 6 does not throw. It fires an `error` event carrying a
 * `GPUInitializationError` -- synchronously, from inside the constructor, so
 * BEFORE any caller can have attached a listener -- and then bails out at
 * `if (!this.painter) return;`, handing back a Map with no painter, no
 * handlers and no style. Two things break on that shell:
 *
 *   THE CATCH NEVER RUNS.  Measured in jsdom: the mini map's caption stayed on
 *                          `pending` for ever instead of settling to "no map
 *                          cached here". A spinner that never resolves is the
 *                          one thing that caption exists to prevent.
 *
 *   `remove()` THROWS.     `Cannot read properties of undefined (reading
 *                          'destroy')` at `this.painter.destroy()`, so the
 *                          unmount cleanup dies before it releases anything --
 *                          in a card that is opened and closed all drive.
 *
 * `painter` is a public field on MapLibre's own class and it is exactly what
 * its constructor tests, so reading it back is the honest replacement for the
 * throw: it covers every reason a context can fail, not the ones a capability
 * probe would think to guess at. Restoring the throw here rather than teaching
 * each call site about painters keeps that knowledge in one place, and leaves
 * both maps' existing failure handling correct as written.
 */
export function createMap(options: maplibregl.MapOptions): maplibregl.Map {
  const instance = new maplibregl.Map(options);
  // Declared non-optional by MapLibre and left unset by that early return, so
  // it is read through a nullable binding rather than taken on trust.
  const painter: maplibregl.Painter | undefined = instance.painter;
  if (painter === undefined) {
    // NOT `instance.remove()` -- that is the call that throws. The shell holds
    // no GPU resources to release; what it does keep is one entry in
    // MapLibre's module-level image-request throttle list, which has no public
    // release path other than the `remove()` that cannot run.
    throw new Error('maplibre: no WebGL2 context, the map has no renderer');
  }
  return instance;
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
 * The other theme with a cartography of its own.
 *
 * Same argument as `LIGHT_MODE`, one step further in. `slate` was already a
 * cool dark theme drawing on BLACK, which is not wrong so much as generic: the
 * owner's reference for it is a deep navy map with a green road network, and
 * no flavour in the package is that. See `features/map/flavors.ts`.
 */
export const SLATE_MODE = 'slate';

/**
 * The cartography to draw, from the driver's choice and the theme.
 *
 * `auto` follows the theme, and two of the themes now have a cartography built
 * for them by name. Everything else still lands on BLACK, which is the answer
 * for the other five v1 palettes and for any mode string this function has
 * never heard of -- including `null`, which is what `currentMode()` returns
 * before `applyMode` has written the attribute. A flavour is the one thing on
 * a map that cannot be absent: `namedFlavor(undefined)` throws, and a style
 * that throws while parsing takes every source down with it.
 *
 * Anything but `auto` is what the driver asked for, and it OUTRANKS the theme
 * on purpose - the reason to pick white is that the sun is on the screen, and
 * that has nothing to do with which palette the chrome is wearing. The
 * parameter is deliberately typed to the FIVE STOCK names rather than to all
 * seven: `FWM_MAP_VIEWS` is what the control can produce, and widening this to
 * `FlavorName` would claim the app can hand over a `slate` it has no way to
 * pick.
 */
export function flavorForMode(
  mode: string | null,
  view: StockFlavorName | 'auto' = 'auto',
): FlavorName {
  if (view !== 'auto') return view;
  if (mode === SLATE_MODE) return 'slate';
  if (mode === LIGHT_MODE) return 'refinement';
  return 'black';
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
  view: StockFlavorName | 'auto' = 'auto',
): unknown {
  if (url === null) return bareStyle(palette);
  const flavor = flavorForMode(mode, view);
  return osmStyle(
    url,
    palette,
    layers(
      'basemap',
      {
        // `flavorFor` reads the custom flavours' colours off the document, the
        // same trick `readPalette` uses and for the same reason: a WebGL
        // shader cannot resolve `var()`.
        ...flavorFor(flavor),
        // THE GROUND STAYS THE PALETTE'S. For slate and refinement these are
        // bound to the flavour's own `earth`/`water` in tokens.css, so this
        // overwrites each with itself. For the five stock flavours it is the
        // pre-existing behaviour, untouched: the mode tints the ground and the
        // flavour supplies the cartography over it.
        background: palette['--fwm-map-earth'],
        earth: palette['--fwm-map-earth'],
        water: palette['--fwm-map-water'],
      },
      { lang: 'en' },
    ),
    // NOT `spritePath(flavor)`. Only the five stock names have a sheet on
    // disk; `spriteFlavor` maps the two custom ones onto the sheet whose
    // shields their `roads_label_major` can actually be read against.
    spritePath(spriteFlavor(flavor)),
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
