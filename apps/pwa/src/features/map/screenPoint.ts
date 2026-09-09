/**
 * WHERE A COORDINATE IS ON THE SCREEN RIGHT NOW, AS A SUBSCRIPTION.
 *
 * The intel card anchors above the reader it describes -- the way a map popover
 * does everywhere else a driver has seen one -- and a card that is anchored to a
 * point on the map has to move when the map does. Pan, pinch, rotate, tilt, a
 * resize on rotation: every one of them moves the pixel a lat/lon lands on, and
 * only the map knows the new one.
 *
 * `MapCanvas` owns the MapLibre instance and keeps it private, which is right:
 * nothing else should be calling `setStyle` or `flyTo`. So this module holds a
 * reference the canvas REGISTERS and lets a subscriber ask one narrow question of
 * it -- "project this point" -- and be told again whenever the answer changes.
 * The same shape as `app/mapEarth.ts` and `app/surface.ts`: module state, a
 * listener set, one watcher.
 *
 * NULL IS "OFF THE SCREEN OR NO MAP", and a subscriber is expected to draw
 * nothing anchored in that case rather than guess a position.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

type Listener = () => void;

let map: MapLibreMap | null = null;
const listeners = new Set<Listener>();

/** The events after which a projected pixel can differ. */
const MOVES = ['move', 'zoom', 'rotate', 'pitch', 'resize'] as const;

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/**
 * `MapCanvas` calls this once the instance exists, and again with `null` when
 * it is removed. Registering wires the move listeners; unregistering unwires
 * them, and every subscriber is told so it can stop drawing.
 */
export function registerMap(instance: MapLibreMap | null): void {
  if (map === instance) return;
  if (map !== null) for (const event of MOVES) map.off(event, notify);
  map = instance;
  if (map !== null) for (const event of MOVES) map.on(event, notify);
  notify();
}

/**
 * The pixel for a coordinate IN VIEWPORT SPACE, or null when there is no map or
 * the point is outside the map's box.
 *
 * Viewport rather than container coordinates on purpose: the card that anchors
 * to this lives in `.fwm-shell-layer`, a different absolutely-positioned box
 * from the map's, and the two are `inset: 0` of two different parents. Adding
 * the container's own rect here means a subscriber only has to subtract its
 * own, and neither has to know how the other is laid out.
 */
export function projectPoint(point: { readonly lat: number; readonly lon: number }): ScreenPoint | null {
  if (map === null) return null;
  const projected = map.project([point.lon, point.lat]);
  const container = map.getContainer().getBoundingClientRect();
  if (
    !Number.isFinite(projected.x) ||
    !Number.isFinite(projected.y) ||
    projected.x < 0 ||
    projected.y < 0 ||
    projected.x > container.width ||
    projected.y > container.height
  ) {
    return null;
  }
  return { x: container.left + projected.x, y: container.top + projected.y };
}

/** Be told whenever any projected pixel may have changed. */
/**
 * MOVE THE MAP TO LOOK AT A POINT, from outside the map.
 *
 * The dock's turn list is chrome, mounted by `app/ShellDock.tsx`, and a step
 * row there asks the map -- which is DRIVE's -- to go and look at that turn.
 * The registry already holds the one instance for `projectPoint`; this is the
 * one write it allows, and it is a camera move only. Nothing here touches
 * `panned`: `MapCanvas` reads that from DRIVE, and a caller that wants the map
 * to STAY where it was sent asks DRIVE to hold it first
 * (`features/drive/driveSignals.focusMapOn` does both, in that order).
 *
 * `easeTo` and not `flyTo`: a fly-to arcs out and back in over a second and a
 * half, and on a phone mounted on a dash that is a second and a half of the
 * road not being drawn. No zoom is written -- the driver's zoom is theirs.
 *
 * Returns whether there was a map to move, so a caller can tell a press that
 * did nothing from one that did.
 */
export function easeMapTo(point: { readonly lat: number; readonly lon: number }): boolean {
  if (map === null) return false;
  map.easeTo({ center: [point.lon, point.lat] });
  return true;
}

export function subscribeScreenPoints(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam. */
export function resetScreenPointsForTests(): void {
  if (map !== null) for (const event of MOVES) map.off(event, notify);
  map = null;
  listeners.clear();
}
