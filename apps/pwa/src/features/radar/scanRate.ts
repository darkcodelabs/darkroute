/**
 * SCAN RATE -- how often the scope is actually being told where the vehicle is.
 *
 * v2 prints `SCAN 4HZ` down the right edge of RADAR's scope, opposite
 * `1000FT`. Both are scope telemetry: the instrument describing its own
 * settings on the dimmest text rung the system has. SWEEP prints the same rung
 * as `SCAN 2.4s / RES 12PX / SRC MESH+DB`.
 *
 * =============================================================================
 * WHY THIS IS MEASURED AND NOT DECLARED
 * =============================================================================
 * 4 Hz is a real number in the design, and it belongs to the hardware:
 * "ESP32-S3 · glovebox node · firmware 1.4.2 · streaming at 4 Hz over its own
 * AP" -- `Flockys Screens II.dc.html`, `A3 · CONNECT`. A plain browser gets
 * whatever cadence the platform feels like giving it, and nothing in this build
 * is paired to a node.
 *
 * Printing `4HZ` regardless would be fabricating instrument data, which is the
 * same offence as printing a satellite count a browser cannot supply (see the
 * SATELLITE COUNT note in `stores/position.ts`). So the rate is MEASURED from
 * the timestamps the position slice already publishes, and when there is
 * nothing to measure it says so with an em dash.
 *
 * =============================================================================
 * THERE IS NO GAP THRESHOLD, ON PURPOSE
 * =============================================================================
 * The window is the last {@link SCAN_RATE_SAMPLES} fix times and the rate is
 * the span divided into the intervals inside it. A stall drags the average
 * down while it is in the window and ages out of it afterwards, which is what
 * actually happened. A "reset after N seconds" rule would need a threshold no
 * design file states, and would hide a slow stream behind a fresh-looking
 * number.
 *
 * Pure: no clock, no store, no React. The caller supplies the timestamps.
 */

import { NO_VALUE } from './format.ts';

/**
 * How many fix timestamps the rate is averaged over.
 *
 * Eight is two seconds at the design's 4 Hz and eight seconds at a browser's
 * typical 1 Hz -- long enough that one late fix does not make the readout
 * flicker, short enough that a stream that really has slowed says so within a
 * few seconds. It is a smoothing window, not a design value.
 */
export const SCAN_RATE_SAMPLES = 8;

/**
 * Add one fix time to the window, oldest first.
 *
 * Idempotent in the value: handing it the same timestamp twice leaves the
 * window untouched the second time. The position slice republishes `fixAtMs`
 * on every render until the next fix lands, and a strict-mode double render
 * must not count as two fixes. `null` (nothing has ever arrived) leaves the window
 * alone; a timestamp older than the newest one is dropped, because a clock
 * that went backwards is not a measurement.
 */
export function trackFixTime(
  samples: readonly number[],
  atMs: number | null,
): readonly number[] {
  if (atMs === null || !Number.isFinite(atMs)) return samples;

  const last = samples[samples.length - 1];
  if (last !== undefined && atMs <= last) return samples;

  const next = [...samples, atMs];
  return next.length > SCAN_RATE_SAMPLES ? next.slice(next.length - SCAN_RATE_SAMPLES) : next;
}

/**
 * Fixes per second across the window, or null when there is nothing to divide.
 *
 * Two samples are the minimum: one timestamp is an event, not a rate.
 */
export function scanRateHz(samples: readonly number[]): number | null {
  if (samples.length < 2) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) return null;

  const spanMs = last - first;
  if (spanMs <= 0) return null;

  const MS_PER_SECOND = 1000;
  return ((samples.length - 1) * MS_PER_SECOND) / spanMs;
}

/**
 * The telemetry string: `4HZ`, `0.5HZ`, or an em dash.
 *
 * Whole hertz at 1 Hz and above, one decimal below it -- a stream slower than
 * once a second rounds to `0HZ` otherwise, and "zero" reads as "stopped" on a
 * screen that is still updating. No space before the unit: the design renders
 * `SCAN 4HZ`, not `SCAN 4 HZ`.
 */
export function formatScanRate(hz: number | null): string {
  if (hz === null || !Number.isFinite(hz) || hz <= 0) return NO_VALUE;
  return hz >= 1 ? `${String(Math.round(hz))}HZ` : `${hz.toFixed(1)}HZ`;
}
