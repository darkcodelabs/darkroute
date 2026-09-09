/**
 * THE PIXEL SWEEP -- sections D and E of `searchbar_and_buttons.dc.html`.
 *
 * A 96x11 grid of pixels laid inside the search bar, each one popping to full
 * and decaying on a per-COLUMN delay, so the whole thing reads as a straight
 * front travelling across the glass. It is the mark's own pixel vocabulary,
 * and it carries three meanings and no others:
 *
 *   left to right      something is ahead of you
 *   every column at once you are in the cone NOW -- a camera flash, not a wave
 *   right to left      it is behind you
 *
 * THREE DOCK STATES ANIMATE AND SIXTEEN DO NOT, and the silence is the point:
 * a bar that moved for navigating, muted, offline, GPS weak, mesh sync, dense
 * area, auto-rerouted, unmapped, arrived, idle, armed, expanded and cruising
 * would be a bar that means nothing when it moves. Nothing in this file can
 * fire for any state but the three, because the only thing it accepts is one
 * of three names.
 *
 * =============================================================================
 * THE FIVE THINGS THIS FILE EXISTS TO GET RIGHT
 * =============================================================================
 * 1. LAYERING. The grid is `z-index: 0` under content at 1, blending `screen`.
 *    `pixelSweep.css` section 6 has that half; `topBar.css` section 2 has the
 *    other. Without both, the sweep brightens through the wordmark.
 *
 * 2. A STRAIGHT FRONT. Delay is `pos * travel + rnd() * jitter` where `pos`
 *    comes from the COLUMN and nothing else, so all eleven rows of a column
 *    fire together. The spec page's builder carries a per-row `bow` term and
 *    every call site passes zero; bowing it and tapering its density
 *    vertically were both tried and rejected, and neither is here.
 *
 * 3. JITTER <= 0.05s. 96 columns over 1.9s puts the columns 20ms apart, so a
 *    jitter any larger than a column's own step smears the leading edge into a
 *    shimmer. `SWEEP_JITTER_MAX` is asserted against every gesture in the test.
 *
 * 4. LIGHT THEME BLENDS `multiply`. In `pixelSweep.css`, off the same three
 *    named skins `topBar.css` inverts the wordmark on.
 *
 * 5. MOUNT ONLY WHILE FIRING. The spec page keeps five grids in the tree at
 *    once so every gesture is visible on a static page -- ~2,500 animated
 *    nodes, permanently. Here `useChromeSweep` holds ONE slot, fills it on a
 *    trigger and empties it the moment the pass is over. Idle is zero nodes.
 *
 * =============================================================================
 * WHAT THIS FILE DOES NOT DECIDE
 * =============================================================================
 * WHEN A CAMERA IS AHEAD. It is told. `fire('approach')` is called by whatever
 * owns the dock's state, for the same reason `TopBar.tsx` is handed its count.
 *
 * WHETHER A TURN IS IN PROGRESS. It is told that too, through `noteManeuver`.
 * The brief's one genuinely dangerous failure is a driver losing a turn
 * because pixels were prettier, so nothing fires for five seconds after a
 * maneuver is drawn -- but a component that read the navigation state itself
 * would be a second copy of it, and a second copy is a copy that goes stale.
 *
 * WHAT THE ABUSE ZONE DOES. It gets NO sweep: it is territory, not proximity,
 * and borrowing the proximity gesture would say the wrong thing. The brief
 * gives it "a slow border-only pulse on the hairline, no pixels" and no
 * period, no keyframe and no alpha to draw it with, so it is not built here
 * and it is reported as an open question rather than invented.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { TOAST_DISMISS_MS, toastForTaps } from './Toast.tsx';

import './pixelSweep.css';

/* ------------------------------------------------------------------------ *
 * THE GRID
 * ------------------------------------------------------------------------ */

/** The three the dock's states map onto. There is no fourth, deliberately. */
export type SweepGesture = 'approach' | 'passing' | 'cleared';

/**
 * Everything that can occupy the bar's one sweep slot.
 *
 * `ambient` is the first-run intro and `pulse` is the easter egg; neither is a
 * status signal and both are named apart from the three so that a reader can
 * see at a glance which ones a driver is supposed to act on. `edge` is what
 * `approach` becomes when the device asks for reduced motion.
 */
