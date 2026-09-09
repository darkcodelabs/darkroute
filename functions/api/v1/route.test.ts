/**
 * WHAT THE ROUTER'S ANSWER BECOMES BEFORE THE PHONE SEES IT.
 *
 * The endpoint's shape handling had no tests at all, and the part of it most
 * worth one is the least visible: `begin_shape_index` counts from the start of
 * ITS OWN LEG. Confirmed against valhalla1.openstreetmap.de on a three-stop
 * Kansas City request while these were written - leg 0 came back with 193 shape
 * points and its turns at 0-192, and leg 1 started counting again at 0. This
 * function concatenates the legs into one line, so carried through unoffset,
 * every turn on the second half of a drive points at a place near the start of
 * the first half, and the app tells a driver the next turn is here when it is
 * half an hour away.
 *
 * The encoded shapes below are real polyline6 strings, generated for these
 * fixtures and checked against `decodeShape` - not hand-typed, because a
 * fixture that decodes to something other than what its comment claims tests
 * the wrong route and passes anyway.
 */

import { describe, expect, it } from 'vitest';

import { decodeShape, exclusionRing, readTrip, turnKind } from './route.ts';

/** Four points due north from 39.0,-94.6, a thousandth of a degree apart. */
const NORTH_4 = '_{jkiA~r|lsDo}@?o}@?o}@?';

/** Three points due east from where NORTH_4 ends, so the legs meet at a stop. */
const EAST_3 = 'ovpkiA~r|lsD?o}@?o}@';

interface RawManeuver {
  readonly type?: number;
  readonly instruction?: string;
  readonly street_names?: readonly string[];
  readonly length?: number;
  readonly time?: number;
  readonly begin_shape_index?: number;
}

function trip(legs: readonly { shape?: unknown; maneuvers?: unknown }[]): unknown {
  return { trip: { legs, summary: { length: 10.1105, time: 1_284 } } };
}

function maneuver(over: RawManeuver): RawManeuver {
  return { type: 10, instruction: 'Turn right.', begin_shape_index: 0, ...over };
}

describe('turning the router legs into one line', () => {
  it('puts a second-leg turn on the second half of the line, not back at the start', () => {
    const answer = readTrip(
      trip([
        { shape: NORTH_4, maneuvers: [maneuver({ type: 3, instruction: 'Drive north.' })] },
        {
          shape: EAST_3,
          // Off the wire this is leg 1's own index 1. The line it belongs to
          // already has four points on it, so it has to land at 5.
          maneuvers: [
            maneuver({ instruction: 'Turn right onto W 111th St.', begin_shape_index: 1 }),
          ],
        },
      ]),
      0,
    );

    expect(answer?.shape).toHaveLength(7);
    expect(answer?.maneuvers.map((entry) => entry.beginShapeIndex)).toEqual([0, 5]);
  });

  it('points a second-leg turn at the coordinate that leg actually contains', () => {
    /*
     * The stronger form of the assertion above, and the one a driver feels: an
     * index is only right if the POINT it addresses is the one the router
     * meant. Leg 1's own index 2 is the last of its three points; on the joined
     * line that has to be the same coordinate, not merely a valid index - and a
     * wrong offset lands on a valid index every time.
     */
    const answer = readTrip(
      trip([
        { shape: NORTH_4, maneuvers: [maneuver({ begin_shape_index: 3 })] },
        { shape: EAST_3, maneuvers: [maneuver({ begin_shape_index: 2 })] },
      ]),
      0,
    );

    const legPoints = decodeShape(EAST_3);
    const at = answer?.maneuvers[1]?.beginShapeIndex ?? -1;
    expect(answer?.shape[at]).toEqual(legPoints[2]);
  });

  it('drops a leg with no line at all, and its turns with it', () => {
    const answer = readTrip(
      trip([
        { maneuvers: [maneuver({ instruction: 'A turn on a leg with no geometry.' })] },
        { shape: NORTH_4, maneuvers: [maneuver({ begin_shape_index: 2 })] },
      ]),
      0,
    );

    expect(answer?.maneuvers.map((entry) => entry.instruction)).toEqual(['Turn right.']);
    // Counted from the start of the line, because the skipped leg put nothing
    // on it - an offset of one leg's worth here would be an index into nothing.
    expect(answer?.maneuvers[0]?.beginShapeIndex).toBe(2);
  });

  it('drops a leg whose line is an empty string rather than lending its turns the next leg', () => {
    const answer = readTrip(
      trip([
        {
          shape: '',
          maneuvers: [maneuver({ instruction: 'A turn on a leg with an empty shape.' })],
        },
        { shape: NORTH_4, maneuvers: [maneuver({ instruction: 'Turn left.', type: 15 })] },
      ]),
      0,
    );

    expect(answer?.maneuvers.map((entry) => entry.instruction)).toEqual(['Turn left.']);
  });

  it('reads a route the router gave no turns for as a route, not a failure', () => {
    // A real state and not a broken one: the line is the part the product
    // depends on, and a drive with no turn list still draws and still gets its
    // cameras counted.
    const answer = readTrip(trip([{ shape: NORTH_4 }]), 3);

    expect(answer?.shape).toHaveLength(4);
    expect(answer?.maneuvers).toEqual([]);
    expect(answer?.avoided).toBe(3);
  });

  it('refuses an answer with no line in it rather than reporting an empty drive', () => {
    expect(readTrip(trip([]), 0)).toBeNull();
    expect(readTrip({ trip: { legs: 'not a list' } }, 0)).toBeNull();
    expect(readTrip('not a trip at all', 0)).toBeNull();
  });
});

