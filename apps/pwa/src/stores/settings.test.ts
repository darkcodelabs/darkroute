import { describe, expect, it } from 'vitest';

import { DEFAULT_MODE } from '../app/mode.ts';
import { MONITORING_KINDS, MONITORING_OFF, MONITORING_ON } from '../services/records/monitoringCatalog.ts';
import {
  ALERT_THRESHOLD_MAX_FT,
  ALERT_THRESHOLD_MIN_FT,
  ALERT_THRESHOLD_STEP_FT,
  DEFAULT_ALERT_THRESHOLD_FT,
} from './fwmCore.ts';
import {
  createGuardedPersistStorage,
  createMemoryPersistPort,
  type PersistPort,
} from './persist.ts';
import {
  DEFAULT_SETTINGS,
  createSettingsStore,
  globalMuteRemainingMs,
  isCameraMutedAt,
  isGloballyMutedAt,
  mergePersistedSettings,
  type PersistedSettings,
} from './settings.ts';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function isolatedStore(port: PersistPort, name = 'fwm.test.settings') {
  return createSettingsStore({
    storageName: name,
    storage: createGuardedPersistStorage<PersistedSettings>({ port }),
    skipHydration: true,
  });
}

describe('settings persistence', () => {
  it('round-trips every persisted field through storage into a fresh store', async () => {
    const port = createMemoryPersistPort();
    const first = isolatedStore(port);

    first.getState().setThresholdFt(750);
    first.getState().muteAll(1_000_000, 600_000);
    first.getState().muteCamera('FWM-0442', 1_000_000, 600_000);
    first.getState().setOwnerTypeEnabled('hoa', false);
    first.getState().setHideUnverified(true);
    first.getState().setWifiOnlySync(false);
    first.getState().completeOnboarding(1_234_567);
    first.getState().setVibration(false);
    first.getState().setShowHandle(true);
    first.getState().setMode('pursuit');
    await flush();

    const second = isolatedStore(port);
    await second.persist.rehydrate();

    const state = second.getState();
    expect(state.thresholdFt).toBe(750);
    expect(state.mutedUntilMs).toBe(1_600_000);
    expect(state.mutedCameras['FWM-0442']).toBe(1_600_000);
    expect(state.ownerTypesEnabled.hoa).toBe(false);
    expect(state.ownerTypesEnabled.police).toBe(true);
    expect(state.hideUnverified).toBe(true);
    expect(state.wifiOnlySync).toBe(false);
    expect(state.onboardingCompletedAtMs).toBe(1_234_567);
    expect(state.vibration).toBe(false);
    expect(state.showHandle).toBe(true);
    expect(state.mode).toBe('pursuit');
    expect(state.hydrated).toBe(true);
  });

  it('reports honestly that the default port is not durable', async () => {
    const port = createMemoryPersistPort();
    const store = isolatedStore(port, 'fwm.test.durability');
    await store.persist.rehydrate();
    expect(store.getState().durable).toBe(false);
    expect(store.getState().durabilityReason).toContain('memory');
  });

  it('starts from defaults when nothing has ever been stored', async () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.empty');
    await store.persist.rehydrate();
    expect(store.getState().thresholdFt).toBe(DEFAULT_ALERT_THRESHOLD_FT);
    expect(store.getState().mode).toBe(DEFAULT_MODE);
    expect(store.getState().ownerTypesEnabled).toEqual(DEFAULT_SETTINGS.ownerTypesEnabled);
    expect(store.getState().monitoringTypes).toEqual(MONITORING_ON);
  });

  it('upgrades old monitoring defaults once without resetting other preferences', async () => {
    const port = createMemoryPersistPort();
    const name = 'fwm.test.monitoring-upgrade';
    await port.setItem(name, JSON.stringify({ version: 1,
      state: { ...DEFAULT_SETTINGS, monitoringTypes: MONITORING_OFF, thresholdFt: 750, mode: 'pursuit' } }));
    const first = isolatedStore(port, name);
    await first.persist.rehydrate();
    expect(first.getState().monitoringTypes).toEqual(MONITORING_ON);
    expect(first.getState().thresholdFt).toBe(750);
    expect(first.getState().mode).toBe('pursuit');
    await flush();
    expect(JSON.parse((await port.getItem(name))!).version).toBe(2);

    first.getState().setMonitoringType('traffic_camera', false);
    await flush();
    const second = isolatedStore(port, name);
    await second.persist.rehydrate();
    expect(second.getState().monitoringTypes).toEqual({ ...MONITORING_ON, traffic_camera: false });
    expect(second.getState().thresholdFt).toBe(750);
  });

  it('keeps an explicit all-off choice across subsequent launches', async () => {
    const port = createMemoryPersistPort();
    const name = 'fwm.test.monitoring-off';
    const first = isolatedStore(port, name);
    for (const kind of MONITORING_KINDS) first.getState().setMonitoringType(kind, false);
    await flush();
    const second = isolatedStore(port, name);
    await second.persist.rehydrate();
    expect(second.getState().monitoringTypes).toEqual(MONITORING_OFF);
  });
});

