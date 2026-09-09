/**
 * THE SHELL.
 *
 * Composition only. Every behaviour below belongs to a module this file
 * imports; what lives here is the ORDER those things are stacked in, because
 * the order is a product rule and not a rendering detail.
 *
 * =============================================================================
 * GLOBAL PRESENTATION PRIORITY - the rule this file exists to enforce
 * =============================================================================
 *
 *   "A live camera alert always wins the screen."
 * - Flockys Screens II.dc.html, B10 · CROSSING IN - ESCALATION LADDER
 *
 * The stack, highest first:
 *
 *   1. LIVE CAMERA ALERT      renders over the screen content, always.
 *   2. SHEET / MODAL          only when no alert is live. The stack an alert
 *                             interrupted is held in `screenState.savedOverlays`
 *                             and comes back when the alert clears - it is not
 *                             destroyed, and it is not re-opened on top of a
 *                             later alert.
 *   3. BANNERS AND STRIPS     offline banner, county-entry strip, node strip.
 *                             Suppressed while an alert is live: they are the
 *                             "any banner" the design says the alert beats.
 *   4. SCREEN CONTENT         the dock screen or secondary screen itself.
 *
 * The dock is NOT in that contest and is never suppressed. It is chrome:
 * "REPORT is the last key in the bar, always far right"
 * (Flockys App Screens v2.dc.html, panel DOCK - REPLACES THE ICON ROW), and a
 * driver being alerted to a camera is exactly the driver most likely to want
 * to report it. Hiding the dock during an alert would also trap them on RADAR.
 *
 * Non-camera notifications lose the same contest, but not here - they lose in
 * `services/adapters/notifications.ts`, which is where the OS-level channels
 * and tags live. The rule is the same one; this file owns the in-page half.
 *
 * =============================================================================
 * WHAT THIS FILE DOES NOT DO
 * =============================================================================
 *   No routing library. No permission request on mount - nothing here calls
 *   `request()` on any adapter, and the only browser dialog reachable from this
 *   tree is the install prompt, which `installPrompt.ts` gates behind a user
 *   gesture, a second session and the absence of an alert.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';

// THE DOCK. `ShellDock` is the connected one: it binds the app's own stores and
// screen state to the presentational `features/dock/Dock`, which decides
// nothing for itself. REPORT is the dock's own first child, so the shell
// composes ONE element here where it once composed a key row and a separate
// REPORT bar.
import { ShellDock } from './ShellDock.tsx';

import type { AdapterSet } from '../services/adapters';
import { createInstallPromptController } from '../services/pwa/installPrompt.ts';
import type { InstallPromptController } from '../services/pwa/installPrompt.ts';
import { setInstallController } from '../services/pwa/installRegistry.ts';
import { lockPortrait } from '../services/pwa/orientation.ts';
import { createServiceWorkerController } from '../services/pwa/registerSW.ts';
import type { SwController } from '../services/pwa/registerSW.ts';
import {
  useFwmMode,
  useImmersiveOnLaunch,
  useLocationPermission,
  useSettingsHydrated,
  useTextScale,
  useTypeface,
  useGlass,
  useLiquid,
  useClear,
  useTone,
  useFlat,
  useSettingsStore,
} from '../stores/index.ts';
import { useFirstRunGate } from './firstRun.ts';
import { useSensors } from './sensors.ts';
import { createRadarWakeLock } from '../services/pwa/wakeLock.ts';

import { ShellProviders } from './ShellProviders.tsx';
import { applyMode, reconcileMode } from './mode.ts';
import { isWatchSurface } from './mode.ts';
import { applyTextScale } from './textScale.ts';
import { applyTypeface } from './typeface.ts';
import { applyClear, applyFlat, applyGlass, applyLiquid, applyTone } from './glass.ts';
import { applyForceLandscape } from './forceLandscape.ts';
import { applyMapEarth } from './mapEarth.ts';
import { armImmersive } from '../services/pwa/immersive.ts';
import {
  DEFAULT_SCREEN,
  DOCK_SCREENS,
  openOverlay,
  openScreen,
  presentation,
  topOverlay,
  useScreenState,
} from './screenState.ts';
import type { ScreenId } from './screenState.ts';
import { detectSurface, watchSurface } from './surface.ts';
import type { FwmSurface } from './surface.ts';

/**
 * Screens are injected rather than imported so that this file does not become
 * the place every feature has to be edited into, and so that a build with a
 * screen missing renders an honest empty state instead of failing to compile.
 */
