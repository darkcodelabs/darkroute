/**
 * EVERY MARK THE CHROME DRAWS, AND NOT ONE REDRAWN.
 *
 * `searchbar_and_buttons.dc.html` renders eleven distinct icons across its two
 * themes -- each one twice, dark and light, identical geometry both times. All
 * eleven are transcribed below, path string for path string, out of the spec's
 * own `<svg>` elements. Nothing here was simplified, re-pathed or sourced from
 * an icon set. If a mark looks wrong, the fix is in the design file.
 *
 * ONE TABLE RATHER THAN ELEVEN INLINE SVGS, because the same chevron is drawn
 * by the bar and the same question mark by the rail, and a mark copied into two
 * components is a mark that gets fixed in one of them. `components/dock/
 * icons.tsx` is the same arrangement for the dock's five, and this file is
 * written to match it.
 *
 * =============================================================================
 * WHAT IS NOT COPIED, AND WHY
 * =============================================================================
 * COLOUR. The spec writes `stroke="#c3cbd3"` / `stroke="#2fd4d4"` /
 * `stroke="#3d4751"` as a presentation attribute on all twenty-two rendered
 * marks. Colour cannot live here: it is the host's state -- a chip's icon is a
 * tier dimmer than its label when resting and full accent when active -- and a
 * hex literal in this file would fail `scripts/check-design-values.mjs` on
 * sight. So the attribute stays and its value becomes `currentColor`, and the
 * surface sets `color`: that is what `chrome.css` does for the chip, the active
 * chip and the rail key.
 *
 * EVERYTHING ELSE THE SPEC WRITES ON THE `<svg>` STAYS AN ATTRIBUTE -- `fill`,
 * `stroke`, the two round joins, the width. `TopBar.tsx` draws its chevron the
 * same way, and it means a mark that loses its stylesheet is still a stroke
 * drawing rather than a black silhouette. `chrome.css` carries only the two
 * things an attribute on this element cannot do: keeping the mark from being
 * squeezed by the flex row it sits in, and repainting HELP's filled point.
 *
 * SIZE. The spec draws each mark at exactly one size and the brief states those
 * sizes as properties of the SURFACE -- "16 px icon" of a chip, "18 px icon" of
 * a rail button -- so the caller passes it. The two agree everywhere; the tests
 * assert that they still do.
 *
 * =============================================================================
 * STROKE WIDTH IS A PROPERTY OF THE DRAWING, SO IT IS IN THE TABLE
 * =============================================================================
 * The dock's marks are all 1.6 and `icons.css` states it once. The chrome's are
 * not: the spec draws the sun, the gear, the envelope and the question mark at
 * 1.6 and the three chip marks, both chevrons, the code brackets and the camera
 * at 1.7. Each mark carries the same width in both themes and at every
 * occurrence, so the width belongs beside the geometry rather than on a
 * surface. Both are inside the brief's 1.6-1.75 band.
 *
 * Unitless SVG user units, not a CSS length, so there is no token for either --
 * the same call `components/dock/icons.css` records for its own 1.6.
 */

import type { ReactElement } from 'react';

import './chrome.css';

/**
 * THE ELEVEN, NAMED FOR WHAT THE SPEC CALLS THEM.
 *
 * The three chip marks and the five rail marks take the spec's and the brief's
 * own words (`Abuse`, `Layers`, `Map view`; "theme (sun), gear, mail, code,
 * help"). The remaining three are named for what they draw, because the spec
 * labels none of them: the bar's chevron, the menu's Navigate chevron, and the
 * camera on the menu's Action row.
 */
export type ChromeIconName =
  | 'chevron-down'
  | 'abuse'
  | 'layers'
  | 'map-view'
  | 'sun'
  | 'moon'
  | 'gear'
  | 'mail'
  | 'code'
  | 'help'
  | 'chevron-right'
  | 'report-camera'
  | 'search'
  | 'mic'
  | 'pin';

interface ChromeIconDrawing {
  /** The inner geometry of the 24-unit box, verbatim. */
  readonly body: ReactElement;
  /** The width the spec strokes this mark at, at every occurrence. */
  readonly strokeWidth: number;
}

