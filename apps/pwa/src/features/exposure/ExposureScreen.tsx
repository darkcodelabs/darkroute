/**
 * EXPOSURE - two states, and the empty one is a sentence.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section C, frames 3 and 4.
 *
 * =============================================================================
 * A ZERO IS A NUMBER; NO DATA IS A SENTENCE
 * =============================================================================
 * Brief 4 names the defect: "the current build shows a 46 px `0`, five
 * em-dashes and 300 px of nothing". That is not an empty state, it is the
 * populated state with every value missing, and it says something false - a
 * driver who has never opened the map is told they were read zero times, which
 * is a measurement the app never took.
 *
 * So there are two layouts here rather than one layout with holes in it. The
 * populated one leads with the count. The empty one leads with `Nothing
 * recorded yet`, says in a paragraph what will fill it and that it stays on the
 * phone, draws the week as a FLAT 3px baseline so the axis is legible without
 * pretending to be a reading, and offers exactly one action.
 *
 * =============================================================================
 * EVERY FIGURE ON THIS SCREEN NOW COMES FROM ONE FUNCTION
 * =============================================================================
 * `services/history/passSummary.ts` computes the all-time total, the seven-day
 * buckets, HOTTEST and the recent list together, from one array, and it has
 * been sitting in the tree without a caller since the monitor card dropped its
 * second page. This screen had its own private copies of three of the four.
 *
 * ADOPTING IT IS A CORRECTNESS FIX AND NOT ONLY A TIDY-UP, and this is the one
 * paragraph to read if you read nothing else here. This screen's own `week`
 * memo counted RAW LOG ROWS. The log is a stream of state CHANGES, so one drive
 * past one camera writes `clear -> approaching`, `approaching -> in_range` and
 * `in_range -> clear` - three rows for one pass. Every bar on the chart, and
 * the HOTTEST tile's count, were therefore inflated by up to 3x, and they
 * disagreed with the hero figure directly above them, which comes from
 * `history.today.passes` and counts the EDGE. `passSummary.isPass` is that same
 * edge - a non-alerting state becoming an alerting one, about a camera - so the
 * chart and the number over it now count the same thing.
 *
 * BEING NEAR A CAMERA IS NOT BEING FLOCKED: an encounter that only ever reached
 * `approaching` never read a plate and is in no count on this screen.
 *
 * =============================================================================
 * WHAT IS NOT DRAWN, AND WHY
 * =============================================================================
 * THE SPEC'S SECOND COMPARISON CLAUSE. Its line reads `31 this week · 9 above
 * your average`. The week total is a sum of the buckets and is drawn. THE
 * AVERAGE IS NOT DERIVABLE: `stores/history.ts` keeps `today`, `allTimePasses`,
 * the trip in progress and a capped entry list - there is no baseline, no
 * per-day history beyond the rolling seven, and no definition anywhere of
 * whether "your average" means the mean of the last seven days, of every day
 * with a pass in it, or of a thirty-day window the log cannot reach. Any answer
 * invents a statistic and prints it at 13px beside two real ones. The clause is
 * left out and the question is in the handover.
 *
 * THE SPEC'S CLOSING NOTE on the empty frame - "Compare with the current build:
 * a 46 px 0, five em-dashes and 300 px of nothing" - is a spec annotation
 * addressed to a reviewer about a build the driver has never seen, in the same
 * class as the dashed dock-reserve track. Not shipped.
 */

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  useAlertLog,
  useAllTimePasses,
  useCachedCameras,
  useTodayPasses,
} from '../../stores/index.ts';
import {
  localDayStart,
  summarizePasses,
} from '../../services/history/passSummary.ts';
import type { CameraFacts, DayBucket, RecentPass } from '../../services/history/passSummary.ts';
import { openScreen } from '../../app/screenState.ts';
import { openIntelCard } from '../intel/IntelScreen.tsx';
import { ReloadTitle } from '../../components/nav';
import { ScreenChevron, ScreenPlane } from '../../components/screen';

import '../../styles/screen.css';
import './exposure.css';

/**
 * The absence, and it appears in exactly ONE place now.
 *
 * It used to be five: the hero, the distinct-camera line, both stat tiles and
 * every row's place name. Four of those five were the empty state wearing the
 * populated layout, and they are gone with it. What is left is a stat card's
 * value when the DURABLE count has not come back from IndexedDB yet - a real
 * "not known", lasting a second or two on a cold start, on a screen that is
 * otherwise full of real numbers. `stores/history.ts` is explicit that null is
 * not zero and only the store may end the absence.
 */
