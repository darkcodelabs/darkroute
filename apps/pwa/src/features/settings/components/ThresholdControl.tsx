/**
 * ALERT AT -- the threshold slider.
 *
 * SOURCE: `Flockys Design System.dc.html` section 04, panel
 * `TOGGLE · SLIDER · CHIPS`:
 *
 *   ALERT AT                                     500 FT      <- mono, hue right
 *   ---------------------------o------------------------     <- 8px track
 *   100                                            1000      <- mono, disabled
 *
 * The track is 8px at radius 999 in the raised surface, the fill is the
 * in-range crimson, and the knob is a 36px disc in the page ground with a 2px
 * crimson ring, centred on the value.
 *
 * =============================================================================
 * WHY A NATIVE `<input type="range">` UNDER A DRAWN TRACK
 * =============================================================================
 * The native control is the accessibility story and the input story: it is a
 * real slider to a screen reader, it steps with the arrow keys, it drags with a
 * thumb, and it emits stepped values without this component doing arithmetic on
 * a pointer position. What it cannot do is paint section 04's picture the same
 * way in every engine -- `::-moz-range-progress` has no WebKit equivalent -- so
 * the track, the fill and the knob are drawn as siblings and the input sits
 * over them, transparent.
 *
 * The fill width and the knob offset are keyed off `data-fwm-threshold-ft`,
 * with one rule per detent in `settings.css`. That is deliberate and it is not
 * a workaround for a missing feature: setting either from JavaScript means an
 * inline style, inline styles are how raw values get past
 * `scripts/check-design-values.mjs`, and the threshold has nineteen legal
 * values, not a continuum.
 *
 * Those rules are transcribed, not generated, so this component states whether
 * the stylesheet actually has one for the value it was handed:
 * `data-fwm-threshold-covered`. When it does not,
 * `--fwm-settings-threshold-at` would fall back to the `0` on `.fwm-settings`
 * and paint a knob at the floor under a readout saying something else -- so the
 * fill and the knob are withheld and only the measured number is shown.
 * `threshold.ts#THRESHOLD_CSS_STOPS` carries the transcription and
 * `threshold.test.tsx` asserts it against the engine's own stop list.
 *
 * =============================================================================
 * THE VALUE IS ALWAYS A DETENT
 * =============================================================================
 * `W10 · THRESHOLD - ROTARY BEZEL` sets this same number in 50 ft steps. The
 * change handler snaps through the engine's own snapper before it reports, so
 * the slider and the bezel can only ever produce values the other could have
 * produced.
 */

import type { ChangeEvent, ReactElement } from 'react';

import {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
} from '../../../stores/fwmCore.ts';
import {
  THRESHOLD_LABEL,
  THRESHOLD_MAX_LABEL,
  THRESHOLD_MIN_LABEL,
  formatThresholdFt,
  hasDetentRule,
  snapToStop,
} from '../threshold.ts';

export interface ThresholdControlProps {
  readonly thresholdFt: number;
  /** Absent means "not wired in this build"; the slider renders disabled. */
  readonly onChange?: ((thresholdFt: number) => void) | undefined;
}

export function ThresholdControl({ thresholdFt, onChange }: ThresholdControlProps): ReactElement {
  const reading = formatThresholdFt(thresholdFt);

  const handle = (event: ChangeEvent<HTMLInputElement>): void => {
    if (onChange === undefined) return;
    onChange(snapToStop(Number(event.target.value)));
  };

  return (
    <div
      className="fwm-settings-threshold"
      data-fwm-threshold-ft={String(thresholdFt)}
      data-fwm-threshold-covered={hasDetentRule(thresholdFt) ? 'true' : 'false'}
      data-fwm-settings-wired={onChange === undefined ? 'false' : 'true'}
    >
      <div className="fwm-settings-threshold-head fwm-data">
        <span className="fwm-settings-threshold-label">{THRESHOLD_LABEL}</span>
        <span className="fwm-settings-threshold-value" data-fwm-settings-threshold="true">
          {reading}
        </span>
      </div>

      <div className="fwm-settings-threshold-bar">
        <span className="fwm-settings-threshold-track" aria-hidden="true" />
        <span className="fwm-settings-threshold-fill" aria-hidden="true" />
        <span className="fwm-settings-threshold-knob" aria-hidden="true" />
        <input
          type="range"
          className="fwm-settings-threshold-input"
          aria-label={THRESHOLD_LABEL}
          aria-valuetext={reading}
          min={ALERT_THRESHOLD_MIN_FT}
          max={ALERT_THRESHOLD_MAX_FT}
          step={ALERT_THRESHOLD_STEP_FT}
          value={thresholdFt}
          disabled={onChange === undefined}
          onChange={handle}
        />
      </div>

      <div className="fwm-settings-threshold-scale fwm-data" aria-hidden="true">
        <span>{THRESHOLD_MIN_LABEL}</span>
        <span>{THRESHOLD_MAX_LABEL}</span>
      </div>
    </div>
  );
}
