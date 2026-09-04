#!/usr/bin/env node
/**
 * generate-assets.mjs - build the PWA manifest and its icon set.
 *
 * ZERO DEPENDENCIES. node:fs, node:path and node:zlib only. Requires Node >=
 * 20.11 (`import.meta.dirname`). Adding `sharp` or an assets-generator plugin
 * would be a new dependency, a new CVE surface and a native build step, for a
 * job that is one inflate, one box filter and one deflate.
 *
 * Usage:
 *   node scripts/generate-assets.mjs
 *   node scripts/generate-assets.mjs --check     verify, write nothing, exit 1 on drift
 *   node scripts/generate-assets.mjs --root DIR
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THIS SCRIPT OBEYS
 * ---------------------------------------------------------------------------
 *
 * 1. NO DESIGN VALUE IS TYPED HERE. `background_color` and `theme_color` are
 *    read out of `apps/pwa/src/styles/tokens.json`, which is the token source
 *    of truth. If `--fwm-bg` changes, this script emits the new colour on the
 *    next run and nobody has to remember a second copy.
 *
 * 2. THE LOGO IS NEVER REDRAWN. Every icon below is a master raster - decoded,
 *    area-averaged down, and composited onto a transparent (or token-black)
 *    square. Resizing, letterboxing and the alpha-mask derivative for
 *    `purpose: monochrome` are transformations of the original pixels. Nothing
 *    draws a shape, a circle, a letter or a placeholder. If a master is missing
 *    or is a PNG variant this decoder does not handle, the script FAILS instead
 *    of inventing an icon.
 *
 * 3. THERE ARE TWO MASTERS, AND MONOCHROME CANNOT USE THE COLOUR ONE.
 *
 *    `darkroute-icon.png` is the artwork: full colour, fully opaque, edge to edge.
 *    It is what the launcher and the install prompt show.
 *
 *    `darkroute-mark.png` is the mark: white on transparent. It is what
 *    `purpose: monochrome` and the Android themed icon need, because those are
 *    ALPHA MASKS - the platform throws the colour away and tints whatever is
 *    opaque. Feeding the artwork to a mask would make every pixel opaque, and
 *    the notification badge would render as a solid filled square in the status
 *    bar. That is the whole reason `master` is a per-spec field rather than one
 *    constant.
 *
 * ---------------------------------------------------------------------------
 * WHAT COMES OUT
 * ---------------------------------------------------------------------------
 *   public/manifest.webmanifest
 *   public/icons/icon-192.png        purpose any        artwork, letterboxed
 *   public/icons/icon-512.png        purpose any        artwork, letterboxed
 *   public/icons/maskable-512.png    purpose maskable   artwork, 20% safe, token bg
 *   public/icons/monochrome-512.png  purpose monochrome MARK, alpha mask
 *   public/icons/monochrome-96.png   purpose monochrome MARK, NOTIFICATION BADGE
 *   public/icons/maskable-384.png    purpose maskable   artwork, WATCH-SAFE 70%
 *
 * The file names are constrained: scripts/check-design-values.mjs only accepts
 * generated icons matching
 *   ^apps/pwa/public/icons/(icon|maskable|monochrome|apple-touch-icon)-\d{2,4}\.png$
 * so the badge is `monochrome-96` (a badge IS a monochrome mask) and the
 * watch-safe icon is `maskable-384` (384 = the round watch face, and a circular
 * safe zone is a mask). The `purpose` field in the manifest is what actually
 * tells the platform what each one is.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// PNG decode
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Channels per pixel for each PNG colour type. Index is the colour type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

class PngError extends Error {
  name = 'PngError';
}

/**
 * Decode a PNG into `{ width, height, data }` where `data` is RGBA, 8 bits per
 * channel, un-premultiplied.
 *
 * Supported: bit depth 8, colour types 0/2/4/6, no interlacing. That is what
 * the brand master is (colour type 6, depth 8, interlace 0 - verified from its
 * IHDR). Anything else throws by name rather than being approximated.
 */
