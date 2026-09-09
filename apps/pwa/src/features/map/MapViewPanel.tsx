/**
 * MAP VIEW - how the map behaves, as opposed to what it draws.
 *
 * =============================================================================
 * WHY THIS IS A SECOND PANEL AND NOT MORE ROWS IN THE FIRST
 * =============================================================================
 * The pill row started as ABUSE / LAYERS / CENTER, and CENTER was one action
 * wearing a whole pill. It is MAP VIEW now, and it holds the settings that
 * govern how the map behaves for the person driving: where it is pointed, how
 * it is angled, whether it clusters, when it warns, and whether the browser
 * chrome is in the way.
 *
 * LAYERS KEPT ITS OWN JOB, by owner decision: what the map DRAWS - the owner
 * filter, roadwork, the cartography. Those are questions about the data on the
 * screen. These are questions about the instrument. Folding them together
 * produced one long panel where the thing somebody opened it for was four
 * scrolls down, which is the failure the pill row existed to fix.
 *
 * Two of these rows - full screen and the map angle - USED to live in the
 * layers panel. They moved here rather than being duplicated: a setting in two
 * panels is two switches to keep in step, and the first time they disagree the
 * driver is the one who finds out.
 *
 * =============================================================================
 * CENTER IS AN ACTION AND EVERYTHING ELSE IS A STATE
 * =============================================================================
 * That is why it is first and why it is drawn as a row rather than a switch,
 * and why it is the one row that SHUTS the panel: recentering is something you
 * do and then want to look at. The switches all leave the panel open, because
 * a switch you cannot see the result of is a switch you press twice.
 *
 * =============================================================================
 * THE THIRD SECTION IS ABOUT WHEN THE APP SPEAKS, AND IT WRITES THE STORE
 * =============================================================================
 * Warn me at, spoken warnings and vibration came here from SETTINGS by owner
 * decision. They are not map settings, and that is the point: they are the
 * three things a driver changes DURING a drive - the passenger is on the phone,
 * the mount is rattling, the road is thick with readers - and SETTINGS is a
 * screen you have to leave the map to reach. Everything they governed
 * stays exactly where it was; only the place you reach them moved, and the
 * SETTINGS copies were deleted rather than mirrored, because the same switch in
 * two places is two things to keep in step.
 *
 * These three WRITE THE STORE DIRECTLY rather than taking a callback prop, and
 * two read it directly as well. `MapControlPanel` - the sibling that shares
 * this panel's chrome - already does exactly that for the owner filter. The
 * alternative is threading three more props through `DriveScreen`, which owns
 * none of these three values and would be forwarding them to their only
 * reader. The threshold's VALUE still arrives as a prop because DriveScreen
 * already holds it for the proximity bands on the cards.
 *
 * =============================================================================
 * EVERY ROW IS THE MENU LANGUAGE NOW, AND NONE OF THE COPY MOVED
 * =============================================================================
 * This panel used to draw a private `.fwm-drive-panel-*` set - its own switch
 * with its own track and thumb, its own two-line rows, its own slider - which
 * is why three chips sitting side by side over one map opened three panels that
 * looked like three products. Every row here is one of `features/chrome/
 * Menu.tsx`'s types now and this file hard-codes no geometry and no colour.
 *
 * NOT A BEHAVIOUR CHANGE ANYWHERE. Every handler, every label and every state
 * sentence below is the string it was; the constants they are read from did not
 * move and did not change. What moved is which component draws them.
 *
 * THE LANGUAGE HAD NO SLIDER AND HAS ONE NOW. `MenuSlider` was added for this
 * panel - see `Menu.tsx` section 7 - rather than left here as the one bespoke
 * control on an otherwise normalised panel. The threshold still runs over
 * `ALERT_THRESHOLD_STOPS_FT` BY INDEX and still writes the store on input; the
 * row reports the position and this file does the lookup, because a row in that
 * language decides nothing.
 *
 * THREE THINGS DID NOT MAP CLEANLY, and none of them is fixed by guessing:
 *
 *   TWO ACTION ROWS, WHERE THE LANGUAGE ALLOWS ONE. `Center on me` and `Done`
 *   are the only two rows here that DO something rather than hold a state, and
 *   `MenuAction` is the type for that - so both are one, and the language's
 *   "always last, never more than one" is broken on purpose and in the open.
 *
 *   BOTH ARE THEREFORE PINK. `MenuActionTone` has exactly one member, `report`,
 *   and it paints `--dr-owner-flock` - the hue the brief reserves for feeding
 *   the camera taxonomy. Neither of these rows reports anything. A neutral
 *   action tone is a token the brief author has to mint; inventing one here is
 *   the single thing `menu.css` says a caller may not do.
 *
 *   `Center on me`'s NOTE HAS NO SLOT. An action row is an icon and a label,
 *   with no value and no note, and `put the map back on the car` /
 *   `already following you` is a live reading rather than decoration - it is
 *   what stops the row looking pressable and doing nothing. It is drawn as a
 *   `MenuNote` directly under the row, which is the language's own 12px muted
 *   prose, rather than being reworded into the label or dropped.
 */

