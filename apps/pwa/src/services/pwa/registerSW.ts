/**
 * SERVICE WORKER REGISTRATION - deliberately manual, deliberately gated.
 *
 * `vite.config.ts` sets `injectRegister: null`, so nothing registers a worker
 * unless this module is called. `App.tsx` calls it on mount. The browser's app
 * installation invitation is a separate concern: `installPrompt.ts` gates
 * that behind a second session, a user gesture and the absence of an alert.
 *
 *   "install prompt: after 2nd session, never on first alert"
 * - Flockys Design System.dc.html, section 06, PLATFORM BEHAVIOUR
 *
 * WHAT AN UPDATE MAY DO WITHOUT ASKING
 *   The generated worker has `skipWaiting: true` and `clientsClaim: true` in
 *   `vite.config.ts`. A new worker therefore activates and claims open clients
 *   without a page-side message. That changes the controller; it does NOT
 *   reload the document or replace the JavaScript already running on it.
 *
 * WHAT REMAINS GATED
 *   If Workbox does report a waiting worker, `applyUpdate()` refuses while an
 *   alert is live. The `controlling` listener reloads only after that explicit
 *   path requested the update. An automatic claim leaves the loaded document
 *   alone, so it cannot tear down a live camera alert.
 *
 * WHAT THIS MODULE DOES NOT CLAIM
 *   Registering a worker is not "offline works". It reports the registration
 *   state it actually observed and nothing more. Whether the precache
 *   completed is the worker's business, and `status().activated` is the only
 *   honest signal this side of the boundary has.
 */

import { Workbox } from 'workbox-window';

import { isAlertActive } from '../../app/screenState.ts';
import {
  errorMessage,
  nav,
  no,
  ok,
  secureContextCapability,
  type Capability,
  type Unsubscribe,
} from '../adapters/types.ts';

/** Default path of the worker `generateSW` emits at the site root. */
export const SW_URL = '/sw.js';

export type SwPhase =
  | 'unsupported'
  /** Nothing has been attempted yet. */
  | 'idle'
  /** `register()` is in flight. */
  | 'registering'
  /** A worker is installed and controlling, and it is the current build. */
  | 'active'
  /** A new build is installed and waiting for permission to take over. */
  | 'update-waiting'
  /** Registration failed. `error` says how. */
  | 'failed';

export interface SwStatus {
  readonly phase: SwPhase;
  /** True once a worker of ours controls this page. */
  readonly controlling: boolean;
  /** True when a newer build is installed and waiting. */
  readonly updateWaiting: boolean;
  /** A sentence, never a payload. Null when nothing went wrong. */
  readonly error: string | null;
}

export interface SwController {
  capability(): Capability;
  status(): SwStatus;
  subscribe(fn: (status: SwStatus) => void): Unsubscribe;
  /** Register the worker. Idempotent; safe to call on every mount. */
  register(): Promise<SwStatus>;
  /**
   * Let the waiting worker take over, which reloads the page.
   * Refuses (returns false) when no update is waiting, or while a camera alert
   * is live.
   */
  applyUpdate(): Promise<boolean>;
  /** Remove the worker and its registration. Used by the privacy "forget" path. */
  unregister(): Promise<boolean>;
}

export interface RegisterOptions {
  /** Override the worker URL. Defaults to {@link SW_URL}. */
  readonly url?: string;
  /**
   * Whether it is currently safe to hand control to a new build. Defaults to
   * "not during a camera alert". Injectable so a test does not need a store.
   */
  readonly canApplyUpdate?: () => boolean;
  /**
   * Register even in a dev build. Off by default because `devOptions.enabled`
   * is false in `vite.config.ts` - a stale precache during a live alert is a
   * correctness bug, not a caching inconvenience.
   */
  readonly allowInDev?: boolean;
  /**
   * If Workbox reports a waiting build, ask it to activate unless an alert is
   * live. The generated worker normally activates itself because
   * `vite.config.ts` sets `skipWaiting: true`; this is the fallback for a
   * registration that nevertheless reaches the waiting state.
   *
   * Defaults to true.
   */
  readonly autoApply?: boolean;
  /**
   * Reload once the new worker takes control. Defaults to true, and is a
   * separate switch because taking the update and re-rendering with it are
   * different decisions - a test wants the first without the second.
   */
  readonly reloadOnUpdate?: boolean;
  /** Injected in tests. The app reloads the real page. */
  readonly reload?: () => void;
}

