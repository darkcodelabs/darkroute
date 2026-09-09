/**
 * WHAT A DRIVER IS TOLD, HOW OFTEN, AND WHEN THE APP SHOULD ADMIT IT IS LOST.
 *
 * Four ways an announcer goes wrong, and every one of them is a person doing
 * 45 mph being talked at:
 *
 *   1. IT REPEATS. The distance test passes on every tick, so one turn is
 *      announced sixty times on the way to it.
 *   2. IT REPEATS AT A LIGHT. The driver creeps over the rung boundary and
 *      back, and each crossing is a fresh announcement of a junction they have
 *      been staring at for a minute.
 *   3. IT COUNTS BACKWARDS. A jumped fix announces a quarter mile and then a
 *      half, telling the driver the turn moved away from them.
 *   4. IT NARRATES A ROUTE NOBODY IS ON. `projectOnSegment` clamps to the
 *      line, so a fix on the wrong side of town still gets a confident answer
 *      about a turn that is not in front of it.
 *
 * The geometry is built in FEET and converted once, because every threshold in
 * the module under test is stated in feet and a test that says `0.001 deg`
 * cannot be read against them.
 */

import { describe, expect, it } from 'vitest';

import type { NavigationPayload } from '../adapters/notifications.ts';

import {
  BACK_ON_ROUTE_FT,
  createAnnouncer,
  feetOffRoute,
  OFF_ROUTE_FT,
  rungFor,
  RUNG_APPROACH,
  RUNG_HALF_MILE,
  RUNG_MILE,
  RUNG_NOW,
  RUNG_QUARTER_MILE,
  spokenFor,
} from './announce.ts';
import type { Maneuver, PlannedRoute, RoutePoint } from './planRoute.ts';

const BASE_LAT = 39.0;
const LON = -94.6;

/** Degrees of latitude in one foot, in the same flat model the module uses. */
const FOOT_LAT = 0.3048 / 111_320;
/** And one foot due east at this latitude. */
const FOOT_EAST = FOOT_LAT / Math.cos((BASE_LAT * Math.PI) / 180);

/** A due-north line, a point every 1,000 ft, 12,000 ft long. */
const STEP_FT = 1000;
const TURN_FT = 6000;
const END_FT = 12_000;

function northLine(): RoutePoint[] {
  const count = END_FT / STEP_FT + 1;
  return Array.from({ length: count }, (_, i) => ({
    lat: BASE_LAT + i * STEP_FT * FOOT_LAT,
    lon: LON,
  }));
}

/** A fix `feet` along that line, and `east` feet to the side of it. */
function fixAt(feet: number, east = 0): RoutePoint {
  return { lat: BASE_LAT + feet * FOOT_LAT, lon: LON + east * FOOT_EAST };
}

/** A fix that is `awayFt` from the turn at 6,000 ft, measured along the road. */
function beforeTurn(awayFt: number): RoutePoint {
  return fixAt(TURN_FT - awayFt);
}

const TURN_TEXT = 'Turn right onto West 119th Street.';
const ARRIVE_TEXT = 'Your destination is on the left.';

function maneuver(instruction: string, beginShapeIndex: number, turn: Maneuver['turn']): Maneuver {
  return { instruction, street: '', miles: 0, seconds: 0, turn, beginShapeIndex };
}

/**
 * A fresh route object every call, on purpose: the reset test needs two routes
 * that are identical in every field and different in reference.
 */
function testRoute(): PlannedRoute {
  return {
    shape: northLine(),
    miles: 2.3,
    seconds: 300,
    avoided: 4,
    maneuvers: [
      maneuver('Drive north.', 0, 'start'),
      maneuver(TURN_TEXT, TURN_FT / STEP_FT, 'right'),
      maneuver(ARRIVE_TEXT, END_FT / STEP_FT, 'arrive'),
    ],
  };
}

function navPayload(distanceFt: number, instruction = TURN_TEXT): NavigationPayload {
  return { kind: 'navigation', instruction, turn: 'right', distanceFt };
}