import { useCallback, useEffect } from 'react';
import type { ReactElement, RefObject } from 'react';

import {
  Menu,
  MenuAction,
  MenuGroup,
  MenuHeader,
  MenuNavigate,
  MenuNote,
  MenuRule,
  MenuSlider,
  MenuToggle,
} from '../chrome/Menu.tsx';
import { MAP_TILT_LABELS } from '../../app/mapTilt.ts';
import type { FwmMapTilt } from '../../app/mapTilt.ts';
import { ALERT_THRESHOLD_STOPS_FT } from '../../stores/fwmCore.ts';
import { useAudioEnabled, useSettingsStore, useVibrationEnabled } from '../../stores/index.ts';

import './mapViewPanel.css';

export const MAP_VIEW_LABEL = 'map view';

/**
 * THE HEADER, WHICH THIS PANEL WAS THE ONLY ONE OF THE THREE WITHOUT.
 *
 * Abuse draws `DOCUMENTED ABUSE` over a count line, Layers draws `WHAT THE MAP
 * DRAWS` over `on this phone`, and this one opened straight onto its first row
 * -- so its content started 9px further right and 13.5px further down than the
 * other two, which a person reads as three panels rather than one language.
 * Measured in Chromium against the other two, not eyeballed.
 *
 * THE SUB IS THE PANEL'S SUBJECT AND NOT ITS INSTRUCTIONS. The other two say
 * what the reading is about -- how many cases, whose phone -- so this one says
 * which of the map's behaviours are under it, because "map view" alone does not
 * distinguish it from LAYERS at a glance.
 */
export const VIEW_HEADER = 'MAP VIEW';
/* SHORT ENOUGH TO SIT ON ONE LINE, which is what makes the three headers the
   same height. Measured on production: the first version of this sentence
   wrapped at the panel's 278px and the header came out 67px against the other
   two panels' 47 -- fixing the missing header by introducing a 20px difference
   in the other direction. */
export const VIEW_HEADER_SUB = 'how the map behaves';

export const VIEW_CENTER = 'Center on me';
export const VIEW_CENTER_NOTE = 'put the map back on the car';
/** Said when the map is already following, so the row is not a no-op surprise. */
export const VIEW_CENTER_ALREADY = 'already following you';

export const VIEW_HEADING_UP = 'Turn the map with you';
export const VIEW_HEADING_UP_ON = 'the road ahead is always up';
export const VIEW_HEADING_UP_OFF = 'north stays up';

export const VIEW_CLUSTER = 'Cluster cameras';
export const VIEW_CLUSTER_ON = 'nearby readers merge into a count';
export const VIEW_CLUSTER_OFF = 'every reader is its own mark';

export const VIEW_ANGLE = 'Map angle';

export const VIEW_WIDE = 'Wide layout';
/* THE NOTE SAYS WHAT IS TRUE ON THE DEVICES THIS ROW EXISTS FOR. The switch is
   for a phone whose OS refuses to rotate, so "landscape" as a promise would be
   a lie there - what the app can always do is lay itself out wide. */
export const VIEW_WIDE_ON = 'forced on - the driving layout, rotated or not';
export const VIEW_WIDE_OFF = 'follow the phone - turn on if it will not rotate';

