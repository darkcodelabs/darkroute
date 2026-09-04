/**
 * INSTALL PROMPT - captured immediately, surfaced late, never during an alert.
 *
 *   "install prompt: after 2nd session, never on first alert"
 * - Flockys Design System.dc.html, section 06, PLATFORM BEHAVIOUR
 *
 * Chromium fires `beforeinstallprompt` once, early, and the event is only
 * usable if it was captured and `preventDefault()`ed at that moment. So the
 * listener is installed on start and the event is stashed - but stashing is not
 * showing. Three gates stand between the stash and the driver's screen:
 *
 *   1. SECOND SESSION. A first-run install nag is how a counter-surveillance
 *      tool gets uninstalled before it ever warns anybody. The session counter
 *      is bumped exactly once per launch by `beginSession()`.
 *   2. NEVER DURING AN ALERT. A camera alert owns the screen. This is checked
 *      at prompt time, not at capture time, so an alert that starts while the
 *      banner is eligible still blocks it.
 *   3. ONCE. A dismissal is remembered, because asking twice is nagging.
 *
 * NO PERMISSION IS REQUESTED ON LOAD. `beforeinstallprompt` is not a permission
 * and raises nothing; `prompt()` is the only call that shows UI and it must be
 * invoked from a user gesture - see the comment on it.
 *
 * WHY THIS HAS ITS OWN TINY DATABASE
 *   The session counter has to survive a reload, and `localStorage` is banned
 *   in `apps/pwa/src` (eslint `no-restricted-globals`) because local secrets
 *   belong in the encrypted vault. The app database's `settings` store is a
 *   closed typed union owned by `services/db/schema.ts`, and adding a name to
 *   it from here would be editing another module's schema. So this module owns
 *   `fwm-shell`: two integers, no user data, no plate, no coordinate, and a
 *   `clearInstallPromptState()` for the privacy "forget" path to call.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import { isAlertActive } from '../../app/screenState.ts';
import { globalValue, nav, no, ok, type Capability, type Unsubscribe } from '../adapters/types.ts';

/** The design's gate: the prompt may first appear on the second session. */
export const MIN_SESSIONS_BEFORE_PROMPT = 2;

/**
 * One launch is one session - not one controller, and not one React mount.
 *
 * Module scope on purpose: React StrictMode mounts, unmounts and remounts every
 * effect in development, and a per-controller flag would count that as two
 * launches and show the install prompt a session early. This flag is reset only
 * by a real page load, which is exactly what a session is.
 */
let launchCounted = false;

/** Test seam: forget that this document already counted its launch. */
export function resetLaunchCount(): void {
  launchCounted = false;
}

export const SHELL_DB_NAME = 'fwm-shell';
export const SHELL_DB_VERSION = 1;
const SHELL_STORE = 'shell';
const SESSION_COUNT_KEY = 'install.sessionCount';
const DISMISSED_KEY = 'install.dismissedAt';

/**
 * BACKING OUT OF THE BROWSER'S OWN DIALOG IS NOT "NEVER ASK AGAIN".
 *
 * These were the same key, and that was the bug. Two very different actions
 * wrote it:
 *
 *   "Keep using the website"   the app's own button, whose copy literally says
 *                              "we will not ask again". Permanent is correct.
 *
 *   backing out of Chrome's    reached by TAPPING INSTALL. Somebody who taps
 *   install sheet              install wants to install; a back gesture, a tap
 *                              outside the sheet or a moment's hesitation is
 *                              "not now". Recording it as permanent meant one
 *                              slip silently retired the prompt forever, with
 *                              nothing on any screen saying why.
 *
 * So a browser-dialog decline is a COOLDOWN measured in launches. Three is
 * enough that nobody is nagged on the next screen unlock and few enough that a
 * mis-tap costs a day rather than the product.
 */
const DECLINED_AT_SESSION_KEY = 'install.declinedAtSession';
export const SESSIONS_AFTER_DECLINE = 3;

