/**
 * The instrument is what turns "paired" into "paired and hearing something",
 * and every one of these pins a way it could quietly lie instead.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_INSTRUMENT,
  HEARD_CAP,
  QUIET_AFTER_MS,
  RATE_WINDOW_MS,
  ageSeconds,
  airState,
  describeAge,
  hopsFrom,
  ingestPacket,
  nameNode,
  nodeIdOf,
  packetRate,
  recencyOf,
  withSelf,
} from './instrument.ts';
import type { PacketEnvelope } from './instrument.ts';

const T0 = 1_700_000_000_000;

function packet(from: number, extra: Partial<PacketEnvelope> = {}): PacketEnvelope {
  return { from, ...extra };
}

describe('nodeIdOf', () => {
  it('writes a node number the way Meshtastic does', () => {
    expect(nodeIdOf(0x433a1b2c)).toBe('!433a1b2c');
  });

  it('handles a node number with the high bit set', () => {
    // Node numbers are unsigned. A signed shift would render a negative here.
    expect(nodeIdOf(0xff000001)).toBe('!ff000001');
  });
});

describe('hopsFrom', () => {
  it('is the difference when the firmware set a start', () => {
    expect(hopsFrom(3, 1)).toBe(2);
  });

  it('is null when hopStart is absent or zero', () => {
    // Firmware that does not populate hopStart would otherwise report every
    // packet as zero hops, which reads as "everyone is a direct neighbour".
    expect(hopsFrom(0, 0)).toBeNull();
    expect(hopsFrom(undefined, 3)).toBeNull();
    expect(hopsFrom(null, 3)).toBeNull();
  });

  it('never returns a negative hop count', () => {
    // A limit above the start is a malformed packet, not a negative distance.
    expect(hopsFrom(2, 5)).toBe(0);
  });
});

describe('ingestPacket', () => {
  it('lists a node from a bare envelope, before any name exists', () => {
    // The point of the panel: a packet we cannot decode still proves the radio
    // is hearing something.
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(0x1234, { encrypted: true }), T0);
    expect(s.heard).toHaveLength(1);
    expect(s.heard[0]?.id).toBe('!00001234');
    expect(s.heard[0]?.name).toBeNull();
    expect(s.encryptedCount).toBe(1);
  });

  it('IGNORES OUR OWN NODE', () => {
    // A node transmits its own telemetry on a timer. Counting it would show a
    // healthy packet rate on a radio hearing nobody, which is exactly the
    // failure this screen exists to make visible.
    const s = withSelf(EMPTY_INSTRUMENT, 0x1111);
    const after = ingestPacket(s, packet(0x1111), T0);
    expect(after).toBe(s);
    expect(after.totalCount).toBe(0);
    expect(packetRate(after, T0)).toBe(0);
  });

  it('moves a node to the top when it is heard again, without duplicating it', () => {
    let s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0);
    s = ingestPacket(s, packet(2), T0 + 1000);
    s = ingestPacket(s, packet(1), T0 + 2000);
    expect(s.heard.map((n) => n.num)).toStrictEqual([1, 2]);
    expect(s.totalCount).toBe(3);
  });

  it('keeps the newest and evicts the least recently heard at the cap', () => {
    let s = EMPTY_INSTRUMENT;
    for (let i = 0; i < HEARD_CAP + 20; i += 1) {
      s = ingestPacket(s, packet(1000 + i), T0 + i * 10);
    }
    expect(s.heard).toHaveLength(HEARD_CAP);
    // Newest first, so the most recent node is at the top and the earliest
    // ones are gone.
    expect(s.heard[0]?.num).toBe(1000 + HEARD_CAP + 19);
    expect(s.heard.some((n) => n.num === 1000)).toBe(false);
  });

  it('keeps the name a roster packet supplied when the node is heard again', () => {
    let s = ingestPacket(EMPTY_INSTRUMENT, packet(7), T0);
    s = nameNode(s, 7, 'Corner of 4th', 'C4TH');
    s = ingestPacket(s, packet(7), T0 + 5000);
    expect(s.heard[0]?.name).toBe('Corner of 4th');
    expect(s.heard[0]?.shortName).toBe('C4TH');
  });

  it('refuses a packet with a nonsense sender', () => {
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(Number.NaN), T0);
    expect(s.heard).toHaveLength(0);
  });

  it('refuses node zero, which is not a node', () => {
    // What the SDK reports before the roster names anyone. It rendered as a
    // node called !00000000 sitting in the list beside real ones.
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(0), T0);
    expect(s.heard).toHaveLength(0);
    expect(s.totalCount).toBe(0);
  });
});

describe('nameNode', () => {
  it('does not invent a heard node from a roster entry', () => {
    // Being in the roster is not the same fact as transmitting right now, and
    // merging the two is the mistake the old five-field panel made.
    const s = nameNode(EMPTY_INSTRUMENT, 42, 'Somewhere', 'SMWH');
    expect(s.heard).toHaveLength(0);
  });
});

describe('packetRate', () => {
  it('counts only what is inside the window', () => {
    let s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0);
    s = ingestPacket(s, packet(2), T0 + 30_000);
    expect(packetRate(s, T0 + 40_000)).toBe(2);
    // The first has aged out of the minute by now.
    expect(packetRate(s, T0 + RATE_WINDOW_MS + 1000)).toBe(1);
  });

  it('survives a clock that jumps backwards', () => {
    // Otherwise a future-dated entry sticks in the window forever.
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0 + 60_000);
    expect(packetRate(s, T0)).toBe(0);
  });
});

describe('airState', () => {
  it('is listening before anything has ever been heard', () => {
    // Not quiet. We have no evidence either way yet, and saying QUIET would be
    // a claim about the sky rather than about us.
    expect(airState(EMPTY_INSTRUMENT, T0)).toBe('listening');
  });

  it('is live while packets are arriving', () => {
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0);
    expect(airState(s, T0 + 1000)).toBe('live');
  });

  it('says quiet rather than zero after a long silence', () => {
    // A bare 0 reads as broken hardware. On a quiet mesh at night zero is the
    // correct and healthy answer, and it should be said in words.
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0);
    expect(airState(s, T0 + QUIET_AFTER_MS + 1)).toBe('quiet');
  });

  it('is still listening during a short gap', () => {
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0);
    expect(airState(s, T0 + RATE_WINDOW_MS + 5000)).toBe('listening');
  });
});

describe('ages', () => {
  it('never reports a negative age', () => {
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0 + 10_000);
    expect(ageSeconds(s.heard[0] as never, T0)).toBe(0);
  });

  it('reads short, because the column is narrow', () => {
    expect(describeAge(0)).toBe('NOW');
    expect(describeAge(14)).toBe('14S');
    expect(describeAge(180)).toBe('3M');
    expect(describeAge(7200)).toBe('2H');
  });

  it('bands recency at two minutes', () => {
    const s = ingestPacket(EMPTY_INSTRUMENT, packet(1), T0);
    expect(recencyOf(s.heard[0] as never, T0 + 60_000)).toBe('fresh');
    expect(recencyOf(s.heard[0] as never, T0 + 130_000)).toBe('stale');
  });
});
