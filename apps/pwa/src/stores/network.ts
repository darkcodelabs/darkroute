/**
 * NETWORK - online, offline, and how honest that claim is.
 *
 * "OFFLINE · NO NETWORK · RUNNING ON CACHE" is a first-class screen (A2), not
 * an error state, and the OFFLINE banner is 28px of permanent chrome. This
 * slice is what turns them on.
 *
 * `navigator.onLine` IS A CLAIM, NOT PROOF
 *   The platform reports whether a network interface exists, not whether
 *   anything is reachable - a captive portal, a dead cell site and an airplane
 *   all read as "online". So {@link NetworkState.online} is named for what it
 *   is, and {@link NetworkActions.noteReachability} lets the code that actually
 *   made a request record what really happened. Nothing in this slice pings
 *   anything: a store that generates traffic to find out if it has traffic is
 *   a battery bug.
 *
 * WHAT DEPENDS ON THIS
 *   The queued-evidence sync holds on a metered link ("SYNC ON WIFI"), the mesh
 *   feed goes dark, and ASK - which needs the model - is honestly unavailable.
 *   Alerts from cached cameras keep working, which is the point of the product.
 */

import { create } from 'zustand';

import type { EffectiveConnectionType, NetworkState as AdapterNetworkState } from '../services/adapters';

export type { EffectiveConnectionType };

export interface NetworkState {
  /** What the OS claims. Never proof that anything is reachable. */
  readonly online: boolean;
  /** True only when a real request has succeeded since the last failure. */
  readonly reachable: boolean | null;
  readonly effectiveType: EffectiveConnectionType | null;
  readonly saveData: boolean | null;
  readonly connectionType: string | null;
  /** Good enough to push queued evidence without costing the user money. */
  readonly unmetered: boolean;
  readonly changedAtMs: number | null;
  /** False when this platform cannot answer the question at all. */
  readonly supported: boolean;
  readonly reason: string | null;
}

export interface NetworkActions {
  /** One sample from the network adapter, plus its unmetered verdict. */
  ingest(state: AdapterNetworkState, unmetered: boolean): void;
  /** A real request succeeded or failed. The only evidence of reachability. */
  noteReachability(reachable: boolean, atMs: number): void;
  markUnsupported(reason: string): void;
  reset(): void;
}

export type NetworkStore = NetworkState & NetworkActions;

const INITIAL_STATE: NetworkState = Object.freeze({
  // Optimistic by design: the product's first act is to try to fetch tiles, and
  // starting in the OFFLINE state would put a banner over a working app on
  // every cold start. The first adapter sample corrects this within a frame.
  online: true,
  reachable: null,
  effectiveType: null,
  saveData: null,
  connectionType: null,
  unmetered: false,
  changedAtMs: null,
  supported: true,
  reason: null,
});

export function createNetworkStore() {
  return create<NetworkStore>()((set, get) => ({
    ...INITIAL_STATE,

    ingest(state, unmetered) {
      const previous = get();
      set({
        online: state.online,
        // Going offline invalidates a previous success; coming back online is
        // not itself evidence of anything, so reachability resets to unknown.
        reachable: state.online === previous.online ? previous.reachable : null,
        effectiveType: state.effectiveType,
        saveData: state.saveData,
        connectionType: state.connectionType,
        unmetered,
        changedAtMs: state.timestamp,
        supported: true,
        reason: null,
      });
    },

    noteReachability(reachable, atMs) {
      set({ reachable, changedAtMs: atMs });
    },

    markUnsupported(reason) {
      set({ supported: false, reason, online: true, reachable: null });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const useNetworkStore = createNetworkStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useIsOnline = (): boolean => useNetworkStore((s) => s.online);

/** Drives the OFFLINE banner and the A2 screen. */
export const useIsOffline = (): boolean => useNetworkStore((s) => !s.online);

/** "SYNC ON WIFI" - whether queued evidence may go now. */
export const useIsUnmetered = (): boolean => useNetworkStore((s) => s.unmetered);

export const useEffectiveConnectionType = (): EffectiveConnectionType | null =>
  useNetworkStore((s) => s.effectiveType);

export const useSaveData = (): boolean | null => useNetworkStore((s) => s.saveData);

/** Null means nothing has been tried since the last change. */
export const useIsReachable = (): boolean | null => useNetworkStore((s) => s.reachable);

export const useNetworkSupported = (): boolean => useNetworkStore((s) => s.supported);

export const networkActions = {
  ingest: (state: AdapterNetworkState, unmetered: boolean): void => {
    useNetworkStore.getState().ingest(state, unmetered);
  },
  noteReachability: (reachable: boolean, atMs: number): void => {
    useNetworkStore.getState().noteReachability(reachable, atMs);
  },
  markUnsupported: (reason: string): void => {
    useNetworkStore.getState().markUnsupported(reason);
  },
  reset: (): void => {
    useNetworkStore.getState().reset();
  },
};
