/**
 * SETTINGS - v1.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isSettings` block.
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
 * NO v0 COMPONENT IS RENDERED HERE
 * =============================================================================
 * This used to mount `PermissionsSection` and `RemovalControl`, which are v0's
 * chrome - a v0 panel and a v0 outline key sitting in the middle of a v1 page.
 * `PermissionsV1` and `RemovalV1` replace them and share the part that
 * matters: the same probe-then-request path, the same `statusWordFor`, the
 * same two-press arm-and-commit phases owned by the container, and the same
 * strings on the irreversible control.
 *
 * =============================================================================
 * WHAT THE DESIGN DRAWS THAT THIS DOES NOT
 * =============================================================================
 * THE WAKE-WORD SWITCH. `ASK` owns that decision and reads the capability
 * itself; this screen has no wake-word state to write.
 *
 * LIQUID GLASS used to be on this list, on the grounds that the tokens were
 * fixed so a switch would move nothing. That was the wrong half to solve: the
 * blur is the loudest thing about v1 and the most expensive thing the app
 * paints, and a driver on a slower phone had no way to turn it down. The
 * setting exists now - `app/glass.ts` - and the control below writes it.
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
  FWM_CLEAR_LEVELS,
  FWM_GLASS_LEVELS,
  FWM_LIQUID_LEVELS,
  GLASS_LABELS,
  LIQUID_LABELS,
  LIQUID_NOTES,
  GLASS_NOTES,
} from '../../../app/glass.ts';
import { FWM_MAP_VIEWS, MAP_VIEW_LABELS, MAP_VIEW_NOTES } from '../../../app/mapView.ts';
import { FWM_MAP_TILTS, MAP_TILT_LABELS, MAP_TILT_NOTES } from '../../../app/mapTilt.ts';
import { TEXT_SCALES } from '../../../app/textScale.ts';
import { openScreen } from '../../../app/screenState.ts';
import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../../components/nav';

import { PermissionsV1 } from './PermissionsV1.tsx';
import { AlertTestV1 } from './AlertTestV1.tsx';
import { RemovalV1 } from './RemovalV1.tsx';
import type { SettingsViewProps } from './SettingsView.tsx';

import '../settingsV1.css';

export const SETTINGS_TITLE = 'Settings';

export const THEME_HEADING = 'Theme';
export const THRESHOLD_HEADING = 'Warn me at';
export const THRESHOLD_UNIT = 'ft';

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
export const MAP_TILT_HEADING = 'Map angle';
export const GLASS_SAMPLE = 'this panel is the material you just set.';
export const TONE_HEADING = 'Glass tone';

export const TEXT_HEADING = 'Text size';

export const HELP_LABEL = 'What this app knows';
export const HELP_SUB = 'every answer names the file that makes it true';

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

/**
 * The threshold choices, in feet.
 *
 * The engine accepts nineteen values between 100 and 1000, and v0's slider
 * offers all of them. Five of those nineteen are offered here - every one a
 * legal stop, so the value this writes is always one the engine and the
 * stylesheet can both draw. The fine resolution is not lost, it is v0's
 * control; this is the coarse one a thumb can hit in a moving car.
 */
const STOPS = [100, 300, 500, 800, 1000] as const;

export type SettingsViewV1Props = SettingsViewProps;

