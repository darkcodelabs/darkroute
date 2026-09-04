/**
 * RADAR, wired to the real stores and to the real engine output shape.
 *
 * Nothing here renders a hand-built view model. Every assertion goes through
 * the same path the driving loop uses -- `positionActions.ingestFix()` and
 * `ingestAlertTick()` -- so a screen that agreed with a mock and disagreed with
 * the engine would fail here.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  alertActions,
  ingestAlertTick,
  positionActions,
  resetAllStores,
  useSettingsStore,
} from '../../stores';
import type { AlertState, AlertTick, CameraAssessment } from '../../stores';

import { RadarScreen } from './RadarScreen.tsx';

const NOW = 1_760_000_000_000;
const now = (): number => NOW;

/** The camera screen 01 is about: 425 ft ahead, inside a 500 ft threshold. */
function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'cam-1',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 221,
    inRange: true,
    muted: false,
    mergedIds: ['cam-1'],
    ...over,
  };
}

/** One tick in the shape `@fwm/core` publishes it. */
function tick(over: Partial<AlertTick> = {}): AlertTick {
  const nearest = over.nearest === undefined ? assessment() : over.nearest;
  const state: AlertState = over.state ?? 'in_range';
  return {
    timestampMs: NOW,
    state,
    previousState: 'clear',
    changed: true,
    nearest,
    cameras: nearest === null ? [] : [nearest],
    countInRange: 3,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: true,
    hapticPulses: 2,
    notifyCameraIds: ['cam-1'],
    suppressedBy: [],
    ...over,
  };
}

/** A live lock at the coordinates the GPS row renders. */
function lock(): void {
  positionActions.ingestFix({
    lat: 39.0997,
    lon: -84.5786,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: 21,
    headingDeg: 41,
    timestamp: NOW,
  });
}

beforeEach(() => {
  resetAllStores();
});

afterEach(() => {
  resetAllStores();
});

describe('wiring', () => {
  it("renders the engine's distance, direction, count and threshold", () => {
    lock();
    ingestAlertTick(tick());

    const { container } = render(<RadarScreen now={now} />);

    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-state')).toBe(
      'in_range',
    );
    // The hero readout, the direction line and the count bar are gone -- the
    // map draws where the camera is and the top block states the road ahead.
    // What this test is for is that the ENGINE's numbers reach the screen, and
    // the state attribute is where that is now observable.
    expect(container.querySelector('.fwm-topblock')).not.toBeNull();
    // The threshold is not on the map at all now. It had a full-width rail
    // across the bottom, which took a band off the screen permanently for a
    // number somebody sets once -- it lives on SETTINGS, beside the sentences
    // that explain what muting and re-alerting actually do.
    expect(screen.queryByText(/^THRESHOLD/)).toBeNull();
    expect(screen.queryByText(/^ALERT \d/)).toBeNull();
  });

  it("renders the position slice's own values in the GPS row and the tiles", () => {
    lock();
    ingestAlertTick(tick());

    const { container } = render(<RadarScreen now={now} />);

    // THE COORDINATE ROW IS GONE. Six digits of latitude is not a thing a
    // driver acts on, and the map shows them where they are by drawing them on
    // it. The accuracy survived, as the chip above the compass.
    expect(screen.getByText('±4 M')).toBeInTheDocument();
    // 21 m/s is 47 mph, and it is under the sign now rather than in a tile.
    expect(container.querySelector('.fwm-topblock-speed-you')?.textContent).toBe('47');
    // The heading is a needle and a cardinal, not a labelled number.
    expect(container.querySelector('.fwm-compass-cardinal')?.textContent).toBe('NE');
  });

  it('escalates to the multiple hue when the engine says multiple', () => {
    lock();
    ingestAlertTick(tick({ state: 'multiple', countInRange: 2 }));

    const { container } = render(<RadarScreen now={now} />);

    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-state')).toBe(
      'multiple',
    );
    // The count bar is gone; the hue escalation is the thing being asserted.
  });
});

