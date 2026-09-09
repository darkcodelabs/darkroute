/**
 * THE VIEWPORT FETCH POLICY.
 *
 * The map half of this needs a MapLibre instance and a GL context; the policy
 * half does not, and the policy half is where the cost lives. So the decisions
 * that matter - fetch or not, and how wide - are pure and asserted here, and
 * `MapCanvas` is left holding only "read the box, apply the answer".
 *
 * What each test is really protecting:
 *
 *   the zoom floor    stops 289 tiles being fetched to answer a question the
 *                     heat layer already answers from the overview
 *   the movement gate stops the camera effect's own nudges - it moves the map
 *                     to follow the car - from re-fetching a ring every tick
 *   the diagonal      stops the straight-edged box of loaded ground that a
 *                     width-sized ring leaves in the corners
 */

import { describe, expect, it } from 'vitest';

import { ringsForRangeFt } from '../../services/cameras/sync.ts';
import {
  VIEWPORT_MOVE_FRACTION,
  VIEWPORT_SYNC_MIN_ZOOM,
  decideViewportSync,
  metresBetween,
  viewportRangeFt,
} from './viewportSync.ts';
import type { ViewportBox } from './viewportSync.ts';

/** A viewport `spanDeg` tall and wide, centred on Kansas City. */
function box(zoom: number, spanDeg = 0.2, centreLat = 38.9181, centreLon = -94.6923): ViewportBox {
  return {
    centreLat,
    centreLon,
    northLat: centreLat + spanDeg / 2,
    southLat: centreLat - spanDeg / 2,
    eastLon: centreLon + spanDeg / 2,
    westLon: centreLon - spanDeg / 2,
    zoom,
  };
}

describe('deciding whether to fetch for the viewport', () => {
  it('fetches nothing at country zoom, where a ring would saturate its cap', () => {
    // `ringsForRangeFt` maxes at 8 - 289 tiles - and every one of them would be
    // fetched to draw a picture the heat layer already draws from coordinates
    // the app already has.
    const decision = decideViewportSync(box(VIEWPORT_SYNC_MIN_ZOOM - 1, 30), null);

    expect(decision.fetch).toBe(false);
    expect(decision.reason).toBe('too-far-out');
  });

  it('fetches on the first look, when there is no previous centre to compare', () => {
    const decision = decideViewportSync(box(12), null);

    expect(decision.fetch).toBe(true);
    expect(decision.reason).toBe('fetch');
  });

  it('ignores a nudge, because following the car is not a decision to look elsewhere', () => {
    const view = box(12);
    // A few hundred metres north: the map moves like this on every position
    // tick, and re-fetching a ring each time is the cost this gate exists for.
    const decision = decideViewportSync(view, {
      lat: view.centreLat - 0.002,
      lon: view.centreLon,
    });

    expect(decision.fetch).toBe(false);
    expect(decision.reason).toBe('not-moved');
  });

  it('fetches when the reader pans somewhere genuinely else', () => {
    const view = box(12);
    // Denver, from Kansas City. Nobody drifts there.
    const decision = decideViewportSync(view, { lat: 39.7392, lon: -104.9903 });

    expect(decision.fetch).toBe(true);
    expect(decision.reason).toBe('fetch');
  });

  it('scales the gate with the view, so the same pan reads differently at two zooms', () => {
    // The move is identical; only the span changes. A tenth of a degree is a
    // large fraction of a z14 screen and a small one of a z9 screen, so "the
    // same view" has to mean something different at each.
    const moved = { lat: 38.9181 - 0.1, lon: -94.6923 };

    expect(decideViewportSync(box(14, 0.05), moved).fetch).toBe(true);
    expect(decideViewportSync(box(9, 4), moved).fetch).toBe(false);
  });

  it('sizes the ring off the DIAGONAL, so the corners are covered and not just the middle', () => {
    const view = box(11, 0.5);
    const diagonalFt = viewportRangeFt(view);
    const widthM = metresBetween(
      view.centreLat,
      view.westLon,
      view.centreLat,
      view.eastLon,
    );

    // The corner is further away than the edge, so a ring sized to the width
    // would stop short of the ground the reader can actually see.
    expect(diagonalFt / 3.280839895).toBeGreaterThan(widthM);
    expect(decideViewportSync(view, null).rings).toBe(ringsForRangeFt(diagonalFt));
  });

  it('still reports a ring width when it declines to fetch, so a caller can log why', () => {
    const view = box(12);
    const decision = decideViewportSync(view, { lat: view.centreLat, lon: view.centreLon });

    expect(decision.fetch).toBe(false);
    expect(decision.rings).toBeGreaterThan(0);
  });

  it('keeps the move fraction a fraction, not a distance', () => {
    // Guards the constant itself: a value of 1 or more would mean the centre
    // has to leave the viewport entirely before anything is fetched, which
    // reads as "panning does nothing" rather than as a threshold.
    expect(VIEWPORT_MOVE_FRACTION).toBeGreaterThan(0);
    expect(VIEWPORT_MOVE_FRACTION).toBeLessThan(1);
  });
});
