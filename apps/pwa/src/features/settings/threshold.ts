/**
 * The alert threshold, as SETTINGS renders it.
 *
 * SOURCE: `Flockys Design System.dc.html` section 04, panel
 * `TOGGLE · SLIDER · CHIPS` -- the only place the threshold control is drawn:
 *
 *     ALERT AT                                    500 FT
 *     [========================o                        ]
 *     100                                            1000
 *
 * and `Flockys Watch.dc.html` `W10 · THRESHOLD - ROTARY BEZEL`, which sets the
 * SAME value from the wrist: `ALERT AT` / `500` / `FT` /
 * `TURN BEZEL · 50 FT STEPS`. Section 07 restates it as a rule:
 * "rotary bezel = threshold".
 *
 * =============================================================================
 * NO NUMBER IN THIS FILE IS THIS FILE'S
 * =============================================================================
 * 100, 1000 and 50 are `@fwm/core`'s `ALERT_THRESHOLD_MIN_FT`,
 * `ALERT_THRESHOLD_MAX_FT` and `ALERT_THRESHOLD_STEP_FT`, reached through
 * `stores/fwmCore.ts` -- the one wiring point the stores already use. A second
 * copy here would be a second place for the bezel and the slider to disagree
 * about what a detent is, and the copy that drifts is always the one nobody
 * remembered.
 *
 * =============================================================================
 * WHY THE STOP LIST IS MATERIALISED
 * =============================================================================
 * The bezel has detents, so the slider has stops: nineteen of them. The list is
 * built once and exported because `settings.css` carries one rule per stop --
 * the fill width and the knob offset are keyed off `data-fwm-threshold-ft`,
 * because setting either from JavaScript would mean an inline style, and inline
 * styles are how raw values get past `scripts/check-design-values.mjs`.
 *
 * =============================================================================
 * THE STYLESHEET IS NOT GENERATED. IT IS TRANSCRIBED, AND CHECKED.
 * =============================================================================
 * Nothing generates `settings.css`'s nineteen detent rules and nothing reads
 * them back: `apps/pwa/vitest.config.ts` sets `css: false`, so an imported
 * stylesheet -- including `./settings.css?raw` -- is the empty string, and
 * `apps/pwa/tsconfig.json` ships no `@types/node`, so a test cannot read the
 * file off disk either. {@link THRESHOLD_STOPS} is derived from the engine's
 * three numbers; the rules are hand-written. Those are two different sources,
 * and a claim that they are "generated from the same three numbers" would be
 * false.
 *
 * So the transcription is stated once, as data, in {@link THRESHOLD_CSS_STOPS},
 * and `threshold.test.tsx` asserts it equals {@link THRESHOLD_STOPS}. A change
 * to `ALERT_THRESHOLD_MIN_FT` / `_MAX_FT` / `_STEP_FT` that nobody carried into
 * the stylesheet now fails a test instead of pinning the knob to the far left
 * while the readout says `125 FT`. And for the value that slips through anyway,
 * {@link hasDetentRule} lets `ThresholdControl` mark itself uncovered so the
 * drawn fill and knob are withheld rather than drawn in the wrong place --
 * a knob at 0% under a `125 FT` readout is invented data wearing a measurement.
 * GAP: see docs/gaps-inbox/settings.md#threshold-detent-rules-are-not-machine-checked
 */

import {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
  snapThresholdFt,
} from '../../stores/fwmCore.ts';

/** `ALERT AT` -- section 04's label, and W10's, unchanged. */
export const THRESHOLD_LABEL = 'ALERT AT';

/** The scale ends section 04 prints under the track: `100` and `1000`. */
export const THRESHOLD_MIN_LABEL = String(ALERT_THRESHOLD_MIN_FT);
export const THRESHOLD_MAX_LABEL = String(ALERT_THRESHOLD_MAX_FT);

/**
 * Every value the control can take, low to high: 100, 150, ... 1000.
 *
 * Derived from the engine's bounds and step rather than written out, so a
 * change to either produces a different list here and a matching set of rules
 * in `settings.css` -- which is exactly the moment somebody should notice.
 */
export const THRESHOLD_STOPS: readonly number[] = Object.freeze(buildStops());

function buildStops(): number[] {
  const stops: number[] = [];
  for (let ft = ALERT_THRESHOLD_MIN_FT; ft <= ALERT_THRESHOLD_MAX_FT; ft += ALERT_THRESHOLD_STEP_FT) {
    stops.push(ft);
  }
  return stops;
}

/**
 * The nearest legal stop to an arbitrary number.
 *
 * The engine's own snapper, re-exported under a local name so this feature has
 * one place that answers "is this a threshold a driver could have chosen".
 * `<input type="range">` already emits stepped values; a browser that rounds
 * differently, or a value read back off a stale persisted blob, still lands on
 * a detent rather than throwing out of `setThresholdFt`.
 */
export function snapToStop(ft: number): number {
  return snapThresholdFt(ft);
}

/** `500` -> `500 FT`. Section 04 prints the unit joined to the value. */
export function formatThresholdFt(ft: number): string {
  return `${String(ft)} FT`;
}

/**
 * Every value `settings.css` declares a `--fwm-settings-threshold-at` rule for.
 *
 * TRANSCRIBED FROM THE STYLESHEET, deliberately by hand, because nothing can
 * read the stylesheet back at test time (see the file header). This is the
 * second of the two sources, written down so the two can be compared: if it
 * ever stops equalling {@link THRESHOLD_STOPS}, `threshold.test.tsx` fails and
 * names the drift. Keep it in step with the block at the bottom of
 * `settings.css` -- one entry per rule, in the same order.
 */
export const THRESHOLD_CSS_STOPS: readonly number[] = Object.freeze([
  100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000,
] as const satisfies readonly number[]);

/**
 * True when `settings.css` can actually draw this value.
 *
 * The drawn fill and knob are withheld when it is false: `--fwm-settings-
 * threshold-at` would fall back to the `0` declared on `.fwm-settings`, and a
 * knob pinned to the floor under a readout that says something else is a
 * picture of a number the driver did not choose.
 */
export function hasDetentRule(ft: number): boolean {
  return THRESHOLD_CSS_STOPS.includes(ft);
}

/**
 * The stop index, 0-based, or -1 when the value is not a stop.
 *
 * Used by the tests and by nothing on the render path: the CSS keys off the
 * value itself, not the index, so a mis-generated rule fails loudly as a
 * missing fill rather than silently as an off-by-one.
 */
export function stopIndex(ft: number): number {
  return THRESHOLD_STOPS.indexOf(ft);
}
