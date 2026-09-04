/**
 * LIQUID GLASS - how much the floating chrome blurs what is behind it.
 *
 * =============================================================================
 * WHY THIS IS A REAL SETTING AND NOT A COMMENT
 * =============================================================================
 * v1's SETTINGS draws a switch and a Light/Medium/Heavy level for it. The first
 * pass shipped without the control on the grounds that `--fwm-surface-glass`
 * and `--fwm-glass-blur` were fixed, so a switch would move nothing - a control
 * that does not control being worse than an absent one.
 *
 * That was the wrong half of the problem to solve. The blur is the single
 * loudest thing about v1: it is on the dock, on every DRIVE control, on the
 * closest card and on the report sheet, and it is also the most expensive thing
 * the app paints. A driver on a slower phone, or one who simply finds it
 * mushy over a busy map, had no way to turn it down. So the setting exists now
 * and the tokens follow it.
 *
 * =============================================================================
 * OFF IS NOT A DEGRADED STATE
 * =============================================================================
 * `off` is a real design, not glass-with-the-blur-removed: the surfaces go
 * OPAQUE. A translucent panel with no blur is the worst of both - it neither
 * separates from the map nor lets you read what is behind it - and it is what
 * you get by setting the blur radius to zero and changing nothing else.
 *
 * =============================================================================
 * TWO LIGHT MODES OVERRIDE ALL OF THIS, AND KEEP DOING SO
 * =============================================================================
 * `refinement` and `e-ink` are paper. Paper does not glow and does not blur,
 * and their own blocks in `tokens.css` say so at a higher specificity than
 * anything here. The level is still stored - a driver who switches back to a
 * dark mode gets the level they chose - it just does not paint on those two.
 */

export const GLASS_ATTRIBUTE = 'data-fwm-glass';

/**
 * The four steps, as the design names them.
 *
 * `off` first because it is the fallback for anything unrecognised, and a
 * stored value nobody can read must land on the cheapest, most legible option
 * rather than the most decorative one.
 */
export const FWM_GLASS_LEVELS = ['off', 'light', 'medium', 'heavy'] as const;

export type FwmGlass = (typeof FWM_GLASS_LEVELS)[number];

/**
 * MEDIUM is the default, and the reason is heat.
 *
 * `backdrop-filter` is not a paint, it is a read-back: the compositor copies
 * the pixels behind the element and blurs them, once per element per frame,
 * over a MapLibre canvas that repaints continuously. The cost scales with the
 * radius. Heavy shipped as the default and the phone got hot enough to notice
 * in the hand.
 *
 * Medium still reads as frost. Heavy is one tap away for a phone that can
 * afford it, and OFF is there for one that cannot - which is the whole reason
 * this is a setting rather than a constant.
 */
export const DEFAULT_GLASS: FwmGlass = 'medium';

export const GLASS_LABELS: Readonly<Record<FwmGlass, string>> = Object.freeze({
  off: 'Off',
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
});

export const GLASS_NOTES: Readonly<Record<FwmGlass, string>> = Object.freeze({
  off: 'no blur. cheapest to draw, and the sharpest map underneath.',
  light: 'a little frost.',
  medium: 'the design file\u2019s own setting.',
  heavy: 'fully frosted. the most expensive thing this app paints.',
});

// ---------------------------------------------------------------------------
// Liquid glass, which is a different thing from frost
// ---------------------------------------------------------------------------

