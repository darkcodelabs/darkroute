/**
 * TALKING TO A NODE THAT IS ALREADY RUNNING FIRMWARE.
 *
 * =============================================================================
 * THIS FILE IS WHY THE PROJECT IS GPL-3.0
 * =============================================================================
 * `@meshtastic/js` is GPL-3.0-only. Linking it makes the combined work
 * GPL-3.0, and the repo was relicensed from MIT to match - see NOTICE.md. The
 * alternative was re-implementing protobufs over a BLE characteristic to dodge
 * a licence, which is more work, worse work, and a second unmaintained copy of
 * somebody else's wire format inside an app that warns people about
 * surveillance hardware.
 *
 * =============================================================================
 * MANAGE, NEVER INSTALL
 * =============================================================================
 * Bluetooth cannot flash a bare board - the ESP32 bootloader speaks UART only
 * and BLE is a service of the firmware, so a factory-fresh node has no BLE
 * stack to talk to. The former cable flasher was deleted; this file owns only
 * management after compatible firmware is already running. Keeping that
 * boundary explicit is what stops a false "pair to install" button existing.
 *
 * =============================================================================
 * LAZY AT THE RADIO BOUNDARY
 * =============================================================================
 * `import()` inside the call. The alert path must never wait on a chunk, and a
 * protobuf runtime is of no use to a driver being warned about a camera.
 *
 * =============================================================================
 * WHAT THIS IS ALLOWED TO SEND
 * =============================================================================
 * Nothing yet - it reads. When it does send, the rule is the one the rest of
 * the product keeps: a CAMERA's position may travel, because it is public,
 * already in OpenStreetMap, and not about anybody. The driver's position never
 * does. A mesh that relays "I am here" would be building the thing this app
 * exists to warn people about.
 */

/** One node the radio has heard, flattened to what a screen can render. */
import { EMPTY_INSTRUMENT, ingestPacket, nameNode, withSelf } from './instrument.ts';
import type { Instrument } from './instrument.ts';

export interface MeshNode {
  /** The node number, as hex - how Meshtastic itself names a node. */
  readonly id: string;
  /** The user-set long name, or null when the node has not announced one. */
  readonly name: string | null;
  /** Short name, typically four characters. */
  readonly shortName: string | null;
  /** Signal-to-noise ratio of the last packet, or null. */
  readonly snr: number | null;
  /** Battery percentage, or null when the node has not reported one. */
  readonly batteryPercent: number | null;
  /** How many hops away, or null when unknown. */
  readonly hopsAway: number | null;
  /** True for the node the phone is connected to. */
  readonly isSelf: boolean;
  /**
   * When the RADIO last heard this node, as its own epoch seconds.
   *
   * The radio's clock, not the phone's: a roster entry seen before this app
   * connected still has an honest age, which "since you opened the app" cannot
   * give. Null when the node has not reported one.
   */
  readonly lastHeard: number | null;
  /** Percent of airtime the mesh is using. The number that explains congestion. */
  readonly channelUtilization: number | null;
  /** Percent of airtime THIS node spends transmitting. */
  readonly airUtilTx: number | null;
  /** True once the node has announced a public key, so a DM to it can be sealed. */
  readonly hasKey: boolean;
  /** Battery voltage in volts, which a mains or solar node reports instead of a percent. */
  readonly voltage: number | null;
  /** Metres above sea level, when the node has a position and shares it. */
  readonly altitudeM: number | null;
  /** `CLIENT`, `CLIENT_BASE`, `ROUTER`... what the node is doing for the mesh. */
  readonly role: string | null;
  /** `HELTEC_V3`, `RAK4631`... the board, which explains a lot about a node. */
  readonly hardware: string | null;
  /**
   * True when the node reached us over MQTT rather than over the air.
   *
   * Worth showing plainly: an MQTT-bridged node is not evidence that anything
   * is in radio range, and a roster that hides the difference makes the mesh
   * look healthier than it is.
   */
  readonly viaMqtt: boolean;
}

/**
 * WHAT THE RADIO IS, as opposed to what it hears.
 *
 * Every field arrives free on connect: the client sends `wantConfig` and the
 * node dumps its own identity, config and channel table. Nothing here costs a
 * request and nothing here goes on the air.
 */