export function SettingsViewV1({
  model,
  onThresholdChange,
  onVibrationChange,
  onClusterCamerasChange,
  onHeadingUpMapChange,
  onAudioChange,
  onModePick,
  onTextScalePick,
  onGlassPick,
  onLiquidPick,
  onClearPick,
  onTonePick,
  onMapViewPick,
  onMapTiltPick,
  onRemovalPress,
  onRemovalCancel,
}: SettingsViewV1Props): ReactElement {
  const switches = [
    {
      key: 'vibration',
      label: 'Vibration',
      sub: 'a short double pulse, nothing else',
      on: model.vibration,
      set: onVibrationChange,
    },
    {
      key: 'audio',
      label: 'Spoken warnings',
      sub: 'distance and side, once per camera',
      on: model.audio,
      set: onAudioChange,
    },
    {
      key: 'cluster',
      label: 'Cluster cameras',
      sub: 'merge nearby pins into one counted dot',
      on: model.clusterCameras,
      set: onClusterCamerasChange,
    },
    {
      key: 'heading',
      label: 'Turn the map with you',
      sub: 'off is north up',
      on: model.headingUpMap,
      set: onHeadingUpMapChange,
    },
  ] as const;

  return (
    <section className="fwm-settingsv1" aria-label="settings">
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

      {/* THE HYDRATION GATE IS STILL THE CONTAINER'S. It renders this view with
          every handler absent until the blob is back, and an absent handler is
          how every control below goes inert. This line only SAYS so. */}
      {model.ready ? null : <p className="fwm-settingsv1-note fwm-data">{NOT_READY}</p>}

      {model.durable ? null : (
        <p className="fwm-settingsv1-note" data-fwm-warn="true">
          {model.durabilityReason ?? 'these choices will not survive a reload.'}
        </p>
      )}

      {/* --- theme ---------------------------------------------------------- */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{THEME_HEADING}</h2>
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
              // A mode that cannot be chosen is disabled, not hidden: the watch
              // rule is a fact about the surface and worth seeing.
              disabled={model.modeForced || onModePick === undefined}
              data-fwm-mode-swatch={mode}
              data-fwm-selected={String(mode === model.mode)}
              onClick={() => {
                onModePick?.(mode);
              }}
            >
              {/* Painted from the mode's own tokens by `settingsV1.css`, so a
                  swatch cannot drift from the skin it names. */}
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

      {/* --- frosted --------------------------------------------------------- */}
      {/* A REAL SETTING, not a picture of one. See the header. */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{GLASS_HEADING}</h2>
          <span className="fwm-settingsv1-card-value fwm-data">{GLASS_LABELS[model.glass]}</span>
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

        {/* THE PANEL IS THE MATERIAL YOU JUST SET - the design's own line, and
            it is literally true: this element is painted from the same two
            tokens the dock and every DRIVE control are. */}
        <p className="fwm-settingsv1-glass-sample fwm-data">{GLASS_SAMPLE}</p>
      </div>

      {/* --- transparency ---------------------------------------------------- */}
      {/* A SECOND AXIS, not a second name for the blur. Blur is what makes a
          panel read as glass and is the expensive half; transparency is how
          much of the map you want to see through it, and costs nothing. */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{CLEAR_HEADING}</h2>
          <span className="fwm-settingsv1-card-value fwm-data">{CLEAR_LABELS[model.clear]}</span>
        </div>
      {/* --- liquid glass ---------------------------------------------------- */}
      {/* A LOOK, NOT PHYSICS, and the copy says so. The version that refracted
          for real used an SVG displacement filter in the backdrop chain and
          tanked the frame rate on a phone; see `app/glass.ts`. This is two
          gradients and costs nothing per frame, which is why it no longer
          carries a performance warning. */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{LIQUID_HEADING}</h2>
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

        {/* The sheen reads as glass because it sits on a frosted panel. On a
            solid one it is just a gradient, so the control says so rather than
            silently looking wrong. */}
        {model.glass === 'off' ? (
          <p className="fwm-settingsv1-note fwm-data">
            turn frost on first - a sheen on a solid panel is just a gradient.
          </p>
        ) : null}
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

      {/* --- glass tone ------------------------------------------------------ */}
      {/* WHAT THE MATERIAL IS, not how much of it there is. The two controls
          above are quantities - blur radius and alpha. This is the one that
          decides whether the panel carries a COLOUR at all, which is the
          difference between glass and a tinted film. */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{TONE_HEADING}</h2>
          <span className="fwm-settingsv1-card-value fwm-data">{TONE_LABELS[model.tone]}</span>
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

      {/* --- map view -------------------------------------------------------- */}
      {/* THE GROUND THE APP IS DRAWN ON, which is not the same choice as the
          theme: which cartography reads best depends on the light you are
          driving in far more than on which palette the chrome wears. All five
          already shipped in the bundle and two of them were reachable. */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{MAP_VIEW_HEADING}</h2>
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

      {/* --- map angle ------------------------------------------------------ */}
      {/* WHICH QUESTION THE MAP ANSWERS. Top-down answers "how many are around
          me"; tilted answers "what is coming", which is the one this product
          exists for. Both stay one press from the map itself - this is the row
          that says what the two of them are for. */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{MAP_TILT_HEADING}</h2>
          <span className="fwm-settingsv1-card-value fwm-data">
            {MAP_TILT_LABELS[model.mapTilt]}
          </span>
        </div>
        <p className="fwm-settingsv1-note fwm-data">{MAP_TILT_NOTES[model.mapTilt]}</p>

        <div className="fwm-settingsv1-designs" role="radiogroup" aria-label={MAP_TILT_HEADING}>
          {FWM_MAP_TILTS.map((tilt) => (
            <button
              type="button"
              key={tilt}
              className="fwm-settingsv1-design"
              role="radio"
              aria-checked={tilt === model.mapTilt}
              disabled={onMapTiltPick === undefined}
              data-fwm-selected={String(tilt === model.mapTilt)}
              onClick={() => {
                onMapTiltPick?.(tilt);
              }}
            >
              <span className="fwm-settingsv1-design-name">{MAP_TILT_LABELS[tilt]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* --- text size ------------------------------------------------------ */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{TEXT_HEADING}</h2>
          <span className="fwm-settingsv1-card-value fwm-data">
            {Math.round(model.textScale * 100)}%
          </span>
        </div>
        {/* EVERY STEP DRAWN AT ITS OWN SIZE. A row of identical labels reading
            87 / 100 / 112 makes somebody do arithmetic to choose; a row where
            the letter grows is the answer itself. */}
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

      {/* --- threshold ------------------------------------------------------ */}
      <div className="fwm-settingsv1-card">
        <div className="fwm-settingsv1-card-head">
          <h2 className="fwm-settingsv1-card-title">{THRESHOLD_HEADING}</h2>
          <span className="fwm-settingsv1-threshold-reading">
            {model.thresholdFt}
            <span className="fwm-settingsv1-threshold-unit"> {THRESHOLD_UNIT}</span>
          </span>
        </div>
        {/* STOPS, NOT A FREE SLIDER. The design draws a continuous track with a
            26px handle. A handle that size, on a phone in a car mount, cannot
            be placed to 50ft; five targets can be hit without looking. */}
        <div className="fwm-settingsv1-stops" role="radiogroup" aria-label="warn me at">
          {STOPS.map((stop) => (
            <button
              type="button"
              key={stop}
              className="fwm-settingsv1-stop"
              role="radio"
              aria-checked={stop === model.thresholdFt}
              disabled={onThresholdChange === undefined}
              data-fwm-selected={String(stop === model.thresholdFt)}
              onClick={() => {
                onThresholdChange?.(stop);
              }}
            >
              {stop}
            </button>
          ))}
        </div>
      </div>

      {/* --- switches ------------------------------------------------------- */}
      <ul className="fwm-settingsv1-switches" aria-label="alerting">
        {switches.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              className="fwm-settingsv1-switch-row"
              role="switch"
              aria-checked={row.on}
              aria-label={row.label}
              disabled={row.set === undefined}
              onClick={() => {
                row.set?.(!row.on);
              }}
            >
              <span className="fwm-settingsv1-switch-where">
                <span className="fwm-settingsv1-switch-label">{row.label}</span>
                <span className="fwm-settingsv1-switch-sub fwm-data">{row.sub}</span>
              </span>
              <span
                className="fwm-settingsv1-track"
                data-fwm-on={String(row.on)}
                aria-hidden="true"
              >
                <span className="fwm-settingsv1-knob" />
              </span>
            </button>
          </li>
        ))}
      </ul>

      <PermissionsV1 />

      {/* Directly under Permissions: the notification row above says what the OS
          was asked for, this says what it actually does with it. */}
      <AlertTestV1 />

      <button
        type="button"
        className="fwm-settingsv1-help"
        onClick={() => {
          openScreen('help');
        }}
      >
        <span className="fwm-settingsv1-switch-where">
          <span className="fwm-settingsv1-switch-label">{HELP_LABEL}</span>
          <span className="fwm-settingsv1-switch-sub fwm-data">{HELP_SUB}</span>
        </span>
        <span className="fwm-settingsv1-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <RemovalV1
        phase={model.removalPhase}
        lines={model.removalLines}
        reason={model.removalReason}
        onPress={onRemovalPress}
        onCancel={onRemovalCancel}
      />
    </section>
  );
}
