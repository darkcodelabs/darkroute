/**
 * SETTINGS, as a pure function of a view model.
 *
 * `SettingsScreen.tsx` reads the stores, resolves the mode against the surface
 * and owns the removal port; this file decides what is on screen and in what
 * order. Splitting them is what lets a test render the watch-forced mode
 * picker, the pre-hydration state and a completed wipe without a database, a
 * fake `navigator` or a real surface.
 *
 * =============================================================================
 * THE STACK, TOP TO BOTTOM
 * =============================================================================
 *   52px header             `SETTINGS` · `ON THIS DEVICE`
 *   durability notice       only when a reload would lose these settings
 *   ALERT AT                the section 04 slider, 100-1000 in 50 ft detents
 *   ALERTS                  the section 04 toggles that something actually reads
 *   THEME MODES             the six skins of section 05, one selected
 *   STAYS ON THE PHONE      what is stored, and the one removal control
 *
 * =============================================================================
 * WHY THERE ARE ONLY TWO TOGGLES
 * =============================================================================
 * The settings slice persists nine preferences. Four of them -- `wakeLock`,
 * `wifiOnlySync`, `notifyWhenParked`, `showHandle` -- are read by NOTHING in
 * this build; the greps are in `docs/gaps-inbox/settings.md`. Rendering a
 * switch that writes a field no consumer reads is a control that lies about
 * what the product does, which is worse than an absent control. `vibration` and
 * `audio` narrow the alert gate in `stores/alert.ts` (`useShouldVibrate`,
 * `useShouldSpeak`), so those two are here.
 * GAP: see docs/gaps-inbox/settings.md#four-stored-preferences-have-no-consumer
 *
 * =============================================================================
 * EVERYTHING ELSE THE BRIEF'S SCREEN 6 LISTS, AND WHY IT IS NOT HERE
 * =============================================================================
 * `DESIGN-GAPS.md#no-settings-screen-exists` records the brief as: "alert
 * distance slider, audio on/off + VOLUME, vibration toggle, WIFI SYNC STATUS +
 * MANUAL TRIGGER, DATABASE FRESHNESS, screen wake lock toggle". Three of those
 * are neither preferences nor covered by the paragraph above, so each has its
 * own gap entry rather than being folded into it:
 *
 *   volume              no field. `stores/settings.ts` persists `audio` as a
 *                       boolean, nothing anywhere carries a level, and there is
 *                       no speech implementation for one to apply in.
 *                       `useShouldSpeak` gates; it does not attenuate. A slider
 *                       would move nothing.
 *                       GAP: #audio-volume-has-nowhere-to-write
 *   wifi sync status    a readout, and it is already built: `B2 · DEAD DROP`
 *                       (`features/dead-drop`) renders the queue, the hold
 *                       reason and the `SYNC NOW` key off `stores/sync.ts`. A
 *                       second copy here is a second place to change it -- the
 *                       same reason TRIAGE's switches are not duplicated.
 *                       GAP: #wifi-sync-status-and-manual-trigger-live-on-dead-drop
 *   database freshness  also already built: `A2 · OFFLINE - DEGRADED`
 *                       (`features/offline`) reads `tileMeta.freshness` and
 *                       renders `CacheNotice`. Same argument.
 *                       GAP: #database-freshness-lives-on-offline
 *
 * TRIAGE's five owner switches and the re-alert distance are NOT duplicated
 * here either. They are `B4 · ALERT TRIAGE`'s screen and `features/triage`
 * renders them; a second copy would be a second place to change them.
 *
 * =============================================================================
 * NOTHING ON THIS SCREEN IS UPLOADED
 * =============================================================================
 * No plate, no coordinate, no count, no chosen mode. The two writes this screen
 * performs go to the settings slice and to `<html data-fwm-mode>`. The removal
 * control talks to IndexedDB and to the key store, and to nothing else.
 */

import type { ReactElement } from 'react';

import type { FwmMode } from '../../../app/mode.ts';
import { MODE_SECTION_CAPTION } from '../modes.ts';
import type { TextScale } from '../../../app/textScale.ts';
import type { Typeface } from '../../../app/typeface.ts';
import type { FwmClear, FwmGlass, FwmGlassTone , FwmLiquid } from '../../../app/glass.ts';
import type { FwmMapView } from '../../../app/mapView.ts';
import type { FwmMapTilt } from '../../../app/mapTilt.ts';
import { PRIVACY_HEADING, PRIVACY_PROMISES } from '../storage.ts';

