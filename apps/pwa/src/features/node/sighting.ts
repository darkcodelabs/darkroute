/**
 * A CAMERA SIGHTING, AS BYTES ON THE MESH.
 *
 * =============================================================================
 * WHY THERE IS NO CUSTOM FIRMWARE UNDER THIS
 * =============================================================================
 * The obvious build was firmware for the Heltec board: RadioLib on the SX1262,
 * a frame format, an OLED status page, BLE to the phone. It was the wrong
 * build, and it is worth writing down why before somebody re-proposes it.
 *
 * Getting two radios to exchange bytes is the easy tenth of the problem. The
 * other nine tenths are things Meshtastic has already solved and tested across
 * a large deployed fleet:
 *
 *   ROUTING. A useful mesh is more than two nodes in line of sight. Managed
 *   flooding with duplicate suppression and hop limits is not a weekend.
 *
 *   ENCRYPTION. Channel keys, per-packet nonces, key exchange. Rolling our own
 *   here would be rolling our own crypto in an app whose entire pitch is that
 *   it does not leak where somebody drives.
 *
 *   THE REGULATOR. 915 MHz in the US is FCC Part 15.247, which constrains dwell
 *   time and hopping. Firmware that ignores it is not "unfinished", it is
 *   unlawful to operate, and nobody would find out from a test.
 *
 *   THE FLEET. Stock firmware is the thing the installer can flash, that other
 *   people already run, and that gets security fixes without this repo
 *   shipping a binary.
 *
 * So the node runs STOCK MESHTASTIC and the interesting part lives here, as a
 * payload on a private port. That is the documented way to extend Meshtastic
 * and it costs no firmware maintenance at all.
 *
 * =============================================================================
 * WHAT IS ALLOWED ON THE WIRE, AND WHAT NEVER IS
 * =============================================================================
 * A CAMERA's position travels. It is public, it is already in OpenStreetMap,
 * and it is not about anybody -- it is a description of a thing bolted to a
 * pole in the street.
 *
 * THE DRIVER'S POSITION NEVER TRAVELS. Not rounded, not delayed, not as a
 * bearing, not implicitly. A mesh that relayed "I am here" would be building
 * the thing this product exists to warn people about, on the user's own
 * battery. There is no field for it below and there must never be one.
 *
 * Note what that means and does not mean: sending a sighting says somebody was
 * close enough to a camera to see it, and the radio's own range bounds that.
 * That is inherent to the act of telling anyone anything, and it is bounded by
 * the driver choosing to send. It is not a coordinate.
 *
 * =============================================================================
 * WHY THE FRAME IS THIS SMALL
 * =============================================================================
 * LoRa's usable payload at the settings Meshtastic ships is a couple of
 * hundred bytes, and airtime is the scarce resource -- a long packet occupies
 * the channel for everybody. Sixteen bytes means a sighting costs almost
 * nothing to relay and many fit in one transmission.
 *
 *   0       magic + version, so a stranger's packet on a shared port is
 *           rejected rather than parsed into a camera somewhere random
 *   1       kind: reported / confirmed / disputed
 *   2..5    latitude, signed, 1e-5 degrees
 *   6..9    longitude, signed, 1e-5 degrees
 *   10..11  bearing the camera faces, degrees, or 0xFFFF for unknown
 *   12..15  osm node id truncated to 32 bits, or 0 for "not in osm yet"
 *
 * FIVE DECIMAL PLACES is about a metre, and it is what the archive itself
 * stores -- `navigateTo.ts` already refuses to print more, on the grounds that
 * it would claim a survey nobody did. Matching it here means a sighting cannot
 * carry more precision than the data it came from.
 */

export const SIGHTING_MAGIC = 0xf1;
export const SIGHTING_BYTES = 16;
/** Meshtastic's PRIVATE_APP port. Ours by convention, not by allocation. */
export const SIGHTING_PORTNUM = 256;

export type SightingKind = 'reported' | 'confirmed' | 'disputed';

const KIND_CODE: Readonly<Record<SightingKind, number>> = {
  reported: 1,
  confirmed: 2,
  disputed: 3,
};
const CODE_KIND: Readonly<Record<number, SightingKind>> = {
  1: 'reported',
  2: 'confirmed',
  3: 'disputed',
};

export interface Sighting {
  readonly kind: SightingKind;
  readonly lat: number;
  readonly lon: number;
  /** Degrees the camera faces, or null when unknown. */
  readonly directionDeg: number | null;
  /** OSM node id, truncated to 32 bits, or null when it is not in OSM yet. */
  readonly osmId: number | null;
}

/** 1e-5 degrees, matching the archive's own precision. */
const SCALE = 100_000;
const UNKNOWN_BEARING = 0xffff;

/**
 * Pack a sighting. Returns null rather than throwing on nonsense, because the
 * caller is a UI and a thrown encoder is a crash on a driving screen.
 */
export function encodeSighting(sighting: Sighting): Uint8Array | null {
  if (!Number.isFinite(sighting.lat) || Math.abs(sighting.lat) > 90) return null;
  if (!Number.isFinite(sighting.lon) || Math.abs(sighting.lon) > 180) return null;

  const bytes = new Uint8Array(SIGHTING_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = SIGHTING_MAGIC;
  bytes[1] = KIND_CODE[sighting.kind];
  view.setInt32(2, Math.round(sighting.lat * SCALE), false);
  view.setInt32(6, Math.round(sighting.lon * SCALE), false);
  view.setUint16(
    10,
    sighting.directionDeg === null || !Number.isFinite(sighting.directionDeg)
      ? UNKNOWN_BEARING
      : ((Math.round(sighting.directionDeg) % 360) + 360) % 360,
    false,
  );
  // `>>> 0` so a negative or oversized id becomes the same 32 bits both ways.
  view.setUint32(12, sighting.osmId === null ? 0 : sighting.osmId >>> 0, false);
  return bytes;
}

/**
 * Unpack a sighting, or null.
 *
 * EVERYTHING FROM THE RADIO IS HOSTILE UNTIL PARSED. A packet on a shared
 * private port can come from anybody within radio range running anything, so
 * this checks the magic, the length, the kind and the coordinate range before
 * returning, and returns null rather than a partly-filled object. A malformed
 * packet that became a camera would put a marker on a driver's map at a
 * position a stranger chose.
 */
export function decodeSighting(bytes: Uint8Array): Sighting | null {
  if (bytes.length !== SIGHTING_BYTES) return null;
  if (bytes[0] !== SIGHTING_MAGIC) return null;

  const kind = CODE_KIND[bytes[1] as number];
  if (kind === undefined) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lat = view.getInt32(2, false) / SCALE;
  const lon = view.getInt32(6, false) / SCALE;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  // 0,0 is null island: a real camera is never there, and it is what a zeroed
  // or truncated packet decodes to.
  if (lat === 0 && lon === 0) return null;

  const bearing = view.getUint16(10, false);
  const osmId = view.getUint32(12, false);

  return {
    kind,
    lat,
    lon,
    directionDeg: bearing === UNKNOWN_BEARING ? null : bearing % 360,
    osmId: osmId === 0 ? null : osmId,
  };
}
