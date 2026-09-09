/**
 * THE PIXEL SWEEP - a radar wipe made of decaying pixels.
 *
 * HISTORICAL SOURCE: unpublished design demo `pixel-sweep-v4-1.html`. The demo
 * runs fullscreen over its own painted roads; this runs in a ~186px square pinned to the ego marker, over a
 * live MapLibre canvas, so three things changed and each one is a decision:
 *
 *   TRANSPARENT, NOT OPAQUE. The demo owns its background and repaints it every
 *   frame. Here the background is the MAP, so the context is alpha and the
 *   frame is CLEARED rather than filled. The demo's road beziers are dropped
 *   entirely - there are real roads underneath.
 *
 *   FAR FEWER PARTICLES. The demo budgets 1150 at 360/s across a whole phone
 *   screen. Scaled to the scope's area that would be a few dozen, and this app
 *   has a measured thermal history over exactly this compositing path, so the
 *   pool is small and the spawn rate is low. It reads the same because the
 *   sweep is small: the eye reads the moving edge, not the count.
 *
 *   NO COLOURS TYPED HERE. The demo hardcodes hues. Every colour below is read
 *   off CSS custom properties at start, so the sweep follows the theme like
 *   everything else and `check-design-values` stays honest.
 *
 * =============================================================================
 * IT SPINS, AND THE HEADING WEDGE MUST NOT
 * =============================================================================
 * The marker carries the driver's heading through MapLibre's `setRotation`, so
 * anything rotating INSIDE it stops meaning "which way am I facing". That was
 * reported once already, as the arrow "spinning around like a maniac", which is
 * why the heading wedge is static.
 *
 * This is a different object: a radar wipe, which is supposed to turn. It is
 * mounted OUTSIDE the rotating element and counter-rotated by the caller, so
 * the sweep is level with the world while the arrow points where the car does.
 */

/** How fast the leading edge travels, in radians per second. */
const SPEED = 1.05;

/**
 * The pool, and the rate that fills it.
 *
 * The demo's 1150 at 360/s covers a whole screen. This covers a disc a couple
 * of hundred pixels across on a device that must not get hot, and these are the
 * numbers that keep the trail continuous at that size.
 */
const MAX_PARTICLES = 150;
const SPAWN_RATE = 70;

/** Clamp on a resumed tab: a huge dt would spawn a whole pool in one frame. */
const MAX_FRAME_S = 0.04;

const TAU = Math.PI * 2;

interface Particle {
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
  flicker: number;
}

export interface SweepColours {
  /** Hue the bulk of the trail takes. Read from the theme's scan accent. */
  readonly hue: number;
  /** How far a particle's hue may wander, so the trail is not one flat colour. */
  readonly spread: number;
}

/**
 * The theme's scan accent, as an HSL hue.
 *
 * Read from a live element rather than a token string so it follows whatever
 * the mode set, including the seven v1 themes. Falls back to a cyan-ish hue
 * when the property is missing or unparseable - a sweep in the wrong colour is
 * better than no sweep and a thrown error on a driving screen.
 */
export function sweepColours(element: Element): SweepColours {
  const styles = getComputedStyle(element);
  const raw = styles.getPropertyValue('--fwm-sweep-hue').trim();
  const parsed = Number.parseFloat(raw);
  return {
    hue: Number.isFinite(parsed) ? parsed : 187,
    spread: 40,
  };
}

/**
 * Run the sweep on a canvas until the returned teardown is called.
 *
 * Owns nothing but the canvas: no timers outside its own frame loop, and it
 * stops itself when the page is hidden, because a radar animation nobody is
 * looking at is a phone getting warm in a pocket.
 */
/**
 * WHAT A RUNNING SWEEP HANDS BACK.
 *
 * It used to be the stop function alone. `moved()` is the addition, and the
 * whole reason for it is written at `IDLE_AFTER_S` below: the loop needs to be
 * told that the car is still going, or it has no way to tell a drive from a red
 * light and animates forever at both.
 */
export interface PixelSweep {
  /** Tear the loop down. Same function the caller used to get back directly. */
  readonly stop: () => void;
  /** The vehicle moved. Restarts the loop if it had idled out. */
  readonly moved: () => void;
}

