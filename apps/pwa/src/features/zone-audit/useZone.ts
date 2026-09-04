/**
 * THE ZONE, READ OFF THE STORES. WIRING, NOT A CALCULATOR.
 *
 * ZONE AUDIT and HEAT MAP are the same measurement with two amounts of screen,
 * so they share one hook. Every value it returns comes from a store selector or
 * from `zone.ts`, whose geodesy is `@fwm/core`'s. This hook:
 *
 *   - calls no browser API. No `navigator`, no `geolocation`, no permission
 *     prompt -- on mount or ever. It takes no clock either: the card's date is
 *     the screen's business, not the zone's.
 *   - does no geospatial arithmetic of its own.
 *   - invents no camera and no read. A cache that has not been filled FOR THIS
 *     DISC says so; it does not report zero cameras, because "we have not
 *     looked" and "there are none" are different statements and only one of
 *     them is reassuring. The coverage question is asked about the audited
 *     zone (`zoneTilesCached`) and never about a global tile count.
 *
 * MUTED CAMERAS COUNT. Nothing here reads a mute, and there is no selector in
 * the import list that could supply one.
 *
 * PRIVACY. The centre is the current fix and it leaves this module only as
 * `located: boolean`. Every camera reaches the caller as an offset in feet, so
 * no component downstream can render, serialise or leak where the driver is.
 */

import { useCallback, useMemo, useState } from 'react';

import {
  useAlertLog,
  useCachedCameras,
  useCamerasStore,
  useCurrentFix,
  useCurrentTrip,
} from '../../stores';
import type { TileRef } from '../../stores';

import {
  DEFAULT_ZONE_RADIUS_MI,
  camerasInZone,
  heatCaption,
  heatCells,
  heatScope,
  heatUnavailableReason,
  nextZoneRadius,
  readCounts,
  zoneStats,
  zoneTilesCached,
} from './zone.ts';
import type { HeatCell, HeatScope, ZoneCamera, ZoneRadiusMi, ZoneStats } from './zone.ts';

export interface ZoneModel {
  readonly radiusMi: ZoneRadiusMi;
  readonly tripOverlay: boolean;
  /** The cameras inside the disc, nearest first. Offsets only, never a fix. */
  readonly cameras: readonly ZoneCamera[];
  readonly cells: readonly HeatCell[];
  /**
   * Which window the layer is measuring: `trip` divides by the open trip's
   * odometer, `recorded` counts the passes it retains because no odometer
   * exists to divide by.
   */
  readonly heatScope: HeatScope;
  /** The caption for {@link heatScope}, which states which of the two it is. */
  readonly heatCaption: string;
  /** Why the layer has nothing to draw, or null when it has. */
  readonly heatUnavailable: string | null;
  /**
   * Null when the zone cannot be stated -- no fix, or an empty camera cache.
   * Not a zeroed record: a card that says `0` about a cache nobody has filled
   * is a lie in the driver's favour.
   */
  readonly stats: ZoneStats | null;
  readonly cycleRadius: () => void;
  readonly toggleTripOverlay: () => void;
}

export function useZone(): ZoneModel {
  // --- what is cached ------------------------------------------------------
  const cameras = useCachedCameras();
  // The tile ADDRESSES, not a count of them: a count is a count of everywhere
  // this device has ever been, and a zone gated on it reports a confident `0`
  // about a disc nobody fetched. The map is replaced wholesale on every write,
  // so selecting it by reference is render-stable.
  const tiles = useCamerasStore((state) => state.tiles);
  const fix = useCurrentFix();
  const entries = useAlertLog();
  const trip = useCurrentTrip();

  // --- the two controls B6 draws -------------------------------------------
  // Local, not in the URL: `?screen=zone-audit` is the only thing this screen
  // may write there, and a radius is not a destination -- it is also a hint
  // about how far the driver cares to look, which has no business in a URL that
  // gets copied into history and synced across devices.
  const [radiusMi, setRadiusMi] = useState<ZoneRadiusMi>(DEFAULT_ZONE_RADIUS_MI);
  // B6 draws `TRIP OVERLAY ON`.
  const [tripOverlay, setTripOverlay] = useState(true);

  const centre = useMemo(() => (fix === null ? null : { lat: fix.lat, lon: fix.lon }), [fix]);
  const located = centre !== null;
  const milesDriven = trip === null ? null : trip.distanceMi;

  // Has this device looked at THIS disc, rather than at anywhere at all?
  const zoneCached = useMemo(() => {
    const refs: readonly TileRef[] = [...tiles.values()].map((tile) => tile.ref);
    return zoneTilesCached(refs, centre);
  }, [tiles, centre]);

  // Two windows, kept apart on purpose. `reads` is everything the history slice
  // still retains -- across sessions and days -- and is what the CSV exports.
  // `tripReads` is the subset that happened inside the open drive, and is the
  // only numerator `reads per mile driven` may ever use.
  const reads = useMemo(() => readCounts(entries), [entries]);
  // The window's two ends are the dependencies, not a fresh object per render.
  const tripFromMs = trip === null ? null : trip.startedAtMs;
  const tripToMs = trip === null ? null : trip.endedAtMs;
  const tripReads = useMemo(
    () =>
      tripFromMs === null
        ? new Map<string, number>()
        : readCounts(entries, { fromMs: tripFromMs, toMs: tripToMs }),
    [entries, tripFromMs, tripToMs],
  );

  const inZone = useMemo(
    () => camerasInZone(cameras, centre, radiusMi, reads, tripReads),
    [cameras, centre, radiusMi, reads, tripReads],
  );

  const cells = useMemo(
    () =>
      heatCells({
        cameras: inZone,
        radiusMi,
        milesDriven,
        tripCameraIds: trip?.cameraIdsPassed ?? [],
      }),
    [inZone, radiusMi, milesDriven, trip],
  );

  const scope = heatScope(milesDriven);
  const readsInZone = cells.reduce((total, cell) => total + cell.reads, 0);

  const heatUnavailable = heatUnavailableReason({
    located,
    tilesCached: zoneCached,
    camerasInZone: inZone.length,
    readsInZone,
  });

  const stats = useMemo(
    () => (located && zoneCached ? zoneStats(inZone) : null),
    [located, zoneCached, inZone],
  );

  const cycleRadius = useCallback((): void => {
    setRadiusMi(nextZoneRadius);
  }, []);

  const toggleTripOverlay = useCallback((): void => {
    setTripOverlay((on) => !on);
  }, []);

  return {
    radiusMi,
    tripOverlay,
    cameras: inZone,
    cells,
    heatScope: scope,
    heatCaption: heatCaption(scope),
    heatUnavailable,
    stats,
    cycleRadius,
    toggleTripOverlay,
  };
}
