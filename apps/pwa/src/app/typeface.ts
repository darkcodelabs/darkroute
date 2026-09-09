/**
 * THE UI TYPEFACE - which face the words are set in, and who chooses.
 *
 * =============================================================================
 * WHY THERE IS A CHOICE AT ALL
 * =============================================================================
 * The product shipped in Chakra Petch, which is a display face: angular, wide,
 * and with a lot of personality. It suits the instrument panel and it is harder
 * to read at a glance than a neutral grotesque, which matters on a screen
 * somebody looks at for half a second while driving.
 *
 * The original bundled faces are the default. The neutral platform face remains
 * available because "the app looks different" is a legitimate objection and a
 * font is exactly the kind of preference people hold strongly. It is one
 * setting away.
 *
 * =============================================================================
 * BOTH FACES MOVE
 * =============================================================================
 * This originally changed only `--fwm-font-ui`, holding the mono back on the
 * grounds that the instrument numbers are aligned on a monospace advance. The
 * effect was that the setting did almost nothing visible: nearly every label on
 * RADAR carries `.fwm-data`, so the screen kept its old face and the choice
 * looked broken.
 *
 * The alignment is protected where it always was. `.fwm-data` sets
 * `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum" 1`,
 * which pins each digit to one advance in any face carrying tabular figures.
 * The mono was a second guarantee on top of that one, not the only one.
 *
 * =============================================================================
 * WHY IT IS AN ATTRIBUTE AND NOT A STYLE
 * =============================================================================
 * Same reason as the text scale: the token lives in `tokens.css` next to every
 * other token, the override is one rule in the same file, and nothing has to
 * import a font stack into a component. A component that hard-coded a family
 * would be invisible to the design gate and would not follow the setting.
 */

export const TYPEFACE_ATTRIBUTE = 'data-fwm-typeface';

export const TYPEFACES = ['original', 'system'] as const;

export type Typeface = (typeof TYPEFACES)[number];

export const DEFAULT_TYPEFACE: Typeface = 'original';

/** What each option is called in SETTINGS. */
export const TYPEFACE_LABELS: Readonly<Record<Typeface, string>> = Object.freeze({
  original: 'ORIGINAL',
  system: 'SYSTEM',
});

export function isTypeface(value: unknown): value is Typeface {
  return typeof value === 'string' && (TYPEFACES as readonly string[]).includes(value);
}

/** Anything unrecognised becomes the default rather than throwing. */
export function resolveTypeface(value: unknown): Typeface {
  return isTypeface(value) ? value : DEFAULT_TYPEFACE;
}

/**
 * Put the choice on the document.
 *
 * The DEFAULT writes no attribute at all, so the bare `:root` rule in
 * `tokens.css` is the default face and there is exactly one place that says
 * what it is. Writing `data-fwm-typeface="original"` would mean the default
 * was expressed twice and could drift.
 */
export function applyTypeface(value: unknown, root?: HTMLElement): Typeface {
  const typeface = resolveTypeface(value);
  const element = root ?? globalThis.document?.documentElement;
  if (element === undefined || element === null) return typeface;
  if (typeface === DEFAULT_TYPEFACE) element.removeAttribute(TYPEFACE_ATTRIBUTE);
  else element.setAttribute(TYPEFACE_ATTRIBUTE, typeface);
  return typeface;
}

/** What the document is currently set to, read back from the attribute. */
export function currentTypeface(root?: HTMLElement): Typeface {
  const element = root ?? globalThis.document?.documentElement;
  return resolveTypeface(element?.getAttribute(TYPEFACE_ATTRIBUTE) ?? DEFAULT_TYPEFACE);
}
