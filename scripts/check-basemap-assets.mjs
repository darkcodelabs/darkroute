/**
 * ARE THE MAP'S GLYPHS AND SPRITES ACTUALLY THERE, AND STILL THE RIGHT ONES?
 *
 * =============================================================================
 * WHY
 * =============================================================================
 * `vendor-basemap-assets.mjs` cited this file as a build guard that
 * "re-derives this list and fails the build when it drifts". It did not exist.
 * A comment promising a safety net is worse than no net, because it stops
 * anybody looking for one.
 *
 * Two failures it catches, both silent at runtime:
 *
 * MISSING. MapLibre asks for `fonts/{fontstack}/{range}.pbf` and a sprite pair
 * lazily, when it first needs to draw a label or an icon. A 404 does not throw;
 * the label simply never appears. So a map with no vendored assets looks like a
 * map in an area with no street names.
 *
 * DRIFTED. The stacks are not a guess -- they are read out of the style the app
 * actually builds. If a flavour change adds a stack, or upstream renames one,
 * the style asks for a font nobody vendored and, again, labels quietly stop.
 * This re-derives the list from `layers()` rather than trusting a constant.
 *
 * THE 2x SPRITE IS NOT OPTIONAL. MapLibre requests `@2x` on any high-DPI
 * screen, which is every phone this app runs on. Shipping only 1x is a silent
 * icon failure on the actual target device that works perfectly on the desktop
 * where you would test it.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { layers, namedFlavor } from '@protomaps/basemaps';

import { FWM_MAP_VIEWS } from '../apps/pwa/src/app/mapView.ts';
import {
  FONT_LICENSE_FILE,
  FONT_LICENSE_SHA256,
  FONT_RANGES,
  REQUIRED_SPRITE_IMAGES,
  SPRITE_FLAVORS,
  SPRITE_LICENSE_FILE,
  SPRITE_LICENSE_SHA256,
} from './vendor-basemap-assets.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = join(REPO_ROOT, 'apps/pwa/public/basemap-assets');
const DIST_ROOT = join(REPO_ROOT, 'apps/pwa/dist/basemap-assets');
const SELECTABLE_FLAVORS = FWM_MAP_VIEWS.filter((flavor) => flavor !== 'auto');
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
// These are expression outputs in the road layers, not plain string literals
// that `requiredStacks()`-style traversal can discover. Their absence produced
// the exact runtime failure this gate exists to prevent: MapLibre fetched the
// missing sprite JSON, Pages returned the HTML app shell, and every shield
// disappeared behind an `Unexpected token '<'` parse error.

/**
 * The font stacks the built style actually asks for.
 *
 * Read from `layers()`, the same call `MapCanvas` makes, so this cannot drift
 * from what ships. `text-font` is sometimes a plain array and sometimes a
 * `case` expression with `literal` arrays inside it, so the whole structure is
 * walked rather than pattern-matched on the common shape.
 */
function requiredStacks() {
  const stacks = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === 'string') stacks.add(value);
  };
  for (const flavor of SELECTABLE_FLAVORS) {
    for (const layer of layers('basemap', namedFlavor(flavor), { lang: 'en' })) {
      const font = layer?.layout?.['text-font'];
      if (font !== undefined) walk(font);
    }
  }
  // The walk collects expression keywords too ('case', 'literal', 'get',
  // 'min_zoom'). A real stack is a font family name, which every Noto face is.
  return [...stacks].filter((s) => /^Noto Sans/.test(s));
}

function filesBelow(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(relative(root, path));
    }
  };
  walk(root);
  return files.sort();
}