import { ModePicker } from './ModePicker.tsx';
import { PermissionsSection } from './PermissionsSection.tsx';
import { MuteControl } from './MuteControl.tsx';
import {
  TEXT_SIZE_CAPTION,
  TEXT_SIZE_SECTION,
  TextSizePicker,
} from './TextSizePicker.tsx';
import {
  TYPEFACE_CAPTION,
  TYPEFACE_SECTION,
  TypefacePicker,
} from './TypefacePicker.tsx';
import { AdminLink } from './AdminLink.tsx';
import { HelpLink } from './HelpLink.tsx';
import { NodeLink } from './NodeLink.tsx';
import { DemoControl } from './DemoControl.tsx';
import { RemovalControl } from './RemovalControl.tsx';
import type { RemovalPhase } from './RemovalControl.tsx';
import { SettingsHeader } from './SettingsHeader.tsx';
import { StoredList } from './StoredList.tsx';
import { BUILD, buildLabel } from '../../../app/buildInfo.ts';
import { SwitchRow } from './SwitchRow.tsx';
import { ThresholdControl } from './ThresholdControl.tsx';

/** Section eyebrows. `ALERT AT` is section 04's; the other two are not drawn. */
export const THRESHOLD_SECTION = 'ALERT AT';
export const ALERTS_SECTION = 'ALERTS';
export const MODES_SECTION = 'THEME MODES';

/**
 * `Vibration` is quoted: it is the first of the two rows section 04's
 * `TOGGLE · SLIDER · CHIPS` panel draws, in that panel's own casing.
 */
export const VIBRATION_LABEL = 'Vibration';

/**
 * The build, at the very bottom.
 *
 * LAST on purpose: it is the least useful line on the screen right up until
 * somebody is reporting a bug, at which point it is the first thing anybody
 * asks for. Putting it under the removal control means "scroll to the end" is
 * a complete instruction.
 */
export const BUILD_SECTION = 'BUILD';
export const BUILD_CAPTION =
  'quote this when reporting anything. it names the code that is running right now, ' +
  'which is not always the newest code deployed.';

export const MAP_SECTION = 'MAP';
export const MAP_SECTION_CAPTION =
  'Clusters merge nearby cameras into one counted marker. Off shows every camera as its own dot. ' +
  'With turn-to-face off, north stays up and the compass and arrow show your heading.';
export const CLUSTER_LABEL = 'Cluster nearby cameras';
export const HEADING_UP_LABEL = 'Turn map to face travel';

/**
 * `Audio` is NOT quoted. Section 04's panel draws exactly two toggle rows and
 * the second is `Wake lock`, which this build cannot honour; no design file
 * draws a toggle labelled `Audio`. The nearest drawn string for this channel is
 * `B10 · CROSSING IN`'s `SPOKEN ALOUD IF AUDIO IS ON`, so the label is derived
 * from it and matched to section 04's sentence casing.
 * GAP: see docs/gaps-inbox/settings.md#audio-toggle-label-is-not-drawn
 */
export const AUDIO_LABEL = 'Audio';

/**
 * What the two toggles do, in one line.
 * GAP: see docs/gaps-inbox/settings.md#alerts-section-caption-is-not-drawn
 */
export const ALERTS_SECTION_CAPTION = 'these narrow what alerts you. nothing widens it.';

/** Said while the stored preferences are still being read back. */
export const HYDRATING_NOTICE = 'reading your settings…';

