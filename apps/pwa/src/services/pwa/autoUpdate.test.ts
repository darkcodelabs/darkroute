import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServiceWorkerController } from './registerSW.ts';

/**
 * A stand-in for `workbox-window`'s Workbox, so the update flow can be driven
 * without a real service worker. Only the three things the controller uses.
 */
class FakeWorkbox {
  static last: FakeWorkbox | null = null;
  readonly listeners = new Map<string, (() => void)[]>();
  readonly skipWaiting = vi.fn(async () => undefined);
  registration: { waiting: object | null } = { waiting: null };

  constructor() {
    FakeWorkbox.last = this;
  }
  addEventListener(name: string, fn: () => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  emit(name: string): void {
    for (const fn of this.listeners.get(name) ?? []) fn();
  }
  async register(): Promise<{ waiting: object | null }> {
    return this.registration;
  }
  async messageSkipWaiting(): Promise<void> {
    await this.skipWaiting();
  }
}

// The factory is hoisted above the class declaration, so it cannot close over
// it. A function constructor defers the lookup to call time, which is when
// FakeWorkbox exists.
vi.mock('workbox-window', () => ({
  Workbox: function Workbox(this: unknown) {
    return new FakeWorkbox();
  } as unknown as typeof FakeWorkbox,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorkbox.last = null;
});

function secureNavigator(): void {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { controller: null, getRegistrations: async () => [] },
  });
}

describe('taking a new build', () => {
  it('applies an update as soon as one is waiting', async () => {
    // The bug this covers cost real deploys: the controller had applyUpdate()
    // and NOTHING called it, so an installed client served its precached shell
    // forever. Every later deploy reached the CDN and was never seen.
    secureNavigator();
    const reload = vi.fn();
    const controller = createServiceWorkerController({ allowInDev: true, reload });

    await controller.register();
    FakeWorkbox.last?.emit('waiting');
    await vi.waitFor(() => {
      expect(FakeWorkbox.last?.skipWaiting).toHaveBeenCalled();
    });
  });

  it('reloads once the new worker controls the page', async () => {
    // Taking the update is not enough: the DOCUMENT is still the old build
    // until something reloads it, so the swap would be invisible.
    secureNavigator();
    const reload = vi.fn();
    const controller = createServiceWorkerController({ allowInDev: true, reload });

    await controller.register();
    FakeWorkbox.last?.emit('waiting');
    await vi.waitFor(() => {
      expect(FakeWorkbox.last?.skipWaiting).toHaveBeenCalled();
    });
    FakeWorkbox.last?.emit('controlling');

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never swaps the build out from under a live camera alert', async () => {
    // The one case where staying stale is correct: activating a waiting worker
    // reloads the page, and doing that mid-alert destroys the single screen
    // the product exists to show.
    secureNavigator();
    const reload = vi.fn();
    const controller = createServiceWorkerController({
      allowInDev: true,
      reload,
      canApplyUpdate: () => false,
    });

    await controller.register();
    FakeWorkbox.last?.emit('waiting');

    expect(FakeWorkbox.last?.skipWaiting).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(controller.status().updateWaiting).toBe(true);
    expect(controller.status().error).toContain('camera alert is live');
  });

  it('does not reload for a worker this page did not ask for', async () => {
    // `controlling` also fires when another tab takes an update. Reloading on
    // that would yank the page out from under a driver who did nothing.
    secureNavigator();
    const reload = vi.fn();
    const controller = createServiceWorkerController({ allowInDev: true, reload });

    await controller.register();
    FakeWorkbox.last?.emit('controlling');

    expect(reload).not.toHaveBeenCalled();
  });

  it('can be switched off, for a caller that wants to prompt instead', async () => {
    secureNavigator();
    const reload = vi.fn();
    const controller = createServiceWorkerController({
      allowInDev: true,
      reload,
      autoApply: false,
    });

    await controller.register();
    FakeWorkbox.last?.emit('waiting');

    expect(FakeWorkbox.last?.skipWaiting).not.toHaveBeenCalled();
    expect(controller.status().updateWaiting).toBe(true);
  });
});