describe('the distance ladder', () => {
  it('announces the same turn once on each rung as the driver closes in', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    const spoken = [5050, 2500, 1300, 400, 50].map((away) => {
      const result = announcer.consider(route, beforeTurn(away));
      return result.payload?.distanceFt ?? null;
    });

    expect(spoken[0]).toBeCloseTo(5050, 2);
    expect(spoken[1]).toBeCloseTo(2500, 2);
    expect(spoken[2]).toBeCloseTo(1300, 2);
    expect(spoken[3]).toBeCloseTo(400, 2);
    expect(spoken[4]).toBeCloseTo(50, 2);
  });

  it('says nothing while the turn is further away than the top rung', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    // 5,600 ft out. Over a mile, so there is no rung to be on yet.
    expect(announcer.consider(route, beforeTurn(5600)).payload).toBeNull();
  });

  it('says nothing between rungs', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    expect(announcer.consider(route, beforeTurn(5050)).payload).not.toBeNull();
    // Still inside the mile rung, a thousand feet later.
    expect(announcer.consider(route, beforeTurn(4000)).payload).toBeNull();
    expect(announcer.consider(route, beforeTurn(3000)).payload).toBeNull();
  });

  it('picks the tightest rung a distance is inside', () => {
    expect(rungFor(RUNG_MILE)).toBeNull();
    expect(rungFor(RUNG_MILE - 1)?.id).toBe('mile');
    expect(rungFor(RUNG_HALF_MILE - 1)?.id).toBe('half-mile');
    expect(rungFor(RUNG_QUARTER_MILE - 1)?.id).toBe('quarter-mile');
    expect(rungFor(RUNG_APPROACH - 1)?.id).toBe('approach');
    expect(rungFor(RUNG_NOW - 1)?.id).toBe('now');
    expect(rungFor(0)?.id).toBe('now');
  });
});

describe('firing once', () => {
  it('does not re-announce a rung the driver crawls back and forth across', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    // Ten feet inside the quarter-mile rung, then twenty back out, then in
    // again - a car easing up to a light and rolling back.
    const first = announcer.consider(route, beforeTurn(RUNG_QUARTER_MILE - 10));
    const back = announcer.consider(route, beforeTurn(RUNG_QUARTER_MILE + 10));
    const again = announcer.consider(route, beforeTurn(RUNG_QUARTER_MILE - 10));

    expect(first.payload).not.toBeNull();
    expect(back.payload).toBeNull();
    expect(again.payload).toBeNull();
  });

  it('never counts backwards after a jumped fix', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    // The first fix of the trip is already inside the quarter-mile rung, which
    // is what a reacquire after a tunnel looks like.
    expect(announcer.consider(route, beforeTurn(1300)).payload?.distanceFt).toBeCloseTo(1300, 2);

    // Drifting back out must not produce "in a half mile" for the same turn.
    expect(announcer.consider(route, beforeTurn(2500)).payload).toBeNull();
    expect(announcer.consider(route, beforeTurn(5000)).payload).toBeNull();
  });

  it('still announces the next turn on rungs the previous turn already spent', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    expect(announcer.consider(route, beforeTurn(400)).payload?.instruction).toBe(TURN_TEXT);
    // Past the junction: the arrival is a different maneuver and owns its own
    // ladder, so the approach rung is due again.
    const after = announcer.consider(route, fixAt(END_FT - 400));

    expect(after.payload?.instruction).toBe(ARRIVE_TEXT);
    expect(after.payload?.distanceFt).toBeCloseTo(400, 2);
  });
});

describe('a new route', () => {
  it('announces the same rung again after a reroute', () => {
    const announcer = createAnnouncer();

    const before = announcer.consider(testRoute(), beforeTurn(1300));
    // A second route object, identical in every field. A reroute that happens
    // to keep the next turn where it was is still a new route.
    const after = announcer.consider(testRoute(), beforeTurn(1300));

    expect(before.payload).not.toBeNull();
    expect(after.payload).not.toBeNull();
  });

  it('does not announce again on the same route object', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    expect(announcer.consider(route, beforeTurn(1300)).payload).not.toBeNull();
    expect(announcer.consider(route, beforeTurn(1300)).payload).toBeNull();
  });

  it('clears the slate when the trip ends', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    announcer.consider(route, beforeTurn(1300));
    expect(announcer.consider(null, beforeTurn(1300)).payload).toBeNull();
    // A new trip on a route object seen before still starts from the top.
    expect(announcer.consider(route, beforeTurn(1300)).payload).not.toBeNull();
  });
});

describe('off route', () => {
  it('measures the perpendicular distance the turn finder throws away', () => {
    const shape = northLine();

    expect(feetOffRoute(shape, fixAt(4700))).toBeCloseTo(0, 0);
    expect(feetOffRoute(shape, fixAt(4700, 300))).toBeCloseTo(300, 0);
    expect(feetOffRoute(shape, fixAt(4700, -300))).toBeCloseTo(300, 0);
  });

  it('has no opinion when there is no line to be off', () => {
    expect(feetOffRoute([], fixAt(0))).toBeNull();
    expect(feetOffRoute([fixAt(0)], fixAt(4700))).toBeNull();
  });

  it('does not flap when a fix wobbles across the threshold', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    // Well inside the corridor.
    expect(announcer.consider(route, fixAt(4700, 100)).offRoute).toBe(false);
    // Past the return threshold but not past the one that declares it lost.
    expect(announcer.consider(route, fixAt(4700, 200)).offRoute).toBe(false);
    // Clearly off.
    expect(announcer.consider(route, fixAt(4700, 300)).offRoute).toBe(true);
    // Back inside the same band it was on route in a moment ago, and STILL
    // off: this is the whole point of the second threshold.
    expect(announcer.consider(route, fixAt(4700, 200)).offRoute).toBe(true);
    // Properly back on the line.
    expect(announcer.consider(route, fixAt(4700, 100)).offRoute).toBe(false);
  });

  it('states its two thresholds far enough apart to be a band', () => {
    expect(BACK_ON_ROUTE_FT).toBeLessThan(OFF_ROUTE_FT);
  });

  it('says nothing about a turn while the driver is not on the route', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    const lost = announcer.consider(route, fixAt(TURN_FT - 1300, 400));

    expect(lost.offRoute).toBe(true);
    expect(lost.payload).toBeNull();
  });

  it('announces the rung it withheld once the driver rejoins', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    announcer.consider(route, fixAt(TURN_FT - 1300, 400));
    const rejoined = announcer.consider(route, beforeTurn(1300));

    expect(rejoined.offRoute).toBe(false);
    expect(rejoined.payload?.distanceFt).toBeCloseTo(1300, 2);
  });

  it('does not treat a dropped fix as evidence the driver came back', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    announcer.consider(route, fixAt(4700, 300));
    expect(announcer.consider(route, null).offRoute).toBe(true);
  });
});

