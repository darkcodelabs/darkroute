import { existsSync, readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { whenStyleReady, type StyleReadyEvent, type StyleReadyTarget } from './mapStyleReady.ts';

class FakeStyle implements StyleReadyTarget {
  loaded = false;
  readonly listeners = new Map<StyleReadyEvent, Set<() => void>>();

  isStyleLoaded(): boolean {
    return this.loaded;
  }

  on(event: StyleReadyEvent, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: StyleReadyEvent, listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: StyleReadyEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('whenStyleReady', () => {
  it('is the readiness gate wired into MapCanvas, not an unused helper', () => {
    const path = ['src/features/map/MapCanvas.tsx', 'apps/pwa/src/features/map/MapCanvas.tsx'].find(
      existsSync,
    );
    expect(path, 'could not read MapCanvas.tsx').toBeTruthy();
    const source = readFileSync(path!, 'utf8');

    expect(source).toContain("import { whenStyleReady } from './mapStyleReady.ts';");
    expect(source).toContain('stopWaitingForStyle = whenStyleReady(instance, initializeStyle);');
    expect(source).not.toMatch(/instance\.on\(['"]load['"],\s*initializeStyle\)/);
  });

  it('initialises once on the normal event path and removes every listener', () => {
    const style = new FakeStyle();
    const ready = vi.fn();
    const dispose = whenStyleReady(style, ready);

    expect(style.listenerCount()).toBe(4);
    style.loaded = true;
    style.emit('styledata');
    style.emit('load');

    expect(ready).toHaveBeenCalledTimes(1);
    expect(style.listenerCount()).toBe(0);
    dispose();
  });

  it('initialises by polling when a failed source prevents the load event', async () => {
    vi.useFakeTimers();
    const style = new FakeStyle();
    const ready = vi.fn();
    whenStyleReady(style, ready, { pollMs: 50, timeoutMs: 1_000 });

    style.loaded = true;
    await vi.advanceTimersByTimeAsync(50);

    expect(ready).toHaveBeenCalledTimes(1);
    expect(style.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing after disposal', async () => {
    vi.useFakeTimers();
    const style = new FakeStyle();
    const ready = vi.fn();
    const dispose = whenStyleReady(style, ready, { pollMs: 50, timeoutMs: 1_000 });

    dispose();
    style.loaded = true;
    style.emit('idle');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(ready).not.toHaveBeenCalled();
    expect(style.listenerCount()).toBe(0);
  });

  it('stops polling but still accepts a late readiness event', async () => {
    vi.useFakeTimers();
    const style = new FakeStyle();
    const ready = vi.fn();
    whenStyleReady(style, ready, { pollMs: 50, timeoutMs: 100 });

    await vi.advanceTimersByTimeAsync(100);

    expect(ready).not.toHaveBeenCalled();
    expect(style.listenerCount()).toBe(4);
    expect(vi.getTimerCount()).toBe(0);

    style.loaded = true;
    style.emit('idle');

    expect(ready).toHaveBeenCalledTimes(1);
    expect(style.listenerCount()).toBe(0);
  });
});
