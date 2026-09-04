/**
 * WHAT THE RADIO IS HEARING, folded into something a person can read.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * Paired, the NODE screen showed five fields taken from the node roster and
 * drawn once. A roster is not traffic: it is the list of nodes this radio has
 * been told about, so it looks identical whether the antenna is hearing a busy
 * mesh, hearing packets it cannot decrypt, or hearing nothing at all because
 * the region or the modem preset is wrong. Those are the three things that
 * actually go wrong with a LoRa node, and the screen could not tell them apart.
 *
 * `onMeshPacket` fires for EVERY packet off the air, before the SDK tries to
 * decode it, so it carries the sender, the signal and the hop counts even for
 * traffic encrypted to a channel this node does not hold. That is the whole
 * trick: a packet we cannot read is still proof the radio works.
 *
 * =============================================================================
 * NOTHING HERE TRANSMITS
 * =============================================================================
 * This module folds received envelopes into state. It holds no connection, has
 * no send path, and imports nothing from the SDK. See `mesh.privacy.test.ts`.
 *
 * =============================================================================
 * PURE, AND `now` IS ALWAYS AN ARGUMENT
 * =============================================================================
 * Every function takes the current time rather than reading a clock, so ages
 * are testable and a device whose clock jumps cannot produce a negative or
 * century-long age on screen.
 */

/** How many heard nodes to keep. Beyond this the least recently heard goes. */
export const HEARD_CAP = 96;

/** The window the packet rate is counted over. */
export const RATE_WINDOW_MS = 60_000;

/**
 * Silence long enough to be worth naming.
 *
 * A bare `0` reads as broken hardware. On a quiet mesh at night zero packets a
 * minute is the correct and healthy answer, and the screen should say so in
 * words rather than leave somebody staring at a zero wondering.
 */
export const QUIET_AFTER_MS = 5 * 60_000;

/** A node this radio has personally heard, as opposed to been told about. */
export interface HeardNode {
  /** Node number, the identity the radio actually uses. */
  readonly num: number;
  /** `!433a1b2c`, which is how Meshtastic writes a node id. */
  readonly id: string;
  /** Long name, once the node announces one. Null until then. */
  readonly name: string | null;
  /** Short name, typically four characters. */
  readonly shortName: string | null;
  /** When we last heard it, on this device's clock. */
  readonly lastHeardMs: number;
  /** Signal to noise of the last packet, in dB. */
  readonly snr: number | null;
  /** Received signal strength of the last packet, in dBm. */
  readonly rssi: number | null;
  /**
   * Hops taken to reach us, or null when unknowable.
   *
   * Derived as `hopStart - hopLimit`. `hopStart` is 0 on firmware that does
   * not set it, and the difference is then meaningless rather than zero.
   */
  readonly hops: number | null;
  /** True when the packet came in over an MQTT gateway rather than the air. */
  readonly viaMqtt: boolean;
  /** True when we could not decrypt it: a different channel, still proof of life. */
  readonly encrypted: boolean;
}

export interface Instrument {
  /** Our own node number, so we never count ourselves as traffic. */
  readonly selfNum: number | null;
  /** Everything heard, newest first. Capped at `HEARD_CAP`. */
  readonly heard: readonly HeardNode[];
  /** Receive times inside the rate window, for the packets-per-minute figure. */
  readonly recentMs: readonly number[];
  /** Packets we could not decrypt, this session. */
  readonly encryptedCount: number;
  /** Packets that arrived over MQTT rather than the air, this session. */
  readonly viaMqttCount: number;
  /** Every packet counted this session, ours excluded. */
  readonly totalCount: number;
  /** When the last packet arrived, or null if none has. */
  readonly lastPacketMs: number | null;
}

export const EMPTY_INSTRUMENT: Instrument = {
  selfNum: null,
  heard: [],
  recentMs: [],
  encryptedCount: 0,
  viaMqttCount: 0,
  totalCount: 0,
  lastPacketMs: null,
};

/** One packet envelope, reduced to the fields that survive an undecodable payload. */
export interface PacketEnvelope {
  readonly from: number;
  readonly rxSnr?: number | null;
  readonly rxRssi?: number | null;
  readonly hopStart?: number | null;
  readonly hopLimit?: number | null;
  readonly viaMqtt?: boolean;
  readonly encrypted?: boolean;
}