export interface MeshDevice {
  readonly firmware: string | null;
  readonly hardware: string | null;
  /** LoRa region, e.g. US. A node set to the wrong one hears nobody. */
  readonly region: string | null;
  /** Modem preset, e.g. LONG_FAST. Two nodes must match to hear each other. */
  readonly preset: string | null;
  readonly hopLimit: number | null;
  /** True when the node holds a keypair, which is what DMs need. */
  readonly hasKeypair: boolean;
}

/** One row of the node's channel table. */
export interface MeshChannel {
  readonly index: number;
  readonly name: string;
  /** DISABLED, PRIMARY or SECONDARY, as the node reports it. */
  readonly role: string;
}

/**
 * A text message the radio heard, with enough context to file it.
 *
 * `direct` is computed here rather than at the screen because it needs
 * `selfNum`, which only this module holds, and getting it wrong silently files
 * somebody's private message into a public thread.
 */
export interface HeardMessage {
  readonly from: number;
  /** Destination node number, or null. `0xffffffff` is broadcast. */
  readonly to: number | null;
  /** Channel index the packet arrived on. Broadcasts only. */
  readonly channel: number;
  /** True when it was addressed to this radio specifically. */
  readonly direct: boolean;
  readonly text: string;
  readonly at: number;
}

export type MeshStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface MeshState {
  readonly status: MeshStatus;
  readonly nodes: readonly MeshNode[];
  /** Human readable, safe to show. Never a stack. */
  readonly message: string;
  /** What the radio is. Null until the node has said. */
  readonly device: MeshDevice | null;
  /** The channel table, lowest index first. Empty until it arrives. */
  readonly channels: readonly MeshChannel[];
}

export interface MeshOptions {
  /**
   * Reattach to a node already authorised, without opening the chooser.
   *
   * Used on load. When no such node exists this returns null and nothing is
   * shown, so a first visit is unaffected.
   */
  readonly silent?: boolean;
  /**
   * A text message heard on the mesh.
   *
   * Receiving is unconditional: the radio hears what it hears. Sending is not,
   * and is never done by this module on its own. See `MeshSession.sendText`.
   */
  readonly onMessage?: (message: HeardMessage) => void;
}

/**
 * A live link to a node.
 *
 * Two methods, and the asymmetry is deliberate: reading happens continuously
 * and needs no method at all, while every transmission is one explicit call
 * from one button.
 */
export interface MeshSession {
  disconnect(): Promise<void>;
  /**
   * PUT TEXT ON THE AIR. The only transmit path in this feature.
   *
   * Broadcast to every node in range, stored on each of them, and on the
   * default channel the key is published in Meshtastic's own source. Called
   * from exactly one place: a person pressing send. Never from a timer, a
   * retry, or a position update.
   */
  sendText(text: string): Promise<void>;
  /**
   * THE SAME TEXT, ADDRESSED TO ONE RADIO.
   *
   * On firmware 2.5+ a direct message to a node whose public key we hold is
   * sealed to that radio - X25519 to a shared secret, then AES-256-CCM with an
   * auth tag - and the firmware FAILS CLOSED rather than downgrading: it
   * refuses to send a text DM it cannot seal, and a receiving node drops one
   * that arrives merely channel-encrypted.
   *
   * What it does NOT hide is that you transmitted, when, or to which node
   * number: the packet header is cleartext. See `MESH_DM_NOTE`.
   */
  sendDirect(to: number, text: string): Promise<void>;
  /**
   * JOIN A GROUP, which in Meshtastic means writing a SECONDARY channel.
   *
   * NOTHING GOES ON THE AIR. The admin packet is addressed to the local node,
   * and `Router::sendLocal` short-circuits packets destined for the local node
   * before the radio. This is a configuration write over the Bluetooth cable.
   *
   * NOTHING ABOUT THE DRIVER'S OWN SETUP MOVES. A secondary channel's radio
   * settings are ignored - "only psk is used", in the protobuf's own words -
   * so the primary channel, the frequency, the region and the modem preset are
   * all untouched.
   *
   * Called from a button and from nowhere else. The app joins nothing on its
   * own; `mesh.privacy.test.ts` fails the build if this ever sits inside a
   * timer or a subscription.
   */
  joinChannel(index: number, name: string, psk: Uint8Array): Promise<void>;
  /** Rename the node. `longName` rides every NodeInfo, so it is public. */
  setOwnerName(longName: string, shortName: string): Promise<void>;
  /**
   * Region, modem preset and hop limit, merged over the node's CURRENT LoRa
   * config so the fields this app does not show are not reset to defaults.
   */
  setLora(region: number, preset: number, hopLimit: number): Promise<void>;
}

