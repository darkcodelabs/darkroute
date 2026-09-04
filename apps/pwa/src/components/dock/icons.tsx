/**
 * The five destination marks. Extracted verbatim from
 * `Flockys App Screens v2.dc.html`, where they were the collapsed keys of the
 * one-bar dock:
 *
 *   "One 58px surface bar. The current destination shows its name at 14px on a
 *    hue-tinted chip; the rest collapse to a 24px stroke icon on the platform
 *    1.6px grid, so the label you can read is always the one you are on."
 *      -- panel DOCK -- REPLACES THE ICON ROW
 *
 * THAT DOCK IS GONE. v1's is four glyphs in a floating pill and draws its own
 * (`DockV1.tsx`), so nothing navigational renders these any more. The one
 * surviving caller is MESH: `features/node/NodeScreen.tsx` draws `node` in the
 * screen's header and against every message on the feed, because the mark is
 * the screen's identity rather than a key's decoration. The other four are kept
 * because `ICON_BODY` is a `Record<DockScreen, ...>` and dropping them would
 * make that table a partial one for no gain; see the type note below.
 *
 * Every `viewBox`, coordinate and path string below is copied character for
 * character out of the rendered docks (lines 113, 195, 267, 330, 404), where
 * each icon is drawn once as the active mark and four times as an inactive one.
 * Nothing here was redrawn, simplified or sourced from an icon set. If an icon
 * looks wrong, the fix is in the design file, not here.
 *
 * WHAT IS NOT COPIED, AND WHY. The design writes `stroke="#8B93A1"` /
 * `stroke="#FF2D5E"` / `fill="#8B93A1"` and `stroke-width="1.6"` as inline
 * presentation attributes on every one of the 30 rendered `<svg>` elements.
 * Colour cannot live here -- it is the host's state, it changes per screen, and
 * a hex literal in this file would fail `scripts/check-design-values.mjs` on
 * sight. So paint is `currentColor`, inherited from whatever renders the mark,
 * and the stroke geometry (width, linecap, linejoin) is declared once on
 * `.fwm-dock-icon` in `icons.css` -- which this file imports itself, so the
 * paint travels with the drawing instead of arriving from a stylesheet the
 * caller has never heard of.
 * The result renders identically; see docs/gaps-inbox/dock-v2.md.
 */

import type { ReactElement } from 'react';

import type { DockScreen } from '../../app/screenState.ts';

import './icons.css';

/**
 * The inner geometry of each 24x24 mark, keyed by destination.
 *
 * A `Record<DockScreen, ...>` on purpose: a sixth dock screen cannot be added
 * to the union without an icon being drawn for it, which is the compile-time
 * version of "never substitute an emoji".
 */
const ICON_BODY: Record<DockScreen, ReactElement> = {
  // RADAR -- concentric rings around a filled centre. The scope, seen from above.
  radar: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <circle className="fwm-dock-icon-fill" cx="12" cy="12" r="1" />
    </>
  ),
  // SWEEP -- the navigation cursor.
  // LOOKUP -- a magnifier. Plate in, capture history out.
  lookup: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M15.6 15.6 20.5 20.5" />
    </>
  ),
  // ASK -- a microphone on its stand.
  ask: (
    <>
      <rect x="9" y="3" width="6" height="10" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  // LOG -- three bulleted rows. The exposure timeline.
  log: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle className="fwm-dock-icon-fill" cx="4.6" cy="6.5" r="1.1" />
      <circle className="fwm-dock-icon-fill" cx="4.6" cy="12" r="1.1" />
      <circle className="fwm-dock-icon-fill" cx="4.6" cy="17.5" r="1.1" />
    </>
  ),
  /**
   * NODE was a U+2B21 WHITE HEXAGON glyph, and is now the project's own mark.
   *
   * A glyph is at the mercy of whatever font the platform substitutes, and
   * this one is the identity of the screen it opens, so it is drawn rather
   * than typed. See the icon itself for what was dropped to make it legible
   * at 24px.
   */
  /**
   * THE PROJECT'S OWN MARK, reduced to what survives at 24px.
   *
   * The supplied artwork is a hexagon frame carrying a dozen mesh nodes and
   * connecting lines, with an eye at the centre and diagonal speed lines
   * across it. Drawn faithfully at this size it is a smudge: at 24px a 1.6px
   * stroke leaves roughly fourteen usable pixels across the eye, and the mesh
   * lattice collapses into grey texture.
   *
   * So this keeps the three things that carry the identity - the hexagon, the
   * nodes ON the hexagon, and the eye inside it - and drops the interior
   * lattice and the speed lines. The full artwork belongs on a surface with
   * room for it.
   *
   * Six vertices of a regular hexagon, flat-top, radius 9 about (12,12):
   * (12,3) (19.8,7.5) (19.8,16.5) (12,21) (4.2,16.5) (4.2,7.5).
   */
  node: (
    <>
      <path d="M12 3 L19.8 7.5 L19.8 16.5 L12 21 L4.2 16.5 L4.2 7.5 Z" />
      {/* The nodes, on the frame. Filled, so they read as points rather than
          as bumps in the outline. */}
      <circle className="fwm-dock-icon-fill" cx="12" cy="3" r="1.5" />
      <circle className="fwm-dock-icon-fill" cx="19.8" cy="7.5" r="1.5" />
      <circle className="fwm-dock-icon-fill" cx="19.8" cy="16.5" r="1.5" />
      <circle className="fwm-dock-icon-fill" cx="12" cy="21" r="1.5" />
      <circle className="fwm-dock-icon-fill" cx="4.2" cy="16.5" r="1.5" />
      <circle className="fwm-dock-icon-fill" cx="4.2" cy="7.5" r="1.5" />
      {/* The eye: two arcs meeting at the corners, and a pupil. */}
      <path d="M6.5 12 Q12 8 17.5 12 Q12 16 6.5 12 Z" />
      <circle className="fwm-dock-icon-fill" cx="12" cy="12" r="1.4" />
    </>
  ),
};

export interface DockIconProps {
  readonly screen: DockScreen;
}

/**
 * One 24x24 stroke mark.
 *
 * Always `aria-hidden`: the key's own label element carries the accessible
 * name, so the icon must not add a second one. It is decoration for the eye
 * and the eye only.
 */
export function DockIcon({ screen }: DockIconProps): ReactElement {
  return (
    <svg
      className="fwm-dock-icon"
      viewBox="0 0 24 24"
      data-fwm-dock-icon={screen}
      aria-hidden="true"
      focusable="false"
    >
      {ICON_BODY[screen]}
    </svg>
  );
}
