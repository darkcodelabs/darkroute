/**
 * The mocks are only useful if they keep the same promises the real adapters
 * keep. These tests are that guarantee.
 */

import { describe, expect, it } from 'vitest';
import { ADAPTER_NAMES, no, type Adapter } from '../types';
import type { AdapterSet } from '../set';
import { CAMERA_ALERT_TAG } from '../notifications';
import { SilentChannelError } from '../vibration';
import { BackgroundConsentRequiredError, type BackgroundConsent } from '../twaLocationBridge';
import { NO_BRIDGE_INFO, createMockAdapters, resetMockAdapters } from './mocks';

const CONSENT: BackgroundConsent = { acknowledged: true, grantedAt: 1_787_000_000_000 };

describe('the mock set', () => {
  it('is assignable to the real AdapterSet', () => {
    // If this stops compiling, a mock has drifted from its adapter.
    const set: AdapterSet = createMockAdapters();
    expect(Object.keys(set).sort()).toEqual([...ADAPTER_NAMES].sort());
  });

  it('starts supported, granted and stopped', async () => {
    const set = createMockAdapters();
    for (const name of ADAPTER_NAMES) {
      if (name === 'twaLocationBridge') continue; // truthfully absent by default
      const adapter = set[name] as unknown as Adapter<unknown, never>;
      expect(adapter.capability().supported).toBe(true);
      expect(adapter.current()).toBeNull();
      expect(adapter.error()).toBeNull();
      await expect(adapter.permission?.()).resolves.toBe('granted');
    }
  });

  it('defaults the native bridge to absent, because that is the truth', () => {
    const set = createMockAdapters();
    expect(set.twaLocationBridge.capability().supported).toBe(false);
    expect(set.twaLocationBridge.bridgeInfo()).toEqual(NO_BRIDGE_INFO);
  });
});

describe('mock controls', () => {
  it('makes a platform unsupported on demand, exactly like the real one', () => {
    const set = createMockAdapters();
    set.geolocation.mock.setCapability(no('this laptop has no gps'));

    expect(set.geolocation.capability().reason).toBe('this laptop has no gps');
    set.geolocation.start();
    expect(set.geolocation.error()?.code).toBe('unsupported');
    expect(set.geolocation.current()).toBeNull();
  });

  it('surfaces a denial without crashing', async () => {
    const set = createMockAdapters();
    set.notifications.mock.setRequestOutcome('denied');
    await expect(set.notifications.request()).resolves.toBe('denied');
    await expect(set.notifications.permission()).resolves.toBe('denied');
    expect(set.notifications.mock.requests()).toBe(1);
  });

  it('sets a value silently and emits a value loudly', () => {
    const set = createMockAdapters();
    const seen: number[] = [];
    set.battery.subscribe((state) => seen.push(state.level));

    set.battery.mock.set({
      level: 0.5,
      charging: false,
      chargingTimeS: null,
      dischargingTimeS: null,
      timestamp: 1,
    });
    expect(seen).toHaveLength(0);
    expect(set.battery.current()?.level).toBe(0.5);

    set.battery.mock.emit({
      level: 0.12,
      charging: false,
      chargingTimeS: null,
      dischargingTimeS: null,
      timestamp: 2,
    });
    expect(seen).toEqual([0.12]);
    expect(set.battery.isBelow(0.2)).toBe(true);
  });

  it('hands back an unsubscribe that works and is idempotent', () => {
    const set = createMockAdapters();
    let calls = 0;
    const unsubscribe = set.network.subscribe(() => {
      calls += 1;
    });
    set.network.setOnline(true);
    expect(calls).toBe(1);
    unsubscribe();
    unsubscribe();
    set.network.setOnline(false);
    expect(calls).toBe(1);
    expect(set.network.mock.subscribers()).toBe(0);
  });

  it('counts start and stop calls while staying idempotent', () => {
    const set = createMockAdapters();
    set.visibility.start();
    set.visibility.start();
    expect(set.visibility.mock.starts()).toBe(2);
    expect(set.visibility.mock.started()).toBe(true);
    set.visibility.stop();
    set.visibility.stop();
    expect(set.visibility.mock.started()).toBe(false);
  });

  it('fails and resets', () => {
    const set = createMockAdapters();
    set.motion.mock.fail('sensor-gone', 'the accelerometer stopped');
    expect(set.motion.error()?.code).toBe('sensor-gone');
    resetMockAdapters(set);
    expect(set.motion.error()).toBeNull();
    expect(set.motion.mock.starts()).toBe(0);
  });
});

