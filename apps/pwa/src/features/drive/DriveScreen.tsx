/**
 * DRIVE - the v1 replacement for RADAR.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isDrive` block,
 * lines 55-178, element for element.
 *
 * =============================================================================
 * WHAT CHANGED FROM v0, AND WHY IT IS A NEW COMPONENT
 * =============================================================================
 * v0 RADAR is an instrument: a dial, a corridor ladder, a compass, a strip.
 * v1 DRIVE is a map with things floating on it. That is a different structure,
 * not a different skin, which is why this is a separate component registered
 * under the same `radar` id rather than a branch inside `RadarView`.
 *
 * =============================================================================
 * WHAT THE FIRST VERSION OF THIS FILE GOT WRONG
 * =============================================================================
 * It shipped a top bar with two controls, no right rail, no speed pill, no
 * owner chip, no action keys on the closest card, and a focus mode that was a
 * full-screen `<button>` - which swallowed every touch on the map, so a driver
 * in focus mode could not pinch, pan or zoom. The design's own focus overlay
 * covers the screen too, and it can afford to: it has no map under it.
 *
 * The rule this file now follows: NOTHING COVERS THE MAP THAT IS NOT A
 * CONTROL. Every block here is positioned from an EDGE; not one is inset-0.
 *
 * FOCUS MODE IS GONE. It hid every control and drew its own big-distance
 * readout - a second screen you had to leave to do anything - and the only
 * part anybody wanted was its side effect: it took the whole panel. That key
 * is now a plain fullscreen toggle over the app exactly as it is, which is the
 * same result as switching focus on and straight back off, in one press.
 *
 * =============================================================================
 * EVERY NUMBER IS DERIVED OR ABSENT
 * =============================================================================
 * The design is populated with a worked example: 0.4 miles, 38 sec, 42 mph,
 * 45 limit, 132k, POLICE, three cameras ahead. Not one is hardcoded. Where the
 * product cannot compute a figure it renders an em dash.
 *
 * "Route around all N" is the design's own label, and it is now the design's
 * own behaviour: the key plans a real multi-stop detour off the cached camera
 * set (`packages/core/src/avoidance.ts`) and offers to hand it to a maps app.
 * The sub-line under it is not the design's, because the handoff discloses
 * something and the key has to say that it asks first. See `driveRouteLabel`
 * and `DetourOffer.tsx` for the whole argument.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { openScreen } from '../../app/screenState.ts';
import {
  alertActions,
  useAlertState,
  useCachedCameraCount,
  useCameraAssessments,
  useCurrentFix,
  useHeadingDeg,
  useIsClosing,
  useIsCameraMuted,
  useMutePierced,
  useMapOwnerFilter,
  useMapView,
  useMapTilt,
  useNearestCamera,
  useSettingsStore,
  useSpeedMph,
  useCachedCameras,
  useCamerasStore,
} from '../../stores/index.ts';
import type { CameraOwnerType } from '../../stores/index.ts';
import { MapCanvas } from '../map/MapCanvas.tsx';
import { MapControlPanel } from '../map/MapControlPanel.tsx';
import { MiniMap } from '../map/MiniMap.tsx';
import { facingSpans } from '../map/miniMap.ts';
import { mapEnabled } from '../map/flag.ts';
import { visibleCameras } from '../map/ownerFilter.ts';
import { speedAt } from '../map/speedAt.ts';
import { waysNear } from '../map/speedSource.ts';
import { openIntelCard } from '../intel/IntelScreen.tsx';
import { chipLabel, mountPhrase } from '../intel/describe.ts';
import { coveredDirections } from '../intel/intelState.ts';
import { OWNER_LABELS } from '../triage/triage.ts';
import { speedPlateState } from '../radar/speedLimit.ts';
import { facingCardinal } from '../report/reportDraft.ts';
// NOT `navigateTo` any more. The detour work took DRIVE off it entirely -- the
// route key hands a multi-stop URL to `routeVia` instead - and re-adding the
// import here would only reintroduce an unused one.
import { ReloadTitle } from '../../components/nav';
import { MAP_VIEW_LABELS } from '../../app/mapView.ts';
import { MAP_TILT_DEG, MAP_TILT_LABELS, nextMapTilt } from '../../app/mapTilt.ts';
import { enterImmersive, exitImmersive } from '../../services/pwa/immersive.ts';
import { catalogue } from '../../services/cameras/catalogue.ts';
import { describeEta, etaSeconds } from './eta.ts';
import { offerDetour } from './DetourOffer.tsx';
import { planDriveDetour } from './detour.ts';
import { useSteadyFix, useSteadyHeading } from './steady.ts';

import './drive.css';

/** Frozen and shared: a build with no map data allocates nothing for it. */
const NO_CAMERAS: readonly never[] = Object.freeze([]);

/** The app's word for "we cannot compute this", used everywhere it cannot. */
export const NO_VALUE = '—';

export const DRIVE_WATCHING = 'Watching';

/**
 * THE WORD, NOT THE MARK - the owner's call, reversing the note below.
 *
 * The halftone logo said whose reading this is without saying the name, which
 * is the right trade on a screen read at speed only if the reader already knows
 * the product. On the first screen of an app somebody just installed, the name
 * is the more useful thing for the same pixels.
 */
export const DRIVE_WORDMARK = 'DarkRoute';

/*
 * `DRIVE_RELOAD_LABEL` USED TO BE HERE, spelled out as
 * `'DarkRoute - reload this page'`. It is `reloadTitleLabel(DRIVE_WORDMARK)`
 * now and lives in `components/nav/ReloadTitle.tsx`, which is the same string
 * and is no longer this screen's private answer: thirteen other pages say the
 * phrase too, and a second copy of it here is how the fifteenth ends up
 * saying something else.
 */
export const DRIVE_FULLSCREEN = 'Full screen';
export const DRIVE_CLOSEST = 'CLOSEST · AHEAD';

/**
 * The ` at ` that `nameOf` puts between a street and its cross street.
 *
 * Anchored with spaces on both sides so it cannot eat the `at` inside a real
 * road name - "Gratiot at Cattaraugus" must lose only the join, and a street
 * actually called "Atlantic" or "Chatham" must be left alone entirely.
 */
const KICKER_JOIN_RE = / at /g;

