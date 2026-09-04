/**
 * A JPEG THAT ACTUALLY CARRIES THE METADATA WE CLAIM TO REMOVE.
 *
 * =============================================================================
 * WHY THIS IS HAND-BUILT
 * =============================================================================
 * `preparePhoto` returns `metadataStripped: true` as a literal type. That is a
 * claim, not a check - nothing anywhere feeds it a photo with real EXIF and
 * looks at the bytes that come out. For a feature whose entire purpose is "as
 * small as possible with zero metadata attached", the guarantee being untested
 * is the part that matters.
 *
 * Encoding this by hand rather than checking in a binary is deliberate: the
 * test can then say exactly WHICH tags it planted, and a reader can see that
 * the GPS coordinates being searched for downstream are the ones written here.
 *
 * =============================================================================
 * WHAT IS PLANTED, AND WHY EACH ONE
 * =============================================================================
 * GPS IFD - latitude and longitude. The obvious one, and the whole reason this
 *   product refuses photos until stripping is proven. 51.5°N 0.13°W.
 *
 * Orientation = 6 (rotate 90° CW). Not just noise: EXIF rotation has to be
 *   BAKED INTO THE PIXELS before the tag is discarded, or every portrait photo
 *   arrives on its side. So this fixture also proves the rotation survived as
 *   geometry after the tag went away - the output must come back TALLER than
 *   it is wide, from a source that is wider than it is tall.
 *
 * IFD1 THUMBNAIL - a second, complete JPEG embedded inside the first, with its
 *   own APP1 and its own GPS block. This is the one a naive stripper misses: it
 *   deletes the APP1 it can see and leaves a whole second image, carrying the
 *   same coordinates, sitting in the file.
 *
 * Make/Model strings, so the assertion has something human-readable to fail on.
 */

const LITTLE_ENDIAN = true;

/** Tag ids, from the Exif 2.32 tables. */
const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  thumbOffset: 0x0201,
  thumbLength: 0x0202,
} as const;

const TYPE = { ascii: 2, short: 3, long: 4, rational: 5 } as const;

interface Entry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Four bytes written inline, or a writer that appends and returns an offset. */
  readonly inline?: number;
  readonly bytes?: Uint8Array;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length + 1);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

/** Degrees as three EXIF rationals: deg/1, min/1, sec*100/100. */
function gpsRationals(value: number): Uint8Array {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 100);
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  view.setUint32(0, deg, LITTLE_ENDIAN);
  view.setUint32(4, 1, LITTLE_ENDIAN);
  view.setUint32(8, min, LITTLE_ENDIAN);
  view.setUint32(12, 1, LITTLE_ENDIAN);
  view.setUint32(16, sec, LITTLE_ENDIAN);
  view.setUint32(20, 100, LITTLE_ENDIAN);
  return new Uint8Array(buf);
}

/**
 * One IFD, plus the heap its long values live in.
 *
 * `heapBase` is where the caller will place `heap` inside the TIFF block, since
 * every offset in EXIF is measured from the start of the TIFF header rather
 * than from the segment or the file.
 */
