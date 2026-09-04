/**
 * TEST HARNESS. Imported only by `*.test.ts` in this directory.
 *
 * Node has no IndexedDB, so the unit tests cannot drive the real persistent key
 * store. These helpers stand an in-memory store in its place and tell the key
 * manager to treat it as durable - the single place that claim is ever made
 * outside a browser. Nothing here weakens a real signature: the same WebCrypto
 * calls run, against the same non-exportable keys.
 */

import { createKeyManager, memoryKeyStore, type KeyManager, type PersistentKeyStore } from './keys';
import { createEvidenceChain, type EvidenceChain } from './chain';
import { createPlateVault, memoryPlateStore, type PlateVault, type SealedPlateStore } from './plate';

/** An in-memory key store that the manager will accept for signing. */
export function durableMemoryKeyStore(): PersistentKeyStore {
  return memoryKeyStore({ claimDurability: 'persistent' });
}

/** An in-memory key store the manager must REFUSE to sign with. */
export function ephemeralMemoryKeyStore(): PersistentKeyStore {
  return memoryKeyStore();
}

export interface TestInstall {
  readonly keys: KeyManager;
  readonly keyStore: PersistentKeyStore;
  readonly chain: EvidenceChain;
  readonly plateStore: SealedPlateStore;
  readonly plates: PlateVault;
  /** Advance the injected clock by whole milliseconds. */
  tick(byMs: number): void;
}

export interface TestInstallOptions {
  readonly keyStore?: PersistentKeyStore;
  /** Epoch ms the injected clock starts at. */
  readonly startAt?: number;
}

/** 2026-08-20T14:22:08.412Z - the DEAD DROP capture time from Screens II B2. */
export const TEST_EPOCH_MS = Date.UTC(2026, 7, 20, 14, 22, 8, 412);

/**
 * One simulated install: its own key store, evidence chain and plate vault,
 * with a deterministic clock and deterministic report ids.
 */
export function createTestInstall(options: TestInstallOptions = {}): TestInstall {
  const keyStore = options.keyStore ?? durableMemoryKeyStore();
  const keys = createKeyManager({ keyStore });
  let clock = options.startAt ?? TEST_EPOCH_MS;
  const now = (): number => clock;

  let counter = 0;
  const newId = (): string => {
    counter += 1;
    const suffix = counter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  };

  const plateStore = memoryPlateStore();

  return {
    keys,
    keyStore,
    chain: createEvidenceChain({ keys, now, newReportId: newId }),
    plateStore,
    plates: createPlateVault({ keys, store: plateStore, now, newId }),
    tick(byMs) {
      clock += byMs;
    },
  };
}