export function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PngError('not a PNG: the 8-byte signature does not match');
  }

  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length; // length + type + data + crc

    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        compression: body[10],
        filter: body[11],
        interlace: body[12],
      };
    } else if (type === 'PLTE') {
      palette = Buffer.from(body);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(body);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (header === null) throw new PngError('PNG has no IHDR chunk');
  if (header.interlace !== 0) {
    throw new PngError('interlaced PNGs are not supported; re-save the master without Adam7');
  }
  if (header.bitDepth !== 8) {
    throw new PngError(`only 8-bit PNGs are supported; this one is ${header.bitDepth}-bit`);
  }
  const channels = CHANNELS[header.colorType];
  if (channels === undefined) {
    throw new PngError(`unsupported PNG colour type ${header.colorType}`);
  }
  if (header.colorType === 3 && palette === null) {
    throw new PngError('palette PNG has no PLTE chunk');
  }
  if (idat.length === 0) throw new PngError('PNG has no IDAT data');

  const raw = inflateSync(Buffer.concat(idat));
  const scanlines = unfilter(raw, header.width, header.height, channels);
  const data = toRgba(scanlines, header, channels, palette, transparency);
  return { width: header.width, height: header.height, data };
}

/** Reverse the per-scanline filters. Returns tightly packed sample bytes. */
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;

    for (let x = 0; x < stride; x += 1) {
      const value = line[x];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = y > 0 && x >= channels ? out[prevStart + x - channels] : 0;
      let result;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + a;
          break;
        case 2:
          result = value + b;
          break;
        case 3:
          result = value + ((a + b) >> 1);
          break;
        case 4:
          result = value + paeth(a, b, c);
          break;
        default:
          throw new PngError(`unknown PNG row filter ${filter} on row ${y}`);
      }
      out[rowStart + x] = result & 0xff;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Expand any supported sample layout to straight RGBA. */
function toRgba(samples, header, channels, palette, transparency) {
  const { width, height, colorType } = header;
  const out = new Uint8Array(width * height * 4);
  const count = width * height;

  for (let i = 0; i < count; i += 1) {
    const s = i * channels;
    const d = i * 4;
    if (colorType === 0) {
      out[d] = samples[s];
      out[d + 1] = samples[s];
      out[d + 2] = samples[s];
      out[d + 3] = 255;
    } else if (colorType === 2) {
      out[d] = samples[s];
      out[d + 1] = samples[s + 1];
      out[d + 2] = samples[s + 2];
      out[d + 3] = 255;
    } else if (colorType === 3) {
      const index = samples[s];
      out[d] = palette[index * 3];
      out[d + 1] = palette[index * 3 + 1];
      out[d + 2] = palette[index * 3 + 2];
      out[d + 3] = transparency !== null && index < transparency.length ? transparency[index] : 255;
    } else if (colorType === 4) {
      out[d] = samples[s];
      out[d + 1] = samples[s];
      out[d + 2] = samples[s];
      out[d + 3] = samples[s + 1];
    } else {
      out[d] = samples[s];
      out[d + 1] = samples[s + 1];
      out[d + 2] = samples[s + 2];
      out[d + 3] = samples[s + 3];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PNG encode
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Encode straight RGBA into a non-interlaced 8-bit colour-type-6 PNG. */
export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Filter type 0 (None) on every row. Deflate does the compression; choosing
  // per-row filters would shrink the file but adds a heuristic nobody can
  // review against a reference implementation.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

/**
 * Area-average resize, alpha-premultiplied.
 *
 * Premultiplication matters: averaging straight RGBA across a transparent edge
 * pulls the colour of fully transparent pixels into the result and leaves a
 * dark halo around the mark. Premultiply, average, un-premultiply.
 */
export function resize(source, width, height) {
  const out = new Uint8Array(width * height * 4);
  const scaleX = source.width / width;
  const scaleY = source.height / height;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * scaleY));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * scaleX));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < source.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < source.width; sx += 1) {
          const s = (sy * source.width + sx) * 4;
          const alpha = source.data[s + 3];
          r += source.data[s] * alpha;
          g += source.data[s + 1] * alpha;
          b += source.data[s + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }
      const d = (y * width + x) * 4;
      if (n === 0 || a === 0) {
        out[d] = 0;
        out[d + 1] = 0;
        out[d + 2] = 0;
        out[d + 3] = 0;
      } else {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(b / a);
        out[d + 3] = Math.round(a / n);
      }
    }
  }
  return { width, height, data: out };
}

