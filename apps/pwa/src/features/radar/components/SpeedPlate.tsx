/**
 * THE SPEED PLATE - a road sign, and your number under it.
 *
 * =============================================================================
 * WHY IT LOOKS LIKE A SIGN
 * =============================================================================
 * The posted limit is the one number on this screen a driver already knows how
 * to read at a glance, because they have been reading it on poles their whole
 * driving life. Drawing it as an MUTCD R2-1 face -- white, black rule, SPEED
 * over LIMIT over the figure -- means it needs no legend and no learning.
 *
 * It also does something for the REST of the screen. The design's own note:
 * "the plate owns the posted limit, so RADAR's only green text is the corridor
 * verdict -- one thing to read per glance." Giving the limit its own visual
 * language frees the instrument palette for the thing the app is actually for.
 *
 * =============================================================================
 * AND WHY IT WILL SHOW A DASH RATHER THAN A NUMBER IT IS NOT SURE OF
 * =============================================================================
 * Because it looks like a sign, anything it prints it asserts with a road
 * sign's authority. `speedLimit.ts` refuses every inferred value for that
 * reason. A dash here means "read the actual sign", which is what a driver
 * would have done anyway; a wrong 35 over a school-zone 25 is worse than
 * nothing at all.
 */

import type { ReactElement } from 'react';

import { speedPlateState } from '../speedLimit.ts';

export interface SpeedPlateProps {
  /** The driver's speed in mph, or null. */
  readonly speedMph: number | null;
  /** The OSM `maxspeed` string for the way underneath, verbatim, or null. */
  readonly maxspeed?: string | null | undefined;
}

export function SpeedPlate({ speedMph, maxspeed = null }: SpeedPlateProps): ReactElement {
  const state = speedPlateState(speedMph, maxspeed);

  return (
    <div
      className="fwm-speedplate"
      data-fwm-speed-over={state.over ? 'true' : 'false'}
      data-fwm-speed-known={state.limitMph === null ? 'false' : 'true'}
    >
      {/* The R2-1 face. `aria-label` carries the whole reading, because the
          three stacked words are one sign and not three labels. */}
      <div
        className="fwm-speedplate-face"
        role="img"
        aria-label={
          state.limitMph === null
            ? 'posted speed limit unknown'
            : `posted speed limit ${String(state.limitMph)}`
        }
      >
        <span className="fwm-speedplate-inner">
          <span className="fwm-speedplate-word">SPEED</span>
          <span className="fwm-speedplate-word">LIMIT</span>
          <span className="fwm-speedplate-figure">{state.limitLabel}</span>
        </span>
      </div>

      {/* Your number, in the bright chip below. Same object, different
          authority: the sign is the road's, this is the car's.

          THE "YOU" LABEL IS GONE, AND THE ARIA LABEL IS WHY THAT IS SAFE.
          Sighted, the chip needs no legend: it is the one bright thing on a
          reversed sign, it sits under the posted limit, and it changes colour
          when the two numbers disagree. None of that reaches a screen reader,
          which without this would hear two bare numbers and no way to tell
          which is the road's and which is the car's. */}
      <div
        className="fwm-speedplate-you"
        role="img"
        aria-label={
          state.speedMph === null
            ? 'your speed unknown'
            : `your speed ${String(state.speedMph)}${state.over ? ', over the limit' : ''}`
        }
      >
        <span className="fwm-speedplate-you-value fwm-data">{state.speedLabel}</span>
      </div>
    </div>
  );
}