/**
 * HOW LONG WITHOUT A MOVE BEFORE THE SWEEP GOES TO SLEEP.
 *
 * The sweep was the only thing awake at a red light, and that was measured
 * rather than assumed: parked with DRIVE up, under 4x CPU throttle, the app is
 * 15.2% of one core with the sweep running and 8.0% with it stopped, and 9.51%
 * of the main thread versus 0.27%. It is the only thing keeping the compositor's
 * Commit and PrePaint alive. While the car is MOVING it is free - MapLibre's own
 * repaint dominates by roughly ten to one and turning the sweep off changed
 * nothing outside noise - so the fix is not to make it cheaper, it is to notice
 * that nobody is watching a decoration while they wait for a light.
 *
 * Four seconds because a GPS fix arrives about once a second and a stopped car
 * still reports jitter; anything under about three would flicker the sweep back
 * on at the kerb. `syncVehicle` calls `moved()` on every position update, so a
 * crawling car in traffic keeps it alive.
 */
const IDLE_AFTER_S = 4;

/**
 * How many zero-size frames to tolerate before sleeping.
 *
 * About a second at 60fps. Long enough that a canvas which is merely detached
 * at construction is measured and drawn without a hiccup; short enough that a
 * canvas which is `display: none` because the driver asked for reduced motion
 * stops costing a layout flush per frame almost immediately.
 */
const BLANK_FRAMES_BEFORE_IDLE = 60;

