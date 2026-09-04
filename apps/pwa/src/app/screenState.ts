/**
 * SCREEN STATE - the whole navigation model, in one store.
 *
 * There is no router. `react-router` would buy us nested routes, loaders and a
 * matcher this product has no use for, and would cost a second source of truth
 * for "what is on screen" at exactly the moment that answer has to be
 * unambiguous: while a camera alert is taking the screen. So navigation is a
 * typed store plus a one-parameter URL adapter, and it is 100% of the routing.
 *
 * THE URL CONTRACT
 *   ?screen=<id>   the only navigation parameter this app reads or writes.
 *   Everything else in the query string is preserved untouched - `src=pwa`
 *   from `start_url`, `src=shortcut` from a manifest shortcut, and anything a
 *   campaign link adds. This module rewrites one key and copies the rest.
 *
 * PRIVACY (non-negotiable)
 *   Nothing but a screen id from the closed list below is ever written to the
 *   URL. Overlay state - which camera's intel card, which report draft - lives
 *   in memory only and is deliberately NOT deep-linkable: a URL is copied into
 *   browser history, synced across devices, and pasted into chats. Plate
 *   values and watchlist entries must never reach any of those, and the
 *   simplest way to guarantee that is for this module to have no channel that
 *   could carry one. `Overlay` therefore holds an id and a kind, and no payload.
 *
 * ALERT PRIORITY
 *   "A live camera alert always wins the screen."
 * - Flockys Screens II.dc.html, B10 escalation ladder
 *   That is modelled here as an explicit saved-stack, not as a race between
 *   z-indexes. `interruptForAlert()` moves the presented overlay stack aside;
 *   `restoreAfterAlert()` puts it back underneath anything the driver opened
 *   while the alert was live. An alert never pushes or pops a history entry:
 *   a camera coming into range is not a navigation, and the Android back
 *   gesture must never "undo" an alert.
 */

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

/**
 * The five dock word-keys, in dock order.
 * "No icons. Five mono word-keys, 58px, split by 1px rules"
 * - Flockys App Screens.dc.html, panel DOCK - REPLACES THE ICON ROW
 */
/**
 * SWEEP is not here any more. RADAR and SWEEP merged: the dial the driver used
 * to navigate to IS the RADAR screen now, so a second key pointed at the same
 * picture. See docs/gaps-inbox/radar-sweep-merge.md.
 *
 * The id survives in SECONDARY_SCREENS so `?screen=sweep` - a manifest
 * shortcut, an old bookmark, a notification - still resolves instead of
 * 404ing; `redirectLegacyScreen` sends it to radar.
 */
export const DOCK_SCREENS = ['radar', 'lookup', 'ask', 'log', 'node'] as const;

export type DockScreen = (typeof DOCK_SCREENS)[number];

/**
 * Everything reachable that is not a dock key. Each maps to a rendered design:
 *   report      App Screens 06 · REPORT - SHEET FROM ANY SCREEN
 *   onboarding  Screens II  A1 · ONBOARDING - PERMISSIONS
 *   offline     Screens II  A2 · OFFLINE - DEGRADED
 *   node        Screens II  A3 · CONNECT - NODE PAIRING
 *   intel       Screens II  A4 · INTEL CARD - MODAL FROM SWEEP
 *   mesh        Screens II  A5 · MESH FEED
 *   board       Screens II  A6 · CONTRIBUTION BOARD
 *   dead-drop   Screens II  B2 · DEAD DROP - QUEUE + EVIDENCE CHAIN
 *   route       Screens II  B3 · PRE-DRIVE - ROUTE SURVEILLANCE SCORE
 *   triage      Screens II  B4 · ALERT TRIAGE - BY OWNER TYPE
 *   watchlist   Screens II  B5 · PLATE WATCHLIST - ALERTS ON NEW READS
 *   zone-audit  Screens II  B6 · ZONE AUDIT - SHAREABLE CARD + HEAT LAYER
 *   heat-map    Screens II  B6, the heat layer as its own full-screen view
 *   record      Screens II  B8 · RECORD - DOCUMENTED ABUSE NEAR YOU
 *   settings    the threshold / mode / privacy surface every screen links into
 */
