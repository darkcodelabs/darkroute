/**
 * THE MENU LANGUAGE. Section C of the chrome brief, section B of
 * `searchbar_and_buttons.dc.html`, and nothing else.
 *
 * SEVEN ROW TYPES: select, filter, toggle, navigate, action, note -- the six
 * the section draws -- and SLIDER, which it does not. A menu is a panel of 44px
 * rows under a tracked caps header, and every menu in the product is assembled
 * from these parts. That is the whole point of the section -- not one menu, a
 * language -- so this file exports a set a caller composes and hard-codes no
 * menu of its own.
 *
 * THE SEVENTH IS NUMBERED LAST BECAUSE IT ARRIVED LAST, and it is the only one
 * with no drawing behind it. MAP VIEW carries a warn-distance the driver drags,
 * the six types have no shape that is dragged, and the panel had been carrying
 * a private control of its own instead -- which is how three panels over one
 * map ended up looking like three products. A row type in the language that
 * every panel can reach is the smaller of the two wrongs. See section 7 for
 * what it borrows from the toggle row and what it had to decide alone.
 *
 * THE THREE RULES THAT ARE NOT GEOMETRY, and each is as load-bearing as the
 * 44px:
 *
 *   ONE SELECTION, EVER. The only thing in the whole language that fills with
 *   accent is the current choice. If two rows are accented the panel has
 *   stopped saying anything.
 *
 *   THE DOT IS THE TAXONOMY. A filter row carries a 9px owner dot and never a
 *   text tag beside it. The map already draws that hue for that operator; a
 *   word as well is a second encoding of one fact, and the second one goes
 *   stale.
 *
 *   THE STATE IS SPELLED OUT. A toggle row prints its current state in words
 *   as well as drawing the switch. "off -- not a policy layer" is the half a
 *   driver can act on; the switch alone is a shape.
 *
 * ROWS NEVER MIX TYPES INSIDE A GROUP. {@link MenuGroup} is where a group is
 * named; it adds no geometry, so a panel built without one measures the same.
 *
 * =============================================================================
 * COLOUR AND GEOMETRY ARE NOT HERE
 * =============================================================================
 * Not one hex, not one pixel. `menu.css` resolves both -- surfaces, inks and
 * accent to the literal `--dr-*` chrome tokens, the owner dots to the palette
 * through `--dr-owner-*`, and every length to a ratio off `--fwm-space-1`.
 * `scripts/check-design-values.mjs` fails the build on a raw value anywhere
 * else. The five values the spec draws that have no token are written up in
 * that file, beside the rule each one meets.
 *
 * =============================================================================
 * WHAT A ROW REPORTS, AND WHAT IT DECIDES
 * =============================================================================
 * Nothing. No row here holds state, reads a store or knows what a camera is.
 * Each is handed what to draw and reports the one press it has. A handler left
 * off means "not wired in this build" and the control renders disabled rather
 * than live-looking and inert -- the idiom `TextSizePicker` and
 * `SettingsSwitch` already run on.
 *
 * =============================================================================
 * WHERE A ROW IS A BUTTON, AND WHERE IT IS NOT
 * =============================================================================
 * The spec says which by where it writes `cursor: pointer`: the FILTER,
 * NAVIGATE and ACTION rows carry it; the SELECT row and the TOGGLE row do not.
 * That is a complete and consistent affordance grammar across the whole panel,
 * so it is transcribed rather than second-guessed. A toggle row's target is its
 * switch, and a select row STATES the current choice rather than offering it.
 *
 * The spec draws every row as a `<div>`, which is correct for a static page
 * and unusable in a product: a tap target that is not a button is unreachable
 * by keyboard and invisible to a screen reader. The three pressable types are
 * `<button>` here. This is the same deliberate deviation `TabRow` documents,
 * and it is the only one this file makes.
 *
 * =============================================================================
 * NO TEXT-CHARACTER GLYPHS
 * =============================================================================
 * The radio, the owner dot and the switch knob are styled spans. The chevron
 * and the action icon are inline SVG in a 24-unit box at 1.7 stroke with round
 * caps and joins and no fill, painting in `currentColor` -- the brief's icon
 * rule and the spec's own paths.
 */

