/**
 * WHAT THE DESTINATION CARD IS ALLOWED TO CLAIM.
 *
 * One build reported "2 readers avoided" over a line that passed nine. Both
 * numbers were real - two were excluded, and the road the detour moved onto had
 * nine of its own - and putting only the flattering one on screen made the app
 * a liar about the single thing it exists to do.
 *
 * These tests are mostly about that: the card may say what it achieved, and it
 * must say what it did not.
 */

import { describe, expect, it } from 'vitest';

import {
  avoidLabel,
  clearedCount,
  describeCost,
  outcomeLine,
  routeHeat,
} from './DestinationCard.tsx';
import type { PlannedRoute } from '../../services/route/planRoute.ts';

function route(miles: number, seconds: number): PlannedRoute {
  // No shape and no turn list: every function under test here reads the
  // miles and the seconds and nothing else.
  return { shape: [], miles, seconds, avoided: 0, maneuvers: [] };
}

describe('what the key says', () => {
  it('offers to build the route when readers are on the way', () => {
    expect(avoidLabel(9, 0)).toContain('Build the dark route');
    expect(avoidLabel(9, 0)).toContain('9');
  });

  it('does not say "all 1" beside a single camera', () => {
    expect(avoidLabel(1, 0)).toBe('Build the dark route · 1 reader');
  });

  it('says there is nothing to do on a clear road, rather than "around all 0"', () => {
    expect(avoidLabel(0, 0)).toBe('Nothing to avoid');
  });

  it('claims a dark route only when the line came back clear', () => {
    expect(avoidLabel(0, 3)).toBe('Dark route · 3 readers avoided');
  });

  it('becomes a reroute, not a claim, when readers are STILL on the line', () => {
    // Pressing again is genuinely the only thing left to try, and calling this
    // "avoided" would be the lie.
    expect(avoidLabel(2, 3)).toBe('Reroute · 2 readers still on it');
  });
});

describe('what the card reports', () => {
  it('says nothing about avoidance before anything has been avoided', () => {
    expect(outcomeLine(0, 0)).toBeNull();
    expect(outcomeLine(0, 4)).toBeNull();
  });

  it('says clear when it is clear', () => {
    expect(outcomeLine(3, 0)).toBe('3 readers avoided · clear');
  });

  it('names what it could not avoid', () => {
    // FIVE were excluded and TWO are still there, so THREE were cleared.
    // `planDarkRoute` adds every reader it finds to the avoid set before
    // deciding to stop, so the leftovers are a subset of the exclusions -
    // printing the exclusion count here double-counts them.
    expect(outcomeLine(5, 2)).toBe('3 readers avoided · 2 readers could not be');
  });

  it('never reports more cleared than were excluded', () => {
    expect(clearedCount(3, 5)).toBe(0);
    expect(outcomeLine(2, 2)).toBe('0 readers avoided · 2 readers could not be');
  });

  it('prices the detour against the plain route, including when it is free', () => {
    expect(describeCost(route(5, 600), route(5, 600))).toBe('no further, and no slower');
    expect(describeCost(route(5, 600), route(6.2, 900))).toContain('1.2 mi further');
    expect(describeCost(route(5, 600), route(6.2, 900))).toContain('5 min longer');
  });

  it('has no price to quote before there is a baseline', () => {
    expect(describeCost(null, route(6, 700))).toBeNull();
  });
});

describe('the heat ramp', () => {
  it('is quiet on a clear road, because a ramp whose bottom rung shouts means nothing', () => {
    expect(routeHeat(0)).toBe('clear');
  });

  it('climbs with the readers on the line', () => {
    expect(routeHeat(1)).toBe('approaching');
    expect(routeHeat(4)).toBe('in-range');
    expect(routeHeat(9)).toBe('multiple');
  });

  it('uses the alert engine’s own four states, not a fifth scale', () => {
    // If this list ever grows a name that is not an alert state, the card has
    // started teaching a second colour language.
    const states = new Set([routeHeat(0), routeHeat(1), routeHeat(3), routeHeat(20)]);
    expect([...states].sort()).toEqual(['approaching', 'clear', 'in-range', 'multiple']);
  });
});
