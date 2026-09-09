/**
 * WHERE THE DRIVER IS GOING, and the line they are taking to get there.
 *
 * =============================================================================
 * NOTHING IN HERE IS EVER PERSISTED
 * =============================================================================
 * Read this before adding a `persist` middleware, because it will look like an
 * obvious improvement and it is not:
 *
 *   A DESTINATION IS THE MOST SENSITIVE VALUE THIS APPLICATION HOLDS. "Where
 *   this car was going, and when" is precisely the record an ALPR network is
 *   built to assemble. An app that exists to keep that record from being made
 *   must not be the thing that writes it down.
 *
 * So this slice is memory-only and it is cleared when the drive ends. A driver
 * who closes the app has no destination when they open it again. That is not an
 * oversight a future version fixes; it is the product.
 *
 * THIS FILE USED TO CLAIM A SECOND GUARD IT DOES NOT HAVE. It said `persist.ts`
 * "would refuse a coordinate at the write anyway, which is the belt to this
 * file's braces". It would not. `assertPersistSafe` refuses plate-SHAPED
 * strings, plate-shaped and plate-NAMED keys, `Map`/`Set`, and anything nested
 * past twelve levels. A numeric `{ lat, lon }` pair walks straight through it.
 * The braces are real - nothing here is persisted - and the belt was imaginary,
 * which is worse than no belt, because the next person to consider persisting
 * this slice would have read that sentence as permission.
 *
 * `stores/destinations.ts` PERSISTS PLACES AND IS NOT A CONTRADICTION OF THIS.
 * Read its header before changing either file. In one sentence: that slice
 * holds the NAMES of places a person chose to go back to, and this one holds
 * where the car is going right now and the line it is taking. An address book
 * is not a track. "Fixing" the apparent inconsistency by persisting this slice
 * is the exact harm the paragraph above exists to prevent.
 *
 * =============================================================================
 * THE APP STILL WORKS WITH NOTHING IN HERE
 * =============================================================================
 * `destination` is null on launch and stays null unless somebody sets one. Every
 * warning, every camera, every alert behaves identically either way - the
 * destination adds a line on the map and a card at the bottom, and takes nothing
 * away. The first promise is still that you open it and drive.
 */

import { create } from 'zustand';

import type { CameraRecord } from './cameras.ts';
import { useCamerasStore } from './cameras.ts';
import { usePositionStore } from './position.ts';
import { camerasOnRoute } from '../services/route/corridor.ts';
import { planDarkRoute, planPlainRoute } from '../services/route/darkRoute.ts';
import { RouteRefused } from '../services/route/planRoute.ts';
import type { PlannedRoute, RoutePoint } from '../services/route/planRoute.ts';

