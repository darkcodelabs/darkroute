/**
 * THE MESH FRAME.
 *
 * Two things are being defended here and only one of them is round-tripping.
 *
 * The other is that EVERYTHING FROM THE RADIO IS HOSTILE. A packet on a shared
 * private port can come from anybody within radio range running anything, and
 * a malformed one that decoded into a camera would put a marker on a driver's
 * map at a position a stranger chose.
 */

import { describe, expect, it } from 'vitest';

import {
  SIGHTING_BYTES,
  SIGHTING_MAGIC,
  decodeSighting,
  encodeSighting,
} from './sighting.ts';
import type { Sighting } from './sighting.ts';

const CAMERA: Sighting = {
  kind: 'reported',
  lat: 38.9183,
  lon: -94.692,
  directionDeg: 223,
  osmId: 12_345_678,
};

describe('round trip', () => {
  it('survives the wire', () => {
    const bytes = encodeSighting(CAMERA);
    expect(bytes).not.toBeNull();
    expect(bytes).toHaveLength(SIGHTING_BYTES);
    const back = decodeSighting(bytes as Uint8Array);
    expect(back?.kind).toBe('reported');
    expect(back?.lat).toBeCloseTo(CAMERA.lat, 5);
    expect(back?.lon).toBeCloseTo(CAMERA.lon, 5);
    expect(back?.directionDeg).toBe(223);
    expect(back?.osmId).toBe(12_345_678);
  });

  it('keeps a southern, western camera on the right side of both axes', () => {
    // The sign bug that survives a naive test: both fields are signed, and a
    // packing that treated them as unsigned would put Buenos Aires in Siberia.
    const bytes = encodeSighting({ ...CAMERA, lat: -33.86, lon: -151.2 });
    const back = decodeSighting(bytes as Uint8Array);
    expect(back?.lat).toBeCloseTo(-33.86, 5);
    expect(back?.lon).toBeCloseTo(-151.2, 5);
  });

  it('carries "direction unknown" as a real answer', () => {
    const bytes = encodeSighting({ ...CAMERA, directionDeg: null });
    expect(decodeSighting(bytes as Uint8Array)?.directionDeg).toBeNull();
  });

  it('carries "not in osm yet" as a real answer', () => {
    const bytes = encodeSighting({ ...CAMERA, osmId: null });
    expect(decodeSighting(bytes as Uint8Array)?.osmId).toBeNull();
  });

  it('costs sixteen bytes, because airtime is the scarce thing', () => {
    expect(encodeSighting(CAMERA)).toHaveLength(16);
  });
});

describe('a hostile packet', () => {
  const good = (): Uint8Array => encodeSighting(CAMERA) as Uint8Array;

  it('is refused when the magic is wrong', () => {
    const bytes = good();
    bytes[0] = 0x00;
    expect(decodeSighting(bytes)).toBeNull();
  });

  it('is refused when it is the wrong length', () => {
    expect(decodeSighting(good().slice(0, 12))).toBeNull();
    expect(decodeSighting(new Uint8Array(64))).toBeNull();
  });

  it('is refused when the kind is one we do not know', () => {
    const bytes = good();
    bytes[1] = 99;
    expect(decodeSighting(bytes)).toBeNull();
  });

  /**
   * NULL ISLAND. A zeroed or truncated packet decodes to 0,0 -- a real
   * coordinate in the Gulf of Guinea, and never a real camera. Accepting it
   * would draw a marker for every malformed frame on the mesh.
   */
  it('is refused at null island', () => {
    const bytes = new Uint8Array(SIGHTING_BYTES);
    bytes[0] = SIGHTING_MAGIC;
    bytes[1] = 1;
    expect(decodeSighting(bytes)).toBeNull();
  });

  it('is refused when the latitude is off the earth', () => {
    const bytes = good();
    new DataView(bytes.buffer).setInt32(2, 91 * 100_000, false);
    expect(decodeSighting(bytes)).toBeNull();
  });
});

describe('what may never be on the wire', () => {
  /**
   * The rule, asserted as a shape rather than trusted to review. A camera's
   * position travels because it is public and not about anybody; the driver's
   * never does. If somebody adds a field for it, this fails.
   */
  it('has no field for the driver', () => {
    const keys = Object.keys(decodeSighting(encodeSighting(CAMERA) as Uint8Array) ?? {});
    expect(keys.sort()).toEqual(['directionDeg', 'kind', 'lat', 'lon', 'osmId']);
  });

  it('carries no more precision than the archive has', () => {
    // Five decimals, about a metre -- the same refusal `navigateTo.ts` makes,
    // because more would claim a survey nobody did.
    const bytes = encodeSighting({ ...CAMERA, lat: 38.918_312_345 });
    const back = decodeSighting(bytes as Uint8Array);
    expect(back?.lat).toBe(38.91831);
  });
});
