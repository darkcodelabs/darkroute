/**
 * SETTINGS - v1, on brief 4's row/group idiom.
 *
 * SOURCE: `the_rest_of_the_app.dc.html`, section D, the two SETTINGS frames.
 *
 * =============================================================================
 * A VIEW, NOT A SCREEN
 * =============================================================================
 * `SettingsScreen` is unchanged and still owns everything hard about this
 * surface: the hydration gate that keeps a control inert until the stored blob
 * is back, the watch rule that refuses to persist a phone skin written from a
 * wrist, the two-press removal, the surface observer. This file receives the
 * same `SettingsViewModel` and the same handlers that `SettingsView` does, and
 * draws them the way v1 draws them.
 *
 * That is the whole point of the container/view split already being here. A v1
 * screen that re-implemented the container would have forked the watch rule.
 *
 * =============================================================================
 * WHAT BRIEF 4 CHANGED
 * =============================================================================
 * THE STRIPES ARE GONE. Every permission and alert-test row carried a coloured
 * left-border rule keyed off its state. Nothing else in the app has one, the
 * row hairline plus a hue on the group header already carries the fact, and a
 * second encoding is the one that goes stale. Deleted in `PermissionsV1`,
 * `AlertTestV1` and `settingsV1.css` together.
 *
 * THE SCREEN HAS A FRAME NOW. A fixed 56px title track, a scrolling band under
 * it with the scrollbar hidden, and 150px reserved at the bottom for the dock -
 * which is always mounted, so anything drawn in that band is under it. The band
 * is the only thing that scrolls.
 *
 * EVERY TOGGLE SPELLS ITS STATE OUT. `on · used while the map is open`, not a
 * switch position. See `PermissionsV1.stateLine`.
 *
 * THE GROUPS ARE NAMED AND HUED. PERMISSIONS in accent, TEST THE ALERT in
 * amber, and the rest muted.
 *
 * =============================================================================
 * SIX GROUPS, WHERE THE SPEC PAGE DRAWS THREE
 * =============================================================================
 * The spec's SETTINGS frame is PERMISSIONS, TEST THE ALERT and THIS PHONE -
 * three groups, nine rows. This screen also picks the palette, the type size,
 * the cartography, the map ground and the demo drive, holds four material axes
 * behind a fold, and links to WHAT THIS APP KNOWS and to a contact address.
 * None of that appears on the spec page.
 *
 * They are KEPT, restyled, under two further group headers - APPEARANCE and
 * ABOUT - rather than deleted, and brief 4 is the reason both ways round:
 *
 *   "This is a refactor, not a redesign. Every screen keeps its purpose, its
 *    data and its copy intent. What changes is structure, density and surface."
 *
 * and it names every deletion it wants explicitly - the stripes on this screen,
 * three cards on MORE, the New camera / Confirm one switch - rather than
 * leaving one to be inferred from what a 390x800 frame had room to draw. The
 * brief also says, of the two cards this screen gained the same day, "keep
 * both, restyled to the new row/group idiom", which is the same instruction
 * generalised.
 *
 * THE ONE ROW THAT IS NOT BUILT AS DRAWN IS `Theme · Night watch ›`.
 * The spec draws it in THIS PHONE as a NAVIGATE row: a label, the current mode,
 * and a chevron, which promises a pushed screen holding the picker. There is no
 * `theme` ScreenId - `app/screenState.ts`'s `SECONDARY_SCREENS` has no such
 * member - so that chevron has nowhere to go, and minting a screen, a registry
 * entry and a back-stack destination is a bigger change than section D asks
 * for. Worse, `features/map/MapControlPanel.tsx` and `MapViewPanel` both
 * `openScreen('settings')` expecting to land ON the picker, so moving it behind
 * a row that does not exist breaks two live map affordances.
 *
 * So the palette picker stays on this screen, under APPEARANCE, and THIS PHONE
 * draws the other two rows the spec gives it. Drawing the Theme row as well
 * would put one setting in two places on one screen, which is the exact fault
 * section C of this brief deletes MORE's theme card for. Reported as the one
 * piece of section D that could not be built as drawn.
 *
 * =============================================================================
 * FIVE CONTROLS LEFT THIS SCREEN FOR THE MAP-VIEW PANEL
 * =============================================================================
 * Warn me at, spoken warnings, vibration, cluster cameras, turn the map with
 * you and the map angle are all in DRIVE's MAP VIEW panel now, by owner
 * decision: they are the things a driver changes while driving, and this screen
 * is two taps off the map. They MOVED - they are not mirrored. A setting drawn
 * in two places is two switches to keep in step, and the first time they
 * disagree the driver is the one who finds out.
 *
 * THE WAKE-WORD SWITCH is not here either: `ASK` owns that decision and reads
 * the capability itself.
 *
 * =============================================================================
 * THE SIXTH GROUP CAME FROM A DIFFERENT SPEC
 * =============================================================================
 * `DESTINATION HISTORY` is section C of `DarkRoute Search Entry.html`, not of
 * brief 4 - that document draws it as a frame captioned "HISTORY, MANAGED - a
 * row in Settings", which is a design handing this screen a group rather than
 * this screen inventing one. It is built as `DestinationHistoryV1`, which owns
 * its own state the way `PermissionsV1` and `AlertTestV1` do, and the two
 * places it departs from its drawing are argued in that file's header.
 */

