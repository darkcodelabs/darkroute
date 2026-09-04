/**
 * THE MAP PICTURE ON THE DRIVE CARD.
 *
 * =============================================================================
 * WHY THE TAP IS THE THING TESTED, AND NOT THE PICTURE
 * =============================================================================
 * `MiniMap` builds a real MapLibre instance and jsdom has no WebGL, so what
 * this file can assert about the drawing is "the figure is on the card" and
 * nothing more - the ground falls to `bare`, which is the same path a phone in
 * a dead zone takes and is therefore worth pinning anyway.
 *
 * The behaviour that can actually break silently is the TARGET. The picture is
 * `pointer-events: none` on purpose (a map inside a scrolling card must not eat
 * a drag), and that is exactly what made the most map-looking thing on the card
 * do nothing when it was pressed. The fix is a transparent button over it, and
 * a transparent button is invisible to review: nothing looks wrong when it
 * stops working. So it is asserted here by ROLE and by NAME, the way a user
 * reaches it, rather than by class.
 *
 * =============================================================================
 * THE CREDIT
 * =============================================================================
 * DRIVE passes `credited`, because the scope under this card draws MapLibre's
 * own attribution control and ODbL wants the credit on the surface, not twice
 * on it. The dead-zone note is NOT a credit and stays. Both halves are checked:
 * dropping the wrong one is a licence problem in one direction and a silent map
 * in the other.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initScreenState, topOverlay } from '../../app/screenState.ts';
import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore, positionActions } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { createAlertLoop } from '../../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../../services/alerts/engineLoop.ts';
import type { CameraRecord } from '../../services/db/schema.ts';
import { GROUND_NOTE } from '../map/miniMap.ts';

import { DRIVE_CARD_EXPAND, DRIVE_MAP_OPEN, DriveScreen } from './DriveScreen.tsx';

const started: AlertLoop[] = [];

/** A fix in Kansas City, moving north fast enough for a confident heading. */
const FIX = {
  lat: 38.9181,
  lon: -94.6923,
  headingDeg: 0,
  speedMps: 21,
  accuracyM: 8,
  timestampMs: 1_700_000_000_000,
};

/**
 * One reader up the road, OUTSIDE the alert radius.
 *
 * 300 m is about 984 ft against a 500 ft default threshold. A camera in range
 * would raise a live alert, and a live alert outranks every overlay in the
 * presentation ladder - so the card under test would be replaced by the thing
 * that outranked it and these assertions would be about the alert layer.
 *
 * It carries a `direction` tag so the cone has something to draw from, which is
 * the path `coveredDirections` -> `facingSpans` takes on the card.
 */
const AHEAD: CameraRecord = {
  id: 'osm:card-map',
  lat: FIX.lat + 300 / 111_320,
  lon: FIX.lon + 60 / (111_320 * Math.cos((FIX.lat * Math.PI) / 180)),
  directionDeg: 180,
  confirmations: 1,
  tags: { direction: '180' },
};

function drive(): void {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras: [AHEAD],
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
  const loop = createAlertLoop();
  started.push(loop);
  loop.tick(FIX);
}

beforeEach(() => {
  initScreenState();
  useCamerasStore.setState(useCamerasStore.getInitialState(), true);
  useAlertStore.setState(useAlertStore.getInitialState(), true);
  usePositionStore.setState(usePositionStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

afterEach(() => {
  for (const loop of started.splice(0)) loop.stop();
});

describe('the map picture on the closest-camera card', () => {
  it('opens the camera card when the picture is pressed, not just when the text is', () => {
    act(() => {
      drive();
    });
    render(<DriveScreen />);

    // By role and name, the way a user reaches it. Asserting on the class
    // would pass for a `<div onClick>` that no keyboard can reach.
    fireEvent.click(screen.getByRole('button', { name: DRIVE_MAP_OPEN }));

    expect(topOverlay()).not.toBeNull();
  });

  it('draws the picture on the COLLAPSED card, which is the default view', () => {
    act(() => {
      drive();
    });
    render(<DriveScreen />);

    // The card opens collapsed, so this is the state most drivers ever see. If
    // the picture were expanded-only, the feature would be invisible by default.
    expect(screen.getByRole('button', { name: DRIVE_CARD_EXPAND })).toBeTruthy();
    expect(screen.getByRole('button', { name: DRIVE_MAP_OPEN })).toBeTruthy();
  });

  it('does not repeat the OpenStreetMap credit the scope already draws', () => {
    act(() => {
      drive();
    });
    render(<DriveScreen />);

    // ODbL wants the credit on the surface. MapCanvas carries it for this
    // screen, so the card saying it again is the same screen crediting twice.
    expect(screen.queryByText(GROUND_NOTE.ground)).toBeNull();
  });

  it('still says the ground is missing, because that is not a credit', async () => {
    act(() => {
      drive();
    });
    render(<DriveScreen />);

    // jsdom has no WebGL, so the map never paints and settles to `bare` - the
    // same state a phone reaches in a dead zone. The note is the picture
    // admitting it has no ground, and the scope cannot say that for THIS
    // camera, so suppressing it with the credit would have been a real loss.
    //
    // `findByText`, not `getByText`: the caption starts at `pending` and empty
    // by design - a picture that cried "no map" for the 500 ms before the tiles
    // land would be lying most of the time it spoke. `MiniMap` reaches `bare`
    // from an async path (the protocol registration is awaited before the map
    // is even constructed), so the assertion has to wait for the same settle a
    // reader waits for.
    expect(await screen.findByText(GROUND_NOTE.bare)).toBeTruthy();
  });
});
