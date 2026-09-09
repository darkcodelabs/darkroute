import { App, type OverlayRegistry, type ScreenRegistry } from './app/App.tsx';
import './styles/tokens.css';
import './styles/global.css';

/**
 * ENTRY POINT.
 *
 * The two imports above are FIRST and IN THAT ORDER, and that is a contract,
 * not a habit - `apps/pwa/index.html` states it, `global.css` consumes
 * `var(--fwm-*)`, and Tailwind's preflight is emitted from the `@tailwind`
 * directives inside `global.css`. Tokens must be declared before either.
 * This file lives at `src/main.tsx` because `index.html` loads
 * `/src/main.tsx`; the rest of the shell lives in `src/app/`.
 *
 * WHY SURFACE AND MODE ARE SET BEFORE THE FIRST RENDER
 *   `data-fwm-surface` and `data-fwm-mode` select the token blocks in
 *   `tokens.css`. Setting them from a React effect would paint one frame of the
 *   phone layout on a watch. So they are applied synchronously here, and
 *   `App.tsx` only keeps them in sync afterwards.
 *
 * WHAT DOES NOT HAPPEN HERE
 *   No permission is requested. No sensor is started. No service worker is
 *   registered from this file - `App.tsx` owns that, and it self-disables in
 *   dev builds. Nothing on this path can raise an OS dialog.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DEFAULT_MODE, applyMode } from './app/mode.ts';
import { initScreenState } from './app/screenState.ts';
import { captureEntrySearch } from './app/firstRun.ts';
import { detectSurface } from './app/surface.ts';
import { bootStores } from './stores/boot.ts';
import { createCameraSync } from './services/cameras/sync.ts';
import { setCameraSync } from './services/cameras/syncInstance.ts';
import { createAlertLoop } from './services/alerts/engineLoop.ts';
import { createAlertDelivery } from './services/alerts/delivery.ts';
import { SignedOutBanner } from './features/access/index.ts';
import { DeadDropScreen } from './features/dead-drop/index.ts';
import { HeatMapScreen, ZoneAuditScreen } from './features/zone-audit/index.ts';
import { V1_OVERLAYS, V1_SCREENS } from './app/registry.v1.tsx';
import { AlertV1 } from './features/alert/AlertV1.tsx';

/**
 * THE SCREEN REGISTRY - the one place a built screen is connected to its id.
 *
 * `App.tsx` deliberately takes this as a prop instead of importing screens
 * itself, so the shell never becomes the file every feature has to be edited
 * into, and so an id with nothing registered renders an honest "screen not
 * built" rather than failing the build.
 *
 * An id is absent from this map for exactly one of two reasons, and the
 * difference matters:
 *   - the screen is NOT BUILT YET - `mesh`, `board`, `route`, and the watch
 *     faces
 *   - the screen IS built, or buildable, but its feature is switched off:
 *     `watchlist` (pending permission from haveibeenflocked), `record`
 *     (pending the aggregation contract) - see src/config/features.ts
 *
 * `lookup` used to be in that second list and is now registered. The reason it
 * was off was that answering its question needs haveibeenflocked's API, which
 * their robots.txt refuses. Linking to them needs no permission at all - their
 * robots.txt says `Allow: /` - so the screen hands the driver over instead of
 * querying. The FLAG stays off and still gates any automated query.
 * Both land on the same honest placeholder, which is the right outcome: the
 * driver is told there is nothing here, not shown a convincing fake.
 */
const SCREENS: ScreenRegistry = {
  /**
   * THE THREE IDS v1 NEVER REDREW.
   *
   * Everything else in this registry was a v0 screen that `V1_SCREENS` shadowed,
   * so it was imported, bundled and never rendered. These three have no v1
   * counterpart and are the whole of what is left: they are not "the old
   * design", they are simply the screens nobody has restyled.
   *
   * All three are reachable only by URL. The registry decides what `?screen=`
   * resolves to, never who may use it -- ADMIN renders a refusal unless the
   * SERVER says the signed-in identity is an administrator.
   */
  'dead-drop': DeadDropScreen,
  'zone-audit': ZoneAuditScreen,
  'heat-map': HeatMapScreen,
};

/**
 * OVERLAYS - the same components, reached the other way.
 *
 * REPORT is a sheet raised over whatever screen you were on, and INTEL is a
 * modal raised from a SWEEP dot. Both are also reachable as screens (the dock's
 * REPORT circle navigates; a deep link can address either), so each is
 * registered twice on purpose rather than duplicated into two components.
 *
 * `V1_OVERLAYS` supplies all three; this map exists so the spread in the render
 * below keeps one shape, and so a future overlay with no v1 form has somewhere
 * to go.
 */
const OVERLAYS: OverlayRegistry = {};

const surface = detectSurface();

