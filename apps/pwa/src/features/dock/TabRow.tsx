/**
 * THE TAB ROW. Five equal columns, 63px, and it is the pane's FLOOR.
 *
 * NOT A SECOND SURFACE. v2 drew the alert card and the tab bar as two opaque
 * slabs with different fills and a hard seam between them. There is one pane
 * now: this row sits inside it, under a single 1px divider, sharing its
 * hairline and its radius. That is why all three published heights -- 150, 170,
 * 302 -- count its 63px, and why it is drawn from `Dock.tsx` rather than from
 * each of the three bodies.
 *
 * AND IT IS NEVER ABSENT. In any of the nineteen. The old drive family drew no
 * tabs at all on the theory that tabs should stand down while moving; what that
 * actually did was take the way out of a drive state away from the person
 * driving. Tapping Mesh mid-drive swaps the body above the divider and leaves
 * the drive state running underneath.
 *
 * STATE COLOUR STOPS AT THE DIVIDER. This row keeps neutral ink, full contrast
 * and its 47px hit targets in all nineteen states, INCLUDING a live amber
 * alert mid-turn. Tinting the tabs to match an alert spends amber on furniture
 * and teaches a driver to stop trusting it. Nothing in this file and nothing in
 * `dock.css` section 7 reads the state.
 *
 * ACTIVE HAS A SURFACE NOW. Colour alone was carrying it in v2; section 08 of
 * the spec gives it a 13% accent fill and an accent hairline -- exactly the
 * active chip in the top search bar, because the dock and the bar are one
 * system and "you are here" should not be drawn two different ways.
 * `data-fwm-active` is present only on the active column, so the stylesheet can
 * select it by presence.
 *
 * THE COLUMNS ARE BUTTONS. The spec draws each as a `<div>` with a `cursor` and
 * no `type` and no aria -- correct for a static page and unusable in a product,
 * because a tap target that is not a button is unreachable by keyboard and
 * invisible to a screen reader. They are `<button>` here. This is a deliberate
 * deviation and the only one this file makes.
 *
 * PRESSING THE ACTIVE TAB IS NOT A NAVIGATION. `app/screenState.ts` treats
 * re-selecting the screen you are on as a RESELECT -- it notifies subscribers
 * and pushes no history, which is how the map recenters. So this component
 * always calls `onTab` and never decides: the caller owns the difference
 * between navigating and recentering, exactly as it does today.
 *
 * WHERE A TAB GOES is `DOCK_TABS[].screen`, and this component does not read
 * it. Map is `radar`, Exposure is `log`, Mesh is `node`, Lookup is `lookup`,
 * More is `more` -- the app's existing screen ids, relabelled and reordered by
 * the dock but never renamed, because every `?screen=` link speaks them.
 *
 * =============================================================================
 * TWO ORIENTATIONS, ONE ROW, AND THE ROW IS THIS ONE
 * =============================================================================
 * "Tab bar: rotates into the 52 px left rail, full height, same five items in
 *  the same order."       -- `DarkRoute Landscape Mode.html`, section B
 *
 * gap record pwa-shell (dash-surface-needs-a-rail-not-a-bottom-dock)
 * proposed three ways to do that and recommended the first: "give `Dock` an
 * `orientation` prop ... it keeps one component and one active-key rule". The
 * prop landed HERE rather than on `Dock` because `Dock` is the PANE -- 150,
 * 170 and 302 px of alert body, maneuver row and expanded sheet, none of which
 * rotates and none of which the landscape column draws. What rotates is the tab
 * row, so the tab row is what gained the orientation.
 *
 * WHAT DIFFERS BETWEEN THE TWO. Exactly three things, and they are all listed
 * here so a fourth cannot be added quietly:
 *
 *   1. the LABEL      `shortLabel` where a tab has one -- Expose, not Exposure
 *   2. the GLYPH      19px in the rail, 21px in the bar
 *   3. the ATTRIBUTE  `data-fwm-orient`, which is all the two stylesheets need
 *
 * Not the table, not the order, not `activeTab`, not what a press does, not the
 * markup. Rotating the phone changes an attribute and the browser relays out;
 * nothing is remounted, so which tab is lit cannot disagree across a rotation
 * because there is only one component that could have an opinion.
 */

import type { ReactElement } from 'react';

import { DOCK_TABS, type DockTabKey } from './dockState.ts';
import { DockIcon } from './icons.tsx';

/** `bar` is the portrait dock's floor; `rail` is the landscape left column. */
export type TabRowOrientation = 'bar' | 'rail';

/** The 21px glyph the spec draws in every one of the five bar columns. */
const TAB_ICON = 21;
/** The 19px glyph the rail draws, measured off all five landscape frames. */
const RAIL_ICON = 19;

export interface TabRowProps {
  readonly activeTab: DockTabKey;
  readonly onTab: (key: DockTabKey) => void;
  /**
   * Defaults to `bar`, which is what every existing caller means. A default
   * rather than a required prop so adding the landscape column could not change
   * what the portrait dock renders.
   */
  readonly orientation?: TabRowOrientation;
}

export function TabRow({ activeTab, onTab, orientation = 'bar' }: TabRowProps): ReactElement {
  const rail = orientation === 'rail';
  return (
    <nav className="fwm-dock-tabs" data-fwm-orient={orientation} aria-label="Dock">
      {DOCK_TABS.map((tab) => {
        const on = tab.key === activeTab;
        /* THE SHORT SPELLING IS A FALLBACK AND NOT A TRANSFORM. Four of the five
           tabs have no `shortLabel` and take the one they already had, so the
           two orientations cannot drift on any tab nobody deliberately
           shortened. See `DockTab.shortLabel`. */
        const label = rail ? (tab.shortLabel ?? tab.label) : tab.label;
        return (
          <button
            key={tab.key}
            type="button"
            className="fwm-dock-tab"
            data-fwm-tab={tab.key}
            data-fwm-active={on ? 'true' : undefined}
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              onTab(tab.key);
            }}
          >
            <DockIcon name={tab.icon} size={rail ? RAIL_ICON : TAB_ICON} />
            {/* The label is PAINTED -- 11px under the glyph, 9px in the rail --
                so it is also the button's accessible name. No clipped word is
                needed here; the icon-only keys elsewhere in the dock carry
                `aria-label`. It sets nothing of its own: the column is the type
                context.

                THE RAIL SAYS `Expose` AND SO DOES ITS ACCESSIBLE NAME, which is
                deliberate. A painted label that a screen reader read as
                something else would be two names for one key, and the shortened
                word is a word rather than a truncation -- it reads correctly
                out loud. */}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
