/**
 * LANDSCAPE MODE -- `DarkRoute Landscape Mode.html`, sections A1, A2, A3, B, C, D.
 *
 * =============================================================================
 * THE PROBLEM THIS REPLACES
 * =============================================================================
 * Rotating used to produce a portrait layout stretched sideways. `global.css`
 * widened the screen panel to 420, turned the dock's pill on its side and left
 * the map a letterbox, and that block carried its own confession -- "THIS IS
 * THE OLD BEHAVIOUR, KEPT ON PURPOSE. THE DOCK SPEC HAS NO RAIL" -- pointing at
 * gap record pwa-shell (dash-surface-needs-a-rail-not-a-bottom-dock).
 * This is the pass that block was waiting for.
 *
 * The measured cost of the old arrangement, on the surface it fires on: the
 * dock's collapsed height is 150px border-box, and 150 of a 434px landscape
 * viewport is 35% of the screen spent on a bar. The search bar above it was
 * another 56, spanning 940px to hold one field. Landscape is not a stretched
 * portrait; it is a COLUMN LAYOUT, and this file is that column.
 *
 * =============================================================================
 * IT DRAWS. IT DOES NOT DECIDE.
 * =============================================================================
 * Every figure arrives as a prop, already derived -- `slots.ts` for the two
 * slots, `useDockState` for the tab and the pane behind it, the stores for the
 * rest. Nothing here subscribes to anything, which is what makes the whole
 * layout assertable without a fix, a route or a seeded IndexedDB.
 * `MonitorCard.tsx` makes the same rule for the same reason and says so.
 *
 * =============================================================================
 * SLOT GEOMETRY IS FIXED ACROSS BOTH MODES -- WITH ONE NUANCE WORTH STATING
 * =============================================================================
 * The mode switch changes what OCCUPIES the slots. It changes no height, no
 * column width and nothing about either rail.
 *
 * The nuance, measured rather than assumed: in monitor mode the top slot is not
 * an element rendered empty, IT DOES NOT EXIST. Frame A2's direct children are
 * the map, the scrim, the left rail, the bottom slot and the right rail, and
 * the spec's own subtitle says "the top slot is not empty, it does not exist".
 * So the rule is FIXED GEOMETRY, VARIABLE OCCUPANCY -- and `slots.top` is
 * nullable rather than carrying an "empty" variant, because an 84px box that
 * draws nothing still shadows the map and still has to be explained.
 *
 * =============================================================================
 * ROTATION IS NOT A REMOUNT
 * =============================================================================
 * "Drive state, route, alert timers and map camera all survive the transition.
 *  The two slots are the same components with different geometry, not a second
 *  screen."                                                       -- section D
 *
 * Which is a constraint on the CALLER as much as on this file, and `ShellDock`
 * meets it: it is mounted on every surface, it owns `expanded`, the active tab
 * and the detour plan, and it renders EITHER the portrait dock or this. So a
 * rotation swaps a subtree and keeps every piece of state above it -- including
 * the expanded-list gesture, which is the one thing `ShellDock`'s own header
 * says is genuinely owned there. The map is not in this tree at all: it stays
 * in `.fwm-shell-mapbed`, one stable position, so MapLibre's context, its
 * fetched tiles and the camera it was flying are untouched by the rotation.
 *
 * =============================================================================
 * NO SPEED GATE. THE SPEC ASKS FOR ONE TWICE AND IT IS DELIBERATELY ABSENT.
 * =============================================================================
 * Section B, on the search bar: "voice and one-tap first, KEYBOARD LOCKED IN
 * MOTION". Section D, on A4: "a text field that LOCKS ABOVE 5 MPH".
 *
 * Neither is implemented, on owner instruction dated with this pass: the field
 * is usable at any speed, with no motion lock, no disabled state and no nag.
 * Passengers type. People at lights type. The app does not decide who is
 * driving. There was nothing to remove -- a grep of `mph`, `speedGate`,
 * `movingLock`, `motionLock`, `tooFast`, `isMoving` and `drivingLock` across
 * `apps/pwa/src` returns readouts and physics inputs only, never a gate -- so
 * this note is the guard: the DOCUMENT still says the opposite in two places
 * and will keep telling the next reader to add one until it is amended.
 */

import type { ReactElement } from 'react';