function inspectRoot(root, label, problems) {
  if (!existsSync(root)) {
    problems.push(
      `${label} does not exist at ${root}.\n` +
        '    The map will draw roads and water but NO LABELS and NO ICONS.\n' +
        '    Run: node scripts/vendor-basemap-assets.mjs',
    );
  } else {
    if (JSON.stringify(SPRITE_FLAVORS) !== JSON.stringify(SELECTABLE_FLAVORS)) {
      problems.push(
        `vendored sprite flavours (${SPRITE_FLAVORS.join(', ')}) do not match the app's selectable flavours (${SELECTABLE_FLAVORS.join(', ')})`,
      );
    }

    for (const stack of requiredStacks()) {
      for (const range of FONT_RANGES) {
        const path = join(root, 'fonts', stack, `${range}.pbf`);
        if (!existsSync(path) || statSync(path).size === 0) {
          problems.push(`${label}: missing or empty glyph range: fonts/${stack}/${range}.pbf`);
        }
      }
    }

    const fontLicence = join(root, 'fonts', FONT_LICENSE_FILE);
    if (!existsSync(fontLicence)) {
      problems.push(`${label}: missing font licence: fonts/${FONT_LICENSE_FILE}`);
    } else {
      const digest = createHash('sha256').update(readFileSync(fontLicence)).digest('hex');
      if (digest !== FONT_LICENSE_SHA256) {
        problems.push(
          `${label}: font licence digest is ${digest}, expected ${FONT_LICENSE_SHA256}`,
        );
      }
    }

    // EVERY SELECTABLE FLAVOUR, AT BOTH DENSITIES. See the header for why a
    // missing pair is a device- or view-specific silent failure.
    for (const flavor of SELECTABLE_FLAVORS) {
      for (const file of [
        `${flavor}.json`,
        `${flavor}.png`,
        `${flavor}@2x.json`,
        `${flavor}@2x.png`,
      ]) {
        const path = join(root, 'sprites', file);
        if (!existsSync(path) || statSync(path).size === 0) {
          problems.push(`${label}: missing or empty sprite: sprites/${file}`);
          continue;
        }
        if (file.endsWith('.json')) {
          try {
            const index = JSON.parse(readFileSync(path, 'utf8'));
            if (typeof index !== 'object' || index === null || Object.keys(index).length === 0) {
              problems.push(`${label}: empty sprite index: sprites/${file}`);
              continue;
            }
            for (const image of REQUIRED_SPRITE_IMAGES) {
              if (!Object.hasOwn(index, image)) {
                problems.push(`${label}: missing road-shield image ${image}: sprites/${file}`);
              }
            }
          } catch {
            problems.push(`${label}: invalid sprite JSON: sprites/${file}`);
          }
        } else if (!readFileSync(path).subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
          problems.push(`${label}: invalid sprite PNG: sprites/${file}`);
        }
      }
    }

    const spriteLicence = join(root, 'sprites', SPRITE_LICENSE_FILE);
    if (!existsSync(spriteLicence)) {
      problems.push(`${label}: missing sprite licence: sprites/${SPRITE_LICENSE_FILE}`);
    } else {
      const digest = createHash('sha256').update(readFileSync(spriteLicence)).digest('hex');
      if (digest !== SPRITE_LICENSE_SHA256) {
        problems.push(
          `${label}: sprite licence digest is ${digest}, expected ${SPRITE_LICENSE_SHA256}`,
        );
      }
    }
  }
}

function compareRoots(source, built, problems) {
  const sourceFiles = filesBelow(source);
  const builtFiles = filesBelow(built);
  if (JSON.stringify(builtFiles) !== JSON.stringify(sourceFiles)) {
    const missing = sourceFiles.filter((file) => !builtFiles.includes(file));
    const extra = builtFiles.filter((file) => !sourceFiles.includes(file));
    if (missing.length > 0) problems.push(`dist: missing ${missing.join(', ')}`);
    if (extra.length > 0) problems.push(`dist: unexpected ${extra.join(', ')}`);
  }
  for (const file of sourceFiles.filter((candidate) => builtFiles.includes(candidate))) {
    if (!readFileSync(join(source, file)).equals(readFileSync(join(built, file)))) {
      problems.push(`dist: bytes differ from public source: ${file}`);
    }
  }
}

function main() {
  const problems = [];
  const checkDist = process.argv.slice(2).includes('--dist');

  inspectRoot(SOURCE_ROOT, 'public', problems);
  if (checkDist) {
    inspectRoot(DIST_ROOT, 'dist', problems);
    compareRoots(SOURCE_ROOT, DIST_ROOT, problems);
  }

  if (problems.length > 0) {
    process.stderr.write(`basemap assets\n--------------\n`);
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.stderr.write(
      `\n${String(problems.length)} problem(s). These fail SILENTLY at runtime:\n` +
        'MapLibre requests glyphs and sprites lazily and a 404 does not throw,\n' +
        'so the map just stops drawing labels.\n',
    );
    process.exitCode = 1;
    return;
  }

  const stacks = requiredStacks();
  process.stdout.write(
    `basemap assets${checkDist ? ' (public = dist)' : ''}: ${String(stacks.length)} font stack(s) x ` +
      `${String(FONT_RANGES.length)} range(s) + ${String(SELECTABLE_FLAVORS.length)} sprite flavour(s) at 1x and 2x + font/sprite licences, all present\n`,
  );
}

main();
