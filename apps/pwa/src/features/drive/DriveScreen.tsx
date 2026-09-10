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

import { onScreenReselected, openScreen } from '../../app/screenState.ts';
import {
  useCameraAssessments,
  useCurrentFix,
  useHeadingDeg,
  useMapOwnerFilter,
  useMapView,
  useMapTilt,
  useNearestCamera,
  useSettingsStore,
  useSpeedMph,
  destinationsActions,
  useCachedCameras,
  useCamerasStore,
  useDestinationBook,
} from '../../stores/index.ts';
import type { CameraOwnerType } from '../../stores/index.ts';
import { LazyMapCanvas as MapCanvas } from '../map/LazyMapCanvas.tsx';
import { DemoPad } from './DemoPad.tsx';
import { MapCompass } from '../map/MapCompass.tsx';
import {
  demoDriveState,
  startDemoDrive,
  stopDemoDrive,
} from '../../services/adapters/demoGeolocation.ts';
import { AbuseMenu } from '../map/AbuseMenu.tsx';
import { setMisuseCasesOnly } from '../misuse/misuseView.ts';
import { MapControlPanel } from '../map/MapControlPanel.tsx';
import { MapViewPanel } from '../map/MapViewPanel.tsx';
import { LIGHT_MODES, toggleDayNight } from '../../app/dayNight.ts';
import { onLayersToggle, onMapFocus, publishLayersOpen } from './driveSignals.ts';
import { easeMapTo } from '../map/screenPoint.ts';
import { mapEnabled } from '../map/flag.ts';
import { visibleCameras } from '../map/ownerFilter.ts';
import { openIntelCard } from '../intel/IntelScreen.tsx';
import { OWNER_LABELS } from '../triage/triage.ts';
// NO MAPS HANDOFF FROM THIS FILE AT ALL, and there is now no import to
// re-add. It was `navigateTo`, then the detour work moved it to the card's
// route key and `routeVia`; the dock has no route-around key, so the only
// surface left that can hand a drive to a maps service is `DetourOffer`,
// raised by the alert takeover, which asks first.
import { MAP_VIEW_LABELS } from '../../app/mapView.ts';
import { MAP_TILT_DEG, nextMapTilt } from '../../app/mapTilt.ts';
import { enterImmersive, exitImmersive } from '../../services/pwa/immersive.ts';
import { useCatalogueTotal } from '../../services/cameras/useCatalogueTotal.ts';
import { useCatalogueUpstream } from '../../services/cameras/useCatalogueUpstream.ts';
import { loadLandmarks } from '../../services/records/landmarks.ts';
import { coverageOf, loadHazards } from '../../services/records/hazards.ts';
import {
  routeActions,
  usePlannedRoute,
 } from '../../stores/route.ts';
import { DocViewScreen } from '../docs/DocViewScreen.tsx';
/* THE CHROME. Four components and one hook, all of them measured against
   `searchbar_and_buttons.dc.html` in `features/chrome/` and none of them
   deciding anything -- every press below is routed by this file. */
import { TopBar } from '../chrome/TopBar.tsx';
import { Chips } from '../chrome/Chips.tsx';
import type { ChipId } from '../chrome/Chips.tsx';
import { Rail } from '../chrome/Rail.tsx';
import { RAIL_MAIL, RAIL_CODE, RAIL_HELP } from '../chrome/Rail.tsx';
import type { RailKeyId } from '../chrome/Rail.tsx';
import { useChromeSweep } from '../chrome/PixelSweep.tsx';
import { Toast } from '../chrome/Toast.tsx';
import { DOCK_TABS } from '../dock/dockState.ts';
import { useDockState } from '../dock/useDockState.ts';
import { useScreen } from '../../stores/navigation.ts';
import { RailSheet } from './RailSheet.tsx';
import { CONTACT_WAYS } from './contactWays.ts';
import { developerWays } from './developerWays.ts';
import { faqWays } from './faqWays.ts';
import { useSteadyFix, useSteadyHeading } from './steady.ts';
import { planDarkRoute, planPlainRoute } from '../../services/route/darkRoute.ts';
import { previewWithoutFix, routeOptionsFrom } from '../search/preview.ts';
import type { RouteOption } from '../search/panel.ts';
import type { Place } from '../../services/route/planRoute.ts';

import './drive.css';

/** The dock tab that IS this screen, so the sweep reads the same ladder the
    dock does. `app/ShellDock.tsx` resolves `overMap` from exactly this. */
const MAP_TAB = DOCK_TABS.find((tab) => tab.key === 'map');

/** Frozen and shared: a build with no map data allocates nothing for it. */
const NO_CAMERAS: readonly never[] = Object.freeze([]);

/** The app's word for "we cannot compute this", used everywhere it cannot. */
export const NO_VALUE = '—';


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
 * GAP: alert-v1, the same gap on the alert takeover.
 */
export function driveRouteLabel(count: number): string {
  return `Route around all ${String(count)}`;
}

/**
 * WHAT A CAMERA THE ARCHIVE CANNOT NAME IS CALLED.
 *
 * Most OSM ALPR nodes carry no street and no operator, so this is a common
 * case rather than an edge one. "Unnamed reader" rather than the raw
 * `osm:13917990301`: the id is a database key, and a list of them tells a
 * driver nothing about where they were.
 */
export const UNNAMED_CAMERA = 'Unnamed reader';

/**
 * The radius the monitor card's list is drawn from.
 *
 * It is the ALERT QUEUE's own reach, not a number this card chose - the list is
 * the queue, so a different figure here would describe a set nobody assembled.
 */
/*
 * THE THREE LIGHT SKINS live in `app/dayNight.ts` now, with the toggle that
 * reads them: the landscape right rail's Day/night circle is the same key on a
 * surface this screen is not an ancestor of, and it could not reach a closure
 * held here. `LIGHT_MODES` is still what the glyphs below branch on.
 */

/*
 * THE ONLY LINE THAT SEPARATES "NOTHING NEARBY" FROM "NOTHING SYNCED".
 * The design draws no empty state for this column. Kept anyway: an empty list
 * with no sentence reads as a clear road, and on a phone that has never
 * fetched a tile it would be a lie.
 */
export const DRIVE_NOTHING_NEARBY = 'no cameras in the archive on this phone yet.';

