/**
 * THE MAP - MapLibre, doing the things the hand-built scope did badly.
 *
 * =============================================================================
 * WHAT THIS COMPONENT OWNS, AND WHAT IT DELIBERATELY DOES NOT
 * =============================================================================
 * It owns the map: the canvas, the sources, the layers, the camera position.
 * It owns NOTHING about alerts, corridors, thresholds or state hues -- those
 * stay where they are and are drawn over the top, because they are the product
 * and this is a renderer.
 *
 * Gestures are MapLibre's. That is most of the point: pinch anchors on the
 * fingers, drag is drag, rotation and inertia come free, and none of it is a
 * hand-written pointer handler with its own bugs. The previous scope needed
 * `panForZoom`, `frameHalfSpan`, `panFromDrag`, a pointer-capture state machine
 * and a `getScreenCTM` conversion to get most of the way there.
 *
 * =============================================================================
 * HEADING-UP IS ONE CALL, AND IT KEEPS ITS RULE
 * =============================================================================
 * `map.setBearing()` replaces rotating every coordinate by hand. What does NOT
 * come for free is knowing WHEN to rotate, and that rule was hard-won: a GPS
 * course is noise at a standstill, so a scope that follows it spins on the spot
 * at every red light. `radar/orientation.ts` still decides; this only applies
 * what it decides.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
// NAMESPACE IMPORT, not default. MapLibre 6 is ESM-only and publishes named
// exports with no default -- `import maplibregl from 'maplibre-gl'` type-checks
// as `any` under some interop settings and fails outright under others.
/**
 * PINNED TO MAPLIBRE 5.
 *
 * NOT out of caution about WebGL2 -- that was a hypothetical, and checking it
 * showed this app already requires service workers, WebGL and DeviceOrientation,
 * so a device without WebGL2 cannot run it anyway. The real reason is measured:
 * on 6.5.0 the PMTiles vector source never finishes loading. The style reports
 * `isStyleLoaded() === false` indefinitely, the source stays `loaded: false`,
 * and after the archive header is read NOT ONE tile request is made. No error is
 * raised on the map, the console, or any request. Same archive, same style, same
 * pmtiles 4.5.0: on 5.6.1 it loads 90 road features and paints 68.
 *
 * So this stays until that interop is understood. `scripts/check-map-render.mjs`
 * is the test that catches it -- 6.x will pass typecheck, pass all 2,300 unit
 * tests, and build cleanly while drawing nothing.
 */
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
// IMPORTED, not global. @types/geojson exposes these as module exports; relying
// on an ambient `GeoJSON` namespace worked only while the package happened to
// be hoisted somewhere tsc looked, and adding an unrelated dependency moved it.
import type { FeatureCollection, Point } from 'geojson';

import 'maplibre-gl/dist/maplibre-gl.css';

import { basemapUrl, isPmtiles } from './basemap.ts';
import { resolveArchiveUrl } from './manifest.ts';
import { setCurrentMap, setResolvedArchive } from './mapRegistry.ts';
import { whenStyleReady } from './mapStyleReady.ts';
// THE STYLE, THE FLAVOUR AND THE PROTOCOL ARE SHARED WITH THE INTEL CARD'S
// MINI MAP. They used to live in this file; see `mapStyle.ts` for what a
// second copy of any of the three would have broken.
import {
  currentMode,
  ensurePmtilesProtocol,
  flavorForMode,
  styleFor,
} from './mapStyle.ts';
import type { FlavorName } from './mapStyle.ts';
import {
  CAMERA_LAYER,
  clusterCountLayer,
  hitLayer,
  CAMERA_SOURCE,
  CLUSTER_COUNT_LAYER,
  CLUSTER_LAYER,
  HEAT_LAYER,
  HIT_LAYER,
  THRESHOLD_LAYER,
  THRESHOLD_SOURCE,
  cameraLayer,
  clusterLayer,
  heatLayer,
  thresholdLayer,
  thresholdRing,
  POINT_MIN_ZOOM,
  toFeatureCollection,
} from './layers.ts';
import type { CameraFeatureInput } from './layers.ts';
import { readPalette } from './palette.ts';
import type { MapToken, Palette } from './palette.ts';
import { MAX_ZOOM, MIN_ZOOM, isZoomCommand } from './zoom.ts';
import { cameraOverview } from '../../services/cameras/overview.ts';
import { coverRangeFt, syncCamerasAt } from '../../services/cameras/syncInstance.ts';
import { decideViewportSync, viewportRangeFt } from './viewportSync.ts';
import { maxTiltDeg } from '../../app/mapTilt.ts';
import { startPixelSweep } from './pixelSweep.ts';
import './map.css';

/**
 * How close the map sits to the ground, as a MapLibre zoom.
 *
 * The old scope's range ladder was in FEET because it drew its own rings. A
 * slippy map's scale is its zoom, and converting between the two on every
 * change would keep two sources of truth for one number. RADAR passes a zoom.
 */
export const DEFAULT_ZOOM = 14;

/** A useful first frame while location is absent or refused: the contiguous US. */
export const NO_FIX_CENTER = Object.freeze([-98.5795, 39.8283] as [number, number]);
export const NO_FIX_ZOOM = 4;

export interface InitialMapViewport {
  readonly center: [number, number];
  readonly zoom: number;
  readonly hasFix: boolean;
}

/** Keep the no-permission frame out of Null Island and at a country-wide scale. */
export function initialMapViewport(
  lat: number | null,
  lon: number | null,
  requestedZoom: number,
): InitialMapViewport {
  const hasFix = lat !== null && lon !== null;
  return {
    center: hasFix ? [lon, lat] : [...NO_FIX_CENTER],
    zoom: hasFix ? requestedZoom : NO_FIX_ZOOM,
    hasFix,
  };
}

export interface MapCanvasProps {
  /** The vehicle, or null before the first fix. */
  readonly lat: number | null;
  readonly lon: number | null;
  /** Degrees to rotate the map to, or null for north-up. */
  readonly bearingDeg: number | null;
  readonly cameras: readonly CameraFeatureInput[];
  readonly zoom?: number | undefined;
  /** True while the driver has dragged away; suppresses following the vehicle. */
  readonly panned?: boolean | undefined;
  readonly onSelectCamera?: ((cameraId: string) => void) | undefined;
  /** Fired when the driver moves the map themselves, so RADAR can show RECENTER. */
  readonly onUserMoved?: (() => void) | undefined;
  /**
   * The driver changed the zoom with their fingers.
   *
   * The map becomes the authority on zoom the moment it is pinched, and this is
   * how the rest of the app finds out -- so the range readout says what the map
   * is actually showing rather than what it was last told to show.
   */
  readonly onZoomChanged?: ((zoom: number) => void) | undefined;
  /**
   * The rails, as MapLibre zooms.
   *
   * These exist so a pinch that runs past the app's range limits STOPS rather
   * than being clamped and yanked back. Same reason a real dial has an end
   * stop: hitting a limit should feel like a limit, not like the instrument
   * disagreeing with you.
   */
  readonly minZoom?: number | undefined;
  readonly maxZoom?: number | undefined;
  /**
   * How far the camera is tilted off vertical, in degrees.
   *
   * 0 is the top-down map this has always drawn. Anything above it looks along
   * the road instead of down at it -- see `app/mapTilt.ts` for why that is two
   * named angles on a button rather than MapLibre's own pitch gesture, which
   * stays off.
   */
  readonly pitchDeg?: number | undefined;
  /**
   * Merge nearby cameras into counted clusters.
   *
   * Off means every camera is its own marker. That is unusable over a country
   * and exactly what some drivers want over a neighbourhood, which is why it is
   * a preference rather than a zoom rule.
   */
  readonly cluster?: boolean | undefined;
  /**
   * The driver's alert threshold in feet, drawn as a ring about the vehicle.
   *
   * Undefined draws nothing, which is what a surface that is not RADAR wants.
   * The sweep dial has always drawn this; the map that replaced the dial did
   * not, so switching to the map lost the only picture of the setting there
   * was. See `thresholdRing`.
   */
  readonly thresholdFt?: number | undefined;
  /** Turn the map to face the direction of travel. Default is north up. */
  readonly headingUp?: boolean | undefined;
  /**
   * Cameras that get a DISTANCE PRINTED beside their dot.
   *
   * v1's DRIVE draws the two nearest with their distance under them and leaves
   * the rest as plain dots, which is the difference between a map with pins on
   * it and a map that answers "how far". The caller decides which - this only
   * draws what it is handed, and an empty list draws nothing.
   *
   * DOM markers rather than a symbol layer, for the same three reasons the
   * vehicle is one: there are one or two of them, they must sit above every
   * camera layer including the clusters, and each carries its own glass chip
   * that the token system already knows how to paint.
   */
  readonly labelled?: readonly CameraLabelInput[] | undefined;
  /**
   * Which basemap cartography to draw. `auto` follows the theme, which is what
   * this component did before the prop existed. See `app/mapView.ts`.
   */
  readonly mapView?: FlavorName | 'auto' | undefined;
}

