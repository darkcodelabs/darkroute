/**
 * THE PROMPT, AND THE ONE THING IT MUST NEVER DO.
 *
 * =============================================================================
 * WHAT IS BEING GUARDED
 * =============================================================================
 * A multi-stop handoff is an HTTPS request to a maps service that says roughly
 * where this car is and which way it is going. Every test in this file exists
 * to hold one line: THAT REQUEST HAPPENS ONLY AFTER SOMEBODY PRESSES THE KEY
 * THAT SAYS IT WILL.
 *
 * So the opener is a spy and most of the assertions are `not.toHaveBeenCalled`.
 * Raising the prompt sends nothing; refusing sends nothing; Escape sends
 * nothing; the close key sends nothing. There is no timeout that proceeds and
 * no remembered answer that would skip the question next time - the sentence
 * saying so is asserted too, because a driver has no other way to check it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { V1_OVERLAYS } from '../../app/registry.v1.tsx';
import { getScreenState, initScreenState, topOverlay } from '../../app/screenState.ts';
import { OVERLAY_CLOSE_LABEL } from '../../components/overlay/OverlayClose.tsx';
import * as planRouteModule from '../../services/route/planRoute.ts';
import { RouteRefused } from '../../services/route/planRoute.ts';
import { useRouteStore } from '../../stores/route.ts';

import {
  DETOUR_ASKED_EVERY_TIME,
  DETOUR_CANCEL,
  DETOUR_CLOSE,
  DETOUR_DISCLOSURE,
  DETOUR_EXPIRED,
  DETOUR_LIMIT,
  DETOUR_NONE_TITLE,
  DETOUR_OVERLAY,
  DETOUR_SEND,
  DETOUR_TITLE,
  DETOUR_UNAVAILABLE,
  detourDestinationName,
  DetourOffer,
  detourPlanLine,
  detourUnavoidableLine,
  offerDetour,
} from './DetourOffer.tsx';
import type { DetourOutcome } from './detour.ts';

/** Two stops around one reader, with nothing the plan had to give up on. */
const ROUTE: DetourOutcome = {
  kind: 'route',
  to: { lat: 38.97, lon: -94.67 },
  plan: {
    waypoints: [
      { lat: 38.93, lon: -94.68 },
      { lat: 38.95, lon: -94.69 },
    ],
    consideredCameras: 3,
    unavoidable: 0,
    dropped: 0,
    clearanceFt: 1000,
  },
  closestFt: 1042,
};

/**
 * Every URL the component managed to open. EMPTY IS THE PASSING STATE, and it
 * is now the passing state for every test in this file.
 *
 * The detour used to hand off to Google Maps. It plans in-app now, so nothing
 * on this surface may open anything at all - and this spy is kept precisely to
 * hold that: it is at `window.open`, the browser's own door, so a future change
 * that reintroduced a handoff by any route would be visible here.
 */
let opened: string[];

/** Every route request the component made. */
let requested: planRouteModule.RouteRequest[];

