/**
 * Tests for scripts/generate-assets.mjs.
 *
 * Plain `node:test` + `node:assert` -- no vitest, no dependency. Run with:
 *   node --test scripts/
 *
 * The PNG codec is round-tripped against itself and against the real brand
 * master, and the manifest is asserted to carry token values rather than typed
 * ones. Nothing here asserts on how the logo LOOKS -- that is not something a
 * test can know -- but everything asserts that the logo is what was resized.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildIcon,
  buildManifest,
  circleScale,
  decodePng,
  encodePng,
  hexToRgb,
  readManifestColors,
  resize,
  square,
  toMonochromeMask,
  trimTransparent,
} from './generate-assets.mjs';

const ROOT = resolve(import.meta.dirname, '..');
/**
 * TWO MASTERS. `MARK` is white-on-transparent and is what the alpha-mask
 * derivatives (`purpose: monochrome`, the Android themed icon) are built from;
 * `ART` is the full-colour artwork the launcher shows. See rule 3 in the
 * generator's header for why a mask cannot use the artwork.
 */
const MASTER = resolve(ROOT, 'apps/pwa/public/assets/darkroute-mark.png');
const ART = resolve(ROOT, 'apps/pwa/public/assets/darkroute-icon.png');
const TOKENS = JSON.parse(readFileSync(resolve(ROOT, 'apps/pwa/src/styles/tokens.json'), 'utf8'));
const MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, 'apps/pwa/public/manifest.webmanifest'), 'utf8'),
);

/** A 2x2 image with one opaque pixel per corner colour and one transparent. */
function tinyImage() {
  return {
    width: 2,
    height: 2,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]),
  };
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

test('encode/decode round-trips exactly', () => {
  const source = tinyImage();
  const decoded = decodePng(encodePng(source));
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  assert.deepEqual([...decoded.data], [...source.data]);
});

test('the brand master decodes to its declared dimensions with real transparency', () => {
  /*
   * DIMENSIONS CHANGED WITH THE MARK, and the numbers here are pinned rather
   * than derived on purpose: a master silently replaced by a differently-shaped
   * file is exactly the accident this catches.
   *
   * 1039x568 is the solid small mark: two route lines opening around an eye,
   * waypoint squares, arrows leaving right. It is a SEPARATE DRAWING from the
   * artwork, not a reduction of it, because the artwork's eye is a halftone and
   * this file is painted as an alpha mask at 24px in the dock and at 16px in a
   * browser tab - sizes where a dither averages to one flat grey.
   */
  const master = decodePng(readFileSync(MASTER));
  assert.equal(master.width, 1039);
  assert.equal(master.height, 568);
  assert.equal(master.data.length, 1039 * 568 * 4);

  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < master.data.length; i += 4) {
    if (master.data[i] === 0) transparent += 1;
    else if (master.data[i] === 255) opaque += 1;
  }
  assert.ok(transparent > 0, 'the master must have transparent pixels');
  assert.ok(opaque > 0, 'the master must have opaque pixels');
});

test('a non-PNG is rejected rather than approximated', () => {
  assert.throws(() => decodePng(Buffer.from('this is not a png')), /signature/);
});

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

test('resize preserves a solid colour and its alpha', () => {
  const size = 8;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = 10;
    data[i * 4 + 1] = 20;
    data[i * 4 + 2] = 30;
    data[i * 4 + 3] = 200;
  }
  const out = resize({ width: size, height: size, data }, 4, 4);
  assert.equal(out.width, 4);
  for (let i = 0; i < 16; i += 1) {
    assert.deepEqual(
      [out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2], out.data[i * 4 + 3]],
      [10, 20, 30, 200],
    );
  }
});

test('resize does not pull colour out of fully transparent pixels', () => {
  // Half opaque white, half transparent black. Premultiplied averaging must
  // keep the colour white; straight averaging would grey it.
  const data = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0]);
  const out = resize({ width: 2, height: 1, data }, 1, 1);
  assert.deepEqual([out.data[0], out.data[1], out.data[2]], [255, 255, 255]);
  assert.equal(out.data[3], 128);
});

