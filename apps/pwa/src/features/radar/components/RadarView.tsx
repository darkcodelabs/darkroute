/**
 * RADAR, as a pure function of a view model.
 *
 * `RadarScreen.tsx` reads the stores and builds the model; this file decides
 * what is on screen and in what order, and nothing else. Splitting them is what
 * makes all six states individually renderable in a test without a store, a
 * fake GPS or a clock.
 *
 * =============================================================================
 * THE STACK, TOP TO BOTTOM
 * =============================================================================
 *   52px header            title in the state hue, REP / SET / VOL
 *   34px county strip      optional; record outranks connectivity
 *   32px offline strip     only when there is no county strip
 *   GPS status row         lock dot, coordinates, sat count
 *   hero readout           distance + unit + direction line
 *   "N in range" bar       only when the engine counted something
 *   the scope              250px dot lattice; THRESHOLD / LOCK in the centre,
 *                          the bearing pip on top, 1000FT and SCAN N HZ down
 *                          the two edges
 *   three stat tiles       SPEED / HEADING / TODAY
 *   one action             RETRY LOCK / ALLOW / RETRY SYNC, when degraded
 *
 * =============================================================================
 * A LIVE CAMERA ALERT WINS THE SCREEN
 * =============================================================================
 *   "A live camera alert always wins the screen."
 *     -- Flockys Screens II.dc.html, B10 · CROSSING IN - ESCALATION LADDER
 *
 * When the alert slice reports a live takeover, this component:
 *   - marks itself `[data-fwm-radar-takeover="true"]`, which `radar.css` turns
 *     into an opaque layer filling its container, painted over the screen
 *     content and over any sheet the shell had open;
 *   - drops both strips. They are the "any banner" the ladder says the alert
 *     beats, and stacking a county notice under a live camera alert is exactly
 *     the inversion the rule exists to prevent.
 *
 * RADAR's alert presentation IS RADAR. The design draws no second screen for
 * it -- screen 01 is the in-range state -- so nothing new is invented here.
 *
 * =============================================================================
 * WHAT MUTING CHANGES, AND WHAT IT REFUSES TO CHANGE
 * =============================================================================
 * The hue desaturates and the direction line becomes `STILL TRACKING`. That is
 * all. The distance keeps updating, the "N in range" bar keeps counting muted
 * cameras, TODAY keeps incrementing, and the state machine keeps transitioning
 * underneath. Muting removes the alert, never the record.
 */

import type { ReactElement } from 'react';

import { formatFixAge } from '../format.ts';
import type { RelativeDirection } from '../format.ts';
import { hasLiveDistance } from '../radarState.ts';
import type { RadarGate, RadarState } from '../radarState.ts';

import { SweepDial } from '../../sweep/components/SweepDial.tsx';
import { MapCanvas } from '../../map/MapCanvas.tsx';
import { mapEnabled } from '../../map/flag.ts';
import { outerFtForZoom, zoomForOuterFt } from '../../map/zoom.ts';
import { MIN_OUTER_FT } from '../../sweep/zoom.ts';
import type { CameraFeatureInput } from '../../map/layers.ts';
import type { PanOffset } from '../../sweep/pan.ts';
import type { SweepDot } from '../../sweep/sweepState.ts';
import type { SweepTelemetry } from '../../sweep/telemetry.ts';
import { RadarAction } from './RadarAction.tsx';
import { RadarHeader } from './RadarHeader.tsx';
import { RadarMessage } from './RadarMessage.tsx';
import { CountyRecordStrip, OfflineStrip, countyStripVisible } from './RadarStrip.tsx';
import type { CountyRecord } from './RadarStrip.tsx';
import { ZoneCaption } from './ZoneCaption.tsx';
import { RadarTopBlock } from './RadarTopBlock.tsx';
import type { Corridor } from '../corridor.ts';
import type { ZoneLive } from '../zoneLive.ts';

