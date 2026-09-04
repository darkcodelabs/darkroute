import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PORTRAIT_LOCK,
  currentOrientation,
  lockPortrait,
  orientationLockCapability,
  unlockOrientation,
} from './orientation.ts';

function stubScreen(orientation: unknown): void {
  vi.stubGlobal('screen', { orientation } as unknown as Screen);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('orientationLockCapability', () => {
  it('says no when there is no Screen Orientation API', () => {
    stubScreen(undefined);
    const capability = orientationLockCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/no Screen Orientation API/);
  });

  it('says no when the API exists without lock(), which is Safari', () => {
    stubScreen({ type: 'portrait-primary' });
    const capability = orientationLockCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/not orientation\.lock/);
  });

  it('says yes when lock() is there', () => {
    stubScreen({ type: 'portrait-primary', lock: () => Promise.resolve() });
    expect(orientationLockCapability().supported).toBe(true);
  });
});

describe('lockPortrait', () => {
  it('asks for portrait-primary, the value section 06 and the manifest name', async () => {
    const lock = vi.fn(() => Promise.resolve());
    stubScreen({ type: 'portrait-primary', lock });

    await expect(lockPortrait('phone')).resolves.toEqual({ outcome: 'locked', reason: null });
    expect(lock).toHaveBeenCalledWith(PORTRAIT_LOCK);
    expect(PORTRAIT_LOCK).toBe('portrait-primary');
  });

  it('never throws when the platform refuses, and reports what it said', async () => {
    stubScreen({
      lock: () =>
        Promise.reject(
          new Error('The page needs to be fullscreen in order to call screen.orientation.lock()'),
        ),
    });

    const result = await lockPortrait('phone');
    expect(result.outcome).toBe('refused');
    expect(result.reason).toMatch(/fullscreen/);
  });

  it('never throws when there is no API at all', async () => {
    stubScreen(undefined);
    const result = await lockPortrait('phone');
    expect(result.outcome).toBe('unavailable');
    expect(result.reason).not.toBeNull();
  });

  it('does not fight a head unit: the dash surface is skipped without calling the API', async () => {
    const lock = vi.fn(() => Promise.resolve());
    stubScreen({ lock });

    const result = await lockPortrait('dash');
    expect(result.outcome).toBe('not-applicable');
    expect(lock).not.toHaveBeenCalled();
  });

  it('locks the watch surfaces like a phone', async () => {
    const lock = vi.fn(() => Promise.resolve());
    stubScreen({ lock });
    await expect(lockPortrait('watch-round')).resolves.toMatchObject({ outcome: 'locked' });
  });
});

describe('unlockOrientation', () => {
  it('is a no-op that reports false when unsupported', () => {
    stubScreen(undefined);
    expect(unlockOrientation()).toBe(false);
  });

  it('calls unlock() and never throws when it fails', () => {
    const unlock = vi.fn(() => {
      throw new Error('nothing was locked');
    });
    stubScreen({ unlock });
    expect(unlockOrientation()).toBe(false);
    expect(unlock).toHaveBeenCalled();
  });

  it('returns true on success', () => {
    stubScreen({ unlock: () => undefined });
    expect(unlockOrientation()).toBe(true);
  });
});

describe('currentOrientation', () => {
  it('reports the platform value, or null when unknown', () => {
    stubScreen({ type: 'landscape-primary' });
    expect(currentOrientation()).toBe('landscape-primary');
    stubScreen(undefined);
    expect(currentOrientation()).toBeNull();
  });
});
