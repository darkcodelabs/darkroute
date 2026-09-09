/**
 * THE COLLAPSED BODY. 12 pad, a 44px lede, a 24px meta line, 4 pad.
 *
 * That is section A's own arithmetic, and section B's five drive states reuse
 * it byte for byte -- the tab bar is cropped out of B only because it is
 * identical, and every pane drawn there is the same 86px of body. So this one
 * component draws FOURTEEN of the nineteen: the eight browse states and the
 * five drive states that have no route in them, plus UNMAPPED.
 *
 * THERE IS NO SEPARATE DRIVE BODY ANY MORE. v2 had a 71px primary over a 41px
 * secondary at a fourth height; the whole argument of v3 is that escalation is
 * hue, weight and the number, NEVER size, so CRUISING and IDLE are the same box
 * and only the tint and the ink change. A pane that grows mid-drive moves the
 * target at the worst possible moment.
 *
 * THE LEDE IS THREE SLOTS AND THE META LINE IS FOUR.
 *
 *   MARK      a 20px glyph, always, never a text character. What kind of thing
 *             this is: a camera, a warning, a check, a dead radio.
 *   FIGURE    the 30px numeral, in the five states that lead with one. Bare --
 *             no unit and no separator -- because its noun is the CAPTION
 *             beside it and the number is read first.
 *   CAPTION   the 15px run that qualifies the figure. Ellipsised, and the only
 *             thing in the lede allowed to truncate.
 *   or
 *   HEADLINE  a 19px sentence INSTEAD of a figure and caption, in the nine
 *             states with no number worth printing. `Working from cache`,
 *             `Likely under surveillance`, `Clear for 2.1 mi`.
 *
 *   TIER      the density word, `exposure high`, in the tier's own colour and
 *             only where there is a count. See the ramp below.
 *   LINE      the 13px meta run. Ellipsised.
 *   VALUE     a small trailing value -- MUTED's countdown, IDLE's mapped total.
 *   KEY       the right slot: one action, or one static word, or nothing.
 *
 * AND AN OPTIONAL 56px MAP INSET beside the pair, in the two states the spec
 * draws one: it shows the one thing words cannot, which way the lens looks. It
 * is a static tile -- `MapInset` and its header say why it must never become a
 * live map instance in a dock row.
 *
 * WHY THE TABLES ARE HERE. Which glyph a state leads with, whether it draws a
 * figure or a sentence, and whether it offers a tile are RENDERING facts: they
 * never vary with the data, only with the state, so they are not in `DockData`.
 * `dockState.ts` carries the strings; this file carries the shape they go into.
 *
 * THIS FILE DRAWS NO COLOUR. The state is on the pane as `data-fwm-state`, the
 * density tier is on the body as `data-fwm-density`, and `dock.css` resolves
 * every hue from those two. Not one token name appears below.
 */

import type { ReactElement } from 'react';

import { dockDensityTier } from './ExpandedPanel.tsx';
import type { DockDensityTier } from './ExpandedPanel.tsx';
import type { DockActionKey, DockData, DockStateId } from './dockState.ts';
import { DockIcon, type DockIconName } from './icons.tsx';
import { DOCK_INSET_DRIVE, MapInset } from './MapInset.tsx';
import { ArcadeKey } from '../arcade/ArcadeKey.tsx';

/** Every leading glyph in the collapsed pane is drawn at 20px. */
const MARK_SIZE = 20;
/** The reroute branch beside the detour offer. The glyph is the verb. */
const KEY_ICON_SIZE = 15;
/** MUTED's undo arrow, the one key that is not the detour offer. */
const UNDO_ICON_SIZE = 15;

/**
 * WHAT EACH STATE LEADS WITH.
 *
 * Every collapsed state has one, and the spec draws all fourteen: there is no
 * dot-plus-glyph and no bare row. The camera is the reader, the triangle is the
 * warning, the check is the all-clear, the crossed radio is the outage.
 *
 * UNDER SURVEILLANCE DRAWS THE CAMERA AND THE SPEC DRAWS AN EYE. `icons.tsx`
 * ships no eye and inventing one here would put a drawing in a component file
 * that the icon table cannot reach; the camera is the same subject said with
 * the vocabulary that exists. Listed in the report as an icon to add.
 */