interface ShellDb extends DBSchema {
  shell: {
    key: string;
    value: { readonly key: string; readonly value: number };
  };
}

/**
 * The persistence this module needs, as a port. The default is IndexedDB; a
 * test passes a memory implementation and never touches a real database.
 */
export interface ShellStore {
  read(key: string): Promise<number | null>;
  write(key: string, value: number): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryShellStore(): ShellStore {
  const values = new Map<string, number>();
  return {
    read: (key) => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    clear: () => {
      values.clear();
      return Promise.resolve();
    },
  };
}

export function createIdbShellStore(): ShellStore {
  let handle: Promise<IDBPDatabase<ShellDb>> | null = null;

  const open = (): Promise<IDBPDatabase<ShellDb>> => {
    handle ??= openDB<ShellDb>(SHELL_DB_NAME, SHELL_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SHELL_STORE)) {
          db.createObjectStore(SHELL_STORE, { keyPath: 'key' });
        }
      },
    });
    return handle;
  };

  return {
    async read(key) {
      if (typeof indexedDB === 'undefined') return null;
      try {
        const row = await (await open()).get(SHELL_STORE, key);
        return typeof row?.value === 'number' ? row.value : null;
      } catch {
        // A private-mode profile can refuse to open a database. That means the
        // counter resets, which means the prompt waits another session. That
        // is the safe direction to fail in.
        return null;
      }
    },
    async write(key, value) {
      if (typeof indexedDB === 'undefined') return;
      try {
        await (await open()).put(SHELL_STORE, { key, value });
      } catch {
        // Same reasoning as read(): failing to remember means asking later.
      }
    },
    async clear() {
      if (typeof indexedDB === 'undefined') return;
      try {
        await (await open()).clear(SHELL_STORE);
      } catch {
        // Nothing to clear if it never opened.
      }
    },
  };
}

/** Wipe the shell counters. Called by the privacy "forget everything" path. */
export async function clearInstallPromptState(
  store: ShellStore = createIdbShellStore(),
): Promise<void> {
  await store.clear();
}

// ---------------------------------------------------------------------------
// The event
// ---------------------------------------------------------------------------

/**
 * `BeforeInstallPromptEvent` is Chromium-only and absent from lib.dom, so it is
 * declared structurally here. No `any`: every field is named and typed.
 */