/**
 * REFRACTION, NOT SCATTERING.
 *
 * Frost blurs what is behind a panel. Liquid glass BENDS it - the panel acts as
 * a lens, so straight lines behind it curve, hardest at the rim where a real
 * lens is thickest, and the colour fringes slightly because glass disperses.
 * Those are different physical effects and this app shipped the first one under
 * the second one's name.
 *
 * IT WAS REAL REFRACTION AND IT HAD TO GO. The first version put an SVG
 * displacement filter into `backdrop-filter`: nine primitives, including three
 * displacement passes for the colour fringe, across roughly ten glass elements,
 * over a map canvas that repaints continuously. `feDisplacementMap` is a
 * per-pixel gather with no hardware fast path the way `blur()` has one. It
 * tanked the frame rate on a real phone, and there is no cheap version - the
 * cost is inherent to snapshotting the backdrop and resampling it every frame.
 *
 * What ships now is PAINT: a sheen where the surface curves away and a bright
 * inset rim where a lens would be thickest. Straight lines behind the glass do
 * not bend. It buys the READ of liquid glass - curved and lit rather than flat
 * and frosted - for two gradients the compositor draws alongside the fill that
 * was already there, and no extra read-back at all.
 *
 * The UI calls it a look rather than physics, because that is what it is.
 */
export const LIQUID_ATTRIBUTE = 'data-fwm-liquid';

export const FWM_LIQUID_LEVELS = ['off', 'on'] as const;

export type FwmLiquid = (typeof FWM_LIQUID_LEVELS)[number];

/**
 * ON, by owner decision: the refraction is part of how the product is meant to
 * look, not an effect you opt into. It was `off` while the look was being
 * judged. It has been judged.
 */
export const DEFAULT_LIQUID: FwmLiquid = 'on';

export const LIQUID_LABELS: Readonly<Record<FwmLiquid, string>> = Object.freeze({
  off: 'Off',
  on: 'On',
});

export const LIQUID_NOTES: Readonly<Record<FwmLiquid, string>> = Object.freeze({
  off: 'flat frosted panels.',
  on: 'panels get a lit edge and a curved sheen, so they read as glass rather than as frosted card. it is paint, not refraction - nothing behind them actually bends - and it costs no extra work per frame.',
});

export function isLiquid(value: unknown): value is FwmLiquid {
  return typeof value === 'string' && (FWM_LIQUID_LEVELS as readonly string[]).includes(value);
}

export function resolveLiquid(value: unknown): FwmLiquid {
  return isLiquid(value) ? value : DEFAULT_LIQUID;
}

export function applyLiquid(value: FwmLiquid, root?: HTMLElement): void {
  const el = root ?? globalThis.document?.documentElement;
  if (el === undefined || el === null) return;
  el.setAttribute(LIQUID_ATTRIBUTE, value);
}

export function isGlass(value: unknown): value is FwmGlass {
  return typeof value === 'string' && (FWM_GLASS_LEVELS as readonly string[]).includes(value);
}

export function resolveGlass(value: unknown): FwmGlass {
  return isGlass(value) ? value : DEFAULT_GLASS;
}

/**
 * Write the attribute the token layer selects on.
 *
 * WRITTEN FOR EVERY VALUE, including the default: a bare `:root` block and a
 * `[data-fwm-glass="off"]` block differ in specificity, and leaving the
 * attribute absent for one value would make that one value the only one the
 * overrides cannot reach. (`applyDesign` carried the same note until v0 was
 * removed and the design attribute went with it.)
 */
export function applyGlass(value: FwmGlass, root?: HTMLElement): void {
  const element = root ?? globalThis.document?.documentElement;
  element?.setAttribute(GLASS_ATTRIBUTE, value);
}

/* ===========================================================================
 * TRANSPARENCY - a SECOND axis, and deliberately not the same control.
 *
 * Blur and opacity were one setting, and they are two different questions.
 * Blur is what makes a panel read as glass rather than as a tinted rectangle;
 * it is also the expensive half, and the half a slower phone wants turned down.
 * Opacity is how much of the map you want to see THROUGH the chrome, which is
 * a legibility preference and costs nothing.
 *
 * Somebody who wants the frosted look on a fast phone but cannot read a card
 * with the road showing through it had no way to say so, and neither did
 * somebody who wants to see the map through solid-cheap panels.
 * ======================================================================== */

export const CLEAR_ATTRIBUTE = 'data-fwm-clear';

export const FWM_CLEAR_LEVELS = ['solid', 'low', 'medium', 'high'] as const;

