/**
 * THE ALERT LAYER, driven by the real engine.
 *
 * This is the one screen in the product whose failure mode is somebody getting
 * a plate read they were warned about incorrectly, so the assertions are about
 * what it REFUSES to say as much as what it shows:
 *
 *   - nothing at all when no takeover is live;
 *   - no side when the platform gave no heading;
 *   - no countdown when there is no speed to divide by, and none once the
 *     camera is behind and the gap is opening again;
 *   - no street, no operator and NEITHER panel for a camera whose record has
 *     left the cache - and still a warning.
 *
 * ...and about what a driver can still reach: the two keys are outside the
 * card's scroll, and both of them silence, because dismissing IS silencing.
 *
 * The ticks come from `@fwm/core` through a test clock, the same way
 * `stores/alert.test.ts` builds them. A layer tested against a hand-written
 * takeover literal proves nothing about the shipped driving loop.
 *
 * =============================================================================
 * WHY EVERY MOUNT IS AWAITED
 * =============================================================================
 * The card draws `MiniMap` through `React.lazy`, so the first render is the
 * Suspense fallback and the real figure arrives a microtask later. Rendering
 * without waiting leaves a state update landing after the test has finished,
 * which is the shape of a flake. `getContext` is stubbed to null for the same
 * reason `IntelViewV1.minimap.test.tsx` stubs it: jsdom has no WebGL, and the
 * map's own "no context" path is a stated condition of these tests rather than
 * noise in the log.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { disposeScreenState, initScreenState } from '../../app/screenState.ts';
import { alertActions, useAlertStore } from '../../stores/alert.ts';
import { camerasActions } from '../../stores/cameras.ts';
import type { TileEntry } from '../../stores/cameras.ts';
import { positionActions } from '../../stores/position.ts';
import { createAlertEngine, createTestClock } from '../../stores/fwmCore.ts';
import type { AlertTick, CameraLike } from '../../stores/fwmCore.ts';
import { resetAllStores } from '../../stores/index.ts';
import { closeDetourOffer, pendingDetour } from '../drive/DetourOffer.tsx';

import {
  AlertV1,
  COMMUNITY_TITLE,
  DETAILS_TITLE,
  DISMISS_HINT,
  KIND_FALLBACK,
  NO_SIDE,
  REROUTE_LABEL,
  SIDE_LABEL,
  SILENCE_LABEL,
  VIEW_ON_MAP,
} from './AlertV1.tsx';

const CAMERA: CameraLike = { id: 'FWM-0442', lat: 39.11, lon: -84.5786, directionDeg: 180 };

/** Northbound, closing from ~3600 ft to ~36 ft. The last tick is in range. */
const LATS = [39.1, 39.105, 39.1077, 39.1085, 39.1093, 39.1097, 39.1099];

/**
 * Past the camera and pulling away: ~180 ft, still inside the 500 ft threshold
 * so the takeover stays up, and more than CLOSING_EPSILON_FT further off than
 * the tick before it so the engine reports the gap as no longer closing.
 */
const PAST_LAT = 39.1095;
const START_MS = 1_000_000;
const STEP_MS = 2_000;
const SPEED_MPS = 21;

interface DriveOptions {
  /** Null models a platform that reported no heading. */
  readonly headingDeg?: number | null;
  readonly speedMps?: number;
  /** Drive one leg PAST the camera, which is the only way to get a real
   *  `isClosing: false` out of the engine rather than asserting on a literal. */
  readonly past?: boolean;
}

