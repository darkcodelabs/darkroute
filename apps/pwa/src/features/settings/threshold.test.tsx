/**
 * The threshold vocabulary SETTINGS and the watch bezel share.
 *
 * Section 04 draws the slider from 100 to 1000; `W10 · THRESHOLD - ROTARY
 * BEZEL` turns the same number in 50 ft steps. These assertions are about the
 * two never being able to disagree.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
  DEFAULT_ALERT_THRESHOLD_FT,
} from '../../stores/fwmCore.ts';

import {
  THRESHOLD_CSS_STOPS,
  THRESHOLD_LABEL,
  THRESHOLD_MAX_LABEL,
  THRESHOLD_MIN_LABEL,
  THRESHOLD_STOPS,
  formatThresholdFt,
  hasDetentRule,
  snapToStop,
  stopIndex,
} from './threshold.ts';
import { ThresholdControl } from './components/ThresholdControl.tsx';

describe('the stops are the bezel detents', () => {
  it('runs the design system slider end to end in bezel steps', () => {
    expect(THRESHOLD_STOPS[0]).toBe(ALERT_THRESHOLD_MIN_FT);
    expect(THRESHOLD_STOPS.at(-1)).toBe(ALERT_THRESHOLD_MAX_FT);
    for (let i = 1; i < THRESHOLD_STOPS.length; i++) {
      const previous = THRESHOLD_STOPS[i - 1] ?? 0;
      const current = THRESHOLD_STOPS[i] ?? 0;
      expect(current - previous).toBe(ALERT_THRESHOLD_STEP_FT);
    }
  });

  it('includes the value every design file renders', () => {
    // `ALERT AT 500 FT` in section 04, `500` in W10, `ALERT AT 500 FT` inside
    // RADAR's ring on screen 01.
    expect(THRESHOLD_STOPS).toContain(DEFAULT_ALERT_THRESHOLD_FT);
    expect(stopIndex(DEFAULT_ALERT_THRESHOLD_FT)).toBeGreaterThanOrEqual(0);
  });

  it('renders a stop, and only a stop, on the attribute the stylesheet keys off', () => {
    // The fill width and the knob offset are one CSS rule per detent, selected
    // by `[data-fwm-threshold-ft="<value>"]`. This asserts the DOM half of that
    // coupling: every value the control can hold is one the stylesheet has a
    // rule for. The CSS half cannot be read here -- vitest runs with
    // `css: false`, so even `./settings.css?raw` is the empty string.
    // GAP: see docs/gaps-inbox/settings.md#threshold-detent-rules-are-not-machine-checked
    for (const ft of THRESHOLD_STOPS) {
      const { container, unmount } = render(<ThresholdControl thresholdFt={ft} />);
      expect(
        container.querySelector('.fwm-settings-threshold')?.getAttribute('data-fwm-threshold-ft'),
      ).toBe(String(ft));
      unmount();
    }
  });
});

describe('the stylesheet transcription and the engine cannot drift apart', () => {
  // `settings.css`'s nineteen detent rules are hand-written; `THRESHOLD_STOPS`
  // is derived from `ALERT_THRESHOLD_MIN_FT` / `_MAX_FT` / `_STEP_FT`. Nothing
  // generates one from the other, so the transcription is written down as data
  // and compared here. Change the bounds or the step without touching
  // `settings.css` and this fails -- instead of the slider silently pinning the
  // knob to the far left while the readout reads e.g. `125 FT`.
  it('has a stylesheet rule for exactly the values the engine allows', () => {
    expect([...THRESHOLD_CSS_STOPS]).toEqual([...THRESHOLD_STOPS]);
  });

  it('claims a rule only for the values it has transcribed', () => {
    for (const ft of THRESHOLD_STOPS) {
      expect(hasDetentRule(ft)).toBe(true);
    }
    // Between two detents, and outside the range: neither has a rule.
    expect(hasDetentRule(125)).toBe(false);
    expect(hasDetentRule(1050)).toBe(false);
  });

  it('withholds the drawn fill and knob for a value the stylesheet cannot place', () => {
    const { container } = render(<ThresholdControl thresholdFt={125} />);
    const root = container.querySelector('.fwm-settings-threshold');

    // The number is measured and still shown; the POSITION is not invented.
    expect(root?.getAttribute('data-fwm-threshold-covered')).toBe('false');
    expect(
      container.querySelector('[data-fwm-settings-threshold="true"]')?.textContent,
    ).toBe('125 FT');
  });

  it('marks every legal value as one the stylesheet can place', () => {
    for (const ft of THRESHOLD_STOPS) {
      const { container, unmount } = render(<ThresholdControl thresholdFt={ft} />);
      expect(
        container
          .querySelector('.fwm-settings-threshold')
          ?.getAttribute('data-fwm-threshold-covered'),
      ).toBe('true');
      unmount();
    }
  });
});

describe('snapping', () => {
  it('pulls an off-detent value onto the nearest one', () => {
    expect(snapToStop(524)).toBe(500);
    expect(snapToStop(526)).toBe(550);
  });

  it('never leaves the range the engine accepts', () => {
    expect(snapToStop(0)).toBe(ALERT_THRESHOLD_MIN_FT);
    expect(snapToStop(99_999)).toBe(ALERT_THRESHOLD_MAX_FT);
  });
});

describe('the readout', () => {
  it('prints the value the way section 04 prints it', () => {
    expect(THRESHOLD_LABEL).toBe('ALERT AT');
    expect(formatThresholdFt(500)).toBe('500 FT');
    expect(THRESHOLD_MIN_LABEL).toBe('100');
    expect(THRESHOLD_MAX_LABEL).toBe('1000');
  });
});
