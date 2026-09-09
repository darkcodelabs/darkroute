/**
 * OFFLINE -- the screen that says which half of the product is still real.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `A2 · OFFLINE - DEGRADED`.
 *
 * =============================================================================
 * THIS FILE IS WIRING
 * =============================================================================
 * Every value below is a store selector or the one cache read in `cache.ts`.
 * This file:
 *
 *   - computes no distance, no bearing and no direction. The hero shows the
 *     same nearest camera RADAR shows, composed through RADAR's own
 *     `directionLine` AND gated by RADAR's own `hasLiveDistance`, so the two
 *     screens can never disagree about what is ahead -- including in the states
 *     where the honest answer is a sentence rather than a number. See
 *     `hero.ts`.
 *   - resolves no capability by hand. `capabilities.ts` does that, from
 *     network, presence and storage facts.
 *   - calls no browser API except `Date.now()` (injectable) and IndexedDB,
 *     through the repositories, read-only.
 *   - requests no permission, starts no sensor, and sends nothing anywhere.
 *
 * =============================================================================
 * WHY THE CACHE IS RE-READ WHEN THE NETWORK CHANGES
 * =============================================================================
 * A network transition is the one moment the tile cache can change underneath
 * this screen: coming back online is what lets the sync refill it. Re-reading
 * on that edge costs a handful of index reads against a store capped at 512
 * rows, and the alternative is a counter that keeps reporting an empty cache
 * after the cache has been filled.
 *
 * =============================================================================
 * NOTHING LEAVES THE DEVICE
 * =============================================================================
 * No plate, no coordinate and no count is uploaded, logged or put in the URL.
 * `RETRY SYNC` is a prop: the queue belongs to the sync layer, and a build
 * that has not wired it renders the button the design draws, disabled, rather
 * than a live-looking control that silently does nothing.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  useAlertState,
  useCameraGeneration,
  useGpsStatus,
  useHeadingDeg,
  useIsClosing,
  useIsMuted,
  useIsOffline,
  useIsReachable,
  useLastFixAtMs,
  useLocationPermission,
  useMutePierced,
  useNearestCamera,
  usePresenceAvailability,
} from '../../stores';

import { resolveRadarGate, resolveRadarState } from '../radar/radarState.ts';

import { readOfflineCache } from './cache.ts';
import type { OfflineCachePort, OfflineCacheRead } from './cache.ts';
import { resolveCapabilities } from './capabilities.ts';
import type { StorageStatus } from './capabilities.ts';
import { resolveOfflineHero } from './hero.ts';
import { OfflineView } from './components/OfflineView.tsx';
import type { OfflineViewHandlers, OfflineViewModel } from './components/OfflineView.tsx';

import '../radar/radar.css';
import './offline.css';

export type OfflineScreenProps = OfflineViewHandlers & {
  /** The cache read. A test passes a fake; the app passes nothing. */
  readonly cachePort?: OfflineCachePort | undefined;
  /** Injectable clock. Used once, for the age of the oldest tile check. */
  readonly now?: (() => number) | undefined;
};

/** What the screen knows about the cache right now. Starts out: nothing. */
type CacheState = OfflineCacheRead | null;

function storageStatusOf(cache: CacheState): StorageStatus {
  if (cache === null) return 'unknown';
  return cache.status === 'ready' ? 'available' : 'unavailable';
}

/**
 * Why there is no storage, in the database layer's own words.
 *
 * Rendered, quietly, under the no-storage sentence. It is built in `cache.ts`
 * from that module's own constants and an `Error.message` raised by the
 * database layer, so it cannot carry a plate, a coordinate or a camera id --
 * and it is rendered and nothing else: never logged, never sent, never in the
 * URL.
 */
function storageReasonOf(cache: CacheState): string | null {
  if (cache === null || cache.status === 'ready') return null;
  return cache.reason;
}