/** Frozen and shared: a build with no map data allocates nothing for it. */
const NO_MAP_CAMERAS: readonly CameraFeatureInput[] = Object.freeze([]);

export interface RadarViewModel {
  /** v2's telemetry corners on the dial. See sweep/telemetry.ts. */
  readonly telemetry: SweepTelemetry;
  /** The dial's camera dots, from SWEEP's own placement. */
  readonly dots: readonly SweepDot[];
  /** The dial's outer ring in feet. Pinch moves it. */
  readonly outerFt: number;
  /**
   * The driver's own map zoom, or null to follow `outerFt`.
   *
   * Separate because the alert range is clamped and the map is not: pulling
   * back to look at a state must not be pushed back to 25 miles by a ceiling
   * that exists for alerting. See `RadarScreen`.
   */
  readonly mapZoom?: number | null | undefined;
  /** Merge nearby cameras into counted clusters. A SETTINGS preference. */
  readonly clusterCameras?: boolean | undefined;
  /** Turn the map to face the direction of travel. A SETTINGS preference. */
  readonly headingUpMap?: boolean | undefined;
  /** ZONE AUDIT's reading for the area around the vehicle, right now. */
  readonly zone: ZoneLive;
  /** One of the six. Resolved by `radarState.ts`, never guessed here. */
  readonly state: RadarState;
  readonly gate: RadarGate;
  /** True only while the position slice reports a live lock. */
  readonly hasFix: boolean;
  /** This platform has no geolocation at all, as opposed to a refusal. */
  readonly geolocationUnavailable: boolean;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly satellites: number | null;
  readonly accuracyM: number | null;
  /** Age of the last fix, for "last fix 40s ago." */
  readonly lastFixAgeMs: number | null;

  /** Straight off the engine's assessment of the nearest camera. */
  readonly distanceFt: number | null;
  readonly relativeDirection: RelativeDirection | null;
  readonly bearingDeg: number | null;
  readonly headingDeg: number | null;
  readonly isClosing: boolean | null;
  /** Muted cameras included. That is the point of the mute rule. */
  readonly countInRange: number;
  /** The configured alert distance. The scope centre reads `THRESHOLD 500 FT`. */
  readonly thresholdFt: number;
  /** Cameras cached on this device. The header's permanent count. */
  readonly camerasKnown?: number | null;
  /** Cameras in the whole published set. */
  readonly camerasTotal?: number | null;
  /** The road ahead, or null when there is no heading to have an ahead. */
  readonly corridor?: Corridor | null;
  /** Where the view is dragged to. Absent is centred on the vehicle. */
  readonly pan?: PanOffset | undefined;
  /**
   * The vehicle's own position, and the cameras as records.
   *
   * The dial never needed either: it placed everything by distance and bearing
   * from a centre that was the vehicle by definition. A MAP needs real
   * coordinates for both, because it places things on the earth rather than
   * relative to the driver.
   */
  readonly fixLat?: number | null | undefined;
  readonly fixLon?: number | null | undefined;
  readonly mapCameras?: readonly CameraFeatureInput[] | undefined;
  /**
   * The OSM `maxspeed` for the way under the vehicle, verbatim, or null.
   *
   * A STRING, not a number, and deliberately un-parsed at this layer: OSM
   * writes "55 mph", "50", "signals", "RU:urban", and deciding which of those
   * is a limit is `speedLimit.ts`'s job. Passing a number would mean somebody
   * had already made that decision, and the wrong decision looks like a road
   * sign asserting a limit that is not posted anywhere.
   */
  readonly maxspeed?: string | null | undefined;
  /**
   * Fixes per second, measured from the timestamps the position slice
   * publishes, or null while there is nothing to measure. The scope's right
   * edge reads `SCAN 4HZ`. Never declared -- see `scanRate.ts`.
   */
  readonly scanRateHz: number | null;

  readonly speedMph: number | null;
  /** Camera passes today, muted ones included. */
  readonly todayPasses: number;
  readonly muteRemainingMs: number;

