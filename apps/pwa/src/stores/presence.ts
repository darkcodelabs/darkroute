/**
 * PRESENCE - other DarkRoute, as distances and nothing else.
 *
 * "14 HAKCERS NEARBY · DISTANCE ONLY · NO COORDINATES SHARED"
 * "Events are rounded to 0.1 mi and delayed 60s. No path, no plate, no
 *  timestamp precision." - Flockys Screens II.dc.html, A5 · MESH FEED
 *
 * PRIVACY IS THE DATA MODEL HERE, NOT A FILTER OVER IT
 *   A peer's exact position is not something this slice rounds - it is
 *   something this slice cannot represent. {@link PresencePeer} has a distance
 *   and no coordinate, and {@link assertNoCoordinates} refuses any incoming
 *   payload that carries one, so a backend that started leaking lat/lon would
 *   fail loudly here instead of quietly drawing a stranger's house on SWEEP.
 *   Distances are re-rounded on the way in even though the server is supposed
 *   to have rounded them: two independent roundings cost nothing, and trusting
 *   a remote party to have protected a local user is not a security model.
 *
 * THE FEATURE IS OFF
 *   `FEATURES.presence` is false - the Durable Objects backend does not exist
 *   yet. This slice therefore reports `disabled` rather than an empty feed: a
 *   MESH screen that renders "0 HAKCERS NEARBY" would be claiming to have
 *   looked. Nothing here fabricates a peer, and there is no demo mode.
 */

import { create } from 'zustand';

import { FEATURES } from '../config/features.ts';

/** Why the feed is or is not showing anything. `live` is the only good one. */
export type PresenceAvailability =
  /** The build has presence switched off. Not "nobody is nearby". */
  | 'disabled'
  /** No network. The feed is one of the things OFFLINE explicitly loses. */
  | 'offline'
  /** The backend is reachable but refused or failed. */
  | 'unavailable'
  /** Connected, and what is below is current. */
  | 'live';

/** A nearby Flocky. There is no coordinate in this type, on purpose. */
export interface PresencePeer {
  /** Ephemeral, server-issued. NOT the session id, and not stable across days. */
  readonly id: string;
  /** Display handle without the `@`, or null for "anonymous". */
  readonly handle: string | null;
  /** Miles, rounded to {@link PRESENCE_DISTANCE_PRECISION_MI}. */
  readonly distanceMi: number;
  readonly lastSeenMs: number;
}

/** One row of the MESH feed. */
export type MeshEventKind = 'in_range' | 'reported' | 'confirmed' | 'disputed';

export interface MeshEvent {
  readonly id: string;
  readonly kind: MeshEventKind;
  readonly handle: string | null;
  readonly distanceMi: number;
  /** Already delayed upstream by {@link PRESENCE_EVENT_DELAY_MS}. */
  readonly atMs: number;
  /** The camera an event is about, when it is about one. Never a plate. */
  readonly cameraId: string | null;
}

/** "rounded to 0.1 mi" - A5. */
export const PRESENCE_DISTANCE_PRECISION_MI = 0.1;
/** "delayed 60s" - A5. Recorded so a screen can say so honestly. */
export const PRESENCE_EVENT_DELAY_MS = 60_000;

/** Raised when an incoming payload carries something it must not. */
export class PresencePrivacyError extends Error {
  override readonly name = 'PresencePrivacyError';
}

/**
 * Field names that may never appear on a peer or an event.
 *
 * Matched on the key with separators stripped, so `lat_deg`, `latDeg` and
 * `LAT-DEG` are the same name.
 */
const FORBIDDEN_FIELDS: readonly string[] = [
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'coord',
  'coords',
  'coordinate',
  'coordinates',
  'position',
  'geometry',
  'geohash',
  'bearing',
  'heading',
  'plate',
  'route',
  'path',
  'track',
];

function flattenKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Refuse anything that could locate a peer.
 *
 * Exported so a transport layer can run it at the wire before this slice ever
 * sees the payload, and so it can be asserted directly in a test.
 */
export function assertNoCoordinates(value: unknown, path = 'peer'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertNoCoordinates(value[i], `${path}[${String(i)}]`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const flat = flattenKey(key);
    if (FORBIDDEN_FIELDS.some((needle) => flat === needle || flat.startsWith(needle))) {
      throw new PresencePrivacyError(
        `refusing presence payload: ${path}.${key} could locate another driver. ` +
          'Presence carries a rounded distance and nothing else.',
      );
    }
    assertNoCoordinates(child, `${path}.${key}`);
  }
}

