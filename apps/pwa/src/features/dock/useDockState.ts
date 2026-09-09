/**
 * WHICH PANE THE DOCK IS IN, WHICH STATE, AND WHAT GOES IN ITS SLOTS.
 *
 * `dockState.ts` is the vocabulary -- three heights, the collapsed fourteen,
 * the navigation six, the three sheets, the density ramp. `dockv3.dc.html` is
 * the drawing. This file is the only place that DERIVES one from the app's own
 * stores, so a state cannot be reached two ways and cannot mean two things.
 *
 * =============================================================================
 * NOTHING HERE INVENTS A SIGNAL
 * =============================================================================
 * Every value below comes from a store this app already writes or from a pure
 * helper it already ships. Where the spec draws a value the app cannot produce,
 * the field is LEFT OFF rather than filled with a plausible one -- an absent
 * field renders as an absence, and a made-up one renders as a fact.
 *
 * FIVE STATES ARE UNREACHABLE AND ARE DELIBERATELY NOT FAKED:
 *
 *   E1 ROUTE PROPOSED     nearly. The spec's trigger is a line that exists and
 *                         has not been STARTED, and this build has no start:
 *                         `routeActions.planned` publishes the route and the
 *                         map draws it in the same tick. What is left of the
 *                         state is honest and rare -- a route is ready and no
 *                         position on it can be computed yet -- and that is the
 *                         only way the ladder reaches it. Its `Start` key is
 *                         fixed by `DriveRows.NAV_SHAPE` rather than by data
 *                         and `ShellDock` leaves it unwired; see the report.
 *   F2 ROUTE CHOICE       needs two lines at once. `planDarkRoute` returns one,
 *                         and the plain baseline it used to be priced against
 *                         is not planned any more -- `DriveScreen` deleted the
 *                         second round trip. Nothing in this build ever holds
 *                         two routes, so there is no choice to draw.
 *   17 REROUTED           the v2 id for a SYSTEM-initiated reroute. Section E's
 *                         REROUTING is what a re-plan draws now, and it is
 *                         reached from `status === 'planning'`, which is a
 *                         press. There is still no automatic reroute.
 *   18 UNMAPPED           needs an ANOMALY: something that looks like a reader
 *                         where the archive has none. Nothing in this build
 *                         detects one, and the hold-to-drop-pin gesture that
 *                         would raise it is disarmed in production.
 *   14 ABUSE, ENTERING    fires only when the county index has loaded AND the
 *                         record carries an outlet and a date. See `sourceGate`
 *                         -- it is a gate, not a formatting step.
 *
 * =============================================================================
 * THE LADDER IS THIS FILE'S OWN, AND THE SPEC SETTLES ITS FIRST BRANCH
 * =============================================================================
 * The spec draws every state side by side and never says which wins when two
 * are true at once -- muted AND dense, offline AND gps-weak, passing a camera
 * AND mid-turn. A renderer needs one answer, so `deriveState` fixes an order
 * and writes it down.
 *
 * THE FIRST BRANCH IS NOT A JUDGEMENT. Section E's own caption calls the
 * navigation family "the single source for every routed state", so a route
 * running means one of the six, and a reader on the line is E3 rather than a
 * drop to the 150px UNDER SURVEILLANCE card. That is also rule 5: three locked
 * heights, and none of them changes while a drive state is active. Escalation
 * is colour, weight and the number.
 *
 * Below that branch the order is what a driver must not miss: the live camera
 * first, then the road, then the conditions, then the resting state. Changing
 * it is a design decision, not a refactor.
 *
 * =============================================================================
 * WHAT IT DOES NOT DO
 * =============================================================================
 * It fetches nothing, it starts no geolocation, and it never calls
 * `countyLocator.locate()` -- that is a network fetch of a polygon index, and
 * the dock is not the surface that should trigger one.
 *
 * IT DOES NOW READ `locateLoaded`, WHICH IS A DIFFERENT PROMISE. That method's
 * whole contract is "already-loaded answer, or null; never triggers a fetch",
 * so reading it keeps the rule above intact word for word while letting the
 * county resolve on any surface that has already paid for the index -- MISUSE's
 * `Near me` chip, or an abuse alert. Before this the county came only off the
 * nearest camera's own `countyFips`, and NOT ONE record in the shipped archive
 * carries that field, so the whole documented-abuse path was unreachable from
 * the dock: a dead read that looked like a working one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  useAbuseNearMe,
  useAccuracyM,
  useAlertStore,
  useCameraAssessments,
  useCamerasStore,
  useCurrentFix,
  useIsMuted,
  useIsOffline,
  useMuteRemainingMs,
  useNearbyDarkrouteCount,
  useSpeedMph,
} from '../../stores/index.ts';
import type { CameraAssessment, CameraOwnerType, CameraRecord } from '../../stores/index.ts';
import { useLastSyncAtMs } from '../../stores/sync.ts';
import {
  useDestination,
  usePlannedRoute,
  useRouteAvoiding,
  useRouteOnLine,
  useRouteStatus,
} from '../../stores/route.ts';
import type { PlannedRoute, RoutePoint, TurnKind } from '../../services/route/planRoute.ts';
import { nextManeuver } from '../../services/route/maneuvers.ts';
import { BACK_ON_ROUTE_FT, OFF_ROUTE_FT, feetOffRoute } from '../../services/route/announce.ts';
import { metresToSegmentSq } from '../../services/route/corridor.ts';
import { placeCase } from './placeCase.ts';
import { shortOperator } from '../intel/intelState.ts';
import { countyLocator } from '../../services/records/countyLocate.ts';
import { countyRecords } from '../../services/records/countyRecords.ts';
import { useCatalogueTotal } from '../../services/cameras/useCatalogueTotal.ts';
import { chipLabel, makerOf, mountOf } from '../intel/describe.ts';
import { facingCardinal } from '../report/reportDraft.ts';
import { formatCacheCount } from '../offline/format.ts';
import { MIN_MOVING_MPH, describeEta, etaSeconds } from '../drive/eta.ts';
import { clearedCount, describeDuration, readerCount } from '../drive/DestinationCard.tsx';
import type { DockNavData } from './DriveRows.tsx';
import type {
  DockNearbyData,
  DockNearbyOwner,
  DockNearbyRow,
  DockRouteChoiceData,
  DockTurnListData,
  DockTurnStep,
} from './ExpandedPanel.tsx';
import { DOCK_DENSITY_RADIUS_MI } from './dockState.ts';
import type {
  DockCollapsedStateId,
  DockData,
  DockExpandedStateId,
  DockExpandedViewId,
  DockNavStateId,
  DockTurn,
} from './dockState.ts';

/* ------------------------------------------------------------------------- *
 * THE NUMBERS THE SPEC ITSELF STATES
 *
 * Each of these is written in the spec's own caption for the thing it gates.
 * Nothing here is a threshold this file chose.
 * ------------------------------------------------------------------------- */

/**
 * Feet in a mile.
 *
 * Declared locally, which is not ideal and is the house's existing state:
 * `radar/corridor.ts`, `sweep/zoom.ts`, `zone-audit/zone.ts`, `alert/AlertV1`
 * and `map/MapViewPanel` each carry their own. `DriveScreen.miles()` is the
 * formatter this would otherwise import, and importing it would close a cycle
 * through a module that also default-mounts a screen.
 */
const FT_PER_MILE = 5280;

/** ARMED -- "camera within 5 mi". IDLE is the same line, negated. */
const ARMED_MI = 5;

/**
 * THE EXPOSURE HORIZON, AND THE DETOUR HORIZON, WHICH ARE ONE HORIZON.
 *
 * B2's subtitle is `cameras per 2 mi`, so the ramp's radius is the spec's. The
 * `Reroute around N` key on the same pane promises to route around N readers
 * and the number it says has to be the number the planner is handed, or the key
 * is lying -- so there is ONE set: `useDockState` counts it for the ramp and
 * the label, and `ShellDock` filters the live assessments through it at press
 * time and hands the result to `planDriveDetour`.
 *
 * TWO MILES ALSO BECAUSE THE PLANNER IS SIZED BY ITS FARTHEST INPUT.
 * `planDriveDetour` runs the detour out past the most distant camera it is
 * given, so handing it every assessment on the phone -- which is every cached
 * camera, not just the nearby ones -- would plan a line miles beyond anywhere
 * the driver is going.
 */
