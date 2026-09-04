import { beforeEach, describe, expect, it } from 'vitest';

import { FEATURES } from '../config/features.ts';
import {
  PRESENCE_DISTANCE_PRECISION_MI,
  PRESENCE_EVENT_DELAY_MS,
  PresencePrivacyError,
  assertNoCoordinates,
  presenceActions,
  roundDistanceMi,
  usePresenceStore,
  type MeshEvent,
  type PresencePeer,
} from './presence.ts';

const PEER: PresencePeer = {
  id: 'ephemeral-1',
  handle: 'sixthstreet',
  distanceMi: 0.43,
  lastSeenMs: 1_000_000,
};

const EVENT: MeshEvent = {
  id: 'ev-1',
  kind: 'in_range',
  handle: null,
  distanceMi: 1.14,
  atMs: 1_000_000,
  cameraId: 'FWM-0442',
};

beforeEach(() => {
  presenceActions.reset();
});

describe('assertNoCoordinates', () => {
  it('accepts a peer that carries only a distance', () => {
    expect(() => {
      assertNoCoordinates([PEER]);
    }).not.toThrow();
  });

  it('refuses anything that could locate another driver', () => {
    for (const leak of [
      { lat: 39.0997 },
      { lon: -84.5786 },
      { latitude: 39.0997 },
      { coords: { x: 1 } },
      { geohash: 'dpsc' },
      { headingDeg: 41 },
      { path: [] },
      { plate: 'HVK 8842' },
    ]) {
      expect(() => {
        assertNoCoordinates({ ...PEER, ...leak });
      }).toThrow(PresencePrivacyError);
    }
  });

  it('finds a coordinate nested inside an event', () => {
    expect(() => {
      assertNoCoordinates([{ ...EVENT, meta: { position: { lat: 1, lon: 2 } } }]);
    }).toThrow(PresencePrivacyError);
  });
});

describe('roundDistanceMi', () => {
  it('rounds to a tenth of a mile, the way the feed is specified', () => {
    expect(PRESENCE_DISTANCE_PRECISION_MI).toBe(0.1);
    expect(roundDistanceMi(0.43)).toBe(0.4);
    expect(roundDistanceMi(1.16)).toBe(1.2);
    expect(roundDistanceMi(2.56)).toBe(2.6);
    // Exact halves land on the coarser answer, which is the safe direction.
    expect(roundDistanceMi(2.55)).toBe(2.5);
  });

  it('never returns a negative or a non-finite distance', () => {
    expect(roundDistanceMi(-3)).toBe(0);
    expect(roundDistanceMi(Number.NaN)).toBe(0);
  });

  it('states the upstream delay rather than implying live positions', () => {
    expect(PRESENCE_EVENT_DELAY_MS).toBe(60_000);
  });
});

describe('the feature flag', () => {
  it('is off in this build, and the store says disabled rather than empty', () => {
    // A MESH screen rendering "0 HAKCERS NEARBY" would be claiming to have
    // looked. There is no backend to look at yet.
    expect(FEATURES.presence).toBe(false);
    expect(usePresenceStore.getState().availability).toBe('disabled');
    // The reason is shown to a driver, so it says what is true for THEM -
    // nobody is shown, nobody sees you - rather than describing our backlog.
    expect(usePresenceStore.getState().reason).toContain('presence is off');
    expect(usePresenceStore.getState().reason).not.toContain('build');
  });

  it('refuses to accept peers while the feature is off', () => {
    presenceActions.ingest([PEER], [EVENT], 14, 1_000_000);
    const state = usePresenceStore.getState();
    expect(state.availability).toBe('disabled');
    expect(state.peers).toHaveLength(0);
    expect(state.nearbyCount).toBe(0);
  });
});