/**
 * Drop fully transparent rows and columns from the edges.
 *
 * NOT A CROP OF THE ARTWORK. The master exports with asymmetric transparent
 * margin - its opaque content sits at x[8..1265] y[46..1105] inside a
 * 1273x1236 canvas - so compositing the whole canvas would centre the *export
 * padding* rather than the mark, and the mark would sit visibly high in a
 * launcher and off-centre inside a maskable icon's safe circle. Only
 * alpha-zero border pixels are removed. Every pixel that carries any of the
 * logo survives byte-for-byte.
 *
 * Returns the source unchanged when there is nothing to trim.
 */
export function trimTransparent(source) {
  let top = source.height;
  let bottom = -1;
  let left = source.width;
  let right = -1;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (source.data[(y * source.width + x) * 4 + 3] === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  if (bottom < 0) throw new Error('the brand master is fully transparent; there is nothing to use');
  if (top === 0 && left === 0 && bottom === source.height - 1 && right === source.width - 1) {
    return source;
  }

  const width = right - left + 1;
  const height = bottom - top + 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((y + top) * source.width + left) * 4;
    data.set(source.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/**
 * The scale that fits `source` inside a square box of `size * contentRatio`.
 * Aspect ratio is preserved - the mark is not square and squashing it into one
 * would be redrawing it.
 */
export function boxScale(source, size, contentRatio) {
  const box = size * contentRatio;
  return Math.min(box / source.width, box / source.height);
}

/**
 * The scale that fits `source` inside a CIRCLE of diameter `size * ratio`.
 *
 * A rectangle inscribed in a box of width D is NOT inside a circle of diameter
 * D - its corners stick out by up to 41%. Both the maskable safe zone and the
 * watch's "circular safe zone: inner 70% of diameter" are circles, so the
 * constraint is on the mark's diagonal, not its width.
 */
export function circleScale(source, size, diameterRatio) {
  const radius = (size * diameterRatio) / 2;
  const halfDiagonal = Math.hypot(source.width, source.height) / 2;
  return radius / halfDiagonal;
}

/**
 * Centre `source` inside a `size`x`size` canvas at `scale`.
 *
 * `background` is `null` for a transparent canvas, or `[r,g,b]` to fill.
 */
export function square(source, size, scale, background) {
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const scaled = resize(source, w, h);

  const data = new Uint8Array(size * size * 4);
  if (background !== null) {
    for (let i = 0; i < size * size; i += 1) {
      data[i * 4] = background[0];
      data[i * 4 + 1] = background[1];
      data[i * 4 + 2] = background[2];
      data[i * 4 + 3] = 255;
    }
  }

  const offsetX = Math.floor((size - w) / 2);
  const offsetY = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = (y * w + x) * 4;
      const d = ((y + offsetY) * size + (x + offsetX)) * 4;
      const alpha = scaled.data[s + 3] / 255;
      if (background === null) {
        data[d] = scaled.data[s];
        data[d + 1] = scaled.data[s + 1];
        data[d + 2] = scaled.data[s + 2];
        data[d + 3] = scaled.data[s + 3];
      } else {
        // Source-over onto the opaque background. The canvas stays opaque,
        // which is what a maskable icon has to be.
        data[d] = Math.round(scaled.data[s] * alpha + data[d] * (1 - alpha));
        data[d + 1] = Math.round(scaled.data[s + 1] * alpha + data[d + 1] * (1 - alpha));
        data[d + 2] = Math.round(scaled.data[s + 2] * alpha + data[d + 2] * (1 - alpha));
        data[d + 3] = 255;
      }
    }
  }
  return { width: size, height: size, data };
}

/**
 * The `purpose: monochrome` derivative.
 *
 * A monochrome icon is an ALPHA MASK: the platform discards the colour and
 * paints the shape in its own accent colour. So the colour channels are
 * normalised to full white and the alpha is weighted by the source luminance,
 * which keeps the anti-aliased edge of the mark exactly where it was. No pixel
 * moves and no shape is drawn - this is a channel operation on the original.
 *
 * 255 here is a channel maximum, not a design colour. The rendered colour of a
 * monochrome icon is chosen by the OS and is never this value.
 */
export function toMonochromeMask(image) {
  const data = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const luma =
      (image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722) / 255;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = Math.round(image.data[i + 3] * luma);
  }
  return { width: image.width, height: image.height, data };
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** `#RGB` / `#RRGGBB` -> `[r, g, b]`. */
export function hexToRgb(hex) {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`token colour is not a 3- or 6-digit hex value: ${hex}`);
  }
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * The manifest's two colours, straight out of the token source.
 *
 * MANIFEST TOKENS (design system, section 06) renders `background #000000` and
 * `theme_color #000000`, which is `--fwm-bg`. Both are read from
 * `color.bg.value`; neither is typed into this file.
 */