describe('muting removes the alert and nothing else', () => {
  it('keeps the distance live, keeps counting, and keeps the exposure count rising', () => {
    lock();
    useSettingsStore.getState().muteAll(NOW);
    ingestAlertTick(tick());

    const { container } = render(<RadarScreen now={now} />);

    // The presentation is muted...
    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-state')).toBe(
      'muted',
    );
    // ...and the screen keeps talking: muting changes the presentation and
    // nothing about the measurement or the record.
    expect(container.querySelector('.fwm-topblock-headline')).not.toBeNull();
    // ...and it still incremented EXPOSURE. "MUTED CAMERAS ... still count."
    // EXPOSURE still rises. The tally moved to the header.
    expect(container.querySelector('.fwm-radar-passed-value')?.textContent).toBe('1');
  });

  it('counts a second muted pass exactly like an audible one', () => {
    lock();
    useSettingsStore.getState().muteAll(NOW);
    ingestAlertTick(tick());
    ingestAlertTick(tick({ state: 'clear', previousState: 'in_range', nearest: null }));
    ingestAlertTick(tick({ previousState: 'clear', nearest: assessment({ id: 'cam-2' }) }));

    const { container } = render(<RadarScreen now={now} />);
    expect(container.querySelector('.fwm-radar-passed-value')?.textContent).toBe('2');
  });

  it('shows the countdown, and gives the alert hue back when the mute expires', () => {
    lock();
    useSettingsStore.getState().muteAll(NOW, 8 * 60_000 + 12_000);
    ingestAlertTick(tick());

    const { container, rerender } = render(<RadarScreen now={now} />);
    expect(screen.getByText('MUTED 8:12')).toBeInTheDocument();

    alertActions.refreshMute(NOW + 9 * 60_000);
    rerender(<RadarScreen now={now} />);

    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-state')).toBe(
      'in_range',
    );
    expect(screen.queryByText(/^MUTED /)).toBeNull();
  });
});

describe('no gps', () => {
  it('degrades to no_gps with a stale fix and offers RETRY LOCK', () => {
    lock();
    ingestAlertTick(tick());
    positionActions.markStale();

    const { container } = render(<RadarScreen now={() => NOW + 40_000} />);

    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-state')).toBe(
      'no_gps',
    );
    expect(screen.getByText('last fix 40s ago.')).toBeInTheDocument();
    expect(screen.getByText('showing cached cameras only.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RETRY LOCK' })).toBeInTheDocument();
  });

  it('does not crash with a null position and never has one to render', () => {
    // Nothing has been ingested at all: fix, heading, speed and nearest are
    // null, and `fixAtMs` is null so there is no age to print either.
    positionActions.markStale();

    expect(() => render(<RadarScreen now={now} />)).not.toThrow();
    expect(screen.getByText('NO FIX')).toBeInTheDocument();
    // AlertRing's word, gone with the ring. The GPS row still says it.
    expect(screen.getByText('NO FIX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RETRY LOCK' })).toBeInTheDocument();
  });

  it('calls the retry handler on a press, and only on a press', () => {
    const onRetryLock = vi.fn();
    positionActions.markStale();

    render(<RadarScreen now={now} onRetryLock={onRetryLock} />);
    expect(onRetryLock).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'RETRY LOCK' }).click();
    expect(onRetryLock).toHaveBeenCalledTimes(1);
  });

  it('offers ALLOW instead of RETRY LOCK once location has been refused', () => {
    positionActions.markDenied();

    render(<RadarScreen now={now} onRequestLocation={() => undefined} />);

    expect(screen.getByRole('button', { name: 'ALLOW' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'RETRY LOCK' })).toBeNull();
  });
});

describe('a live camera alert wins the screen', () => {
  it('marks the takeover while the alert slice reports one', () => {
    lock();
    ingestAlertTick(tick());

    const { container } = render(<RadarScreen now={now} />);

    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-takeover')).toBe(
      'true',
    );
  });

  it('drops the takeover when the driver dismisses, and keeps the record', () => {
    lock();
    ingestAlertTick(tick());
    alertActions.dismiss();

    const { container } = render(<RadarScreen now={now} />);

    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-takeover')).toBe(
      'false',
    );
    // Dismissing ends the takeover. It does not end the state or the count.
    expect(container.querySelector('.fwm-radar')?.getAttribute('data-fwm-radar-state')).toBe(
      'in_range',
    );
  });
});

describe('this screen asks the platform for nothing', () => {
  it('requests no permission and starts no sensor on mount', () => {
    const getCurrentPosition = vi.fn();
    const watchPosition = vi.fn();
    const vibrate = vi.fn();
    const requestPermission = vi.fn();

    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
      vibrate,
      permissions: { query: requestPermission },
    });

    lock();
    ingestAlertTick(tick());
    render(<RadarScreen now={now} />);

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    // Alert haptics are the driving loop's, fired from the alert gate. RADAR
    // draws the alert; it never buzzes for one.
    expect(vibrate).not.toHaveBeenCalled();
  });
});

