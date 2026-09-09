/**
 * `FACING · FROM COMPASS` - the arc, and the bearing beside it.
 *
 * SOURCE: v2 `06 · REPORT`. A 120px FILLED disc carrying a 60 degree wedge, an
 * 8px centre dot and four cardinals; to its right the cardinal at 26px/700 in
 * the in-range hue, then `223° · covering the northbound lane` and
 * `TAP ARC TO ADJUST`.
 *
 * v2 inverted the disc: v1 stroked a 1px ring around nothing, v2 fills
 * `--fwm-surface-card` and strokes nothing, and the cardinals went from 9px in
 * `--fwm-line-strong` to 10px in `--fwm-text-muted`. The SVG is unchanged -
 * `.fwm-report-dial-ring` is the same `<circle>`, it just paints instead of
 * outlines. See `report.css`.
 *
 * =============================================================================
 * THE DIAL IS THE CONTROL
 * =============================================================================
 * `TAP ARC TO ADJUST` is an instruction, so the dial is a control and not a
 * picture: a tap anywhere on it sets the bearing to the direction of the tap.
 * It is also an ARIA slider, because a control reachable only by touch is
 * unreachable from a keyboard, a switch or a screen reader - the same
 * accommodation `SweepDial` makes for its camera dots.
 * GAP: see docs/gaps-inbox/report.md#arc-adjust-is-touch-only-in-the-design
 *
 * A tap the geometry cannot read (nothing laid out yet, or dead centre) leaves
 * the bearing exactly as it was. It never falls back to north.
 */

import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';

import { NO_VALUE } from '../../radar';
import {
  CENTRE_DOT_RADIUS,
  DIAL_CARDINALS,
  DIAL_CENTRE,
  DIAL_UNITS,
  FACING_COARSE_STEP_DEG,
  FACING_MAX_DEG,
  FACING_MIN_DEG,
  FACING_STEP_DEG,
  RING_RADIUS,
  bearingFromPoint,
  facingAriaValue,
  facingWedgePath,
} from '../facing.ts';
import { FACING_HINT, facingCardinal, facingDetail, normaliseDegrees } from '../reportDraft.ts';

export interface FacingDialProps {
  /** Degrees the lens looks along, or null when nothing has supplied one. */
  readonly facingDeg: number | null;
  /** `FACING · FROM COMPASS`, or whichever provenance is true right now. */
  readonly label: string;
  /** Absent renders the dial as a picture: drawn, announced, not adjustable. */
  readonly onAdjust?: ((bearingDeg: number) => void) | undefined;
}

/** What a screen reader says instead of a bare number. */
function valueText(facingDeg: number | null): string {
  if (facingDeg === null) return 'not set';
  return `${facingCardinal(facingDeg)}, ${String(facingAriaValue(facingDeg))} degrees`;
}

/**
 * The slider's numeric attributes, or none of them.
 *
 * WITH NO BEARING THERE IS NO `aria-valuenow`. Reporting 0 would announce due
 * north - a bearing the app does not have - to any assistive technology that
 * prefers `aria-valuenow` over `aria-valuetext`, which is the same invented
 * reading the sheet refuses everywhere else. ARIA 1.2 makes `aria-valuenow`
 * optional precisely so a slider can say its value is unknown; `aria-valuetext`
 * says "not set" beside it.
 */
function sliderValue(facingDeg: number | null): Record<string, number> {
  const bounds = { 'aria-valuemin': FACING_MIN_DEG, 'aria-valuemax': FACING_MAX_DEG };
  if (facingDeg === null) return bounds;
  return { ...bounds, 'aria-valuenow': facingAriaValue(facingDeg) };
}

export function FacingDial({ facingDeg, label, onAdjust }: FacingDialProps): ReactElement {
  const cardinal = facingCardinal(facingDeg);
  const detail = facingDetail(facingDeg);

  const step = (by: number): void => {
    if (onAdjust === undefined) return;
    onAdjust(normaliseDegrees((facingDeg ?? 0) + by));
  };

  const onClick = (event: MouseEvent<SVGSVGElement>): void => {
    if (onAdjust === undefined) return;
    const bearing = bearingFromPoint(
      event.currentTarget.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    if (bearing === null) return;
    onAdjust(bearing);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (onAdjust === undefined) return;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowUp') {
      event.preventDefault();
      step(FACING_STEP_DEG);
    } else if (key === 'ArrowLeft' || key === 'ArrowDown') {
      event.preventDefault();
      step(-FACING_STEP_DEG);
    } else if (key === 'PageUp') {
      event.preventDefault();
      step(FACING_COARSE_STEP_DEG);
    } else if (key === 'PageDown') {
      event.preventDefault();
      step(-FACING_COARSE_STEP_DEG);
    }
  };

  return (
    <section className="fwm-report-facing" aria-label="facing">
      <h2 className="fwm-report-label">{label}</h2>
      <div className="fwm-report-facing-row">
        <svg
          className="fwm-report-dial"
          viewBox={`0 0 ${String(DIAL_UNITS)} ${String(DIAL_UNITS)}`}
          role={onAdjust === undefined ? 'img' : 'slider'}
          aria-label="camera facing"
          aria-valuetext={valueText(facingDeg)}
          data-fwm-report-facing={facingDeg === null ? 'unset' : 'set'}
          {...(onAdjust === undefined
            ? {}
            : {
                tabIndex: 0,
                ...sliderValue(facingDeg),
                onClick,
                onKeyDown,
              })}
        >
          <circle
            className="fwm-report-dial-ring"
            cx={DIAL_CENTRE}
            cy={DIAL_CENTRE}
            r={RING_RADIUS}
          />
          {facingDeg === null ? null : (
            <path
              className="fwm-report-dial-wedge"
              d={facingWedgePath(facingDeg)}
              aria-hidden="true"
            />
          )}
          <circle
            className="fwm-report-dial-centre"
            cx={DIAL_CENTRE}
            cy={DIAL_CENTRE}
            r={CENTRE_DOT_RADIUS}
          />
          {DIAL_CARDINALS.map((point) => (
            <text
              key={point.label}
              className="fwm-report-dial-cardinal"
              x={point.x}
              y={point.y}
              textAnchor="middle"
              dominantBaseline="middle"
              aria-hidden="true"
            >
              {point.label}
            </text>
          ))}
        </svg>

        <div className="fwm-report-facing-readout">
          <p className="fwm-report-facing-cardinal fwm-data">{cardinal}</p>
          <p className="fwm-report-facing-detail fwm-data">
            {detail ?? NO_VALUE}
            {onAdjust === undefined ? null : (
              <span className="fwm-report-facing-hint">{FACING_HINT}</span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
