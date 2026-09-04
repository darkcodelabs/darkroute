/**
 * `ALERTS PER DRIVE - PROJECTED`.
 *
 * SOURCE: `Flockys Screens II.dc.html`, `B4 · ALERT TRIAGE - BY OWNER TYPE` --
 * a card with a mono 10px/.2em eyebrow, a 56px/700 numeral in the clear green,
 * and a two-line mono 11px caption baseline-aligned beside it: `down from 19`
 * over `with current filters`.
 *
 * =============================================================================
 * THE BASELINE IS THE PROOF THAT NOTHING WAS ERASED
 * =============================================================================
 * `down from 19` is not decoration. It is the unfiltered count, and it does not
 * move when a switch is flipped -- that is what makes "Muting only removes the
 * alert - never the record" checkable on the screen that says it. Both figures
 * come from `projectAlerts()`, which never reads `entry.muted`.
 *
 * =============================================================================
 * AN ABSENT PROJECTION IS AN EM DASH, NOT A ZERO
 * =============================================================================
 * With no drive on record there is nothing to divide by, and `0 ALERTS PER
 * DRIVE` would be a promise this app has not earned. The numeral prints ` - ` in
 * the muted grey and the caption says which of the two it is.
 * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn
 */

import type { ReactElement } from 'react';

import { formatProjection, projectionLines } from '../triage.ts';
import type { AlertProjection } from '../triage.ts';

export interface ProjectionCardProps {
  readonly projection: AlertProjection;
}

export function ProjectionCard({ projection }: ProjectionCardProps): ReactElement {
  const [comparison, qualifier] = projectionLines(projection);
  const known = projection.projected !== null;

  return (
    <section
      className="fwm-triage-card"
      data-fwm-triage-card="projection"
      aria-label="ALERTS PER DRIVE - PROJECTED"
    >
      <div className="fwm-triage-card-label">ALERTS PER DRIVE - PROJECTED</div>
      <div className="fwm-triage-projection">
        <div
          className="fwm-triage-projection-value fwm-data"
          data-fwm-triage-projected={known ? 'known' : 'unknown'}
          data-fwm-triage-baseline={formatProjection(projection.baseline)}
        >
          {formatProjection(projection.projected)}
        </div>
        <div className="fwm-triage-projection-caption">
          <div>{comparison}</div>
          <div>{qualifier}</div>
        </div>
      </div>
    </section>
  );
}