export const DOCK_DETOUR_FT = DOCK_DENSITY_RADIUS_MI * FT_PER_MILE;

/**
 * The readers a detour would route around: everything inside the horizon.
 *
 * GENERIC ON PURPOSE. The hook has `CameraAssessment`s and the shell has them
 * too, but the only field either half needs is the measured distance, and a
 * filter that demanded the whole assessment would be a second import of the
 * store's shape into a function that measures nothing.
 */
export function detourCameras<T extends { readonly distanceFt: number }>(
  assessments: readonly T[],
): readonly T[] {
  return assessments.filter((camera) => camera.distanceFt <= DOCK_DETOUR_FT);
}

/** APPROACHING -- "30 to 90 s to camera". CRUISING is "more than 90 s". */
const APPROACHING_MIN_S = 30;
const APPROACHING_MAX_S = 90;

/**
 * GPS WEAK -- "accuracy worse than about 100 ft".
 *
 * The store holds metres, so the spec's figure is converted rather than
 * restated: 100 ft is 30.48 m, and rounding it to 30 would move the trigger.
 */
const GPS_WEAK_FT = 100;
const M_PER_FT = 0.3048;

/**
 * MESH SYNC and CLEARED -- "about 6 s".
 *
 * MESH SYNC states the figure; CLEARED's caption says only "a few seconds after
 * passing, then decays" and gives none, so six is borrowed from the state that
 * does rather than picked.
 */
const TRANSIENT_MS = 6000;

/**
 * BELOW A THOUSAND FEET THE READOUT IS FEET, above it miles.
 *
 * Not a threshold about the world -- a formatting rule about a 30px slot. The
 * spec draws `500 ft` in E2 and `0.4 mi` in E3, so both spellings are the
 * design's; this is the line between them, and it is a thousand because that is
 * where the feet reading grows a fourth digit and stops fitting.
 */
const FEET_READOUT_MAX = 1000;

/* ------------------------------------------------------------------------- *
 * SMALL FORMATTERS THE APP DOES NOT ALREADY OWN
 * ------------------------------------------------------------------------- */

/** `1.5`. One decimal, the same precision every distance on DRIVE carries. */
function mi(distanceFt: number | null | undefined): string | null {
  if (distanceFt === null || distanceFt === undefined || !Number.isFinite(distanceFt)) return null;
  return (distanceFt / FT_PER_MILE).toFixed(1);
}

/** `1.5 mi`, or null when there is no distance to state. */
function miLabel(distanceFt: number | null | undefined): string | null {
  const value = mi(distanceFt);
  return value === null ? null : `${value} mi`;
}

/** `600 ft` or `1.4 mi`, whichever the number is legible as. */
function distanceLabel(distanceFt: number | null | undefined): string | null {
  if (distanceFt === null || distanceFt === undefined || !Number.isFinite(distanceFt)) return null;
  if (distanceFt < FEET_READOUT_MAX) return `${String(Math.round(distanceFt / 10) * 10)} ft`;
  return miLabel(distanceFt);
}

/** The same distance split into the 30px readout and the unit on its baseline. */
function readout(distanceFt: number): { readonly figure: string; readonly unit: string } {
  if (distanceFt < FEET_READOUT_MAX) {
    return { figure: String(Math.round(distanceFt / 10) * 10), unit: 'ft' };
  }
  return { figure: (distanceFt / FT_PER_MILE).toFixed(1), unit: 'mi' };
}

/**
 * `8:12` -- what is left on a mute.
 *
 * Seconds are zero-padded and minutes are not, which is how a clock reads.
 */