/**
 * Round to a tenth of a mile. Applied on the way in, every time, even though
 * the server is supposed to have done it already.
 *
 * Exact halves are not worth reasoning about here: 2.55 is not representable in
 * binary floating point and lands on 2.5, which is the coarser answer and
 * therefore the safe direction to be wrong in.
 */
export function roundDistanceMi(distanceMi: number): number {
  if (!Number.isFinite(distanceMi) || distanceMi < 0) return 0;
  return Number(distanceMi.toFixed(1));
}

export interface PresenceState {
  readonly availability: PresenceAvailability;
  /** "14 HAKCERS NEARBY". Server-reported; peers below may be a subset. */
  readonly nearbyCount: number;
  readonly peers: readonly PresencePeer[];
  /** Newest first. */
  readonly events: readonly MeshEvent[];
  readonly updatedAtMs: number | null;
  /** A sentence for the UI when `availability` is not `live`. */
  readonly reason: string | null;
}

export interface PresenceActions {
  /** @throws PresencePrivacyError when a payload carries a coordinate. */
  ingest(
    peers: readonly PresencePeer[],
    events: readonly MeshEvent[],
    nearbyCount: number,
    atMs: number,
  ): void;
  markOffline(): void;
  markUnavailable(reason: string): void;
  reset(): void;
}

export type PresenceStore = PresenceState & PresenceActions;

const NO_PEERS: readonly PresencePeer[] = Object.freeze([]);
const NO_EVENTS: readonly MeshEvent[] = Object.freeze([]);

const DISABLED_REASON =
  'presence is off. no other drivers are shown, and none can see you.';

const INITIAL_STATE: PresenceState = Object.freeze({
  availability: FEATURES.presence ? 'unavailable' : 'disabled',
  nearbyCount: 0,
  peers: NO_PEERS,
  events: NO_EVENTS,
  updatedAtMs: null,
  reason: FEATURES.presence ? null : DISABLED_REASON,
});

export function createPresenceStore() {
  return create<PresenceStore>()((set) => ({
    ...INITIAL_STATE,

    ingest(peers, events, nearbyCount, atMs) {
      if (!FEATURES.presence) {
        // Not an error the user caused, and not something to render as a feed.
        // The flag is off; accepting data would put peers on a screen the
        // product has decided not to ship yet.
        set({ availability: 'disabled', reason: DISABLED_REASON });
        return;
      }
      assertNoCoordinates(peers, 'peers');
      assertNoCoordinates(events, 'events');
      set({
        availability: 'live',
        nearbyCount,
        peers: Object.freeze(
          peers.map((peer) => ({ ...peer, distanceMi: roundDistanceMi(peer.distanceMi) })),
        ),
        events: Object.freeze(
          events.map((event) => ({ ...event, distanceMi: roundDistanceMi(event.distanceMi) })),
        ),
        updatedAtMs: atMs,
        reason: null,
      });
    },

    markOffline() {
      if (!FEATURES.presence) return;
      // "NO mesh feed, other darkroute" - A2 · OFFLINE lists this as lost.
      set({
        availability: 'offline',
        peers: NO_PEERS,
        events: NO_EVENTS,
        nearbyCount: 0,
        reason: 'no network: the mesh feed is one of the things that stops working offline',
      });
    },

    markUnavailable(reason) {
      if (!FEATURES.presence) return;
      set({ availability: 'unavailable', peers: NO_PEERS, events: NO_EVENTS, nearbyCount: 0, reason });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },
  }));
}

export const usePresenceStore = createPresenceStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const usePresenceAvailability = (): PresenceAvailability =>
  usePresenceStore((s) => s.availability);

export const useIsPresenceLive = (): boolean =>
  usePresenceStore((s) => s.availability === 'live');

/** "14 HAKCERS NEARBY". Zero when nothing is live - and the screen must say why. */
export const useNearbyDarkrouteCount = (): number => usePresenceStore((s) => s.nearbyCount);

export const useNearbyPeers = (): readonly PresencePeer[] => usePresenceStore((s) => s.peers);

export const useMeshEvents = (): readonly MeshEvent[] => usePresenceStore((s) => s.events);

export const usePresenceReason = (): string | null => usePresenceStore((s) => s.reason);

export const presenceActions = {
  ingest: (
    peers: readonly PresencePeer[],
    events: readonly MeshEvent[],
    nearbyCount: number,
    atMs: number,
  ): void => {
    usePresenceStore.getState().ingest(peers, events, nearbyCount, atMs);
  },
  markOffline: (): void => {
    usePresenceStore.getState().markOffline();
  },
  markUnavailable: (reason: string): void => {
    usePresenceStore.getState().markUnavailable(reason);
  },
  reset: (): void => {
    usePresenceStore.getState().reset();
  },
};
