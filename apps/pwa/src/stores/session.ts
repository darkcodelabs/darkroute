/**
 * SESSION - anonymous, server-issued, no login of any kind.
 *
 * "no account · no analytics · GPL-3.0-only source"
 * - Flockys Screens II.dc.html, A1 · ONBOARDING
 *
 * One UUID the backend issued, and an optional display handle the backend
 * accepted ("@wakaflocka", A6 · CONTRIBUTION BOARD). Nothing here is derived
 * from the device: an id derived from the device is a fingerprint wearing a
 * session's clothes, and this product would be the wrong place to build one.
 *
 * THE HANDLE IS PUBLIC. THE PLATE IS NOT.
 *   A handle appears in the MESH feed next to a distance. A user who types
 *   their plate into a public display name has just published the one secret
 *   this whole product exists to protect, so {@link SessionError} is raised
 *   before such a handle can be stored - the same check
 *   `services/db/repositories/session.ts` makes, applied here because this
 *   slice persists and that one is not always in the path.
 *
 * This is the second and last slice allowed to persist. Its stored blob goes
 * through the guarded storage in `./persist.ts` like the settings one does.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage } from 'zustand/middleware';

import { looksLikePlate } from '../services/db/repositories/plateVault.ts';
import { createGuardedPersistStorage, getPersistPort } from './persist.ts';

/**
 * The shape a session id must have.
 *
 * "Anonymous server-issued session UUID" - and the persistence boundary in
 * `./persist.ts` only exempts this field from the plate-shape check on the
 * condition that it really is a UUID, so validating here turns a confusing
 * `PlateShapedValueError` at the write into a clear refusal at the call.
 */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Raised for a handle that must not be stored. Never echoes the input. */
export class SessionError extends Error {
  override readonly name = 'SessionError';
}

export interface PersistedSession {
  /** Server-issued anonymous UUID, or null before the first exchange. */
  readonly sessionId: string | null;
  /** Claimed display handle, without the leading `@`. Null until claimed. */
  readonly handle: string | null;
  /** Epoch ms the id was issued by the server. */
  readonly issuedAtMs: number | null;
}

export interface SessionState extends PersistedSession {
  readonly hydrated: boolean;
  readonly durable: boolean;
  readonly durabilityReason: string | null;
}

export interface SessionActions {
  /** Store what the server issued. Replaces whatever was there. */
  adopt(sessionId: string, issuedAtMs: number, handle?: string | null): void;
  /** @throws SessionError when the handle could be a plate. */
  setHandle(handle: string | null): void;
  /** Forget the session. Used by "forget me" and by `clearLocalData()`. */
  clear(): void;
  refreshDurability(): void;
  markHydrated(): void;
}

export type SessionStore = SessionState & SessionActions;

export const ANONYMOUS_SESSION: PersistedSession = Object.freeze({
  sessionId: null,
  handle: null,
  issuedAtMs: null,
});

/**
 * Handles are validated server-side; this is the one local refusal.
 *
 * The message names the rule, never the value - an exception message is a log
 * line waiting to happen, and this one is raised exactly when the value might
 * be the secret.
 */
export function assertHandleSafe(handle: string | null): void {
  if (handle === null) return;
  if (handle.trim() === '') {
    throw new SessionError('a handle cannot be blank; pass null to clear it');
  }
  if (looksLikePlate(handle)) {
    throw new SessionError('handle looks like a licence plate; handles are public and plates are not');
  }
}

function readPersistedSession(stored: unknown): PersistedSession {
  if (stored === null || typeof stored !== 'object') return ANONYMOUS_SESSION;
  const bag = stored as Record<string, unknown>;
  const sessionId = bag['sessionId'];
  const handle = bag['handle'];
  const issuedAtMs = bag['issuedAtMs'];
  // A stored handle has been through a browser upgrade and possibly a devtools
  // edit. If it now looks like a plate, drop it rather than hydrate it: the
  // store must not become the reason a plate is on screen.
  const safeHandle =
    typeof handle === 'string' && handle !== '' && !looksLikePlate(handle) ? handle : null;
  return Object.freeze({
    sessionId:
      typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId) ? sessionId : null,
    handle: safeHandle,
    issuedAtMs: typeof issuedAtMs === 'number' && Number.isFinite(issuedAtMs) ? issuedAtMs : null,
  });
}

export const SESSION_STORAGE_KEY = 'fwm.session';
export const SESSION_STORAGE_VERSION = 1;

export interface SessionStoreOptions {
  readonly storageName?: string;
  readonly storage?: PersistStorage<PersistedSession, Promise<void>>;
  readonly skipHydration?: boolean;
}

export function createSessionStore(options: SessionStoreOptions = {}) {
  const storage = options.storage ?? createGuardedPersistStorage<PersistedSession>();

  return create<SessionStore>()(
    persist(
      (set) => ({
        ...ANONYMOUS_SESSION,
        hydrated: false,
        durable: getPersistPort().durable,
        durabilityReason: null,

        adopt(sessionId, issuedAtMs, handle = null) {
          if (!SESSION_ID_RE.test(sessionId)) {
            throw new SessionError(
              'a session id must be the UUID the server issued; nothing here derives one from the device',
            );
          }
          assertHandleSafe(handle);
          set({ sessionId, issuedAtMs, handle });
        },

        setHandle(handle) {
          assertHandleSafe(handle);
          set({ handle });
        },

        clear() {
          set({ ...ANONYMOUS_SESSION });
        },

        refreshDurability() {
          const port = getPersistPort();
          set({
            durable: port.durable,
            durabilityReason: port.durable ? null : (port.reason ?? null),
          });
        },

        markHydrated() {
          set({ hydrated: true });
        },
      }),
      {
        name: options.storageName ?? SESSION_STORAGE_KEY,
        version: SESSION_STORAGE_VERSION,
        storage,
        skipHydration: options.skipHydration ?? false,
        partialize: (state): PersistedSession => ({
          sessionId: state.sessionId,
          handle: state.handle,
          issuedAtMs: state.issuedAtMs,
        }),
        merge: (persisted, current): SessionStore => ({
          ...current,
          ...readPersistedSession(persisted),
        }),
        onRehydrateStorage: () => (state) => {
          state?.refreshDurability();
          state?.markHydrated();
        },
      },
    ),
  );
}

export const useSessionStore = createSessionStore();

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useSessionId = (): string | null => useSessionStore((s) => s.sessionId);
export const useHandle = (): string | null => useSessionStore((s) => s.handle);
export const useHasSession = (): boolean => useSessionStore((s) => s.sessionId !== null);
export const useSessionHydrated = (): boolean => useSessionStore((s) => s.hydrated);

/**
 * What a peer-facing surface is allowed to call this user.
 *
 * "off = you appear as an anonymous dot" (A1) and "anonymous" is a literal row
 * in the MESH feed (A5), so the anonymous case is a real, designed value rather
 * than a missing one.
 */
export const ANONYMOUS_LABEL = 'anonymous';

export function displayName(handle: string | null, showHandle: boolean): string {
  if (!showHandle || handle === null) return ANONYMOUS_LABEL;
  return `@${handle}`;
}
