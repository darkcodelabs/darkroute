/**
 * THE SPEED PLATE - what it says, and what it refuses to say.
 *
 * The plate is drawn as a road sign, so anything it prints it asserts with a
 * road sign's authority. Most of these are about the dash.
 *
 * The rest are about the "YOU" caption being gone. Removing a visible label is
 * only safe if something else carries it, and for a screen reader the position
 * and the colour of the chip carry nothing at all -- without the aria label a
 * driver using one would hear two bare numbers with no way to tell which is the
 * road's and which is the car's.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SpeedPlate } from './SpeedPlate.tsx';

function plate(speedMph: number | null, maxspeed: string | null = null) {
  const { container } = render(<SpeedPlate speedMph={speedMph} maxspeed={maxspeed} />);
  const root = container.querySelector('.fwm-speedplate');
  const chip = container.querySelector('.fwm-speedplate-you');
  return {
    container,
    over: root?.getAttribute('data-fwm-speed-over'),
    known: root?.getAttribute('data-fwm-speed-known'),
    limit: container.querySelector('.fwm-speedplate-figure')?.textContent,
    speed: container.querySelector('.fwm-speedplate-you-value')?.textContent,
    chipLabel: chip?.getAttribute('aria-label'),
  };
}

describe('the posted limit', () => {
  it('prints the number when the way underneath carries one', () => {
    expect(plate(60, '55 mph').limit).toBe('55');
  });

  it('prints a DASH rather than a value it cannot stand behind', () => {
    // "read the actual sign" is what a driver would have done anyway. A wrong
    // 35 over a school-zone 25 is worse than nothing.
    expect(plate(60, null).limit).not.toMatch(/\d/);
    expect(plate(60, 'signals').limit).not.toMatch(/\d/);
  });

  it('marks itself unknown so the CSS can tell, without parsing the glyph', () => {
    expect(plate(60, '55 mph').known).toBe('true');
    expect(plate(60, null).known).toBe('false');
  });
});

describe('the "YOU" caption is gone, and the chip speaks for itself', () => {
  it('renders NO visible caption -- position and fill say what it is', () => {
    const { container } = plate(47, '45 mph');
    expect(container.querySelector('.fwm-speedplate-you-label')).toBeNull();
    expect(container.textContent).not.toContain('YOU');
  });

  it('STILL SAYS WHOSE NUMBER IT IS to a screen reader', () => {
    // The assertion the caption's removal rests on.
    expect(plate(47, '55 mph').chipLabel).toContain('your speed');
    expect(plate(47, '55 mph').chipLabel).toContain('47');
  });

  it('says over the limit out loud, because colour does not read aloud', () => {
    expect(plate(70, '55 mph').chipLabel).toContain('over the limit');
    expect(plate(47, '55 mph').chipLabel).not.toContain('over the limit');
  });

  it('says unknown rather than naming a speed it does not have', () => {
    expect(plate(null, '55 mph').chipLabel).toContain('unknown');
    expect(plate(null, '55 mph').chipLabel).not.toMatch(/\d/);
  });
});

describe('over the limit', () => {
  it('is flagged only when BOTH numbers are known', () => {
    // Without a limit there is nothing to be over. A plate that guessed here
    // would colour the chip on every unmapped road in the country.
    expect(plate(90, null).over).toBe('false');
    expect(plate(null, '25 mph').over).toBe('false');
  });

  it('tolerates a few mph -- a dashboard fact is not an alarm', () => {
    expect(plate(56, '55 mph').over).toBe('false');
    expect(plate(70, '55 mph').over).toBe('true');
  });
});
