/**
 * THE CURRENT MAP, for the few things outside the map that need to ask it something.
 *
 * =============================================================================
 * WHY A REGISTRY AND NOT A GLOBAL
 * =============================================================================
 * `MapCanvas` already parks the instance on `globalThis.__fwmMapInstance`, and
 * that is deliberately a DEBUG handle: it exists so a headless preflight can
 * interrogate a WebGL context it cannot screenshot. Reading it from application
 * code would make a test affordance load-bearing, and the first person to delete
 * it for being test-only would break a feature.
 *
 * This is the supported way to ask. It is a module-scoped variable rather than
 * a React context because the asker is not always in the tree beneath the map --
 * the Intel card is a separate screen, and threading a ref through every screen
 * that might one day want to know what road a point is on would be a worse
 * trade than one registry with a narrow surface.
 *
 * =============================================================================
 * IT IS ALLOWED TO BE EMPTY
 * =============================================================================
 * There is no map when the dial is rendering, before the archive resolves, or
 * in any unit test. Every caller must handle null, and the things that use this
 * are enrichments -- a street name the card can do without -- never anything
 * the product depends on.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

/** Only what askers actually need, so a test can pass a plain object. */
/**
 * What the rest of the app may ask of the map.
 *
 * `querySourceFeatures` was the whole surface, which was right while the only
 * caller was a probe. DEMO MODE needs to drive the camera the way a thumb
 * does - so it can show a zoom rather than describe one - and doing that
 * through the real instance is the difference between demonstrating the map
 * and animating a picture of it.
 *
 * Deliberately still a `Pick`. The map is not a global to reach into; this
 * names exactly what may be asked, and adding to it should feel like a
 * decision.
 */
export type QueryableMap = Pick<
  MapLibreMap,
  'querySourceFeatures' | 'easeTo' | 'getZoom' | 'getCenter'
>;

let current: QueryableMap | null = null;

/** Called by `MapCanvas` on build, and with null on teardown. */
export function setCurrentMap(map: QueryableMap | null): void {
  current = map;
}

/** The live map, or null. Callers MUST handle null -- see the header. */
export function currentMap(): QueryableMap | null {
  return current;
}

/**
 * WHICH ARCHIVE THE SCOPE ACTUALLY RESOLVED, for the second map.
 *
 * `manifest.ts` explains at length why the archive is never a fixed filename:
 * a client holding cached byte offsets into a rebuilt file reads garbage, so
 * resolution goes through a manifest and a range probe. That is a network
 * negotiation, and it must happen ONCE per session.
 *
 * The INTEL card's mini map draws the same ground as the scope behind it. If it
 * resolved its own archive it would repeat that negotiation every time a driver
 * taps a dot, and - because the manifest can change between calls - could end
 * up drawing a different archive from the one the scope is on. So the scope
 * publishes what it resolved and the card reads it.
 *
 * Null means the scope has not built yet, which is a real state: the card is
 * reachable by deep link with no map ever mounted. The card falls back to the
 * archive this device last used, and never starts a resolution of its own.
 */
let archive: string | null = null;

/** Called by `MapCanvas` once resolution finishes, with what it will build on. */
export function setResolvedArchive(url: string | null): void {
  archive = url;
}

/** The archive the scope is reading, or null if no scope has built. */
export function resolvedArchive(): string | null {
  return archive;
}
