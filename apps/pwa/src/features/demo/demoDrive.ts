/**
 * DEMO MODE - a scripted drive through everything this app does.
 *
 * =============================================================================
 * IT DRIVES THE REAL APP, IT DOES NOT MOCK ONE
 * =============================================================================
 * Nothing here draws a screen or fakes a state. It writes cameras into the
 * cameras store and fixes into the position store, and then the SHIPPED
 * pipeline does the rest: the alert loop assesses, the engine decides, the
 * delivery wire buzzes and notifies, the corridor builds, the map follows, the
 * zone resolves a county and the misuse strip appears.
 *
 * That is the whole design constraint. A demo that paints its own screens
 * proves the demo works. This one can only show what the product actually
 * does, and if a stage stops appearing then something is genuinely broken.
 *
 * =============================================================================
 * WHY IT SEEDS ITS OWN CAMERAS
 * =============================================================================
 * The archive is real and wherever the laptop is probably is not interesting.
 * Worse, the one thing hardest to show on demand is the misuse strip: it needs
 * to be in one of 38 counties that have a documented record, which no amount
 * of standing in a car park will arrange.
 *
 * So the drive is placed in Cook County, Illinois - FIPS 17031, which carries
 * four records, more than anywhere else - and the cameras are written with
 * that FIPS so the zone resolves it exactly the way it would on a real road.
 * The RECORDS ARE NOT FAKED. They are the shipped file, fetched normally, and
 * if a record were removed from it the strip would change here too.
 *
 * =============================================================================
 * IT PUTS EVERYTHING BACK
 * =============================================================================
 * `stop()` restores the camera tiles and the alert state it found. A demo that
 * leaves a driver's app full of Chicago is worse than no demo.
 */

import { camerasActions, useCamerasStore } from '../../stores/cameras.ts';
import { closeIntelCard, openIntelCard } from '../intel/IntelScreen.tsx';
import { currentMap } from '../map/mapRegistry.ts';
import { positionActions, setScriptedPosition } from '../../stores/position.ts';
import { alertActions } from '../../stores/alert.ts';
import type { GeoFix } from '../../services/adapters/geolocation.ts';
import type { CameraRecord } from '../../services/db/schema.ts';

/**
 * Cook County, Illinois.
 *
 * Chosen because it carries four documented misuse records, more than any
 * other county in the shipped file, so the strip has the most to say.
 */
export const DEMO_FIPS = '17031';
/**
 * The z11 tile the demo route is actually in.
 *
 * Computed, not guessed - the first value here was 519/755, which is Walworth
 * County, Wisconsin, about seventy miles from the route. The demo cameras
 * still worked because the engine measures distance and does not care which
 * tile a record was filed under, but the ZONE does: it takes the commonest
 * county among nearby cameras, so a tile in the wrong state is a county strip
 * that never fires. This one holds 260 real Cook County cameras.
 */
export const DEMO_TILE = { z: 11, x: 525, y: 761 } as const;

/** Metres per degree of latitude. Good to well under a pixel at this scale. */
const M_PER_DEG = 111_320;
const FT_PER_M = 3.28084;

export interface DemoStage {
  readonly id: string;
  /** What is on screen, in the words somebody would narrate it. */
  readonly title: string;
  /** Why it is worth showing. One line. */
  readonly shows: string;
  /** How long this stage runs. */
  readonly ms: number;
}

/**
 * THE RUNNING ORDER.
 *
 * Ordered so each stage is legible before the next thing happens. The alert
 * escalation has to come before the mute, because a mute is only interesting
 * once somebody has seen what it is silencing.
 */