export function readManifestColors(tokens) {
  const bg = tokens?.color?.bg?.value;
  if (typeof bg !== 'string') {
    throw new Error('tokens.json has no color.bg.value; the manifest colours come from there');
  }
  // Validate by parsing. A malformed token must fail the build, not ship.
  hexToRgb(bg);
  return { background_color: bg, theme_color: bg };
}

// ---------------------------------------------------------------------------
// The icon set
// ---------------------------------------------------------------------------

/**
 * Content ratios.
 *
 * ANY_RATIO 1 - a `purpose: any` icon is shown uncropped, so the art fills it.
 *
 * THE SAFE-ZONE CONSTANTS ARE GONE, ON PURPOSE. There were four here:
 * MASKABLE_RATIO 0.6, WATCH_RATIO 0.7, MASKABLE_SAFE_DIAMETER 0.8 and
 * WATCH_SAFE_DIAMETER 0.7 - two pairs saying the same thing from opposite
 * sides. None is referenced any more, because both maskable specs below ship
 * FULL BLEED: the current artwork carries its own padding, so cropping it to a
 * safe circle would inset an already-inset mark twice.
 *
 * The geometry is kept written down because it is the thing to reason from if
 * the artwork is ever replaced with a bare mark:
 *
 *   The platform's maskable safe zone is a circle covering 80% of the icon, and
 *   the design says the same thing as "maskable variant adds 20% padding"
 *   (design system, section 06, SPLASH · HOME ICON). Fitting a square mark's
 *   DIAGONAL inside that circle puts it at ~59% of the icon's width - which is
 *   the 60% the design's wording implies, and is provably inside the circle
 *   rather than approximately inside it. A watch face is the same shape with a
 *   tighter number: "circular safe zone: inner 70% of diameter" (section 07,
 *   WATCH RULES).
 *
 * `circleScale()` still implements exactly that, and a spec opts into it with
 * `safeDiameter`. See `buildIcon` for why a spec must declare one field or the
 * other and gets an exception rather than a NaN if it declares neither.
 */
const ANY_RATIO = 1;

/**
 * The two masters. See rule 3 in the header for why monochrome cannot share
 * the colour one.
 */
export const ART_MASTER = 'apps/pwa/public/assets/darkroute-icon.png';
export const MARK_MASTER = 'apps/pwa/public/assets/darkroute-mark.png';

