/**
 * THE ROSTER TELLS THE TRUTH ABOUT A MESH THAT NEVER SAYS GOODBYE.
 *
 * Meshtastic nodes do not announce that they left, so the node database is a
 * record of everything ever heard. A roster that renders it as a list of peers
 * claims a mesh that is not there. These pin the three places that claim could
 * be smuggled back in: the online count, the null handling in every sort, and
 * the power line for nodes that have no battery.
 */

import { describe, expect, it } from 'vitest';

import {
  ONLINE_WINDOW_S,
  buildRoster,
  heardAgo,
  hopsLine,
  isOnline,
  matchesQuery,
  powerLine,
  rosterCounts,
  sortRoster,
} from './roster.ts';
import type { MeshNode } from '../node/mesh.ts';

const NOW_MS = 1_800_000_000_000;
const NOW_S = Math.round(NOW_MS / 1000);

function node(over: Partial<MeshNode> = {}): MeshNode {
  return {
    id: '!a0cccf24',
    name: 'darkroute cf24',
    shortName: 'cf24',
    snr: 6.5,
    batteryPercent: 83,
    hopsAway: 0,
    isSelf: false,
    lastHeard: NOW_S - 30,
    channelUtilization: 6.1,
    airUtilTx: 1.2,
    hasKey: true,
    voltage: 4.01,
    altitudeM: 343,
    role: 'CLIENT',
    hardware: 'HELTEC V3',
    viaMqtt: false,
    ...over,
  };
}

describe('online is a claim with a definition', () => {
  it('counts a node heard inside the window and not one outside it', () => {
    expect(isOnline(node({ lastHeard: NOW_S - ONLINE_WINDOW_S + 5 }), NOW_MS)).toBe(true);
    expect(isOnline(node({ lastHeard: NOW_S - ONLINE_WINDOW_S - 5 }), NOW_MS)).toBe(false);
  });

  it('does NOT count a node that never reported when it was heard', () => {
    // Unknown is not recent. Treating null as online would inflate the headline
    // number with nodes nobody has evidence for.
    expect(isOnline(node({ lastHeard: null }), NOW_MS)).toBe(false);
  });

  it('reports online, shown and total separately, because they disagree', () => {
    const all = [
      node({ id: '!1', lastHeard: NOW_S - 10 }),
      node({ id: '!2', lastHeard: NOW_S - 10 }),
      node({ id: '!3', lastHeard: NOW_S - 90_000 }),
      node({ id: '!4', lastHeard: null }),
    ];
    expect(rosterCounts(all, all.slice(0, 2), NOW_MS)).toEqual({ online: 2, shown: 2, total: 4 });
  });
});

describe('sorting', () => {
  it('puts UNKNOWN last in every mode, never worst', () => {
    /*
     * The rule that matters. A node with no SNR is not a node with a bad SNR.
     * If null collapsed to -Infinity, silent nodes would sort to the bottom of
     * a signal list and to the TOP of a hops list, and in both cases the screen
     * would be asserting something the radio never said.
     */
    const withValue = node({ id: '!has', snr: -20, hopsAway: 7, lastHeard: NOW_S - 99_999 });
    const withNull = node({ id: '!nul', snr: null, hopsAway: null, lastHeard: null });

    for (const sort of ['signal', 'hops', 'heard'] as const) {
      const out = sortRoster([withNull, withValue], sort);
      expect(out[out.length - 1]?.id, `${sort} put unknown before a real value`).toBe('!nul');
    }
  });

  it('orders signal best first and hops nearest first', () => {
    const ordered = sortRoster(
      [node({ id: '!low', snr: -12 }), node({ id: '!high', snr: 9 })],
      'signal',
    );
    expect(ordered[0]?.id).toBe('!high');

    const byHops = sortRoster(
      [node({ id: '!far', hopsAway: 5 }), node({ id: '!near', hopsAway: 1 })],
      'hops',
    );
    expect(byHops[0]?.id).toBe('!near');
  });

  it('falls back to the id for an unnamed node rather than to an empty string', () => {
    // Otherwise every anonymous node clusters at the top of an A-Z list under
    // nothing at all, which looks like a rendering bug and is a sorting one.
    const out = sortRoster(
      [node({ id: '!zzz', name: null }), node({ id: '!aaa', name: null })],
      'name',
    );
    expect(out.map((n) => n.id)).toEqual(['!aaa', '!zzz']);
  });

  it('does not mutate the array it was given', () => {
    const input = [node({ id: '!b', snr: 1 }), node({ id: '!a', snr: 9 })];
    const before = input.map((n) => n.id);
    sortRoster(input, 'signal');
    expect(input.map((n) => n.id)).toEqual(before);
  });
});

