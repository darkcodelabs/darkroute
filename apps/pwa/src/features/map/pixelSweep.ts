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
export function startPixelSweep(canvas: HTMLCanvasElement): () => void {
  /*
   * NO `desynchronized`. The reference demo uses it, and fullscreen over its
   * own opaque background that is free speed. Here the canvas is a TRANSPARENT
   * overlay on top of a GL map, and the low-latency path composites some
   * Android GPUs' canvases as an opaque block - the sweep rendered as a solid
   * white or black square sitting over the road. Correctness over latency: this
   * is a decorative wipe, not an input surface.
   */
  const ctx = canvas.getContext('2d', { alpha: true });
  if (ctx === null) return () => undefined;

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
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
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

  const observer =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => { measure(); }) : null;
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
      raf = requestAnimationFrame(frame);
      return;
    }

    head = (head + SPEED * dt) % TAU;

    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(width, height) / 2;

    emit(cx, cy, r, dt);

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
    for (const q of pool) {
      if (!q.on) continue;
      const remain = q.life / q.max;
      const alpha = Math.min(1, remain * 1.65) * (0.72 + 0.28 * Math.sin(q.flicker));
      if (alpha < 0.035) continue;
      ctx.fillStyle = `hsl(${String(Math.round(q.hue))} 100% 61% / ${alpha.toFixed(3)})`;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.restore();

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

  return () => {
    stopped = true;
    observer?.disconnect();
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', visibility);
    globalThis.removeEventListener('resize', measure);
  };
}
