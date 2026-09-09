/**
 * THE DOCK'S KEYS DO WHAT THEIR LABELS SAY, in the two places a sweep found
 * they did not.
 *
 * `ShellDock.detour.test.tsx` covers what the detour key SAYS. This file covers
 * two presses whose EFFECT was wrong on the glass while every handler existed:
 *
 *   END FROM THE TURN LIST left the sheet open. The route cleared, the ladder
 *   fell through to the collapsed half, and the collapsed half honoured the
 *   same `expanded` flag - so the driver who pressed End on their turn list
 *   landed on 302px of nearby readers they had not asked for.
 *
 *   ARMED'S SHEET WAS EMPTY. `Dock.tsx` lists ARMED among the three collapsed
 *   states with something behind them - "ARMED has the reader" - and the ladder
 *   opens section C's list for it. The list was built from the readers within
 *   two miles, which ARMED defines as none, so the press opened 302px of header
 *   over nothing: the one thing the deleted chevron's replacement was argued
 *   never to do.
 *
 *   REROUTE AROUND N UNDER THE TAKEOVER did nothing a driver could see. The
 *   prompt was raised into `savedOverlays` behind the alert layer and surfaced
 *   on its own once the alert lapsed, about a place the car had left. AlertV1's
 *   own REROUTE key mutes first for exactly this reason; the dock's key now does
 *   the same, and only then.
 *
 * WHY IT DRIVES THE STORES. Both claims are about what the whole shell does
 * with a press, not about a callback firing: the first spans the route store,
 * the ladder and the shell's own gesture flag; the second spans the navigation
 * store's presentation and the alert store's mute. A hand-built `DockProps`
 * would prove neither.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAlertLoop } from '../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../services/alerts/engineLoop.ts';
import type { PlannedRoute } from '../services/route/planRoute.ts';
import { useAlertStore } from '../stores/alert.ts';
import { useCamerasStore } from '../stores/cameras.ts';
import { navigationActions, useNavigationStore } from '../stores/navigation.ts';
import { positionActions, usePositionStore } from '../stores/position.ts';
import { routeActions, useRouteStore } from '../stores/route.ts';
import { useSettingsStore } from '../stores/settings.ts';
import type { CameraRecord } from '../services/db/schema.ts';
import { closeDetourOffer, pendingDetour } from '../features/drive/DetourOffer.tsx';
import { DOCK_COLLAPSE_LABEL, DOCK_EXPAND_LABEL } from '../features/dock/Dock.tsx';
import { initScreenState } from './screenState.ts';
import { ShellDock } from './ShellDock.tsx';

const started: AlertLoop[] = [];

/** Overland Park, the same corner `ShellDock.detour.test.tsx` drives. */
const FIX = { lat: 38.9181, lon: -94.6923, accuracyM: 8, timestampMs: 1_700_000_000_000 };

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((FIX.lat * Math.PI) / 180);

function at(north: number, east: number): { readonly lat: number; readonly lon: number } {
  return { lat: FIX.lat + north / M_PER_DEG_LAT, lon: FIX.lon + east / M_PER_DEG_LON };
}

function reader(north: number, east: number, id: string): CameraRecord {
  return { id, ...at(north, east), directionDeg: 180, confirmations: 1 };
}

/** Four readers ahead and beside the line, none inside the 500 ft alert radius. */
const AHEAD: readonly CameraRecord[] = [
  reader(400, 60, 'osm:a0'),
  reader(600, 80, 'osm:a1'),
  reader(800, 70, 'osm:a2'),
  reader(1000, 90, 'osm:a3'),
];

/**
 * A line north from the fix with a turn and an arrival, so the ladder has a
 * maneuver to draw and a turn list to expand into.
 */
function routeNorth(): PlannedRoute {
  const shape = [];
  for (let i = 0; i <= 10; i += 1) shape.push(at(240 * i, 0));
  for (let i = 1; i <= 10; i += 1) shape.push(at(2400, 160 * i));
  return {
    shape,
    miles: 2.5,
    seconds: 300,
    avoided: 0,
    maneuvers: [
      { instruction: 'Head north on Metcalf Ave.', street: 'Metcalf Ave', miles: 1.5, seconds: 180, turn: 'start', beginShapeIndex: 0 },
      { instruction: 'Turn right onto W 103rd St.', street: 'W 103rd St', miles: 1.0, seconds: 120, turn: 'right', beginShapeIndex: 10 },
      { instruction: 'You have arrived.', street: '', miles: 0, seconds: 0, turn: 'arrive', beginShapeIndex: 20 },
    ],
  };
}

function putReaders(cameras: readonly CameraRecord[]): void {
  useCamerasStore.getState().putTiles([
    { ref: { z: 11, x: 484, y: 783 }, cameras, fetchedAtMs: FIX.timestampMs, freshness: 'fresh', source: 'network' },
  ]);
}

