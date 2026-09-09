/**
 * DESIGN TOKENS, HANDED TO A RENDERER THAT CANNOT READ CSS.
 *
 * MapLibre paint properties are values in a style object, evaluated by a WebGL
 * shader. `var(--fwm-alert-in-range)` means nothing to it -- there is no
 * cascade and no element to resolve against.
 *
 * So the tokens are read off the document once, at the moment a style is built,
 * and passed in as literals. That keeps `tokens.css` the single place any
 * colour is decided: change a token, restyle the map. The alternative -- a
 * second copy of the palette written into the map code -- is the thing this
 * codebase's design gate exists to prevent, and it would drift within a week.
 *
 * The same trick the coverage field already uses for its ramp; see
 * `sweep/components/HeatLayer.tsx`.
 */

/** Tokens the map needs. Named here so the list is greppable from tokens.css. */
export const MAP_TOKENS = [
  '--fwm-bg',
  // The map's own ground. `readPalette` only resolves what is in this list, so
  // a token absent here is never fetched however carefully it is defined.
  '--fwm-map-earth',
  '--fwm-map-water',
  '--fwm-text',
  '--fwm-text-2',
  '--fwm-line',
  '--fwm-accent-scan',
  '--fwm-alert-clear',
  '--fwm-alert-approaching',
  '--fwm-alert-in-range',
  '--fwm-alert-multiple',
  '--fwm-plasma-0',
  '--fwm-plasma-2',
  '--fwm-plasma-4',
  '--fwm-plasma-6',
  '--fwm-plasma-8',
  '--fwm-plasma-10',
  /*
   * THE OWNER TAXONOMY, WHICH THE MARKERS NOW READ INSTEAD OF APPROXIMATING.
   *
   * `layers.ts` picked its five marker colours out of the ALERT ramp plus a
   * plasma step, which put the map a shade away from every other surface that
   * names an owner: LAYERS, the intel card and the dock all read `--dr-owner-*`.
   * Two of the five actually disagreed -- private drew #D45BAE against the
   * panel's #FF8DA5, and unverified drew the scan cyan against the purple the
   * owner chose on 2026-09-08 -- so the same camera was two colours depending on
   * which surface a driver was looking at.
   *
   * These are the tokens, so the three pale skins re-cut them here too, which
   * the alert ramp did not do for this purpose.
   */
  '--dr-owner-police',
  /* inter-agency is named for the company whose network it is. */
  '--dr-owner-flock',
  '--dr-owner-hoa',
  '--dr-owner-private',
  '--dr-owner-unverified',
] as const;

export type MapToken = (typeof MAP_TOKENS)[number];

export type Palette = Readonly<Record<MapToken, string>>;

/**
 * What a token falls back to when there is no document to read.
 *
 * Not a palette: ONE neutral grey, used for every token, and only in a
 * headless environment. A per-token fallback table would be a second copy of
 * the design system -- exactly what this file exists to avoid -- and it would
 * be the copy nobody updates. A map rendered entirely in grey is obviously
 * wrong, which is the correct way for a missing document to fail.
 */
export const FALLBACK_COLOUR = 'rgb(128, 128, 128)';

/**
 * Resolve an arbitrary list of tokens off an element, or fall back.
 *
 * THE READER IS GENERIC BECAUSE THERE ARE TWO LISTS NOW. `flavors.ts` builds
 * the two custom Protomaps flavours out of `--fwm-carto-*`, which is the same
 * problem this file already solved -- a renderer that cannot read CSS, given
 * literals resolved off the document at build time -- and a second
 * `getComputedStyle` loop written next door is the copy that stops matching
 * this one the first time either is touched.
 *
 * `getPropertyValue` resolves a `var()` chain, which is what lets a mode bind
 * `--fwm-map-earth: var(--fwm-carto-slate-earth)` instead of transcribing the
 * hex twice. Two sources for one fact is the setup that drifts.
 */
export function readTokens<T extends string>(
  tokens: readonly T[],
  element?: Element | null,
): Readonly<Record<T, string>> {
  const target = element ?? globalThis.document?.documentElement ?? null;
  const out: Record<string, string> = {};
  if (target === null || typeof globalThis.getComputedStyle !== 'function') {
    for (const token of tokens) out[token] = FALLBACK_COLOUR;
    return out as Record<T, string>;
  }
  const style = globalThis.getComputedStyle(target);
  for (const token of tokens) {
    const value = style.getPropertyValue(token).trim();
    out[token] = value === '' ? FALLBACK_COLOUR : value;
  }
  return out as Record<T, string>;
}

/** Read the tokens off an element, or fall back. */
export function readPalette(element?: Element | null): Palette {
  return readTokens(MAP_TOKENS, element);
}