/**
 * THE LIVE LINK, OWNED BY THIS MODULE AND NOT BY A COMPONENT.
 *
 * A node accepts one bluetooth client. When the handle lived in a ref on the
 * NODE screen, tapping RADAR unmounted the screen and took the link with it:
 * either the reference was dropped and the node stayed claimed by a screen
 * that no longer existed, or the screen disconnected on unmount and simply
 * walking to another part of the app cost you your node.
 *
 * Neither is what somebody means by "connected". A paired radio is a property
 * of the session, not of which screen is on top, so it lives here and survives
 * navigation. Only an explicit disconnect, or the page going away, releases it.
 */
let live: MeshSession | null = null;

/**
 * THE LAST THING THE LINK SAID, kept beside the link itself.
 *
 * Owning the session at module scope was only half of it. `onState` was still
 * a callback captured from ONE render of ONE component, so when the screen
 * unmounted and came back the radio was still connected and nothing ever told
 * the new component: it mounted with empty state, printed NO NODE, and offered
 * to connect something that was already connected.
 *
 * From the driver's side that is indistinguishable from the link dropping,
 * which is what it was reported as. So the state lives here too, and a screen
 * subscribes rather than being handed a callback.
 */
let lastState: MeshState | null = null;
let lastInstrument: Instrument = EMPTY_INSTRUMENT;

type StateListener = (state: MeshState) => void;
type InstrumentListener = (instrument: Instrument) => void;
const stateListeners = new Set<StateListener>();
const instrumentListeners = new Set<InstrumentListener>();

/** The open link, if there is one. */
export function liveSession(): MeshSession | null {
  return live;
}

/**
 * Watch the link. Called with whatever is already known, immediately, so a
 * screen that mounts onto a live connection shows it rather than asking for
 * one that exists.
 */
export function subscribeMesh(
  onState: StateListener,
  onInstrument?: InstrumentListener,
): () => void {
  stateListeners.add(onState);
  if (onInstrument !== undefined) instrumentListeners.add(onInstrument);
  if (lastState !== null) onState(lastState);
  if (onInstrument !== undefined && lastInstrument !== EMPTY_INSTRUMENT) {
    onInstrument(lastInstrument);
  }
  return () => {
    stateListeners.delete(onState);
    if (onInstrument !== undefined) instrumentListeners.delete(onInstrument);
  };
}

function publishState(state: MeshState): void {
  lastState = state;
  for (const listener of stateListeners) listener(state);
}

function publishInstrumentState(instrument: Instrument): void {
  lastInstrument = instrument;
  for (const listener of instrumentListeners) listener(instrument);
}

/** Whether this browser can open a BLE link at all. */
export function canMesh(nav: Navigator | undefined = globalThis.navigator): boolean {
  const bag = nav as unknown as { bluetooth?: unknown } | undefined;
  return globalThis.isSecureContext === true && bag?.bluetooth !== undefined;
}

/**
 * THE ENUMS, AS WORDS.
 *
 * The protobufs give integers, and an integer on screen is not an answer -
 * "region 1" tells nobody whether their radio is set for where they are. Only
 * the values a driver can act on are named; anything else prints its number,
 * which is still better than nothing and honest about being unmapped.
 */
export const REGION_NAME: Readonly<Record<number, string>> = Object.freeze({
  1: 'US', 2: 'EU 433', 3: 'EU 868', 4: 'CN', 5: 'JP', 6: 'ANZ',
  7: 'KR', 8: 'TW', 9: 'RU', 10: 'IN', 11: 'NZ 865', 12: 'TH',
  13: 'LORA 24', 14: 'UA 433', 15: 'UA 868', 16: 'MY 433', 17: 'MY 919',
  18: 'SG 923',
});

export const PRESET_NAME: Readonly<Record<number, string>> = Object.freeze({
  0: 'LONG FAST', 1: 'LONG SLOW', 2: 'VERY LONG SLOW', 3: 'MEDIUM SLOW',
  4: 'MEDIUM FAST', 5: 'SHORT SLOW', 6: 'SHORT FAST', 7: 'LONG MODERATE',
  8: 'SHORT TURBO',
});

/**
 * The current code for a region or preset NAME.
 *
 * `MeshDevice` carries the human name because that is what the screen shows.
 * Writing one back needs the number, and reversing the lookup here keeps the
 * two from drifting into disagreement - a hand-maintained second table is how a
 * radio ends up set to Malaysia because somebody renumbered a row.
 */
