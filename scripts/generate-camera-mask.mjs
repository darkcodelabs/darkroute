/**
 * generate-camera-mask.mjs - the CCTV mark, as a tintable mask.
 *
 * WHY A MASK AND NOT A TRACED PATH
 *   The mark arrived as a raster, and a raster cannot take a fill - so it
 *   cannot carry the state hue or the blend ramp, which is the whole reason
 *   the emoji was rejected.
 *
 *   The obvious answer was to trace it to a path. An earlier exploratory probe
 *   used marching squares plus Douglas-Peucker and reached an IoU of 0.45
 *   against the source - it covered 3,950 of 6,848 ink pixels, because the
 *   undirected ring walk merged separate contours and `fill-rule="evenodd"`
 *   cancelled the overlap. The probe was not production tooling and is not
 *   shipped; getting the trace right would still only approximate the artwork.
 *
 *   A mask is exact. The alpha channel IS the shape, so an SVG `<mask>` over a
 *   filled rect gives the artwork pixel for pixel AND takes any colour - which
 *   is everything the path was wanted for, with none of the approximation.
 *
 * WHAT IT WRITES
 *   `apps/pwa/public/icons/camera-mask.png` - white where the source has ink,
 *   transparent everywhere else. White-on-transparent works as both a
 *   luminance and an alpha mask, so it does not depend on `mask-type`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { decodePng, encodePng, resize } from './generate-assets.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'apps/pwa/public/icons/camera-mask.png');

/** Rendered at most 26 dial units; 96 is 4x that, enough for any density. */
const SIZE = 96;

const INK_ALPHA = 128;

/** Ink -> opaque white. Everything else -> fully transparent. */
export function toMask(image) {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    // Anti-aliased edges keep their softness: coverage carries into alpha
    // rather than being thresholded, so the mark does not render jagged.
    const ink = a < INK_ALPHA ? 0 : Math.max(0, Math.min(255, Math.round(255 - luma)));
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = ink;
  }
  return { width, height, data: out };
}

/** Crop to the ink, so the mark fills its box rather than floating in margin. */
export function trim(image) {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('generate-camera-mask: the image has no ink');
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const from = ((y + minY) * width + (x + minX)) * 4;
      const to = (y * w + x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width: w, height: h, data: out };
}

export function build(sourcePath, size = SIZE) {
  const masked = trim(toMask(decodePng(readFileSync(sourcePath))));
  // Fit the long edge; the dial places it on its centre either way.
  const scale = size / Math.max(masked.width, masked.height);
  return resize(masked, Math.max(1, Math.round(masked.width * scale)), Math.max(1, Math.round(masked.height * scale)));
}

function main(argv) {
  const input = argv.find((a) => !a.startsWith('--'));
  if (input === undefined) {
    process.stderr.write('usage: node scripts/generate-camera-mask.mjs <source.png>\n');
    return 2;
  }
  const image = build(resolve(input));
  mkdirSync(dirname(OUT), { recursive: true });
  const bytes = encodePng(image);
  writeFileSync(OUT, bytes);
  process.stdout.write(
    `wrote ${String(image.width)}x${String(image.height)} mask, ${String(bytes.length)} bytes -> apps/pwa/public/icons/camera-mask.png\n`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
