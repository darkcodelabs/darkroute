/**
 * LOG / EXPOSURE -- the receipt.
 *
 * =============================================================================
 * THIS FILE IS WIRING. IT IS NOT A MOCK, AND IT IS NOT A CALCULATOR.
 * =============================================================================
 * Every number below is a count of rows the alert slice already wrote, or the
 * durable trip record read back off IndexedDB. Nothing is invented and nothing
 * is a sample. Like `RadarScreen.tsx`, this file:
 *
 *   - prompts for nothing. No `navigator.geolocation`, no notification, no
 *     permission. The platform calls in this subtree are `Date.now()`,
 *     injectable through the `now` prop and used only to decide which local day
 *     is "today", and ONE read-only IndexedDB open behind the `allTimePort`
 *     prop, which loads the `ALL TIME` figure the design draws as `1,284`.
 *     GAP: see docs/gaps-inbox/log.md#nothing-hydrates-the-durable-counters
 *   - does no geospatial arithmetic. Distances arrive already measured, and the
 *     one length the design draws that nothing measured -- the hottest
 *     segment's `1.2 MI` -- prints an em dash.
 *   - renders no row it was not given. An empty window says it is empty; there
 *     is no seeded history and no sample drive anywhere in this feature.
 *
 * =============================================================================
 * MUTED CAMERAS COUNT HERE. THAT IS THE WHOLE POINT OF THIS SCREEN.
 * =============================================================================
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *    count in EXPOSURE, still log to LOOKUP. Muting only removes the alert -
 *    never the record."
 *      -- Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 * `useAlertLog()` is the whole log and it reaches the view intact. The word
 * `muted` is read in exactly two places in this feature -- here, to carry it
 * onto the row as data, and in `Timeline.tsx`, to write it into a data
 * attribute a test reads -- and in neither is it a condition. No predicate in
 * `exposure.ts` looks at it and no rule in `log.css` selects on it.
 *
 * =============================================================================
 * PRIVACY
 * =============================================================================
 * No plate is read, rendered, logged or navigated to. The rows carry a camera's
 * place name, a clock time, a speed and a distance, and the record they come
 * from has no coordinates in it by design. `CONF` / `DISM` write one enum into
 * the local history slice; nothing here uploads anything. The two footer keys
 * write a screen id -- and only a screen id -- to the one navigation model.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  historyActions,
  navigationActions,
  useAlertLog,
  useAllTimePasses,
  useCurrentTrip,
  useHistoryStore,
} from '../../stores';
import type { AlertOutcome } from '../../stores';

import { readAllTimeExposure, resolveAllTime } from './allTimeExposure.ts';
import type { AllTimeExposurePort, AllTimeExposureRead } from './allTimeExposure.ts';
import { LogView } from './components/LogView.tsx';
import type { LogViewHandlers, LogViewModel } from './components/LogView.tsx';
import type { LogRow } from './components/Timeline.tsx';
import {
  cameraEncounters,
  formatRowMeta,
  formatRowName,
  hottestSegment,
  localDayStart,
  openingLogScope,
  scopedEntries,
  sevenDayBars,
  todayExposure,
} from './exposure.ts';
import type { LogScope } from './exposure.ts';

import './log.css';

export type LogScreenProps = LogViewHandlers & {
  /** Injectable clock. Used once, to decide which local day is "today". */
  readonly now?: (() => number) | undefined;
  /**
   * The durable `ALL TIME` read. Injected so a test never opens a database,
   * exactly as `OfflineScreen` injects its cache port.
   */
  readonly allTimePort?: AllTimeExposurePort | undefined;
};