export const VIEW_FULLSCREEN = 'Full screen';
export const VIEW_FULLSCREEN_ON = 'on - the browser chrome is hidden';
export const VIEW_FULLSCREEN_OFF = 'hide the browser chrome';

export const VIEW_THRESHOLD = 'Warn me at';
/**
 * THE ONE ROW THAT IS NOT A PREFERENCE.
 *
 * Every other setting here changes how the map looks. This one decides how
 * close a reader gets before the app interrupts, which is the product's whole
 * behaviour - so the note says what the number MEANS rather than what it is.
 *
 * =============================================================================
 * IT IS A SLIDER NOW, REVERSING WHAT THIS COMMENT USED TO ARGUE
 * =============================================================================
 * What stood here was: NOT A SLIDER. The threshold is the one setting that
 * changes whether the app interrupts you, a drag control on a panel read at a
 * junction is the wrong place to change it, so the row reports the number and
 * goes to the real control in settings.
 *
 * The owner ruled otherwise, and the ruling is the one that counts. The
 * argument was also weaker than it read: the "real control" was five tap
 * targets on a screen you have to LEAVE THE MAP to reach, which is a worse
 * thing to do at a junction than move a thumb, and the link's own destination
 * has now been deleted. What survives of the concern is in the shape of the
 * control - eleven named stops rather than a continuum, so the value is always
 * one somebody meant, and a control a whole row tall.
 *
 * THE DISC IS 23 AND THE BAND IS 44, since the row became `MenuSlider`. This
 * used to draw the disc itself at the touch minimum; the language sizes the
 * INPUT at a row's height instead, so the whole band still drags, and sizes the
 * visible disc at the switch's own height so the two controls a menu can carry
 * present the same size of thing to a thumb. Nothing about the grab got
 * smaller; the picture of it did.
 */
export const VIEW_THRESHOLD_NOTE = 'how close a reader gets before the app speaks up';

/* THE TWO DELIVERY CHANNELS, moved here from SETTINGS with the threshold. They
   answer the question the row above asks - how close - with "and then what",
   so the three belong on one panel or on none. */
export const VIEW_AUDIO = 'Spoken warnings';
export const VIEW_AUDIO_ON = 'distance and side, once per camera';
export const VIEW_AUDIO_OFF = 'off - the screen and the buzz only';

export const VIEW_VIBRATION = 'Vibration';
export const VIEW_VIBRATION_ON = 'a short double pulse, nothing else';
export const VIEW_VIBRATION_OFF = 'off - nothing is buzzed';

/* The close key's word, exported now that it is a row like the others rather
   than a literal in the markup. The string is the one it always was. */
export const VIEW_DONE = 'Done';

/**
 * Feet in a mile, for the readout only.
 *
 * `DriveScreen` keeps its own copy for the same reason: this is a unit
 * conversion, not a design value, and importing one screen's private constant
 * into another is a worse coupling than the two agreeing about arithmetic that
 * cannot change.
 */
const FT_PER_MILE = 5280;

/**
 * THE STOP THE THUMB SITS ON for whatever is stored.
 *
 * `indexOf` is not enough. The watch bezel steps in 50s and v0's settings
 * slider offers nineteen values of its own, so a stored threshold can be 400 -
 * legal, in range, and not one of this slider's stops. The thumb goes to the
 * nearest stop and the READOUT still prints the stored number, which is the
 * pair to keep honest: the number is what the engine is warning at, and
 * printing the stop instead would put a threshold on screen that nobody set.
 */