/** Shared and frozen: a screen that labels nothing allocates nothing. */
const EMPTY_LABELS: readonly CameraLabelInput[] = Object.freeze([]);

/** One camera with its distance printed beside it. See `labelled`. */
export interface CameraLabelInput {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  /** `0.4`. Already formatted - the map does not know about units. */
  readonly label: string;
  /** Decides the hue, using the same words the alert engine does. */
  readonly state: 'in-range' | 'approaching' | 'clear';
}

/**
 * Diagnostics on the container, for measuring the map from outside it.
 *
 * The map's state lives inside a WebGL context that a test harness cannot
 * reach: "is it drawing anything" is not answerable from the DOM, and a
 * screenshot of an empty map and a screenshot of a broken one are the same
 * black rectangle. These attributes are how a preflight tells them apart.
 */
function publish(instance: MapLibreMap, element: HTMLElement, count: number): void {
  /**
   * ONE ATTRIBUTE, WRITTEN ONCE.
   *
   * This was a run of `setAttribute` calls and it made the diagnostics lie: a
   * throw part-way through left some attributes from this call and the rest
   * from an earlier one, so the reading was a mixture of two moments in time
   * that never both existed. Half-written diagnostics are worse than none --
   * they send you looking for a bug in whatever the stale half describes.
   *
   * Everything is computed first, into a plain object, and written in a single
   * assignment. Any failure is captured as a value rather than escaping.
   */
  const state: Record<string, unknown> = { cameras: count };

  try {
    state['zoom'] = Number(instance.getZoom().toFixed(2));
    const centre = instance.getCenter();
    state['centre'] = `${centre.lat.toFixed(4)},${centre.lng.toFixed(4)}`;
  } catch (cause) {
    state['centreError'] = String(cause).slice(0, 80);
  }

  /**
   * WHAT IS NOT HERE ANY MORE, AND WHY.
   *
   * This also ran `querySourceFeatures`, `queryRenderedFeatures` over both
   * camera layers, and `getStyle().layers.map(...)` -- three whole-viewport
   * queries plus a style walk, on a driver's phone, so that a harness could
   * read them off an attribute. It runs from five places (the first fix, map
   * load, `moveend`, `idle` and the camera effect), which on DRIVE is three or
   * four times per GPS fix, forever, for nobody.
   *
   * The preflight never needed them. `scripts/check-map-render.mjs` computes
   * all three ITSELF off `globalThis.__fwmMapInstance`, which is exposed
   * unconditionally a few hundred lines below -- it calls the same three APIs
   * directly. Publishing them here was a second implementation of a measurement
   * the measuring tool already takes.
   *
   * What stays is what is free: a count the caller already has, and two
   * getters that read numbers off the camera object.
   */
  element.setAttribute('data-fwm-map', JSON.stringify(state));
}

/**
 * THE NATIONAL SET, fetched once and only when it is needed.
 *
 * Camera tiles are loaded around the vehicle, which is right for driving and
 * useless for looking at the country: zoomed out, the map showed one cluster
 * over wherever the driver happened to be. This is every camera as a flat
 * coordinate array -- 0.83 MB gzipped for 131,000 of them -- swapped in when
 * the view is wider than individual markers can serve.
 *
 * Memoised, so panning across the threshold does not refetch, and it is never
 * requested at all by a driver who only ever looks at the road ahead.
 *
 * THE FETCH ITSELF IS NOT HERE. `services/cameras/overview.ts` owns it, bound
 * to the same generation as the warning tiles, because a screen must never
 * draw one snapshot's dots over another snapshot's alerts. What is memoised
 * here is the GeoJSON BUILD -- turning 260,000 numbers into features is
 * expensive and belongs to whichever generation produced them, so the memo is
 * keyed by generation and dropped with it.
 */
let overviewFeatures: { readonly generation: string; readonly data: unknown } | null = null;

/**
 * THE BASEMAP LAYERS WHOSE COLOUR THIS APP OWNS, and the token behind each.
 *
 * `osmStyle` sets these once by overriding three keys on the Protomaps flavour.
 * A mode change has to reach the same layers on a style that is already built,
 * and MapLibre has no "re-apply the flavour" call -- so the mapping is written
 * down here rather than inferred by matching against the old colour, which
 * would break the first time two layers shared a value.
 *
 * Enumerated from the running style, not from the package: `water` is a fill
 * and `water_stream` / `water_river` are lines, so the paint property differs
 * per layer and a single loop over "water*" would silently miss two of them.
 */
const GROUND_LAYERS: readonly {
  readonly id: string;
  readonly property: string;
  readonly token: MapToken;
}[] = [
  { id: 'background', property: 'background-color', token: '--fwm-map-earth' },
  { id: 'earth', property: 'fill-color', token: '--fwm-map-earth' },
  { id: 'water', property: 'fill-color', token: '--fwm-map-water' },
  { id: 'water_stream', property: 'line-color', token: '--fwm-map-water' },
  { id: 'water_river', property: 'line-color', token: '--fwm-map-water' },
];

async function loadOverview(): Promise<unknown> {
  const settled = await cameraOverview.settled();
  const generation = cameraOverview.generation();
  // No generation, or a read that failed, or a pointer that moved while the
  // bytes were in flight. All three are "there is nothing coherent to draw",
  // and the caller keeps the tile data it already has.
  if (settled === null || generation === null) throw new Error('overview: unavailable');
  if (overviewFeatures !== null && overviewFeatures.generation === generation) {
    return overviewFeatures.data;
  }

  const coords = settled.coords;
  const features = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    features.push({
      type: 'Feature',
      // No id and no properties: this set exists to be COUNTED, never tapped.
      // At this zoom a tap cannot mean one camera anyway.
      properties: {},
      geometry: { type: 'Point', coordinates: [coords[i + 1], coords[i]] },
    });
  }
  const data = { type: 'FeatureCollection', features };
  overviewFeatures = { generation, data };
  return data;
}

