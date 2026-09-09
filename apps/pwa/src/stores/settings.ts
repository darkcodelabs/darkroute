/**
 * SETTINGS - the durable half of the state model.
 *
 * Everything a driver deliberately chose and expects to find again: the alert
 * threshold, the mute timers, the TRIAGE filters, the delivery-channel toggles
 * and the theme mode. This slice and {@link ../stores/session.ts} are the ONLY
 * two allowed to persist, and what they persist goes through the guarded
 * storage in `./persist.ts` - see that file for why an ordinary
 * `createJSONStorage(() => localStorage)` is a privacy bug here, not a shortcut.
 *
 * MUTE LIVES HERE, NOT IN THE ALERT SLICE
 *   "MUTED CAMERAS DON'T DISAPPEAR. They still draw on SWEEP in grey, still
 *   count in EXPOSURE, still log to LOOKUP. Muting only removes the alert -
 *   never the record." - Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 *
 *   Mute is therefore a DELIVERY PREFERENCE, and preferences are durable: a
 *   ten-minute mute has to survive the app being backgrounded at a red light.
 *   The alert slice reads this config and caches the evaluated boolean; it
 *   never owns the timer. The names below mirror `SettingsValueMap` in
 *   `services/db/schema.ts` one for one so the two can never drift apart.
 *
 * NO DEFAULTS ARE INVENTED HERE
 *   Threshold, threshold bounds, step and the re-alert distance all come from
 *   `@fwm/core`, which sourced them from the design files. A second copy in
 *   this file would be a second place for a design value to drift, and the copy
 *   that drifts is always the one nobody remembered.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage } from 'zustand/middleware';

import type { FwmMode } from '../app/mode.ts';
import { DEFAULT_MODE, isFwmMode } from '../app/mode.ts';
import { DEFAULT_TEXT_SCALE, isTextScale, resolveTextScale } from '../app/textScale.ts';
import type { TextScale } from '../app/textScale.ts';
import { DEFAULT_TYPEFACE, resolveTypeface } from '../app/typeface.ts';
import type { Typeface } from '../app/typeface.ts';
import { DEFAULT_CLEAR, DEFAULT_FLAT, DEFAULT_GLASS, DEFAULT_LIQUID, DEFAULT_TONE, resolveClear, resolveFlat, resolveGlass, resolveLiquid, resolveTone } from '../app/glass.ts';
import { DEFAULT_MAP_VIEW, resolveMapView } from '../app/mapView.ts';
import { applyForceLandscape } from '../app/forceLandscape.ts';
import { applyMapEarth, isMapEarthColour } from '../app/mapEarth.ts';
import { DEFAULT_MAP_TILT, resolveMapTilt } from '../app/mapTilt.ts';
import type { FwmClear, FwmFlat, FwmGlass, FwmGlassTone, FwmLiquid } from '../app/glass.ts';
import type { FwmMapView } from '../app/mapView.ts';
import type { FwmMapTilt } from '../app/mapTilt.ts';
import type { CameraOwnerType } from '../services/db/schema.ts';
import {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
  DEFAULT_ALERT_THRESHOLD_FT,
  DEFAULT_MUTE_DURATION_MS,
  DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT,
  assertThresholdFt,
  snapThresholdFt,
} from './fwmCore.ts';
import { createGuardedPersistStorage, getPersistPort, isPersistDurable } from './persist.ts';
import { EXPIRY_DAYS_CHOICES, EXPIRY_DAYS_DEFAULT } from '../features/search/places.ts';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** The five owner classes TRIAGE groups alerts by. */
export const OWNER_TYPES: readonly CameraOwnerType[] = [
  'police',
  'inter_agency',
  'hoa',
  'private',
  'unverified',
];

/**
 * What is written to disk. Everything else in the slice is runtime bookkeeping.
 *
 * Note what is NOT in here and never will be: a plate, a watchlist, a
 * coordinate, a handle (that is the session slice's, and it is server-issued),
 * or anything keyed by a plate. `assertPersistSafe` in `./persist.ts` enforces
 * that at the write rather than trusting this comment.
 */