/** `433a1b2c` -> `!433a1b2c`, which is how Meshtastic writes a node id. */
export function nodeIdOf(num: number): string {
  // `>>> 0` because a node number is unsigned and the high bit is common.
  return `!${(num >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Hops taken, or null.
 *
 * `hopStart` is absent or 0 on firmware that does not populate it, and a
 * difference against a missing start is not a hop count. Clamped at 0 because
 * a limit above the start is a malformed packet, not a negative distance.
 */
export function hopsFrom(hopStart: number | null | undefined, hopLimit: number | null | undefined): number | null {
  if (typeof hopStart !== 'number' || hopStart <= 0) return null;
  if (typeof hopLimit !== 'number' || hopLimit < 0) return null;
  return Math.max(0, hopStart - hopLimit);
}

/** Our own node, so its own transmissions never read as a busy mesh. */
export function withSelf(state: Instrument, selfNum: number | null): Instrument {
  return state.selfNum === selfNum ? state : { ...state, selfNum };
}

/**
 * Fold one received packet in.
 *
 * Our own packets are dropped entirely: a node transmits its own telemetry on
 * a timer, so counting it would show a healthy packet rate on a radio that is
 * hearing nobody at all. That is precisely the failure this screen exists to
 * make visible.
 */
export function ingestPacket(state: Instrument, packet: PacketEnvelope, now: number): Instrument {
  if (state.selfNum !== null && packet.from === state.selfNum) return state;
  if (!Number.isFinite(packet.from)) return state;
  // `0` is not a node. It is what the SDK reports before the roster has told
  // us who anyone is, and it rendered as a node called `!00000000` sitting in
  // the heard list next to real ones.
  if (packet.from === 0) return state;

  const existing = state.heard.find((n) => n.num === packet.from) ?? null;
  const next: HeardNode = {
    num: packet.from,
    id: nodeIdOf(packet.from),
    // A packet envelope carries no names. Keep whatever a NodeInfo told us.
    name: existing?.name ?? null,
    shortName: existing?.shortName ?? null,
    lastHeardMs: now,
    snr: typeof packet.rxSnr === 'number' ? packet.rxSnr : null,
    rssi: typeof packet.rxRssi === 'number' ? packet.rxRssi : null,
    hops: hopsFrom(packet.hopStart, packet.hopLimit),
    viaMqtt: packet.viaMqtt === true,
    encrypted: packet.encrypted === true,
  };

  const heard = [next, ...state.heard.filter((n) => n.num !== packet.from)].slice(0, HEARD_CAP);

  return {
    ...state,
    heard,
    recentMs: pruneRate([...state.recentMs, now], now),
    encryptedCount: state.encryptedCount + (next.encrypted ? 1 : 0),
    viaMqttCount: state.viaMqttCount + (next.viaMqtt ? 1 : 0),
    totalCount: state.totalCount + 1,
    lastPacketMs: now,
  };
}

/**
 * Attach a name the roster told us, without inventing an entry.
 *
 * A node in the roster we have never personally heard is a different fact from
 * one transmitting right now, and merging the two would be the same mistake
 * the old five-field panel made.
 */
export function nameNode(
  state: Instrument,
  num: number,
  name: string | null,
  shortName: string | null,
): Instrument {
  const found = state.heard.some((n) => n.num === num);
  if (!found) return state;
  return {
    ...state,
    heard: state.heard.map((n) =>
      n.num === num ? { ...n, name: name ?? n.name, shortName: shortName ?? n.shortName } : n,
    ),
  };
}

/** Drop receive times that have fallen out of the window. */
function pruneRate(times: readonly number[], now: number): readonly number[] {
  // A clock that jumped backwards would otherwise keep everything forever.
  return times.filter((t) => t <= now && now - t < RATE_WINDOW_MS);
}

/** Packets heard in the last minute, ours excluded. */
export function packetRate(state: Instrument, now: number): number {
  return pruneRate(state.recentMs, now).length;
}

/**
 * How the AIR readout should read.
 *
 * `quiet` is not an error and not a zero: it is the honest description of a
 * mesh with nobody on it, and saying it in words is what stops somebody
 * concluding their new node is broken.
 */
export type AirState = 'listening' | 'live' | 'quiet';

export function airState(state: Instrument, now: number): AirState {
  if (packetRate(state, now) > 0) return 'live';
  if (state.lastPacketMs === null) return 'listening';
  return now - state.lastPacketMs >= QUIET_AFTER_MS ? 'quiet' : 'listening';
}

/**
 * Age of a heard node, in whole seconds, never negative.
 *
 * A phone whose clock moves, or a node heard a moment before a time sync,
 * would otherwise render an age in the far future or the last century.
 */
export function ageSeconds(node: HeardNode, now: number): number {
  return Math.max(0, Math.round((now - node.lastHeardMs) / 1000));
}

/** `NOW`, `14S`, `3M`, `2H`. Short because it sits in a narrow column. */
export function describeAge(seconds: number): string {
  if (seconds < 3) return 'NOW';
  if (seconds < 60) return `${String(seconds)}S`;
  if (seconds < 3600) return `${String(Math.floor(seconds / 60))}M`;
  return `${String(Math.floor(seconds / 3600))}H`;
}

/** Recency band, for the rule down the left of a row. */
export type Recency = 'fresh' | 'stale';

export function recencyOf(node: HeardNode, now: number): Recency {
  return ageSeconds(node, now) <= 120 ? 'fresh' : 'stale';
}