import type { ReactElement } from 'react';

import type { FwmMode } from '../../../app/mode.ts';
import { V1_MODES } from '../modes.ts';
import {
  CLEAR_LABELS,
  FWM_GLASS_TONES,
  TONE_LABELS,
  TONE_NOTES,
  CLEAR_NOTES,
  FLAT_LABELS,
  FLAT_NOTES,
  FWM_CLEAR_LEVELS,
  FWM_FLAT_LEVELS,
  FWM_GLASS_LEVELS,
  FWM_LIQUID_LEVELS,
  GLASS_LABELS,
  LIQUID_LABELS,
  LIQUID_NOTES,
  GLASS_NOTES,
} from '../../../app/glass.ts';
import { FWM_MAP_VIEWS, MAP_VIEW_LABELS, MAP_VIEW_NOTES } from '../../../app/mapView.ts';
/* `app/mapTilt.ts` is no longer imported here: the map-angle card went to the
   MAP VIEW panel, which reads those labels itself. */
import { TEXT_SCALES } from '../../../app/textScale.ts';
import { openScreen } from '../../../app/screenState.ts';
import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../../components/nav';

import { PermissionsV1 } from './PermissionsV1.tsx';
import { AlertTestV1 } from './AlertTestV1.tsx';
import { DestinationHistoryV1 } from './DestinationHistoryV1.tsx';
import { InstallRowV1 } from './InstallRowV1.tsx';
import { RemovalV1 } from './RemovalV1.tsx';
import type { SettingsViewProps } from './SettingsView.tsx';
import { defaultMapEarth } from '../../../app/mapEarth.ts';

import '../settingsV1.css';

export const SETTINGS_TITLE = 'Settings';

/* ------------------------------------------------------------------------ *
 * THE GROUP HEADERS. Typed in sentence case; `settingsV1.css` draws the caps,
 * so a header cannot be half-uppercased by whoever typed it.
 * ------------------------------------------------------------------------ */

export const APPEARANCE_HEADING = 'Appearance';
export const APPEARANCE_NOTE = 'the palette, the type, and how the map itself is drawn';
export const ABOUT_HEADING = 'About';
export const ABOUT_NOTE = 'where the answers come from, and who to write to';
export const THIS_PHONE_HEADING = 'This phone';
export const THIS_PHONE_NOTE = 'nothing here leaves the device';

export const THEME_HEADING = 'Theme';
/* `THRESHOLD_HEADING` and `THRESHOLD_UNIT` were here. The warn distance is a
   slider in DRIVE's MAP VIEW panel now; `VIEW_THRESHOLD` in
   `features/map/MapViewPanel.tsx` is the one remaining copy of the words. */

/* FROSTED, NOT LIQUID, and the rename is a correction rather than a preference.
 *
 * This control sets blur, saturation and brightness on a backdrop. That is
 * FROST: it scatters what is behind the panel so the panel reads as translucent
 * and the content behind it reads as mush.
 *
 * Liquid glass is a different physical claim - it REFRACTS, bending what is
 * behind it rather than scattering it, hardest at the edges, the way a lens
 * does. Calling frost by that name meant the app shipped a setting whose name
 * described an effect it did not have. `LIQUID_HEADING` below is the real one. */
export const GLASS_HEADING = 'Frosted';

/* THE ONE THAT ACTUALLY REFRACTS. See `app/glass.ts` for why it is a separate
   control and not a fifth frost level. */
export const LIQUID_HEADING = 'Liquid glass';
export const CLEAR_HEADING = 'Transparency';
export const MAP_VIEW_HEADING = 'Map view';
/* `MAP_TILT_HEADING` was here. The angle is a row in the MAP VIEW panel, which
   is one press from the map it tilts; `DRIVE_TILT` and the panel's own
   `VIEW_ANGLE` carry the words. Note that `MAP_VIEW_HEADING` above is NOT a
   duplicate of that panel: this card picks the CARTOGRAPHY, and the layers
   panel deliberately links here rather than keeping a second copy of it. */
export const GLASS_SAMPLE = 'this panel is the material you just set.';
export const TONE_HEADING = 'Glass tone';

