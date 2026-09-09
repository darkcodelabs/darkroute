/**
 * EXPORT CSV -- `fwm-zone-audit/v1`.
 *
 * `EXPORT CSV` is the second key on `B6 · ZONE AUDIT`. The panel draws the
 * button and names no columns, so this file is the format.
 *
 * =============================================================================
 * WHAT IS IN IT, AND WHY THAT IS ALL
 * =============================================================================
 *   camera_id         a public infrastructure record id (`FWM-0442`)
 *   owner_type        the exclusive owner enum, or `unknown`
 *   facing_inbound    yes / no / unknown -- unknown is NOT no
 *   confirmations     independent confirmations on the record, or blank
 *   reads             passes THIS device recorded at that camera, aggregate
 *
 * =============================================================================
 * WHAT IS DELIBERATELY NOT IN IT
 * =============================================================================
 *   NO PLATE. No plate value exists in any type this module imports; the vault
 *   is a separate encrypted store and nothing here can reach it.
 *
 *   NO COORDINATE. Not the zone centre, not the fix, not a camera latitude or
 *   longitude, not a bearing and not a distance. A list of coordinates whose
 *   centroid is the driver is a location disclosure wearing a spreadsheet, and
 *   the file is going somewhere the driver does not control.
 *
 *   NO DISTANCE ORDERING EITHER. `camerasInZone()` returns NEAREST FIRST, and
 *   handing that order to a file makes ROW ORDER an ordinal distance ranking
 *   from the driver's fix -- a bearing-free but perfectly usable rank that the
 *   `no distance` rule above was written to forbid. Rows are therefore sorted
 *   by `camera_id`, which is a property of public infrastructure and carries no
 *   fact about the driver at all.
 *
 *   NO TIMESTAMPS. When a read happened is a movement trace. Only the aggregate
 *   count per camera goes out.
 *
 *   The file name carries a UTC date and nothing about the driver.
 * GAP: see docs/gaps-inbox/zone-audit.md#what-the-csv-may-contain
 *
 * =============================================================================
 * WHAT IT STILL DISCLOSES, STATED PLAINLY
 * =============================================================================
 * A `camera_id` is a key into a PUBLIC camera dataset that carries a position,
 * so a set of ids all drawn from one disc describes THE AREA THAT DISC COVERS
 * even though no field here is a coordinate. That is not removable while the
 * file is a reviewable list of the cameras in a zone, which is what an audit
 * export is. The user-facing notice names the contents rather than promising
 * `NO LOCATION`, and the honest boundary is written down instead of implied.
 * GAP: see docs/gaps-inbox/zone-audit.md#the-csv-id-set-still-describes-an-area
 *
 * =============================================================================
 * THIS FILE DOES NOT SEND ANYTHING
 * =============================================================================
 * No `fetch`, no clipboard, no share, no download. It returns a string. What
 * happens to that string is the caller's decision and, on this screen, the
 * user's.
 * GAP: see docs/gaps-inbox/zone-audit.md#export-csv-has-no-sink-on-this-device
 */

import type { ZoneCamera } from './zone.ts';

export const ZONE_CSV_SCHEMA = 'fwm-zone-audit/v1';

/** The header row, in order. This IS the format. */
export const ZONE_CSV_COLUMNS = [
  'camera_id',
  'owner_type',
  'facing_inbound',
  'confirmations',
  'reads',
] as const;

/** RFC 4180: CRLF between records. */
const RECORD_SEPARATOR = '\r\n';

export interface ZoneCsvBundle {
  readonly schema: typeof ZONE_CSV_SCHEMA;
  /** The CSV text. This is the export. */
  readonly text: string;
  /** Data rows, not counting the header. */
  readonly rows: number;
  /** Suggested file name. UTC-stamped, and about nobody. */
  readonly filename: string;
}

/**
 * RFC 4180 quoting.
 *
 * Everything is quoted rather than only the fields that need it: a quoting rule
 * with a branch is a quoting rule with a bug, and the size difference on a few
 * hundred rows is nothing.
 */
export function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** yes / no / unknown. `null` is unknown, and unknown is not `no`. */
export function facingField(facingInbound: boolean | null): string {
  if (facingInbound === null) return 'unknown';
  return facingInbound ? 'yes' : 'no';
}

/** `fwm-zone-audit-20260819.csv`. UTC, so it does not leak a timezone either. */
export function zoneCsvFilename(exportedAtMs: number): string {
  const date = Number.isFinite(exportedAtMs) ? new Date(exportedAtMs) : new Date(0);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${String(date.getUTCFullYear())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  return `fwm-zone-audit-${stamp}.csv`;
}

export function zoneCsvRow(camera: ZoneCamera): string {
  return [
    csvField(camera.id),
    csvField(camera.ownerType ?? 'unknown'),
    csvField(facingField(camera.facingInbound)),
    csvField(camera.confirmations === null ? '' : String(camera.confirmations)),
    csvField(String(camera.reads)),
  ].join(',');
}

/**
 * The export order.
 *
 * By `camera_id`, ALWAYS -- never the order the zone model returns, which is
 * nearest-first and therefore a distance ranking from the driver's position.
 * Sorting is not cosmetic here: it is the step that takes the last locating
 * signal out of the file.
 */
export function sortForExport(cameras: readonly ZoneCamera[]): readonly ZoneCamera[] {
  return [...cameras].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Build the export.
 *
 * Called from the press and only when a sink is wired, so a build with nowhere
 * to put the bytes never produces them.
 */
export function buildZoneCsv(cameras: readonly ZoneCamera[], exportedAtMs: number): ZoneCsvBundle {
  const header = ZONE_CSV_COLUMNS.map(csvField).join(',');
  const lines = [header, ...sortForExport(cameras).map(zoneCsvRow)];
  return {
    schema: ZONE_CSV_SCHEMA,
    text: `${lines.join(RECORD_SEPARATOR)}${RECORD_SEPARATOR}`,
    rows: cameras.length,
    filename: zoneCsvFilename(exportedAtMs),
  };
}
