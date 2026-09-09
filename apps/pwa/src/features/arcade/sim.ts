/**
 * PEW -- the round, as arithmetic.
 *
 * The owner's ask, verbatim: "I think it would be fun if there was a mini game
 * kinda like asteroids where if you were near a camera you could pewpew at it
 * or something." This file is the "kinda like asteroids" half. It knows
 * nothing about a canvas, a store, a token or a phone; `ArcadeOverlay.tsx`
 * draws what it computes and `useArcadeLoop.ts` decides when.
 *
 * =============================================================================
 * THE FIELD IS THE READERS AROUND THE CAR, ABSTRACTED
 * =============================================================================
 * The ship is the car and it is PARKED -- no thrust, no drift -- because the
 * game is only offered to a parked car (`offer.ts`). Every rock is a reader
 * within the dock's own two-mile horizon, placed at the bearing it really sits
 * on, turned into the phone's frame by `screenAngleDeg` exactly the way the
 * sweep does, and at a radius linear in its measured distance. The one the
 * dock is talking about -- the nearest, in range -- is the big rock.
 *
 * IT IS A GAME'S WORLD, NOT A DISTANCE CLAIM. A reader more than a mile out
 * sits on the edge of the field whatever its distance, and the renderer paints
 * those in the muted ink so nobody reads a position off them. The rocks then
 * ORBIT and SPIRAL IN, which no camera does; the field is captured once when
 * the round opens and never re-anchored to the live assessments, so a GPS
 * wobble cannot move a rock a player is aiming at.
 *
 * =============================================================================
 * UNITS
 * =============================================================================
 * Arena units: the ship is at the origin and 1.0 is half the SHORTER side of
 * the canvas, so a rock at radius 1 is on the edge whichever way the arena is
 * taller. Angles are compass-style: 0 up, clockwise, in degrees -- the sweep's
 * own convention, so `screenAngleDeg` feeds straight in. Time is seconds.
 *
 * Every constant below is a bare number. The two that are design values --
 * the shot cadence and the burst's decay -- arrive from the stylesheet through
 * `RoundOptions`, read off `--fwm-dur-fast` and `--fwm-dur-alert` by
 * `palette.ts`; the defaults here exist for a headless run and are the same
 * numbers `tokens.css` states.
 *
 * =============================================================================
 * DETERMINISM
 * =============================================================================
 * The one random stream is the 31-bit LCG `PixelSweep.tsx` uses, seeded by the
 * caller. Same readers, same heading, same seed: the same field, the same
 * spins, the same rock outlines. The tests lean on that.
 */

import type { DockNearbyOwner } from '../dock/ExpandedPanel.tsx';
import { screenAngleDeg } from '../sweep/geometry.ts';

/* ------------------------------------------------------------------------ *
 * THE NUMBERS
 * ------------------------------------------------------------------------ */

/** A round is a minute, or a collision, whichever is first. */
export const ROUND_S = 60;

/** The longest step the simulation will take. A tab that was hidden for ten
 *  seconds gets one 0.04s step on return, not ten seconds of rocks. */
export const MAX_FRAME_S = 0.04;

/** Asteroids' own rule: three shots in the air, no more. */
export const MAX_BULLETS = 3;

/** Arena-heights per second. Crosses the field in well under a second. */
export const BULLET_SPEED = 1.6;

/** Past this radius a bullet has left the field and is dropped. */
export const BULLET_EDGE = 1.15;

/** Radians per second, before the ramp. */
export const ORBIT_RAD_S = 0.08;

/** Arena-heights per second inward, before the ramp. */
export const INWARD_S = 0.02;

/** Every 15 seconds both speeds grow 10%. */
export const RAMP_EVERY_S = 15;
export const RAMP_FACTOR = 1.1;

/** The ship's hit radius, and a full-size rock's drawn radius. */
export const SHIP_R = 0.07;
export const ROCK_R = 0.09;

/** The in-range nearest reader is the big one. */
export const NEAREST_SCALE = 3;

/** A fragment below a quarter of full size is dust and vanishes. */
export const MIN_FRAGMENT = 0.25;

/** Fragments leave the split at this angular offset either side of the parent. */
export const SPLIT_DEG = 30;

/** Twelve one-unit squares fly out of every hit. */
export const BURST_COUNT = 12;

