/**
 * THE DOCK. One inset pane, three locked heights, nineteen states.
 *
 * `dockv3.dc.html` is the specification and this is the shell it draws: inset
 * 10 on all four sides, radius 24, one hairline, four layers of glass, and a
 * 1px divider splitting a body from the tab row that is the pane's floor.
 * Nothing about that changes between states. Only the ground, the edge, the ink
 * and the height do, and the height only ever takes one of three values --
 * COLLAPSED 150, NAVIGATING 170, EXPANDED 302, border-box, hairline included.
 *
 * THE TAB ROW IS DRAWN HERE, NOT BY A BODY. It is permanent chrome: never
 * absent in any of the nineteen, and all three published heights count its
 * 63px. Drawing it from each body would put one fact in three files and let a
 * pane ship without it -- which is exactly what the old drive family did.
 *
 * THERE IS NO GRAB HANDLE AND NO EXPAND CHEVRON. The chevron collided with the
 * pane's corner and with the report key; the grab bar under the tab row
 * duplicated the system gesture bar three pixels below it. Both are deleted,
 * and the WHOLE PANE BODY is the tap target instead -- `.fwm-dock-tap`, a real
 * button stretched over the body and painted with nothing. `dock.css` section
 * 4 argues why it is a stretched button and not a click handler on a box.
 *
 * THIS COMPONENT DOES NOT DECIDE ANYTHING. It does not choose the state, does
 * not navigate, does not know what a reader is. The caller passes the pane, the
 * state and that pane's own data; the height follows from the pane and every
 * hue from the state, in the stylesheet's own selectors. A dock that decided
 * its own state would be a second copy of the alert logic living in the chrome.
 *
 * COLOUR IS NOT HERE. Not one hex, not one token name, in any of the files this
 * brief owns. `scripts/check-design-values.mjs` fails the build on a raw value
 * anywhere else, and the deeper reason is that the driver picked one of
 * seventeen skins and the dock has to follow all of them.
 *
 * THE REPORT KEY IS A SIBLING, NOT A CHILD, and so is the scrim. The key laps
 * over the pane's top-right corner in all nineteen states; folding it inside
 * would eat one of the three locked heights and put a sixth destination in a
 * five-column grid. The scrim is full-bleed and the pane is inset 10, so it
 * cannot be a child either. `Dock` returns a fragment of the three.
 *
 * WHY THE PROPS ARE A UNION. The three bodies do not take the same data and
 * never did: the collapsed row takes a count and two sentences, the navigation
 * row takes a maneuver, and the expanded sheet takes one of three lists.
 * Spelling that as one optional-everything object would let a caller hand the
 * turn list a set of readers and get an empty pane back with no error
 * anywhere. `pane` is the discriminant, and it is also the height.
 */

import type { ReactElement } from 'react';

import { BrowseRow, dockDensityOf } from './BrowseRow.tsx';
import type { DockActionKey, DockData, DockStateId, DockTabKey } from './dockState.ts';
import { DriveRows } from './DriveRows.tsx';
import type { DockNavAction, DockNavData, DockNavStateId } from './DriveRows.tsx';
import { ExpandedPanel } from './ExpandedPanel.tsx';
import type { ExpandedPanelProps } from './ExpandedPanel.tsx';
import { ReportButton } from './ReportButton.tsx';
import { TabRow } from './TabRow.tsx';
import './dock.css';

/**
 * WHICH OF THE THREE HEIGHTS A PANE DRAWS AT.
 *
 *   collapsed   150  section A, and section B's five drive states
 *   navigating  170  section E, the six routed states
 *   expanded    302  sections C and F, the two sheets
 *
 * THIS REPLACES `DOCK_FAMILY` AND `DOCK_HEIGHT` FOR GEOMETRY. That pair groups
 * the nineteen as browse / expanded / drive and publishes 147 / 288 / 168 --
 * v2's split and v2's numbers. Five of the nine states it calls `drive` are the
 * collapsed 150 now: CRUISING, APPROACHING, UNDER SURVEILLANCE, CLEARED and
 * OFFLINE are section B, and section B is the same body as section A down to
 * the pixel. Only a state with a ROUTE in it takes the second height.
 *
 * Retiring the old pair is the owner of `dockState.ts`'s call. What cannot
 * happen is two live tables disagreeing about a number the brief locked, so
 * nothing here reads either of them.
 */
