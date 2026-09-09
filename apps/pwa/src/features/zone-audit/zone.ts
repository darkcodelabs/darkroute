/**
 * ZONE AUDIT -- the arithmetic behind `B6 · ZONE AUDIT - SHAREABLE CARD + HEAT
 * LAYER`.
 *
 * SOURCE: `Flockys Screens II.dc.html`, panel `B6` (`ZONE AUDIT`,
 * `2 MI RADIUS`, `HEAT LAYER · READS PER MILE DRIVEN`, `LOW` / `MEDIUM` /
 * `HEAVY`, `TRIP OVERLAY ON`, `47`, `POLICE-OWNED`, `HOA / PRIVATE`,
 * `SHARED TO OUTSIDE AGENCIES`, `FACING INBOUND TRAFFIC`).
 *
 * =============================================================================
 * THE ENGINE OWNS THE GEODESY. THIS MODULE OWNS THE PROJECTION.
 * =============================================================================
 * Every distance and every bearing below comes from `@fwm/core` through
 * `stores/fwmCore.ts` -- `distanceFt`, `bearing`, `isFacingVehicle`. Nothing
 * here re-derives one. What this module does that the engine does not is turn
 * the engine's polar answer (how far, which way) into a cell of a fixed grid,
 * which is presentation and not geodesy.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-layer-metric-is-not-in-any-store-spatially
 *
 * =============================================================================
 * MUTED CAMERAS COUNT. THE WORD `muted` DOES NOT APPEAR IN THIS FILE.
 * =============================================================================
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *    count in EXPOSURE, still log to LOOKUP. Muting only removes the alert -
 *    never the record."
 *      -- Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 * No predicate below reads a mute, so a muted camera is inside the zone, inside
 * its heat cell, inside the card's counts and inside the CSV exactly as an
 * unmuted one is. `ZoneAuditScreen.test.tsx` runs the same zone twice, silenced
 * and not, and compares the whole rendered panel.
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * A `ZoneCamera` carries an offset from the zone centre in feet and NEVER the
 * centre itself, so nothing downstream -- the card, the share text, the CSV --
 * can print, serialise or leak where the driver is. No plate value exists in
 * any type this module imports. Nothing here reaches a network, a URL or a log.
 */

import {
  MAX_TILE_ZOOM,
  MIN_TILE_ZOOM,
  bearing,
  distanceFt,
  isFacingVehicle,
  latLonToTile,
} from '../../stores/fwmCore.ts';
import type { AlertLogEntry, CameraOwnerType, CameraRecord, TileRef } from '../../stores';
import { isCameraPass } from '../log/exposure.ts';
import { NO_VALUE } from '../radar';

// ---------------------------------------------------------------------------
// The radius
// ---------------------------------------------------------------------------

/**
 * The radii the header offers.
 *
 * B6 draws ONE value, `2 MI RADIUS`, and no picker of any kind. The option set
 * is therefore chosen, not designed, and `2` opens because that is the drawn
 * value.
 * GAP: see docs/gaps-inbox/zone-audit.md#radius-selector-is-named-but-never-drawn
 */
export const ZONE_RADII_MI = [1, 2, 5] as const;

export type ZoneRadiusMi = (typeof ZONE_RADII_MI)[number];

export const DEFAULT_ZONE_RADIUS_MI: ZoneRadiusMi = 2;

/** Unit conversion, not a design value. */
export const FEET_PER_MILE = 5280;

export function isZoneRadiusMi(value: unknown): value is ZoneRadiusMi {
  return typeof value === 'number' && (ZONE_RADII_MI as readonly number[]).includes(value);
}

/** The next radius in the ring, wrapping. The header key is the selector. */
export function nextZoneRadius(current: ZoneRadiusMi): ZoneRadiusMi {
  const at = ZONE_RADII_MI.indexOf(current);
  const next = ZONE_RADII_MI[(at + 1) % ZONE_RADII_MI.length];
  return next ?? DEFAULT_ZONE_RADIUS_MI;
}

/** `2 MI RADIUS` -- the header readout, exactly as B6 prints it. */
export function formatRadiusReadout(radiusMi: ZoneRadiusMi): string {
  return `${String(radiusMi)} MI RADIUS`;
}

