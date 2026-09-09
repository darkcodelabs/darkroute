/**
 * THE MINI MAP'S ARITHMETIC.
 *
 * Everything the picture decides before a GL context exists: how wide a facing
 * mark is, which way it points, and what the caption may claim. The component
 * around it cannot be asserted this way -- a WebGL canvas reads back the same
 * whether it drew a junction or nothing -- which is exactly why these decisions
 * live in a module with no renderer in it.
 */

import { describe, expect, it } from 'vitest';

import {
  FACING_SPAN_DEG,
  GROUND_NOTE,
  MINI_MAP_ZOOM,
  conePath,
  facingSpans,
  miniMapLabel,
} from './miniMap.ts';

describe('facingSpans', () => {
  it('turns a written bearing into a cone centred on it', () => {
    expect(facingSpans([{ kind: 'bearing', deg: 90 }], null)).toEqual([
      { fromDeg: 60, toDeg: 120 },
    ]);
  });

  it('wraps a cone that crosses north rather than producing a negative angle', () => {
    // 0 - 30 is -30, which as a compass bearing is 330. A path built from a
    // negative angle still draws, so this is the kind of error that survives
    // to a phone: the cone would be correct and the numbers unreadable.
    expect(facingSpans([{ kind: 'bearing', deg: 0 }], null)).toEqual([
      { fromDeg: 330, toDeg: 30 },
    ]);
  });

  it('keeps an arc exactly as the mapper wrote it', () => {
    // `direction=338-23` is 45 degrees of real coverage. Re-centring it on its
    // midpoint would replace a measurement with our own 60-degree convention.
    expect(facingSpans([{ kind: 'arc', fromDeg: 338, toDeg: 23 }], null)).toEqual([
      { fromDeg: 338, toDeg: 23 },
    ]);
  });

  it('draws a zero-width arc as the default cone rather than as nothing', () => {
    // `direction=90-90` is a typo, not a camera that sees a line. Drawing it
    // literally produces an invisible sliver and silently loses the facing.
    expect(facingSpans([{ kind: 'arc', fromDeg: 90, toDeg: 90 }], null)).toEqual([
      { fromDeg: 60, toDeg: 120 },
    ]);
  });

  it('draws every direction on a semicolon list, because the FACING tile counts them', () => {
    // The tile above the picture prints "090 +1". A picture with one cone on it
    // would contradict the line directly above it.
    const spans = facingSpans(
      [
        { kind: 'bearing', deg: 90 },
        { kind: 'bearing', deg: 270 },
      ],
      90,
    );
    expect(spans).toHaveLength(2);
  });

  it('falls back to the record derived bearing when no tag was parsed', () => {
    // `directionDeg` is computed at build time, so a record can carry it with
    // no `direction` tag left to read.
    expect(facingSpans([], 180)).toEqual([{ fromDeg: 150, toDeg: 210 }]);
  });

  it('draws nothing at all when the facing is unknown', () => {
    // The honest majority. `null` never means "not facing you" -- it means
    // nobody wrote it down -- so the picture claims nothing.
    expect(facingSpans([], null)).toEqual([]);
  });

  it('is 60 degrees wide, which is the SWEEP PRIMITIVES figure', () => {
    const [span] = facingSpans([{ kind: 'bearing', deg: 180 }], null);
    expect(span).toBeDefined();
    expect((span?.toDeg ?? 0) - (span?.fromDeg ?? 0)).toBe(FACING_SPAN_DEG);
  });
});

describe('conePath', () => {
  it('starts at the camera and closes back to it', () => {
    const path = conePath({ fromDeg: 60, toDeg: 120 }, 30);
    expect(path.startsWith('M 0 0 L ')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('puts north up and east right, which is what north-up means', () => {
    // The picture cannot be rotated, so screen up IS north. A cone pointing
    // north must reach negative y; one pointing east must reach positive x.
    expect(conePath({ fromDeg: 0, toDeg: 0.0001 }, 40)).toContain('L 0 -40');
    expect(conePath({ fromDeg: 90, toDeg: 90.0001 }, 40)).toContain('L 40 0');
  });

  it('sets the large-arc flag past a half turn', () => {
    // Without it SVG draws the SHORT way round, which turns a camera watching
    // most of a junction into one watching the sliver it cannot see.
    const wide = conePath({ fromDeg: 0, toDeg: 300 }, 30);
    const narrow = conePath({ fromDeg: 0, toDeg: 60 }, 30);
    expect(wide).toContain('A 30 30 0 1 1');
    expect(narrow).toContain('A 30 30 0 0 1');
  });

  it('sweeps clockwise, the way a compass reads', () => {
    expect(conePath({ fromDeg: 10, toDeg: 70 }, 30)).toContain(' 1 ');
  });
});

describe('what the picture is allowed to claim', () => {
  it('credits OpenStreetMap when there is ground, because ODbL is a condition', () => {
    expect(GROUND_NOTE.ground).toContain('OpenStreetMap');
  });

  it('says the ground is missing rather than showing a mark on flat colour', () => {
    expect(GROUND_NOTE.bare).not.toBe('');
  });

  it('claims nothing while it is still resolving', () => {
    // No spinner, and no "no map here" that a tile arriving 200ms later makes
    // a lie. The caption is empty until the map has settled.
    expect(GROUND_NOTE.pending).toBe('');
  });

  it('tells a screen reader the facing, which is otherwise drawn only', () => {
    expect(miniMapLabel([{ fromDeg: 60, toDeg: 120 }], 'ground')).toContain('facing');
    expect(miniMapLabel([], 'ground')).not.toContain('facing');
  });

  it('tells a screen reader when there is no ground under the mark', () => {
    expect(miniMapLabel([], 'bare')).toContain('no map cached');
  });
});

describe('the zoom', () => {
  it('is closer than the driving scope, which would draw kilometres of nothing', () => {
    expect(MINI_MAP_ZOOM).toBeGreaterThan(14);
  });
});