import { ChromeIcon } from '../chrome/icons.tsx';
import type { DockNearbyRow } from '../dock/ExpandedPanel.tsx';
import { DOCK_MANEUVER_ICON, DockIcon } from '../dock/icons.tsx';
import type { DockTurn } from '../dock/icons.tsx';
import { TabRow } from '../dock/TabRow.tsx';
import type { DockDensityTier, DockTabKey } from '../dock/dockState.ts';
import { dockRerouteLabel } from '../dock/dockState.ts';
import { COUNT_DASH, countLabel } from '../search/panel.ts';
import type { CameraCount } from '../search/panel.ts';
import { countFigure } from './slots.ts';
import { ReportKey } from '../../components/dock/ReportKey.tsx';
import type { LandscapeSlots } from './slots.ts';

import './landscape.css';

/* ------------------------------------------------------------------------ *
 * THE WORDS
 *
 * Spelled once, exported, so a test names the string rather than a selector
 * and so the rail's five labels cannot be re-spelled in a second file.
 * ------------------------------------------------------------------------ */

/** The mark's alt text. Section B: "Logo only, 42 px, at the top of the rail." */
export const LANDSCAPE_MARK = 'DarkRoute';
/** The whole layer, for a reader arriving by landmark rather than by tab. */
export const LANDSCAPE_CHROME_LABEL = 'Landscape controls';
export const LANDSCAPE_RIGHT_RAIL_LABEL = 'Map controls';

/** The five right-rail controls, in the spec's own order. */
export const LANDSCAPE_SEARCH = 'Where to?';
export const LANDSCAPE_LAYERS = 'Layers';
export const LANDSCAPE_DAY_NIGHT = 'Day or night map';
export const LANDSCAPE_SETTINGS = 'Settings';

/** The bottom slot's own keys. */
export const LANDSCAPE_END = 'End';
export const LANDSCAPE_RETRY = 'Retry';
/** The press that raises A3. Section D: "Tapping the bottom slot ...". */
export const LANDSCAPE_EXPAND = 'Show every camera nearby';
export const LANDSCAPE_COLLAPSE = 'Hide the camera list';

/**
 * Section A2's footer, and the count in it is the one drawn beside it.
 *
 * `countLabel` returns the dash for an unmeasured count, so an uncounted phone
 * reads "tap to list all -" rather than "tap to list all 0". Which is odd
 * English and honest arithmetic, and the second of those is the one that
 * matters on this surface.
 */
export function landscapeListAll(count: CameraCount): string {
  return `tap to list all ${countLabel(count)}`;
}

/** A1's bottom slot: `arrival`, `min`, `on route`. Three captions, one place. */
export const LANDSCAPE_ARRIVAL = 'arrival';
export const LANDSCAPE_MINUTES = 'min';
export const LANDSCAPE_ON_ROUTE = 'on route';

/* ------------------------------------------------------------------------ *
 * PROPS
 * ------------------------------------------------------------------------ */

/** What the right rail's five circles do. Every one is optional and an absent
 *  handler leaves the control visibly unwired rather than plausibly wrong --
 *  the rule `ShellDock.onAction` already applies to seven dock keys. */
export interface LandscapeRightRail {
  readonly onSearch?: (() => void) | undefined;
  readonly layersOn?: boolean | undefined;
  readonly onLayers?: (() => void) | undefined;
  readonly onDayNight?: (() => void) | undefined;
  readonly onSettings?: (() => void) | undefined;
  readonly queuedReports?: number | undefined;
  readonly onReport?: (() => void) | undefined;
  readonly onPinDrop?: (() => void) | undefined;
}