// Night Watch is the default and the only mode allowed on an always-on watch
// face; `applyMode` enforces that itself when the surface is watch-*.
// A persisted mode preference, when SETTINGS gains one, replaces this argument
// and nothing else - the enforcement stays where it is.
applyMode(DEFAULT_MODE, surface);


// Snapshot the URL the app was opened with BEFORE `initScreenState()` rewrites
// it. The first-run gate needs to know whether this load carried a `?screen=`
// request, and `initScreenState` drops the parameter when it names the default
// screen - after that the question is unanswerable.
captureEntrySearch();

// Adopt the deep link (?screen=…) before the first render, so a manifest
// shortcut opens on its screen instead of flashing RADAR first.
initScreenState();

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root is missing from index.html; the shell has nothing to mount into');
}

/**
 * WHY THE FIRST RENDER WAITS.
 *
 * The stores hydrate at import time, before any storage port can be opened,
 * because opening IndexedDB is asynchronous - so their first read comes from
 * the in-memory fallback and returns nothing. `bootStores()` installs the
 * durable port and re-reads both persisted slices through it.
 *
 * Rendering before that finishes would paint one frame of DEFAULT settings and,
 * worse, run the first-run gate against `onboardingCompletedAtMs: null` - so a
 * driver who finished onboarding weeks ago would be sent back through it on
 * every cold start. The gate is correct; it just cannot be asked before the
 * answer is loaded.
 *
 * It gives up after a deadline rather than waiting forever: a blocked upgrade
 * from another open tab never resolves, and an app that paints defaults and
 * says its settings are not durable beats an app that paints nothing.
 */
// The camera map. A store subscription, not a hook: the fix that triggers a
// tile fetch does not arrive through a component tree, and the sync must
// outlive whatever screen happens to be mounted. It starts before the first
// render so a warm reload with a cached fix fills the map immediately.
// THE ONE CAMERA SYNC. Registered rather than exported: RADAR widens its tile
// ring when the driver zooms out, and a screen importing this file would drag
// the whole shell into every test that touches it. See `syncInstance.ts`.
setCameraSync(createCameraSync());

// The alert loop. packages/core holds the whole state machine and was never
// driven: `alertActions.ingest()` appeared only in tests, so a fix and a
// camera list never became "425 FT, AHEAD". Started after the sync so the
// first tick can already see a tile.
createAlertLoop();

/**
 * And the wire from the gate to the driver's hands.
 *
 * The loop above turns a fix and a camera list into a decision. Until this
 * call, the ONLY thing that decision did was change some pixels:
 * `vibration.buzz()` and `notifications.show()` were complete, tested and
 * called by nothing, so the app could not warn a driver who was looking at the
 * road -- which is every driver worth warning.
 *
 * After the loop, deliberately: delivery subscribes to the store the loop
 * writes, and starting it first would be a subscription to a slice nothing had
 * published to yet.
 */
createAlertDelivery();

void bootStores().then(() => {
  // The store is hydrated by here, so this is the real answer rather than the
  // mirror's guess. They agree in every case except a wipe or a restore.
  createRoot(container).render(
    <StrictMode>
      {/* The banner slot renders nothing until an Access sign-in expires, and
          the shell hides it while a camera alert is live -- a camera outranks a
          message about a login. See features/access/SignedOutBanner.tsx. */}
      <App
        /**
         * THE REGISTRY IS THE DESIGN SEAM.
         *
         * v1 screens are separate components registered under the same ids, so
         * a redesigned screen never edits or branches the v0 one. Ids absent
         * from V1_SCREENS fall through to their v0 component, which is what
         * lets the redesign land one screen at a time without a half-built app
         * in between.
         *
         * Chosen after `bootStores()` rather than from the pre-paint mirror:
         * the mirror is there so the PALETTE is right on the first frame, and
         * `main.tsx` already waits for the store before rendering anything.
         */
        screens={{ ...SCREENS, ...V1_SCREENS }}
        /*
         * NO `dock` PROP, DELIBERATELY. The dock used to be picked here the way
         * the screens are, because there were two of them: v0's six-key bar and
         * v1's four-key pill with the REPORT circle beside it. v0's dock is
         * deleted, so `App` names `DockV1` as its own default. Passing
         * `dock={DockV1}` here would restate that default in a second place,
         * and two statements of one fact go stale one at a time.
         */
        /**
         * THE ALERT LAYER, which v0 does not have.
         *
         * v0's takeover is an attribute on RADAR, so a driver anywhere else
         * when a camera comes into range sees nothing. That was tolerable with
         * five dock keys all one tap from RADAR and is not with v1's hub. This
         * paints over the screen AND over any open sheet, on every screen.
         * v0 keeps its RADAR-local takeover, unchanged.
         */
        alertLayer={AlertV1}
        overlays={{ ...OVERLAYS, ...V1_OVERLAYS }}
        banners={<SignedOutBanner />}
      />
    </StrictMode>,
  );
});