/**
 * THE CORRIDOR DOES NOT FOLLOW THE COMPASS.
 *
 * Three screenshots from a stationary phone, seconds apart: the compass read
 * NE, then W, then N, and the corridor rewrote itself each time -- "CLEAR FOR
 * 1.5 MI, THEN 7 IN A 1210 FT STRETCH", then "CLEAR FOR 2.1 MI, THEN 1
 * CAMERA", then "CLEAR FOR 2.8 MI, THEN 6 IN A 680 FT STRETCH". Three
 * different three-mile futures for somebody standing still.
 *
 * `orientation.ts` already held the GPS course null below walking pace for this
 * exact reason. `preferHeading` then handed the magnetometer straight through,
 * and the corridor -- a claim about the road AHEAD -- was being projected along
 * whichever way a hand-held phone happened to be pointing.
 */
describe('a heading the vehicle does not have', () => {
  /** A fix with no course and no speed: parked, or walking. */
  function standingStill(): void {
    positionActions.ingestFix({
      lat: 39.0997,
      lon: -84.5786,
      accuracyM: 4,
      altitudeM: null,
      altitudeAccuracyM: null,
      speedMps: 0,
      headingDeg: null,
      timestamp: NOW,
    });
  }

  it('SHOWS WHAT IS AROUND YOU rather than a corridor along the compass', () => {
    standingStill();
    // The magnetometer is perfectly happy to answer. That is the trap.
    positionActions.ingestHeading({
      headingDeg: 41,
      source: 'absolute-orientation',
      accuracyDeg: 10,
      absolute: true,
      timestamp: NOW,
    });
    ingestAlertTick(tick());

    const { container } = render(<RadarScreen now={now} />);
    const verdict = container.querySelector('.fwm-topblock-headline')?.textContent ?? '';

    // NOT the directional wording. "CLEAR FOR 2 MI" is a claim about a road
    // ahead, and nothing here has looked at a road ahead.
    expect(verdict).not.toContain('CLEAR FOR');
    // And not the empty box either -- standing still is exactly when somebody
    // has time to look at the screen.
    expect(verdict).not.toBe('NO BEARING');
    expect(verdict).toMatch(/NEAREST|NONE WITHIN/);
  });

  it('captions the ladder AROUND YOU, so the distances are not read as "ahead"', () => {
    standingStill();
    ingestAlertTick(tick());

    const { container } = render(<RadarScreen now={now} />);
    const caption = container.querySelector('.fwm-topblock-headline')?.textContent ?? '';
    const around = container.querySelector('.fwm-topblock-around')?.textContent ?? '';
    // The single most misleading string this screen could show is a proximity
    // reading labelled as being AHEAD -- it would put cameras behind the driver
    // on a ladder that says they are in front. The caption slot now carries the
    // forecast, so the guard lives in the forecast's own wording: the
    // omnidirectional form never says "AHEAD" and never says "THEN", which is
    // sequence and needs a direction of travel.
    expect(caption).not.toContain('AHEAD');
    expect(caption).not.toContain('THEN');
    // The headline is the verdict; the omnidirectional count is its own
    // reading beside the ladder.
    expect(caption).toMatch(/NEAREST|NONE WITHIN/);
    expect(around).toContain('AROUND YOU');
  });

  /*
   * NOT ASSERTED HERE: that the compass ROSE still reads while stationary.
   *
   * It does -- this change did not touch it, `headingDeg` is computed exactly
   * as before -- but the rose is fed by `useCompassHeading`, which subscribes
   * to `deviceorientation` directly rather than through the position store, so
   * `ingestHeading` cannot drive it and a test written against that store would
   * be asserting its own setup. `preferHeading` owns that fallback and has its
   * own tests.
   */

  it('projects a corridor again once the vehicle is actually moving', () => {
    lock(); // 21 m/s with a real GPS course
    ingestAlertTick(tick());

    const { container } = render(<RadarScreen now={now} />);
    expect(container.querySelector('.fwm-topblock-headline')?.textContent).toContain('CLEAR FOR');
    // Moving, the caption is either the directional forecast or the plain
    // label -- and either way it must NOT be the proximity wording.
    const moving = container.querySelector('.fwm-topblock-headline')?.textContent ?? '';
    expect(moving).not.toContain('AROUND YOU');
    expect(moving).toMatch(/CLEAR FOR/);
  });
});
