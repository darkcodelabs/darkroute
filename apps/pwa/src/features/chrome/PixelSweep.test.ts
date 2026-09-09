/**
 * THE SWEEP, AND THE FOUR THINGS THAT WOULD STILL LOOK LIKE A SWEEP IF THEY
 * WERE WRONG.
 *
 * This file asserts the FORMULA and never the random output. `buildSweepCells`
 * draws from a seeded stream, so its pixels are reproducible and it would be
 * easy to snapshot them -- and a snapshot of 460 coordinates would go red on
 * every legitimate change and green on every illegitimate one, because nobody
 * can read it. What is actually load-bearing is:
 *
 *   1. THE FRONT IS A STRAIGHT VERTICAL LINE. Every row of a column carries
 *      the same column term, so the front is a line and not a comma. A `bow`
 *      term reintroduced by somebody who thought it looked softer would pass a
 *      render test and fail here.
 *
 *   2. JITTER STAYS UNDER 0.05s. At 96 columns over 1.9s the columns are 20ms
 *      apart. Jitter larger than that step smears the leading edge into a
 *      shimmer -- it still animates, it just stops meaning a direction.
 *
 *   3. DIRECTION. Left to right is approaching, right to left is cleared, and
 *      all-at-once is passing. Swap two of them and the bar tells a driver a
 *      camera is behind them while they drive into it.
 *
 *   4. THE TWO COPIES OF FIVE DURATIONS AGREE. `pixelSweep.css` animates for
 *      3.2s and `SPECS` unmounts after 3.2s x its last stop; the numbers live
 *      in two files because CSS cannot tell TypeScript when a pass is over.
 *      Drift either one and the grid either vanishes mid-pass or sits in the
 *      tree animating nothing, which is rule 5 broken silently.
 *
 * The tap sequence is here too, for the reason every off-by-one countdown is:
 * "3 steps / 2 steps / 1 step" is four boundaries in five strings.
 */

import { readFileSync } from 'node:fs';

import { createElement } from 'react';

import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AMBIENT_EVERY_MS,
  AMBIENT_PASSES,
  SWEEP_JITTER_MAX,
  SWEEP_TURN_QUIET_MS,
  SWEEP_SPECS,
  buildSweepCells,
  seedForTap,
  sweepLifetimeMs,
  useChromeSweep,
} from './PixelSweep.tsx';
import type { PixelSweepProps, SweepKind, SweepSpec } from './PixelSweep.tsx';
import {
  HAKCER_ALREADY,
  Toast,
  HAKCER_SILENT_TAPS,
  HAKCER_TAPS,
  TOAST_DISMISS_MS,
  toastForTaps,
} from './Toast.tsx';

/* ------------------------------------------------------------------------ *
 * THE SPEC TABLE, TWICE
 *
 * Below is the table TRANSCRIBED A SECOND TIME, straight from the spec page's
 * own `buildSweep` calls and the brief's gesture table -- and it is compared
 * field by field against the one the module ships. Writing it out twice is the
 * point: a test that imported the table and asserted things about it would
 * assert them about whatever the table happened to say, and a seed or a
 * density edited by accident would take the test along with it.
 *
 * Everything after that first comparison uses the MODULE's table, so the
 * behaviour under test is the behaviour that ships.
 * ------------------------------------------------------------------------ */

const APPROACH: SweepSpec = {
  cols: 96, rows: 11, emitCols: 96,
  density: 0.44, travel: 1.9, jitter: 0.03, reverse: false,
  seed: 20260907, dur: 3.2, hold: 0.36,
};

const PASSING: SweepSpec = {
  cols: 96, rows: 11, emitCols: 96,
  density: 0.5, travel: 0, jitter: 0.05, reverse: false,
  seed: 41190228, dur: 2.4, hold: 0.34,
};

const CLEARED: SweepSpec = {
  cols: 96, rows: 11, emitCols: 96,
  density: 0.4, travel: 1.9, jitter: 0.03, reverse: true,
  seed: 90551477, dur: 3.2, hold: 0.36,
};

const AMBIENT: SweepSpec = {
  cols: 96, rows: 11, emitCols: 96,
  density: 0.36, travel: 2.4, jitter: 0.035, reverse: false,
  seed: 77712203, dur: 60, hold: 0.034,
};

