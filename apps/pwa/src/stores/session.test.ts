import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_LABEL,
  SessionError,
  assertHandleSafe,
  createSessionStore,
  displayName,
  type PersistedSession,
} from './session.ts';
import {
  createGuardedPersistStorage,
  createMemoryPersistPort,
  type PersistPort,
} from './persist.ts';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A server-issued anonymous session id, in the only shape one may take. */
const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function isolated(port: PersistPort, name = 'fwm.test.session') {
  return createSessionStore({
    storageName: name,
    storage: createGuardedPersistStorage<PersistedSession>({ port }),
    skipHydration: true,
  });
}

describe('handles', () => {
  it('accepts an ordinary handle', () => {
    expect(() => {
      assertHandleSafe('wakaflocka');
    }).not.toThrow();
  });

  it('refuses a handle shaped like a licence plate', () => {
    // A handle is public. A plate is not. Typing one into the other is the
    // single worst thing a user of this app could do by accident.
    expect(() => {
      assertHandleSafe('HVK 8842');
    }).toThrow(SessionError);
    expect(() => {
      assertHandleSafe('471 TRB');
    }).toThrow(SessionError);
  });

  it('never echoes the refused value', () => {
    try {
      assertHandleSafe('HVK 8842');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('8842');
    }
  });

  it('refuses a blank handle rather than storing an empty display name', () => {
    expect(() => {
      assertHandleSafe('   ');
    }).toThrow(SessionError);
  });
});

describe('the store', () => {
  it('adopts a server-issued session and round-trips it', async () => {
    const port = createMemoryPersistPort();
    const first = isolated(port);
    first.getState().adopt(UUID, 1_000_000, 'wakaflocka');
    await flush();

    const second = isolated(port);
    await second.persist.rehydrate();
    expect(second.getState().sessionId).toBe(UUID);
    expect(second.getState().handle).toBe('wakaflocka');
    expect(second.getState().issuedAtMs).toBe(1_000_000);
  });

  it('refuses to adopt a plate-shaped handle at all', () => {
    const store = isolated(createMemoryPersistPort(), 'fwm.test.session.plate');
    expect(() => {
      store.getState().adopt(UUID, 1, 'HVK 8842');
    }).toThrow(SessionError);
    expect(store.getState().sessionId).toBeNull();
  });

  it('refuses an id that is not the UUID the server issued', () => {
    const store = isolated(createMemoryPersistPort(), 'fwm.test.session.id');
    expect(() => {
      store.getState().adopt('device-fingerprint-1', 1);
    }).toThrow(SessionError);
  });

  it('clears back to anonymous', () => {
    const store = isolated(createMemoryPersistPort(), 'fwm.test.session.clear');
    store.getState().adopt(UUID, 1, 'wakaflocka');
    store.getState().clear();
    expect(store.getState().sessionId).toBeNull();
    expect(store.getState().handle).toBeNull();
  });
});

describe('displayName', () => {
  it('is anonymous unless the user asked to be shown', () => {
    // "off = you appear as an anonymous dot" - Screens II, A1.
    expect(displayName('wakaflocka', false)).toBe(ANONYMOUS_LABEL);
    expect(displayName(null, true)).toBe(ANONYMOUS_LABEL);
    expect(displayName('wakaflocka', true)).toBe('@wakaflocka');
  });
});