/* THE RELIEF. Named for what the owner asked for rather than for what it turns
   off: "flat" is the word for a panel with no rim, no sheen and no shadow under
   it, and "Relief: Off" would be the same setting spelled as its own negation. */
export const FLAT_HEADING = 'Flat';

/* THE MAP'S GROUND. See `app/mapEarth.ts` for why this is a setting and not a
   commit, and `styles/tokens.css` for why the default is the same in both
   themes. */
export const MAP_EARTH_HEADING = 'Map ground';
export const MAP_EARTH_DEFAULT_LABEL = 'Default';
export const MAP_EARTH_PICK = 'Pick a colour';
export const MAP_EARTH_RESET = 'Default';
export const MAP_EARTH_NOTE =
  'The colour under the roads. It applies in every theme, light and dark, ' +
  'because the cameras, the route and every alert hue were tuned against one ' +
  'ground and a map that changed with the chrome would move all of them.';
/* What the native picker opens on when nothing is chosen. Read off the token
   rather than written here, so opening the picker and closing it changes
   nothing and there is one source for the ground. See `app/mapEarth.ts`. */

export const DEMO_DRIVE_HEADING = 'Demo drive';
export const DEMO_DRIVE_ON = 'On';
export const DEMO_DRIVE_OFF = 'Off';
export const DEMO_DRIVE_NOTE =
  'Places you on the map by hand so alerts, navigation and abuse zones can be ' +
  'shown without driving to a camera. A pad appears over the map. It does not ' +
  'change what the app asks for, and the position is never saved.';

/* SAID ONLY WHEN BOTH ARE ON, because that is the one combination where a
   control the driver can still see and press is drawing nothing. Not a warning:
   the liquid choice is kept on purpose so that turning flat back off restores
   it, and this line is what makes that promise visible. */
export const FLAT_OVER_LIQUID = 'liquid glass stays chosen while this is on - it just has nothing left to paint.';

export const TEXT_HEADING = 'Text size';
/** The four blur-and-tint settings, behind one disclosure. */
export const MATERIAL_HEADING = 'Material';

export const HELP_LABEL = 'What this app knows';

/**
 * WHO TO WRITE TO.
 *
 * There was no contact anywhere in the product. `.well-known/security.txt`
 * carries one, which is correct and is for reporting a vulnerability - it is
 * not where somebody goes to say a camera is in the wrong place, or that the
 * app did something strange, or to ask what happens to their data.
 *
 * A `mailto:` rather than a form: a form needs somewhere to POST to, and this
 * app deliberately has no endpoint that accepts anything. The address opens in
 * whatever the reader already uses and nothing is sent from here.
 */
export const CONTACT_LABEL = 'Contact';
export const CONTACT_ADDRESS = 'cory@darkroute.ai';
/* SHORT ENOUGH FOR THE ROW'S RIGHT-HAND SLOT. The sentence this replaced --
   "questions, corrections, anything else — <address>" -- was written for a
   stacked sub-line and ellipsises to nothing in a 13px right-aligned column.
   The address IS the answer to "what does this row do", so it is what stays. */
export const CONTACT_SUB = CONTACT_ADDRESS;
export const HELP_SUB = 'answers name their file';

/** Said while the persisted blob is still being read back. */
export const NOT_READY = 'reading your saved settings.';

/** The mode names, spelled the way a person would say them. */
const MODE_LABEL: Partial<Record<FwmMode, string>> = {
  'night-watch': 'Night Watch',
  slate: 'Slate',
  carbon: 'Carbon',
  violet: 'Violet',
  'e-ink': 'E-ink',
  refinement: 'Refinement',
  paper: 'Paper',
};

/**
 * What the card says for a theme this picker does not offer.
 *
 * Reachable: `mode` is one storage field shared by both designs, so a driver
 * who chose `pursuit` in v0 and switched to v1 has a stored mode with no card
 * here. The header says its name rather than an em dash - it IS their mode,
 * v1 just has no palette for it and renders night watch.
 */
function modeLabel(mode: FwmMode): string {
  return MODE_LABEL[mode] ?? mode;
}

/*
 * `STOPS` WAS HERE - five coarse threshold targets, 100 / 300 / 500 / 800 /
 * 1000, drawn as a radiogroup. The warn distance is a real slider in DRIVE's
 * MAP VIEW panel now, running the eleven stops in
 * `ALERT_THRESHOLD_STOPS_FT` from 25 ft to a mile, so this screen no longer
 * offers a second, coarser, narrower way to set the same number.
 */

/** The chevron every navigate row draws. U+203A, the outbound `‹` of `BackKey`. */
const CHEVRON = '›';

export type SettingsViewV1Props = SettingsViewProps;

