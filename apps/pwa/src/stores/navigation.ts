/**
 * NAVIGATION - a zustand view onto the one navigation model.
 *
 * There is no router in this product and there is no second source of truth for
 * "what is on screen". `app/screenState.ts` already owns that: the screen id,
 * the overlay stack, the one `?screen=` URL parameter, the history entries and
 * the alert save/restore. This slice does NOT reimplement any of it - it
 * mirrors that store into zustand so screens can use the same typed-selector
 * idiom they use for everything else, and its actions delegate straight back.
 *
 * Why mirror rather than replace: the alert takeover has to be able to move a
 * sheet aside from OUTSIDE React - a camera coming into range does not arrive
 * through a component tree - and the URL adapter has to stay in one file or the
 * "one query parameter, everything else preserved" contract stops being
 * checkable. Mirroring keeps both properties and costs one subscription.
 *
 * PRIVACY
 *   Nothing but a screen id from a closed list reaches the URL. Overlay state
 *   is an id and a kind with no payload, deliberately not deep-linkable: a URL
 *   is copied into history, synced across devices and pasted into chats, and
 *   plate values and watchlist entries must never reach any of those.
 */

import { create } from 'zustand';

import {
  closeOverlay as closeOverlayInScreenState,
  getScreenState,
  goBack as goBackInScreenState,
  interruptForAlert as interruptInScreenState,
  openOverlay as openOverlayInScreenState,
  openScreen as openScreenInScreenState,
  presentation as presentationOf,
  restoreAfterAlert as restoreInScreenState,
  subscribe as subscribeToScreenState,
  topOverlay as topOverlayOf,
} from '../app/screenState.ts';
import type {
  DockScreen,
  OpenScreenOptions,
  Overlay,
  Presentation,
  ScreenId,
  ScreenState,
} from '../app/screenState.ts';

export type { DockScreen, Overlay, Presentation, ScreenId };

export interface NavigationState {
  readonly screen: ScreenId;
  /** Bottom-to-top. Empty while an alert holds the stack aside. */
  readonly overlays: readonly Overlay[];
  /** Cached output, never recomputed by a component. Null during an alert. */
  readonly topOverlay: Overlay | null;
  /** What the shell must put in front of the driver. Cached, not derived. */
  readonly presentation: Presentation;
  readonly alertActive: boolean;
  /** The stack an alert moved aside. Empty when nothing was interrupted. */
  readonly savedOverlays: readonly Overlay[];
  readonly depth: number;
}

export interface NavigationActions {
  openScreen(screen: ScreenId, options?: OpenScreenOptions): void;
  openOverlay(overlay: Overlay): number;
  closeOverlay(id?: string): boolean;
  /** Android back. False means "we had nothing to unwind - let the OS have it". */
  back(): boolean;
  /**
   * Move the presented sheet/modal stack aside for a live camera alert.
   *
   * Idempotent: a second camera entering range during an alert must not
   * overwrite the saved stack with the (empty) current one.
   */
  saveForAlert(): boolean;
  /** Put the interrupted stack back, under anything opened during the alert. */
  restoreAfterAlert(): boolean;
  /** Re-read `app/screenState.ts`. Wired to its subscription; also for tests. */
  sync(): void;
}

export type NavigationStore = NavigationState & NavigationActions;

function snapshot(state: ScreenState): NavigationState {
  return {
    screen: state.screen,
    overlays: state.overlays,
    topOverlay: topOverlayOf(state),
    presentation: presentationOf(state),
    alertActive: state.alertActive,
    savedOverlays: state.savedOverlays,
    depth: state.depth,
  };
}

export function createNavigationStore() {
  const store = create<NavigationStore>()((set) => ({
    ...snapshot(getScreenState()),

    openScreen(screen, options) {
      openScreenInScreenState(screen, options ?? {});
    },

    openOverlay(overlay) {
      return openOverlayInScreenState(overlay);
    },

    closeOverlay(id) {
      return id === undefined ? closeOverlayInScreenState() : closeOverlayInScreenState(id);
    },

    back() {
      return goBackInScreenState();
    },

    saveForAlert() {
      return interruptInScreenState();
    },

    restoreAfterAlert() {
      return restoreInScreenState();
    },

    sync() {
      set(snapshot(getScreenState()));
    },
  }));

  // The bridge. `screenState` notifies synchronously, so a component rendered
  // during an alert reads the same snapshot the alert logic just wrote - no
  // tearing between the takeover layer and the dock.
  subscribeToScreenState(() => {
    store.setState(snapshot(getScreenState()));
  });

  return store;
}

export const useNavigationStore = createNavigationStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useScreen = (): ScreenId => useNavigationStore((s) => s.screen);
export const useTopOverlay = (): Overlay | null => useNavigationStore((s) => s.topOverlay);
export const useOverlays = (): readonly Overlay[] => useNavigationStore((s) => s.overlays);
export const usePresentation = (): Presentation => useNavigationStore((s) => s.presentation);
export const useSavedOverlays = (): readonly Overlay[] =>
  useNavigationStore((s) => s.savedOverlays);
export const useNavigationDepth = (): number => useNavigationStore((s) => s.depth);

/** Is this dock key the active one? A primitive, so the dock never re-renders wholesale. */
export const useIsScreenActive = (screen: ScreenId): boolean =>
  useNavigationStore((s) => s.screen === screen);

export const navigationActions = {
  openScreen: (screen: ScreenId, options?: OpenScreenOptions): void => {
    useNavigationStore.getState().openScreen(screen, options);
  },
  openOverlay: (overlay: Overlay): number => useNavigationStore.getState().openOverlay(overlay),
  closeOverlay: (id?: string): boolean => useNavigationStore.getState().closeOverlay(id),
  back: (): boolean => useNavigationStore.getState().back(),
  saveForAlert: (): boolean => useNavigationStore.getState().saveForAlert(),
  restoreAfterAlert: (): boolean => useNavigationStore.getState().restoreAfterAlert(),
  sync: (): void => {
    useNavigationStore.getState().sync();
  },
};