/**
 * A `Record<ChromeIconName, ...>` on purpose: a further name cannot be added to
 * the union without a drawing existing for it, which is the compile-time
 * version of "no text-character glyphs".
 */
const CHROME_ICON: Record<ChromeIconName, ChromeIconDrawing> = {
  /* THE BAR'S CHEVRON. Drawn at 19 on the right of the field -- the one key
     section A leaves there. `TopBar.tsx` draws this path inline; it is here so
     the bar and anything else that folds a surface share one drawing. */
  'chevron-down': {
    body: <path d="M7 10.5 12 15.5l5-5" />,
    strokeWidth: 1.7,
  },

  /* ABUSE -- a page with a curled leaf and three ruled lines. A filed report. */
  abuse: {
    body: (
      <>
        <path d="M4.5 4.5h11.5v15H4.5z" />
        <path d="M16 8.5h3.5v9a2 2 0 0 1-3.5 1.4" />
        <path d="M7.5 8.5h5.5M7.5 12h5.5M7.5 15.5h3.5" />
      </>
    ),
    strokeWidth: 1.7,
  },

  /* LAYERS -- a rhombus with a second sheet under it. */
  layers: {
    body: (
      <>
        <path d="M12 4.2 20 8.4 12 12.6 4 8.4z" />
        <path d="M4 12.6 12 16.8l8-4.2" />
      </>
    ),
    strokeWidth: 1.7,
  },

  /* MAP VIEW -- a reticle: two concentric rings and four cardinal ticks. */
  'map-view': {
    body: (
      <>
        <circle cx="12" cy="12" r="7.2" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
      </>
    ),
    strokeWidth: 1.7,
  },

  /* THE THEME KEY'S SUN. Drawn while the app is DARK, because the key names
     where pressing it goes rather than where it already is -- see `Rail.tsx`. */
  sun: {
    body: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
      </>
    ),
    strokeWidth: 1.6,
  },

  /* AND THE MOON, drawn while the app is LIGHT. The path is the one the old
     search bar used, restored rather than redrawn: a single crescent, no stars,
     no fill. See `Rail.tsx` for why the pair exists again. */
  moon: {
    body: <path d="M20.2 14.2A8.4 8.4 0 0 1 9.8 3.8a8.4 8.4 0 1 0 10.4 10.4Z" />,
    strokeWidth: 1.7,
  },

  /* THE GEAR. Twelve teeth as one closed path around a hub. */
  gear: {
    body: (
      <>
        <circle cx="12" cy="12" r="2.9" />
        <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.3 7.3 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96a7.3 7.3 0 0 0 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7.3 7.3 0 0 0 1.63-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64z" />
      </>
    ),
    strokeWidth: 1.6,
  },

  /* THE ENVELOPE. A rectangle and the flap's fold. */
  mail: {
    body: (
      <>
        <path d="M3.5 6.5h17v11h-17z" />
        <path d="m3.5 7 8.5 6 8.5-6" />
      </>
    ),
    strokeWidth: 1.6,
  },

  /* CODE -- two angle brackets. One path, drawn as the spec writes it. */
  code: {
    body: <path d="M9.5 7 5 12l4.5 5M14.5 7 19 12l-4.5 5" />,
    strokeWidth: 1.7,
  },

  /* HELP -- a ring, a question mark's hook, and its point.
     THE POINT IS FILLED, and the spec writes it `fill="#c3cbd3" stroke="none"`
     -- a stroked 0.6 radius circle at 1.6 is a ring with no middle. The class
     repaints it in `currentColor` and takes the stroke off; see `chrome.css`. */
  help: {
    body: (
      <>
        <circle cx="12" cy="12" r="8.2" />
        <path d="M9.8 9.6a2.3 2.3 0 1 1 3.4 2.1c-.8.5-1.2 1-1.2 1.8v.4" />
        <circle className="fwm-chrome-icon-fill" cx="12" cy="17" r="0.6" />
      </>
    ),
    strokeWidth: 1.6,
  },

  /* THE MENU'S NAVIGATE CHEVRON. Drawn at 16 on the right of a Navigate row --
     row type 4 of the menu language. Not the bar's chevron rotated: it is its
     own path in the spec and it is transcribed as one. */
  'chevron-right': {
    body: <path d="M9.5 6.5 15 12l-5.5 5.5" />,
    strokeWidth: 1.7,
  },

  /* THE MENU'S ACTION MARK -- a camera body with a plus in it. Drawn at 17 on
     "Report a camera here", row type 5, tinted to its own hue. */
  'report-camera': {
    body: (
      <>
        <path d="M4.5 8.5h3l1.4-2h6.2l1.4 2h3v9h-15z" />
        <path d="M12 10v5M9.5 12.5h5" />
      </>
    ),
    strokeWidth: 1.7,
  },

  /* ---------------------------------------------------------------------
   * THREE MORE, AND THEY COME FROM A SECOND DESIGN FILE.
   *
   * `DarkRoute Search Entry.html` draws the search entry panel, and its 46px
   * field carries two marks the chrome brief never had: the search glyph on
   * the left and the MIC on the right. Its first-run block draws a third, the
   * pin, on `Set home` and `Set work`. They are transcribed the same way the
   * eleven above are -- path string for path string, out of the rendered
   * `<svg>` elements at real size -- and they live here rather than inline in
   * the panel because that is the rule this file exists for: the search glyph
   * is drawn by the field in both orientations and by the panel's map-result
   * rows, and a mark copied into two components is a mark that gets fixed in
   * one of them.
   * ------------------------------------------------------------------ */

  /* THE SEARCH GLYPH. A ring and a handle, at 17 inside the field. The spec
     writes no `stroke-linejoin` on it; the two paths have no joins to round,
     so the attribute this file sets on every mark changes nothing. */
  search: {
    body: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m15.8 15.8 4.2 4.2" />
      </>
    ),
    strokeWidth: 1.8,
  },

  /* THE MIC, AND IT IS DRAWN AT 18 WHILE THE SEARCH GLYPH IS DRAWN AT 17.
     Not an inconsistency to tidy: "the mic sits inside the field at full
     accent, SAME SIZE as the search glyph" is optical rather than literal, and
     a capsule with a cradle under it reads a pixel smaller than a ring at the
     same box. The spec draws 17 and 18 in every frame it appears in and the
     panel passes both. */
  mic: {
    body: (
      <>
        <path d="M12 3.5a2.6 2.6 0 0 1 2.6 2.6v5.4a2.6 2.6 0 0 1-5.2 0V6.1A2.6 2.6 0 0 1 12 3.5z" />
        <path d="M6.5 11.2a5.5 5.5 0 0 0 11 0M12 17v3.5" />
      </>
    ),
    strokeWidth: 1.7,
  },

  /* THE PIN. A teardrop with a hole, at 17, leading the two first-run rows.
     STROKE 1.8 rather than 1.7, which is what the search spec draws it at on
     both of those rows. The landscape spec draws the same path at 1.7 on its
     keyboard-up frame; the file this panel is built from wins, and the
     disagreement is recorded in gap record search-panel. */
  pin: {
    body: (
      <>
        <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
        <circle cx="12" cy="10" r="2.2" />
      </>
    ),
    strokeWidth: 1.8,
  },
};

export interface ChromeIconProps {
  readonly name: ChromeIconName;
  /** The spec's own size for the surface drawing it: 16 on a chip, 18 in the rail. */
  readonly size: number;
}

/**
 * One stroke mark in a 24-unit box.
 *
 * Always `aria-hidden`: a chip's own label is its accessible name and a rail
 * key's is on the button, so the mark must not add a second one. It is
 * decoration for the eye and the eye only.
 */
export function ChromeIcon({ name, size }: ChromeIconProps): ReactElement {
  const drawing = CHROME_ICON[name];
  return (
    <svg
      className="fwm-chrome-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      data-fwm-chrome-icon={name}
      fill="none"
      stroke="currentColor"
      strokeWidth={drawing.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {drawing.body}
    </svg>
  );
}