export function OfflineScreen({
  cachePort = readOfflineCache,
  now = Date.now,
  ...handlers
}: OfflineScreenProps = {}): ReactElement {
  // --- connectivity --------------------------------------------------------
  const offline = useIsOffline();
  const reachable = useIsReachable();
  const presence = usePresenceAvailability();

  // --- the engine's answers, shared with RADAR -----------------------------
  const alertState = useAlertState();
  const nearest = useNearestCamera();
  const isClosing = useIsClosing();
  const headingDeg = useHeadingDeg();
  const gps = useGpsStatus();
  const locationPermission = useLocationPermission();
  const lastFixAtMs = useLastFixAtMs();
  const muted = useIsMuted();
  const mutePierced = useMutePierced();

  // --- the cache -----------------------------------------------------------
  const [cache, setCache] = useState<CacheState>(null);
  const workingGeneration = useCameraGeneration();

  useEffect(() => {
    let live = true;
    // Not cleared first: a re-read on a network edge must not blank the
    // counters back to ` - ` while the second read is in flight. The screen
    // keeps showing the last figure it actually obtained.
    void cachePort().then((read) => {
      if (live) setCache(read);
    });
    return () => {
      live = false;
    };
  }, [cachePort, offline]);

  const storage = storageStatusOf(cache);
  const storageReason = storageReasonOf(cache);
  const snapshot = cache !== null && cache.status === 'ready' ? cache.snapshot : null;
  const cachedCameras = snapshot?.cachedCameras ?? null;

  /**
   * DISK AND MEMORY CAN LEGITIMATELY DISAGREE, AND ONLY THIS FILE SEES BOTH.
   *
   * `sync.ts` admits a complete, twice-verified network generation to memory
   * even when the durable replacement conflicts, so the driver keeps getting
   * current warnings while the disk keeps the older coherent snapshot for the
   * next restart. That is the right trade and it is not free: the offline
   * capability this screen reports is the DISK's, one generation behind.
   *
   * Both halves are needed to see it, and they live in different layers -- the
   * sentinel comes out of the cache read, the working generation out of the
   * camera store -- so the comparison is made here and rendered as a sentence
   * rather than left for a driver to infer from two numbers that look fine.
   */
  const behindLiveGeneration =
    snapshot !== null &&
    snapshot.generation !== null &&
    workingGeneration !== null &&
    snapshot.generation !== workingGeneration;

  const radarInput = { alertState, gps, locationPermission, muted, mutePierced };
  const state = resolveRadarState(radarInput);
  const gate = resolveRadarGate(radarInput);

  // Read from the clock at render time rather than memoised against a captured
  // one: a value cached against a stale `now` would keep reporting the age the
  // database had when this screen opened.
  //
  // It does NOT tick on its own. There is no interval here, deliberately -- a
  // timer that re-renders a driving screen to advance a phrase quantised to
  // days is a wakeup an hour that buys nothing. The phrase advances the next
  // time anything else re-renders the screen, which on this product is the
  // next GPS tick.
  const ageSince = (stampMs: number | null): number | null =>
    stampMs === null ? null : Math.max(0, now() - stampMs);

  const dbAgeMs = ageSince(snapshot?.oldestCheckedAtMs ?? null);
  const cachedAgeMs = ageSince(snapshot?.oldestFetchedAtMs ?? null);
  const lastFixAgeMs = ageSince(lastFixAtMs);

  const capabilities = useMemo(
    () =>
      resolveCapabilities({
        online: !offline,
        reachable,
        presence,
        storage,
        cachedCameras,
      }),
    [offline, reachable, presence, storage, cachedCameras],
  );

  const model: OfflineViewModel = useMemo(
    () => ({
      offline,
      hero: resolveOfflineHero({
        state,
        gate,
        geolocationUnavailable: gps === 'unavailable' || locationPermission === 'unavailable',
        lastFixAgeMs,
        distanceFt: nearest?.distanceFt ?? null,
        direction: nearest?.relativeDirection ?? null,
        bearingDeg: nearest?.bearingDeg ?? null,
        headingDeg,
        isClosing,
        offline,
        cachedCameras,
        storage,
      }),
      capabilities,
      cachedCameras,
      cachedTiles: snapshot?.cachedTiles ?? null,
      dbAgeMs,
      cachedAgeMs,
      storage,
      storageReason,
      ...(snapshot === null ? {} : { incoherence: snapshot.incoherence }),
      behindLiveGeneration,
    }),
    [
      offline,
      behindLiveGeneration,
      nearest,
      state,
      gate,
      gps,
      locationPermission,
      lastFixAgeMs,
      headingDeg,
      isClosing,
      capabilities,
      snapshot,
      cachedCameras,
      dbAgeMs,
      cachedAgeMs,
      storage,
      storageReason,
    ],
  );

  return <OfflineView model={model} {...handlers} />;
}
