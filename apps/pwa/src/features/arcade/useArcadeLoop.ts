/**
 * THE FRAME. One requestAnimationFrame loop, one canvas, no text.
 *
 * `sim.ts` decides what happens; this decides when and paints it. Fixed-step
 * accumulator at sixty steps a second, the elapsed time clamped at
 * `MAX_FRAME_S` so a stalled tab does not deliver a lifetime of rocks in one
 * frame. Hidden tabs pause the loop and resume with a fresh clock -- paused,
 * not forfeited, see `useArcadeStandDown.ts`.
 *
 * COLOUR IS READ, NOT WRITTEN. `readArcadePalette` resolves the tokens off
 * the canvas at mount and again whenever `data-fwm-mode` changes on the root,
 * so a skin switch mid-round repaints the next frame in the new skin. The
 * unit -- a shot, a burst square, the stroke -- is `--fwm-space-1`, read the
 * same way. Not one literal length or colour is in this file.
 *
 * NO `desynchronized` on the context. `map/pixelSweep.ts` learned that the
 * low-latency path composites some Android GPUs' canvases as an opaque block
 * over the map; this canvas is transparent over glass over the map, and it is
 * cleared, never filled.
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

import { BURST_TOKENS, OWNER_TOKEN, readArcadePalette } from './palette.ts';
import type { ArcadePalette } from './palette.ts';
import { MAX_FRAME_S, SHIP_R, polar, rockRadius, step } from './sim.ts';
import type { RoundState } from './sim.ts';

/** Sixty steps a second. */
const STEP_S = 1 / 60;

const DEG = Math.PI / 180;

export interface ArcadeLoopInput {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly round: RoundState | null;
  /** False stops the loop: standing down, or the round is over. */
  readonly active: boolean;
  /** After every painted frame. The overlay syncs its HUD off this. */
  readonly onFrame: (round: RoundState) => void;
}

export interface ArenaPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A pointer position to arena units, given the canvas's client rect.
 *
 * The unit is half the shorter side, so 1.0 is the edge of the field on that
 * axis. A zero-sized rect (jsdom) falls back to a unit of one rather than
 * dividing by nothing.
 */
export function pointToArena(
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  clientX: number,
  clientY: number,
): ArenaPoint {
  const unit = Math.min(rect.width, rect.height) / 2;
  const safe = unit > 0 ? unit : 1;
  return {
    x: (clientX - rect.left - rect.width / 2) / safe,
    y: (clientY - rect.top - rect.height / 2) / safe,
  };
}

/** Paint one frame. Clears; never fills. */
export function drawRound(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  round: RoundState,
  palette: ArcadePalette,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const unit = Math.min(width, height) / 2;
  const cx = width / 2;
  const cy = height / 2;
  const u = palette.unitPx;
  const colours = palette.colours;

  ctx.lineWidth = u / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* ROCKS. Seven-vertex outlines in the owner's hue; muted when clamped. */
  for (const rock of round.rocks) {
    const at = polar(rock.r, rock.angleDeg);
    const px = cx + at.x * unit;
    const py = cy + at.y * unit;
    const rr = rockRadius(rock) * unit;
    ctx.strokeStyle = rock.clamped ? colours['--dr-ink-muted'] : colours[OWNER_TOKEN[rock.owner]];
    ctx.beginPath();
    const n = rock.shape.length;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + rock.angleDeg * DEG;
      const radius = rr * (rock.shape[i] ?? 1);
      const x = px + Math.cos(a) * radius;
      const y = py + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /* SHOTS. One unit square, in the accent. */
  ctx.fillStyle = colours['--dr-accent'];
  for (const bullet of round.bullets) {
    ctx.fillRect(cx + bullet.x * unit - u / 2, cy + bullet.y * unit - u / 2, u, u);
  }

  /* THE BURST. One unit square per particle, in the six pixel hues, fading. */
  for (const particle of round.particles) {
    const life = round.burstS > 0 ? particle.age / round.burstS : 1;
    ctx.globalAlpha = Math.max(0, 1 - life);
    ctx.fillStyle = colours[BURST_TOKENS[particle.tone - 1] ?? '--dr-px-1'];
    ctx.fillRect(cx + particle.x * unit - u / 2, cy + particle.y * unit - u / 2, u, u);
  }
  ctx.globalAlpha = 1;

  /* THE SHIP. A notched triangle in the dock's ink, nose where the last tap was. */
  const nose = polar(SHIP_R, round.shipAngleDeg);
  const left = polar(SHIP_R * 0.9, round.shipAngleDeg - 140);
  const right = polar(SHIP_R * 0.9, round.shipAngleDeg + 140);
  const notch = polar(SHIP_R * 0.4, round.shipAngleDeg + 180);
  ctx.strokeStyle = colours['--dr-ink'];
  ctx.beginPath();
  ctx.moveTo(cx + nose.x * unit, cy + nose.y * unit);
  ctx.lineTo(cx + right.x * unit, cy + right.y * unit);
  ctx.lineTo(cx + notch.x * unit, cy + notch.y * unit);
  ctx.lineTo(cx + left.x * unit, cy + left.y * unit);
  ctx.closePath();
  ctx.stroke();
}

export function useArcadeLoop({ canvasRef, round, active, onFrame }: ArcadeLoopInput): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || round === null || canvas === null) return;
    if (typeof globalThis.requestAnimationFrame !== 'function') return;

    let palette = readArcadePalette(canvas);
    /* `null` in a headless DOM: the simulation still runs and the HUD still
       updates; only the paint is skipped. */
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;

    let frame: number | null = null;
    let last = performance.now();
    let acc = 0;

    const paint = (): void => {
      const dpr = globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const bw = Math.round(width * dpr);
      const bh = Math.round(height * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      if (ctx !== null) drawRound(ctx, width, height, dpr, round, palette);
    };

    const tick = (now: number): void => {
      frame = null;
      acc += Math.min(Math.max(0, (now - last) / 1000), MAX_FRAME_S);
      last = now;
      while (acc >= STEP_S && round.over === null) {
        step(round, STEP_S);
        acc -= STEP_S;
      }
      paint();
      onFrame(round);
      if (round.over === null) frame = requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (frame !== null) return;
      last = performance.now();
      acc = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
    };

    /* HIDDEN PAUSES. A driver who takes a call comes back to the round where
       it was; the clock restarts from the moment of return. */
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    /* A SKIN SWITCH REPAINTS. The tokens are re-read off the canvas the next
       time the root's mode attribute changes. */
    const observer =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            palette = readArcadePalette(canvas);
          })
        : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-fwm-mode'],
    });

    if (!document.hidden) start();

    return (): void => {
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, canvasRef, onFrame, round]);
}
