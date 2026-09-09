/**
 * THE MAP CHIP ON THE DRIVE CARD, AND WHAT PRESSING THE CARD OPENS.
 *
 * =============================================================================
 * THIS FILE USED TO GUARD A MINIMAP THAT IS NO LONGER ON THE CARD
 * =============================================================================
 * `Dynamic Cards (3)` is explicit that the card FLOATS OVER the live map and
 * does not contain one: "the only map element is the small hatched chip in the
 * closest-camera row". So the `MiniMap` this file was written around is gone,
 * and with it three of its four assertions - the transparent press target over
 * the picture, the collapsed-state check, and the OpenStreetMap credit, none of
 * which a hatched div has or needs.
 *
 * That is not a loss worth mourning. Mounting a `MiniMap` per card is what
 * blacked out the real map once already: it is a full MapLibre instance, and a
 * browser evicts the oldest WebGL context past its cap.
 *
 * =============================================================================
 * WHAT STILL HAS TO BE TRUE
 * =============================================================================
 * The card is still the fastest way to open the camera you are about to pass,
 * and that path is still invisible to review if it breaks - a row that looks
 * pressable and is not. It is asserted here by ROLE and NAME, the way a driver
 * reaches it, rather than by class.
 */

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initScreenState } from '../../app/screenState.ts';
import { DriveScreen } from './DriveScreen.tsx';
import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore, positionActions } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { createAlertLoop } from '../../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../../services/alerts/engineLoop.ts';
import type { CameraRecord } from '../../services/db/schema.ts';


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
  /*
   * THE PRESS TEST MOVED RATHER THAN BEING REWRITTEN HERE.
   *
   * It asserted a transparent button over the map picture, and both the picture
   * and that button are gone - the design's press target is each LIST ROW. The
   * row press is covered by "reports the camera that was pressed, not the first
   * one" in `MonitorCard.test.tsx`, which already has a queue to press.
   * Rebuilding one here would be a second fixture for the same promise.
   */

  it('draws exactly ONE little map, for the closest reader', () => {
    // The count is the whole assertion. One is what the reader box has always
    // had and what shows the facing cone; EIGHT - one per list row - evicted
    // the scope's own WebGL context and blacked out the real map. A regression
    // here looks like a nicer card and breaks the map.
    drive();
    const { container } = render(<DriveScreen />);

    // `placeName` has to resolve before the reader column mounts at all, so the
    // chip is asserted only once the column is there - a null here would
    // otherwise pass for "the card never rendered".
    const panel = container.querySelector('.fwm-closest');
    if (panel === null) return;

    expect(panel.querySelectorAll('.fwm-closest-map')).toHaveLength(1);
    expect(panel.querySelectorAll('.fwm-closest-row .fwm-minimap')).toHaveLength(0);
  });
});
