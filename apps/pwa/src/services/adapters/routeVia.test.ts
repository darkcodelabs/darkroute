/**
 * THE MULTI-STOP HANDOFF, and what it is allowed to say about the driver.
 *
 * The assertions that matter here are about ABSENCE: no origin, no label, no
 * word about cameras. This adapter is the one place in the app that makes a
 * network request on the driver's behalf, so what is NOT in the URL is the
 * part that has to be pinned down by a test rather than by a comment.
 */

import { describe, expect, it, vi } from 'vitest';

import { MAX_HANDOFF_WAYPOINTS } from '../../stores/fwmCore.ts';

import { ROUTE_VIA_HOST, routeVia, routeViaUrl } from './routeVia.ts';

const END = { lat: 38.97719, lon: -94.7214 };
const VIA = [
  { lat: 38.93, lon: -94.7 },
  { lat: 38.95, lon: -94.73 },
];

function opener() {
  const opened: string[] = [];
  return { opened, open: vi.fn((url: string) => opened.push(url)) };
}

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('handing a detour to a maps app', () => {
  it('carries every stop, in the order they are met', () => {
    // The whole feature. One waypoint is a jog; the sequence is what routes a
    // driver around a run of readers, and the order is what keeps it a route
    // rather than a tour.
    const stops = params(routeViaUrl({ destination: END, via: VIA })).get('waypoints');

    expect(stops).toBe('38.93,-94.7|38.95,-94.73');
  });

  it('ends where the planner said, and drives there', () => {
    const query = params(routeViaUrl({ destination: END, via: VIA }));

    expect(query.get('destination')).toBe('38.97719,-94.7214');
    expect(query.get('travelmode')).toBe('driving');
  });

  it('NEVER puts the driver’s own position in the url', () => {
    // The same rule `navigateTo` keeps, for the same reason: the maps app
    // supplies the origin from the location permission it already holds. An
    // origin parameter would put the live fix into a URL and a server log.
    const url = routeViaUrl({ destination: END, via: VIA });

    expect(params(url).get('origin')).toBeNull();
    expect(url).not.toMatch(/saddr|origin=|from=/);
  });

  it('says nothing about why the route is shaped like this', () => {
    // A label naming a camera, an avoidance, or this app would turn a route
    // request into a statement about what the driver is doing.
    const url = routeViaUrl({ destination: END, via: VIA }).toLowerCase();

    for (const word of ['camera', 'alpr', 'avoid', 'flock', 'darkroute', 'surveillance']) {
      expect(url).not.toContain(word);
    }
  });

  it('carries no more precision than the tiles do', () => {
    const url = routeViaUrl({
      destination: { lat: 1.123456789, lon: 2.987654321 },
      via: [{ lat: 3.111111111, lon: 4.222222222 }],
    });

    expect(params(url).get('destination')).toBe('1.12346,2.98765');
    expect(params(url).get('waypoints')).toBe('3.11111,4.22222');
  });

  it('refuses a route with no stops rather than opening a plain destination', () => {
    // A driver who pressed "route around" and got directions to a point two
    // miles ahead has been handed a route that avoids nothing.
    const o = opener();

    expect(routeVia({ destination: END, via: [] }, { opener: o })).toBe('invalid');
    expect(o.open).not.toHaveBeenCalled();
  });

  it('refuses more stops than the link can carry, rather than being truncated', () => {
    // Google drops the excess silently, so the app would believe it had sent
    // twelve stops and the driver would be routed by nine of them.
    const o = opener();
    const tooMany = Array.from({ length: MAX_HANDOFF_WAYPOINTS + 1 }, (_, i) => ({
      lat: 38.9 + i / 1000,
      lon: -94.7,
    }));

    expect(routeVia({ destination: END, via: tooMany }, { opener: o })).toBe('invalid');
    expect(o.open).not.toHaveBeenCalled();
  });

  it('refuses an impossible coordinate instead of opening a map of nowhere', () => {
    const o = opener();

    expect(routeVia({ destination: { lat: 999, lon: 0 }, via: VIA }, { opener: o })).toBe(
      'invalid',
    );
    expect(routeVia({ destination: END, via: [{ lat: Number.NaN, lon: 0 }] }, { opener: o })).toBe(
      'invalid',
    );
    expect(o.open).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to open with, rather than reporting success', () => {
    expect(routeVia({ destination: END, via: VIA }, { opener: null })).toBe('unavailable');
  });

  it('opens exactly one request, to the host the prompt names', () => {
    const o = opener();

    expect(routeVia({ destination: END, via: VIA }, { opener: o })).toBe('opened');
    expect(o.opened).toHaveLength(1);
    expect(new URL(o.opened[0] ?? '').host).toBe(ROUTE_VIA_HOST);
  });
});