export type FwmClear = (typeof FWM_CLEAR_LEVELS)[number];

/**
 * MEDIUM is the default. At high transparency the moving map supplies most of
 * the background behind 11px labels, so their contrast changes road by road.
 * Medium is the design file's own setting and gives the chrome enough body to
 * be a stable reading surface. High remains one tap away.
 */
export const DEFAULT_CLEAR: FwmClear = 'medium';

export const CLEAR_LABELS: Readonly<Record<FwmClear, string>> = Object.freeze({
  solid: 'Solid',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
});

export const CLEAR_NOTES: Readonly<Record<FwmClear, string>> = Object.freeze({
  solid: 'opaque panels. nothing shows through.',
  low: 'a hint of the map behind the chrome.',
  medium: 'the design file\u2019s own setting.',
  high: 'the map reads clearly through every panel.',
});

export function isClear(value: unknown): value is FwmClear {
  return typeof value === 'string' && (FWM_CLEAR_LEVELS as readonly string[]).includes(value);
}

export function resolveClear(value: unknown): FwmClear {
  return isClear(value) ? value : DEFAULT_CLEAR;
}

/** Written for every value, for the same specificity reason as the design. */
export function applyClear(value: FwmClear, root?: HTMLElement): void {
  const element = root ?? globalThis.document?.documentElement;
  element?.setAttribute(CLEAR_ATTRIBUTE, value);
}

/* =============================================================================
 * THE TONE - what the glass is MADE OF, as opposed to how much of it there is.
 * =============================================================================
 * The other two axes are quantities: how much blur, how much you can see
 * through. Neither of them can answer the question Apple's own Liquid Glass
 * picker asks, which is whether the material carries a COLOUR at all.
 *
 *   CLEAR    the panel adds light, not colour. A near-neutral veil, and the
 *            saturation of whatever is behind it is pushed UP rather than
 *            washed out - which is the single thing that separates liquid
 *            glass from frosted glass. Colours behind a real lens get more
 *            vivid at the edges, not greyer.
 *
 *   TINTED   the panel carries the theme's own channel, which is what this app
 *            has always painted. More legible over a busy map, and the right
 *            answer in direct sun where a clear panel is just glare.
 *
 * ORTHOGONAL TO TRANSPARENCY ON PURPOSE. `clear` here is not "more see
 * through" - that is `data-fwm-clear`, and both tones honour it. This decides
 * WHICH channel the alpha is applied to, so the two controls cannot fight.
 * ========================================================================== */

export const TONE_ATTRIBUTE = 'data-fwm-tone';

export const FWM_GLASS_TONES = ['clear', 'tinted'] as const;

export type FwmGlassTone = (typeof FWM_GLASS_TONES)[number];

/**
 * TINTED, by owner decision.
 *
 * `clear` held this on the argument that it looks most like the material the
 * control is named after. Tinted is what the app painted before the tone
 * existed and it is what the product ships as; clear stays one tap away.
 */
export const DEFAULT_TONE: FwmGlassTone = 'tinted';

export const TONE_LABELS: Readonly<Record<FwmGlassTone, string>> = Object.freeze({
  clear: 'Clear',
  tinted: 'Tinted',
});

export const TONE_NOTES: Readonly<Record<FwmGlassTone, string>> = Object.freeze({
  clear: 'the panel adds light rather than colour, and what is behind it gets more vivid, not greyer.',
  tinted: 'the panel carries the theme’s own colour. easier to read over a busy map or in the sun.',
});

export function isTone(value: unknown): value is FwmGlassTone {
  return typeof value === 'string' && (FWM_GLASS_TONES as readonly string[]).includes(value);
}

export function resolveTone(value: unknown): FwmGlassTone {
  return isTone(value) ? value : DEFAULT_TONE;
}

export function applyTone(value: FwmGlassTone, root?: HTMLElement): void {
  const element = root ?? globalThis.document?.documentElement;
  element?.setAttribute(TONE_ATTRIBUTE, value);
}
