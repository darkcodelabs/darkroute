/**
 * THE ROUND, PINNED. Layout, motion, shots, splits, the ramp and the end.
 *
 * Every assertion is about `sim.ts` alone -- no DOM, no store, no canvas --
 * because the simulation is the design and the canvas is only how it is
 * painted. The seeded stream makes every case reproducible.
 */

import { describe, expect, it } from 'vitest';

import { screenAngleDeg } from '../sweep/geometry.ts';
import {
  BULLET_EDGE,
  INNER_R,
  MAX_BULLETS,
  MAX_FRAME_S,
  MIN_FRAGMENT,
  NEAREST_R,
  NEAREST_SCALE,
  ROUND_S,
  SHIP_R,
  angleOf,
  createRound,
  layoutRadius,
  polar,
  rampAt,
  remainingS,
  rockRadius,
  shoot,
  step,
} from './sim.ts';
import type { ArcadeReader, RoundState } from './sim.ts';

function reader(id: string, distanceFt: number, bearingDeg: number, inRange = false): ArcadeReader {
  return { id, distanceFt, bearingDeg, inRange, owner: 'police' };
}

const FIELD: readonly ArcadeReader[] = [
  reader('near', 300, 40, true),
  reader('mid', 2000, 130),
  reader('far', 4000, 250),
  reader('beyond', 9000, 320),
];

/** Advance in the loop's own fixed steps. */
function run(state: RoundState, seconds: number): void {
  const dt = 1 / 60;
  let left = seconds;
  while (left > 0) {
    step(state, Math.min(dt, left));
    left -= dt;
  }
}

describe('layout', () => {
  it('places every rock at screenAngleDeg(bearing, heading)', () => {
    const round = createRound(FIELD, 90, 1);
    const angles = round.rocks.map((rock) => rock.angleDeg);
    expect(angles).toEqual(FIELD.map((r) => screenAngleDeg(r.bearingDeg, 90)));
    const northUp = createRound(FIELD, null, 1);
    expect(northUp.rocks.map((rock) => rock.angleDeg)).toEqual(FIELD.map((r) => r.bearingDeg));
  });

  it('puts radius monotone in distance and clamps at the edge, muted', () => {
    expect(layoutRadius(0).r).toBe(INNER_R);
    expect(layoutRadius(1000).r).toBeGreaterThan(layoutRadius(500).r);
    expect(layoutRadius(4000).r).toBeGreaterThan(layoutRadius(1000).r);
    expect(layoutRadius(9000)).toEqual({ r: 1, clamped: true });
    expect(layoutRadius(4000).clamped).toBe(false);
    const round = createRound(FIELD, null, 1);
    const beyond = round.rocks.find((rock) => rock.angleDeg === 320);
    expect(beyond?.clamped).toBe(true);
    expect(beyond?.r).toBe(1);
  });

  it('makes the in-range nearest the big rock at 3x, on its own ring', () => {
    const round = createRound(FIELD, null, 1);
    const big = round.rocks.find((rock) => rock.size === NEAREST_SCALE);
    expect(big?.angleDeg).toBe(40);
    expect(big?.r).toBe(NEAREST_R);
    expect(round.rocks.filter((rock) => rock.size !== 1)).toHaveLength(1);
  });

  it('draws no big rock when the nearest is not in range', () => {
    const round = createRound([reader('a', 300, 40, false), reader('b', 900, 90)], null, 1);
    expect(round.rocks.every((rock) => rock.size === 1)).toBe(true);
  });

  it('caps the field at sixteen rocks, nearest first', () => {
    const many = Array.from({ length: 30 }, (_, i) => reader(`r${String(i)}`, 100 + i * 200, i * 12));
    const round = createRound(many, null, 1);
    expect(round.rocks).toHaveLength(16);
  });

  it('lays the same field twice from the same seed', () => {
    const a = createRound(FIELD, 10, 4242);
    const b = createRound(FIELD, 10, 4242);
    expect(a.rocks).toEqual(b.rocks);
    const c = createRound(FIELD, 10, 4243);
    expect(c.rocks.map((rock) => rock.shape)).not.toEqual(a.rocks.map((rock) => rock.shape));
  });
});

describe('shots', () => {
  it('aims the ship at the tap and fires one bullet from the nose', () => {
    const round = createRound(FIELD, null, 1);
    expect(shoot(round, 0.5, -0.5)).toBe(true);
    expect(round.shipAngleDeg).toBe(45);
    expect(round.bullets).toHaveLength(1);
    const bullet = round.bullets[0];
    expect(Math.hypot(bullet?.x ?? 0, bullet?.y ?? 0)).toBeCloseTo(SHIP_R, 6);
  });

  it('honours the cadence and the three-in-flight cap', () => {
    const round = createRound(FIELD, null, 1, { cadenceS: 0.16 });
    expect(shoot(round, 0, -1)).toBe(true);
    expect(shoot(round, 0, -1)).toBe(false);
    run(round, 0.2);
    expect(shoot(round, 0, -1)).toBe(true);
    run(round, 0.2);
    expect(shoot(round, 0, -1)).toBe(true);
    run(round, 0.2);
    expect(round.bullets).toHaveLength(MAX_BULLETS);
    expect(shoot(round, 0, -1)).toBe(false);
  });

  it('drops a bullet that leaves the field', () => {
    const round = createRound([], null, 1);
    shoot(round, 0, -1);
    run(round, 1.2);
    expect(round.bullets).toHaveLength(0);
    expect(BULLET_EDGE).toBeGreaterThan(1);
  });
});

