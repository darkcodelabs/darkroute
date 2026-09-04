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

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { V1_OVERLAYS } from '../../app/registry.v1.tsx';
import { getScreenState, initScreenState, topOverlay } from '../../app/screenState.ts';
import { OVERLAY_CLOSE_LABEL } from '../../components/overlay/OverlayClose.tsx';
import * as navigateToModule from '../../services/adapters/navigateTo.ts';
import { ROUTE_VIA_HOST } from '../../services/adapters/routeVia.ts';

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
  DetourOffer,
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
 * Every URL the component managed to open. Empty is the passing state.
 *
 * SPIED AT `window.open` - the browser's own door, not an adapter's. A stub on
 * `browserOpener` only catches callers that import it across a module
 * boundary, so "nothing was sent" would quietly stop meaning "nothing was
 * sent" the first time something opened a URL another way. Nothing below
 * `routeVia` is stubbed either, so a regression that put an origin into the
 * link is still visible here.
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
  vi.restoreAllMocks();
});

/** Raise the prompt the way DRIVE raises it, then render what the shell would. */
function offer(outcome: DetourOutcome) {
  offerDetour(outcome);
  return render(<DetourOffer />);
}

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

  it('opens the route, with every stop, once the driver says yes', () => {
    offer(ROUTE);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));

    expect(opened).toHaveLength(1);
    const url = new URL(opened[0] ?? '');
    expect(url.host).toBe(ROUTE_VIA_HOST);
    expect(url.searchParams.get('waypoints')).toBe('38.93,-94.68|38.95,-94.69');
    expect(url.searchParams.get('destination')).toBe('38.97,-94.67');
    // Still not the driver's own position, even on the consented path.
    expect(url.searchParams.get('origin')).toBeNull();
    // And the question is over.
    expect(topOverlay(getScreenState())).toBeNull();
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

  it('stays open and says so when the handoff itself failed', () => {
    // Closing as though it had worked would leave a driver believing a route
    // is waiting for them in another app.
    vi.spyOn(navigateToModule, 'browserOpener').mockReturnValue(null);
    offer(ROUTE);

    fireEvent.click(screen.getByRole('button', { name: DETOUR_SEND }));

    expect(screen.getByText(DETOUR_UNAVAILABLE)).toBeInTheDocument();
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
