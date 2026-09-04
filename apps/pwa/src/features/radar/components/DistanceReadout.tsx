/**
 * The hero readout: distance, unit, direction line.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `01 · RADAR - IN RANGE` --
 *   `425` at 96px beside `FT` at 28px, then `AHEAD · SLIGHT LEFT` at 14px in
 *   the state hue. `A2 · OFFLINE` renders the same block at 88px with
 *   `CACHED CAMERA · AHEAD`; the state matrix renders `2.4` / `MI TO NEAREST`
 *   for clear and `425` / `FT` / `STILL TRACKING` for muted.
 *
 * =============================================================================
 * THE DIGITS NEVER TWEEN
 * =============================================================================
 * The value SNAPS on every GPS tick. There is no count-up, no interpolation, no
 * CSS transition and no CSS animation on the digit element, and there never may
 * be one:
 *
 *   - A tween shows a distance the vehicle was never at. At 47 mph a 240ms
 *     ease is 16 feet of fiction, and this readout's entire job is to be the
 *     number a driver can trust at a glance.
 *   - A tween that has not finished when the next fix lands renders a value
 *     that is behind the truth and still moving, which reads as "closing" when
 *     the car may be receding.
 *   - "mono, tabular-nums. Never wraps, never animates its digits."
 *       -- Flockys Design System.dc.html, section 02, text-hero
 *
 * The digit element is a plain `<span>` whose text is the store's value. React
 * replaces the text node; nothing animates it. `radar.css` declares no
 * transition and no animation on `.fwm-radar-digits`, and `RadarView.test.tsx`
 * reads that file off disk to keep it that way.
 *
 * `aria-live` is deliberately absent: a screen reader announcing every foot
 * would talk over the driver continuously. The state change is announced once,
 * by the status row, not by the numeral.
 */

import type { ReactElement } from 'react';

import { distanceUnit, formatDistanceValue } from '../format.ts';

export interface DistanceReadoutProps {
  /** Feet to the nearest camera, straight off the engine's assessment. */
  readonly distanceFt: number | null;
  /** The composed line under the numerals, or null when the state has none. */
  readonly directionLine: string | null;
}

export function DistanceReadout({ distanceFt, directionLine }: DistanceReadoutProps): ReactElement {
  const unit = distanceUnit(distanceFt);

  return (
    <div className="fwm-radar-readout">
      <div className="fwm-radar-hero">
        {/* SNAP, NEVER TWEEN. See the file comment above. */}
        <span className="fwm-radar-digits fwm-data" data-fwm-radar-digits="true">
          {formatDistanceValue(distanceFt)}
        </span>
        <span className="fwm-radar-unit fwm-data">{unit}</span>
      </div>
      {directionLine === null ? null : (
        <div className="fwm-radar-direction fwm-data" data-fwm-radar-direction="true">
          {directionLine}
        </div>
      )}
    </div>
  );
}
