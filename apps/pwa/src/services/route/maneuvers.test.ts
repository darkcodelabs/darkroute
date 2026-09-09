/**
 * WHAT THE NAV CARD IS ALLOWED TO SAY IS NEXT.
 *
 * Three ways this goes wrong, and all three are on screen in front of a driver
 * doing 45 mph:
 *
 *   1. IT NAMES A TURN ALREADY TAKEN. The router's list starts at the start of
 *      the drive and never moves; a card that shows entry one shows a junction
 *      that is ten minutes behind.
 *   2. IT MEASURES ACROSS THE MAP. Straight-line to a junction round a bend is
 *      shorter than the driving distance, so the turn gets announced before the
 *      driver can see it.
 *   3. IT BELIEVES A PER-LEG INDEX. `begin_shape_index` restarts at zero on
 *      every leg of a multi-stop trip, and the endpoint concatenates the legs
 *      into one line. Carried through unoffset, a turn half an hour away points
 *      at a place a few hundred metres from the start.
 *
 * The distances here are written as multiples of a known step rather than as
 * decimals, so they say what they are measuring.
 */

import { describe, expect, it } from 'vitest';

import { nextManeuver } from './maneuvers.ts';
import type { Maneuver, PlannedRoute, RoutePoint } from './planRoute.ts';

const LON = -94.6;
const BASE_LAT = 39.0;

/** One shape point to the next: 0.001 deg of latitude, about 111.32 m. */
const STEP = 0.001;
const STEP_MI = (STEP * 111_320) / 1609.344;

/** The same distance due east, so a corner has equal-length arms. */
const EAST = STEP / Math.cos((BASE_LAT * Math.PI) / 180);

/** A due-north line, `count` points long. */
function northLine(count: number): RoutePoint[] {
  return Array.from({ length: count }, (_, i) => ({ lat: BASE_LAT + i * STEP, lon: LON }));
}

/** Somewhere on that line, in steps from its start. */
function onLine(steps: number): RoutePoint {
  return { lat: BASE_LAT + steps * STEP, lon: LON };
}

function turn(instruction: string, beginShapeIndex: number, kind: Maneuver['turn']): Maneuver {
  return { instruction, street: '', miles: 0, seconds: 0, turn: kind, beginShapeIndex };
}

function routeOf(shape: readonly RoutePoint[], maneuvers: readonly Maneuver[]): PlannedRoute {
  return { shape, miles: 6.3, seconds: 890, avoided: 0, maneuvers };
}