const MARK: Readonly<Record<DockStateId, DockIconName>> = {
  idle: 'check',
  armed: 'camera',
  'armed-expanded': 'camera',
  dense: 'camera',
  muted: 'mute',
  offline: 'wifi-off',
  navigating: 'navigate',
  'navigating-expanded': 'navigate',
  cruising: 'camera',
  approaching: 'warning',
  passing: 'camera',
  cleared: 'check',
  'abuse-zone': 'newspaper',
  'abuse-entering': 'newspaper',
  'gps-weak': 'gps-off',
  'mesh-sync': 'mesh-hex',
  rerouted: 'reroute',
  unmapped: 'plus-circle',
  arrived: 'flag',
};

/**
 * THE FIVE STATES THAT LEAD WITH A NUMBER.
 *
 * A figure earns the 30px slot when the reading IS a number: a count of
 * readers, a distance, a countdown. The other nine have no number worth
 * printing -- `Working from cache` is not a quantity, and setting a word at
 * 30px would make the pane shout a thing it cannot act on -- so they spend the
 * lede on one 19px sentence instead.
 *
 * It is a table and not a test on the data because the data cannot tell them
 * apart: CLEARED carries `Cleared` in the same field CRUISING carries `2 min`.
 */
const LEADS_WITH_FIGURE: ReadonlySet<DockStateId> = new Set<DockStateId>([
  'armed',
  'dense',
  'abuse-zone',
  'cruising',
  'approaching',
]);

/**
 * THE TWO STATES THAT DRAW THE MAP INSET, and the tile each one gets.
 *
 * Both are about a reader's LENS rather than its distance -- one is 600 feet
 * from a cone and the other is inside it -- and the facing is the one thing the
 * sentence beside it cannot say. The other twelve have nothing to draw: a
 * cached map, a mute countdown and a mesh sync are not places.
 */
const INSET: ReadonlySet<DockStateId> = new Set<DockStateId>(['approaching', 'passing']);

/**
 * THE STATES WHOSE COUNT IS A CAMERA DENSITY.
 *
 * ONE. `DockData.count` is the 30px numeral and nothing more specific than
 * that, so ABUSE ZONE's `3` sits in the same field as DENSE AREA's `14` -- and
 * three sourced misconduct reports in a jurisdiction is not an exposure
 * reading. Running the ramp on it would paint an accountability number in the
 * density hue and print `exposure low` under the words `abuse reports`, which
 * is two of the brief's rules broken at once: hue carrying two meanings, and a
 * tier word that is not about the thing beside it.
 *
 * So the ramp is gated on the state rather than on the presence of a number.
 * B2 says what it measures in its own subtitle -- cameras per 2 mi -- and this
 * is the list of states that measure that.
 *
 * CRUISING JOINED IT, and it always should have. It prints `26 cameras within
 * 2 mi` from `input.exposureCount` - the same two-mile set DENSE counts and the
 * same set the ramp reads - so a driver saw the identical measurement tiered on
 * one state and drawn in plain white on the other, with the tier word missing
 * entirely. Same question, same number, two different answers on screen.
 */
const COUNTS_CAMERAS: ReadonlySet<DockStateId> = new Set<DockStateId>(['dense', 'cruising']);

/**
 * The tier a state is in, or `undefined` where the ramp does not apply.
 *
 * `Dock` reads this for the body's `data-fwm-density`, which carries the
 * COLOUR; this file reads it for `DOCK_TIER_WORD`, which carries the WORD. One
 * function, so the two halves of the ramp cannot disagree.
 */
export function dockDensityOf(state: DockStateId, data: DockData): DockDensityTier | undefined {
  if (!COUNTS_CAMERAS.has(state) || data.count === undefined) return undefined;
  return dockDensityTier(data.count);
}

/**
 * THE DENSITY RAMP. Four tiers, and the word rides beside the colour.
 *
 * Colour never travels alone: anyone who cannot use hue reads the word
 * instead, and both come off `dockDensityTier` so they cannot disagree. The
 * thresholds are the spec's -- 0, 1-5, 6-12, 13+ -- and live in that function;
 * this is only what each tier is called on the glass.
 *
 * `exposure` AND NOT A BARE `high`. B2's cards label the number alone, where
 * the surrounding card already says what is being counted. Section A draws the
 * real dock and spells it `exposure high` in the meta line, because on a pane
 * that also carries a distance and a route count, one adjective with no noun
 * is a word the driver has to work out.
 */
export const DOCK_TIER_WORD: Readonly<Record<DockDensityTier, string>> = {
  clear: 'exposure clear',
  low: 'exposure low',
  moderate: 'exposure moderate',
  high: 'exposure high',
};

