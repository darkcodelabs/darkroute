/**
 * VENDOR THE BASEMAP'S GLYPHS AND SPRITES - so the map asks nobody but us.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * The style used to point `glyphs` and `sprite` at protomaps.github.io. The
 * comment defending that said they are "static assets, not a tile service keyed
 * to a position", which is half true and misses the half that matters: it is
 * still a request from the driver's device to a third party, carrying their IP,
 * a timestamp and a Referer, on a screen whose entire premise is that nobody is
 * told where the driver is. `basemap.ts` states the rule for tiles -- self-host
 * or draw nothing -- and the assets were quietly exempt from it.
 *
 * It also broke offline. No glyphs means NO STREET NAMES in a tunnel or a dead
 * zone, which is where a driver most needs to know what road they are on.
 *
 * =============================================================================
 * WHAT IS VENDORED, AND WHAT IS DELIBERATELY NOT
 * =============================================================================
 * FONTS. Three stacks, because that is what the v5 style actually asks for --
 * measured by generating the style and reading every `text-font` in it, rather
 * than guessing: Noto Sans Regular, Noto Sans Medium, Noto Sans Italic.
 *
 * Every Unicode range MapLibre can request: 256 ranges per stack, 768 files,
 * 10.9 MiB at the pinned revision. US labels are not Latin-only: mapper names
 * legitimately contain Cyrillic, CJK, Arabic and other scripts. More
 * importantly, Cloudflare Pages answers a missing static path with the SPA
 * document. MapLibre then parses `<!doctype` as a glyph protobuf and reports
 * `Unimplemented type: 4`, which looks like a corrupt map tile even though the
 * archive is sound. Shipping the complete range set removes both the missing
 * labels and that HTML-as-protobuf failure.
 *
 * The glyphs are copied into the deploy but NOT precached wholesale. The
 * service worker caches only ranges MapLibre actually asks for, so a phone does
 * not download 10.9 MiB on first install merely to cover scripts it may never
 * encounter.
 *
 * SPRITES. Every selectable flavour, at both densities. MapLibre requests the
 * @2x set on any high-DPI screen, which is every phone this app runs on, so
 * shipping only 1x is a silent icon failure on the actual target device and
 * works perfectly on the desktop where you would test it. A flavour whose
 * sprite pair is absent is worse: Pages serves the app shell for that missing
 * JSON path, MapLibre tries to parse `<!doctype` as JSON, and every road shield
 * in that view disappears.
 *
 * =============================================================================
 * PINNED
 * =============================================================================
 * basemaps-assets publishes no releases, so there is no version to depend on --
 * only a commit. ASSETS_SHA is that commit. Changing it is a deliberate act
 * with a diff, which is the point: the fonts a build shipped should be
 * knowable a year later.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** protomaps/basemaps-assets, pinned. See the header. */
export const ASSETS_SHA = '028c18f713baecad011301ff7a69acc39bcc2ae7';
const ASSETS_REPO = 'https://github.com/protomaps/basemaps-assets.git';

/**
 * The stacks the style asks for.
 *
 * Derived, not assumed: generate the style with `layers()` and collect every
 * `text-font`. If a future flavor adds a stack and it is not here, its labels
 * silently do not draw -- so `scripts/check-basemap-assets.mjs` re-derives this
 * list from the built style and fails the build when it drifts.
 */
export const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];

export const FONT_LICENSE_FILE = 'OFL.txt';
export const FONT_LICENSE_SHA256 =
  '7713cfc8e3c36d5ec4aa3d6cffe7500a1b3310f8a86d914b8ea09c2a9dee7c2d';

/** Every 256-codepoint range in MapLibre's 16-bit glyph address space. */
export const FONT_RANGES = Array.from({ length: 256 }, (_, index) => {
  const start = index * 256;
  return `${String(start)}-${String(start + 255)}`;
});

/**
 * THE SPRITE SHEETS, one per flavour the app can actually select.
 *
 * ALL FIVE OF THEM. Sprite colour is BAKED INTO THE PIXELS -- no entry in these
 * sheets carries an `sdf` flag, and per the MapLibre spec `icon-color` only
 * applies to SDF icons -- so the shield that is pure black in `black.png` is
 * pure white in `light.png` and cannot be recoloured at runtime. The app lets a
 * driver select every Protomaps flavour, so every flavour must have its own
 * JSON/PNG pair at 1x and 2x.
 *
 * The index is not portable either: `light.json` carries 53 keys against
 * `black.json`'s 18, at different offsets, so pairing one flavour's PNG with
 * another's JSON slices the wrong pixels out of the sheet.
 */