function countdown(remainingMs: number): string {
  const total = Math.max(0, Math.round(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * `last synced 14 min ago` -- OFFLINE's own line, and `Synced 2m` for the 13px
 * trailing slot that MESH SYNC spends on the same fact.
 *
 * Two spellings because they are two slots: one is a sentence inside a 13px
 * meta line and the other is a trailing value with no room for words.
 */
function syncedAgo(atMs: number | null, nowMs: number): string | null {
  if (atMs === null || !Number.isFinite(atMs)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  if (minutes < 1) return 'Synced now';
  if (minutes < 60) return `Synced ${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${String(hours)}h`;
  return `Synced ${String(Math.floor(hours / 24))}d`;
}

function syncedSentence(atMs: number | null, nowMs: number): string | null {
  if (atMs === null || !Number.isFinite(atMs)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  if (minutes < 1) return 'last synced just now';
  if (minutes < 60) return `last synced ${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last synced ${String(hours)} hr ago`;
  return `last synced ${String(Math.floor(hours / 24))} days ago`;
}

/** Drops the parts a record does not carry, so a line never has a stranded dot. */
function joinParts(parts: readonly (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => typeof part === 'string' && part !== '');
  return kept.length === 0 ? null : kept.join(' · ');
}

/* ------------------------------------------------------------------------- *
 * RECORD READING
 * ------------------------------------------------------------------------- */

/** `Metcalf Ave @ W 111th St`, or null when the archive names neither road. */
function streetOf(record: CameraRecord | null): string | null {
  if (record === null) return null;
  /* CASED, because the archive shouts. See `placeCase.ts` - the US extract
     stores `W 111TH ST` and the spec draws `W 111th St`, and block capitals
     cost the word-shape a driver recognises without reading. */
  const street = placeCase(record.street ?? null);
  const cross = placeCase(record.cross ?? null);
  if (street === null) return cross;
  /* `&` AND NOT `@`, which is what the spec draws and what a junction is
     called out loud. `@` is a database join, not a street corner. */
  return cross === null ? street : `${street} & ${cross}`;
}

/**
 * WHICH DOT A ROW IN THE NEARBY SHEET GETS.
 *
 * The dot is the ONLY place operator identity survives in the dock, and it only
 * appears in the sheet where a named operator sits beside it -- so the colour
 * marks a row rather than making a claim. Flock is read off the MAKER tag,
 * because "who built the reader" is the question the brand hue answers; the
 * rest come off `ownerType`, which is the agency class TRIAGE groups by.
 *
 * `inter_agency` lands on `police`: the token family has no sixth dot, and an
 * inter-agency pool is police hardware whoever else can read it. The sharing is
 * said in words on the row beside the dot, where it belongs.
 */
export function ownerOf(record: CameraRecord | null, ownerType: CameraOwnerType | undefined): DockNearbyOwner {
  const maker = makerOf(record);
  if (maker !== null && maker.includes('FLOCK')) return 'flock';
  if (ownerType === 'police' || ownerType === 'inter_agency') return 'police';
  if (ownerType === 'hoa') return 'hoa';
  if (ownerType === 'private') return 'private';
  return 'unverified';
}

/** `Flock · inter-agency shared`. Who runs it, and who else can read it. */
function whoRunsIt(record: CameraRecord | null): string | null {
  /*
   * `Flock · inter-agency shared`, WHICH IS THE SPEC'S OWN SUB-LINE.
   *
   * It used to draw `chipLabel`, which is the raw operator tag - `FLOCK
   * SAFETY`, shouted, and the whole tag where the spec shows the short name.
   * `shortOperator` is the app's existing answer to that and LOOKUP has always
   * used it; the dock simply never called it, so the same camera read `Flock`
   * on one screen and `FLOCK SAFETY` on another.
   */
  const operator = record?.tags?.['operator'];
  const named = shortOperator(typeof operator === 'string' ? operator : null);
  return joinParts([
    named ?? chipLabel(record?.ownerType, record),
    record?.ownerType === 'inter_agency' ? 'inter-agency shared' : null,
  ]);
}

/**
 * The router's thirteen turn kinds, reduced to the four the icon table draws.
 *
 * A LOSSY MAPPING, and it is written out rather than hidden in a lookup so the
 * loss is visible: `uturn` and `roundabout` have no drawing and arrive here as
 * the straight-ahead arrow, which is the wrong instruction for both. The fix is
 * two more icons, not a mirrored `turn-left` invented here.
 */
function dockTurn(turn: TurnKind): DockTurn {
  if (turn === 'left' || turn === 'sharp-left' || turn === 'slight-left') return 'left';
  if (turn === 'right' || turn === 'sharp-right' || turn === 'slight-right') return 'right';
  if (turn === 'arrive') return 'end';
  return 'up';
}

/* ------------------------------------------------------------------------- *
 * THE ROUTE'S OWN GEOMETRY
 * ------------------------------------------------------------------------- */

/**
 * WHICH SHAPE SEGMENT EACH READER ON THE LINE SITS BESIDE.
 *
 * `camerasOnRoute` measures this and throws it away -- it returns the readers
 * in passing order and not where each one is -- and the turn list needs the
 * position, because a step whose note says `clear` over a reader is the lie
 * that whole sheet exists to prevent.
 *
 * It is the same ruler: `metresToSegmentSq` is corridor.ts's own projection, so
 * "on this route" and "on this step of it" cannot disagree. The cost is one
 * pass over the shape per reader ON THE LINE, which the planner has already
 * cut to a handful; it is not run over the archive.
 */
function segmentOf(shape: readonly RoutePoint[], camera: RoutePoint): number | null {
  if (shape.length < 2) return null;
  let bestSq = Infinity;
  let bestIndex: number | null = null;
  for (let i = 0; i < shape.length - 1; i += 1) {
    const a = shape[i];
    const b = shape[i + 1];
    if (a === undefined || b === undefined) continue;
    const distSq = metresToSegmentSq(camera, a, b);
    if (distSq < bestSq) {
      bestSq = distSq;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * The readers on the line, counted per maneuver, in driving order.
 *
 * A reader belongs to the step it is passed ON: the maneuver whose shape index
 * is the last one at or before the reader's own segment. The final maneuver
 * takes everything after it, which is right -- it is the arrival, and the last
 * leg is still a leg.
 */
function readersPerStep(route: PlannedRoute, onLine: readonly CameraRecord[]): readonly number[] {
  const counts = route.maneuvers.map(() => 0);
  if (counts.length === 0) return counts;
  for (const camera of onLine) {
    const at = segmentOf(route.shape, camera);
    if (at === null) continue;
    let step = 0;
    for (const [index, maneuver] of route.maneuvers.entries()) {
      if (maneuver.beginShapeIndex <= at) step = index;
    }
    const current = counts[step];
    if (current !== undefined) counts[step] = current + 1;
  }
  return counts;
}

/* ------------------------------------------------------------------------- *
 * TWO SMALL CLOCKS
 * ------------------------------------------------------------------------- */

/**
 * A RE-RENDER WHEN A TRANSIENT WINDOW SHUTS.
 *
 * CLEARED and MESH SYNC are both "for about six seconds, then something else".
 * Nothing in the stores changes when the window ends, so without this the dock
 * would sit in CLEARED until the next engine tick happened to arrive -- which,
 * parked, is never.
 *
 * One timeout, armed only while a window is actually open, cleared on unmount.
 * It sets a counter rather than a boolean so a second window arming inside the
 * first still forces the render.
 */
function useExpiry(atMs: number | null, windowMs: number): void {
  const [, bump] = useState(0);
  useEffect(() => {
    if (atMs === null) return undefined;
    const left = atMs + windowMs - Date.now();
    if (left <= 0) return undefined;
    const timer = globalThis.setTimeout(() => {
      bump((n) => n + 1);
    }, left);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [atMs, windowMs]);
}

/**
 * ONE RE-RENDER WHEN THE COUNTY RECORDS ARRIVE.
 *
 * `countyRecords.forCounty()` starts its own fetch and returns null until the
 * file lands; there is no subscription. `MisuseScreen` polls for the same
 * reason and this is that idiom, kept to one interval that stops itself.
 */
function useCountyRecordsReady(): boolean {
  const [ready, setReady] = useState(() => countyRecords.ready());
  useEffect(() => {
    if (ready) return undefined;
    const timer = globalThis.setInterval(() => {
      if (!countyRecords.ready()) return;
      setReady(true);
      globalThis.clearInterval(timer);
    }, 250);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, [ready]);
  return ready;
}

/* ------------------------------------------------------------------------- *
 * THE HOOK
 * ------------------------------------------------------------------------- */

export interface DockStateInput {
  /**
   * The pane has been pressed open.
   *
   * NOT DERIVED, because it is not a fact about the world: the three sheets are
   * the same situations with the pane open, and only the surface that owns the
   * gesture knows. The whole pane body is that gesture now -- there is no grab
   * handle and no chevron -- and `app/ShellDock.tsx` holds the flag.
   */
  readonly expanded?: boolean;
  /**
   * IS THE MAP THE SCREEN UNDERNEATH THE DOCK?
   *
   * =========================================================================
   * WHY THE LADDER NEEDS TO BE TOLD THIS
   * =========================================================================
   * The dock is CHROME. It is mounted once, by `app/ShellDock.tsx`, and it is
   * on EXPOSURE and MESH and LOOKUP and MORE exactly as much as it is on the
   * map. The routed states are not: a driver who has opened EXPOSURE and is
   * still rolling would get a maneuver row about a road they are not looking
   * at, in place of the sheet they opened.
   *
   * The tab row survives in every one of the nineteen now -- that is v3's
   * merged pane -- so this is no longer about losing the way back. It is about
   * what the dock SAYS: off the map the ladder falls through to its collapsed
   * half, which is not a fallback and not a placeholder. OFFLINE, GPS WEAK,
   * MUTED, MESH SYNC, ABUSE ZONE, the exposure count and IDLE are all still
   * derived from live stores and all still true.
   *
   * NOT DERIVED HERE, deliberately. This hook knows about cameras, fixes and
   * routes; which screen is mounted is `app/screenState.ts`'s fact, and a
   * second reader of it in here would be a second place the map's screen id is
   * written down.
   *
   * Defaults TRUE: the spec is drawn for a dock over the map, and a caller that
   * has not thought about it gets the behaviour the spec describes.
   */
  readonly overMap?: boolean;
}

/**
 * WHAT THE DOCK IS, as the three arms `DockProps` takes.
 *
 * A discriminated union and not a bag with three optional payloads, for the
 * same reason `Dock.tsx` gives: the three panes do not take the same data and
 * never did, and one optional-everything object would let a caller hand the
 * turn list a set of readers and get an empty pane back with no error anywhere.
 */
export type DockExpandedDerived =
  | { readonly view: 'nearby'; readonly data: DockNearbyData }
  | { readonly view: 'turn-list'; readonly data: DockTurnListData }
  | { readonly view: 'route-choice'; readonly data: DockRouteChoiceData };

export type DockDerived =
  | { readonly pane: 'collapsed'; readonly state: DockCollapsedStateId; readonly data: DockData }
  | { readonly pane: 'navigating'; readonly state: DockNavStateId; readonly data: DockNavData }
  | {
      readonly pane: 'expanded';
      readonly state: DockExpandedStateId;
      readonly view: DockExpandedDerived;
    };

export function useDockState(input: DockStateInput = {}): DockDerived {
  const expanded = input.expanded === true;
  const overMap = input.overMap !== false;

  // -- position -------------------------------------------------------------
  const fix = useCurrentFix();
  const speedMph = useSpeedMph();
  const accuracyM = useAccuracyM();

  // -- cameras --------------------------------------------------------------
  const assessments = useCameraAssessments();
  const nearest = useCamerasStore((s) => s.nearest);
  const records = useCamerasStore((s) => s.cameras);
  const tilesUpdatedAtMs = useCamerasStore((s) => s.tilesUpdatedAtMs);
  const catalogueTotal = useCatalogueTotal();

  // -- the alert engine -----------------------------------------------------
  const alertState = useAlertStore((s) => s.state);
  const previousAlertState = useAlertStore((s) => s.previousState);
  const changedAtMs = useAlertStore((s) => s.changedAtMs);
  const isClosing = useAlertStore((s) => s.isClosing);
  const muted = useIsMuted();
  const mutedRemainingMs = useMuteRemainingMs();

  // -- the network, the mesh ------------------------------------------------
  const offline = useIsOffline();
  const nearbyDrivers = useNearbyDarkrouteCount();
  const lastSyncAtMs = useLastSyncAtMs();

  // -- the route ------------------------------------------------------------
  const destination = useDestination();
  const route = usePlannedRoute();
  const routeStatus = useRouteStatus();
  const avoiding = useRouteAvoiding();
  const onLine = useRouteOnLine();

  const countyReady = useCountyRecordsReady();

  /*
   * ONE CLOCK PER RENDER. Read once so every window below is measured against
   * the same instant -- two `Date.now()` calls a few lines apart can straddle a
   * boundary and put the dock in two states in one pass.
   */
  const nowMs = Date.now();

  const recordOf = useMemo(() => {
    const byId = new Map(records.map((record) => [record.id, record]));
    return (id: string | null | undefined): CameraRecord | null =>
      id === null || id === undefined ? null : (byId.get(id) ?? null);
  }, [records]);

  const nearestRecord = recordOf(nearest?.id);

  /* --- how many, and how close ------------------------------------------ */

  /*
   * THE FIVE-MILE SET IS KEPT, NOT JUST COUNTED. ARMED fires off its length,
   * and ARMED's sheet lists its members - see `sheet` below.
   */
  const withinArmedSet = useMemo(
    () => assessments.filter((a) => a.distanceFt <= ARMED_MI * FT_PER_MILE),
    [assessments],
  );
  const withinArmed = withinArmedSet.length;
  /*
   * THE EXPOSURE COUNT, THE RAMP'S INPUT AND THE DETOUR'S HORIZON, all three
   * off one set. B2 counts cameras per two miles and the key promises to route
   * around the same ones; one collection counted once is why the numeral and
   * the key cannot disagree.
   */
  const within2mi = useMemo(() => detourCameras(assessments), [assessments]);

  /*
   * HOW MANY OF THE FOURTEEN ARE ON A SHARED FEED.
   *
   * Section A's meta line is `exposure high · 9 on route · 2 inter-agency`, and
   * this is the third clause. It was the one that could be built and was not:
   * `9 on route` genuinely is not derivable on a parked, unrouted card because
   * there is no line to be on, and that absence was allowed to swallow the
   * clause beside it, which is a fact about the RECORDS rather than about any
   * route.
   *
   * It matters more than the raw count. Fourteen readers run by fourteen
   * separate operators and fourteen on one shared network are different
   * exposures - the second is one query - and `inter_agency` is the archive's
   * word for exactly that.
   */
  const sharedWithin2mi = useMemo(
    () =>
      within2mi.reduce(
        (total, camera) => (recordOf(camera.id)?.ownerType === 'inter_agency' ? total + 1 : total),
        0,
      ),
    [within2mi, recordOf],
  );

  /*
   * SECONDS TO THE NEAREST READER, through the app's own `etaSeconds`.
   *
   * It answers null far more readily than distance-over-speed would -- stopped,
   * no speed, or explicitly not closing -- and every one of those nulls is a
   * state where CRUISING and APPROACHING both have nothing to say.
   */
  const secondsToNearest = etaSeconds({
    distanceFt: nearest?.distanceFt ?? null,
    speedMph,
    closing: isClosing,
  });

  const moving = speedMph !== null && Number.isFinite(speedMph) && speedMph >= MIN_MOVING_MPH;

  /* --- the route's own numbers ------------------------------------------ */

  const next = useMemo(
    () => (route === null || fix === null ? null : nextManeuver(route, { lat: fix.lat, lon: fix.lon })),
    [route, fix],
  );

  /**
   * ARRIVED, WITHOUT AN INVENTED RADIUS.
   *
   * `nextManeuver` never runs out: the router's last maneuver is the arrival,
   * and its `miles` is exactly zero once the driver is on it. So "the next
   * thing is the arrival and it is zero miles away" is the store's own answer
   * to "have I got there", and no threshold has to be chosen.
   */
  const arrived = next !== null && next.maneuver.turn === 'arrive' && next.miles === 0;

  /**
   * OFF THE LINE, WITH THE ANNOUNCER'S OWN HYSTERESIS.
   *
   * `announce.ts` publishes both numbers and the rule between them: you go off
   * at 240 ft and you are not back until 120, so a fix jittering across one
   * threshold cannot flap the dock between two states at GPS rate. A ref rather
   * than state because the flag is derived from the fix that is already causing
   * this render -- putting it in state would render twice to record it.
   *
   * A NULL OFFSET DOES NOT CLEAR IT, which is the announcer's rule too: a
   * dropped tick is an absence of evidence, and treating it as evidence the
   * driver came back is how a lost signal cancels a wrong-turn banner.
   */
  const offRouteRef = useRef(false);
  const offRouteFor = useRef<PlannedRoute | null>(null);
  if (route !== offRouteFor.current) {
    offRouteFor.current = route;
    offRouteRef.current = false;
  }
  const offsetFt =
    route === null || fix === null ? null : feetOffRoute(route.shape, { lat: fix.lat, lon: fix.lon });
  if (offsetFt !== null) {
    offRouteRef.current = offRouteRef.current ? offsetFt > BACK_ON_ROUTE_FT : offsetFt > OFF_ROUTE_FT;
  }
  const offRoute = offRouteRef.current;

  /**
   * A READER ON THE LINE, AND WHICH ONE.
   *
   * E3 is the routed dock's camera alert -- rule 4 of the handoff calls it "a
   * live amber alert mid-turn" -- so it fires on the ENGINE saying something is
   * there, not on a geometry test of this file's own. Which reader it is about
   * is the engine's nearest, and whether that reader is one the planner could
   * not clear is what the footer gets to say.
   */
  const onLineIds = useMemo(() => new Set(onLine.map((camera) => camera.id)), [onLine]);
  const cameraAhead = alertState !== 'clear' && nearest !== null;

  /* --- the documented-abuse gate ---------------------------------------- */

  /** The `Abuse near me` switch from the abuse menu. See the county read below. */
  const nearMeOn = useAbuseNearMe();

  /**
   * THE COUNTY, FROM THE NEAREST CAMERA'S OWN RECORD.
   *
   * `MisuseScreen` reads `cameraFips ?? locatedFips` and this takes only the
   * first half -- see the header. Absent for the records that fall outside
   * every county polygon, and absent whenever nothing is cached, both of which
   * read as "no jurisdiction claim", never as "clean".
   */
  /*
   * `cameraFips ?? locatedFips`, WHICH IS WHAT `MisuseScreen` HAS ALWAYS READ.
   *
   * The camera's own field stays first because it is a claim the record makes
   * about itself. The fallback is `locateLoaded` rather than `locate` - see the
   * header - so this resolves once something else has loaded the index and
   * stays null until then, rather than making the dock the surface that fetches
   * a polygon file.
   *
   * GATED ON `abuseNearMe`. That switch reads "count abuse in the nearby
   * query", and this is that query: off, the county is not resolved and no
   * documented-abuse state can be reached.
   */
  const locatedFips =
    nearMeOn && fix !== null ? (countyLocator.locateLoaded(fix.lat, fix.lon)?.fips ?? null) : null;
  const fips = nearestRecord?.countyFips ?? locatedFips;
  const county = countyReady && nearMeOn ? countyRecords.forCounty(fips) : null;

  /**
   * THE SOURCE GATE, and it is a gate rather than a formatting step.
   *
   * The brief is explicit: the state must cite an outlet and a date, and "if a
   * report has no source, do not raise the alert". `parseRecord` already drops
   * an uncited row, so a record that reaches here has both -- but the gate is
   * written out anyway, because the state must not be reachable through a
   * future loosening of that parser.
   */
  const sourced = county === null ? null : (county.records[0] ?? null);
  const outlet = sourced?.sourceName ?? null;
  const sourceDate = sourced === null ? null : String(sourced.year);
  const sourceGate = outlet !== null && outlet !== '' && sourceDate !== null;

  /**
   * ENTERING, as opposed to being in.
   *
   * A county id that is not the one the previous render saw. A ref rather than
   * state: the transition is the event, and storing it would re-render to
   * record something that has already been rendered.
   */
  const lastFips = useRef<string | null>(null);
  const enteredAtMs = useRef<number | null>(null);
  if (fips !== lastFips.current) {
    enteredAtMs.current = lastFips.current === null ? null : nowMs;
    lastFips.current = fips;
  }
  const entering = enteredAtMs.current !== null && nowMs - enteredAtMs.current < TRANSIENT_MS;

  /* --- transient windows ------------------------------------------------- */

  /**
   * JUST CLEARED. The engine left an alerting state for `clear`, and it did so
   * within the window. `changedAtMs` is the engine's own stamp for that edge.
   */
  const clearedAtMs =
    alertState === 'clear' &&
    (previousAlertState === 'in_range' || previousAlertState === 'multiple')
      ? changedAtMs
      : null;
  const justCleared = clearedAtMs !== null && nowMs - clearedAtMs < TRANSIENT_MS;
  const syncedRecently = lastSyncAtMs !== null && nowMs - lastSyncAtMs < TRANSIENT_MS;

  useExpiry(clearedAtMs, TRANSIENT_MS);
  useExpiry(lastSyncAtMs, TRANSIENT_MS);
  useExpiry(enteredAtMs.current, TRANSIENT_MS);

  /* --- the ladder -------------------------------------------------------- */

  const ladder = deriveState({
    expanded,
    /* THE TWO GATES INTO THE ROUTED HALF, both closed off the map. See
       `overMap` -- the values themselves are still computed above and still
       honest; this only says which half of the ladder may read them. */
    routeActive: overMap && destination !== null && route !== null,
    routePlanning: overMap && destination !== null && routeStatus === 'planning',
    hasManeuver: next !== null,
    hasSteps: route !== null && route.maneuvers.length > 0,
    offRoute,
    arrived,
    cameraOnRoute: cameraAhead,
    moving: overMap && moving,
    alertState,
    secondsToNearest,
    justCleared,
    entering: entering && sourceGate,
    abuseZone: sourceGate,
    offline,
    gpsWeak: accuracyM !== null && accuracyM > GPS_WEAK_FT * M_PER_FT,
    muted: muted && mutedRemainingMs > 0,
    syncing: syncedRecently,
    exposed: within2mi.length > 0,
    armed: withinArmed > 0,
  });

  /* --- the data ---------------------------------------------------------- */

  /**
   * WHAT SECTION C LISTS, AND OVER WHICH RADIUS.
   *
   * `Dock.tsx` names three collapsed states with a sheet behind them and says
   * what each one holds: DENSE has the fourteen, ABUSE ZONE has what is around
   * you, and "ARMED has the reader". The list was built from the two-mile set
   * alone, and ARMED is DEFINED as that set being empty - a reader within five
   * miles and none within two - so pressing an ARMED pane opened 302px of
   * header over nothing. That is the one outcome the deleted chevron's
   * replacement was argued never to produce, on the state whose whole message
   * is "there is one, and here is where".
   *
   * So the sheet lists the readers inside the horizon that RAISED the state:
   * two miles whenever anything is inside it, else ARMED's five. One decision,
   * taken once, and the header's count and radius are read off the same object
   * as the rows, so the head cannot say `within 2 mi` over a list of readers
   * three miles out. The density tier is NOT moved with it - the ramp is a
   * rule about two miles and `expandedView` keeps running it on that count.
   */
  const sheet = useMemo(
    () =>
      within2mi.length > 0
        ? { readers: within2mi, radiusMi: DOCK_DENSITY_RADIUS_MI }
        : { readers: withinArmedSet, radiusMi: ARMED_MI },
    [within2mi, withinArmedSet],
  );

  const nearbyRows = useMemo<readonly DockNearbyRow[]>(
    () =>
      [...sheet.readers]
        .sort((a, b) => a.distanceFt - b.distanceFt)
        .map((a) => {
          const record = recordOf(a.id);
          return {
            id: a.id,
            /* THE ID WHEN THE ARCHIVE NAMES NO ROAD, which is the fallback
               `lookup/search.ts` already uses for the quarter of the archive
               that has no street. A blank row is not an honest absence -- it
               is a row that looks like a rendering fault. */
            where: streetOf(record) ?? a.id,
            who: whoRunsIt(record) ?? 'Unverified report',
            owner: ownerOf(record, record?.ownerType),
            /* `distanceLabel`, NOT `miLabel`. The list is sorted by distance
               and every row was printing miles to one decimal, so three readers
               spread over a few hundred feet all read `1.0 mi` and a sorted
               list looked broken. Feet under the threshold is the same idiom
               the rest of DRIVE uses and is the half where the precision is
               worth having - a mile away is a mile away, but 900 ft and
               1,400 ft are different decisions. */
            distance: distanceLabel(a.distanceFt) ?? '',
          };
        }),
    [sheet, recordOf],
  );

  const steps = useMemo<readonly DockTurnStep[]>(() => {
    if (route === null) return [];
    const counts = readersPerStep(route, onLine);
    /*
     * ONLY THE TURNS STILL AHEAD, the same trim `DriveScreen.navTurns` makes.
     * A list that keeps replaying the junctions behind you is a list nobody
     * reads twice.
     */
    const from = next === null ? 0 : route.maneuvers.indexOf(next.maneuver);
    return route.maneuvers.slice(Math.max(0, from)).map((entry, offset) => {
      const index = Math.max(0, from) + offset;
      const readers = counts[index] ?? 0;
      const arrival = entry.turn === 'arrive';
      return {
        id: `${String(entry.beginShapeIndex)}-${String(index)}`,
        distance: `${entry.miles.toFixed(1)} mi`,
        road: entry.street === '' ? entry.instruction : entry.street,
        note: arrival ? 'destination' : readers === 0 ? 'clear' : `${readerCount(readers)} on this leg`,
        tone: arrival ? 'clear' : readers === 0 ? 'quiet' : 'alert',
      };
    });
  }, [route, onLine, next]);

  const slots = useMemo<BuildInput>(
    () => ({
      nearest,
      nearestRecord,
      route,
      next,
      onLineIds,
      destination: destination?.name ?? null,
      onRouteCount: onLine.length,
      avoidingCount: avoiding.length,
      offsetFt,
      exposureCount: within2mi.length,
      exposureShared: sharedWithin2mi,
      sheetCount: sheet.readers.length,
      sheetRadiusMi: sheet.radiusMi,
      secondsToNearest,
      countyIncidents: county?.incidents ?? 0,
      countyAgency: sourced?.agency ?? null,
      outlet,
      sourceDate,
      catalogueTotal,
      tilesUpdatedAtMs,
      mutedRemainingMs,
      nearbyDrivers,
      lastSyncAtMs,
      accuracyM,
      nowMs,
    }),
    // `nowMs` is deliberately in the list: it is the clock every window above
    // was measured against, and a memo that outlived it would print a stale age.
    [
      nearest,
      nearestRecord,
      route,
      next,
      onLineIds,
      destination,
      onLine.length,
      avoiding.length,
      offsetFt,
      within2mi.length,
      sheet,
      secondsToNearest,
      county,
      sourced,
      outlet,
      sourceDate,
      catalogueTotal,
      tilesUpdatedAtMs,
      mutedRemainingMs,
      nearbyDrivers,
      lastSyncAtMs,
      accuracyM,
      nowMs,
    ],
  );

  return useMemo<DockDerived>(() => {
    if (ladder.pane === 'collapsed') {
      return { pane: 'collapsed', state: ladder.state, data: collapsedData(ladder.state, slots) };
    }
    if (ladder.pane === 'navigating') {
      return { pane: 'navigating', state: ladder.state, data: navData(ladder.state, slots) };
    }
    return {
      pane: 'expanded',
      state: ladder.state,
      view: expandedView(ladder.view, slots, nearbyRows, steps),
    };
  }, [ladder, slots, nearbyRows, steps]);
}

/* ------------------------------------------------------------------------- *
 * THE LADDER, AS A PURE FUNCTION
 *
 * Exported so it can be tested without a store, and so the precedence can be
 * read in one screen rather than traced through a hook.
 * ------------------------------------------------------------------------- */

export interface DockLadderInput {
  /** The pane has been pressed open. Honoured only where a sheet exists. */
  readonly expanded: boolean;
  /** A destination and a line to it. */
  readonly routeActive: boolean;
  /** A destination, and a plan in flight for it. */
  readonly routePlanning: boolean;
  /** `nextManeuver` answered: there is a turn ahead and a position on the line. */
  readonly hasManeuver: boolean;
  /** The route carries a turn list, so there is something to expand into. */
  readonly hasSteps: boolean;
  readonly offRoute: boolean;
  readonly arrived: boolean;
  /** The engine has a reader for the driver, while a route is running. */
  readonly cameraOnRoute: boolean;
  readonly moving: boolean;
  readonly alertState: 'clear' | 'approaching' | 'in_range' | 'multiple';
  /** Through `etaSeconds`, so a stopped car and an unknown speed both read null. */
  readonly secondsToNearest: number | null;
  readonly justCleared: boolean;
  readonly entering: boolean;
  readonly abuseZone: boolean;
  readonly offline: boolean;
  readonly gpsWeak: boolean;
  readonly muted: boolean;
  readonly syncing: boolean;
  /** At least one reader inside the two miles the ramp counts. */
  readonly exposed: boolean;
  readonly armed: boolean;
}

export type DockLadderResult =
  | { readonly pane: 'collapsed'; readonly state: DockCollapsedStateId }
  | { readonly pane: 'navigating'; readonly state: DockNavStateId }
  | {
      readonly pane: 'expanded';
      readonly state: DockExpandedStateId;
      readonly view: DockExpandedViewId;
    };

export function deriveState(input: DockLadderInput): DockLadderResult {
  /* ------------------------------------------------------------------- *
   * ROUTED. Section E is "the single source for every routed state", so a
   * running route means one of the six and the pane stays at 170.
   * ------------------------------------------------------------------- */
  if (input.routeActive || input.routePlanning) {
    /* THE TURN LIST, which every routed state has behind it -- the whole
       family offers the press, unlike the collapsed half where four states
       have nothing worth opening. It needs a turn list to open INTO; a route
       that came back with none leaves the pane where it is rather than
       growing 132px of empty sheet. */
    if (input.expanded && input.hasSteps) {
      return { pane: 'expanded', state: 'navigating-expanded', view: 'turn-list' };
    }

    /* A PLAN IN FLIGHT IS THE MOST VOLATILE FACT ON THE PANE. Everything
       under it is measured along a line that is about to be replaced. */
    if (input.routePlanning) return { pane: 'navigating', state: 'rerouting' };

    /* THE DRIVE IS OVER BEFORE IT IS ANYTHING ELSE. Above off-route because a
       destination a few hundred feet off the line's own end would otherwise
       read as a wrong turn for as long as the driver sat in the car park. */
    if (input.arrived) return { pane: 'navigating', state: 'arrived' };

    /* THEN OFF ROUTE, and it beats the reader ahead on `announce.ts`'s own
       argument: a distance measured along a route the driver is not on is a
       fiction. E5 carries the reader count in its footer rather than losing
       it. */
    if (input.offRoute) return { pane: 'navigating', state: 'off-route' };

    /* THEN THE READER. This is the routed dock's camera alert -- "a live amber
       alert mid-turn" -- and it is why a route running does not drop the pane
       to the 150px UNDER SURVEILLANCE card. */
    if (input.cameraOnRoute) return { pane: 'navigating', state: 'camera-on-route' };

    /* THEN THE ROAD. E2 is the maneuver row; the 800 ft in its caption is what
       the renderer escalates the arrow on, not what selects the state -- there
       is no seventh state for a turn three miles out, and drawing a proposal's
       `Start` key over a running route would be the worse of the two. */
    if (input.hasManeuver) return { pane: 'navigating', state: 'turn-imminent' };

    /* AND E1, WHICH IS ALL THAT IS LEFT OF "PROPOSED" IN A BUILD WITH NO
       START. A line exists and no position on it can be computed -- no fix, or
       a route the router returned with no turns -- so the only thing sayable
       is the trip. */
    return { pane: 'navigating', state: 'route-proposed' };
  }

  /* ------------------------------------------------------------------- *
   * MOVING, WITH NO ROUTE. The collapsed drive states, live camera first.
   * ------------------------------------------------------------------- */
  if (input.moving) {
    /* INSIDE THE CONE BEATS EVERYTHING, including a documented jurisdiction:
       it is the only thing on the dock that is happening right now. */
    if (input.alertState === 'in_range' || input.alertState === 'multiple') {
      return { pane: 'collapsed', state: 'passing' };
    }
    if (input.justCleared) return { pane: 'collapsed', state: 'cleared' };
    /* THEN THE JURISDICTION, which is an alert with a citation behind it. */
    if (input.entering) return { pane: 'collapsed', state: 'abuse-entering' };
    /* THEN THE CAMERA AHEAD. `approaching` is a window, not a band: outside it
       the dock says how far, not how soon. */
    if (
      input.alertState === 'approaching' &&
      input.secondsToNearest !== null &&
      input.secondsToNearest >= APPROACHING_MIN_S &&
      input.secondsToNearest <= APPROACHING_MAX_S
    ) {
      return { pane: 'collapsed', state: 'approaching' };
    }
    /* UNMAPPED would sit here. It has no signal. */
    return { pane: 'collapsed', state: 'cruising' };
  }

  /* ------------------------------------------------------------------- *
   * NOT MOVING. The conditions first, because each of them changes what
   * every other state on this dock would MEAN -- an exposure count over a
   * stale cache or a 180 ft fix is a claim the app cannot make.
   * ------------------------------------------------------------------- */
  if (input.offline) return { pane: 'collapsed', state: 'offline' };
  if (input.gpsWeak) return { pane: 'collapsed', state: 'gps-weak' };
  if (input.muted) return { pane: 'collapsed', state: 'muted' };
  if (input.syncing) return { pane: 'collapsed', state: 'mesh-sync' };

  /**
   * THREE STATES HAVE A SHEET BEHIND THEM AND ALL THREE MUST OPEN IT.
   *
   * The chevron is deleted and the whole pane is the target, which makes this
   * MORE load-bearing than it was in v2, not less: a press anywhere on a
   * 150px pane that derives the state it was already in is a dead surface
   * rather than one dead control.
   *
   * ALL THREE REACH THE SAME SHEET, because the spec draws exactly one
   * collapsed-family sheet -- section C, the readers within two miles, sorted
   * by distance. That list is the honest answer to all three questions: the
   * exposure count asks which fourteen, ARMED asks which reader, ABUSE ZONE
   * asks what is around me in a county with a record. ABUSE ZONE in particular
   * cannot fire without a nearest record, since its own gate reads the county
   * off that record's `countyFips`.
   *
   * WHAT THIS IS NOT: a sheet of sourced reports behind ABUSE ZONE. That would
   * be a fourth view and a drawing nobody has made.
   */
  const sheet = input.abuseZone || input.exposed || input.armed;
  if (input.expanded && sheet) {
    return { pane: 'expanded', state: 'armed-expanded', view: 'nearby' };
  }

  if (input.abuseZone) return { pane: 'collapsed', state: 'abuse-zone' };
  /**
   * THE EXPOSURE CARD, AND WHY ITS GATE IS ONE READER AND NOT TEN.
   *
   * V2 called this DENSE AREA and fired it at ten within two miles, which is
   * v2's own threshold and not the spec's. B2 publishes a FOUR-TIER ramp over
   * the same count -- 0 clear, 1-5 low, 6-12 moderate, 13+ high -- and a state
   * that cannot exist below ten leaves two of those four tiers unreachable and
   * the ramp saying only "bad" and "worse".
   *
   * So the count is the reading whenever there is one, and the tier word is
   * what escalates. That is the whole of "escalation is colour, weight and the
   * number, never size", applied to the one number the dock spends its 30px
   * slot on.
   *
   * `clear` IS STILL UNREACHABLE, and by one line in a file this brief does
   * not own: `BrowseRow.COUNTS_CAMERAS` gates the ramp on the state, and IDLE
   * is not in it. IDLE carries `count: 0` so that adding it is a one-word
   * change; see the report.
   */
  if (input.exposed) return { pane: 'collapsed', state: 'dense' };
  if (input.armed) return { pane: 'collapsed', state: 'armed' };
  return { pane: 'collapsed', state: 'idle' };
}

/* ------------------------------------------------------------------------- *
 * THE SLOTS
 * ------------------------------------------------------------------------- */

interface BuildInput {
  readonly nearest: CameraAssessment | null;
  readonly nearestRecord: CameraRecord | null;
  readonly route: PlannedRoute | null;
  readonly next: { readonly maneuver: { readonly turn: TurnKind; readonly instruction: string; readonly street: string; readonly miles: number }; readonly miles: number } | null;
  readonly onLineIds: ReadonlySet<string>;
  readonly destination: string | null;
  readonly onRouteCount: number;
  readonly avoidingCount: number;
  readonly offsetFt: number | null;
  readonly exposureCount: number;
  /** How many of `exposureCount` are on a shared inter-agency feed. */
  readonly exposureShared: number;
  /** What section C's list holds, and the radius it holds it over. See `sheet`. */
  readonly sheetCount: number;
  readonly sheetRadiusMi: number;
  readonly secondsToNearest: number | null;
  readonly countyIncidents: number;
  readonly countyAgency: string | null;
  readonly outlet: string | null;
  readonly sourceDate: string | null;
  readonly catalogueTotal: number | null;
  readonly tilesUpdatedAtMs: number | null;
  readonly mutedRemainingMs: number;
  readonly nearbyDrivers: number;
  readonly lastSyncAtMs: number | null;
  readonly accuracyM: number | null;
  readonly nowMs: number;
}

/** Strips the keys whose value is null, so an absence stays an absence. */
function defined<T>(data: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out as T;
}

/** Who runs the nearest reader, and which way it looks. */
function nearestFacing(input: BuildInput): number | null {
  const recorded = input.nearestRecord?.directionDeg;
  if (recorded !== null && recorded !== undefined) return recorded;
  return input.nearest?.directionDeg ?? null;
}

function collapsedData(state: DockCollapsedStateId, input: BuildInput): DockData {
  const facing = nearestFacing(input);
  const faces = facing === null ? null : `faces ${facingCardinal(facing)}`;
  const operator = chipLabel(input.nearestRecord?.ownerType, input.nearestRecord);
  const street = streetOf(input.nearestRecord);
  const distance = miLabel(input.nearest?.distanceFt);

  switch (state) {
    /* --- IDLE ------------------------------------------------------------ */
    case 'idle':
      return defined<DockData>({
        /* ZERO, so the ramp's `clear` tier has a number to colour the moment
           `BrowseRow` lets IDLE into `COUNTS_CAMERAS`. Inert until then, and
           inert is the right kind of wrong for a field nobody reads. */
        count: 0,
        statusText: distance === null ? 'Nothing within 2 mi' : `Clear for ${distance}`,
        statusTrailing:
          input.catalogueTotal === null ? null : `${formatCacheCount(input.catalogueTotal)} mapped`,
        facingDeg: facing,
      });

    /* --- ARMED ----------------------------------------------------------- */
    case 'armed':
      return defined<DockData>({
        distance,
        statusText: joinParts([operator, faces]),
        subline: street,
        facingDeg: facing,
      });

    /* --- THE EXPOSURE CARD ----------------------------------------------- */
    case 'dense':
      return defined<DockData>({
        count: input.exposureCount,
        /* THE RADIUS, AND NOT A VERDICT. The spec's line ends with the tier
           word and `BrowseRow` draws that from `DOCK_TIER_WORD` off the same
           count -- so it is not repeated here, and nothing in this app grades
           a stretch of road beyond the ramp. */
        statusText: `cameras within ${String(DOCK_DENSITY_RADIUS_MI)} mi`,
        /* WHAT THE COUNT IS MADE OF, where the archive says.
           `9 on route` is section A's own second clause and it stays absent:
           this is a parked, unrouted card and there is no line to be on. What
           the key beside it counts is a DIFFERENT nine - how many a single
           corridor can be aimed through, which is a plan rather than a fact.
           `N inter-agency` is neither; it is a property of the records, it is
           derivable here, and it was only missing because the clause that
           cannot be built was allowed to take it down too. */
        secondaryText:
          input.exposureShared === 0
            ? null
            : `${String(input.exposureShared)} inter-agency`,
        around: null,
      });

    /* --- MUTED ----------------------------------------------------------- */
    case 'muted':
      return defined<DockData>({
        statusText: joinParts(['Muted', input.nearestRecord?.street ?? null]),
        countdown: countdown(input.mutedRemainingMs),
        keyLabel: 'Undo',
      });

    /* --- OFFLINE --------------------------------------------------------- */
    case 'offline':
      return defined<DockData>({
        figure: 'Working from cache',
        subline: joinParts([
          syncedSentence(input.tilesUpdatedAtMs, input.nowMs),
          input.catalogueTotal === null
            ? null
            : `${formatCacheCount(input.catalogueTotal)} cameras stored`,
        ]),
      });

    /* --- CRUISING -------------------------------------------------------- */
    case 'cruising':
      return defined<DockData>({
        /* THE COUNT, WHICH IS SECTION B'S OWN LEDE: a bare `3` over what it is
           counting. It is the same two-mile set the ramp reads and the exposure
           card draws, because it is the only count of readers this dock has --
           the corridor's "ahead on this road" belongs to DRIVE.
           IT NOW CARRIES `count` RATHER THAN `figure`, which is what lets the
           ramp reach it. `figure` is a string the pane prints; `count` is a
           NUMBER the ramp can tier, and `dockDensityOf` refuses any state whose
           `count` is undefined. So the previous note here - "it is one word" -
           was half right: adding `cruising` to `COUNTS_CAMERAS` alone would
           have changed nothing, because the guard would still have thrown it
           out. Same value, same rendering, now tierable. */
        count: input.exposureCount === 0 ? null : input.exposureCount,
        statusText: `cameras within ${String(DOCK_DENSITY_RADIUS_MI)} mi`,
        subline: distance === null ? null : `nearest ${distance}`,
        /* ZERO IS AN ABSENCE, not a key face: a key offering to route around
           nothing is a key that refuses, and the dock does not draw one. */
        around: null,
      });

    /* --- APPROACHING ----------------------------------------------------- */
    case 'approaching':
      return defined<DockData>({
        /* FEET, WHICH IS WHAT SECTION B DRAWS. V2 spent this slot on seconds;
           v3 spends it on the distance, and the seconds are what put the state
           on screen rather than what it says. */
        figure:
          input.nearest === null ? null : readout(input.nearest.distanceFt).figure,
        statusText:
          input.nearest === null
            ? null
            : joinParts([readout(input.nearest.distanceFt).unit, street]),
        /* WHO IS READING AND WHAT IT IS BOLTED TO -- section B's own second
           line. The mount is dropped where the mapper did not write it, which
           for most OSM ALPR nodes is most of them. */
        subline: joinParts([operator, mountOf(input.nearestRecord)]),
        facingDeg: facing,
        around: null,
      });

    /* --- UNDER SURVEILLANCE ---------------------------------------------- */
    case 'passing':
      return defined<DockData>({
        figureLines: ['Likely under', 'surveillance'] as readonly [string, string],
        /* NO DWELL IN SECONDS. The spec draws one and nothing measures one:
           `etaSeconds` answers time TO a camera and returns null once it is
           not closing. What is true is who is reading and which way. */
        subline: joinParts(['plate read expected', operator, faces]),
        facingDeg: facing,
      });

    /* --- CLEARED --------------------------------------------------------- */
    case 'cleared':
      return defined<DockData>({
        figure: distance === null ? 'Clear' : `Clear for ${distance}`,
        /* THE NEXT ONE, not an all-time tally. The archive count is the search
           bar's -- `DriveScreen.watchingCount.test.tsx` holds that it lives
           there and nowhere else. The distance is already in the figure, so
           this slot spends itself on WHERE the next one is and HOW LONG. */
        subline: joinParts([
          street === null ? null : `next at ${street}`,
          describeEta(input.secondsToNearest)?.toLowerCase() ?? null,
        ]),
      });

    /* --- ABUSE ZONE ------------------------------------------------------ */
    case 'abuse-zone':
      return defined<DockData>({
        count: input.countyIncidents,
        statusText: joinParts(['abuse reports', input.countyAgency]),
      });

    /* --- ABUSE ZONE, ENTERING -------------------------------------------- */
    case 'abuse-entering':
      return defined<DockData>({
        figure: 'Reported abuse',
        statusText: input.countyAgency === null ? null : `Entering ${input.countyAgency}`,
        subline: joinParts([
          'Data shared outside agency',
          joinParts([input.outlet, input.sourceDate]),
        ]),
        secondaryTrailing: 'Read',
        outlet: input.outlet,
        sourceDate: input.sourceDate,
      });

    /* --- GPS WEAK -------------------------------------------------------- */
    case 'gps-weak':
      return defined<DockData>({
        statusText: 'GPS weak · alerts may arrive late',
        statusTrailing:
          input.accuracyM === null
            ? null
            : `±${String(Math.round(input.accuracyM / M_PER_FT))} ft`,
      });

    /* --- MESH SYNC ------------------------------------------------------- */
    case 'mesh-sync':
      return defined<DockData>({
        statusText: `Mesh · ${String(input.nearbyDrivers)} drivers confirming nearby`,
        statusTrailing: syncedAgo(input.lastSyncAtMs, input.nowMs),
      });

    /* --- UNMAPPED -------------------------------------------------------- *
     * Unreachable -- see the header. Kept as a case so the switch is total and
     * a future signal has an obvious place to land, and returning nothing
     * rather than a plausible fixture so that if it IS reached by accident it
     * draws an empty row somebody notices, not a sentence they believe. */
    case 'unmapped':
      return {};
  }
}

function navData(state: DockNavStateId, input: BuildInput): DockNavData {
  const route = input.route;
  const next = input.next;
  /** `34 min`. The route's own time, through the app's formatter. */
  const eta = route === null ? null : describeDuration(route.seconds);
  const routeMiles = route === null ? null : `${route.miles.toFixed(1)} mi`;
  const cleared = clearedCount(input.avoidingCount, input.onRouteCount);
  const turn = next === null ? null : dockTurn(next.maneuver.turn);
  const toTurn = next === null ? null : readout(next.miles * FT_PER_MILE);
  const facing = nearestFacing(input);
  const operator = chipLabel(input.nearestRecord?.ownerType, input.nearestRecord);

  switch (state) {
    /* --- E1 ROUTE PROPOSED ----------------------------------------------- */
    case 'route-proposed':
      return defined<DockNavData>({
        figure: route === null ? null : String(Math.max(1, Math.round(route.seconds / 60))),
        unit: joinParts(['min', routeMiles]),
        /* `avoids 3 of 5 cameras` -- the two halves the planner reported, and
           never a recount. `clearedCount` is what was excluded less what is
           still on the line, which is the double-count `DestinationCard`
           exists not to make. */
        sub:
          cleared + input.onRouteCount === 0
            ? null
            : `avoids ${String(cleared)} of ${String(cleared + input.onRouteCount)} cameras`,
        /* NOT `2 routes compared`. There is one route -- see the header on F2
           -- so the footer names where the line goes instead. */
        footer: input.destination,
      });

    /* --- E2 TURN IMMINENT ------------------------------------------------ */
    case 'turn-imminent':
      return defined<DockNavData>({
        figure: toTurn?.figure ?? null,
        unit: toTurn?.unit ?? null,
        sub: next?.maneuver.instruction ?? null,
        /* WHAT COMES AFTER THE TURN, which is the whole value of this slot at
           500 feet: the driver is about to commit and wants to know the next
           commitment. `maneuver.miles` is the length of the leg the turn
           begins, so it is exactly "then this far". */
        footer:
          next === null || next.maneuver.street === ''
            ? null
            : `then ${next.maneuver.miles.toFixed(1)} mi to ${next.maneuver.street}`,
        turn,
      });

    /* --- E3 CAMERA ON ROUTE ---------------------------------------------- */
    case 'camera-on-route':
      return defined<DockNavData>({
        figure: toTurn?.figure ?? null,
        unit: toTurn?.unit ?? null,
        sub: next?.maneuver.instruction ?? null,
        /* THE READER, AND WHETHER THE PLANNER COULD NOT CLEAR IT. `on route`
           is claimed only for a reader in the store's own `onLine` set --
           what the route was measured against, on this device. Anything else
           is a reader beside the road and the footer says only how far. */
        footer: joinParts([
          distanceLabel(input.nearest?.distanceFt),
          operator,
          input.nearest !== null && input.onLineIds.has(input.nearest.id) ? 'on route' : null,
        ]),
        turn,
        facingDeg: facing,
        around: null,
      });

    /* --- E4 REROUTING ---------------------------------------------------- */
    case 'rerouting':
      return defined<DockNavData>({
        title: 'Finding a way around',
        sub: input.destination === null ? 'holding your destination' : `holding ${input.destination}`,
        /* ONLY WHERE IT IS TRUE. `routeActions.planning` does not clear the
           line, so the old one really is still live -- but a FIRST plan has
           no old line, and promising one would be the dock telling a driver
           to keep following a road it has not drawn. */
        footer: route === null ? null : 'keep driving — old route stays live',
      });

    /* --- E5 OFF ROUTE ---------------------------------------------------- */
    case 'off-route':
      return defined<DockNavData>({
        title: 'Off route',
        sub: joinParts([
          distanceLabel(input.offsetFt),
          next === null || next.maneuver.street === '' ? null : `from ${next.maneuver.street}`,
        ]),
        /* THE READERS DO NOT STOP MATTERING BECAUSE THE LINE DID. E5 is the
           one routed state that carries the exposure count, which is why it
           sits above the reader alert in the ladder rather than losing it. */
        footer:
          input.exposureCount === 0
            ? null
            : `still watching ${String(input.exposureCount)} cameras nearby`,
      });

    /* --- E6 ARRIVED ------------------------------------------------------ */
    case 'arrived':
      return defined<DockNavData>({
        title: 'Arrived',
        sub: input.destination,
        footer: joinParts([
          eta,
          `avoided ${String(cleared)}, passed ${String(input.onRouteCount)}`,
        ]),
      });
  }
}

function expandedView(
  view: DockExpandedViewId,
  input: BuildInput,
  nearby: readonly DockNearbyRow[],
  steps: readonly DockTurnStep[],
): DockExpandedDerived {
  if (view === 'turn-list') {
    return {
      view: 'turn-list',
      data: {
        /* THE HEADER IS THE ROW IT EXPANDED FROM, not a second drawing of it.
           F1 keeps the maneuver and the footer exactly where they were and
           grows the list underneath; handing it E2's own data is what makes
           that true rather than nearly true. */
        nav: navData('turn-imminent', input),
        steps,
      } satisfies DockTurnListData,
    };
  }

  if (view === 'route-choice') {
    /* UNREACHABLE -- see the header. Nothing in this build holds two routes,
       so the list is empty and the header is the one line there is. */
    return {
      view: 'route-choice',
      data: { nav: navData('route-proposed', input), routes: [] } satisfies DockRouteChoiceData,
    };
  }

  return {
    view: 'nearby',
    data: defined<DockNearbyData>({
      /* THE HEAD COUNTS THE LIST. Two miles on the exposure card, five on
         ARMED, and both numbers come off the one `sheet` the rows do. */
      count: input.sheetCount,
      headline: `cameras within ${String(input.sheetRadiusMi)} mi`,
      /* THE RAMP STAYS ON TWO MILES. One reader five miles out is `exposure
         clear` by B2's own definition, and printing `exposure low` over it
         would be the tier word measuring something other than what it names. */
      exposure: input.exposureCount,
      note: 'sorted by distance',
      around: null,
      nearby,
    }),
  };
}
