/**
 * MONITOR MODE - the card DRIVE shows when nobody has said where they are
 * going.
 *
 * =============================================================================
 * WHAT IT REPLACED
 * =============================================================================
 * DRIVE used to draw one card that expanded and collapsed, and a second small
 * one over it. Two cards meant two answers to "how far is the nearest reader",
 * and the collapse meant the answer a driver saw by default was whichever one
 * they had last left open. There is ONE card on screen now and it has no mini
 * variant: this one when there is no destination, the navigation card when
 * there is, and never both.
 *
 * =============================================================================
 * IT TAKES DATA, NOT STORES
 * =============================================================================
 * Nothing in here subscribes to anything. Every figure arrives as a prop,
 * already formatted, which is what makes the card testable without a device, a
 * fix, or a seeded IndexedDB - and it is why the empty states below can be
 * asserted at all.
 *
 * =============================================================================
 * EVERY NUMBER ON THIS CARD IS MEASURED, INCLUDING THE MISSING ONES
 * =============================================================================
 * The durable pass count is null until the vault has answered, and a card that
 * printed `0` in the meantime would be telling a driver they had never been
 * read when the truth is that nobody has looked yet. Same for the two lists: an
 * empty nearby list is the archive on this phone having nothing inside the
 * radius, which is not the same claim as "there are no cameras", and an empty
 * recent list is a log that has not started rather than a drive that was clean.
 * Each of those says which, in words, instead of rendering as a blank column.
 */

import { useCallback, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, UIEvent } from 'react';

import { ClosestPanel, type ClosestPanelProps } from './ClosestPanel.tsx';

import './monitorCard.css';

export const MONITOR_TITLE = 'Upcoming Cameras Nearby';
export const MONITOR_SORTED = 'Sorted by distance';
/* The key row the monitor card draws for itself - see the note at its markup
   for why these are not `ClosestPanel`'s own labels. */
export const MONITOR_MUTE = 'MUTE';
export const MONITOR_UNMUTE = 'UNMUTE';

const RAIL_PAGES = 2;
/* What each dot stands for, so the indicator is announced as navigation rather
   than as three anonymous pills. Order is the DRAWN order, which is what a
   person swiping is moving through. */
const RAIL_NAMES = ['Closest camera and what is coming up', 'Plate reads'] as const;

/** The tinted panel's own words, kept the same as EXPOSURE's so the two
 *  surfaces are not two vocabularies for one count. */
export const MONITOR_ALL_TIME_UNIT = 'plate reads, all time';
export const MONITOR_PASSES_NOTE = 'passes on this phone';

export const MONITOR_HOTTEST = 'HOTTEST';
export const MONITOR_ALL_TIME = 'ALL TIME';
export const MONITOR_NOTHING_REPEATED = 'nothing repeated yet';
export const MONITOR_RECENT = 'RECENT';
export const MONITOR_SEE_ALL = 'See all';

/**
 * Said in place of the big figure while the durable count is still null.
 *
 * NOT AN EM DASH. A dash is what EXPOSURE prints for a value it cannot compute,
 * and it reads as "there is nothing here" - which is the one thing this state
 * does not mean. The count is loading; the sentence says so.
 */
export const MONITOR_UNCOUNTED = 'not counted yet';

/** Said when the log has nothing in it, which is a start rather than a result. */
export const MONITOR_NO_RECENT =
  'nothing recorded yet. this fills in as you drive past cameras, and it is kept on this phone ' +
  'only.';

/** Said in the third column before the first fix. There is no distance to give. */
export const MONITOR_NO_FIX =
  'no position yet. the closest reader is measured from where you are, so this fills in with your ' +
  'first fix.';

/**
 * WHAT AN EMPTY NEARBY LIST ACTUALLY MEANS, said in the radius the caller used.
 *
 * "No cameras nearby" would be a claim about the world. What is true is
 * narrower and is the sentence below: the archive cached on this phone holds
 * none inside that radius. A driver who has never synced, or who is off the
 * edge of a downloaded region, is in exactly this state and is entitled to know
 * which of the two things happened.
 */
export function nothingNearbyLine(withinLabel: string): string {
  return `no cameras ${withinLabel.toLowerCase()} in the archive on this phone.`;
}

