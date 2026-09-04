/**
 * The share card, as B6 draws it.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B6 · ZONE AUDIT` -- a panel edged in
 * the in-range hue: the `Dark`/`Route` lockup over a 70px mono numeral,
 * one 21px sentence, four mono stat rows, and a two-line 9px footer.
 *
 * =============================================================================
 * WHAT IS MISSING FROM IT, AND WHY
 * =============================================================================
 * THE PLACE NAME. B6's sentence ends `of Hartwell Elementary.` Naming the
 * middle of the disc means reverse-geocoding the driver's exact position, which
 * is a network call carrying their coordinates. The clause is dropped rather
 * than invented; `place` restores it the moment something on the device can
 * name a zone without asking a server where the driver is.
 * GAP: see docs/gaps-inbox/zone-audit.md#card-place-name-needs-a-geocoder
 *
 * THE DOMAIN. B6's footer ends `darkroute.app`. The production origin is
 * configuration, not source -- `services/adapters/share.ts` refuses to construct
 * one and so does this component. `origin` renders the line when a build has one.
 * GAP: see docs/gaps-inbox/zone-audit.md#no-configured-origin-so-the-card-carries-no-domain
 *
 * =============================================================================
 * A MISSING NUMBER IS AN EM DASH
 * =============================================================================
 * `stats` is null before the zone can be located. Every numeral then prints
 * ` - `, and the card keeps its shape rather than drawing a plausible zero.
 */

import type { ReactElement } from 'react';

import { NO_VALUE } from '../../radar';
import { formatExposureTotal } from '../../log/exposure.ts';
import { BRAND_PREFIX, BRAND_SUFFIX } from '../shareCard.ts';
import { ZONE_STAT_ROWS, cardProvenance, cardSentence, zoneStatValue } from '../zone.ts';
import type { ZoneRadiusMi, ZoneStats } from '../zone.ts';

export interface ShareCardProps {
  /** Null until the zone can be located. Every numeral prints an em dash. */
  readonly stats: ZoneStats | null;
  readonly radiusMi: ZoneRadiusMi;
  /** What named the zone, when anything did. Never a coordinate. */
  readonly place?: string | null;
  readonly atMs: number;
  /** Absolute origin from app config. Never built here. Omit to draw no line. */
  readonly origin?: string | null;
}

export function ShareCard({
  stats,
  radiusMi,
  place = null,
  atMs,
  origin = null,
}: ShareCardProps): ReactElement {
  const hero = stats === null ? NO_VALUE : formatExposureTotal(stats.total);
  return (
    <article className="fwm-zone-card" data-fwm-zone-card="true">
      <div className="fwm-zone-card-brand">
        <span className="fwm-zone-card-mark" aria-hidden="true" />
        <span className="fwm-zone-card-word">
          {BRAND_PREFIX}
          <span className="fwm-zone-card-word-accent">{BRAND_SUFFIX}</span>
        </span>
      </div>
      <p className="fwm-zone-card-hero" data-fwm-zone-card-hero="true">
        {hero}
      </p>
      <p className="fwm-zone-card-line">{cardSentence(radiusMi, place)}</p>
      <div className="fwm-zone-card-rows">
        {ZONE_STAT_ROWS.map((row) => (
          <div key={row} className="fwm-zone-card-row" data-fwm-zone-card-row={row}>
            <span className="fwm-zone-card-row-label">{row}</span>
            <span className="fwm-zone-card-row-value">
              {stats === null ? NO_VALUE : formatExposureTotal(zoneStatValue(stats, row))}
            </span>
          </div>
        ))}
      </div>
      <p className="fwm-zone-card-foot">
        {cardProvenance(atMs)}
        {origin === null || origin.trim() === '' ? null : (
          <span className="fwm-zone-card-origin">{origin.trim()}</span>
        )}
      </p>
    </article>
  );
}