// ---------------------------------------------------------------------------
// The zone
// ---------------------------------------------------------------------------

/**
 * Where the disc is centred.
 *
 * The current fix, and nothing this module ever renders or serialises.
 * GAP: see docs/gaps-inbox/zone-audit.md#zone-centre-is-the-current-fix
 */
export interface ZoneCentre {
  readonly lat: number;
  readonly lon: number;
}

/**
 * One camera inside the audited disc.
 *
 * `eastFt` / `northFt` are an offset FROM the centre, which is what lets the
 * heat grid place a camera without anything downstream ever holding the centre.
 */
export interface ZoneCamera {
  readonly id: string;
  readonly ownerType: CameraOwnerType | null;
  /**
   * Lens pointed back at the middle of the zone, `null` when the record has no
   * recorded facing. Null is not `false`: an unrecorded facing is missing
   * information, not an all-clear.
   * GAP: see docs/gaps-inbox/zone-audit.md#facing-inbound-traffic-is-interpreted-as-facing-the-zone-centre
   */
  readonly facingInbound: boolean | null;
  readonly confirmations: number | null;
  readonly eastFt: number;
  readonly northFt: number;
  /**
   * Every pass this device still retains at this camera. Muted passes included.
   * This is the CSV's `reads` column and the `recorded` heat scope's numerator.
   */
  readonly reads: number;
  /**
   * The subset of {@link reads} that happened inside the OPEN TRIP's window.
   *
   * Kept apart from `reads` because they are measured over different stretches
   * of road, and `reads per mile driven` may only ever divide the trip's reads
   * by the trip's miles.
   */
  readonly tripReads: number;
}

