/**
 * The facing dial's geometry, in the design's own 120 pixels.
 *
 * Reference: `Flockys App Screens.dc.html` -- `06 · REPORT`, the 120px dial
 * with its 60 degree wedge, 8px centre dot and four cardinals.
 */

import { describe, expect, it } from 'vitest';

import {
  ARC_SPAN_DEG,
  CENTRE_DOT_RADIUS,
  DIAL_CARDINALS,
  DIAL_CENTRE,
  DIAL_UNITS,
  FACING_MAX_DEG,
  FACING_MIN_DEG,
  RING_RADIUS,
  WEDGE_RADIUS,
  bearingFromPoint,
  dialPoint,
  facingAriaValue,
  facingWedgePath,
} from './facing.ts';

/** The dial as it is laid out on a phone: 120 CSS pixels at the top left. */
const RECT = { left: 0, top: 0, width: DIAL_UNITS, height: DIAL_UNITS };

describe('the dial the panel draws', () => {
  it('is 120 units across, with the wedge and the ring inside it', () => {
    expect(DIAL_UNITS).toBe(120);
    expect(DIAL_CENTRE).toBe(60);
    expect(ARC_SPAN_DEG).toBe(60);
    expect(RING_RADIUS).toBeLessThan(DIAL_CENTRE);
    expect(WEDGE_RADIUS).toBeLessThan(DIAL_CENTRE);
    expect(CENTRE_DOT_RADIUS).toBe(4);
  });

  it('places the four cardinals north-up and clockwise', () => {
    expect(DIAL_CARDINALS.map((point) => point.label)).toEqual(['N', 'E', 'S', 'W']);
    const [north, east, south, west] = DIAL_CARDINALS;
    expect(north?.y).toBeLessThan(DIAL_CENTRE);
    expect(east?.x).toBeGreaterThan(DIAL_CENTRE);
    expect(south?.y).toBeGreaterThan(DIAL_CENTRE);
    expect(west?.x).toBeLessThan(DIAL_CENTRE);
  });
});

describe('polar coordinates', () => {
  it('puts zero degrees at the top and runs clockwise', () => {
    expect(dialPoint(50, 0)).toEqual({ x: 60, y: 10 });
    expect(dialPoint(50, 90)).toEqual({ x: 110, y: 60 });
    expect(dialPoint(50, 180)).toEqual({ x: 60, y: 110 });
    expect(dialPoint(50, 270)).toEqual({ x: 10, y: 60 });
  });
});

describe('the wedge', () => {
  it('is a 60 degree slice centred on the bearing, so arc and readout agree', () => {
    const from = dialPoint(WEDGE_RADIUS, 223 - ARC_SPAN_DEG / 2);
    const to = dialPoint(WEDGE_RADIUS, 223 + ARC_SPAN_DEG / 2);
    expect(facingWedgePath(223)).toBe(
      `M 60 60 L ${String(from.x)} ${String(from.y)} ` +
        `A ${String(WEDGE_RADIUS)} ${String(WEDGE_RADIUS)} 0 0 1 ${String(to.x)} ${String(to.y)} Z`,
    );
  });

  it('starts at the centre of the dial, so the slice is a wedge and not a chord', () => {
    expect(facingWedgePath(0).startsWith('M 60 60 L')).toBe(true);
    expect(facingWedgePath(0).endsWith('Z')).toBe(true);
  });
});

describe('tap to adjust', () => {
  it('reads a tap as the bearing it points at', () => {
    expect(bearingFromPoint(RECT, 60, 0)).toBe(0);
    expect(bearingFromPoint(RECT, 120, 60)).toBe(90);
    expect(bearingFromPoint(RECT, 60, 120)).toBe(180);
    expect(bearingFromPoint(RECT, 0, 60)).toBe(270);
  });

  it('measures from the element, wherever it sits on the page', () => {
    const offset = { left: 20, top: 40, width: DIAL_UNITS, height: DIAL_UNITS };
    expect(bearingFromPoint(offset, 140, 100)).toBe(90);
  });

  it('declines a tap it cannot read rather than answering north', () => {
    expect(bearingFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 4, 4)).toBeNull();
    expect(bearingFromPoint(RECT, 60, 60)).toBeNull();
  });
});

describe('the number the slider reports', () => {
  it('never exceeds the maximum it declares, however a tap rounds', () => {
    // `bearingFromPoint` returns three decimals, so a tap a hair west of north
    // reads 359.x. Rounding alone would announce 360 -- above `aria-valuemax`,
    // and a bearing that does not exist on a half-open circle.
    expect(facingAriaValue(359.7)).toBe(0);
    expect(facingAriaValue(359.4)).toBe(359);
    for (const bearing of [0, 0.4, 179.5, 223, 359, 359.9, 360]) {
      const value = facingAriaValue(bearing);
      expect(value).toBeGreaterThanOrEqual(FACING_MIN_DEG);
      expect(value).toBeLessThanOrEqual(FACING_MAX_DEG);
    }
  });

  it('reports the drawn bearing unchanged', () => {
    expect(facingAriaValue(223)).toBe(223);
  });
});