export interface LandscapeChromeProps {
  readonly activeTab: DockTabKey;
  readonly onTab: (key: DockTabKey) => void;
  readonly slots: LandscapeSlots;
  /**
   * WHICH TIER COLOURS THE COUNT. `dock.css`'s four-tier density ramp over two
   * miles, and NOT the search panel's three-tier route ladder -- they answer
   * different questions and conflating them would paint an area reading in a
   * route hue. `'unknown'` is the uncomputed state and draws the dash in muted
   * ink; it is never a fifth tier and never a fake `clear`.
   */
  readonly density: DockDensityTier | 'unknown';
  /** A3. Section D: "a panel, not a sheet" -- it replaces both slots. */
  readonly expanded: boolean;
  readonly onExpand: () => void;
  readonly onCollapse: () => void;
  /** The list A3 scrolls. Empty is a real answer and draws as an empty list. */
  readonly nearby?: readonly DockNearbyRow[] | undefined;
  readonly onPickNearby?: ((id: string) => void) | undefined;
  /** The detour offer, raised from either slot's footer. */
  readonly onReroute?: (() => void) | undefined;
  /** The only End in the application. See `ShellDock.onAction`. */
  readonly onEnd?: (() => void) | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly right?: LandscapeRightRail | undefined;
  /**
   * THE SEARCH FIELD HAS FOCUS, SO THE CHROME GETS OUT OF THE KEYBOARD'S WAY.
   *
   * A5, "the honest case · keyboard takes 200 px, chrome yields". A landscape
   * soft keyboard is full-width and about 200px tall, and it respects no
   * columns: it covers the bottom slot, the whole right rail and four of the
   * five tabs on the left one. So both rails go while the field is focused,
   * and both come back the instant it is not.
   *
   * BOTH RAILS ENTIRELY, NEVER CLIPPED. "NEVER CLIP EITHER RAIL. NEVER TAKE THE
   * WHOLE SCREEN." A rail with its bottom half under a keyboard is worse than
   * an absent one -- it looks pressable and is not -- and a full-screen sheet
   * would hide the map, which is the one thing this layout exists to keep.
   * What stays is the panel at 336 wide and roughly 590px of live map beside
   * it. The proof that the frame closes is in `features/search/keyboard.ts`.
   */
  readonly yielding?: boolean | undefined;
  /** The 42px mark. Handed in so this file names no asset path. */
  readonly markSrc: string;
  /** A3's header line, `14 shown - 1010 stored`. */
  readonly storedNote?: string | undefined;
}

/* ------------------------------------------------------------------------ *
 * THE LAYOUT
 * ------------------------------------------------------------------------ */

