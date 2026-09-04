/**
 * THE BASEMAP - where the ground under the cameras comes from.
 *
 * =============================================================================
 * WHY THIS FILE IS MOSTLY ABOUT PRIVACY
 * =============================================================================
 * `sweep/geometry.ts` opens by explaining why this product had no map at all:
 *
 *   "A tile layer would also mean network requests keyed to the driver's
 *    position, which is the one thing the product promises not to do."
 *
 * That reasoning was right, and it is the reason the scope was a hand-drawn
 * polar dial for as long as it was. What it got wrong is treating "a map" and
 * "somebody else's tile server" as the same thing. They are not, but operating
 * the server ourselves does not make the request private:
 *
 *   A THIRD-PARTY TILE SERVER sees a stream of tile coordinates from a device.
 *   Tile coordinates ARE a position, at a resolution that improves as the
 *   driver zooms in, and the request carries an IP and a timestamp. That is a
 *   movement log held by a company the driver never chose, and it is exactly
 *   what this app exists to reduce. It is not acceptable in production, at any
 *   convenience.
 *
 *   TILES ON INFRASTRUCTURE WE OPERATE still reveal what was requested, plus an
 *   IP and a timestamp. The shipped PMTiles archives live at
 *   `tiles.darkroute.ai`, which is a DIFFERENT, unauthenticated origin from the
 *   app. The z14 speed lookup is derived directly from the current fix, so a
 *   request identifies roughly a 1.9 km square at a typical US latitude. The
 *   basemap ranges identify the viewport. `THREAT-MODEL.md` §5.3 states this
 *   accepted risk; there is no claim here that the edge keeps no logs.
 *
 * So the rule is: the basemap is PROJECT-HOSTED and disclosed, or there is no
 * basemap. That controls who receives the request. It does not erase it.
 *
 * =============================================================================
 * WHAT "NO BASEMAP" LOOKS LIKE, AND WHY IT REMAINS AVAILABLE
 * =============================================================================
 * MapLibre does not need a basemap to be useful here. A style with a painted
 * background and our own sources on top gives the whole reason for moving to
 * it -- GPU-rendered points, a real heatmap layer, clustering, label collision,
 * correct pinch anchoring, rotation -- with no external request whatsoever.
 *
 * That is what {@link bareStyle} is. An explicit empty
 * `VITE_FWM_BASEMAP_URL` selects it; otherwise the release uses the disclosed,
 * project-operated tile host below. Pointing {@link basemapUrl} at another
 * project-operated PMTiles archive changes the ground; nothing else changes.
 */

import { readPalette } from './palette.ts';
import type { Palette } from './palette.ts';

/**
 * Where a self-hosted vector basemap lives, or null for none.
 *
 * Read from the build env rather than hard-coded so the same bundle can be
 * built against a local archive, an R2 bucket, or nothing at all.
 *
 * MUST be an origin we control. The current R2-backed host is cross-origin and
 * public: one file, HTTP range requests, no per-tile path on somebody else's
 * server, but still a request that reveals a viewport. See the header and
 * `THREAT-MODEL.md` §5.3 for the boundary this actually provides.
 */
/*
 * THE FALLBACK MUST NOT BE THE CONUS-CLIPPED ARCHIVE.
 *
 * `manifest.ts` is authoritative - it reads `basemap.json`, range-checks that
 * the archive it names really exists, and only then uses it - so this constant
 * is reached exactly when the manifest CANNOT be fetched. That is a dead spot,
 * a captive portal, a first run offline.
 *
 * Left at `basemap-us-20260820` it made that path quietly worse than a failure:
 * that archive was clipped to a CONUS bounding box, so a driver in Honolulu,
 * Anchorage, San Juan or the Aleutians got a map with no ground under them at
 * all while the app reported itself working. Measured on both archives, z14
 * tiles: Honolulu 20,770 B vs 0, Anchorage 3,592 B vs 0, San Juan 10,314 B vs
 * 0, Adak 1,276 B vs 0, with Wichita byte-identical at 16,209 B.
 *
 * The nationwide archive is immutable and published, so pointing the fallback
 * at it costs nothing and closes that hole.
 */
