/**
 * The switch has one job on the devices it exists for: declare the wide layout
 * even though the viewport disagrees, and keep declaring it after a reload.
 * Every test here is written against a viewport that reports PORTRAIT, because
 * a landscape viewport would pass with the feature deleted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyForceLandscape } from './forceLandscape.ts';
import {
  SURFACE_ATTRIBUTE,
  detectSurface,
  setSurfaceOverride,
  surfaceOverride,
  watchSurface,
} from './surface.ts';

/** A portrait phone: not a watch, not wide, not round. */
function portraitViewport(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('screen', { width: 390, height: 844 });
}

beforeEach(() => {
  portraitViewport();
  setSurfaceOverride(null);
});

afterEach(() => {
  setSurfaceOverride(null);
  vi.unstubAllGlobals();
});

describe('the surface a driver declared', () => {
  it('reads phone from a portrait viewport when nothing is declared', () => {
    expect(detectSurface()).toBe('phone');
    expect(surfaceOverride()).toBeNull();
  });

  it('reports dash from the same portrait viewport once the switch is on', () => {
    applyForceLandscape(true);
    expect(detectSurface()).toBe('dash');
  });

  it('writes the declared surface onto the attribute every stylesheet reads', () => {
    // The whole layout keys off this attribute; a declaration the CSS cannot
    // see would change the React tree and leave the styling behind.
    applyForceLandscape(true);
    expect(document.documentElement.getAttribute(SURFACE_ATTRIBUTE)).toBe('dash');
  });

  it('hands the decision back to the viewport when the switch goes off', () => {
    applyForceLandscape(true);
    applyForceLandscape(false);
    expect(surfaceOverride()).toBeNull();
    expect(detectSurface()).toBe('phone');
  });

  it('tells a live watcher on the press, not on the next resize', () => {
    // A driver who pressed a switch is owed the layout now. No resize and no
    // orientationchange is fired in this test, on purpose.
    const seen: string[] = [];
    const watch = watchSurface((next) => seen.push(next));
    applyForceLandscape(true);
    expect(seen).toEqual(['dash']);
    expect(watch.current()).toBe('dash');
    watch.stop();
  });

  it('stops notifying a watcher that was stopped', () => {
    const seen: string[] = [];
    const watch = watchSurface((next) => seen.push(next));
    watch.stop();
    applyForceLandscape(true);
    expect(seen).toEqual([]);
  });

  it('asks the OS to rotate for real, and survives a refusal', () => {
    // The lock is the good outcome; the refusal is the case this whole setting
    // exists for, so a rejected promise must not escape as an unhandled one and
    // must not stop the declaration.
    const lock = vi.fn(() => Promise.reject(new Error('portrait lock engaged')));
    const unlock = vi.fn();
    vi.stubGlobal('screen', { width: 390, height: 844, orientation: { lock, unlock } });

    applyForceLandscape(true);
    expect(lock).toHaveBeenCalledWith('landscape');
    expect(detectSurface()).toBe('dash');

    applyForceLandscape(false);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('survives a browser with no orientation API at all', () => {
    vi.stubGlobal('screen', { width: 390, height: 844 });
    expect(() => applyForceLandscape(true)).not.toThrow();
    expect(detectSurface()).toBe('dash');
  });
});
