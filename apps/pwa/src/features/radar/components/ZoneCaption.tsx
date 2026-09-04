/**
 * PUBLISHES THE ZONE LINE TO THE DOCK. RENDERS NOTHING ITSELF.
 *
 * `OVERLAND PARK · 15 CAMS · WITHIN 2 MI` is RADAR's data and the DOCK's
 * chrome. It went through three homes to get here, and the reasons are worth
 * keeping because each one failed for a different reason:
 *
 *   A 190px CARD at the bottom of the column. It covered the scope, which is
 *   the thing the screen is about.
 *
 *   A STICKY ROW inside the scrolling column. The column's bottom edge is the
 *   dock, so a sticky row sat exactly on the clip boundary and lost its last
 *   few pixels -- the text was cut in half.
 *
 *   A SIBLING BAR above the dock. Correct, and a third piece of chrome
 *   competing with two: a black bar with more empty space in it than text,
 *   between the instrument and the navigation.
 *
 * It belongs inside the dock's own rounded panel, under its hairline, which is
 * where the design puts it. That means the DOCK draws it, and the dock is
 * rendered by the shell rather than by this screen -- so this component
 * publishes the values and draws nothing.
 *
 * A component that renders null to run an effect is unusual enough to justify
 * itself: the alternative is a hook call inside `RadarView`, and `RadarView`
 * is a presentational component that takes a model and returns markup. Putting
 * a subscription in it would make every test of that component a test of the
 * dock channel too.
 */

import { useEffect } from 'react';

import { setDockCaption } from '../../../app/dockCaption.ts';
import { gazetteer } from '../../../services/cameras/gazetteer.ts';
import type { RadarState } from '../radarState.ts';
import type { ZoneLive } from '../zoneLive.ts';

/** When the cameras are on unincorporated land and only a county is known. */
export const ZONE_CAPTION_UNKNOWN = 'unmapped area';

export interface ZoneCaptionProps {
  readonly zone: ZoneLive;
  readonly state: RadarState;
}

export function ZoneCaption({ zone, state }: ZoneCaptionProps): null {
  // Names resolve from the gazetteer, which loads lazily. Until it has, and for
  // the cameras on unincorporated land, there is no place name -- this falls
  // back to the county and then to saying so, never to a guess.
  const place =
    gazetteer.place(zone.placeGeoid ?? undefined)?.label ??
    gazetteer.county(zone.countyFips ?? undefined)?.label ??
    (zone.total > 0 ? ZONE_CAPTION_UNKNOWN : '');

  useEffect(() => {
    // An empty place publishes nothing, and the dock draws no row at all --
    // an unfilled slot would change the dock's height as a driver moves
    // between screens, and chrome that resizes under a thumb is chrome you
    // cannot aim at.
    if (place === '' || zone.total === 0) return setDockCaption(null);
    return setDockCaption({
      place,
      count: zone.total,
      within: `WITHIN ${String(zone.radiusMi)} MI`,
      state,
    });
  }, [place, zone.total, zone.radiusMi, state]);

  return null;
}
