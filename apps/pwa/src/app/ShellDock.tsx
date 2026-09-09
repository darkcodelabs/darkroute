/**
 * THE DOCK, MOUNTED ONCE, AS CHROME.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS AT ALL
 * =============================================================================
 * `features/dock/Dock.tsx` decides nothing: it is handed a pane, a state, that
 * pane's own data and a handful of callbacks, and it draws them. Its own header
 * says so in capitals. Something has to be the caller, and the caller has to be
 * the SHELL rather than a screen, because the dock is chrome:
 *
 *   - the tab row is how a driver reaches EXPOSURE, MESH, LOOKUP and MORE, and
 *     v3 draws it in every one of the nineteen states. A dock that only exists
 *     while DRIVE is mounted cannot navigate anywhere: the first tap takes it
 *     off screen with the screen that owned it.
 *   - `App.tsx`'s presentation ladder already rules that the dock is never
 *     suppressed by a live camera alert, and `mode.ts` rules that a watch face
 *     draws no dock at all. Both are shell rules about a shell element.
 *
 * =============================================================================
 * WHAT IS DECIDED HERE, AND WHAT IS NOT
 * =============================================================================
 * WHICH PANE AND WHICH STATE is `useDockState`'s, and only its. Nothing in this
 * file reads a camera, a fix or a route in order to describe one, with ONE
 * exception argued out at `detour` below: the number on the detour key is the
 * size of a PLAN rather than a count of anything in a store, so the only
 * surface that can know it is the one that plans it, which is this one.
 *
 * WHERE A TAB GOES is `DOCK_TABS`'s. The five ids are the app's own -- map is
 * `radar`, exposure is `log`, mesh is `node`, lookup is `lookup`, more is
 * `more` -- and are not renamed here or anywhere.
 *
 * WHETHER A PRESS IS A NAVIGATION is `openScreen`'s. Pressing the tab you are
 * already on is a RESELECT: no history entry, subscribers notified, which is
 * how the map recenters. This file hands over the id and does not try to tell
 * the two apart -- a second copy of that rule is how the dock and the URL would
 * end up disagreeing.
 *
 * WHAT THE SHEET IS DOING is the only thing genuinely owned here. Expanded is a
 * gesture on the dock, not a fact about the world. V3 deleted the grab handle
 * and the chevron and made the WHOLE PANE the target, so the gesture is now the
 * pane's own press and the flag still lives with the dock, which is here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { Dock } from '../features/dock/Dock.tsx';
import {
  DOCK_TABS,
  dockDensityTier,
  withArcadeOffer,
  withDetourCount,
} from '../features/dock/dockState.ts';
import type { DockActionKey, DockDensityTier, DockTabKey } from '../features/dock/dockState.ts';
import { LandscapeChrome } from '../features/landscape/LandscapeChrome.tsx';
import { landscapeSlots } from '../features/landscape/slots.ts';
import { raiseSearch, useSearchRaise } from '../features/search/searchRaise.ts';
import type { DockNavAction, DockNavData } from '../features/dock/DriveRows.tsx';
import { detourCameras, useDockState } from '../features/dock/useDockState.ts';
import { offerDetour } from '../features/drive/DetourOffer.tsx';
import { focusMapOn, toggleLayers, useLayersOpen } from '../features/drive/driveSignals.ts';
import { toggleDayNight } from './dayNight.ts';
import { openIntelCard } from '../features/intel/IntelScreen.tsx';
import {
  detourKeyCount,
  detourRouteCameras,
  planDriveDetour,
} from '../features/drive/detour.ts';
import { useSteadyHeading } from '../features/drive/steady.ts';
import { openReportSheet } from '../features/report/ReportScreen.tsx';
import { openArcade } from '../features/arcade/ArcadeOverlay.tsx';
import { useArcadeOffer } from '../features/arcade/offer.ts';
import { planDarkRoute } from '../services/route/darkRoute.ts';
import { RouteRefused } from '../services/route/planRoute.ts';
import { useCameraAssessments, useCamerasStore } from '../stores/cameras.ts';
import { useNavigationStore, useScreen } from '../stores/navigation.ts';
import { useCurrentFix, usePositionStore, useSpeedMph } from '../stores/position.ts';
import { alertActions } from '../stores/alert.ts';
import { routeActions, useRouteStore } from '../stores/route.ts';
import { MARK_SRC } from '../features/chrome/TopBar.tsx';
import { openScreen } from './screenState.ts';
import { useSurface } from './useSurface.ts';

/**
 * WHERE THE MAP IS, read off the tab table rather than written down again.
 *
 * `App.tsx` has its own `MAP_SCREEN` for the persistent map bed, and this is
 * deliberately NOT that constant imported: `App` imports this file, and taking
 * a value back the other way would close the loop. One string, spelled once per
 * direction, and both of them read `radar` off the same tab table if the table
 * ever changes.
 */
