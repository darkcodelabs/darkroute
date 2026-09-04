import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLEARANCE_FT,
  MAX_HANDOFF_WAYPOINTS,
  closestApproachFt,
  planDetour,
} from './avoidance.ts';
import { destinationPoint, distanceFt } from './geo.ts';

/** Overland Park, where the reported cameras actually are. */
const START = { lat: 38.9, lon: -94.67 };
/** Due north, about 3.5 miles. */
const END = destinationPoint(START.lat, START.lon, 0, 5600);

/** A camera `ft` to the given side, `alongM` up the route. */
function beside(alongM: number, sideBearing: number, ft: number) {
  const on = destinationPoint(START.lat, START.lon, 0, alongM);
  return destinationPoint(on.lat, on.lon, sideBearing, ft * 0.3048);
}

describe('planning a detour', () => {
  it('returns nothing to do when every camera is already clear', () => {
    // Half a mile to the side is well outside the default 1000 ft berth.
    const plan = planDetour(START, END, [beside(2800, 90, 2640)]);
    expect(plan.waypoints).toEqual([]);
    expect(plan.consideredCameras).toBe(0);
  });

  it('ignores cameras behind you and past the destination', () => {
    const behind = destinationPoint(START.lat, START.lon, 180, 400);
    const past = destinationPoint(END.lat, END.lon, 0, 400);
    const plan = planDetour(START, END, [behind, past]);
    expect(plan.waypoints).toEqual([]);
    expect(plan.consideredCameras).toBe(0);
  });

  it('puts the waypoint on the far side from the camera', () => {
    // One camera 300 ft to the RIGHT of the route, halfway along.
    const camera = beside(2800, 90, 300);
    const plan = planDetour(START, END, [camera]);

    expect(plan.waypoints).toHaveLength(1);
    expect(plan.consideredCameras).toBe(1);

    // The detour must be LEFT of the route, i.e. west of the north-bound line.
    const point = plan.waypoints[0];
    expect(point).toBeDefined();
    expect(point!.lon).toBeLessThan(START.lon);

    // ...and it must actually clear the camera by more than the berth.
    const gap = closestApproachFt(plan.waypoints, [camera]);
    expect(gap).not.toBeNull();
    expect(gap!).toBeGreaterThan(DEFAULT_CLEARANCE_FT);
  });

  it('honours a wider berth when one is asked for', () => {
    const camera = beside(2800, 90, 300);
    const tight = planDetour(START, END, [camera], { clearanceFt: 500 });
    const wide = planDetour(START, END, [camera], { clearanceFt: 2000 });

    const tightGap = closestApproachFt(tight.waypoints, [camera]);
    const wideGap = closestApproachFt(wide.waypoints, [camera]);
    expect(tightGap).not.toBeNull();
    expect(wideGap).not.toBeNull();
    expect(wideGap!).toBeGreaterThan(tightGap!);
    expect(wide.clearanceFt).toBe(2000);
  });

  it('collapses a row of cameras into one waypoint rather than a zig-zag', () => {
    // Six cameras down one boulevard, 150 m apart, all on the same side.
    const row = [0, 150, 300, 450, 600, 750].map((along) => beside(1500 + along, 90, 250));
    const plan = planDetour(START, END, row);

    expect(plan.consideredCameras).toBe(6);
    // Six stops for one road would exhaust the cap and be undrivable.
    expect(plan.waypoints.length).toBeLessThan(row.length);
  });

  it('reports what the handoff cap discarded instead of dropping it quietly', () => {
    /*
     * A LONGER ROUTE, deliberately. On the 5.6 km route the rest of this file
     * uses, cameras spaced 900 m apart run past the destination and are
     * correctly filtered out - so the fixture produced six clusters and the cap
     * never bit. The route has to be long enough to actually hold them.
     */
    const longEnd = destinationPoint(START.lat, START.lon, 0, 20_000);
    const many = Array.from({ length: MAX_HANDOFF_WAYPOINTS + 4 }, (_, index) =>
      beside(600 + index * 900, index % 2 === 0 ? 90 : 270, 200),
    );
    const plan = planDetour(START, longEnd, many);

    expect(plan.waypoints).toHaveLength(MAX_HANDOFF_WAYPOINTS);
    expect(plan.dropped).toBeGreaterThan(0);
  });

  it('counts a camera ON the route as unavoidable rather than pretending', () => {
    // Essentially on the centreline: no side has room, and a detour cannot fix
    // it. Saying so is the point - the driver is going to pass this one.
    const onLine = destinationPoint(START.lat, START.lon, 0, 2800);
    const plan = planDetour(START, END, [onLine]);

    expect(plan.unavoidable).toBe(1);
    expect(plan.waypoints).toEqual([]);
  });

  it('is a no-op for a zero-length route or no cameras', () => {
    expect(planDetour(START, START, [beside(100, 90, 100)]).waypoints).toEqual([]);
    expect(planDetour(START, END, []).waypoints).toEqual([]);
  });

  it('orders waypoints the way they are met', () => {
    const near = beside(900, 90, 250);
    const far = beside(4200, 90, 250);
    const plan = planDetour(START, END, [far, near]);

    expect(plan.waypoints).toHaveLength(2);
    const first = plan.waypoints[0];
    const second = plan.waypoints[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The first waypoint is the one closer to where the driver starts.
    expect(distanceFt(START.lat, START.lon, first!.lat, first!.lon)).toBeLessThan(
      distanceFt(START.lat, START.lon, second!.lat, second!.lon),
    );
  });
});
