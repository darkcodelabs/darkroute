/**
 * STORE BOOT - install the durable port, then re-read the persisted slices.
 *
 * The stores are created at module scope, so zustand starts hydrating them the
 * moment they are imported: before any port can be opened, because opening
 * IndexedDB is asynchronous. Those first reads therefore hit the in-memory
 * fallback and come back empty, and both slices mark themselves hydrated with
 * defaults.
 *
 * That is why this runs a REHYDRATE after installing the port rather than only
 * installing it. Without the second pass the durable port would take effect for
 * writes and not for the read that matters - the one on cold start - and a
 * saved theme would still come back as Night Watch every time.
 *
 * WHY IT IS ALLOWED TO GIVE UP
 *   A blocked IndexedDB upgrade never resolves. Blocking the first paint on it
 *   forever means an app that shows nothing at all, which is strictly worse
 *   than an app that opens with default settings and says its settings are not
 *   durable - a sentence SETTINGS already knows how to print. Hence the
 *   deadline.
 */

import { installIdbPersistPort } from './persistPort.idb.ts';
import { hydrateHistory } from './historyPersistence.ts';
import { useSettingsStore } from './settings.ts';
import { useSessionStore } from './session.ts';

/**
 * How long the first paint may wait on the local database.
 *
 * Not a design value: nothing is animated or sized by it. An IndexedDB open on
 * a cold phone is single-digit milliseconds; this is the ceiling for the
 * pathological case (a blocked upgrade from another open tab), not a budget.
 */
export const BOOT_DEADLINE_MS = 1_500;

export interface BootStoresOptions {
  readonly deadlineMs?: number;
  /** Injected in tests, to avoid opening a real database. */
  readonly install?: () => Promise<unknown>;
}

export interface BootResult {
  readonly durable: boolean;
  /** True when the deadline fired before the database answered. */
  readonly timedOut: boolean;
}

function deadline(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve('timeout');
    }, ms);
  });
}

export async function bootStores(options: BootStoresOptions = {}): Promise<BootResult> {
  const ms = options.deadlineMs ?? BOOT_DEADLINE_MS;
  const install = options.install ?? installIdbPersistPort;

  const outcome = await Promise.race([install().then(() => 'installed' as const), deadline(ms)]);

  if (outcome === 'timeout') {
    // The install is still in flight and will install the port when it lands.
    // Anything written after that point is durable; this boot is not, and the
    // stores report that rather than the UI assuming it.
    useSettingsStore.getState().refreshDurability();
    return { durable: false, timedOut: true };
  }

  // Re-read both persisted slices through the port that now exists. These
  // cannot be skipped on the grounds that the stores are "already hydrated":
  // they are hydrated FROM THE WRONG PORT.
  await Promise.all([
    useSettingsStore.persist.rehydrate(),
    useSessionStore.persist.rehydrate(),
  ]);

  // THE LOG, BACK OFF DISK. Not raced against the deadline above: the alert
  // history is what the driver collected, and a boot that gives up on it
  // reports zero as though the drive never happened - which is exactly the
  // bug this was added to fix. It is awaited, and a failure is survivable
  // because `hydrateHistory` returns false rather than throwing.
  await hydrateHistory();

  useSettingsStore.getState().refreshDurability();
  return { durable: useSettingsStore.getState().durable, timedOut: false };
}
