/**
 * THE SWEEP DRAWS, MOVES, AND STOPS.
 *
 * jsdom has no 2D context, so the canvas is stubbed and the assertions are
 * about the CALLS: that a frame fills rectangles, that a later frame fills them
 * somewhere else, and that teardown ends the loop. That covers the three ways
 * this actually breaks - never starting, drawing one static frame, and running
 * forever after the map is gone. The middle one is what "the animation is
 * broken" looks like from outside.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startPixelSweep } from './pixelSweep.ts';

interface Fill {
  x: number;
  y: number;
}

let fills: Fill[];
let context: Record<string, unknown>;
let canvas: HTMLCanvasElement;
let frames: FrameRequestCallback[];

beforeEach(() => {
  fills = [];
  frames = [];
  context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn((x: number, y: number) => {
      fills.push({ x, y });
    }),
    globalCompositeOperation: '',
    fillStyle: '',
  };
  canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    width: 186,
    height: 186,
    top: 0,
    left: 0,
    right: 186,
    bottom: 186,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  // A frame queue this test drives by hand, so time is deterministic.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom has no ResizeObserver. The sweep must work without one, which is also
  // the older-browser path.
  vi.stubGlobal('ResizeObserver', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Run the next queued frame, stamped at `t` milliseconds. */
function tick(t: number): void {
  const next = frames.shift();
  next?.(t);
}

describe('startPixelSweep', () => {
  it('sizes the canvas to its box rather than the 300x150 default', () => {
    // A canvas left at its default draws the sweep at the wrong scale and
    // stretches it, which reads as a blurry smear rather than as pixels.
    startPixelSweep(canvas);
    expect(canvas.width).toBeGreaterThan(150);
    expect(canvas.height).toBeGreaterThan(150);
  });

  it('draws particles once time has passed', () => {
    startPixelSweep(canvas);
    tick(0);
    tick(16);
    tick(32);
    expect(fills.length, 'nothing was drawn').toBeGreaterThan(0);
  });

  it('MOVES: a later frame does not draw the first frame again', () => {
    startPixelSweep(canvas);
    for (let t = 0; t <= 240; t += 16) tick(t);
    const first = fills.slice(0, 10);
    const later = fills.slice(-10);
    const identical =
      first.length === later.length &&
      first.every((f, i) => later[i]?.x === f.x && later[i]?.y === f.y);
    expect(identical, 'every frame drew the same pixels').toBe(false);
  });

  it('clears rather than fills, so the map shows through', () => {
    // The reference demo repaints an opaque background every frame. Here the
    // background is the MAP: filling it would hide the road under the marker.
    startPixelSweep(canvas);
    tick(0);
    tick(16);
    expect(context['clearRect']).toHaveBeenCalled();
  });

  it('stops when torn down', () => {
    const stop = startPixelSweep(canvas);
    tick(0);
    tick(16);
    const before = fills.length;
    stop();
    // Any frame still queued must be inert afterwards.
    tick(32);
    tick(48);
    expect(fills.length, 'kept drawing after teardown').toBe(before);
  });

  it('survives a canvas with no 2D context at all', () => {
    const bare = document.createElement('canvas');
    vi.spyOn(bare, 'getContext').mockReturnValue(null);
    expect(() => {
      startPixelSweep(bare)();
    }).not.toThrow();
  });

  it('DRAWS NOTHING until it has a real box, then starts once it does', () => {
    /*
     * THE WHITE SQUARE.
     *
     * The canvas is created DETACHED - the marker element is built, the sweep
     * starts on it, and only then is the marker handed to MapLibre. A single
     * measurement at construction therefore read 0x0, the backing store came
     * out 1x1, and CSS stretched that one pixel over the whole 186px box. It
     * appeared to fix itself after a minute because an unrelated window resize
     * eventually re-measured it.
     */
    const detached = document.createElement('canvas');
    vi.spyOn(detached, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const rect = vi.spyOn(detached, 'getBoundingClientRect').mockReturnValue({
      width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });

    startPixelSweep(detached);
    tick(0);
    tick(16);
    expect(fills.length, 'drew into a box it did not have').toBe(0);

    // The marker is attached; the element now has its real size.
    rect.mockReturnValue({
      width: 186, height: 186, top: 0, left: 0, right: 186, bottom: 186, x: 0, y: 0,
      toJSON: () => ({}),
    });
    for (let t = 32; t <= 200; t += 16) tick(t);
    expect(detached.width, 'never re-measured once attached').toBeGreaterThan(150);
    expect(fills.length, 'never started drawing').toBeGreaterThan(0);
  });
});