describe('mergePersistedSettings', () => {
  it('ignores a stored threshold outside the slider range', () => {
    // 6000, not 5000: the slider goes to a mile now, so 5000 ft is a value a
    // driver could have chosen and must survive the read back.
    expect(mergePersistedSettings({ thresholdFt: 6_000 }).thresholdFt).toBe(
      DEFAULT_ALERT_THRESHOLD_FT,
    );
    expect(mergePersistedSettings({ thresholdFt: 5_000 }).thresholdFt).toBe(5_000);
    expect(mergePersistedSettings({ thresholdFt: '500' }).thresholdFt).toBe(
      DEFAULT_ALERT_THRESHOLD_FT,
    );
  });

  it('ignores a mode this build does not have', () => {
    expect(mergePersistedSettings({ mode: 'chrome-and-neon' }).mode).toBe(DEFAULT_MODE);
  });

  it('drops non-numeric mute expiries rather than hydrating them', () => {
    const merged = mergePersistedSettings({
      mutedCameras: { 'FWM-0442': 'soon', 'FWM-0118': 42 },
    });
    expect(merged.mutedCameras).toEqual({ 'FWM-0118': 42 });
  });

  it('survives a blob that is not an object at all', () => {
    expect(mergePersistedSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergePersistedSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });
});

describe('threshold', () => {
  it('refuses a value the slider could not have produced', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.threshold');
    expect(() => {
      store.getState().setThresholdFt(0);
    }).toThrow(RangeError);
    expect(() => {
      store.getState().setThresholdFt(ALERT_THRESHOLD_MAX_FT + 1);
    }).toThrow(RangeError);
  });

  it('steps by whole bezel notches and stops at the ends', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.step');
    expect(store.getState().stepThresholdFt(1)).toBe(
      DEFAULT_ALERT_THRESHOLD_FT + ALERT_THRESHOLD_STEP_FT,
    );
    expect(store.getState().stepThresholdFt(-100)).toBe(ALERT_THRESHOLD_MIN_FT);
    // 200 NOTCHES, NOT 100, and the number had to change with the band. The
    // bezel steps 50 ft and the range is now 25..5280 -- 5255 ft, or 106
    // notches end to end -- so a hundred of them from the floor lands at 5025
    // and asserts nothing about the ceiling.
    expect(store.getState().stepThresholdFt(200)).toBe(ALERT_THRESHOLD_MAX_FT);
  });
});