export function LandscapeChrome({
  activeTab,
  onTab,
  slots,
  density,
  expanded,
  onExpand,
  onCollapse,
  nearby,
  onPickNearby,
  onReroute,
  onEnd,
  onRetry,
  right,
  markSrc,
  storedNote,
  yielding = false,
}: LandscapeChromeProps): ReactElement {
  return (
    <div
      className="fwm-ls"
      data-fwm-mode={slots.mode}
      /* ONE ATTRIBUTE, AND THE STYLESHEET DOES THE REST. The rails are not
         conditionally rendered: unmounting them would drop the tab row's focus
         on the body mid-rotation and rebuild five buttons on every keystroke
         that opened and closed a keyboard. `landscape.css` fades them out and
         takes them off the tab order, which is the same mechanism `drive.css`
         already uses for the chevron's bare mode. */
      data-fwm-yield={yielding ? 'true' : undefined}
      aria-label={LANDSCAPE_CHROME_LABEL}
    >
      {/* THE SIDE SCRIM, and it is `aria-hidden` because it is a gradient.
          Under everything, over the map, never a target. */}
      <div className="fwm-ls-scrim" aria-hidden="true" />

      {/* --- the left rail ------------------------------------------------ */}
      {/* Section B: "Tab bar: rotates into the 52 px left rail, full height,
          same five items in the same order." Same component too -- `TabRow`
          draws this and the portrait bar off one table. */}
      <div className="fwm-ls-rail">
        <div className="fwm-ls-logo">
          {/* NO WORDMARK AND NO READ COUNT. Section B: they "do not fit a 52 px
              column and are not needed mid-drive". They stay on the portrait
              bar, which this layout deletes rather than restyles. */}
          <img src={markSrc} alt={LANDSCAPE_MARK} />
        </div>
        <TabRow activeTab={activeTab} onTab={onTab} orientation="rail" />
      </div>

      {/* --- the content column ------------------------------------------- */}
      {expanded ? (
        <ExpandedPanel
          rows={nearby ?? []}
          onPick={onPickNearby}
          onCollapse={onCollapse}
          onReroute={onReroute}
          slots={slots}
          density={density}
          storedNote={storedNote}
        />
      ) : (
        <>
          {slots.top === null ? null : <TopSlot top={slots.top} />}
          {slots.band === null ? null : <AlertBand band={slots.band} onReroute={onReroute} />}
          <BottomSlot
            slot={slots.bottom}
            density={density}
            onExpand={onExpand}
            onReroute={onReroute}
            onEnd={onEnd}
            onRetry={onRetry}
          />
        </>
      )}

      {/* --- the right rail ----------------------------------------------- */}
      <RightRail right={right} />
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * THE TOP SLOT -- 336 x 84, "what is happening now"
 * ------------------------------------------------------------------------ */

interface TopSlotProps {
  readonly top: NonNullable<LandscapeSlots['top']>;
}

function TopSlot({ top }: TopSlotProps): ReactElement {
  return (
    <div className="fwm-ls-slot" data-fwm-slot="top">
      <ManeuverGlyph turn={top.turn} />
      <div className="fwm-ls-readout">
        {top.figure === undefined && top.title === undefined ? null : (
          <div className="fwm-ls-figure-row">
            {top.figure === undefined ? null : (
              <span className="fwm-ls-figure">{top.figure}</span>
            )}
            {top.unit === undefined ? null : <span className="fwm-ls-unit">{top.unit}</span>}
            {top.title === undefined ? null : <span className="fwm-ls-unit">{top.title}</span>}
          </div>
        )}
        {top.sub === undefined ? null : <div className="fwm-ls-sub">{top.sub}</div>}
      </div>
    </div>
  );
}

/**
 * THE MANEUVER'S OWN MARK, and NOTHING WHERE THERE IS NO DIRECTION.
 *
 * `DriveRows.leadMark` makes the same refusal in the same words: "Returns
 * `null` rather than a substitute when the direction has no drawing ... a
 * mirrored or borrowed arrow would lose the driver a turn." The slot then
 * starts at the readout and loses a picture, which is the cheap failure.
 */
function ManeuverGlyph({ turn }: { readonly turn?: DockTurn | undefined }): ReactElement | null {
  if (turn === undefined) return null;
  const name = DOCK_MANEUVER_ICON[turn];
  if (name === undefined) return null;
  return (
    <span className="fwm-ls-turn-glyph">
      <DockIcon name={name} size={34} />
    </span>
  );
}

/* ------------------------------------------------------------------------ *
 * THE ALERT BAND -- 336 x 56, inserted, never grown into
 * ------------------------------------------------------------------------ */

interface AlertBandProps {
  readonly band: NonNullable<LandscapeSlots['band']>;
  readonly onReroute?: (() => void) | undefined;
}

function AlertBand({ band, onReroute }: AlertBandProps): ReactElement {
  return (
    <div className="fwm-ls-band" role="status">
      <span className="fwm-ls-band-glyph">
        <DockIcon name="warning" size={19} />
      </span>
      {band.figure === undefined ? null : (
        <span className="fwm-ls-band-figure">{band.figure}</span>
      )}
      <span className="fwm-ls-band-text">{band.text}</span>
      {/* THE DETOUR KEY, AND ABSENT IS ABSENT. `withDetourCount` deletes the
          count when there is no route to offer, and every pane in this product
          draws the key only where the field is present -- a key that offers to
          route around nothing is a key that refuses. */}
      {band.around === undefined || onReroute === undefined ? null : (
        <button type="button" className="fwm-ls-key" onClick={onReroute}>
          {dockRerouteLabel(band.around)}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * THE BOTTOM SLOT -- 336 x 96, "where you stand"
 * ------------------------------------------------------------------------ */

interface BottomSlotProps {
  readonly slot: LandscapeSlots['bottom'];
  readonly density: DockDensityTier | 'unknown';
  readonly onExpand: () => void;
  readonly onReroute?: (() => void) | undefined;
  readonly onEnd?: (() => void) | undefined;
  readonly onRetry?: (() => void) | undefined;
}

function BottomSlot({
  slot,
  density,
  onExpand,
  onReroute,
  onEnd,
  onRetry,
}: BottomSlotProps): ReactElement {
  return (
    <div
      className="fwm-ls-slot"
      data-fwm-slot="bottom"
      data-fwm-density={slot.kind === 'monitor' ? density : undefined}
    >
      {slot.kind === 'navigation' ? (
        <div className="fwm-ls-head" data-fwm-triple="true">
          <Stat value={slot.arrival} label={LANDSCAPE_ARRIVAL} />
          <Stat value={slot.minutes} label={LANDSCAPE_MINUTES} />
          <Stat value={countFigure(slot.onRoute)} label={LANDSCAPE_ON_ROUTE} />
        </div>
      ) : slot.kind === 'monitor' ? (
        <div className="fwm-ls-head">
          <span className="fwm-ls-icon" aria-hidden="true">
            <DockIcon name="camera" size={22} />
          </span>
          <span className="fwm-ls-count">{countFigure(slot.count)}</span>
          <div className="fwm-ls-headlines">
            {slot.statusText === undefined ? null : (
              <span className="fwm-ls-headline">{slot.statusText}</span>
            )}
            {slot.subline === undefined ? null : (
              <span className="fwm-ls-headnote">{slot.subline}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="fwm-ls-head">
          <span className="fwm-ls-icon" aria-hidden="true">
            <DockIcon name="wifi-off" size={22} />
          </span>
          <div className="fwm-ls-headlines">
            <span className="fwm-ls-headline">{slot.statusText}</span>
            {slot.detail === undefined ? null : (
              <span className="fwm-ls-headnote">{slot.detail}</span>
            )}
          </div>
        </div>
      )}

      <div className="fwm-ls-rule" />

      <div className="fwm-ls-foot">
        {slot.kind === 'navigation' ? (
          <>
            <span className="fwm-ls-foot-note">{slot.remaining ?? COUNT_DASH}</span>
            {onEnd === undefined ? null : (
              <button type="button" className="fwm-ls-key" data-fwm-tone="end" onClick={onEnd}>
                {LANDSCAPE_END}
              </button>
            )}
          </>
        ) : slot.kind === 'monitor' ? (
          <>
            {/* THE WHOLE FOOTER LINE IS THE TARGET that raises A3, which is
                section D's own gesture -- "Tapping the bottom slot slides a
                336 px panel up the left column to full height". It is a
                `<button>` and not the slot's own press because the slot also
                holds the detour key, and a target inside a target is a press
                whose outcome depends on where a thumb landed. */}
            <button
              type="button"
              className="fwm-ls-foot-key"
              /* THE PAINTED WORD IS A COUNT AND THE SPOKEN ONE IS A VERB.
                 "tap to list all 14" read aloud tells a driver what a sighted
                 driver can see; it does not tell them what pressing does. The
                 label says that, and the count stays painted. */
              aria-label={LANDSCAPE_EXPAND}
              onClick={onExpand}
            >
              <span className="fwm-ls-foot-note">{landscapeListAll(slot.count)}</span>
            </button>
            {slot.around === undefined || onReroute === undefined ? null : (
              <button type="button" className="fwm-ls-key" onClick={onReroute}>
                <DockIcon name="reroute" size={14} />
                {dockRerouteLabel(slot.around)}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="fwm-ls-foot-note">{slot.subline ?? ''}</span>
            {onRetry === undefined ? null : (
              <button type="button" className="fwm-ls-key" onClick={onRetry}>
                {LANDSCAPE_RETRY}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
}: {
  readonly value: string | null;
  readonly label: string;
}): ReactElement {
  return (
    <div className="fwm-ls-stat">
      {/* NEVER BLANK AND NEVER A FAKE ZERO. An arrival nobody has computed
          draws the dash the rest of this product draws for an unmeasured
          figure -- `features/search/panel.ts` publishes the glyph so there is
          one of it. */}
      <span className="fwm-ls-stat-value">{value ?? COUNT_DASH}</span>
      <span className="fwm-ls-stat-label">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * A3 -- THE EXPANDED PANEL. A panel, not a sheet.
 * ------------------------------------------------------------------------ */

interface ExpandedPanelProps {
  readonly rows: readonly DockNearbyRow[];
  readonly onPick?: ((id: string) => void) | undefined;
  readonly onCollapse: () => void;
  readonly onReroute?: (() => void) | undefined;
  readonly slots: LandscapeSlots;
  readonly density: DockDensityTier | 'unknown';
  readonly storedNote?: string | undefined;
}

function ExpandedPanel({
  rows,
  onPick,
  onCollapse,
  onReroute,
  slots,
  density,
  storedNote,
}: ExpandedPanelProps): ReactElement {
  const bottom = slots.bottom;
  const count = bottom.kind === 'monitor' ? countFigure(bottom.count) : COUNT_DASH;
  const around = bottom.kind === 'monitor' ? bottom.around : undefined;
  return (
    <div className="fwm-ls-panel" data-fwm-density={density}>
      <div className="fwm-ls-head">
        <span className="fwm-ls-icon" aria-hidden="true">
          <DockIcon name="camera" size={22} />
        </span>
        <span className="fwm-ls-count">{count}</span>
        <div className="fwm-ls-headlines">
          {bottom.kind === 'monitor' && bottom.statusText !== undefined ? (
            <span className="fwm-ls-headline">{bottom.statusText}</span>
          ) : null}
          {bottom.kind === 'monitor' && bottom.subline !== undefined ? (
            <span className="fwm-ls-headnote">{bottom.subline}</span>
          ) : null}
        </div>
        <button type="button" className="fwm-ls-key" onClick={onCollapse}>
          {LANDSCAPE_COLLAPSE}
        </button>
      </div>

      <div className="fwm-ls-rule" />

      {/* SCROLLS INTERNALLY, which is section B's own word for it: "A full-height
          336 px panel in the left column, not a bottom sheet. Scrolls
          internally." The page never scrolls; there is nowhere for it to go. */}
      <div className="fwm-ls-list">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="fwm-ls-row"
            data-fwm-owner={row.owner}
            onClick={() => {
              onPick?.(row.id);
            }}
          >
            <span className="fwm-ls-dot" aria-hidden="true" />
            <span className="fwm-ls-row-text">
              <span className="fwm-ls-row-title">{row.where}</span>
              <span className="fwm-ls-row-sub">{row.who}</span>
            </span>
            <span className="fwm-ls-row-dist">{row.distance}</span>
          </button>
        ))}
      </div>

      <div className="fwm-ls-rule" />

      <div className="fwm-ls-foot">
        <span className="fwm-ls-foot-note">{storedNote ?? ''}</span>
        {around === undefined || onReroute === undefined ? null : (
          <button type="button" className="fwm-ls-key" onClick={onReroute}>
            <DockIcon name="reroute" size={14} />
            {dockRerouteLabel(around)}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * THE RIGHT RAIL -- five circles, vertically centred
 * ------------------------------------------------------------------------ */

/**
 * SEARCH IS FIRST, AND THAT IS THE WHOLE POINT OF SECTION D'S "no search bar":
 * "A 56 px bar spanning 940 px is all dead space. Search becomes the first
 *  right-rail button".
 *
 * TWO OF THE FIVE ARE NEVER NAMED IN THE DOCUMENT. Section B accounts for
 * search, layers and report and claims to be "every portrait element, accounted
 * for"; the sun with eight rays and the cog are drawn in all four frames and
 * named nowhere in B, C or D. They are read here as day/night and settings,
 * which is inference from a glyph rather than the spec, and it is reported.
 *
 * REPORT IS `ReportKey`, NOT A REDRAWN CIRCLE. It owns tap-opens-the-sheet,
 * hold-1s-drops-a-pin, the drag-abort slop and the queued badge, and it has
 * outlived two docks by being a component rather than markup inside one. A
 * second pink circle here would fork the two gestures on the first change to
 * either.
 */
function RightRail({ right }: { readonly right?: LandscapeRightRail | undefined }): ReactElement {
  const r = right ?? {};
  return (
    <div className="fwm-ls-right" role="group" aria-label={LANDSCAPE_RIGHT_RAIL_LABEL}>
      <Circle keyName="search" label={LANDSCAPE_SEARCH} icon="search" onPress={r.onSearch} />
      <Circle
        keyName="layers"
        label={LANDSCAPE_LAYERS}
        icon="layers"
        onPress={r.onLayers}
        pressed={r.layersOn}
      />
      <Circle keyName="day-night" label={LANDSCAPE_DAY_NIGHT} icon="sun" onPress={r.onDayNight} />
      {/* NOT WRAPPED IN A `.fwm-ls-circle`. `ReportKey` renders its own
          `<button>`, and putting one inside a styled div would draw two rings
          and give the rail a target inside a target. The stylesheet re-cuts
          `.fwm-dock-report-key` for this column instead -- the same technique
          the left rail uses on `.fwm-dock-tabs`, and the reason neither
          component needed editing. */}
      <ReportKey
        queuedCount={r.queuedReports ?? 0}
        {...(r.onReport === undefined ? {} : { onReport: r.onReport })}
        {...(r.onPinDrop === undefined ? {} : { onPinDrop: r.onPinDrop })}
      />
      <Circle keyName="settings" label={LANDSCAPE_SETTINGS} icon="gear" onPress={r.onSettings} />
    </div>
  );
}

interface CircleProps {
  readonly keyName: string;
  readonly label: string;
  readonly icon: 'search' | 'layers' | 'sun' | 'gear';
  readonly onPress?: (() => void) | undefined;
  readonly pressed?: boolean | undefined;
}

function Circle({ keyName, label, icon, onPress, pressed }: CircleProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-ls-circle"
      data-fwm-key={keyName}
      /* VISIBLY UNWIRED RATHER THAN PLAUSIBLY WRONG. `ShellDock.onAction`
         leaves seven dock keys in exactly this state and argues it: a key given
         a guessed destination does the wrong thing half the time, and a key
         that says it is not connected can be found by a grep. */
      data-fwm-unwired={onPress === undefined ? 'true' : undefined}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onPress}
    >
      <ChromeIcon name={icon} size={19} />
    </button>
  );
}
