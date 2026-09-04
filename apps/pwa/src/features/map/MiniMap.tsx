/**
 * THE MINI MAP - a still picture of one camera, on the card that describes it.
 *
 * =============================================================================
 * WHY A SECOND MAPLIBRE INSTANCE IS THE HONEST ANSWER HERE
 * =============================================================================
 * The obvious objection to a live map per card is weight: a card is opened,
 * closed and reopened all drive, and each open builds a WebGL context, a style
 * with two hundred Protomaps layers in it, and a tile pipeline. That is a real
 * objection, so it was measured rather than argued about. Twelve consecutive
 * open/close cycles, headless Chromium at 390x844 dpr 2 on SOFTWARE GL
 * (swiftshader, so every shader compile is main-thread work a phone's GPU does
 * in hardware), reading a local archive served with no cache headers:
 *
 *   tap -> card on screen                     201 ms median (173 / 274)
 *   tap -> ground painted in the picture      569 ms median (545 / 598)
 *   longest main-thread task inside an open   134 ms median (max 157)
 *
 * and the same run with the labels left in the style was 706 ms to ground and
 * a 245 ms block, which is why `withoutLabels` exists -- see its note. A card
 * opened in a build with NO archive at all (`VITE_FWM_BASEMAP_URL=""`) still
 * costs 106 ms, so about 28 ms of that block is this map and the rest is the
 * card itself.
 *
 * The card is therefore READABLE in a fifth of a second and the picture fills
 * in behind it. That is the shape this was allowed to have; a map that made the
 * card wait for it would not be.
 *
 * WebGL contexts over the run: 14 created (the scope, plus one per card), 13
 * released -- MapLibre frees a context by losing it deliberately, and `remove()`
 * on unmount is what keeps the live count at two. Leaking them instead would
 * have crossed Chromium's ~16 ceiling by the sixteenth camera a driver looked
 * at, and the context the browser drops is the OLDEST: the scope's. The scope
 * was still drawing 71 features after all twelve cycles.
 *
 * The alternative considered and rejected was decoding one vector tile with
 * `@mapbox/vector-tile` and drawing roads into a 2D canvas, the way
 * `speedSource.ts` reads a tile directly. It would be lighter and it would be a
 * SECOND RENDERER: its own road classification, its own colours, its own bugs,
 * drifting from the cartography the driver sees on the scope. Same picture,
 * twice the map code. Weight was not a good enough reason.
 *
 * =============================================================================
 * IT IS A PICTURE, AND PICTURES DO NOT TAKE GESTURES
 * =============================================================================
 * `interactive: false` plus `pointer-events: none`. The card SCROLLS, and a map
 * that swallows a drag inside a scrolling card is a map that has broken the
 * card: the finger moves, the page does not, and the reader concludes the app
 * has hung. There is no zoom, no pan, no rotate and no tap target here.
 *
 * =============================================================================
 * THE MARK IS DOM, NOT A MAPLIBRE MARKER
 * =============================================================================
 * The map is centred on the camera and cannot be moved, so the camera is always
 * exactly in the middle -- which means an SVG pinned to the middle of the box is
 * the same picture as a `Marker` at the same coordinate, and survives things a
 * marker cannot: no WebGL, no archive, no style. On a phone with the ground
 * missing the reader still gets the mark, the facing and a caption saying why
 * there is nothing under it. See {@link MiniMapGround}.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useMapView } from '../../stores';
import { basemapUrl, isPmtiles } from './basemap.ts';
import { readRemembered } from './manifest.ts';
import { resolvedArchive } from './mapRegistry.ts';
import { currentMode, ensurePmtilesProtocol, styleFor, withoutLabels } from './mapStyle.ts';
import { readPalette } from './palette.ts';
import {
  GROUND_NOTE,
  GROUND_NOTE_CREDITED,
  MINI_MAP_ZOOM,
  conePath,
  miniMapLabel,
} from './miniMap.ts';
import type { FacingSpan, MiniMapGround } from './miniMap.ts';
import './miniMap.css';

/**
 * How long the picture may say nothing before it admits there is no ground.
 *
 * The scope waits 2.5 s for a manifest (`MANIFEST_TIMEOUT_MS`) on the grounds
 * that a driver needs the map NOW. This is looser because the cost of being
 * wrong is different: the caption is a claim about what is cached, and calling
 * a slow archive an absent one is a lie the reader can see. Four seconds, and a
 * later `idle` still corrects the caption if the tiles do arrive.
 */
const GROUND_TIMEOUT_MS = 4_000;

/** The cone's reach inside the viewBox below. Two thirds, so the box frames it. */
const CONE_RADIUS = 33;

