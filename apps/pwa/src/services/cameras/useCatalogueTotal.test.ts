/**
 * THE COUNT ARRIVES, AND THE SCREEN IS TOLD.
 *
 * `catalogue.total()` is a getter over a value that loads asynchronously.
 * Calling it during render is correct and useless on its own: the first render
 * reads `null`, the read lands a moment later, and nothing schedules another
 * render — so the screen draws the absence forever.
 *
 * DRIVE's header did that. It showed the lone figure "1k" on every cold start
 * and only became the pair "1k / 140k" if something unrelated re-rendered it,
 * which on the first-run path is nothing. A bare number is the exact ambiguity
 * `catalogue.ts` was written to prevent: it could mean the network knows about
 * 987 cameras, or that this phone holds 987 of a much larger set.
 *
 * These tests are about the SUBSCRIPTION, not the number. The number was never
 * wrong; nobody was ever told it had arrived.
 */

import { describe, expect, it, vi } from 'vitest';

import { createCatalogue } from './catalogue.ts';

/**
 * The generation the device is working against.
 *
 * Injected, because without one `prepare()` returns null and the catalogue
 * never loads at all - correct behaviour, and it makes a test that omits it
 * assert nothing.
 *
 * Sixty-four hex characters because `CAMERA_GENERATION_PATTERN` requires that
 * shape, and the identity is read from the RESPONSE HEADER rather than the
 * body - a mock that only fills in the JSON gets rejected before the count is
 * ever looked at.
 */
const GENERATION = 'a'.repeat(64);

/** A fetch that resolves a generation index when asked, and can be delayed. */
function indexFetch(cameras: number) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('index.json')) {
      return new Response(
        JSON.stringify({
          zoom: 11,
          cameras,
          tiles: 10,
          upstream: '2026-09-01T18:00:00Z',
          generatedAt: '2026-09-01T18:26:43.396Z',
          source: 'test',
          attribution: 'Map data © OpenStreetMap contributors',
          licence: 'ODbL-1.0',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-darkroute-camera-generation': GENERATION,
          },
        },
      );
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('being told when the published count lands', () => {
  it('hands out an unsubscribe that actually unsubscribes', () => {
    const catalogue = createCatalogue({ fetchImpl: indexFetch(140_000), workingGeneration: () => GENERATION });
    const listener = vi.fn();

    const off = catalogue.subscribe(listener);
    expect(typeof off).toBe('function');
    off();

    // The contract `useSyncExternalStore` relies on. A subscribe that cannot be
    // undone leaks a listener per mount, and this hook mounts on every screen.
    expect(() => {
      off();
    }).not.toThrow();
  });

  it('notifies a subscriber once the read has landed', async () => {
    const catalogue = createCatalogue({ fetchImpl: indexFetch(140_000), workingGeneration: () => GENERATION });
    const listener = vi.fn();
    catalogue.subscribe(listener);

    // The first read is what kicks the load off, and it is correctly null:
    // nothing has arrived yet. This is the render that used to be the last one.
    expect(catalogue.total()).toBeNull();

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });
    expect(catalogue.total()).toBe(140_000);
  });

  it('notifies even when the read FAILS, so "still unknown" is distinguishable', async () => {
    // "We have not tried" and "we tried and there is no number" are different
    // states, and a caller can only tell them apart if it is told about the
    // second. The count stays null either way; the notification is the signal.
    const catalogue = createCatalogue({
      fetchImpl: vi.fn(async () => new Response('nope', { status: 500 })),
      workingGeneration: () => GENERATION,
    });
    const listener = vi.fn();
    catalogue.subscribe(listener);

    expect(catalogue.total()).toBeNull();

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });
    expect(catalogue.total()).toBeNull();
  });

  it('stops calling a listener that has unsubscribed', async () => {
    const catalogue = createCatalogue({ fetchImpl: indexFetch(140_000), workingGeneration: () => GENERATION });
    const listener = vi.fn();
    const off = catalogue.subscribe(listener);
    off();

    catalogue.total();
    await vi.waitFor(() => {
      expect(catalogue.total()).toBe(140_000);
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