export function LogScreen({
  now = Date.now,
  allTimePort = readAllTimeExposure,
  onScope,
  onOutcome,
  onHeatMap,
  onZoneAudit,
}: LogScreenProps = {}): ReactElement {
  // --- the record ----------------------------------------------------------
  const entries = useAlertLog();
  const trip = useCurrentTrip();
  const storeAllTimePasses = useAllTimePasses();
  // The history slice publishes no selector for this one field. Reading the
  // store directly is the workaround: adding a selector would mean editing a
  // shared file that other screens are being built against right now.
  // GAP: see docs/gaps-inbox/log.md#no-selector-for-all-time-since
  const storeAllTimeSinceMs = useHistoryStore((state) => state.allTimeSinceMs);

  // --- the durable ALL TIME figure -----------------------------------------
  // One read-only open, once per mount, off the trips store the spec names for
  // this card. It never writes, and a browser with no IndexedDB (or a failed
  // open) leaves the card on its em dash rather than on a made-up number.
  const [durable, setDurable] = useState<AllTimeExposureRead | null>(null);
  useEffect(() => {
    let live = true;
    void allTimePort().then((read) => {
      // Only a FIGURE moves this screen. A read that came back unavailable --
      // no IndexedDB, no trip ever recorded, a failed open -- leaves the card
      // on the em dash it is already showing, so it is not worth a render, and
      // a stale figure is never cleared by a later failed read.
      if (live && read.status === 'ready') setDurable(read);
    });
    return () => {
      live = false;
    };
  }, [allTimePort]);
  const allTime = resolveAllTime(storeAllTimePasses, storeAllTimeSinceMs, durable);
  const allTimePasses = allTime.passes;
  const allTimeSinceMs = allTime.sinceMs;

  // --- the toggle ----------------------------------------------------------
  // Local, not in the URL: `?screen=log` is the only thing this screen is
  // allowed to write there, and a scope is not a destination.
  //
  // The design draws TRIP filled, and that is what this opens on WHEN THERE IS
  // A TRIP. Nothing in this build starts one, and opening on a scope that is
  // structurally empty would blank four of the panel's five data surfaces on a
  // device with a full log.
  // GAP: see docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner
  const [scope, setScope] = useState<LogScope>(() => openingLogScope(trip !== null));

  // The day boundary, not the instant. Memoising on `now()` itself would
  // recompute the whole week on every render; memoising on the local midnight
  // recomputes it exactly when the day rolls over.
  const dayStartMs = localDayStart(now());

  // The seven-day trend is the WHOLE log, never the scoped slice: it is a
  // trend, and a trend that only ever showed the current trip would be one bar.
  const bars = useMemo(() => sevenDayBars(entries, dayStartMs), [entries, dayStartMs]);

  // TODAY IS COUNTED OFF THE ROWS, not off `history.today.passes`: that counter
  // is only ever zeroed by `historyActions.rollDay()`, which nothing in this
  // build calls, so it holds passes since the store was created rather than
  // passes today -- and would disagree with the seven bars drawn beside it the
  // moment a drive crossed midnight or the log was cleared.
  // GAP: see docs/gaps-inbox/log.md#nothing-rolls-the-day-over
  const today = useMemo(() => todayExposure(entries, dayStartMs), [entries, dayStartMs]);

  const inScope = useMemo(() => scopedEntries(entries, scope, trip), [entries, scope, trip]);
  const segment = useMemo(() => hottestSegment(inScope), [inScope]);
  const rows = useMemo<readonly LogRow[]>(
    () =>
      cameraEncounters(inScope).map((entry) => ({
        id: entry.id,
        name: formatRowName(entry),
        meta: formatRowMeta(entry),
        state: entry.state,
        outcome: entry.outcome,
        // Carried, never applied. See the header.
        muted: entry.muted,
      })),
    [inScope],
  );

  const model: LogViewModel = useMemo(
    () => ({
      scope,
      todayPasses: today.passes,
      todayUnique: today.uniqueCameras,
      bars,
      segment,
      allTimePasses,
      allTimeSinceMs,
      rows,
      tripOpen: trip !== null,
    }),
    [scope, today, bars, segment, allTimePasses, allTimeSinceMs, rows, trip],
  );

  return (
    <LogView
      model={model}
      onScope={onScope ?? setScope}
      onOutcome={onOutcome ?? recordOutcome}
      onHeatMap={onHeatMap ?? openHeatMap}
      onZoneAudit={onZoneAudit ?? openZoneAudit}
    />
  );
}

/** One enum, into the local history slice. No network, no URL, no analytics. */
function recordOutcome(id: number, outcome: AlertOutcome): void {
  historyActions.setOutcome(id, outcome);
}

/** The one navigation model. A screen id reaches the URL; nothing else does. */
function openHeatMap(): void {
  navigationActions.openScreen('heat-map');
}

function openZoneAudit(): void {
  navigationActions.openScreen('zone-audit');
}