function buildIfd(
  entries: readonly Entry[],
  heapBase: number,
  nextIfdOffset: number,
): { readonly ifd: Uint8Array; readonly heap: Uint8Array } {
  const ifdBytes = 2 + entries.length * 12 + 4;
  const ifd = new Uint8Array(ifdBytes);
  const view = new DataView(ifd.buffer);
  view.setUint16(0, entries.length, LITTLE_ENDIAN);

  const heapParts: Uint8Array[] = [];
  let heapLen = 0;

  entries.forEach((entry, i) => {
    const at = 2 + i * 12;
    view.setUint16(at, entry.tag, LITTLE_ENDIAN);
    view.setUint16(at + 2, entry.type, LITTLE_ENDIAN);
    view.setUint32(at + 4, entry.count, LITTLE_ENDIAN);
    if (entry.bytes === undefined) {
      view.setUint32(at + 8, entry.inline ?? 0, LITTLE_ENDIAN);
      return;
    }
    if (entry.bytes.length <= 4) {
      const pad = new Uint8Array(4);
      pad.set(entry.bytes);
      ifd.set(pad, at + 8);
      return;
    }
    view.setUint32(at + 8, heapBase + ifdBytes + heapLen, LITTLE_ENDIAN);
    heapParts.push(entry.bytes);
    heapLen += entry.bytes.length;
  });

  view.setUint32(2 + entries.length * 12, nextIfdOffset, LITTLE_ENDIAN);

  const heap = new Uint8Array(heapLen);
  let cursor = 0;
  for (const part of heapParts) {
    heap.set(part, cursor);
    cursor += part.length;
  }
  return { ifd, heap };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The GPS coordinates planted in BOTH the main IFD and the thumbnail. */
export const PLANTED_GPS = { lat: 51.5007, lon: -0.1246 } as const;
export const PLANTED_MAKE = 'DARKROUTE-TEST-MAKE';
export const PLANTED_MODEL = 'DARKROUTE-TEST-MODEL';

/** A minimal but decodable baseline JPEG of a solid colour, `size` square. */
function plainJpeg(width: number, height: number): Uint8Array {
  // A real encoder is out of scope here; the browser only has to DECODE this,
  // and the smallest thing every decoder accepts is a 1x1 baseline JPEG scaled
  // by the SOF dimensions. Built from a known-good minimal stream with the
  // dimensions patched into its SOF0 segment.
  const base = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07,
    0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f,
    0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c,
    0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d,
    0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02,
    0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11,
    0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91,
    0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09,
    0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57,
    0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77,
    0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
    0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
    0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8,
    0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08,
    0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9,
  ]);
  const out = base.slice();
  // Patch SOF0 height/width. The marker sits at a fixed offset in this stream.
  const sof = out.indexOf(0xc0, 2);
  const at = sof + 4;
  new DataView(out.buffer).setUint16(at, height, false);
  new DataView(out.buffer).setUint16(at + 2, width, false);
  return out;
}

/**
 * Build the APP1 payload: TIFF header, IFD0 (with GPS + Orientation), IFD1
 * (with a thumbnail pointer), and the thumbnail's own bytes.
 */
function exifApp1(thumbnail: Uint8Array): Uint8Array {
  const header = new Uint8Array(8);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, 0x4949, LITTLE_ENDIAN); // "II"
  hv.setUint16(2, 42, LITTLE_ENDIAN);
  hv.setUint32(4, 8, LITTLE_ENDIAN);

  // GPS IFD, placed after IFD0 and IFD1. Offsets are resolved in two passes:
  // build with a guess, then rebuild once the real sizes are known. Simpler
  // here: fix the layout order and compute sizes up front.
  const gpsEntries: Entry[] = [
    { tag: 0x0001, type: TYPE.ascii, count: 2, bytes: ascii('N') },
    { tag: 0x0002, type: TYPE.rational, count: 3, bytes: gpsRationals(PLANTED_GPS.lat) },
    { tag: 0x0003, type: TYPE.ascii, count: 2, bytes: ascii('W') },
    { tag: 0x0004, type: TYPE.rational, count: 3, bytes: gpsRationals(PLANTED_GPS.lon) },
  ];

  const ifd0Entries = (gpsOffset: number): Entry[] => [
    { tag: TAG.make, type: TYPE.ascii, count: PLANTED_MAKE.length + 1, bytes: ascii(PLANTED_MAKE) },
    {
      tag: TAG.model,
      type: TYPE.ascii,
      count: PLANTED_MODEL.length + 1,
      bytes: ascii(PLANTED_MODEL),
    },
    // 6 = rotate 90 CW. Must survive as PIXELS after the tag is discarded.
    { tag: TAG.orientation, type: TYPE.short, count: 1, inline: 6 },
    { tag: TAG.gpsIfd, type: TYPE.long, count: 1, inline: gpsOffset },
  ];

  // Pass 1: sizes with placeholder offsets.
  const probe0 = buildIfd(ifd0Entries(0), 8, 0);
  const ifd0Size = probe0.ifd.length + probe0.heap.length;
  const ifd1Base = 8 + ifd0Size;

  const probe1 = buildIfd(
    [
      { tag: TAG.thumbOffset, type: TYPE.long, count: 1, inline: 0 },
      { tag: TAG.thumbLength, type: TYPE.long, count: 1, inline: thumbnail.length },
    ],
    ifd1Base,
    0,
  );
  const ifd1Size = probe1.ifd.length + probe1.heap.length;
  const gpsBase = ifd1Base + ifd1Size;
  const probeGps = buildIfd(gpsEntries, gpsBase, 0);
  const gpsSize = probeGps.ifd.length + probeGps.heap.length;
  const thumbBase = gpsBase + gpsSize;

  // Pass 2: real offsets.
  const built0 = buildIfd(ifd0Entries(gpsBase), 8, ifd1Base);
  const built1 = buildIfd(
    [
      { tag: TAG.thumbOffset, type: TYPE.long, count: 1, inline: thumbBase },
      { tag: TAG.thumbLength, type: TYPE.long, count: 1, inline: thumbnail.length },
    ],
    ifd1Base,
    0,
  );
  const builtGps = buildIfd(gpsEntries, gpsBase, 0);

  const tiff = concat([
    header,
    built0.ifd,
    built0.heap,
    built1.ifd,
    built1.heap,
    builtGps.ifd,
    builtGps.heap,
    thumbnail,
  ]);

  const marker = ascii('Exif').slice(0, 4);
  return concat([marker, new Uint8Array([0, 0]), tiff]);
}