export const SECONDARY_SCREENS = [
  'report',
  'settings',
  'help',
  // Merged into radar; kept so old links resolve. See DOCK_SCREENS.
  'sweep',
  'onboarding',
  'offline',
  // `node` moved to DOCK_SCREENS -- it is a destination now, not a detour.
  'intel',
  'mesh',
  'board',
  'route',
  'triage',
  'watchlist',
  'zone-audit',
  'record',
  'dead-drop',
  'heat-map',
  /**
   * ADMIN - who else may open the app.
   *
   * Reachable only by URL and only rendered when the SERVER says the signed-in
   * identity is an administrator. It is not in the dock and never will be:
   * everybody else who reaches this app is a tester, and a key they can see but
   * not use is a worse answer than no key.
   */
  'admin',
  /**
   * MORE - the v1 hub.
   *
   * v0's dock carries five destinations and has nowhere for a sixth; v1's
   * carries four and puts everything else behind this one. The id exists in
   * both designs because ids are shared, but only the v1 dock links to it:
   * under v0 nothing navigates here, which is the correct outcome for a hub
   * whose whole job is to hold the screens v1's dock dropped.
   */
  'more',
  /**
   * MISUSE - who has abused this network, and where.
   *
   * Reads `public/records/counties.json`, the citation-gated file behind
   * RADAR's county strip. It is a destination in v1 (a MORE tile) and
   * reachable by URL in v0.
   */
  'misuse',
  /**
   * DOCS - the route out to the documentation and, more importantly, to the
   * commit this bundle was built from.
   *
   * A destination rather than a link in Settings because it is the answer to
   * "why should I believe any of this", and that question is asked by people
   * who have not found Settings yet.
   */
  'docs',
] as const;

export type SecondaryScreen = (typeof SECONDARY_SCREENS)[number];

export const SCREEN_IDS = [...DOCK_SCREENS, ...SECONDARY_SCREENS] as const;

export type ScreenId = DockScreen | SecondaryScreen;

/** RADAR is the product. Every unresolved entry point lands here. */
export const DEFAULT_SCREEN: ScreenId = 'radar';

/**
 * The one query parameter. Manifest shortcuts, deep links and internal
 * navigation all speak this key and nothing else.
 */
export const SCREEN_PARAM = 'screen';

/**
 * Screens that merged into another one, and where they go now.
 *
 * A dead deep link is worse than a redirect: a manifest shortcut or a
 * notification tap that lands on "screen not built" reads as the app being
 * broken, when the screen simply became part of a better one.
 */
export const MERGED_SCREENS: Readonly<Record<string, ScreenId>> = Object.freeze({
  sweep: 'radar',
});

export function redirectLegacyScreen(screen: ScreenId): ScreenId {
  return MERGED_SCREENS[screen] ?? screen;
}

export function isScreenId(value: unknown): value is ScreenId {
  return typeof value === 'string' && (SCREEN_IDS as readonly string[]).includes(value);
}