export const NO_VALUE = '—';

/** Under a pass whose camera record the phone no longer holds. */
export const NOT_ON_PHONE = 'record not on this phone';

export const EXPOSURE_TITLE = 'Exposure';
export const EXPOSURE_UNIT = 'plate reads today';
export const EXPOSURE_UNIT_ALL = 'plate reads, all time';
export const EXPOSURE_TODAY = 'TODAY';
/** The heading when the range toggle is on ALL - the list is no longer today's. */
export const EXPOSURE_ALL = 'RECENT';
export const RANGE_WEEK = '7 days';
export const RANGE_ALL = 'All';

export const HOTTEST_KICKER = 'HOTTEST';
export const ALL_TIME_KICKER = 'ALL TIME';
export const ALL_TIME_NOTE = 'on this phone';

/** Said on the HOTTEST card when the leader has been passed exactly once. */
export const NOTHING_REPEATED = 'nothing repeated yet';

/* -------------------------------------------------------------------------
 * THE EMPTY STATE, in full, because it is the half of this screen brief 4 is
 * actually about.
 * ---------------------------------------------------------------------- */

export const EMPTY_TITLE = 'Nothing recorded yet';
export const EMPTY_BODY =
  'This fills in as you drive past cameras. It is kept on this phone only — no account, ' +
  'nothing uploaded, and it is yours to wipe.';
export const EMPTY_ACTION = 'Open the map';
export const EMPTY_LEARN = 'What it records';
export const EMPTY_LEARN_META = 'and what it never does';

/** Said when the log has passes but none since local midnight. */
export const EXPOSURE_NONE_TODAY =
  'No passes today. The week above counts the last seven days, and All lists the most recent ' +
  'whenever they happened.';

/**
 * How many rows the RECENT list draws.
 *
 * Carried over from the previous build unchanged, and it is a real limit rather
 * than a design number: ALL is "the most recent, whenever they happened", the
 * log is durable, and a driver with a year of history would otherwise mount a
 * list of every pass they have ever made inside a band that scrolls.
 *
 * TODAY is NOT capped by it - see `rows` below. A day's passes are bounded by
 * the day, and truncating them would make the list disagree with the figure at
 * the top of the same screen, which is the exact defect this screen was last
 * fixed for.
 */
export const RECENT_LIMIT = 24;

/** The three tiers the spec colours its bars in. */
export type BarTier = 'high' | 'mid' | 'low';

/**
 * `count >= 8` amber, `>= 5` cyan, below that dim cyan - the spec's own
 * expression, lifted rather than re-derived.
 *
 * ABSOLUTE, NOT RELATIVE TO THE WEEK'S PEAK. A quiet week does not promote its
 * busiest day to amber: eight passes is eight passes, and a colour that means
 * "a lot for you lately" would change what amber means from one week to the
 * next on the one screen whose subject is how much you are being read.
 */
export function barTier(count: number): BarTier {
  if (count >= 8) return 'high';
  if (count >= 5) return 'mid';
  return 'low';
}

/**
 * The bar's height, as a percentage of the 46px track the stylesheet draws.
 *
 * The spec writes `Math.max(3, Math.round(count / peak * 46)) + 'px'`. That
 * pixel cannot be written here - the design gate rejects a raw length in a
 * style object as hard as a raw hex - and it should not be: 46 is the track,
 * which is geometry, and geometry lives in the stylesheet. So the track is
 * 46px there and this is the fraction of it, which is the same number one
 * indirection later. The 3px floor is `min-height` on the bar, for the same
 * reason: a zero-count day must still draw a mark, because the shape of a
 * quiet week is itself the information.
 *
 * `peak` is the week's own maximum with a floor of 1, so a week of nothing
 * divides by one rather than by zero.
 */
export function barPercent(count: number, peak: number): string {
  return `${String(Math.round((count / Math.max(1, peak)) * 100))}%`;
}