export function startPixelSweep(canvas: HTMLCanvasElement): PixelSweep {
  /*
   * NO `desynchronized`. The reference demo uses it, and fullscreen over its
   * own opaque background that is free speed. Here the canvas is a TRANSPARENT
   * overlay on top of a GL map, and the low-latency path composites some
   * Android GPUs' canvases as an opaque block - the sweep rendered as a solid
   * white or black square sitting over the road. Correctness over latency: this
   * is a decorative wipe, not an input surface.
   */
  const ctx = canvas.getContext('2d', { alpha: true });
  if (ctx === null) return { stop: () => undefined, moved: () => undefined };

  const colours = sweepColours(canvas);
  const pool: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    on: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    max: 0,
    size: 1,
    hue: colours.hue,
    flicker: 0,
  }));

  let cursor = 0;
  let carry = 0;
  let head = -0.1;
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  let width = 0;
  let height = 0;
  /*
   * HOW LONG THE VEHICLE HAS BEEN STILL, accumulated from the frame's own `dt`
   * rather than compared against `performance.now()`.
   *
   * The first cut stamped a wall clock in `moved()` and subtracted it from the
   * frame's `now`. Those are the same clock in a browser and NOT the same clock
   * anywhere the frames are driven by hand - the tests step `now` from zero
   * while `performance.now()` returns real uptime, so the difference came out
   * hugely negative and the sweep could never idle. Summing `dt` uses one
   * clock, the one the animation itself is already integrating.
   */
  let stillFor = 0;
  /** Consecutive frames with no box to draw into. See the zero-size branch. */
  let blankFrames = 0;

  /**
   * MEASURED WHENEVER THE BOX CHANGES, NOT ONCE AT THE START.
   *
   * This ran a single time, at construction - and at construction the canvas is
   * DETACHED: the marker element is built, the sweep is started on it, and only
   * then is the marker handed to MapLibre and put in the document. So the first
   * measurement was 0x0, the backing store came out 1x1, and CSS stretched that
   * one pixel across the whole 186px box. That is the white square, and it
   * "fixed itself after a minute" only because a window resize eventually fired
   * and re-measured it.
   *
   * A ResizeObserver watches the element's own box rather than the window's, so
   * it corrects on the frame the marker is attached instead of waiting for an
   * unrelated event that may never come.
   */
  const measure = (): void => {
    /*
     * THE LAYOUT BOX, NOT THE PAINTED ONE, and the difference is a squashed
     * sweep rather than a rounding error.
     *
     * This read `getBoundingClientRect()`, which returns the axis-aligned box of
     * the element AFTER transforms. The canvas sits inside a MapLibre marker
     * that `setRotation` turns to carry the heading, so at any heading that is
     * not a multiple of 90 degrees the rect is the bounding box of a rotated
     * square - measured at heading 45 it came back 212x122 for an element whose
     * own box is 184x184. The backing store was then sized to that, and the
     * sweep was drawn into a squashed box whose shape depended on which way the
     * car was pointing.
     *
     * `offsetWidth`/`offsetHeight` are the element's own border box and ignore
     * transforms entirely, which is exactly the question being asked here. They
     * are integers, which costs sub-pixel precision on a square this size and
     * is worth it: a stable square beats a precise parallelogram.
     */
    const boxWidth = canvas.offsetWidth;
    const boxHeight = canvas.offsetHeight;
    if (boxWidth <= 0 || boxHeight <= 0) return;
    const rect = { width: boxWidth, height: boxHeight };
    // A device pixel ratio above ~1.15 buys nothing on squares this small and
    // costs the fill rate linearly. The demo caps it for the same reason.
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.15);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  measure();

  /*
   * THE ONE WAY BACK INTO THE LOOP. `raf === 0` is the single "not running"
   * state - `visibility()`, the zero-size sleep and the stopped-car sleep all
   * land on it - so everything that could mean "there is something to draw
   * again" re-enters here rather than each growing its own restart.
   */
  const wake = (): void => {
    if (stopped || raf !== 0) return;
    if (globalThis.document?.visibilityState === 'hidden') return;
    blankFrames = 0;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          measure();
          // The element just got a box back - reduced motion turned off, or the
          // heading became known again. Nothing else would restart the loop.
          if (width > 0 && height > 0) wake();
        })
      : null;
  observer?.observe(canvas);

  const nextParticle = (): Particle => {
    for (let n = 0; n < MAX_PARTICLES; n += 1) {
      const q = pool[cursor] as Particle;
      cursor = (cursor + 1) % MAX_PARTICLES;
      if (!q.on) return q;
    }
    const q = pool[cursor] as Particle;
    cursor = (cursor + 1) % MAX_PARTICLES;
    return q;
  };

  const emit = (cx: number, cy: number, r: number, dt: number): void => {
    carry += SPAWN_RATE * dt;
    let n = Math.min(carry | 0, 8);
    carry -= n;

    while (n > 0) {
      n -= 1;
      const q = nextParticle();
      // DEPTH is how far out along the beam a particle starts. The power curve
      // biases toward the middle so the trail has a body rather than a rim.
      const depth = Math.pow(Math.random(), 0.68);
      const lag = Math.pow(Math.random(), 2.1) * 0.19;
      const a = head - lag + (Math.random() - 0.5) * (0.025 + depth * 0.055);
      const rr = r * (0.18 + depth * 0.82);
      const lateral = (Math.random() - 0.5) * r * (0.03 + depth * 0.13);

      q.on = true;
      q.x = cx + Math.cos(a) * rr - Math.sin(a) * lateral;
      q.y = cy + Math.sin(a) * rr + Math.cos(a) * lateral;

      const drift = 1 + Math.random() * 6;
      const side = (Math.random() - 0.5) * (2 + depth * 5);
      q.vx = Math.cos(a) * drift - Math.sin(a) * side;
      q.vy = Math.sin(a) * drift + Math.cos(a) * side;

      // A few live much longer and much larger. Without them the trail is an
      // even wash; with them it sparkles, which is what reads as pixels.
      const odd = Math.random();
      q.max = odd < 0.06 ? 1.4 + Math.random() : 0.45 + Math.random() * 0.85;
      q.life = q.max;
      q.size = odd < 0.035 ? 2.6 + Math.random() * 1.8 : 0.8 + Math.random() * 1.6;
      q.hue = colours.hue + (Math.random() - 0.5) * colours.spread;
      q.flicker = Math.random() * TAU;
    }
  };

  const frame = (now: number): void => {
    if (stopped) return;
    const dt = Math.min((now - last) / 1000, MAX_FRAME_S);
    last = now;

    // NOTHING IS DRAWN INTO AN UNKNOWN BOX. Until the marker is in the document
    // there is no size to draw at, and anything emitted now would be placed
    // against the wrong centre and then stretched.
    if (width <= 0 || height <= 0) {
      measure();
      /*
       * A BOX THAT NEVER ARRIVES IS NOT A BOX WORTH WAITING FOR AT 60Hz.
       *
       * Two states park the canvas at zero size FOREVER, and both are supposed
       * to be the cheap ones: `prefers-reduced-motion: reduce` and an unknown
       * heading each set `display: none` in `map.css`. The comment there says
       * the sweep is "removed from the layout rather than merely paused, so it
       * costs no compositing" - true about compositing, false about this loop,
       * which kept spinning and calling `measure()`, and `measure()` reads the
       * element's box. That is a forced style and layout flush sixty times a
       * second, forever, measured at 7.29% of a core against 0.72% with the
       * sweep genuinely absent. A driver who asked for stillness was paying ten
       * times the idle cost for an animation they had switched off.
       *
       * A second of frames first, because at construction the canvas is
       * DETACHED and legitimately measures zero until the marker is put in the
       * document. After that, sleep - `wake()` is wired to the ResizeObserver,
       * so the moment the element gets a box the loop comes back.
       */
      blankFrames += 1;
      if (blankFrames > BLANK_FRAMES_BEFORE_IDLE) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
      return;
    }
    blankFrames = 0;

    head = (head + SPEED * dt) % TAU;

    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) / 2;

    /*
     * THE CAR IS STOPPED, SO THE SWEEP STOPS - but it FADES OUT rather than
     * vanishing. Emission ceases the moment the vehicle has been still for
     * `IDLE_AFTER_S`; the particles already in the air keep running until the
     * pool drains, and only then does the loop let go of the frame callback.
     * Cutting the rAF the instant the timer fires would leave a frozen spray of
     * dots painted over the map until the car pulled away.
     */
    stillFor += dt;
    const idle = stillFor >= IDLE_AFTER_S;
    if (!idle) emit(cx, cy, r, dt);

    for (const q of pool) {
      if (!q.on) continue;
      q.life -= dt;
      if (q.life <= 0) {
        q.on = false;
        continue;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.flicker += dt * 5;
    }

    // CLEARED, not filled. The map is the background.
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let live = 0;
    for (const q of pool) {
      if (!q.on) continue;
      live += 1;
      const remain = q.life / q.max;
      const alpha = Math.min(1, remain * 1.65) * (0.72 + 0.28 * Math.sin(q.flicker));
      if (alpha < 0.035) continue;
      ctx.fillStyle = `hsl(${String(Math.round(q.hue))} 100% 61% / ${alpha.toFixed(3)})`;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.restore();

    /*
     * AND HERE IS WHERE IT ACTUALLY GOES QUIET. Idle AND nothing left in the
     * air: clear the canvas one final time and drop the frame callback, so the
     * compositor, the GPU and the core all get to idle while the car waits.
     * `raf = 0` is the same "not running" state `visibility()` uses, which is
     * what lets `moved()` restart through one path instead of two.
     */
    if (idle && live === 0) {
      ctx.clearRect(0, 0, width, height);
      raf = 0;
      return;
    }

    raf = requestAnimationFrame(frame);
  };

  /**
   * NOTHING RUNS WHILE THE PAGE IS HIDDEN.
   *
   * `requestAnimationFrame` is already throttled when hidden, but the loop is
   * stopped outright so a backgrounded tab holds no callback at all.
   */
  const visibility = (): void => {
    if (globalThis.document?.visibilityState === 'hidden') {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (raf === 0 && !stopped) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  document.addEventListener('visibilitychange', visibility);
  globalThis.addEventListener('resize', measure, { passive: true });
  raf = requestAnimationFrame(frame);

  return {
    /*
     * THE VEHICLE MOVED. Stamp the clock, and if the loop had idled itself out,
     * bring it back the same way `visibility()` does - `raf === 0` is the one
     * "not running" state, and `last` has to be reset or the first frame after
     * a wait computes a `dt` of however long the car sat there and flings every
     * particle across the canvas. `MAX_FRAME_S` would clamp it; resetting is
     * still the honest thing, because no time passed for the animation.
     */
    moved: () => {
      stillFor = 0;
      wake();
    },
    stop: () => {
      stopped = true;
      observer?.disconnect();
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', visibility);
      globalThis.removeEventListener('resize', measure);
    },
  };
}
