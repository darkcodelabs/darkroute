/**
 * LOG's public surface.
 *
 * `src/app/App.tsx` takes a screen registry; this feature's entry in it is
 * {@link LogScreen}, which is usable with no props. The rest is exported for
 * tests and for the screens that share EXPOSURE's vocabulary -- ZONE AUDIT
 * counts the same passes over a zone, and the watch face `W5 · TODAY -
 * EXPOSURE GLANCE` draws the same seven-day trend.
 *
 * Nothing here reads a store, prompts for a permission or touches a browser API
 * on import.
 */

export { LogScreen } from './LogScreen.tsx';
export type { LogScreenProps } from './LogScreen.tsx';

export { LogView, emptyTimelineMessage } from './components/LogView.tsx';
export type { LogViewHandlers, LogViewModel, LogViewProps } from './components/LogView.tsx';

export { ExposureCard } from './components/ExposureCard.tsx';
export type { ExposureCardProps } from './components/ExposureCard.tsx';
export { ExposureStats } from './components/ExposureStats.tsx';
export type { ExposureStatsProps } from './components/ExposureStats.tsx';
export { LogActions } from './components/LogActions.tsx';
export type { LogActionsProps } from './components/LogActions.tsx';
export { LogHeader } from './components/LogHeader.tsx';
export type { LogHeaderProps } from './components/LogHeader.tsx';
export { Timeline } from './components/Timeline.tsx';
export type { LogRow, TimelineProps } from './components/Timeline.tsx';

export {
  BAR_LEVELS,
  DAY_LABELS,
  DEFAULT_LOG_SCOPE,
  LOG_SCOPES,
  SCOPE_LABELS,
  TREND_DAYS,
  addDays,
  alertSeverity,
  barLevel,
  barRank,
  cameraEncounters,
  cameraPasses,
  dayLabel,
  formatClock,
  formatExposureTotal,
  formatRowMeta,
  formatRowName,
  formatSegmentDetail,
  formatSince,
  formatUniqueCaption,
  hottestSegment,
  isCameraPass,
  isEncounterState,
  isLogScope,
  localDayStart,
  openingLogScope,
  scopedEntries,
  sevenDayBars,
  todayExposure,
} from './exposure.ts';
export type { BarRank, DayBar, HotSegment, LogScope, TodayExposure } from './exposure.ts';

export { readAllTimeExposure, resolveAllTime } from './allTimeExposure.ts';
export type {
  AllTimeExposurePort,
  AllTimeExposureRead,
  AllTimeFigure,
} from './allTimeExposure.ts';