/**
 * THE PRIMARY KEY, which counts what it would route around.
 *
 * The design's key is "Route around all 4" over "+3 MIN" - a promise and its
 * cost. The count is real and comes from the card's own queue: the camera in
 * the figure plus everything in THEN under it.
 *
 * The COST is not written yet. There is no routing engine in this build, so
 * "+3 MIN" would be a number the app made up about how long a detour takes -
 * on the one screen a person reads at speed. The sub-line says what the key
 * actually does until a route can be costed, and the label is already the
 * design's.
 *
 * =============================================================================
 * THE KEY NOW DOES WHAT IT SAYS, AND THE NOTE ABOVE IT IS SPENT
 * =============================================================================
 * This carried a second header saying `Route around it` could not be done -
 * that `navigateTo` opens the maps app AT a point and no URL takes an
 * avoid-this waypoint, so the key routed a driver INTO the camera it named.
 * That was true of a single-point `geo:` handoff and it was the honest thing
 * to write while that was all there was.
 *
 * It is not what the key does now. `packages/core/src/avoidance.ts` plans a
 * detour as an ordered list of points to travel VIA, each pushed a clearance
 * off the far side of the cameras beside the route, and a maps link carries
 * those as intermediate stops. The count in this label is now the set the
 * planner is handed, so the word and the arithmetic are about the same
 * cameras.
 *
 * What has NOT changed is the honesty: a multi-stop handoff is an HTTPS
 * request to a maps service, which is a disclosure, and it is asked about
 * before it is made. The key raises `DetourOffer`; nothing leaves from here.
 * GAP: docs/gaps-inbox/alert-v1.md, the same gap on the alert takeover.
 */
export function driveRouteLabel(count: number): string {
  return `Route around all ${String(count)}`;
}

export const DRIVE_MUTE = 'Mute 10m';
export const DRIVE_UNMUTE = 'Unmute';
/* Said only while a live mute is being overridden. Names the rule rather than
   apologising, because the driver's next question is "then what is mute for". */
export const DRIVE_MUTE_PIERCED =
  'MUTED · STILL ALERTING BECAUSE THIS ONE IS INSIDE YOUR RE-ALERT DISTANCE';
export const DRIVE_AHEAD = 'AHEAD';
export const DRIVE_CARD_MINI = 'Shrink this card';
export const DRIVE_CARD_EXPAND = 'Show the whole card';
/* The picture's own name. The text beside it goes to the same place, so this
   says what was PRESSED rather than repeating the destination - two controls
   announcing "Open this camera" reads as two different cameras. */
export const DRIVE_MAP_OPEN = 'Open this camera from the map picture';
export const DRIVE_THEN = 'THEN';
export const DRIVE_LESS = 'Less';

/**
 * THE CARD'S OWN ROW ABOUT WHAT THE MAP IS DRAWING.
 *
 * =============================================================================
 * WHY THE DISCLOSURE HAS TO BE HERE AND NOT ONLY IN THE PANEL
 * =============================================================================
 * The panel carries the display-only sentence permanently, which is right, but
 * choosing an owner class SHUTS the panel - so at the exact moment the map
 * starts hiding cameras, the sentence explaining it leaves the screen. What was
 * left was the rail key's accessible name and its scan hue, both on one 48px
 * key that a driver has no reason to look at again.
 *
 * The card is the surface a driver is already reading, because it is the
 * warning. So the state of the drawing filter is named here, and whenever a
 * class is selected the row also says, in words, that the hiding is a picture:
 * every camera is still being watched. A filter that narrows the map without
 * saying so on the screen the driver is looking at is a claim the app has not
 * made out loud.
 *
 * =============================================================================
 * A CONTROL THAT OPENS THE PANEL, NOT A SECOND CHIP STRIP
 * =============================================================================
 * A row of owner chips in this card would sit about 40px under
 * `chipLabel(nearestRecord?.ownerType, nearestRecord)` in the card's head, and
 * for a police camera both would read POLICE / AGENCY while meaning
 * categorically different things: one is a fact about THIS CAMERA, the other a
 * setting about the PICTURE. Identical words, adjacent, different meaning, read
 * at speed - a designed-in misreading. One opener means one panel, one place
 * the filter is explained, and no second implementation to drift.
 *
 * =============================================================================
 * NOTHING IN THIS ROW TOUCHES A FIGURE
 * =============================================================================
 * It reads `mapOwnerFilter` and writes only `mapPanelOpen`. The distance, the
 * chip, `driveRouteLabel`'s count, the ETA, the queue and the proximity band
 * all derive from the ASSESSMENTS, which are measured over every camera and
 * never see this value. `DriveScreen.ownerFilter.test.tsx` asserts exactly
 * that, by rendering the card twice around a filter that hides its own nearest
 * camera.
 */
export const DRIVE_DRAWS = 'MAP DRAWS';

/** `null` - every camera, including the ones whose owner nobody recorded. */
export const DRIVE_DRAWS_ALL = 'all owners';

/**
 * SAID ON THE CARD WHENEVER A CLASS IS HIDDEN, and only then.
 *
 * Unlike the panel's permanent sentence this one is conditional, because the
 * row's own value already reads `all owners` in the default case and there is
 * nothing yet to disown. The moment there is, the sentence appears under it.
 *
 * It does not name the class: the value beside it already does, and printing
 * `POLICE / AGENCY` twice in one row is the misreading described above.
 *
 * `driveDrawingOnly` below says the same thing on the rail key's accessible
 * name, in different words, because that key has no visible text and must name
 * the class itself. THE TWO ARE ONE CLAIM. If either is ever reworded, reword
 * both, and do not let one of them start promising something the other does
 * not: the app is still watching, still measuring and still warning about every
 * camera in the archive, whatever the map has been narrowed to.
 */
export const DRIVE_DRAWS_STILL = 'drawing only. every camera is still being watched.';

/** The two round keys on the right rail. */
export const DRIVE_RECENTER = 'Recentre on me';
export const DRIVE_MISUSE = 'Misuse';
/**
 * The rail key that opens the map panel.
 *
 * It said `Map view` while it cycled the cartography and did nothing else. The
 * key now opens a panel that answers two questions - which cameras are drawn,
 * and what they are drawn on - and the accessible name is built from this plus
 * the current state of both. See the `aria-label` on the key itself.
 */
export const DRIVE_LAYERS = 'Map';

/**
 * SAID ON THE KEY ITSELF WHENEVER A DRAWING FILTER IS ON.
 *
 * The panel says it too, permanently, but the panel is shut most of the time -
 * choosing an owner class closes it. A screen reader driving past a hidden
 * camera class must be able to hear, from the control, that the hiding is a
 * picture and not a change to what the app is watching.
 */
export function driveDrawingOnly(owner: CameraOwnerType): string {
  return `drawing ${OWNER_LABELS[owner]} only, plus the two closest. all cameras still alerting.`;
}
export const DRIVE_TILT = 'Map angle';
export const DRIVE_SETTINGS = 'Settings';

/**
 * Said when there is no fix.
 *
 * The design has no such state. Without it the screen would show a map centred
 * on nothing with an em dash where the distance goes, which reads as broken
 * rather than as waiting.
 */
export const DRIVE_NO_FIX =
  'no position yet. the map and the distances need a gps fix; everything else on this screen is ' +
  'already loaded.';

/** Said when a fix exists and there is genuinely nothing near. */
export const DRIVE_CLEAR = 'nothing within range. the radius is yours to change in settings.';


const FT_PER_MILE = 5280;

/** How much of the road ahead is worth listing. Beyond this it is a scroll. */
const MAX_QUEUE = 8;

