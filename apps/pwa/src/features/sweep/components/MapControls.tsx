/**
 * THE MAP'S OWN CONTROLS - small, in a corner, on the map.
 *
 * The range and the threshold each had a full-width rail with a row of labels
 * under it. Between them they took a band off the top and the bottom of the
 * screen permanently, for two controls that are touched rarely: the range is
 * pinched, and the threshold is a setting somebody sets once and forgets.
 *
 * Every map puts its controls on itself, small, in a corner, and gives the rest
 * of the glass to the map. That is what this is. The threshold is not here at
 * all -- it moved to SETTINGS, where a number with rules attached can be
 * explained next to the control that sets it.
 *
 * WHAT SURVIVED, AND WHY EACH
 *   the range READOUT   a map that does not say what scale it is at is asking
 *                       the driver to guess. It is a label, not a slider.
 *   plus and minus      pinch is the real control; these are for one hand on a
 *                       mount, and for anybody whose phone or grip makes a
 *                       two-finger gesture awkward.
 *   RE-CENTER           bottom LEFT, opposite the zoom keys, and only while
 *                       the view is displaced. A pill with the vehicle's own
 *                       arrow on it, the way every maps app draws this.
 *
 * NO AUTOMATIC RE-CENTERING. It was tried -- released the pan whenever the
 * vehicle was moving -- and it is wrong for the same reason the timed version
 * was wrong: it decides for the driver that they have finished looking. The
 * button is the whole mechanism. It appears when there is something to undo
 * and does exactly one thing.
 */

import type { ReactElement } from 'react';

import { MAX_OUTER_FT, MIN_OUTER_FT, clampOuterFt } from '../zoom.ts';
import { rangeLabel } from './RangeKey.tsx';

/**
 * How much one press changes the range.
 *
 * A RATIO, not a step: the ladder spans 1000 ft to 100 miles, so a fixed
 * increment would be a crawl at one end and a leap at the other. A quarter
 * doubling per press is about five presses per doubling, which is fine
 * one-handed and quick enough to cross the whole range in a few seconds.
 */
export const ZOOM_STEP = 1.25;

export function zoomedIn(outerFt: number): number {
  return clampOuterFt(outerFt / ZOOM_STEP);
}

export function zoomedOut(outerFt: number): number {
  return clampOuterFt(outerFt * ZOOM_STEP);
}

export interface MapControlsProps {
  readonly outerFt: number;
  /** Absent renders the range as a readout with no keys. */
  readonly onChange?: ((outerFt: number) => void) | undefined;
  /** The view is displaced. Without this the pill has nothing to undo. */
  readonly panned?: boolean;
  readonly onRecenter?: (() => void) | undefined;
}

/**
 * The vehicle's own arrow, at button size.
 *
 * The same shape the scope draws the driver as, deliberately: the button says
 * "put me back on that" and pointing at the thing with a picture of it is
 * shorter than any wording.
 */
function RecenterArrow(): ReactElement {
  return (
    <svg className="fwm-map-recenter-arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 L20 21 L12 16.5 L4 21 Z" />
    </svg>
  );
}

export function MapControls({
  outerFt,
  onChange,
  panned = false,
  onRecenter,
}: MapControlsProps): ReactElement {
  const range = clampOuterFt(outerFt);

  return (
    <>
    {panned && onRecenter !== undefined ? (
      <button type="button" className="fwm-map-recenter" onClick={onRecenter}>
        <RecenterArrow />
        Re-center
      </button>
    ) : null}

    <div className="fwm-map-controls">
      <span className="fwm-map-range fwm-data" data-fwm-map-range={rangeLabel(range)}>
        {rangeLabel(range)}
      </span>

      {onChange === undefined ? null : (
        <div className="fwm-map-zoom">
          <button
            type="button"
            className="fwm-map-key"
            disabled={range <= MIN_OUTER_FT}
            onClick={() => { onChange(zoomedIn(range)); }}
            aria-label="zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="fwm-map-key"
            disabled={range >= MAX_OUTER_FT}
            onClick={() => { onChange(zoomedOut(range)); }}
            aria-label="zoom out"
          >
            −
          </button>
        </div>
      )}
    </div>
    </>
  );
}
