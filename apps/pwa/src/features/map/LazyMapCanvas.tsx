/**
 * THE MAP, LOADED WHEN A SCREEN ACTUALLY DRAWS ONE.
 *
 * =============================================================================
 * WHY
 * =============================================================================
 * `maplibre-gl` plus `pmtiles` is 917 KB of the bundle. It was statically
 * imported into the boot path, so every visitor downloaded, parsed and compiled
 * the entire WebGL map engine before the first pixel of UI appeared - including
 * on ONBOARDING, which is the first screen a new install sees and draws no map
 * at all.
 *
 * `React.lazy` moves that behind the render that needs it. Onboarding, SETTINGS,
 * LOOK UP, the docs screens and everything else now paint without waiting for
 * it; DRIVE and RADAR pay for it, which is correct, because they are the
 * screens made of it.
 *
 * =============================================================================
 * THE FALLBACK IS THE MAP'S OWN GROUND, NOT A SPINNER
 * =============================================================================
 * A spinner over the map area would be a second loading language on a screen
 * that already has one - the scope draws its own earth colour while tiles
 * arrive, and has since it was written. So the fallback is that same ground,
 * which makes the handover invisible: the box is the right colour before the
 * map exists and stays the right colour after, and only the roads appear.
 *
 * =============================================================================
 * WHAT THIS MUST NOT DO
 * =============================================================================
 * Delay an ALERT. `packages/core` computes distance and the alert state with no
 * map involved whatsoever, and DRIVE's card, haptics and notifications are
 * driven from the store rather than from anything on this canvas. A driver
 * whose map is still loading is still being warned - that is the whole reason
 * the engine was kept independent of the renderer, and it is what makes
 * deferring the renderer safe.
 */

import { Suspense, lazy } from 'react';
import type { ComponentProps, ReactElement } from 'react';

import type { MapCanvas as MapCanvasType } from './MapCanvas.tsx';

import './map.css';

/*
 * Named export, so the dynamic import has to pick it out. `React.lazy` wants a
 * module with a default export and `MapCanvas.tsx` deliberately has none - the
 * repo's rule is that a default export is a name nothing can check.
 */
const MapCanvasLazy = lazy(async () => {
  const module = await import('./MapCanvas.tsx');
  return { default: module.MapCanvas };
});

export type LazyMapCanvasProps = ComponentProps<typeof MapCanvasType>;

export function LazyMapCanvas(props: LazyMapCanvasProps): ReactElement {
  return (
    <Suspense
      fallback={
        /* The scope's own earth colour. See the note above: this is the same
           ground MapLibre paints under its tiles, so nothing flashes when the
           real canvas replaces it. `aria-hidden` because a map that has not
           loaded has nothing to announce, and the alert state a driver
           actually needs is announced from the card, not from here. */
        <div className="fwm-map-canvas fwm-map-canvas-pending" aria-hidden="true" />
      }
    >
      <MapCanvasLazy {...props} />
    </Suspense>
  );
}