/** `4:12 PM`, in whatever shape the device writes a clock. */
function clockOf(atMs: number): string {
  /*
   * The spec writes `4:12 pm`, which is one locale's answer. `toLocaleTimeString`
   * is every locale's - it prints 16:12 on a 24-hour phone, which is what that
   * driver's car clock says. Hardcoding the spec's form would make the one
   * column on this screen that a driver checks against a clock disagree with
   * their clock.
   */
  return new Date(atMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ExposureScreen(): ReactElement {
  const [allTime, setAllTime] = useState(false);
  const passesToday = useTodayPasses();
  const allTimePasses = useAllTimePasses();
  const log = useAlertLog();
  const cameras = useCachedCameras();

  /**
   * THE ARCHIVE ALREADY ON THE DEVICE, as the lookup `summarizePasses` takes.
   *
   * INJECTED RATHER THAN IMPORTED, which is that service's own rule: the place
   * name and the operator live on the CAMERA record and not on the log row, and
   * a service that reached into the cameras store could not be rendered in a
   * test. The card holds the records; it hands a reader in.
   *
   * Returning null is normal, not exceptional: tiles are evicted, and the record
   * for a camera passed three days ago may simply not be in memory now. The
   * row's own snapshotted `label` is what answers then.
   */
  const lookup = useMemo(() => {
    const byId = new Map<string, CameraFacts>();
    for (const camera of cameras) {
      const street = camera.street ?? null;
      const cross = camera.cross ?? null;
      const label = street !== null && cross !== null ? `${street} & ${cross}` : (street ?? cross);
      const operator = camera.tags?.['operator'];
      /* THE MAKER STANDS IN FOR AN OPERATOR NOBODY RECORDED. 17% of records
         name who runs the camera; 95% name who built it, and "Flock Safety"
         is a truer second line than a blank. */
      const maker = camera.tags?.['manufacturer'];
      byId.set(camera.id, {
        label: label ?? '',
        operator:
          typeof operator === 'string' && operator !== ''
            ? operator
            : typeof maker === 'string'
              ? maker
              : '',
        ...(camera.locality === undefined ? {} : { where: camera.locality }),
      });
    }
    return (cameraId: string): CameraFacts | null => byId.get(cameraId) ?? null;
  }, [cameras]);

  /** Whose hardware it was, for the mark at the head of a row. */
  const ownerOf = useMemo(() => {
    const byId = new Map<string, string>();
    for (const camera of cameras) {
      if (camera.ownerType !== undefined) byId.set(camera.id, camera.ownerType);
    }
    return (cameraId: string): string => byId.get(cameraId) ?? 'unknown';
  }, [cameras]);

  /**
   * EVERY FIGURE, FROM ONE CALL. See the header for why this replaced three
   * private memos and what those three were counting instead.
   *
   * `Date.now()` is read on every render rather than held in state: this screen
   * has no clock of its own, and a stale `nowMs` would put a pass made at
   * 23:59 in yesterday's bucket for as long as the screen stayed mounted.
   */
  const summary = useMemo(
    () =>
      summarizePasses({
        entries: log,
        nowMs: Date.now(),
        allTimePasses,
        lookup,
        // Bounded by the log the store already caps, so nothing is silently
        // dropped from TODAY; the visible list is sliced below, by range.
        limit: log.length,
      }),
    [log, allTimePasses, lookup],
  );

  const week: readonly DayBucket[] = summary.byDay;
  const peak = week.reduce((high, day) => Math.max(high, day.count), 0);
  const weekTotal = week.reduce((sum, day) => sum + day.count, 0);

  /**
   * THE LIST, FILTERED TO THE RANGE THE HEADING CLAIMS.
   *
   * The heading and the list are one decision: `today.passes` rolls over at
   * local midnight and the log does not, so a list of "the last N whatever day
   * they fell on" under a heading hardcoded to TODAY, below a hero reading
   * `0 plate reads today`, was two right numbers contradicting each other on
   * screen. The range toggle says which question is being asked, so it decides
   * both.
   */
  const rows: readonly RecentPass[] = useMemo(() => {
    if (allTime) return summary.recent.slice(0, RECENT_LIMIT);
    const dayStart = localDayStart(Date.now());
    return summary.recent.filter((row) => row.atMs >= dayStart);
  }, [summary.recent, allTime]);

  /**
   * NOTHING HAS EVER BEEN RECORDED, which is not the same as nothing today.
   *
   * Both halves are needed. The in-memory log alone would show `Nothing
   * recorded yet` to a driver with two hundred durable passes in the second
   * before `hydrate()` lands - telling somebody with a year of history that
   * they have never been read is the worst version of this screen being wrong.
   * The durable count alone cannot see a first pass that has not been written
   * out yet. Empty is when neither knows of anything.
   */
  const nothingEver = log.length === 0 && (allTimePasses ?? 0) === 0;

  const headline = allTime ? allTimePasses : passesToday;

  return (
    <section className="fwm-screen fwm-exposure" aria-label="exposure">
      {/* No back key: EXPOSURE is a dock root. See `MoreScreen.tsx` for the
          whole argument, and for why the spec's 40px exit is not drawn. */}
      <div className="fwm-screen-title">
        <ReloadTitle title={EXPOSURE_TITLE} className="fwm-screen-title-text" />
        {/* A SEGMENTED RANGE, not a dropdown: two options that are always both
            worth seeing, and switching is one tap rather than two. It is the
            spec's own smaller control - 24px keys in a 15-radius shell - rather
            than section C's 36-in-44, because it rides inside the 56px title
            track and a 44px shell would fill it. */}
        <div className="fwm-exposure-range" role="radiogroup" aria-label="range">
          {[
            { key: 'week', label: RANGE_WEEK, on: !allTime },
            { key: 'all', label: RANGE_ALL, on: allTime },
          ].map((range) => (
            <button
              key={range.key}
              type="button"
              role="radio"
              aria-checked={range.on}
              className="fwm-exposure-range-key"
              data-fwm-selected={String(range.on)}
              onClick={() => {
                setAllTime(range.key === 'all');
              }}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fwm-screen-band fwm-screen-stack fwm-exposure-band">
        {nothingEver ? (
          <>
            <div className="fwm-screen-card fwm-exposure-empty">
              <h2 className="fwm-exposure-empty-title">{EMPTY_TITLE}</h2>
              <p className="fwm-exposure-empty-body">{EMPTY_BODY}</p>

              {/* THE AXIS WITHOUT A READING. Seven flat 3px rules under the
                  seven day names: it says what the chart will be and does not
                  pretend to be one. A bar chart of zeros is a chart claiming
                  seven measurements that were never taken. */}
              <ul className="fwm-exposure-week fwm-exposure-week-flat" aria-label="this week">
                {week.map((day) => (
                  <li className="fwm-exposure-day" key={day.dayStartMs}>
                    <span className="fwm-exposure-track" aria-hidden="true">
                      <span className="fwm-exposure-bar" data-fwm-tier="flat" />
                    </span>
                    <span className="fwm-exposure-day-name fwm-data">{day.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* ONE ACTION. The screen fills because the driver drives, so the
                only useful key is the one that starts that. */}
            <button
              type="button"
              className="fwm-screen-row fwm-exposure-go"
              onClick={() => {
                openScreen('radar');
              }}
            >
              <ScreenPlane />
              <span className="fwm-exposure-go-label">{EMPTY_ACTION}</span>
            </button>

            <button
              type="button"
              className="fwm-screen-row"
              onClick={() => {
                openScreen('help');
              }}
            >
              <span className="fwm-screen-row-title">{EMPTY_LEARN}</span>
              <span className="fwm-screen-row-meta fwm-data">{EMPTY_LEARN_META}</span>
              <ScreenChevron />
            </button>
          </>
        ) : (
          <>
            {/* THE HERO. One number, the size of the question being asked. */}
            <div className="fwm-screen-card fwm-exposure-hero">
              <p className="fwm-exposure-figure-line">
                <span className="fwm-exposure-figure fwm-data">
                  {headline === null ? NO_VALUE : String(headline)}
                </span>
                <span className="fwm-exposure-unit">
                  {allTime ? EXPOSURE_UNIT_ALL : EXPOSURE_UNIT}
                </span>
              </p>
              {/* The week total, and only the week total. The spec's second
                  clause names an average this app has no baseline for; see the
                  file header. */}
              <p className="fwm-exposure-compare fwm-data">
                {`${String(weekTotal)} this week`}
              </p>

              <ul className="fwm-exposure-week" aria-label="this week">
                {week.map((day) => (
                  <li className="fwm-exposure-day" key={day.dayStartMs}>
                    <span className="fwm-exposure-track" aria-hidden="true">
                      <span
                        className="fwm-exposure-bar"
                        data-fwm-tier={barTier(day.count)}
                        style={{ height: barPercent(day.count, peak) }}
                      />
                    </span>
                    {/* TODAY IS THE LAST BUCKET and it is the one drawn in the
                        body tier rather than the faint one - it is the bar the
                        driver is adding to right now. */}
                    <span
                      className="fwm-exposure-day-name fwm-data"
                      data-fwm-today={String(day === week[week.length - 1])}
                    >
                      {day.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="fwm-exposure-tiles">
              <div className="fwm-exposure-tile">
                <span className="fwm-exposure-tile-kicker" data-fwm-hue="amber">
                  {HOTTEST_KICKER}
                </span>
                <span className="fwm-exposure-tile-value">
                  {summary.hottest?.label ?? NO_VALUE}
                </span>
                <span className="fwm-exposure-tile-note fwm-data">
                  {/* `repeated: false` means the leader has been passed once,
                      which means EVERY camera has: there is a busiest row but
                      no pattern, and crowning a camera on one pass would be the
                      screen finding meaning it has not got. */}
                  {summary.hottest === null || !summary.hottest.repeated
                    ? NOTHING_REPEATED
                    : `${String(summary.hottest.count)} passes`}
                </span>
              </div>
              <div className="fwm-exposure-tile">
                <span className="fwm-exposure-tile-kicker" data-fwm-hue="cyan">
                  {ALL_TIME_KICKER}
                </span>
                <span className="fwm-exposure-tile-value fwm-data">
                  {/* NEVER LESS THAN THE WEEK, AND NEVER A DASH beside "29
                      this week". The durable counter is null until a trip has
                      written it, which on a phone that has only ever logged
                      alerts is forever; the week's own passes are a floor the
                      all-time figure cannot honestly sit below. */}
                  {summary.allTimePasses === null && weekTotal === 0
                    ? NO_VALUE
                    : String(Math.max(summary.allTimePasses ?? 0, weekTotal))}
                </span>
                <span className="fwm-exposure-tile-note fwm-data">{ALL_TIME_NOTE}</span>
              </div>
            </div>

            <div className="fwm-screen-group fwm-exposure-eyebrow">
              <h2 className="fwm-screen-group-label">
                {allTime ? EXPOSURE_ALL : EXPOSURE_TODAY}
              </h2>
            </div>

            {rows.length === 0 ? (
              /* A LOG WITH PLENTY IN IT AND NOTHING SINCE MIDNIGHT. Printing
                 "nothing recorded yet" here would put the empty state directly
                 under a chart showing the very passes the sentence denies. */
              <p className="fwm-screen-note fwm-exposure-none-today">{EXPOSURE_NONE_TODAY}</p>
            ) : (
              <ul className="fwm-exposure-list" aria-label="passes">
                {rows.map((row) => (
                  <li key={`${String(row.atMs)}-${row.cameraId}`}>
                    <button
                      type="button"
                      className="fwm-screen-row"
                      data-fwm-lead="mark"
                      onClick={() => {
                        openIntelCard(row.cameraId);
                      }}
                    >
                      <span
                        className="fwm-screen-dot"
                        data-fwm-owner={ownerOf(row.cameraId)}
                        aria-hidden="true"
                      />
                      <span className="fwm-exposure-pass-where">
                        {/* THE ID WHEN THERE IS NO NAME, never a dash. A row that
                            read "\u2014" was a pass at a camera whose record is not on
                            the phone any more -- a tile evicted, or a camera the
                            archive has since removed -- and the dash told the
                            driver nothing they could look up or report. The id
                            is the same key the intel card opens on. */}
                        <span className="fwm-exposure-pass-place">{row.label ?? row.cameraId}</span>
                        {/* WHO RUNS IT AND WHERE, under the street. When the
                            record said nothing because there is no record, say
                            that, so the row is not mistaken for a camera that
                            merely lacks tags. */}
                        {row.operator === null && row.where === null ? (
                          row.label === null ? (
                            <span className="fwm-exposure-pass-meta">{NOT_ON_PHONE}</span>
                          ) : null
                        ) : (
                          <span className="fwm-exposure-pass-meta">
                            {[row.operator, row.where].filter((part) => part !== null).join(' \u00b7 ')}
                          </span>
                        )}
                      </span>
                      <span className="fwm-exposure-pass-time fwm-data">{clockOf(row.atMs)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="fwm-screen-dock-reserve" aria-hidden="true" />
    </section>
  );
}