export type SweepKind = SweepGesture | 'ambient' | 'pulse' | 'edge';

/**
 * THE CEILING ON JITTER, and rule 3 above in one number.
 *
 * Not a default -- a bound. Every spec below is checked against it in the
 * test, because the failure it prevents is not a crash: it is a sweep that
 * still runs, still looks busy, and no longer reads as a direction.
 */
export const SWEEP_JITTER_MAX = 0.05;

/** How long the pixels stay quiet after a maneuver is drawn, in milliseconds. */
export const SWEEP_TURN_QUIET_MS = 5000;

/** The ambient intro: five passes, one a minute, then never again. */
export const AMBIENT_PASSES = 5;
export const AMBIENT_EVERY_MS = 60000;

/**
 * THE BASE THE EASTER EGG'S PER-TAP SEED COUNTS UP FROM. See `seedForTap`.
 */
const PULSE_SEED_BASE = 1000;

/**
 * ONE GESTURE'S NUMBERS.
 *
 * Every field is transcribed from the spec page's own `buildSweep` calls or
 * from the brief's gesture table. Nothing here is derived and nothing is
 * tuned.
 */
export interface SweepSpec {
  /** Columns and rows of the grid. 96 x 11 for all five. */
  readonly cols: number;
  readonly rows: number;
  /**
   * HOW MANY OF THOSE COLUMNS CARRY PIXELS, counted from the left edge.
   *
   * 96 for every gesture except the reduced-motion degrade, which is a flash
   * at the bar's left edge and so lights the grid's own leading column alone.
   */
  readonly emitCols: number;
  /** The share of cells that land. The spec's own per-gesture occupancy. */
  readonly density: number;
  /** Seconds for the front to cross the bar. Zero is "all columns at once". */
  readonly travel: number;
  /** Seconds of scatter on top of the column delay. Never above the ceiling. */
  readonly jitter: number;
  /** Right to left. The identical comet run backwards. */
  readonly reverse: boolean;
  /** The seeded stream this grid draws from. */
  readonly seed: number;
  /**
   * The animation's duration in seconds, MIRRORING `pixelSweep.css`.
   *
   * Here as well as there because this file has to know when a pass is over in
   * order to take it out of the tree, and CSS cannot tell it. The test reads
   * the stylesheet and asserts the two agree.
   */
  readonly dur: number;
  /**
   * THE KEYFRAME'S LAST STOP, as a fraction of `dur`.
   *
   * `dr-px` is at zero from 36% onward, `dr-px-flash` from 34%, `dr-px-pulse`
   * from 55%, `dr-px-amb` from 3.4%. After that the animation is still running
   * and drawing nothing, which is exactly the state rule 5 says not to keep in
   * the tree -- so this, not `dur`, is what the unmount is timed off.
   */
  readonly hold: number;
}

/**
 * THE FIVE GESTURES.
 *
 * PASSING TRAVELS ZERO. The brief's table says `travel: 0` -- "a camera flash,
 * not a wave" -- while the spec page's own builder passes 0.12. The brief is
 * the newer of the two and states the intent in words as well as in a number,
 * so zero is what is built; it is flagged as a contradiction and it is a
 * one-character change here if the page's 0.12 was the deliberate one.
 */