export function nearestStopIndex(thresholdFt: number): number {
  let best = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const [index, stop] of ALERT_THRESHOLD_STOPS_FT.entries()) {
    const gap = Math.abs(stop - thresholdFt);
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * `500 ft`, or `0.25 mi` once feet stop being readable.
 *
 * The crossover is the quarter mile, which is the first stop where the figure
 * in feet is four digits: "1320 ft" is a number you have to convert before it
 * means anything to a driver, and "0.25 mi" is a distance. Below it, feet are
 * the unit every other reading on this screen already uses.
 */
export function thresholdReading(thresholdFt: number): string {
  if (thresholdFt < FT_PER_MILE / 4) return `${String(thresholdFt)} ft`;
  return `${String(Number((thresholdFt / FT_PER_MILE).toFixed(2)))} mi`;
}

export interface MapViewPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Where focus goes when this shuts - the pill that opened it. */
  readonly returnFocusTo: RefObject<HTMLButtonElement | null>;

  /** True while the driver has dragged away, so centring would do something. */
  readonly panned: boolean;
  readonly onCenter: () => void;

  readonly headingUp: boolean;
  readonly onToggleHeadingUp: () => void;

  readonly cluster: boolean;
  readonly onToggleCluster: () => void;

  readonly tilt: FwmMapTilt;
  readonly onNextTilt: () => void;

  readonly full: boolean;
  readonly onToggleFull: () => void;

  /**
   * FORCE THE WIDE LAYOUT. See `app/forceLandscape.ts` for why a driver needs
   * to be able to overrule detection at all, and `stores/settings.ts` for the
   * field it is persisted in.
   */
  readonly wide: boolean;
  readonly onToggleWide: () => void;

  /**
   * Feet. Read here, and WRITTEN here - see `VIEW_THRESHOLD_NOTE` for the
   * reversal, and the panel header for why the write does not come back out as
   * a callback.
   */
  readonly thresholdFt: number;
  /**
   * THE WAY OUT TO SETTINGS, WHICH NO ROW CALLS ANY MORE.
   *
   * It opened SETTINGS for the threshold stepper. That stepper is deleted and
   * this row is a slider, so nothing here calls it. It is still DECLARED, and
   * optional, only because `DriveScreen` still passes it and that file is not
   * this change's to edit. The edit it is waiting for is the deletion of these
   * four lines from `features/drive/DriveScreen.tsx`:
   *
   *     onOpenThreshold={() => {
   *       openScreen('settings');
   *     }}
   *
   * and then of this prop. `openScreen` has other callers in that file, so the
   * import stays.
   */
  readonly onOpenThreshold?: (() => void) | undefined;
}

/**
 * THE TWO ACTION GLYPHS THIS PANEL DRAWS.
 *
 * `MenuAction` takes its icon from the caller rather than naming one from a
 * list, on the argument that an action's icon is the action's - so these are
 * here and not in `Menu.tsx`, which draws only the one the spec draws. Both
 * follow the brief's icon rule to the letter: a 24-unit box at 1.7 stroke with
 * round caps and joins, no fill, painting in `currentColor` so the row's tone
 * moves the glyph and the label together and the two can never end up different
 * colours. 17px is `MenuReportIcon`'s size, because a second size on the same
 * row type would be a second decision nobody made.
 *
 * NEITHER IS TRANSCRIBED FROM A DRAWING, because there is no drawing: the spec
 * has one action row and it is the report camera. A crosshair for "put the map
 * back on the car" and a check for "shut this" are the two most literal shapes
 * either could take.
 */
const ACTION_ICON_PX = 17;

function CenterIcon(): ReactElement {
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
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}

function DoneIcon(): ReactElement {
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
      <path d="M5 12.5 10 17.5 19 7.5" />
    </svg>
  );
}

