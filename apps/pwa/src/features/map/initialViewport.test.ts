import { describe, expect, it } from 'vitest';

import {
  NO_FIX_CENTER,
  NO_FIX_ZOOM,
  initialMapViewport,
} from './MapCanvas.tsx';

describe('the map initial viewport', () => {
  it('opens on the supplied fix at the requested driving zoom', () => {
    expect(initialMapViewport(39.0997, -84.5786, 14)).toEqual({
      center: [-84.5786, 39.0997],
      zoom: 14,
      hasFix: true,
    });
  });

  it('opens on the contiguous US when there is no fix, never Null Island', () => {
    const viewport = initialMapViewport(null, null, 14);

    expect(viewport).toEqual({ center: [...NO_FIX_CENTER], zoom: NO_FIX_ZOOM, hasFix: false });
    expect(viewport.center).not.toEqual([0, 0]);
    expect(viewport.zoom).toBeLessThanOrEqual(4);
  });

  it('does not treat a half-present coordinate as a location', () => {
    expect(initialMapViewport(39.0997, null, 14).hasFix).toBe(false);
    expect(initialMapViewport(null, -84.5786, 14).hasFix).toBe(false);
  });
});
