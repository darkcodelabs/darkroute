/**
 * LOG / EXPOSURE, as a pure function of a view model.
 *
 * SOURCE: `Flockys App Screens.dc.html`, panel `05 · LOG - EXPOSURE`. Element
 * order is the panel's order: header, `FLOCKED TODAY` card with the seven-day
 * trend, the `HOTTEST SEGMENT` / `ALL TIME` pair, the `TIMELINE` label, the
 * rows, and the `HEAT MAP` / `ZONE AUDIT` keys at the bottom.
 *
 * The REPORT bar and the five dock word-keys the panel also draws are NOT here:
 * they are shell chrome (`app/App.tsx` + `components/dock`), rendered on every
 * screen, and drawing a second copy would put two docks on the page.
 *
 * This component reads no store, calls no browser API and takes no clock. It is
 * the seam the state tests render against.
 */

import type { ReactElement } from 'react';

import type { AlertOutcome } from '../../../stores';
import type { DayBar, HotSegment, LogScope } from '../exposure.ts';

import { ExposureCard } from './ExposureCard.tsx';
import { ExposureStats } from './ExposureStats.tsx';
import { LogActions } from './LogActions.tsx';
import { LogHeader } from './LogHeader.tsx';
import { Timeline } from './Timeline.tsx';
import type { LogRow } from './Timeline.tsx';

export interface LogViewModel {
  readonly scope: LogScope;
  /** Camera passes today, counted off today's rows. Muted passes included. */
  readonly todayPasses: number;
  readonly todayUnique: number;
  readonly bars: readonly DayBar[];
  /** The hottest place name in scope, or null when nothing in scope has one. */
  readonly segment: HotSegment | null;
  /** Null until the durable count is loaded. Not zero. */
  readonly allTimePasses: number | null;
  readonly allTimeSinceMs: number | null;
  /** One row per encounter in scope -- approaching-only encounters included. */
  readonly rows: readonly LogRow[];
  /** Whether a trip is open. Decides what the TRIP scope says when it is empty. */
  readonly tripOpen: boolean;
}

export interface LogViewHandlers {
  readonly onScope?: ((scope: LogScope) => void) | undefined;
  readonly onOutcome?: ((id: number, outcome: AlertOutcome) => void) | undefined;
  readonly onHeatMap?: (() => void) | undefined;
  readonly onZoneAudit?: (() => void) | undefined;
}

export type LogViewProps = LogViewHandlers & {
  readonly model: LogViewModel;
};

/**
 * What an empty TIMELINE says.
 *
 * The design never draws one. Each string names the window that came up empty
 * rather than inventing a row, because "no cameras read you on this drive" is a
 * genuinely good outcome and hiding it behind a fake row would be a lie in the
 * driver's favour and a lie all the same.
 * GAP: see DESIGN-GAPS.md#empty-and-loading-states-mostly-undrawn
 */
export function emptyTimelineMessage(scope: LogScope, tripOpen: boolean): string {
  if (scope === 'all-time') return 'NO CAMERAS RECORDED';
  return tripOpen ? 'NO CAMERAS THIS TRIP' : 'NO TRIP IN PROGRESS';
}

export function LogView({
  model,
  onScope,
  onOutcome,
  onHeatMap,
  onZoneAudit,
}: LogViewProps): ReactElement {
  return (
    <section className="fwm-log" data-fwm-log-scope={model.scope}>
      <LogHeader scope={model.scope} onScope={onScope} />
      <div className="fwm-log-body">
        <ExposureCard
          todayPasses={model.todayPasses}
          todayUnique={model.todayUnique}
          bars={model.bars}
        />
        <ExposureStats
          segment={model.segment}
          allTimePasses={model.allTimePasses}
          allTimeSinceMs={model.allTimeSinceMs}
        />
        <div className="fwm-log-section-label">TIMELINE</div>
        <Timeline
          rows={model.rows}
          emptyMessage={emptyTimelineMessage(model.scope, model.tripOpen)}
          onOutcome={onOutcome}
        />
        <LogActions onHeatMap={onHeatMap} onZoneAudit={onZoneAudit} />
      </div>
    </section>
  );
}
