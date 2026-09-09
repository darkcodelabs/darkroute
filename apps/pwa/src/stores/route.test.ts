/**
 * CANCEL, WHICH KEEPS THE OLD LINE. The dock's E4 key disowns the plan in
 * flight and nothing else: the destination stays, a line already drawn stays,
 * and the router's late answer lands nowhere.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannedRoute } from '../services/route/planRoute.ts';

const planDarkRoute = vi.fn();
vi.mock('../services/route/darkRoute.ts', () => ({
  planDarkRoute: (...args: unknown[]) => planDarkRoute(...args),
}));

const { routeActions, useRouteStore } = await import('./route.ts');
const { usePositionStore } = await import('./position.ts');

const LINE: PlannedRoute = {
  shape: [{ lat: 38.9, lon: -94.6 }],
  miles: 1,
  seconds: 60,
  avoided: 0,
  maneuvers: [],
};

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useRouteStore.setState(useRouteStore.getInitialState(), true);
  usePositionStore.setState(
    { ...usePositionStore.getInitialState(), fix: { lat: 38.91, lon: -94.69, accuracyM: 5, timestampMs: 1 } } as never,
    true,
  );
  routeActions.setDestination({ name: 'x', lat: 38.92, lon: -94.68 } as never);
  planDarkRoute.mockReset();
});

describe('cancelPlanning', () => {
  it('drops back to idle with the destination kept, and ignores the late answer', async () => {
    const late = deferred();
    planDarkRoute.mockReturnValue(late.promise);
    routeActions.planFromHere();
    expect(useRouteStore.getState().status).toBe('planning');

    routeActions.cancelPlanning();
    expect(useRouteStore.getState().status).toBe('idle');
    expect(useRouteStore.getState().destination).not.toBeNull();

    late.resolve({ route: LINE, avoided: [], remaining: [] });
    await late.promise;
    await Promise.resolve();
    expect(useRouteStore.getState().route).toBeNull();
    expect(useRouteStore.getState().status).toBe('idle');
  });

  it('keeps a line that was already drawn', () => {
    routeActions.planned(LINE, [], []);
    planDarkRoute.mockReturnValue(new Promise(() => undefined));
    routeActions.planFromHere();
    expect(useRouteStore.getState().status).toBe('planning');
    routeActions.cancelPlanning();
    expect(useRouteStore.getState().status).toBe('ready');
    expect(useRouteStore.getState().route).toBe(LINE);
  });

  it('does nothing when nothing is being planned', () => {
    routeActions.cancelPlanning();
    expect(useRouteStore.getState().status).toBe('idle');
  });
});