  readonly offline: boolean;
  readonly takeover: boolean;
  readonly county: CountyRecord | null;
}

export interface RadarViewHandlers {
  /** Opens the intel card for a tapped camera. */
  readonly onSelectCamera?: ((cameraId: string) => void) | undefined;
  /** Pinch changed the dial's range. */
  readonly onPinch?: ((outerFt: number) => void) | undefined;
  /** The driver's raw map zoom, unclamped. See `RadarViewModel.mapZoom`. */
  readonly onMapZoom?: ((zoom: number) => void) | undefined;
  /** An explicit range choice, which hands zoom authority back to the range. */
  readonly onRangeKey?: (() => void) | undefined;
  /** Opens WHAT THIS APP KNOWS. Absent renders the `?` key inert. */
  readonly onHelp?: (() => void) | undefined;
  /** Opens the menu -- SETTINGS, which is where mute now lives. */
  readonly onSettings?: (() => void) | undefined;
  /** Writes the alert threshold from the scope's bottom rail. */
  readonly onThresholdChange?: ((thresholdFt: number) => void) | undefined;
  /** A one-finger drag moved the view off the vehicle. */
  readonly onPan?: ((pan: PanOffset) => void) | undefined;
  /** Hands a detour around the stretch ahead to the phone's maps app. */
  readonly onReroute?: (() => void) | undefined;
  /**
   * Opens the report sheet.
   *
   * NOT a header key any more: REPORT is the dock's fifth key, on every
   * screen. This stays on the props because the takeover still offers it.
   */
  readonly onReport?: (() => void) | undefined;
  readonly onViewRecord?: (() => void) | undefined;
  /** Restart the position watch. Wired by the driving loop, not by this screen. */
  readonly onRetryLock?: (() => void) | undefined;
  /** Prompts for location. Runs from a press and from nowhere else. */
  readonly onRequestLocation?: (() => void) | undefined;
  readonly onRetrySync?: (() => void) | undefined;
  /**
   * The driver moved the map themselves.
   *
   * The dial reported a pan as a coordinate because it owned the transform.
   * The map owns its own camera, so all RADAR needs to know is that the view
   * is no longer the vehicle's -- which is what puts RE-CENTER on screen.
   */
  readonly onUserMoved?: (() => void) | undefined;
}

export type RadarViewProps = RadarViewHandlers & {
  readonly model: RadarViewModel;
};

/**
 * The copy that replaces the readout when there is no distance to show.
 *
 * The no-fix pair is verbatim from the state matrix. The permission sentence is
 * verbatim from the onboarding screen. The two lead sentences for `loading` and
 * `denied` are the only strings on this screen the design never wrote.
 * GAP: see docs/gaps-inbox/radar-screen.md#radar-loading-state-not-drawn
 */
function degradedCopy(model: RadarViewModel): { lead: string; note: string | null } {
  const PRIVACY_NOTE =
    'Required. Distance to cameras is computed on-device. Coordinates never leave the phone unless you file a report.';

  if (model.gate === 'denied') {
    return {
      lead: model.geolocationUnavailable
        ? 'this device has no location service.'
        : 'location is off.',
      note: PRIVACY_NOTE,
    };
  }
  if (model.gate === 'loading') {
    return { lead: 'waiting for the first fix.', note: null };
  }

  // A state that WOULD show a distance, with no camera to measure to. Ordered
  // after the gate checks on purpose: no_gps and denied have their own copy and
  // must keep it - they are why there is no distance, and this branch is for
  // when there is no reason except an empty map.
  //
  // The design never draws it: every state in the matrix assumes a camera
  // database. It must not be dressed up as CLEAR - "clear" is a measurement,
  // and this is the absence of one. The copy says what a driver can act on and
  // nothing about the build; the tile sync fills this in within a second of a
  // fix, so the sentence a driver actually sees is about coverage, not us.
  if (hasLiveDistance(model.state) && model.distanceFt === null) {
    return {
      lead: 'no cameras on the map here.',
      note: 'nothing to measure to, so this is not a clear road - it is an unmapped one.',
    };
  }

  const age = formatFixAge(model.lastFixAgeMs);
  return {
    lead: age === null ? 'no fix.' : `last fix ${age} ago.`,
    note: 'showing cached cameras only.',
  };
}

