/**
 * Shared plumbing for the typed repositories.
 *
 * Two things live here and nothing else: the database handle type, and the
 * injected dependencies every repository takes. Both exist so that a
 * repository is a pure function of (handle, clock, randomness) and a test
 * never has to mock a module.
 */

import type { IDBPDatabase } from 'idb';

import type { FwmDB, StoreName } from '../schema.ts';

/** The open database, typed against the schema. */
export type FwmDatabase = IDBPDatabase<FwmDB>;

/**
 * Everything a repository needs from the outside world.
 *
 * `now` is injected rather than read from `Date.now()` at the call site so a
 * test can drive an expiry, a backoff schedule or a staleness window without
 * sleeping. `random` is injected for the same reason on the jitter path.
 */
export interface RepositoryDeps {
  readonly now: () => number;
  readonly random: () => number;
}

export const systemDeps: RepositoryDeps = {
  now: () => Date.now(),
  random: () => Math.random(),
};

export function resolveDeps(overrides?: Partial<RepositoryDeps>): RepositoryDeps {
  return {
    now: overrides?.now ?? systemDeps.now,
    random: overrides?.random ?? systemDeps.random,
  };
}

/** What an eviction actually did, so a caller can log or surface it. */
export interface EvictionReport {
  readonly store: StoreName;
  readonly reason: 'cap' | 'expiry' | 'explicit';
  readonly evicted: number;
}

/** Errors this layer raises deliberately, rather than letting IDB guess. */
export class RepositoryError extends Error {
  override readonly name = 'RepositoryError';
  constructor(
    message: string,
    readonly store: StoreName,
  ) {
    super(message);
  }
}
