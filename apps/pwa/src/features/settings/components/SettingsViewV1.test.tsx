/**
 * SETTINGS v1 - what this screen NO LONGER DRAWS.
 *
 * Six controls left for DRIVE's MAP VIEW panel by owner decision: the warn
 * distance, spoken warnings, vibration, cluster cameras, turn the map with you,
 * and the map angle. They MOVED rather than being mirrored, and every assertion
 * in the first block below is about the moving half of that - a copy quietly
 * left behind here is the failure this file exists to catch, because a setting
 * drawn in two places is two switches to keep in step and the first time they
 * disagree the driver is the one who finds out.
 *
 * The second block is the other half: the things that did NOT move. It is easy
 * to read "remove anything the map panel offers" as "remove anything about the
 * map", and the cartography picker is the trap - the layers panel deliberately
 * links HERE for it rather than keeping its own copy, so deleting it would
 * leave a control with no home and a link pointing at nothing.
 *
 * Rendered through `SettingsScreen`, not by hand: the container owns the
 * hydration gate and passes every handler, so this is the same view the app
 * mounts. A hand-built model would let this file agree with a mock while the
 * product disagreed.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAllStores, useSettingsStore } from '../../../stores';
import { SettingsScreen } from '../SettingsScreen.tsx';
import type { RemovalPort } from '../removal.ts';

import { MAP_VIEW_HEADING, SettingsViewV1 } from './SettingsViewV1.tsx';

/** A port that reports a clean wipe. Nothing here presses removal. */
function removedPort(): RemovalPort {
  return vi.fn<RemovalPort>().mockResolvedValue({ status: 'removed', lines: [] });
}

function drawV1(): void {
  render(<SettingsScreen surface="phone" removalPort={removedPort()} view={SettingsViewV1} />);
}

beforeEach(() => {
  resetAllStores();
  // The persisted blob is read asynchronously and every control is inert until
  // it lands. A gated screen would pass the absence tests below for the wrong
  // reason, so it is hydrated first.
  useSettingsStore.getState().markHydrated();
});

afterEach(() => {
  resetAllStores();
});

describe('the controls that moved to the map view panel are gone from here', () => {
  it('draws no warn-distance control at all, not a second coarser one', () => {
    drawV1();
    // Both shapes it has worn: the five-stop radiogroup this screen had, and
    // the slider the map panel has now. Neither belongs on this screen.
    expect(screen.queryByRole('radiogroup', { name: /warn me at/i })).toBeNull();
    expect(screen.queryByRole('slider', { name: /warn me at/i })).toBeNull();
    expect(screen.queryByText(/warn me at/i)).toBeNull();
  });

  it('draws no spoken-warnings switch', () => {
    drawV1();
    expect(screen.queryByRole('switch', { name: /spoken warnings/i })).toBeNull();
  });

  it('draws no vibration switch', () => {
    drawV1();
    expect(screen.queryByRole('switch', { name: /vibration/i })).toBeNull();
  });

  it('draws no cluster-cameras switch', () => {
    drawV1();
    expect(screen.queryByRole('switch', { name: /cluster cameras/i })).toBeNull();
  });

  it('draws no heading-up switch', () => {
    drawV1();
    expect(screen.queryByRole('switch', { name: /turn the map with you/i })).toBeNull();
  });

  it('draws no map-angle picker', () => {
    drawV1();
    expect(screen.queryByRole('radiogroup', { name: /map angle/i })).toBeNull();
  });

  it('keeps only the switches that are a different kind from a driving control', () => {
    // The strongest form of the same claim: not "the four are gone" one at a
    // time, but "every switch left on this screen is one you decide once,
    // sitting down, and none of them is an alert setting".
    //
    // `PermissionsV1` draws three - location, notifications and motion, what
    // the app is ALLOWED to use. `DestinationHistoryV1` draws the fourth,
    // `Remember places`, which is the same kind of decision: whether the app
    // may write down where you went. Nobody changes either at a junction.
    //
    // THE COUNT IS STILL ASSERTED rather than relaxed to "at least three",
    // because the whole value of this test is that a fifth switch has to be
    // argued for HERE, in the file about what does not belong on this screen,
    // rather than appearing quietly.
    drawV1();
    const switches = screen.queryAllByRole('switch');
    expect(switches).toHaveLength(4);
    for (const control of switches) {
      expect(control.textContent ?? '').toMatch(
        /location|notification|motion|remember places/i,
      );
    }
  });

  it('leaves the settings it moved exactly where they were in the store', () => {
    // Moving a control must not move a DEFAULT. Every one of these is still the
    // value `DEFAULT_SETTINGS` declares; the map panel writes the same fields.
    drawV1();
    const state = useSettingsStore.getState();
    expect(state.thresholdFt).toBe(500);
    expect(state.audio).toBe(true);
    expect(state.vibration).toBe(true);
    expect(state.clusterCameras).toBe(false);
    // NORTH UP, by owner decision 2026-09-08. This line read `true` until that
    // reversal, and it is the assertion that catches a default being changed
    // from somewhere other than `DEFAULT_SETTINGS` - so it tracks the default
    // rather than being relaxed to "whatever the store says".
    expect(state.headingUpMap).toBe(false);
  });
});

describe('what did not move, and must not be tidied away with the rest', () => {
  it('still picks the cartography, which the layers panel links here for', () => {
    // `MapControlPanel`'s "Set theme" row shuts itself and opens this screen
    // instead of keeping six cartography rows of its own. This card is that
    // link's destination: it is NOT the map-view panel's `Map view`, which is
    // about where the map points.
    drawV1();
    expect(screen.getByRole('radiogroup', { name: MAP_VIEW_HEADING })).toBeInTheDocument();
  });

  it('still picks the palette and the text size', () => {
    drawV1();
    expect(screen.getByRole('radiogroup', { name: /theme mode/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /text size/i })).toBeInTheDocument();
  });
});
