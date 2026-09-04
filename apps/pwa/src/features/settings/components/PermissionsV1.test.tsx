/**
 * THE MOTION ROW THAT WOULD NOT HOLD A VALUE.
 *
 * Reported from an Android phone: the Motion sensors row read GRANTED on one
 * load and OPTIONAL on the next, with nothing changed in between. Permissions
 * are re-read from the OS every launch and are absent from the settings store's
 * `partialize`, so nothing was being persisted wrongly - the row was drawing a
 * word for a permission the app had not read yet, and how long that lasted
 * varied from launch to launch.
 *
 * Two things caused it and both are asserted here:
 *
 *   1. `readPermissions` published one map after `Promise.all` over all fifteen
 *      adapters, so motion's synchronous answer waited on
 *      `navigator.permissions.query('clipboard-write')`. Measured on a real
 *      build at 6x CPU throttle: motion answered at +8 ms and reached the store
 *      at +267 ms warm, +791 ms cold.
 *   2. `statusWordFor` folded `unknown` in with `prompt`, so for that whole
 *      window the row asserted OPTIONAL - a platform's word for a state no
 *      platform had reported.
 *
 * The test that would have caught it is the third one: with a stalled adapter
 * in the set, the row must reach GRANTED anyway, and must never have said
 * OPTIONAL on the way there.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PermissionOutcome } from '../../../services/adapters';
import {
  createMockAdapters,
  type MockAdapterSet,
} from '../../../services/adapters/testing/mocks.ts';
import { capabilitiesActions } from '../../../stores/index.ts';

import { PermissionsV1 } from './PermissionsV1.tsx';

const MOTION_ROW = 'settingsv1-permission-motion';
const NOW = (): number => 1_700_000_000_000;

afterEach(() => {
  // A module singleton. A leaked permission map makes the next test lie about
  // what the screen read on mount, which is the only thing these tests measure.
  capabilitiesActions.reset();
});

/** Every mock answers instantly; this one never answers until it is released. */
function stall(adapters: MockAdapterSet): () => void {
  let release = (): void => {};
  const stalled = new Promise<PermissionOutcome>((resolve) => {
    release = () => {
      resolve('prompt');
    };
  });
  adapters.clipboard.permission = () => stalled;
  return release;
}

function word(): string | null {
  return screen.getByTestId(MOTION_ROW).getAttribute('data-fwm-state');
}

describe('the motion row', () => {
  it('reads GRANTED on a phone that has granted it', async () => {
    const adapters = createMockAdapters();
    adapters.motion.mock.setPermission('granted');

    await act(async () => {
      render(<PermissionsV1 adapters={adapters} now={NOW} />);
    });

    expect(word()).toBe('GRANTED');
  });

  it('says CHECKING, not OPTIONAL, before the read has landed', () => {
    const adapters = createMockAdapters();
    adapters.motion.mock.setPermission('granted');

    // Rendered WITHOUT flushing effects: this is the first paint, the frame the
    // driver sees before any adapter has answered. OPTIONAL here would be the
    // screen inventing a platform answer.
    render(<PermissionsV1 adapters={adapters} now={NOW} />);

    expect(word()).toBe('CHECKING');
    // Still tappable: a row whose read has not come back may well have a prompt
    // behind it. See `isRequestable`.
    expect(screen.getByTestId(MOTION_ROW)).not.toBeDisabled();
  });
});

describe('what the row must never do', () => {
  it('does not wait for an adapter it does not draw', async () => {
    const adapters = createMockAdapters();
    adapters.motion.mock.setPermission('granted');
    // The clipboard has no row on this screen. It used to be able to hold the
    // motion row on the wrong word anyway.
    const release = stall(adapters);

    // `render` flushes effects synchronously, so this is the paint after mount
    // and before any promise has settled - the frame the driver actually sees.
    const seen: (string | null)[] = [];
    render(<PermissionsV1 adapters={adapters} now={NOW} />);
    seen.push(word());

    // One turn of the microtask queue: all a synchronous adapter needs, and
    // nowhere near enough for the stalled one, which never answers at all.
    await act(async () => {
      await Promise.resolve();
    });
    seen.push(word());

    expect(word()).toBe('GRANTED');
    // The wrong word never appeared, at any point, on the way to the right one.
    expect(seen).not.toContain('OPTIONAL');

    release();
  });
});

describe('the words that are not guesses', () => {
  it('reads OPTIONAL only when the platform actually says prompt', async () => {
    const adapters = createMockAdapters();
    adapters.motion.mock.setPermission('prompt');

    await act(async () => {
      render(<PermissionsV1 adapters={adapters} now={NOW} />);
    });

    // iOS: DeviceMotionEvent.requestPermission exists and has not been called,
    // so there IS something behind the row, and the design's word for a
    // convenience the product can live without is OPTIONAL.
    expect(word()).toBe('OPTIONAL');
    expect(screen.getByTestId(MOTION_ROW)).not.toBeDisabled();
  });
});

describe('a phone with no motion hardware', () => {
  it('reads UNAVAILABLE without waiting for a permission read', () => {
    const adapters = createMockAdapters();
    adapters.motion.mock.setCapability({
      supported: false,
      reason: 'DeviceMotionEvent is not available in this browser',
    });

    // No effects flushed, so no permission has been read - but `probe()` is
    // synchronous and settles this one on its own. "This phone does not have
    // the hardware" is a fact rather than a guess, so it outranks CHECKING.
    render(<PermissionsV1 adapters={adapters} now={NOW} />);

    expect(word()).toBe('UNAVAILABLE');
  });
});