/** A cleared field waits this long before a fresh rock arrives at the edge. */
export const RESPAWN_S = 3;

/** How many readers the field holds. The nearest sixteen; the rest are noise. */
export const MAX_ROCKS = 16;

/** Where a reader lands: this close is the inner ring, a mile out is the edge. */
export const NEAREST_R = 0.62;
export const INNER_R = 0.5;
export const EDGE_FT = 5280;

/** Defaults for the two stylesheet-derived durations. See the header. */
export const DEFAULT_CADENCE_S = 0.16;
export const DEFAULT_BURST_S = 0.4;

/** Six hues in the mark's own pixel palette. `--dr-px-1` .. `--dr-px-6`. */
export const BURST_TONES = 6;

/* ------------------------------------------------------------------------ *
 * THE SHAPES
 * ------------------------------------------------------------------------ */

/** What the field is built from. A subset of `CameraAssessment`, on purpose. */
export interface ArcadeReader {
  readonly id: string;
  readonly distanceFt: number;
  readonly bearingDeg: number;
  readonly inRange: boolean;
  readonly owner: DockNearbyOwner;
}

export interface Rock {
  readonly id: number;
  readonly owner: DockNearbyOwner;
  /** Screen angle, degrees, 0 up, clockwise. Mutated by the orbit. */
  angleDeg: number;
  /** Distance from the ship, arena units. Mutated by the spiral. */
  r: number;
  /** 1 is a full rock, 3 the nearest reader. Halves on every hit. */
  readonly size: number;
  /** Which way it orbits. Fragments inherit it. */
  readonly spin: 1 | -1;
  /** Placed on the edge because the reader was over a mile out. Drawn muted. */
  readonly clamped: boolean;
  /** Outline jitter, one draw per vertex, so a rock keeps its shape. */
  readonly shape: readonly number[];
}

export interface Bullet {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface Particle {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  age: number;
  /** 1..6 */
  readonly tone: number;
}

export type RoundEnd = 'time' | 'collision';

export interface RoundOptions {
  /** Seconds between shots. `--fwm-dur-fast`. */
  readonly cadenceS?: number;
  /** Seconds a burst square lives. `--fwm-dur-alert`. */
  readonly burstS?: number;
}

export interface RoundState {
  /** Seconds elapsed. */
  t: number;
  readonly rocks: Rock[];
  readonly bullets: Bullet[];
  readonly particles: Particle[];
  /** Where the nose points. Degrees, 0 up, clockwise. */
  shipAngleDeg: number;
  /** Seconds until the next shot may fire. */
  cooldownS: number;
  hits: number;
  /** The class of the last reader hit, for the HUD's word beside the colour. */
  lastHitOwner: DockNearbyOwner | null;
  over: RoundEnd | null;
  /** Counting down while the field is empty; null while it is not. */
  respawnInS: number | null;
  /** The screen angle a fresh rock arrives on: the farthest reader's bearing. */
  readonly respawnAngleDeg: number;
  readonly cadenceS: number;
  readonly burstS: number;
  nextId: number;
  /** The seeded stream. */
  readonly rnd: () => number;
}

/* ------------------------------------------------------------------------ *
 * HELPERS
 * ------------------------------------------------------------------------ */

/** The spec page's generator, to the constant. See `PixelSweep.buildSweepCells`. */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const DEG = Math.PI / 180;

/** Polar to arena coordinates: x right, y DOWN, matching the canvas. */
export function polar(r: number, angleDeg: number): { readonly x: number; readonly y: number } {
  const a = angleDeg * DEG;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

/** The screen angle of a point, degrees, 0 up, clockwise, in [0, 360). */
export function angleOf(x: number, y: number): number {
  const a = Math.atan2(x, -y) / DEG;
  return ((a % 360) + 360) % 360;
}

/**
 * Where a reader sits on the field, and whether it was clamped to the edge.
 *
 * Linear in distance from `INNER_R` at zero feet to the edge at a mile, then
 * clamped -- see the header for why the clamp is a game rule and not a
 * measurement. The nearest in-range reader ignores the ruler and takes its own
 * ring, because the big rock has to start clear of the ship.
 */
export function layoutRadius(distanceFt: number): { readonly r: number; readonly clamped: boolean } {
  const safe = Number.isFinite(distanceFt) && distanceFt > 0 ? distanceFt : 0;
  const ruler = INNER_R + (1 - INNER_R) * (safe / EDGE_FT);
  return ruler >= 1 ? { r: 1, clamped: true } : { r: ruler, clamped: false };
}

/** The rock's drawn radius, arena units. */
export function rockRadius(rock: Pick<Rock, 'size'>): number {
  return rock.size * ROCK_R;
}

/** The speed multiplier at time `t`. Monotonic, stepwise, +10% per 15s. */
export function rampAt(t: number): number {
  return RAMP_FACTOR ** Math.floor(Math.max(0, t) / RAMP_EVERY_S);
}

/** Seven vertices, each pushed in or out a little. One draw per vertex. */
function rockShape(rnd: () => number): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i += 1) out.push(0.75 + rnd() * 0.4);
  return out;
}