function usableCoordinate(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * The stretch of time a read has to fall in to be counted.
 *
 * `toMs` is null while the drive it describes is still running.
 */
export interface ReadWindow {
  readonly fromMs: number;
  readonly toMs: number | null;
}

/** Inclusive at both ends. A read with no usable clock is in no window. */
export function inReadWindow(atMs: number, window: ReadWindow | null): boolean {
  if (window === null) return true;
  if (!Number.isFinite(atMs)) return false;
  if (atMs < window.fromMs) return false;
  return window.toMs === null || atMs <= window.toMs;
}

/**
 * How many passes the alert log recorded at each camera, optionally inside one
 * window.
 *
 * A pass is `features/log/exposure.ts#isCameraPass` -- a non-alerting state
 * becoming an alerting one, with a camera it was about -- IMPORTED rather than
 * restated. A second copy of a predicate drifts silently, and this one decides
 * a number the screen prints on a card meant to be handed to somebody else.
 * `zone.test.ts` drives one fixture through `cameraPasses` and through this and
 * compares the totals, so the two cannot disagree even by accident.
 *
 * WITH NO WINDOW this counts every retained entry, which is the whole history
 * slice -- capped at `DEFAULT_MAX_HISTORY_ENTRIES` and refilled from IndexedDB
 * across sessions and days. That total is an all-time number and must never be
 * divided by one trip's odometer. See {@link heatScope}.
 */
export function readCounts(
  entries: readonly AlertLogEntry[],
  window: ReadWindow | null = null,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.cameraId;
    if (id === null) continue;
    if (!isCameraPass(entry)) continue;
    if (!inReadWindow(entry.atMs, window)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// What the cache has actually looked at
// ---------------------------------------------------------------------------

/**
 * Has this device looked HERE?
 *
 * A COUNT of cached tiles is a count of everywhere the driver has ever been:
 * one drive through another city on another day makes it non-zero forever, and
 * a zone gated on it reports `0 license plate readers` about a disc nobody
 * fetched. "We have not looked" and "there are none" are different statements
 * and only one of them is reassuring, so the question is asked about the
 * AUDITED DISC -- is the tile the zone centre falls in in the cache?
 *
 * The addressing is the engine's (`latLonToTile`), asked at whichever zooms the
 * cache happens to hold; this module picks no zoom of its own and does no
 * geodesy.
 *
 * IT ANSWERS FOR THE CENTRE, NOT FOR THE RIM. A 2 mi disc is wider than a tile
 * at the zoom the app works at, so a zone whose centre tile is cached can still
 * have unfetched edges. Bounding the disc in tiles needs a "point at bearing B,
 * distance D" that `@fwm/core` does not expose.
 * GAP: see docs/gaps-inbox/zone-audit.md#zone-coverage-is-tested-at-the-centre-tile-only
 */
export function zoneTilesCached(tiles: Iterable<TileRef>, centre: ZoneCentre | null): boolean {
  if (centre === null || !usableCoordinate(centre.lat, centre.lon)) return false;
  for (const ref of tiles) {
    if (!Number.isInteger(ref.z) || ref.z < MIN_TILE_ZOOM || ref.z > MAX_TILE_ZOOM) continue;
    const here = latLonToTile(centre.lat, centre.lon, ref.z);
    if (here.x === ref.x && here.y === ref.y) return true;
  }
  return false;
}

/**
 * The cameras inside the disc, nearest first.
 *
 * A camera with an unusable position is dropped rather than placed at the
 * centre: an unplaceable camera is missing information, and a false pin in the
 * middle of the zone would be a fake.
 */
export function camerasInZone(
  cameras: readonly CameraRecord[],
  centre: ZoneCentre | null,
  radiusMi: ZoneRadiusMi,
  reads: ReadonlyMap<string, number> = new Map<string, number>(),
  tripReads: ReadonlyMap<string, number> = new Map<string, number>(),
): readonly ZoneCamera[] {
  if (centre === null || !usableCoordinate(centre.lat, centre.lon)) return [];
  const radiusFt = radiusMi * FEET_PER_MILE;
  const inside: { readonly camera: ZoneCamera; readonly ft: number }[] = [];

  for (const record of cameras) {
    if (!usableCoordinate(record.lat, record.lon)) continue;
    const ft = distanceFt(centre.lat, centre.lon, record.lat, record.lon);
    if (ft > radiusFt) continue;
    const toCamera = bearing(centre.lat, centre.lon, record.lat, record.lon);
    const radians = (toCamera * Math.PI) / 180;
    inside.push({
      ft,
      camera: {
        id: record.id,
        ownerType: record.ownerType ?? null,
        facingInbound: isFacingVehicle(record.directionDeg, toCamera),
        confirmations: record.confirmations ?? null,
        eastFt: ft * Math.sin(radians),
        northFt: ft * Math.cos(radians),
        reads: reads.get(record.id) ?? 0,
        tripReads: tripReads.get(record.id) ?? 0,
      },
    });
  }

  inside.sort((a, b) => a.ft - b.ft);
  return inside.map((item) => item.camera);
}

// ---------------------------------------------------------------------------
// The card's four rows
// ---------------------------------------------------------------------------

/**
 * The counts the share card prints.
 *
 * `police`, `hoaPrivate` and `sharedOutside` read a five-way EXCLUSIVE enum, so
 * they can sum to less than `total` -- an `unverified` camera counts in the
 * total and in no row. B6's own numbers imply overlapping cross-cuts the enum
 * cannot express.
 * GAP: see docs/gaps-inbox/zone-audit.md#owner-buckets-in-b6-overlap-and-ours-cannot
 */
export interface ZoneStats {
  readonly total: number;
  readonly police: number;
  readonly hoaPrivate: number;
  readonly sharedOutside: number;
  readonly facingInbound: number;
  /** In the total, in no row. Rendered nowhere; kept so a test can say so. */
  readonly unclassified: number;
}

export function zoneStats(cameras: readonly ZoneCamera[]): ZoneStats {
  let police = 0;
  let hoaPrivate = 0;
  let sharedOutside = 0;
  let facingInbound = 0;
  let unclassified = 0;

  for (const camera of cameras) {
    if (camera.facingInbound === true) facingInbound += 1;
    switch (camera.ownerType) {
      case 'police':
        police += 1;
        break;
      case 'hoa':
      case 'private':
        hoaPrivate += 1;
        break;
      case 'inter_agency':
        sharedOutside += 1;
        break;
      default:
        unclassified += 1;
        break;
    }
  }

  return { total: cameras.length, police, hoaPrivate, sharedOutside, facingInbound, unclassified };
}

/** The four row labels, in B6's order. */
export const ZONE_STAT_ROWS = [
  'POLICE-OWNED',
  'HOA / PRIVATE',
  'SHARED TO OUTSIDE AGENCIES',
  'FACING INBOUND TRAFFIC',
] as const;

export type ZoneStatRow = (typeof ZONE_STAT_ROWS)[number];

export function zoneStatValue(stats: ZoneStats, row: ZoneStatRow): number {
  switch (row) {
    case 'POLICE-OWNED':
      return stats.police;
    case 'HOA / PRIVATE':
      return stats.hoaPrivate;
    case 'SHARED TO OUTSIDE AGENCIES':
      return stats.sharedOutside;
    default:
      return stats.facingInbound;
  }
}

// ---------------------------------------------------------------------------
// The heat layer
// ---------------------------------------------------------------------------

/**
 * The grid the disc is divided into.
 *
 * Fixed, because a data-driven position can only reach the DOM through an
 * inline `style` and that is banned here. `components/ZoneAuditView.test.tsx`
 * ("lays the grid out at the resolution the model counts at") asserts these two
 * numbers against the `repeat()` in `zone-audit.css`, so the model and the
 * stylesheet cannot drift apart.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-grid-resolution-is-chosen-not-drawn
 */
export const HEAT_GRID_COLS = 8;
export const HEAT_GRID_ROWS = 6;

/**
 * WHICH WINDOW THE LAYER IS MEASURING.
 *
 * `reads per mile driven` is one measurement, and it needs both of its numbers
 * taken over the SAME stretch of road. The odometer that supplies the
 * denominator belongs to the open trip and `startTrip()` resets it to zero at
 * the top of every drive, so the numerator has to be the reads that happened
 * inside that trip. A lifetime read count over one trip's miles is not a rate:
 * it is two measurements of different things divided by each other, and it runs
 * hot by the ratio of the two windows -- forty retained reads inside the first
 * half mile of a drive reads as eighty per mile, which would pin every cell to
 * HEAVY on a screen whose whole job is to state density accurately.
 *
 * WITH NO TRIP OPEN there is no denominator at all, and no other mileage exists
 * anywhere on the device. The layer then measures the thing it can measure
 * honestly -- the passes it has recorded at each cell -- and the caption says
 * which of the two it is showing. Drawing nothing at all was the previous
 * answer, and it made B6's most prominent element blank in every build that has
 * no trip owner (`docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner`).
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-scope-falls-back-when-no-trip-is-open
 */
export const HEAT_SCOPES = ['trip', 'recorded'] as const;

export type HeatScope = (typeof HEAT_SCOPES)[number];

/** `trip` only when a trip odometer has actually moved. */
export function heatScope(milesDriven: number | null): HeatScope {
  return milesDriven !== null && Number.isFinite(milesDriven) && milesDriven > 0
    ? 'trip'
    : 'recorded';
}

/** The three bands B6's legend names, weakest first. */
export const HEAT_RANKS = ['low', 'medium', 'heavy'] as const;

export type HeatBand = (typeof HEAT_RANKS)[number];

/** A cell with no measured reads is in no band and draws nothing. */
export type HeatRank = HeatBand | 'none';

export const HEAT_RANK_LABELS: Readonly<Record<HeatBand, string>> = Object.freeze({
  low: 'LOW',
  medium: 'MEDIUM',
  heavy: 'HEAVY',
});

/**
 * The band cut points, in reads per mile driven -- the `trip` scope.
 *
 * Absolute rather than relative to the busiest cell, so two zones can be
 * compared -- which is what an audit is for.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-bands-low-medium-heavy-have-no-cut-points
 */
export const HEAVY_READS_PER_MI = 1;
export const MEDIUM_READS_PER_MI = 0.4;

/**
 * The same three bands in the `recorded` scope, where the quantity is a COUNT
 * of passes and not a rate, so the per-mile cut points do not apply to it.
 * Absolute for the same reason, and chosen rather than designed.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-bands-low-medium-heavy-have-no-cut-points
 */
export const HEAVY_READS = 5;
export const MEDIUM_READS = 2;

/** Band a value against the cut points of the scope that produced it. */
export function heatRank(value: number | null, scope: HeatScope): HeatRank {
  if (value === null || !Number.isFinite(value) || value <= 0) return 'none';
  const heavy = scope === 'trip' ? HEAVY_READS_PER_MI : HEAVY_READS;
  const medium = scope === 'trip' ? MEDIUM_READS_PER_MI : MEDIUM_READS;
  if (value >= heavy) return 'heavy';
  if (value >= medium) return 'medium';
  return 'low';
}

export interface HeatCell {
  /** Row-major index, so a list key needs no coordinate pair. */
  readonly index: number;
  readonly col: number;
  readonly row: number;
  readonly cameras: number;
  /** Passes counted in the scope this layer is measuring, and only that scope. */
  readonly reads: number;
  /** The rate, in `trip` scope. Null in `recorded` scope: there is no denominator. */
  readonly readsPerMile: number | null;
  readonly rank: HeatRank;
  /** The open trip reached a camera in this cell. */
  readonly onTrip: boolean;
}

function clampIndex(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(limit - 1, Math.max(0, Math.trunc(value)));
}

/** Which cell an offset from the centre falls in. North is row 0. */
export function cellFor(
  eastFt: number,
  northFt: number,
  radiusMi: ZoneRadiusMi,
): { readonly col: number; readonly row: number } {
  const radiusFt = radiusMi * FEET_PER_MILE;
  const span = radiusFt * 2;
  return {
    col: clampIndex(((eastFt + radiusFt) / span) * HEAT_GRID_COLS, HEAT_GRID_COLS),
    row: clampIndex(((radiusFt - northFt) / span) * HEAT_GRID_ROWS, HEAT_GRID_ROWS),
  };
}

export interface HeatInput {
  readonly cameras: readonly ZoneCamera[];
  readonly radiusMi: ZoneRadiusMi;
  /**
   * Miles the open trip has covered. Null or zero is not a denominator, and
   * selects the `recorded` scope rather than emptying the layer.
   * @see {@link heatScope}
   */
  readonly milesDriven: number | null;
  /** Camera ids the open trip passed. Drives the overlay outline. */
  readonly tripCameraIds: readonly string[];
}

/**
 * Every cell of the grid, always -- an empty cell is a cell with no reads, not
 * a missing one, exactly as `log.css` draws a day with no passes as a baseline
 * rather than a gap.
 */
export function heatCells(input: HeatInput): readonly HeatCell[] {
  const scope = heatScope(input.milesDriven);
  const miles = scope === 'trip' ? (input.milesDriven ?? 0) : 0;
  const onTrip = new Set(input.tripCameraIds);

  const cameras = new Array<number>(HEAT_GRID_COLS * HEAT_GRID_ROWS).fill(0);
  const reads = new Array<number>(HEAT_GRID_COLS * HEAT_GRID_ROWS).fill(0);
  const touched = new Array<boolean>(HEAT_GRID_COLS * HEAT_GRID_ROWS).fill(false);

  for (const camera of input.cameras) {
    const { col, row } = cellFor(camera.eastFt, camera.northFt, input.radiusMi);
    const index = row * HEAT_GRID_COLS + col;
    cameras[index] = (cameras[index] ?? 0) + 1;
    // The numerator is scoped with the denominator or it is not a rate.
    reads[index] = (reads[index] ?? 0) + (scope === 'trip' ? camera.tripReads : camera.reads);
    if (onTrip.has(camera.id)) touched[index] = true;
  }

  const cells: HeatCell[] = [];
  for (let index = 0; index < HEAT_GRID_COLS * HEAT_GRID_ROWS; index++) {
    const cellReads = reads[index] ?? 0;
    const readsPerMile = scope === 'trip' ? cellReads / miles : null;
    cells.push({
      index,
      col: index % HEAT_GRID_COLS,
      row: Math.floor(index / HEAT_GRID_COLS),
      cameras: cameras[index] ?? 0,
      reads: cellReads,
      readsPerMile,
      rank: heatRank(scope === 'trip' ? readsPerMile : cellReads, scope),
      onTrip: touched[index] === true,
    });
  }
  return cells;
}

export interface HeatAvailability {
  /** There is a fix, so the disc has a middle. */
  readonly located: boolean;
  /**
   * THIS zone's tile has been read, so "no cameras" is a measurement rather
   * than an absence of one. Never a global tile count: see
   * {@link zoneTilesCached}.
   */
  readonly tilesCached: boolean;
  readonly camerasInZone: number;
  /** Passes counted in the active scope, across the whole disc. */
  readonly readsInZone: number;
}

/**
 * Why the layer has nothing to draw, or null when it has.
 *
 * B6 draws one populated state and no other, so each of these says which
 * missing thing is missing rather than drawing a blob that is not there. The
 * order matters: an empty cache is "we do not know", which is a different
 * statement from "there are none here", and reporting the second when the first
 * is true would be a lie in the driver's favour.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-layer-has-no-drawn-empty-state
 */
export function heatUnavailableReason(input: HeatAvailability): string | null {
  if (!input.located) return 'NO FIX · ZONE NOT LOCATED';
  if (!input.tilesCached) return 'NO CAMERAS CACHED FOR THIS ZONE';
  if (input.camerasInZone === 0) return 'NO CAMERAS IN THIS ZONE';
  if (input.readsInZone <= 0) return 'NO READS RECORDED IN THIS ZONE YET';
  return null;
}

// ---------------------------------------------------------------------------
// The trip overlay
// ---------------------------------------------------------------------------

/** `TRIP OVERLAY ON` / `TRIP OVERLAY OFF`. B6 draws the first. */
export function tripOverlayLabel(on: boolean): string {
  return on ? 'TRIP OVERLAY ON' : 'TRIP OVERLAY OFF';
}

// ---------------------------------------------------------------------------
// Card copy
// ---------------------------------------------------------------------------

/** The heat layer's caption, verbatim, in the scope B6 draws it in. */
export const HEAT_CAPTION = 'HEAT LAYER · READS PER MILE DRIVEN';

/**
 * The caption for the scope B6 does not draw.
 *
 * A count is not a rate, so the layer may not carry the drawn caption over a
 * quantity that was never divided by anything. The line names what it is
 * showing instead of implying a denominator nobody took.
 * GAP: see docs/gaps-inbox/zone-audit.md#heat-scope-falls-back-when-no-trip-is-open
 */
export const HEAT_CAPTION_RECORDED = 'HEAT LAYER · READS RECORDED';

export function heatCaption(scope: HeatScope): string {
  return scope === 'trip' ? HEAT_CAPTION : HEAT_CAPTION_RECORDED;
}

/** The eyebrow over the card preview, verbatim. */
export const SHARE_CARD_EYEBROW = 'SHARE CARD - RENDERS AS AN IMAGE';

/**
 * `license plate readers within 2 miles.`
 *
 * B6 ends the sentence `of Hartwell Elementary.` A place name means reverse
 * geocoding the driver's exact position, so the clause is dropped when nothing
 * named the zone rather than invented or replaced with a coordinate.
 * GAP: see docs/gaps-inbox/zone-audit.md#card-place-name-needs-a-geocoder
 */
export function cardSentence(radiusMi: ZoneRadiusMi, place: string | null = null): string {
  const unit = radiusMi === 1 ? 'mile' : 'miles';
  const within = `license plate readers within ${String(radiusMi)} ${unit}`;
  return place === null || place.trim() === '' ? `${within}.` : `${within} of ${place.trim()}.`;
}

/** Month labels for the card's footer date. Restated: LOG keeps its own private. */
const MONTH_LABELS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

/** `COMMUNITY-REPORTED · AUG 19 2026`, exactly as B6 prints it. */
export function cardProvenance(atMs: number): string {
  if (!Number.isFinite(atMs)) return `COMMUNITY-REPORTED · ${NO_VALUE}`;
  const date = new Date(atMs);
  const month = MONTH_LABELS[date.getMonth()] ?? NO_VALUE;
  return `COMMUNITY-REPORTED · ${month} ${String(date.getDate())} ${String(date.getFullYear())}`;
}
