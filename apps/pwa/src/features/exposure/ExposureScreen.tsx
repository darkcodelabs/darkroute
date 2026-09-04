/**
 * EXPOSURE - the v1 replacement for LOG.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isLog` block.
 *
 * One big count, a week of bars, two summary tiles, and today's passes as a
 * list. Where v0 LOG is a table with filters, this leads with the number a
 * person came to see and puts the detail underneath.
 *
 * EVERY FIGURE IS DERIVED. The design is drawn with 37 reads, 19 cameras,
 * "+12%", "I-85 Exit 249 · 11 reads", "4 of 22 drives · 18% clean". None of
 * those are hardcoded. Anything the product cannot compute prints an em dash,
 * and the week bars are drawn from real per-day counts or not at all.
 */

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  useAlertLog,
  useAllTimePasses,
  useCachedCameras,
  useTodayPasses,
  useTodayUniqueCount,
} from '../../stores/index.ts';
import type { AlertLogEntry } from '../../stores/index.ts';
import { openIntelCard } from '../intel/IntelScreen.tsx';
import { ReloadTitle } from '../../components/nav';

import './exposure.css';

export const NO_VALUE = '—';

export const EXPOSURE_TITLE = 'Exposure';
export const EXPOSURE_UNIT = 'plate reads today';
export const EXPOSURE_TODAY = 'TODAY';
/** The heading when the range toggle is on ALL - the list is no longer today's. */
export const EXPOSURE_ALL = 'RECENT';
export const RANGE_WEEK = '7 days';
export const RANGE_ALL = 'All';

/** Said when the log is empty, which the design has no state for. */
export const EXPOSURE_EMPTY =
  'nothing recorded yet. this fills in as you drive past cameras, and it is kept on this phone ' +
  'only.';