export const DEMO_STAGES: readonly DemoStage[] = [
  {
    id: 'clear',
    title: 'DRIVING',
    shows: 'the map tracks you, and the corridor says how far you can go',
    ms: 9_000,
  },
  {
    id: 'zoom-out',
    title: 'ZOOM OUT',
    shows: 'the whole field, pinched back the way a thumb would',
    ms: 7_000,
  },
  {
    id: 'zoom-in',
    title: 'BACK IN',
    shows: 'and back to driving range',
    ms: 5_000,
  },
  {
    id: 'tap',
    title: 'TAP A CAMERA',
    shows: 'who owns it, which way it faces, how it is mounted',
    ms: 9_000,
  },
  {
    id: 'approaching',
    title: 'APPROACHING',
    shows: 'the first warning, at the distance you set',
    ms: 6_000,
  },
  {
    id: 'in-range',
    title: 'IN RANGE',
    shows: 'the alert: vibration, a notification, the screen takes over',
    ms: 6_000,
  },
  {
    id: 'multiple',
    title: 'A GAUNTLET',
    shows: 'four cameras in one stretch, counted rather than listed',
    ms: 6_000,
  },
  {
    id: 'abuse',
    title: 'A COUNTY WITH A RECORD',
    shows: 'documented misuse where you are driving, with its source',
    ms: 10_000,
  },
  {
    id: 'muted',
    title: 'MUTED',
    shows: 'the alert is hidden, the pass is still counted',
    ms: 6_000,
  },
];

/**
 * One camera on the demo road.
 *
 * `street` and `cross` are real Chicago cross streets along the route, and
 * they are not decoration: the exposure log labels a pass from exactly these
 * two fields, so a camera without them logs as a dash. A demo whose log reads
 * "- · - MPH · 851 FT" five times over shows the feature failing.
 */
function camera(
  id: string,
  lat: number,
  lon: number,
  direction: number,
  street: string,
  cross: string,
): CameraRecord {
  return {
    id: `demo:${id}`,
    lat,
    lon,
    directionDeg: direction,
    ownerType: 'police',
    street,
    cross,
    // THE FIELD THE WHOLE ABUSE STAGE TURNS ON. `zoneLive` takes the commonest
    // FIPS among nearby cameras, so this is what makes the county resolve.
    countyFips: DEMO_FIPS,
  } as CameraRecord;
}

/** Metres north of the start, as a latitude. */
const northOf = (lat: number, metres: number): number => lat + metres / M_PER_DEG;

/**
 * N Columbus Drive, northbound.
 *
 * The route was a straight line up -87.6231, which on a Chicago grid runs
 * through buildings and across the river - so `speedAt` had no road to match
 * against and the posted limit stayed a dash for the whole demo. A real
 * north-south arterial gives the real lookup something to find.
 */
const START_LAT = 41.881_9;
const START_LON = -87.620_6;

/**
 * What the plate shows when the real lookup finds nothing.
 *
 * A DEMO VALUE, and the only invented number in this file. `maxspeed` is on
 * roughly 95% of OSM ways but not on every one, and a demo that shows a dash
 * where a driver expects a sign reads as broken rather than as honest. The
 * real lookup is still tried first and still wins whenever it answers, so on a
 * road that carries a limit this is never seen.
 */
export const DEMO_FALLBACK_MAXSPEED = '30 mph';

/**
 * The road, as cameras placed along it.
 *
 * Distances are chosen against the DEFAULT 500 ft threshold so the states
 * arrive in order: one camera far enough out to leave the corridor clear, one
 * at the approach band, then a cluster close enough together to read as a
 * single gauntlet rather than four separate events.
 */
export function demoCameras(): readonly CameraRecord[] {
  const ft = (n: number): number => n / FT_PER_M;
  const ST = 'N Columbus Dr';
  return [
    camera('far', northOf(START_LAT, ft(7_000)), START_LON, 180, ST, 'E Grand Ave'),
    camera('approach', northOf(START_LAT, ft(3_200)), START_LON, 180, ST, 'E South Water St'),
    camera('near', northOf(START_LAT, ft(1_400)), START_LON, 180, ST, 'E Lower Wacker Dr'),
    camera('cluster-1', northOf(START_LAT, ft(900)), START_LON + 0.000_2, 180, ST, 'E Randolph St'),
    camera('cluster-2', northOf(START_LAT, ft(820)), START_LON - 0.000_2, 180, ST, 'E Washington St'),
    camera('cluster-3', northOf(START_LAT, ft(760)), START_LON, 180, ST, 'E Monroe St'),
  ];
}