beforeEach(() => {
  opened = [];
  requested = [];
  initScreenState({ initialScreen: 'radar' });
  useRouteStore.setState(useRouteStore.getInitialState(), true);
  vi.spyOn(globalThis.window, 'open').mockImplementation((url) => {
    opened.push(String(url));
    return null;
  });
  vi.spyOn(planRouteModule, 'planRoute').mockImplementation((request) => {
    requested.push(request);
    return Promise.resolve({
      shape: [
        { lat: 38.9, lon: -94.7 },
        { lat: 38.97, lon: -94.67 },
      ],
      miles: 6.1,
      seconds: 720,
      avoided: request.avoid.length,
      maneuvers: [],
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FROM = { lat: 38.9, lon: -94.7 };
/** Everything on the phone. The planner measures its own line against these. */
const CAMERAS = [
  { id: 'a', lat: 38.93, lon: -94.68, directionDeg: 0, confirmations: 1 },
  { id: 'b', lat: 38.95, lon: -94.69, directionDeg: 0, confirmations: 1 },
];

/** Raise the prompt the way DRIVE raises it, then render what the shell would. */
function offer(outcome: DetourOutcome) {
  offerDetour(outcome, { from: FROM, cameras: CAMERAS });
  return render(<DetourOffer />);
}

/*
 * THE BUG THIS BLOCK EXISTS FOR.
 *
 * The key says "Route around all 9". `planDetour` groups cameras that sit
 * close together along the line and gives each group ONE waypoint, so nine
 * readers over a couple of blocks correctly plan as one stop. The offer used
 * to say "1 stop" and nothing else, and a driver who pressed a key promising
 * nine, read "1 stop", then saw a single via-point in their maps app had every
 * reason to conclude eight had been dropped. Correct arithmetic, unstated, is
 * indistinguishable from broken arithmetic.
 */
describe('the plan line, which has to reconcile stops to cameras', () => {
  it('says one stop clears all of them, when the group is one stop', () => {
    const line = detourPlanLine(1, 1000, 9);
    expect(line).toContain('1 stop');
    expect(line).toContain('all 9 cameras');
    // And WHY one is enough, so it does not read like a shortfall.
    expect(line).toMatch(/close enough together/);
  });

  it('does not claim a group when there is one camera and one stop', () => {
    const line = detourPlanLine(1, 1000, 1);
    expect(line).toContain('the camera');
    expect(line).not.toMatch(/close enough together/);
  });

  it('says one each when the counts match, rather than inventing grouping', () => {
    const line = detourPlanLine(4, 1000, 4);
    expect(line).toContain('4 stops');
    expect(line).toContain('one for each camera');
  });

  it('reconciles the two numbers when some cameras share a stop', () => {
    const line = detourPlanLine(3, 1000, 9);
    expect(line).toContain('3 stops');
    expect(line).toContain('all 9 cameras');
    expect(line).toContain('share a stop');
  });

  it('always states the berth it plans, in feet', () => {
    for (const [stops, cameras] of [
      [1, 1],
      [1, 9],
      [4, 4],
      [3, 9],
    ] as const) {
      expect(detourPlanLine(stops, 1000, cameras)).toContain('1000 ft');
    }
  });
});

describe('the detour offer', () => {
  it('is registered as the overlay DRIVE raises, or nothing would be drawn', () => {
    expect(V1_OVERLAYS[DETOUR_OVERLAY.id]).toBe(DetourOffer);
  });

  it('sends nothing merely by being asked', () => {
    offer(ROUTE);

    expect(screen.getByRole('heading', { name: DETOUR_TITLE })).toBeInTheDocument();
    expect(opened).toEqual([]);
  });

  it('says what leaves the phone, and what the route is not, before the key', () => {
    // Both blocks are the consent. A prompt that asked for a yes without them
    // would be a confirmation dialog, not an informed choice.
    offer(ROUTE);

    expect(screen.getByText(DETOUR_DISCLOSURE)).toBeInTheDocument();
    expect(screen.getByText(DETOUR_LIMIT)).toBeInTheDocument();
    expect(screen.getByText(DETOUR_ASKED_EVERY_TIME)).toBeInTheDocument();
  });

  it('plans the route in this app, and opens nothing, once the driver says yes', async () => {
    offer(ROUTE);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));
    await waitFor(() => {
      expect(requested).toHaveLength(1);
    });

    // NOTHING WAS HANDED TO A MAPS APP. This is the assertion the whole change
    // was for.
    expect(opened).toEqual([]);

    // The first round asks for the plain route; the readers that turn out to
    // be on it become the exclusions of the round after. See `darkRoute.ts`.
    expect(requested[0]?.avoid).toEqual([]);
    expect(requested[0]?.from).toEqual(FROM);
    expect(requested[0]?.to).toEqual(ROUTE.to);

    // The line is on the app's own map, and the question is over.
    await waitFor(() => {
      expect(topOverlay(getScreenState())).toBeNull();
    });
    expect(useRouteStore.getState().route?.miles).toBe(6.1);
  });

  it('names the destination after what it is doing, so the card is readable', async () => {
    offer(ROUTE);
    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));

    await waitFor(() => {
      expect(useRouteStore.getState().destination?.name).toBe(
        detourDestinationName(ROUTE.plan.consideredCameras),
      );
    });
  });

  it('sends nothing when the driver says no, and closes anyway', () => {
    offer(ROUTE);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_CANCEL }));

    expect(opened).toEqual([]);
    expect(topOverlay(getScreenState())).toBeNull();
  });

  it('sends nothing on Escape', () => {
    offer(ROUTE);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(opened).toEqual([]);
    expect(topOverlay(getScreenState())).toBeNull();
  });

  it('sends nothing from the close key', () => {
    offer(ROUTE);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_CLOSE_LABEL }));

    expect(opened).toEqual([]);
    expect(topOverlay(getScreenState())).toBeNull();
  });

  it('stays open and says so when the request itself failed', async () => {
    // Closing as though it had worked would leave a driver believing a route
    // is on the map.
    vi.spyOn(planRouteModule, 'planRoute').mockRejectedValue(new Error('offline'));
    offer(ROUTE);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));

    expect(await screen.findByText(DETOUR_UNAVAILABLE)).toBeInTheDocument();
    expect(topOverlay(getScreenState())).not.toBeNull();
  });

  it("prints the router's own sentence when no route avoids all of them", async () => {
    // "Try again with fewer of them" is something a driver can act on;
    // "failed" is not.
    const detail = 'no driving route avoids all of those. try again with fewer of them.';
    vi.spyOn(planRouteModule, 'planRoute').mockRejectedValue(new RouteRefused('no_route', detail));
    offer(ROUTE);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(topOverlay(getScreenState())).not.toBeNull();
  });

  it('names the cameras the detour cannot help with, beside the offer', () => {
    offer({
      ...ROUTE,
      plan: { ...ROUTE.plan, unavoidable: 2, dropped: 1 },
    });

    expect(screen.getByText(detourUnavoidableLine(2))).toBeInTheDocument();
    // The offer still stands - it routes around the rest - but the driver has
    // been told what it does not do before they pay for it in a disclosure.
    expect(screen.getByRole('button', { name: DETOUR_SEND })).toBeInTheDocument();
  });

  it('offers no send key at all when there is no route to send', () => {
    // The honest end of "route around": say why, do not open an empty route.
    offer({ kind: 'none', reason: 'all-unavoidable', unavoidable: 3, clearanceFt: 1000 });

    expect(screen.getByRole('heading', { name: DETOUR_NONE_TITLE })).toBeInTheDocument();
    expect(screen.getByText(/all 3 of the cameras ahead sit on the road/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DETOUR_SEND })).toBeNull();
    expect(screen.getByRole('button', { name: DETOUR_CLOSE })).toBeInTheDocument();
    expect(opened).toEqual([]);
  });

  it('does not re-plan behind a driver who came back to a dropped offer', () => {
    // `openOverlay` writes the stack into history, so a forward gesture can
    // raise this again after the route was dropped. Silently planning a new
    // one would answer a question asked somewhere else on the road.
    offerDetour(ROUTE);
    const asked = render(<DetourOffer />);
    fireEvent.click(asked.getByRole('button', { name: DETOUR_CANCEL }));
    // The shell unmounts the overlay when the stack pops; this test drives the
    // component directly, so it does that part itself.
    asked.unmount();

    render(<DetourOffer />);

    expect(screen.getByText(DETOUR_EXPIRED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DETOUR_SEND })).toBeNull();
    expect(opened).toEqual([]);
  });
});
