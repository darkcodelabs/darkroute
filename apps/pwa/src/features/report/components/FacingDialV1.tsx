/**
 * THE FACING DIAL - v1.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isReport` block,
 * lines 634-643: a 96px disc with a conic arc showing the facing, the bearing
 * as a heading beside it, and "Filled from your compass. Drag the arc if it
 * looks wrong."
 *
 * =============================================================================
 * WHY THIS IS NOT `FacingDial`
 * =============================================================================
 * That component is v0's: a 120-unit ring with N/E/S/W lettering and v0's
 * readout beside it. It is correct and it looks like v0, which is the one
 * thing a v1 sheet must not contain.
 *
 * =============================================================================
 * EVERY HARD PART IS IMPORTED, NOT REWRITTEN
 * =============================================================================
 * `facing.ts` already owns the geometry and the input maths - the wedge path,
 * the click-to-bearing conversion, the step sizes, the ARIA bounds - and
 * `reportDraft.ts` owns the wording. This file is the arrangement of those,
 * which is what a redesign is.
 *
 * The a11y contract is the same one, deliberately:
 *   - `role="slider"` only when it is adjustable; `role="img"` otherwise, so a
 *     dial nothing can move does not announce itself as a control.
 *   - NO `aria-valuenow` when the bearing is unknown. Reporting 0 would
 *     announce due north - a bearing the app does not have - to any assistive
 *     technology that prefers it over `aria-valuetext`.
 *   - Arrows step 1 degree, PageUp/PageDown step 15.
 */

import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';

import {
  CENTRE_DOT_RADIUS,
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

export const FACING_V1_TITLE = 'Which way does it look?';
export const FACING_UNSET = 'Not set';

export interface FacingDialV1Props {
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

/** The slider's numeric attributes, or none of them. See the header. */
function sliderValue(facingDeg: number | null): Record<string, number> {
  const bounds = { 'aria-valuemin': FACING_MIN_DEG, 'aria-valuemax': FACING_MAX_DEG };
  if (facingDeg === null) return bounds;
  return { ...bounds, 'aria-valuenow': facingAriaValue(facingDeg) };
}

export function FacingDialV1({ facingDeg, label, onAdjust }: FacingDialV1Props): ReactElement {
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
    <section className="fwm-reportv1-facing-block" aria-label="facing">
      <svg
        className="fwm-reportv1-dial"
        viewBox={`0 0 ${String(DIAL_UNITS)} ${String(DIAL_UNITS)}`}
        role={onAdjust === undefined ? 'img' : 'slider'}
        aria-label="camera facing"
        aria-valuetext={valueText(facingDeg)}
        data-fwm-report-facing={facingDeg === null ? 'unset' : 'set'}
        {...(onAdjust === undefined
          ? {}
          : { tabIndex: 0, ...sliderValue(facingDeg), onClick, onKeyDown })}
      >
        <circle
          className="fwm-reportv1-dial-ring"
          cx={DIAL_CENTRE}
          cy={DIAL_CENTRE}
          r={RING_RADIUS}
        />
        {/* NO WEDGE WITH NO BEARING. An arc pointing north on a record whose
            facing is unknown is the sheet inventing the one field it is asking
            the driver to supply. */}
        {facingDeg === null ? null : (
          <path
            className="fwm-reportv1-dial-wedge"
            d={facingWedgePath(facingDeg)}
            aria-hidden="true"
          />
        )}
        <circle
          className="fwm-reportv1-dial-centre"
          cx={DIAL_CENTRE}
          cy={DIAL_CENTRE}
          r={CENTRE_DOT_RADIUS}
        />
      </svg>

      <div className="fwm-reportv1-facing-readout">
        <p className="fwm-reportv1-facing-heading">
          {facingDeg === null ? FACING_UNSET : `${facingCardinal(facingDeg)} · ${facingDetail(facingDeg) ?? ''}`}
        </p>
        <p className="fwm-reportv1-facing-label fwm-data">{label}</p>
        {onAdjust === undefined ? null : (
          <p className="fwm-reportv1-facing-hint fwm-data">{FACING_HINT}</p>
        )}
      </div>
    </section>
  );
}
