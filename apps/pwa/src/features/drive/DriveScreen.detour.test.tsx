/**
 * "AROUND N" - what the detour key on the dock actually does.
 *
 * =============================================================================
 * THE DEFECT THIS FILE EXISTS TO KEEP FIXED
 * =============================================================================
 * DRIVE's `Route around all N` key called `navigateTo` with the NEAREST
 * CAMERA's own position. Pressed, it opened the phone's maps app with
 * turn-by-turn directions to the thing the label promised to route around -
 * the exact failure `features/radar/reroute.ts` warns about in prose, shipped
 * on the biggest key on the driving screen.
 *
 * So the load-bearing assertions here are:
 *
 *   - the press plans a real detour and raises the offer, and
 *   - the press sends NOTHING, on any platform, until somebody says yes.
 *
 * =============================================================================
 * THE KEY MOVED. THE BEHAVIOUR DID NOT, AND NEITHER DID THESE CASES
 * =============================================================================
 * These five were skipped for one release. `Dock.dc.html` specifies nineteen
 * states and none of them had a route-around key, so the closest card came off
 * DRIVE with the affordance on it and every case here failed on the query
 * rather than on the behaviour it was written to protect. The note left in
 * their place said the behaviour was still shipped, still load-bearing, and
 * waiting on an owner decision about where the affordance lived.
 *
 * IT LIVES IN THE DRIVE FAMILY'S SECONDARY-ROW RIGHT SLOT, in the three states
 * that can offer a detour: the exposure card, CRUISING and APPROACHING. Zero
 * new states, zero height change - the slot was being spent on `Tap for tabs`.
 *
 * THE VERB CAME BACK WITH IT. V3's rule 7 is that the key reads `Reroute
 * around N` everywhere and never a bare `Around N`, which names a quantity
 * without saying what happens to it. So the query below moved by one word; the
 * behaviour it protects has not moved at all.
 *
 * So `routeKey()` is re-pointed and the five are back. What they assert is
 * unchanged to the word.
 *
 * =============================================================================
 * WHY THIS RENDERS `ShellDock` AND NOT `DriveScreen`
 * =============================================================================
 * The dock is CHROME. `app/ShellDock.tsx` mounts it once for the whole app and
 * binds the stores to it; `DriveScreen` neither draws it nor decides anything
 * about it, and says so in its own header. Mounting DRIVE here would mount a
 * MapLibre canvas to press a key that is not on it.
 *
 * The file keeps its name because the regression it guards is DRIVE's, and
 * because deleting the only written record that DRIVE ever had this key would
 * un-cover the maps-app failure on the day somebody re-adds one.
 *
 * Everything is still driven through the shipped chain - records into the
 * cameras store, `createAlertLoop` over a real fix, `packages/core` doing the
 * measuring - rather than through a hand-built view model, so a surface that
 * agreed with a mock and disagreed with the engine would fail here.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getScreenState, initScreenState, topOverlay } from '../../app/screenState.ts';
import { ShellDock } from '../../app/ShellDock.tsx';
import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore, positionActions } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { createAlertLoop } from '../../services/alerts/engineLoop.ts';
import * as planRouteModule from '../../services/route/planRoute.ts';
import type { AlertLoop } from '../../services/alerts/engineLoop.ts';
import type { CameraRecord } from '../../services/db/schema.ts';

import { DETOUR_OVERLAY, DETOUR_SEND, DetourOffer, pendingDetour } from './DetourOffer.tsx';

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

/**
 * TWELVE READERS INSIDE TWO MILES, which is 4 DENSE AREA's own definition.
 *
 * Spread from 300 m to 1,400 m so they are all inside the two-mile detour
 * horizon and none of them is inside the 500 ft alert radius, for the same
 * reason `AHEAD` is: a live camera alert outranks every overlay.
 */

/**
 * Put a set of readers on the phone, put the car among them, and tick.
 *
 * ONE FIX, ONE LOOP, THE REAL ENGINE. The dock reads `assessments` off the
 * cameras store, and only `alert.ts` writes those - so a fixture that skipped
 * the tick would be a dock reading a set no engine ever produced.
 */
