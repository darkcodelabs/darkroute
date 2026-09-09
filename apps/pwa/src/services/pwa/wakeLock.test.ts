import { afterEach, describe, expect, it } from 'vitest';

import { no } from '../adapters/types.ts';
import { createMockVisibility, createMockWakeLock } from '../adapters/testing/mocks.ts';
import { disposeScreenState, initScreenState, openScreen } from '../../app/screenState.ts';
import { WAKE_LOCK_SCREEN, createRadarWakeLock } from './wakeLock.ts';

function build() {
  const wakeLock = createMockWakeLock();
  const visibility = createMockVisibility();
  return { wakeLock, visibility };
}

afterEach(() => {
  disposeScreenState();
});

describe('createRadarWakeLock', () => {
  it('names RADAR as the only screen that earns a lock', () => {
    expect(WAKE_LOCK_SCREEN).toBe('radar');
  });

  it('takes the lock on RADAR and drops it on every other screen', () => {
    const { wakeLock, visibility } = build();
    const controller = createRadarWakeLock({ wakeLock, visibility, followScreenStore: false });
    controller.start();

    // RADAR is the initial screen.
    expect(wakeLock.mock.started()).toBe(true);
    expect(controller.status().wanted).toBe(true);
    expect(controller.status().held).toBe(true);

    controller.setScreen('sweep');
    expect(wakeLock.mock.started()).toBe(false);
    expect(controller.status().wanted).toBe(false);
    expect(controller.status().held).toBe(false);

    controller.setScreen('radar');
    expect(wakeLock.mock.started()).toBe(true);
    controller.stop();
  });

  it('releases on hide and re-acquires on visible', () => {
    const { wakeLock, visibility } = build();
    const controller = createRadarWakeLock({ wakeLock, visibility, followScreenStore: false });
    controller.start();
    expect(wakeLock.mock.started()).toBe(true);

    visibility.setVisible(false);
    expect(wakeLock.mock.started()).toBe(false);
    expect(controller.status().visible).toBe(false);

    visibility.setVisible(true);
    expect(wakeLock.mock.started()).toBe(true);
    expect(controller.status().wanted).toBe(true);
    controller.stop();
  });

  it('does not re-acquire on visible when RADAR is no longer foreground', () => {
    const { wakeLock, visibility } = build();
    const controller = createRadarWakeLock({ wakeLock, visibility, followScreenStore: false });
    controller.start();

    controller.setScreen('log');
    visibility.setVisible(false);
    visibility.setVisible(true);

    expect(wakeLock.mock.started()).toBe(false);
    controller.stop();
  });

  it('follows the screen store when asked to', () => {
    initScreenState();
    const { wakeLock, visibility } = build();
    const controller = createRadarWakeLock({ wakeLock, visibility });
    controller.start();
    expect(wakeLock.mock.started()).toBe(true);

    openScreen('lookup');
    expect(wakeLock.mock.started()).toBe(false);

    openScreen('radar');
    expect(wakeLock.mock.started()).toBe(true);
    controller.stop();
  });

  it('releases and unsubscribes on stop, and stop is idempotent', () => {
    const { wakeLock, visibility } = build();
    const controller = createRadarWakeLock({ wakeLock, visibility, followScreenStore: false });
    controller.start();
    controller.stop();
    controller.stop();

    expect(wakeLock.mock.started()).toBe(false);
    expect(controller.status().wanted).toBe(false);

    // A late visibility change must not resurrect the lock.
    visibility.setVisible(true);
    expect(wakeLock.mock.started()).toBe(false);
  });

  it('reports the platform capability honestly instead of pretending it holds a lock', () => {
    const { wakeLock, visibility } = build();
    wakeLock.mock.setCapability(no('the Screen Wake Lock API is not available in this browser'));

    const controller = createRadarWakeLock({ wakeLock, visibility, followScreenStore: false });
    expect(controller.capability().supported).toBe(false);
    expect(controller.capability().reason).toMatch(/not available/);

    controller.start();
    // `wanted` is honest about intent; `held` must not claim a lock the
    // platform never gave.
    expect(controller.status().wanted).toBe(true);
    expect(controller.status().held).toBe(false);
    controller.stop();
  });

  it('publishes status to subscribers on every change', () => {
    const { wakeLock, visibility } = build();
    const controller = createRadarWakeLock({ wakeLock, visibility, followScreenStore: false });
    const seen: boolean[] = [];
    const off = controller.subscribe((status) => seen.push(status.wanted));

    controller.start();
    controller.setScreen('ask');
    controller.setScreen('radar');
    off();
    controller.stop();

    expect(seen).toContain(true);
    expect(seen).toContain(false);
  });
});