export function MapViewPanel({
  open,
  onClose,
  returnFocusTo,
  panned,
  onCenter,
  headingUp,
  onToggleHeadingUp,
  cluster,
  onToggleCluster,
  tilt,
  onNextTilt,
  full,
  onToggleFull,
  wide,
  onToggleWide,
  thresholdFt,
}: MapViewPanelProps): ReactElement {
  const audio = useAudioEnabled();
  const vibration = useVibrationEnabled();

  /**
   * CLOSING PUTS FOCUS BACK ON THE PILL THAT OPENED IT.
   *
   * The `Done` row did this inline and it was the only way out that did:
   * `AbuseMenu` and `MapControlPanel` both shut on Escape and hand focus back,
   * and this panel - the third of the three chips, sharing their shell - did
   * not listen for the key at all. Pressed in a browser, Escape on an open MAP
   * VIEW did nothing; on either sibling it shut the panel. Three panels that
   * dismiss three ways is the drift `RailSheet.tsx` was written to end for
   * the rail's sheets, and a keyboard driver learns the gesture once.
   *
   * Wrapped so `Done` and Escape are one exit, the same shape as the siblings'
   * `closeAndRestore`.
   */
  const closeAndRestore = useCallback((): void => {
    onClose();
    returnFocusTo.current?.focus();
  }, [onClose, returnFocusTo]);

  /*
   * ESCAPE SHUTS IT, bound on the document while open and for the reason the
   * siblings give: there is no scrim to tap - a scrim is a thing covering the
   * map - and the panel does not take focus when it opens, so a listener on
   * the panel itself would never hear the key.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeAndRestore();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closeAndRestore]);

  /**
   * THE SLIDER'S POSITION IS AN INDEX, NOT A DISTANCE.
   *
   * `<input type="range">` is linear in whatever it is given, and 25..5280 in
   * feet spends nine tenths of its travel above 500 ft where nobody needs the
   * resolution - the useful end of the range would be about three pixels wide.
   * So the input runs 0..10 over `ALERT_THRESHOLD_STOPS_FT` and the feet are
   * looked up. That also means every value the thumb can produce is a stop the
   * engine accepts and `snapThresholdFt` leaves alone, so nothing between this
   * control and the alert engine has to round anything.
   */
  const stopAt = nearestStopIndex(thresholdFt);
  const reading = thresholdReading(thresholdFt);

  /**
   * THE ROW REPORTS A POSITION AND THIS FILE TURNS IT INTO FEET.
   *
   * `MenuSlider` decides nothing, the way every row in that language decides
   * nothing - it hands back where the thumb landed and never learns what a stop
   * means. Which is the same guard as before under a different signature: only
   * an index off the end of the list can miss, the input cannot produce one,
   * and refusing beats writing a threshold the store would throw on.
   */
  const onSlide = (at: number): void => {
    const next = ALERT_THRESHOLD_STOPS_FT[at];
    if (next === undefined) return;
    useSettingsStore.getState().setThresholdFt(next);
  };

  return (
    /* MOUNTED WHETHER OR NOT IT IS OPEN, AND `data-fwm-open` IS WHAT SHOWS IT.
       This used to `return null` when shut, and that is why pressing the MAP
       VIEW pill did nothing: `.fwm-drive-panel` in `mapControlPanel.css` - the
       shell this panel deliberately shares rather than redefines - is written
       `opacity: 0; visibility: hidden` at rest and only becomes visible under
       `[data-fwm-open="true"]`. An unmounted panel never got the attribute, so
       the open state flipped, the pill lit up, and nothing appeared.

       Staying mounted is also what lets the slide animate in BOTH directions;
       a panel that unmounts on close has nothing left to transition. Same
       reasoning, same two belt-and-braces attributes as `MapControlPanel`,
       which shares this shell.

       THE SHELL IS ALL IT SHARES. Where the panel sits, how wide it is, how far
       it may grow, how it scrolls and how it arrives are `.fwm-drive-panel`'s;
       the surface, the hairline, the radius and the padding are the `Menu`
       inside, which is the same division `abuseMenu.css` states at its head. */
    <div
      className="fwm-drive-panel fwm-mapview"
      role="group"
      aria-label={MAP_VIEW_LABEL}
      data-fwm-open={String(open)}
      /* CSS hides it with `visibility`, which is enough in a browser. These two
         are for everything that does not run the stylesheet - the test
         environment among them - so a shut panel is never a set of controls a
         reader or a tab key can reach. */
      aria-hidden={!open}
      inert={!open}
    >
      <Menu>
        <MenuHeader label={VIEW_HEADER} sub={VIEW_HEADER_SUB} />

        {/* THE THREE GROUPS ARE THE THREE SECTIONS, with their accessible names
            unchanged. A `MenuRule` between them because a group adds no
            geometry by design - it is the language's own group boundary, and
            without one the three runs would gap identically to the rows inside
            them and stop reading as three subjects. */}
        <MenuGroup label="where the map is pointed">
          {/* THE ACTION, FIRST AND ON ITS OWN.
              It shuts the panel because the result is on the map behind it, and
              the note under it says "already following you" rather than going
              quiet when there is nothing to recenter - a row that looks
              pressable and does nothing is the failure
              `features/radar/reroute.ts` recorded. See this file's head for why
              that reading is a note and not a value. */}
          <MenuAction
            icon={<CenterIcon />}
            label={VIEW_CENTER}
            onAct={() => {
              onCenter();
              onClose();
            }}
          />
          <MenuNote>{panned ? VIEW_CENTER_NOTE : VIEW_CENTER_ALREADY}</MenuNote>

          <MenuToggle
            label={VIEW_HEADING_UP}
            state={headingUp ? VIEW_HEADING_UP_ON : VIEW_HEADING_UP_OFF}
            on={headingUp}
            onToggle={() => {
              onToggleHeadingUp();
            }}
          />

          {/* THE ANGLE. Two named states rather than a switch, because "flat"
              and "angled" are both positive choices and a switch would make one
              of them the absence of the other. A navigate row because it states
              the current answer and presses through to the next one; nothing
              opens, which is the one thing its chevron promises and does not
              keep - recorded rather than papered over. */}
          <MenuNavigate label={VIEW_ANGLE} value={MAP_TILT_LABELS[tilt]} onOpen={onNextTilt} />

          <MenuToggle
            label={VIEW_FULLSCREEN}
            state={full ? VIEW_FULLSCREEN_ON : VIEW_FULLSCREEN_OFF}
            on={full}
            onToggle={() => {
              onToggleFull();
            }}
          />

          {/* THE WIDE LAYOUT, IN THIS SECTION AND NOT IN SETTINGS. It belongs
              beside "where the map is pointed" for the same reason full screen
              does: both are things a driver reaches for once the phone is
              already in the mount and something about the picture is wrong.
              Settings is two screens away from the mount. */}
          <MenuToggle
            label={VIEW_WIDE}
            state={wide ? VIEW_WIDE_ON : VIEW_WIDE_OFF}
            on={wide}
            onToggle={() => {
              onToggleWide();
            }}
          />
        </MenuGroup>

        <MenuRule />

        <MenuGroup label="what the map shows you">
          <MenuToggle
            label={VIEW_CLUSTER}
            state={cluster ? VIEW_CLUSTER_ON : VIEW_CLUSTER_OFF}
            on={cluster}
            onToggle={() => {
              onToggleCluster();
            }}
          />
        </MenuGroup>

        <MenuRule />

        <MenuGroup label="when the app warns you">
          {/* THE SLIDER, DIRECTLY UNDER ITS OWN LABEL, by owner decision - see
              `VIEW_THRESHOLD_NOTE` for the argument it overrules. The reading is
              beside the label and pinned right rather than riding under the
              thumb: a value that tracks the thumb is a nicer picture and an
              unreadable one at arm's length in a mount, because it moves and the
              eye has to find it again. */}
          <MenuSlider
            label={VIEW_THRESHOLD}
            value={reading}
            at={stopAt}
            min={0}
            max={ALERT_THRESHOLD_STOPS_FT.length - 1}
            note={VIEW_THRESHOLD_NOTE}
            onChange={onSlide}
          />

          {/* SPOKEN WARNINGS AND VIBRATION, moved from SETTINGS. Under the
              distance rather than over it: the threshold decides WHETHER there
              is a warning, and these two decide how it arrives. */}
          <MenuToggle
            label={VIEW_AUDIO}
            state={audio ? VIEW_AUDIO_ON : VIEW_AUDIO_OFF}
            on={audio}
            onToggle={() => {
              useSettingsStore.getState().setAudio(!audio);
            }}
          />

          <MenuToggle
            label={VIEW_VIBRATION}
            state={vibration ? VIEW_VIBRATION_ON : VIEW_VIBRATION_OFF}
            on={vibration}
            onToggle={() => {
              useSettingsStore.getState().setVibration(!vibration);
            }}
          />
        </MenuGroup>

        {/* THE CLOSE KEY, LAST, WHICH IS WHERE AN ACTION ROW BELONGS. It was a
            centred muted row of its own; it is the language's action row now and
            therefore tinted, which this file's head reports rather than works
            around. */}
        <MenuAction icon={<DoneIcon />} label={VIEW_DONE} onAct={closeAndRestore} />
      </Menu>
    </div>
  );
}
