/**
 * RADAR -- the screen this product is.
 *
 * =============================================================================
 * THIS FILE IS WIRING. IT IS NOT A MOCK, AND IT IS NOT A CALCULATOR.
 * =============================================================================
 * Every value below arrives from a store selector, and every store selector is
 * a cached output of the engine in `@fwm/core` or of an adapter that
 * capability-detected first. This file:
 *
 *   - calls no browser API. No `navigator`, no `geolocation`, no `vibrate`, no
 *     `Notification`, no permission prompt -- on mount or ever. The only
 *     platform call in the whole subtree is `Date.now()`, injectable through
 *     the `now` prop, used for one thing: the age of the last fix.
 *   - does no geospatial arithmetic. Distance, bearing, relative direction,
 *     in-range and the state machine all arrive already decided. Duplicating
 *     any of them here is how a screen starts disagreeing with the alert that
 *     is buzzing the driver's pocket.
 *   - renders no distance it was not given. A missing value is an em dash.
 *
 * =============================================================================
 * WHAT RADAR OWNS THAT NOTHING ELSE DOES
 * =============================================================================
 * Two presentations that are not alert states: `no_gps` and `muted`. Both are
 * resolved in `radarState.ts` from values the stores publish, and both are
 * deliberately grey, because a coloured ring on this screen always means a
 * camera.
 *
 * =============================================================================
 * THE HANDLERS ARE INJECTED, AND AN ABSENT ONE IS NOT FAKED
 * =============================================================================
 * `RETRY LOCK`, `ALLOW` and `RETRY SYNC` restart a position watch, prompt for a
 * permission and drain a queue -- none of which RADAR owns. Each is a prop.
 * A build that has not wired one renders the control the design draws, disabled,
 * instead of a live-looking button that does nothing. `ALLOW` in particular
 * runs only from a press: nothing on this screen can raise an OS dialog on
 * mount.
 */

import { openScreen } from '../../app/screenState.ts';
import {
  useCachedCameraCount,
  useCachedCameras,
  useCameraAssessments,
  useIsPresenceLive,
  useNearbyPeers,
  useSpeedMps,
} from '../../stores/index.ts';
import { zoneLive } from './zoneLive.ts';
import { DEFAULT_SWEEP_ZOOM, clampOuterFt } from '../sweep/zoom.ts';
import { useSettingsStore } from '../../stores/index.ts';
import { speedAt } from '../map/speedAt.ts';
import { waysNear } from '../map/speedSource.ts';
import { sweepDots } from '../sweep/sweepState.ts';
import { catalogue } from '../../services/cameras/catalogue.ts';
import { gazetteer } from '../../services/cameras/gazetteer.ts';
import { countyRecords } from '../../services/records/countyRecords.ts';
import { onScreenReselected } from '../../app/screenState.ts';
import { NO_PAN, reachFt, viewCentre } from '../sweep/pan.ts';
import { OUTER_RADIUS } from '../sweep/geometry.ts';
import { NORTH_UP, nextOrientation } from './orientation.ts';
import { preferHeading } from './compassHeading.ts';
import { useCompassHeading } from './useCompassHeading.ts';
import { aroundYou, corridorFor } from './corridor.ts';
import { rerouteWaypoint } from './reroute.ts';
import { navigateTo } from '../../services/adapters/navigateTo.ts';
import type { OrientationState } from './orientation.ts';
import { coverRangeFt, syncCamerasAt } from '../../services/cameras/syncInstance.ts';
import type { PanOffset } from '../sweep/pan.ts';
import type { SweepInput } from '../sweep/sweepState.ts';
import type { SweepTelemetry } from '../sweep/telemetry.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import {
  useAccuracyM,
  useAlertState,
  useAlertThresholdFt,
  useCountInRange,
  useCurrentFix,
  useGpsStatus,
  useHeadingDeg,
  useIsAlertTakeoverActive,
  useIsClosing,
  useIsMuted,
  useIsOffline,
  useLastFixAtMs,
  useLocationPermission,
  useMutePierced,
  useMuteRemainingMs,
  useNearestCamera,
  useSatellites,
  useSpeedMph,
  useTodayPasses,
} from '../../stores';