export interface PersistedSettings {
  /**
   * Alert threshold in feet. The map-view slider's eleven stops, 25 to 5280;
   * the watch bezel still steps 50 at a time inside that band.
   */
  readonly thresholdFt: number;
  /** Epoch ms the global mute expires, or null when nothing is muted. */
  readonly mutedUntilMs: number | null;
  /** Camera id -> epoch ms that camera's mute expires. */
  readonly mutedCameras: Readonly<Record<string, number>>;
  /** "RE-ALERT ON MUTED IF closer than 150 ft" - B4 · ALERT TRIAGE. */
  readonly reAlertWhenCloserThanFt: number;
  /** TRIAGE toggles. True means "alert on this owner class". */
  readonly ownerTypesEnabled: Readonly<Record<CameraOwnerType, boolean>>;
  /** "UNVERIFIED REPORTS · 1 confirmation only" collapsed to one switch. */
  readonly hideUnverified: boolean;
  /** "2 REPORTS QUEUED · SYNC ON WIFI" - hold evidence for an unmetered link. */
  readonly wifiOnlySync: boolean;
  /** Epoch ms onboarding finished, so permissions are never re-asked on load. */
  readonly onboardingCompletedAtMs: number | null;
  /**
   * WHETHER THE APP USES EACH CAPABILITY, which is not the same as whether the
   * OS has granted it.
   *
   * No web API hands a permission back, so the permission switches could only
   * ever go one way - and "on" was the only state a driver could reach. That
   * is the wrong side of the asymmetry to be stuck on: someone who wants the
   * app to stop reading their location should not have to go and find their
   * browser's site settings to be listened to.
   *
   * So OFF here is honoured by US. The grant stays where it is; the app stops
   * using it. Location off stops the position watch, notifications off stops
   * anything being posted, motion off stops the sensor read. Turning one back
   * on re-uses the grant if it is still there and asks for it if it is not.
   *
   * Defaults to on for all three, because a permission the driver granted
   * during onboarding is one they granted in order to be used.
   */
  readonly capabilitiesEnabled: Readonly<Record<GatedCapability, boolean>>;
  /** Component toggle "Vibration". Gates the haptic channel only. */
  readonly vibration: boolean;
  /** Spoken county takeover - "SPOKEN ALOUD IF AUDIO IS ON", B10. */
  readonly audio: boolean;
  /** Component toggle "Wake lock". "wake lock while RADAR is foreground". */
  readonly wakeLock: boolean;
  /** "NOTIFY WHEN PARKED · reads while the car isn't moving" - B5. */
  readonly notifyWhenParked: boolean;
  /** "SHOW A HANDLE · off = you appear as an anonymous dot" - A1. */
  readonly showHandle: boolean;
  /** Theme skin. Night Watch is the fallback and the watch-only mode. */
  readonly mode: FwmMode;
  /**
   * Type scale, as a multiplier on the root font size.
   *
   * The design's type ramp bottoms out at 11px and `user-scalable=no` takes
   * pinch-zoom away, so this is the only way a driver can make the labels
   * readable. See `../app/textScale.ts` for why it scales type and not spacing.
   */
  readonly textScale: TextScale;
  /** Which face the UI words are set in. See `app/typeface.ts`. */
  readonly typeface: Typeface;
  /**
   * Whether nearby cameras merge into counted clusters on the map.
   *
   * ON is right for a country: 131,000 markers is a solid field of colour and
   * says nothing. OFF is right for a driver who wants to see the individual
   * poles around them rather than a number standing in for them, and some
   * people simply read a scatter better than a summary.
   *
   * A setting rather than a zoom rule because it is a preference about how to
   * read a map, and the zoom already decides when clustering STOPS being useful
   * -- this decides whether it happens at all.
   */
  readonly clusterCameras: boolean;
  /**
   * WHETHER A STARTED ROUTE IS WRITTEN DOWN AT ALL.
   *
   * Section C of `DarkRoute Search Entry.html` - the destination history. ON by
   * default, which is the one default on this screen that deserves an argument
   * rather than an assertion: it is the only setting here that turns on a
   * record of where somebody goes.
   *
   * It is on because the record never leaves the phone, it is nine rows deep,
   * every one of them expires, and the panel's entire premise is that most
   * trips are somewhere you have already been - a search field that opens to a
   * cursor instead of to Home is a worse product for no privacy gain, since
   * nothing was going to be uploaded either way. The row says so in words
   * rather than making a person infer it: `on - never leaves the phone`.
   *
   * OFF STOPS THE WRITING, IT DOES NOT DELETE. Turning the feature off and back
   * on is not a wipe, and a switch that silently shredded nine places would be
   * a deletion wearing a toggle's clothes. `Forget all recent places` is the
   * control that deletes, and it is drawn in red one row below.
   */
  readonly rememberPlaces: boolean;
  /**
   * HOW LONG A RECENT SURVIVES ITS LAST USE, IN DAYS. `null` is NEVER.
   *
   * Section C: "Ninety days since last use, then deleted. Configurable to 30,
   * 90, a year or never - the setting is per-phone, and 90 is the default."
   *
   * `null` is a real choice rather than a missing value - somebody who drives
   * the same six places forever should not lose them to a timer - so it is
   * spelt as a nullable number and not as a sentinel like 0 or Infinity, both
   * of which arithmetic would treat as a window.
   *
   * The four choices themselves are NOT listed here. They live in
   * `features/search/places.ts` as `EXPIRY_DAYS_CHOICES`, beside the expiry
   * function that reads them, because a second copy of the list is a second
   * place a fifth option would have to be added and the one that gets forgotten
   * is always the copy furthest from the rule.
   */
  readonly keepPlacesDays: number | null;
  /**
   * WHETHER THE APP TAKES THE WHOLE SCREEN ON LAUNCH.
   *
   * It always did, and nobody was asked. `armImmersive` fired on the first
   * touch of every session, so the status bar - the clock, the battery, the
   * signal - vanished on a phone somebody was about to drive with. That was
   * reported as the single most common complaint about the app.
   *
   * DEFAULTS TO FALSE, and the default is the important half. A driver who
   * never opens onboarding, never finds this switch and never touches anything
   * keeps their status bar. Full screen is now something you ask for, in two
   * places - the first-run row and the map panel - rather than something that
   * happens to you.
   *
   * The map panel's full-screen toggle is unaffected: that is a deliberate
   * press, and this only governs whether the app grabs the screen on its own.
   */
  readonly immersiveOnLaunch: boolean;
  /**
   * Draw roadwork and closures over the map.
   *
   * OFF by default, and it must stay that way. It is a second data layer with
   * its own coverage and its own staleness, and a driver who never turned it on
   * must never be able to mistake its silence for a clear road. Opting in is
   * how somebody learns it exists and therefore learns what it does not cover.
   */
  readonly showHazards: boolean;
  /**
   * Count documented abuse in the nearby query, and let the dock resolve which
   * county you are in.
   *
   * ON by default. IT NEEDS NO GEOMETRY, which an earlier draft of this got
   * wrong: abuse is recorded per COUNTY, so the question is point-in-county and
   * `services/records/countyLocate.ts` already answers exactly that - the same
   * mechanism MISUSE's `Near me` chip runs on. `useDockState` reads
   * `locateLoaded`, whose contract is "already-loaded answer, never fetches",
   * so this is real without making the dock the surface that pulls the index.
   *
   * There is deliberately NO `showAbuseAreas` beside it. Owner call: a case
   * carries a FIPS and no coordinate, and a red-washed 480 square mile county
   * tells a driver nothing they can act on. The row was removed rather than
   * shipped inert or backed by county rings.
   */
  readonly abuseNearMe: boolean;
  /**
   * Raise the alert card on entering a county that has a record.
   *
   * OFF by default, as brief 4 draws it, and that is a BEHAVIOUR CHANGE rather
   * than a new capability: `services/alerts/delivery.ts` fires `considerAbuse`
   * for every driver entering a recorded county today, gated only by the mute.
   * After this an existing install stops getting those cards until somebody
   * opts in.
   */
  readonly abuseAlertOnEntry: boolean;
  /** Name the agency in the alert body instead of "documented abuse area". */
  readonly abuseNameAgency: boolean;
  /**
   * How much the floating chrome blurs what is behind it.
   *
   * A real preference rather than a fixed token: the blur is the loudest thing
   * about v1 and the most expensive thing the app paints, so a driver on a
   * slower phone - or one who finds it mushy over a busy map - can turn it
   * down. See `app/glass.ts`.
   */
  readonly glass: FwmGlass;
  /**
   * REFRACTION, a separate switch from frost.
   *
   * Not a fifth frost level: frost scatters what is behind a panel and this
   * bends it, so a driver can want one without the other. See `app/glass.ts`.
   */
  readonly liquid: FwmLiquid;
  /** Which basemap cartography the map draws. See `app/mapView.ts`. */
  readonly mapView: FwmMapView;
  /** Straight down, or tilted along the road. See `app/mapTilt.ts`. */
  readonly mapTilt: FwmMapTilt;
  /** How much shows THROUGH the chrome. Separate from the blur. */
  readonly clear: FwmClear;
  /** WHAT the glass is made of - clear light, or the theme's colour. */
  readonly tone: FwmGlassTone;
  /**
   * Whether the material is lit and raised, or a plain filled panel.
   *
   * A modifier over the other four rather than a step in any of them: it takes
   * the rim, the sheen and the cast shadow away and leaves the blur, the alpha
   * and the channel exactly where the driver set them. Stored separately for
   * that reason - turning flat off has to give back the liquid glass that was
   * chosen before it, and a value folded into another axis cannot remember
   * one. See `app/glass.ts`.
   */
  readonly flat: FwmFlat;
  /**
   * THE MAP'S GROUND, WHEN THE DRIVER HAS PICKED ONE. `null` means the theme's.
   *
   * Six-digit hex or nothing - `app/mapEarth.ts` explains why the shorthand and
   * `rgb()` forms are refused rather than accepted and silently mis-drawn. It
   * applies in EVERY theme, which is the whole point: the ground was too blue,
   * it will be somebody's judgement again in a month, and that judgement should
   * not need a commit.
   */
  readonly mapEarth: string | null;
  /**
   * DEMO DRIVE. Whether the position on the map is placed by hand.
   *
   * Persisted so the pad is still there after a reload mid-demo. The POSITION
   * is not - see `services/adapters/demoGeolocation.ts` for why a saved
   * coordinate is the one thing in that module worth stealing.
   */
  readonly demoDrive: boolean;
  /**
   * Whether the map turns to face the direction of travel.
   *
   * OFF -- NORTH UP -- is the default, by owner decision 2026-09-08. This
   * reverses the 2026-09-06 decision that made it ON, and both arguments are
   * kept because the reversal is the interesting part.
   *
   * FOR HEADING-UP, 2026-09-06: this is a driving app used in a mount, every
   * mapping app a driver has ever used turns with them, and north up is the
   * setting people go looking for rather than the one they expect to find.
   *
   * FOR NORTH-UP, 2026-09-08, and it is the stronger case: a rotating map makes
   * every direction on screen mean something different from one second to the
   * next. The magnetometer in a steel car is noisy, so the world orients itself
   * by a few degrees continuously; north is the one orientation every label and
   * road name is drawn to be read against; and it is the frame the whole app
   * already speaks in - a camera FACING, a corridor BEARING and a detour
   * waypoint are all true-north values.
   *
   * The thing that decided it: demo drive's pad. Its arrows are screen
   * directions, and on a rotated map pressing RIGHT moved the marker UP. That
   * is not a demo bug, it is what a rotating map does to every directional
   * control in the product, and it will do it again to the next one.
   *
   * The compass and the vehicle arrow show the heading either way, so this
   * changes what turns, not what is known - and it is one row in MAP VIEW for
   * anyone who wants the map to turn with them.
   */
  readonly headingUpMap: boolean;
  /**
   * FORCE THE WIDE LAYOUT even when the viewport says portrait.
   *
   * For the phone that is physically sideways in a mount with Portrait Lock on:
   * the OS hands the browser a tall viewport, detection is right on the evidence
   * it has, and the driver is stuck looking at the wrong layout. `app/
   * forceLandscape.ts` carries the full argument, including why the switch also
   * asks the OS to rotate for real and why it still declares the surface when
   * that request is refused.
   *
   * OFF by default: detection is correct on every device that tells the truth,
   * which is nearly all of them.
   */
  readonly forceLandscape: boolean;
}