export const DEFAULT_BASEMAP_URL =
  'https://tiles.darkroute.ai/basemap-us-20260901-full-us.pmtiles';

/**
 * The speeds archive: drivable ways that actually carry an OSM `maxspeed`.
 *
 * A SECOND archive because no tile schema ships speed data -- verified against
 * this basemap's own roads layer and against Shortbread, OpenMapTiles and
 * VersaTiles. It holds one attribute and nothing else, which is why the whole
 * country fits in 126 MB.
 *
 * NOT a map source. It is z14-only, and MapLibre cannot underzoom a source, so
 * declaring it here meant the map never fetched a tile at RADAR's usual zoom.
 * `speedSource.ts` reads the single tile under the driver directly instead.
 */
export const DEFAULT_SPEEDS_URL = 'https://tiles.darkroute.ai/speeds-us-20260820.pmtiles';

export function basemapUrl(env: Readonly<Record<string, string | undefined>>): string | null {
  const raw = env['VITE_FWM_BASEMAP_URL'];
  if (typeof raw === 'string') {
    const url = raw.trim();
    // An explicit empty value is how a build says "no ground at all" -- useful
    // for a test build, and it must not fall through to the default.
    return url === '' ? null : url;
  }
  return DEFAULT_BASEMAP_URL;
}

/** True when the URL is a PMTiles archive, which needs the protocol handler. */
export function isPmtiles(url: string): boolean {
  return url.endsWith('.pmtiles') || url.startsWith('pmtiles://');
}

/**
 * A style with no ground in it: a painted background and nothing else.
 *
 * Every layer the app draws is added on top of this at runtime. Deliberately
 * NOT empty -- an empty style leaves the canvas transparent and the page shows
 * through, which reads as a failed load rather than as a deliberate absence.
 */
/**
 * The style with real ground under it: OSM, from infrastructure we operate.
 *
 * =============================================================================
 * WHY THIS IS OSM AND NOT THE ROAD TILES WE ALREADY HAD
 * =============================================================================
 * The scope drew roads from TIGER/Line, which is public-domain and complete for
 * highways and utterly empty below them: PRISECROADS is primary and secondary
 * roads only, so at street zoom the map was a black field with one arterial
 * across it. Local streets are not "missing detail" in TIGER, they are simply
 * not in the file.
 *
 * OSM has them, and it has the water, the land use and the labels as well --
 * and it is the same dataset the cameras come from, so a camera and the road it
 * stands on are finally drawn from one source rather than two that disagree.
 *
 * =============================================================================
 * AND WHY IT IS A SINGLE FILE ON INFRASTRUCTURE WE OPERATE
 * =============================================================================
 * PMTiles is one archive read by HTTP range request. There is no per-tile path
 * on somebody else's server, and the host is operated by this project. It is
 * still cross-origin and unauthenticated, unlike the same-origin camera path;
 * the header states what those range requests disclose.
 */
/**
 * The layers the archive does NOT contain, and the style must therefore not ask for.
 *
 * The shipped archive is built with `tile-join --exclude-layer` for buildings,
 * POIs and land use: a driving instrument paints roads and water on black, and
 * measuring the real archive (11,277 tiles sampled evenly across 4.5 million)
 * put land use at 33% of its bytes and buildings at 10.7% for ground texture
 * this design never draws.
 *
 * MapLibre tolerates a layer pointing at an absent source-layer by drawing
 * nothing, so leaving them in would work -- and would mean shipping a style
 * that describes a map we do not have, and paying to evaluate those layers on
 * every frame. Dropping them keeps the style honest about the data behind it.
 *
 * `pois` USED TO BE LISTED HERE AND WAS DEAD WEIGHT. The black flavour draws
 * boundaries, buildings, earth, landuse, places, roads and water -- no `pois`
 * layer exists in it to filter, so the entry matched nothing and quietly
 * implied a saving that was not being made. The archive is still built without
 * that layer; this list is only about what the STYLE asks for.
 */
export const OMITTED_SOURCE_LAYERS: readonly string[] = ['buildings', 'landuse'];

