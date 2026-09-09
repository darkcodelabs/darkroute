/**
 * THE MAP VIEW - which basemap cartography is drawn under the app.
 *
 * =============================================================================
 * THESE ARE REAL, AND THEY ALREADY SHIPPED
 * =============================================================================
 * `@protomaps/basemaps` publishes five named flavours - light, dark, white,
 * black, grayscale - and every one is already in the bundle. The app used
 * exactly two of them, chosen for you: BLACK for eight modes and LIGHT for
 * `refinement`, hard-coded in a two-line function nobody could reach.
 *
 * A basemap is not a theme. The theme is the app's chrome; this is the ground
 * the app is drawn on, and which one reads best depends on the light you are
 * driving in far more than on which palette you like. At night black is the
 * only one that does not blind you; in direct sun white is the only one you can
 * see at all; grayscale is the one that lets the camera dots be the only
 * coloured things on the screen, which is arguably what this product is for.
 *
 * =============================================================================
 * AUTO IS THE DEFAULT AND KEEPS THE OLD BEHAVIOUR
 * =============================================================================
 * `auto` follows the theme, which is what the app did before this existed. A
 * driver who never opens the control sees no change.
 */

export const FWM_MAP_VIEWS = ['auto', 'black', 'dark', 'grayscale', 'light', 'white'] as const;

export type FwmMapView = (typeof FWM_MAP_VIEWS)[number];

export const DEFAULT_MAP_VIEW: FwmMapView = 'auto';

/** What each flavour is actually FOR, rather than what colour it is. */
export const MAP_VIEW_LABELS: Readonly<Record<FwmMapView, string>> = Object.freeze({
  auto: 'Match theme',
  black: 'Black',
  dark: 'Dark',
  grayscale: 'Greyscale',
  light: 'Light',
  white: 'White',
});

export const MAP_VIEW_NOTES: Readonly<Record<FwmMapView, string>> = Object.freeze({
  auto: 'follows whichever theme you picked. what the app did before this control existed.',
  black: 'true black. the least light a phone can emit at night.',
  dark: 'dark but not black - roads read as roads rather than as outlines.',
  grayscale: 'no colour at all in the map, so the camera dots are the only coloured things on it.',
  light: 'daylight cartography.',
  white: 'maximum contrast for direct sun.',
});

export function isMapView(value: unknown): value is FwmMapView {
  return typeof value === 'string' && (FWM_MAP_VIEWS as readonly string[]).includes(value);
}

export function resolveMapView(value: unknown): FwmMapView {
  return isMapView(value) ? value : DEFAULT_MAP_VIEW;
}

/**
 * The next view in the list.
 *
 * =============================================================================
 * THE MAP KEY NO LONGER CYCLES, AND THIS COMMENT USED TO SAY IT DID
 * =============================================================================
 * This was written for a 48px key on DRIVE's rail that advanced the cartography
 * by one, on the grounds that a driver comparing two flavours wants to flip
 * between them rather than open a sheet. That reasoning holds for two states
 * and fails at six: reaching a named flavour cost up to five presses, and on
 * DRIVE `MAP_VIEW_LABELS` only ever appeared in the key's `aria-label`, so a
 * sighted driver could not tell which of the six they were on except by looking
 * at the ground.
 *
 * The "full list with its reasons" this comment promised was in SETTINGS is
 * genuinely there - `SettingsViewV1.tsx:437` renders `MAP_VIEW_NOTES` for the
 * current flavour and `:453` names all six. An earlier draft of this note
 * claimed it "had no reader at all", which was simply wrong. The problem was
 * that reading it meant leaving the screen you were driving on.
 *
 * The key now opens `features/map/MapControlPanel.tsx`, which lists all six by
 * name with the reason for each, alongside the map's owner filter. The
 * comparison the cycle was for is still one press per flavour there, and that
 * panel deliberately stays open while you make it.
 *
 * KEPT rather than deleted: "the one after this" is a reasonable thing to be
 * able to ask an ordered list for, and removing an exported pure function is a
 * separate decision from changing a control. Nothing in the app calls it today.
 */
export function nextMapView(view: FwmMapView): FwmMapView {
  const at = FWM_MAP_VIEWS.indexOf(view);
  return FWM_MAP_VIEWS[(at + 1) % FWM_MAP_VIEWS.length] ?? DEFAULT_MAP_VIEW;
}
