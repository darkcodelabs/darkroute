/**
 * TWO THINGS THE SHELL CAN ASK DRIVE TO DO, and one fact DRIVE reports back.
 *
 * =============================================================================
 * WHY A MODULE AND NOT A PROP
 * =============================================================================
 * DRIVE owns two pieces of transient state that a control outside its subtree
 * needs to press on:
 *
 *   `mapPanelOpen`  the Layers panel. Its portrait opener is a chip under the
 *                   bar, inside DRIVE. Its landscape opener is the second
 *                   circle of the right rail, inside `.fwm-shell-dock` ->
 *                   `ShellDock` -> `LandscapeChrome`.
 *   `panned`        whether the map is following the car. A step row in the
 *                   dock's turn list asks the map to go and look at that turn,
 *                   and a map that is still following would ease straight back
 *                   to the car on the next fix.
 *
 * Neither opener is an ancestor of the other, and lifting either state into
 * `App.tsx` would put it in a component that mounts and unmounts on every
 * screen change. So, the shape `features/search/searchRaise.ts` and
 * `app/screenState.onScreenReselected` already use for this class of problem:
 * a module-level listener set DRIVE subscribes to while mounted. Nothing here
 * holds the state; DRIVE still does. This is only the wire.
 *
 * `layersOpen` IS published rather than requested, the other direction, so the
 * landscape circle can draw lit while the panel it opened is up.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;
type PointListener = (point: MapFocus) => void;

/** Somewhere on the map the shell wants looked at. */
export interface MapFocus {
  readonly lat: number;
  readonly lon: number;
}

const layersListeners = new Set<Listener>();
const focusListeners = new Set<PointListener>();
const openListeners = new Set<Listener>();
let layersOpen = false;

/** DRIVE subscribes: the Layers panel was asked to toggle. */
export function onLayersToggle(listener: Listener): () => void {
  layersListeners.add(listener);
  return () => {
    layersListeners.delete(listener);
  };
}

/** The shell asks: toggle the Layers panel. A no-op when DRIVE is not mounted. */
export function toggleLayers(): void {
  for (const listener of [...layersListeners]) listener();
}

/** DRIVE subscribes: the shell wants the map to go and look somewhere. */
export function onMapFocus(listener: PointListener): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** The shell asks: hold the map and move it to this point. */
export function focusMapOn(point: MapFocus): void {
  for (const listener of [...focusListeners]) listener(point);
}

/** DRIVE reports: the Layers panel is up, or is not. */
export function publishLayersOpen(open: boolean): void {
  if (open === layersOpen) return;
  layersOpen = open;
  for (const listener of [...openListeners]) listener();
}

function subscribeOpen(listener: Listener): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

function snapshotOpen(): boolean {
  return layersOpen;
}

function serverOpen(): boolean {
  return false;
}

/** Whether the Layers panel is up, for a control outside DRIVE to draw from. */
export function useLayersOpen(): boolean {
  return useSyncExternalStore(subscribeOpen, snapshotOpen, serverOpen);
}

/** Test-only. One test's listeners must not hear the next test's presses. */
export function resetDriveSignalsForTests(): void {
  layersListeners.clear();
  focusListeners.clear();
  openListeners.clear();
  layersOpen = false;
}