describe('one turn off the wire', () => {
  it('drops a maneuver with no sentence to say', () => {
    // A blank row with an arrow on it tells a driver less than no row at all.
    const answer = readTrip(
      trip([
        {
          shape: NORTH_4,
          maneuvers: [maneuver({ instruction: '' }), maneuver({ instruction: 'Turn right.' })],
        },
      ]),
      0,
    );

    expect(answer?.maneuvers).toHaveLength(1);
  });

  it('names the street on the sign, not the route number beside it', () => {
    // Valhalla lists every name a way carries, local name first, and the local
    // name is the one a driver can match against what is in front of them.
    const answer = readTrip(
      trip([
        {
          shape: NORTH_4,
          maneuvers: [maneuver({ street_names: ['Metcalf Avenue', 'US 169'] })],
        },
      ]),
      0,
    );

    expect(answer?.maneuvers[0]?.street).toBe('Metcalf Avenue');
  });

  it('leaves the street empty where the router named none, rather than inventing one', () => {
    const answer = readTrip(trip([{ shape: NORTH_4, maneuvers: [maneuver({})] }]), 0);

    expect(answer?.maneuvers[0]?.street).toBe('');
  });

  it('reads the length as the miles it was asked for', () => {
    const answer = readTrip(
      trip([{ shape: NORTH_4, maneuvers: [maneuver({ length: 1.2, time: 84 })] }]),
      0,
    );

    expect(answer?.maneuvers[0]?.miles).toBe(1.2);
    expect(answer?.maneuvers[0]?.seconds).toBe(84);
  });
});

describe('which arrow a turn gets drawn as', () => {
  it('calls all three starts a start, because the side is not a turn', () => {
    // 1 kStart, 2 kStartRight, 3 kStartLeft - which side of the street you set
    // off from, which is not something to draw an arrow for.
    expect([turnKind(1), turnKind(2), turnKind(3)]).toEqual(['start', 'start', 'start']);
  });

  it('calls all three destinations an arrival', () => {
    expect([turnKind(4), turnKind(5), turnKind(6)]).toEqual(['arrive', 'arrive', 'arrive']);
  });

  it('draws both u-turn codes as the one u-turn', () => {
    expect([turnKind(12), turnKind(13)]).toEqual(['uturn', 'uturn']);
  });

  it('draws every ramp and exit as the one slip road', () => {
    expect([17, 18, 19, 20, 21].map(turnKind)).toEqual(['ramp', 'ramp', 'ramp', 'ramp', 'ramp']);
  });

  it('treats a fork you keep to one side of as a slight turn', () => {
    // 23 kStayRight and 24 kStayLeft are a stay to Valhalla and a slight turn
    // to the hands on the wheel. 22 kStayStraight really is straight.
    expect([turnKind(23), turnKind(24), turnKind(22)]).toEqual([
      'slight-right',
      'slight-left',
      'straight',
    ]);
  });

  it('says straight for a code it does not know rather than guessing an arrow', () => {
    // The transit, ferry and elevator codes a driving route never emits, and
    // whatever a future Valhalla adds. An arrow pointing left where the road
    // goes right is a wrong instruction delivered with confidence; the router's
    // own sentence is still printed beside it either way.
    expect(turnKind(30)).toBe('straight');
    expect(turnKind(Number.NaN)).toBe('straight');
  });
});