export const DRIVE_WITHIN = 'Within 5 miles';

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
export const DRIVE_RECENTER = 'Recenter on me';
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

/*
 * `watchingCount` AND `watchingPair` ARE GONE, and the rounding is why.
 *
 * They wrote `1k / 140k WATCHING` under the speed plate: the cached figure over
 * the published one, both rounded to the nearest thousand. The pairing was
 * sound - a bare `987` could mean the network knows about 987 cameras or that
 * this phone holds 987 of a much larger set - but the rounding was not. A
 * figure that cannot change by less than a thousand cannot show a sync
 * stopping, and this app served a six-day-old archive under exactly that
 * number without anybody being able to tell.
 *
 * The search bar draws the published total in full instead - `139,918`,
 * through `formatCacheCount` - with a dot beside it for how old the archive
 * behind it is. Nothing calls these two any more, and leaving them exported
 * would leave the rounded form one import away from coming back.
 */

export function DriveScreen(): ReactElement {
  const fix = useCurrentFix();

  /*
   * DEMO DRIVE STARTS WHERE YOU ALREADY ARE.
   *
   * Turning it on in SETTINGS records the preference; this is what acts on it,
   * because SETTINGS has no position and seeding from nothing would put the pad
   * on a map showing an empty ocean. It reads the last real fix, which by the
   * time anybody opens SETTINGS is the map they were just looking at.
   *
   * NO FIX, NO DEMO. If location has never answered there is nowhere honest to
   * start, and inventing a coordinate would put a demo on a road the driver has
   * never been near. The preference stays on and this seeds the moment a fix
   * arrives, so it starts by itself rather than needing to be toggled again.
   */
  const demoDrive = useSettingsStore((s) => s.demoDrive);

  /* TURNING IT OFF IS ITS OWN EFFECT, KEYED ONLY ON THE SETTING.
   *
   * It used to live in the effect below, which depends on the current fix and
   * therefore re-runs two or three times a second. That called `stopDemoDrive`
   * on every GPS tick, and the loop that came out of it took production down -
   * see the guard in `demoGeolocation.ts`. The adapter is defensive about it
   * now, but the honest fix is also here: a teardown that runs on a position
   * change was never describing anything real. */
  useEffect(() => {
    if (demoDrive) return;
    stopDemoDrive();
  }, [demoDrive]);

  useEffect(() => {
    /* SEEDING NEEDS THE FIX, so this one does depend on it - but it is a pure
       guard-and-return until demo mode is actually on AND has no position yet,
       which happens once. */
    if (!demoDrive || demoDriveState().active || fix === null) return;
    startDemoDrive({ lat: fix.lat, lon: fix.lon });
  }, [demoDrive, fix]);
  const headingDeg = useHeadingDeg();
  const speedMph = useSpeedMph();
  const assessments = useCameraAssessments();
  const nearest = useNearestCamera();
  /*
   * BARE: the search bar folded, so everything else goes with it.
   *
   * Folding used to put away the bar's own field and keys and leave the map
   * rail and the dock sitting on the map. The owner's read is that the chevron
   * means "clear the screen", not "shrink one control" - so the attribute goes
   * on the DRIVE root and `drive.css` hides the rail and the dock off it.
   */
  const [bare, setBare] = useState(false);
  const mode = useSettingsStore((s) => s.mode);
  const clusterCameras = useSettingsStore((s) => s.clusterCameras);
  const headingUpMap = useSettingsStore((s) => s.headingUpMap);
  const forceLandscape = useSettingsStore((s) => s.forceLandscape);
  const thresholdFt = useSettingsStore((s) => s.thresholdFt);
  /*
   * `nearestMuted` AND `mutePierced` WENT WITH THE CARD'S MUTE KEY.
   *
   * Neither was ever rendered by anything else on this screen: the key is the
   * only thing that read the first, and the pierced-mute sentence -- "MUTED,
   * STILL ALERTING BECAUSE THIS ONE IS INSIDE YOUR RE-ALERT DISTANCE" -- was
   * written for the card's second line and the dock has no line for it.
   *
   * BOTH ARE STILL LIVE SIGNALS. `AlertV1` reads `mutePierced` for the takeover
   * and the INTEL card owns the per-camera mute. What has gone is this screen's
   * copy, not the behaviour.
   * GAP: the dock draws a mute key in states 3, 9 and 10 and `DockActionKey`
   * has no member for it, so there is nothing here to wire it to.
   */

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
  /*
   * THE PUBLISHED TOTAL, SUBSCRIBED RATHER THAN SAMPLED.
   *
   * This was `catalogue.total()` called inline during render. The catalogue
   * loads asynchronously and had nothing to notify, so the first render read
   * `null` and no later render was ever scheduled - the header drew the lone
   * figure "1k" on every cold start and only became the pair "1k / 140k" if
   * something unrelated happened to re-render the screen.
   *
   * That lone number is the exact ambiguity `catalogue.ts` was written to
   * avoid: it could mean the network knows about 987 cameras, or that this
   * phone holds 987 of a much larger set.
   */
  const publishedTotal = useCatalogueTotal();
  /*
   * WHEN THAT TOTAL WAS TRUE, subscribed the same way and for a harder reason.
   *
   * The number above is only as good as its date. On 2026-09-07 the app drew a
   * confident "139,918" over an archive that had not moved for six days,
   * because the age had never been given to any screen to render. The search
   * bar's dot is painted from this; a bar that could not see it would be the
   * same silence with a light on it.
   */
  const upstream = useCatalogueUpstream();


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

  /*
   * THE SEARCH SPEC'S HISTORY AND PREVIEW, WIRED TO THIS SCREEN.
   *
   * The bar was mounted with no `book`, no `onRemember` and no `routes`: the
   * panel drew the first-run card over a history it was never handed, wrote
   * nothing when a drive started, and skipped its PICKED state because no
   * host offered a preview ("I don't think it's saving historical searches for
   * navigation" -- owner, 2026-09-09). The book is the destinations store's;
   * a start writes it through `rememberRouteStart`, which is section C's one
   * write; and picking a destination plans the two lines the preview can
   * offer, from where the car is, so the driver chooses exposure or speed
   * before the drive rather than being handed one.
   */
  const book = useDestinationBook();
  const [routeOptions, setRouteOptions] = useState<readonly RouteOption[] | null>(null);
  const previewRef = useRef(0);
  const preview = useCallback(
    (place: Place | null): void => {
      previewRef.current += 1;
      const mine = previewRef.current;
      setRouteOptions(null);
      if (place === null) return;
      if (fix === null) {
        setRouteOptions(previewWithoutFix());
        return;
      }
      const request = {
        from: { lat: fix.lat, lon: fix.lon },
        to: { lat: place.lat, lon: place.lon },
        cameras: useCamerasStore.getState().cameras,
      };
      /* TWO PLANS FROM ONE PRESS, and the press is the row the driver tapped.
         Either may fail on its own; the preview is whatever came back. */
      void Promise.all([
        planPlainRoute(request).catch(() => null),
        planDarkRoute(request).catch(() => null),
      ]).then(([plain, dark]) => {
        if (mine !== previewRef.current) return;
        setRouteOptions(routeOptionsFrom(plain, dark, request.cameras));
      });
    },
    [fix],
  );
  const recenter = useCallback(() => {
    setPanned(false);
  }, []);
  /* Stop the map following, without moving it. Used by demo drive so the marker
     travels across the view instead of being held under the crosshair. */
  const holdMap = useCallback(() => {
    setPanned(true);
  }, []);
  /*
   * PRESSING THE MAP TAB WHILE THE MAP IS UP RECENTRES IT. A panned map is a
   * map that is not about the car any more, and the way back has to be one
   * obvious press; RADAR's dial made the same ruling for the same key. DRIVE
   * is registered at `radar` -- see `registry.v1.tsx` -- so that is the id a
   * re-select of this screen reports.
   */
  useEffect(
    () =>
      onScreenReselected((screen) => {
        if (screen === 'radar') recenter();
      }),
    [recenter],
  );
  /*
   * A STEP ROW IN THE DOCK ASKS THE MAP TO GO AND LOOK AT THAT TURN. Hold
   * first, then move: `MapCanvas` eases back to the car on the next fix unless
   * `panned` is set, and a move made before the hold would have lasted one
   * GPS tick. The move itself is the map registry's; `screenPoint.ts` says why
   * it is an ease and not a fly.
   */
  useEffect(
    () =>
      onMapFocus((point) => {
        holdMap();
        easeMapTo(point);
      }),
    [holdMap],
  );

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
  /*
   * THE SECOND PANEL. `Map view` governs how the map BEHAVES - where it points,
   * its angle, clustering, the warn distance, full screen - while `Layers`
   * keeps what it DRAWS. Two pills, two panels, by owner decision: one panel
   * holding both put the thing somebody opened it for four scrolls down.
   */
  const [mapViewOpen, setMapViewOpen] = useState(false);
  const mapViewKeyRef = useRef<HTMLButtonElement | null>(null);

  /*
   * AND A THIRD, WHICH IS THE REPORTS CHIP'S.
   *
   * It used to navigate - one press off the map and onto the MISUSE archive -
   * and it opens a panel now, for the reason the other two do: what the chip
   * controls is the map and the alert, and neither of those is on the screen you
   * were sent to. `AbuseMenu` keeps those controls alongside News and Abuse
   * rows that open the corresponding screens.
   *
   * Transient, and never persisted, exactly like the two above. Which panel was
   * open is not a preference; it is where a thumb was a second ago.
   */
  const [abusePanelOpen, setAbusePanelOpen] = useState(false);
  const abusePanelKeyRef = useRef<HTMLButtonElement | null>(null);

  /*
   * THE DESTINATION AND ITS ROUTE. All of it is memory-only - see the note at
   * the top of `stores/route.ts` for why a destination is never written down.
   */
  /*
   * THE ROUTE ITSELF IS STILL READ HERE -- the map draws its line. The
   * DESTINATION, the STATUS, the ERROR, the AVOIDED SET and the READERS ON THE
   * LINE are not: they were the navigation card's five props and they are now
   * `useDockState`'s subscriptions, read once, in the file that decides what
   * the bar says about them.
   */
  const route = usePlannedRoute();
  /*
   * THERE IS NO BASELINE HERE ANY MORE.
   *
   * `plainRoute` held the route as first planned, with nothing avoided, so the
   * navigation card and then the dock could price the avoidance as `+1.2 mi`.
   * Both of those readers have left this component - the card is deleted and
   * the dock is chrome, mounted by `app/ShellDock.tsx` - and a piece of state
   * that is written on every drive and read by nothing is a lie in a file, not
   * a feature.
   *
   * It also cost a whole extra routing round-trip per destination: the plain
   * line was planned first, held, never drawn, and then thrown away.
   *
   * GETTING THE FIGURE BACK is a store change, not a change here. The baseline
   * has to outlive this screen to be readable from the shell, which means a
   * field on `stores/route.ts` written where `planned` is written. Until then
   * state 8 draws no detour price, which `useDockState.buildData` already
   * treats as an ordinary absence - the first plan of every drive had none.
   */


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
  /*
   * THE SAME PANEL, PRESSED FROM THE LANDSCAPE RAIL. The right rail's Layers
   * circle is mounted by the shell, in a subtree this screen is not an ancestor
   * of; `driveSignals.ts` is the wire. The panel stays this screen's state --
   * only the press travels -- and the open flag goes back the other way so the
   * circle can draw lit while the panel it opened is up.
   */
  useEffect(() => onLayersToggle(toggleMapPanel), [toggleMapPanel]);
  useEffect(() => {
    publishLayersOpen(mapPanelOpen);
  }, [mapPanelOpen]);
  useEffect(() => () => publishLayersOpen(false), []);

  /**
   * THE CHIP THE RESULTS SHEET IS COVERING.
   *
   * The sheet is positioned from the bar and overlaps most of the chip row, and
   * now that it is made of the same translucent glass as everything else that
   * floats here, that overlap SHOWS - a row of bordered pills reading through
   * the first result. Hiding the row is the right answer rather than making the
   * sheet opaque: somebody reading search results is not reaching for the map
   * controls, and an opaque sheet would be the one panel on this screen the
   * transparency setting could not reach.
   *
   * The bar owns the query, so the bar is the only thing that knows. It reports
   * and this decides - `TopBarProps.onSearchingChange`.
   */
  const [searching, setSearching] = useState(false);

  /**
   * WHICH RAIL SHEET IS OPEN, or none.
   *
   * `mail`, `code` and `help` each raise a short list over the map. They used
   * to be three components that each drew their own 48px key and each held
   * their own open flag, closing each other through a module variable. The rail
   * is one component now and the five keys are one drawing, so the state is one
   * id here: two sheets cannot be open at once because there is nowhere for the
   * second one to be. Transient by design and never persisted.
   */
  const [railSheet, setRailSheet] = useState<RailKeyId | null>(null);
  const closeRailSheet = useCallback(() => {
    setRailSheet(null);
  }, []);
  /* The keys the sheets hand focus back to when Escape shuts them. Without
     these, dismissing drops focus to `<body>`. See `RailSheetProps`. */
  const mailKeyRef = useRef<HTMLButtonElement | null>(null);
  const codeKeyRef = useRef<HTMLButtonElement | null>(null);
  const helpKeyRef = useRef<HTMLButtonElement | null>(null);

  /**
   * SECTION D AND SECTION E: the pixel sweep, its toast, and the tap counter.
   *
   * One hook, one slot. `sweep` is the bar's first child, `toast` is a pill
   * near the bottom of the map, `tapMark` is the 72x72 target on the logo,
   * `fire` is the three driving gestures and `noteManeuver` is the five-second
   * quiet window around a turn. See `PixelSweep.tsx` for what competes for the
   * slot and which of them wins.
   */
  const { sweep, toast, fire, noteManeuver, tapMark } = useChromeSweep();

  /**
   * WHAT THE DOCK IS SAYING, READ FROM THE THING THAT DECIDES IT.
   *
   * The three sweep gestures are the three ALERT states of the dock -- 10
   * APPROACHING, 11 PASSING, 12 CLEARED -- and the honest way to fire on those
   * is to read the ladder that produces them rather than to re-derive
   * "passing" from the alert store beside it. `deriveState` is pure and
   * `useDockState` is its only caller; a second definition of what passing
   * means is exactly how the two would drift.
   *
   * THE COST IS A SECOND DERIVATION, and it is stated rather than hidden: this
   * subscribes to the same stores `app/ShellDock.tsx` does and builds the same
   * data. `expanded` is deliberately not passed - it changes only the two
   * NAVIGATING and three ARMED states, never these three, so the two readings
   * cannot disagree about anything read here.
   *
   * GAP: there is no store holding the dock's current state, which is what
   * would make this a subscription instead of a recomputation. That is a change
   * to `features/dock/`, which this work is not allowed to touch.
   */
  const screen = useScreen();
  /* THE PANE IS PART OF THE ANSWER NOW. `useDockState` returns a discriminated
     union -- collapsed, navigating, expanded -- because v3's three panes do not
     take the same data, so the two things this screen reads are narrowed out of
     it rather than pulled off one flat object: the three lit COLLAPSED states
     the sweep fires for, and the maneuver token, which only a routed pane has. */
  const dock = useDockState({
    /* THE SAME ANSWER `ShellDock` GIVES, computed the same way. DRIVE stays
       MOUNTED under every other screen - `App.tsx` parks the map rather than
       tearing its WebGL context down - so without this the two copies would
       disagree the moment somebody opened SETTINGS, and this one would fire a
       sweep across a bar nobody can see. */
    overMap: screen === MAP_TAB?.screen,
  });
  const dockState = dock.pane === 'collapsed' ? dock.state : null;
  const dockTurn = dock.pane === 'navigating' ? dock.data.turn : undefined;

  /**
   * ONE PASS PER ARRIVAL AT A STATE, never one per render.
   *
   * `fire` is a trigger, not a level: called every render it would restart the
   * grid sixty times a second. The previous state is held in a ref so the
   * effect can compare rather than re-fire, and anything that is not one of the
   * three simply clears the memory.
   */
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (dockState !== 'approaching' && dockState !== 'passing' && dockState !== 'cleared') {
      firedFor.current = null;
      return;
    }
    if (firedFor.current === dockState) return;
    firedFor.current = dockState;
    fire(dockState === 'approaching' ? 'approach' : dockState === 'passing' ? 'passing' : 'cleared');
  }, [dockState, fire]);

  /**
   * A TURN IS ON SCREEN, SO NOTHING DECORATIVE FIRES FOR FIVE SECONDS.
   *
   * The maneuver token the dock draws in its navigating row is the only place
   * in the product a turn is drawn. The quiet window is
   * the one rule in `PixelSweep.tsx` that is about safety rather than taste:
   * pixels moving across the top of the screen while somebody is being told to
   * turn is decoration displacing signal.
   */
  useEffect(() => {
    if (dockTurn === undefined) return;
    noteManeuver();
  }, [dockTurn, noteManeuver]);

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

  /*
   * `records` AND `recordOf` WENT WITH THE CARD.
   *
   * Every consumer of a camera's NAME on this screen -- the street, the chip,
   * the mount, the summary's lookup -- was the card. The map draws from
   * `useCachedCameras` below, which is a different subscription for a different
   * reason: it changes only when a tile is written, and the record lookup
   * changed on every engine tick.
   */

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
   * WHICH READERS ARE ON THE LINE, measured here, on the phone.
   *
   * The route came back from the server; the cameras were already here. Pairing
   * them locally means the server is never told which readers a driver cares
   * about - see `services/route/corridor.ts`.
   */
  /**
   * THE READERS STILL ON THE LINE, FROM THE PLANNER RATHER THAN RECOMPUTED.
   *
   * This was a local `camerasOnRoute(route.shape, cameras)` memo, which gave
   * the right answer today and was a bug waiting to happen: the card puts this
   * number NEXT TO `avoiding`, and `avoiding` is what the planner was told to
   * exclude at plan time. Two numbers on one line, one live and one a snapshot,
   * is exactly the mismatch that produced the "5 avoided · 2 could not be"
   * double-count - a real figure printed where it means something else.
   *
   * `planDarkRoute` already measured this against the final line, on this
   * device, and put it in the store. Reading it back means both halves of that
   * sentence come from the same moment and cannot drift apart.
   */
  /**
   * ASK FOR A ROUTE. Called from a PRESS and from nowhere else.
   *
   * THE DARK ROUTE IS THE ANSWER, not a second press.
   *
   * Choosing a destination used to draw the PLAIN route and then offer to build
   * the dark one. What that put on screen was a bright line straight through a
   * cluster of readers with "8 readers on the way" under it - this application
   * drawing, at a glance, the exact drive it exists to help somebody avoid.
   *
   * It then planned BOTH: the plain line first, kept as the baseline the card
   * priced the detour against and deliberately never published to the map, then
   * the dark one. That baseline has no reader left in this component - see the
   * note where it used to be declared - so the first request is gone with it
   * and a destination now costs one round trip instead of two.
   */
  /* The closure this note describes is gone: the body moved to
     `routeActions.planFromHere`, which the bar's `onDestination` now calls
     directly with the line the driver chose, and the intel card calls too. */

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

  /*
   * EVERY ROW SAYS WHAT IT IS, not just where.
   *
   * Nine rows reading "METCALF AVE", "METCALF AVE", "METCALF AVE" is a list
   * that cannot be used: the key above it offers to route around all nine and
   * the list gives a driver no way to tell one from another, or to judge
   * whether the nine are one intersection's worth of readers or nine separate
   * ones. A street name is not distinguishing when a corridor carries a dozen
   * cameras, which is exactly the case the list exists for.
   *
   * So each row carries the SAME facts the closest card carries about the
   * camera in its figure - who it belongs to, which way it looks, what it is
   * bolted to - built from the same helpers, so the row and the card a tap
   * opens cannot make different claims about the same camera.
   *
   * Each part is dropped when the record does not carry it rather than printed
   * as a blank, which is why most rows will show a chip and a street and
   * nothing else. That is the honest state of OSM's ALPR nodes.
   */
  /*
   * THE LANDMARK INDEX, loaded once and never blocking anything.
   *
   * A landmark is a nicety: it makes nine cameras on one street tellable
   * apart. Nothing waits for it, nothing errors without it, and a device that
   * never gets it keeps every warning it had. `ready` exists only to re-render
   * once when the table arrives; the table itself is module state because a
   * megabyte of reference data has no business in a React store.
   */
  /*
   * A PUBLISHED DOCUMENT, OPEN OVER THE MAP.
   *
   * Local state rather than a registered screen: the reader is a leaf with one
   * way in and one way out, nothing deep-links to it, and putting it in the
   * navigation stack would let a back gesture restore a document over a map
   * whose position has since moved on.
   */
  const [openDoc, setOpenDoc] = useState<
    null | { readonly name: string; readonly title: string; readonly file: string }
  >(null);

  /*
   * THE LANDMARK TABLE IS STILL LOADED HERE, and this screen no longer reads it.
   *
   * `loadLandmarks()` has exactly one caller in the application -- this one --
   * and `landmarkFor` is what `features/lookup/search.ts` names a camera by. So
   * dropping the load with the card would have taken the landmark out of LOOK
   * UP's results without a line changing in LOOK UP.
   *
   * Fire and forget now, with no `landmarksReadyAt`: that state existed only to
   * re-render the nearby list when the table landed, and the dock's list does
   * not carry a landmark. Nothing here waits for it and nothing errors without
   * it. GAP: the load belongs to whoever reads it, not to whichever screen
   * happens to mount first.
   */
  useEffect(() => {
    void loadLandmarks();
  }, []);

  /*
   * ONLY THE ONES THAT DISTINGUISH.
   *
   * Computed across the nearest camera AND the queue together, because that is
   * the set on screen. Six cameras ringing one store all saying NEAR HOME DEPOT
   * would recreate the exact problem the landmark was added to solve. See
   * `distinctLandmarks`.
   */
  /*
   * THE ROADWORK LAYER, fetched only when it is switched on.
   *
   * A driver who never asks for it pays nothing - not the bytes, not the
   * request. That matters more here than for the landmark index, because this
   * layer has partial coverage and unfamiliar semantics, and loading it
   * eagerly would make its silence look like an answer to somebody who never
   * opted in.
   */
  const showHazards = useSettingsStore((s) => s.showHazards);
  const setShowHazards = useSettingsStore((s) => s.setShowHazards);
  useEffect(() => {
    if (!showHazards) return;
    void loadHazards();
  }, [showHazards]);


  const hazardCoverage = useMemo(
    () => coverageOf(nearest?.lat ?? null, nearest?.lon ?? null),
    [nearest?.lat, nearest?.lon],
  );

  /*
   * `landmarks` AND `ahead` WENT WITH THE CARD.
   *
   * They were the nearby list's display shape -- a landmark name, a chip, a
   * proximity band and a mount phrase per row. The dock's expanded list carries
   * a distance, a street and an operator dot and nothing else, and it builds
   * those itself in `useDockState` off the same assessments. Keeping a second
   * derivation here would be two answers to "what is on the road ahead".
   *
   * `distinctLandmarks` and the landmark table are still loaded above: the
   * INTEL card reads them, and the load is what makes them available to it.
   */

  /*
   * `alertState`, `nearestRecord`, `chip`, `nearestFacings` AND
   * `closestPicture` WENT WITH THE CARD.
   *
   * The last of them is the ONE `MiniMap` this screen was allowed -- one full
   * `new maplibregl.Map(...)`, never one per row, because eight of them evicted
   * the main map's WebGL context and blacked it out. The dock draws no picture
   * at all, so the instance is gone rather than moved, and the rule it existed
   * to obey has nothing left to violate. `DriveScreen.cardMap.test.tsx` asserts
   * that instance exists and now has nothing to assert about.
   */

  /*
   * `passSummary` WENT WITH THE MONITOR CARD's second page.
   *
   * It was the plate-read column -- all-time, by day, hottest, recent -- and
   * the dock has no page for it. The same summary is the EXPOSURE screen's own
   * subject, which is where the Exposure tab now goes, so the reading has moved
   * rather than been lost. `summarizePasses` is untouched.
   */

  /*
   * `nearby` AND `closestPanel` WENT WITH THE CARD.
   *
   * `ClosestPanel` was eighteen props -- a MiniMap, a compass, a chip, a mute
   * key, a route-around key and a list -- and the dock draws none of that
   * shape. Its two surviving readings, HOW FAR and WHAT IT IS, are the dock's
   * `distance` and `statusText`, and `useDockState` derives them from the same
   * assessment this file was reading. Nothing is re-derived here.
   *
   * WHAT WENT WITH IT AND HAS NO NEW HOME -- listed so the loss is a decision
   * rather than an accident:
   *
   *   the reader box tap        `openIntelCard(nearest.id)`. Still reachable
   *                             from EXPOSURE, LOOK UP, the alert takeover and
   *                             a tapped map dot; not from the bar any more.
   *   the mute key              `alertActions.muteCamera` on the nearest
   *                             camera. Still on the INTEL card.
   *   the route-around key      `offerDetour(planDriveDetour(...))`. Still
   *                             raised by the alert takeover, which is the
   *                             surface that already asks before anything
   *                             leaves the phone.
   *
   * `alertState` and `mutePierced` are no longer read here at all. Both are
   * live signals that `AlertV1` reads for itself; this file simply has nothing
   * left to draw with them.
   */

  /* ---------------------------------------------------------------------- *
   * THE DOCK IS NOT DRAWN HERE, AND NOTHING ABOUT IT IS DECIDED HERE
   *
   * It is CHROME. `app/ShellDock.tsx` mounts it once, into `App.tsx`'s own
   * `.fwm-shell-dock`, and it is on EXPOSURE and MESH and LOOKUP and MORE
   * exactly as much as it is here.
   *
   * This screen briefly owned it: it held the expanded flag, resolved
   * `.fwm-shell-dock` in an effect and `createPortal`d a second `<Dock>` into
   * the slot `App.tsx` was already filling with the v1 bar. Two docks in one
   * row, and a tab row that only existed while DRIVE was mounted - the first
   * tap took the dock off screen with the screen that owned it.
   *
   * What went with it: the `end` and `reroute` keys, which are store calls and
   * are made from the shell now, and the plain-route BASELINE this file used to
   * plan and hold so state 8 could price the detour as `+1.2 mi`. The baseline
   * was React state in this component and the dock is no longer in this
   * component, so it is gone rather than quietly stale - see the note on
   * `requestRoute`. `Dock.dc.html`'s own caption already allows for its
   * absence: the first plan of every drive has no baseline either.
   * ---------------------------------------------------------------------- */

  return (
    <section className="fwm-drive" aria-label="drive" data-fwm-bare={String(bare)}>
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
            /* THE PLANNED LINE. Undefined until somebody sets a destination
               and presses for a route, which is what keeps this additive. */
            route={route?.shape}
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

        {/* SECTION E'S SENTENCE, bottom-centred on the MAP and not on the bar,
            which is what `pixelSweep.css` section 10 positions it against. It
            holds nothing: the tap counter, the 3.2s timer and the decision
            about which sentence this is all live in `useChromeSweep`, next to
            the pulse they arrive with. Null most of the time, which draws
            nothing at all. */}
        {/* WHICH WAY IS NORTH, and one press to put it back on top. Drawn on
            every screen because the map can be turned by a two-finger rotate
            even with heading-up off, and a rotation nothing announces is what
            made the demo pad's arrows read as broken. */}
        <MapCompass
          bearingDeg={headingUpMap ? (mapHeading ?? 0) : 0}
          headingUp={headingUpMap}
          onFaceNorth={() => {
            useSettingsStore.getState().setHeadingUpMap(false);
            recenter();
          }}
        />

        <Toast message={toast} />

        {/* DEMO DRIVE'S PAD. Mounted over the map, above the dock's scrim and
            below the dock, because the dock is usually the thing being
            demonstrated. It draws nothing at all when demo mode is off. */}
        <DemoPad
          /* THE MAP HOLDS STILL AND THE MARKER MOVES. That is the whole point
             of a pad: you are driving a dot around a map you can see, and a map
             that recentres on every press pins the marker to the middle of the
             screen forever - which looks exactly like a control that does
             nothing. A real drive follows the vehicle because the driver cannot
             see round corners; a demo is the opposite case, where the operator
             is looking at the whole field and steering across it.
             `recenter` is still one press away on the locate key when the
             marker reaches an edge. */
          onMove={holdMap}
          /* So RIGHT means right on screen even when the map is turned. */
          mapBearingDeg={mapHeading ?? 0}
          onExit={() => {
            useSettingsStore.getState().setDemoDrive(false);
          }}
        />
      </div>

      {(
        <>
          {/* --- the top bar ------------------------------------------------ */}
          {/* SECTION A OF THE CHROME BRIEF, MOUNTED.

              `features/chrome/TopBar.tsx` is the drawing - 56px of glass, the
              mark hanging off the left cap, the wordmark with the read count
              under it, the rule, the field and one key - and it carries the old
              `SearchBar`'s whole brain on that markup: the query, the on-device
              results, `Start DarkRoute`, the clear key, the fold.

              IT IS ADDITIVE, and that has not changed. Type nothing and this
              screen behaves precisely as it did: the app still opens and drives
              with no destination, no account and no setup, and the search runs
              against the cameras already on the phone, so nothing about a query
              leaves the device.

              THE SWEEP MOUNTS THROUGH IT. `sweep` is the bar's first child at
              `z-index: 0`; `tapMark` makes the 72x72 mark a target. Section D
              and section E, both from the one hook above. */}
          <div className="fwm-drive-top">
            <TopBar
              sweep={sweep}
              onTapMark={tapMark}
              /* The mark's dark-line variant, off the same `LIGHT_MODES` set
                 the rail's glyph and the theme key both read. One source for
                 "is a pale skin on", three surfaces that need the answer. */
              light={LIGHT_MODES.has(mode)}
              at={fix === null ? null : { lat: fix.lat, lon: fix.lon }}
              onPick={(cameraId) => {
                openIntelCard(cameraId);
              }}
              /* THE CHEVRON IS THE FOLD. `bare` goes on the DRIVE root and
                 `drive.css` takes the rail, the chips and the dock away with
                 the bar - the owner's read is that the chevron means "clear the
                 screen", not "shrink one control". */
              onFoldChange={setBare}
              /* THE COUNT LIVES ON THE BAR, under the wordmark, with a dot that
                 says how old the archive behind it is. Passed in rather than
                 read inside the bar - a component that fetches its own numbers
                 is one a test cannot put into the state it needs to check. */
              total={publishedTotal}
              upstream={upstream}
              /* WHERE A NUMBER ABOUT SURVEILLANCE COVERAGE HAS TO LEAD. Same
                 route the FAQ key's "How this works" row opens - one screen,
                 reached from both the number and the list. */
              onHowItWorks={() => {
                openScreen('docs');
              }}
              /* A DESTINATION IS NOT A ROUTE. Setting one draws the card and
                 nothing else; the route is the card's own press. The app never
                 plans a drive on somebody's behalf. */
              onDestination={(place, option) => {
                routeActions.setDestination(place);
                setPanned(false);
                /* AND BUILD THE ROUTE. Choosing a destination is the press
                   that authorises it - a person who typed a place and picked
                   it off the list has asked to go there. The line is the dark
                   one unless the preview's FASTEST row was the one pressed. */
                routeActions.planFromHere(option === 'fastest' ? 'plain' : 'dark');
              }}
              book={book}
              routes={routeOptions}
              onPicked={preview}
              onRemember={(place) => {
                void destinationsActions.rememberRouteStart(place);
              }}
              onForget={(placeId) => {
                void destinationsActions.forgetPlace(placeId);
              }}
              onSaveAs={(place, kind) => {
                void destinationsActions.saveNewPlace(place, kind);
              }}
              onSearchingChange={setSearching}
            />

            {/* --- the chips -------------------------------------------------- */}
            {/* SECTION B, AND THEY ARE THE PILL ROW'S OWN HANDLERS. Abuse,
                Layers, Map view - the same three destinations, wired to the same
                three closures, because a second implementation of "open the
                layers panel" is how two surfaces drift apart.

                THEY GO WHILE THE RESULTS SHEET IS UP. The sheet hangs from the
                bar and covers this row; see `searching`. */}
            {searching ? null : (
              <Chips
                /* ONE AT A TIME, WHICH IS ALREADY TRUE. Opening any of the
                   three shuts the other two below, so at most one chip is ever
                   on and `active` can be the single id the drawing draws. */
                active={
                  abusePanelOpen
                    ? 'abuse'
                    : mapPanelOpen
                      ? 'layers'
                      : mapViewOpen
                        ? 'map-view'
                        : null
                }
                bindings={{
                  /* ABUSE BOUND AT LAST. It carried `aria-pressed={false}`
                     forever while it navigated, which was the honest attribute
                     for a chip that opened a screen and is the wrong one now:
                     `expanded` is what a chip that raises a panel claims, and
                     `Chips.tsx`'s own header says so. The ref is what the panel
                     hands focus back to when it shuts. */
                  abuse: { expanded: abusePanelOpen, ref: abusePanelKeyRef },
                  layers: {
                    expanded: mapPanelOpen,
                    ref: mapPanelKeyRef,
                    /* The name carries what is ON, not just what the key is
                       called - the cartography in force, plus the drawing filter
                       when one is set, because a filter is a picture and a driver
                       who cannot see it needs telling. */
                    label:
                      mapOwnerFilter === null
                        ? `${DRIVE_LAYERS}: ${MAP_VIEW_LABELS[mapView]}`
                        : `${DRIVE_LAYERS}: ${MAP_VIEW_LABELS[mapView]}, ${driveDrawingOnly(mapOwnerFilter)}`,
                  },
                  'map-view': { expanded: mapViewOpen, ref: mapViewKeyRef },
                }}
                onSelect={(chip: ChipId) => {
                  // ONE PANEL AT A TIME, AND NOW THERE ARE THREE. Two glass
                  // panels overlapping the same band of map is unreadable, and
                  // the second one to open would be the only one a driver could
                  // reach - so every branch shuts the other two.
                  if (chip === 'abuse') {
                    setMapPanelOpen(false);
                    setMapViewOpen(false);
                    setAbusePanelOpen((was) => !was);
                    return;
                  }
                  if (chip === 'layers') {
                    setAbusePanelOpen(false);
                    setMapViewOpen(false);
                    toggleMapPanel();
                    return;
                  }
                  setAbusePanelOpen(false);
                  setMapPanelOpen(false);
                  setMapViewOpen((was) => !was);
                }}
              />
            )}
          </div>

          {/* THE SPEED PLATE IS GONE FROM THE MAP, AND THAT CORNER STAYS EMPTY.
              It was `0 MPH · 45 LIMIT` set flat on the cartography with no
              surface under it - measured at 16,168, 105x15, background
              `rgba(0,0,0,0)` - which is the one thing on this screen that was
              neither map nor instrument.

              CURRENT SPEED BELONGS IN THE DOCK, in its drive states, which
              already carry a 41px secondary row. The map is for browsing and
              nobody browses at 60mph, so a speed readout pinned over the
              cartography is chrome competing with the thing it is drawn on.

              DO NOT REBUILD IT HERE. If a speed is wanted back on this screen
              it goes in the dock's row, not in this corner. */}

          {/* THE COUNT IS NOT HERE ANY MORE. It sat under this plate, as
              `1k / 140k WATCHING`, after a first attempt at putting it inside
              the search bar turned the bar into two rows. It is back on the bar
              by owner decision - under the wordmark, as the real number with a
              freshness dot beside it - and this time the identity column is
              pinned so the row cannot grow. It is not drawn twice. */}

          {/* --- the right rail --------------------------------------------- */}
          {/* SECTION B'S OTHER HALF: five 40px circles, one button type, and
              nothing else on this edge of the map.

              WHAT IT ABSORBED. The theme toggle and the gear came OFF THE BAR -
              a search field holds search controls - and they are wired to the
              same two closures the bar was handed, not to a second copy of
              them. CONTACT, DEVELOPERS and FAQ came off the old rail, which was
              three components that each drew their own 48px key: the keys are
              the spec's now and only their LISTS survive, in `contactWays.ts`,
              `developerWays.ts` and `faqWays.ts`.

              ABUSE, LAYERS and MAP VIEW are deliberately NOT here. They are the
              chip row under the bar, with their names written on them, which is
              strictly better: an unlabelled circle is a rebus the first time
              somebody sees it, and those three are the ones people reach for.
              Keeping both would have been two ways to press the same thing in
              two places six inches apart. */}
          <div className="fwm-drive-rail">
            <Rail
              /* THE ONE KEY THAT KNOWS WHICH WAY IT GOES. The same
                 `LIGHT_MODES` set the handler below branches on, so the glyph
                 and the press can never disagree about which theme is on. */
              light={LIGHT_MODES.has(mode)}
              bindings={{
                mail: { expanded: railSheet === 'mail', ref: mailKeyRef },
                code: { expanded: railSheet === 'code', ref: codeKeyRef },
                help: { expanded: railSheet === 'help', ref: helpKeyRef },
              }}
              onSelect={(key: RailKeyId) => {
                if (key === 'theme') {
                  /* The decision is `app/dayNight.ts`'s, shared with the
                     landscape circle; see that file for why dark is slate and
                     light is refinement and the key knows only those two. */
                  toggleDayNight();
                  return;
                }
                if (key === 'settings') {
                  openScreen('settings');
                  return;
                }
                /* The three that raise a list. Pressing the open one shuts it,
                   which is what the sheets' own keys did. */
                setRailSheet((was) => (was === key ? null : key));
              }}
            />

            {/* CONTACT. Rarely used and urgently used are not the same thing:
                somebody who has just seen a camera in the wrong place should not
                have to leave the map to say so. Email, the repository and Signal
                - three ways that are not interchangeable. */}
            {railSheet !== 'mail' ? null : (
              <RailSheet
                label={RAIL_MAIL}
                items={CONTACT_WAYS}
                onClose={closeRailSheet}
                returnFocusTo={mailKeyRef}
              />
            )}

            {/* THE STOPPED END OF THE RAIL, and it escalates. CONTACT tells a
                person. DEVELOPERS hands over the data itself, because an archive
                of public infrastructure that only this app can read is a smaller
                version of the problem it objects to. FAQ is where the claims are
                checked.

                WHAT IT KNOWS and HOW THIS WORKS used to be rows in MORE, in a
                list beside a theme picker - three navigations from the screen
                that raises the question they answer. */}
            {railSheet !== 'code' ? null : (
              <RailSheet
                label={RAIL_CODE}
                items={developerWays((name) => {
                  setOpenDoc(
                    name === 'taxonomy'
                      ? { name, title: 'Taxonomy', file: 'TAXONOMY.md' }
                      : { name, title: 'Data contracts', file: 'DATA-CONTRACTS.md' },
                  );
                })}
                onClose={closeRailSheet}
                returnFocusTo={codeKeyRef}
              />
            )}

            {railSheet !== 'help' ? null : (
              <RailSheet
                label={RAIL_HELP}
                items={faqWays(openScreen, (name) => {
                  if (name === 'terms') {
                    setOpenDoc({ name, title: 'Terms of use', file: 'TERMS.md' });
                    return;
                  }
                  setOpenDoc(
                    name === 'legal'
                      ? { name, title: 'The legal position', file: 'LEGAL.md' }
                      : { name, title: 'Transparency', file: 'TRANSPARENCY.md' },
                  );
                },
                demoDrive,
                (on) => {
                  useSettingsStore.getState().setDemoDrive(on);
                  /* Shut the sheet on the way through. The pad it turns on is
                     under this menu, and leaving the list open over the control
                     somebody just asked for is the whole reason the row is here
                     rather than two screens away in SETTINGS. */
                  closeRailSheet();
                })}
                onClose={closeRailSheet}
                returnFocusTo={helpKeyRef}
              />
            )}
          </div>

          {/* THREE PANES BESIDE THE RAIL, and all three are mounted whether or
              not they are open so the slide can animate both ways;
              `data-fwm-open` is what shows one.

              NEWS AND DOCUMENTED ABUSE, under the Reports chip, and
              it is the one anchored to the LEFT inset rather than clear of the
              rail: Reports is the leftmost chip and the rail is on the far edge,
              so this pane takes the edge the search bar above it takes. See
              `abuseMenu.css`. */}
          <AbuseMenu
            open={abusePanelOpen}
            onClose={() => {
              setAbusePanelOpen(false);
            }}
            returnFocusTo={abusePanelKeyRef}
            onReadNews={() => {
              openScreen('news');
            }}
            onReadCases={() => {
              setMisuseCasesOnly(false);
              openScreen('reports');
            }}
          />

          {/* SIBLING OF THE RAIL, not a child of it: the rail is a column of
              48px keys and this is a pane beside them. */}
          <MapControlPanel
            open={mapPanelOpen}
            onClose={closeMapPanel}
            returnFocusTo={mapPanelKeyRef}
            hazards={showHazards}
            onToggleHazards={() => {
              setShowHazards(!showHazards);
            }}
            hazardCoverage={hazardCoverage}
            onOpenTheme={() => {
              openScreen('settings');
            }}
          />

          {/* HOW THE MAP BEHAVES, under its own pill. See `MapViewPanel` for
              why this is a second panel rather than more rows in the first. */}
          <MapViewPanel
            open={mapViewOpen}
            onClose={() => {
              setMapViewOpen(false);
            }}
            returnFocusTo={mapViewKeyRef}
            panned={panned}
            onCenter={recenter}
            headingUp={headingUpMap}
            onToggleHeadingUp={() => {
              useSettingsStore.getState().setHeadingUpMap(!headingUpMap);
            }}
            cluster={clusterCameras}
            onToggleCluster={() => {
              useSettingsStore.getState().setClusterCameras(!clusterCameras);
            }}
            tilt={mapTilt}
            onNextTilt={toggleTilt}
            full={full}
            onToggleFull={toggleFull}
            wide={forceLandscape}
            onToggleWide={() => {
              /* The store action carries the apply, the same way `setMapEarth`
                 does, so the layout changes on the press. */
              useSettingsStore.getState().setForceLandscape(!forceLandscape);
            }}
            thresholdFt={thresholdFt}
            onOpenThreshold={() => {
              openScreen('settings');
            }}
          />
        </>
      )}

      {/* THE DOCUMENT READER, over everything.
          Rendered last so it covers the map rather than competing with it, and
          it owns its own way back - see `openDoc`. */}
      {openDoc === null ? null : (
        <div className="fwm-docview-over">
          <DocViewScreen
            name={openDoc.name}
            title={openDoc.title}
            file={openDoc.file}
            onBack={() => {
              setOpenDoc(null);
            }}
          />
        </div>
      )}
    </section>
  );
}