/**
 * The mark's own coordinate space.
 *
 * A square viewBox centred on 0,0 puts the camera at the origin, which is what
 * `conePath` assumes and what "centred on the camera" means. 100 units wide
 * because the arithmetic is then percentages of the box and reads as such.
 */
const VIEW_BOX = '-50 -50 100 100';

export interface MiniMapProps {
  readonly lat: number;
  readonly lon: number;
  /** Which way the lens looks, from {@link facingSpans}. Empty draws no cone. */
  readonly facings: readonly FacingSpan[];
  /**
   * The surface this picture stands on ALREADY credits OpenStreetMap.
   *
   * Set by DRIVE, whose card sits over the scope and whose scope draws
   * MapLibre's attribution control. Drops the caption's credit and nothing
   * else - see {@link GROUND_NOTE_CREDITED}, which keeps the dead-zone note.
   *
   * It is a claim the CALLER makes, not something this component can detect,
   * which is why it is a prop rather than a lookup: a screen that stops drawing
   * the scope has to stop passing this at the same time.
   */
  readonly credited?: boolean;
}

/**
 * WHICH ARCHIVE, WITHOUT ASKING THE NETWORK WHICH ARCHIVE.
 *
 * The scope resolves this through a manifest and a range probe -- see
 * `manifest.ts` for why a fixed filename corrupts clients -- and publishes what
 * it settled on. Opening a card must not repeat that negotiation: it is two
 * requests to draw a thumbnail, and if the manifest has moved on it would hand
 * this map a DIFFERENT archive from the one the scope behind it is reading.
 *
 * So: what the scope resolved, else what this device last used (which is the
 * archive whose tiles are in the browser's cache, so it is also the one most
 * likely to answer offline), else the compiled-in default. No fetch either way.
 */
function miniArchive(): string | null {
  const resolved = resolvedArchive();
  if (resolved !== null) return resolved;
  // `manifest.ts`'s own reader, not a second copy of it: the key and the
  // "empty string is not a URL" rule belong with the code that writes them.
  const remembered = readRemembered(safeLocalStorage());
  if (remembered !== null) return remembered;
  return basemapUrl(import.meta.env as unknown as Record<string, string | undefined>);
}

/**
 * `localStorage`, or nothing.
 *
 * Touching it THROWS outright in some privacy modes -- not on the read, on the
 * PROPERTY ACCESS -- so it cannot be handed straight to anything. `MapCanvas`
 * carries the same three lines for the same reason.
 */
function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** True when the reader has asked the platform for less movement. */
function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

