/**
 * TEXT SIZE.
 *
 * The design system's type ramp bottoms out at `--fwm-text-micro`, .6875rem -
 * 11px at a browser default of 16. That is the size of every label on the
 * product: SPEED, HEADING, TODAY, REP, SET, VOL, the dock keys. On a phone held
 * at arm's length in a car it is too small to read, and the driver has no way
 * to do anything about it, because:
 *
 *   - the type ramp is fixed in the design file, so it cannot simply be
 *     redrawn larger without leaving the system;
 *   - `index.html` sets `user-scalable=no` (required verbatim by section 06),
 *     so pinch-zoom is not available as a fallback;
 *   - a correct `width=device-width` viewport opts the page out of Chrome's
 *     font boosting, so Android's own "Text scaling" setting does not reach it
 *     either.
 *
 * So the product owes the driver a control of its own. This is it.
 *
 * HOW IT WORKS, AND WHY IT SCALES ONLY TYPE
 *   Every type token is in `rem`, and every spacing, touch-target and chrome
 *   height token is in `px`. So setting the ROOT font size scales the whole
 *   type ramp proportionally and leaves the 44px touch minimum, the 64px dock
 *   and the 52px header exactly where the design put them. That is the right
 *   split for a car: bigger words, and controls that stay where the driver's
 *   thumb learned they were.
 *
 *   The consequence is that text can outgrow a box that was drawn around
 *   smaller text, which is why the scale is capped rather than open-ended.
 *
 * WHY IT IS APPLIED HERE AND NOT IN A COMPONENT
 *   Same reason as the mode: applying it from a React effect paints one frame
 *   at the old size. It is set synchronously on `documentElement` before the
 *   first render, exactly like `data-fwm-mode` and `data-fwm-surface`.
 */

/** The root size, in px, that the design's rem values were drawn against. */
export const BASE_FONT_PX = 16;

/**
 * The offered steps.
 *
 * 1 is the design as drawn. 1.5 is the ceiling because above it the hero
 * readout (5rem = 80px at 1.0) stops fitting beside the ring on a 360dp phone,
 * and a distance the driver cannot see all of is worse than a smaller one they
 * can.
 *
 * .875 exists for the people who asked for more on screen at once, not as an
 * accessibility option. It SHIPPED as the default briefly and was reverted:
 * below the drawn size is a fine thing to offer and a bad thing to assume,
 * because the assumption lands on every install including the readers who
 * would never go looking for this row. The steps above 1 are the
 * accessibility range and nothing may treat 1 as a ceiling.
 */
export const TEXT_SCALES = [0.875, 1, 1.125, 1.25, 1.375, 1.5] as const;

export type TextScale = (typeof TEXT_SCALES)[number];

/* The design as drawn. Anyone who wants more on screen can choose .875. */
export const DEFAULT_TEXT_SCALE: TextScale = 1;

export const TEXT_SCALE_ATTRIBUTE = 'data-fwm-text-scale';

export function isTextScale(value: unknown): value is TextScale {
  return typeof value === 'number' && (TEXT_SCALES as readonly number[]).includes(value);
}

/** The nearest offered step. Anything unreadable falls back to the default. */
export function resolveTextScale(value: unknown): TextScale {
  if (isTextScale(value)) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TEXT_SCALE;
  let best: TextScale = DEFAULT_TEXT_SCALE;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const step of TEXT_SCALES) {
    const distance = Math.abs(step - value);
    if (distance < bestDistance) {
      best = step;
      bestDistance = distance;
    }
  }
  return best;
}

/** The label a control shows for a step. */
export function formatTextScale(scale: TextScale): string {
  return `${Math.round(scale * 100)}%`;
}

/**
 * Apply a scale to the document root.
 *
 * Writes the root font size AND a data attribute: the font size is what does
 * the work, and the attribute is what a CSS rule or a test can key off without
 * parsing a computed pixel value back into a ratio.
 */
export function applyTextScale(value: unknown, root?: HTMLElement): TextScale {
  const scale = resolveTextScale(value);
  const element = root ?? globalThis.document?.documentElement;
  if (element === undefined || element === null) return scale;
  element.style.fontSize = `${BASE_FONT_PX * scale}px`;
  element.setAttribute(TEXT_SCALE_ATTRIBUTE, String(scale));
  return scale;
}

/** What the document is currently set to, read back from the attribute. */
export function currentTextScale(root?: HTMLElement): TextScale {
  const element = root ?? globalThis.document?.documentElement;
  const raw = element?.getAttribute(TEXT_SCALE_ATTRIBUTE);
  return raw === null || raw === undefined ? DEFAULT_TEXT_SCALE : resolveTextScale(Number(raw));
}
