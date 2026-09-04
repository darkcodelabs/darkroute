/**
 * "ROUTE AROUND ALL N" - what the key on DRIVE actually does now.
 *
 * =============================================================================
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED
 * =============================================================================
 * The key called `navigateTo` with the NEAREST CAMERA's own position. Pressed,
 * it opened the phone's maps app with turn-by-turn directions to the thing the
 * label promised to route around - the exact failure `features/radar/reroute.
 * ts` warns about in prose, shipped on the biggest key on the driving screen.
 *
 * So the load-bearing assertions here are:
 *
 *   - the press plans a real detour and raises the offer, and
 *   - the press sends NOTHING, on any platform, until somebody says yes.
 *
 * Everything is driven through the shipped chain - records into the cameras
 * store, `createAlertLoop` over a real fix, `packages/core` doing the measuring
 * - rather than through a hand-built view model, so a screen that agreed with a
 * mock and disagreed with the engine would fail here. Same fixture shape as
 * `DriveScreen.ownerFilter.test.tsx`, which this file sits beside.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getScreenState, initScreenState, topOverlay } from '../../app/screenState.ts';
import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore, positionActions } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { createAlertLoop } from '../../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../../services/alerts/engineLoop.ts';
import type { CameraRecord } from '../../services/db/schema.ts';

import { DETOUR_OVERLAY, DETOUR_SEND, DetourOffer, pendingDetour } from './DetourOffer.tsx';
import { DRIVE_CARD_EXPAND, DriveScreen } from './DriveScreen.tsx';

const started: AlertLoop[] = [];
function loopUnderTest(): AlertLoop {
  const loop = createAlertLoop();
  started.push(loop);
  return loop;
}

/** A fix in Kansas City, moving north fast enough for a confident heading. */
const FIX = {
  lat: 38.9181,
  lon: -94.6923,
  headingDeg: 0,
  speedMps: 21,
  accuracyM: 8,
  timestampMs: 1_700_000_000_000,
};

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari';

/**
 * A camera `metres` north of the fix and `sideM` east of the road.
 *
 * OFF TO ONE SIDE, deliberately. A camera exactly on the centreline is the
 * `unavoidable` case, and a fixture made entirely of those would test the
 * refusal rather than the route.
 */
function cameraAhead(metres: number, sideM: number, id: string): CameraRecord {
  return {
    id,
    lat: FIX.lat + metres / 111_320,
    lon: FIX.lon + sideM / (111_320 * Math.cos((FIX.lat * Math.PI) / 180)),
    directionDeg: 180,
    confirmations: 1,
  };
}

/**
 * Three readers up the road, the nearest of them OUTSIDE the alert radius.
 *
 * 300 m is about 984 ft against a 500 ft default threshold. That matters for
 * more than tidiness: a live camera alert outranks every overlay in the
 * presentation ladder (`app/screenState.ts`), so a fixture with a reader in
 * range would record the offer and then correctly refuse to present it - and
 * these tests would be asserting about the alert layer instead of the prompt.
 */
const AHEAD: readonly CameraRecord[] = [
  cameraAhead(300, 60, 'osm:a'),
  cameraAhead(700, 80, 'osm:b'),
  cameraAhead(1400, 70, 'osm:c'),
];

function drive(): AlertLoop {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras: AHEAD,
      fetchedAtMs: FIX.timestampMs,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
  positionActions.ingestFix({
    lat: FIX.lat,
    lon: FIX.lon,
    accuracyM: FIX.accuracyM,
    altitudeM: null,
    altitudeAccuracyM: null,
    headingDeg: FIX.headingDeg,
    speedMps: FIX.speedMps,
    timestamp: FIX.timestampMs,
  });
  const loop = loopUnderTest();
  loop.tick(FIX);
  return loop;
}

/**
 * Open the closest card, because it now OPENS COLLAPSED.
 *
 * `cardMini` defaults to `true` by owner decision, and the collapsed card
 * deliberately drops the keys, the queue and the MAP DRAWS row - it keeps the
 * distance and the owner and nothing else. Those controls are `hidden`, so
 * `getByRole` cannot see them, which is correct: a hidden control is not
 * available to a user either.
 *
 * Every test below is ABOUT one of those controls, so opening the card is a
 * precondition rather than part of what is under test. Written once here so
 * the eleven that need it cannot drift apart, and named so a future reader
 * knows the default is collapsed without having to find the `useState`.
 */
function expandCard(): void {
  /*
   * TOLERANT OF THERE BEING NO CARD, which is a real state and not a mistake:
   * several tests in this file are about the map control panel or the rail key
   * and run with nothing in range, so no closest card is drawn and there is
   * nothing to expand. `queryByRole` rather than `getByRole` so those tests do
   * not fail on a precondition they have no interest in - and this stays a
   * precondition helper rather than quietly becoming an assertion that a card
   * exists. The tests that need the card assert on its contents directly.
   */
  const key = screen.queryByRole('button', { name: DRIVE_CARD_EXPAND });
  if (key !== null) fireEvent.click(key);
}