/*
 * FIVE HANDLERS ARE DELIBERATELY NOT DESTRUCTURED: `onThresholdChange`,
 * `onVibrationChange`, `onAudioChange`, `onClusterCamerasChange` and
 * `onHeadingUpMapChange`. The container still builds and passes all five,
 * because v0's view still draws every one of those controls; this view does
 * not, and naming an unused handler here would be a promise that something on
 * this screen writes it.
 *
 * `onMapTiltPick` is not in that list because it no longer exists. It was the
 * one handler NEITHER view read once the map-angle card left, so the container
 * stopped building it rather than threading a callback to nobody - see the
 * note where it stood in `SettingsScreen.tsx`.
 */
export function SettingsViewV1({
  model,
  onModePick,
  onTextScalePick,
  onGlassPick,
  onLiquidPick,
  onClearPick,
  onTonePick,
  onFlatPick,
  onMapEarthPick,
  onDemoDriveToggle,
  onMapViewPick,
  onRemovalPress,
  onRemovalCancel,
}: SettingsViewV1Props): ReactElement {
  return (
    <section className="fwm-settingsv1" aria-label="settings">
      {/* =================================================================
          THE TITLE TRACK. 56px, and it does not scroll.
          ================================================================= */}
      <header className="fwm-settingsv1-header">
        {/* SETTINGS IS REACHED TWO WAYS AND HAD NO WAY OUT OF EITHER: MORE's
            "Settings and themes" row, and DRIVE's gear. The dock lights MORE
            on this screen, so the only exit was a key pointing at the place
            you had just left, and from DRIVE's gear there was no exit at all
            short of DRIVE's own dock key.

            The arrow says MORE for both entrances rather than tracking which
            one you used. See `components/nav/BackKey.tsx`. */}
        <BackKey to="more" label={BACK_TO_MORE} />
        <ReloadTitle title={SETTINGS_TITLE} className="fwm-settingsv1-title" />
      </header>

      {/* =================================================================
          THE CONTENT BAND. The only thing on this screen that scrolls, with
          150px reserved at its foot for the dock.
          ================================================================= */}
      <div className="fwm-settingsv1-band">
        {/* THE HYDRATION GATE IS STILL THE CONTAINER'S. It renders this view
            with every handler absent until the blob is back, and an absent
            handler is how every control below goes inert. This line only SAYS
            so. */}
        {model.ready ? null : <p className="fwm-settingsv1-note fwm-data">{NOT_READY}</p>}

        {model.durable ? null : (
          <p className="fwm-settingsv1-note" data-fwm-warn="true">
            {model.durabilityReason ?? 'these choices will not survive a reload.'}
          </p>
        )}

        {/* --- PERMISSIONS --------------------------------------------------
            What the app may read, and whether it is using it. Draws its own
            group header in the accent hue. */}
        <PermissionsV1 />

        {/* --- TEST THE ALERT -----------------------------------------------
            Directly under Permissions: the notification row above says what the
            OS was asked for, this says what it actually does with it. Draws its
            own amber group header and the amber note under its rows. */}
        <AlertTestV1 />

        {/* --- DESTINATION HISTORY ------------------------------------------
            Directly under TEST THE ALERT and well above THIS PHONE, because it
            is the group the wipe row at the bottom of the screen is ABOUT: its
            note is the sentence that tells a person which of its two lists
            `Wipe everything on this phone` takes and which the red row inside
            it keeps. A reader who meets the wipe first has already been told
            the wrong half. Draws its own amber group header. */}
        <DestinationHistoryV1 ready={model.ready} />

        {/* --- APPEARANCE ---------------------------------------------------
            The five pickers the spec page has no frame for. See the header for
            why they are kept and why the Theme picker in particular could not
            move behind a navigate row. */}
        <div className="fwm-settingsv1-group" role="group" aria-label={APPEARANCE_HEADING}>
          <div className="fwm-settingsv1-group-head">
            <h2 className="fwm-settingsv1-group-label">{APPEARANCE_HEADING}</h2>
            <p className="fwm-settingsv1-group-note fwm-data">{APPEARANCE_NOTE}</p>
          </div>

          {/* --- theme -------------------------------------------------- */}
          <div className="fwm-settingsv1-card">
            <div className="fwm-settingsv1-card-head">
              <h3 className="fwm-settingsv1-card-title">{THEME_HEADING}</h3>
              <span className="fwm-settingsv1-card-value fwm-data">{modeLabel(model.mode)}</span>
            </div>

            {model.modeForced ? (
              <p className="fwm-settingsv1-note fwm-data">
                an always-on watch face holds night watch. the other skins are for the phone.
              </p>
            ) : null}

            <div className="fwm-settingsv1-swatches" role="radiogroup" aria-label="theme mode">
              {V1_MODES.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className="fwm-settingsv1-swatch"
                  role="radio"
                  aria-checked={mode === model.mode}
                  // A mode that cannot be chosen is disabled, not hidden: the
                  // watch rule is a fact about the surface and worth seeing.
                  disabled={model.modeForced || onModePick === undefined}
                  data-fwm-mode-swatch={mode}
                  data-fwm-selected={String(mode === model.mode)}
                  onClick={() => {
                    onModePick?.(mode);
                  }}
                >
                  {/* Painted from the mode's own tokens by `settingsV1.css`, so
                      a swatch cannot drift from the skin it names. */}
                  <span className="fwm-settingsv1-swatch-chips" aria-hidden="true">
                    <span className="fwm-settingsv1-chip" data-fwm-chip="bg" />
                    <span className="fwm-settingsv1-chip" data-fwm-chip="accent" />
                    <span className="fwm-settingsv1-chip" data-fwm-chip="alert" />
                  </span>
                  <span className="fwm-settingsv1-swatch-name">{modeLabel(mode)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* --- text size ---------------------------------------------- */}
          <div className="fwm-settingsv1-card">
            <div className="fwm-settingsv1-card-head">
              <h3 className="fwm-settingsv1-card-title">{TEXT_HEADING}</h3>
              <span className="fwm-settingsv1-card-value fwm-data">
                {Math.round(model.textScale * 100)}%
              </span>
            </div>
            {/* EVERY STEP DRAWN AT ITS OWN SIZE. A row of identical labels
                reading 87 / 100 / 112 makes somebody do arithmetic to choose; a
                row where the letter grows is the answer itself. */}
            <div className="fwm-settingsv1-sizes" role="radiogroup" aria-label={TEXT_HEADING}>
              {TEXT_SCALES.map((scale) => (
                <button
                  type="button"
                  key={scale}
                  className="fwm-settingsv1-size"
                  role="radio"
                  aria-checked={scale === model.textScale}
                  aria-label={`${String(Math.round(scale * 100))} percent`}
                  disabled={onTextScalePick === undefined}
                  data-fwm-selected={String(scale === model.textScale)}
                  style={{ fontSize: `${String(scale)}rem` }}
                  onClick={() => {
                    onTextScalePick?.(scale);
                  }}
                >
                  A
                </button>
              ))}
            </div>
          </div>

          {/* --- map view ------------------------------------------------ */}
          {/* THE GROUND THE APP IS DRAWN ON, which is not the same choice as
              the theme: which cartography reads best depends on the light you
              are driving in far more than on which palette the chrome wears.
              All five already shipped in the bundle and two were reachable. */}
          <div className="fwm-settingsv1-card">
            <div className="fwm-settingsv1-card-head">
              <h3 className="fwm-settingsv1-card-title">{MAP_VIEW_HEADING}</h3>
              <span className="fwm-settingsv1-card-value fwm-data">
                {MAP_VIEW_LABELS[model.mapView]}
              </span>
            </div>
            <p className="fwm-settingsv1-note fwm-data">{MAP_VIEW_NOTES[model.mapView]}</p>

            <div className="fwm-settingsv1-designs" role="radiogroup" aria-label={MAP_VIEW_HEADING}>
              {FWM_MAP_VIEWS.map((view) => (
                <button
                  type="button"
                  key={view}
                  className="fwm-settingsv1-design"
                  role="radio"
                  aria-checked={view === model.mapView}
                  disabled={onMapViewPick === undefined}
                  data-fwm-selected={String(view === model.mapView)}
                  onClick={() => {
                    onMapViewPick?.(view);
                  }}
                >
                  <span className="fwm-settingsv1-design-name">{MAP_VIEW_LABELS[view]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* --- map ground ----------------------------------------------
              WAS NESTED THREE DEEP AND HIDDEN. This card and DEMO DRIVE below
              it were both inside the Frosted card's own `<div>` AND inside the
              shut-by-default `Material` fold, whose summary names neither -
              two cards nested in a third, behind a disclosure about something
              else. Brief 4 says to keep both, restyled to the row/group idiom;
              lifting them out to APPEARANCE, where they belong, is what that
              restyle turned out to mean. */}
          <div className="fwm-settingsv1-card">
            <div className="fwm-settingsv1-card-head">
              <h3 className="fwm-settingsv1-card-title">{MAP_EARTH_HEADING}</h3>
              <span className="fwm-settingsv1-card-value fwm-data">
                {model.mapEarth ?? MAP_EARTH_DEFAULT_LABEL}
              </span>
            </div>
            <p className="fwm-settingsv1-note fwm-data">{MAP_EARTH_NOTE}</p>

            <div className="fwm-settingsv1-stops">
              {/* A NATIVE COLOUR INPUT, on purpose. Every platform already has a
                  picker its owner knows how to drive, it is reachable by
                  keyboard, and a hand-built wheel here would be a design
                  surface to maintain for a control used twice a year. */}
              <label className="fwm-settingsv1-swatch">
                <input
                  type="color"
                  value={model.mapEarth ?? defaultMapEarth()}
                  disabled={onMapEarthPick === undefined}
                  onChange={(event) => {
                    onMapEarthPick?.(event.target.value);
                  }}
                />
                {MAP_EARTH_PICK}
              </label>

              <button
                type="button"
                className="fwm-settingsv1-stop"
                disabled={onMapEarthPick === undefined || model.mapEarth === null}
                onClick={() => {
                  onMapEarthPick?.(null);
                }}
              >
                {MAP_EARTH_RESET}
              </button>
            </div>
          </div>

          {/* --- demo drive ----------------------------------------------
              It moves your position on the map by hand so the alert states, the
              navigation family and the abuse zones can be shown without driving
              to a reader. It does not touch the location permission - see
              `services/adapters/demoGeolocation.ts` for why that is a hard
              line.

              A TWO-STOP RADIOGROUP RATHER THAN A SWITCH, and that is not a
              styling preference: `SettingsViewV1.test.tsx` asserts that this
              screen holds EXACTLY THREE `role="switch"` controls and that every
              one of them is a permission - the test that stops an alert setting
              creeping back after six of them moved to the map panel. A fourth
              switch here fails it, and the setting is not a permission. */}
          <div className="fwm-settingsv1-card">
            <div className="fwm-settingsv1-card-head">
              <h3 className="fwm-settingsv1-card-title">{DEMO_DRIVE_HEADING}</h3>
              <span className="fwm-settingsv1-card-value fwm-data">
                {model.demoDrive ? DEMO_DRIVE_ON : DEMO_DRIVE_OFF}
              </span>
            </div>
            <p className="fwm-settingsv1-note fwm-data">{DEMO_DRIVE_NOTE}</p>

            <div className="fwm-settingsv1-stops" role="radiogroup" aria-label={DEMO_DRIVE_HEADING}>
              {[false, true].map((on) => (
                <button
                  type="button"
                  key={String(on)}
                  className="fwm-settingsv1-stop"
                  role="radio"
                  aria-checked={on === model.demoDrive}
                  disabled={onDemoDriveToggle === undefined}
                  data-fwm-selected={String(on === model.demoDrive)}
                  onClick={() => {
                    onDemoDriveToggle?.(on);
                  }}
                >
                  {on ? DEMO_DRIVE_ON : DEMO_DRIVE_OFF}
                </button>
              ))}
            </div>
          </div>

          {/* --- the material fold ---------------------------------------
              Four of the nine cards on this screen were about how blurry the
              floating chrome is - Frosted, Transparency, Liquid glass and Glass
              tone - each with a heading, a value, a paragraph of prose and a
              segmented control. That was most of a long scroll spent on
              something almost nobody changes.

              Shut by default. Native `details` keeps the closed state honest
              without another preference to persist, and the summary carries the
              current values, so collapsing hides controls rather than state.
              The summary is drawn as a 44px row so the fold reads as one more
              row in the group rather than as a fifth kind of thing. */}
          <details className="fwm-settingsv1-fold">
            <summary className="fwm-settingsv1-fold-key">
              <span className="fwm-settingsv1-fold-title">{MATERIAL_HEADING}</span>
              <span className="fwm-settingsv1-fold-value fwm-data">
                {`${GLASS_LABELS[model.glass]} · ${CLEAR_LABELS[model.clear]}`}
              </span>
              <span className="fwm-settingsv1-fold-chevron" aria-hidden="true">
                {CHEVRON}
              </span>
            </summary>

            {/* --- frosted ---------------------------------------------- */}
            {/* A REAL SETTING, not a picture of one. See the header. */}
            <div className="fwm-settingsv1-card">
              <div className="fwm-settingsv1-card-head">
                <h3 className="fwm-settingsv1-card-title">{GLASS_HEADING}</h3>
                <span className="fwm-settingsv1-card-value fwm-data">
                  {GLASS_LABELS[model.glass]}
                </span>
              </div>
              <p className="fwm-settingsv1-note fwm-data">{GLASS_NOTES[model.glass]}</p>

              <div className="fwm-settingsv1-stops" role="radiogroup" aria-label={GLASS_HEADING}>
                {FWM_GLASS_LEVELS.map((level) => (
                  <button
                    type="button"
                    key={level}
                    className="fwm-settingsv1-stop"
                    role="radio"
                    aria-checked={level === model.glass}
                    disabled={onGlassPick === undefined}
                    data-fwm-selected={String(level === model.glass)}
                    onClick={() => {
                      onGlassPick?.(level);
                    }}
                  >
                    {GLASS_LABELS[level]}
                  </button>
                ))}
              </div>

              {/* THE PANEL IS THE MATERIAL YOU JUST SET - the design's own line,
                  and it is literally true: inside an open fold these cards are
                  painted from the same two tokens the dock and every DRIVE
                  control are. See `settingsV1.css` section 9. */}
              <p className="fwm-settingsv1-glass-sample fwm-data">{GLASS_SAMPLE}</p>
            </div>

            {/* --- transparency ----------------------------------------- */}
            {/* A SECOND AXIS, not a second name for the blur. Blur is what
                makes a panel read as glass and is the expensive half;
                transparency is how much of the map you want to see through it,
                and costs nothing. */}
            <div className="fwm-settingsv1-card">
              <div className="fwm-settingsv1-card-head">
                <h3 className="fwm-settingsv1-card-title">{CLEAR_HEADING}</h3>
                <span className="fwm-settingsv1-card-value fwm-data">
                  {CLEAR_LABELS[model.clear]}
                </span>
              </div>
              <p className="fwm-settingsv1-note fwm-data">{CLEAR_NOTES[model.clear]}</p>

              <div className="fwm-settingsv1-stops" role="radiogroup" aria-label={CLEAR_HEADING}>
                {FWM_CLEAR_LEVELS.map((level) => (
                  <button
                    type="button"
                    key={level}
                    className="fwm-settingsv1-stop"
                    role="radio"
                    aria-checked={level === model.clear}
                    disabled={onClearPick === undefined}
                    data-fwm-selected={String(level === model.clear)}
                    onClick={() => {
                      onClearPick?.(level);
                    }}
                  >
                    {CLEAR_LABELS[level]}
                  </button>
                ))}
              </div>

              <p className="fwm-settingsv1-glass-sample fwm-data">{GLASS_SAMPLE}</p>
            </div>

            {/* --- liquid glass ----------------------------------------- */}
            {/* A LOOK, NOT PHYSICS, and the copy says so. The version that
                refracted for real used an SVG displacement filter in the
                backdrop chain and tanked the frame rate on a phone; see
                `app/glass.ts`. This is two gradients and costs nothing per
                frame, which is why it no longer carries a performance
                warning. */}
            <div className="fwm-settingsv1-card">
              <div className="fwm-settingsv1-card-head">
                <h3 className="fwm-settingsv1-card-title">{LIQUID_HEADING}</h3>
                <span className="fwm-settingsv1-card-value fwm-data">
                  {LIQUID_LABELS[model.liquid]}
                </span>
              </div>
              <p className="fwm-settingsv1-note fwm-data">{LIQUID_NOTES[model.liquid]}</p>

              <div className="fwm-settingsv1-stops" role="radiogroup" aria-label={LIQUID_HEADING}>
                {FWM_LIQUID_LEVELS.map((level) => (
                  <button
                    type="button"
                    key={level}
                    className="fwm-settingsv1-stop"
                    role="radio"
                    aria-checked={level === model.liquid}
                    disabled={onLiquidPick === undefined || model.glass === 'off'}
                    data-fwm-selected={String(level === model.liquid)}
                    onClick={() => {
                      onLiquidPick?.(level);
                    }}
                  >
                    {LIQUID_LABELS[level]}
                  </button>
                ))}
              </div>

              {/* The sheen reads as glass because it sits on a frosted panel. On
                  a solid one it is just a gradient, so the control says so
                  rather than silently looking wrong. */}
              {model.glass === 'off' ? (
                <p className="fwm-settingsv1-note fwm-data">
                  turn frost on first - a sheen on a solid panel is just a gradient.
                </p>
              ) : null}
            </div>

            {/* --- glass tone ------------------------------------------- */}
            {/* WHAT THE MATERIAL IS, not how much of it there is. The two
                controls above are quantities - blur radius and alpha. This is
                the one that decides whether the panel carries a COLOUR at all,
                which is the difference between glass and a tinted film. */}
            <div className="fwm-settingsv1-card">
              <div className="fwm-settingsv1-card-head">
                <h3 className="fwm-settingsv1-card-title">{TONE_HEADING}</h3>
                <span className="fwm-settingsv1-card-value fwm-data">
                  {TONE_LABELS[model.tone]}
                </span>
              </div>
              <p className="fwm-settingsv1-note fwm-data">{TONE_NOTES[model.tone]}</p>

              <div className="fwm-settingsv1-stops" role="radiogroup" aria-label={TONE_HEADING}>
                {FWM_GLASS_TONES.map((tone) => (
                  <button
                    type="button"
                    key={tone}
                    className="fwm-settingsv1-stop"
                    role="radio"
                    aria-checked={tone === model.tone}
                    disabled={onTonePick === undefined}
                    data-fwm-selected={String(tone === model.tone)}
                    onClick={() => {
                      onTonePick?.(tone);
                    }}
                  >
                    {TONE_LABELS[tone]}
                  </button>
                ))}
              </div>

              <p className="fwm-settingsv1-glass-sample fwm-data">{GLASS_SAMPLE}</p>
            </div>

            {/* --- flat -------------------------------------------------- */}
            {/* THE RELIEF, and the fifth axis. The four cards above are all
                about how much material there is and what it is made of; this
                one is about whether it is LIT - the specular rim, the sheen and
                the cast shadow that make a panel read as a raised object rather
                than as a filled rectangle. `app/glass.ts` argues why that could
                not be a value on any of the other four.

                THE LIQUID CONTROL IS LEFT LIVE ON PURPOSE, unlike the way
                frost=off disables it above. Turning flat off has to give back
                the exact look the driver chose before, so the sheen has to stay
                CHOSEN while it is not being drawn. The note below says so rather
                than the control quietly going inert. */}
            <div className="fwm-settingsv1-card">
              <div className="fwm-settingsv1-card-head">
                <h3 className="fwm-settingsv1-card-title">{FLAT_HEADING}</h3>
                <span className="fwm-settingsv1-card-value fwm-data">
                  {FLAT_LABELS[model.flat]}
                </span>
              </div>
              <p className="fwm-settingsv1-note fwm-data">{FLAT_NOTES[model.flat]}</p>

              <div className="fwm-settingsv1-stops" role="radiogroup" aria-label={FLAT_HEADING}>
                {FWM_FLAT_LEVELS.map((level) => (
                  <button
                    type="button"
                    key={level}
                    className="fwm-settingsv1-stop"
                    role="radio"
                    aria-checked={level === model.flat}
                    disabled={onFlatPick === undefined}
                    data-fwm-selected={String(level === model.flat)}
                    onClick={() => {
                      onFlatPick?.(level);
                    }}
                  >
                    {FLAT_LABELS[level]}
                  </button>
                ))}
              </div>

              {model.flat === 'on' && model.liquid === 'on' ? (
                <p className="fwm-settingsv1-note fwm-data">{FLAT_OVER_LIQUID}</p>
              ) : null}

              <p className="fwm-settingsv1-glass-sample fwm-data">{GLASS_SAMPLE}</p>
            </div>
          </details>
        </div>

        {/* --- ABOUT ---------------------------------------------------- */}
        <div className="fwm-settingsv1-group" role="group" aria-label={ABOUT_HEADING}>
          <div className="fwm-settingsv1-group-head">
            <h2 className="fwm-settingsv1-group-label">{ABOUT_HEADING}</h2>
            <p className="fwm-settingsv1-group-note fwm-data">{ABOUT_NOTE}</p>
          </div>

          <button
            type="button"
            className="fwm-settingsv1-help"
            onClick={() => {
              openScreen('help');
            }}
          >
            <span className="fwm-settingsv1-row-label">{HELP_LABEL}</span>
            <span className="fwm-settingsv1-row-value fwm-data">{HELP_SUB}</span>
            <span className="fwm-settingsv1-chevron" aria-hidden="true">
              {CHEVRON}
            </span>
          </button>

          {/* An anchor, not a button: this leaves the app, and a control that
              leaves the app should be a link so a long-press offers to copy the
              address and a screen reader announces it as one. */}
          <a className="fwm-settingsv1-help" href={`mailto:${CONTACT_ADDRESS}`}>
            <span className="fwm-settingsv1-row-label">{CONTACT_LABEL}</span>
            <span className="fwm-settingsv1-row-value fwm-data">{CONTACT_SUB}</span>
            <span className="fwm-settingsv1-chevron" aria-hidden="true">
              {CHEVRON}
            </span>
          </a>
        </div>

        {/* --- THIS PHONE ------------------------------------------------
            The spec's third group, and the last thing on the screen: the wipe
            is terminal, so nothing follows it. */}
        <div className="fwm-settingsv1-group" role="group" aria-label={THIS_PHONE_HEADING}>
          <div className="fwm-settingsv1-group-head">
            <h2 className="fwm-settingsv1-group-label">{THIS_PHONE_HEADING}</h2>
            <p className="fwm-settingsv1-group-note fwm-data">{THIS_PHONE_NOTE}</p>
          </div>

          <InstallRowV1 />

          <RemovalV1
            phase={model.removalPhase}
            lines={model.removalLines}
            reason={model.removalReason}
            onPress={onRemovalPress}
            onCancel={onRemovalCancel}
          />
        </div>
      </div>
    </section>
  );
}