export interface DemoHandle {
  stop(): void;
}

export interface DemoOptions {
  /** Called whenever the stage changes, so a screen can narrate it. */
  readonly onStage?: (stage: DemoStage, index: number) => void;
  readonly onEnd?: () => void;
}

/**
 * Run the demo. Returns a handle that puts everything back.
 *
 * The drive is a position walked north along one longitude at a steady 45 mph,
 * which is enough to hold the orientation gate open - below walking pace the
 * heading is deliberately withheld and the corridor refuses to answer, which
 * is correct behaviour and a terrible demo.
 */
export function startDemo(options: DemoOptions = {}): DemoHandle {
  const before = useCamerasStore.getState().tiles;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  /**
   * THE DEMO OWNS THE MAP WHILE IT RUNS.
   *
   * `putTiles` alone was not enough: the real archive for wherever the demo is
   * placed loads alongside it, so the drive ran past 144 genuine Chicago
   * cameras with six demo ones mixed in and no stage was legible. Replacing
   * the tile set outright is the only way the scripted escalation is the thing
   * on screen. `stop()` puts the real set back.
   */
  /**
   * THE DEMO OWNS POSITION WHILE IT RUNS.
   *
   * Without this the real geolocation watcher keeps reporting where the phone
   * actually is, the two writers fight, and the phone wins: measured, the
   * drive froze on its first frame while looking like it was running.
   */
  setScriptedPosition(true);
  useCamerasStore.setState({ tiles: new Map() });
  camerasActions.putTiles([
    {
      ref: DEMO_TILE,
      cameras: demoCameras(),
      fetchedAtMs: Date.now(),
      freshness: 'fresh',
      source: 'network',
    },
  ]);

  // 45 mph. Fast enough that the heading gate stays open, slow enough that the
  // escalation is watchable rather than a flicker.
  const speedMps = 20.1;
  const stepMs = 500;
  let elapsedMs = 0;

  interval = setInterval(() => {
    if (stopped) return;
    elapsedMs += stepMs;
    const metres = (speedMps * elapsedMs) / 1000;
    /**
     * A COMPLETE `GeoFix`, and typed rather than cast.
     *
     * The first version of this passed `timestampMs` and omitted the altitude
     * pair, behind an `as never`. The cast silenced the compiler, the store
     * dropped every fix, and the demo froze on its first frame while looking
     * like it was running. The cast is the bug: this shape is checked now, so
     * a field that moves breaks the build instead of the demo.
     */
    const fix: GeoFix = {
      lat: northOf(START_LAT, metres),
      lon: START_LON,
      accuracyM: 4,
      altitudeM: null,
      altitudeAccuracyM: null,
      speedMps,
      headingDeg: 0,
      timestamp: Date.now(),
    };
    positionActions.ingestScriptedFix(fix);
  }, stepMs);

  let at = 0;
  /** Whether THIS demo opened the intel card. See the close note below. */
  let cardOpen = false;
  const advance = (): void => {
    if (stopped || at >= DEMO_STAGES.length) {
      if (!stopped) options.onEnd?.();
      return;
    }
    /**
     * TAKE DOWN WHATEVER THE LAST STAGE PUT UP, FIRST.
     *
     * Two bugs lived here. Closing unconditionally called
     * `navigationActions.back()` when nothing was open - `closeIntelCard`
     * falls through to it, which is right for a close button and catastrophic
     * on a timer - and navigated the app off RADAR on the very first stage.
     * Then, guarded but placed AFTER the open, it closed the card two lines
     * after opening it, so the tap stage rendered nothing at all.
     *
     * At the top, guarded: the card stands for its whole stage and comes down
     * when the next one begins.
     */
    if (cardOpen) {
      closeIntelCard();
      cardOpen = false;
    }

    const stage = DEMO_STAGES[at] as DemoStage;
    options.onStage?.(stage, at);

    // The mute is a real mute through the real action, not a flag. Anything
    // less would not exercise the invariant it exists to show.
    if (stage.id === 'muted') alertActions.muteAll(Date.now());


    /**
     * ZOOM AND TAP ARE DRIVEN THROUGH THE REAL SURFACES.
     *
     * `easeTo` on the live MapLibre instance is the same thing a pinch does,
     * and `openIntelCard` is the same handler a tapped dot calls. Animating a
     * picture of either would prove nothing.
     */
    if (stage.id === 'zoom-out') {
      const map = currentMap();
      if (map?.easeTo !== undefined && map.getZoom !== undefined) {
        map.easeTo({ zoom: Math.max(9, map.getZoom() - 3.2), duration: 2_600 });
      }
    }
    if (stage.id === 'zoom-in') {
      const map = currentMap();
      if (map?.easeTo !== undefined && map.getZoom !== undefined) {
        map.easeTo({ zoom: map.getZoom() + 3.2, duration: 2_200 });
      }
    }
    if (stage.id === 'tap') {
      // A camera the driver can actually see: the nearest one the engine has
      // assessed, which is whatever is genuinely closest right now.
      /**
       * DISMISS THE TAKEOVER FIRST.
       *
       * "A live camera alert always wins the screen" is a deliberate rule and
       * it applies to this overlay too - so opening the card mid-alert set the
       * selection, opened the overlay, and rendered nothing, because the
       * takeover was drawn over it. Correct behaviour, invisible failure.
       *
       * Dismissing is what a driver does to read a card during an alert, so
       * the demo does the same thing rather than working around it.
       */
      alertActions.dismiss();
      const nearest = useCamerasStore.getState().nearest;
      if (nearest !== null) {
        openIntelCard(nearest.id);
        cardOpen = true;
      }
    }

    at += 1;
    timers.push(setTimeout(advance, stage.ms));
  };
  advance();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (interval !== null) clearInterval(interval);
      // Hand position back to the radio FIRST, so a failure below cannot leave
      // a driver with a latched-off GPS.
      setScriptedPosition(false);
      for (const t of timers) clearTimeout(t);
      alertActions.unmuteAll(Date.now());
      if (cardOpen) {
        closeIntelCard();
        cardOpen = false;
      }
      // PUT THE ARCHIVE BACK. Leaving a driver's app full of Chicago is worse
      // than never having run a demo.
      useCamerasStore.setState({ tiles: before });
      options.onEnd?.();
    },
  };
}