import type { ReactElement, ReactNode } from 'react';

import './menu.css';

/* ------------------------------------------------------------------------ *
 * THE TAXONOMY
 * ------------------------------------------------------------------------ */

/**
 * WHOSE HARDWARE IS ON THE POLE, as a token rather than a colour.
 *
 * The five the spec's own filter group draws, in its order: police, flock
 * (inter-agency shared), hoa, private, unverified. `menu.css` maps each to
 * `--dr-owner-*`, which is the one colour in the menu language that still
 * resolves to the driver's palette -- an operator hue means the same thing
 * here, on the map and in the dock, so it moves with them.
 */
export type MenuOwner = 'flock' | 'police' | 'hoa' | 'private' | 'unverified';

/**
 * AN ACTION'S HUE, and there is exactly one of them.
 *
 * "Hue carries exactly one meaning" is the brief's own rule, and `report` --
 * the Flock pink -- is the only action the spec draws. A second member is a
 * second meaning and a second token, so it is not guessed at here: the axis is
 * named so a second one has somewhere to go, and left empty because the spec
 * leaves it empty.
 */
export type MenuActionTone = 'report';

/**
 * A WHOLE PANEL'S HUE AND MATERIAL, as one word.
 *
 * Absent is the language as `menu.css` publishes it: the cyan accent on
 * `--dr-surface-menu` at 0.90, no shadow. `abuse` is brief 4 section A's
 * documented-abuse menu, which is red on the thin 0.72 glass -- one of only
 * three glass surfaces in that whole brief, everything else in it being
 * opaque.
 *
 * WHY THE VARIANT'S DECLARATIONS ARE NOT IN `menu.css`. Two of its own tests
 * are load-bearing rules rather than measurements: the accent fill may appear
 * in exactly two places, and no shadow may do a hairline's work. The abuse cut
 * draws a third fill and a cast shadow, so writing it into the language file
 * would either break those pins or quietly weaken what they protect. The tone
 * is DECLARED here -- so the panel carries an attribute a stylesheet can see,
 * and so a reader of this file knows a second look exists -- and PAINTED in
 * `features/map/abuseMenu.css`, beside the panel that is the only thing using
 * it. The default is untouched by construction: no attribute, no rule.
 */
export type MenuTone = 'abuse';

/* ------------------------------------------------------------------------ *
 * THE PANEL
 * ------------------------------------------------------------------------ */

export interface MenuProps {
  /** Rows, groups, rules and notes, in the order they are drawn. */
  readonly children: ReactNode;
  /**
   * The panel's hue and material. See {@link MenuTone} -- there is one, and
   * omitting it is the language exactly as `menu.css` publishes it.
   */
  readonly tone?: MenuTone | undefined;
}

/**
 * THE PANEL. radius 20, `--dr-surface-menu`, hairline, `--dr-blur`, padding
 * 14, gap 4 -- the six properties that are the whole of what a panel is.
 */
export function Menu({ children, tone }: MenuProps): ReactElement {
  /* `undefined` renders NO attribute, which is what keeps the default the
     drawing: a panel nobody toned is selected by not one rule outside this
     file's own stylesheet. */
  return (
    <div className="fwm-menu" data-fwm-tone={tone}>
      {children}
    </div>
  );
}

export interface MenuGroupProps {
  /**
   * What this run of rows is about, for assistive technology.
   *
   * Optional because the spec's own panel groups nothing explicitly -- its one
   * boundary is a {@link MenuRule}. Naming a group is how a caller makes "rows
   * never mix types inside a group" true for a screen reader as well as for
   * the eye.
   */
  readonly label?: string | undefined;
  readonly children: ReactNode;
}