/**
 * Where the glyphs and sprites live: OUR origin, always.
 *
 * These pointed at protomaps.github.io, defended in a comment as "static
 * assets, not a tile service keyed to a position". True, and beside the point --
 * it is still a request from the driver's device to a third party carrying
 * their IP and a timestamp, from a screen whose whole premise is that nobody is
 * told where they are. It also meant NO STREET NAMES OFFLINE, in the tunnels
 * and dead zones where knowing your road matters most.
 *
 * `scripts/vendor-basemap-assets.mjs` puts them here, pinned to a commit.
 */
export const GLYPHS_PATH = '/basemap-assets/fonts/{fontstack}/{range}.pbf';
/**
 * THE SPRITE SHEET, PER FLAVOUR.
 *
 * Sprite colour is baked into the pixels -- no entry carries an `sdf` flag, and
 * `icon-color` only applies to SDF icons -- so a light basemap cannot reuse the
 * black sheet's shields, arrows and place dots. They would be black artwork on
 * a light ground.
 *
 * `scripts/vendor-basemap-assets.mjs` ships every selectable flavour at both
 * pixel densities, pinned to the same commit, and
 * `scripts/check-basemap-assets.mjs` checks the complete matrix is present.
 */
export function spritePath(flavor: string): string {
  return `/basemap-assets/sprites/${flavor}`;
}

/** The default sheet. Every mode but `refinement` draws on a dark ground. */
export const SPRITE_PATH = spritePath('black');

/**
 * Asset URLs, made ABSOLUTE against the current origin.
 *
 * MapLibre 6 rejects a relative sprite outright -- "Invalid sprite URL ...,
 * must be absolute" -- and because that throws while the style is being parsed
 * it takes the WHOLE STYLE down with it: no sources, no tiles, no error the
 * user sees. MapLibre 5 accepted the relative form, so this appears only on
 * upgrade, and it appears as a map that quietly stops asking for tiles.
 *
 * Resolved at call time rather than at module load so the same bundle works
 * from any origin, and falls back to the relative path where there is no
 * `location` at all (jsdom, node) rather than inventing a host.
 */
export function assetUrl(path: string): string {
  try {
    const origin = globalThis.location?.origin;
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      return `${origin}${path}`;
    }
  } catch {
    // No DOM. Fall through.
  }
  return path;
}

/**
 * The full style: our archive, our assets, Protomaps' cartography.
 *
 * `theme` is the layer array from `@protomaps/basemaps`. It is passed in rather
 * than imported here so this module stays free of the style package and can be
 * unit-tested without it.
 *
 * NOTE ON THE PACKAGE: this used `protomaps-themes-base`, which npm has
 * formally deprecated in favour of `@protomaps/basemaps`. Staying on the dead
 * package cost us oneway arrows and US interstate shields -- the two most
 * driving-relevant pieces of cartography in the whole style.
 */
export function osmStyle(
  url: string,
  palette: Palette,
  theme: unknown,
  sprite: string = SPRITE_PATH,
): unknown {
  const themeLayers = Array.isArray(theme) ? theme : [];
  return {
    version: 8,
    glyphs: assetUrl(GLYPHS_PATH),
    sprite: assetUrl(sprite),
    sources: {
      basemap: {
        type: 'vector',
        url: `pmtiles://${url}`,
        // ODbL. The camera table and these tiles are both OSM-derived, and the
        // attribution is not decoration -- it is a licence condition.
        attribution: '© OpenStreetMap contributors · Protomaps',
      },
    },
    layers: [
      // The ground. Painted rather than left transparent, so a slow archive
      // shows the app's own black instead of the page behind the canvas.
      {
        id: 'fwm-background',
        type: 'background',
        paint: { 'background-color': palette['--fwm-bg'] },
      },
      ...themeLayers.filter((layer: unknown) => {
        if (typeof layer !== 'object' || layer === null) return false;
        const sourceLayer = (layer as { 'source-layer'?: unknown })['source-layer'];
        return (
          typeof sourceLayer !== 'string' || !OMITTED_SOURCE_LAYERS.includes(sourceLayer)
        );
      }),
    ],
  };
}

export function bareStyle(palette: Palette = readPalette()): unknown {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'fwm-background',
        type: 'background',
        paint: { 'background-color': palette['--fwm-bg'] },
      },
    ],
  };
}