/**
 * A landscape JPEG carrying GPS, Orientation=6 and an embedded thumbnail that
 * is itself a JPEG with its own GPS.
 */
export function exifJpegBytes(width = 640, height = 400): Uint8Array {
  const main = plainJpeg(width, height);

  // The thumbnail is a complete JPEG with its own APP1 carrying the same
  // coordinates - the segment a stripper that only walks the outer file misses.
  const thumbBase = plainJpeg(32, 20);
  const thumbApp1 = exifApp1Minimal();
  const thumbnail = concat([
    thumbBase.slice(0, 2),
    new Uint8Array([0xff, 0xe1, (thumbApp1.length + 2) >> 8, (thumbApp1.length + 2) & 0xff]),
    thumbApp1,
    thumbBase.slice(2),
  ]);

  const app1 = exifApp1(thumbnail);
  const segLen = app1.length + 2;
  return concat([
    main.slice(0, 2),
    new Uint8Array([0xff, 0xe1, segLen >> 8, segLen & 0xff]),
    app1,
    main.slice(2),
  ]);
}

/** The thumbnail's own EXIF: GPS only, no nested thumbnail. */
function exifApp1Minimal(): Uint8Array {
  const header = new Uint8Array(8);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, 0x4949, LITTLE_ENDIAN);
  hv.setUint16(2, 42, LITTLE_ENDIAN);
  hv.setUint32(4, 8, LITTLE_ENDIAN);

  const gpsEntries: Entry[] = [
    { tag: 0x0002, type: TYPE.rational, count: 3, bytes: gpsRationals(PLANTED_GPS.lat) },
    { tag: 0x0004, type: TYPE.rational, count: 3, bytes: gpsRationals(PLANTED_GPS.lon) },
  ];
  const probe0 = buildIfd([{ tag: TAG.gpsIfd, type: TYPE.long, count: 1, inline: 0 }], 8, 0);
  const gpsBase = 8 + probe0.ifd.length + probe0.heap.length;
  const built0 = buildIfd([{ tag: TAG.gpsIfd, type: TYPE.long, count: 1, inline: gpsBase }], 8, 0);
  const builtGps = buildIfd(gpsEntries, gpsBase, 0);

  const tiff = concat([header, built0.ifd, built0.heap, builtGps.ifd, builtGps.heap]);
  return concat([ascii('Exif').slice(0, 4), new Uint8Array([0, 0]), tiff]);
}
