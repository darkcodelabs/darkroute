/**
 * NETWORK - online/offline plus connection quality when the browser offers it.
 *
 * Drives the OFFLINE strip ("cached cameras only"), the sync-on-wifi rule for
 * queued reports ("2 REPORTS QUEUED · SYNC ON WIFI") and the decision to hold a
 * tile fetch rather than burn a metered connection.
 *
 * HONESTY
 *   `navigator.onLine` only means "the OS thinks an interface is up". It says
 *   nothing about whether the API is reachable, and it is famously true on a
 *   captive-portal wifi that serves nothing. The value is reported as what it
 *   is; anything that needs certainty must make a request and find out.
 *   Network Information (`effectiveType`, `saveData`, `type`) is Chromium-only,
 *   so those fields are null elsewhere and the reason says so.
 */

import { createCore, createListenerBag, numberOrNull } from './core';
import { globalValue, nav, no, ok, type Adapter, type Capability } from './types';

export type EffectiveConnectionType = 'slow-2g' | '2g' | '3g' | '4g';

export interface NetworkState {
  /** What the OS claims. Never proof that anything is reachable. */
  readonly online: boolean;
  readonly effectiveType: EffectiveConnectionType | null;
  readonly downlinkMbps: number | null;
  readonly rttMs: number | null;
  /** True when the user has asked the OS for reduced data use. */
  readonly saveData: boolean | null;
  /** 'wifi' | 'cellular' | 'ethernet' | ... when the browser reports it. */
  readonly connectionType: string | null;
  readonly timestamp: number;
}

export interface NetworkAdapter extends Adapter<NetworkState> {
  /** True when the connection is good enough to sync a queued report. */
  isUnmetered(): boolean;
}

interface ConnectionLike extends EventTarget {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
}

function connection(): ConnectionLike | undefined {
  const navigator = nav() as unknown as { connection?: ConnectionLike } | undefined;
  return navigator?.connection;
}

const EFFECTIVE_TYPES: readonly string[] = ['slow-2g', '2g', '3g', '4g'];

export function networkCapability(): Capability {
  const navigator = nav();
  if (navigator === undefined) return no('no navigator in this runtime');
  if (typeof navigator.onLine !== 'boolean') {
    return no('navigator.onLine is not available in this runtime');
  }
  return ok();
}

/** Separate probe: the coarse online flag works everywhere, the detail does not. */
export function connectionDetailCapability(): Capability {
  if (connection() === undefined) {
    return no('the Network Information API is not available in this browser');
  }
  return ok();
}

export function readNetworkState(atMs: number): NetworkState {
  const navigator = nav();
  const conn = connection();
  const effective = typeof conn?.effectiveType === 'string' ? conn.effectiveType : null;
  return {
    online: navigator?.onLine !== false,
    effectiveType:
      effective !== null && EFFECTIVE_TYPES.includes(effective)
        ? (effective as EffectiveConnectionType)
        : null,
    downlinkMbps: numberOrNull(conn?.downlink),
    rttMs: numberOrNull(conn?.rtt),
    saveData: typeof conn?.saveData === 'boolean' ? conn.saveData : null,
    connectionType: typeof conn?.type === 'string' ? conn.type : null,
    timestamp: atMs,
  };
}

export function createNetworkAdapter(): NetworkAdapter {
  const core = createCore<NetworkState>();
  const listeners = createListenerBag();

  const sample = (): void => {
    core.emit(readNetworkState(Date.now()));
  };

  return {
    name: 'network',

    capability: networkCapability,

    /** Idempotent. Emits once immediately so a subscriber is never blind. */
    start(): void {
      const capability = networkCapability();
      if (!capability.supported) {
        core.fail('unsupported', capability.reason ?? 'network state is not available');
        return;
      }
      if (core.running()) return;
      core.setRunning(true);
      const target = globalValue<EventTarget>('window');
      listeners.on(target, 'online', sample);
      listeners.on(target, 'offline', sample);
      listeners.on(connection(), 'change', sample);
      sample();
    },

    /** Idempotent. */
    stop(): void {
      listeners.removeAll();
      core.setRunning(false);
    },

    current: core.current,
    error: core.error,
    subscribe: core.subscribe,

    isUnmetered(): boolean {
      const state = core.current() ?? readNetworkState(Date.now());
      if (!state.online) return false;
      if (state.saveData === true) return false;
      if (state.connectionType === 'wifi' || state.connectionType === 'ethernet') return true;
      // No detail available: refuse to guess that a cellular link is free.
      return false;
    },
  };
}