/** The primary key on the closest card, whatever number it is counting. */
function routeKey(): HTMLElement {
  return screen.getByRole('button', { name: /^Route around all/ });
}

/**
 * Every URL anything managed to open. Empty is the passing state.
 *
 * SPIED AT `window.open`, NOT AT AN ADAPTER. Stubbing `browserOpener` catches
 * `routeVia`, which imports it across a module boundary - and misses
 * `navigateTo`, which calls it from inside its own module. That was not a
 * theoretical gap: with the old handler restored to check these tests fail
 * against it, "nothing was opened" still passed while the maps app was in fact
 * being opened at the nearest camera. The browser's own door is the only place
 * this claim can be made about every caller at once.
 */
let opened: string[];

beforeEach(() => {
  opened = [];
  initScreenState({ initialScreen: 'radar' });
  vi.spyOn(globalThis.window, 'open').mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
});

afterEach(() => {
  while (started.length > 0) started.pop()?.stop();
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
  useSettingsStore.getState().reset();
  vi.restoreAllMocks();
});

describe('the DRIVE route-around key', () => {
  it('opens nothing when pressed - it asks first', () => {
    // THE REGRESSION. This used to open the maps app immediately, at the
    // nearest camera. Nothing may leave the device on this press.
    drive();
    render(<DriveScreen />);
    expandCard();

    fireEvent.click(routeKey());

    expect(opened).toEqual([]);
    expect(topOverlay(getScreenState())?.id).toBe(DETOUR_OVERLAY.id);
  });

  it('plans a real multi-stop detour off the cameras the label counted', () => {
    drive();
    render(<DriveScreen />);
    expandCard();
    // The fixture is only meaningful if the key is about all three readers.
    expect(routeKey()).toHaveTextContent('Route around all 3');

    fireEvent.click(routeKey());

    const offer = pendingDetour();
    expect(offer?.kind).toBe('route');
    if (offer?.kind !== 'route') throw new Error('expected a planned route');
    // Stops, plural or not, but real ones - and every camera the key named was
    // handed to the planner rather than a subset of them.
    expect(offer.plan.waypoints.length).toBeGreaterThan(0);
    expect(offer.plan.consideredCameras).toBe(3);
    // West of the road: the cameras in the fixture are all to the east.
    for (const stop of offer.plan.waypoints) expect(stop.lon).toBeLessThan(FIX.lon);
  });

  it('sends the whole route, and only after the driver says yes', () => {
    drive();
    render(
      <>
        <DriveScreen />
        <DetourOffer />
      </>,
    );
    expandCard();

    fireEvent.click(routeKey());
    expect(opened).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));

    expect(opened).toHaveLength(1);
    const query = new URL(opened[0] ?? '').searchParams;
    expect(query.get('waypoints')).not.toBeNull();
    expect(query.get('origin')).toBeNull();
  });

  it('says why rather than opening an empty route when there is no fix', () => {
    // No `drive()`: cameras and position stores are empty, so there is nothing
    // to plan from. The key is only drawn beside a camera, so this drives the
    // refusal through the planner rather than through the screen.
    drive();
    act(() => {
      usePositionStore.getState().reset();
    });
    render(<DriveScreen />);
    expandCard();

    fireEvent.click(routeKey());

    expect(pendingDetour()).toMatchObject({ kind: 'none', reason: 'no-fix' });
    expect(opened).toEqual([]);
  });
});

/**
 * THE REVERSAL: THE ROUTE KEY IS NO LONGER WITHHELD ON iOS.
 *
 * `DriveScreen.ownerFilter.test.tsx` carried a case called "offers no route key
 * on an iPhone", asserting that the primary key was absent under an iPhone user
 * agent. It was right about the code it was written against: the key called
 * `navigateTo`, iOS does not register `geo:`, and the only fallback would have
 * been an HTTPS request the driver was never told about. Hiding the key was the
 * honest option, and `canUseGeoHandoff` is still exactly that guard for the
 * INTEL card, which still hands over a single `geo:` point.
 *
 * It is the wrong assertion for this key now. The detour handoff is an HTTPS
 * directions URL on EVERY platform - no scheme carries waypoints - and it is
 * announced on every platform before it is made. A platform check would no
 * longer be protecting an iPhone driver from an unannounced request; it would
 * only be withholding the feature from one who had already been asked and had
 * already said yes.
 */
describe('the route key on an iPhone', () => {
  it('is drawn, and still sends nothing until the prompt is answered', () => {
    vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    drive();
    render(<DriveScreen />);
    expandCard();

    // The rest of the live closest card is unchanged.
    expect(screen.getByRole('button', { name: 'Mute 10m' })).toBeInTheDocument();
    expect(routeKey()).toBeInTheDocument();

    fireEvent.click(routeKey());

    expect(opened).toEqual([]);
    expect(topOverlay(getScreenState())?.id).toBe(DETOUR_OVERLAY.id);
  });
});