/**
 * A GROUP, WHICH IS NOT A ROW TYPE.
 *
 * It re-states the panel's own 4px gap and adds nothing else, so a grouped run
 * and a loose run measure identically. That is deliberate: the spec's flat
 * panel has to be buildable exactly, and a wrapper that changed the geometry
 * would make the two mutually exclusive.
 */
export function MenuGroup({ label, children }: MenuGroupProps): ReactElement {
  return (
    <div className="fwm-menu-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export interface MenuHeaderProps {
  /** The 11px accent label. Drawn in caps by the stylesheet, whatever the case here. */
  readonly label: string;
  /** The 13px muted sub-line under it. */
  readonly sub: string;
}

/** The header: an 11px accent label in tracked caps over a 13px muted sub-line. */
export function MenuHeader({ label, sub }: MenuHeaderProps): ReactElement {
  return (
    <div className="fwm-menu-head">
      <p className="fwm-menu-head-label">{label}</p>
      <p className="fwm-menu-head-sub">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * 1 -- SELECT
 * ------------------------------------------------------------------------ */

export interface MenuSelectProps {
  readonly label: string;
  /**
   * How many the choice covers. Drawn as bare digits, which is what the spec
   * draws -- `1010`, not `1,010`. A separator here would be a formatting
   * decision the design has not made.
   */
  readonly count: number;
}

/**
 * 1 -- SELECT. A 15px radio, the label, the count, on accent fill and accent
 * line. EXACTLY ONE PER GROUP, EVER, and the only accent fill in the language.
 *
 * NOT A BUTTON, AND THE UNSELECTED SIDE IS NOT BUILT. The spec draws one select
 * row, it is the chosen one, and it is the only row in the panel without
 * `cursor: pointer`. What an unchosen select row looks like -- hollow radio,
 * un-accented ground, some other label weight -- appears nowhere in the spec or
 * the brief, and deriving it would be inventing three values. So this states
 * the current choice; the alternatives beside it in the spec's own panel are
 * {@link MenuFilter} rows, which is why those are pressable and this is not.
 *
 * If the intent was a live radio group, that is a value the spec is missing and
 * it needs an answer rather than a guess.
 */
export function MenuSelect({ label, count }: MenuSelectProps): ReactElement {
  return (
    <div className="fwm-menu-row" data-fwm-row="select">
      {/* The radio is a picture of the accent fill's own claim, so it is not
          announced a second time. */}
      <span className="fwm-menu-radio" aria-hidden="true">
        <span className="fwm-menu-radio-core" />
      </span>
      <span className="fwm-menu-label">{label}</span>
      <span className="fwm-menu-count">{String(count)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * 2 -- FILTER
 * ------------------------------------------------------------------------ */

export interface MenuFilterProps {
  /** Whose hardware. The dot IS the taxonomy -- never add a text tag beside it. */
  readonly owner: MenuOwner;
  readonly label: string;
  readonly count: number;
  /** Absent means "not wired in this build" -- the row renders inert. */
  readonly onPress?: (() => void) | undefined;
}

/**
 * 2 -- FILTER. A 9px owner dot, a 13px label, a count.
 *
 * WHAT PRESSING ONE DOES IS NOT IN THE SPEC. The row carries `cursor: pointer`
 * and no state of any kind -- no check, no accent, nothing that distinguishes
 * one filter row from another. So it reports the press and decides nothing,
 * and the caller owns the meaning. Drawing an on/off state here would be
 * inventing an appearance the spec does not have.
 */
export function MenuFilter({ owner, label, count, onPress }: MenuFilterProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-menu-row"
      data-fwm-row="filter"
      disabled={onPress === undefined}
      onClick={onPress}
    >
      <span className="fwm-menu-dot" data-fwm-owner={owner} aria-hidden="true" />
      <span className="fwm-menu-label">{label}</span>
      <span className="fwm-menu-count">{String(count)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------------ *
 * 3 -- TOGGLE
 * ------------------------------------------------------------------------ */

export interface MenuToggleProps {
  readonly label: string;
  /**
   * THE CURRENT STATE IN WORDS, and it is required.
   *
   * "off -- not a policy layer", "sound and haptics on" -- the spec's own two.
   * The switch says on or off; this says what that means. A toggle row without
   * it is a switch with a caption, which is the row type the brief is
   * explicitly not asking for.
   */
  readonly state: string;
  readonly on: boolean;
  /**
   * THE ONE ROW THE PANEL IS ABOUT, drawn filled rather than on row ground.
   *
   * AND IT DRAWS NOTHING IN THE DEFAULT TONE, deliberately. "One selection,
   * ever" is one of the three rules that are not geometry, the accent fill is
   * the select row's alone, and `Menu.test.tsx` pins `--dr-accent-fill` to
   * exactly two occurrences so that stays true. So this writes an attribute
   * and no default rule reads it.
   *
   * A TONE is what makes it visible, and the abuse tone is the one that
   * publishes a fill for it -- brief 4 section A draws `Show abuse areas`
   * accent-filled in red while the three toggles under it sit on row ground.
   * Passing this without a tone is a no-op rather than an error: the row is
   * still a correct toggle, it is just not singled out, which is the honest
   * outcome for a look nobody has drawn.
   *
   * At most one per panel. Not enforced here for the same reason
   * {@link MenuAction}'s "always last, never more than one" is not: a row
   * cannot read its siblings, so it is the caller's rule to keep.
   */
  readonly filled?: boolean | undefined;
  /** Absent means "not wired in this build" -- the switch renders disabled. */
  readonly onToggle?: ((on: boolean) => void) | undefined;
}

/**
 * 3 -- TOGGLE. Label, the current state in words, a 40 x 23 switch.
 *
 * THE ROW IS NOT THE TARGET. The spec gives it no `cursor: pointer`; the switch
 * is the control and carries the label as its accessible name, which is the
 * arrangement `SwitchRow` and `SettingsSwitch` already use. The words are
 * visible text and `aria-checked` carries the same fact to a screen reader, so
 * the two cannot drift.
 */
export function MenuToggle({
  label,
  state,
  on,
  filled,
  onToggle,
}: MenuToggleProps): ReactElement {
  return (
    <div
      className="fwm-menu-row"
      data-fwm-row="toggle"
      /* Only ever written `true`. `false` and the attribute's absence mean the
         same thing and a stylesheet would have to select both, so the falsy
         case renders nothing at all. */
      data-fwm-filled={filled === true ? 'true' : undefined}
    >
      <span className="fwm-menu-label">{label}</span>
      <span className="fwm-menu-value">{state}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="fwm-menu-switch"
        disabled={onToggle === undefined}
        onClick={
          onToggle === undefined
            ? undefined
            : () => {
                onToggle(!on);
              }
        }
      >
        <span className="fwm-menu-switch-knob" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * 4 -- NAVIGATE
 * ------------------------------------------------------------------------ */

/** The chevron's size in the spec's own drawing. 16px in a 24-unit box. */
const CHEVRON_PX = 16;

/** The action icon's size in the spec's own drawing. 17px in a 24-unit box. */
const ACTION_ICON_PX = 17;

export interface MenuNavigateProps {
  readonly label: string;
  /** The current answer, right-aligned. The chevron opens where it is changed. */
  readonly value: string;
  /** Absent means "not wired in this build" -- the row renders inert. */
  readonly onOpen?: (() => void) | undefined;
}

/**
 * 4 -- NAVIGATE. Label, current value right-aligned, chevron.
 *
 * WHAT OPENS IS A PANEL OF THE SAME KIND. That is the chevron's promise and the
 * reason this is a row type rather than a link: a menu never opens a dialog, a
 * sheet or a screen, it opens another menu built from these same six types.
 */
export function MenuNavigate({ label, value, onOpen }: MenuNavigateProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-menu-row"
      data-fwm-row="navigate"
      disabled={onOpen === undefined}
      onClick={onOpen}
    >
      <span className="fwm-menu-label">{label}</span>
      <span className="fwm-menu-value">{value}</span>
      <svg
        className="fwm-menu-chevron"
        viewBox="0 0 24 24"
        width={CHEVRON_PX}
        height={CHEVRON_PX}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9.5 6.5 15 12l-5.5 5.5" />
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------------ *
 * 5 -- ACTION
 * ------------------------------------------------------------------------ */

export interface MenuActionProps {
  /**
   * The glyph, as inline SVG in a 24-unit box painting in `currentColor`.
   *
   * Supplied by the caller rather than named from a list: an action's icon is
   * the action's, and the spec draws exactly one of them.
   * {@link MenuReportIcon} is that one, transcribed.
   */
  readonly icon: ReactNode;
  readonly label: string;
  /** The action's own hue. See {@link MenuActionTone} -- there is one. */
  readonly tone?: MenuActionTone | undefined;
  /** Absent means "not wired in this build" -- the row renders inert. */
  readonly onAct?: (() => void) | undefined;
}

/**
 * 5 -- ACTION. Icon and label, tinted to the action's own hue.
 *
 * ALWAYS LAST, NEVER MORE THAN ONE. Neither is enforced here and neither could
 * be without this component reading its siblings, which is a panel's business
 * and not a row's. It is the caller's rule to keep: an action anywhere but the
 * bottom, or two of them, and a panel of choices starts reading as a panel of
 * commands.
 */
export function MenuAction({
  icon,
  label,
  tone = 'report',
  onAct,
}: MenuActionProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-menu-row"
      data-fwm-row="action"
      data-fwm-tone={tone}
      disabled={onAct === undefined}
      onClick={onAct}
    >
      <span className="fwm-menu-act-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="fwm-menu-label">{label}</span>
    </button>
  );
}

/**
 * THE ONE ACTION GLYPH THE SPEC DRAWS -- the report camera, at 17px.
 *
 * Every `d` is byte-identical to `searchbar_and_buttons.dc.html`; nothing was
 * redrawn, simplified or sourced from an icon set. Colour is NOT copied: the
 * spec writes `stroke="#ff7ad2"`, which would be a raw hex here and right in
 * one skin and wrong in sixteen, so it paints in `currentColor` and takes its
 * hue from the row's tone. Same contract as `features/dock/icons.tsx`.
 */
export function MenuReportIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={ACTION_ICON_PX}
      height={ACTION_ICON_PX}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 8.5h3l1.4-2h6.2l1.4 2h3v9h-15z" />
      <path d="M12 10v5M9.5 12.5h5" />
    </svg>
  );
}

/* ------------------------------------------------------------------------ *
 * 6 -- NOTE, AND THE GROUP RULE
 * ------------------------------------------------------------------------ */

export interface MenuNoteProps {
  readonly children: ReactNode;
}

/**
 * 6 -- NOTE. 12px muted, no row, no border.
 *
 * It explains a CONSEQUENCE the rows cannot -- "Display only -- every camera is
 * still watched." is the spec's own, and it is there because a panel of filters
 * looks exactly like a panel of switches that turn surveillance off. Having no
 * ground and no edge is what makes it read as commentary on the rows rather
 * than as another one.
 */
export function MenuNote({ children }: MenuNoteProps): ReactElement {
  return <p className="fwm-menu-note">{children}</p>;
}

/**
 * THE GROUP BOUNDARY, WHICH IS NOT A SEVENTH ROW TYPE.
 *
 * A 1px rule inset 4, with 6 of air either side. The spec's panel draws exactly
 * one, between the owner filters and the settings under them, and that is what
 * it is for: the visible edge of "rows never mix types inside a group".
 */
export function MenuRule(): ReactElement {
  return <div className="fwm-menu-rule" role="separator" />;
}


/* ------------------------------------------------------------------------ *
 * 7 -- SLIDER
 * ------------------------------------------------------------------------ */

export interface MenuSliderProps {
  readonly label: string;
  /**
   * THE CURRENT VALUE IN WORDS, and it is required for the reason
   * {@link MenuToggleProps.state} is: the control is a picture and this is the
   * reading. It is also the whole accessible value -- see the input below.
   */
  readonly value: string;
  /** Where the thumb sits, on the scale `min` and `max` set up. */
  readonly at: number;
  readonly min: number;
  readonly max: number;
  /**
   * The step, and 1 -- an index step -- when it is left off.
   *
   * A LIST OF NAMED STOPS IS A RANGE OVER ITS INDICES, which is the shape this
   * row is really for. Pass `min={0}`, `max={list.length - 1}` and the default
   * step, and `at` is the index; `MapViewPanel` runs the alert threshold that
   * way because a linear range in feet spends nine tenths of its travel where
   * nobody needs the resolution. It is also why {@link onChange} reports the
   * POSITION and not a value: only the caller knows what stop four means.
   */
  readonly step?: number | undefined;
  /**
   * The sentence under the row, drawn as a {@link MenuNote}.
   *
   * NOT A SLOT OF ITS OWN. A note is already a type in this language -- 12px
   * muted prose with no ground and no edge -- and a second one drawn inside the
   * row would be the same words in a second style. Taken as a prop rather than
   * left to the caller because a slider is the one row whose value is a number
   * the driver has to be told the MEANING of, so the two travel together.
   */
  readonly note?: ReactNode;
  /** Absent means "not wired in this build" -- the control renders disabled. */
  readonly onChange?: ((at: number) => void) | undefined;
}

/**
 * 7 -- SLIDER. Label and current value on a row's own line, a track under them,
 * a note under that.
 *
 * THE ONLY ROW THAT IS TWO ROWS TALL, and it is the one deviation this type
 * makes from "every row is 44". The head line IS 44, so the label lands on the
 * same baseline as every label above and below it; the track gets a second 44
 * because a thumb in a windscreen mount has to be able to land anywhere on the
 * band rather than on an 8px bar. Everything else -- the ground, the hairline,
 * the radius, the type, the two gaps -- is the row material unchanged.
 *
 * WHAT IT DOES NOT DRAW IS A FILLED PORTION. `::-moz-range-progress` has no
 * WebKit twin, so a track that fills behind the thumb is a picture one engine
 * renders and the other does not; the accent is spent on the thumb, which is
 * where the switch already spends it.
 *
 * REPORTS THE POSITION AND DECIDES NOTHING, like every other row here. It holds
 * no state, does no lookup, and never sees what a stop means.
 */
export function MenuSlider({
  label,
  value,
  at,
  min,
  max,
  step = 1,
  note,
  onChange,
}: MenuSliderProps): ReactElement {
  return (
    <>
      <div className="fwm-menu-row" data-fwm-row="slider">
        <span className="fwm-menu-slider-head">
          <span className="fwm-menu-label">{label}</span>
          <span className="fwm-menu-value">{value}</span>
        </span>
        {/* `aria-valuetext` IS THE WHOLE ACCESSIBLE READING, because the input's
            own value is a position and a position is not a quantity -- a reader
            left to it announces "5 of 10", which says nothing about what is
            being set. `aria-label` names the control rather than pointing at the
            label span: a row has no id to hang `aria-labelledby` off and
            minting one would be a second thing to keep unique. Same arrangement
            the toggle row's switch uses. */}
        <input
          type="range"
          className="fwm-menu-slider"
          aria-label={label}
          aria-valuetext={value}
          min={min}
          max={max}
          step={step}
          value={at}
          disabled={onChange === undefined}
          onChange={
            onChange === undefined
              ? undefined
              : (event) => {
                  onChange(Number(event.target.value));
                }
          }
        />
      </div>
      {note === undefined ? null : <MenuNote>{note}</MenuNote>}
    </>
  );
}
