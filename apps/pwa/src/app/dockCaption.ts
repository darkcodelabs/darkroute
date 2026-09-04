/**
 * THE DOCK'S CAPTION LINE - what the current screen wants said under the keys.
 *
 * =============================================================================
 * WHY A CHANNEL AND NOT A PROP
 * =============================================================================
 * The zone line - `OVERLAND PARK · 15 CAMS · WITHIN 2 MI` - belongs to RADAR:
 * it is RADAR's data, computed from RADAR's cameras. It is DRAWN inside the
 * dock, sharing the dock's rounded panel and its hairline, because that is
 * where the design puts it and because a separate bar floating above the dock
 * is a third piece of chrome competing with two.
 *
 * Those two facts do not fit together as props. The dock is rendered by the
 * shell, not by the screen, so threading this through would mean the shell
 * knowing about zones, counties and camera counts - and every future screen's
 * caption after that. `App.tsx` deliberately takes its screens as a registry
 * so it never becomes the file every feature has to be edited into, and this
 * would undo exactly that.
 *
 * So it is a channel. A screen publishes a caption while it is mounted, the
 * dock renders whatever is published, and neither imports the other.
 *
 * =============================================================================
 * WHY IT CLEARS ITSELF
 * =============================================================================
 * A caption outliving its screen is the failure this shape invites: navigate
 * from RADAR to SETTINGS and the dock still says how many cameras are within
 * two miles, which is now a claim nobody is making. Publishers hand back a
 * disposer and `useDockCaption` calls it on unmount, so the line cannot survive
 * the screen that owns it.
 */

import { useSyncExternalStore } from 'react';

export interface DockCaption {
  /** Where you are. Empty renders nothing at all rather than an empty slot. */
  readonly place: string;
  /** How many cameras the zone holds. */
  readonly count: number;
  /** The radius the count was taken over, already worded: `WITHIN 2 MI`. */
  readonly within: string;
  /**
   * RADAR's alert state, so the count can be lit in the same hue the scope is.
   * `null` for a caption that has no state to carry.
   */
  readonly state: string | null;
}

let caption: DockCaption | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Publish the caption. Returns a disposer.
 *
 * The disposer only clears if this caption is still the published one: two
 * screens overlapping during a transition must not have the outgoing one wipe
 * the incoming one's line.
 */
export function setDockCaption(next: DockCaption | null): () => void {
  caption = next;
  emit();
  return () => {
    if (caption === next) {
      caption = null;
      emit();
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): DockCaption | null {
  return caption;
}

/** The caption the dock should draw, or null. */
export function useDockCaption(): DockCaption | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** For tests: forget whatever is published. */
export function clearDockCaption(): void {
  caption = null;
  emit();
}