test('trimTransparent removes only alpha-zero borders', () => {
  const data = new Uint8Array(3 * 3 * 4);
  // One opaque pixel in the middle.
  data[(1 * 3 + 1) * 4 + 3] = 255;
  const out = trimTransparent({ width: 3, height: 3, data });
  assert.equal(out.width, 1);
  assert.equal(out.height, 1);
  assert.equal(out.data[3], 255);
});

test('trimTransparent returns the source untouched when there is no margin', () => {
  const source = tinyImage();
  source.data[15] = 255; // make the last pixel opaque
  assert.equal(trimTransparent(source), source);
});

test('square centres the mark and keeps its aspect ratio', () => {
  const source = { width: 4, height: 2, data: new Uint8Array(4 * 2 * 4).fill(255) };
  const out = square(source, 8, 1, null);
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
  // 4x2 scaled by 1 -> 4x4? No: scale 1 means "no scaling", so 4x2 centred.
  const opaqueRows = new Set();
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (out.data[(y * 8 + x) * 4 + 3] > 0) opaqueRows.add(y);
    }
  }
  assert.deepEqual(
    [...opaqueRows].sort((a, b) => a - b),
    [3, 4],
  );
});

test('a filled canvas is fully opaque, which is what a maskable icon must be', () => {
  const source = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(255) };
  const out = square(source, 8, 0.5, [0, 0, 0]);
  for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255);
});

test('circleScale keeps the whole mark inside the safe circle', () => {
  const source = { width: 100, height: 80, data: new Uint8Array(100 * 80 * 4) };
  const size = 512;
  const scale = circleScale(source, size, 0.8);
  const halfDiagonal = (Math.hypot(source.width, source.height) * scale) / 2;
  assert.ok(halfDiagonal <= (size * 0.8) / 2 + 1e-9);
  // And a box fit at the same ratio would NOT, which is why this exists.
  const boxHalfDiagonal = (Math.hypot(source.width, source.height) * ((size * 0.8) / 100)) / 2;
  assert.ok(boxHalfDiagonal > (size * 0.8) / 2);
});

