/**
 * THE CAMERA COUNT MOVED, AND IT HAS TO BE IN ONE PLACE.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS
 * =============================================================================
 * The count has now lived in three places on this screen: a second line inside
 * the search bar, which turned the bar into two rows and pushed the mark and
 * the wordmark off the field's baseline; a caption under the speed plate, which
 * is where it was parked afterwards; and - by owner decision - back under the
 * wordmark, this time in a column pinned to the reload key's own height so the
 * row cannot grow.
 *
 * A move like that fails in exactly one way that review does not catch: the new
 * one lands and the old one is left behind, and the screen quietly draws the
 * same reading twice in two corners with two different formats. So the
 * assertion here is about the SCREEN rather than about either component - the
 * count is on the bar, the old caption is gone, and the rounded `140k` form the
 * owner rejected is nowhere on it.
 *
 * `TopBar.test.tsx` holds what the count SAYS and what the dot beside it
 * means. This holds only that there is one of it, in the right place.
 */

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initScreenState } from '../../app/screenState.ts';
import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore, positionActions } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { createAlertLoop } from '../../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../../services/alerts/engineLoop.ts';
import type { CameraRecord } from '../../services/db/schema.ts';

import { DriveScreen } from './DriveScreen.tsx';

/** Every loop a test starts, stopped even when the test fails partway. */
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
 * raises a live alert, and a live alert outranks every overlay in the
 * presentation ladder - so the screen under test would be replaced by the thing
 * that outranked it and the search bar would not be on it to assert about.
 */
const AHEAD: CameraRecord = {
  id: 'osm:held-count',
  lat: FIX.lat + 300 / 111_320,
  lon: FIX.lon,
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

describe('where DRIVE draws the camera count', () => {
  it('draws it once, on the search bar', () => {
    drive();
    const { container } = render(<DriveScreen />);

    /* The bar is `features/chrome/TopBar.tsx` now; the count is the same
       reading in the same place, under the wordmark, with the same freshness
       dot beside it. Only the class names moved. */
    const counts = container.querySelectorAll('.fwm-topbar-count');
    expect(counts).toHaveLength(1);
    expect(container.querySelector('.fwm-topbar .fwm-topbar-count')).not.toBeNull();
  });

  it('leaves that corner of the map empty - no caption, and no speed plate', () => {
    // `.fwm-drive-held` was the caption in that corner and `.fwm-drive-speed`
    // was the reading it sat under. Both are gone: the count moved onto the
    // bar, and the speed moved into the dock's drive row, because the map is
    // for browsing and nobody browses at 60mph.
    //
    // Asserted as ABSENT rather than left untested, because "do not rebuild it
    // on the map" is the actual instruction and an absence nobody guards is an
    // absence that comes back.
    drive();
    const { container } = render(<DriveScreen />);

    expect(container.querySelector('.fwm-drive-held')).toBeNull();
    expect(container.querySelector('.fwm-drive-speed')).toBeNull();
  });

  it('draws no count rounded to the nearest thousand anywhere on the screen', () => {
    // `1k / 140k` is what the caption said. The owner asked for the actual
    // number, and a rounded figure surviving somewhere else on the screen
    // would be the same claim in two precisions.
    drive();
    const { container } = render(<DriveScreen />);

    expect(container.textContent ?? '').not.toMatch(/\d+k\b/);
  });
});
