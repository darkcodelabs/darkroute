/**
 * generate-android-assets.mjs - the launcher icons and splash for the TWA.
 *
 * Same masters as the web icons (`ART_MASTER` for everything the launcher shows
 * in colour, `MARK_MASTER` for the themed icon, which is an alpha mask)
 * and the same decode/scale/encode code from `generate-assets.mjs`, so the icon
 * on the home screen and the icon in the browser's install prompt are the same
 * mark at the same proportions. Two generators drawing the same logo two ways
 * is how a brand ends up with a launcher icon nobody recognises.
 *
 * WHAT IT WRITES, and why each one exists
 *
 *   mipmap-<d>/ic_launcher.png             legacy square icon, API 25 and below
 *   mipmap-<d>/ic_launcher_round.png       legacy round icon, API 25 and below
 *   mipmap-<d>/ic_launcher_foreground.png  adaptive-icon foreground, API 26+
 *   mipmap-<d>/ic_launcher_monochrome.png  themed icon, API 33+
 *   drawable-<d>/splash.png                handed to Chrome during the handoff
 *
 * THE ADAPTIVE-ICON GEOMETRY IS NOT A GUESS
 *   The foreground canvas is 108dp and the launcher may mask it to any shape,
 *   so only the inner 66dp circle is guaranteed visible. The mark is fitted to
 *   THAT CIRCLE, not to a 66dp box - a rectangle inscribed in a box of width D
 *   has corners up to 41% outside the circle of diameter D, which is exactly
 *   how a logo ends up with its edges clipped on a round launcher.
 *   `circleScale()` in generate-assets.mjs does the diagonal arithmetic.
 *
 * BACKGROUND
 *   The adaptive background is a flat `@color/backgroundColor` (#000000,
 *   --fwm-bg) declared in the XML, so the foreground here is transparent. The
 *   legacy icons have no separate background layer, so those are composited
 *   onto the same black.
 *
 * Run: node scripts/generate-android-assets.mjs [--check]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  ART_MASTER,
  MARK_MASTER,
  buildIcon,
  decodePng,
  encodePng,
  hexToRgb,
  trimTransparent,
} from './generate-assets.mjs';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

/** Android density buckets and their multiplier against mdpi. */
const DENSITIES = [
  { dir: 'mdpi', scale: 1 },
  { dir: 'hdpi', scale: 1.5 },
  { dir: 'xhdpi', scale: 2 },
  { dir: 'xxhdpi', scale: 3 },
  { dir: 'xxxhdpi', scale: 4 },
];

/** Base sizes in dp. */
const LEGACY_ICON_DP = 48;
const ADAPTIVE_CANVAS_DP = 108;
/** The guaranteed-visible circle inside the 108dp canvas, as a ratio. */
const ADAPTIVE_SAFE_RATIO = 66 / 108;
/**
 * Splash mark size in dp. Chrome centres this over
 * SPLASH_SCREEN_BACKGROUND_COLOR; at 160dp it reads as a mark rather than as a
 * full-bleed image on both a compact phone and a tablet.
 */
const SPLASH_DP = 160;
/** How much of a legacy icon's box the mark fills. */
const LEGACY_CONTENT_RATIO = 0.78;

/** --fwm-bg, transcribed in apps/android/app/src/main/res/values/colors.xml. */
const BACKGROUND_HEX = '#000000';

function px(dp, scale) {
  return Math.round(dp * scale);
}

export function androidAssetSpecs() {
  const specs = [];
  for (const { dir, scale } of DENSITIES) {
    const mipmap = `apps/android/app/src/main/res/mipmap-${dir}`;
    const drawable = `apps/android/app/src/main/res/drawable-${dir}`;

    specs.push({
      path: `${mipmap}/ic_launcher.png`,
      size: px(LEGACY_ICON_DP, scale),
      kind: 'filled',
      safeDiameter: LEGACY_CONTENT_RATIO,
      master: ART_MASTER,
    });
    specs.push({
      path: `${mipmap}/ic_launcher_round.png`,
      size: px(LEGACY_ICON_DP, scale),
      kind: 'filled',
      safeDiameter: LEGACY_CONTENT_RATIO,
      master: ART_MASTER,
    });
    specs.push({
      path: `${mipmap}/ic_launcher_foreground.png`,
      size: px(ADAPTIVE_CANVAS_DP, scale),
      kind: 'any',
      // `any` fits to a box, so the box IS the safe circle's diameter and the
      // mark's diagonal is constrained by using the circle ratio directly.
      ratio: ADAPTIVE_SAFE_RATIO * 0.86,
      master: ART_MASTER,
    });
    specs.push({
      path: `${mipmap}/ic_launcher_monochrome.png`,
      size: px(ADAPTIVE_CANVAS_DP, scale),
      kind: 'mask',
      // THE MARK, NOT THE ARTWORK. API 33+ themed icons are alpha masks: the
      // launcher discards colour and tints whatever is opaque. The artwork is
      // opaque edge to edge, so it would theme as a solid filled square.
      ratio: ADAPTIVE_SAFE_RATIO * 0.86,
      master: MARK_MASTER,
    });
    specs.push({
      path: `${drawable}/splash.png`,
      size: px(SPLASH_DP, scale),
      kind: 'any',
      ratio: 1,
      master: ART_MASTER,
    });
  }
  return specs;
}

export function generateAndroid(root = DEFAULT_ROOT, check = false) {
  // Each master decoded once, however many densities use it.
  const masters = new Map();
  const masterFor = (rel) => {
    const cached = masters.get(rel);
    if (cached !== undefined) return cached;
    const path = join(root, rel);
    if (!existsSync(path)) {
      throw new Error(`brand master is missing: ${relative(root, path)}`);
    }
    const loaded = trimTransparent(decodePng(readFileSync(path)));
    masters.set(rel, loaded);
    return loaded;
  };
  const background = hexToRgb(BACKGROUND_HEX);

  const results = [];
  let ok = true;

  for (const spec of androidAssetSpecs()) {
    const bytes = encodePng(buildIcon(masterFor(spec.master), spec, background));
    const target = join(root, spec.path);
    const existing = existsSync(target) ? readFileSync(target) : null;

    if (existing !== null && existing.equals(bytes)) {
      results.push({ status: 'unchanged', path: spec.path, bytes: bytes.length });
      continue;
    }
    if (check) {
      ok = false;
      results.push({
        status: existing === null ? 'MISSING' : 'STALE',
        path: spec.path,
        bytes: bytes.length,
      });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    results.push({
      status: existing === null ? 'written' : 'updated',
      path: spec.path,
      bytes: bytes.length,
    });
  }

  return {
    ok,
    results,
    masters: [...masters.entries()].map(([file, image]) => ({
      file,
      width: image.width,
      height: image.height,
    })),
  };
}

function main(argv) {
  const check = argv.includes('--check');
  let report;
  try {
    report = generateAndroid(DEFAULT_ROOT, check);
  } catch (err) {
    process.stderr.write(`generate-android-assets failed: ${err.message}\n`);
    return 1;
  }
  for (const m of report.masters) {
    process.stdout.write(`master ${m.file} ${m.width}x${m.height}\n`);
  }
  for (const entry of report.results) {
    process.stdout.write(`  ${entry.status.padEnd(9)} ${entry.path} (${entry.bytes} bytes)\n`);
  }
  if (!report.ok) {
    process.stdout.write('\nandroid assets are out of date; run without --check\n');
    return 1;
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
