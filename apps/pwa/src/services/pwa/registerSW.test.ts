import { afterEach, describe, expect, it, vi } from 'vitest';

import { SW_URL, createServiceWorkerController, serviceWorkerCapability } from './registerSW.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('serviceWorkerCapability', () => {
  it('says no, with a sentence, when the browser has no service workers', () => {
    // jsdom has no navigator.serviceWorker, which is the honest answer for it.
    const capability = serviceWorkerCapability(true);
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/no service worker support/);
  });

  it('says no on an insecure origin, and says why', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('isSecureContext', false);
    const capability = serviceWorkerCapability(true);
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/secure context/);
  });

  it('refuses to register in a dev build unless explicitly allowed', () => {
    vi.stubGlobal('navigator', { serviceWorker: {} });
    vi.stubGlobal('isSecureContext', true);
    // vitest runs with import.meta.env.DEV === true.
    expect(serviceWorkerCapability(false).supported).toBe(false);
    expect(serviceWorkerCapability(false).reason).toMatch(/dev builds/);
    expect(serviceWorkerCapability(true).supported).toBe(true);
  });
});

describe('the controller', () => {
  it('defaults to the worker generateSW emits at the site root', () => {
    expect(SW_URL).toBe('/sw.js');
  });

  it('reports unsupported instead of throwing, and registers nothing', async () => {
    const controller = createServiceWorkerController();
    const status = await controller.register();
    expect(status.phase).toBe('unsupported');
    expect(status.controlling).toBe(false);
    expect(status.error).not.toBeNull();
  });

  it('refuses to apply an update that is not waiting', async () => {
    const controller = createServiceWorkerController();
    await controller.register();
    await expect(controller.applyUpdate()).resolves.toBe(false);
  });

  it('publishes status changes to subscribers', async () => {
    const controller = createServiceWorkerController();
    const phases: string[] = [];
    const off = controller.subscribe((status) => phases.push(status.phase));
    await controller.register();
    off();
    expect(phases).toContain('unsupported');
  });

  it('starts idle and never claims a worker it does not have', () => {
    const controller = createServiceWorkerController();
    expect(controller.status()).toEqual({
      phase: 'idle',
      controlling: false,
      updateWaiting: false,
      error: null,
    });
  });
});