export const SWEEP_SPECS: Readonly<Record<SweepKind, SweepSpec>> = {
  approach: {
    cols: 96, rows: 11, emitCols: 96,
    density: 0.44, travel: 1.9, jitter: 0.03, reverse: false,
    seed: 20260907, dur: 3.2, hold: 0.36,
  },
  passing: {
    cols: 96, rows: 11, emitCols: 96,
    density: 0.5, travel: 0, jitter: 0.05, reverse: false,
    seed: 41190228, dur: 2.4, hold: 0.34,
  },
  cleared: {
    cols: 96, rows: 11, emitCols: 96,
    density: 0.4, travel: 1.9, jitter: 0.03, reverse: true,
    seed: 90551477, dur: 3.2, hold: 0.36,
  },
  ambient: {
    cols: 96, rows: 11, emitCols: 96,
    density: 0.36, travel: 2.4, jitter: 0.035, reverse: false,
    seed: 77712203, dur: 60, hold: 0.034,
  },
  pulse: {
    cols: 96, rows: 11, emitCols: 96,
    density: 0.5, travel: 0.85, jitter: 0.03, reverse: false,
    seed: PULSE_SEED_BASE, dur: 4, hold: 0.55,
  },
  /*
   * THE REDUCED-MOTION DEGRADE.
   *
   * "A single 180ms pixel flash at the bar's left edge" is the whole of what
   * the brief says, so the whole of what is built is the grid it already
   * describes with every travelling part removed: the leading COLUMN of the
   * same 96, no travel, no jitter, and the no-travel keyframe the passing
   * gesture already uses. Nothing new is minted -- how wide "the left edge"
   * is, and which of the four profiles a flash wears, are both reported as
   * open questions rather than answered with a number nobody wrote down.
   */
  edge: {
    cols: 96, rows: 11, emitCols: 1,
    density: 0.5, travel: 0, jitter: 0, reverse: false,
    seed: 41190228, dur: 0.18, hold: 0.34,
  },
};

/**
 * A NEW SEED FOR EVERY TAP, so no two pulses land identically.
 *
 * The spec page's own arithmetic, kept rather than replaced with
 * `Math.random()`: it is a prime step off a fixed base, which means the taps
 * within one session are all different from each other AND reproducible in a
 * test. `Math.random` would be perfectly acceptable in app code here and would
 * cost the ability to assert any of it.
 */
export function seedForTap(tap: number): number {
  return PULSE_SEED_BASE + tap * 7919;
}

/** One pixel: where it sits, when it fires, and which of the six it is. */
export interface SweepCell {
  readonly col: number;
  readonly row: number;
  /** Seconds. `pos * travel + rnd() * jitter`, and nothing else. */
  readonly delay: number;
  /** 1..6, the index of a `--dr-px-*` hue. */
  readonly tone: number;
}

/** How many hues the mark's palette has. `--dr-px-1` .. `--dr-px-6`. */
const TONES = 6;

/**
 * THE GRID, AS DATA.
 *
 * Separated from the rendering so the delay formula can be asserted without a
 * DOM: the formula is the design, the `<span>`s are only how it gets painted.
 *
 * THE GENERATOR IS THE SPEC PAGE'S, to the constant. A 31-bit linear
 * congruential step, and the draws are consumed in the spec's own order --
 * occupancy, then jitter, then hue -- because changing that order changes
 * which pixels land even with the same seed, and the seeds below were chosen
 * against these streams.
 */
export function buildSweepCells(spec: SweepSpec, seed: number): readonly SweepCell[] {
  let state = seed;
  const rnd = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };

  const cells: SweepCell[] = [];
  for (let col = 0; col < spec.emitCols; col++) {
    for (let row = 0; row < spec.rows; row++) {
      // occupancy first, and a skipped cell consumes nothing further
      if (rnd() > spec.density) continue;
      /*
       * THE FRONT, AND IT IS A STRAIGHT VERTICAL LINE.
       * `pos` reads the COLUMN only, so every row of a column fires together.
       * `row` appears nowhere in this expression and that is the whole rule.
       */
      const pos = spec.reverse ? (spec.cols - 1 - col) / spec.cols : col / spec.cols;
      const delay = pos * spec.travel + rnd() * spec.jitter;
      cells.push({ col, row, delay, tone: Math.floor(rnd() * TONES) + 1 });
    }
  }
  return cells;
}

/** How long a pass is worth keeping in the tree, in milliseconds. */
export function sweepLifetimeMs(spec: SweepSpec): number {
  return (spec.travel + spec.jitter + spec.dur * spec.hold) * 1000;
}

/* ------------------------------------------------------------------------ *
 * THE COMPONENT
 * ------------------------------------------------------------------------ */

export interface PixelSweepProps {
  readonly kind: SweepKind;
  /**
   * Which stream to draw. Defaults to the gesture's own fixed seed, so an
   * approach sweep looks the same every time it fires; the easter egg passes
   * `seedForTap` instead, which is what makes each tap land differently.
   */
  readonly seed?: number | undefined;
}

