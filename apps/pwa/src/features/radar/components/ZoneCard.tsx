/**
 * THE LIVE ZONE CARD - ZONE AUDIT's reading, for where you are now.
 *
 * ZONE AUDIT (B6) is a screen you navigate to. This is the same numbers, under
 * the dial, moving as you drive: what am I in the middle of, without leaving
 * RADAR.
 *
 * IT IS BUILT IN THE INTEL CARD'S LANGUAGE, ON PURPOSE.
 *   The intel card is what this product already uses to say "here is a thing,
 *   and here are its facts": a hue-lit top rule, a title row with a readout
 *   opposite, a mono sub-line, then a row of bordered fact tiles. A zone is
 *   the same shape of statement about a bigger subject, so it reuses that
 *   vocabulary rather than inventing a second one. Two card idioms on one
 *   screen is how an interface stops feeling like one product.
 *
 *   The top rule takes the RADAR STATE hue, which is what makes it feel alive:
 *   the card is green while the road is clear and crimson while something is
 *   inside the threshold, without printing a second copy of the state anywhere.
 *
 * SAME NUMBERS, NOT A SECOND OPINION. The owner classes come from
 * `zoneLive.ts`, which uses `zone.ts`'s own rows in its own order.
 */

import type { ReactElement } from 'react';

import { gazetteer } from '../../../services/cameras/gazetteer.ts';
import type { RadarState } from '../radarState.ts';
import type { ZoneLive } from '../zoneLive.ts';

export const ZONE_EYEBROW = 'THIS ZONE';
/** Shown before any camera is cached, so the card never draws a hollow zero. */
export const ZONE_EMPTY = 'no cameras on the map within range yet.';
/** When the cameras are on unincorporated land and only a county is known. */
export const ZONE_UNINCORPORATED = 'unincorporated';

export interface ZoneCardProps {
  readonly zone: ZoneLive;
  /** RADAR's state, so the card's rule carries the same hue the dial does. */
  readonly state: RadarState;
}

function Tile({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): ReactElement {
  return (
    <div
      className="fwm-radar-zone-tile"
      data-fwm-radar-zone-tile={label}
      // Zero is a real answer here, not a missing one - "0 POLICE" is
      // information - but it is drawn muted so the eye lands on the counts
      // that are not zero.
      data-fwm-radar-zone-zero={value === 0 ? 'true' : 'false'}
    >
      <span className="fwm-radar-zone-tile-label">{label}</span>
      <span className="fwm-radar-zone-tile-value">{String(value)}</span>
    </div>
  );
}

export function ZoneCard({ zone, state }: ZoneCardProps): ReactElement {
  // Names resolve from the gazetteer, which loads lazily. Until it has, and
  // for the 26,289 cameras on unincorporated land, there is no place name -
  // the card falls back to the county and then to saying so, never to a guess.
  const place = gazetteer.place(zone.placeGeoid ?? undefined);
  const county = gazetteer.county(zone.countyFips ?? undefined);
  const title = place?.label ?? county?.label ?? ZONE_EYEBROW;
  const subline =
    place === null
      ? county === null
        ? null
        : ZONE_UNINCORPORATED
      : (county?.label ?? null);

  return (
    <section
      className="fwm-radar-zone"
      data-fwm-radar-zone-state={state}
      aria-label="this zone"
    >
      <div className="fwm-radar-zone-title-row">
        <h2 className="fwm-radar-zone-title">{title}</h2>
        {/*
          "WITHIN", not a bare "2 MI". The dial's own readout above this card is
          the distance to the NEAREST camera -- 1.5 MI -- and this is the RADIUS
          the counts were taken over. Two unlabelled mile figures on one screen
          read as one number disagreeing with itself.
        */}
        <p className="fwm-radar-zone-readout fwm-data">{`WITHIN ${String(zone.radiusMi)} MI`}</p>
      </div>

      {subline === null ? null : (
        <p className="fwm-radar-zone-subline fwm-data">{subline}</p>
      )}

      {zone.total === 0 ? (
        <p className="fwm-radar-zone-empty fwm-data">{ZONE_EMPTY}</p>
      ) : (
        <div className="fwm-radar-zone-tiles fwm-data">
          <Tile label="CAMERAS" value={zone.total} />
          <Tile label="POLICE" value={zone.police} />
          <Tile label="HOA / PRIVATE" value={zone.hoaPrivate} />
          <Tile label="UNVERIFIED" value={zone.unverified} />
        </div>
      )}
    </section>
  );
}
