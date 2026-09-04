import { beforeEach, describe, expect, it } from 'vitest';

import type { NetworkState as AdapterNetworkState } from '../services/adapters';
import { networkActions, useNetworkStore } from './network.ts';

const ONLINE: AdapterNetworkState = {
  online: true,
  effectiveType: '4g',
  downlinkMbps: 10,
  rttMs: 50,
  saveData: false,
  connectionType: 'wifi',
  timestamp: 1_000_000,
};

const OFFLINE: AdapterNetworkState = { ...ONLINE, online: false, timestamp: 1_000_500 };

beforeEach(() => {
  networkActions.reset();
});

describe('online state', () => {
  it('starts optimistic so a cold start does not paint a banner over a working app', () => {
    expect(useNetworkStore.getState().online).toBe(true);
    expect(useNetworkStore.getState().reachable).toBeNull();
  });

  it('records what the adapter reported, including the unmetered verdict', () => {
    networkActions.ingest(ONLINE, true);
    const state = useNetworkStore.getState();
    expect(state.online).toBe(true);
    expect(state.unmetered).toBe(true);
    expect(state.effectiveType).toBe('4g');
    expect(state.connectionType).toBe('wifi');
  });

  it('drops through to offline, which the OFFLINE screen reads', () => {
    networkActions.ingest(OFFLINE, false);
    expect(useNetworkStore.getState().online).toBe(false);
    expect(useNetworkStore.getState().unmetered).toBe(false);
  });
});

describe('reachability', () => {
  it('is separate from onLine, because a captive portal reads as online', () => {
    networkActions.ingest(ONLINE, true);
    networkActions.noteReachability(false, 1_000_100);
    expect(useNetworkStore.getState().online).toBe(true);
    expect(useNetworkStore.getState().reachable).toBe(false);
  });

  it('forgets a stale verdict when the interface state itself changes', () => {
    networkActions.ingest(ONLINE, true);
    networkActions.noteReachability(true, 1_000_100);
    networkActions.ingest(OFFLINE, false);
    expect(useNetworkStore.getState().reachable).toBeNull();
  });

  it('keeps the verdict across samples that do not change the interface state', () => {
    networkActions.ingest(ONLINE, true);
    networkActions.noteReachability(true, 1_000_100);
    networkActions.ingest({ ...ONLINE, timestamp: 1_000_200 }, true);
    expect(useNetworkStore.getState().reachable).toBe(true);
  });
});

describe('unsupported platforms', () => {
  it('says so rather than claiming to be offline', () => {
    networkActions.markUnsupported('navigator.onLine is not available in this runtime');
    const state = useNetworkStore.getState();
    expect(state.supported).toBe(false);
    expect(state.online).toBe(true);
    expect(state.reason).toContain('navigator.onLine');
  });
});