describe('arrival', () => {
  it('marks the final maneuver as arriving', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    const payload = announcer.consider(route, fixAt(END_FT - 50)).payload;

    expect(payload?.instruction).toBe(ARRIVE_TEXT);
    expect(payload?.arriving).toBe(true);
  });

  it('marks it on the distance rungs too, not only at the door', () => {
    const announcer = createAnnouncer();
    const route = testRoute();

    expect(announcer.consider(route, fixAt(END_FT - 1300)).payload?.arriving).toBe(true);
  });

  it('leaves an ordinary turn unmarked', () => {
    const announcer = createAnnouncer();

    const payload = announcer.consider(testRoute(), beforeTurn(1300)).payload;

    expect(payload?.instruction).toBe(TURN_TEXT);
    expect(payload?.arriving).toBeUndefined();
    expect('arriving' in (payload ?? {})).toBe(false);
  });
});

describe('the trip facts on the card', () => {
  it('carries what the caller knows and what the route knows', () => {
    const announcer = createAnnouncer();

    const payload = announcer.consider(testRoute(), beforeTurn(1300), {
      etaMinutes: 14,
      milesRemaining: 6.4,
    }).payload;

    expect(payload?.etaMinutes).toBe(14);
    expect(payload?.milesRemaining).toBe(6.4);
    // Off the route, not off the caller: a second source for this number is a
    // second answer waiting to disagree.
    expect(payload?.avoided).toBe(4);
  });

  it('omits the fields the caller did not supply rather than inventing zeros', () => {
    const announcer = createAnnouncer();

    const payload = announcer.consider(testRoute(), beforeTurn(1300)).payload;

    expect('etaMinutes' in (payload ?? {})).toBe(false);
    expect('milesRemaining' in (payload ?? {})).toBe(false);
  });
});

describe('the sentence a driver hears', () => {
  it('speaks a fraction on every distance rung', () => {
    expect(spokenFor(navPayload(5050))).toBe('in one mile, turn right onto West 119th Street');
    expect(spokenFor(navPayload(2500))).toBe('in a half mile, turn right onto West 119th Street');
    expect(spokenFor(navPayload(1300))).toBe(
      'in a quarter mile, turn right onto West 119th Street',
    );
    expect(spokenFor(navPayload(400))).toBe('in 500 feet, turn right onto West 119th Street');
  });

  it('drops the distance at the mouth of the turn', () => {
    expect(spokenFor(navPayload(50))).toBe('turn right onto West 119th Street');
    expect(spokenFor(navPayload(0))).toBe('turn right onto West 119th Street');
  });

  it('keeps the street name capitalised while the instruction is not', () => {
    // The card lowercases the whole line because the card is set in the chrome
    // voice. A speech engine handed "west 119th street" reads it differently.
    expect(spokenFor(navPayload(1300))).toContain('West 119th Street');
    expect(spokenFor(navPayload(1300)).startsWith('in a quarter mile, turn')).toBe(true);
  });

  it('counts in whole miles past the top of the ladder', () => {
    expect(spokenFor(navPayload(RUNG_MILE))).toBe('in one mile, turn right onto West 119th Street');
    expect(spokenFor(navPayload(2 * RUNG_MILE))).toBe(
      'in 2 miles, turn right onto West 119th Street',
    );
  });

  it('reads the arrival as the sentence it already is', () => {
    expect(spokenFor(navPayload(50, ARRIVE_TEXT))).toBe('your destination is on the left');
    expect(spokenFor(navPayload(1300, ARRIVE_TEXT))).toBe(
      'in a quarter mile, your destination is on the left',
    );
  });

  it('still says the distance when the router names no instruction', () => {
    expect(spokenFor(navPayload(1300, ''))).toBe('in a quarter mile');
    expect(spokenFor(navPayload(50, ''))).toBe('');
  });
});