const PULSE: SweepSpec = {
  cols: 96, rows: 11, emitCols: 96,
  density: 0.5, travel: 0.85, jitter: 0.03, reverse: false,
  seed: 1000, dur: 4, hold: 0.55,
};

const EDGE: SweepSpec = {
  cols: 96, rows: 11, emitCols: 1,
  density: 0.5, travel: 0, jitter: 0, reverse: false,
  seed: 41190228, dur: 0.18, hold: 0.34,
};

/** The independently written table, keyed the way the module keys its own. */
const EXPECTED: Readonly<Record<SweepKind, SweepSpec>> = {
  approach: APPROACH, passing: PASSING, cleared: CLEARED,
  ambient: AMBIENT, pulse: PULSE, edge: EDGE,
};

/** What the module actually ships, which is what every test below exercises. */
const ALL: ReadonlyArray<readonly [SweepKind, SweepSpec]> =
  (Object.keys(EXPECTED) as SweepKind[]).map((kind) => [kind, SWEEP_SPECS[kind]] as const);

describe('the gesture table', () => {
  it("ships the spec page's own numbers, and exactly six gestures", () => {
    expect(Object.keys(SWEEP_SPECS).sort()).toStrictEqual(Object.keys(EXPECTED).sort());
    for (const kind of Object.keys(EXPECTED) as SweepKind[]) {
      expect(SWEEP_SPECS[kind], kind).toStrictEqual(EXPECTED[kind]);
    }
  });
});

/** The delay every cell of one column carries, ignoring jitter. */
function columnFloor(spec: SweepSpec, col: number): number {
  const pos = spec.reverse ? (spec.cols - 1 - col) / spec.cols : col / spec.cols;
  return pos * spec.travel;
}

/* ------------------------------------------------------------------------ *
 * 1. THE FRONT IS A LINE
 * ------------------------------------------------------------------------ */

describe('the leading edge', () => {
  it('gives every row of a column the same column term, so the front is vertical', () => {
    for (const [name, spec] of ALL) {
      for (const cell of buildSweepCells(spec, spec.seed)) {
        const floor = columnFloor(spec, cell.col);
        /* The ONLY thing between a cell's delay and its column's own delay is
           jitter. A `bow` term, a row taper or an arc would put a row-shaped
           gap here, and there is nowhere else for one to hide. */
        expect(cell.delay - floor, `${name} col ${String(cell.col)} row ${String(cell.row)}`)
          .toBeGreaterThanOrEqual(0);
        expect(cell.delay - floor).toBeLessThan(spec.jitter + Number.EPSILON);
      }
    }
  });

  it('spreads no more than one column-step of jitter, and never more than 0.05s', () => {
    for (const [name, spec] of ALL) {
      expect(spec.jitter, `${name} jitter`).toBeLessThanOrEqual(SWEEP_JITTER_MAX);

      let worst = 0;
      for (const cell of buildSweepCells(spec, spec.seed)) {
        worst = Math.max(worst, cell.delay - columnFloor(spec, cell.col));
      }
      expect(worst, `${name} measured jitter`).toBeLessThanOrEqual(spec.jitter);
    }
  });

  it('keeps the column step the brief does its arithmetic on', () => {
    /*
     * THE 20 MILLISECONDS THE CEILING IS ARGUED FROM. "At 96 columns over
     * 1.9s the columns are only 20ms apart" is the brief's whole reason for
     * capping jitter, so the step itself is pinned here: change `cols` or
     * `travel` and the ceiling stops being a reasoned number.
     *
     * MEASURED, AND NOT WHAT THE PROSE IMPLIES. The shipped jitter is 0.03s,
     * which is 1.52 of those steps, and the 0.05s ceiling is 2.53 of them --
     * so a cell CAN already land a column or two late. That is the spec's own
     * value and it is kept; the front reads as a line with a step and a half
     * of fuzz across 96 columns. What is NOT asserted here is "jitter below
     * one column step", because nothing in either brief says that and the
     * spec page would fail it.
     */
    for (const spec of [APPROACH, CLEARED]) {
      expect((spec.travel / spec.cols) * 1000).toBeCloseTo(19.79, 2);
      expect(spec.jitter / (spec.travel / spec.cols)).toBeLessThan(2);
    }
  });
});

/* ------------------------------------------------------------------------ *
 * 2. DIRECTION IS THE GRAMMAR
 * ------------------------------------------------------------------------ */

