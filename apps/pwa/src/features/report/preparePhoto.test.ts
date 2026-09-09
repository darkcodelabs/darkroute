/**
 * PREPARING A PHOTO - the sizing and quality rules, without a browser.
 *
 * The decode/encode itself needs a real canvas and is covered by the report
 * flow in a browser; what is testable here is every decision made ABOUT the
 * image, which is where the bugs that matter would be.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_BYTES,
  MAX_EDGE_PX,
  MIN_QUALITY,
  START_QUALITY,
  fitWithin,
  qualityLadder,
} from './preparePhoto.ts';

describe('fitting a photo to the longest edge', () => {
  it('scales a landscape phone frame down by its width', () => {
    const fitted = fitWithin(4032, 3024);
    expect(fitted.width).toBe(MAX_EDGE_PX);
    expect(fitted.height).toBe(1200);
  });

  it('scales a portrait frame down by its height', () => {
    const fitted = fitWithin(3024, 4032);
    expect(fitted.height).toBe(MAX_EDGE_PX);
    expect(fitted.width).toBe(1200);
  });

  it('keeps the aspect ratio to within a pixel', () => {
    const frames: readonly (readonly [number, number])[] = [
      [4032, 3024],
      [1920, 1080],
      [3000, 4000],
      [2560, 1440],
    ];
    for (const [w, h] of frames) {
      const fitted = fitWithin(w, h);
      expect(fitted.width / fitted.height).toBeCloseTo(w / h, 2);
    }
  });

  it('NEVER enlarges a small photo', () => {
    // Upscaling adds bytes and no information. A small photo stays small.
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(100, 100)).toEqual({ width: 100, height: 100 });
  });

  it('refuses nonsense rather than producing a NaN-sized canvas', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-10, 20)).toEqual({ width: 0, height: 0 });
  });
});

describe('the quality ladder', () => {
  const ladder = qualityLadder();

  it('starts where it says and never goes below the floor', () => {
    expect(ladder[0]).toBe(START_QUALITY);
    expect(Math.min(...ladder)).toBeGreaterThanOrEqual(MIN_QUALITY);
  });

  it('only ever steps down', () => {
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!).toBeLessThan(ladder[i - 1]!);
    }
  });

  it('is short, because every rung is another full encode', () => {
    // A binary search would find a tighter answer and re-encode a
    // multi-megapixel image several more times to do it. On a phone that is
    // the expensive part, not the bytes it would save.
    expect(ladder.length).toBeLessThanOrEqual(4);
    expect(ladder.length).toBeGreaterThanOrEqual(2);
  });

  it('has a floor low enough to be reachable and high enough to be evidence', () => {
    // Past this a photo of a small distant object stops being usable as the
    // thing it exists to be. A file still over budget is returned anyway and
    // the caller is told the size.
    expect(MIN_QUALITY).toBeGreaterThanOrEqual(0.4);
    expect(MIN_QUALITY).toBeLessThan(START_QUALITY);
  });
});

describe('the size budget', () => {
  it('is small enough that a queue of reports is not a hidden upload', () => {
    // A dozen queued reports must not quietly be ten megabytes.
    expect(MAX_BYTES * 12).toBeLessThan(10 * 1024 * 1024);
  });
});
