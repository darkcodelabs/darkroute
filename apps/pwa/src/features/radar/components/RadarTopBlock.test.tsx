/**
 * THE TOP BLOCK - that it says the right things and refuses to guess.
 *
 * It replaced seven stacked readouts, so the coverage those had is the coverage
 * this needs: what it prints when it knows, and - far more important - what it
 * prints when it does not.
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Corridor } from '../corridor.ts';
import { RadarTopBlock } from './RadarTopBlock.tsx';

function corridor(over: Partial<Corridor> = {}): Corridor {
  return {
    headingDeg: 41,
    rangeFt: 3 * 5280,
    clearForFt: 7392,
    cameras: [],
    worstStretch: null,
    ...over,
  } as Corridor;
}

describe('the speed plate', () => {
  it('prints a posted limit it actually has', () => {
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={62} maxspeed="55 mph" headingDeg={41} />,
    );
    expect(container.querySelector('.fwm-topblock-speed-limit')?.textContent).toBe('55');
    expect(container.querySelector('.fwm-topblock-speed-you')?.textContent).toBe('62');
  });

  it('prints a DASH when the limit is unknown, and says so to a screen reader', () => {
    // The plate is a road sign. Anything it prints, it asserts with a sign's
    // authority -- so an inferred limit is worse than no limit at all.
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={62} maxspeed={null} headingDeg={41} />,
    );
    expect(container.querySelector('.fwm-topblock-speed-limit')?.textContent).toBe('—');
    expect(container.querySelector('.fwm-topblock-speed-sign')?.getAttribute('aria-label')).toBe(
      'posted speed limit unknown',
    );
  });

  it('flags over the limit, and only when it knows both numbers', () => {
    const over = render(
      <RadarTopBlock corridor={corridor()} speedMph={70} maxspeed="55 mph" headingDeg={41} />,
    );
    expect(
      over.container.querySelector('.fwm-topblock-speed')?.getAttribute('data-fwm-speed-over'),
    ).toBe('true');

    const unknown = render(
      <RadarTopBlock corridor={corridor()} speedMph={70} maxspeed={null} headingDeg={41} />,
    );
    expect(
      unknown.container.querySelector('.fwm-topblock-speed')?.getAttribute('data-fwm-speed-over'),
    ).toBe('false');
  });
});

describe('the compass', () => {
  it('rotates the needle to the heading and never the ring', () => {
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={30} headingDeg={135} />,
    );
    // BOTH HALVES TURN TOGETHER, as one needle. They are rotated by their
    // shared group rather than individually -- two polygons each carrying
    // their own rotation is two objects that happen to agree, and they would
    // eventually stop agreeing.
    const north = container.querySelector('.fwm-compass-needle-north');
    const south = container.querySelector('.fwm-compass-needle-south');
    expect(north).not.toBeNull();
    expect(south).not.toBeNull();
    expect(north?.parentElement).toBe(south?.parentElement);
    expect(north?.parentElement?.getAttribute('transform')).toContain('rotate(135');
    // THE RING NEVER SPINS. A rose that turns makes the driver read a moving
    // label; a needle against a fixed ring can be read as a shape.
    expect(container.querySelector('.fwm-compass-ring')?.getAttribute('transform')).toBeNull();
    // AND NEITHER DOES THE HUB. It covers the seam between the halves; if it
    // rode the rotation it would drift off the join at every angle but zero.
    expect(container.querySelector('.fwm-compass-hub')?.getAttribute('transform')).toBeNull();
  });

  it('draws no needle at all without a heading, rather than pointing north', () => {
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={null} headingDeg={null} />,
    );
    expect(container.querySelector('.fwm-compass-needle-north')).toBeNull();
    expect(container.querySelector('.fwm-compass-needle-south')).toBeNull();
    expect(container.querySelector('.fwm-compass-hub')).toBeNull();
  });
});

describe('the verdict and the ladder', () => {
  it('states how far the road is clear', () => {
    const { container } = render(
      <RadarTopBlock
        corridor={corridor({
          clearForFt: 7392,
          cameras: [{ id: 'a', distanceFt: 7392, offsetDeg: 0, state: 'approaching' }],
        } as Partial<Corridor>)}
        speedMph={55}
        headingDeg={41}
      />,
    );
    // The caption leads with the verdict and qualifies it with the forecast;
    // the verdict is the part that must be exact and must come first.
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toMatch(
      /^CLEAR FOR 1\.4 MI\b/,
    );
  });

  it('says NO FIX rather than inventing a clear road', () => {
    const { container } = render(
      <RadarTopBlock corridor={null} speedMph={null} headingDeg={null} hasFix={false} />,
    );
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toBe('NO FIX');
    expect(container.querySelectorAll('.fwm-topblock-mark')).toHaveLength(0);
  });

  it('says NO BEARING, not NO FIX, when parked with a good position', () => {
    // THIS WAS ON SCREEN AND IT WAS A LIE. A stationary car has a perfectly
    // good fix; the orientation gate holds the HEADING null on purpose, because
    // a course derived from two identical positions is noise. The corridor
    // needs a bearing to know what "ahead" means, so it returns null -- and
    // reporting that as NO FIX tells a driver their GPS is broken while the
    // accuracy chip beside it reads ±8 M.
    const { container } = render(
      <RadarTopBlock corridor={null} speedMph={1} headingDeg={null} accuracyM={8} hasFix />,
    );
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toBe('NO BEARING');
    expect(container.querySelector('.fwm-topblock-accuracy')?.textContent).toBe('±8 M');
  });

  it('puts a mark on the ladder for each camera ahead', () => {
    const { container } = render(
      <RadarTopBlock
        corridor={corridor({
          cameras: [
            { id: 'a', distanceFt: 5280, offsetDeg: 0, state: 'approaching' },
            { id: 'b', distanceFt: 10560, offsetDeg: 5, state: 'in_range' },
          ],
        } as Partial<Corridor>)}
        speedMph={40}
        headingDeg={0}
      />,
    );
    const marks = container.querySelectorAll('.fwm-topblock-mark');
    expect(marks).toHaveLength(2);
    // Positioned by a quantised attribute, never an inline style: a
    // measurement in a style attribute is one the design gate cannot read.
    expect(marks[0]?.getAttribute('data-fwm-corridor-at')).toBe('330');
    expect(marks[0]?.getAttribute('style')).toBeNull();
  });
});

describe('the accuracy chip', () => {
  it('rounds to whole metres', () => {
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={30} headingDeg={0} accuracyM={3.4} />,
    );
    expect(container.querySelector('.fwm-topblock-accuracy')?.textContent).toBe('±3 M');
  });

  it('says nothing at all rather than a fabricated zero', () => {
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={30} headingDeg={0} accuracyM={null} />,
    );
    expect(container.querySelector('.fwm-topblock-accuracy')?.textContent).toBe('');
  });
});

describe('reroute', () => {
  it('is absent when there is nothing wired to it, rather than inert', () => {
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={30} headingDeg={0} />,
    );
    expect(container.querySelector('.fwm-topblock-key')).toBeNull();
  });

  it('calls back on a press', () => {
    const onReroute = vi.fn();
    const { container } = render(
      // A corridor with something IN it: the key is disabled on a clear road,
      // because there is no way around a stretch with no cameras on it. The
      // default fixture is empty, which now means unpressable.
      <RadarTopBlock
        corridor={corridor({
          cameras: [{ id: 'c1', distanceFt: 900, offsetDeg: 0, state: 'clear' }],
        })}
        speedMph={30}
        headingDeg={0}
        onReroute={onReroute}
      />,
    );
    container.querySelector<HTMLButtonElement>('.fwm-topblock-key')?.click();
    expect(onReroute).toHaveBeenCalledTimes(1);
  });
});

describe('the accuracy chip refuses a perfect fix', () => {
  it('prints nothing for zero metres, which no receiver ever reports', () => {
    // Seen on the running app as "±0 M". It is what a mock location provider
    // supplies when it has no error model, and it reads as the most confident
    // claim the chip can make. Same rule as the speed plate: a number nobody
    // stands behind does not get printed.
    const { container } = render(
      <RadarTopBlock corridor={corridor()} speedMph={30} headingDeg={0} accuracyM={0} />,
    );
    expect(container.querySelector('.fwm-topblock-accuracy')?.textContent).toBe('');
  });
});

/**
 * THE REROUTE KEY SAYS WHEN IT CANNOT ACT.
 *
 * `rerouteWaypoint` refuses a corridor with no cameras in it and one with no
 * heading. Both refusals are correct -- there is no way around a stretch with
 * nothing on it, and no "ahead" to put a waypoint in without a course -- and
 * both were SILENT: the key stayed drawn at full strength and the press did
 * nothing. On a road reading CLEAR FOR 3 MI that is the same shape as broken,
 * and it was reported as exactly that.
 */
