/**
 * ZONE AUDIT -- how watched a place is, in a form that can be handed to
 * somebody who does not have this app.
 *
 * =============================================================================
 * THIS FILE IS WIRING. IT IS NOT A MOCK, AND IT IS NOT A CALCULATOR.
 * =============================================================================
 * Every count on this screen is a camera the tile cache holds or a pass the
 * alert log recorded, measured through `zone.ts`, whose geodesy is `@fwm/core`'s.
 * This file:
 *
 *   - calls no browser API on mount or ever. The share sheet opens from the
 *     press and from nowhere else -- `share()` is a user gesture by contract,
 *     and the adapter is constructed without touching `navigator`.
 *   - does no geospatial arithmetic.
 *   - renders no camera it was not given. A cache nobody has filled says so
 *     rather than reporting a reassuring zero.
 *
 * =============================================================================
 * MUTED CAMERAS COUNT HERE
 * =============================================================================
 *   "They still draw on SWEEP in grey, still count in EXPOSURE, still log to
 *    LOOKUP. Muting only removes the alert - never the record."
 *      -- Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 * No mute selector is imported by this feature at all, so a muted camera is in
 * the zone, in its heat cell, in the card and in the CSV exactly as any other.
 * `ZoneAuditScreen.test.tsx` runs the same zone twice, silenced and not, and
 * compares the whole rendered panel.
 *
 * =============================================================================
 * WHAT LEAVES THE DEVICE, AND WHAT CANNOT
 * =============================================================================
 * `SHARE CARD` hands `services/adapters/share.ts` the card's words under the
 * payload kind it already reserves, `zone-audit-card`. No `url`: this build has
 * no configured origin and the adapter refuses to guess one. No plate -- no
 * plate value exists in any type this feature imports. No coordinate -- the
 * zone centre never leaves `useZone()` and the card has no field for one.
 *
 * `EXPORT CSV` builds nothing until the press, and only when a sink is wired.
 * The file carries no plate, no coordinate, no timestamp and no distance -- and
 * its rows are written in `camera_id` order rather than the nearest-first order
 * the zone model returns, because row order in a distance-sorted list is itself
 * a distance ranking from the driver's fix. What the file still discloses -- a
 * set of public ids drawn from one disc describes that disc's area -- is stated
 * in `zoneCsv.ts` and named in the notice the driver is shown.
 * GAP: see docs/gaps-inbox/zone-audit.md#export-csv-has-no-sink-on-this-device
 * GAP: see docs/gaps-inbox/zone-audit.md#the-csv-id-set-still-describes-an-area
 *
 * Nothing on this screen writes to the URL beyond a screen id, which is all
 * `app/screenState.ts` can carry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { createShareAdapter } from '../../services/adapters/share.ts';
import type { ShareAdapter } from '../../services/adapters/share.ts';

import { ZoneAuditView } from './components/ZoneAuditView.tsx';
import type { ZoneAuditViewModel, ZoneNotice } from './components/ZoneAuditView.tsx';
import { buildZoneSharePayload } from './shareCard.ts';
import { useZone } from './useZone.ts';
import { buildZoneCsv } from './zoneCsv.ts';
import type { ZoneCsvBundle } from './zoneCsv.ts';

import './zone-audit.css';

export interface ZoneAuditScreenProps {
  /** Injectable clock. Used for the card's date and the export's file name. */
  readonly now?: (() => number) | undefined;
  /**
   * The share sheet. Defaults to this build's adapter; `null` renders
   * `SHARE CARD` disabled, which is the honest state for a build that has
   * switched sharing off.
   */
  readonly share?: ShareAdapter | null;
  /**
   * Receive the CSV. Absent means the key renders disabled -- there is nowhere
   * sanctioned on this device to put the bytes, so a build with no sink never
   * produces them.
   */
  readonly onExportCsv?: ((bundle: ZoneCsvBundle) => void) | undefined;
  /**
   * What named the zone, when anything did. Absent drops B6's `of Hartwell
   * Elementary` clause rather than inventing a name or printing a coordinate.
   * GAP: see docs/gaps-inbox/zone-audit.md#card-place-name-needs-a-geocoder
   */
  readonly place?: string | null;
  /**
   * Absolute public origin from app config. Absent draws no domain line and
   * puts no `url` in the share payload. Never constructed here.
   * GAP: see docs/gaps-inbox/zone-audit.md#no-configured-origin-so-the-card-carries-no-domain
   */
  readonly origin?: string | null;
}

