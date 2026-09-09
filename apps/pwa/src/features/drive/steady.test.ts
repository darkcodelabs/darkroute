/**
 * The deadband and the held heading, which between them decide whether a parked
 * phone looks like a working one.
 *
 * Both of these shipped wrong once in each direction, which is why they have a
 * test: fed raw, the map slid and the arrow spun; damped too hard, the map
 * stopped following at walking pace and the arrow greyed out at every red
 * light, which reads as a lost fix.
 */

import { describe, expect, it } from 'vitest';

import { HEADING_FLOOR_MPH, STEADY_METRES, steadyHeading } from './steady.ts';

describe('the movement deadband', () => {
  it('is wider than a stationary phone drifts and narrower than a walk', () => {
    // Consumer GPS wanders 3-5 m parked; a person walks 6 m in about five
    // seconds. The band has to sit between those or it damps the wrong thing.
    expect(STEADY_METRES).toBeGreaterThan(5);
    expect(STEADY_METRES).toBeLessThanOrEqual(8);
  });

  it('describes a distance a car passes in well under a second', () => {
    // 25 mph is 11.2 m/s. The band must not be a perceptible follow delay.
    const secondsAt25Mph = STEADY_METRES / 11.2;
    expect(secondsAt25Mph).toBeLessThan(1);
  });
});

describe('the held heading', () => {
  it('reports the live heading while the car is moving', () => {
    expect(steadyHeading(90, HEADING_FLOOR_MPH + 5, null)).toBe(90);
  });

  it('HOLDS the last confident heading once the car stops', () => {
    // The fix has not been lost - only the DIRECTION is unmeasurable, and a car
    // that has stopped is still pointing the way it was last going. Blanking it
    // greys the marker at every red light, which looks like losing the lock.
    expect(steadyHeading(37, 0, 90)).toBe(90);
    expect(steadyHeading(211, HEADING_FLOOR_MPH - 1, 90)).toBe(90);
  });

  it('never adopts a heading measured below the floor', () => {
    // A course computed from two points inside the GPS's own error cloud
    // describes the error, not the car. That is the value that made the arrow
    // spin, and it must not become the held one.
    expect(steadyHeading(211, 1, null)).toBeNull();
  });

  it('claims no direction at all until one has been measured', () => {
    // A phone opened from cold and never moved has nothing to point at.
    expect(steadyHeading(null, 0, null)).toBeNull();
    expect(steadyHeading(180, 0, null)).toBeNull();
  });

  it('treats a missing speed as not moving rather than as moving', () => {
    // No speed is not evidence of travel, and the safe reading is the held one.
    expect(steadyHeading(180, null, 45)).toBe(45);
    expect(steadyHeading(180, null, null)).toBeNull();
  });
});