export interface SettingsState extends PersistedSettings {
  /**
   * Which owner class the MAP is currently DRAWING, or null for all of them.
   *
   * THIS IS NOT A FILTER ON ALERTING. `ownerTypesEnabled` above is the TRIAGE
   * filter and it governs which cameras are allowed to warn the driver. This
   * one governs which dots are painted, and nothing else: the engine keeps
   * assessing every camera, the drive card keeps measuring against every
   * camera, and the queue keeps counting every camera. The two must never be
   * merged, aliased, or read by the same component - a driver who narrowed the
   * picture to "police" and thereby stopped being warned about the HOA reader
   * ahead is the single worst thing this app could do, and it would look from
   * the outside like a filter working correctly.
   *
   * NOT PERSISTED, deliberately. It is absent from {@link PersistedSettings},
   * from `partialize` and from `mergePersistedSettings`, and `reset()` clears
   * it explicitly. DEFAULT_SETTINGS' own comment states the rule this follows:
   * a tool that silently hides cameras on first run has lied to the driver
   * about what is out there. A drawing filter that survived a cold start would
   * be that same lie a day later - filtered to police last Tuesday, opens the
   * app on Friday with the HOA readers gone and no memory of asking. `mapView`
   * persists safely because no cartography can hide a camera. This one can.
   * Every session starts at "all owners".
   *
   * Single-select rather than a record of booleans because null is the only
   * value that means "everything, including the cameras whose owner is
   * unrecorded"; a `Record<CameraOwnerType, boolean>` needs a sixth key to say
   * the same thing.
   */
  readonly mapOwnerFilter: CameraOwnerType | null;
  /** False until the stored blob has been read back (or found absent). */
  readonly hydrated: boolean;
  /** False when a reload will lose these settings. Screens may render it. */
  readonly durable: boolean;
  /** Why persistence is not durable, when it is not. */
  readonly durabilityReason: string | null;
}