export function regionCode(name: string | null): number | null {
  return codeOf(REGION_NAME, name);
}

export function presetCode(name: string | null): number | null {
  return codeOf(PRESET_NAME, name);
}

function codeOf(table: Readonly<Record<number, string>>, name: string | null): number | null {
  if (name === null) return null;
  for (const [code, value] of Object.entries(table)) {
    if (value === name) return Number(code);
  }
  return null;
}

const CHANNEL_ROLE: Readonly<Record<number, string>> = Object.freeze({
  0: 'DISABLED', 1: 'PRIMARY', 2: 'SECONDARY',
});

/**
 * Boards, by `HardwareModel`. Anything unlisted prints its id rather than
 * guessing, so an unknown board reads as unknown instead of as the wrong one.
 */
const HARDWARE_NAME: Readonly<Record<number, string>> = Object.freeze({
  4: 'HELTEC V2.0', 9: 'HELTEC V3', 10: 'T-BEAM', 12: 'T-ECHO',
  31: 'RAK4631', 39: 'RAK11310', 43: 'HELTEC V3', 47: 'HELTEC WSL V3',
  50: 'STATION G1', 61: 'RPI PICO', 71: 'T-DECK', 75: 'T-WATCH S3',
  81: 'HELTEC WIRELESS TRACKER', 82: 'HELTEC WIRELESS PAPER',
  84: 'T-DECK PLUS', 93: 'SEEED XIAO S3', 103: 'T-LORA PAGER',
  106: 'HELTEC MESH NODE T114', 255: 'PRIVATE HW',
});

/**
 * What a node is doing for the mesh, by `Config_DeviceConfig_Role`.
 *
 * This is not decoration. A ROUTER repeats everything it hears and a
 * CLIENT_MUTE repeats nothing, so the roster's mix of roles is most of the
 * answer to "why is this mesh slow" or "why does nothing reach me".
 */
const ROLE_NAME: Readonly<Record<number, string>> = Object.freeze({
  0: 'CLIENT', 1: 'CLIENT_MUTE', 2: 'ROUTER', 3: 'ROUTER_CLIENT',
  4: 'REPEATER', 5: 'TRACKER', 6: 'SENSOR', 7: 'TAK', 8: 'CLIENT_HIDDEN',
  9: 'LOST_AND_FOUND', 10: 'TAK_TRACKER', 11: 'ROUTER_LATE', 12: 'CLIENT_BASE',
});

