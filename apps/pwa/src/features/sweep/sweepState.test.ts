/**
 * WHAT SWEEP DRAWS, ONE DECISION AT A TIME.
 *
 * The load-bearing assertions in this file are the privacy and safety ones:
 *
 *   - a muted camera still has a dot, an arc, a tap target and a place in the
 *     tally. Nothing in `sweepState.ts` may remove a camera from the dial.
 *   - a ghost's angle is presentational. Every ghost reports
 *     `bearingKnown: false` and carries no camera id, because presence
 *     publishes a distance and never a direction.
 *   - `HAKCERS` is unknown, not zero, when presence is not live.
 */

import { describe, expect, it } from 'vitest';

import type { CameraAssessment, PresencePeer } from '../../stores';

import { OUTER_RADIUS } from './geometry.ts';
import { SWEEP_LAYERS } from './sweepState.ts';
import { cameraDotState, ghostAngleDeg, sweepCounts, sweepDots } from './sweepState.ts';
import type { SweepInput } from './sweepState.ts';

/** The camera screen 01 and panel 02 are both about: 425 ft, facing 223. */
function camera(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'FWM-0442',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 223,
    inRange: true,
    muted: false,
    mergedIds: ['FWM-0442'],
    ...over,
  };
}

function input(over: Partial<SweepInput> = {}): SweepInput {
  return {
    assessments: [camera()],
    headingDeg: 41,
    gps: 'lock',
    locationPermission: 'granted',
    muted: false,
    mutePierced: false,
    peers: [],
    presenceLive: false,
    ...over,
  };
}

function peer(over: Partial<PresencePeer> = {}): PresencePeer {
  return { id: 'ephemeral-a', handle: null, distanceMi: 0.1, lastSeenMs: 0, ...over };
}

// ---------------------------------------------------------------------------
// Dot classes
// ---------------------------------------------------------------------------