function fixHere(speedMps: number | null, headingDeg: number | null): void {
  positionActions.ingestFix({
    lat: FIX.lat,
    lon: FIX.lon,
    accuracyM: FIX.accuracyM,
    altitudeM: null,
    altitudeAccuracyM: null,
    headingDeg,
    speedMps,
    timestamp: FIX.timestampMs,
  });
  const loop = createAlertLoop();
  started.push(loop);
  loop.tick({
    lat: FIX.lat,
    lon: FIX.lon,
    headingDeg,
    speedMps,
    accuracyM: FIX.accuracyM,
    motionMagnitudeMps2: null,
    timestampMs: FIX.timestampMs,
  });
}

function pane(): HTMLElement {
  const found = document.querySelector('.fwm-dock');
  if (!(found instanceof HTMLElement)) throw new Error('no dock on screen');
  return found;
}

beforeEach(() => {
  initScreenState({ initialScreen: 'radar' });
});

afterEach(() => {
  while (started.length > 0) started.pop()?.stop();
  closeDetourOffer();
  routeActions.clear();
  navigationActions.restoreAfterAlert();
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
  useSettingsStore.getState().reset();
});

describe('End, pressed from inside the turn list', () => {
  it('clears the route AND shuts the sheet, instead of dropping onto the nearby list', () => {
    putReaders(AHEAD);
    fixHere(0, null);
    routeActions.setDestination({ name: 'Test Place', detail: 'Overland Park', ...at(2400, 1600) });
    routeActions.planned(routeNorth(), [], []);
    render(<ShellDock />);

    /* The route is live, so the pane is the 170px maneuver row, and the whole
       body is the way into the turn list. */
    expect(pane()).toHaveAttribute('data-fwm-pane', 'navigating');
    fireEvent.click(screen.getByRole('button', { name: DOCK_EXPAND_LABEL }));
    expect(pane()).toHaveAttribute('data-fwm-pane', 'expanded');
    expect(pane()).toHaveAttribute('data-fwm-state', 'navigating-expanded');

    fireEvent.click(screen.getByRole('button', { name: 'End' }));

    /* The route is gone - that half always worked. */
    expect(useRouteStore.getState().route).toBeNull();
    expect(useRouteStore.getState().destination).toBeNull();
    /* AND THE SHEET IS GONE WITH IT. Before the fix this read `expanded` /
       `armed-expanded`: the readers within two miles, at 302px, over a map the
       driver had just asked to be left alone with. */
    expect(pane()).toHaveAttribute('data-fwm-pane', 'collapsed');
    expect(screen.queryByRole('button', { name: DOCK_COLLAPSE_LABEL })).toBeNull();
  });
});

describe('Reroute around N while the alert takeover holds the screen', () => {
  it('silences the alert before it asks, so the prompt is not raised behind the takeover', () => {
    putReaders(AHEAD);
    fixHere(21, 0);
    /* What `App.tsx` does when the engine takes the screen: overlays move
       aside and `presentation` reads `camera-alert`. */
    expect(navigationActions.saveForAlert()).toBe(true);
    expect(useNavigationStore.getState().presentation).toBe('camera-alert');
    render(<ShellDock />);

    const key = screen.getByRole('button', { name: /^Reroute around \d+ readers?$/ });
    fireEvent.click(key);

    /* The question is asked - that half always fired - and the takeover that
       would have painted over it has been muted, the same trade AlertV1's own
       REROUTE key makes. */
    expect(pendingDetour()?.kind).toBe('route');
    expect(useAlertStore.getState().muted).toBe(true);
    expect(useSettingsStore.getState().mutedUntilMs).not.toBeNull();
  });

  it('buys no silence when nothing is covering the prompt', () => {
    putReaders(AHEAD);
    fixHere(21, 0);
    expect(useNavigationStore.getState().presentation).not.toBe('camera-alert');
    render(<ShellDock />);

    fireEvent.click(screen.getByRole('button', { name: /^Reroute around \d+ readers?$/ }));

    /* The parked exposure card is the case the old argument was right about:
       ten minutes of quiet the driver did not ask for would be the wrong trade
       to copy, so it is still not copied there. */
    expect(pendingDetour()?.kind).toBe('route');
    expect(useAlertStore.getState().muted).toBe(false);
    expect(useSettingsStore.getState().mutedUntilMs).toBeNull();
  });
});

describe('the sheet behind ARMED', () => {
  it('lists the reader the state is about, not an empty two-mile list', () => {
    /* One reader, three miles north: inside ARMED's five miles, outside the
       exposure count's two. */
    putReaders([reader(4800, 0, 'osm:far')]);
    fixHere(0, null);
    render(<ShellDock />);

    expect(pane()).toHaveAttribute('data-fwm-state', 'armed');
    fireEvent.click(screen.getByRole('button', { name: DOCK_EXPAND_LABEL }));
    expect(pane()).toHaveAttribute('data-fwm-pane', 'expanded');

    const rows = document.querySelectorAll('.fwm-dock-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('osm:far');
    expect(rows[0]).toHaveTextContent('3.0 mi');
    /* And the header counts what the list holds, over the radius it holds it. */
    expect(screen.getByText('cameras within 5 mi')).toBeInTheDocument();
  });
});