export function isDockScreen(value: unknown): value is DockScreen {
  return typeof value === 'string' && (DOCK_SCREENS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

/**
 * A sheet or a modal. Deliberately payload-free: see the PRIVACY note at the
 * top. A feature that needs "which camera" keeps that in its own store and
 * keys it by the same `id` string it opened the overlay with.
 */
export interface Overlay {
  readonly id: string;
  readonly kind: 'sheet' | 'modal';
}

/**
 * What the shell should actually put in front of the driver, in priority order.
 * `camera-alert` outranks everything: a banner, a sheet, a modal and any
 * non-camera notification all lose to a camera that is in range.
 */
export type Presentation = 'camera-alert' | 'overlay' | 'screen';

export interface ScreenState {
  readonly screen: ScreenId;
  /** Top of stack is last. Empty while an alert holds them aside. */
  readonly overlays: readonly Overlay[];
  /** True between `interruptForAlert()` and `restoreAfterAlert()`. */
  readonly alertActive: boolean;
  /** The stack an alert moved aside. Empty when nothing was interrupted. */
  readonly savedOverlays: readonly Overlay[];
  /** How many history entries this module pushed and has not yet popped. */
  readonly depth: number;
}

const EMPTY_OVERLAYS: readonly Overlay[] = Object.freeze([]);

const INITIAL_STATE: ScreenState = Object.freeze({
  screen: DEFAULT_SCREEN,
  overlays: EMPTY_OVERLAYS,
  alertActive: false,
  savedOverlays: EMPTY_OVERLAYS,
  depth: 0,
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type Unsubscribe = () => void;

let state: ScreenState = INITIAL_STATE;
const listeners = new Set<() => void>();

function setState(next: ScreenState): void {
  if (next === state) return;
  state = Object.freeze(next);
  for (const listener of [...listeners]) listener();
}

export function getScreenState(): ScreenState {
  return state;
}

export function subscribe(listener: () => void): Unsubscribe {
  listeners.add(listener);
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    listeners.delete(listener);
  };
}

/**
 * React binding. `useSyncExternalStore` rather than a context so that a
 * component rendered during an alert reads the same snapshot the alert logic
 * just wrote, with no tearing between the takeover layer and the dock.
 */
export function useScreenState(): ScreenState {
  return useSyncExternalStore(subscribe, getScreenState, getScreenState);
}

/** What the shell must present right now. Nothing outranks a camera alert. */
export function presentation(current: ScreenState = state): Presentation {
  if (current.alertActive) return 'camera-alert';
  if (current.overlays.length > 0) return 'overlay';
  return 'screen';
}

/** The overlay on top, or null. Always null while an alert is live. */
export function topOverlay(current: ScreenState = state): Overlay | null {
  if (current.alertActive) return null;
  return current.overlays[current.overlays.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// URL adapter
// ---------------------------------------------------------------------------

/**
 * Read a screen id out of a query string. Anything unrecognised resolves to
 * {@link DEFAULT_SCREEN} - a deep link that names a screen this build does not
 * have must open the app, not a blank page.
 */
export function screenFromSearch(search: string): ScreenId {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(SCREEN_PARAM);
  // A merged screen resolves to the one it merged into, so an old link
  // lands on a real picture rather than a placeholder.
  return isScreenId(raw) ? redirectLegacyScreen(raw) : DEFAULT_SCREEN;
}

/**
 * Build the query string for a screen, preserving every other parameter that
 * was already there. RADAR is the default and carries no parameter, so the
 * home screen URL stays clean.
 */
export function searchForScreen(screen: ScreenId, currentSearch: string): string {
  const params = new URLSearchParams(
    currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch,
  );
  if (screen === DEFAULT_SCREEN) params.delete(SCREEN_PARAM);
  else params.set(SCREEN_PARAM, screen);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * The pieces of `window` this module touches, named so a test can supply them
 * and so it is obvious there is nothing else.
 */
export interface HistoryPort {
  readonly history: Pick<History, 'pushState' | 'replaceState' | 'back' | 'state'>;
  readonly location: Pick<Location, 'search' | 'pathname' | 'hash'>;
  addEventListener(type: 'popstate', handler: () => void): void;
  removeEventListener(type: 'popstate', handler: () => void): void;
}

let port: HistoryPort | null = null;

function browserPort(): HistoryPort | null {
  if (typeof window === 'undefined') return null;
  return {
    get history() {
      return window.history;
    },
    get location() {
      return window.location;
    },
    addEventListener: (type, handler) => {
      window.addEventListener(type, handler);
    },
    removeEventListener: (type, handler) => {
      window.removeEventListener(type, handler);
    },
  };
}

/** The shape this module stores in `history.state`, under its own key. */
interface HistoryEntry {
  readonly screen: ScreenId;
  readonly overlays: readonly Overlay[];
  readonly depth: number;
}

const HISTORY_KEY = 'fwm';

function readHistoryEntry(raw: unknown): HistoryEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const bag = (raw as Record<string, unknown>)[HISTORY_KEY];
  if (bag === null || typeof bag !== 'object') return null;
  const entry = bag as Record<string, unknown>;
  if (!isScreenId(entry['screen'])) return null;
  const overlays = Array.isArray(entry['overlays'])
    ? (entry['overlays'] as unknown[]).filter(isOverlay)
    : [];
  const depth = typeof entry['depth'] === 'number' && entry['depth'] >= 0 ? entry['depth'] : 0;
  return { screen: entry['screen'], overlays, depth };
}

function isOverlay(value: unknown): value is Overlay {
  if (value === null || typeof value !== 'object') return false;
  const bag = value as Record<string, unknown>;
  return typeof bag['id'] === 'string' && (bag['kind'] === 'sheet' || bag['kind'] === 'modal');
}

function writeHistory(replace: boolean): void {
  if (port === null) return;
  const entry: HistoryEntry = {
    screen: state.screen,
    overlays: state.overlays,
    depth: state.depth,
  };
  const url = `${port.location.pathname}${searchForScreen(state.screen, port.location.search)}${port.location.hash}`;
  const payload = { [HISTORY_KEY]: entry };
  if (replace) port.history.replaceState(payload, '', url);
  else port.history.pushState(payload, '', url);
}

function onPopState(): void {
  if (port === null) return;
  const entry = readHistoryEntry(port.history.state);
  // No entry of ours means the user landed on a history record this module did
  // not write - a hash change, or a foreign pushState. Fall back to the URL,
  // which is the only thing we can still trust.
  const screen = entry?.screen ?? screenFromSearch(port.location.search);
  const overlays = entry?.overlays ?? EMPTY_OVERLAYS;
  const depth = entry?.depth ?? 0;
  // An alert in progress is NOT unwound by a back gesture. The saved stack and
  // the alert flag survive; only the navigation part of the state moves.
  setState({
    ...state,
    screen,
    overlays: state.alertActive ? EMPTY_OVERLAYS : overlays,
    savedOverlays: state.alertActive ? overlays : state.savedOverlays,
    depth,
  });
}

export interface InitOptions {
  /** Override the browser globals. Tests pass a fake; the app passes nothing. */
  readonly port?: HistoryPort;
  /** Start here instead of whatever the URL says. Used by tests only. */
  readonly initialScreen?: ScreenId;
}

/**
 * Bind the store to the URL: adopt the deep link, then follow back/forward.
 * Returns a disposer. Calling it twice replaces the previous binding rather
 * than stacking a second popstate listener.
 */
export function initScreenState(options: InitOptions = {}): Unsubscribe {
  disposeScreenState();
  port = options.port ?? browserPort();

  const screen =
    options.initialScreen ??
    (port === null ? DEFAULT_SCREEN : screenFromSearch(port.location.search));

  setState({ ...INITIAL_STATE, screen });
  // replaceState, not push: the entry point must not leave a phantom record
  // behind that a back gesture can land on.
  writeHistory(true);

  port?.addEventListener('popstate', onPopState);
  return disposeScreenState;
}

/** Detach from the URL and reset. Safe to call when never initialised. */
export function disposeScreenState(): void {
  port?.removeEventListener('popstate', onPopState);
  port = null;
  setState(INITIAL_STATE);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface OpenScreenOptions {
  /**
   * Replace the current history entry instead of pushing one. Use for a
   * redirect (onboarding -> radar) so back does not return to the redirect.
   */
  readonly replace?: boolean;
}

/**
 * Go to a screen. Pushes a history entry unless `replace` is set.
 *
 * Opening a screen closes nothing: an alert that is live stays live and stays
 * on top, because a camera in range outranks the screen behind it.
 */
/**
 * RESELECTING THE SCREEN YOU ARE ALREADY ON.
 *
 * Pressing RADAR while RADAR is open is not navigation, and it is not nothing:
 * on every map application it means "put me back in the middle". The screen
 * itself is the only thing that knows what that means, so this records the fact
 * and lets whoever cares subscribe.
 *
 * A counter rather than an event object: a listener only ever needs to know
 * that it happened again, and a number is trivially comparable in a `useEffect`
 * dependency list.
 */
let reselects = 0;
const reselectListeners = new Set<(screen: ScreenId, count: number) => void>();

export function onScreenReselected(
  listener: (screen: ScreenId, count: number) => void,
): () => void {
  reselectListeners.add(listener);
  return () => {
    reselectListeners.delete(listener);
  };
}

export function openScreen(screen: ScreenId, options: OpenScreenOptions = {}): void {
  const replace = options.replace === true;
  if (state.screen === screen && state.overlays.length === 0) {
    // Already there with nothing on top. Keep the URL authoritative but do not
    // grow the back stack with duplicates.
    reselects += 1;
    for (const listener of reselectListeners) listener(screen, reselects);
    writeHistory(true);
    return;
  }
  setState({
    ...state,
    screen,
    overlays: EMPTY_OVERLAYS,
    depth: replace ? state.depth : state.depth + 1,
  });
  writeHistory(replace);
}

/**
 * Open a sheet or modal on top of the current screen.
 *
 * Returns the overlay stack depth after the call. While an alert is live the
 * overlay is still recorded - it just is not presented, and it becomes visible
 * when `restoreAfterAlert()` runs. Nothing is silently dropped.
 */
export function openOverlay(overlay: Overlay): number {
  const overlays = [...state.overlays, overlay];
  setState({ ...state, overlays, depth: state.depth + 1 });
  writeHistory(false);
  return overlays.length;
}

/**
 * Close the top overlay, or the one with `id` if given. Returns true when
 * something was closed.
 */
export function closeOverlay(id?: string): boolean {
  if (state.overlays.length === 0) return false;
  const overlays =
    id === undefined
      ? state.overlays.slice(0, -1)
      : state.overlays.filter((overlay) => overlay.id !== id);
  if (overlays.length === state.overlays.length) return false;
  setState({ ...state, overlays, depth: Math.max(0, state.depth - 1) });
  writeHistory(true);
  return true;
}

/**
 * Back, in the Android sense.
 *
 * Returns true when this module had something to unwind. False means the back
 * stack is ours-empty and the platform is free to leave the app - the caller
 * must NOT swallow the gesture in that case, because a back press that does
 * nothing is how an app earns a one-star review.
 *
 * An alert is never unwound by back. Dismissing an alert is the alert's own
 * affordance; `restoreAfterAlert()` is how it ends.
 */
export function goBack(): boolean {
  if (state.depth <= 0) return false;
  if (port === null) {
    // No history to pop from (tests, non-DOM runtime). Unwind the store the
    // same way popstate would.
    if (state.overlays.length > 0) return closeOverlay();
    setState({ ...state, screen: DEFAULT_SCREEN, depth: state.depth - 1 });
    return true;
  }
  port.history.back();
  return true;
}

// ---------------------------------------------------------------------------
// Alert interruption
// ---------------------------------------------------------------------------

/**
 * A live camera alert takes the screen.
 *
 * Idempotent by design: a second camera entering range during an alert must
 * not overwrite the saved stack with the (empty) current one, which would
 * silently destroy the sheet the driver had open. The first interrupt owns the
 * saved stack until it is restored.
 *
 * Deliberately does not touch history, the screen id or the URL. When the
 * alert clears, the driver is exactly where they were.
 *
 * Returns true when this call performed the interrupt.
 */
export function interruptForAlert(): boolean {
  if (state.alertActive) return false;
  setState({
    ...state,
    alertActive: true,
    savedOverlays: state.overlays,
    overlays: EMPTY_OVERLAYS,
  });
  return true;
}

/**
 * The alert cleared. Put the interrupted stack back.
 *
 * Anything the driver opened *during* the alert stays on top of what was
 * restored, because that is the more recent intent.
 *
 * Returns true when an alert was actually active.
 */
export function restoreAfterAlert(): boolean {
  if (!state.alertActive) return false;
  setState({
    ...state,
    alertActive: false,
    overlays: [...state.savedOverlays, ...state.overlays],
    savedOverlays: EMPTY_OVERLAYS,
  });
  return true;
}

/** True while a camera alert owns the screen. Read by installPrompt and the SW. */
export function isAlertActive(): boolean {
  return state.alertActive;
}
