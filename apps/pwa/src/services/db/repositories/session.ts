/**
 * The anonymous session row. One record, key `current`.
 *
 * "Anonymous server-issued session UUID. No social login, no OAuth, no
 * passwords, no profile pages." The id is issued by the backend and stored
 * here; nothing in this file derives it from anything on the device, because
 * an id derived from the device is a device fingerprint wearing a session's
 * clothes.
 *
 * The handle is optional and validated server-side. This store keeps whatever
 * the server accepted and does not second-guess it - except for one local
 * check: a handle must not be shaped like a licence plate, because a user who
 * types their plate into a public display name has just published the secret
 * this whole product exists to protect.
 */

import type { SessionRecord } from '../schema.ts';
import { SESSION_KEY } from '../schema.ts';
import { looksLikePlate } from './plateVault.ts';
import type { FwmDatabase, RepositoryDeps } from './support.ts';
import { RepositoryError, resolveDeps } from './support.ts';

export interface SessionRepository {
  get(): Promise<SessionRecord | undefined>;
  /** Store a server-issued session. Replaces whatever was there. */
  set(sessionId: string, handle?: string | null): Promise<SessionRecord>;
  setHandle(handle: string | null): Promise<SessionRecord>;
  clear(): Promise<boolean>;
}

export function createSessionRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): SessionRepository {
  const deps = resolveDeps(overrides);

  function assertHandleSafe(handle: string | null): void {
    if (handle === null) return;
    if (looksLikePlate(handle)) {
      // The message never echoes the input: an error string is a log line
      // waiting to happen.
      throw new RepositoryError(
        'handle looks like a licence plate; handles are public and plates are not',
        'session',
      );
    }
  }

  return {
    get() {
      return db.get('session', SESSION_KEY);
    },

    async set(sessionId, handle = null) {
      assertHandleSafe(handle);
      const record: SessionRecord = {
        key: SESSION_KEY,
        sessionId,
        handle,
        issuedAt: deps.now(),
      };
      await db.put('session', record);
      return record;
    },

    async setHandle(handle) {
      assertHandleSafe(handle);
      const existing = await db.get('session', SESSION_KEY);
      if (existing === undefined) {
        throw new RepositoryError('no session to attach a handle to', 'session');
      }
      const record: SessionRecord = { ...existing, handle };
      await db.put('session', record);
      return record;
    },

    async clear() {
      const existed = (await db.get('session', SESSION_KEY)) !== undefined;
      await db.delete('session', SESSION_KEY);
      return existed;
    },
  };
}