function drive({ headingDeg = 0, speedMps = SPEED_MPS, past = false }: DriveOptions = {}): void {
  const clock = createTestClock(START_MS);
  const engine = createAlertEngine({ clock });
  const path = past ? [...LATS, PAST_LAT] : LATS;
  const ticks: AlertTick[] = path.map((lat) => {
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

/**
 * The archive's copy of the same camera.
 *
 * Separate from the engine's `CameraLike` on purpose: the engine measures
 * positions and the cache holds records, and the whole "a takeover can outlive
 * its record" behaviour is the two of them coming apart.
 */
function tile(): TileEntry {
  return {
    ref: { z: 14, x: 4_314, y: 6_320 },
    cameras: [
      {
        id: CAMERA.id,
        lat: CAMERA.lat,
        lon: CAMERA.lon,
        directionDeg: 180,
        ownerType: 'unverified',
        confirmations: 28,
        street: 'W 87TH STREET PKWY',
        cross: 'W 87TH ST',
        tags: { manufacturer: 'Flock Safety', 'camera:mount': 'traffic_signals' },
      },
    ],
    fetchedAtMs: START_MS,
    freshness: 'fresh',
    source: 'network',
  };
}

/** A fix the detour planner can route off: a position and a real course. */
function lock(): void {
  positionActions.ingestFix({
    lat: 39.0997,
    lon: -84.5786,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: SPEED_MPS,
    headingDeg: 0,
    timestamp: START_MS,
  });
}

/** Render, and wait for the lazy picture rather than leaving it in flight. */
async function mount(): Promise<HTMLElement> {
  render(<AlertV1 />);
  await screen.findByRole('img');
  return screen.getByRole('alertdialog');
}

function textOf(): string {
  return screen.getByRole('alertdialog').textContent ?? '';
}

beforeEach(() => {
  resetAllStores();
  initScreenState();
  // No WebGL in jsdom. The map takes its own "bare" path, which is the same
  // one a driver in a dead zone gets.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  // Module state, so it outlives `cleanup()` and would leak a planned route
  // into whichever test ran next.
  closeDetourOffer();
  disposeScreenState();
  resetAllStores();
});

describe('the v1 alert layer', () => {
  it('renders nothing at all when no takeover is live', () => {
    const { container } = render(<AlertV1 />);
    expect(container.firstChild).toBeNull();
  });

  it('takes the screen when a camera comes into range', async () => {
    drive();
    await mount();
    expect(screen.getByRole('alertdialog', { name: 'camera alert' })).toBeInTheDocument();
    expect(screen.getByText(DISMISS_HINT)).toBeInTheDocument();
  });

  it('names the side only when the platform gave a heading', async () => {
    drive();
    await mount();
    const sides = Object.values(SIDE_LABEL);
    expect(sides.some((side) => textOf().includes(side))).toBe(true);
  });

  it('withholds the side rather than guessing it with no heading', async () => {
    // "on your right" told to a driver whose camera is on the left is worse
    // than no side at all.
    drive({ headingDeg: null });
    await mount();
    expect(textOf()).toContain(NO_SIDE);
    for (const side of Object.values(SIDE_LABEL)) {
      expect(textOf()).not.toContain(side);
    }
  });

  it('silences when the surface around the card is tapped', async () => {
    drive();
    await mount();
    expect(useAlertStore.getState().muted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));

    // THE MUTE IS THE DISMISSAL. A takeover that closes without muting is
    // re-raised by the next tick, which is a driver tapping the same screen
    // every two seconds at 60 mph.
    expect(useAlertStore.getState().muted).toBe(true);
  });

  it('silences from the key as well as from the surface', async () => {
    drive();
    await mount();
    fireEvent.click(screen.getByRole('button', { name: SILENCE_LABEL }));
    expect(useAlertStore.getState().muted).toBe(true);
  });
});

describe('a takeover whose camera has left the cache', () => {
  it('still warns, and prints no street it cannot name', async () => {
    drive();
    const dialog = await mount();

    // The warning is intact: the figure, the side and both keys.
    expect(dialog.querySelector('.fwm-alertv1-figure')?.textContent).toMatch(/^\d/);
    expect(screen.getByRole('button', { name: SILENCE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REROUTE_LABEL })).toBeInTheDocument();

    // ...and nothing invented in its place. No street line at all rather than a
    // phrase about a road nobody named, in the largest text on the screen.
    expect(dialog.querySelector('.fwm-alertv1-where')).toBeNull();
    expect(dialog.querySelector('.fwm-alertv1-operator')).toBeNull();
    expect(screen.queryByText(DETAILS_TITLE)).not.toBeInTheDocument();
    // COMMUNITY INFO too. Two of its rows need no record - this device's read
    // count and the number of cameras being measured - so it is the panel that
    // can outlive one, titled as though it knew whose community it meant.
    expect(screen.queryByText(COMMUNITY_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText(VIEW_ON_MAP)).not.toBeInTheDocument();
  });

  it('calls it a camera rather than naming hardware nobody recorded', async () => {
    drive();
    const dialog = await mount();
    expect(dialog.querySelector('.fwm-alertv1-kind-label')?.textContent).toBe(KIND_FALLBACK);
  });
});

describe('a takeover whose camera is still cached', () => {
  it('names the corner rather than the road alone', async () => {
    camerasActions.putTile(tile());
    drive();
    await mount();
    // "on METCALF AVE" is a four-mile road; "at W 87TH ST" is a place.
    expect(screen.getByText('W 87TH STREET PKWY at W 87TH ST')).toBeInTheDocument();
  });

  it('names the maker when nobody has confirmed an agency', async () => {
    // `chipLabel`'s ruling: "FLOCK SAFETY" is a better answer to "what is that"
    // than "UNVERIFIED", which only tells a driver the app is unsure - and the
    // border hue already says that.
    camerasActions.putTile(tile());
    drive();
    const dialog = await mount();
    expect(dialog.querySelector('.fwm-alertv1-operator')?.textContent).toBe('FLOCK SAFETY');
  });

  it('draws both disclosure panels, closed, with the facts the record carries', async () => {
    camerasActions.putTile(tile());
    drive();
    const dialog = await mount();

    expect(screen.getByText(DETAILS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(COMMUNITY_TITLE)).toBeInTheDocument();
    // Closed on arrival: they are the tallest and least urgent thing in the
    // card, and a driver has not asked for them.
    for (const panel of dialog.querySelectorAll('details')) {
      expect(panel.open).toBe(false);
    }
    expect(screen.getByText('28 hakcers')).toBeInTheDocument();
  });

  it('reads the mount as a sentence rather than as a raw OSM tag', async () => {
    camerasActions.putTile(tile());
    drive();
    await mount();
    // `traffic_signals` shouted verbatim is the bug this reuses `mountPhrase`
    // to avoid.
    expect(textOf()).toContain('On traffic signals');
    expect(textOf()).not.toContain('traffic_signals');
  });
});

describe('the countdown', () => {
  it('is withheld when there is no speed to divide by', async () => {
    // No fix has been ingested, so the position store has no speed. A guessed
    // countdown is worse than none.
    drive();
    const dialog = await mount();
    expect(dialog.querySelector('.fwm-alertv1-quiet')?.textContent ?? '').not.toContain('~');
  });

  it('is stated once the platform has given a speed and the gap is closing', async () => {
    lock();
    drive();
    const dialog = await mount();
    expect(dialog.querySelector('.fwm-alertv1-quiet')?.textContent ?? '').toContain('~');
  });

  it('is withheld once the camera is behind and the gap is opening again', async () => {
    // Speed and distance are both known here, so the countdown would divide
    // cleanly - and count down to an arrival that is never going to happen. The
    // driver is past the reader. `etaSeconds` withholds on a gap the engine says
    // is opening, and this is the surface proving it does.
    // The record is cached here on purpose: it carries the lane clause, so the
    // quiet line still has something to draw and "no countdown" is a visible
    // absence inside a rendered line rather than an absent line proving nothing.
    camerasActions.putTile(tile());
    lock();
    drive({ past: true });
    const dialog = await mount();

    // Pin the precondition, so this cannot pass for the wrong reason: the
    // engine really has decided the gap is opening, and there is really a speed
    // to divide by. Without both, "no countdown" would prove nothing.
    expect(useAlertStore.getState().isClosing).toBe(false);

    const quiet = dialog.querySelector('.fwm-alertv1-quiet')?.textContent ?? '';
    expect(quiet).not.toContain('~');
    // The line itself is still drawn - it is the countdown that is withheld,
    // not the lane the camera covers.
    expect(quiet).not.toBe('');
    // ...and the takeover is still up, still warning. Withholding the countdown
    // is not dismissing the camera.
    expect(screen.getByRole('button', { name: SILENCE_LABEL })).toBeInTheDocument();
  });
});

describe('the reroute key', () => {
  it('silences before it asks, because the takeover covers every overlay', async () => {
    lock();
    drive();
    await mount();

    fireEvent.click(screen.getByRole('button', { name: REROUTE_LABEL }));

    expect(useAlertStore.getState().muted).toBe(true);
    // It always raises something - a plan or a stated reason. A key that looked
    // pressable and quietly did nothing is the failure this replaced.
    expect(pendingDetour()).not.toBeNull();
  });
});

describe('the dismiss swipe', () => {
  it('silences on a downward swipe over the surface', async () => {
    drive();
    const dialog = await mount();

    fireEvent.touchStart(dialog, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 400 }] });

    expect(useAlertStore.getState().muted).toBe(true);
  });

  it('ignores a drag that starts in the scrolling half of the card', async () => {
    drive();
    const dialog = await mount();
    const body = dialog.querySelector('.fwm-alertv1-more');
    expect(body).not.toBeNull();

    fireEvent.touchStart(body as Element, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(body as Element, { changedTouches: [{ clientY: 400 }] });

    // That is a scroll. Closing the warning every time somebody read past the
    // fold would make the rest of the card unreachable.
    expect(useAlertStore.getState().muted).toBe(false);
  });

  it('ignores an upward drag', async () => {
    drive();
    const dialog = await mount();

    fireEvent.touchStart(dialog, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientY: 100 }] });

    expect(useAlertStore.getState().muted).toBe(false);
  });
});