describe('dot classes', () => {
  it('draws a camera inside the threshold in the in-range hue', () => {
    const [dot] = sweepDots(input());
    expect(dot?.kind).toBe('in-range');
    expect(dot?.state).toBe('in_range');
    expect(dot?.hue).toBe('in-range');
  });

  it('draws a camera outside the threshold as known, in the approaching hue', () => {
    const [dot] = sweepDots(input({ assessments: [camera({ inRange: false, distanceFt: 820 })] }));
    expect(dot?.kind).toBe('known');
    expect(dot?.hue).toBe('approaching');
  });

  it('rotates a known facing into the dial frame', () => {
    const [dot] = sweepDots(input());
    // Lens points 223, vehicle heads 41: 182 deg round the dial.
    expect(dot?.facingDeg).toBe(182);
  });

  it('leaves the arc off a camera whose facing was never recorded', () => {
    const [dot] = sweepDots(input({ assessments: [camera({ directionDeg: null })] }));
    expect(dot?.facingDeg).toBeNull();
  });

  it('drops a camera further out than the outer ring rather than pinning it to the rim', () => {
    expect(sweepDots(input({ assessments: [camera({ distanceFt: 4000 })] }))).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Muting
// ---------------------------------------------------------------------------

describe('a muted camera', () => {
  it('still draws, in grey, with its tap target and its facing arc intact', () => {
    const dots = sweepDots(input({ assessments: [camera({ muted: true })] }));
    const [dot] = dots;

    expect(dots).toHaveLength(1);
    expect(dot?.hue).toBe('muted');
    expect(dot?.muted).toBe(true);
    expect(dot?.cameraId).toBe('FWM-0442');
    expect(dot?.facingDeg).toBe(182);
  });

  it('greys every dot while a global mute is live', () => {
    const dots = sweepDots(
      input({ assessments: [camera(), camera({ id: 'FWM-0118', inRange: false })], muted: true }),
    );
    expect(dots.map((dot) => dot.hue)).toStrictEqual(['muted', 'muted']);
    expect(dots).toHaveLength(2);
  });

  it('gets its alert hue back when the mute is pierced', () => {
    const state = cameraDotState(camera(), input({ muted: true, mutePierced: true }));
    expect(state).toBe('in_range');
  });

  it('carries that pierce onto the dot itself, not just into the state table', () => {
    // "RE-ALERT ON MUTED IF closer than 150 ft" -- Screens II, B4. The dot the
    // dial draws has to be a full in-range dot: `SweepDial` reads `hue` for the
    // glow, so a pierced dot whose hue said in-range while its treatment said
    // muted would paint alert crimson with no glow. `muted` stays true because
    // the camera IS muted -- the pierce is what overrides the treatment.
    const [dot] = sweepDots(input({ muted: true, mutePierced: true }));
    expect(dot?.state).toBe('in_range');
    expect(dot?.hue).toBe('in-range');
    expect(dot?.kind).toBe('in-range');
    expect(dot?.muted).toBe(true);
  });

  it('still counts in the IN RANGE tally', () => {
    const counts = sweepCounts(input({ assessments: [camera({ muted: true })] }), 1, 0);
    expect(counts.inRange).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No fix
// ---------------------------------------------------------------------------

describe('no fix', () => {
  it('greys a camera whose fix aged out rather than colouring it', () => {
    const [dot] = sweepDots(input({ gps: 'stale' }));
    expect(dot?.state).toBe('no_gps');
    expect(dot?.hue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ghosts
// ---------------------------------------------------------------------------

describe('flocky ghosts', () => {
  it('draws none while presence is not live', () => {
    expect(sweepDots(input({ peers: [peer()] }))).toHaveLength(1);
  });

  it('draws one per nearby peer once presence is live', () => {
    const dots = sweepDots(input({ peers: [peer()], presenceLive: true }));
    expect(dots).toHaveLength(2);
    expect(dots[1]?.kind).toBe('ghost');
  });

  it('never claims a bearing it was not given, and is never a camera', () => {
    const dots = sweepDots(input({ assessments: [], peers: [peer()], presenceLive: true }));
    const [ghost] = dots;

    expect(ghost?.bearingKnown).toBe(false);
    expect(ghost?.cameraId).toBeNull();
    expect(ghost?.hue).toBeNull();
    expect(ghost?.facingDeg).toBeNull();
  });

  it('keeps the same ghost in the same place across renders', () => {
    expect(ghostAngleDeg('ephemeral-a')).toBe(ghostAngleDeg('ephemeral-a'));
    expect(ghostAngleDeg('ephemeral-a')).not.toBe(ghostAngleDeg('ephemeral-b'));
  });

  it('puts a ghost on the dial at the distance presence reported', () => {
    // 0.1 mi is 528 ft. On a proportional scale over a 1000 ft range that is
    // 52.8 % of the way out, which lands between the third and fourth drawn
    // rings (70.1 % and 100 %)... it does not: it lands between the SECOND and
    // THIRD. Asserted against the rings themselves rather than two literals, so
    // the radii and this expectation cannot drift apart.
    const [ghost] = sweepDots(input({ assessments: [], peers: [peer()], presenceLive: true }));
    // The real invariant: it sits at its true fraction of the range, measured
    // against the frame the scale now reaches -- not against a drawn ring.
    expect(ghost?.radius).toBeCloseTo((528 / 1000) * OUTER_RADIUS, 1);
  });

  it('drops a peer further away than the dial reaches', () => {
    const dots = sweepDots(
      input({ assessments: [], peers: [peer({ distanceMi: 1.4 })], presenceLive: true }),
    );
    expect(dots).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The legend
// ---------------------------------------------------------------------------

describe('the legend counts', () => {
  it('takes IN RANGE from the engine rather than re-deriving it', () => {
    const counts = sweepCounts(input({ assessments: [camera(), camera({ id: 'b' })] }), 2, 0);
    expect(counts.inRange).toBe(2);
  });

  it('counts every other assessed camera as KNOWN, dial or no dial', () => {
    const assessments = [
      camera(),
      camera({ id: 'b', inRange: false, distanceFt: 900 }),
      camera({ id: 'c', inRange: false, distanceFt: 9000 }),
    ];
    expect(sweepCounts(input({ assessments }), 1, 0).known).toBe(2);
  });

  it('reads HAKCERS as unknown, not zero, while presence is not live', () => {
    expect(sweepCounts(input(), 0, 0).darkroute).toBeNull();
  });

  it('reads the presence slice count once presence is live', () => {
    expect(sweepCounts(input({ presenceLive: true }), 0, 14).darkroute).toBe(14);
  });
});

describe('the layer toggle', () => {
  it('offers exactly the two keys the design draws', () => {
    expect(SWEEP_LAYERS).toStrictEqual(['route', 'mesh']);
  });
});