describe('the turn a driver is approaching', () => {
  it('names the one ahead, not the one already driven through', () => {
    const route = routeOf(northLine(11), [
      turn('Drive north.', 0, 'start'),
      turn('Turn right onto W 111th St.', 4, 'right'),
      turn('Your destination is on the left.', 10, 'arrive'),
    ]);

    const next = nextManeuver(route, onLine(2.5));

    expect(next?.maneuver.instruction).toBe('Turn right onto W 111th St.');
    // A turn and a half of line still to cover.
    expect(next?.miles).toBeCloseTo(1.5 * STEP_MI, 4);
  });

  it('still names the turn you are stopped on rather than skipping to the next one', () => {
    // The projection puts a car sitting on the junction at 4.0000001 as often
    // as at 4.0, and the moment a driver most needs to be told about a turn is
    // the moment they are at it.
    const route = routeOf(northLine(11), [
      turn('Drive north.', 0, 'start'),
      turn('Turn right onto W 111th St.', 4, 'right'),
      turn('Your destination is on the left.', 10, 'arrive'),
    ]);

    const next = nextManeuver(route, onLine(4));

    expect(next?.maneuver.instruction).toBe('Turn right onto W 111th St.');
    expect(next?.miles).toBeCloseTo(0, 6);
  });

  it('measures along the road rather than across the bend', () => {
    // Two steps north, then two steps east. Crow-flies from half a step in is
    // shorter than the driving distance, and the crow-flies figure is the one
    // that announces a turn before it is in sight.
    const corner: RoutePoint[] = [
      { lat: BASE_LAT, lon: LON },
      { lat: BASE_LAT + STEP, lon: LON },
      { lat: BASE_LAT + 2 * STEP, lon: LON },
      { lat: BASE_LAT + 2 * STEP, lon: LON + EAST },
      { lat: BASE_LAT + 2 * STEP, lon: LON + 2 * EAST },
    ];
    const route = routeOf(corner, [
      turn('Drive north.', 0, 'start'),
      turn('Your destination is on the right.', 4, 'arrive'),
    ]);

    const next = nextManeuver(route, { lat: BASE_LAT + 0.5 * STEP, lon: LON });

    expect(next?.miles).toBeCloseTo(3.5 * STEP_MI, 4);
    // What it would have said measuring straight there: 1.5 steps north and 2
    // east is a hypotenuse of 2.5 steps.
    expect(next?.miles).not.toBeCloseTo(2.5 * STEP_MI, 3);
  });

  it('finds a second-leg turn where the offset put it, not back near the start', () => {
    /*
     * Twelve points: leg 0 is 0-5, leg 1 is 6-11, and index 5 and 6 are the
     * same coordinate because concatenating legs repeats the stop between them.
     * Leg 1's turn came off the router as begin_shape_index 2 and the endpoint
     * added the six points already on the line, making it 8.
     */
    const legs = [...northLine(6), ...northLine(6).map((p) => ({ ...p, lat: p.lat + 5 * STEP }))];
    const carried = routeOf(legs, [
      turn('Drive north.', 0, 'start'),
      turn('Turn right onto W 119th St.', 3, 'right'),
      turn('Turn left onto State Line Rd.', 8, 'left'),
      turn('Your destination is on the left.', 11, 'arrive'),
    ]);

    const next = nextManeuver(carried, onLine(6.5));

    expect(next?.maneuver.instruction).toBe('Turn left onto State Line Rd.');
    // Half a step short of index 8, which is where leg 1's second point landed
    // once the six points ahead of it were counted.
    expect(next?.miles).toBeCloseTo(0.5 * STEP_MI, 4);
  });

  it('would have had nothing left to say if the leg offset were dropped', () => {
    // The bug, held down by a test: with leg 1's raw indices carried through,
    // every one of its turns sits back at the start of the drive and reads as
    // already taken. The driver gets no instruction at all on the second half
    // of a two-stop trip.
    const legs = [...northLine(6), ...northLine(6).map((p) => ({ ...p, lat: p.lat + 5 * STEP }))];
    const unoffset = routeOf(legs, [
      turn('Drive north.', 0, 'start'),
      turn('Turn right onto W 119th St.', 3, 'right'),
      turn('Turn left onto State Line Rd.', 2, 'left'),
      turn('Your destination is on the left.', 5, 'arrive'),
    ]);

    expect(nextManeuver(unoffset, onLine(6.5))).toBeNull();
  });

  it('says you are arriving once every turn is behind you', () => {
    const route = routeOf(northLine(11), [
      turn('Drive north.', 0, 'start'),
      turn('Turn right onto W 111th St.', 4, 'right'),
      turn('Your destination is on the left.', 10, 'arrive'),
    ]);

    const next = nextManeuver(route, onLine(9.5));

    expect(next?.maneuver.turn).toBe('arrive');
    expect(next?.miles).toBeCloseTo(0.5 * STEP_MI, 4);
  });
});

describe('when there is nothing to say', () => {
  it('says nothing before a route exists', () => {
    expect(nextManeuver(null, onLine(1))).toBeNull();
  });

  it('says nothing before there is a fix to measure from', () => {
    const route = routeOf(northLine(4), [turn('Drive north.', 0, 'start')]);
    expect(nextManeuver(route, null)).toBeNull();
  });

  it('says nothing when the router returned a line but no turns', () => {
    // A real state, not a broken one: a route still draws and still counts the
    // readers on it when the turn list is empty.
    expect(nextManeuver(routeOf(northLine(4), []), onLine(1))).toBeNull();
  });

  it('says nothing when there is no line to measure along', () => {
    const stub = routeOf([onLine(0)], [turn('Drive north.', 0, 'start')]);
    expect(nextManeuver(stub, onLine(0))).toBeNull();
  });
});