function driveThrough(cameras: readonly CameraRecord[]): AlertLoop {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras,
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
 * MOVING, WITH THREE READERS AHEAD: CRUISING, and its key reads
 * `Reroute around 3`.
 *
 * The dock's ladder puts a moving car with a camera outside the approaching
 * window into CRUISING, and CRUISING's secondary rail is where the detour key
 * lives. Nothing here asks for that state by name - it is derived from the fix
 * and the cameras, the same as it is on the road.
 */
function drive(): AlertLoop {
  return driveThrough(AHEAD);
}

/**
 * THE DETOUR KEY, wherever the dock has put it and whatever number it counts.
 *
 * `Reroute around 3` in CRUISING, `Reroute around 14` on the exposure card.
 * The regex is the point:
 * these cases are about what the key DOES, and pinning the exact count here
 * would make every one of them fail the day a fixture gains a camera. The two
 * that care about the number assert on it directly.
 *
 * BY ROLE AND BY NAME, which is also an assertion. The word on the glass IS
 * the accessible name - the key carries no `aria-label` hiding it - so a
 * `getByRole` that finds it has already proved a driver using voice control
 * can reach it by saying what they can see.
 */
function routeKey(): HTMLElement {
  return screen.getByRole('button', { name: /^Reroute around \d+ readers?$/ });
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

describe('the dock detour key', () => {
  it('opens nothing when pressed - it asks first', () => {
    // THE REGRESSION. This used to open the maps app immediately, at the
    // nearest camera. Nothing may leave the device on this press.
    drive();
    render(<ShellDock />);

    fireEvent.click(routeKey());

    expect(opened).toEqual([]);
    expect(topOverlay(getScreenState())?.id).toBe(DETOUR_OVERLAY.id);
  });

  it('plans a real multi-stop detour off the cameras the label counted', () => {
    drive();
    render(<ShellDock />);
    // The fixture is only meaningful if the key is about all three readers.
    //
    // ITS FACE IS THE WHOLE PROMISE NOW. The deleted key drew `➤ 3` and hid
    // the sentence in an `aria-label`, because a 26px key had no room for
    // words. This one has a 13px slot and spends it on both: the sentence is
    // what is painted and what is announced, so one assertion covers the count
    // a driver can see and the promise it is making.
    /* The face is the count; the reroute glyph beside it carries the verb. The
       accessible name is the sentence, because a bare `3` is not one. */
    expect(routeKey()).toHaveTextContent('Reroute around 3');
    expect(routeKey()).toHaveAccessibleName('Reroute around 3 readers');

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

  it('plans in this app, and only after the driver says yes', async () => {
    const planned = vi
      .spyOn(planRouteModule, 'planRoute')
      .mockResolvedValue({
        shape: [FIX, { lat: FIX.lat + 0.02, lon: FIX.lon }],
        miles: 2,
        seconds: 300,
        avoided: 3,
        maneuvers: [],
      });

    drive();
    render(
      <>
        <ShellDock />
        <DetourOffer />
      </>,
    );

    fireEvent.click(routeKey());
    // Raising the question sends nothing. That has always been the rule here.
    expect(planned).not.toHaveBeenCalled();
    expect(opened).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));

    await waitFor(() => {
      expect(planned).toHaveBeenCalledTimes(1);
    });
    // NOTHING WENT TO A MAPS APP. The handoff this key used to make is gone.
    expect(opened).toEqual([]);

    const request = planned.mock.calls[0]?.[0];
    // The driver's own position IS in the request now - a router needs
    // somewhere to route from.
    expect(request?.from).toEqual({ lat: FIX.lat, lon: FIX.lon });
    /*
     * The FIRST round asks for the plain route with nothing excluded. The
     * readers that turn out to be ON that line become the exclusions of the
     * round after, and so on - see `services/route/darkRoute.ts`. Sending the
     * cameras ahead in one shot is what shipped a line past nine of them.
     */
    expect(request?.avoid).toEqual([]);
  });

  /*
   * DELETED: 'says why rather than opening an empty route when there is no fix'.
   *
   * It pressed the key with the position store empty and asserted the refusal.
   * That is no longer stageable at this level and the reason IS the fix: with
   * no fix `planDriveDetour` refuses before it can name a count, so the key is
   * not drawn at all, and a test cannot click a key that correctly does not
   * exist. A key that renders a count and then refuses is the thing that
   * was wrong.
   *
   * The claim itself is not lost -- `detour.test.ts` asserts the refusal
   * reason for every arm (no fix, no bearing nameable, nothing ahead, all
   * unavoidable, already clear) against the planner directly, which is where
   * it belongs. The UI half is covered by the absent-at-zero test in
   * `dock.test.tsx`.
   */
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
describe('the detour key on an iPhone', () => {
  it('is drawn, and still sends nothing until the prompt is answered', () => {
    vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    drive();
    render(<ShellDock />);

    expect(routeKey()).toBeInTheDocument();

    fireEvent.click(routeKey());

    expect(opened).toEqual([]);
    expect(topOverlay(getScreenState())?.id).toBe(DETOUR_OVERLAY.id);
  });
});