const MAP_TAB = DOCK_TABS.find((tab) => tab.key === 'map');

/**
 * WHERE A STEP ROW POINTS. `useDockState` names a step `${beginShapeIndex}-${n}`,
 * so the number before the dash is an index into the route's shape. Exported
 * for the test; null for an id that names no point on this line.
 */
export function stepPoint(
  id: string,
  route: { readonly shape: readonly { readonly lat: number; readonly lon: number }[] } | null,
): { readonly lat: number; readonly lon: number } | null {
  if (route === null) return null;
  const index = Number.parseInt(id, 10);
  if (!Number.isInteger(index) || index < 0) return null;
  const point = route.shape[index];
  return point === undefined ? null : { lat: point.lat, lon: point.lon };
}

export function ShellDock(): ReactElement {
  const screen = useScreen();

  /**
   * WHICH ARRANGEMENT, AND IT IS ARRANGEMENT ONLY.
   *
   * `dash` is landscape by definition -- `services/pwa/orientation.ts` already
   * refuses to lock it, "the dash surface is landscape by definition" -- and it
   * fires at `(min-width: 700px) and (orientation: landscape)`.
   *
   * ROTATING IS A SUBTREE SWAP AND NOT A REMOUNT OF THIS COMPONENT, which is
   * the whole reason the branch is here rather than in `App.tsx`. Everything
   * below -- the expanded gesture, the active tab, the detour plan, every
   * store subscription -- lives above the branch, so a rotation keeps all of
   * it. Section D: "Drive state, route, alert timers and map camera all survive
   * the transition." The map is not in either subtree at all; it stays in
   * `.fwm-shell-mapbed`, one stable position, so MapLibre's context and the
   * camera it was flying are untouched by a rotation.
   */
  const landscape = useSurface() === 'dash';
  /* WHETHER THE SEARCH FIELD HAS FOCUS, which is the only thing this component
     needs to know about the panel: focused means a full-width soft keyboard is
     over the layout, and the landscape chrome gets out of its way. Read
     unconditionally, above the early return below, because it is a hook. */
  const search = useSearchRaise();
  /* Whether DRIVE's Layers panel is up, so the landscape circle draws lit. */
  const layersOpen = useLayersOpen();

  /**
   * THE PANE, PRESSED OPEN.
   *
   * The three sheets are the collapsed and navigating panes with the body
   * pressed. No store holds that and none should: it is a gesture on one
   * element, and the element is here.
   */
  const [expanded, setExpanded] = useState(false);

  /**
   * AND SHUT AGAIN ON THE WAY TO ANOTHER SCREEN.
   *
   * The expanded sheet is 302px of nearby readers or of turn steps -- an answer
   * about the road, opened over the map. Carrying it onto MORE would leave two
   * thirds of that screen under a list the driver opened somewhere else and did
   * not close. Navigating away is the closest thing to "I am done with this"
   * the dock gets.
   */
  useEffect(() => {
    setExpanded(false);
  }, [screen]);

  /**
   * THE DOCK IS NOT ALWAYS OVER THE MAP, and the ladder is told.
   *
   * A maneuver row on EXPOSURE is a stale answer about a road the driver is not
   * looking at. Off the map the ladder falls through to its collapsed half,
   * which is still derived from live stores and still true -- see `overMap` on
   * `DockStateInput` for the whole argument.
   */
  const derived = useDockState({
    expanded,
    overMap: screen === MAP_TAB?.screen,
  });

  /**
   * WHETHER PEW IS ON OFFER, which is the second field the ladder does not
   * derive. `features/arcade/offer.ts` holds the eight conditions -- parked by
   * the engine's own verdict, in range, nothing being said, on the map, on
   * `dense`, motion not reduced -- and this is the only surface that asks. It
   * rides onto the collapsed pane through `withArcadeOffer` the way the detour
   * count rides through `withDetourCount`, and it draws in the inset slot.
   */
  const arcade = useArcadeOffer(derived);

  /**
   * THE DETOUR, PLANNED ON EVERY RENDER SO THE KEY CAN COUNT HONESTLY.
   *
   * =========================================================================
   * THE BUG: TWO SETS, ONE NUMBER, AND A LINE AIMED AT NEITHER
   * =========================================================================
   * The key read `Reroute around 14` and the route it planned reported "0
   * readers on route - 0 avoided", because the fourteen and the plan were
   * different collections. `useDockState` counted every reader inside two miles
   * for the label; `planDriveDetour` then threw away every one of them that was
   * behind the car, further off the line than the berth, or past the end point,
   * which on a stationary phone surrounded by readers was nearly all fourteen.
   *
   * So the plan is built HERE, once per render, and the label is read off it
   * with `detourKeyCount`. The number on the glass is the plan's own
   * `consideredCameras` and cannot be anything else, because there is no second
   * count to disagree with it.
   *
   * THAT ALONE WOULD ONLY HAVE MADE THE KEY SAY `Reroute around 1`. The other
   * half is in `detour.ts`: with no course to plan along, the line is aimed at
   * the readers rather than at whatever bearing was lying around, so the
   * corridor holds a real set instead of whichever single camera happened to
   * fall in it. The exposure card is a parked phone, and the geometry the key
   * was borrowing was written for a moving one.
   *
   * =========================================================================
   * AND THE PRESS OFFERS THIS SAME PLAN, NOT ANOTHER ONE
   * =========================================================================
   * `reroute` still reads its stores at press time, and is right to: it re-aims
   * a route from where the car is NOW. This key cannot. The end point is
   * DERIVED FROM THE ORIGIN - a run-out along the heading past the farthest
   * reader - so a plan built from one fix and sent from a fresher one would be
   * aimed from a place the car has left. One fix, one heading, one plan, and
   * the driver is offered the plan whose size they read on the key.
   *
   * =========================================================================
   * THE HEADING IS THE GPS COURSE, HELD, AND NEVER THE COMPASS
   * =========================================================================
   * `useSteadyHeading` off the fix's own course is the rule `steady.ts` wrote:
   * the last heading taken while actually MOVING, held when the car stops, null
   * until the phone has seen the car move at all. A compass says where the
   * phone is pointing; a detour is about where the car is going. It is the
   * fix's course rather than `useHeadingDeg` for one reason beyond that: this
   * component is mounted on every screen for the life of the app, and
   * `headingDeg` is written on every compass sample, so subscribing the whole
   * chrome to it would re-render the chrome at sensor rate.
   */
  const fix = useCurrentFix();
  const speedMph = useSpeedMph();
  /**
   * THE ROUTE'S OWN MEASUREMENTS, for the landscape bottom slot and nothing
   * else. `useDockState` reads the same store and turns it into three
   * sentences; the slot draws an arrival clock, a duration, a reader count and
   * a distance, and none of those four is a sentence the dock has a slot for.
   * Subscribed here rather than inside the landscape tree so that tree stays
   * presentational and assertable without a store.
   *
   * IT IS THE SAME STORE, so the two arrangements cannot be describing
   * different plans -- which is the property `landscapeSlots` taking `derived`
   * rather than re-reading is protecting on the other half of the data.
   */
  const route = useRouteStore((state) => state.route);
  const onLine = useRouteStore((state) => state.onLine);
  const heading = useSteadyHeading(fix?.headingDeg ?? null, speedMph);
  const assessments = useCameraAssessments();

  /**
   * ONE COLLECTION, NAMED, AND THEN USED THREE TIMES.
   *
   * `detourCameras` is the two-mile horizon the exposure count is taken over --
   * see its own header for why the whole phone would run the route out miles
   * past anywhere the driver is going. This is the set the planner steers
   * around, the set the key's number is a subset of, and the set the router
   * measures its answer against, and it is bound to a name here so that the
   * third of those cannot quietly become a different reading of the store.
   */
  const nearby = useMemo(() => detourCameras(assessments), [assessments]);

  const detour = useMemo(
    () => planDriveDetour(fix, heading, nearby),
    [fix, heading, nearby],
  );

  /**
   * ZERO IS AN ABSENCE. `withDetourCount` deletes the field when there is no
   * route to offer, and every pane draws the key only where the field is
   * present, so a refusal takes the key off the dock instead of leaving one
   * that can only apologise.
   */
  const detourCount = useMemo(() => detourKeyCount(detour), [detour]);

  /**
   * WHICH TAB IS LIT: the screen on top, through the same table the presses go
   * out by. Anything the dock does not name -- `misuse`, `settings`, `docs`,
   * and the rest of what sits behind MORE -- lights MORE.
   */
  const activeTab = useMemo<DockTabKey>(
    () => DOCK_TABS.find((tab) => tab.screen === screen)?.key ?? 'more',
    [screen],
  );

  const onTab = useCallback((key: DockTabKey) => {
    const tab = DOCK_TABS.find((candidate) => candidate.key === key);
    if (tab === undefined) return;
    openScreen(tab.screen);
  }, []);

  const onExpand = useCallback(() => {
    setExpanded(true);
  }, []);
  const onCollapse = useCallback(() => {
    setExpanded(false);
  }, []);

  /**
   * THE DOCK'S NON-TAB KEYS.
   *
   * `end` clears the plan. It is the only End in the application - the
   * navigation card that used to carry one is deleted - so without it a driver
   * can start a route and never stop one.
   *
   * `reroute` and `recalculate` both re-plan from where the driver is NOW, and
   * read their stores at PRESS TIME to do it. That is the right reading for a
   * key whose whole job is "from here, again": the car has moved since the
   * render that drew it, and nothing on the glass has already promised a size.
   * They are two keys rather than one because they are two OFFERS - `reroute`
   * bends a line that is still under you around a reader, `recalculate` picks
   * up a line you have already left - and section E5 spells the second out on
   * its own key. They plan identically, and saying so once here is cheaper than
   * two copies of the same twenty lines.
   *
   * `around` IS THE DETOUR KEY. It does NOT plan at press time, and that is the
   * difference between it and the two above rather than an inconsistency: its
   * face is a COUNT, the count is the size of a plan, and the plan the driver
   * is offered has to be the plan they read the number off. So it is built at
   * render, above, and this handler only raises it. NOTHING leaves the phone on
   * the press; it hands the same `offerDetour(...)` prompt
   * `features/alert/AlertV1.tsx` raises from its own REROUTE key, so the two
   * surfaces cannot ask differently for one drive.
   *
   * The rest are NOT WIRED, and are left visibly unwired rather than given a
   * plausible destination:
   *
   *   dismiss  UNMAPPED, which is unreachable.
   *   add      UNMAPPED, which is unreachable.
   *   wrong    CLEARED. "Wrong?" disputes a pass that was just logged, and
   *            nothing in this build can retract a log entry.
   *   start    E1's key. There is no unstarted route in this build -- planning
   *            publishes the line and the map draws it -- so there is nothing
   *            for Start to start. The state is nearly unreachable and its verb
   *            is fixed by `DriveRows.NAV_SHAPE` rather than by data; see the
   *            report.
   *   save     E6's key. Nothing in this build saves a drive.
   *
   * `cancel` IS wired now, below: `routeActions.cancelPlanning` disowns the
   * plan in flight and keeps the old line and the destination, which is what
   * E4's key says it does.
   */
  const onAction = useCallback(
    (action: DockActionKey) => {
      if (action === 'end') {
        routeActions.clear();
        /*
         * AND THE SHEET SHUTS WITH THE ROUTE. `End` is drawn twice - on the
         * 170px maneuver row and in the header of the turn list grown under it
         * - and the second one shipped leaving `expanded` set. The route went,
         * the ladder fell through to the collapsed half, and the collapsed half
         * honours the same flag: a driver who pressed End on their turn list
         * landed on 302px of nearby readers they had not asked for, with the
         * only way out a second press on a pane that had just changed under
         * their thumb. The sheet was the route's; when the route ends, so does
         * the gesture that opened it.
         */
        setExpanded(false);
        return;
      }

      /*
       * UNDO THE MUTE, WHICH IS THE ONLY WAY BACK OUT OF ONE.
       *
       * THIS KEY WAS LEFT UNWIRED, and the note that used to sit above said
       * why: "MUTED is a GLOBAL mute in this app and the spec's key undoes
       * whichever mute raised the state; picking one here would undo the wrong
       * thing half the time." That reasoning was wrong about its own state
       * machine. `useDockState` raises MUTED from `useIsMuted()`, which is
       * `alert.muted` -- the GLOBAL mute and nothing else -- and it prints
       * `useMuteRemainingMs()`, which is the global countdown. A per-camera
       * mute does not raise this row and has no countdown on it, so there is no
       * ambiguity to resolve: the mute this row is about is the one
       * `unmuteAll` ends.
       *
       * The cost of the caution was total. A driver who muted had no control
       * anywhere in the application that would unmute them -- the key was drawn
       * (and then, while a route was live, painted over by the detour count;
       * see `BrowseRow.MetaKey`) and pressing it did nothing. Reported by the
       * owner in those words: "there is no way to unmute".
       *
       * IT GOES THROUGH THE ALERT STORE and not through settings, because
       * `alertActions.unmuteAll` re-evaluates the engine on the same tick --
       * so the row leaves MUTED on the press instead of on the next position
       * fix, which on a stationary phone can be a long time to stare at a
       * countdown that is no longer counting anything.
       */
      if (action === 'undo') {
        alertActions.unmuteAll(Date.now());
        return;
      }

      /*
       * PEW. The key only exists while `useArcadeOffer` said so, and the
       * overlay re-checks on mount, so this handler decides nothing; it
       * raises the arena and the arena stands itself down. Nothing leaves
       * the phone and nothing is written down -- `features/arcade/` imports
       * no service and no persistence.
       */
      if (action === 'arcade') {
        openArcade();
        return;
      }

      /**
       * THE DETOUR KEY. Plans on the device, then ASKS.
       *
       * IT RAISES THE EXISTING PROMPT AND DOES NOT REBUILD IT. `DetourOffer`
       * owns the question, the refusal text and the one place a route leaves
       * this phone; `AlertV1`'s REROUTE key raises it with exactly this pair. A
       * second consent flow spelled out here would be a second answer to "did
       * anything get sent", which is the one question this feature exists to
       * keep answerable by reading one function.
       *
       * WHAT IS OFFERED IS THE PLAN THE KEY COUNTED. `detour` is built above,
       * from one fix, one heading and one collection of readers, and the number
       * on the key is read off that same object -- so `Reroute around 3` and
       * the route the prompt describes are three of the same readers by
       * construction.
       *
       * THE CONTEXT'S CAMERAS ARE THE SAME COLLECTION, WIDER THAN THE PLAN'S
       * COUNT AND NOT WIDER THAN THE PLANNER'S INPUT.
       * `services/route/darkRoute.ts` measures EVERY round's new line against
       * what it is handed, on the device. A route bent around the three readers
       * beside your line is a different road with its own readers on it, and
       * handing the router only those three is how a build shipped "2 avoided"
       * over a line that passed nine. So `nearby` is every reader within two
       * miles in every direction, not the subset that ended up beside the line.
       *
       * IT ALWAYS RAISES SOMETHING. `detourKeyCount` takes the counting key off
       * the dock for all five refusals, so this handler is normally unreachable
       * without a plan behind it -- and `planDriveDetour` still answers with a
       * REASON rather than a null, so if it is reached the prompt says which of
       * the five it is instead of quietly doing nothing.
       *
       * AND IT SILENCES FIRST ONLY WHEN THE TAKEOVER IS ACTUALLY UP. `AlertV1`
       * mutes before it offers because the takeover layer paints over every
       * overlay by construction, so the prompt would be raised underneath it.
       * This key used to skip that on the argument that it lives on panes with
       * no takeover on screen - which is true of the parked exposure card and
       * false of UNDER SURVEILLANCE and APPROACHING, both of which the ladder
       * draws WHILE the engine is in range and the takeover is holding the
       * screen. Pressed there, the key raised the prompt into
       * `savedOverlays`, nothing visible happened, and the question surfaced
       * on its own a minute later about a place the car had already left: a
       * dead press followed by a stale one. So it reads the presentation at
       * press time and does exactly what `AlertV1`'s REROUTE key does when the
       * same layer is in the way; with nothing covering the prompt it still
       * buys no silence the driver did not ask for.
       */
      if (action === 'around') {
        if (useNavigationStore.getState().presentation === 'camera-alert') {
          alertActions.muteAll(Date.now());
        }
        offerDetour(
          detour,
          fix === null
            ? null
            : {
                from: { lat: fix.lat, lon: fix.lon },
                cameras: detourRouteCameras(nearby),
              },
        );
        return;
      }

      if (action === 'cancel') {
        routeActions.cancelPlanning();
        return;
      }

      if (action !== 'reroute' && action !== 'recalculate') return;

      const target = useRouteStore.getState().destination;
      /* NAMED FOR WHEN IT WAS READ, and not `fix`, which is the rendered one
         above: this key wants the position as of the press and the two must not
         be able to stand in for each other by having the same name. */
      const pressFix = usePositionStore.getState().fix;
      if (target === null || pressFix === null) return;
      const cameras = useCamerasStore.getState().cameras;

      routeActions.planning();
      planDarkRoute({
        from: { lat: pressFix.lat, lon: pressFix.lon },
        to: { lat: target.lat, lon: target.lon },
        cameras,
      })
        .then((built) => {
          routeActions.planned(built.route, built.avoided, built.remaining);
        })
        .catch((cause: unknown) => {
          /*
           * The server's own sentence - "no driving route avoids all of those,
           * try again with fewer of them" names something a driver can do. A
           * generic failure does not.
           */
          routeActions.failed(
            cause instanceof RouteRefused ? cause.message : 'that route could not be planned.',
          );
        });
    },
    [detour, fix, nearby],
  );

  /**
   * THE NAVIGATION PANE'S ACTIONS ARE A SUBSET OF THE SAME UNION.
   *
   * `DockNavAction` is `Extract`ed from `DockActionKey`, so this is a widening
   * and not a translation. It exists because `DockProps` narrows the callback
   * per pane -- a caller cannot hand the navigation row a `wrong` handler --
   * and one shared implementation is what keeps `end` and `around` from meaning
   * two things on two panes.
   */
  const onNavAction = useCallback(
    (action: DockNavAction) => {
      onAction(action);
    },
    [onAction],
  );

  const shell = {
    activeTab,
    onTab,
    onReport: openReportSheet,
    onExpand,
    onCollapse,
  } as const;

  /**
   * LANDSCAPE. One tree, three panes' worth of data, and no second state.
   *
   * `landscapeSlots` reads the SAME `derived` the portrait dock is handed --
   * not the stores again -- so the two arrangements cannot describe different
   * drives. What it needs on top of that is the route's own measurements, which
   * the dock's shapes have no slot for: an arrival clock, a duration, a reader
   * count and a distance remaining. Those come off the route store here and are
   * formatted once, in `slots.ts`.
   *
   * THE COUNT IS NEVER FAKED. `route.onLine` is a live array so its length is a
   * real count; a route that has not been planned has none and the slot draws a
   * dash. `dockDensityTier` colours the monitor count on the dock's own
   * four-tier ramp over two miles, and `'unknown'` is the uncomputed state
   * rather than a fifth tier.
   */
  if (landscape) {
    const slots = landscapeSlots(derived, {
      seconds: route?.seconds ?? null,
      miles: route?.miles ?? null,
      onRoute: route === null ? null : onLine.length,
      nowMs: Date.now(),
    });
    const monitorCount = slots.bottom.kind === 'monitor' ? slots.bottom.count : null;
    const density: DockDensityTier | 'unknown' =
      monitorCount === null || monitorCount.state !== 'known'
        ? 'unknown'
        : dockDensityTier(monitorCount.cams);

    return (
      <LandscapeChrome
        activeTab={activeTab}
        onTab={onTab}
        slots={slots}
        density={density}
        expanded={expanded}
        onExpand={onExpand}
        onCollapse={onCollapse}
        nearby={
          derived.pane === 'expanded' && derived.view.view === 'nearby'
            ? derived.view.data.nearby
            : undefined
        }
        onPickNearby={openIntelCard}
        onReroute={() => {
          onAction('around');
        }}
        onEnd={() => {
          onAction('end');
        }}
        markSrc={MARK_SRC}
        /* THE CHROME YIELDS TO THE KEYBOARD. See section 9 of
           `landscape.css`; the flag is the same one the panel reads. */
        yielding={search.focused}
        right={{
          /* SEARCH IS THE FIRST RIGHT-RAIL BUTTON, AND IT IS WIRED NOW.
             Section D: "Search becomes the first right-rail button and opens
             the destination panel in section A4."

             IT DOES NOT MOUNT A PANEL. `TopBar` is still the panel's only host
             -- it owns the query, the place book, the on-device hits and the
             lookup results -- so this raises a flag that host is already
             watching rather than building a second search component, which the
             brief's one-component rule forbids. `features/search/searchRaise.ts`
             argues why the flag is a module and not a prop: the two openers are
             in two subtrees and neither is an ancestor of the other.

             AND IT OPENS WITH THE KEYBOARD DOWN. `raiseSearch` focuses nothing.
             "Most trips are somewhere the user has already been, so the panel's
             job on open is to show those." */
          onSearch: raiseSearch,
          /* LAYERS AND DAY/NIGHT ARE DRIVE'S OWN STATE, and both are reached
             over `features/drive/driveSignals.ts` and `app/dayNight.ts` rather
             than by lifting that state into a component that remounts on every
             screen change. The circle draws lit while the panel it opened is
             up, which is the flag DRIVE publishes back. */
          layersOn: layersOpen,
          onLayers: toggleLayers,
          onDayNight: toggleDayNight,
          queuedReports: 0,
          onReport: openReportSheet,
          /* THE GEAR GOES WHERE EVERY OTHER GEAR IN THE PRODUCT GOES. It was
             left off this list and the circle drew exactly as the wired ones do
             - `landscape.css` paints nothing off `data-fwm-unwired` - so a
             driver who pressed Wide layout had a Settings key that did nothing,
             on the one surface where the portrait rail's gear is `display:
             none`. `openScreen('settings')` is the same call the rail, the
             layers panel and the map view panel make; there is nothing here to
             invent.

             Every circle on this rail is wired now; `landscape.css` still owes
             `data-fwm-unwired` a look, so the next one that is not will say so. */
          onSettings: () => {
            openScreen('settings');
          },
        }}
      />
    );
  }

  if (derived.pane === 'navigating') {
    return (
      <Dock
        {...shell}
        pane="navigating"
        state={derived.state}
        data={withNavDetourCount(derived.data, detourCount)}
        onAction={onNavAction}
      />
    );
  }

  if (derived.pane === 'expanded') {
    /* THE SHEET'S OWN HANDLERS, one per view, and each of them is the handler
       the collapsed pane would have used for the same press: a reader opens its
       intel card wherever it is drawn. A step row moves the map to that turn:
       the id `useDockState` gives a step begins with the maneuver's shape
       index, and the route's shape has the point. `onChoose` has no destination
       in this build -- there is no second route to choose -- and is passed as
       `undefined` rather than as a handler that swallows the press. */
    const view = derived.view;
    return (
      <Dock
        {...shell}
        pane="expanded"
        state={derived.state}
        view={
          view.view === 'nearby'
            ? {
                view: 'nearby',
                data: withNearbyDetourCount(view.data, detourCount),
                onPick: openIntelCard,
                onAction: onNavAction,
              }
            : view.view === 'turn-list'
              ? {
                  view: 'turn-list',
                  data: { ...view.data, nav: withNavDetourCount(view.data.nav, detourCount) },
                  onStep: (id: string) => {
                    const point = stepPoint(id, useRouteStore.getState().route);
                    if (point !== null) focusMapOn(point);
                  },
                  onAction: onNavAction,
                }
              : {
                  view: 'route-choice',
                  data: view.data,
                  onChoose: undefined,
                  onAction: onNavAction,
                }
        }
      />
    );
  }

  return (
    <Dock
      {...shell}
      pane="collapsed"
      state={derived.state}
      data={withArcadeOffer(withDetourCount(derived.data, detourCount), arcade)}
      onAction={onAction}
    />
  );
}

/**
 * THE SAME RULE AS `withDetourCount`, for the two shapes that are not `DockData`.
 *
 * NULL DELETES THE FIELD RATHER THAN BLANKING IT, because every pane draws the
 * key on the field being present -- so an absent field IS an absent key, which
 * is the whole of "a key offering to route around nothing is a key that
 * refuses". `exactOptionalPropertyTypes` is on, so `around: undefined` would be
 * a type error here rather than a quiet second spelling of the same thing.
 *
 * Two functions and not one generic, because the two interfaces are unrelated
 * and a generic over "objects with an optional `around`" would accept anything
 * with a number on it, including the data of a pane that draws no key at all.
 */
function withNavDetourCount(data: DockNavData, count: number | null): DockNavData {
  const { around: _replaced, ...rest } = data;
  return count === null ? rest : { ...rest, around: count };
}

function withNearbyDetourCount<T extends { readonly around?: number }>(
  data: T,
  count: number | null,
): T {
  const { around: _replaced, ...rest } = data;
  return (count === null ? rest : { ...rest, around: count }) as T;
}