export interface SettingsViewModel {
  /** False until the persisted blob has been read back (or found absent). */
  readonly ready: boolean;
  readonly thresholdFt: number;
  readonly vibration: boolean;
  readonly audio: boolean;
  /** The mode actually applied to `<html>`, after the watch rule. */
  readonly mode: FwmMode;
  /** True when the watch rule, not the user, decided {@link mode}. */
  readonly modeForced: boolean;
  /** Type scale multiplier currently applied to the document root. */
  readonly textScale: TextScale;
  readonly typeface: Typeface;
  /** How much the floating chrome blurs. v1 only; v0 draws no glass. */
  readonly glass: FwmGlass;
  /** Whether panels refract as well as frost. A separate effect, not a level. */
  readonly liquid: FwmLiquid;
  /** How much shows THROUGH the chrome. A separate axis from the blur. */
  readonly clear: FwmClear;
  /** WHAT the glass is made of. Clear light, or the theme's colour. */
  readonly tone: FwmGlassTone;
  /** Which basemap cartography the map draws. */
  readonly mapView: FwmMapView;
  /** Straight down, or tilted along the road. */
  readonly mapTilt: FwmMapTilt;
  /** Whether the map merges nearby cameras into counted clusters. */
  readonly clusterCameras: boolean;
  /** Whether the map turns to face travel. Off is north up. */
  readonly headingUpMap: boolean;
  /** False when a reload will lose every choice on this screen. */
  readonly durable: boolean;
  /** The store's own sentence for why. Never written here. */
  readonly durabilityReason: string | null;
  readonly removalPhase: RemovalPhase;
  readonly removalLines: readonly string[];
  readonly removalReason: string | null;
}

export interface SettingsViewHandlers {
  readonly onThresholdChange?: ((thresholdFt: number) => void) | undefined;
  readonly onVibrationChange?: ((on: boolean) => void) | undefined;
  readonly onClusterCamerasChange?: ((on: boolean) => void) | undefined;
  readonly onHeadingUpMapChange?: ((on: boolean) => void) | undefined;
  readonly onAudioChange?: ((on: boolean) => void) | undefined;
  readonly onModePick?: ((mode: FwmMode) => void) | undefined;
  readonly onTextScalePick?: ((scale: TextScale) => void) | undefined;
  readonly onTypefacePick?: ((face: Typeface) => void) | undefined;
  readonly onGlassPick?: ((glass: FwmGlass) => void) | undefined;
  readonly onLiquidPick?: ((liquid: FwmLiquid) => void) | undefined;
  readonly onClearPick?: ((clear: FwmClear) => void) | undefined;
  readonly onTonePick?: ((tone: FwmGlassTone) => void) | undefined;
  readonly onMapViewPick?: ((view: FwmMapView) => void) | undefined;
  readonly onMapTiltPick?: ((tilt: FwmMapTilt) => void) | undefined;
  readonly onRemovalPress?: (() => void) | undefined;
  readonly onRemovalCancel?: (() => void) | undefined;
}

export type SettingsViewProps = SettingsViewHandlers & {
  readonly model: SettingsViewModel;
};