export type DockPane = 'collapsed' | 'navigating' | 'expanded';

/** Every collapsed state, and which of the nineteen ids reach the other two. */
export const DOCK_PANE: Readonly<Record<DockStateId, DockPane>> = {
  idle: 'collapsed',
  armed: 'collapsed',
  'armed-expanded': 'expanded',
  dense: 'collapsed',
  muted: 'collapsed',
  offline: 'collapsed',
  navigating: 'navigating',
  'navigating-expanded': 'expanded',
  cruising: 'collapsed',
  approaching: 'collapsed',
  passing: 'collapsed',
  cleared: 'collapsed',
  'abuse-zone': 'collapsed',
  'abuse-entering': 'collapsed',
  'gps-weak': 'collapsed',
  'mesh-sync': 'collapsed',
  rerouted: 'navigating',
  unmapped: 'collapsed',
  arrived: 'navigating',
};

/**
 * THE FAMILY NAME THE CHROME STILL READS.
 *
 * `styles/global.css` pads the screen under the dock from
 * `:root:has(.fwm-dock[data-fwm-family='...'])`, and that stylesheet is out of
 * scope for this brief. So the attribute is still emitted -- as an ALIAS of the
 * pane, not a second source of truth, and never read back by anything here.
 *
 * Its three lengths over there are now 3, 2 and 14 pixels short of the pane
 * they describe. That is padding under a floating dock rather than the dock
 * itself, so nothing overlaps; it is listed for the owner of that file.
 */
const DOCK_FAMILY_ALIAS: Readonly<Record<DockPane, string>> = {
  collapsed: 'browse',
  navigating: 'drive',
  expanded: 'expanded',
};

/**
 * THE COLLAPSED STATES WITH SOMETHING BEHIND THEM.
 *
 * The chevron is gone but the affordance is not: these three have a sheet worth
 * opening -- ARMED has the reader, DENSE AREA has fourteen of them, ABUSE ZONE
 * has three sourced reports. IDLE, OFFLINE, GPS WEAK and MESH SYNC have nothing
 * behind them, so their body is not a button at all and pressing it does
 * nothing rather than opening an empty sheet.
 *
 * The navigation pane's own expand is not here: every routed state has a turn
 * list behind it, so the whole family offers the press.
 */
const DOCK_EXPANDS: ReadonlySet<DockStateId> = new Set<DockStateId>([
  'armed',
  'dense',
  'abuse-zone',
]);

/**
 * What the stretched tap target says out loud.
 *
 * Sentence case, because it is only ever spoken: the spec draws no word here,
 * and the whole point of deleting the chevron was that the pane needs no label
 * to be pressable. A control with no accessible name is unusable, so it gets
 * one that is not painted.
 */
export const DOCK_EXPAND_LABEL = 'Expand';
export const DOCK_COLLAPSE_LABEL = 'Collapse';

/** What every pane needs, whatever is inside it. */
interface DockShellProps {
  /** Which of the five tabs is lit. Drawn in all nineteen states. */
  readonly activeTab: DockTabKey;
  /**
   * A tab was pressed -- INCLUDING the one already active.
   *
   * `app/screenState.ts` treats re-selecting the current screen as a RESELECT:
   * no history push, subscribers notified, which is how the map recenters. The
   * dock cannot tell those apart without duplicating that rule, so it reports
   * every press and the caller decides.
   */
  readonly onTab: (key: DockTabKey) => void;
  readonly onReport: () => void;
  /** The pane body was pressed, in a state that has a sheet behind it. */
  readonly onExpand?: (() => void) | undefined;
  /** The pane body was pressed while a sheet was open. */
  readonly onCollapse?: (() => void) | undefined;
}

