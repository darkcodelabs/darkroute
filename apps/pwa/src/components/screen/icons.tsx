/**
 * THE TWO GLYPHS SECTION C DRAWS, and there are only two.
 *
 * `the_rest_of_the_app.dc.html` inlines the same 16px chevron at the tail of
 * every navigate row across four of its five tab frames, and the same 17px
 * paper-plane on EXPOSURE's one action. Transcribing either into four files is
 * how the fifth copy ends up with a different stroke width -- the argument
 * `components/nav/ReloadTitle.tsx` already makes about controls, applied to the
 * two shapes those controls contain.
 *
 * EVERY NUMBER HERE IS THE SPEC'S. The `viewBox`, the path data, the stroke
 * width and the linecaps are copied out of its markup rather than redrawn:
 *
 *   chevron  viewBox 0 0 24 24 - 16x16 - stroke-width 1.7 - round caps/joins
 *            path "M9.5 6.5 15 12l-5.5 5.5"
 *   plane    viewBox 0 0 24 24 - 17x17 - stroke-width 1.8 - round caps/joins
 *            path "M3.6 11.2 20.4 4.4 13.6 21.2l-2.2-7.8z"
 *
 * `width`/`height` are ATTRIBUTES, not styles. The design-value gate reads a
 * React `style` object and treats a unitless number there as a hardcoded px --
 * an SVG presentation attribute is the element's own intrinsic size, which is
 * a different thing and the one the spec writes. The painted size still comes
 * from CSS: `.fwm-screen-chevron` sizes the chevron off the 4px step, and the
 * attribute is only the aspect ratio the box is resolved against.
 *
 * COLOUR IS `currentColor` ON BOTH. The spec hardcodes the muted ink on the
 * chevron and accent on the plane, which is true of the one state it drew and
 * wrong the moment a row is pressed or a theme is light. Inheriting means the
 * glyph is whatever its row is, which is what makes one component serve both.
 */

import type { ReactElement } from 'react';

/** The tail of a navigate row. 16px, muted by inheritance. */
export function ScreenChevron(): ReactElement {
  return (
    <svg
      className="fwm-screen-chevron"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.5 6.5 15 12l-5.5 5.5" />
    </svg>
  );
}

/** EXPOSURE's one action, and the map key's mark everywhere it appears. */
export function ScreenPlane(): ReactElement {
  return (
    <svg
      className="fwm-screen-plane"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.6 11.2 20.4 4.4 13.6 21.2l-2.2-7.8z" />
    </svg>
  );
}