/**
 * The screen that owns the map, and therefore the one kept mounted underneath
 * everything else on a wide surface. `radar` is DRIVE's id in both registries -
 * v1 renamed the screen and deliberately kept the id, so every `?screen=radar`
 * link, the dock key and the alert's restore path went on working.
 */
const MAP_SCREEN = 'radar';

/** The install invite's overlay id. Registered in `registry.v1.tsx`. */
export const INSTALL_OVERLAY = { id: 'install', kind: 'sheet' } as const;

export type ScreenRegistry = Partial<Record<ScreenId, ComponentType>>;

/** Overlays are keyed by the same string `openOverlay({ id })` was called with. */
export type OverlayRegistry = Record<string, ComponentType>;

export interface AppProps {
  readonly screens?: ScreenRegistry;
  readonly overlays?: OverlayRegistry;
  /**
   * The live camera alert layer. When absent, `alertActive` still suppresses
   * overlays - the alert is real even if this build has nothing to draw for it
   * - but banners stay up, because hiding them for a layer that renders
   * nothing would leave the driver with a blank screen.
   */
  readonly alertLayer?: ComponentType | undefined;
  /** Offline banner, county strip, node strip. Hidden while an alert is live. */
  readonly banners?: ReactNode;
  /** Injected in tests so nothing registers a worker or counts a session. */
  readonly serviceWorker?: SwController | null;
  /**
   * The sensor set the GPS watch runs against. `undefined` builds the real
   * platform adapters; `null` disables the runtime entirely, which is what
   * every test passes - jsdom has no geolocation, and a test that opened a
   * real watch would be asserting against the machine it happens to run on.
   */
  readonly sensors?: AdapterSet | null;
  readonly installPrompt?: InstallPromptController | null;
  /** Off in tests: a wake lock in jsdom is noise. */
  readonly holdWakeLock?: boolean;
  /**
   * THE DOCK, injected so a test can render the shell without one.
   *
   * OPTIONAL, DEFAULTING TO `ShellDock`, AND NOT REQUIRED. It was a seam with
   * two sides: v0's six-key bar was the default and `main.tsx` substituted v1's
   * pill. Both of those are gone and there is one dock left to name, so the
   * default is the only answer and nothing passes this in production.
   *
   * IT IS KEPT ANYWAY, and it earns more now than it did then. `ShellDock` is
   * not a presentational bar: it subscribes to the position, camera, alert,
   * route, mesh and settings stores through `useDockState` and polls for the
   * county index. Every shell test that is about something else - the alert
   * ladder, the install invite, the surface attribute - would otherwise mount
   * all of that to assert on a banner. The seam lets such a test hand over a
   * stub, and lets the ones that ARE about the dock assert against the real
   * thing by passing nothing.
   *
   * Required would say the opposite: that the caller has a decision to make. It
   * does not. The chrome-vs-no-chrome question that IS real - the watch draws
   * no dock at all - is decided by `showDockChrome` below, off the surface, and
   * never by this prop.
   *
   * `| undefined` is explicit because `exactOptionalPropertyTypes` is on.
   */
  readonly dock?: ComponentType | undefined;
}

/**
 * Rendered when a screen id has no component registered yet.
 *
 * It says what it is. It does not draw a fake version of the screen, and it
 * does not pretend the feature exists - a placeholder that looks like a working
 * SWEEP is how a build ships claiming to show cameras it never had.
 */