export interface Destination {
  readonly name: string;
  readonly detail: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * WHAT THE ROUTE IS DOING, as one value rather than three booleans.
 *
 * `loading || error || route` as separate fields is how a screen ends up
 * rendering a spinner over an error over a stale line. One state, one thing on
 * screen.
 */
export type RouteStatus = 'idle' | 'planning' | 'ready' | 'failed';

export interface RouteState {
  readonly destination: Destination | null;
  readonly route: PlannedRoute | null;
  readonly status: RouteStatus;
  /** The server's own sentence when planning failed. Shown verbatim. */
  readonly error: string | null;
  /**
   * The readers this route was planned to AVOID.
   *
   * Kept so the card can say "avoiding 9" honestly - the number the router was
   * actually given, not a fresh count of what is near the line now. Those
   * differ, and reporting the second while having asked the first is the kind
   * of small lie that makes a driver stop believing the rest.
   */
  readonly avoiding: readonly CameraRecord[];
  /**
   * READERS STILL ON THE FINAL LINE.
   *
   * Empty is the good outcome. Non-empty is the honest one: in a dense area
   * there may be no legal route that clears every reader, and the card says so
   * rather than reporting a clear road over a line that passes three.
   *
   * Separate from `avoiding` because they answer different questions - what was
   * asked for, and what was achieved - and a build that conflated them shipped
   * "2 readers avoided" over a route past nine.
   */
  readonly onLine: readonly CameraRecord[];
}

export interface RouteActions {
  /** Set where we are going. Does not plan - planning is a separate press. */
  setDestination(destination: Destination): void;
  planning(): void;
  planned(
    route: PlannedRoute,
    avoiding: readonly CameraRecord[],
    onLine: readonly CameraRecord[],
  ): void;
  failed(detail: string): void;
  /**
   * Stop waiting for a plan. The destination stays, and so does whatever line
   * was already drawn: this is `Cancel` on a search for a route, not `End`.
   */
  cancelled(): void;
  /** End the drive. Everything goes, including the destination. */
  clear(): void;
}

const EMPTY: readonly CameraRecord[] = Object.freeze([]);

const INITIAL: RouteState = Object.freeze({
  destination: null,
  route: null,
  status: 'idle',
  error: null,
  avoiding: EMPTY,
  onLine: EMPTY,
});

export const useRouteStore = create<RouteState & RouteActions>()((set) => ({
  ...INITIAL,

  setDestination(destination) {
    /*
     * A NEW DESTINATION DROPS THE OLD ROUTE. Keeping it would leave a line on
     * the map going somewhere the card no longer names, which reads as the app
     * having planned something it has not.
     */
    set({
      destination,
      route: null,
      status: 'idle',
      error: null,
      avoiding: EMPTY,
      onLine: EMPTY,
    });
  },

  planning() {
    set({ status: 'planning', error: null });
  },

  planned(route, avoiding, onLine) {
    set({ route, avoiding, onLine, status: 'ready', error: null });
  },

  failed(detail) {
    // The route is dropped: a failed replan must not leave the previous line up
    // while the card says it failed.
    set({ status: 'failed', error: detail, route: null, avoiding: EMPTY, onLine: EMPTY });
  },

  cancelled() {
    set((state) => ({
      status: state.route === null ? 'idle' : 'ready',
      error: null,
    }));
  },

  clear() {
    set({ ...INITIAL });
  },
}));

export const useDestination = (): Destination | null =>
  useRouteStore((state) => state.destination);
export const usePlannedRoute = (): PlannedRoute | null => useRouteStore((state) => state.route);
export const useRouteStatus = (): RouteStatus => useRouteStore((state) => state.status);
export const useRouteError = (): string | null => useRouteStore((state) => state.error);
export const useRouteAvoiding = (): readonly CameraRecord[] =>
  useRouteStore((state) => state.avoiding);
export const useRouteOnLine = (): readonly CameraRecord[] =>
  useRouteStore((state) => state.onLine);

/**
 * WHICH PLAN IS THE CURRENT ONE. Bumped by every `planFromHere` and by
 * `cancelPlanning`; a callback whose number no longer matches writes nothing.
 * Module state and not store state because nothing renders from it.
 */
let planGeneration = 0;

/**
 * WHICH LINE A PRESS ASKS FOR. `dark` is the product: the readers taken out.
 * `plain` is the search panel's FASTEST row -- offered beside it, never
 * instead of it, and only ever chosen by the driver.
 */
export type RoutePlanKind = 'dark' | 'plain';

export const routeActions = {
  setDestination: (destination: Destination): void => {
    useRouteStore.getState().setDestination(destination);
  },
  planning: (): void => {
    useRouteStore.getState().planning();
  },
  planned: (
    route: PlannedRoute,
    avoiding: readonly CameraRecord[],
    onLine: readonly CameraRecord[],
  ): void => {
    useRouteStore.getState().planned(route, avoiding, onLine);
  },
  failed: (detail: string): void => {
    useRouteStore.getState().failed(detail);
  },
  /**
   * PLAN FROM WHERE THE CAR IS TO THE DESTINATION THAT IS SET, AND GO.
   *
   * This is the body `DriveScreen.requestRoute` carried as a local closure,
   * lifted into the store because a second surface needed it and could not
   * reach a closure: the intel card's `Go to this camera` set a destination and
   * closed itself, and nothing planned -- the line was never drawn and the dock
   * never left browse. "The 'go to the camera' doesn't plan the route and go."
   *
   * STILL CALLED FROM A PRESS AND FROM NOWHERE ELSE. Moving it here changes who
   * may call it, not when: `services/route/planRoute.ts` forbids a route that
   * is not a direct user action, and every caller of this is a key under a
   * thumb. Nothing here runs on a timer or a store change.
   *
   * The origin is the last fix and the readers are the phone's own archive,
   * read off their stores at the press rather than captured in a closure, so
   * the plan is from where the car IS. No fix means no plan and no error: a
   * destination with no origin is a destination that waits.
   */
  planFromHere: (kind: RoutePlanKind = 'dark'): void => {
    const target = useRouteStore.getState().destination;
    const fix = usePositionStore.getState().fix;
    if (target === null || fix === null) return;
    planGeneration += 1;
    const mine = planGeneration;
    routeActions.planning();
    const request = {
      from: { lat: fix.lat, lon: fix.lon },
      to: { lat: target.lat, lon: target.lon },
      cameras: useCamerasStore.getState().cameras,
    };
    /* THE PLAIN LINE STILL COUNTS ITS READERS. A driver who chose FASTEST
       gets the honest number on the card, measured on the phone, the same way
       the dark line reports what it could not avoid. */
    const plan =
      kind === 'plain'
        ? planPlainRoute(request).then((route) => ({
            route,
            avoided: [] as readonly CameraRecord[],
            remaining: camerasOnRoute(route.shape, request.cameras),
          }))
        : planDarkRoute(request);
    plan
      .then((built) => {
        if (mine !== planGeneration) return;
        routeActions.planned(built.route, built.avoided, built.remaining);
      })
      .catch((cause: unknown) => {
        if (mine !== planGeneration) return;
        routeActions.failed(
          cause instanceof RouteRefused ? cause.message : 'that route could not be planned.',
        );
      });
  },

  /**
   * STOP WAITING FOR THE PLAN IN FLIGHT. The dock's `Cancel` key, which was
   * left unwired because "routeActions has no way to abandon a plan in flight
   * without also clearing the destination". Now it has: the request is not
   * aborted -- the router is already working -- but its answer is disowned. A
   * generation counter, bumped here and read by `planFromHere`'s callbacks, is
   * what makes a late `planned` land nowhere. The old line, if there was one,
   * stays drawn, and the destination stays set; a driver who cancelled a
   * replan is still going where they were going.
   */
  cancelPlanning: (): void => {
    planGeneration += 1;
    if (useRouteStore.getState().status === 'planning') useRouteStore.getState().cancelled();
  },

  clear: (): void => {
    useRouteStore.getState().clear();
  },
};

export type { PlannedRoute, RoutePoint };
