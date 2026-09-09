/**
 * `FLOCKED TODAY` -- the hero count and the seven-day trend.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `05 · LOG - EXPOSURE`
 *   `FLOCKED TODAY` / `12` / `CAMERAS · 4 UNIQUE`, seven bars 64px tall with
 *   the tallest in the in-range hue and the next in the approaching hue, and a
 *   `SUN`..`SAT` axis at 9px.
 * `Flockys Watch.dc.html`, `W5 · TODAY - EXPOSURE GLANCE`, draws the same seven
 * bars and names them `7 DAY TREND`.
 *
 * MUTED CAMERAS ARE IN THESE NUMBERS. `todayPasses` and the bars are counted
 * off the SAME recorded rows by the same predicate (`exposure.ts`
 * `todayExposure()` and `sevenDayBars()`), so the hero and the last bar of the
 * week are the same number by construction, and neither can be reset by a
 * counter this screen does not own. There is no mute check anywhere in this
 * subtree.
 * GAP: see docs/gaps-inbox/log.md#nothing-rolls-the-day-over
 *
 * ZERO IS A REAL NUMBER, AND IT IS PRINTED. A day with no cameras draws a
 * baseline tick rather than vanishing, so the week always reads as seven days.
 */

import type { ReactElement } from 'react';

import { formatCount } from '../../radar';
import { formatUniqueCaption } from '../exposure.ts';
import type { DayBar } from '../exposure.ts';

export interface ExposureCardProps {
  /** Camera passes today. Muted passes included, by design. */
  readonly todayPasses: number;
  readonly todayUnique: number;
  /** Seven days, oldest first, ending today. */
  readonly bars: readonly DayBar[];
}

export function ExposureCard({ todayPasses, todayUnique, bars }: ExposureCardProps): ReactElement {
  return (
    <section className="fwm-log-card" data-fwm-log-card="today" aria-label="FLOCKED TODAY">
      <div className="fwm-log-card-label">FLOCKED TODAY</div>
      <div className="fwm-log-today-count">
        <div className="fwm-log-hero fwm-data" data-fwm-log-today="true">
          {formatCount(todayPasses)}
        </div>
        <div className="fwm-log-today-caption fwm-data">{formatUniqueCaption(todayUnique)}</div>
      </div>
      <div className="fwm-log-bars" data-fwm-log-bars="7">
        {bars.map((bar) => (
          <div
            key={bar.dayStartMs}
            className="fwm-log-bar"
            data-fwm-log-bar-day={bar.label}
            data-fwm-log-bar-level={String(bar.level)}
            data-fwm-log-bar-rank={bar.rank}
            data-fwm-log-bar-passes={String(bar.passes)}
          />
        ))}
      </div>
      <div className="fwm-log-axis fwm-data" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar.dayStartMs}>{bar.label}</span>
        ))}
      </div>
    </section>
  );
}
