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
  /*
   * THE ELEMENT'S OWN BOX, because that is what the sweep measures now.
   *
   * It used to read `getBoundingClientRect()`, and this file mocked that. The
   * canvas sits inside a MapLibre marker that is ROTATED to carry the heading,
   * so that rect is the axis-aligned box of a rotated square - 212x122 at
   * heading 45 for an element whose own box is 184x184 - and the backing store
   * was sized to it. `offsetWidth`/`offsetHeight` ignore transforms, which is
   * the question being asked. jsdom does no layout and reports 0 for both, so
   * they are defined here; the rect mock stays because nothing should depend on
   * which of the two the implementation happens to read.
   */
  Object.defineProperty(canvas, 'offsetWidth', { value: 186, configurable: true });
  Object.defineProperty(canvas, 'offsetHeight', { value: 186, configurable: true });
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
    const sweep = startPixelSweep(canvas);
    tick(0);
    tick(16);
    const before = fills.length;
    sweep.stop();
    // Any frame still queued must be inert afterwards.
    tick(32);
    tick(48);
    expect(fills.length, 'kept drawing after teardown').toBe(before);
  });

  /**
   * THE RED LIGHT, which is the whole reason this loop can stop at all.
   *
   * Measured before the guard existed: parked with DRIVE up under 4x CPU
   * throttle, the app was 15.2% of one core with the sweep running and 8.0%
   * with it asleep - 9.51% of the main thread against 0.27% - and it was the
   * only thing keeping the compositor's Commit and PrePaint alive. While the
   * car MOVES it is free, because MapLibre's own repaint dominates by roughly
   * ten to one. So the fix is not a cheaper sweep, it is a sweep that notices
   * nobody is watching a decoration while they wait for a light.
   */
  it('goes quiet once the vehicle has been still, and fades rather than vanishing', () => {
    const sweep = startPixelSweep(canvas);
    // A few frames to warm up: the first measures the box, and a particle has
    // to live long enough to clear the alpha floor before it is painted.
    let warm = 0;
    for (let i = 0; i < 6; i += 1) {
      warm += 16;
      tick(warm);
    }
    expect(fills.length, 'nothing drawn while moving').toBeGreaterThan(0);

    // Four seconds with no `moved()`. Emission stops here, but the particles
    // already in the air have to run out before the loop may let go - cutting
    // the callback the instant the timer fires would freeze a spray of dots on
    // the map until the car pulled away.
    let t = warm;
    let queuedWhileDraining = 0;
    // IDLE_AFTER_S is 4s and a particle can live 2.4s, so a full quiet-down
    // is about 400 frames at 16ms. 1200 leaves headroom without hanging.
    for (let i = 0; i < 1200 && frames.length > 0; i += 1) {
      t += 16;
      tick(t);
      queuedWhileDraining += 1;
    }

    expect(frames.length, 'still holding a frame callback while parked').toBe(0);
    expect(queuedWhileDraining, 'stopped dead instead of fading out').toBeGreaterThan(1);
    sweep.stop();
  });

  it('wakes up again when the vehicle moves', () => {
    const sweep = startPixelSweep(canvas);
    let t = 0;
    // IDLE_AFTER_S is 4s and a particle can live 2.4s, so a full quiet-down
    // is about 400 frames at 16ms. 1200 leaves headroom without hanging.
    for (let i = 0; i < 1200 && frames.length > 0; i += 1) {
      t += 16;
      tick(t);
    }
    expect(frames.length, 'did not idle out').toBe(0);

    const before = fills.length;
    sweep.moved();
    expect(frames.length, 'moving did not re-arm the loop').toBe(1);
    tick(t + 16);
    tick(t + 32);
    expect(fills.length, 'awake but drawing nothing').toBeGreaterThan(before);
    sweep.stop();
  });

  /**
   * REDUCED MOTION, AND THE HEADING-UNKNOWN STATE, WHICH ARE THE SAME BUG.
   *
   * `map.css` answers both by setting `display: none` on the canvas, under a
   * comment saying the sweep is "removed from the layout rather than merely
   * paused, so it costs no compositing". That is true about compositing and was
   * false about this loop: it kept spinning, and every frame called `measure()`,
   * which reads the element's box - a forced style and layout flush sixty times
   * a second, forever. Measured at 7.29% of a core against 0.72% with the sweep
   * genuinely absent, so a driver who asked for stillness paid ten times the
   * idle cost for an animation they had switched off.
   */
  it('sleeps instead of spinning when the canvas is display:none', () => {
    const hidden = document.createElement('canvas');
    vi.spyOn(hidden, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    Object.defineProperty(hidden, 'offsetWidth', { value: 0, configurable: true });
    Object.defineProperty(hidden, 'offsetHeight', { value: 0, configurable: true });

    const sweep = startPixelSweep(hidden);
    let t = 0;
    for (let i = 0; i < 400 && frames.length > 0; i += 1) {
      t += 16;
      tick(t);
    }

    expect(fills.length, 'drew into a box it does not have').toBe(0);
    expect(frames.length, 'still holding a frame callback with nothing to draw').toBe(0);
    sweep.stop();
  });

  it('survives a canvas with no 2D context at all', () => {
    const bare = document.createElement('canvas');
    vi.spyOn(bare, 'getContext').mockReturnValue(null);
    expect(() => {
      startPixelSweep(bare).stop();
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
    // Detached: the element's own box is zero. See `measure()` for why this is
    // `offsetWidth` and not a client rect.
    let box = 0;
    Object.defineProperty(detached, 'offsetWidth', { get: () => box, configurable: true });
    Object.defineProperty(detached, 'offsetHeight', { get: () => box, configurable: true });

    startPixelSweep(detached);
    tick(0);
    tick(16);
    expect(fills.length, 'drew into a box it did not have').toBe(0);

    // The marker is attached; the element now has its real size.
    box = 186;
    for (let t = 32; t <= 200; t += 16) tick(t);
    expect(detached.width, 'never re-measured once attached').toBeGreaterThan(150);
    expect(fills.length, 'never started drawing').toBeGreaterThan(0);
  });
});
