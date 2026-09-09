/**
 * THE MAP'S GROUND COLOUR, WHEN THE DRIVER HAS PICKED ONE.
 * =============================================================================
 * The base map's ground is `--fwm-map-earth`, and every theme binds it to the
 * cartography that theme draws. This overwrites that one property on the root
 * element, which is an inline style and therefore wins over all seventeen
 * skins - so a chosen colour is respected in the light theme and the dark one
 * without being declared in either.
 *
 * WHY A SETTING AND NOT A COMMIT. The ground was `#162640` and it was too blue.
 * That is a judgement, it will be a judgement again in a month, and the person
 * making it should not have to open a pull request. `null` means "whatever the
 * theme says", which is now the same dark ground in both themes - see
 * `--fwm-map-earth-default` in `styles/tokens.css`.
 *
 * =============================================================================
 * WHY THE MAP HAS TO BE TOLD
 * =============================================================================
 * MapLibre resolves the ground once, into a WebGL paint value, when the style
 * is built - `features/map/mapStyle.ts` reads the computed palette because a
 * shader cannot resolve `var()`. So changing the property repaints every CSS
 * surface immediately and leaves the map on the old colour until its style is
 * rebuilt. `MapCanvas` watches for that, which is the only reason this module
 * publishes a change rather than just setting a property.
 */

const EARTH_PROPERTY = '--fwm-map-earth';

/**
 * Six-digit hex, and nothing else.
 *
 * HeatLayer's parser reads `#rrggbb` only and silently falls back on anything
 * it cannot parse - so a shorthand `#abc` or an `rgb()` here would not error,
 * it would draw the heat layer on a different ground than the map, which is a
 * seam nobody would connect back to a colour picker. The check is here rather
 * than in the settings UI because this is the function every caller reaches.
 */
const SIX_DIGIT_HEX = /^#[0-9a-f]{6}$/i;

export function isMapEarthColour(value: string): boolean {
  return SIX_DIGIT_HEX.test(value);
}

/**
 * WHAT THE PICKER OPENS ON WHEN NOTHING IS CHOSEN.
 *
 * Read off the computed style rather than written down, because the default
 * ground lives in `tokens.css` as `--fwm-map-earth-default` and a copy of it in
 * a `.tsx` would be a second source for one colour - which is exactly what the
 * design gate refuses, and rightly: the two would drift and the picker would
 * open on last month's ground.
 *
 * It falls back to the LIVE ground and then to the empty string, and writes no
 * colour of its own. A literal here would be a second source for a value that
 * already has one in `tokens.css`, which is the drift the design gate exists to
 * stop - and the browser's own default for an empty `input[type=color]` is the
 * same black a hardcoded fallback would have named, so writing it down buys
 * nothing and costs a place for the two to disagree.
 */
export function defaultMapEarth(root?: HTMLElement): string {
  const element = root ?? globalThis.document?.documentElement;
  if (element === undefined || element === null) return '';
  const style = globalThis.getComputedStyle?.(element);
  if (style === undefined) return '';
  for (const token of ['--fwm-map-earth-default', '--fwm-map-earth']) {
    const value = style.getPropertyValue(token).trim();
    if (isMapEarthColour(value)) return value;
  }
  return '';
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Told when the ground changes, so the map can rebuild its style. */
export function subscribeMapEarth(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Apply it, or clear it. An invalid value clears rather than throwing: this is
 * called on boot with whatever is in storage, and a persisted string from an
 * older build must not be able to stop the app rendering a map.
 */
export function applyMapEarth(value: string | null, root?: HTMLElement): void {
  const element = root ?? globalThis.document?.documentElement;
  if (element === undefined || element === null) return;

  if (value === null || !isMapEarthColour(value)) {
    element.style.removeProperty(EARTH_PROPERTY);
  } else {
    element.style.setProperty(EARTH_PROPERTY, value);
  }

  for (const fn of [...listeners]) fn();
}