export interface SettingsActions {
  setThresholdFt(thresholdFt: number): void;
  /** Nudge by whole bezel steps. Returns the threshold actually applied. */
  stepThresholdFt(steps: number): number;
  muteAll(nowMs: number, durationMs?: number): void;
  unmuteAll(): void;
  muteCamera(cameraId: string, nowMs: number, durationMs?: number): void;
  unmuteCamera(cameraId: string): void;
  /** Drop expired per-camera mutes. Called from the tick, never from a timer. */
  pruneMutes(nowMs: number): void;
  setReAlertWhenCloserThanFt(distanceFt: number): void;
  setOwnerTypeEnabled(ownerType: CameraOwnerType, enabled: boolean): void;
  /**
   * Choose the owner class the map DRAWS, or null to draw all of them.
   *
   * Display only. See {@link SettingsState.mapOwnerFilter}. Note the name: it
   * is not a `setOwnerType*` sibling of `setOwnerTypeEnabled`, and must not
   * become one, because the whole safety property here is that the two filters
   * stay tellable apart at every call site.
   */
  setMapOwnerFilter(owner: CameraOwnerType | null): void;
  setHideUnverified(hide: boolean): void;
  setWifiOnlySync(wifiOnly: boolean): void;
  completeOnboarding(atMs: number): void;
  /**
   * Turn the app's USE of a capability on or off. Not the OS grant - see
   * `capabilitiesEnabled` for why those are two different things.
   */
  setCapabilityEnabled(name: GatedCapability, on: boolean): void;
  setVibration(on: boolean): void;
  setAudio(on: boolean): void;
  setWakeLock(on: boolean): void;
  setNotifyWhenParked(on: boolean): void;
  setShowHandle(on: boolean): void;
  setMode(mode: FwmMode): void;
  setTextScale(scale: TextScale): void;
  setTypeface(face: Typeface): void;
  /** Merge nearby cameras into counted clusters. See `clusterCameras`. */
  setClusterCameras(on: boolean): void;
  /** Write started routes down at all. See `rememberPlaces`. */
  setRememberPlaces(on: boolean): void;
  /** How long a recent survives its last use. `null` is never. */
  setKeepPlacesDays(days: number | null): void;
  /** Take the whole screen on launch. Off by default. See `immersiveOnLaunch`. */
  setImmersiveOnLaunch(on: boolean): void;
  setAbuseNearMe(on: boolean): void;
  setAbuseAlertOnEntry(on: boolean): void;
  setAbuseNameAgency(on: boolean): void;
  /** Draw roadwork and closures. See `showHazards`. */
  setShowHazards(on: boolean): void;
  /** Turn the map to face the direction of travel. See `headingUpMap`. */
  setHeadingUpMap(on: boolean): void;
  /** Declare the wide layout regardless of the viewport. See `forceLandscape`. */
  setForceLandscape(on: boolean): void;
  /** How much the floating chrome blurs. See `app/glass.ts`. */
  setGlass(glass: FwmGlass): void;
  /** Whether panels refract as well as frost. See `app/glass.ts`. */
  setLiquid(liquid: FwmLiquid): void;
  /** Which basemap cartography the map draws. */
  setMapView(view: FwmMapView): void;
  setMapTilt(tilt: FwmMapTilt): void;
  /** How much shows through the chrome. */
  setClear(clear: FwmClear): void;
  setTone(tone: FwmGlassTone): void;
  /** Whether the material is lit and raised, or plain. See `app/glass.ts`. */
  setFlat(flat: FwmFlat): void;
  /** The map's ground colour, or `null` to go back to the theme's own. */
  setMapEarth(colour: string | null): void;
  /** Turn hand-placed positioning on or off. */
  setDemoDrive(on: boolean): void;
  /** Note the durability of the installed persist port. */
  refreshDurability(): void;
  /** Called by the persist middleware once the stored blob has been read. */
  markHydrated(): void;
  /** Back to defaults, in memory. Does not by itself clear the stored blob. */
  reset(): void;
}

export type SettingsStore = SettingsState & SettingsActions;

const ALL_OWNERS_ENABLED: Readonly<Record<CameraOwnerType, boolean>> = Object.freeze({
  police: true,
  inter_agency: true,
  hoa: true,
  private: true,
  unverified: true,
});

const NO_MUTED_CAMERAS: Readonly<Record<string, number>> = Object.freeze({});

/**
 * Defaults.
 *
 * Every filter starts ON. A tool that silently hides cameras on first run has
 * lied to the driver about what is out there; TRIAGE is fatigue control the
 * user opts into, and B4 states the projection as "4, down from 19 WITH
 * CURRENT FILTERS", which only reads as a choice if the unfiltered number was
 * ever true.
 */
/**
 * The three capabilities a driver can switch off in the app.
 *
 * Named separately from `AdapterName`, which spans fifteen entries most of
 * which are not permissions and have no switch. Widening this set means
 * writing the gate that honours it; a name here with no gate would be a switch
 * that does nothing, which is the bug this whole change exists to fix.
 */
export type GatedCapability = 'geolocation' | 'notifications' | 'motion';

const GATED_CAPABILITIES: readonly GatedCapability[] = ['geolocation', 'notifications', 'motion'];

/**
 * Rehydrate the switches, defaulting each one ON independently.
 *
 * Per-key rather than all-or-nothing: a stored bag written before this
 * preference existed has none of the three, and a bag written by a later build
 * may have more. Either way every key the app knows about resolves, and a
 * corrupt entry falls back to on rather than silently disabling a sensor the
 * driver never asked to disable.
 */
function readCapabilitiesEnabled(value: unknown): Readonly<Record<GatedCapability, boolean>> {
  const bag = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const out: Record<GatedCapability, boolean> = {
    geolocation: true,
    notifications: true,
    motion: true,
  };
  for (const name of GATED_CAPABILITIES) {
    out[name] = readBoolean(bag[name], true);
  }
  return Object.freeze(out);
}

