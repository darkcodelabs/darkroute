/**
 * `POSITION · AUTO` - where the driver is, to four decimals.
 *
 * SOURCE: v2 `06 · REPORT`. An edgeless `--fwm-surface-card` card at 6px
 * radius: a 10px mono label, the coordinate pair at 17px/700, and the
 * instrument line under it in the clear-green hue (`±4 M · 9 SATS · Reading
 * Rd`). v1 drew a 1px edge around `--fwm-surface-1`; v2 dropped the edge and
 * lifted the fill.
 *
 * AUTO MEANS AUTO. There is no way to type a position on this sheet and there
 * is no map to drag a pin on: the coordinates are the fix the app already has.
 * With no fix the card says `NO FIX` and the submit is blocked - a report with
 * invented coordinates is worse than no report.
 */

import type { ReactElement } from 'react';

import { NO_FIX_DETAIL, POSITION_LABEL } from '../reportDraft.ts';

export interface PositionCardProps {
  /** `39.0997 N · 84.5786 W`, or the em dash when there is no fix. */
  readonly coordinates: string;
  /** `±4 M · 9 SATS`, or null when the platform reports neither. */
  readonly detail: string | null;
  readonly hasFix: boolean;
}

export function PositionCard({ coordinates, detail, hasFix }: PositionCardProps): ReactElement {
  return (
    <section
      className="fwm-report-position"
      data-fwm-report-position={hasFix ? 'fix' : 'no-fix'}
      aria-label="position"
    >
      <h2 className="fwm-report-label">{POSITION_LABEL}</h2>
      <p className="fwm-report-coords fwm-data">{coordinates}</p>
      {hasFix && detail === null ? null : (
        <p className="fwm-report-detail fwm-data" data-fwm-report-detail={hasFix ? 'fix' : 'no-fix'}>
          {hasFix ? detail : NO_FIX_DETAIL}
        </p>
      )}
    </section>
  );
}