/** Every derivative, in manifest order. `kind` picks the transformation. */
const ICON_SPECS = [
  { file: 'icon-192.png', size: 192, purpose: 'any', kind: 'transparent', ratio: ANY_RATIO, master: ART_MASTER },
  { file: 'icon-512.png', size: 512, purpose: 'any', kind: 'transparent', ratio: ANY_RATIO, master: ART_MASTER },
  {
    file: 'maskable-512.png',
    size: 512,
    purpose: 'maskable',
    kind: 'filled',
    /*
     * FULL BLEED, NOT THE SAFE CIRCLE. `safeDiameter` exists for a mark that
     * would otherwise be clipped, and it insets the whole image to guarantee
     * it survives any launcher shape. The artwork is now DRAWN for this: it is
     * square, and its corners carry a road lattice that is meant to be cropped.
     * Insetting it again shrinks the mark into the middle of a black tile and
     * throws away the bleed that was the point of the square render.
     */
    ratio: ANY_RATIO,
    master: ART_MASTER,
  },
  {
    file: 'monochrome-512.png',
    size: 512,
    purpose: 'monochrome',
    kind: 'mask',
    ratio: ANY_RATIO,
    master: MARK_MASTER,
  },
  // The notification badge. Android renders it at ~24dp in the status bar, so
  // 96 is the largest useful source; `purpose: monochrome` is what a badge is.
  { file: 'monochrome-96.png', size: 96, purpose: 'monochrome', kind: 'mask', ratio: ANY_RATIO, master: MARK_MASTER },
  /*
   * THE FAVICON, and why it comes from the MARK rather than the artwork.
   *
   * A browser tab renders this at 16 CSS pixels. The artwork is a halftone eye
   * over a road lattice, and at 16px both average to a single grey - it would
   * be a smudge that could belong to any site. The mark is solid strokes and
   * survives, which is the whole reason it exists as a separate file.
   *
   * `filled` rather than `mask`: a favicon sits on whatever chrome the browser
   * paints, light or dark, so it has to carry its own ground instead of
   * inheriting one.
   */
  { file: 'icon-32.png', size: 32, purpose: 'favicon', kind: 'filled', ratio: ANY_RATIO, master: MARK_MASTER, crop: 'centre-square' },
  { file: 'icon-16.png', size: 16, purpose: 'favicon', kind: 'filled', ratio: ANY_RATIO, master: MARK_MASTER, crop: 'centre-square' },
  // Watch-safe: the round face is 384x384 and crops to a circle.
  {
    file: 'maskable-384.png',
    size: 384,
    purpose: 'maskable',
    kind: 'filled',
    // Same reasoning as maskable-512: the artwork carries its own bleed.
    ratio: ANY_RATIO,
    master: ART_MASTER,
  },
];

/**
 * The centre square of a wider mark.
 *
 * A THIRD MASTER WOULD HAVE BEEN THE OBVIOUS MOVE and the design gate is right
 * to refuse it: every brand image has to be derived from one of the two
 * masters, or nobody can tell whether a committed PNG is the logo or something
 * that drifted from it. So the crop happens here, from the mark, at build time.
 */
export function centreSquare(source) {
  const side = Math.min(source.width, source.height);
  const ox = Math.round((source.width - side) / 2);
  const oy = Math.round((source.height - side) / 2);
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y += 1)
    for (let x = 0; x < side; x += 1) {
      const s = ((y + oy) * source.width + x + ox) * 4;
      const d = (y * side + x) * 4;
      data[d] = source.data[s];
      data[d + 1] = source.data[s + 1];
      data[d + 2] = source.data[s + 2];
      data[d + 3] = source.data[s + 3];
    }
  return { width: side, height: side, data };
}