import { RadarView } from './components/RadarView.tsx';
import type { RadarViewHandlers, RadarViewModel } from './components/RadarView.tsx';
import type { CountyRecord } from './components/RadarStrip.tsx';
import { demoMaxspeed } from '../demo/demoDrive.ts';
import { resolveRadarGate, resolveRadarState } from './radarState.ts';
import { scanRateHz, trackFixTime } from './scanRate.ts';

import './radar.css';

export type RadarScreenProps = RadarViewHandlers & {
  /**
   * Override the county record. Tests use it; the screen resolves its own.
   *
   * It used to be the ONLY source -- a prop nobody passed, so the strip never
   * drew. The records are real now: `services/records/countyRecords.ts` looks
   * one up by the FIPS the cameras already carry.
   */
  readonly county?: CountyRecord | null;
  /** Injectable clock. Used once, for the age of the last fix. */
  readonly now?: (() => number) | undefined;
};

export function RadarScreen({
  county = null,
  now = Date.now,
  ...handlers
}: RadarScreenProps = {}): ReactElement {
  // --- the engine's answers ------------------------------------------------
  const alertState = useAlertState();
  const nearest = useNearestCamera();
  const countInRange = useCountInRange();
  const isClosing = useIsClosing();
  const thresholdFt = useAlertThresholdFt();
  /**
   * Whether the map merges cameras into counted clusters. A SETTINGS choice.
   *
   * Subscribed with a selector so a change to any other setting -- a mute, a
   * threshold nudge -- does not re-render RADAR, which redraws a map.
   */
  const clusterCameras = useSettingsStore((state) => state.clusterCameras);
  /** Whether the map turns to face travel. Default north-up; see the store. */
  const headingUpMap = useSettingsStore((state) => state.headingUpMap);
  const camerasKnown = useCachedCameraCount();

  /**
   * The documented record for the county the vehicle is in.
   *
   * Keyed on the FIPS the ZONE resolves -- the commonest county among the
   * cameras around you -- rather than on a reverse geocode, because that FIPS
   * is already on every camera and needs no second lookup and no request.
   *
   * Null is UNDOCUMENTED, never CLEAN. The strip stays absent rather than
   * printing a zero, which would read as "audited and found clean" -- a claim
   * nobody has made about almost anywhere.
   */

  const takeover = useIsAlertTakeoverActive();

  // --- the mute gate -------------------------------------------------------
  const muted = useIsMuted();
  const mutePierced = useMutePierced();
  const muteRemainingMs = useMuteRemainingMs();

  // --- where the vehicle is ------------------------------------------------
  const gps = useGpsStatus();
  const fix = useCurrentFix();

  const satellites = useSatellites();
  const accuracyM = useAccuracyM();
  const rawHeadingDeg = useHeadingDeg();
  const speedMps = useSpeedMps();

  /**
   * THE HEADING THE SCOPE IS ROTATED BY, which is not the one the platform
   * reports.
   *
   * A GPS course is derived from consecutive positions, so standing still it is
   * derived from measurement noise -- observed at 0-1 mph reporting E, SE, SW,
   * W on consecutive fixes, each one re-rotating the entire map. The scope
   * could not hold still.
   *
   * `nextOrientation` holds the heading while the vehicle is slow or stopped,
   * eases through jitter while it is moving, and snaps through a real turn.
   * See `orientation.ts` -- the whole rule is there and it is pure.
   *
   * A ref, not state: this is derived from a stream of fixes rather than owned
   * by the screen, and re-rendering to store it would be a render per fix on
   * top of the one the fix already causes.
   */
  const orientation = useRef<OrientationState>(NORTH_UP);
  /**
   * THE COMPASS COVERS WHAT THE GPS CANNOT.
   *
   * `nextOrientation` holds the heading null while the vehicle is stationary,
   * because a GPS COURSE at a standstill is derived from measurement noise. All
   * true -- and it left a parked car with no bearing at all, showing NO BEARING
   * and an empty compass beside an accuracy chip reading ±8 M.
   *
   * A magnetometer does not care whether you are moving. So the GPS course wins
   * whenever there is one (a phone in a steel box reads the box as much as the
   * earth), and the compass answers when there is not.
   *
   * The gate still applies to the GPS course, which is what it was written for.
   * A compass reading goes straight through: it has its own noise floor in
   * `worthPublishing`, and holding it back while stationary would defeat the
   * entire reason for reading it.
   */
  const compassHeadingDeg = useCompassHeading();
  orientation.current = nextOrientation(orientation.current, {
    headingDeg: rawHeadingDeg,
    speedMps,
  });

  /**
   * =========================================================================
   * TWO HEADINGS, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS
   * =========================================================================
   * WHICH WAY THE DEVICE POINTS, and WHICH WAY THE VEHICLE IS GOING. They are
   * the same number in a moving car and nothing like each other otherwise, and
   * this screen used ONE value for both.
   *
   * THE BUG THAT CAME OF IT. Three screenshots from a stationary phone, seconds
   * apart: the compass read NE, then W, then N, and the corridor rewrote itself
   * each time -- "CLEAR FOR 1.5 MI, THEN 7 IN A 1210 FT STRETCH", then "CLEAR
   * FOR 2.1 MI, THEN 1 CAMERA", then "CLEAR FOR 2.8 MI, THEN 6 IN A 680 FT
   * STRETCH". Three different three-mile futures for a person standing still.
   *
   * `orientation.ts` was already right and already held the GPS course null
   * below walking pace, for precisely this reason. Then `preferHeading` handed
   * the magnetometer straight through, and every consumer downstream treated a
   * hand-held phone's facing as a direction of travel.
   *
   * `travelHeadingDeg` is null unless the vehicle is actually moving. Anything
   * that PROJECTS FORWARD reads it and nothing else: the corridor, the road the
   * speed plate matches against, and the map camera. When it is null the
   * corridor is null and the block says NO BEARING, which is true and is an
   * answer a person can act on, rather than a confident wrong one.
   *
   * `headingDeg` keeps the compass, and is for the things that describe the
   * MOMENT rather than the road ahead -- the rose, the cardinal readout. A
   * compass on a parked car pointing north SHOULD say north; that was the whole
   * reason for reading the magnetometer and it is still worth having.
   */
  const travelHeadingDeg = orientation.current.headingDeg;
  const headingDeg = preferHeading(travelHeadingDeg, compassHeadingDeg).headingDeg;
  const speedMph = useSpeedMph();
  const lastFixAtMs = useLastFixAtMs();
  const locationPermission = useLocationPermission();

  // --- the rest ------------------------------------------------------------
  const todayPasses = useTodayPasses();
  const offline = useIsOffline();

  const gate = resolveRadarGate({
    alertState,
    gps,
    locationPermission,
    muted,
    mutePierced,
  });
  const state = resolveRadarState({
    alertState,
    gps,
    locationPermission,
    muted,
    mutePierced,
  });

  // Recomputed on every render on purpose: the driving loop re-renders this
  // screen on each fix, and an age memoised against a stale clock would freeze
  // "last fix 40s ago" at whatever it said when the fix stopped arriving.
  const lastFixAgeMs = lastFixAtMs === null ? null : Math.max(0, now() - lastFixAtMs);

  // THE SCOPE'S `SCAN 4HZ` IS MEASURED, NOT DECLARED.
  //
  // 4 Hz belongs to the glovebox node ("streaming at 4 Hz over its own AP",
  // `A3 · CONNECT`), and a browser's geolocation runs at whatever cadence the
  // platform feels like. Printing the design's number regardless would be
  // fabricating instrument data, the same offence as printing a satellite
  // count the web cannot supply. So the rate comes from the timestamps the
  // position slice already publishes.
  //
  // A ref rather than state: this is a cache of values that have already
  // arrived, not a source of renders, and `trackFixTime` ignores a timestamp
  // it has already seen, so a strict-mode double render counts one fix.
  const fixTimes = useRef<readonly number[]>([]);
  fixTimes.current = trackFixTime(fixTimes.current, lastFixAtMs);
  const scanRate = scanRateHz(fixTimes.current);

  const cachedCameras = useCachedCameras();

  const zone = useMemo(() => zoneLive(fix, cachedCameras), [fix, cachedCameras]);

  const liveCounty = useMemo((): CountyRecord | null => {
    const fips = zone.countyFips;
    if (fips === null) return null;
    const record = countyRecords.forCounty(fips);
    if (record === null) return null;
    const label = gazetteer.county(fips)?.label ?? null;
    if (label === null) return null;
    return { label, incidents: record.incidents };
  }, [zone.countyFips, camerasKnown]);
  // The dial's inputs, read here so RADAR places dots exactly as SWEEP did.
  const assessments = useCameraAssessments();
  const peers = useNearbyPeers();
  const presenceLive = useIsPresenceLive();
  // The dial's range. A pinch moves it; there is no slider - SWEEP's was
  // removed when the two screens merged, and the readout under the dial is
  // what keeps an invisible gesture's state visible.
  const [outerFt, setOuterFt] = useState<number>(DEFAULT_SWEEP_ZOOM.outerFt);
  /**
   * THE MAP'S OWN ZOOM, which is not the alert range.
   *
   * They were the same number, and that broke zooming out. The alert radius has
   * a real ceiling -- `clampOuterFt` -- so a driver pulling back to look at the
   * state reported a huge range, it clamped to the maximum, and the clamped
   * value came back as a zoom prop the map had already moved past. The map
   * eased back to 25 miles: the same snap-back as before, wearing the opposite
   * sign.
   *
   * Null means "no opinion, follow the range" -- which is what a range-key
   * press restores. Any other value is the driver's own gesture, and the map
   * keeps it however far out it goes, because looking further is not the same
   * as alerting further.
   */
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  // Where the view has been dragged to. Reset by pressing RADAR -- see the
  // recentre handler below and `screenState.ts`.
  const [pan, setPan] = useState<PanOffset>(NO_PAN);
  // WIDEN THE DATA TO MATCH THE VIEW.
  //
  // The camera sync fetched a fixed 3x3 of tiles whatever the scope was set to,
  // so at 100 miles the dial drew a 20-mile square of cameras in the middle of
  // an empty circle, with the roads ending on the straight edge where the
  // loaded tiles stopped. Both loaders now take the range they are being asked
  // to draw.
  useEffect(() => {
    coverRangeFt(outerFt);
  }, [outerFt]);

  /**
   * WHERE THE VIEW IS, which is not where the vehicle is once a thumb has moved
   * it.
   *
   * Cameras were fetched for the tile the VEHICLE sits in. Right
   * while the view is centred on it and wrong the moment it is not: panning
   * moves the window over the world, and the world outside the vehicle's own
   * tiles had never been loaded, so dragging revealed emptiness. A map loads
   * what the viewer is looking at.
   */
  const centre = useMemo(
    () =>
      fix === null
        ? null
        : viewCentre({ lat: fix.lat, lon: fix.lon }, pan, outerFt, OUTER_RADIUS, travelHeadingDeg),
    // BOTH headings: the view centre reads the travel heading, and the two can
    // diverge -- a stopped vehicle keeps a compass reading while the travel
    // heading goes null. There is no react-hooks lint rule in this repo to
    // catch a stale dep, so the list is maintained by hand and by reading.
    [fix, pan, outerFt, headingDeg, travelHeadingDeg],
  );

  /**
   * How far the frame can see from the vehicle. Grows with the pan, because a
   * dragged frame is looking somewhere the vehicle is not -- see `reachFt`.
   */
  const reach = useMemo(() => reachFt(outerFt, pan, OUTER_RADIUS), [outerFt, pan]);

  /**
   * THE POSTED LIMIT OF THE ROAD UNDERNEATH, or null.
   *
   * The plate has always accepted a `maxspeed` and nothing ever supplied one,
   * so it showed a dash on every road in the country. It comes off the speeds
   * archive now, read at the vehicle's own position -- see `speedAt`, which
   * refuses anything ambiguous, too far away, or running across the heading.
   *
   * Recomputed per fix rather than continuously: the archive is queried from
   * already-loaded tiles, so this is arithmetic over a handful of ways, and the
   * answer cannot change without the vehicle moving.
   *
   * Expect a DASH on most side streets. OSM carries `maxspeed` on roughly 95%
   * of freeway miles and 10% of residential ones, and `speedLimit.ts` prints
   * nothing rather than a guess.
   */
  const [maxspeed, setMaxspeed] = useState<string | null>(null);
  useEffect(() => {
    if (fix === null) {
      setMaxspeed(null);
      return;
    }
    let cancelled = false;
    void waysNear(fix.lon, fix.lat).then((ways) => {
      if (cancelled) return;
      const posted = speedAt(ways, fix.lon, fix.lat, travelHeadingDeg)?.maxspeed ?? null;
      // The real lookup wins whenever it answers. `demoMaxspeed` is null unless
      // a demo is running, so this can only ever fill a dash during one.
      setMaxspeed(posted ?? demoMaxspeed());
    });
    return () => {
      cancelled = true;
    };
    // `travelHeadingDeg` is what `speedAt` matches the road against; see the
    // note on the two headings above.
  }, [fix, headingDeg, travelHeadingDeg]);

  // The camera tiles follow the window too, for the same reason.
  useEffect(() => {
    if (centre === null) return;
    syncCamerasAt(centre.lat, centre.lon);
  }, [centre]);

  // Pressing RADAR while RADAR is open recentres the scope. A panned scope is a
  // lied-to scope -- the vehicle is not in the middle any more, so bearings read
  // off the dial are wrong -- and undoing that has to be one obvious action.
  useEffect(
    () =>
      onScreenReselected((screen) => {
        if (screen === 'radar') setPan(NO_PAN);
      }),
    [],
  );
  /**
   * SWEEP's own input shape, so the dial places dots exactly as it did on its
   * own screen. Imported rather than reimplemented: two placements of one
   * camera set is how the merged screen would start disagreeing with itself.
   */
  const sweepInput: SweepInput = useMemo(
    () => ({
      assessments,
      headingDeg,
      gps,
      locationPermission,
      muted,
      mutePierced,
      peers,
      presenceLive,
      outerFt,
      reachFt: reach,
    }),
    [assessments, headingDeg, gps, locationPermission, muted, mutePierced, peers, presenceLive, outerFt, reach],
  );

  const sweepTelemetry: SweepTelemetry = useMemo(
    () => ({ headingDeg, lat: fix?.lat ?? null, lon: fix?.lon ?? null, meshLive: presenceLive }),
    [headingDeg, fix, presenceLive],
  );

  const model: RadarViewModel = useMemo(
    () => ({
      state,
      gate,
      hasFix: gps === 'lock',
      geolocationUnavailable: gps === 'unavailable' || locationPermission === 'unavailable',
      lat: fix?.lat ?? null,
      lon: fix?.lon ?? null,
      satellites,
      accuracyM,
      lastFixAgeMs,
      distanceFt: nearest?.distanceFt ?? null,
      relativeDirection: nearest?.relativeDirection ?? null,
      bearingDeg: nearest?.bearingDeg ?? null,
      headingDeg,
      isClosing,
      countInRange,
      thresholdFt,
      camerasKnown: camerasKnown === 0 ? null : camerasKnown,
      camerasTotal: catalogue.total(),
      // The driver's own map zoom, which the alert range must not clamp. See
      // the `mapZoom` state above.
      mapZoom,
      clusterCameras,
      headingUpMap,
      maxspeed,
      /*
       * A CORRIDOR WHEN THERE IS A DIRECTION, A PROXIMITY VIEW WHEN THERE IS
       * NOT -- never an empty box.
       *
       * `corridorFor` returns null without a travel heading, which is correct
       * and which left the block showing NO BEARING and an empty ladder. That
       * is more honest than the churning corridor it replaced and no more
       * useful, and standing still is exactly when somebody has time to look.
       *
       * `aroundYou` answers the question that IS answerable: the same cameras,
       * the same range, the same bands, ranked by a distance that needs no
       * course. Only when there is no fix at all is there nothing to draw.
       */
      corridor:
        corridorFor(assessments, travelHeadingDeg, thresholdFt) ??
        (fix === null ? null : aroundYou(assessments, thresholdFt)),
      pan,
      scanRateHz: scanRate,
      speedMph,
      todayPasses,
      muteRemainingMs,
      offline,
      takeover,
      county: county ?? liveCounty,
      // Every cached camera within the radius, not only the ones the engine
      // assessed: the engine decides an alert, this describes the area, and a
      // camera behind you still watches the road you are on.
      zone,
      outerFt,
      // THE MAP'S INPUTS. Real coordinates, and the camera RECORDS rather than
      // the dial's placed dots -- a map places things on the earth, so it needs
      // what the record says, not where the dial decided to draw it.
      fixLat: fix?.lat ?? null,
      fixLon: fix?.lon ?? null,
      mapCameras: cachedCameras,
      dots: sweepDots(sweepInput),
      telemetry: sweepTelemetry,
    }),
    [
      cachedCameras,
      outerFt,
      mapZoom,
      clusterCameras,
      headingUpMap,
      maxspeed,
      sweepInput,
      sweepTelemetry,
      state,
      gate,
      gps,
      locationPermission,
      fix,
      satellites,
      accuracyM,
      lastFixAgeMs,
      nearest,
      headingDeg,
      travelHeadingDeg,
      isClosing,
      countInRange,
      thresholdFt,
      scanRate,
      speedMph,
      todayPasses,
      muteRemainingMs,
      offline,
      takeover,
      county,
      liveCounty,
      zone,
    ],
  );

  /**
   * DEFAULT HEADER NAVIGATION.
   *
   * The shell registers this screen with no props, so without a default the
   * header's `SET` key is rendered and does nothing - the settings screen, the
   * theme picker and the alert threshold all exist and are unreachable. An
   * explicitly-passed handler still wins, which is what the tests use.
   *
   * `REP` opens the report screen the same way the dock's REPORT bar does, so
   * the two entry points cannot diverge.
   */
  const navigation: RadarViewHandlers = {
    onSettings: () => {
      openScreen('settings');
    },
    onReport: () => {
      openScreen('report');
    },
    onHelp: () => {
      openScreen('help');
    },
    onPan: (next: PanOffset) => {
      setPan(next);
    },
    /**
     * The map moved under the driver's own finger.
     *
     * Recorded as a non-zero pan so everything already keyed off "is the view
     * displaced" -- RE-CENTER appearing, the vehicle-follow being suppressed --
     * keeps working across both renderers without a second flag to keep in
     * step. The VALUE is meaningless to the map, which owns its own camera;
     * only the fact of it matters.
     */
    onUserMoved: () => {
      setPan((current) => (current.x === 0 && current.y === 0 ? { x: 1, y: 0 } : current));
    },
    onReroute: () => {
      // A WAYPOINT, not a route. There is no routing engine here and no
      // destination the driver has given -- so this picks a point ahead and to
      // the quieter side and hands it to whatever maps app the phone has, which
      // routes with its own road graph and its own copy of the driver's
      // location. Nothing about surveillance is sent anywhere.
      // See `reroute.ts` for what it deliberately does not claim.
      if (fix === null) return;
      // The key is disabled when `canReroute` is false, so reaching here with
      // an unroutable corridor should be impossible -- `rerouteWaypoint` still
      // refuses on its own terms rather than trusting that.
      const waypoint = rerouteWaypoint(
        { lat: fix.lat, lon: fix.lon },
        corridorFor(assessments, travelHeadingDeg, thresholdFt),
      );
      if (waypoint === null) return;
      navigateTo({ lat: waypoint.lat, lon: waypoint.lon, label: 'around this stretch' });
    },
    onRangeKey: () => {
      // An explicit range choice hands authority back to the range: the map
      // stops holding the driver's freehand zoom and follows outerFt again.
      setMapZoom(null);
    },
    onThresholdChange: (next: number) => {
      // Straight to settings: the scope's stepper and the SETTINGS screen write
      // the same number, and the alert engine reads that one.
      useSettingsStore.getState().setThresholdFt(next);
    },
    onPinch: (next: number) => {
      // The RANGE clamps, because the alert radius has a real ceiling. The MAP
      // does not -- see `mapZoom`.
      setOuterFt(clampOuterFt(next));
    },
    onMapZoom: (next: number) => {
      setMapZoom(next);
    },
    ...handlers,
  };

  return <RadarView model={model} {...navigation} />;
}