describe('direction', () => {
  it('runs approach left to right and cleared right to left', () => {
    expect(columnFloor(APPROACH, 0)).toBe(0);
    expect(columnFloor(APPROACH, 95)).toBeGreaterThan(columnFloor(APPROACH, 0));

    expect(columnFloor(CLEARED, 95)).toBeLessThan(columnFloor(CLEARED, 0));
    expect(columnFloor(CLEARED, 0)).toBeCloseTo(CLEARED.travel * (95 / 96), 6);
  });

  it('fires every column of the passing flash together', () => {
    /* A camera flash, not a wave: travel is zero, so the only spread left is
       jitter and the whole bar is one event. */
    expect(PASSING.travel).toBe(0);
    for (const cell of buildSweepCells(PASSING, PASSING.seed)) {
      expect(cell.delay).toBeLessThanOrEqual(PASSING.jitter);
    }
  });

  it('degrades to the leading column alone, with no travel and no scatter', () => {
    const cells = buildSweepCells(EDGE, EDGE.seed);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.col).toBe(0);
      expect(cell.delay).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------------ *
 * 3. THE GRID ITSELF
 * ------------------------------------------------------------------------ */

describe('the grid', () => {
  it('is 96 x 11 for every gesture', () => {
    for (const [name, spec] of ALL) {
      expect(spec.cols, `${name} cols`).toBe(96);
      expect(spec.rows, `${name} rows`).toBe(11);
    }
  });

  it('lands each cell inside the grid and paints it one of the six hues', () => {
    for (const [name, spec] of ALL) {
      for (const cell of buildSweepCells(spec, spec.seed)) {
        expect(cell.col, name).toBeLessThan(spec.emitCols);
        expect(cell.row, name).toBeLessThan(spec.rows);
        expect(cell.tone, name).toBeGreaterThanOrEqual(1);
        expect(cell.tone, name).toBeLessThanOrEqual(6);
      }
    }
  });

  it('fills roughly the density it was asked for, and never the whole grid', () => {
    /*
     * Occupancy is the variable the brief names -- sparse at 90 seconds, dense
     * at 30 -- so it is checked as a RATE rather than a count. A grid at 100%
     * is a solid bar of colour, not a sweep.
     *
     * THE TOLERANCE IS THE SAMPLE'S OWN, not a number picked to make this
     * pass. Each cell is one Bernoulli draw, so three standard deviations of
     * the rate is 3 x sqrt(d(1-d)/n): +/- 4.6 points on the 1,056-cell grids
     * and +/- 45 on the reduced-motion degrade, which is ELEVEN cells and
     * cannot carry a tight rate. A flat +/- 10 passed the five big grids and
     * failed the small one for being small.
     */
    for (const [name, spec] of ALL) {
      const total = spec.emitCols * spec.rows;
      const landed = buildSweepCells(spec, spec.seed).length;
      const tolerance = 3 * Math.sqrt((spec.density * (1 - spec.density)) / total);
      expect(landed / total, `${name} occupancy`).toBeGreaterThan(spec.density - tolerance);
      expect(landed / total, `${name} occupancy`).toBeLessThan(spec.density + tolerance);
    }
  });

  it('lands the occupancy the spec page draws, which is NOT the prose 30-40%', () => {
    /*
     * MEASURED, AND THE ONE PLACE THE TWO SOURCES DISAGREE. Section D's prose
     * says "~30-40% occupancy"; the spec page's own `buildSweep` calls pass
     * 0.44, 0.5, 0.4, 0.36 and 0.5, and only ONE of the five lands inside the
     * band the prose states. The literal call sites are what is built, and
     * these are the rates they produce -- pinned so that a future edit toward
     * the prose is a deliberate change rather than a drift.
     */
    const rate = (spec: SweepSpec): number =>
      buildSweepCells(spec, spec.seed).length / (spec.emitCols * spec.rows);
    expect(rate(APPROACH)).toBeCloseTo(0.4375, 4);
    expect(rate(PASSING)).toBeCloseTo(0.5313, 4);
    expect(rate(CLEARED)).toBeCloseTo(0.41, 4);
    expect(rate(AMBIENT)).toBeCloseTo(0.3589, 4);
    expect(rate(PULSE)).toBeCloseTo(0.5142, 4);
  });

  it('gives every tap a different stream, so no two pulses land identically', () => {
    const first = buildSweepCells(PULSE, seedForTap(1));
    const second = buildSweepCells(PULSE, seedForTap(2));
    const key = (cells: readonly { col: number; row: number }[]): string =>
      cells.map((c) => `${String(c.col)}.${String(c.row)}`).join(',');
    expect(key(first)).not.toBe(key(second));
  });

  it('draws the same stream twice from the same seed', () => {
    /* The seeded generator is the spec page's own, and it is kept precisely so
       that an approach sweep is the same sweep every time it fires. */
    expect(buildSweepCells(APPROACH, APPROACH.seed))
      .toStrictEqual(buildSweepCells(APPROACH, APPROACH.seed));
  });
});

/* ------------------------------------------------------------------------ *
 * 4. MOUNT ONLY WHILE FIRING
 * ------------------------------------------------------------------------ */

describe('the lifetime of one pass', () => {
  it('covers the travel, the scatter and the visible part of the keyframe', () => {
    /* 1.9s of travel + 0.03s of scatter + 36% of 3.2s = 3.082s. Anything
       shorter cuts the tail off on the right-hand columns. */
    expect(sweepLifetimeMs(APPROACH)).toBeCloseTo(3082, 3);
    expect(sweepLifetimeMs(PASSING)).toBeCloseTo(866, 3);
    expect(sweepLifetimeMs(AMBIENT)).toBeCloseTo(4475, 3);
    expect(sweepLifetimeMs(PULSE)).toBeCloseTo(3080, 3);
  });

  it('never keeps a grid for the whole animation, which is the point of rule 5', () => {
    /* The ambient pass animates for 60s and is VISIBLE for four and a half.
       Keeping it mounted for the other 55 is ~380 nodes the compositor ticks
       for nothing, five times, on every cold start. */
    for (const [name, spec] of ALL) {
      expect(sweepLifetimeMs(spec), `${name} lifetime`).toBeLessThan(spec.dur * 1000);
    }
    expect(sweepLifetimeMs(AMBIENT)).toBeLessThan(AMBIENT_EVERY_MS);
  });

  it('runs the intro five times a minute apart and never again', () => {
    expect(AMBIENT_PASSES).toBe(5);
    expect(AMBIENT_EVERY_MS).toBe(60000);
  });

  it('stays quiet for five seconds after a turn', () => {
    expect(SWEEP_TURN_QUIET_MS).toBe(5000);
  });
});

/* ------------------------------------------------------------------------ *
 * 5. THE TWO COPIES OF FIVE DURATIONS
 * ------------------------------------------------------------------------ */

describe('the stylesheet and the module', () => {
  /** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
  const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
  const CSS: string = readFileSync(`${HERE}/pixelSweep.css`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '));

  /** `--fwm-dur-alert` is 400ms and `--fwm-dur-instant` is 90ms, in tokens.css. */
  const DUR_ALERT = 0.4;
  const DUR_INSTANT = 0.09;

  /** The multiplier a `calc(var(--fwm-dur-*) * n)` declaration carries. */
  function declaredSeconds(prop: string): number {
    const found = new RegExp(
      `--fwm-pxsweep-${prop}:\\s*calc\\(var\\(--fwm-(dur-alert|dur-instant)\\)\\s*\\*\\s*([0-9.]+)\\)`,
      'u',
    ).exec(CSS);
    expect(found, `no --fwm-pxsweep-${prop} in pixelSweep.css`).not.toBeNull();
    const base = found?.[1] === 'dur-instant' ? DUR_INSTANT : DUR_ALERT;
    return base * Number(found?.[2]);
  }

  it('animates for exactly as long as the module thinks it does', () => {
    expect(declaredSeconds('dur-sweep')).toBeCloseTo(APPROACH.dur, 6);
    expect(declaredSeconds('dur-sweep')).toBeCloseTo(CLEARED.dur, 6);
    expect(declaredSeconds('dur-flash')).toBeCloseTo(PASSING.dur, 6);
    expect(declaredSeconds('dur-pulse')).toBeCloseTo(PULSE.dur, 6);
    expect(declaredSeconds('dur-amb')).toBeCloseTo(AMBIENT.dur, 6);
    expect(declaredSeconds('dur-edge')).toBeCloseTo(EDGE.dur, 6);
  });

  it('dismisses the toast on the same 3.2s the stylesheet writes for a sweep', () => {
    expect(TOAST_DISMISS_MS).toBe(3200);
    expect(declaredSeconds('dur-sweep') * 1000).toBeCloseTo(TOAST_DISMISS_MS, 6);
  });

  it('carries all four keyframe blocks, and no fifth', () => {
    const names = [...CSS.matchAll(/@keyframes\s+([\w-]+)/gu)].map((m) => m[1]);
    expect(names).toStrictEqual(['dr-px', 'dr-px-flash', 'dr-px-pulse', 'dr-px-amb']);
  });

  it('lays the grid under the content and lets nothing through it', () => {
    const at = CSS.indexOf('\n.fwm-pxsweep {');
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf('}', at));
    /* Six declarations, all six load-bearing. `z-index: 0` with the bar's
       content at 1 is what keeps `screen` from washing out the wordmark. */
    expect(block).toContain('z-index: 0');
    expect(block).toContain('mix-blend-mode: screen');
    expect(block).toContain('pointer-events: none');
    expect(block).toContain('overflow: hidden');
    expect(block).toContain('border-radius: var(--fwm-radius-full)');
    expect(block).toContain('inset: 0');
  });

  it('blends multiply on the three light skins and restates no colour', () => {
    expect(CSS).toContain("[data-fwm-mode='refinement'] .fwm-pxsweep");
    expect(CSS).toContain("[data-fwm-mode='paper'] .fwm-pxsweep");
    expect(CSS).toContain("[data-fwm-mode='e-ink'] .fwm-pxsweep");
    expect(CSS).toContain('mix-blend-mode: multiply');
    /* One palette, both themes. A light block that redeclared `--dr-px-*`
       would be a second set of six colours nobody is checking the contrast of. */
    expect(/\[data-fwm-mode[^{]*\{[^}]*--dr-px-/u.test(CSS)).toBe(false);
  });

  it('silences the other four under reduced motion and keeps the degrade', () => {
    const at = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf('\n}', CSS.indexOf('{', at)));
    for (const kind of ['approach', 'passing', 'cleared', 'pulse', 'ambient']) {
      expect(block, kind).toContain(`.fwm-pxsweep--${kind} .fwm-pxsweep-cell`);
    }
    /* The degrade is the approach signal, not decoration. Turning it off here
       would leave a driver who asked for less motion with no signal at all. */
    expect(block).not.toContain('.fwm-pxsweep--edge');
  });

  it('draws the toast as the app surface, at the one alpha that is not 0.84', () => {
    const at = CSS.indexOf('\n.fwm-pxtoast {');
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf('\n}', at));
    expect(block).toContain('border-radius: var(--fwm-radius-full)');
    expect(block).toContain('background: var(--dr-surface-toast)');
    expect(block).toContain('backdrop-filter: var(--dr-blur)');
    expect(block).toContain('solid var(--dr-hairline)');
    expect(block).toContain('z-index: 4');
    expect(block).toContain('font-size: var(--fwm-text-forecast)');
    /*
     * MEASURED IN CHROMIUM, AND NOT IN THE SPEC. `left: 50%` with no `right`
     * shrink-to-fits against half the screen, so the spec's three declarations
     * alone gave a 206px pill THREE LINES tall at the design width. With this
     * it is one line, 39px. The `max-width` it is capped by is still the
     * spec's own.
     */
    expect(block).toContain('width: max-content');
  });

  it('resolves the toast alpha in both themes, and in tokens.css alone', () => {
    const TOKENS = readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '));
    /* 0.92 on the dark ground, 0.95 on the light one -- the spec page's own
       two values. A surface floating on the MAP needs more body than one on
       the chrome, which is the whole reason it is not `--dr-surface`. */
    expect(TOKENS).toContain('--dr-surface-toast: rgba(14, 17, 21, 0.92)');
    expect(TOKENS.match(/--dr-surface-toast: rgba\(255, 255, 255, 0\.95\)/gu)).toHaveLength(3);
    /* And the six sweep hues, which no component may restate. */
    for (const hue of ['#ff3dbe', '#2fd4ff', '#7c4dff', '#ffffff', '#ff7ad2', '#00e5ff']) {
      expect(TOKENS, hue).toContain(hue);
    }
  });

  it('runs each pass once, never on a loop', () => {
    expect(CSS).toContain('animation-iteration-count: 1');
    /* `infinite` is what the spec PAGE does so all five gestures are visible
       on a static page at once. In the product a sweep is a thing that
       happened, and a thing that happened does not repeat. */
    expect(CSS).not.toContain('infinite');
  });
});

/* ------------------------------------------------------------------------ *
 * 6. THE TAP SEQUENCE
 * ------------------------------------------------------------------------ */

describe('the build-number sequence', () => {
  it('says nothing for the first three taps', () => {
    expect(HAKCER_SILENT_TAPS).toBe(3);
    expect(toastForTaps(1)).toBeNull();
    expect(toastForTaps(2)).toBeNull();
    expect(toastForTaps(3)).toBeNull();
  });

  it("counts down from the fourth in the brief's own words", () => {
    expect(toastForTaps(4)).toBe('You are now 3 steps away from being a haKCer.');
    expect(toastForTaps(5)).toBe('You are now 2 steps away from being a haKCer.');
    /* Singular on the last step. The one place a pluraliser would go wrong. */
    expect(toastForTaps(6)).toBe('You are now 1 step away from being a haKCer.');
  });

  it('arrives on the seventh and stays arrived', () => {
    expect(HAKCER_TAPS).toBe(7);
    expect(toastForTaps(7)).toBe('You are now a haKCer!');
    expect(toastForTaps(8)).toBe(HAKCER_ALREADY);
    expect(toastForTaps(99)).toBe(HAKCER_ALREADY);
  });

  it('spells the word with a capital K and a capital C, every time', () => {
    /* `haKCer` is the substitution the whole joke rests on. Lowercase it and
       the sequence is Android's, unchanged, with nothing of this product in
       it. Checked as characters rather than case-insensitively on purpose. */
    for (const taps of [4, 5, 6, 7, 8]) {
      expect(toastForTaps(taps)).toContain('haKCer');
    }
  });
});

/* ------------------------------------------------------------------------ *
 * 7. THE CONTROLLER, WHICH IS WHERE THE RULES LIVE
 *
 * The formula above decides what a sweep LOOKS like. This decides whether one
 * happens at all, and every assertion here is a rule the brief states in
 * words: once per event, mounted only while firing, never within five seconds
 * of a turn, and degraded rather than removed when the device asks for less
 * motion.
 * ------------------------------------------------------------------------ */

/** What kind of grid is in the bar's slot right now, or null for none. */
function slot(sweep: ReturnType<typeof useChromeSweep>['sweep']): SweepKind | null {
  return sweep === null ? null : (sweep.props as PixelSweepProps).kind;
}

describe('the sweep controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts one pass on a trigger and takes it out again when it is over', () => {
    const { result } = renderHook(() => useChromeSweep());
    expect(slot(result.current.sweep)).toBeNull();

    act(() => { result.current.fire('approach'); });
    expect(slot(result.current.sweep)).toBe('approach');

    /* Still there one frame before the end -- cutting it short clips the tail
       off the right-hand columns, which is the half a driver sees last. */
    act(() => { vi.advanceTimersByTime(sweepLifetimeMs(APPROACH) - 1); });
    expect(slot(result.current.sweep)).toBe('approach');

    act(() => { vi.advanceTimersByTime(1); });
    expect(slot(result.current.sweep)).toBeNull();
  });

  it('never fires within five seconds of a turn', () => {
    const { result } = renderHook(() => useChromeSweep());
    act(() => { result.current.noteManeuver(); });

    act(() => { result.current.fire('approach'); });
    expect(slot(result.current.sweep)).toBeNull();

    act(() => { vi.advanceTimersByTime(SWEEP_TURN_QUIET_MS - 1); result.current.fire('passing'); });
    expect(slot(result.current.sweep)).toBeNull();

    /* And the window ENDS. A quiet window that never lifted would be a bar
       that went silent for the rest of the drive after one turn. */
    act(() => { vi.advanceTimersByTime(2); result.current.fire('passing'); });
    expect(slot(result.current.sweep)).toBe('passing');
  });

  it('degrades approach to the edge flash under reduced motion, and drops the rest', () => {
    vi.stubGlobal('matchMedia', (media: string) => ({ matches: true, media }));
    const { result } = renderHook(() => useChromeSweep());

    act(() => { result.current.fire('approach'); });
    expect(slot(result.current.sweep)).toBe('edge');

    act(() => { vi.advanceTimersByTime(sweepLifetimeMs(EDGE)); });
    expect(slot(result.current.sweep)).toBeNull();

    /* Passing and cleared are confirmations of something already read. They
       do not degrade, they simply do not fire. */
    act(() => { result.current.fire('passing'); });
    expect(slot(result.current.sweep)).toBeNull();
    act(() => { result.current.fire('cleared'); });
    expect(slot(result.current.sweep)).toBeNull();
  });

  it('fires one pulse per tap, on a new seed every time', () => {
    const { result } = renderHook(() => useChromeSweep());
    const seeds: number[] = [];
    for (let tap = 1; tap <= 3; tap++) {
      act(() => { result.current.tapMark(); });
      expect(slot(result.current.sweep)).toBe('pulse');
      seeds.push((result.current.sweep?.props as PixelSweepProps).seed ?? 0);
      act(() => { vi.advanceTimersByTime(sweepLifetimeMs(PULSE)); });
    }
    expect(new Set(seeds).size).toBe(3);
    expect(seeds).toStrictEqual([seedForTap(1), seedForTap(2), seedForTap(3)]);
  });

  it('says nothing for three taps, then counts down, then stays arrived', () => {
    const { result } = renderHook(() => useChromeSweep());
    const said: (string | null)[] = [];
    for (let tap = 1; tap <= 8; tap++) {
      act(() => { result.current.tapMark(); });
      said.push(result.current.toast);
    }
    expect(said).toStrictEqual([
      null, null, null,
      'You are now 3 steps away from being a haKCer.',
      'You are now 2 steps away from being a haKCer.',
      'You are now 1 step away from being a haKCer.',
      'You are now a haKCer!',
      HAKCER_ALREADY,
    ]);
  });

  it('dismisses the sentence at 3.2s, and a new tap resets the clock', () => {
    const { result } = renderHook(() => useChromeSweep());
    for (let tap = 1; tap <= 4; tap++) act(() => { result.current.tapMark(); });
    expect(result.current.toast).not.toBeNull();

    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 1); });
    expect(result.current.toast).not.toBeNull();

    /* A tap here must give the NEW sentence a full 3.2s, not the 1ms the old
       one had left -- a queue of expiring timers is how a toast flickers. */
    act(() => { result.current.tapMark(); });
    act(() => { vi.advanceTimersByTime(TOAST_DISMISS_MS - 1); });
    expect(result.current.toast).toBe('You are now 2 steps away from being a haKCer.');

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.toast).toBeNull();
  });

  it('lets a signal take the slot from a tap, and never the other way round', () => {
    /* Decoration must never displace signal. This is the brief's one stated
       priority and the only thing settling the collision between them. */
    const { result } = renderHook(() => useChromeSweep());

    act(() => { result.current.tapMark(); });
    expect(slot(result.current.sweep)).toBe('pulse');
    act(() => { result.current.fire('approach'); });
    expect(slot(result.current.sweep)).toBe('approach');

    act(() => { result.current.tapMark(); });
    expect(slot(result.current.sweep)).toBe('approach');
    /* The words still arrive -- a sentence is not motion and costs nobody a turn. */
    expect(result.current.toast).toBeNull();
  });

  it('counts the taps even when the pulse stands down', () => {
    const { result } = renderHook(() => useChromeSweep());
    act(() => { result.current.fire('approach'); });
    for (let tap = 1; tap <= 4; tap++) act(() => { result.current.tapMark(); });
    expect(slot(result.current.sweep)).toBe('approach');
    expect(result.current.toast).toBe('You are now 3 steps away from being a haKCer.');
  });
});

/* ------------------------------------------------------------------------ *
 * 8. THE TOAST ITSELF
 *
 * `createElement` rather than JSX because this file is `.ts`: the delay
 * formula is the reason it exists and a formula does not need a renderer.
 * ------------------------------------------------------------------------ */

describe('the toast', () => {
  it('draws nothing at all when there is nothing to say', () => {
    const { container } = render(createElement(Toast, { message: null }));
    /* Not an empty pill, and not a hidden one: three taps in, there is no
       surface on the map at all. */
    expect(container.innerHTML).toBe('');
  });

  it('announces the sentence politely, and never as an alert', () => {
    render(createElement(Toast, { message: 'You are now a haKCer!' }));
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('You are now a haKCer!');
    /* `alert` would cut across whatever a screen reader was saying for the
       sake of a joke. This interrupts nothing. */
    expect(screen.queryByRole('alert')).toBeNull();
    expect(el).toHaveClass('fwm-pxtoast');
  });
});