describe('mute arithmetic', () => {
  const at = 1_000_000;

  it('reports the global mute as live until it expires, then not', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.mute');
    store.getState().muteAll(at, 600_000);
    expect(isGloballyMutedAt(store.getState(), at + 1)).toBe(true);
    expect(globalMuteRemainingMs(store.getState(), at + 60_000)).toBe(540_000);
    expect(isGloballyMutedAt(store.getState(), at + 600_001)).toBe(false);
    expect(globalMuteRemainingMs(store.getState(), at + 600_001)).toBe(0);
  });

  it('treats a global mute as covering every camera', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.mute.all');
    store.getState().muteAll(at, 600_000);
    expect(isCameraMutedAt(store.getState(), 'FWM-0873', at + 1)).toBe(true);
  });

  it('prunes only what has actually expired', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.prune');
    store.getState().muteCamera('FWM-0442', at, 10_000);
    store.getState().muteCamera('FWM-0118', at, 600_000);
    store.getState().pruneMutes(at + 20_000);
    expect(Object.keys(store.getState().mutedCameras)).toEqual(['FWM-0118']);
  });

  it('unmuting one camera leaves the others muted', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.unmute');
    store.getState().muteCamera('FWM-0442', at);
    store.getState().muteCamera('FWM-0118', at);
    store.getState().unmuteCamera('FWM-0442');
    expect(isCameraMutedAt(store.getState(), 'FWM-0442', at + 1)).toBe(false);
    expect(isCameraMutedAt(store.getState(), 'FWM-0118', at + 1)).toBe(true);
  });
});

/**
 * THE MAP'S DRAWING FILTER.
 *
 * These tests exist to hold two properties that are invisible in the diff and
 * expensive in the car:
 *
 *   1. It never reaches disk. A drawing filter that survives a cold start
 *      hides cameras from a driver who does not remember asking, which is the
 *      one thing DEFAULT_SETTINGS' comment forbids.
 *   2. It is not `ownerTypesEnabled`. That one governs alerting and is
 *      persisted; writing either through the other's setter is the defect this
 *      whole feature was written to avoid, so the isolation is asserted rather
 *      than assumed.
 */
describe('map owner filter', () => {
  it('starts at all owners and holds whichever class is chosen', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.mapowner');
    expect(store.getState().mapOwnerFilter).toBeNull();

    store.getState().setMapOwnerFilter('police');
    expect(store.getState().mapOwnerFilter).toBe('police');

    store.getState().setMapOwnerFilter(null);
    expect(store.getState().mapOwnerFilter).toBeNull();
  });

  it('never reaches the stored blob, even after other settings are written', async () => {
    const port = createMemoryPersistPort();
    const store = isolatedStore(port, 'fwm.test.mapowner.blob');

    store.getState().setMapOwnerFilter('hoa');
    // A persisted write is what actually triggers a save; without one the blob
    // could be absent for the boring reason rather than the intended one.
    store.getState().setThresholdFt(750);
    await flush();

    const raw = await port.getItem('fwm.test.mapowner.blob');
    expect(raw).not.toBeNull();
    const blob = JSON.parse(raw ?? '{}') as { state?: Record<string, unknown> };
    expect(blob.state?.['thresholdFt']).toBe(750);
    expect(blob.state).not.toHaveProperty('mapOwnerFilter');
    expect(raw).not.toContain('mapOwnerFilter');
  });

  it('comes back null in a fresh store hydrated from a blob written while filtered', async () => {
    const port = createMemoryPersistPort();
    const first = isolatedStore(port, 'fwm.test.mapowner.cold');
    first.getState().setMapOwnerFilter('private');
    first.getState().setThresholdFt(750);
    await flush();

    const second = isolatedStore(port, 'fwm.test.mapowner.cold');
    await second.persist.rehydrate();

    expect(second.getState().thresholdFt).toBe(750);
    expect(second.getState().mapOwnerFilter).toBeNull();
  });

  it('is cleared by reset, which spreads a shape that does not contain it', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.mapowner.reset');
    store.getState().setMapOwnerFilter('inter_agency');
    store.getState().reset();
    expect(store.getState().mapOwnerFilter).toBeNull();
  });

  it('does not disturb the alerting filter, and is not disturbed by it', () => {
    const store = isolatedStore(createMemoryPersistPort(), 'fwm.test.mapowner.triage');

    store.getState().setMapOwnerFilter('police');
    // Drawing only police must leave every owner class still able to alert.
    expect(store.getState().ownerTypesEnabled).toEqual(DEFAULT_SETTINGS.ownerTypesEnabled);

    store.getState().setOwnerTypeEnabled('hoa', false);
    expect(store.getState().mapOwnerFilter).toBe('police');
  });
});