describe('the mocks reproduce the rules, not just the shapes', () => {
  it('vibration still refuses a non-camera caller', () => {
    const set = createMockAdapters();
    set.vibration.start();
    expect(() => set.vibration.buzz({ source: 'county-entry', state: 'in_range' })).toThrow(
      SilentChannelError,
    );
    expect(set.vibration.buzzes()).toHaveLength(0);

    const result = set.vibration.buzz({ source: 'camera-alert', state: 'multiple' });
    expect(result.ok).toBe(true);
    expect(set.vibration.buzzes()).toHaveLength(1);
  });

  it('notifications still replace by tag instead of stacking', async () => {
    const set = createMockAdapters();
    set.notifications.start();

    await set.notifications.show({
      kind: 'camera-alert',
      state: 'approaching',
      distanceFt: 820,
      bearingLabel: 'ahead · closing',
      inRangeCount: 0,
    });
    await set.notifications.show({
      kind: 'camera-alert',
      state: 'in_range',
      distanceFt: 425,
      bearingLabel: 'ahead · slight left',
      inRangeCount: 3,
    });

    const shown = set.notifications.notifications.shown();
    expect(shown).toHaveLength(1);
    expect(shown[0]?.tag).toBe(CAMERA_ALERT_TAG);
    expect(shown[0]?.channel).toBe('alert-in-range');
  });

  it('notifications still refuse to post while stopped', async () => {
    const set = createMockAdapters();
    const result = await set.notifications.show({ kind: 'watchlist', newReadCount: 1 });
    expect(result.outcome).toBe('blocked');
    expect(set.notifications.notifications.shown()).toHaveLength(0);
  });

  it('the bridge still demands acknowledged consent', () => {
    const set = createMockAdapters();
    const unacknowledged = { acknowledged: false, grantedAt: 0 } as unknown as BackgroundConsent;
    expect(() => set.twaLocationBridge.startBackgroundTracking(unacknowledged)).toThrow(
      BackgroundConsentRequiredError,
    );
    // With consent but no bridge, it still refuses rather than pretending.
    expect(set.twaLocationBridge.startBackgroundTracking(CONSENT)).toBe(false);

    set.twaLocationBridge.setBridgeInfo({
      present: true,
      version: '1.0.0',
      canRequestPermission: true,
      canTrackInBackground: true,
    });
    expect(set.twaLocationBridge.startBackgroundTracking(CONSENT)).toBe(true);
    expect(set.twaLocationBridge.backgroundTracking()).toBe(true);
  });

  it('speech reports the wake-word answer separately from push-to-talk', () => {
    const set = createMockAdapters();
    set.speechRecognition.setWakeWordCapability(no('wake word only runs while on screen'));
    expect(set.speechRecognition.capability().supported).toBe(true);
    expect(set.speechRecognition.wakeWordCapability().supported).toBe(false);

    set.speechRecognition.start({ mode: 'wake-word' });
    expect(set.speechRecognition.listening()).toBe(false);
    expect(set.speechRecognition.error()?.code).toBe('wake-word-unavailable');

    set.speechRecognition.startPushToTalk();
    expect(set.speechRecognition.listening()).toBe(true);
    expect(set.speechRecognition.mode()).toBe('push-to-talk');
  });

  it('camera capture models a cancelled picker as null', async () => {
    const set = createMockAdapters();
    await expect(set.cameraCapture.capture()).resolves.toBeNull();

    const photo = {
      blob: new Blob(['x']),
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      metadataStripped: false,
      capturedAt: 1,
    } as const;
    set.cameraCapture.setNextPhoto(photo);
    await expect(set.cameraCapture.capture()).resolves.toEqual(photo);
    expect(set.cameraCapture.current()).toEqual(photo);
  });

  it('share reports a dismissed sheet as cancelled, not as a failure', async () => {
    const set = createMockAdapters();
    set.share.setNextStatus('cancelled');
    const outcome = await set.share.share({
      kind: 'zone-audit-card',
      title: 'zone audit',
      text: '47 license plate readers within 2 miles',
    });
    expect(outcome.status).toBe('cancelled');
    expect(set.share.shared()).toHaveLength(0);
  });

  it('clipboard records what it was asked to copy', async () => {
    const set = createMockAdapters();
    await expect(set.clipboard.writeText('camera-id', 'FWM-0442')).resolves.toBe(true);
    expect(set.clipboard.writes()).toEqual([{ kind: 'camera-id', text: 'FWM-0442' }]);
    expect(set.clipboard.current()?.characters).toBe(8);
  });
});
