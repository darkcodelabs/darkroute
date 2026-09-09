/**
 * The intel card hangs above the reader that opened it, and that only works if
 * the map answers "where is this coordinate on the screen" honestly and says so
 * again whenever the answer changes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  projectPoint,
  registerMap,
  resetScreenPointsForTests,
  subscribeScreenPoints,
} from './screenPoint.ts';

function fakeMap(input: {
  readonly project: (lngLat: [number, number]) => { x: number; y: number };
  readonly width?: number;
  readonly height?: number;
  readonly left?: number;
  readonly top?: number;
}) {
  const handlers = new Map<string, Set<() => void>>();
  return {
    handlers,
    project: input.project,
    getContainer: () => ({
      getBoundingClientRect: () => ({
        left: input.left ?? 0,
        top: input.top ?? 0,
        width: input.width ?? 390,
        height: input.height ?? 844,
      }),
    }),
    on: (event: string, fn: () => void) => {
      handlers.set(event, (handlers.get(event) ?? new Set()).add(fn));
    },
    off: (event: string, fn: () => void) => {
      handlers.get(event)?.delete(fn);
    },
  };
}

afterEach(() => {
  resetScreenPointsForTests();
});

describe('where a reader is on the screen', () => {
  it('answers null with no map registered, so a card draws nothing anchored', () => {
    expect(projectPoint({ lat: 38.93, lon: -94.67 })).toBeNull();
  });

  it('returns the pixel in viewport space, with the container offset added', () => {
    /* The card lives in a different absolutely-positioned box from the map,
       so a container-relative pixel would be wrong by the map's own offset. */
    const map = fakeMap({ project: () => ({ x: 100, y: 200 }), left: 10, top: 32 });
    registerMap(map as never);
    expect(projectPoint({ lat: 0, lon: 0 })).toEqual({ x: 110, y: 232 });
  });

  it('answers null for a reader panned off the map, rather than a pixel outside it', () => {
    const map = fakeMap({ project: () => ({ x: -5, y: 200 }) });
    registerMap(map as never);
    expect(projectPoint({ lat: 0, lon: 0 })).toBeNull();
  });

  it('tells subscribers on every event that can move a projected pixel', () => {
    const map = fakeMap({ project: () => ({ x: 1, y: 1 }) });
    registerMap(map as never);
    const seen = vi.fn();
    subscribeScreenPoints(seen);
    for (const event of ['move', 'zoom', 'rotate', 'pitch', 'resize']) {
      for (const fn of map.handlers.get(event) ?? []) fn();
    }
    expect(seen).toHaveBeenCalledTimes(5);
  });

  it('unwires the old map and tells subscribers when the map goes away', () => {
    const map = fakeMap({ project: () => ({ x: 1, y: 1 }) });
    registerMap(map as never);
    const seen = vi.fn();
    subscribeScreenPoints(seen);
    registerMap(null);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(map.handlers.get('move')?.size ?? 0).toBe(0);
    expect(projectPoint({ lat: 0, lon: 0 })).toBeNull();
  });

  it('stops telling a subscriber that unsubscribed', () => {
    const map = fakeMap({ project: () => ({ x: 1, y: 1 }) });
    registerMap(map as never);
    const seen = vi.fn();
    const stop = subscribeScreenPoints(seen);
    stop();
    for (const fn of map.handlers.get('move') ?? []) fn();
    expect(seen).not.toHaveBeenCalled();
  });
});
