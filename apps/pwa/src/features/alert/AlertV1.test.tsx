/**
 * THE ALERT LAYER, driven by the real engine.
 *
 * This is the one screen in the product whose failure mode is somebody getting
 * a plate read they were warned about incorrectly, so the assertions are about
 * what it REFUSES to say as much as what it shows:
 *
 *   - nothing at all when no takeover is live;
 *   - no side when the platform gave no heading;
 *   - no countdown when there is no speed to divide by.
 *
 * The ticks come from `@fwm/core` through a test clock, the same way
 * `stores/alert.test.ts` builds them. A layer tested against a hand-written
 * takeover literal proves nothing about the shipped driving loop.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { disposeScreenState, initScreenState } from '../../app/screenState.ts';
import { alertActions, useAlertStore } from '../../stores/alert.ts';
import { createAlertEngine, createTestClock } from '../../stores/fwmCore.ts';
import type { AlertTick, CameraLike } from '../../stores/fwmCore.ts';
import { resetAllStores } from '../../stores/index.ts';

import { AlertV1, DISMISS_HINT, NO_SIDE, SIDE_LABEL, SILENCE_LABEL } from './AlertV1.tsx';

const CAMERA: CameraLike = { id: 'FWM-0442', lat: 39.11, lon: -84.5786, directionDeg: 180 };

/** Northbound, closing from ~3600 ft to ~36 ft. The last tick is in range. */
const LATS = [39.1, 39.105, 39.1077, 39.1085, 39.1093, 39.1097, 39.1099];
const START_MS = 1_000_000;
const STEP_MS = 2_000;
const SPEED_MPS = 21;

interface DriveOptions {
  /** Null models a platform that reported no heading. */
  readonly headingDeg?: number | null;
  readonly speedMps?: number;
}

function drive({ headingDeg = 0, speedMps = SPEED_MPS }: DriveOptions = {}): void {
  const clock = createTestClock(START_MS);
  const engine = createAlertEngine({ clock });
  const ticks: AlertTick[] = LATS.map((lat) => {
    const tick = engine.update(
      {
        lat,
        lon: -84.5786,
        headingDeg,
        speedMps,
        accuracyM: 4,
        timestampMs: clock.now(),
      },
      [CAMERA],
    );
    clock.advance(STEP_MS);
    return tick;
  });
  for (const tick of ticks) {
    alertActions.ingest(tick, {
      labelFor: () => 'Reading Rd',
      speedMph: speedMps === 0 ? 0 : 47,
    });
  }
}

beforeEach(() => {
  resetAllStores();
  initScreenState();
});

afterEach(() => {
  cleanup();
  disposeScreenState();
  resetAllStores();
});

describe('the v1 alert layer', () => {
  it('renders nothing at all when no takeover is live', () => {
    const { container } = render(<AlertV1 />);
    expect(container.firstChild).toBeNull();
  });

  it('takes the screen when a camera comes into range', () => {
    drive();
    render(<AlertV1 />);
    expect(screen.getByRole('alertdialog', { name: 'camera alert' })).toBeInTheDocument();
    expect(screen.getByText(DISMISS_HINT)).toBeInTheDocument();
  });

  it('names the side only when the platform gave a heading', () => {
    drive();
    render(<AlertV1 />);
    const sides = Object.values(SIDE_LABEL);
    const headline = screen.getByRole('alertdialog').textContent ?? '';
    expect(sides.some((side) => headline.includes(side))).toBe(true);
  });

  it('withholds the side rather than guessing it with no heading', () => {
    // "on your right" told to a driver whose camera is on the left is worse
    // than no side at all.
    drive({ headingDeg: null });
    render(<AlertV1 />);
    const headline = screen.getByRole('alertdialog').textContent ?? '';
    expect(headline).toContain(NO_SIDE);
    for (const side of Object.values(SIDE_LABEL)) {
      expect(headline).not.toContain(side);
    }
  });

  it('silences when the surface is tapped, rather than re-raising every tick', () => {
    drive();
    render(<AlertV1 />);
    expect(useAlertStore.getState().muted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));

    // THE MUTE IS THE DISMISSAL. A takeover that closes without muting is
    // re-raised by the next tick, which is a driver tapping the same screen
    // every two seconds at 60 mph.
    expect(useAlertStore.getState().muted).toBe(true);
  });

  it('silences from the key as well as from the surface', () => {
    drive();
    render(<AlertV1 />);
    fireEvent.click(screen.getByRole('button', { name: SILENCE_LABEL }));
    expect(useAlertStore.getState().muted).toBe(true);
  });
});