test('the monochrome derivative is an alpha mask with white channels', () => {
  const out = toMonochromeMask(tinyImage());
  for (let i = 0; i < out.data.length; i += 4) {
    assert.equal(out.data[i], 255);
    assert.equal(out.data[i + 1], 255);
    assert.equal(out.data[i + 2], 255);
  }
  // The fully transparent pixel stays fully transparent.
  assert.equal(out.data[15], 0);
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test('hexToRgb accepts 3 and 6 digit values and rejects anything else', () => {
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('23262F'), [0x23, 0x26, 0x2f]);
  assert.throws(() => hexToRgb('#12345'), /hex/);
});

test('the manifest colours come from tokens.json, not from this script', () => {
  const colors = readManifestColors(TOKENS);
  assert.equal(colors.background_color, TOKENS.color.bg.value);
  assert.equal(colors.theme_color, TOKENS.color.bg.value);

  // Change the token, and the emitted manifest changes with it.
  const recoloured = readManifestColors({ color: { bg: { value: '#123456' } } });
  assert.equal(recoloured.background_color, '#123456');
});

test('a missing or malformed token colour fails the build instead of shipping', () => {
  assert.throws(() => readManifestColors({}), /color\.bg\.value/);
  assert.throws(() => readManifestColors({ color: { bg: { value: 'black' } } }), /hex/);
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test('buildManifest emits the fields MANIFEST TOKENS specifies', () => {
  const manifest = buildManifest(TOKENS);
  assert.equal(manifest.name, 'DarkRoute');
  assert.equal(manifest.short_name, 'DarkRoute');
  // Fullscreen, with standalone as the first step down the override chain.
  assert.equal(manifest.display, 'fullscreen');
  assert.ok(manifest.display_override.includes('standalone'));
  assert.equal(manifest.orientation, 'portrait-primary');
  assert.equal(manifest.start_url, '/?src=pwa');
  assert.deepEqual(manifest.categories, ['utility', 'navigation']);
});

test('the committed manifest matches what the generator produces', () => {
  assert.deepEqual(MANIFEST, buildManifest(TOKENS));
});

test('the icon set covers every purpose the shell needs', () => {
  const byPurpose = {};
  for (const icon of MANIFEST.icons) {
    byPurpose[icon.purpose] ??= [];
    byPurpose[icon.purpose].push(icon.sizes);
  }
  assert.deepEqual(byPurpose.any, ['192x192', '512x512']);
  // 512 launcher icon + 384 watch-safe icon.
  assert.deepEqual(byPurpose.maskable, ['512x512', '384x384']);
  // 512 monochrome + 96 notification badge.
  assert.deepEqual(byPurpose.monochrome, ['512x512', '96x96']);
});

test('every declared icon exists and is the size it claims', () => {
  for (const icon of MANIFEST.icons) {
    const file = resolve(ROOT, 'apps/pwa/public', icon.src.replace(/^\//, ''));
    const decoded = decodePng(readFileSync(file));
    assert.equal(`${decoded.width}x${decoded.height}`, icon.sizes, icon.src);
    assert.equal(icon.type, 'image/png');
  }
});

test('the manifest asks for fullscreen, and the generator owns that', () => {
  /*
   * These five fields were once hand-edited into the generated manifest, and
   * the next `generate-assets` run silently reverted every one of them - the
   * app went back to `standalone`, `getInstalledRelatedApps()` stopped being
   * able to answer, and nothing failed. A generated file has exactly one
   * author.
   */
  assert.equal(MANIFEST.display, 'fullscreen');
  assert.deepEqual(MANIFEST.display_override, ['fullscreen', 'standalone', 'minimal-ui', 'browser']);
  // The chain must degrade, never skip straight to a browser tab.
  assert.equal(MANIFEST.display_override[0], 'fullscreen');
  assert.equal(MANIFEST.display_override.at(-1), 'browser');
  assert.deepEqual(MANIFEST.launch_handler, { client_mode: 'focus-existing' });
  // `getInstalledRelatedApps()` returns nothing without this declaration, and
  // the install invite's "you already have this" branch depends on it.
  assert.ok(Array.isArray(MANIFEST.related_applications));
  assert.equal(MANIFEST.related_applications[0].platform, 'webapp');
  assert.equal(MANIFEST.prefer_related_applications, false);
});

test('no shortcut URL can carry user data', () => {
  for (const shortcut of MANIFEST.shortcuts) {
    const url = new URL(shortcut.url, 'https://flock.test');
    for (const [key] of url.searchParams) {
      assert.ok(['src', 'screen'].includes(key), `unexpected shortcut parameter: ${key}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The real icons
// ---------------------------------------------------------------------------

test('the generated icons are derived from a master, not drawn', () => {
  // icon-512 is a colour derivative, so it rebuilds from the ARTWORK. Building
  // it from the mark would produce a different file, which is the whole point
  // of this assertion: it pins that the committed bytes came out of the
  // generator, from the master the spec names.
  const art = trimTransparent(decodePng(readFileSync(ART)));
  const spec = { file: 'icon-512.png', size: 512, purpose: 'any', kind: 'transparent', ratio: 1 };
  const rebuilt = encodePng(buildIcon(art, spec, [0, 0, 0]));
  const committed = readFileSync(resolve(ROOT, 'apps/pwa/public/icons/icon-512.png'));
  assert.ok(rebuilt.equals(committed), 'icon-512.png is not what the generator produces');
});

test('the monochrome icons are built from the MARK, never the artwork', () => {
  // The failure this catches is specific and silent: a `purpose: monochrome`
  // icon is an alpha mask the platform tints, and the artwork is opaque edge to
  // edge -- so building one from it yields a fully opaque square that renders
  // as a solid filled blob in the notification shade. It would look fine in a
  // file browser and wrong on a phone.
  for (const name of ['monochrome-512.png', 'monochrome-96.png']) {
    const icon = decodePng(readFileSync(resolve(ROOT, 'apps/pwa/public/icons', name)));
    let opaque = 0;
    for (let i = 3; i < icon.data.length; i += 4) if (icon.data[i] > 250) opaque += 1;
    const fraction = opaque / (icon.data.length / 4);
    assert.ok(fraction < 0.5, `${name} is ${Math.round(fraction * 100)}% opaque - that is a blob, not a mask`);
  }
});

test('the any-purpose icons are the artwork, edge to edge', () => {
  /*
   * THIS ASSERTION USED TO BE THE OPPOSITE, and the change is deliberate.
   *
   * It required transparency, because the master was a white mark on nothing
   * and a `purpose: any` icon letterboxed it. The master for colour icons is
   * now the artwork: a designed square that carries its own rounded border and
   * background, opaque to the edge. An `any` icon is shown UNCROPPED, so an
   * opaque square is exactly right there - it is what almost every app icon on
   * a phone is.
   *
   * What still has to be true is that it is a picture rather than a flat fill,
   * which is what a broken decode or a missing master would leave behind.
   */
  for (const name of ['icon-192.png', 'icon-512.png']) {
    const icon = decodePng(readFileSync(resolve(ROOT, 'apps/pwa/public/icons', name)));
    const colours = new Set();
    for (let i = 0; i < icon.data.length; i += 4) {
      assert.equal(icon.data[i + 3], 255, `${name} has a transparent pixel`);
      colours.add((icon.data[i] << 16) | (icon.data[i + 1] << 8) | icon.data[i + 2]);
    }
    /*
     * THE THRESHOLD DROPPED FROM 1000, and the reason is the artwork, not a
     * regression. This assertion exists to catch a flat fill left behind by a
     * broken decode or a missing master; it was calibrated against a full
     * COLOUR icon, where distinct RGB triples come cheaply.
     *
     * The mark is now monochrome by design, so every pixel is a grey and R=G=B
     * collapses the count. Measured: 856 distinct values at 192px and 2,519 at
     * 512px - unambiguously a picture, and nowhere near the handful a flat fill
     * or a failed decode would produce.
     */
    assert.ok(colours.size > 200, `${name} is a flat fill, not the artwork`);
  }
});

test('the maskable icons are opaque and painted with the token background', () => {
  const [r, g, b] = hexToRgb(TOKENS.color.bg.value);
  for (const name of ['maskable-512.png', 'maskable-384.png']) {
    const icon = decodePng(readFileSync(resolve(ROOT, 'apps/pwa/public/icons', name)));
    for (let i = 3; i < icon.data.length; i += 4) {
      assert.equal(icon.data[i], 255, `${name} has a transparent pixel`);
    }
    // Top-left corner is padding, so it is the background colour.
    assert.deepEqual([icon.data[0], icon.data[1], icon.data[2]], [r, g, b]);
  }
});

test('the maskable icons bleed to the edge, because the artwork is drawn for the crop', () => {
  /*
   * THIS ASSERTION USED TO BE ITS OPPOSITE, and the reversal is the point.
   *
   * It required the mark to sit inside the safe circle, which was right while
   * the artwork was a 2.3:1 mark a launcher mask would have clipped. Insetting
   * it guaranteed survival on any shape.
   *
   * The artwork is now a SQUARE drawn for this crop, with a road lattice in the
   * corners that exists to be eaten by it. Insetting that shrinks the mark into
   * the middle of a black tile and discards the bleed - which is exactly what
   * one build shipped, and it looked like a rendering bug.
   *
   * So the property to hold is reversed: content must REACH the edges. A
   * maskable whose border is all background has silently gone back to being
   * letterboxed, and this is what says so.
   */
  const [bgR, bgG, bgB] = hexToRgb(TOKENS.color.bg.value);
  for (const [name, size] of [['maskable-512.png', 512], ['maskable-384.png', 384]]) {
    const icon = decodePng(readFileSync(resolve(ROOT, 'apps/pwa/public/icons', name)));
    // A band just inside each edge: the outermost row may legally be ground
    // even on a bled image, so sampling it would be flaky.
    const inset = Math.round(size * 0.04);
    let edgeInk = 0;
    for (let i = inset; i < size - inset; i += 1) {
      for (const [x, y] of [[i, inset], [i, size - inset - 1], [inset, i], [size - inset - 1, i]]) {
        const p = (y * size + x) * 4;
        if (icon.data[p] !== bgR || icon.data[p + 1] !== bgG || icon.data[p + 2] !== bgB) edgeInk += 1;
      }
    }
    assert.ok(
      edgeInk > 40,
      `${name} has an empty border - the artwork is letterboxed rather than bled (${edgeInk} lit edge samples)`,
    );
  }
});
