/**
 * Single-value settings, keyed by name.
 *
 * WHY THERE IS NO DEFAULT ALERT THRESHOLD IN THIS FILE. The engine's default
 * lives in `packages/core` as `DEFAULT_ALERT_THRESHOLD_FT`, sourced from the
 * design. A second copy here would be a second place for a design value to
 * drift, and the one that drifts is always the copy nobody remembered. This
 * store answers "not set" honestly; callers pass their own fallback to
 * `getOr()` and get it from the engine.
 *
 * VALUES ARE VALIDATED ON READ. The only writer is `set()`, which is typed -
 * but a value read back from disk has been through a browser upgrade, a
 * profile sync and possibly a devtools edit since it was written. A guard per
 * name costs a line and turns "the app crashed" into "the setting was
 * ignored".
 */

import type { SettingName, SettingsRecord, SettingsValueMap } from '../schema.ts';
import { SECRET_SETTING_NAMES } from '../schema.ts';
import type { FwmDatabase, RepositoryDeps } from './support.ts';
import { resolveDeps } from './support.ts';

type Guard = (value: unknown) => boolean;

const isNumber: Guard = (value) => typeof value === 'number' && Number.isFinite(value);
const isBoolean: Guard = (value) => typeof value === 'boolean';
const isNullableNumber: Guard = (value) => value === null || isNumber(value);
const isNullableString: Guard = (value) => value === null || typeof value === 'string';
const isRecord: Guard = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** One guard per name. A name with no guard cannot be added by accident. */
const GUARDS: Readonly<Record<SettingName, Guard>> = {
  'alert.thresholdFt': isNumber,
  'alert.mutedUntil': isNullableNumber,
  'alert.mutedCameras': isRecord,
  'triage.enabledOwnerTypes': isRecord,
  'triage.hideUnverified': isBoolean,
  'sync.wifiOnly': isBoolean,
  'plateVault.keyId': isNullableString,
  'plateVault.lastExportAt': isNullableNumber,
  'onboarding.completedAt': isNullableNumber,
};

export interface SettingsRepository {
  get<K extends SettingName>(name: K): Promise<SettingsValueMap[K] | undefined>;
  getOr<K extends SettingName>(name: K, fallback: SettingsValueMap[K]): Promise<SettingsValueMap[K]>;
  set<K extends SettingName>(name: K, value: SettingsValueMap[K]): Promise<void>;
  remove(name: SettingName): Promise<void>;
  /** Everything that is set and valid. Absent names are absent, not defaulted. */
  all(): Promise<Partial<SettingsValueMap>>;
  /**
   * Drop the settings that are local-only secrets - today, the plate-vault key
   * reference. Returns the names actually removed, for `clearLocalData()`.
   */
  clearSecrets(): Promise<SettingName[]>;
  clear(): Promise<number>;
}

export function createSettingsRepository(
  db: FwmDatabase,
  overrides?: Partial<RepositoryDeps>,
): SettingsRepository {
  const deps = resolveDeps(overrides);

  async function read<K extends SettingName>(name: K): Promise<SettingsValueMap[K] | undefined> {
    const row = await db.get('settings', name);
    if (row === undefined) return undefined;
    if (!GUARDS[name](row.value)) return undefined;
    // The guard above is the runtime proof of this assertion; `value` is
    // declared `unknown` in the schema precisely so this is the only place a
    // setting's type is decided.
    return row.value as SettingsValueMap[K];
  }

  return {
    get: read,

    async getOr(name, fallback) {
      const value = await read(name);
      return value === undefined ? fallback : value;
    },

    async set(name, value) {
      const record: SettingsRecord = { name, value, updatedAt: deps.now() };
      await db.put('settings', record);
    },

    async remove(name) {
      await db.delete('settings', name);
    },

    async all() {
      const rows = await db.getAll('settings');
      const out: Partial<SettingsValueMap> = {};
      for (const row of rows) {
        const guard = GUARDS[row.name] as Guard | undefined;
        if (guard === undefined || !guard(row.value)) continue;
        // Same reasoning as `read`: guarded, then narrowed once.
        Object.assign(out, { [row.name]: row.value });
      }
      return out;
    },

    async clearSecrets() {
      const removed: SettingName[] = [];
      const tx = db.transaction('settings', 'readwrite');
      for (const name of SECRET_SETTING_NAMES) {
        const existing = await tx.store.get(name);
        if (existing === undefined) continue;
        void tx.store.delete(name);
        removed.push(name);
      }
      await tx.done;
      return removed;
    },

    async clear() {
      const total = await db.count('settings');
      await db.clear('settings');
      return total;
    },
  };
}