describe('filtering', () => {
  it('matches the node id, which is often the only handle a node has', () => {
    expect(matchesQuery(node({ name: null, shortName: null }), 'cccf')).toBe(true);
  });

  it('matches name, short name, hardware and role, case-insensitively', () => {
    expect(matchesQuery(node(), 'DARKROUTE')).toBe(true);
    expect(matchesQuery(node(), 'cf24')).toBe(true);
    expect(matchesQuery(node(), 'heltec')).toBe(true);
    expect(matchesQuery(node(), 'client')).toBe(true);
    expect(matchesQuery(node(), 'nothing here')).toBe(false);
  });

  it('treats an empty or whitespace query as no filter', () => {
    expect(matchesQuery(node(), '')).toBe(true);
    expect(matchesQuery(node(), '   ')).toBe(true);
  });

  it('filters then sorts', () => {
    const nodes = [
      node({ id: '!1', name: 'alpha', snr: 1 }),
      node({ id: '!2', name: 'beta', snr: 9 }),
      node({ id: '!3', name: 'alpine', snr: 5 }),
    ];
    const out = buildRoster(nodes, 'alp', 'signal');
    expect(out.map((n) => n.name)).toEqual(['alpine', 'alpha']);
  });
});

describe('the power line', () => {
  it('shows volts for a node that reports no percent', () => {
    // Solar and mains nodes do exactly this. Drawing an empty battery meter for
    // them would report a flat battery that is not flat.
    expect(powerLine(node({ batteryPercent: null, voltage: 4.28 }))).toBe('4.28V');
  });

  it('drops the Meshtastic 101 sentinel, which is not a charge level', () => {
    // 101 means "plugged in, no battery". Rendering it as 101% is the kind of
    // detail that makes a whole screen look untrustworthy.
    expect(powerLine(node({ batteryPercent: 101, voltage: 4.28 }))).toBe('4.28V');
  });

  it('says nothing rather than zero when the node reported no power at all', () => {
    expect(powerLine(node({ batteryPercent: null, voltage: null }))).toBeNull();
  });
});

describe('the small readouts', () => {
  it('names a direct neighbour rather than calling it zero hops', () => {
    expect(hopsLine(node({ hopsAway: 0 }))).toBe('DIRECT');
    expect(hopsLine(node({ hopsAway: 2 }))).toBe('2 HOPS');
    expect(hopsLine(node({ hopsAway: null }))).toBeNull();
  });

  it('ages against the radio clock and says NOW inside a minute and a half', () => {
    expect(heardAgo(NOW_S - 5, NOW_MS)).toBe('NOW');
    expect(heardAgo(NOW_S - 600, NOW_MS)).toBe('10M');
    expect(heardAgo(NOW_S - 7200, NOW_MS)).toBe('2H');
    expect(heardAgo(NOW_S - 172_800, NOW_MS)).toBe('2D');
    expect(heardAgo(null, NOW_MS)).toBe('—');
  });

  it('never shows a negative age when the radio clock runs ahead', () => {
    // The radio's clock and the phone's are independent and do drift.
    expect(heardAgo(NOW_S + 500, NOW_MS)).toBe('NOW');
  });
});