export interface BeforeInstallPromptEventLike extends Event {
  readonly platforms?: readonly string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEventLike {
  const candidate = event as Partial<BeforeInstallPromptEventLike>;
  return typeof candidate.prompt === 'function' && candidate.userChoice instanceof Promise;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export type InstallOutcome =
  | 'accepted'
  | 'dismissed'
  /** No captured event to show. */
  | 'unavailable'
  /** A gate said no: too early, already dismissed, already installed, or an alert. */
  | 'blocked';

/** Why `canPrompt()` is false. `ready` means it is true. */
export type InstallBlockReason =
  | 'ready'
  | 'no-event'
  | 'first-session'
  /** The app's own "keep using the website". Permanent, and meant to be. */
  | 'already-dismissed'
  /** Backed out of the BROWSER's dialog. A cooldown, not a decision. */
  | 'recently-declined'
  | 'already-installed'
  | 'alert-active';

export interface InstallPromptStatus {
  /** True once `beforeinstallprompt` has been captured. */
  readonly captured: boolean;
  /** Launches counted so far, including this one. */
  readonly sessions: number;
  readonly dismissed: boolean;
  readonly installed: boolean;
  readonly canPrompt: boolean;
  readonly reason: InstallBlockReason;
}

export interface InstallPromptController {
  capability(): Capability;
  status(): InstallPromptStatus;
  subscribe(fn: (status: InstallPromptStatus) => void): Unsubscribe;
  /**
   * Start listening and count this launch as a session.
   * Idempotent. Safe on every mount.
   */
  start(): Promise<InstallPromptStatus>;
  stop(): void;
  canPrompt(): boolean;
  /**
   * Show the browser's install dialog.
   *
   * MUST be called from a user gesture - a tap on the install affordance. It is
   * never called from `start()`, from a timer, or from a render. Returns
   * `blocked` without showing anything when a gate says no, which includes a
   * live camera alert.
   */
  prompt(): Promise<InstallOutcome>;
  /** Record that the driver said no. Remembered, so it is not asked again. */
  dismiss(): Promise<void>;
  /** Clear both refusals so the offer can come back. */
  allowAgain(): Promise<void>;
}

export interface InstallPromptDeps {
  readonly store?: ShellStore;
  /** Defaults to the screen store's alert flag. */
  readonly isAlertActive?: () => boolean;
  /** Defaults to `window`. */
  readonly target?: EventTarget;
}

export function installPromptCapability(): Capability {
  if (typeof window === 'undefined') return no('no window in this runtime');
  if (nav() === undefined) return no('no navigator in this runtime');
  // `onbeforeinstallprompt` is the only honest feature test: the event never
  // fires on Firefox or Safari, and neither exposes the property.
  if (!('onbeforeinstallprompt' in window)) {
    return no(
      'this browser has no beforeinstallprompt event; installing is a browser-menu action here',
    );
  }
  return ok();
}

/**
 * True when the page is already running as an installed app.
 *
 * =============================================================================
 * IT IS NOT ONLY `standalone`
 * =============================================================================
 * This tested `(display-mode: standalone)` alone, which was right while the
 * manifest asked for `standalone`. It now asks for `fullscreen`, so an
 * INSTALLED copy reports its display mode as `fullscreen` and this said "not
 * installed" - which would have the app offer to install itself to somebody
 * already standing inside it, and `already-installed` is the FIRST gate in
 * `blockReason`, so every gate under it was being evaluated on a false premise.
 *
 * Every display mode in the manifest's `display_override` chain except
 * `browser` means installed, so all three are tested. `browser` is the one that
 * means a tab, and it is deliberately absent.
 *
 * ONE THING THIS CANNOT SEE, on purpose: a browser TAB that has been put into
 * element fullscreen also matches `(display-mode: fullscreen)`, and the app
 * does exactly that on first touch (`immersive.ts`). That would make a tab
 * claim to be installed. `document.fullscreenElement` is what separates the
 * two - element fullscreen has one, a launched app does not - so it is checked
 * first and short-circuits the whole thing.
 */
const INSTALLED_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui'];

export function isStandalone(): boolean {
  if (typeof matchMedia !== 'function') return false;
  // A tab we put into element fullscreen ourselves. Not an install.
  if (globalThis.document?.fullscreenElement != null) return false;
  for (const mode of INSTALLED_DISPLAY_MODES) {
    if (matchMedia(`(display-mode: ${mode})`).matches) return true;
  }
  // iOS Safari's non-standard flag. Read structurally, never asserted.
  const legacy = globalValue<{ standalone?: boolean }>('navigator');
  return legacy?.standalone === true;
}

export function createInstallPromptController(
  deps: InstallPromptDeps = {},
): InstallPromptController {
  const store = deps.store ?? createIdbShellStore();
  const alertActive = deps.isAlertActive ?? ((): boolean => isAlertActive());
  const target = deps.target ?? (typeof window === 'undefined' ? undefined : window);

  const subscribers = new Set<(status: InstallPromptStatus) => void>();
  let deferred: BeforeInstallPromptEventLike | null = null;
  let sessions = 0;
  let dismissed = false;
  /** Launch count when the browser's own dialog was last backed out of. */
  let declinedAtSession: number | null = null;
  let installed = isStandalone();
  let running = false;

  const blockReason = (): InstallBlockReason => {
    if (installed) return 'already-installed';
    if (dismissed) return 'already-dismissed';
    /*
     * BEFORE `no-event`, and that ordering is the point.
     *
     * The event is single-use, so the moment somebody declines the browser's
     * sheet `deferred` is null and the generic "this browser has no install
     * event" would win - which is what Firefox and iOS mean, and is exactly
     * wrong here. A cooldown being set is proof an event DID fire once, so it
     * is both the more specific answer and the only actionable one.
     */
    if (declinedAtSession !== null && sessions < declinedAtSession + SESSIONS_AFTER_DECLINE) {
      return 'recently-declined';
    }
    if (deferred === null) return 'no-event';
    if (sessions < MIN_SESSIONS_BEFORE_PROMPT) return 'first-session';
    if (alertActive()) return 'alert-active';
    return 'ready';
  };

  const snapshot = (): InstallPromptStatus => {
    const reason = blockReason();
    return {
      captured: deferred !== null,
      sessions,
      dismissed,
      installed,
      canPrompt: reason === 'ready',
      reason,
    };
  };

  const publish = (): void => {
    const status = snapshot();
    for (const fn of [...subscribers]) fn(status);
  };

  const onBeforeInstallPrompt = (event: Event): void => {
    if (!isBeforeInstallPromptEvent(event)) return;
    // Required: without preventDefault the browser shows its own mini-infobar
    // and the event becomes unusable later.
    event.preventDefault();
    deferred = event;
    publish();
  };

  const onAppInstalled = (): void => {
    installed = true;
    deferred = null;
    publish();
  };

  return {
    capability: installPromptCapability,

    status: snapshot,

    subscribe(fn) {
      subscribers.add(fn);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        subscribers.delete(fn);
      };
    },

    async start() {
      if (running) return snapshot();
      running = true;

      target?.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      target?.addEventListener('appinstalled', onAppInstalled);

      // Count this launch, once. Reading then writing is not atomic, but the
      // only writer is this line and `launchCounted` holds it to one run per
      // document.
      const previous = (await store.read(SESSION_COUNT_KEY)) ?? 0;
      if (launchCounted) {
        sessions = previous;
      } else {
        launchCounted = true;
        sessions = previous + 1;
        await store.write(SESSION_COUNT_KEY, sessions);
      }

      dismissed = ((await store.read(DISMISSED_KEY)) ?? 0) > 0;
      const declined = (await store.read(DECLINED_AT_SESSION_KEY)) ?? 0;
      declinedAtSession = declined > 0 ? declined : null;
      installed = isStandalone();

      publish();
      return snapshot();
    },

    stop() {
      if (!running) return;
      running = false;
      target?.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      target?.removeEventListener('appinstalled', onAppInstalled);
    },

    canPrompt: () => blockReason() === 'ready',

    async prompt() {
      const reason = blockReason();
      if (reason !== 'ready') return deferred === null ? 'unavailable' : 'blocked';
      const event = deferred;
      if (event === null) return 'unavailable';

      // The event is single-use whatever the answer, so drop it first.
      deferred = null;
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'dismissed') {
        // The SOFT key. See `DECLINED_AT_SESSION_KEY`: somebody who got this far
        // tapped INSTALL, so backing out is "not now", not "never".
        declinedAtSession = sessions;
        await store.write(DECLINED_AT_SESSION_KEY, sessions);
      }
      publish();
      return choice.outcome;
    },

    async dismiss() {
      dismissed = true;
      deferred = null;
      await store.write(DISMISSED_KEY, Date.now());
      publish();
    },

    /**
     * Undo both refusals, for the one control that offers to ask again.
     *
     * A permanent "never ask" with no way back is a setting nobody can change
     * after the fact, on the screen that is supposed to explain itself. Note it
     * cannot conjure a `beforeinstallprompt`: Chrome fires that once per page
     * load, so the offer returns on the next launch rather than instantly.
     */
    async allowAgain() {
      dismissed = false;
      declinedAtSession = null;
      await store.write(DISMISSED_KEY, 0);
      await store.write(DECLINED_AT_SESSION_KEY, 0);
      publish();
    },
  };
}