export function PixelSweep({ kind, seed }: PixelSweepProps): ReactElement {
  const spec = SWEEP_SPECS[kind];
  const cells = useMemo(() => buildSweepCells(spec, seed ?? spec.seed), [spec, seed]);

  /*
   * THE ONE MOTION IN THIS FILE THAT IS NOT DECORATION.
   *
   * `global.css` stops EVERY animation under `prefers-reduced-motion: reduce`
   * -- `animation-name: none !important` on `*:not([data-fwm-motion=
   * "essential"])` -- and that blanket rule silently killed the degrade the
   * first time it was measured in a browser: the 180ms flash rendered as four
   * static pixels sitting at the left cap forever. `essential` is that file's
   * own documented opt-out, opt-in per element, for motion that carries
   * meaning rather than decoration.
   *
   * `edge` IS the meaning: it is the approach signal, and the brief degrades
   * the approach signal rather than removing it precisely because a driver
   * acts on it. The other five are decoration or are the full-motion versions
   * of it, and the same file says decorative motion may not use this.
   */
  const essential = kind === 'edge' ? 'essential' : undefined;

  return (
    /* Decoration, and announced as nothing. There is no reading of this that a
       screen reader could give that would be better than silence. */
    <div className={`fwm-pxsweep fwm-pxsweep--${kind}`} aria-hidden="true">
      {cells.map((cell) => (
        <span
          key={`${String(cell.col)}_${String(cell.row)}`}
          className={`fwm-pxsweep-cell fwm-pxsweep-c${String(cell.tone)}`}
          data-fwm-motion={essential}
          style={{
            left: `${String((cell.col / spec.cols) * 100)}%`,
            top: `${String((cell.row / spec.rows) * 100)}%`,
            /* the one per-element value, and the only one that differs */
            animationDelay: `${cell.delay.toFixed(3)}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * THE CONTROLLER
 * ------------------------------------------------------------------------ */

/** Whether the device has asked for less motion, read fresh at every trigger. */
function motionReduced(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * THE AMBIENT INTRO'S SCHEDULE, AT MODULE SCOPE.
 *
 * "Five times, then never again for the session" is a property of the SESSION
 * and not of a component, so it is held where a session is: a remount of the
 * bar must not buy five more passes, and an unmount must not cancel the ones
 * still owed. The sink is whichever controller is currently mounted, or null.
 */
let ambientLeft = AMBIENT_PASSES;
let ambientTimer: ReturnType<typeof setTimeout> | null = null;
let ambientSink: (() => void) | null = null;

function runAmbientPass(): void {
  ambientTimer = null;
  if (ambientLeft <= 0) return;
  ambientLeft -= 1;
  ambientSink?.();
  if (ambientLeft > 0) ambientTimer = setTimeout(runAmbientPass, AMBIENT_EVERY_MS);
}

/** One mounted grid: which gesture, which stream, and a key that forces a remount. */
interface MountedSweep {
  readonly kind: SweepKind;
  readonly seed: number;
  readonly key: number;
}

export interface ChromeSweep {
  /** The grid to render as the bar's FIRST child, or null when nothing fires. */
  readonly sweep: ReactElement | null;
  /** The easter egg's sentence, for `<Toast />` on the map. Null most of the time. */
  readonly toast: string | null;
  /** One pass of one gesture. Once per event -- never on a loop. */
  readonly fire: (gesture: SweepGesture) => void;
  /** The host drew a maneuver. Nothing fires for the next five seconds. */
  readonly noteManeuver: () => void;
  /** The mark was pressed. Fires a pulse and advances the counter. */
  readonly tapMark: () => void;
}

/**
 * THE ONE SLOT, AND EVERYTHING THAT COMPETES FOR IT.
 *
 * ONE grid at a time, because there is one bar. What happens when two things
 * want it at once is not in the brief, so the only rule applied is the brief's
 * own stated priority -- decoration must never displace signal, and losing a
 * signal to something prettier is the failure it calls dangerous:
 *
 *   - the three gestures always take the slot, whatever is in it;
 *   - the ambient intro and the easter egg's pulse stand down while one of the
 *     three is in flight, and take the slot otherwise.
 *
 * Which of the three wins against ANOTHER of the three is left as last-write-
 * wins, which is what the spec page's own remount-by-key does, and it is
 * reported as an open question rather than settled here.
 */
export function useChromeSweep(): ChromeSweep {
  const [mounted, setMounted] = useState<MountedSweep | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** The pass currently in the slot, readable from a callback without a re-render. */
  const liveKind = useRef<SweepKind | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quietUntil = useRef(0);
  const taps = useRef(0);
  const key = useRef(0);

  /** Put a grid in the slot and set the timer that takes it out again. */
  const show = useCallback((kind: SweepKind, seed: number): void => {
    if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    key.current += 1;
    liveKind.current = kind;
    setMounted({ kind, seed, key: key.current });
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null;
      liveKind.current = null;
      /* UNMOUNTED, NOT LEFT TO FINISH. Rule 5: an animation that has reached
         its last stop is still an animation the compositor is ticking. */
      setMounted(null);
    }, sweepLifetimeMs(SWEEP_SPECS[kind]));
  }, []);

  /** True while a maneuver is on screen or within five seconds of one. */
  const inQuietWindow = useCallback((): boolean => Date.now() < quietUntil.current, []);

  /** True while one of the three signals owns the slot. */
  const signalInFlight = useCallback((): boolean => {
    const live = liveKind.current;
    return live === 'approach' || live === 'passing' || live === 'cleared';
  }, []);

  const fire = useCallback(
    (gesture: SweepGesture): void => {
      /* THE ONE RULE THAT IS ABOUT SAFETY AND NOT ABOUT TASTE. */
      if (inQuietWindow()) return;
      if (motionReduced()) {
        /* Reduce disables all four. The approach signal is the one a driver
           acts on, so it degrades to the edge flash rather than vanishing;
           passing and cleared are confirmations and simply do not fire. */
        if (gesture === 'approach') show('edge', SWEEP_SPECS.edge.seed);
        return;
      }
      show(gesture, SWEEP_SPECS[gesture].seed);
    },
    [inQuietWindow, show],
  );

  const noteManeuver = useCallback((): void => {
    quietUntil.current = Date.now() + SWEEP_TURN_QUIET_MS;
  }, []);

  const tapMark = useCallback((): void => {
    taps.current += 1;

    /* THE PULSE. Every tap fires one, at a new seed. Not while a signal is in
       flight and not inside the quiet window: the pixels are the part that can
       cost somebody a turn, and a tap is never worth that. */
    if (!signalInFlight() && !inQuietWindow() && !motionReduced()) {
      show('pulse', seedForTap(taps.current));
    }

    /* THE SENTENCE. Words are not motion, so it is told whether or not the
       pulse was. A new tap RESETS the 3.2s rather than queueing a second pill. */
    const said = toastForTaps(taps.current);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    setToast(said);
    if (said !== null) {
      toastTimer.current = setTimeout(() => {
        toastTimer.current = null;
        setToast(null);
      }, TOAST_DISMISS_MS);
    }
  }, [inQuietWindow, show, signalInFlight]);

  /* THE AMBIENT INTRO. Five passes, one a minute, then never again -- and each
     pass is a MOUNT rather than an iteration, so nothing sits in the tree for
     the 55 seconds between them. It stands down for a signal and for reduced
     motion, and it is not a status signal, so a skipped pass is simply lost. */
  useEffect(() => {
    ambientSink = (): void => {
      if (signalInFlight() || inQuietWindow() || motionReduced()) return;
      show('ambient', SWEEP_SPECS.ambient.seed);
    };
    /* The first pass goes through the timer too, so that a development-mode
       double mount does not spend it on the copy that is about to unmount. */
    if (ambientLeft > 0 && ambientTimer === null) ambientTimer = setTimeout(runAmbientPass, 0);
    return (): void => {
      ambientSink = null;
    };
  }, [inQuietWindow, show, signalInFlight]);

  /* Nothing this hook started outlives it except the session's own schedule. */
  useEffect(
    () => (): void => {
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    [],
  );

  const sweep = useMemo(
    () =>
      mounted === null ? null : (
        <PixelSweep key={mounted.key} kind={mounted.kind} seed={mounted.seed} />
      ),
    [mounted],
  );

  return { sweep, toast, fire, noteManeuver, tapMark };
}