/** `!0x433a1b2c` - the form Meshtastic prints, so it matches a node's own UI. */
function nodeId(num: number): string {
  return `!${(num >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Connect to a node over Bluetooth and stream what it knows.
 *
 * MUST be called from a user gesture: `requestDevice` opens the OS chooser and
 * throws otherwise.
 *
 * Every failure is reported through `onState` rather than thrown. A pairing
 * that fails halfway leaves a user holding hardware and needing to know which
 * half - a rejected promise crossing a React boundary tells them nothing.
 */
/**
 * Whether a node this browser already has permission for is within reach.
 *
 * `navigator.bluetooth.getDevices()` lists devices this origin has been
 * granted, which is what makes a silent reconnect possible at all.
 */
/**
 * WHAT THIS BROWSER WILL ACTUALLY LET US DO ABOUT RECONNECTING.
 *
 * Reported rather than assumed. Whether a page can reattach to a node it has
 * already been granted is not something we get to decide, it varies by
 * browser and by a flag, and "the link keeps dropping" and "this browser will
 * not hand it back" look identical from the outside. Both of us were guessing.
 *
 * `getDevices` is the documented way back. In Chrome it is gated behind
 * chrome://flags/#enable-web-bluetooth-new-permissions-backend; without it the
 * method is absent or answers with nothing, and every reload costs a chooser.
 */
export interface ReconnectSupport {
  /** Whether `navigator.bluetooth.getDevices` exists at all. */
  readonly hasGetDevices: boolean;
  /** How many nodes it hands back. Zero with the method present means the flag. */
  readonly remembered: number;
  /** The permission state, when the browser will tell us. */
  readonly permission: string | null;
}

export async function reconnectSupport(): Promise<ReconnectSupport> {
  const nav = globalThis.navigator as unknown as {
    bluetooth?: { getDevices?: () => Promise<unknown[]> };
    permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> };
  };
  const getDevices = nav.bluetooth?.getDevices;
  const hasGetDevices = typeof getDevices === 'function';

  let remembered = 0;
  if (hasGetDevices) {
    try {
      remembered = (await getDevices.call(nav.bluetooth)).length;
    } catch {
      // Present and refused. Same practical answer as absent.
      remembered = 0;
    }
  }

  let permission: string | null = null;
  try {
    // Not every engine knows this descriptor; asking is free and the answer is
    // worth having when it comes.
    const status = await nav.permissions?.query?.({ name: 'bluetooth' });
    permission = status?.state ?? null;
  } catch {
    permission = null;
  }

  return { hasGetDevices, remembered, permission };
}

export async function grantedNodeCount(): Promise<number> {
  const bag = globalThis.navigator as unknown as {
    bluetooth?: { getDevices?: () => Promise<unknown[]> };
  };
  if (typeof bag.bluetooth?.getDevices !== 'function') return 0;
  try {
    return (await bag.bluetooth.getDevices()).length;
  } catch {
    // Some browsers expose the method and refuse the call. Not an error worth
    // showing: it means the same thing as having no granted device.
    return 0;
  }
}

export async function connectMesh(options: MeshOptions): Promise<MeshSession | null> {
  const { onMessage, silent = false } = options;
  // Everything the link says goes through the module, so any screen watching
  // it hears the same thing whether it was mounted at connect time or not.
  const onState = publishState;
  const onInstrument = publishInstrumentState;

  if (!canMesh()) {
    onState({
      status: 'failed',
      nodes: [],
      message: 'this browser has no web bluetooth. chrome or edge on android or a desktop does.',
      device: null,
      channels: [],
    });
    return null;
  }

  onState({
    status: 'connecting',
    nodes: [],
    message: silent ? 'reattaching to your node' : 'choose your node',
    device: null,
    channels: [],
  });

  // `Protobuf` is re-exported by the client, so the channel message and the
  // client come from one lazily-loaded chunk rather than two.
  const { BleConnection, Protobuf } = await import('@meshtastic/js');
  const { create } = await import('@bufbuild/protobuf');
  const connection = new BleConnection();

  /**
   * Accumulated by node number.
   *
   * A Map rather than an array because NodeInfo arrives repeatedly for the
   * same node - once on connect and again whenever anything about it changes -
   * and appending would grow a list of duplicates that looks like a bigger
   * mesh than exists. On an app about counting things, that is the wrong
   * direction to be wrong in.
   */
  const seen = new Map<number, MeshNode>();
  let selfNum: number | null = null;

  /**
   * WHAT THE RADIO IS ACTUALLY HEARING, as opposed to what it has been told.
   *
   * The roster above is the node's address book: it looks the same whether the
   * antenna is hearing a busy mesh, hearing packets it cannot decrypt, or
   * hearing nothing at all. `onMeshPacket` fires for every packet off the air
   * BEFORE the SDK tries to decode it, so it carries the sender, the signal and
   * the hop counts even for traffic on a channel we do not hold.
   */
  let instrument = EMPTY_INSTRUMENT;

  /**
   * Coalesced, because a busy mesh delivers packets far faster than a screen
   * needs to change and every one of these is a React render.
   */
  let instrumentTimer: ReturnType<typeof setTimeout> | null = null;
  const publishInstrument = (): void => {
    if (instrumentTimer !== null) return;
    instrumentTimer = setTimeout(() => {
      instrumentTimer = null;
      onInstrument(instrument);
    }, 250);
  };

  /** What the node has told us about itself. Filled by the config subscriptions. */
  let device: MeshDevice = {
    firmware: null,
    hardware: null,
    region: null,
    preset: null,
    hopLimit: null,
    hasKeypair: false,
  };
  const channelTable = new Map<number, MeshChannel>();

  const publish = (status: MeshStatus, message: string): void => {
    const nodes = [...seen.values()].sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    onState({
      status,
      nodes,
      message,
      device,
      channels: [...channelTable.values()].sort((a, b) => a.index - b.index),
    });
  };

  connection.events.onMyNodeInfo.subscribe((info) => {
    selfNum = info.myNodeNum;
    // So our own timed telemetry never reads as a busy mesh.
    instrument = withSelf(instrument, info.myNodeNum);
    publishInstrument();
    const existing = seen.get(info.myNodeNum);
    if (existing !== undefined) seen.set(info.myNodeNum, { ...existing, isSelf: true });
    publish('connected', 'connected');
  });

  connection.events.onNodeInfoPacket.subscribe((info) => {
    const user = info.user;
    seen.set(info.num, {
      id: nodeId(info.num),
      name: user?.longName ?? null,
      shortName: user?.shortName ?? null,
      snr: Number.isFinite(info.snr) ? info.snr : null,
      batteryPercent:
        info.deviceMetrics?.batteryLevel === undefined
          ? null
          : info.deviceMetrics.batteryLevel,
      hopsAway: info.hopsAway ?? null,
      isSelf: selfNum !== null && info.num === selfNum,
      // THE RADIO'S OWN CLOCK, not the phone's. A roster entry the node heard
      // before this app connected still has an honest age.
      lastHeard: typeof info.lastHeard === 'number' && info.lastHeard > 0 ? info.lastHeard : null,
      // The two numbers that explain a congested mesh, and which nothing in
      // this app showed anywhere until now.
      channelUtilization: info.deviceMetrics?.channelUtilization ?? null,
      airUtilTx: info.deviceMetrics?.airUtilTx ?? null,
      // Whether a direct message to this node can be sealed to it.
      hasKey: (user?.publicKey?.length ?? 0) === 32,
      // A mains or solar node reports volts and no percent, so both are carried
      // and the screen shows whichever exists rather than an empty battery.
      voltage: info.deviceMetrics?.voltage ?? null,
      altitudeM:
        typeof info.position?.altitude === 'number' && info.position.altitude !== 0
          ? info.position.altitude
          : null,
      role: user?.role === undefined ? null : ROLE_NAME[user.role] ?? String(user.role),
      hardware:
        user?.hwModel === undefined ? null : HARDWARE_NAME[user.hwModel] ?? String(user.hwModel),
      viaMqtt: info.viaMqtt === true,
    });
    // A name for a node we have heard. Deliberately does NOT create an entry:
    // being in the roster is a different fact from transmitting right now.
    instrument = nameNode(
      instrument,
      info.num,
      info.user?.longName ?? null,
      info.user?.shortName ?? null,
    );
    publishInstrument();
    publish('connected', 'connected');
  });

  /**
   * EVERY PACKET OFF THE AIR, decodable or not.
   *
   * This is the subscription that turns a still picture into a live one. It
   * fires before the SDK's decode switch, so a packet encrypted to somebody
   * else's channel still arrives here and is still proof the radio works.
   */
  /**
   * TEXT HEARD ON THE MESH.
   *
   * Unconditional: the radio hears what it hears, and pretending otherwise
   * would be lying about what is in the air around somebody.
   */
  /*
   * WHAT THE RADIO IS, AND WHY IT MIGHT BE DEAF.
   *
   * All three of these arrive FREE. `BleConnection.connect` calls `configure()`
   * unconditionally, which sends `wantConfig` and makes the node dump its own
   * identity, its config and its channel table down the cable. Subscribing
   * costs no request and puts nothing on the air.
   *
   * They are also the answer to the commonest complaint about a mesh radio -
   * "it hears nothing" - which is almost never the antenna. It is a region, a
   * modem preset or a channel that does not match the people you are trying to
   * reach, and none of those were visible anywhere in this app.
   *
   * READ ONLY. `setConfig` stays banned; this is the half that reports.
   */
  connection.events.onDeviceMetadataPacket.subscribe((packet) => {
    const meta = packet.data;
    device = {
      ...device,
      firmware: meta.firmwareVersion === '' ? null : meta.firmwareVersion,
      hardware: HARDWARE_NAME[meta.hwModel] ?? (meta.hwModel === 0 ? null : `MODEL ${String(meta.hwModel)}`),
    };
    publish('connected', 'connected');
  });

  /** The node's own LoRa config, verbatim, so writes merge instead of replace. */
  // Typed structurally rather than by name: `Protobuf` is a runtime import
  // inside this function, so its namespace is not available for annotations.
  let loraConfig: Record<string, unknown> | null = null;

  connection.events.onConfigPacket.subscribe((config) => {
    const variant = config.payloadVariant;
    if (variant.case === 'lora') {
      // THE WHOLE MESSAGE, kept so a later write can merge over it. A partial
      // `setConfig` resets every field it omits to the protobuf default, which
      // would silently re-enable transmit on a node somebody muted and drop a
      // deliberate frequency override.
      loraConfig = variant.value as unknown as Record<string, unknown>;
      device = {
        ...device,
        region: REGION_NAME[variant.value.region] ?? null,
        preset: PRESET_NAME[variant.value.modemPreset] ?? null,
        hopLimit: variant.value.hopLimit,
      };
      publish('connected', 'connected');
    }
    if (variant.case === 'security') {
      // The LENGTH only. The key bytes are never read, bound or stored - this
      // is the app asking "can this radio seal a direct message at all".
      device = { ...device, hasKeypair: (variant.value.privateKey?.length ?? 0) === 32 };
      publish('connected', 'connected');
    }
  });

  connection.events.onChannelPacket.subscribe((channel) => {
    channelTable.set(channel.index, {
      index: channel.index,
      name: channel.settings?.name ?? '',
      role: CHANNEL_ROLE[channel.role] ?? 'DISABLED',
    });
    publish('connected', 'connected');
  });

  connection.events.onMessagePacket.subscribe((packet) => {
    if (onMessage === undefined) return;
    if (typeof packet.data !== 'string' || packet.data === '') return;
    /*
     * NOT OUR OWN WORDS BACK AT US.
     *
     * The radio echoes what we send, so a message put on the air arrived here
     * as well - and this handler files everything as HEARD, which drew it in
     * the thread as if a stranger had said it. Sent messages are already
     * recorded, on the send, as ours.
     *
     * The `from === 0` arm is the same bug wearing a worse label: an echo that
     * arrives before `onMyNodeInfo` has told us our own node number has no
     * sender to compare against, and node 0 is not a node. It rendered as
     * `!00000000`, which is what put a message from nobody in the transcript.
     */
    if (packet.from === 0) return;
    if (selfNum !== null && packet.from === selfNum) return;
    /*
     * WHICH CONVERSATION THIS BELONGS TO.
     *
     * A broadcast goes to `BROADCAST_NUM` (0xffffffff) on a channel index; a
     * direct message is addressed to our own node number. Without carrying both
     * the screen cannot tell a channel from a DM, which is how the old chat
     * ended up as one undifferentiated stream - every conversation on the mesh
     * poured into a single thread, including messages meant for one person.
     */
    const to = typeof packet.to === 'number' ? packet.to : null;
    const direct = selfNum !== null && to === selfNum;
    onMessage({
      from: packet.from,
      to,
      channel: typeof packet.channel === 'number' ? packet.channel : 0,
      direct,
      text: packet.data,
      at: Date.now(),
    });
  });

  connection.events.onMeshPacket.subscribe((packet) => {
    const payload = (packet as { payloadVariant?: { case?: string } }).payloadVariant;
    instrument = ingestPacket(
      instrument,
      {
        from: packet.from,
        rxSnr: packet.rxSnr,
        rxRssi: packet.rxRssi,
        hopStart: packet.hopStart,
        hopLimit: packet.hopLimit,
        viaMqtt: packet.viaMqtt === true,
        // protobuf-es v2 oneofs are `{case, value}`. `encrypted` means we hold
        // no key for the channel it was sent on.
        encrypted: payload?.case === 'encrypted',
      },
      Date.now(),
    );
    publishInstrument();
  });

  try {
    /**
     * SILENT RECONNECT, WHICH IS WHAT MAKES A REFRESH SURVIVABLE.
     *
     * A page reload tears down the GATT link, and re-opening the chooser on
     * every reload would be its own kind of broken. `getDevices()` returns the
     * devices this origin has ALREADY been granted, and `connect({ device })`
     * attaches to one directly with no prompt.
     *
     * Only ever used for a reconnect. A first connection still goes through
     * the chooser, because picking your own radio is a decision to make once
     * rather than something a page does for you.
     */
    if (silent) {
      const known = await connection.getDevices();
      const device = known[0];
      if (device === undefined) {
        onState({ status: 'closed', nodes: [], message: 'no node paired yet', device: null, channels: [] });
        return null;
      }
      await connection.connect({ device });
    } else {
      // Opens the OS chooser. A dismissal throws, and that is an answer, not a
      // fault -- so it is reported as `closed` rather than as a failure.
      await connection.connect({});
    }
    publish('connected', 'connected');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'could not connect';
    const dismissed = /cancel|user|chooser/i.test(message);
    onState({
      status: dismissed ? 'closed' : 'failed',
      nodes: [],
      message: dismissed ? 'no node chosen' : message,
      device: null,
      channels: [],
    });
    return null;
  }

  /**
   * RELEASE THE RADIO WHEN THE PAGE GOES AWAY.
   *
   * A Meshtastic node accepts ONE bluetooth client at a time. A reload tears
   * this page down without unwinding anything, so the node was left holding a
   * link to a page context that no longer exists, and the reloaded page could
   * not get it back until the node timed the old one out. From the driver's
   * side that is "I refreshed and it died".
   *
   * `pagehide` rather than `beforeunload`: it fires on mobile, where
   * `beforeunload` is unreliable and is skipped entirely when a page enters
   * the back-forward cache.
   *
   * Best effort by nature. The browser may cut the process off mid-teardown,
   * and the node's own supervision timeout is the real backstop. Asking is
   * still strictly better than not asking.
   */
  const release = (): void => {
    try {
      // Synchronous in this SDK, which is what we want here: a page being
      // torn down is not going to await anything.
      connection.disconnect();
    } catch {
      // The page is going away. There is nobody left to tell.
    }
  };
  globalThis.addEventListener('pagehide', release);

  const session: MeshSession = {
    /**
     * The one transmit path. `refuseToSend` gates the text BEFORE it reaches
     * here; this deliberately does not re-check, because two places deciding
     * what may go on the air is how they drift apart.
     */
    async sendText(text: string): Promise<void> {
      await connection.sendText(text, 'broadcast');
    },

    async sendDirect(to: number, text: string): Promise<void> {
      // A node NUMBER, never 'broadcast'. That is the whole difference, and it
      // is what makes the firmware take its PKI path.
      await connection.sendText(text, to);
    },

    async joinChannel(index: number, name: string, psk: Uint8Array): Promise<void> {
      await connection.setChannel(
        create(Protobuf.Channel.ChannelSchema, {
          index,
          // SECONDARY, never PRIMARY. A primary channel sets the radio's
          // frequency; writing one would move somebody off the mesh they
          // already use, which is the one thing this must never do.
          role: Protobuf.Channel.Channel_Role.SECONDARY,
          settings: create(Protobuf.Channel.ChannelSettingsSchema, { name, psk }),
        }),
      );
    },


    /**
     * THE NODE'S OWN NAME.
     *
     * The owner's radio, the owner's label. Refusing this made the app less
     * useful without making anybody safer - people simply named the node in
     * another app and came back.
     *
     * `longName` is broadcast to the whole mesh in every NodeInfo, so it is
     * public by construction, and the panel says so before the field.
     */
    async setOwnerName(longName: string, shortName: string): Promise<void> {
      await connection.setOwner(
        create(Protobuf.Mesh.UserSchema, { longName, shortName }),
      );
    },

    /**
     * THE THREE SETTINGS THAT DECIDE WHETHER THE RADIO HEARS ANYBODY.
     *
     * Region, modem preset and hop limit. A node on the wrong region or preset
     * is not broken, it is somewhere else, and until now this app could point
     * that out and do nothing about it.
     *
     * WHAT IS NOT WRITTEN HERE MATTERS AS MUCH AS WHAT IS. The LoRa config
     * message also carries `txEnabled`, `overrideFrequency` and
     * `ignoreIncoming`; a partial `setConfig` would reset every field it omits
     * to its protobuf default, so this reads the node's CURRENT config and
     * writes it back with three fields changed. Passing a fresh object here
     * would silently re-enable transmit on a node somebody deliberately
     * muted, and turn off a frequency override they set on purpose.
     */
    async setLora(region: number, preset: number, hopLimit: number): Promise<void> {
      const current = loraConfig;
      if (current === null) throw new Error('the node has not sent its LoRa config yet');
      await connection.setConfig(
        create(Protobuf.Config.ConfigSchema, {
          payloadVariant: {
            case: 'lora',
            value: { ...current, region, modemPreset: preset, hopLimit },
          },
        }),
      );
    },

    async disconnect(): Promise<void> {
      globalThis.removeEventListener('pagehide', release);
      // A pending throttle would otherwise fire one last render after the
      // caller believes the link is closed.
      if (instrumentTimer !== null) {
        clearTimeout(instrumentTimer);
        instrumentTimer = null;
      }
      try {
        await connection.disconnect();
      } catch {
        // Already gone. Nothing to do and nothing worth saying.
      }
      onState({ status: 'closed', nodes: [], message: 'disconnected', device: null, channels: [] });
      if (live === session) {
        live = null;
        lastInstrument = EMPTY_INSTRUMENT;
        publishInstrumentState(EMPTY_INSTRUMENT);
      }
    },
  };

  live = session;
  return session;
}