export function SettingsView({
  model,
  onThresholdChange,
  onVibrationChange,
  onClusterCamerasChange,
  onHeadingUpMapChange,
  onAudioChange,
  onModePick,
  onTextScalePick,
  onTypefacePick,
  onRemovalPress,
  onRemovalCancel,
}: SettingsViewProps): ReactElement {
  return (
    <section
      className="fwm-settings"
      data-fwm-settings-ready={model.ready ? 'true' : 'false'}
      data-fwm-settings-durable={model.durable ? 'true' : 'false'}
      aria-label="settings"
    >
      <SettingsHeader />

      <div className="fwm-settings-body fwm-safe-dock-gutter">
        {model.ready ? null : (
          <p className="fwm-settings-notice fwm-data" role="status">
            {HYDRATING_NOTICE}
          </p>
        )}

        {model.durable || model.durabilityReason === null ? null : (
          <p className="fwm-settings-notice fwm-data" role="status">
            {model.durabilityReason}
          </p>
        )}

        <section className="fwm-settings-section" aria-label={THRESHOLD_SECTION}>
          <ThresholdControl thresholdFt={model.thresholdFt} onChange={onThresholdChange} />
        </section>

        <section className="fwm-settings-section" aria-label={ALERTS_SECTION}>
          <h2 className="fwm-settings-eyebrow fwm-data">{ALERTS_SECTION}</h2>
          <p className="fwm-settings-caption fwm-data">{ALERTS_SECTION_CAPTION}</p>
          <SwitchRow label={VIBRATION_LABEL} on={model.vibration} onToggle={onVibrationChange} />
          <SwitchRow label={AUDIO_LABEL} on={model.audio} onToggle={onAudioChange} />
        </section>

        {/* Directly under ALERTS: mute is the biggest thing you can do to
            them, and it used to be a key called VOL with no explanation. */}
        <MuteControl />

        <PermissionsSection />

        <section className="fwm-settings-section" aria-label={TEXT_SIZE_SECTION}>
          <h2 className="fwm-settings-eyebrow fwm-data">{TEXT_SIZE_SECTION}</h2>
          <p className="fwm-settings-caption fwm-data">{TEXT_SIZE_CAPTION}</p>
          <TextSizePicker active={model.textScale} onPick={onTextScalePick} />
        </section>

        {/* The FAQ, moved out of RADAR's header -- see `HelpLink`. Above ACCESS
            because everybody has it and almost nobody has the other. */}
        <HelpLink />

        {/* Only rendered for administrators. See `AdminLink` for why that is a
            courtesy rather than the control. */}
        <AdminLink />

        {/* HARDWARE. A door like the two above it, not a preference like the
            sections below -- so it sits with the doors. */}
        <NodeLink />

        {/* Beside the doors rather than among the preferences: it goes
            somewhere and does something, it does not set anything. */}
        <DemoControl />

        {/* THE MAP'S OWN SECTION. Clustering is not an alert preference and not
            a theme -- it is how the map answers "how many", and a driver who
            wants to see individual poles rather than a number should not have
            to hunt for that under Display. */}
        <section className="fwm-settings-section" aria-label={MAP_SECTION}>
          <h2 className="fwm-settings-eyebrow fwm-data">{MAP_SECTION}</h2>
          <p className="fwm-settings-caption fwm-data">{MAP_SECTION_CAPTION}</p>
          <SwitchRow
            label={CLUSTER_LABEL}
            on={model.clusterCameras}
            onToggle={onClusterCamerasChange}
          />
          {/* Off by default: a magnetometer in a steel car is noisy, and
              rotating the whole world by a few degrees of that noise is what
              made the map feel like it was chasing the compass. */}
          <SwitchRow
            label={HEADING_UP_LABEL}
            on={model.headingUpMap}
            onToggle={onHeadingUpMapChange}
          />
        </section>

        <section className="fwm-settings-section" aria-label={TYPEFACE_SECTION}>
          <h2 className="fwm-settings-eyebrow fwm-data">{TYPEFACE_SECTION}</h2>
          <p className="fwm-settings-caption fwm-data">{TYPEFACE_CAPTION}</p>
          <TypefacePicker active={model.typeface} onPick={onTypefacePick} />
        </section>

        <section className="fwm-settings-section" aria-label={MODES_SECTION}>
          <h2 className="fwm-settings-eyebrow fwm-data">{MODES_SECTION}</h2>
          <p className="fwm-settings-caption fwm-data">{MODE_SECTION_CAPTION}</p>
          <ModePicker active={model.mode} forced={model.modeForced} onPick={onModePick} />
        </section>

        <section className="fwm-settings-section" aria-label={PRIVACY_HEADING}>
          <h2 className="fwm-settings-eyebrow fwm-data">{PRIVACY_HEADING}</h2>
          <StoredList />
          <div className="fwm-settings-promises fwm-data">
            {PRIVACY_PROMISES.map((promise) => (
              <p key={promise} className="fwm-settings-promise">
                {promise}
              </p>
            ))}
          </div>
          <RemovalControl
            phase={model.removalPhase}
            lines={model.removalLines}
            reason={model.removalReason}
            onPress={onRemovalPress}
            onCancel={onRemovalCancel}
          />
        </section>

        {/* THE BUILD, last on the screen. See BUILD_SECTION. */}
        <section className="fwm-settings-section" aria-label={BUILD_SECTION}>
          <h2 className="fwm-settings-eyebrow fwm-data">{BUILD_SECTION}</h2>
          <p className="fwm-settings-caption fwm-data">{BUILD_CAPTION}</p>
          {/* SELECTABLE, which is the whole point -- somebody has to be able to
              copy this into a message. Everything else on this screen is a
              control, so the app disables selection broadly; this opts back in. */}
          <p
            className="fwm-settings-build fwm-data"
            data-fwm-build={BUILD.commit}
          >
            {buildLabel()}
          </p>
        </section>
      </div>
    </section>
  );
}