/** Miles, to one decimal, or the em dash. Feet are too fine to read at speed. */
export function miles(distanceFt: number | null): string {
  if (distanceFt === null || !Number.isFinite(distanceFt)) return NO_VALUE;
  return (distanceFt / FT_PER_MILE).toFixed(1);
}

/**
 * HOW CLOSE, AS A BAND.
 *
 * The engine's own alert state is three values and two of them mean "not yet",
 * so anything hued by it alone said nothing about distance until the moment it
 * became a warning. These are bands against the driver's OWN threshold, so the
 * colour means the same thing whatever radius they set:
 *
 *   in-range     inside the radius. this is the warning, and it is RED.
 *   closing      within half again. the top of the ramp: yellow.
 *   approaching  within twice it.
 *   near         within five times it.
 *   far          beyond that - a reading, not an absence.
 *
 * `none` is the only one that is not a distance: nothing to measure.
 *
 * FIVE, NOT FOUR, AND THE FIFTH IS NOT PADDING. The colours are plasma stops
 * (see `--fwm-plasma-*`), and with four bands the ramp jumped magenta straight
 * to yellow - skipping the orange between them, which is the widest perceptual
 * step in the whole colormap and exactly the one a driver reads while deciding.
 * `closing` is that step, and it sits where it is most useful: the last stretch
 * before the threshold, which is the only part of the approach anybody watches.
 */
export type ProximityBand = 'in-range' | 'closing' | 'approaching' | 'near' | 'far' | 'none';

export function proximityBand(distanceFt: number | null, thresholdFt: number): ProximityBand {
  if (distanceFt === null || !Number.isFinite(distanceFt) || thresholdFt <= 0) return 'none';
  if (distanceFt <= thresholdFt) return 'in-range';
  if (distanceFt <= thresholdFt * 1.5) return 'closing';
  if (distanceFt <= thresholdFt * 2) return 'approaching';
  if (distanceFt <= thresholdFt * 5) return 'near';
  return 'far';
}

/**
 * `132k`, `987`, or the em dash.
 *
 * The design writes `132k` beside WATCHING, and what it is counting is the
 * ARCHIVE on the phone - not the cameras currently in range, which is what the
 * first version of this file put there and is a completely different number
 * (usually 0). A driver reading `Watching 0` while the app is working is being
 * told the product is off.
 */
export function watchingCount(cached: number | null): string {
  if (cached === null) return NO_VALUE;
  if (cached < 1000) return String(cached);
  return `${String(Math.round(cached / 1000))}k`;
}

/**
 * `987 / 132k` - what this phone holds, out of what exists.
 *
 * The cached figure ALONE is unreadable: it could mean the network knows about
 * 987 cameras, or that this phone holds 987 of a much larger set, and those are
 * very different claims. Both numbers together say which, and are also the only
 * place the sync is visible at all. RADAR's header has made the same pairing
 * for the same reason since before this screen existed.
 */
export function watchingPair(cached: number | null, total: number | null): string {
  const held = watchingCount(cached);
  if (total === null) return held;
  return `${held} / ${watchingCount(total)}`;
}