describe('the fixtures these tests are built on', () => {
  it('decodes to the four northbound points its name claims', () => {
    // polyline6, not polyline5. Reading it at five decimal places silently
    // divides every coordinate by ten and drops the route in the Gulf of
    // Guinea, so the precision is worth a test of its own.
    expect(decodeShape(NORTH_4)).toEqual([
      { lat: 39, lon: -94.6 },
      { lat: 39.001, lon: -94.6 },
      { lat: 39.002, lon: -94.6 },
      { lat: 39.003, lon: -94.6 },
    ]);
  });

  it('starts the second leg where the first one ended, the way a stop does', () => {
    const north = decodeShape(NORTH_4);
    expect(decodeShape(EAST_3)[0]).toEqual(north[north.length - 1]);
  });
});

/**
 * THE ONE INVARIANT THAT MAKES AVOIDANCE WORK.
 *
 * The app calls a reader "on the route" when it is within `CORRIDOR_M` (60 m,
 * `apps/pwa/src/services/route/corridor.ts`) of the line. This Worker draws the
 * box the router may not enter. If the box is smaller than that corridor there
 * is a band of readers the app DETECTS and the router CANNOT avoid - and
 * because `buildDarkRoute` stops once a round adds no new readers, one reader
 * in that band ends the iteration with itself still on the line.
 *
 * That shipped: a 28 m box against a 60 m corridor made every reader between
 * 28 m and 60 m of its road permanently unavoidable, reported to the driver as
 * "could not be avoided" when nothing had ever been able to try.
 *
 * The two constants live on opposite sides of a network boundary and cannot
 * import each other, so this is where the coupling is enforced.
 */
describe('the exclusion box a reader becomes', () => {
  const M_PER_DEG_LAT = 111_320;
  const CORRIDOR_M = 60; // must track apps/pwa/src/services/route/corridor.ts

  const spanMetres = (ring: [number, number][], lat: number) => {
    const lons = ring.map(([lon]) => lon);
    const lats = ring.map(([, value]) => value);
    return {
      northSouth: (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT,
      eastWest:
        (Math.max(...lons) - Math.min(...lons)) *
        M_PER_DEG_LAT *
        Math.cos((lat * Math.PI) / 180),
    };
  };

  it('reaches at least as far as the corridor that detects the reader', () => {
    const lat = 38.92;
    const { northSouth, eastWest } = spanMetres(exclusionRing({ lat, lon: -94.67 }), lat);
    // Half-width each way, so the full span is twice the corridor.
    expect(northSouth / 2).toBeGreaterThanOrEqual(CORRIDOR_M);
    expect(eastWest / 2).toBeGreaterThanOrEqual(CORRIDOR_M);
  });

  it('is square on the ground, not square in degrees', () => {
    // A degree of longitude is shorter than a degree of latitude everywhere but
    // the equator. One number for both gave a box 60 m tall and 47 m wide in
    // Kansas - and 20 m wide in Alaska, where this app also ships.
    for (const lat of [25.8, 38.92, 47.6, 64.8]) {
      const { northSouth, eastWest } = spanMetres(exclusionRing({ lat, lon: -94.67 }), lat);
      expect(Math.abs(northSouth - eastWest)).toBeLessThan(1);
    }
  });

  it('closes the ring, because Valhalla wants it closed', () => {
    const ring = exclusionRing({ lat: 38.92, lon: -94.67 });
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('puts longitude first in every pair, which is the opposite of the rest of this file', () => {
    // Getting this backwards avoids a point in the ocean and nobody notices
    // until a driver passes a camera.
    for (const [lon, lat] of exclusionRing({ lat: 38.92, lon: -94.67 })) {
      expect(lon).toBeLessThan(-90);
      expect(lat).toBeGreaterThan(30);
    }
  });
});