export function buildIcon(rawMaster, spec, backgroundRgb) {
  /*
   * THE TAB ICON IS THE MARK'S CENTRE, not the whole mark.
   *
   * The mark is 1.83:1. Fitted to the width of a 32px favicon it is 17px tall,
   * which puts the strokes under a pixel and shows a dark smudge in the tab -
   * measured, not predicted. The centre square gives the eye the full height,
   * and the arrows are what a favicon has least room for anyway.
   */
  const master = spec.crop === 'centre-square' ? centreSquare(rawMaster) : rawMaster;
  /*
   * WHICH FIT, AND WHY IT IS KEYED ON THE SPEC RATHER THAN ON `kind`.
   *
   * It used to be: `filled` means the platform crops it, so fit the SAFE
   * CIRCLE. That held while every filled icon was a wide mark that had to be
   * protected from a launcher's mask.
   *
   * It stopped holding when the artwork became a square drawn FOR that crop,
   * with a road lattice in the corners meant to be eaten. Such an icon wants
   * full bleed, and insetting it puts the mark in the middle of a black tile.
   * The favicons want the box too - they carry their own ground for the same
   * reason a maskable does, but nothing crops a browser tab.
   *
   * So the fit follows the field the spec actually declares. A `safeDiameter`
   * asks to survive a crop; a `ratio` asks to fill the box. Declaring neither
   * is a mistake, and it is a LOUD one now: the previous version silently
   * computed `circleScale(..., undefined)`, which is NaN, and produced a
   * collapsed icon that looked like an empty tile rather than an error.
   */
  if (spec.safeDiameter === undefined && spec.ratio === undefined) {
    throw new Error(`icon ${spec.file}: declare either safeDiameter or ratio`);
  }
  const scale =
    spec.safeDiameter === undefined
      ? boxScale(master, spec.size, spec.ratio)
      : circleScale(master, spec.size, spec.safeDiameter);
  const background = spec.kind === 'filled' ? backgroundRgb : null;
  const image = square(master, spec.size, scale, background);
  return spec.kind === 'mask' ? toMonochromeMask(image) : image;
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/**
 * Shortcut targets.
 *
 * `screen` is THE navigation parameter, defined by
 * `apps/pwa/src/app/screenState.ts` (`SCREEN_PARAM`). `src=shortcut` is carried
 * through untouched by that module and exists so a launch can be attributed
 * without a tracker.
 *
 * NO USER DATA IS EVER PUT IN THESE URLS, and none can be: the only values are
 * literal screen ids from a closed list.
 *
 * The design's MANIFEST TOKENS panel lists "Report camera · Sweep". This build
 * ships RADAR and REPORT instead - see
 * docs/gaps-inbox/pwa-shell.md#manifest-shortcuts-radar-not-sweep.
 */
const SHORTCUTS = [
  { name: 'RADAR', short_name: 'RADAR', url: '/?src=shortcut&screen=radar' },
  { name: 'Report camera', short_name: 'REPORT', url: '/?src=shortcut&screen=report' },
];

export function buildManifest(tokens) {
  const colors = readManifestColors(tokens);
  return {
    name: 'DarkRoute',
    short_name: 'DarkRoute',
    description: 'ALPR camera awareness for drivers. See them before they see you.',
    id: '/',
    scope: '/',
    start_url: '/?src=pwa',
    /**
     * FULLSCREEN, not standalone.
     *
     * `standalone` still paints a system status bar in `theme_color`, which is
     * a band of black above a map meant to run to the edge of the phone. This
     * app is a map with things floating on it, and the status bar is the one
     * thing that stops it being that.
     *
     * `display_override` is the graceful walk down for anything that will not
     * do fullscreen, and it is a SEPARATE FIELD from `display` on purpose: an
     * engine that does not understand `display_override` at all still reads
     * `display` and lands on fullscreen or, failing that, its own fallback.
     *
     * NOTE FOR ANYONE CHANGING THIS: an already-installed app keeps its
     * install-time display mode. Chrome picks up manifest changes but does not
     * re-apply `display` to an existing install, so testing this needs an
     * uninstall and reinstall, not a reload.
     */
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone', 'minimal-ui', 'browser'],
    /**
     * ONE WINDOW. Opening a second copy of a driving app while the first is
     * holding the GPS, the alert engine and possibly a radio link is never what
     * somebody meant by tapping the icon again.
     */
    launch_handler: { client_mode: 'focus-existing' },
    /**
     * ITSELF, so `getInstalledRelatedApps()` can answer.
     *
     * The install invite asks the browser whether a copy of this app is already
     * on the device, and that call returns nothing unless the manifest declares
     * what to look for. `prefer_related_applications: false` keeps the browser
     * offering ITS install rather than pointing at a store listing that does
     * not exist.
     *
     * NO HOSTNAME. This entry once carried `id: 'https://dev.darkroute.ai/'`,
     * which put the Access-gated admin host into a file every install fetches
     * on first load. For platform `webapp` the manifest URL is what identifies
     * the app, and `hasInstalledRelatedApp()` only ever counts the results
     * (relatedApps.ts:51) - it never reads an id - so naming a host bought
     * nothing and published something. The committed manifest was cleaned
     * during pre-public development and this generator was not, which is drift
     * the generator-matches-output test exists to catch: a generated file has
     * exactly one author, and it is this one.
     */
    related_applications: [{ platform: 'webapp', url: '/manifest.webmanifest' }],
    prefer_related_applications: false,
    orientation: 'portrait-primary',
    background_color: colors.background_color,
    theme_color: colors.theme_color,
    categories: ['utility', 'navigation'],
    /*
     * FAVICONS ARE NOT MANIFEST ICONS. The spec allows exactly `any`,
     * `maskable` and `monochrome` in `purpose`; anything else makes the whole
     * icon entry invalid, and a browser that rejects an entry can fall back to
     * having no installable icon at all. The favicon sizes are generated by the
     * same table because they are the same pipeline, and linked from the
     * document head instead - which is where a browser looks for them anyway.
     */
    icons: ICON_SPECS.filter((spec) => spec.purpose !== 'favicon').map((spec) => ({
      src: `/icons/${spec.file}`,
      sizes: `${spec.size}x${spec.size}`,
      type: 'image/png',
      purpose: spec.purpose,
    })),
    shortcuts: SHORTCUTS,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `generate-assets -- emit manifest.webmanifest and the PWA icon set

  --check       verify the committed output matches, write nothing
  --root DIR    repo root (default: the repo this script lives in)
  -h, --help    this text
`;

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') opts.check = true;
    else if (arg === '--root') {
      i += 1;
      opts.root = resolve(argv[i] ?? '');
    } else if (arg === '-h' || arg === '--help') opts.help = true;
    else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function writeIfChanged(path, contents, check, results) {
  const rel = relative(DEFAULT_ROOT, path);
  const existing = existsSync(path) ? readFileSync(path) : null;
  const same = existing !== null && existing.equals(contents);
  if (same) {
    results.push({ path: rel, status: 'unchanged', bytes: contents.length });
    return true;
  }
  if (check) {
    results.push({
      path: rel,
      status: existing === null ? 'missing' : 'stale',
      bytes: contents.length,
    });
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  results.push({
    path: rel,
    status: existing === null ? 'created' : 'updated',
    bytes: contents.length,
  });
  return true;
}

export function generate(root, check = false) {
  const tokensPath = join(root, 'apps/pwa/src/styles/tokens.json');
  const publicDir = join(root, 'apps/pwa/public');

  if (!existsSync(tokensPath)) {
    throw new Error(`token source not found: ${tokensPath}`);
  }

  /**
   * Each master decoded ONCE, however many derivatives use it.
   *
   * `trimTransparent` is what makes one code path serve both: on the mark it
   * crops the transparent margin so the logo fills its box, and on the artwork
   * -- which is fully opaque to the edge -- it finds nothing to trim and hands
   * the image straight back.
   */
  const masters = new Map();
  const masterFor = (rel) => {
    const cached = masters.get(rel);
    if (cached !== undefined) return cached;
    const path = join(root, rel);
    if (!existsSync(path)) {
      // No fallback. Drawing a stand-in icon would put a shape in the launcher
      // that nobody designed.
      throw new Error(`brand master not found: ${path}`);
    }
    const loaded = trimTransparent(decodePng(readFileSync(path)));
    masters.set(rel, loaded);
    return loaded;
  };

  const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
  const backgroundRgb = hexToRgb(readManifestColors(tokens).background_color);

  const results = [];
  let ok = true;

  const manifest = buildManifest(tokens);
  ok =
    writeIfChanged(
      join(publicDir, 'manifest.webmanifest'),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      check,
      results,
    ) && ok;

  for (const spec of ICON_SPECS) {
    const png = encodePng(buildIcon(masterFor(spec.master), spec, backgroundRgb));
    ok = writeIfChanged(join(publicDir, 'icons', spec.file), png, check, results) && ok;
  }

  return {
    ok,
    results,
    // Reported per master now that there are two, so a run says which artwork
    // it actually read rather than describing one of them as "the" master.
    masters: [...masters.entries()].map(([rel, image]) => ({
      file: rel,
      width: image.width,
      height: image.height,
    })),
  };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP}`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let report;
  try {
    report = generate(opts.root, opts.check);
  } catch (err) {
    process.stderr.write(`generate-assets failed: ${err.message}\n`);
    return 1;
  }

  process.stdout.write(
    `${report.masters.map((m) => `${m.file} ${m.width}x${m.height}`).join('\n')}\n`,
  );
  for (const entry of report.results) {
    process.stdout.write(`  ${entry.status.padEnd(9)} ${entry.path} (${entry.bytes} bytes)\n`);
  }
  if (!report.ok) {
    process.stdout.write('\ngenerated assets are out of date; run without --check\n');
    return 1;
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
