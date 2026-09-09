/**
 * THE COMPASS. Which way is north, and one press to put it back on top.
 * =============================================================================
 * WHY IT EXISTS
 * =============================================================================
 * North-up is the default, so most of the time this needle points straight up
 * and says nothing new. That is the point: the moment the map is turned - by
 * the heading-up setting, or by a two-finger rotate - every direction on screen
 * starts meaning something different, and until now there was nothing on the
 * map that said so. A driver who could not remember which way the world was
 * facing had to open MAP VIEW to find out.
 *
 * The bug that made it necessary: demo drive's pad moved the marker UP when
 * RIGHT was pressed, because the arrows were screen directions and the map was
 * rotated. That is fixed at the source, but it happened because the rotation
 * was invisible. A control that changes what every other control means should
 * be legible from the surface it changes.
 *
 * =============================================================================
 * IT IS A READOUT AND A CONTROL, WHICH IS THE CONVENTION
 * =============================================================================
 * Every mapping app a driver has used puts a compass on a rotated map and
 * returns it to north when pressed. Doing the same thing costs nothing to learn
 * and is the one gesture people already try.
 *
 * Pressing it sets `headingUpMap` to false, which is the SETTING rather than a
 * transient nudge, so it survives the next GPS tick. A one-press control that
 * gets silently undone two seconds later is worse than no control.
 */

import type { ReactElement } from 'react';

import './mapCompass.css';

export const COMPASS_TO_NORTH = 'Face the map north';
export const COMPASS_IS_NORTH = 'The map faces north';

export interface MapCompassProps {
  /**
   * How far the map is turned, clockwise, in degrees. 0 is north-up.
   *
   * The NEEDLE counter-rotates by this: the map turning right is the world
   * turning left under it, and a compass that turned WITH the map would point
   * at the top of the screen forever and mean nothing.
   */
  readonly bearingDeg: number;
  /** Whether the map is set to turn with the vehicle. */
  readonly headingUp: boolean;
  /** Put the map back to north-up. */
  readonly onFaceNorth: () => void;
}

/** Below this the map is north-up for any purpose a driver has. */
const SQUARE_ENOUGH_DEG = 1;

export function MapCompass({
  bearingDeg,
  headingUp,
  onFaceNorth,
}: MapCompassProps): ReactElement {
  const turned = Math.abs(((bearingDeg % 360) + 360) % 360) > SQUARE_ENOUGH_DEG;

  return (
    <button
      type="button"
      className="fwm-compass"
      /* THE STATE IS IN THE NAME, not only in the drawing. A needle is a
         picture, and the one person who cannot use a picture is the person most
         likely to have lost track of which way the map is facing. */
      aria-label={turned || headingUp ? COMPASS_TO_NORTH : COMPASS_IS_NORTH}
      data-fwm-turned={turned ? 'true' : undefined}
      data-fwm-heading-up={headingUp ? 'true' : undefined}
      onClick={onFaceNorth}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        style={{ transform: `rotate(${String(-bearingDeg)}deg)` }}
      >
        {/* The needle: a north half and a south half, so it reads as a compass
            rather than as an arrow pointing somewhere. */}
        <path className="fwm-compass-n" d="M12 3.5 15.2 12H8.8z" />
        <path className="fwm-compass-s" d="M12 20.5 8.8 12h6.4z" />
      </svg>
      {/* The letter does not turn. It labels the needle's red half, and a
          rotating N is a letter a driver has to read sideways. */}
      <span className="fwm-compass-mark" aria-hidden="true">
        N
      </span>
    </button>
  );
}