/**
 * `localStorage`, or nothing.
 *
 * Touching it throws outright in some privacy modes -- not on read, on the
 * PROPERTY ACCESS -- so it cannot be referenced directly from a render path.
 */
function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function MapCanvas({
  lat,
  lon,
  bearingDeg,
  cameras,
  zoom = DEFAULT_ZOOM,
  panned = false,
  onSelectCamera,
  onUserMoved,
  onZoomChanged,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
  cluster = true,
  headingUp = false,
  thresholdFt,
  labelled,
  mapView = 'auto',
  pitchDeg = 0,
}: MapCanvasProps): ReactElement {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);

  /**
   * Non-zero while WE are moving the map.
   *
   * `dragstart` and `zoomstart` fire for programmatic moves as well as for
   * fingers, and telling them apart matters: a spurious "the driver moved it"
   * sets the panned flag, which permanently stops the map following the
   * vehicle. Checking `originalEvent` alone is not enough, because our own
   * `easeTo` can be running when a real event arrives.
   */
  const programmatic = useRef(0);
  /**
   * The bearing the camera was last written with.
   *
   * Kept so the follow effect can tell a REAL bearing change from a re-render:
   * without it the only way to know whether `easeTo` has anything to do is to
   * call it, which is the write this is here to avoid.
   */
  const appliedBearing = useRef(0);
  /** The pitch the camera was last written with. Same job as `appliedBearing`. */
  const appliedPitch = useRef(0);
  /**
   * The chosen cartography, in a ref.
   *
   * The style builder runs from the deferred BUILD and from the mode observer,
   * neither of which is a render, so this cannot be read from a prop closure
   * without them both going stale. Same shape as `camerasRef`.
   */
  const viewRef = useRef(mapView);
  viewRef.current = mapView;

  // Handlers change identity every render; the map is built once. Reading them
  // through refs keeps the map from being torn down and rebuilt for a callback.
  const selectRef = useRef(onSelectCamera);
  selectRef.current = onSelectCamera;
  const movedRef = useRef(onUserMoved);
  movedRef.current = onUserMoved;
  const zoomedRef = useRef(onZoomChanged);
  zoomedRef.current = onZoomChanged;

  /**
   * The last zoom WE commanded.
   *
   * THE PINCH BUG, in one variable. The camera effect ran on every GPS fix and
   * re-applied the `zoom` PROP each time, so a pinch changed the map for about
   * a second and was then overwritten by the value the app last decided --
   * "punch it and it just snaps back to a zoomed view".
   *
   * Comparing the prop against what we last applied separates the two cases: a
   * prop that has genuinely changed is a COMMAND (the +/- keys, a cluster
   * being opened) and gets applied; a prop that has not changed is the app
   * simply re-rendering, and the driver's own zoom is left alone.
   */
  const commandedZoom = useRef<number | null>(null);

  /** Push the current map state onto the container for measurement. */
  const publishNow = useCallback((): void => {
    const instance = map.current;
    const element = holder.current;
    if (instance === null || element === null) return;
    publish(instance, element, cameraCountRef.current);
  }, []);

  const cameraCountRef = useRef(0);
  cameraCountRef.current = cameras.length;

  /**
   * The CURRENT camera list, for a map that is built later than this render.
   *
   * THE MAP DREW NO CAMERAS AT ALL. The `load` handler is created inside the
   * build-once effect, so it closed over whatever `cameras` was at MOUNT --
   * empty. The `[cameras]` effect that would have corrected it early-returns
   * while `ready.current` is false, and `ready` is only set inside that same
   * load handler. So the sequence was: cameras arrive, effect bails because the
   * map is not ready, map finishes building and seeds itself from the stale
   * empty closure, and nothing ever retries. Measured in a browser: the source
   * held 0 features while the app reported 979 cameras loaded.
   *
   * It got worse rather than better when the build became asynchronous -- it
   * now waits on a manifest fetch AND a dynamic import, so the data almost
   * always wins the race.
   *
   * This is the identical hazard `initialRef` above exists to solve for the
   * camera position. It was solved there and left unsolved for the payload.
   */
  const camerasRef = useRef(cameras);
  camerasRef.current = cameras;

  /**
   * The latest camera inputs, for a build that happens LATER.
   *
   * Construction now waits on the pmtiles protocol import, so by the time the
   * map is created the `lat`/`lon` captured in the effect's closure are stale --
   * usually still null, which put the map at 0,0 in the Atlantic while a live
   * fix sat in props. The effect is deliberately built-once, so it cannot
   * re-read them; a ref updated every render can.
   */
  const initialRef = useRef({ lat, lon, zoom, bearingDeg, pitchDeg });
  initialRef.current = { lat, lon, zoom, bearingDeg, pitchDeg };

  /**
   * Whether the map has been put on the vehicle yet.
   *
   * Beside the other build-time refs because the DEFERRED BUILD reads it: a map
   * constructed after a fix has already arrived is already centred, and the
   * first-fix branch below must not jump to it a second time.
   */
  const centred = useRef(false);

  /**
   * The archive URL the style was built from.
   *
   * A restyle needs the SAME one and must not re-derive it: resolution goes
   * through `resolveArchiveUrl`, which probes a manifest over the network and
   * falls back to whatever this device used last. Re-running that on a theme
   * change could hand the map a different archive mid-session, and a client
   * holding cached byte offsets into the old one reads garbage. See
   * `manifest.ts`.
   */
  const builtUrl = useRef<string | null>(null);

  /**
   * The mode-repaint, reachable from the BUILD.
   *
   * The observer below owns it, and the build has to be able to call it: the
   * map is built asynchronously (a manifest fetch, then a dynamic import) and
   * the stored theme is applied asynchronously too (IndexedDB hydration).
   * Whichever lands second has to reconcile against the other, and only one of
   * them has a callback that fires.
   */
  const repaintRef = useRef<(() => void) | null>(null);

  // --- build once ----------------------------------------------------------
  useEffect(() => {
    const element = holder.current;
    if (element === null || map.current !== null) return;

    const palette = readPalette(element);
    const configured = basemapUrl(import.meta.env as unknown as Record<string, string | undefined>);

    /**
     * THE PROTOCOL MUST EXIST BEFORE THE MAP DOES.
     *
     * This was a race, and it silently cost us the entire basemap. The handler
     * for `pmtiles://` was registered inside a dynamic `import().then()`, and
     * the Map was constructed on the NEXT LINE -- synchronously, long before
     * that promise resolved. MapLibre would start loading a style whose only
     * source used a scheme nothing could resolve yet, fail to resolve it, and
     * make ZERO requests. No error, no warning: a map that simply never asks
     * for a tile looks exactly like a map with nothing near it.
     *
     * So construction moved inside the resolution. `cancelled` covers the
     * unmount-before-resolve case, which React in strict mode will do to you.
     */
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    let stopWaitingForStyle: (() => void) | null = null;
    /** Set once resolution finishes; the style is built against THIS archive. */
    let url: string | null = configured;

    const build = (): void => {
      if (cancelled || map.current !== null) return;
      instance = buildMap();
    };

    const buildMap = (): MapLibreMap => {
      const initial = initialRef.current;
      const viewport = initialMapViewport(initial.lat, initial.lon, initial.zoom);
      const hasInitialFix = viewport.hasFix;
      // Remembered for a restyle; see `builtUrl`.
      builtUrl.current = url;
      /**
       * AND PUBLISHED, so the second map does not resolve a second archive.
       *
       * The INTEL card's mini map needs an archive URL too, and re-running
       * `resolveArchiveUrl` for it would mean a manifest fetch and a range probe
       * to open a card - and, worse, could hand the card a DIFFERENT archive
       * from the one the scope is reading, which is the exact split `manifest.ts`
       * exists to prevent. It reads this instead. See `mapRegistry.ts`.
       */
      setResolvedArchive(url);
      const built = new maplibregl.Map({
        container: element,
        /**
         * THE STYLE - built, not pointed at.
         *
         * This passed `url` straight through, which handed MapLibre a `.pmtiles`
         * URL where a style document belongs: it fetched an eight-gigabyte binary
         * archive and tried to parse it as JSON. The map has never drawn a road.
         * `osmStyle` -- which existed, and had zero call sites -- is what wraps
         * the archive in a style with the Protomaps cartography over it.
         */
        style: styleFor(
          url,
          palette,
          currentMode(),
          viewRef.current,
        ) as maplibregl.StyleSpecification,
        center: viewport.center,
        zoom: viewport.zoom,
        bearing: initial.bearingDeg ?? 0,
        pitch: initial.pitchDeg,
        minZoom,
        maxZoom,
        /**
         * THE CEILING THE TILT CONTROL CAN ASK FOR.
         *
         * Sourced from the tilt table rather than written here, so the two cannot
         * disagree: a steeper entry added to `MAP_TILT_DEG` is reachable without
         * anybody remembering to raise a second number. MapLibre's own default is
         * 60, and the gesture that would let a finger reach it is off regardless.
         */
        maxPitch: maxTiltDeg(),
        attributionControl: { compact: true },
        // The driver is holding a phone in a car. Every one of these is a way to
        // end up somewhere they did not ask to be.
        pitchWithRotate: false,
        dragRotate: false,
        touchPitch: false,
        /**
         * HOW FAR A FINGER MAY MOVE AND STILL BE A TAP.
         *
         * MapLibre's default is 3 pixels, which is a mouse's tolerance. A thumb
         * on a phone braced against a moving car does not hold 3 pixels, and
         * anything past it is reclassified as a DRAG: the map pans a hair and
         * the tap is never delivered, so a camera simply does not open and
         * nothing anywhere reports a problem.
         *
         * It is invisible in a headless harness -- `mouse.click` moves zero
         * pixels, so every automated check of this passes at 3.
         *
         * Ten is still well inside the 44px hit target, so it cannot make a tap
         * land on the wrong camera; it only stops a steady-handed tap being
         * thrown away. Panning is unaffected -- a real drag travels far more
         * than ten pixels.
         */
        clickTolerance: 10,
      });
      map.current = built;
      const instance = built;
      // If a fix was already available at build time we have just centred on it,
      // so the first-fix branch below must not fire again and re-jump.
      if (hasInitialFix) {
        centred.current = true;
        commandedZoom.current = initial.zoom;
      }
      // A HANDLE FOR MEASUREMENT, not for the app.
      //
      // The map's state lives in a WebGL context no harness can screenshot --
      // MapLibre omits `preserveDrawingBuffer`, so a working map and a broken one
      // read back identically. `data-fwm-map` covers the camera layers; this lets
      // a preflight ask the same questions about the BASEMAP, which is how the
      // "style was a .pmtiles URL" bug should have been caught.
      (globalThis as { __fwmMapInstance?: unknown }).__fwmMapInstance = instance;
      // The SUPPORTED way for the rest of the app to ask the map a question. The
      // global above is a debug handle for a headless preflight; see mapRegistry.
      setCurrentMap(instance);

      /**
       * INITIALISE WHEN THE STYLE IS READY, NOT WHEN EVERY SOURCE IS PERFECT.
       *
       * MapLibre's top-level `load` event waits for the initial sources. One
       * malformed basemap tile or sprite response can prevent that event forever
       * even though the style itself is usable. The old handler therefore never
       * added the camera source, never marked `ready`, and silently disabled every
       * later repaint. `styledata` is allowed to fire many times; the guard makes
       * this exactly-once at the first point `isStyleLoaded()` says layers may be
       * added. The short-lived `render` and `idle` listeners cover a style whose
       * last `styledata` event preceded listener registration; they remove
       * themselves with the other listeners as soon as the style is ready.
       */
      const initializeStyle = (): void => {
        if (ready.current) return;
        ready.current = true;
        element.setAttribute('data-fwm-map-loaded', 'true');
        // `camerasRef`, NOT the closure -- see its comment. Seeding from the
        // closure is what left the map with roads and no cameras.
        const current = camerasRef.current;
        instance.addSource(CAMERA_SOURCE, {
          type: 'geojson',
          data: toFeatureCollection(current) as FeatureCollection,
          // Native MapLibre clustering; there is no parallel cluster implementation.
          cluster,
          clusterRadius: 44,
          clusterMaxZoom: 15,
        });
        /**
         * HEAT IS THE FAR FIELD'S ANSWER TO "WHERE IS IT BAD", IN BOTH MODES.
         *
         * This used to be `if (cluster)`. The reasoning was sound -- a glow over
         * every one of nine hundred individual markers buries them and makes the
         * map crawl -- and the remedy was too broad: it removed the field at
         * every zoom rather than at the zooms where markers are drawn, and below
         * POINT_MIN_ZOOM in that mode no markers are. The result was a map with
         * nothing on it at all. See `addCameraLayers`, which owns the rule now.
         */
        syncThreshold(instance);
        addCameraLayers(instance, palette, cluster);
        // THE MODE MAY HAVE CHANGED WHILE THIS WAS BUILDING. Reconcile now that
        // `ready` is true, or a theme applied during the build is lost forever.
        repaintRef.current?.();
        publish(instance, element, current.length);
        // A map that OPENS zoomed out needs the national set immediately.
        swapForZoom(instance);
        // And the driver is almost always already located by the time the map
        // finishes building -- see `syncVehicle`.
        syncVehicle(instance);
        syncLabels(instance);
      };
      stopWaitingForStyle = whenStyleReady(instance, initializeStyle);

      // A tap on a camera opens that camera. One feature, one record, no guessing
      // which member of a merged marker was meant.
      /**
       * ONE HANDLER, ON THE INVISIBLE TARGET.
       *
       * Bound to the 44px hit layer rather than the 13px dot, and it decides from
       * the feature whether the tap meant a camera or a cluster: a cluster has a
       * `point_count` and no record of its own, so the only honest response is to
       * go IN; a point has an id, so it opens.
       */
      /**
       * BOUND TO THE MAP, AND IT QUERIES THE LAYER ITSELF.
       *
       * =======================================================================
       * WHY NOT `instance.on('click', HIT_LAYER, ...)`
       * =======================================================================
       * Because the layer does not survive the app. Two effects tear the camera
       * layers down and re-add them -- the cluster toggle, which must replace the
       * SOURCE because MapLibre fixes `cluster` at creation and offers no setter,
       * and the mode observer, which rebuilds them to repaint the palette. A
       * layer-delegated listener is bound to the layer that existed when the map
       * was built, and after a rebuild it stops firing.
       *
       * Measured: with clustering ON a tap opens the card; with clustering OFF --
       * which goes through the source rebuild -- 89 hit features were under the
       * finger, one of them carrying a real camera id, and NOTHING happened.
       * Reported as "now I can't click a node and bring up an intel card".
       *
       * A map-level listener has no such lifetime. It queries the hit layer at
       * the moment of the tap, so it is correct for whatever layers exist then,
       * and no future rebuild can silently unbind it.
       */
      instance.on('click', (event) => {
        if (instance.getLayer(HIT_LAYER) === undefined) return;
        const feature = instance.queryRenderedFeatures(event.point, { layers: [HIT_LAYER] })[0];
        if (feature === undefined) return;
        const id = feature.properties?.['id'];
        if (typeof id === 'string') {
          selectRef.current?.(id);
          return;
        }
        if (feature.properties?.['cluster'] === true) {
          const coords = (feature.geometry as Point).coordinates;
          programmatic.current += 1;
          instance.easeTo({
            center: [coords[0] ?? 0, coords[1] ?? 0],
            zoom: instance.getZoom() + 2,
          });
          programmatic.current -= 1;
        }
      });

      // `dragstart`/`zoomstart` fire for programmatic moves too; the flag on the
      // event is what separates "the driver did this" from "we did this".
      const userMoved = (event: { originalEvent?: unknown }): void => {
        if (programmatic.current > 0) return;
        if (event.originalEvent !== undefined) movedRef.current?.();
      };
      instance.on('dragstart', userMoved);
      instance.on('zoomstart', userMoved);
      // The driver's own zoom becomes the truth. Reported on `zoomend` rather
      // than continuously: a pinch fires hundreds of intermediate values and the
      // range readout does not need to animate through all of them.
      instance.on('zoomend', (event: { originalEvent?: unknown }) => {
        if (programmatic.current > 0 || event.originalEvent === undefined) return;
        const next = instance.getZoom();
        /*
         * THE DRIVER'S ZOOM IS NOT A COMMAND, AND WRITING IT HERE WAS THE PINCH
         * BUG.
         *
         * `commandedZoom` means "the last zoom PROP we applied" - the doc on the
         * ref says exactly that. This line put the MAP's zoom in it instead, so
         * after a pinch the ref held the driver's value while the prop still held
         * the app's. DRIVE passes no zoom at all, so its prop is a constant 14:
         * pinch out to 12, and every GPS fix after that compared 12 against 14,
         * read it as a fresh command, and eased the map back to 14.
         *
         * That is the "I pinch out to look around and it snaps back" report, and
         * it fires about once a second, which is why it felt random.
         *
         * The ref is left alone. It is updated where the prop is applied, and
         * nowhere else.
         */
        zoomedRef.current?.(next);
      });
      // NO PUBLISH HERE. `idle` below is the trustworthy reading and this one
      // was a second, earlier, always-wrong copy of it -- taken while tiles are
      // still building. The zoom swap stays; that is the actual job of this
      // handler.
      instance.on('moveend', () => {
        swapForZoom(instance);
        syncViewport(instance);
      });
      instance.on('zoomend', () => {
        swapForZoom(instance);
      });
      // `idle` is the only event that means "everything queued has been drawn".
      // `moveend` fires while tiles are still being built, so a measurement taken
      // there reports zero rendered features for a map that is about to draw
      // hundreds -- a false negative that reads exactly like a broken layer.
      instance.on('idle', () => {
        publishNow();
      });

      return built;
    };

    /**
     * WHICH archive, then HOW to read it, then the map.
     *
     * The archive is resolved through a manifest rather than a fixed filename
     * because a rebuilt archive at the same URL corrupts every client holding
     * cached byte offsets into the old one -- silently. See `manifest.ts`.
     * Resolution can fail freely: it falls back to the archive this device
     * already used, and then to the compiled-in URL.
     */
    void (async () => {
      if (configured !== null) {
        url = await resolveArchiveUrl({
          fallbackUrl: configured,
          storage: safeLocalStorage(),
        });
      }
      if (cancelled) return;

      if (url !== null && isPmtiles(url)) {
        // PMTiles is a single archive read with HTTP range requests, which is
        // how a self-hosted basemap avoids being a per-tile path on somebody
        // else's server. The style cannot resolve its source until the protocol
        // is registered, so the map is built after it, not beside it.
        await ensurePmtilesProtocol();
        if (cancelled) return;
      }
      build();
    })();

    return () => {
      cancelled = true;
      stopWaitingForStyle?.();
      ready.current = false;
      setCurrentMap(null);
      instance?.remove();
      map.current = null;
    };
    // BUILT ONCE, ON PURPOSE. Everything that changes afterwards is applied by
    // the effects below. Rebuilding would throw away a WebGL context, every
    // loaded tile and the driver's own pan, several times a second.
  }, []);

  /**
   * WHERE THE DRIVER IS, and which way they are pointing.
   *
   * There was NO vehicle marker at all. The map centred on the driver and drew
   * nothing to say so, which on a screen full of camera clusters leaves no
   * answer to "where am I" -- reported simply as "I have no navigation arrow".
   *
   * A DOM marker rather than a layer: it is exactly one object, it must sit
   * above every layer including the clusters, and it has to rotate smoothly
   * with the heading. A symbol layer would need its own source, its own sort
   * key against the camera layers, and a sprite icon to rotate.
   */
  const vehicle = useRef<maplibregl.Marker | null>(null);
  /** Teardown for the sweep's frame loop; the marker outlives re-renders. */
  const stopSweep = useRef<(() => void) | null>(null);
  const positionRef = useRef({ lat, lon, bearingDeg });
  positionRef.current = { lat, lon, bearingDeg };

  /**
   * Put the driver on the map, or take them off it.
   *
   * Called from the BUILD as well as from the effect below, and that is the
   * whole point. The build is deferred -- it waits on a manifest fetch and a
   * dynamic import -- so the position almost always arrives BEFORE the map
   * exists. An effect keyed on `[lat, lon]` therefore runs once against a null
   * map, returns, and never fires again, because the position it is watching
   * does not change a second time. The marker simply never appeared.
   *
   * That is the same shape as the bug that left the map with no cameras. Twice
   * in one file makes it a pattern: anything created by the async build needs a
   * way in from the build, not only from a prop.
   */
  const syncVehicle = useCallback((instance: MapLibreMap): void => {
    const { lat: vLat, lon: vLon, bearingDeg: vBearing } = positionRef.current;
    if (vLat === null || vLon === null) {
      stopSweep.current?.();
      stopSweep.current = null;
      vehicle.current?.remove();
      vehicle.current = null;
      return;
    }

    if (vehicle.current === null) {
      const element = document.createElement('div');
      element.className = 'fwm-vehicle';
      element.setAttribute('aria-hidden', 'true');
      // Drawn rather than an image: it takes its colour from the token so it
      // follows every theme mode, and stays crisp at any density.
      /*
       * THE SWEEP CANVAS SITS OUTSIDE THE ROTATION.
       *
       * The marker itself is turned by `setRotation` to carry the heading, so
       * anything inside it turns too. A radar wipe that inherits the heading is
       * not a wipe, it is a second thing pretending to mean direction - which
       * is the mistake the static heading wedge exists to avoid.
       *
       * `.fwm-vehicle-sweep` is counter-rotated in CSS off the same
       * `--fwm-vehicle-rotation` the marker writes, so the sweep stays level
       * with the world while the arrow points where the car does.
       */
      element.innerHTML =
        '<canvas class="fwm-vehicle-sweep" aria-hidden="true"></canvas>' +
        '<svg viewBox="0 0 24 24" class="fwm-vehicle-arrow">' +
        '<path d="M12 2 L19 21 L12 17 L5 21 Z" /></svg>';
      const canvas = element.querySelector('canvas');
      if (canvas instanceof HTMLCanvasElement) {
        stopSweep.current?.();
        stopSweep.current = startPixelSweep(canvas);
      }
      vehicle.current = new maplibregl.Marker({
        element,
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      });
      vehicle.current.setLngLat([vLon, vLat]).addTo(instance);
    } else {
      vehicle.current.setLngLat([vLon, vLat]);
    }

    // THE ARROW TURNS, THE MAP DOES NOT. With north fixed, the heading has to
    // live somewhere on the ground, and this is the only object whose
    // orientation means anything.
    vehicle.current.setRotation(vBearing ?? 0);
    // The sweep counter-rotates off this, so it stays level with the ground.
    (vehicle.current.getElement() as HTMLElement).style.setProperty(
      '--fwm-vehicle-rotation',
      `${String(-(vBearing ?? 0))}deg`,
    );
    (vehicle.current.getElement() as HTMLElement).dataset['fwmHeading'] =
      vBearing === null ? 'unknown' : 'live';
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    syncVehicle(instance);
  }, [lat, lon, bearingDeg, syncVehicle]);

  // The frame loop outlives every re-render, so it is stopped exactly once,
  // when the map component goes away.
  useEffect(
    () => () => {
      stopSweep.current?.();
      stopSweep.current = null;
    },
    [],
  );

  /**
   * THE LABELLED CAMERAS - a dot with its distance under it.
   *
   * Keyed by camera id and reconciled rather than rebuilt: markers are DOM
   * nodes with a MapLibre subscription each, and tearing all of them down on
   * every GPS tick would remove and re-add elements several times a second.
   *
   * Same deferred-build problem as the vehicle, solved the same way: the list
   * is held in a ref and `syncLabels` is called from the build AND from this
   * effect, because the cameras almost always arrive before the map exists.
   */
  const labels = useRef(new Map<string, maplibregl.Marker>());
  const labelledRef = useRef(labelled);
  labelledRef.current = labelled;

  const syncLabels = useCallback((instance: MapLibreMap): void => {
    const wanted = labelledRef.current ?? EMPTY_LABELS;
    const seen = new Set<string>();

    for (const item of wanted) {
      seen.add(item.id);
      let marker = labels.current.get(item.id);
      if (marker === undefined) {
        const element = document.createElement('div');
        element.className = 'fwm-camera-label';
        element.setAttribute('aria-hidden', 'true');
        element.innerHTML =
          '<span class="fwm-camera-label-dot"></span>' +
          '<span class="fwm-camera-label-chip"></span>';
        marker = new maplibregl.Marker({ element });
        marker.setLngLat([item.lon, item.lat]).addTo(instance);
        labels.current.set(item.id, marker);
      } else {
        marker.setLngLat([item.lon, item.lat]);
      }
      const element = marker.getElement();
      element.dataset['fwmState'] = item.state;
      const chip = element.querySelector('.fwm-camera-label-chip');
      // textContent, never innerHTML: the label is formatted app data and
      // there is no reason for this node to be able to parse markup.
      if (chip !== null) chip.textContent = item.label;
    }

    // Anything that stopped being one of the nearest loses its label. Left
    // behind, it would be a distance frozen at whatever it last read.
    for (const [id, marker] of labels.current) {
      if (seen.has(id)) continue;
      marker.remove();
      labels.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    syncLabels(instance);
  }, [labelled, syncLabels]);

  /**
   * A NEW CARTOGRAPHY IS A NEW STYLE, which means the same full rebuild a mode
   * change needs: the basemap layers are replaced wholesale and the app's own
   * layers have to be re-added on top of them. `repaintRef` is that sequence,
   * already written and already used by the mode observer, so this asks for it
   * rather than growing a second copy.
   *
   * Skipped on the first pass - the build already used the right view.
   */
  const appliedView = useRef(mapView);
  useEffect(() => {
    if (appliedView.current === mapView) return;
    appliedView.current = mapView;
    repaintRef.current?.();
  }, [mapView]);

  // Every marker is a DOM node and a subscription. None may outlive the map.
  useEffect(
    () => () => {
      for (const marker of labels.current.values()) marker.remove();
      labels.current.clear();
    },
    [],
  );

  /**
   * THE ALERT THRESHOLD, AS A RING ON THE GROUND.
   *
   * Self-healing, and deliberately so. This one function is called from five
   * places -- the first build, a position change, a threshold change, a
   * flavour change that tore the style down, and a palette repaint that tore
   * the layers down -- and each of those leaves a DIFFERENT amount standing:
   * sometimes the source and layer both survive, sometimes neither does.
   * Writing five variants of "add it if it is missing" is how the camera layers
   * drifted apart and had the heat handover fixed twice. So it asks rather than
   * assumes, and every caller can simply call it.
   *
   * The layer goes on BEFORE the camera layers when both are being added, so
   * the dots and clusters paint over the ring. It is a reference mark; nothing
   * about it should ever be harder to see through than a camera.
   */
  const thresholdRef = useRef(thresholdFt);
  thresholdRef.current = thresholdFt;

  const syncThreshold = useCallback((instance: MapLibreMap): void => {
    const { lat: vLat, lon: vLon } = positionRef.current;
    const ft = thresholdRef.current;

    // NO FIX OR NO SETTING MEANS NO RING, and the ring already on the map has
    // to go: a circle left behind at the last known position claims the alert
    // fires around a place the driver is no longer at.
    if (vLat === null || vLon === null || ft === undefined || !(ft > 0)) {
      if (instance.getLayer(THRESHOLD_LAYER) !== undefined) {
        instance.removeLayer(THRESHOLD_LAYER);
      }
      if (instance.getSource(THRESHOLD_SOURCE) !== undefined) {
        instance.removeSource(THRESHOLD_SOURCE);
      }
      return;
    }

    const data = thresholdRing(vLat, vLon, ft) as FeatureCollection;
    const source = instance.getSource<GeoJSONSource>(THRESHOLD_SOURCE);
    if (source === undefined) {
      instance.addSource(THRESHOLD_SOURCE, { type: 'geojson', data });
    } else {
      source.setData(data);
    }

    if (instance.getLayer(THRESHOLD_LAYER) === undefined) {
      instance.addLayer(
        thresholdLayer(readPalette(holder.current ?? undefined)) as maplibregl.LayerSpecification,
      );
    }
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    syncThreshold(instance);
  }, [lat, lon, thresholdFt, syncThreshold]);

  /**
   * WHICH SET IS ON THE MAP: the tiles around the vehicle, or the whole country.
   *
   * Driven by the MAP'S OWN ZOOM, not by the React prop. The prop only changes
   * after a gesture has round-tripped out to the app and back, so anything that
   * moves the camera another way -- a cluster tap, `easeTo`, a programmatic
   * zoom -- would never trigger the swap. Reading `getZoom()` on the map's own
   * events makes the source follow what is actually on screen.
   */
  const showingOverview = useRef(false);

  /**
   * WHERE THE READER IS LOOKING, so the cameras there are real cameras.
   *
   * `sync.ts` fetches around the VEHICLE, which is right for driving and leaves
   * a panned-to city drawing clusters from `overview.json` with nothing behind
   * them - the coordinate is known, the record is not, and tapping one opens
   * nothing. This asks for the tiles under the viewport as well.
   *
   * The policy is in `viewportSync.ts` and is pure, so the zoom floor and the
   * movement gate are testable without a map. Everything here is the part that
   * needs one: read the box, remember the centre, apply the answer.
   *
   * `coverRangeFt` FIRST. It sets the ring width the subsequent fetch uses; the
   * other order fetches a windscreen-sized ring and widens it for next time,
   * which is how the straight-edged box of loaded ground appears.
   */
  const lastViewportCentre = useRef<{ lat: number; lon: number } | null>(null);

  const syncViewport = useCallback((instance: MapLibreMap): void => {
    if (!ready.current) return;
    const centre = instance.getCenter();
    const bounds = instance.getBounds();
    const box = {
      centreLat: centre.lat,
      centreLon: centre.lng,
      northLat: bounds.getNorth(),
      eastLon: bounds.getEast(),
      southLat: bounds.getSouth(),
      westLon: bounds.getWest(),
      zoom: instance.getZoom(),
    };
    const decision = decideViewportSync(box, lastViewportCentre.current);
    if (!decision.fetch) return;
    lastViewportCentre.current = { lat: box.centreLat, lon: box.centreLon };
    coverRangeFt(viewportRangeFt(box));
    syncCamerasAt(box.centreLat, box.centreLon);
  }, []);

  const swapForZoom = useCallback((instance: MapLibreMap): void => {
    if (!ready.current) return;
    const wantsOverview = instance.getZoom() < POINT_MIN_ZOOM;
    if (wantsOverview === showingOverview.current) return;

    if (!wantsOverview) {
      showingOverview.current = false;
      instance
        .getSource<GeoJSONSource>(CAMERA_SOURCE)
        ?.setData(toFeatureCollection(camerasRef.current) as FeatureCollection);
      return;
    }

    // Claimed BEFORE the await so a burst of zoom events cannot each start a
    // swap; `loadOverview` is memoised, but the setData would still race.
    showingOverview.current = true;
    void loadOverview()
      .then((data) => {
        if (!showingOverview.current || map.current === null) return;
        map.current.getSource<GeoJSONSource>(CAMERA_SOURCE)?.setData(data as FeatureCollection);
      })
      .catch(() => {
        // Keep whatever is on the map. A missing overview is a thinner map,
        // not a broken one.
        showingOverview.current = false;
      });
  }, []);

  /**
   * THE APP'S OWN CAMERA LAYERS, added in one place.
   *
   * Every one of them carries the palette baked into a paint expression -- the
   * owner-type `match` on the dots, the plasma ramp on the heat, the count
   * label -- so a palette change means rebuilding them, not nudging a property.
   * Three callers need exactly this sequence (the first build, the cluster
   * toggle, and a mode change) and they were drifting apart: the heat handover
   * fix had to be written twice.
   *
   * Order is load-bearing: the invisible 44px hit target goes down first so
   * everything visible paints over it.
   */
  const addCameraLayers = useCallback(
    (instance: MapLibreMap, palette: Palette, clustered: boolean): void => {
      instance.addLayer(hitLayer() as maplibregl.LayerSpecification);
      instance.addLayer(
        heatLayer(palette, clustered ? undefined : POINT_MIN_ZOOM) as maplibregl.LayerSpecification,
      );
      instance.addLayer(clusterLayer(palette) as maplibregl.LayerSpecification);
      instance.addLayer(
        clusterCountLayer(palette, ['Noto Sans Medium']) as maplibregl.LayerSpecification,
      );
      instance.addLayer(cameraLayer(palette) as maplibregl.LayerSpecification);
    },
    [],
  );

  /**
   * THE MAP FOLLOWS THE SKIN, which until now it was the only surface not to.
   *
   * `readPalette` was called exactly twice -- when the map was built, and when
   * clustering was toggled -- so picking a mode restyled the whole app and left
   * the map on whatever palette happened to be live at mount. Reported as an
   * amber instrument panel above a map that had not moved.
   *
   * WHY THE DOM ATTRIBUTE AND NOT THE STORE. `applyMode` is the only writer of
   * `data-fwm-mode`, but five call sites reach it and `resolveMode` can land
   * somewhere the store does not say -- a watch surface is forced to
   * `night-watch` regardless of the saved preference. Subscribing to the store
   * would desync exactly there. The attribute is the truth about what is
   * painted, which is what the map needs to match.
   */
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (root === undefined || root === null) return undefined;

    /** The flavour the style on screen was built with. */
    let paintedFlavor = flavorForMode(currentMode(), viewRef.current);

    const repaint = (): void => {
      const instance = map.current;
      /**
       * NOT READY MEANS TRY AGAIN LATER, NOT NEVER.
       *
       * This returned here and that was the whole bug: a mode change arriving
       * while the map was still building was DROPPED. `paintedFlavor` kept the
       * value it was initialised with, the map finished building on whatever
       * flavour was current at build time, and no second mutation ever came
       * because the attribute had already been written.
       *
       * The result was a black basemap with white roads under light chrome -
       * BLACK's cartography, which is tuned for a dark ground, sitting under a
       * paper-coloured app. Intermittent, because it depended on whether
       * IndexedDB hydration applied the stored theme before or after a
       * manifest fetch plus a dynamic import finished.
       *
       * The build calls this once on `load` for exactly this reason, so
       * whichever of the two lands second reconciles against the other.
       */
      if (instance === null || !ready.current) return;
      const palette = readPalette(holder.current ?? undefined);
      const mode = currentMode();
      const flavor = flavorForMode(mode, viewRef.current);

      /*
       * A FLAVOUR CHANGE IS A NEW STYLE, not a repaint.
       *
       * `setPaintProperty` can move the ground colours, and for seven of the
       * eight modes that is all that differs. `refinement` is the LIGHT one,
       * and it needs the other flavour outright: BLACK's cartography is tuned
       * for a dark ground -- `city_label` #999999, `highway` #292929 -- and on
       * #EAF0EE those are a smear. The SPRITE has to change with it too, and a
       * sprite is a property of the style document, not of a layer, so there
       * is no setter for it.
       *
       * `setStyle` destroys every layer beneath, including the app's own, so
       * they are re-added on the next `styledata`. The SOURCE goes with them,
       * which is why the overview swap state is reset -- `swapForZoom` then
       * reloads whichever set the current zoom calls for.
       */
      if (flavor !== paintedFlavor) {
        paintedFlavor = flavor;
        const url = builtUrl.current;
        instance.once('styledata', () => {
          if (map.current === null) return;
          if (instance.getSource(CAMERA_SOURCE) === undefined) {
            instance.addSource(CAMERA_SOURCE, {
              type: 'geojson',
              data: toFeatureCollection(camerasRef.current) as FeatureCollection,
              cluster: clusterRef.current,
              clusterRadius: 44,
              clusterMaxZoom: 15,
            });
          }
          syncThreshold(instance);
          addCameraLayers(instance, readPalette(holder.current ?? undefined), clusterRef.current);
          showingOverview.current = false;
          swapForZoom(instance);
        });
        instance.setStyle(
          styleFor(url, palette, mode, viewRef.current) as maplibregl.StyleSpecification,
          { diff: false },
        );
        return;
      }

      // The basemap's ground, whose colours this app overrides at style build.
      // `setPaintProperty` rather than a restyle: a `setStyle` would tear down
      // every layer below and the camera source with them.
      for (const ground of GROUND_LAYERS) {
        if (instance.getLayer(ground.id) === undefined) continue;
        instance.setPaintProperty(ground.id, ground.property, palette[ground.token]);
      }

      // The app's own layers have the palette inside their paint expressions,
      // so they are rebuilt. The SOURCE is untouched, which is why the overview
      // swap state survives this.
      // THE RING IS IN THIS LIST TOO. Its colour is baked into a paint
      // expression exactly like the camera layers', so a mode change that only
      // rebuilt those would leave one dashed circle in the previous theme's
      // grey -- the single most obviously wrong object on a restyled map.
      for (const id of [
        CAMERA_LAYER,
        CLUSTER_COUNT_LAYER,
        CLUSTER_LAYER,
        HEAT_LAYER,
        HIT_LAYER,
        THRESHOLD_LAYER,
      ]) {
        if (instance.getLayer(id) !== undefined) instance.removeLayer(id);
      }
      syncThreshold(instance);
      addCameraLayers(instance, palette, clusterRef.current);
    };

    const observer = new MutationObserver(repaint);
    observer.observe(root, { attributes: true, attributeFilter: ['data-fwm-mode'] });
    // Reachable from the build's `load`, which is the other half of the race.
    repaintRef.current = repaint;
    // And run it now: the attribute may already have changed while this effect
    // was being set up.
    repaint();

    return () => {
      observer.disconnect();
      repaintRef.current = null;
    };
  }, [addCameraLayers, syncThreshold]);

  /**
   * Clustering is a SOURCE property, so changing it means replacing the source.
   *
   * MapLibre fixes `cluster` when a GeoJSON source is created and offers no
   * setter, so a toggle cannot just flip a flag -- the source and every layer
   * reading it have to be torn down and rebuilt. Skipped entirely on the first
   * pass, because the build already created them with the right value.
   */
  const clusterRef = useRef(cluster);
  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current || clusterRef.current === cluster) return;
    clusterRef.current = cluster;
    const palette = readPalette(holder.current ?? undefined);
    for (const id of [CAMERA_LAYER, CLUSTER_COUNT_LAYER, CLUSTER_LAYER, HEAT_LAYER, HIT_LAYER]) {
      if (instance.getLayer(id) !== undefined) instance.removeLayer(id);
    }
    if (instance.getSource(CAMERA_SOURCE) !== undefined) instance.removeSource(CAMERA_SOURCE);
    instance.addSource(CAMERA_SOURCE, {
      type: 'geojson',
      data: toFeatureCollection(camerasRef.current) as FeatureCollection,
      cluster,
      clusterRadius: 44,
      clusterMaxZoom: 15,
    });
    addCameraLayers(instance, palette, cluster);
    showingOverview.current = false;
    swapForZoom(instance);
  }, [cluster, swapForZoom]);

  // --- the data ------------------------------------------------------------
  useEffect(() => {
    const instance = map.current;
    if (instance === null || !ready.current) return;
    const source = instance.getSource<GeoJSONSource>(CAMERA_SOURCE);
    if (source === undefined) return;
    // Do not stamp the local set over the national one the driver is looking at.
    if (showingOverview.current) return;
    source.setData(toFeatureCollection(cameras) as FeatureCollection);
    const element = holder.current;
    if (element !== null) publish(instance, element, cameras.length);
  }, [cameras]);

  // --- where it is looking -------------------------------------------------
  /**
   * ONE MOVE, NOT THREE.
   *
   * Centre, bearing and zoom were three effects calling `easeTo` separately,
   * and `easeTo` CANCELS whatever animation is already running. So the three
   * fought: the centre animation would start toward the vehicle, the bearing
   * animation would cancel it a frame later, and the map stopped wherever the
   * interrupted one had got to.
   *
   * Measured on the deployed build: 979 cameras loaded, zoom correct, and the
   * map sitting at 4.93 N, 11.05 W -- in the Atlantic off West Africa. It had
   * set out from the null-island default it was constructed at and been cut
   * off a few degrees into the journey. Every camera was thousands of miles
   * outside the viewport, which is why the canvas was one flat black rectangle.
   *
   * One effect, one call, every property together.
   */
  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;

    /**
     * NORTH IS UP UNLESS THE DRIVER ASKS OTHERWISE.
     *
     * It always rotated to the live heading, and on a real phone that reads as
     * the map "constantly orienting itself to my compass" -- a magnetometer in
     * a steel car is noisy, and every few degrees of that noise swung the whole
     * world. North up is now the default and heading-up is a SETTINGS choice,
     * because plenty of drivers do want the map facing the way they are going.
     *
     * Either way the heading is shown: the compass in the top block, and the
     * vehicle arrow. A needle turning is an instrument; a map turning is the
     * ground moving, and that should be opt-in.
     */
    const bearing = headingUp ? (bearingDeg ?? 0) : 0;
    const hasFix = lat !== null && lon !== null;

    // THE FIRST FIX JUMPS. A map constructed before the GPS answers starts at
    // [0, 0], and animating from there to the driver is a flight across the
    // Atlantic that shows a black screen for its duration and can be cancelled
    // half way -- which is exactly what happened. Only once it is somewhere
    // real does moving become something to animate.
    if (hasFix && !centred.current) {
      centred.current = true;
      commandedZoom.current = zoom;
      appliedBearing.current = bearing;
      appliedPitch.current = pitchDeg;
      programmatic.current += 1;
      instance.jumpTo({ center: [lon, lat], zoom, bearing, pitch: pitchDeg });
      programmatic.current -= 1;
      publishNow();
      return;
    }

    // ONLY A CHANGED PROP IS A COMMAND. See `commandedZoom`.
    const zoomCommanded = isZoomCommand(commandedZoom.current, zoom);
    if (zoomCommanded) commandedZoom.current = zoom;

    /**
     * A PANNED MAP IS NOT TOUCHED AT ALL.
     *
     * This used to skip only the CENTRE and still call `easeTo` for the bearing
     * on every tick. `easeTo` is a camera write with an animation: it cancels
     * whatever is in flight and re-seats the view. On a phone getting a GPS fix
     * every second or two, that meant a pinch was undone a moment after it was
     * made - reported as "every time it gets a gps lock it reverts my pinch to
     * zoom stage", which is exactly what it did.
     *
     * There is also nothing left for it to do. The centre is skipped because
     * the driver panned, the zoom is skipped unless the app commanded one, and
     * the bearing is a constant 0 unless heading-up is on. Writing the camera
     * to set three values that have not changed is all cost and no effect.
     *
     * A real command still gets through: a zoom the app set, or a bearing
     * change when the driver has asked the map to turn with them.
     */
    const bearingChanged = bearing !== appliedBearing.current;
    /**
     * A TILT IS A COMMAND EVEN ON A PANNED MAP.
     *
     * The driver pressed a button for it. Bearing gets the same treatment
     * directly above, and for the same reason: the panned check exists to stop
     * a GPS tick UNDOING a gesture, not to stop the app answering a press.
     */
    const pitchChanged = pitchDeg !== appliedPitch.current;
    if (panned && !zoomCommanded && !bearingChanged && !pitchChanged) return;
    appliedBearing.current = bearing;
    appliedPitch.current = pitchDeg;

    programmatic.current += 1;
    instance.easeTo({
      ...(hasFix && !panned ? { center: [lon, lat] as [number, number] } : {}),
      ...(zoomCommanded ? { zoom } : {}),
      bearing,
      pitch: pitchDeg,
      duration: 450,
    });
    programmatic.current -= 1;
  }, [lat, lon, panned, bearingDeg, pitchDeg, zoom, publishNow]);

  return <div ref={holder} className="fwm-map" data-fwm-map="true" data-fwm-map-view={mapView} />;
}
