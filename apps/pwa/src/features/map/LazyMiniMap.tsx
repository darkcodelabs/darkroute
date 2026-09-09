/**
 * THE CARD THUMBNAIL, LOADED WHEN A CARD DRAWS ONE.
 *
 * `MiniMap` builds its own MapLibre instance, so importing it statically keeps
 * the whole 917 KB map engine in the entry graph - and DRIVE imports it for the
 * closest-camera card, which put it on the boot path of every visitor
 * including ones who never see a card.
 *
 * Deferring it is what actually takes maplibre off the critical path: with only
 * `MapCanvas` lazy, Vite still emitted a `modulepreload` for the chunk because
 * this import kept it reachable from the entry.
 *
 * The fallback is a box of the same ground and the same size, so the card does
 * not reflow when the picture arrives. `miniMap.css` owns the geometry; this
 * borrows the canvas class rather than restating any of it.
 */

import { Suspense, lazy } from 'react';
import type { ComponentProps, ReactElement } from 'react';

import type { MiniMap as MiniMapType } from './MiniMap.tsx';

import './miniMap.css';

const MiniMapLazy = lazy(async () => {
  const module = await import('./MiniMap.tsx');
  return { default: module.MiniMap };
});

export type LazyMiniMapProps = ComponentProps<typeof MiniMapType>;

export function LazyMiniMap(props: LazyMiniMapProps): ReactElement {
  return (
    <Suspense
      fallback={
        /* Same box, same ground, no reflow. `aria-hidden` because a picture
           that has not loaded has nothing to describe - the distance and the
           facing are stated in text beside it either way. */
        <figure className="fwm-minimap" aria-hidden="true">
          <div className="fwm-minimap-canvas" />
        </figure>
      }
    >
      <MiniMapLazy {...props} />
    </Suspense>
  );
}