export const DEFAULT_SETTINGS: PersistedSettings = Object.freeze({
  thresholdFt: DEFAULT_ALERT_THRESHOLD_FT,
  mutedUntilMs: null,
  mutedCameras: NO_MUTED_CAMERAS,
  reAlertWhenCloserThanFt: DEFAULT_RE_ALERT_WHEN_CLOSER_THAN_FT,
  ownerTypesEnabled: ALL_OWNERS_ENABLED,
  hideUnverified: false,
  wifiOnlySync: true,
  onboardingCompletedAtMs: null,
  capabilitiesEnabled: Object.freeze({ geolocation: true, notifications: true, motion: true }),
  vibration: true,
  audio: true,
  wakeLock: true,
  notifyWhenParked: true,
  showHandle: false,
  mode: DEFAULT_MODE,
  textScale: DEFAULT_TEXT_SCALE,
  typeface: DEFAULT_TYPEFACE,
  glass: DEFAULT_GLASS,
  liquid: DEFAULT_LIQUID,
  mapView: DEFAULT_MAP_VIEW,
  mapTilt: DEFAULT_MAP_TILT,
  clear: DEFAULT_CLEAR,
  tone: DEFAULT_TONE,
  flat: DEFAULT_FLAT,
  /* The theme's own ground, which is now the same dark one in both themes. */
  mapEarth: null,
  // Off. A demo control that is on by default is a bug in somebody's car.
  demoDrive: false,
  /**
   * OFF by default.
   *
   * The old default was on, reasoning that the first thing a new install shows
   * is a whole metro and a scatter of nine hundred dots is unreadable. True of
   * the FIRST SCREEN and wrong about every screen after it: the map opens at
   * the driving zoom, where clustering replaces the individual poles a driver
   * is actually looking for with a number, and a count cannot be tapped for an
   * intel card.
   *
   * The zoom already handles the wide case on its own -- `heatLayer` draws the
   * far field below `POINT_MIN_ZOOM` whether or not clustering is on, so
   * zooming out to a state still gives a readable picture rather than a
   * thousand dots. Clustering is the preference for people who want the count;
   * it is not the thing that makes the wide view work.
   */
  clusterCameras: false,
  // ON, and the reason is on the field above rather than here: the record never
  // leaves the phone and the panel exists to open to it.
  rememberPlaces: true,
  // NINETY, which is the spec's own default and not a rounding of it.
  keepPlacesDays: EXPIRY_DAYS_DEFAULT,
  // OFF. The app used to take the screen without asking; see `immersiveOnLaunch`.
  immersiveOnLaunch: false,
  // Off until asked for. See `showHazards`.
  showHazards: false,
  abuseNearMe: true,
  abuseAlertOnEntry: false,
  abuseNameAgency: true,
  // Heading up. See `headingUpMap` for why that is the default rather than a
  // neutral choice, and for the argument it overrules.
  headingUpMap: false,
  // Detection decides. See `forceLandscape`.
  forceLandscape: false,
});

// ---------------------------------------------------------------------------
// Validation of anything read back from disk
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readOwnerTypes(value: unknown): Readonly<Record<CameraOwnerType, boolean>> {
  if (value === null || typeof value !== 'object') return ALL_OWNERS_ENABLED;
  const bag = value as Record<string, unknown>;
  const out: Record<CameraOwnerType, boolean> = { ...ALL_OWNERS_ENABLED };
  for (const owner of OWNER_TYPES) {
    const stored = bag[owner];
    if (typeof stored === 'boolean') out[owner] = stored;
  }
  return Object.freeze(out);
}

function readMutedCameras(value: unknown): Readonly<Record<string, number>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return NO_MUTED_CAMERAS;
  const out: Record<string, number> = {};
  for (const [cameraId, until] of Object.entries(value as Record<string, unknown>)) {
    if (isFiniteNumber(until)) out[cameraId] = until;
  }
  return Object.freeze(out);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

/**
 * A `Keep for` value, snapped to one of the four the picker offers.
 *
 * `null` IS A VALUE AND NOT AN ABSENCE. It means NEVER, it is one of the four
 * choices, and it must round-trip through both this and {@link readKeepDays}
 * untouched. The whole reason the two functions are separate is that they
 * disagree about `undefined`: a write of `undefined` is a caller mistake and
 * snaps to the default here, while a rehydrate of `undefined` is a blob written
 * before the setting existed and takes the default there. Only `null` survives
 * both, which is what makes "never" durable.
 */
function resolveKeepDays(value: unknown): number | null {
  if (value === null) return null;
  return isFiniteNumber(value) && EXPIRY_DAYS_CHOICES.includes(value)
    ? value
    : EXPIRY_DAYS_DEFAULT;
}

/** The same value read back off disk. See {@link resolveKeepDays}. */
function readKeepDays(value: unknown): number | null {
  if (value === null) return null;
  if (value === undefined) return EXPIRY_DAYS_DEFAULT;
  return resolveKeepDays(value);
}

/**
 * Merge a stored blob over the defaults, one guarded field at a time.
 *
 * The default shallow merge would take anything the blob happened to contain,
 * including a threshold of `"500"` or a mode this build does not have. A guard
 * per field costs a line and turns "the app crashed on boot" into "that setting
 * was ignored".
 */