/**
 * The one action offered, if any.
 *
 * Precedence is worst-first: a refused permission cannot be fixed by retrying a
 * lock, and neither can be fixed by retrying a sync.
 */
function actionFor(
  model: RadarViewModel,
  handlers: RadarViewHandlers,
): { label: string; onPress: (() => void) | undefined } | null {
  if (model.gate === 'denied') {
    return { label: 'ALLOW', onPress: handlers.onRequestLocation };
  }
  if (model.state === 'no_gps') {
    return { label: 'RETRY LOCK', onPress: handlers.onRetryLock };
  }
  if (model.offline) {
    return { label: 'RETRY SYNC', onPress: handlers.onRetrySync };
  }
  return null;
}

export function RadarView({ model, ...handlers }: RadarViewProps): ReactElement {
  // A hero numeral with nothing to show renders NO_VALUE ("—") at
  // --fwm-text-hero -- a dash drawn at the size of the hero numeral. It reads
  // as a broken element, not as "unknown", so the hero requires a distance as
  // well as a live state.
  const live = hasLiveDistance(model.state) && model.distanceFt !== null;
  const action = actionFor(model, handlers);

  // Record outranks connectivity: the county strip replaces the offline strip
  // when both apply, rather than stacking two strips over the readout. It only
  // displaces it when it is actually on screen -- a county passed while
  // `FEATURES.record` is off must not silently take the offline warning with it.
  const showCounty = !model.takeover && countyStripVisible(model.county);
  const showOffline = !model.takeover && !showCounty;

  return (
    <section
      className="fwm-radar"
      data-fwm-radar-state={model.state}
      data-fwm-radar-gate={model.gate}
      data-fwm-radar-takeover={model.takeover ? 'true' : 'false'}
      aria-label="radar"
    >
      <RadarHeader
        muteRemainingMs={model.state === 'muted' ? model.muteRemainingMs : null}
        camerasKnown={model.camerasKnown ?? null}
        camerasTotal={model.camerasTotal ?? null}
        todayPasses={model.todayPasses}
        onSettings={handlers.onSettings}
      />

      {showCounty ? (
        <CountyRecordStrip record={model.county} onView={handlers.onViewRecord} />
      ) : null}
      {showOffline ? <OfflineStrip offline={model.offline} /> : null}

      {/* THE TOP BLOCK. One row where seven stacked lines used to be. See
          `RadarTopBlock` for what went away and why. */}
      <RadarTopBlock
        corridor={model.corridor ?? null}
        speedMph={model.speedMph}
        maxspeed={model.maxspeed ?? null}
        headingDeg={model.headingDeg}
        accuracyM={model.accuracyM}
        hasFix={model.hasFix}
        thresholdFt={model.thresholdFt}
        onReroute={handlers.onReroute}
        /* The SAME handler the map and the dial hand a tapped dot to, so a
           camera opens the same card wherever it is touched. */
        onSelectCamera={handlers.onSelectCamera}
      />

      {/* THE DEGRADED STATES SURVIVED THE TIGHTENING.
          The top block assumes a fix: a posted limit, a heading, a corridor. It
          says NO FIX in the verdict line, which is honest but not an
          explanation -- "last fix 40s ago, showing cached cameras only" is, and
          it is what tells a driver whether to trust what is on the screen. The
          RETRY LOCK / ALLOW key below is the way out. */}
      {live ? null : <RadarMessage {...degradedCopy(model)} />}

      <div className="fwm-radar-body">
        {/* NOTHING BETWEEN THE HEADER AND THE GROUND.
            The readouts that used to float here are in the top block now, and
            the map runs the full height of this column. */}
        {mapEnabled() ? (
          /* THE MAP. Same slot, same surrounding chrome -- the top block and
             the dock are the product and do not care what draws the ground.
             See `features/map`. */
          <MapCanvas
            lat={model.fixLat ?? null}
            lon={model.fixLon ?? null}
            bearingDeg={model.headingDeg}
            cameras={model.mapCameras ?? NO_MAP_CAMERAS}
            zoom={model.mapZoom ?? zoomForOuterFt(model.outerFt)}
            /* THE CLOSE END IS A RAIL; THE FAR END IS NOT.
               Pinching IN past the app's minimum range would be clamped in feet
               and eased back -- that is the snap-back -- so it stops dead.
               Pinching OUT was rejected the same way, which capped the map at
               about 25 miles and made it impossible to look at a state, let
               alone the country. Zooming out is just looking; the alert radius
               stays clamped at its own maximum regardless of what is on screen,
               so there is nothing to protect against. */
            maxZoom={zoomForOuterFt(MIN_OUTER_FT)}
            cluster={model.clusterCameras ?? true}
            headingUp={model.headingUpMap ?? false}
            /* THE THRESHOLD RING. The sweep dial below draws one and the map
               did not, so switching ground lost the only picture of the alert
               setting the driver had. Same value, same source of truth. */
            thresholdFt={model.thresholdFt}
            panned={model.pan !== undefined && (model.pan.x !== 0 || model.pan.y !== 0)}
            onSelectCamera={handlers.onSelectCamera}
            onUserMoved={handlers.onUserMoved}
            /* The driver's pinch feeds the SAME handler as the dial's pinch,
               so the range the rest of the app reasons about -- the alert
               radius, the tile fetch, the RANGE readout -- is the range the
               map is actually showing. Deliberately converted with the default
               latitude, matching `zoomForOuterFt` above: the round trip has to
               be symmetric or a pinch would drift the range every gesture. */
            onZoomChanged={(next) => {
              // Two consumers, deliberately. The RANGE gets feet and clamps
              // them; the MAP keeps the raw zoom so a clamp can never drag the
              // view back to a limit that only applies to alerting.
              handlers.onPinch?.(outerFtForZoom(next));
              handlers.onMapZoom?.(next);
            }}
          />
        ) : (
        <SweepDial
          bleed
          dots={model.dots}
          scanning={model.gate === 'live' && model.state !== 'no_gps'}
          headingUp={model.headingDeg !== null}
          onSelectCamera={handlers.onSelectCamera}
          outerFt={model.outerFt}
          onPinch={handlers.onPinch}
          thresholdFt={model.thresholdFt}
          onThresholdChange={handlers.onThresholdChange}
          pan={model.pan}
          onPan={handlers.onPan}
          alertState={model.state}
        />
        )}


        {/* ZONE AUDIT's reading, for where you are now. Below the dial
            because it describes the area the dial is drawing. */}

        {action === null ? null : <RadarAction label={action.label} onPress={action.onPress} />}
      </div>

      {/* THE ZONE LINE IS DRAWN NOWHERE, and this comment used to say it was
          drawn by the dock. It published to `app/dockCaption.ts` and v0's
          `Dock` was the only `useDockCaption()` subscriber; that dock is
          deleted, so the channel now has a publisher and no reader.

          Nothing was lost with it. This whole view is already unreachable:
          `registry.v1.tsx` maps `radar` to `DriveScreen`, and `main.tsx`
          renders `{ ...SCREENS, ...V1_SCREENS }`, so v1's screen shadows v0's
          on every boot and `ZoneCaption` has not mounted for a driver in a
          long time. It is recorded here rather than quietly deleted because
          removing the rest of v0's RADAR is its own change, not a side effect
          of removing a dock. */}
      <ZoneCaption zone={model.zone} state={model.state} />
    </section>
  );
}
