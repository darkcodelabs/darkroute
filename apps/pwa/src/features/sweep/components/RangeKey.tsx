/**
 * THE RANGE KEY - what the dial is showing, and how to change it without a pinch.
 *
 * WHY IT CAME BACK
 *   SWEEP had a range control. The merge took it out in favour of pinch, and
 *   two things went with it that pinch does not replace:
 *
 *     · The dial stopped SAYING what it was showing. The ring numbers read
 *       `1 / 0.5 / 0.3` with the unit said nowhere, so the scope was drawing a
 *       scale a driver could not name. "How far out am I looking" had no answer
 *       on screen.
 *     · A pinch is not available to every hand or every mount. A one-finger tap
 *       that steps the ladder is, and a driver in a car mount reaching across
 *       to a phone is doing it one-handed.
 *
 *   So the gesture stays the fine control and this is the coarse one: it names
 *   the current range and steps to the next rung on tap. They write to the same
 *   `outerFt`, so they can never disagree.
 *
 * WHY IT STEPS RATHER THAN OPENS A PICKER
 *   Four rungs. A picker is a second surface to dismiss, at a moment when the
 *   driver's attention is on the road; a tap that advances one rung and wraps
 *   is a single glance and a single touch.
 *
 * WHAT IT SHOWS WHEN PINCHED OFF A RUNG
 *   Pinch is continuous, so the range is usually BETWEEN rungs. The key names
 *   the true range then, not the nearest rung -- rounding the label to a rung
 *   the dial is not actually drawn at would make the one honest readout on the
 *   scope a lie. Tapping from there advances to the next rung above.
 */

import type { ReactElement } from 'react';

import {
  FEET_PER_MILE,
  MAX_OUTER_FT,
  SWEEP_ZOOMS,
  clampOuterFt,
  unitForOuterFt,
} from '../zoom.ts';

export const RANGE_KEY_EYEBROW = 'RANGE';

/**
 * The range as words, at any value the pinch can produce.
 *
 * Feet under a mile, miles above it, and one decimal only where it earns its
 * place -- `1.5 MI` is worth saying, `1.5000000000000002 MI` is what a float
 * division produces if nobody rounds it.
 */
export function rangeLabel(outerFt: number): string {
  const range = clampOuterFt(outerFt);
  if (unitForOuterFt(range) === 'FT') return `${String(Math.round(range))} FT`;
  const miles = range / FEET_PER_MILE;
  const shown = miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10;
  return `${String(shown)} MI`;
}

/**
 * The next rung up, wrapping to the tightest one at the top.
 *
 * Strictly greater, so a range sitting exactly on a rung advances rather than
 * selecting itself and appearing to do nothing.
 */
export function nextRangeFt(outerFt: number): number {
  const range = clampOuterFt(outerFt);
  const up = SWEEP_ZOOMS.find((zoom) => zoom.outerFt > range + 1);
  return up?.outerFt ?? SWEEP_ZOOMS[0]?.outerFt ?? range;
}

export interface RangeKeyProps {
  readonly outerFt: number;
  /** Absent renders the key as a readout: it still says the range. */
  readonly onChange?: ((outerFt: number) => void) | undefined;
}

export function RangeKey({ outerFt, onChange }: RangeKeyProps): ReactElement {
  const label = rangeLabel(outerFt);
  const atCeiling = clampOuterFt(outerFt) >= MAX_OUTER_FT;

  return (
    <button
      type="button"
      className="fwm-sweep-range-key"
      data-fwm-sweep-range={label}
      data-fwm-sweep-range-ceiling={atCeiling ? 'true' : 'false'}
      disabled={onChange === undefined}
      onClick={onChange === undefined ? undefined : () => { onChange(nextRangeFt(outerFt)); }}
      aria-label={`range ${label}, tap for the next range out`}
    >
      <span className="fwm-sweep-range-eyebrow fwm-data">{RANGE_KEY_EYEBROW}</span>
      <span className="fwm-sweep-range-value fwm-data">{label}</span>
    </button>
  );
}