describe('hits', () => {
  it('splits a rock into two half-size fragments at +/-30 degrees, inheriting radius and spin', () => {
    const round = createRound([reader('one', 2000, 0)], null, 7);
    const target = round.rocks[0];
    if (target === undefined) throw new Error('no rock');
    const at = polar(target.r, target.angleDeg);
    /* A bullet on the rock: shoot straight at it and step until it lands. */
    shoot(round, at.x, at.y);
    /* Step until the shot lands, then look before the burst has faded. */
    for (let i = 0; i < 120 && round.hits === 0; i += 1) step(round, 1 / 60);
    expect(round.hits).toBe(1);
    expect(round.rocks).toHaveLength(2);
    const [a, b] = round.rocks;
    expect(a?.size).toBe(0.5);
    expect(b?.size).toBe(0.5);
    expect(a?.spin).toBe(target.spin);
    expect(Math.abs((a?.angleDeg ?? 0) - (b?.angleDeg ?? 0))).toBeCloseTo(60, 0);
    expect(round.particles.length).toBeGreaterThan(0);
    expect(round.lastHitOwner).toBe('police');
  });

  it('dusts a fragment below a quarter size', () => {
    const round = createRound([reader('one', 2000, 0)], null, 7);
    /* Force the situation: one quarter-size rock, hit once. */
    round.rocks.splice(0, round.rocks.length, {
      id: 99,
      owner: 'hoa',
      angleDeg: 0,
      r: 0.6,
      size: MIN_FRAGMENT,
      spin: 1,
      clamped: false,
      shape: [1, 1, 1, 1, 1, 1, 1],
    });
    shoot(round, 0, -0.6);
    run(round, 0.6);
    expect(round.hits).toBe(1);
    expect(round.rocks).toHaveLength(0);
  });

  it('respawns a full rock on the farthest reader bearing three seconds after the field clears', () => {
    const round = createRound([reader('one', 2000, 0), reader('two', 3000, 200)], null, 7);
    round.rocks.splice(0, round.rocks.length);
    run(round, 2.5);
    expect(round.rocks).toHaveLength(0);
    run(round, 0.6);
    expect(round.rocks).toHaveLength(1);
    expect(round.rocks[0]?.angleDeg).toBeCloseTo(200, 0);
    expect(round.rocks[0]?.r).toBeCloseTo(1, 1);
    expect(round.rocks[0]?.size).toBe(1);
  });
});

describe('motion and the end', () => {
  it('orbits and spirals inward', () => {
    const round = createRound([reader('one', 2000, 90)], null, 1);
    const before = { ...(round.rocks[0] as object) } as { angleDeg: number; r: number };
    run(round, 2);
    const after = round.rocks[0];
    expect(after?.r).toBeLessThan(before.r);
    expect(after?.angleDeg).not.toBe(before.angleDeg);
  });

  it('ends the round when a rock reaches the ship', () => {
    const round = createRound([reader('one', 100, 0)], null, 1);
    const rock = round.rocks[0];
    if (rock === undefined) throw new Error('no rock');
    rock.r = SHIP_R + rockRadius(rock) + 0.01;
    run(round, 2);
    expect(round.over).toBe('collision');
  });

  it('ends at sixty seconds and is a no-op afterwards', () => {
    /* A field kept empty, so nothing can reach the ship: the clock is the
       only thing that can end this one. Sixty-one seconds of steps. */
    const round = createRound([reader('one', 4000, 0)], null, 1);
    for (let i = 0; i < (ROUND_S + 1) * 60; i += 1) {
      round.rocks.splice(0, round.rocks.length);
      step(round, 1 / 60);
    }
    expect(round.over).toBe('time');
    expect(round.t).toBe(ROUND_S);
    expect(remainingS(round)).toBe(0);
    const snapshot = JSON.stringify(round.rocks);
    step(round, 0.02);
    expect(shoot(round, 0, -1)).toBe(false);
    expect(JSON.stringify(round.rocks)).toBe(snapshot);
  });

  it('clamps a stray large step at MAX_FRAME_S', () => {
    const round = createRound([reader('one', 4000, 0)], null, 1);
    step(round, 10);
    expect(round.t).toBeCloseTo(MAX_FRAME_S, 9);
  });

  it('ramps the speeds ten percent every fifteen seconds, monotonically', () => {
    expect(rampAt(0)).toBe(1);
    expect(rampAt(14.9)).toBe(1);
    expect(rampAt(15)).toBeCloseTo(1.1, 9);
    expect(rampAt(45)).toBeCloseTo(1.1 ** 3, 9);
    let last = 0;
    for (let t = 0; t <= 60; t += 1) {
      const now = rampAt(t);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('reads angles compass-style: 0 up, clockwise', () => {
    expect(angleOf(0, -1)).toBe(0);
    expect(angleOf(1, 0)).toBe(90);
    expect(angleOf(0, 1)).toBe(180);
    expect(angleOf(-1, 0)).toBe(270);
  });
});
