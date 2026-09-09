/**
 * AM I AN ADMINISTRATOR - asked of the server ONCE, then shared.
 *
 * =============================================================================
 * WHY THIS IS A SINGLETON AND NOT A HOOK THAT FETCHES
 * =============================================================================
 * It started as a hook that fetched on mount, and the SETTINGS test caught the
 * problem immediately: "this screen asks the platform for nothing ... sends
 * nothing on mount". That is a real property of that screen and worth keeping.
 * A component that quietly issues a request when it renders makes every screen
 * that ever uses it a screen that talks to the network.
 *
 * So the request happens ONCE, from the app shell, where network work already
 * belongs. Components subscribe and never initiate. The answer changes about as
 * often as somebody is made an administrator, which is to say almost never.
 *
 * =============================================================================
 * WHAT THE ANSWER IS FOR
 * =============================================================================
 * Deciding what to DRAW. It is not permission to do anything: every endpoint
 * that changes who may reach the app re-derives the caller's identity from the
 * Cloudflare Access assertion and refuses on its own terms. Forcing `admin:
 * true` here buys a screen whose every button returns 403.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { isAccessBounce } from '../../services/access/session.ts';

export interface AdminIdentity {
  /** The signed-in address, or null when Access is not in front of the app. */
  readonly email: string | null;
  readonly admin: boolean;
  /** False until the first answer arrives, so nothing flashes on screen. */
  readonly known: boolean;
}

export const UNKNOWN: AdminIdentity = Object.freeze({
  email: null,
  admin: false,
  known: false,
});

let identity: AdminIdentity = UNKNOWN;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: AdminIdentity): void {
  identity = next;
  for (const listener of listeners) listener();
}

/**
 * Ask, once per session. Safe to call from anywhere, any number of times.
 *
 * The in-flight promise is the guard: two screens mounting in the same frame
 * must not both ask.
 */
export function loadAdminIdentity(fetcher: typeof fetch = fetch): Promise<void> {
  if (inFlight !== null) return inFlight;
  // `redirect: 'manual'` so an expired Access session is DETECTED rather than
  // silently answered "not an administrator" -- which is how the ADMIN row
  // vanished from SETTINGS at the same moment the camera data stopped loading,
  // both of them correct readings of a question that could not be asked. See
  // services/access/session.ts.
  inFlight = fetcher('/api/admin/me', {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  })
    .then(async (res) => {
      if (isAccessBounce(res)) return null;
      return res.ok ? ((await res.json()) as Partial<AdminIdentity>) : null;
    })
    .then((body) => {
      publish({
        email: typeof body?.email === 'string' ? body.email : null,
        admin: body?.admin === true,
        known: true,
      });
    })
    .catch(() => {
      // No Functions deployed, or offline. "Not an administrator" is the safe
      // answer to a question that could not be asked.
      publish({ email: null, admin: false, known: true });
    });
  return inFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = (): AdminIdentity => identity;

/**
 * Read the shared answer, asking for it the first time somebody wants it.
 *
 * =============================================================================
 * WHY THIS ASKS, WHEN IT USED NOT TO
 * =============================================================================
 * The request was fired from the shell's boot effect for EVERY visitor, to
 * answer a question only SETTINGS and the ADMIN screen ever ask. That put a
 * round trip to the administrative surface on the cold-start path of a driver
 * who will never be an administrator - measured on the live site as one of
 * twenty requests before the map had painted, and the only one that could not
 * possibly matter to them.
 *
 * Moving the ask here makes it cost exactly what it is worth: nothing on DRIVE,
 * one request the first time a screen that shows an admin row is opened.
 *
 * It is still ONE request per session. `loadAdminIdentity` guards on its own
 * in-flight promise, so several screens mounting in the same frame share it,
 * and `identity` is module state that outlives any unmount.
 *
 * `useEffect`, not a call during render: initiating a fetch while rendering is
 * a side effect in the render phase, and under StrictMode it happens twice.
 */
export function useAdmin(): AdminIdentity {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!value.known) void loadAdminIdentity();
  }, [value.known]);
  return value;
}

/** For tests: forget the answer and allow another ask. */
export function resetAdminIdentity(): void {
  inFlight = null;
  publish(UNKNOWN);
}