/* ------------------------------------------------------------------------ *
 * THE ROUND
 * ------------------------------------------------------------------------ */

/**
 * Lay the field.
 *
 * `readers` is the two-mile set (`detourCameras`); the nearest sixteen are
 * kept. Each one lands at `screenAngleDeg(bearing, heading)` -- north-up when
 * the heading is null, which is what the sweep does too -- and at
 * `layoutRadius(distance)`. The in-range nearest is placed on its own ring at
 * three times the size.
 */
export function createRound(
  readers: readonly ArcadeReader[],
  headingDeg: number | null,
  seed: number,
  options: RoundOptions = {},
): RoundState {
  const rnd = seededRandom(seed);
  const sorted = [...readers].sort((a, b) => a.distanceFt - b.distanceFt).slice(0, MAX_ROCKS);
  const nearest = sorted[0];
  const bigId = nearest !== undefined && nearest.inRange ? nearest.id : null;

  const rocks: Rock[] = [];
  let nextId = 1;
  for (const reader of sorted) {
    const big = reader.id === bigId;
    const placed = big ? { r: NEAREST_R, clamped: false } : layoutRadius(reader.distanceFt);
    rocks.push({
      id: nextId,
      owner: reader.owner,
      angleDeg: screenAngleDeg(reader.bearingDeg, headingDeg),
      r: placed.r,
      size: big ? NEAREST_SCALE : 1,
      spin: rnd() < 0.5 ? 1 : -1,
      clamped: placed.clamped,
      shape: rockShape(rnd),
    });
    nextId += 1;
  }

  const farthest = sorted[sorted.length - 1];
  const respawnAngleDeg =
    farthest === undefined ? 0 : screenAngleDeg(farthest.bearingDeg, headingDeg);

  return {
    t: 0,
    rocks,
    bullets: [],
    particles: [],
    shipAngleDeg: 0,
    cooldownS: 0,
    hits: 0,
    lastHitOwner: null,
    over: null,
    respawnInS: rocks.length === 0 ? RESPAWN_S : null,
    respawnAngleDeg,
    cadenceS: options.cadenceS ?? DEFAULT_CADENCE_S,
    burstS: options.burstS ?? DEFAULT_BURST_S,
    nextId,
    rnd,
  };
}

/**
 * Aim at a point and fire.
 *
 * The ship turns to face the tap whether or not a shot leaves: Asteroids caps
 * the shots in flight at three and the cadence is one per `cadenceS`, and a
 * tap that only turns the nose is still a tap that did something. Returns
 * true when a bullet was actually added.
 */
export function shoot(state: RoundState, x: number, y: number): boolean {
  if (state.over !== null) return false;
  const angleDeg = angleOf(x, y);
  state.shipAngleDeg = angleDeg;
  if (state.cooldownS > 0 || state.bullets.length >= MAX_BULLETS) return false;
  const nose = polar(SHIP_R, angleDeg);
  const dir = polar(BULLET_SPEED, angleDeg);
  state.bullets.push({ x: nose.x, y: nose.y, vx: dir.x, vy: dir.y });
  state.cooldownS = state.cadenceS;
  return true;
}

