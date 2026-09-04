/**
 * THE SCOPE TELEMETRY -- the six 8px lines v2 hangs in the scope's corners.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, `02 · SWEEP`. Two blocks, both
 * `font-size:8px; letter-spacing:.14em; color:#4E5563; line-height:1.7`:
 *
 *   left, bottom     SCAN 2.4s   RES 12PX   SRC MESH+DB
 *   right, bottom    HDG 041°    LAT 39.0997   LON -84.5786
 *
 * v1 drew none of it. The left block is the INSTRUMENT describing itself; the
 * right block is the VEHICLE, and every line of it is measured.
 *
 * =============================================================================
 * PRIVACY. THIS IS THE WHOLE REASON THIS FILE IS SEPARATE AND PURE.
 * =============================================================================
 * {@link formatLatitude} and {@link formatLongitude} render the driver's own
 * position at four decimals -- about 11 m. That is fine on the driver's own
 * screen and NOWHERE ELSE. Their output must never reach:
 *
 *   a log line, a URL or a query string, a notification body, an analytics or
 *   telemetry event, a crash report, a request body, a share payload, or a
 *   `data-*` attribute that any of those could later be built from.
 *
 * The rules that keep that true, all of them checkable:
 *
 *   1. THE SOURCE IS MEMORY-ONLY. The numbers come from the position slice's
 *      `useCurrentFix()`. `stores/position.ts` states in its header that the
 *      slice "is never persisted, never serialised into a URL, never attached
 *      to a notification and never logged".
 *   2. THERE IS ONE SANCTIONED EXIT, AND IT IS NOT THIS ONE.
 *      `positionForDiagnostics()` rounds through the geolocation adapter's
 *      `redact()` -- three decimals, ~110 m, altitude dropped -- and is the
 *      only shape allowed to leave the device. SWEEP never calls it, because
 *      SWEEP never sends anything.
 *   3. THE OUTPUT IS A TEXT NODE AND NOTHING ELSE. `SweepTelemetry.tsx` puts
 *      these strings in element CONTENT. No attribute on this screen carries a
 *      coordinate -- not `data-*`, not `aria-label`, not a React key --
 *      and `components/SweepTelemetry.test.tsx` walks every rendered attribute
 *      and fails if a coordinate value appears in one.
 *   4. THIS FORMATTER AND COMPONENT DO NOT TRANSMIT. They import no network
 *      adapter and perform no request when rendered; the component test pins
 *      that boundary. The merged RADAR screen has a basemap, so this is not a
 *      claim that the whole screen is offline.
 *
 * There is no debug mode that unlocks more precision, and no code path here
 * that widens it. That switch does not exist.
 */

import { NO_VALUE, formatHeadingDegrees } from '../radar';

/**
 * The scope's sweep period, in seconds, as the telemetry prints it.
 *
 * `sweep.css` animates the beam at `calc(var(--fwm-dur-alert) * 6)` and
 * `--fwm-dur-alert` is 400ms, so the period is 2400ms. It is mirrored here
 * because a CSS custom property is not readable as a string, and
 * `telemetry.test.ts` reads `sweep.css` and asserts the multiple is still 6 so
 * the two cannot drift apart unnoticed.
 */
export const SCAN_PERIOD_S = 2.4;

/**
 * v2's `RES 12PX`, drawn as chrome.
 *
 * Nothing in this build measures a raster resolution: there is no basemap, no
 * tile and no camera feed, and the scope is vector. The line is reproduced as
 * the design writes it because it describes the INSTRUMENT and cannot mislead
 * anyone about a camera -- but it is not sourced, and it is the one number in
 * either block that is not.
 * GAP: docs/gaps-inbox/sweep-v2.md#res-12px-is-not-sourced-by-anything
 */
export const RESOLUTION_PX = 12;

/** Decimals the on-screen coordinate carries. v2 draws four: `39.0997`. */
export const COORDINATE_DECIMALS = 4;

/** Everything the two blocks read. All of it arrives from a store selector. */
export interface SweepTelemetry {
  /** Degrees clockwise from true north, or `null` with no heading. */
  readonly headingDeg: number | null;
  /** The driver's own latitude. RENDER ONLY -- see the header of this file. */
  readonly lat: number | null;
  /** The driver's own longitude. RENDER ONLY -- see the header of this file. */
  readonly lon: number | null;
  /**
   * The mesh feed is switched on AND connected. False collapses `SRC MESH+DB`
   * to `SRC DB`, because a source line that names a feed the build has switched
   * off is a false claim about where the dots came from -- the same reason the
   * legend reads `HAKCERS - ` rather than `HAKCERS 0`.
   */
  readonly meshLive: boolean;
}

/** `SCAN 2.4s`. */
export function formatScan(): string {
  return `SCAN ${SCAN_PERIOD_S.toFixed(1)}s`;
}

/** `RES 12PX`. */
export function formatResolution(): string {
  return `RES ${String(RESOLUTION_PX)}PX`;
}

/** `SRC MESH+DB` while the mesh is live, `SRC DB` when it is not. */
export function formatSource(meshLive: boolean): string {
  return meshLive ? 'SRC MESH+DB' : 'SRC DB';
}

/** `HDG 041°`, on the same zero-padded three digits RADAR's tile uses. */
export function formatHeadingLine(headingDeg: number | null): string {
  return `HDG ${formatHeadingDegrees(headingDeg)}`;
}

/** The bare signed number v2 draws. RENDER ONLY. */
function coordinate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE;
  return value.toFixed(COORDINATE_DECIMALS);
}

/** `LAT 39.0997`. RENDER ONLY -- see the header of this file. */
export function formatLatitude(lat: number | null): string {
  return `LAT ${coordinate(lat)}`;
}

/** `LON -84.5786`. RENDER ONLY -- see the header of this file. */
export function formatLongitude(lon: number | null): string {
  return `LON ${coordinate(lon)}`;
}

/** The left block, top to bottom, exactly as v2 stacks it. */
export function instrumentLines(telemetry: SweepTelemetry): readonly string[] {
  return [formatScan(), formatResolution(), formatSource(telemetry.meshLive)];
}

/** The right block, top to bottom, exactly as v2 stacks it. */
export function vehicleLines(telemetry: SweepTelemetry): readonly string[] {
  return [
    formatHeadingLine(telemetry.headingDeg),
    formatLatitude(telemetry.lat),
    formatLongitude(telemetry.lon),
  ];
}