export function MiniMap({ lat, lon, facings, credited = false }: MiniMapProps): ReactElement {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ground, setGround] = useState<MiniMapGround>('pending');

  const view = useMapView();
  // Read from the build and from the restyle, neither of which is a render.
  const viewRef = useRef(view);
  viewRef.current = view;
  const archive = useRef<string | null>(null);
  const position = useRef({ lat, lon });
  position.current = { lat, lon };

  // --- build once ----------------------------------------------------------
  useEffect(() => {
    const element = holder.current;
    if (element === null || map.current !== null) return undefined;

    let cancelled = false;
    let instance: MapLibreMap | null = null;
    const url = miniArchive();
    archive.current = url;

    /**
     * DID ANYTHING ACTUALLY DRAW?
     *
     * `isSourceLoaded` answers "did the source finish", which is true of an
     * archive that returned nothing for this area -- the offline case this
     * caption exists for. The only honest test is the one the repo's own
     * render check uses: ask the map what it painted. Run on every `idle`, so
     * tiles that arrive late still correct a caption that gave up on them.
     */
    const settle = (): void => {
      if (cancelled || instance === null) return;
      if (url === null) {
        setGround('bare');
        return;
      }
      setGround(instance.queryRenderedFeatures().length > 0 ? 'ground' : 'bare');
    };

    const timer = setTimeout(() => {
      if (cancelled) return;
      setGround((current) => (current === 'pending' ? 'bare' : current));
    }, GROUND_TIMEOUT_MS);

    void (async () => {
      // The SHARED registration. A second `Protocol` would replace the live
      // handler and stop the scope's own source resolving -- see `mapStyle.ts`.
      if (url !== null && isPmtiles(url)) await ensurePmtilesProtocol();
      if (cancelled) return;

      try {
        instance = new maplibregl.Map({
          container: element,
          style: withoutLabels(
            styleFor(url, readPalette(element), currentMode(), viewRef.current),
          ) as maplibregl.StyleSpecification,
          center: [position.current.lon, position.current.lat],
          zoom: MINI_MAP_ZOOM,
          // A PICTURE. No handler is attached at all, so nothing here can eat
          // the scroll the card needs.
          interactive: false,
          /**
           * The attribution is in the CAPTION instead.
           *
           * ODbL is a condition of drawing these tiles, not a decoration, so it
           * is not dropped -- but MapLibre's own control is a 100px pill with a
           * link in it, and this box is 112px wide with a camera in the middle
           * of it. `GROUND_NOTE.ground` carries the credit as text the card
           * lays out itself.
           */
          attributionControl: false,
          /**
           * NOTHING FADES IN FOR SOMEBODY WHO ASKED FOR STILLNESS.
           *
           * MapLibre cross-fades labels over 300 ms by default. That is motion,
           * it is decorative, and `prefers-reduced-motion` is a request to stop
           * exactly this. The CSS does the same for the box itself.
           *
           * Spread rather than a ternary with `undefined`, because the option
           * is typed `number` and this build runs `exactOptionalPropertyTypes`:
           * absent and undefined are not the same value here.
           */
          ...(prefersReducedMotion() ? { fadeDuration: 0 } : {}),
        });
      } catch {
        // NO WEBGL AT ALL - a locked-down browser, a blocked context, a
        // harness. Not an error worth reporting to the driver: the mark and the
        // caption are the same two things they get in a dead zone.
        setGround('bare');
        return;
      }

      map.current = instance;
      // SWALLOWED, DELIBERATELY. MapLibre logs to the console when nothing is
      // listening, and a card opened over a dead zone would fill the console
      // the scope's own diagnostics are read from. The caption is this map's
      // way of reporting a failure, and `settle` decides it from what painted.
      instance.on('error', () => undefined);
      instance.on('idle', settle);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.current = null;
      // THE CONTEXT GOES BACK. A card is opened over and over; leaked WebGL
      // contexts hit the browser's ceiling and the oldest is dropped, which
      // would be the scope's.
      instance?.remove();
    };
    // Built once. The two effects below move it and restyle it in place.
  }, []);

  // --- where it looks ------------------------------------------------------
  // `jumpTo`, never `easeTo`: this is a still picture, and a card that flew
  // between cameras would be animating a fact rather than stating it.
  useEffect(() => {
    map.current?.jumpTo({ center: [lon, lat], zoom: MINI_MAP_ZOOM });
  }, [lat, lon]);

  // --- what it is drawn in -------------------------------------------------
  /**
   * THE CARD FOLLOWS THE SAME CARTOGRAPHY AS THE SCOPE.
   *
   * Both halves matter. `mapView` is the driver's explicit choice and outranks
   * everything; `data-fwm-mode` is the theme, which `flavorForMode` maps onto a
   * flavour for anybody who left the choice on `auto`. `MapCanvas` watches the
   * attribute for exactly this reason and its comment records what happens when
   * a map ignores it: black cartography under light chrome, which reads as a
   * broken thumbnail rather than as a preference.
   *
   * No layers are re-added afterwards, unlike the scope's repaint: this map
   * owns no sources of its own, and the mark is DOM.
   */
  useEffect(() => {
    const restyle = (): void => {
      const instance = map.current;
      if (instance === null) return;
      instance.setStyle(
        withoutLabels(
          styleFor(archive.current, readPalette(holder.current), currentMode(), viewRef.current),
        ) as maplibregl.StyleSpecification,
        { diff: false },
      );
    };

    const root = globalThis.document?.documentElement ?? null;
    if (root === null) return undefined;
    const observer = new MutationObserver(restyle);
    observer.observe(root, { attributes: true, attributeFilter: ['data-fwm-mode'] });
    // The view prop changing IS a restyle; the observer only covers the theme.
    restyle();
    return () => {
      observer.disconnect();
    };
  }, [view]);

  return (
    <figure className="fwm-minimap" data-fwm-ground={ground}>
      <div className="fwm-minimap-canvas" ref={holder} aria-hidden="true" />
      <svg
        className="fwm-minimap-mark"
        viewBox={VIEW_BOX}
        role="img"
        aria-label={miniMapLabel(facings, ground)}
      >
        {facings.map((span) => (
          <path
            className="fwm-minimap-cone"
            key={`${String(span.fromDeg)}-${String(span.toDeg)}`}
            d={conePath(span, CONE_RADIUS)}
          />
        ))}
        {/* The camera itself, last, so no cone is drawn over it. */}
        <circle className="fwm-minimap-dot" cx={0} cy={0} r={4} />
      </svg>
      <figcaption className="fwm-minimap-note fwm-data">
        {(credited ? GROUND_NOTE_CREDITED : GROUND_NOTE)[ground]}
      </figcaption>
    </figure>
  );
}