/** Split one rock, or dust it, and throw the burst. */
function hitRock(state: RoundState, index: number, at: { readonly x: number; readonly y: number }): void {
  const rock = state.rocks[index];
  if (rock === undefined) return;
  state.rocks.splice(index, 1);
  state.hits += 1;
  state.lastHitOwner = rock.owner;

  const half = rock.size / 2;
  if (half >= MIN_FRAGMENT) {
    for (const side of [-1, 1] as const) {
      state.rocks.push({
        id: state.nextId,
        owner: rock.owner,
        angleDeg: rock.angleDeg + side * SPLIT_DEG,
        r: rock.r,
        size: half,
        spin: rock.spin,
        clamped: rock.clamped,
        shape: rockShape(state.rnd),
      });
      state.nextId += 1;
    }
  }

  for (let i = 0; i < BURST_COUNT; i += 1) {
    const a = (i / BURST_COUNT) * 360 + state.rnd() * (360 / BURST_COUNT);
    const speed = 0.3 + state.rnd() * 0.5;
    const v = polar(speed, a);
    state.particles.push({
      x: at.x,
      y: at.y,
      vx: v.x,
      vy: v.y,
      age: 0,
      tone: Math.floor(state.rnd() * BURST_TONES) + 1,
    });
  }
}

/**
 * Advance the round.
 *
 * `dtS` is clamped to `MAX_FRAME_S`; the caller's accumulator hands over
 * fixed steps and this guards the single stray large one. After the round is
 * over this is a no-op -- the end card is a still.
 */
export function step(state: RoundState, dtS: number): void {
  if (state.over !== null) return;
  const dt = Math.min(Math.max(0, dtS), MAX_FRAME_S);
  if (dt === 0) return;

  const ramp = rampAt(state.t);
  state.t += dt;
  state.cooldownS = Math.max(0, state.cooldownS - dt);

  /* ROCKS: orbit and spiral. */
  for (const rock of state.rocks) {
    rock.angleDeg += rock.spin * ORBIT_RAD_S * ramp * dt / DEG;
    rock.r = Math.max(0, rock.r - INWARD_S * ramp * dt);
  }

  /* BULLETS: fly, leave, or hit. */
  for (let b = state.bullets.length - 1; b >= 0; b -= 1) {
    const bullet = state.bullets[b];
    if (bullet === undefined) continue;
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    if (Math.hypot(bullet.x, bullet.y) > BULLET_EDGE) {
      state.bullets.splice(b, 1);
      continue;
    }
    let struck = -1;
    for (let i = 0; i < state.rocks.length; i += 1) {
      const rock = state.rocks[i];
      if (rock === undefined) continue;
      const at = polar(rock.r, rock.angleDeg);
      if (Math.hypot(bullet.x - at.x, bullet.y - at.y) <= rockRadius(rock)) {
        struck = i;
        break;
      }
    }
    if (struck >= 0) {
      state.bullets.splice(b, 1);
      hitRock(state, struck, { x: bullet.x, y: bullet.y });
    }
  }

  /* BURST: drift and fade. */
  for (let p = state.particles.length - 1; p >= 0; p -= 1) {
    const particle = state.particles[p];
    if (particle === undefined) continue;
    particle.age += dt;
    if (particle.age >= state.burstS) {
      state.particles.splice(p, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }

  /* COLLISION: a rock's edge reaching the ship's radius ends the round. */
  for (const rock of state.rocks) {
    if (rock.r - rockRadius(rock) <= SHIP_R) {
      state.over = 'collision';
      return;
    }
  }

  /* RESPAWN: an empty field gets a fresh rock at the edge after three seconds. */
  if (state.rocks.length === 0) {
    state.respawnInS = (state.respawnInS ?? RESPAWN_S) - dt;
    if (state.respawnInS <= 0) {
      state.rocks.push({
        id: state.nextId,
        owner: state.lastHitOwner ?? 'unverified',
        angleDeg: state.respawnAngleDeg,
        r: 1,
        size: 1,
        spin: state.rnd() < 0.5 ? 1 : -1,
        clamped: false,
        shape: rockShape(state.rnd),
      });
      state.nextId += 1;
      state.respawnInS = null;
    }
  } else {
    state.respawnInS = null;
  }

  /* TIME. */
  if (state.t >= ROUND_S) {
    state.t = ROUND_S;
    state.over = 'time';
  }
}

/** Seconds left on the clock, whole, for the HUD. */
export function remainingS(state: RoundState): number {
  return Math.max(0, Math.ceil(ROUND_S - state.t));
}