export function ZoneAuditScreen({
  now = Date.now,
  share,
  onExportCsv,
  place = null,
  origin = null,
}: ZoneAuditScreenProps = {}): ReactElement {
  const zone = useZone();

  // Constructed once. The adapter touches no browser API until it is asked to,
  // and `start()` is deliberately not called: a share is always a user gesture
  // and needs no arming.
  const shareAdapter = useMemo(() => (share === undefined ? createShareAdapter() : share), [share]);

  const [notice, setNotice] = useState<ZoneNotice | null>(null);

  // A share is async and the screen can be navigated away from mid-flight.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // A changed zone is a changed claim: the previous card's "CARD SHARED" must
  // never sit under numbers it was not about.
  useEffect(() => {
    setNotice(null);
  }, [zone.radiusMi]);

  const shareCard = useCallback((): void => {
    const stats = zone.stats;
    if (stats === null || shareAdapter === null) return;
    void shareAdapter
      .share(
        buildZoneSharePayload({
          stats,
          radiusMi: zone.radiusMi,
          place,
          atMs: now(),
          origin,
        }),
      )
      .then((result) => {
        if (!live.current) return;
        // A dismissed sheet is the user saying no, not a failure.
        if (result.status === 'cancelled') return;
        if (result.status === 'shared') {
          setNotice('shared');
          return;
        }
        setNotice(result.status === 'unsupported' ? 'share-unavailable' : 'share-failed');
      });
  }, [shareAdapter, zone.stats, zone.radiusMi, place, origin, now]);

  /**
   * A zone this screen refuses to STATE is a zone it refuses to EXPORT.
   *
   * `stats` is null when the zone cannot be located or when this device has
   * never cached the zone's own tile, and the card then prints em dashes rather
   * than a reassuring zero. A file listing the cameras of a disc the screen
   * will not put a number on would be the same claim leaving by the other door,
   * in a format that outlives the screen it came from.
   */
  const exportableRows = zone.stats === null ? 0 : zone.cameras.length;

  /**
   * Serialise on the press, never before. A build with no handler never builds
   * the bytes at all, which is the strongest form of "nothing leaves that the
   * design does not say leaves".
   */
  const exportCsv = useCallback((): void => {
    if (onExportCsv === undefined || exportableRows === 0) return;
    onExportCsv(buildZoneCsv(zone.cameras, now()));
    if (live.current) setNotice('csv-exported');
  }, [onExportCsv, exportableRows, zone.cameras, now]);

  const model: ZoneAuditViewModel = {
    radiusMi: zone.radiusMi,
    cells: zone.cells,
    heatCaption: zone.heatCaption,
    heatUnavailable: zone.heatUnavailable,
    tripOverlay: zone.tripOverlay,
    stats: zone.stats,
    place,
    // Recomputed on every render on purpose: the card states the day it was
    // built, and a date memoised against a stale clock outlives the day.
    atMs: now(),
    origin,
    exportableRows,
    notice,
  };

  return (
    <ZoneAuditView
      model={model}
      onRadius={zone.cycleRadius}
      onTripOverlay={zone.toggleTripOverlay}
      onShare={shareAdapter === null ? undefined : shareCard}
      onExportCsv={onExportCsv === undefined ? undefined : exportCsv}
    />
  );
}