export type DockProps = DockShellProps &
  (
    | {
        readonly pane: 'collapsed';
        readonly state: DockStateId;
        readonly data: DockData;
        /**
         * undo, dismiss, wrong, around. `around` is the detour offer and it
         * lives in the second row's right slot -- not a twentieth affordance:
         * that slot exists in every collapsed state and used to carry
         * throwaway hints like `Tap for tabs`, which a driver reads once and
         * never needs again. The offer takes the slot the instruction wasted.
         */
        readonly onAction?: ((action: DockActionKey) => void) | undefined;
      }
    | {
        readonly pane: 'navigating';
        readonly state: DockNavStateId;
        readonly data: DockNavData;
        readonly onAction?: ((action: DockNavAction) => void) | undefined;
      }
    | {
        readonly pane: 'expanded';
        /** Which of the nineteen tints the sheet. `armed-expanded` or
         *  `navigating-expanded` today; the sheet itself is `view`. */
        readonly state: DockStateId;
        readonly view: ExpandedPanelProps;
      }
  );

export function Dock(props: DockProps): ReactElement {
  const { pane, state, activeTab, onTab, onReport, onExpand, onCollapse } = props;

  /* A SHEET ALWAYS COLLAPSES; THREE COLLAPSED STATES AND THE WHOLE NAVIGATION
     FAMILY OPEN ONE. Pressing the body of an expanded pane is the way back now
     that the grabber is deleted, so the target is offered whenever a handler
     exists for the direction this pane can travel in. */
  const press = pressFor(props, onExpand, onCollapse);

  /* THE TIER IS DERIVED ONCE. Its COLOUR comes off this attribute and its WORD
     comes off the same function inside `BrowseRow`; two derivations of one
     number is how the two would come to disagree, and the brief's rule is that
     colour never travels alone. */
  const density =
    props.pane === 'collapsed' ? dockDensityOf(props.state, props.data) : undefined;

  return (
    <>
      {/* THE SCRIM IS FIRST so it paints under both the key and the pane. It is
          `aria-hidden` because 180px of gradient is not content. */}
      <div className="fwm-dock-scrim" aria-hidden="true" />

      <ReportButton onReport={onReport} />

      {/* TWO ATTRIBUTES THAT MATTER AND ONE ALIAS. The pane picks the height;
          the state picks the edge, the ground and every per-state hue, and it
          picks them in the stylesheet's own selectors -- publishing the mapping
          here as well would be a second copy of one fact, and the copy that
          drifts is always the one nothing renders from. */}
      <div
        className="fwm-dock"
        data-fwm-pane={pane}
        data-fwm-family={DOCK_FAMILY_ALIAS[pane]}
        data-fwm-state={state}
      >
        {/* THE REGION ABOVE THE DIVIDER, and the tap target stretched over it.
            The target is the body's FIRST child so every key that shares a row
            paints and receives its press ahead of it -- `dock.css` gives those
            keys `position: relative` for exactly that reason. A press on the
            detour offer reroutes; a press anywhere else opens or closes. */}
        <div className="fwm-dock-body" data-fwm-density={density}>
          {press === undefined ? null : (
            <button
              type="button"
              className="fwm-dock-tap"
              aria-label={pane === 'expanded' ? DOCK_COLLAPSE_LABEL : DOCK_EXPAND_LABEL}
              aria-expanded={pane === 'expanded'}
              onClick={press}
            />
          )}

          {props.pane === 'collapsed' ? (
            <BrowseRow state={props.state} data={props.data} onAction={props.onAction} />
          ) : null}

          {props.pane === 'navigating' ? (
            <DriveRows state={props.state} data={props.data} onAction={props.onAction} />
          ) : null}

          {props.pane === 'expanded' ? <ExpandedPanel {...props.view} /> : null}
        </div>

        {/* THE ONE RULE INSIDE THE PANE, and the line state colour stops at. */}
        <div className="fwm-dock-divider" />

        <TabRow activeTab={activeTab} onTab={onTab} />
      </div>
    </>
  );
}

/** Which handler the stretched target fires, if any. Split out so the pane
 *  discriminant narrows `state` without a cast. */
function pressFor(
  props: DockProps,
  onExpand: (() => void) | undefined,
  onCollapse: (() => void) | undefined,
): (() => void) | undefined {
  if (props.pane === 'expanded') return onCollapse;
  if (props.pane === 'navigating') return onExpand;
  return DOCK_EXPANDS.has(props.state) ? onExpand : undefined;
}