export function mergePersistedSettings(stored: unknown): PersistedSettings {
  if (stored === null || typeof stored !== 'object') return DEFAULT_SETTINGS;
  const bag = stored as Record<string, unknown>;
  const thresholdRaw = bag['thresholdFt'];
  const threshold =
    isFiniteNumber(thresholdRaw) &&
    thresholdRaw >= ALERT_THRESHOLD_MIN_FT &&
    thresholdRaw <= ALERT_THRESHOLD_MAX_FT
      ? thresholdRaw
      : DEFAULT_SETTINGS.thresholdFt;
  const reAlertRaw = bag['reAlertWhenCloserThanFt'];
  const modeRaw = bag['mode'];
  return Object.freeze({
    thresholdFt: threshold,
    mutedUntilMs: readNullableNumber(bag['mutedUntilMs']),
    mutedCameras: readMutedCameras(bag['mutedCameras']),
    reAlertWhenCloserThanFt:
      isFiniteNumber(reAlertRaw) && reAlertRaw >= 0
        ? reAlertRaw
        : DEFAULT_SETTINGS.reAlertWhenCloserThanFt,
    ownerTypesEnabled: readOwnerTypes(bag['ownerTypesEnabled']),
    hideUnverified: readBoolean(bag['hideUnverified'], DEFAULT_SETTINGS.hideUnverified),
    wifiOnlySync: readBoolean(bag['wifiOnlySync'], DEFAULT_SETTINGS.wifiOnlySync),
    onboardingCompletedAtMs: readNullableNumber(bag['onboardingCompletedAtMs']),
    capabilitiesEnabled: readCapabilitiesEnabled(bag['capabilitiesEnabled']),
    vibration: readBoolean(bag['vibration'], DEFAULT_SETTINGS.vibration),
    audio: readBoolean(bag['audio'], DEFAULT_SETTINGS.audio),
    wakeLock: readBoolean(bag['wakeLock'], DEFAULT_SETTINGS.wakeLock),
    notifyWhenParked: readBoolean(bag['notifyWhenParked'], DEFAULT_SETTINGS.notifyWhenParked),
    showHandle: readBoolean(bag['showHandle'], DEFAULT_SETTINGS.showHandle),
    mode: isFwmMode(modeRaw) ? modeRaw : DEFAULT_SETTINGS.mode,
    textScale: isTextScale(bag['textScale']) ? bag['textScale'] : DEFAULT_SETTINGS.textScale,
    typeface: resolveTypeface(bag['typeface']),
    // Absent in a blob written before this setting existed, which must read as
    // the default rather than as false -- an upgrade should not silently turn
    // clustering off for everyone who already had the app.
    clusterCameras: bag['clusterCameras'] === undefined
      ? DEFAULT_SETTINGS.clusterCameras
      : bag['clusterCameras'] === true,
    // `readBoolean(..., DEFAULT)` and not `=== true`: an install predating this
    // switch has no key for it, and must keep remembering places rather than
    // silently stop - a person whose history quietly stopped growing after an
    // update would have no way to tell that from having driven nowhere new.
    rememberPlaces: readBoolean(bag['rememberPlaces'], DEFAULT_SETTINGS.rememberPlaces),
    /*
     * `null` SURVIVES THE READ, because `null` is NEVER and losing it would
     * turn "keep these forever" into "delete them in ninety days" on the next
     * cold start - a data loss caused by a rehydrate, which is the worst class
     * of bug this validator exists to prevent. Only `undefined` (no key) and a
     * value that is neither null nor a finite number fall back to the default.
     */
    keepPlacesDays: readKeepDays(bag['keepPlacesDays']),
    /*
     * An installed app that predates this switch has no key for it, and gets
     * OFF - the new default - rather than keeping the behaviour it had. That is
     * the intent: the old behaviour is the thing being complained about, and
     * carrying it forward for existing installs would fix it for nobody who
     * already has the app.
     */
    immersiveOnLaunch: readBoolean(bag['immersiveOnLaunch'], DEFAULT_SETTINGS.immersiveOnLaunch),
    showHazards: bag['showHazards'] === true,
    /* `readBoolean(..., DEFAULT)` and not `=== true`: an install predating these
       switches must keep the published default rather than be silently forced
       off, which is what a bare truthiness read would do to the two that
       default ON. */
    abuseNearMe: readBoolean(bag['abuseNearMe'], DEFAULT_SETTINGS.abuseNearMe),
    abuseAlertOnEntry: readBoolean(bag['abuseAlertOnEntry'], DEFAULT_SETTINGS.abuseAlertOnEntry),
    abuseNameAgency: readBoolean(bag['abuseNameAgency'], DEFAULT_SETTINGS.abuseNameAgency),
    // Anything unreadable lands on the default rather than throwing the whole
    // blob away, same as every other field here.
    glass: resolveGlass(bag['glass']),
    liquid: resolveLiquid(bag['liquid']),
    mapView: resolveMapView(bag['mapView']),
    mapTilt: resolveMapTilt(bag['mapTilt']),
    clear: resolveClear(bag['clear']),
    tone: resolveTone(bag['tone']),
    flat: resolveFlat(bag['flat']),
    /* A stored colour from an older build that this one cannot parse resolves
       to null rather than throwing: a bad string must never be able to stop the
       app drawing a map. `isMapEarthColour` is the single judge. */
    mapEarth:
      typeof bag['mapEarth'] === 'string' && isMapEarthColour(bag['mapEarth'])
        ? bag['mapEarth']
        : null,
    demoDrive: bag['demoDrive'] === true,
    /*
     * ABSENT MEANS "NEVER CHOSE", NOT "CHOSE FALSE".
     *
     * This read `=== true`, which was correct while the default was false and
     * silently wrong the moment it became true: every install that had never
     * touched the row has no key on disk, so `=== true` would have handed back
     * `false` and quietly overruled the new default for exactly the people who
     * never expressed a preference. A stored `false` is still honoured.
     */
    headingUpMap: typeof bag['headingUpMap'] === 'boolean'
      ? bag['headingUpMap']
      : DEFAULT_SETTINGS.headingUpMap,
    forceLandscape: bag['forceLandscape'] === true,
  });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const SETTINGS_STORAGE_KEY = 'fwm.settings';
/** Bump when a stored field changes meaning. `migrate` then re-reads it. */
export const SETTINGS_STORAGE_VERSION = 1;

export interface SettingsStoreOptions {
  readonly storageName?: string;
  readonly storage?: PersistStorage<PersistedSettings, Promise<void>>;
  /** Hydrate later with `store.persist.rehydrate()`. Tests use this. */
  readonly skipHydration?: boolean;
}

export function createSettingsStore(options: SettingsStoreOptions = {}) {
  const storage = options.storage ?? createGuardedPersistStorage<PersistedSettings>();

  return create<SettingsStore>()(
    persist(
      (set, get) => ({
        ...DEFAULT_SETTINGS,
        // Runtime-only, and starts at "all owners" on every launch. See the
        // field's doc comment for why this one must not be spread out of
        // DEFAULT_SETTINGS like everything above it.
        mapOwnerFilter: null,
        hydrated: false,
        durable: isPersistDurable(),
        durabilityReason: null,

        setThresholdFt(thresholdFt) {
          // Out of range is a caller bug, not a value to clamp: the slider goes
          // 25 to 5280 and the bezel steps in 50s inside that, so anything else
          // means the caller invented a threshold the driver could not have
          // chosen.
          assertThresholdFt(thresholdFt);
          set({ thresholdFt });
        },

        stepThresholdFt(steps) {
          const raw = get().thresholdFt + steps * ALERT_THRESHOLD_STEP_FT;
          const bounded = Math.min(
            ALERT_THRESHOLD_MAX_FT,
            Math.max(ALERT_THRESHOLD_MIN_FT, snapThresholdFt(raw)),
          );
          set({ thresholdFt: bounded });
          return bounded;
        },

        muteAll(nowMs, durationMs = DEFAULT_MUTE_DURATION_MS) {
          set({ mutedUntilMs: nowMs + durationMs });
        },

        unmuteAll() {
          set({ mutedUntilMs: null });
        },

        muteCamera(cameraId, nowMs, durationMs = DEFAULT_MUTE_DURATION_MS) {
          set({
            mutedCameras: Object.freeze({
              ...get().mutedCameras,
              [cameraId]: nowMs + durationMs,
            }),
          });
        },

        unmuteCamera(cameraId) {
          const current = get().mutedCameras;
          if (!Object.hasOwn(current, cameraId)) return;
          // Rebuilt rather than deleted: `delete` on a computed key is banned by
          // the lint config, and copy-without is clearer about the result anyway.
          const next: Record<string, number> = {};
          for (const [id, until] of Object.entries(current)) {
            if (id !== cameraId) next[id] = until;
          }
          set({ mutedCameras: Object.freeze(next) });
        },

        pruneMutes(nowMs) {
          const state = get();
          const expiredGlobal = state.mutedUntilMs !== null && state.mutedUntilMs <= nowMs;
          const live: Record<string, number> = {};
          let dropped = 0;
          for (const [cameraId, until] of Object.entries(state.mutedCameras)) {
            if (until > nowMs) live[cameraId] = until;
            else dropped++;
          }
          if (!expiredGlobal && dropped === 0) return;
          set({
            mutedUntilMs: expiredGlobal ? null : state.mutedUntilMs,
            mutedCameras: dropped === 0 ? state.mutedCameras : Object.freeze(live),
          });
        },

        setReAlertWhenCloserThanFt(distanceFt) {
          if (!Number.isFinite(distanceFt) || distanceFt < 0) {
            throw new RangeError(
              `settings: reAlertWhenCloserThanFt must be finite and >= 0, received ${String(distanceFt)}`,
            );
          }
          set({ reAlertWhenCloserThanFt: distanceFt });
        },

        setOwnerTypeEnabled(ownerType, enabled) {
          set({
            ownerTypesEnabled: Object.freeze({ ...get().ownerTypesEnabled, [ownerType]: enabled }),
          });
        },

        setMapOwnerFilter(owner) {
          set({ mapOwnerFilter: owner });
        },

        setHideUnverified(hide) {
          set({ hideUnverified: hide });
        },

        setWifiOnlySync(wifiOnly) {
          set({ wifiOnlySync: wifiOnly });
        },

        completeOnboarding(atMs) {
          set({ onboardingCompletedAtMs: atMs });
        },

        setCapabilityEnabled(name, on) {
          set({
            capabilitiesEnabled: Object.freeze({ ...get().capabilitiesEnabled, [name]: on }),
          });
        },

        setVibration(on) {
          set({ vibration: on });
        },

        setAudio(on) {
          set({ audio: on });
        },

        setWakeLock(on) {
          set({ wakeLock: on });
        },

        setNotifyWhenParked(on) {
          set({ notifyWhenParked: on });
        },

        setShowHandle(on) {
          set({ showHandle: on });
        },

        setMode(mode) {
          set({ mode });
        },

        setTextScale(scale) {
          // Snapped, not trusted: a value from a stale build or a hand-edited
          // store must land on an offered step rather than setting the root
          // font to something nobody can read their way out of.
          set({ textScale: resolveTextScale(scale) });
        },

        setTypeface(face: unknown) {
          set({ typeface: resolveTypeface(face) });
        },

        setClusterCameras(on: unknown) {
          set({ clusterCameras: on === true });
        },

        setRememberPlaces(on: unknown) {
          set({ rememberPlaces: on === true });
        },

        setKeepPlacesDays(days: unknown) {
          // SNAPPED TO AN OFFERED CHOICE, the same rule `setTextScale` follows
          // and for the same reason: a value that reached the store from a
          // stale render or a devtools poke must land on something the picker
          // can draw as selected, or the row shows a window nobody can select
          // their way out of.
          set({ keepPlacesDays: resolveKeepDays(days) });
        },

        setImmersiveOnLaunch(on: unknown) {
          set({ immersiveOnLaunch: on === true });
        },

        setShowHazards(on: unknown) {
          set({ showHazards: on === true });
        },

        setAbuseNearMe(on: unknown) {
          set({ abuseNearMe: on === true });
        },

        setAbuseAlertOnEntry(on: unknown) {
          set({ abuseAlertOnEntry: on === true });
        },

        setAbuseNameAgency(on: unknown) {
          set({ abuseNameAgency: on === true });
        },

        setGlass(glass: unknown) {
          set({ glass: resolveGlass(glass) });
        },

        setLiquid(liquid: unknown) {
          set({ liquid: resolveLiquid(liquid) });
        },

        setMapView(view: unknown) {
          set({ mapView: resolveMapView(view) });
        },

        setMapTilt(tilt: unknown) {
          set({ mapTilt: resolveMapTilt(tilt) });
        },

        setClear(clear: unknown) {
          set({ clear: resolveClear(clear) });
        },

        setTone(tone: unknown) {
          set({ tone: resolveTone(tone) });
        },

        setFlat(flat: unknown) {
          set({ flat: resolveFlat(flat) });
        },

        setMapEarth(colour: unknown) {
          const value =
            typeof colour === 'string' && isMapEarthColour(colour) ? colour : null;
          set({ mapEarth: value });
          applyMapEarth(value);
        },

        setDemoDrive(on: unknown) {
          set({ demoDrive: on === true });
        },

        setHeadingUpMap(on: unknown) {
          set({ headingUpMap: on === true });
        },

        setForceLandscape(on: unknown) {
          const value = on === true;
          set({ forceLandscape: value });
          // Store first, then apply, the same order `setMapEarth` uses: the
          // declaration is what makes the layout change on the press rather
          // than one paint later, and it must not outlive a failed write.
          applyForceLandscape(value);
        },

        refreshDurability() {
          const port = getPersistPort();
          set({
            durable: port.durable,
            durabilityReason: port.durable ? null : (port.reason ?? null),
          });
        },

        markHydrated() {
          set({ hydrated: true });
        },

        reset() {
          // mapOwnerFilter is named explicitly because DEFAULT_SETTINGS is
          // PersistedSettings and does not carry it; spreading alone would
          // leave a runtime-only field standing through a reset that the
          // driver asked for precisely to get everything back.
          set({ ...DEFAULT_SETTINGS, mapOwnerFilter: null });
        },
      }),
      {
        name: options.storageName ?? SETTINGS_STORAGE_KEY,
        version: SETTINGS_STORAGE_VERSION,
        storage,
        skipHydration: options.skipHydration ?? false,
        partialize: (state): PersistedSettings => ({
          mapEarth: state.mapEarth,
          demoDrive: state.demoDrive,
          thresholdFt: state.thresholdFt,
          mutedUntilMs: state.mutedUntilMs,
          mutedCameras: state.mutedCameras,
          reAlertWhenCloserThanFt: state.reAlertWhenCloserThanFt,
          ownerTypesEnabled: state.ownerTypesEnabled,
          hideUnverified: state.hideUnverified,
          wifiOnlySync: state.wifiOnlySync,
          onboardingCompletedAtMs: state.onboardingCompletedAtMs,
          capabilitiesEnabled: state.capabilitiesEnabled,
          vibration: state.vibration,
          audio: state.audio,
          wakeLock: state.wakeLock,
          notifyWhenParked: state.notifyWhenParked,
          showHandle: state.showHandle,
          mode: state.mode,
          textScale: state.textScale,
          typeface: state.typeface,
          clusterCameras: state.clusterCameras,
          rememberPlaces: state.rememberPlaces,
          keepPlacesDays: state.keepPlacesDays,
          immersiveOnLaunch: state.immersiveOnLaunch,
          showHazards: state.showHazards,
          abuseNearMe: state.abuseNearMe,
          abuseAlertOnEntry: state.abuseAlertOnEntry,
          abuseNameAgency: state.abuseNameAgency,
          headingUpMap: state.headingUpMap,
          forceLandscape: state.forceLandscape,
          glass: state.glass,
          liquid: state.liquid,
          mapView: state.mapView,
          mapTilt: state.mapTilt,
          clear: state.clear,
          tone: state.tone,
          flat: state.flat,
        }),
        merge: (persisted, current): SettingsStore => ({
          ...current,
          ...mergePersistedSettings(persisted),
        }),
        // `state` here is THIS store's state, actions bound to THIS store - so
        // a second instance created by a test hydrates itself and never writes
        // into the module singleton below.
        onRehydrateStorage: () => (state) => {
          state?.refreshDurability();
          // `hasHydrated()` is zustand's own flag; this mirror exists so a
          // component can read it with a selector instead of a store method.
          state?.markHydrated();
        },
      },
    ),
  );
}

export const useSettingsStore = createSettingsStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Screens read these, never the raw shape. Each returns a primitive or a value
 * stored by reference, so an unrelated write cannot cause a re-render.
 */
export const useAlertThresholdFt = (): number => useSettingsStore((s) => s.thresholdFt);
export const useOwnerTypesEnabled = (): Readonly<Record<CameraOwnerType, boolean>> =>
  useSettingsStore((s) => s.ownerTypesEnabled);
export const useHideUnverified = (): boolean => useSettingsStore((s) => s.hideUnverified);
export const useWifiOnlySync = (): boolean => useSettingsStore((s) => s.wifiOnlySync);
export const useCapabilityEnabled = (name: GatedCapability): boolean =>
  useSettingsStore((s) => s.capabilitiesEnabled[name]);

/** Read outside React - the sensor runtime is not a component. */
export const capabilityEnabled = (name: GatedCapability): boolean =>
  useSettingsStore.getState().capabilitiesEnabled[name];

export const useVibrationEnabled = (): boolean => useSettingsStore((s) => s.vibration);
export const useAudioEnabled = (): boolean => useSettingsStore((s) => s.audio);
export const useWakeLockEnabled = (): boolean => useSettingsStore((s) => s.wakeLock);
export const useNotifyWhenParked = (): boolean => useSettingsStore((s) => s.notifyWhenParked);
export const useShowHandle = (): boolean => useSettingsStore((s) => s.showHandle);
/* The three abuse switches. See their fields for why there is no fourth. */
export const useAbuseNearMe = (): boolean => useSettingsStore((s) => s.abuseNearMe);
export const useAbuseAlertOnEntry = (): boolean => useSettingsStore((s) => s.abuseAlertOnEntry);
export const useAbuseNameAgency = (): boolean => useSettingsStore((s) => s.abuseNameAgency);
export const useFwmMode = (): FwmMode => useSettingsStore((s) => s.mode);
export const useTextScale = (): TextScale => useSettingsStore((s) => s.textScale);
export const useTypeface = (): Typeface => useSettingsStore((s) => s.typeface);
export const useGlass = (): FwmGlass => useSettingsStore((s) => s.glass);
export const useLiquid = (): FwmLiquid => useSettingsStore((s) => s.liquid);
export const useMapView = (): FwmMapView => useSettingsStore((s) => s.mapView);
/**
 * Which owner class the map draws. Null draws all of them.
 *
 * Drawing only - never read this to decide whether to alert, to measure, or to
 * count. `useOwnerTypesEnabled` is the alerting filter.
 */
export const useMapOwnerFilter = (): CameraOwnerType | null =>
  useSettingsStore((s) => s.mapOwnerFilter);
export const useMapTilt = (): FwmMapTilt => useSettingsStore((s) => s.mapTilt);
export const useClear = (): FwmClear => useSettingsStore((s) => s.clear);
export const useImmersiveOnLaunch = (): boolean =>
  useSettingsStore((s) => s.immersiveOnLaunch);
export const useTone = (): FwmGlassTone => useSettingsStore((s) => s.tone);
export const useFlat = (): FwmFlat => useSettingsStore((s) => s.flat);
export const useSettingsHydrated = (): boolean => useSettingsStore((s) => s.hydrated);
export const useSettingsDurable = (): boolean => useSettingsStore((s) => s.durable);
export const useOnboardingComplete = (): boolean =>
  useSettingsStore((s) => s.onboardingCompletedAtMs !== null);

/** Is anything muted right now? Evaluated against a caller-supplied clock. */
export function isGloballyMutedAt(state: PersistedSettings, nowMs: number): boolean {
  return state.mutedUntilMs !== null && state.mutedUntilMs > nowMs;
}

export function isCameraMutedAt(
  state: PersistedSettings,
  cameraId: string,
  nowMs: number,
): boolean {
  if (isGloballyMutedAt(state, nowMs)) return true;
  const until = state.mutedCameras[cameraId];
  return until !== undefined && until > nowMs;
}

/** Milliseconds left on the global mute - the "MUTED 8:12" readout. */
export function globalMuteRemainingMs(state: PersistedSettings, nowMs: number): number {
  if (state.mutedUntilMs === null) return 0;
  return Math.max(0, state.mutedUntilMs - nowMs);
}