/** Said when the log has passes but none since local midnight. */
export const EXPOSURE_NONE_TODAY =
  'no passes today. the week above counts the last seven days, and ALL lists the most recent ' +
  'whenever they happened.';

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** `08:12`, from a timestamp. The clock a pass is read against. */
function clockOf(atMs: number): string {
  const d = new Date(atMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Local midnight. The day boundary the `today` counters already roll on. */
function startOfLocalDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * WHAT TO CALL A PASS, resolved at RENDER rather than trusted from the row.
 *
 * =============================================================================
 * WHY THE ROWS WERE ALL EM DASHES
 * =============================================================================
 * `label` is snapshotted into the log at the moment the pass is recorded, by
 * `alert.ts` calling `context.labelFor`. Two consequences, and the second is
 * the one that put a dash on every row of a real drive:
 *
 *   1. Any pass recorded BEFORE `labelFor` was wired into `engineLoop.ts` has
 *      `label: null` forever. The log is durable, so those rows outlive the fix
 *      and there is no backfill - the name was never written down.
 *   2. A camera whose tile had no `street` when it was passed keeps the null
 *      even after a later sync fills the field in.
 *
 * Re-resolving here fixes both, because the archive is on the device: the same
 * `street`/`cross` pair the intel card prints is a lookup away, and ~85% of
 * records carry a street.
 *
 * =============================================================================
 * AND WHY THE TILE LOOKED FINE WHILE THE ROWS DID NOT
 * =============================================================================
 * The HOTTEST tile fell back to `entry.cameraId`; the rows fell back to the
 * placeholder. Identical null, two different answers, so the screen showed a
 * camera id in one place and a dash in another for the very same pass. One
 * function now, used by both.
 */
function passLabel(entry: AlertLogEntry, streetOf: (id: string) => string | null): string | null {
  if (entry.label !== null && entry.label !== '') return entry.label;
  if (entry.cameraId === null) return null;
  // The archive first, because a street beats an id for somebody at 45 mph.
  return streetOf(entry.cameraId) ?? entry.cameraId;
}

export function ExposureScreen(): ReactElement {
  const [allTime, setAllTime] = useState(false);
  const passesToday = useTodayPasses();
  const uniqueToday = useTodayUniqueCount();
  const allTimePasses = useAllTimePasses();
  const log = useAlertLog();
  const cameras = useCachedCameras();

  /**
   * THE WEEK, counted from the log rather than stored.
   *
   * Seven buckets by weekday. A day with no passes is a zero-height bar and
   * not a missing one: the shape of a quiet week is information.
   */
  const week = useMemo(() => {
    const now = new Date();
    const counts = new Array<number>(7).fill(0);
    const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    for (const entry of log) {
      if (entry.atMs < cutoff) continue;
      const day = new Date(entry.atMs).getDay();
      counts[day] = (counts[day] ?? 0) + 1;
    }
    const peak = Math.max(1, ...counts);
    // Ordered so today is last, which is how a week is read.
    const todayIdx = now.getDay();
    return Array.from({ length: 7 }, (_, i) => {
      const idx = (todayIdx + 1 + i) % 7;
      return {
        day: DAY_NAMES[idx] ?? '',
        count: counts[idx] ?? 0,
        height: `${String(Math.round(((counts[idx] ?? 0) / peak) * 100))}%`,
        today: idx === todayIdx,
      };
    });
  }, [log]);

  /** The archive already on the device, as a street lookup. */
  const streetOf = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of cameras) {
      const street = c.street ?? null;
      const cross = c.cross ?? null;
      const name = street !== null && cross !== null ? `${street} & ${cross}` : (street ?? cross);
      if (name !== null) byId.set(c.id, name);
    }
    return (id: string): string | null => byId.get(id) ?? null;
  }, [cameras]);

  /** The camera seen most often this week, or null when nothing repeats. */
  const hottest = useMemo(() => {
    const byCamera = new Map<string, { label: string; count: number }>();
    for (const entry of log) {
      if (entry.cameraId === null) continue;
      const found = byCamera.get(entry.cameraId);
      if (found === undefined) {
        byCamera.set(entry.cameraId, {
          label: passLabel(entry, streetOf) ?? entry.cameraId,
          count: 1,
        });
      } else found.count += 1;
    }
    let best: { id: string; label: string; count: number } | null = null;
    for (const [id, v] of byCamera) {
      if (best === null || v.count > best.count) best = { id, label: v.label, count: v.count };
    }
    return best;
  }, [log, streetOf]);

  /**
   * THE LIST, FILTERED TO THE RANGE THE HEADING CLAIMS.
   *
   * This was `[...log].reverse().slice(0, 24)` - the last 24 entries whatever
   * day they fell on - printed under a heading hardcoded to `TODAY`, directly
   * below a hero reading `0 plate reads today`. Both numbers were right and
   * they contradicted each other on screen: `today.passes` rolls over at local
   * midnight, the log does not, so the morning after a drive the screen said
   * zero and then listed ten of them.
   *
   * The range toggle at the top already says which question is being asked, so
   * it decides this too.
   */
  const passes = useMemo(() => {
    const ordered = [...log].reverse();
    if (allTime) return ordered.slice(0, 24);
    const dayStart = startOfLocalDay(Date.now());
    return ordered.filter((entry) => entry.atMs >= dayStart).slice(0, 24);
  }, [log, allTime]);
  const headline = allTime ? allTimePasses : passesToday;

  return (
    <section className="fwm-exposure" aria-label="exposure">
      <header className="fwm-exposure-header">
        <ReloadTitle title={EXPOSURE_TITLE} className="fwm-exposure-title" />
        <div className="fwm-exposure-range" role="radiogroup" aria-label="range">
          {[
            { key: 'week', label: RANGE_WEEK, on: !allTime },
            { key: 'all', label: RANGE_ALL, on: allTime },
          ].map((r) => (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={r.on}
              className="fwm-exposure-range-key fwm-data"
              data-fwm-selected={String(r.on)}
              onClick={() => {
                setAllTime(r.key === 'all');
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {/* THE HERO. One number, the size of the question being asked. */}
      <div className="fwm-exposure-hero">
        <span className="fwm-exposure-figure fwm-data">
          {headline === null ? NO_VALUE : String(headline)}
        </span>
        <span className="fwm-exposure-unit">
          {allTime ? 'plate reads, all time' : EXPOSURE_UNIT}
        </span>
        <span className="fwm-exposure-sub">
          {uniqueToday === 0 ? NO_VALUE : `${String(uniqueToday)} distinct cameras`}
        </span>

        <ul className="fwm-exposure-week" aria-label="this week">
          {week.map((d) => (
            <li className="fwm-exposure-day" key={d.day} data-fwm-today={String(d.today)}>
              <span className="fwm-exposure-bar" style={{ height: d.height }} />
              <span className="fwm-exposure-day-name fwm-data">{d.day}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="fwm-exposure-tiles">
        <div className="fwm-exposure-tile">
          <span className="fwm-exposure-tile-kicker fwm-data">HOTTEST</span>
          <span className="fwm-exposure-tile-value">{hottest?.label ?? NO_VALUE}</span>
          <span className="fwm-exposure-tile-note fwm-data">
            {hottest === null ? 'nothing repeated yet' : `${String(hottest.count)} reads`}
          </span>
        </div>
        <div className="fwm-exposure-tile">
          <span className="fwm-exposure-tile-kicker fwm-data">ALL TIME</span>
          <span className="fwm-exposure-tile-value">
            {allTimePasses === null ? NO_VALUE : String(allTimePasses)}
          </span>
          <span className="fwm-exposure-tile-note fwm-data">passes on this phone</span>
        </div>
      </div>

      <h2 className="fwm-exposure-eyebrow fwm-data">{allTime ? EXPOSURE_ALL : EXPOSURE_TODAY}</h2>

      {/* TWO EMPTY STATES, because they are two different facts.
          Filtering the list to today created a second way to be empty: a log
          with plenty in it and nothing since midnight. Printing "nothing
          recorded yet" there would have replaced the old contradiction with a
          fresh one - the week bars right above it would be showing the very
          passes the sentence denies. */}
      {passes.length === 0 ? (
        <p className="fwm-exposure-empty fwm-data">
          {log.length === 0 ? EXPOSURE_EMPTY : EXPOSURE_NONE_TODAY}
        </p>
      ) : (
        <ul className="fwm-exposure-list" aria-label="passes">
          {passes.map((entry) => (
            <li className="fwm-exposure-pass" key={entry.id}>
              <button
                type="button"
                className="fwm-exposure-pass-key"
                disabled={entry.cameraId === null}
                onClick={
                  entry.cameraId === null
                    ? undefined
                    : () => {
                        openIntelCard(entry.cameraId as string);
                      }
                }
              >
                <span className="fwm-exposure-dot" data-fwm-state={entry.state} aria-hidden="true" />
                <span className="fwm-exposure-pass-where">
                  <span className="fwm-exposure-pass-place">
                    {passLabel(entry, streetOf) ?? NO_VALUE}
                  </span>
                  <span className="fwm-exposure-pass-meta fwm-data">
                    {entry.distanceFt === null
                      ? NO_VALUE
                      : `${String(Math.round(entry.distanceFt))} ft`}
                  </span>
                </span>
                <span className="fwm-exposure-pass-time fwm-data">{clockOf(entry.atMs)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
