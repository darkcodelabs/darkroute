/**
 * OFFLINE, as a pure function of a view model.
 *
 * `OfflineScreen.tsx` reads the stores and the cache; this file decides what is
 * on screen and in what order. Splitting them is what makes the empty cache,
 * the missing database and the network coming back individually renderable in
 * a test without a database or a fake `navigator`.
 *
 * =============================================================================
 * THE STACK, TOP TO BOTTOM -- `A2 · OFFLINE - DEGRADED`
 * =============================================================================
 *   52px header            `RADAR`, and the connectivity word on the right
 *   32px offline strip     `NO NETWORK · RUNNING ON CACHE`, amber, pulsing
 *   hero readout           `610` / `FT` / `CACHED CAMERA · AHEAD`, or the
 *                          sentence that replaces it when there is no distance
 *                          to draw -- gated exactly as RADAR gates it, in
 *                          `hero.ts`
 *   WHAT STILL WORKS       five resolved OK/NO rows
 *   two counters           `CACHED CAMS` / `MAP TILES`
 *   DB-age warning         amber left rule, one sentence of four
 *   RETRY SYNC             48px, at the bottom
 *
 * =============================================================================
 * FOUR OF THOSE SEVEN ARE IMPORTED, NOT REBUILT
 * =============================================================================
 * The amber strip is RADAR's `OfflineStrip`, the hero is RADAR's
 * `DistanceReadout`, the sentence that replaces the hero is RADAR's
 * `RadarMessage`, and the button is RADAR's `RadarAction`. They are the same
 * elements in both designs, they already carry the "digits never tween" rule
 * and the "an unwired control renders disabled" rule, and a second copy of any
 * of them is a second place for the offline treatment to drift.
 *
 * They read `--fwm-radar-*` locals off their nearest ancestor, so `offline.css`
 * declares those locals on `.fwm-offline` and pins the hue to amber -- which is
 * the colour A2 draws the direction line in.
 *
 * =============================================================================
 * ONE LIVE REGION FOR ONE FACT
 * =============================================================================
 * The amber strip is a `role="status"` carrying the whole connectivity
 * sentence, `NO NETWORK · RUNNING ON CACHE`. The header word is the same fact
 * in one word, so it is NOT a second live region: making it one queued two
 * announcements for every transition, and a driver using a screen reader would
 * hear the network state twice on mount and twice again on every flap.
 *
 * =============================================================================
 * THE CONNECTIVITY WORD IS READ FROM THE STORE, NOT ASSUMED
 * =============================================================================
 * A2 draws `OFFLINE`, because A2 is a picture of a phone with no network. This
 * screen can still be open when the network returns, and a header that went on
 * insisting `OFFLINE` over a working connection would be the same lie in the
 * other direction. `ONLINE` is the one word on this screen the design does not
 * draw.
 * GAP: see docs/gaps-inbox/offline.md#no-online-variant-of-a2
 */

import type { ReactElement } from 'react';

import { DistanceReadout } from '../../radar/components/DistanceReadout.tsx';
import { RadarAction } from '../../radar/components/RadarAction.tsx';
import { RadarMessage } from '../../radar/components/RadarMessage.tsx';
import { OfflineStrip } from '../../radar/components/RadarStrip.tsx';
import type { CacheIncoherence } from '../../../services/db';
import type { OfflineCapability, StorageStatus } from '../capabilities.ts';
import type { OfflineHero } from '../hero.ts';

import { CacheCounters } from './CacheCounters.tsx';
import { CacheNotice } from './CacheNotice.tsx';
import { CapabilityList } from './CapabilityList.tsx';

/** The label on the one action A2 draws. */
export const RETRY_SYNC_LABEL = 'RETRY SYNC';

export interface OfflineViewModel {
  /** The network slice's verdict. Drives the strip and the header word. */
  readonly offline: boolean;
  /**
   * The readout A2 draws, or the sentence that replaces it. Resolved in
   * `hero.ts` -- this file paints whichever arrived.
   */
  readonly hero: OfflineHero;
  readonly capabilities: readonly OfflineCapability[];
  /** Distinct cameras on disk, or null while the read is in flight. */
  readonly cachedCameras: number | null;
  readonly cachedTiles: number | null;
  /** Age of the oldest cached tile check, or null when there is no check. */
  readonly dbAgeMs: number | null;
  /** Age of the oldest tile fetch. The only age an unchecked cache has. */
  readonly cachedAgeMs: number | null;
  readonly storage: StorageStatus;
  /** The database layer's account of why there is no storage. */
  readonly storageReason: string | null;
  /**
   * Why rows on disk are not being counted, when some are not.
   *
   * The counters print what is USABLE, so this is what keeps a refused cache
   * from reading as a cache that was never filled.
   */
  readonly incoherence?: CacheIncoherence;
  /** True when the disk snapshot is older than the warnings running now. */
  readonly behindLiveGeneration?: boolean;
}

export interface OfflineViewHandlers {
  /**
   * Drain the queue and refetch tiles. Absent means "not wired in this build",
   * and `RadarAction` then renders the button the design draws, disabled.
   */
  readonly onRetrySync?: (() => void) | undefined;
}

export type OfflineViewProps = OfflineViewHandlers & {
  readonly model: OfflineViewModel;
};

export function OfflineView({ model, onRetrySync }: OfflineViewProps): ReactElement {
  const pending = model.storage === 'unknown';

  return (
    <section
      className="fwm-offline"
      data-fwm-offline-network={model.offline ? 'offline' : 'online'}
      data-fwm-offline-storage={model.storage}
      aria-label="offline"
    >
      <header className="fwm-offline-header">
        <span className="fwm-offline-title">RADAR</span>
        {/* Not a live region -- see "ONE LIVE REGION FOR ONE FACT" above. */}
        <span className="fwm-offline-connectivity fwm-data">
          {model.offline ? 'OFFLINE' : 'ONLINE'}
        </span>
      </header>

      <OfflineStrip offline={model.offline} />

      <div className="fwm-offline-body">
        <div className="fwm-offline-hero">
          {model.hero.kind === 'readout' ? (
            <DistanceReadout
              distanceFt={model.hero.distanceFt}
              directionLine={model.hero.directionLine}
            />
          ) : (
            <RadarMessage lead={model.hero.lead} note={model.hero.note} />
          )}
        </div>

        <CapabilityList capabilities={model.capabilities} />

        <CacheCounters cachedCameras={model.cachedCameras} cachedTiles={model.cachedTiles} />

        <CacheNotice
          ageMs={model.dbAgeMs}
          cachedAgeMs={model.cachedAgeMs}
          cachedCameras={model.cachedCameras}
          storageAvailable={model.storage === 'available'}
          storageReason={model.storageReason}
          pending={pending}
          {...(model.incoherence === undefined ? {} : { incoherence: model.incoherence })}
          {...(model.behindLiveGeneration === undefined
            ? {}
            : { behindLiveGeneration: model.behindLiveGeneration })}
        />

        <RadarAction label={RETRY_SYNC_LABEL} onPress={onRetrySync} />
      </div>
    </section>
  );
}