/**
 * THE DETOUR KEY'S FACE, SPELLED HERE AND NOT READ OFF `dockAroundLabel`.
 *
 * `Reroute around 3`, never a bare `Around 3` -- rule 7 of the handoff, and the
 * reason is grammar: `Around 3` names a quantity without saying what happens to
 * it, and a driver reading four characters at 70mph gets a number and no verb.
 *
 * `dockState.dockAroundLabel` still returns the bare form. It is not this
 * file's to change and nothing here calls it; `DriveRows` spells the same
 * sentence for the navigation pane's own slot. Listed in the report as one
 * string to retire once `dockState.ts` is rebuilt.
 */
export function dockDetourLabel(count: number): string {
  return `Reroute around ${String(count)}`;
}

/**
 * WHAT THE KEY SAYS OUT LOUD, which is not quite what it draws.
 *
 * The painted label is already a whole sentence, so the spoken one only has to
 * name what is being routed around -- a reader, not a number.
 */
export function dockDetourSpoken(count: number): string {
  return count === 1 ? 'Reroute around 1 reader' : `Reroute around ${String(count)} readers`;
}

export interface BrowseRowProps {
  readonly state: DockStateId;
  readonly data: DockData;
  readonly onAction: ((action: DockActionKey) => void) | undefined;
}