export function DriveScreen(): ReactElement {
  const fix = useCurrentFix();
  const headingDeg = useHeadingDeg();
  const speedMph = useSpeedMph();
  const assessments = useCameraAssessments();
  const nearest = useNearestCamera();
  const cached = useCachedCameraCount();
  const closing = useIsClosing();
  const clusterCameras = useSettingsStore((s) => s.clusterCameras);
  const headingUpMap = useSettingsStore((s) => s.headingUpMap);
  const thresholdFt = useSettingsStore((s) => s.thresholdFt);
  const nearestMuted = useIsCameraMuted(nearest?.id ?? '');
  /*
   * WHY THE MUTE DID NOT WORK, which is the thing the driver actually needs.
   *
   * A mute is deliberately PIERCED inside `reAlertWhenCloserThanFt` - the
   * design's "RE-ALERT ON MUTED IF closer than 150 ft", on the grounds that a
   * mute is a request for less noise and not a request to be driven past a
   * camera in silence. The engine says so through `mutePierced` and the design
   * says the screen should "explain why it just buzzed".
   *
   * This screen never rendered it. So the driver hits Mute, the mute IS
   * applied, the alert keeps firing because they are already inside the
   * re-alert distance, and nothing on screen accounts for it. From the seat
   * that reads as a broken button, which is exactly how it was reported.
   */
  const mutePierced = useMutePierced();

  /**
   * FOCUS MODE. Transient by design: it is a thing somebody turns on for a
   * stretch of road, not a preference they hold, so it does not persist and
   * does not belong in settings.
   */
  /**
   * WHAT THE MAP IS TOLD, as opposed to what the GPS said.
   *
   * A parked phone reports a cloud of positions and a heading computed from
   * inside that cloud - a random number. Fed straight to the map, the first
   * slid the whole world back and forth every tick and the second spun the
   * vehicle arrow. See `steady.ts`.
   *
   * The CARDS still read the raw fix: a distance that only updates every 12 m
   * would be wrong most of the time, and the numbers are the product.
   */
  const mapFix = useSteadyFix(fix);
  const mapHeading = useSteadyHeading(headingDeg, speedMph);


  /**
   * THE IN-CARD QUEUE, open or shut.
   *
   * Shut by default: THEN is three dots and a count, and the full list is one
   * tap away for somebody who wants it.
   */
  const [queueOpen, setQueueOpen] = useState(false);
  /*
   * FULL BY DEFAULT, and it stays that way for the session rather than being
   * remembered. A driver who shrank the card yesterday on a quiet road should
   * not have it start small on a road with nine cameras on it - the default is
   * the safe one, so the default is what a new drive gets.
   */
  /*
   * OPENS COLLAPSED, by owner decision. The card is the biggest thing on the
   * screen and it sits on the map a driver is trying to read ahead on, so the
   * glanceable form is the one to land in; expanding is one tap and the state
   * is remembered for the session.
   */
  const [cardMini, setCardMini] = useState(true);

  /**
   * THE FULLSCREEN KEY.
   *
   * =========================================================================
   * IT USED TO BE "FOCUS MODE", AND THAT WAS THE WRONG SHAPE
   * =========================================================================
   * Focus hid every control and drew its own big-distance readout - a second
   * screen you had to leave to do anything. The only part anybody wanted was
   * the side effect: it took the whole panel, because a real `requestFullscreen`
   * inside an `onClick` is the one path every engine honours.
   *
   * So the mode is gone and the side effect is the whole feature. Press it and
   * the APP goes fullscreen - dock, cards, rail and all, exactly as they are.
   * Press it again and the status bar comes back.
   *
   * A settings switch was tried for this and did not work on a real device
   * while this key always did. Rather than keep debugging a second control
   * that was doing the same job worse, there is now one control, and it is the
   * one that was already working.
   */
  const [full, setFull] = useState(false);


  useEffect(() => {
    const sync = (): void => {
      setFull(globalThis.document?.fullscreenElement != null);
    };
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
    };
  }, []);

  const toggleFull = useCallback(() => {
    // SYNCHRONOUS, inside the click. Awaiting anything first spends the tap's
    // transient activation and the request is refused.
    if (globalThis.document?.fullscreenElement == null) enterImmersive();
    else exitImmersive();
  }, []);

  /** True once the driver has dragged the map away from themselves. */
  const [panned, setPanned] = useState(false);
  const recentre = useCallback(() => {
    setPanned(false);
  }, []);

  /**
   * WHICH CARTOGRAPHY THE MAP IS DRAWN ON. Six flavours ship in the bundle and
   * two were reachable; which one reads best depends on the light you are
   * driving in, which is a thing that changes during a drive. All six are named
   * in the map panel now, each with the reason it exists.
   */
  const mapView = useMapView();

  /**
   * WHICH OWNER CLASS THE MAP DRAWS, or null for all of them.
   *
   * Read here and used at exactly one place - the `drawn` memo that feeds
   * MapCanvas. It is deliberately NOT persisted (see `stores/settings.ts`), so
   * every session opens showing every camera; a display filter that survived a
   * cold start would hide readers from a driver who had forgotten asking.
   *
   * This is not `ownerTypesEnabled`. That one governs ALERTING and is the
   * driver's rule about what is worth warning about. This one governs pixels.
   */
  const mapOwnerFilter = useMapOwnerFilter();

  /**
   * THE MAP PANEL, open or shut.
   *
   * Local and transient, like the card's own size toggle: it is a thing somebody
   * opens for a moment, not a preference they hold. It is deliberately NOT an
   * overlay - see the header of `MapControlPanel.tsx` for why a control that an
   * alert takeover would re-raise over the road is the wrong shape for this.
   */
  const [mapPanelOpen, setMapPanelOpen] = useState(false);
  /**
   * The rail key, so the panel can hand focus back when it shuts.
   *
   * Without it, every close dropped focus to `<body>`: the rows shut the panel
   * from inside their own click handler and the container takes `inert` in the
   * same commit, so the button holding focus stopped being focusable. Escape
   * did the same. See `MapControlPanel`'s `closeAndRestore`.
   */
  const mapPanelKeyRef = useRef<HTMLButtonElement | null>(null);
  const toggleMapPanel = useCallback(() => {
    setMapPanelOpen((was) => !was);
  }, []);
  const closeMapPanel = useCallback(() => {
    setMapPanelOpen(false);
  }, []);

  /**
   * TILT THE MAP ALONG THE ROAD, or lay it flat again.
   *
   * Top-down answers "how many are around me"; tilted answers "what is coming",
   * which is the question this app exists for. Both are one press away and the
   * angle is remembered, because it is a way of reading a map rather than a
   * momentary view. See `app/mapTilt.ts` for why the pitch GESTURE stays off.
   */
  const mapTilt = useMapTilt();
  const toggleTilt = useCallback(() => {
    useSettingsStore.getState().setMapTilt(nextMapTilt(useSettingsStore.getState().mapTilt));
  }, []);

  /**
   * THE POSTED LIMIT of the road underneath, or null. Read off the speeds
   * archive at the vehicle's own position, exactly as RADAR reads it, so the
   * two screens cannot print different limits for the same road.
   *
   * Expect a DASH on most side streets: OSM carries `maxspeed` on roughly 95%
   * of freeway miles and 10% of residential ones, and `speedLimit.ts` prints
   * nothing rather than a guess.
   */
  const [maxspeed, setMaxspeed] = useState<string | null>(null);
  useEffect(() => {
    if (fix === null) {
      setMaxspeed(null);
      return undefined;
    }
    let cancelled = false;
    void waysNear(fix.lon, fix.lat).then((ways) => {
      if (cancelled) return;
      setMaxspeed(speedAt(ways, fix.lon, fix.lat, headingDeg)?.maxspeed ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [fix, headingDeg]);

  const plate = speedPlateState(speedMph, maxspeed);

  /**
   * Street names and owner class live on the camera RECORD, not on the
   * assessment: an assessment is geometry (distance, bearing, in range) and
   * deliberately carries no naming.
   */
  const records = useCamerasStore((s) => s.cameras);
  const recordOf = useCallback(
    (id: string | undefined) => (id === undefined ? null : (records.find((r) => r.id === id) ?? null)),
    [records],
  );

  const nameOf = useCallback(
    (id: string | undefined): string => {
      const record = recordOf(id);
      if (record === null) return 'unnamed road';
      if (record.street === undefined) return 'unnamed road';
      return record.cross === undefined ? record.street : `${record.street} at ${record.cross}`;
    },
    [recordOf],
  );

  /**
   * THE RECORDS, NOT THE ASSESSMENTS.
   *
   * This mapped the engine's per-tick assessments into map features, and the
   * two do not carry the same facts. `toFeatureCollection` reads `ownerType`,
   * `street`, `cross` and `tags`; an assessment has none of them, so every dot
   * on DRIVE fell through the owner-type colour rule to the same scan hue --
   * police, HOA, private and inter-agency were one indistinguishable colour --
   * and not one `osm:` tag property was ever emitted, which is the whole point
   * of flattening the tags verbatim.
   *
   * The two fields it DID pass, `inRange` and `muted`, are not read by the map
   * at all. So the memo recomputed a whole feature array on every engine tick
   * to deliver two values nothing wanted and drop four that everything did.
   *
   * RADAR has always passed the records. Now both screens draw the same map
   * from the same source, and the array only changes when a tile is written.
   */
  const cameras = useCachedCameras();

  /**
   * WHICH OF THEM THE MAP DRAWS - a display choice, and only a display choice.
   *
   * `mapOwnerFilter` is the driver's answer to "show me who owns what". It is
   * applied HERE, at the one call site that feeds the map, and nowhere else.
   * `cameras` above stays whole for the record lookups, the WATCHING count and
   * everything Look up asks of the same store, and the engine reads the cameras
   * store directly and never sees this value at all.
   *
   * Filtering inside `useCachedCameras()` instead would be the defect this
   * feature was written to avoid: a driver who narrowed the map to police and
   * forgot would drive past an unwarned HOA reader, and the app would look like
   * it was working. `visibleCameras` returns the same array reference when the
   * filter is null, so the default case allocates nothing and MapCanvas's
   * identity-keyed data effect does not re-push the archive every render.
   */
  const drawn = useMemo(() => visibleCameras(cameras, mapOwnerFilter), [cameras, mapOwnerFilter]);

  /**
   * THE TWO NEAREST GET THEIR DISTANCE PRINTED ON THE MAP.
   *
   * The design labels two dots and leaves the rest plain, and two is the right
   * number: a distance beside every dot is a wall of digits over the road, and
   * the answer a driver wants off the map is "how far is the next one".
   *
   * The state words are the alert engine's own, so a dot on the map and the
   * card below it are the same colour for the same reason.
   *
   * DO NOT FILTER THIS BY `mapOwnerFilter`, however tidy it would look beside
   * `drawn`. These two markers are built from the ASSESSMENTS - they are the
   * cameras the app is currently warning about - and they keep their dot and
   * their distance on the map even when their owner class is hidden. That is
   * not a leak in the filter, it is the safety property made visible: the
   * picture can be narrowed, the warning cannot.
   */
  const labelled = useMemo(
    () =>
      assessments.slice(0, 2).map((a) => ({
        id: a.id,
        lat: a.lat,
        lon: a.lon,
        label: miles(a.distanceFt),
        state: a.muted ? ('clear' as const) : a.inRange ? ('in-range' as const) : ('approaching' as const),
      })),
    [assessments],
  );

  /**
   * Everything after the nearest, which the big card already shows.
   *
   * THE ASSESSMENTS, kept as assessments. `ahead` below is the display shape
   * and drops the coordinates; the detour planner needs them, and re-deriving
   * the same filter and slice a second time is how the key's count and the
   * planner's camera set would eventually come to mean different things.
   */
  const queue = useMemo(
    () => assessments.filter((a) => a.id !== nearest?.id).slice(0, MAX_QUEUE),
    [assessments, nearest],
  );

  const ahead = useMemo(
    () =>
      queue.map((a) => ({
        id: a.id,
        miles: miles(a.distanceFt),
        label: nameOf(a.id),
        // The SAME ladder the closest card's border uses, so a tile and the
        // card above it cannot disagree about how close something is.
        band: proximityBand(a.distanceFt, thresholdFt),
        muted: a.muted,
      })),
    [queue, nameOf, thresholdFt],
  );

  const eta = describeEta(
    etaSeconds({ distanceFt: nearest?.distanceFt ?? null, speedMph, closing }),
  );

  /**
   * THE CARD'S HUE IS THE ENGINE'S STATE, not `inRange` alone.
   *
   * It was amber whenever the closest camera was outside the alert radius,
   * which is almost always - a camera 1.5 miles away is not "approaching", it
   * is simply the nearest one, and painting the whole card amber for it made
   * the colour mean nothing. `useAlertState` is the same value the takeover,
   * the log and the intel card use, so all four agree about one camera.
   */
  const alertState = useAlertState();

  /**
   * HOW CLOSE, AS A BAND - which is what the card's border is coloured by.
   *
   * The engine's own state is three values and two of them mean "not yet", so
   * a card hued by it alone was the theme accent almost always and said nothing
   * about distance. This is the same three hues over four bands, keyed off the
   * driver's OWN threshold rather than a fixed mileage, so the colour means the
   * same thing whatever radius they set:
   *
   *   inside the radius        the alert hue. this is the warning.
   *   within twice it          approaching.
   *   within five times it     the theme's accent - near, not a warning.
   *   further, or unknown      the quiet line. there is nothing to say.
   */
  const proximity = proximityBand(nearest?.distanceFt ?? null, thresholdFt);

  const nearestRecord = recordOf(nearest?.id);

  /**
   * The chip. The owner when somebody has attributed it, the MAKER when nobody
   * has - "FLOCK SAFETY" answers "what is that" and "UNVERIFIED" does not, and
   * the border hue already says how sure the app is.
   */
  const chip = chipLabel(nearestRecord?.ownerType, nearestRecord);

  /**
   * WHICH WAY THE LENS LOOKS, for the picture on the card.
   *
   * Built exactly the way `intelState` builds the card's own - the record's
   * `direction` tags first, its derived `directionDeg` only as a fallback - so
   * the cone on this card and the cone on the card a tap opens are the same
   * claim about the same camera. Two computations of a facing is how they end
   * up disagreeing.
   *
   * Empty for most records, which draws no cone at all. That is the honest
   * answer: OSM's ALPR nodes usually carry no direction, and a default cone
   * would invent a coverage nobody recorded.
   */
  const nearestFacings = facingSpans(
    coveredDirections(nearestRecord ?? null),
    nearestRecord?.directionDeg ?? nearest?.directionDeg ?? null,
  );

  /** Where it is mounted, when the record says. Most do not. */
  const mount = mountPhrase(nearestRecord);

  /**
   * "faces north", or nothing.
   *
   * `directionDeg` is absent on most records and is never coerced: a camera
   * whose facing is unknown says nothing about it rather than claiming north.
   */
  const faces =
    nearest?.directionDeg === null || nearest?.directionDeg === undefined
      ? null
      : `faces ${facingCardinal(nearest.directionDeg).toLowerCase()}`;

  /**
   * The line under the figure: where it is, which way it looks, and what it is
   * bolted to. Each part is dropped when the record does not carry it rather
   * than printed as a blank.
   */
  /*
   * JUST THE ADDRESS, for the kicker. `where` below is this plus the facing and
   * the mount; the kicker wants only the part that answers "which junction is
   * this", because it has one line and it is drawn in the collapsed card too.
   *
   * `at` BECOMES `@`, which is not pedantry. The kicker already joins with an
   * `@` ("AHEAD @ ..."), so a camera that has a cross street would otherwise
   * read "AHEAD @ METCALF AVE at W 111TH ST" - two different words for the same
   * relation in one seven-word line. `nameOf` keeps `at` because the expanded
   * street line is a sentence and reads better with it.
   */
  const placeName =
    nearest === null ? null : nameOf(nearest.id).replace(KICKER_JOIN_RE, ' @ ');

  const where =
    nearest === null
      ? null
      : [nameOf(nearest.id), faces, mount]
          .filter((part): part is string => typeof part === 'string' && part !== '')
          .join(', ');

  const openIntel = useCallback(() => {
    if (nearest !== null) openIntelCard(nearest.id);
  }, [nearest]);

  /**
   * WHAT THE KEY WOULD ROUTE AROUND: the camera in the figure, plus the queue.
   *
   * The exact set `driveRouteLabel` counts. `1 + ahead.length` is this array's
   * length by construction, so the key cannot say "all 6" and hand the planner
   * five cameras.
   */
  const routeCameras = useMemo(
    () => (nearest === null ? [] : [nearest, ...queue]),
    [nearest, queue],
  );

  /**
   * ROUTE AROUND THEM. Plans on the device, then ASKS.
   *
   * =========================================================================
   * NOTHING IS SENT FROM HERE
   * =========================================================================
   * This key used to call `navigateTo` with the NEAREST CAMERA's position -
   * turn-by-turn directions to the thing the label promised to avoid. It now
   * plans a detour and raises `DetourOffer`, which is the only surface in the
   * app that can hand a route to a maps service and does so only after an
   * explicit yes. A refusal, an Escape or a close leaves nothing sent.
   *
   * THE RAW FIX AND THE STEADY HEADING, which is not an inconsistency. The
   * position wants to be as current as it is - the plan is thrown away in
   * seconds - while the heading wants to be the one the car was last actually
   * travelling on, because a course computed inside a parked phone's error
   * cloud would aim the whole route somewhere arbitrary. See `steady.ts`.
   *
   * IT ALWAYS RAISES SOMETHING. `planDriveDetour` returns a reason rather than
   * a null precisely so this cannot become the key that looks pressable and
   * quietly does nothing - the failure `features/radar/reroute.ts` records.
   */
  const routeAround = useCallback(() => {
    offerDetour(planDriveDetour(fix, mapHeading, routeCameras));
  }, [fix, mapHeading, routeCameras]);

  const toggleMuteNearest = useCallback(() => {
    if (nearest === null) return;
    const now = Date.now();
    if (nearestMuted) alertActions.unmuteCamera(nearest.id, now);
    else alertActions.muteCamera(nearest.id, now);
  }, [nearest, nearestMuted]);


  return (
    <section className="fwm-drive" aria-label="drive">
      {/* THE MAP OWNS EVERY TOUCH IT IS NOT COVERED BY. Nothing in this file
          spans it - see the header. */}
      <div className="fwm-drive-map">
        {mapEnabled() ? (
          <MapCanvas
            lat={mapFix?.lat ?? null}
            lon={mapFix?.lon ?? null}
            bearingDeg={mapHeading}
            cameras={drawn.length > 0 ? drawn : NO_CAMERAS}
            cluster={clusterCameras}
            mapView={mapView}
            pitchDeg={MAP_TILT_DEG[mapTilt]}
            labelled={labelled}
            headingUp={headingUpMap}
            thresholdFt={thresholdFt}
            panned={panned}
            onUserMoved={() => {
              // ANY gesture pins the view, zoom included - MapCanvas fires this
              // from `zoomstart` as well as `dragstart`. Without it the next
              // GPS tick eases the map back to the vehicle and the pinch is
              // undone a second after it was made.
              setPanned(true);
            }}
            onZoomChanged={() => {
              setPanned(true);
            }}
            onSelectCamera={(id) => {
              openIntelCard(id);
            }}
          />
        ) : null}
      </div>

      {(
        <>
          {/* --- the top bar ------------------------------------------------ */}
          {/* THE STATUS PILL, and the gear opposite it. Nothing else lives up
              here: the row was four controls wide and the two most useful ones
              could not be reached with a thumb on the hand holding the wheel. */}
          <div className="fwm-drive-top">
            <div className="fwm-drive-pill">
              <span className="fwm-drive-live" aria-hidden="true" />
              {/* THE WORDMARK, AND IT RELOADS - the shared control now.
                  The name reads on a first launch where a mark does not, and it
                  keeps the mark's shadow treatment - see `.fwm-drive-mark`,
                  which `ReloadTitle` puts on the `<h1>` - because the thing
                  under it is still a basemap that changes colour.

                  This screen's hand-rolled `<button>` is gone. It was the same
                  button thirteen other pages needed and did not have, so it
                  moved to `components/nav/ReloadTitle.tsx` and DRIVE renders
                  that: same chrome reset, same accessible name, and the
                  keyboard reachability and 44px target now come from one file
                  rather than from this one.

                  It is a HEADING now as well, which it was not before. DRIVE
                  had no `h1` at all - the app's first screen was the one with
                  no top for a heading-navigation user to find. */}
              <ReloadTitle title={DRIVE_WORDMARK} className="fwm-drive-mark" asMark />
              <span className="fwm-drive-pill-count fwm-data">
                {watchingPair(cached, catalogue.total())}
              </span>
              {/* The accessible name, now that the word is a picture. */}
              <span className="fwm-drive-pill-word">{DRIVE_WATCHING}</span>
            </div>

            <span className="fwm-drive-spacer" />

            <button
              type="button"
              className="fwm-drive-round"
              aria-label={DRIVE_SETTINGS}
              onClick={() => {
                openScreen('settings');
              }}
            >
              <svg
                className="fwm-drive-glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {/* A GEAR. It was a sun - the design's `⚙` rendered as a
                    glyph this icon set does not have - and nobody reads a sun
                    as settings. */}
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19.1 14.4a1.5 1.5 0 0 0 .3 1.6l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-1.6-.3 1.5 1.5 0 0 0-.9 1.4v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.6.3l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0 .3-1.6 1.5 1.5 0 0 0-1.4-.9h-.2a1.8 1.8 0 1 1 0-3.6h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 1.6.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.6-.3l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0-.3 1.6v.1a1.5 1.5 0 0 0 1.4.9h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9Z" />
              </svg>
            </button>
          </div>

          {/* THE SPEED PLATE, UNDER THE WORDMARK.
              It was the first child of `.fwm-drive-cards` at the BOTTOM of the
              screen, above the closest card. Moved up here by owner decision:
              the posted limit and your speed are a heads-up reading, and the
              bottom of the screen is where the card that grows lives.

              Pinned rather than in the top row, because the row is a flex line
              and the plate is a second line under it. `.fwm-drive-rail` already
              does exactly this on the right - same offset arithmetic, mirrored
              to `left` - so the plate sits under the wordmark as the rail sits
              under the gear. */}
          <div className="fwm-drive-speed" data-fwm-drive-over={String(plate.over)}>
            <span className="fwm-drive-speed-now">{plate.speedLabel}</span>
            {/* TWO LINES, the design's own shape: the figure is the thing you
                glance at and the labels stack beside it rather than pushing it
                along a row. */}
            <span className="fwm-drive-speed-unit fwm-data">
              MPH
              <br />
              {plate.limitLabel} LIMIT
            </span>
          </div>

          {/* --- the right rail --------------------------------------------- */}
          {/* FOCUS JOINS THE RAIL, same 48px circle as the compass. It is a map
              control - it changes what the map shows - and it belongs with the
              other two rather than in a row of destinations. */}
          <div className="fwm-drive-rail">
            {/* THE RECORD. It was a labelled chip in a row of its own, which is
                a whole band of screen for one destination - and the rail is
                where the map's own controls already live. */}
            <button
              type="button"
              className="fwm-drive-round"
              aria-label={DRIVE_MISUSE}
              onClick={() => {
                openScreen('misuse');
              }}
            >
              <svg
                className="fwm-drive-glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5.5 5.5h9.4a1.6 1.6 0 0 1 1.6 1.6v10.3a1.6 1.6 0 0 0 1.6 1.6H6.6A1.1 1.1 0 0 1 5.5 17.9Z" />
                <path d="M16.5 9.6h1.4a1.6 1.6 0 0 1 1.6 1.6v6.2a1.6 1.6 0 0 1-1.6 1.6" />
                <path d="M8.2 8.8h5.4M8.2 12h5.4M8.2 15.2h3.2" />
              </svg>
            </button>

            <button
              type="button"
              className="fwm-drive-round"
              data-fwm-drive-on={String(full)}
              aria-pressed={full}
              aria-label={DRIVE_FULLSCREEN}
              onClick={toggleFull}
            >
              <svg
                className="fwm-drive-glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 8.6V6.1a1.6 1.6 0 0 1 1.6-1.6h2.5M15.4 4.5h2.5A1.6 1.6 0 0 1 19.5 6.1v2.5M19.5 15.4v2.5a1.6 1.6 0 0 1-1.6 1.6h-2.5M8.6 19.5H6.1a1.6 1.6 0 0 1-1.6-1.6v-2.5" />
              </svg>
            </button>

            <button
              type="button"
              className="fwm-drive-round"
              data-fwm-drive-on={String(panned)}
              aria-label={DRIVE_RECENTER}
              onClick={recentre}
            >
              <svg
                className="fwm-drive-glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="6.4" />
                <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6" strokeLinecap="round" />
              </svg>
            </button>

            {/* THE PANEL KEY. It used to advance the cartography by one, which
                is the right control for two states and the wrong one for six:
                reaching a named flavour cost up to five presses and the key
                showed no label while you did it.

                The accessible name carries BOTH things the panel governs, and
                when a drawing filter is on it also carries the fact that the
                filter is a picture - see `driveDrawingOnly`. The scan hue is on
                whenever anything non-default is in force, filter included. */}
            <button
              type="button"
              ref={mapPanelKeyRef}
              className="fwm-drive-round"
              data-fwm-drive-on={String(mapView !== 'auto' || mapOwnerFilter !== null)}
              aria-expanded={mapPanelOpen}
              aria-label={
                mapOwnerFilter === null
                  ? `${DRIVE_LAYERS}: ${MAP_VIEW_LABELS[mapView]}`
                  : `${DRIVE_LAYERS}: ${MAP_VIEW_LABELS[mapView]}, ${driveDrawingOnly(mapOwnerFilter)}`
              }
              onClick={toggleMapPanel}
            >
              <svg
                className="fwm-drive-glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m12 4 8 4.4-8 4.4-8-4.4L12 4Z" />
                <path d="m4.6 13.2 7.4 4 7.4-4" strokeLinecap="round" />
              </svg>
            </button>

            {/* THE ANGLE. A square seen flat on, and the same square seen in
                perspective - which is literally the difference the press
                makes, and needs no word. */}
            <button
              type="button"
              className="fwm-drive-round"
              data-fwm-drive-on={String(mapTilt !== 'flat')}
              aria-pressed={mapTilt !== 'flat'}
              aria-label={`${DRIVE_TILT}: ${MAP_TILT_LABELS[mapTilt]}`}
              onClick={toggleTilt}
            >
              <svg
                className="fwm-drive-glyph"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {mapTilt === 'flat' ? (
                  <>
                    <rect x="4.6" y="4.6" width="14.8" height="14.8" rx="1.6" />
                    <path d="M4.6 12h14.8M12 4.6v14.8" strokeWidth={1.1} />
                  </>
                ) : (
                  <>
                    <path d="M8.6 6.4h6.8l4 11.2H4.6Z" />
                    <path d="M6.6 13.2h10.8M11.1 6.4 9.6 17.6M12.9 6.4l1.5 11.2" strokeWidth={1.1} />
                  </>
                )}
              </svg>
            </button>
          </div>

          {/* SIBLING OF THE RAIL, not a child of it: the rail is a column of
              48px keys and this is a pane beside them. It is mounted whether or
              not it is open so the slide can animate both ways; `data-fwm-open`
              is what shows it. */}
          <MapControlPanel
            open={mapPanelOpen}
            onClose={closeMapPanel}
            returnFocusTo={mapPanelKeyRef}
          />
        </>
      )}

      {/* --- the cards ---------------------------------------------------- */}
      {(
        <div className="fwm-drive-cards">
          {nearest === null ? (
            <p className="fwm-drive-empty fwm-data">{fix === null ? DRIVE_NO_FIX : DRIVE_CLEAR}</p>
          ) : (
            <div
              className="fwm-drive-closest"
              data-fwm-state={alertState}
              data-fwm-near={proximity}
              data-fwm-card={cardMini ? 'mini' : 'full'}
            >
              {/* SHRINK, NOT DISMISS.
                  The card is the biggest thing on the screen and it sits on the
                  map a driver is trying to read ahead on. Collapsing keeps the
                  distance and the owner - the two facts that are the reason to
                  look at all - and drops the buttons, the queue and the street
                  line. There is no close: a card that can vanish is a camera
                  that can go unnoticed. */}
              <button
                type="button"
                className="fwm-drive-card-size"
                aria-expanded={!cardMini}
                aria-label={cardMini ? DRIVE_CARD_EXPAND : DRIVE_CARD_MINI}
                onClick={() => {
                  setCardMini(!cardMini);
                }}
              >
                <span aria-hidden="true">{cardMini ? '▴' : '▾'}</span>
              </button>

              {/* THE TEXT AND THE PICTURE, SIDE BY SIDE.
                  The map is a SIBLING of the opener rather than a child of it:
                  `MiniMap` renders a `<figure>` with a `<figcaption>`, and a
                  button may only contain phrasing content, so nesting it would
                  have made the card's primary control invalid HTML. It is not
                  a second tap target either - `.fwm-minimap` is
                  `pointer-events: none`, so a finger anywhere across this row
                  still lands on the opener underneath. */}
              <div className="fwm-drive-closest-body">
                <button type="button" className="fwm-drive-closest-open" onClick={openIntel}>
                  <span className="fwm-drive-closest-head">
                    {/* THE ADDRESS IS IN THE KICKER, not only in the street line.
                      The street line (`.fwm-drive-closest-where`) is hidden by
                      the collapse - deliberately, it is the longest text in the
                      card - and the card now OPENS collapsed, so the one fact a
                      driver most needs to match what they are seeing out of the
                      window was the fact the default view dropped.

                      `nameOf` alone rather than `where`: `where` appends the
                      facing and the mount ("faces se, on traffic signals"),
                      which is detail for the expanded card and would push a
                      one-line kicker to three. */}
                    <span className="fwm-drive-closest-kicker fwm-data">
                      {DRIVE_CLOSEST}
                      {placeName === null ? '' : ` @ ${placeName}`}
                    </span>
                  </span>

                  <span className="fwm-drive-closest-row">
                    <span className="fwm-drive-closest-figure">{miles(nearest.distanceFt)}</span>
                    <span className="fwm-drive-closest-meta">
                      <span className="fwm-drive-closest-unit">
                        MILES{eta === null ? '' : ` · ${eta}`}
                      </span>
                      <span className="fwm-drive-closest-where">{where}</span>
                    </span>
                    {/* THE CHIP SITS WITH THE DISTANCE NOW, not above it.
                        It used to share the kicker's line, which put it in the
                        corner the picture now occupies and made the two facts
                        the card is FOR - how far, and what it is - read as
                        header and body rather than as one statement. Baseline
                        with the unit, because "1.5 MILES / FLOCK SAFETY" is
                        the sentence.

                        NO CHIP when the record carries no owner class. An
                        unattributed camera must not be labelled POLICE. */}
                    {chip === null ? null : (
                      <span className="fwm-drive-closest-owner fwm-data">{chip}</span>
                    )}
                  </span>
                </button>

                {/* WHERE IT IS, AS A PICTURE, on the card that says how far.
                    Same component and same facing arithmetic as the card a tap
                    opens, so the cone here and the cone there cannot disagree.
                    Kept in BOTH states: the collapsed card is the default view
                    now, and a driver who never expands it would otherwise never
                    see the one thing that turns a distance into a place. */}
                <div className="fwm-drive-closest-map">
                  {/* `credited`: the scope underneath this card draws MapLibre's
                      own attribution control, so the ODbL credit is already on
                      this screen. The caption would have been the same screen
                      saying it twice. The dead-zone note it also carries is
                      kept - see `GROUND_NOTE_CREDITED`. */}
                  <MiniMap
                    lat={nearest.lat}
                    lon={nearest.lon}
                    facings={nearestFacings}
                    credited
                  />
                  {/* THE PICTURE IS A TARGET, because it looks like one.
                      `MiniMap` is `pointer-events: none` so that a map inside a
                      scrolling card cannot eat a drag - which also meant a tap
                      on the most map-looking thing on the card fell through to
                      the card's background and did nothing. A thing that looks
                      pressable and is not is worse than no affordance at all.

                      A REAL BUTTON over the figure rather than a handler on the
                      div: this is the same destination as the text beside it,
                      so it must be reachable by keyboard and announce itself,
                      and it cannot be nested INSIDE the opener because a button
                      may not contain a button. Its own label, not the opener's -
                      a screen reader landing on two identically-named controls
                      has been told the card has two destinations. */}
                  <button
                    type="button"
                    className="fwm-drive-closest-maplink"
                    aria-label={DRIVE_MAP_OPEN}
                    onClick={openIntel}
                  />
                </div>
              </div>

              <div className="fwm-drive-closest-keys" hidden={cardMini}>
                {/* THE DESIGN'S TWO-LINE PRIMARY: a label and the consequence
                    under it. See `driveRouteLabel` for why the count is real
                    and the cost line is not a made-up "+3 MIN". */}
                {/* DRAWN ON EVERY PLATFORM. It used to be withheld on iOS,
                    because iOS does not register `geo:` and the fallback would
                    have been an unannounced HTTPS request. The handoff behind
                    this key is an HTTPS request everywhere now and is
                    announced everywhere, so there is nothing left for a
                    platform check to protect - only an iPhone driver to
                    withhold the feature from. See `routeVia.ts`. */}
                <button
                  type="button"
                  className="fwm-drive-key"
                  data-fwm-key="primary"
                  onClick={routeAround}
                >
                  {/* NO SUB-LINE. It read "ASKS FIRST, THEN YOUR MAPS APP",
                      which was the honest warning while pressing this key went
                      straight to a handoff. `DetourOffer` is that warning now -
                      a sheet that states what is sent and to whom and takes a
                      yes or a no - so the line under the label was the app
                      saying twice what it now says properly once, in the place
                      where the driver can actually act on it. */}
                  <span className="fwm-drive-key-label">{driveRouteLabel(1 + ahead.length)}</span>
                </button>
                <button
                  type="button"
                  className="fwm-drive-key"
                  data-fwm-pierced={String(nearestMuted && mutePierced)}
                  onClick={toggleMuteNearest}
                >
                  {nearestMuted ? DRIVE_UNMUTE : DRIVE_MUTE}
                </button>
              </div>

              {/* THE ONE LINE THAT MAKES THE BUTTON MAKE SENSE. Only drawn when
                  the mute is live AND being overridden, so it is never noise:
                  if it is on screen, something the driver did is not taking
                  effect and this says why. */}
              {nearestMuted && mutePierced ? (
                <p className="fwm-drive-pierced fwm-data">{DRIVE_MUTE_PIERCED}</p>
              ) : null}

              {/* WHAT THE MAP IS DRAWING, on the surface being read anyway.
                  Dropped with the rest of the controls in the mini state, which
                  keeps only the distance and the owner. See `DRIVE_DRAWS` for
                  why the disclosure cannot live in the panel alone, and why
                  this is one opener rather than a strip of owner chips beside
                  a chip that means something else. */}
              {cardMini ? null : (
                <button
                  type="button"
                  className="fwm-drive-draws"
                  data-fwm-drive-on={String(mapOwnerFilter !== null)}
                  aria-expanded={mapPanelOpen}
                  onClick={toggleMapPanel}
                >
                  <span className="fwm-drive-draws-label fwm-data">{DRIVE_DRAWS}</span>
                  <span className="fwm-drive-draws-value">
                    {mapOwnerFilter === null ? DRIVE_DRAWS_ALL : OWNER_LABELS[mapOwnerFilter]}
                  </span>
                  {mapOwnerFilter === null ? null : (
                    <span className="fwm-drive-draws-note fwm-data">{DRIVE_DRAWS_STILL}</span>
                  )}
                </button>
              )}

              {/* THE QUEUE, inside the card. One line of dots for what is after
                  this one, and the whole list one tap away. */}
              {ahead.length === 0 || cardMini ? null : (
                <>
                  <span className="fwm-drive-rule" aria-hidden="true" />

                  <button
                    type="button"
                    className="fwm-drive-then"
                    aria-expanded={queueOpen}
                    onClick={() => {
                      setQueueOpen(!queueOpen);
                    }}
                  >
                    <span className="fwm-drive-then-label fwm-data">{DRIVE_THEN}</span>
                    <span className="fwm-drive-then-ticks">
                      {ahead.slice(0, 3).map((a) => (
                        <span className="fwm-drive-tick" key={a.id} data-fwm-near={a.band}>
                          <span className="fwm-drive-tick-dot" aria-hidden="true" />
                          <span className="fwm-drive-tick-dist">{a.miles}</span>
                        </span>
                      ))}
                    </span>
                    <span className="fwm-drive-then-more fwm-data">
                      {queueOpen ? DRIVE_LESS : `${String(ahead.length)} more`}
                    </span>
                  </button>

                  {queueOpen ? (
                    <ul className="fwm-drive-queue" aria-label={DRIVE_AHEAD}>
                      {ahead.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            className="fwm-drive-queue-row"
                            data-fwm-near={a.band}
                            data-fwm-drive-muted={String(a.muted)}
                            onClick={() => {
                              openIntelCard(a.id);
                            }}
                          >
                            <span className="fwm-drive-tick-dot" aria-hidden="true" />
                            <span className="fwm-drive-queue-dist">{a.miles}</span>
                            <span className="fwm-drive-queue-label">{a.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </div>
          )}

        </div>
      )}
    </section>
  );
}