export const SPRITE_FLAVORS = ['black', 'dark', 'grayscale', 'light', 'white'];
export const SPRITE_VERSION = 'v4';
/** Static and expression-produced image names used by every shipped flavour. */
export const REQUIRED_SPRITE_IMAGES = [
  'arrow',
  'capital',
  'townspot',
  ...['generic_shield', 'US:I', 'NL:S-road'].flatMap((family) =>
    Array.from({ length: 5 }, (_, index) => `${family}-${String(index + 1)}char`),
  ),
];
export const SPRITE_LICENSE_FILE = 'LICENSE.txt';
export const SPRITE_LICENSE_SHA256 =
  '5d1eb083c5bf849216176995c7d72545f0d2ad9af469a38cd0ec2c644f20bab2';
const SPRITE_FILES = SPRITE_FLAVORS.flatMap((flavor) => [
  `${flavor}.json`,
  `${flavor}.png`,
  `${flavor}@2x.json`,
  `${flavor}@2x.png`,
]);

const OUT = 'apps/pwa/public/basemap-assets';
const SPRITE_LICENSE_SOURCE = 'scripts/tangrams-icons.LICENSE.txt';

function bytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? bytes(path) : statSync(path).size;
  }
  return total;
}

function main() {
  const tmp = '/tmp/fwm-basemap-assets';
  rmSync(tmp, { recursive: true, force: true });

  // A shallow clone of a single commit. The repo has no releases, so there is
  // no tarball to pin -- the SHA is the version.
  execFileSync('git', ['clone', '--quiet', '--depth', '1', ASSETS_REPO, tmp], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  execFileSync('git', ['-C', tmp, 'fetch', '--quiet', '--depth', '1', 'origin', ASSETS_SHA], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  execFileSync('git', ['-C', tmp, 'checkout', '--quiet', ASSETS_SHA], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'fonts'), { recursive: true });
  mkdirSync(join(OUT, 'sprites'), { recursive: true });

  let copied = 0;
  for (const stack of FONT_STACKS) {
    const from = join(tmp, 'fonts', stack);
    if (!existsSync(from)) {
      throw new Error(`font stack missing upstream: ${stack} (is ASSETS_SHA stale?)`);
    }
    mkdirSync(join(OUT, 'fonts', stack), { recursive: true });
    for (const range of FONT_RANGES) {
      const file = `${range}.pbf`;
      const src = join(from, file);
      if (!existsSync(src)) throw new Error(`range missing upstream: ${stack}/${file}`);
      cpSync(src, join(OUT, 'fonts', stack, file));
      copied += 1;
    }
  }

  for (const file of SPRITE_FILES) {
    const src = join(tmp, 'sprites', SPRITE_VERSION, file);
    if (!existsSync(src)) throw new Error(`sprite missing upstream: ${file}`);
    cpSync(src, join(OUT, 'sprites', file));
    copied += 1;
  }

  // The sprite sheets are derived from tangrams/icons. Its MIT notice must
  // travel with the substantial binary copies, not merely live behind a URL
  // in the upstream README.
  cpSync(SPRITE_LICENSE_SOURCE, join(OUT, 'sprites', SPRITE_LICENSE_FILE));
  copied += 1;

  // The font licence travels with the fonts. SIL OFL requires it.
  cpSync(join(tmp, 'fonts', FONT_LICENSE_FILE), join(OUT, 'fonts', FONT_LICENSE_FILE));
  copied += 1;

  rmSync(tmp, { recursive: true, force: true });

  const total = bytes(OUT);
  process.stdout.write(
    `vendored ${String(copied)} files, ${(total / 1024 / 1024).toFixed(2)} MB -> ${OUT}\n` +
      `  fonts:   ${FONT_STACKS.join(', ')}\n` +
      `  ranges:  ${String(FONT_RANGES.length)} (${FONT_RANGES[0]} through ${FONT_RANGES.at(-1)})\n` +
      `  sprites: ${SPRITE_VERSION}/{${SPRITE_FLAVORS.join(',')}} at 1x and 2x\n` +
      `  pinned:  ${ASSETS_SHA}\n`,
  );
}

/**
 * Run only when invoked directly, so `check-basemap-assets.mjs` can import the
 * stack and range lists rather than restating them -- which is the only way the
 * check can actually detect drift instead of ratifying its own copy.
 */
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
