/**
 * DELIVERY - that an alert actually reaches the driver's hands.
 *
 * Every tick here comes from the REAL `@fwm/core` engine driven by a test
 * clock, for the reason `stores/alert.test.ts` gives: a wire proved against
 * hand-written ticks proves nothing about the shipped driving loop. This is
 * the file that would have caught `buzz()` having no callers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alertActions, useAlertStore } from '../../stores/alert.ts';
import { createAlertEngine, createTestClock } from '../../stores/fwmCore.ts';
import type { AlertTick, CameraLike } from '../../stores/fwmCore.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { resetAllStores } from '../../stores/index.ts';
import { createMockAdapters } from '../adapters/testing/mocks.ts';
import type { MockAdapterSet } from '../adapters/testing/mocks.ts';
import { createAlertDelivery } from './delivery.ts';
import type { AlertDelivery } from './delivery.ts';

const CAMERA_A: CameraLike = { id: 'FWM-0442', lat: 39.11, lon: -84.5786, directionDeg: 180 };
const CAMERA_B: CameraLike = { id: 'FWM-0443', lat: 39.1101, lon: -84.5788, directionDeg: 180 };
const CAMERAS: readonly CameraLike[] = [CAMERA_A, CAMERA_B];

/** The same northbound approach the alert slice's own tests drive. */
const APPROACH_LATS = [39.1, 39.105, 39.1077, 39.1085, 39.1093];
const START_MS = 1_000_000;
const STEP_MS = 2_000;
const SPEED_MPS = 21;

function driveTicks(): AlertTick[] {
  const clock = createTestClock(START_MS);
  const engine = createAlertEngine({ clock });
  return APPROACH_LATS.map((lat) => {
    const tick = engine.update(
      {
        lat,
        lon: -84.5786,
        headingDeg: 0,
        speedMps: SPEED_MPS,
        accuracyM: 4,
        timestampMs: clock.now(),
      },
      CAMERAS,
    );
    clock.advance(STEP_MS);
    return tick;
  });
}

/**
 * Permission is driven through the ADAPTER, not through a fake global.
 *
 * The mock reproduces the real adapter's refusal exactly -- `show()` returns
 * `blocked` for anything but `granted` and never prompts -- so a test that
 * gets past it would get past the real one, which is the whole point of
 * testing through the adapter rather than around it.
 */
const permit = (state: 'granted' | 'denied' | 'prompt'): void => {
  adapters.notifications.mock.setPermission(state);
};

let adapters: MockAdapterSet;
let delivery: AlertDelivery | null = null;

beforeEach(() => {
  resetAllStores();
  adapters = createMockAdapters();
});

afterEach(() => {
  delivery?.stop();
  delivery = null;
  resetAllStores();
});

const start = (): void => {
  delivery = createAlertDelivery({ adapters });
};

const drive = (): void => {
  for (const tick of driveTicks()) alertActions.ingest(tick);
};

/**
 * `notifications.show()` is async and delivery deliberately does not await it
 * -- a driving loop must not block on the platform. So a test that asserts on
 * what reached the platform has to let the microtask queue drain first.
 */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('haptics', () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR. `vibration.buzz()` was complete,
   * guarded, tested in isolation, and called by nothing in production, so an
   * alert changed pixels and did nothing else.
   */
  it('buzzes when the gate opens', () => {
    useSettingsStore.getState().setVibration(true);
    start();
    drive();
    expect(adapters.vibration.buzzes().length).toBeGreaterThan(0);
  });

  it('is silent when the driver has switched vibration off', () => {
    useSettingsStore.getState().setVibration(false);
    start();
    drive();
    expect(adapters.vibration.buzzes()).toEqual([]);
  });

  /**
   * The toggle is honoured by starting and stopping the ADAPTER, not by a
   * branch at the call site, so flipping it mid-drive has to take effect
   * without restarting delivery.
   */
  it('follows the toggle changing mid-drive', () => {
    useSettingsStore.getState().setVibration(false);
    start();
    drive();
    expect(adapters.vibration.buzzes()).toEqual([]);

    useSettingsStore.getState().setVibration(true);
    resetAlertOnly();
    drive();
    expect(adapters.vibration.buzzes().length).toBeGreaterThan(0);
  });

  it('never buzzes twice for one delivery', () => {
    useSettingsStore.getState().setVibration(true);
    start();
    const ticks = driveTicks();
    const last = ticks[ticks.length - 1] as AlertTick;
    alertActions.ingest(last);
    const after = adapters.vibration.buzzes().length;
    // Re-publishing the same tick must not re-buzz: the store bumps
    // `delivered` per ingest and delivery keys off it.
    useAlertStore.setState({ ticks: useAlertStore.getState().ticks + 1 });
    expect(adapters.vibration.buzzes().length).toBe(after);
  });
});

describe('notifications', () => {
  it('shows one when the gate opens', async () => {
    start();
    drive();
    await settle();
    expect(adapters.notifications.notifications.shown().length).toBeGreaterThan(0);
  });

  /**
   * NEVER PROMPTS. A permission dialog raised by a camera coming into range is
   * a dialog raised while driving. ONBOARDING and SETTINGS ask, in the calm.
   */
  it('stays quiet rather than prompting when permission was never granted', async () => {
    start();
    permit('prompt');
    drive();
    await settle();
    expect(adapters.notifications.notifications.shown()).toEqual([]);
    // THE POINT: no prompt was raised. `request()` is the only thing that
    // prompts and delivery must never call it.
    expect(adapters.notifications.mock.requests()).toBe(0);
  });

  it('stays quiet when permission was denied', async () => {
    start();
    permit('denied');
    drive();
    await settle();
    expect(adapters.notifications.notifications.shown()).toEqual([]);
  });

  /**
   * WHAT GOES TO THE OPERATING SYSTEM. A notification lands on a lock screen,
   * so it may carry a distance and a bearing phrase and never a street, a
   * coordinate or a camera id.
   */
  it('carries a bearing phrase and no location whatsoever', async () => {
    start();
    drive();
    await settle();
    const [first] = adapters.notifications.notifications.shown();
    expect(first).toBeDefined();
    const payload = JSON.stringify(first);
    expect(payload).not.toMatch(/-84\.5|39\.1/);
    expect(payload).not.toContain('FWM-0442');
  });
});

/** Reset only what a second drive needs, leaving settings and delivery alone. */
function resetAlertOnly(): void {
  alertActions.reset();
}