/**
 * THE RUNNING DEMO, OWNED BY THE MODULE RATHER THAN BY A COMPONENT.
 *
 * The first version had `DemoControl` hold the handle in a ref and stop it on
 * unmount, which is the correct instinct for a component that owns a timer and
 * exactly wrong here: pressing the button navigates to RADAR, RADAR unmounts
 * SETTINGS, the cleanup fires, and the demo stops before its first tick. It
 * looked like a frozen drive; it was a demo that had already been cancelled.
 *
 * Same shape as the alert loop and the camera sync, and for the same reason: a
 * thing that must outlive whatever screen is mounted cannot be owned by one.
 */
let running: DemoHandle | null = null;
const listeners = new Set<(stage: DemoStage | null) => void>();

function publish(stage: DemoStage | null): void {
  for (const listener of listeners) listener(stage);
}

/** Subscribe to stage changes. Returns an unsubscribe. */
export function onDemoStage(listener: (stage: DemoStage | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function demoRunning(): boolean {
  return running !== null;
}

/** Start it, or stop it if it is already going. */
export function toggleDemo(): void {
  if (running !== null) {
    running.stop();
    running = null;
    publish(null);
    return;
  }
  running = startDemo({
    onStage: (stage) => {
      publish(stage);
    },
    onEnd: () => {
      running?.stop();
      running = null;
      publish(null);
    },
  });
}

/**
 * The limit to show while a demo is running and the real lookup has nothing.
 *
 * Null whenever no demo is running, so this can only ever affect a demo. The
 * real value always wins - see `RadarScreen`, which only consults this when
 * `speedAt` returned nothing.
 */
export function demoMaxspeed(): string | null {
  return running === null ? null : DEMO_FALLBACK_MAXSPEED;
}