describe('the reroute key', () => {
  const camera = (distanceFt: number) => ({
    id: `c${String(distanceFt)}`,
    distanceFt,
    offsetDeg: 0,
    state: 'clear' as const,
  });

  const withCameras = (count: number, headingDeg: number | null): Corridor => ({
    headingDeg,
    rangeFt: 15_840,
    cameras: Array.from({ length: count }, (_, i) => camera(500 + i * 500)),
    clearForFt: 500,
    worstStretch: null,
  });

  function key(corridor: Corridor | null): HTMLButtonElement | null {
    const { container } = render(
      <RadarTopBlock
        corridor={corridor}
        speedMph={47}
        headingDeg={41}
        onReroute={() => undefined}
      />,
    );
    return container.querySelector('.fwm-topblock-key');
  }

  it('is PRESSABLE when there is something ahead to route around', () => {
    expect(key(withCameras(3, 41))?.disabled).toBe(false);
  });

  it('is disabled on a clear road -- there is no way around nothing', () => {
    expect(key(withCameras(0, 41))?.disabled).toBe(true);
  });

  it('is disabled without a heading, because there is no "ahead" to aim at', () => {
    // The proximity view: cameras all around, no direction of travel.
    expect(key(withCameras(5, null))?.disabled).toBe(true);
  });

  it('is disabled with no corridor at all', () => {
    expect(key(null)?.disabled).toBe(true);
  });
});
