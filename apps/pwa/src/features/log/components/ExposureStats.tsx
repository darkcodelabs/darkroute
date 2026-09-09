/**
 * `HOTTEST SEGMENT` and `ALL TIME` -- the two cards under the trend.
 *
 * SOURCE: `Flockys App Screens.dc.html`, `05 · LOG - EXPOSURE` -- a 1fr 1fr
 * grid: `HOTTEST SEGMENT` / `Reading Rd` / `5 CAMS / 1.2 MI`, and `ALL TIME` /
 * `1,284` / `SINCE MAR 2026`.
 *
 * TWO HONEST ABSENCES
 *   - the segment's LENGTH. Nothing in this app measures one: an alert row
 *     carries no coordinates on purpose, so `1.2 MI` renders as an em dash
 *     rather than as a plausible number.
 *     GAP: see docs/gaps-inbox/log.md#hottest-segment-length-is-not-measured
 *   - the all-time TOTAL before IndexedDB has answered. `null` is "not loaded",
 *     which is not zero, and it prints an em dash until the durable count lands.
 */

import type { ReactElement } from 'react';

import { NO_VALUE } from '../../radar';
import { formatExposureTotal, formatSegmentDetail, formatSince } from '../exposure.ts';
import type { HotSegment } from '../exposure.ts';

export interface ExposureStatsProps {
  /** Null when nothing in scope carries a place name. */
  readonly segment: HotSegment | null;
  /** Null until the durable all-time count is loaded. Not zero. */
  readonly allTimePasses: number | null;
  readonly allTimeSinceMs: number | null;
}

export function ExposureStats({
  segment,
  allTimePasses,
  allTimeSinceMs,
}: ExposureStatsProps): ReactElement {
  return (
    <div className="fwm-log-stats">
      <section className="fwm-log-card" data-fwm-log-stat="HOTTEST SEGMENT">
        <div className="fwm-log-card-label">HOTTEST SEGMENT</div>
        <div className="fwm-log-stat-value" data-fwm-log-segment-name="true">
          {segment === null ? NO_VALUE : segment.name}
        </div>
        <div className="fwm-log-stat-detail fwm-data">
          {segment === null ? NO_VALUE : formatSegmentDetail(segment.cameraCount)}
        </div>
      </section>
      <section className="fwm-log-card" data-fwm-log-stat="ALL TIME">
        <div className="fwm-log-card-label">ALL TIME</div>
        <div className="fwm-log-stat-value" data-fwm-log-alltime="true">
          {formatExposureTotal(allTimePasses)}
        </div>
        <div className="fwm-log-stat-detail fwm-data">{formatSince(allTimeSinceMs)}</div>
      </section>
    </div>
  );
}