export function BrowseRow({ state, data, onAction }: BrowseRowProps): ReactElement {
  const figure = LEADS_WITH_FIGURE.has(state) ? figureOf(data) : undefined;
  const headline = figure === undefined ? headlineOf(data) : undefined;
  /* THE CAPTION AND THE META LINE COME OUT OF ONE ORDERED LIST, so no sentence
     is drawn twice and none is silently dropped. A lede with a figure in it
     spends the first candidate on the caption; a lede with a headline has
     already spent one, so the meta line takes the first that is left. */
  const pool = sentences(data, headline);
  const caption = figure === undefined ? undefined : pool[0];
  const rest = figure === undefined ? pool : pool.slice(1);
  const tier = dockDensityOf(state, data);

  return (
    <div className="fwm-dock-split">
      <div className="fwm-dock-column">
        <div className="fwm-dock-lede">
          <span className="fwm-dock-mark">
            <DockIcon name={MARK[state]} size={MARK_SIZE} />
          </span>

          {figure === undefined ? null : <span className="fwm-dock-count">{figure}</span>}

          {figure === undefined ? (
            headline === undefined ? null : (
              <span className="fwm-dock-headline">{headline}</span>
            )
          ) : caption === undefined ? null : (
            <span className="fwm-dock-caption">{caption}</span>
          )}
        </div>

        <div className="fwm-dock-meta">
          {/* THE TIER WORD LEADS THE LINE, in the tier's own hue at weight 700,
              and the sentence follows it. This is the half of the ramp that is
              not colour. */}
          <span className="fwm-dock-line-meta">
            {tier === undefined ? null : (
              <strong className="fwm-dock-tier">{DOCK_TIER_WORD[tier]}</strong>
            )}
            {tier !== undefined && rest[0] !== undefined ? ' · ' : null}
            {rest[0]}
          </span>

          {data.countdown === undefined ? null : (
            <span className="fwm-dock-value">{data.countdown}</span>
          )}
          {rest[1] === undefined ? null : <span className="fwm-dock-value">{rest[1]}</span>}

          <MetaKey state={state} data={data} onAction={onAction} />
        </div>
      </div>

      {/* THE INSET SLOT, BORROWED WHEN EMPTY. The two states that draw a tile
          are both moving, and the game is only offered to a parked car, so
          the two never meet -- and if a flag ever arrived on APPROACHING or
          PASSING the tile would still win, because the facing is a fact and
          the key is a toy. `MetaKey` above is untouched: the detour key keeps
          its slot and its precedence. */}
      {INSET.has(state) ? (
        <MapInset variant="camera" size={DOCK_INSET_DRIVE} />
      ) : data.arcade === true ? (
        <ArcadeKey
          onPress={() => {
            onAction?.('arcade');
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * THE RIGHT SLOT. One key, one static word, or nothing.
 *
 * THE DETOUR OFFER COMES FIRST wherever a count exists to route around: it is
 * the only thing on a collapsed pane that changes the drive, and the states
 * that also carry a word in this slot -- CLEARED's `Dismiss`, ABUSE,
 * ENTERING's `Read` -- are the states with nothing to route around.
 *
 * A STATIC WORD IS DRAWN AS A SPAN AND NOT AS A BUTTON. The spec draws both
 * that way, and a word that looks pressable and is not is worse than a word
 * that does not.
 */
function MetaKey({
  state,
  data,
  onAction,
}: {
  readonly state: DockStateId;
  readonly data: DockData;
  readonly onAction: ((action: DockActionKey) => void) | undefined;
}): ReactElement | null {
  /*
   * MUTED'S UNDO OUTRANKS THE DETOUR KEY, AND IT IS THE ONLY STATE THAT DOES.
   *
   * There is one key slot, and while a route is live the detour count claims
   * it in every state -- which is how MUTED shipped with `Reroute around 9`
   * where its Undo should be and NO WAY BACK OUT OF A MUTE ON THE SCREEN AT
   * ALL. Reported by the owner: "there is no way to unmute".
   *
   * The tie is broken by which key the driver cannot get any other way. The
   * detour offer has three other doors -- `AlertV1`'s REROUTE key, the same
   * key on every other dock state, and this one again the moment the mute
   * lapses -- and it comes back on its own. A mute has exactly one door, this
   * one, and until it lapses the app is quiet about readers it can see. A
   * silence the driver cannot leave is the failure; a detour offered a state
   * later is not.
   *
   * The other two labelled keys stay BELOW the detour count deliberately.
   * CLEARED's `Wrong?` disputes a pass that has already happened and will
   * still be disputable afterwards, and UNMAPPED's `Add` is unreachable in
   * this build; neither is a door out of a state the driver is stuck in.
   */
  if (state === 'muted' && data.keyLabel !== undefined) {
    return (
      <button
        type="button"
        className="fwm-dock-action"
        data-fwm-action="undo"
        onClick={() => {
          onAction?.('undo');
        }}
      >
        <DockIcon name="undo" size={UNDO_ICON_SIZE} />
        {data.keyLabel}
      </button>
    );
  }

  if (data.around !== undefined) {
    return (
      <button
        type="button"
        className="fwm-dock-action"
        data-fwm-action="around"
        aria-label={dockDetourSpoken(data.around)}
        onClick={() => {
          onAction?.('around');
        }}
      >
        <DockIcon name="reroute" size={KEY_ICON_SIZE} />
        {dockDetourLabel(data.around)}
      </button>
    );
  }

  if (state === 'cleared' && data.keyLabel !== undefined) {
    return (
      <button
        type="button"
        className="fwm-dock-action"
        data-fwm-action="wrong"
        onClick={() => {
          onAction?.('wrong');
        }}
      >
        <DockIcon name="camera-plus" size={KEY_ICON_SIZE} />
        {data.keyLabel}
      </button>
    );
  }

  if (state === 'unmapped' && data.keyLabel !== undefined) {
    return (
      <button
        type="button"
        className="fwm-dock-action"
        data-fwm-action="add"
        onClick={() => {
          onAction?.('add');
        }}
      >
        {data.keyLabel}
      </button>
    );
  }

  /* The static word: UNMAPPED's `Dismiss` and ABUSE, ENTERING's `Read`, which
     is a citation rather than an action this build can carry out. */
  return data.secondaryTrailing === undefined ? null : (
    <span className="fwm-dock-static">{data.secondaryTrailing}</span>
  );
}

/** The 30px readout, in the five states that lead with one. */
function figureOf(data: DockData): string | undefined {
  return data.count === undefined ? (data.distance ?? data.figure) : String(data.count);
}

/** The 19px sentence, in the nine that do not. */
function headlineOf(data: DockData): string | undefined {
  /* UNDER SURVEILLANCE's two lines become one. v2 hard-broke `Likely under` /
     `surveillance` at 26px because it drew a 71px row; the lede is 44 and the
     spec sets the whole phrase on one line at 19. The tuple survives in
     `DockData` and is joined here rather than re-typed, so the two spellings
     cannot drift. */
  if (data.figureLines !== undefined) return data.figureLines.join(' ');
  return data.figure ?? data.statusText;
}

/**
 * WHICH FIELD GOES IN WHICH SLOT, decided once.
 *
 * `DockData` names its fields for the slot they filled in v2's layout, and v3
 * has two runs and a trailing value where v2 had four slots across two
 * differently-shaped rows. Rather than a per-state table of field names --
 * nineteen rows that would go stale the moment a fixture changed -- the
 * candidates are taken in a fixed order and each slot consumes one in turn.
 *
 * `headline` is filtered out so a sentence already spent on the 19px line is
 * not printed again underneath it, which is the one way this could read wrong.
 */
function sentences(data: DockData, headline: string | undefined): readonly string[] {
  return [data.statusText, data.subline, data.secondaryText, data.statusTrailing].filter(
    (line): line is string => line !== undefined && line !== headline,
  );
}