export function serviceWorkerCapability(allowInDev = false): Capability {
  const navigator = nav();
  if (navigator === undefined) return no('no navigator in this runtime');
  if (!('serviceWorker' in navigator)) {
    return no('this browser has no service worker support, so nothing can be cached for offline');
  }
  const insecure = secureContextCapability('service workers');
  if (insecure !== null) return insecure;
  if (!allowInDev && import.meta.env.DEV) {
    return no('service workers are disabled in dev builds to keep the precache from going stale');
  }
  return ok();
}

const IDLE: SwStatus = Object.freeze({
  phase: 'idle',
  controlling: false,
  updateWaiting: false,
  error: null,
});

export function createServiceWorkerController(options: RegisterOptions = {}): SwController {
  const url = options.url ?? SW_URL;
  const allowInDev = options.allowInDev === true;
  const canApplyUpdate = options.canApplyUpdate ?? ((): boolean => !isAlertActive());
  const autoApply = options.autoApply !== false;
  const reloadOnUpdate = options.reloadOnUpdate !== false;
  const reload =
    options.reload ??
    ((): void => {
      globalThis.location?.reload();
    });
  /** True once we asked for the swap, so only OUR update reloads the page. */
  let updateRequested = false;

  const subscribers = new Set<(status: SwStatus) => void>();
  let status: SwStatus = IDLE;
  let wb: Workbox | null = null;
  let registering: Promise<SwStatus> | null = null;

  const set = (next: Partial<SwStatus>): void => {
    status = Object.freeze({ ...status, ...next });
    for (const fn of [...subscribers]) fn(status);
  };

  const controller: SwController = {
    capability: () => serviceWorkerCapability(allowInDev),

    status: () => status,

    subscribe(fn) {
      subscribers.add(fn);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        subscribers.delete(fn);
      };
    },

    async register() {
      const capability = serviceWorkerCapability(allowInDev);
      if (!capability.supported) {
        set({
          phase: 'unsupported',
          error: capability.reason ?? 'service workers are unavailable',
        });
        return status;
      }
      if (registering !== null) return registering;
      if (status.phase === 'active' || status.phase === 'update-waiting') return status;

      set({ phase: 'registering', error: null });

      registering = (async (): Promise<SwStatus> => {
        try {
          const instance = new Workbox(url);
          wb = instance;

          // `waiting` fires when a new build is installed behind the current
          // one. `externalwaiting` is the same event caused by another tab.
          // `waiting` covers the case that matters: a new build installed
          // behind this page. workbox-window's type map has no
          // `externalwaiting` in this version, and reaching past the types to
          // add it would be guessing at an API - the next launch picks up a
          // build installed by another tab anyway.
          const onWaiting = (): void => {
            set({ phase: 'update-waiting', updateWaiting: true });
            // This is a fallback path: the generated worker normally skips
            // waiting itself. If a worker does wait, ask it to take over only
            // when no alert is live.
            if (autoApply) void controller.applyUpdate();
          };
          instance.addEventListener('waiting', onWaiting);

          instance.addEventListener('controlling', () => {
            set({ phase: 'active', controlling: true, updateWaiting: false });
            // `clientsClaim` may produce this event without a page-side update
            // request. A new controller does not replace the DOCUMENT or its
            // running JS, and that automatic path must not reload during an
            // alert. Reload only after our explicitly gated waiting-worker
            // path requested it.
            if (updateRequested && reloadOnUpdate) reload();
          });
          instance.addEventListener('activated', () => {
            set({ phase: 'active' });
          });

          const registration = await instance.register();
          set({
            phase: registration?.waiting != null ? 'update-waiting' : 'active',
            controlling: nav()?.serviceWorker.controller != null,
            updateWaiting: registration?.waiting != null,
            error: null,
          });
        } catch (cause) {
          wb = null;
          set({
            phase: 'failed',
            error: errorMessage(cause, 'the service worker could not be registered'),
          });
        } finally {
          registering = null;
        }
        return status;
      })();

      return registering;
    },

    async applyUpdate() {
      if (wb === null || !status.updateWaiting) return false;
      if (!canApplyUpdate()) {
        // Not an error: it is a refusal with a reason, and the caller may try
        // again the moment the alert clears.
        set({ error: 'an update is ready but a camera alert is live; it will wait' });
        return false;
      }
      set({ error: null });
      updateRequested = true;
      // `controlling` fires when the new worker takes over; that listener
      // reloads the document so the swap is actually visible.
      await wb.messageSkipWaiting();
      return true;
    },

    async unregister() {
      const registrations = await nav()?.serviceWorker.getRegistrations();
      if (registrations === undefined || registrations.length === 0) return false;
      let removed = false;
      for (const registration of registrations) {
        removed = (await registration.unregister()) || removed;
      }
      wb = null;
      set({ phase: 'idle', controlling: false, updateWaiting: false, error: null });
      return removed;
    },
  };

  return controller;
}