/** "1 pass" / "0 passes" - the bar chart's own reading, out loud. */
export function passCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'pass' : 'passes'}`;
}

export interface MonitorCardProps {
  /* The nearby list and the press that opens a camera belong to the reader
     column now - they arrive inside `closest`. See `ClosestPanel`. */
  readonly passes: {
    readonly allTime: number | null;
    readonly byDay: readonly { readonly label: string; readonly count: number }[];
    readonly hottest: { readonly count: number; readonly label: string } | null;
    readonly recent: readonly {
      readonly cameraId: string; readonly ago: string;
      readonly label: string; readonly operator: string;
    }[];
  };
  readonly onSeeAll: () => void;
  readonly closest: ClosestPanelProps | null;
}

/**
 * A bar's height, handed to CSS as a share of the tallest bar rather than as a
 * height.
 *
 * The stylesheet turns the share into a percentage and floors it with a
 * `min-height`, which is the half that matters: a day with no passes still
 * draws a visible stub, so a quiet week reads as a quiet week instead of as a
 * chart that failed to render. Setting the height here directly would have put
 * that floor in two places, and the one in JavaScript would have been the one
 * nobody remembered to keep.
 */
type BarStyle = CSSProperties & { readonly '--fwm-monitor-bar-share': string };

export function barStyle(share: number): BarStyle {
  return { '--fwm-monitor-bar-share': share.toFixed(3) };
}

/** The row and footer chevrons. Geometry only; `monitorCard.css` paints. */
function ChevronGlyph(): ReactElement {
  return (
    <svg className="fwm-monitor-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5 L16 12 L9 19" />
    </svg>
  );
}


export function MonitorCard({
  passes,
  onSeeAll,
  closest,
}: MonitorCardProps): ReactElement {
  /**
   * THE TALLEST BAR, and it is not `Math.max(1, ...)`.
   *
   * Flooring the peak at one would draw a full-height bar for a single pass on
   * an otherwise empty week, which says "this was the busy day" about a week
   * with nothing in it. Zero here means every share is zero and every bar is the
   * stub, which is what an empty week looks like.
   */
  const peak = passes.byDay.reduce((most, day) => Math.max(most, day.count), 0);

  /*
   * WHICH COLUMN THE RAIL IS SHOWING, for the swipe indicator under the card.
   *
   * The design's own arithmetic: `scrollLeft / (scrollWidth / 3)`, rounded. It
   * asks the element rather than tracking the columns itself, so it stays
   * correct through a resize, a snap, a keyboard scroll or a fling - anything
   * that moves the rail moves this, because the rail is the only source.
   *
   * Rounding rather than flooring is what makes the dot flip at the halfway
   * point, which is where the snap is taking you.
   */
  const railRef = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState(0);
  const onRail = useCallback((event: UIEvent<HTMLElement>) => {
    const rail = event.currentTarget;
    const step = rail.scrollWidth / RAIL_PAGES;
    // A rail that has not been laid out yet divides by zero.
    if (!Number.isFinite(step) || step <= 0) return;
    const next = Math.min(RAIL_PAGES - 1, Math.max(0, Math.round(rail.scrollLeft / step)));
    setPage((current) => (current === next ? current : next));
  }, []);

  return (
    <div className="fwm-monitor-rail">
    <section className="fwm-monitor" aria-label="Cameras nearby" ref={railRef} onScroll={onRail}>
      {/* --- what is coming up, under the reader you are about to pass ---- */}

      {/* COLUMN ONE IS THE SHARED READER COLUMN, whole.
          It owns the reader box AND the nearby list - see `ClosestPanel`. The
          heading and the separate key row that used to sit here are gone: the
          design folds the keys into the reader's third line and drops the
          heading, which is the only way four pinned children become two and the
          list gets room inside a locked 180px card. */}
      {closest === null ? (
        <p className="fwm-monitor-empty fwm-data">{MONITOR_NO_FIX}</p>
      ) : (
        <ClosestPanel {...closest} />
      )}

      <div className="fwm-monitor-col fwm-monitor-passes">
        <div className="fwm-monitor-panel">
          {/* The design's handle. Purely a mark that this block is its own
              object on a card made of three columns - it drags nothing, so it
              is hidden from anybody who would otherwise be told it does. */}
          <span className="fwm-monitor-handle" aria-hidden="true" />

          <span className="fwm-monitor-hero-unit fwm-data">{MONITOR_ALL_TIME_UNIT}</span>
          {passes.allTime === null ? (
            <span className="fwm-monitor-hero-pending fwm-data">{MONITOR_UNCOUNTED}</span>
          ) : (
            <span className="fwm-monitor-hero fwm-data">{String(passes.allTime)}</span>
          )}
          <span className="fwm-monitor-hero-note fwm-data">{MONITOR_PASSES_NOTE}</span>

          {/* NO CHART AT ALL rather than seven empty stubs when the caller has
              no week to draw: an axis with no days on it is a promise that the
              data exists somewhere. Seven ZERO days is a different thing and
              does draw - see the stub note on `barStyle`. */}
          {passes.byDay.length === 0 ? null : (
            <ul className="fwm-monitor-week" aria-label="passes by day">
              {passes.byDay.map((day) => (
                <li
                  className="fwm-monitor-day"
                  key={day.label}
                  /* A TIE IS A TIE. Every bar that equals the peak takes the
                     accent, because picking one of two equal days to darken
                     would be the card inventing a winner. */
                  data-fwm-monitor-peak={String(peak > 0 && day.count === peak)}
                >
                  {/* THE TRACK IS WHAT THE SHARE IS A SHARE OF. A percentage
                      height resolves against the parent's height, and the
                      parent here also holds the day name - so without a box of
                      its own the bars were measured against the chart plus its
                      axis labels and never reached the top. */}
                  <span className="fwm-monitor-track">
                    <span
                      className="fwm-monitor-bar"
                      style={barStyle(peak === 0 ? 0 : day.count / peak)}
                      role="img"
                      aria-label={`${day.label}: ${passCount(day.count)}`}
                    />
                  </span>
                  <span className="fwm-monitor-day-name fwm-data" aria-hidden="true">
                    {day.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="fwm-monitor-tiles">
          <div className="fwm-monitor-tile">
            <span className="fwm-monitor-tile-kicker fwm-data">{MONITOR_HOTTEST}</span>
            {passes.hottest === null ? (
              <span className="fwm-monitor-tile-note fwm-data">{MONITOR_NOTHING_REPEATED}</span>
            ) : (
              <>
                <span className="fwm-monitor-tile-value fwm-data">
                  {String(passes.hottest.count)}
                </span>
                <span className="fwm-monitor-tile-note fwm-data">{passes.hottest.label}</span>
              </>
            )}
          </div>
          <div className="fwm-monitor-tile">
            <span className="fwm-monitor-tile-kicker fwm-data">{MONITOR_ALL_TIME}</span>
            {passes.allTime === null ? (
              <span className="fwm-monitor-tile-note fwm-data">{MONITOR_UNCOUNTED}</span>
            ) : (
              <span className="fwm-monitor-tile-value fwm-data">{String(passes.allTime)}</span>
            )}
            <span className="fwm-monitor-tile-note fwm-data">{MONITOR_PASSES_NOTE}</span>
          </div>
        </div>

        <div className="fwm-monitor-panel fwm-monitor-recent">
          <header className="fwm-monitor-recent-head">
            <h3 className="fwm-monitor-kicker fwm-data">{MONITOR_RECENT}</h3>
            <button type="button" className="fwm-monitor-seeall" onClick={onSeeAll}>
              <span className="fwm-monitor-seeall-label">{MONITOR_SEE_ALL}</span>
              <ChevronGlyph />
            </button>
          </header>

          {passes.recent.length === 0 ? (
            <p className="fwm-monitor-empty fwm-data">{MONITOR_NO_RECENT}</p>
          ) : (
            /* NOT SLICED HERE. The design draws five, and five is what the
               caller passes; cutting the list a second time in this file would
               make "how many are recent" a question with two answers, and the
               one in the presentational component would be the answer nobody
               could find. The card scrolls if the column outgrows its space. */
            <ul className="fwm-monitor-recent-rows" aria-label={MONITOR_RECENT}>
              {/* THE POSITION IS PART OF THE KEY, because a pass carries no id in
                  this contract and a camera plus its "2 min ago" is not unique:
                  two reads by one camera inside the same bucket collide, which
                  is the repetition the HOTTEST tile exists to count. Keyed on
                  those two alone, React warned and then drew the camera a THIRD
                  time as soon as a newer pass arrived at the top of the log -
                  measured, not feared, and it is the worst failure available to
                  a panel whose subject is how often you were read. */}
              {passes.recent.map((pass, index) => (
                <li
                  className="fwm-monitor-recent-row"
                  key={`${pass.cameraId}-${pass.ago}-${String(index)}`}
                >
                  <span className="fwm-monitor-dot" aria-hidden="true" />
                  <span className="fwm-monitor-recent-ago fwm-data">{pass.ago}</span>
                  <span className="fwm-monitor-recent-label">{pass.label}</span>
                  <span className="fwm-monitor-recent-operator fwm-data">{pass.operator}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>

      {/*
        THE PAGE DOTS AND THE WORD, both as `Dynamic Cards (3)` draws them.

        Three columns that scroll sideways look exactly like one column with a
        lot of empty space to the right of it unless something says otherwise.
        The dots answer that: the lit one is the column you are on. The design
        pairs them with the word SWIPE and the owner has now cut that TWICE -
        once before this port and once after it came back with the source. It
        does not come back again.

        It is `aria-hidden` and paired with a live region rather than being
        marked up as a tablist: the dots are not controls - you cannot press
        them, they only report - and a screen reader reaches all three columns
        by moving through the rail itself, which is the real navigation.
      */}
      <div className="fwm-monitor-swipe" aria-hidden="true">
        {RAIL_NAMES.map((name, index) => (
          <span
            key={name}
            className="fwm-monitor-swipe-dot"
            data-fwm-on={String(index === page)}
          />
        ))}
      </div>

      {/* The same fact in words, for anything that cannot see the dots. */}
      <p className="fwm-monitor-swipe-said" role="status">
        {`${RAIL_NAMES[page] ?? ''}, ${String(page + 1)} of ${String(RAIL_PAGES)}`}
      </p>
    </div>

  );
}
