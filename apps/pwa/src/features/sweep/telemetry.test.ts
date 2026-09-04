/**
 * The scope telemetry, against the six lines v2 draws -- and against the
 * privacy rule that governs three of them.
 *
 * `sweep.css` is read from disk so the printed scan period can be checked
 * against the animation that actually runs. vitest runs with `css: false`, so a
 * computed style would be empty and asserting on one would prove nothing.
 */

// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COORDINATE_DECIMALS,
  SCAN_PERIOD_S,
  formatHeadingLine,
  formatLatitude,
  formatLongitude,
  formatResolution,
  formatScan,
  formatSource,
  instrumentLines,
  vehicleLines,
} from './telemetry.ts';
import type { SweepTelemetry } from './telemetry.ts';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const sweepCss: string = readFileSync(`${HERE}/sweep.css`, 'utf8');

/** The exact fix v2 prints in the corner of `02 · SWEEP`. */
function telemetry(over: Partial<SweepTelemetry> = {}): SweepTelemetry {
  return { headingDeg: 41, lat: 39.0997, lon: -84.5786, meshLive: true, ...over };
}

describe('the instrument block', () => {
  it('reads exactly what v2 writes', () => {
    expect([...instrumentLines(telemetry())]).toStrictEqual([
      'SCAN 2.4s',
      'RES 12PX',
      'SRC MESH+DB',
    ]);
  });

  it('prints the scan period the stylesheet actually animates', () => {
    // The beam runs at `calc(var(--fwm-dur-alert) * 6)` and --fwm-dur-alert is
    // 400ms. A printed period that has drifted from the animation is a lie
    // about how often the scope has looked.
    expect(sweepCss).toContain('--fwm-sweep-dur: calc(var(--fwm-dur-alert) * 6);');
    expect(SCAN_PERIOD_S * 1000).toBe(400 * 6);
    expect(formatScan()).toBe('SCAN 2.4s');
  });

  it('keeps the resolution line as the chrome v2 writes it', () => {
    expect(formatResolution()).toBe('RES 12PX');
  });

  it('does not name a mesh feed the build has switched off', () => {
    // Same rule as the legend's `HAKCERS - `: a zero, or a source, from a feed
    // that has not looked is not an answer.
    expect(formatSource(true)).toBe('SRC MESH+DB');
    expect(formatSource(false)).toBe('SRC DB');
    expect([...instrumentLines(telemetry({ meshLive: false }))]).toContain('SRC DB');
  });
});

describe('the vehicle block', () => {
  it('reads exactly what v2 writes', () => {
    expect([...vehicleLines(telemetry())]).toStrictEqual([
      'HDG 041°',
      'LAT 39.0997',
      'LON -84.5786',
    ]);
  });

  it('zero-pads the heading to three digits, as RADAR does', () => {
    expect(formatHeadingLine(41)).toBe('HDG 041°');
    expect(formatHeadingLine(5)).toBe('HDG 005°');
    expect(formatHeadingLine(359)).toBe('HDG 359°');
  });

  it('says the heading is unknown rather than pointing north by default', () => {
    expect(formatHeadingLine(null)).toBe('HDG —');
    expect(formatHeadingLine(Number.NaN)).toBe('HDG —');
  });

  it('keeps the sign v2 draws instead of a hemisphere letter', () => {
    expect(formatLongitude(-84.5786)).toBe('LON -84.5786');
    expect(formatLatitude(-39.0997)).toBe('LAT -39.0997');
  });

  it('says the position is unknown rather than drawing the equator', () => {
    // `LAT 0.0000` is a real place in the Gulf of Guinea. An em dash is not.
    expect(formatLatitude(null)).toBe('LAT —');
    expect(formatLongitude(null)).toBe('LON —');
  });
});

describe('the coordinate is never more precise than v2 draws it', () => {
  it('rounds to four decimals, about eleven metres', () => {
    expect(COORDINATE_DECIMALS).toBe(4);
    expect(formatLatitude(39.099_712_345_6)).toBe('LAT 39.0997');
    expect(formatLongitude(-84.578_698_76)).toBe('LON -84.5787');
  });

  it('has no path that widens it -- there is no debug precision', () => {
    // The whole module, as text: nothing here reads a flag, an env var or a
    // query string to decide how many decimals to print.
    const source: string = readFileSync(`${HERE}/telemetry.ts`, 'utf8');
    expect(source).not.toContain('import.meta.env');
    expect(source).not.toContain('location.search');
    expect(source).not.toContain('localStorage');
    // And exactly one place decides the precision.
    expect(source.match(/toFixed\(/g)).toHaveLength(2);
  });
});