function UnbuiltScreen({ screen }: { readonly screen: ScreenId }): ReactNode {
  /*
   * AND THEN IT LEAVES. A link into a screen this build does not draw --
   * `?screen=board` from an old bookmark, a notification from a previous
   * version -- says so for one frame and lands on the map, replacing the URL
   * so Back does not return to the dead end. Found by the 2026-09-09 sweep:
   * five ids reachable by URL drew nothing but this box.
   */
  /* The five dock tabs and the MORE hub they lead to: a build without one of
     these registered is a test harness, not a dead end. */
  const dock = (DOCK_SCREENS as readonly string[]).includes(screen) || screen === 'more';
  useEffect(() => {
    /* A dock screen with no component is a test harness, not a dead end. */
    if (!dock) openScreen(DEFAULT_SCREEN, { replace: true });
  }, [screen, dock]);
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-6 font-data text-text-muted">
      <div className="text-micro">{screen.toUpperCase()}</div>
      <div className="text-body">screen not built</div>
    </div>
  );
}

export function App({
  screens = {},
  overlays = {},
  alertLayer: AlertLayer,
  banners,
  serviceWorker,
  sensors,
  installPrompt,
  holdWakeLock = true,
  dock: DockChrome = ShellDock,
}: AppProps): ReactNode {
  const state = useScreenState();
  const [surface, setSurface] = useState<FwmSurface>(detectSurface);

  // --- surface + mode ------------------------------------------------------
  // Layout keys off [data-fwm-surface], never off the user agent alone; this
  // is the only subscriber that re-measures it. A mode change can never reach
  // layout, so re-applying the mode on a surface change is safe by
  // construction - it only re-runs the always-on-watch rule.
  useEffect(() => {
    const watch = watchSurface((next) => {
      setSurface(next);
      reconcileMode(next);
    });
    const initial = watch.current();
    setSurface(initial);
    reconcileMode(initial);
    return () => {
      watch.stop();
    };
  }, []);

  // --- portrait lock -------------------------------------------------------
  // Section 06 asks for it. It is refused outside an installed/fullscreen
  // context on every browser, and refusal is not an error - `lockPortrait`
  // never throws and the dash surface is skipped outright.
  useEffect(() => {
    void lockPortrait(surface);
  }, [surface]);

  // --- screen wake lock ----------------------------------------------------
  useEffect(() => {
    if (!holdWakeLock) return undefined;
    const lock = createRadarWakeLock();
    return lock.start();
  }, [holdWakeLock]);

  // --- service worker ------------------------------------------------------
  // `serviceWorker === null` means "explicitly disabled". `undefined` means
  // "make the real one", which self-disables in dev builds.
  const swController = useMemo(
    () => (serviceWorker === null ? null : (serviceWorker ?? createServiceWorkerController())),
    [serviceWorker],
  );
  useEffect(() => {
    void swController?.register();
  }, [swController]);

  // --- persisted appearance ------------------------------------------------
  // main.tsx applies the DEFAULT mode synchronously before the first render so
  // a watch never paints one frame of the phone layout. It cannot apply the
  // driver's SAVED preference, because the settings store has not read the disk
  // yet at that point. This is where the saved values land, once they exist.
  //
  // Without this effect the theme picker in SETTINGS works until the app is
  // reloaded and then silently reverts, and the text-size control does nothing
  // at all on a cold start.
  const settingsHydrated = useSettingsHydrated();
  const immersiveOnLaunch = useImmersiveOnLaunch();
  const preferredMode = useFwmMode();
  const preferredTextScale = useTextScale();
  const preferredTypeface = useTypeface();
  const preferredGlass = useGlass();
  const preferredLiquid = useLiquid();
  const preferredClear = useClear();
  const preferredTone = useTone();
  const preferredFlat = useFlat();
  /* The map's ground, if one was chosen. Applied here with the rest of the
     appearance so it lands before the map builds its style - see
     `app/mapEarth.ts` for why the map has to be told separately. */
  const preferredMapEarth = useSettingsStore((state) => state.mapEarth);
  const preferredForceLandscape = useSettingsStore((state) => state.forceLandscape);
  /**
   * IMMERSIVE ONLY IF IT WAS ASKED FOR.
   *
   * This used to be unconditional: `armImmersive()` on mount, fullscreen on the
   * first touch of every session, status bar gone. It was the most complained
   * about behaviour in the app - people were losing the clock and the battery
   * meter on a phone they were about to drive with, and had not asked for
   * either to go.
   *
   * So it is a setting now, defaulted OFF, offered on the first-run screen and
   * in the map panel. Somebody who wants the edge-to-edge map still gets it in
   * one press; somebody who never touches the switch keeps their status bar.
   *
   * WAITS FOR HYDRATION, which matters more than it looks: the store starts at
   * its defaults and the saved value arrives a tick later, so arming before
   * that would fullscreen the app of every driver who had turned this OFF - the
   * exact people it is for.
   *
   * Armed once and never re-armed - see `armImmersive` for why a refusal is
   * final. Turning the switch on mid-session therefore takes effect on the next
   * launch, which is what "on launch" says it does.
   */
  useEffect(() => {
    if (!settingsHydrated || !immersiveOnLaunch) return undefined;
    return armImmersive();
  }, [settingsHydrated, immersiveOnLaunch]);

  useEffect(() => {
    if (!settingsHydrated) return;
    // `applyMode` re-applies the always-on-watch rule itself, so a saved
    // preference can never override the surface constraint.
    applyMode(preferredMode, surface);
    applyTextScale(preferredTextScale);
    applyTypeface(preferredTypeface);
    applyGlass(preferredGlass);
    applyLiquid(preferredLiquid);
    applyClear(preferredClear);
    applyTone(preferredTone);
    applyFlat(preferredFlat);
    applyMapEarth(preferredMapEarth);
    /* A DECLARED SURFACE HAS TO SURVIVE A RELOAD, or the driver whose phone
       will not rotate re-presses the switch every cold start. See
       `app/forceLandscape.ts`; the call is a no-op when the flag is off. */
    applyForceLandscape(preferredForceLandscape);
    /*
     * THE ADMIN PROBE IS NOT A BOOT CONCERN. It used to run here, which put a
     * request to the administrative surface on the cold-start path of every
     * visitor - to answer a question only SETTINGS and the ADMIN screen ask,
     * and that almost no visitor is the subject of.
     *
     * `useAdmin` asks the first time something actually reads the answer. Still
     * one request per session, and none at all on DRIVE.
     */
  }, [
    settingsHydrated,
    preferredMode,
    preferredTextScale,
    preferredTypeface,
    preferredGlass,
    preferredLiquid,
    preferredClear,
    preferredTone,
    preferredFlat,
    preferredMapEarth,
    preferredForceLandscape,
    surface,
  ]);

  // --- sensors -------------------------------------------------------------
  // The GPS watch. Keyed on the location permission so that granting it in
  // onboarding restarts the runtime immediately - without the key, a driver
  // who tapped ALLOW would sit on NO FIX until they killed the app.
  // `sensors === null` disables it: tests must never open a real watch, and
  // jsdom has no geolocation to open one with.
  const locationPermission = useLocationPermission();
  useSensors(locationPermission, sensors);

  // --- first run -----------------------------------------------------------
  // Onboarding is where location is asked for, so a build that never routes to
  // it is a build that never gets a fix. The gate waits for the settings store
  // to hydrate, because deciding "never onboarded" against an unread store
  // would re-run onboarding on every cold start.
  useFirstRunGate();

  // --- install prompt ------------------------------------------------------
  // start() only counts the launch and captures the event. It shows nothing.
  const install = useMemo(
    () => (installPrompt === null ? null : (installPrompt ?? createInstallPromptController())),
    [installPrompt],
  );
  /**
   * THE INVITE, raised once the controller says it may be.
   *
   * Every rule about WHEN is the controller's: it counts launches so this
   * cannot fire on a first visit, it refuses while a camera alert is live, and
   * it remembers a refusal permanently. This only asks whether it may, and
   * opens a sheet if so.
   */
  useEffect(() => {
    if (install === null) return undefined;
    let live = true;
    const offer = (status: { canPrompt: boolean; installed: boolean }): void => {
      if (!live || !status.canPrompt || status.installed) return;
      openOverlay(INSTALL_OVERLAY);
    };
    const stop = install.subscribe(offer);
    return () => {
      live = false;
      stop();
    };
  }, [install]);

  useEffect(() => {
    if (install === null) return undefined;
    void install.start();
    // Published so MORE can offer the install without App having to thread a
    // controller through a screen registry. See services/pwa/installRegistry.ts.
    setInstallController(install);
    return () => {
      setInstallController(null);
      install.stop();
    };
  }, [install]);

  // --- presentation --------------------------------------------------------
  const layer = presentation(state);
  const overlay = topOverlay(state);
  const Screen = screens[state.screen];
  const Overlay = overlay === null ? undefined : overlays[overlay.id];
  const alertShowing = layer === 'camera-alert' && AlertLayer !== undefined;

  // "no bottom nav: swipe left = SWEEP, right = dismiss, long-press = mute
  //  10 min, rotary bezel = threshold"
  //   -- Flockys Design System.dc.html, section 07, WATCH RULES
  // A 44px-minimum dock inside a 384px round face would eat the circular safe
  // zone, so the watch surfaces get no chrome at all. The gestures that replace
  // it are a separate layer and are not implemented here.
  // GAP: pwa-shell / watch-navigation-has-no-implementation
  const showDockChrome = !isWatchSurface(surface);

  /**
   * MAP-PRIMARY, ON A SCREEN BIG ENOUGH TO HOLD ONE.
   *
   * =========================================================================
   * WHY THE DESKTOP LAYOUT IS NOT JUST BREAKPOINTS
   * =========================================================================
   * On a phone every screen is the whole viewport and navigating REPLACES what
   * you were looking at, which is correct: there is room for one thing. Widen
   * that to a monitor and the same tree gives you a 1,900px-wide settings list
   * and no map at all - the product's single most important surface vanishes
   * because you tapped a nav key.
   *
   * So on `dash` the map STAYS MOUNTED and everything else becomes a panel over
   * it. Not a second component tree: the same `radar` screen, rendered in a
   * layer underneath, with the active screen laid over one side.
   *
   * Mounted rather than re-mounted matters for more than looks. MapLibre holds
   * a WebGL context, the tiles it has fetched and the camera it was flying; the
   * engine loop keeps assessing against a live fix. Unmounting that on every
   * nav and rebuilding it on the way back would drop the context, refetch the
   * tiles and lose the view - which is exactly what tapping SETTINGS did.
   *
   * `dash` is the existing surface for this, and it already fires at
   * `(min-width: 700px) and (orientation: landscape)`. This closes
   * gap record pwa-shell (dash-surface-needs-a-rail-not-a-bottom-dock).
   */
  const mapPrimary = surface === 'dash';
  const MapScreen = screens[MAP_SCREEN];
  // Only when the map is not already the thing being shown - otherwise the
  // same screen would be mounted twice, and DriveScreen owns a map instance.
  const showPersistentMap = MapScreen !== undefined && state.screen !== MAP_SCREEN;

  /*
   * PARKED, ON EVERY SURFACE THAT IS NOT A DASH.
   *
   * The reasoning above - a WebGL context, the fetched tiles and the camera it
   * was flying are all thrown away by an unmount - is not a wide-screen fact.
   * It was fixed for `dash` only, so a phone still paid it: tapping LOG and
   * coming back tore down MapLibre and rebuilt it, which is the blank map that
   * has to draw itself in again.
   *
   * On a phone there is room for one thing, so the map is not laid UNDER the
   * active screen the way it is on a dash - it is parked: mounted, holding its
   * context and its tiles, and made invisible so it cannot bleed through an
   * opaque panel or take a tap meant for what is on top. Coming back is then a
   * visibility change rather than a rebuild.
   *
   * `visibility` rather than `display: none`, deliberately. Removing it from
   * layout would give MapLibre a zero-size container, and it resizes to that -
   * so returning would show a correctly-mounted map with nothing in it, which
   * is the same bug wearing a better disguise.
   */
  const mapParked = showPersistentMap && !mapPrimary;

  return (
    <ShellProviders>
      <div
        className="fwm-shell fwm-safe-x flex flex-col bg-bg font-ui text-body text-text"
        data-fwm-map-primary={showPersistentMap && mapPrimary ? 'true' : undefined}
      >
        {/* 5. THE MAP, UNDERNEATH EVERYTHING, on a wide surface only.
            Below the banners in the ladder because it is the ground rather
            than a message, and `aria-hidden` because the panel over it is what
            a screen reader should be reading - the map is decoration until you
            navigate back to it, at which point this stops rendering and the
            real one takes over. */}
        {showPersistentMap ? (
          <div
            className="fwm-shell-mapbed"
            data-fwm-map-parked={mapParked ? 'true' : undefined}
            aria-hidden="true"
            /* Parked, it is not a control surface and must never eat a tap
               meant for the screen laid over it. */
            inert={mapParked}
          >
            <MapScreen />
          </div>
        ) : null}

        {/* 3. BANNERS - lose to a live camera alert, win over nothing else. */}
        {alertShowing ? null : banners}

        {/* 4. SCREEN CONTENT, with 2. OVERLAY and 1. ALERT stacked over it.
            NO DOCK GUTTER ANY MORE. The dock used to be `fixed bottom-0` and
            the screen reserved 84px of padding to sit clear of it. The dock is
            a flex sibling now and occupies real space, so reserving it here
            would leave an 84px band of dead screen above the bar.
            `fwm-shell-screen` is `flex:1; min-height:0` - the min-height is what
            lets a screen scroll internally instead of growing the page. */}
        {/* WHERE FOCUS LANDS when an overlay closes and the control that
            raised it has gone with it. See components/overlay/useOverlayDismiss.ts:
            a close handler that unmounts the button holding focus drops it on
            the body, and a reader is silently returned to the top of the
            document. Programmatic only - tabIndex -1 is not a tab stop, and a
            screen root is not something a driver ever clicks. */}
        <main
          className="fwm-shell-screen relative"
          data-fwm-screen-root="true"
          tabIndex={-1}
        >
          {Screen === undefined ? <UnbuiltScreen screen={state.screen} /> : <Screen />}

          {/* 2. SHEET / MODAL. `topOverlay()` already returns null while an
              alert is live, so this cannot render over one.

              WRAPPED, AND THE WRAPPER IS THE FIX. `.fwm-shell-screen > *` gives
              every child `flex: 1`, so an overlay rendered as a bare sibling
              became a second FLEX ROW: the screen took the top half and the
              sheet took the bottom half, both visible at once. A camera card
              appeared under DRIVE instead of over it. `.fwm-shell-layer` takes
              it out of flow and lays it over the screen, which is what this
              file's own presentation ladder says an overlay does. */}
          {Overlay === undefined ? null : (
            <div className="fwm-shell-layer">
              <Overlay />
            </div>
          )}

          {/* 1. LIVE CAMERA ALERT. Last in the tree and therefore last painted:
              it covers the screen content and any overlay that somehow
              survived. This is the highest-priority surface in the product. */}
          {alertShowing ? (
            <div className="fwm-shell-layer" data-fwm-layer="alert">
              <AlertLayer />
            </div>
          ) : null}
        </main>

        {/* CHROME - never suppressed by an alert. The dock is on every screen
            including during an alert: the driver being warned about a camera is
            the driver most likely to report it, and hiding the dock would
            strand them on DRIVE. REPORT belongs to the dock component - it
            draws the key and the bar as one pair - so this is one element
            here rather than a bar stacked over a key row.
            The watch has no dock at all - see `showDockChrome` above.
            GAP: pwa-shell / dash-surface-needs-a-rail-not-a-bottom-dock */}
        {/* IN FLOW, NOT FIXED. This was `fixed inset-x-0 bottom-0`, and on
            Chrome for Android that is the bottom of the LAYOUT viewport --
            which sits behind the address bar, while the shell is sized in
            `100dvh`, the VISUAL viewport. The two disagree by exactly the
            height of the browser chrome whenever it is showing, and the dock
            was drawn in the gap: reported twice as the bottom nav
            disappearing, and not reproducible at any viewport size in a
            desktop harness because desktop Chrome has no collapsing bar.

            As a flex child of a `100dvh` column it is inside the visible area
            by construction, on every device, with no unit to get wrong. */}
        {showDockChrome ? (
          <div className="fwm-shell-dock fwm-safe-bottom bg-bg">
            <DockChrome />
          </div>
        ) : null}
      </div>
    </ShellProviders>
  );
}
