#!/usr/bin/env node

/**
 * ADD `licenceUrl` TO EVERY CHECKED-IN CAMERA TILE AND TO `index.json`.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * `publish-cameras.mjs:974` reads the local generation with
 * `requireLicenceUrl: true`, so every tile in the archive must carry the ODbL
 * URI beside its attribution and licence. All 8,803 checked-in tiles carry the
 * first two and none carries the third: the archive predates the field.
 *
 * `sync-cameras.mjs` adds it, but only to a tile it CREATES - an existing tile
 * is read off disk and keeps whatever shape it already had. So a tile with no
 * camera changes keeps the old shape indefinitely, and the first publish after
 * a bootstrap fails on whichever one it reaches first. On 2026-09-07 that was
 * `11/116/894.json`, and it would have been 8,802 more after it.
 *
 * This is the one-time pass that closes the gap. It is mechanical and it is
 * safe: the value is a constant already exported by `fetch-cameras.mjs`, the
 * two fields beside it are already correct, and this writes exactly what the
 * sync writes onto any tile it happens to rewrite.
 *
 * =============================================================================
 * WHAT IT WILL NOT DO
 * =============================================================================
 * It does not touch a camera, a coordinate, a tag or a count. If a tile carries
 * a `licenceUrl` that is not the canonical one it REFUSES rather than
 * overwriting: a wrong licence URI in an ODbL archive is a licensing claim, and
 * silently correcting one would hide however it got there.
 *
 * Nor does it renumber, reformat or re-key anything. Tiles are rewritten with
 * the same JSON shape and key order they already had, plus one key, so the diff
 * is one line per file and a reviewer can see that at a glance.
 *
 * Usage:
 *   node scripts/backfill-camera-licence-url.mjs --target=apps/pwa/public/cameras
 *   node scripts/backfill-camera-licence-url.mjs --target=... --dry-run
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ATTRIBUTION, LICENCE, LICENCE_URL } from './fetch-cameras.mjs';

export function parseArgs(argv) {
  let target = null;
  let dryRun = false;
  for (const argument of argv) {
    if (argument === '--dry-run') {
      dryRun = true;
    } else if (argument.startsWith('--target=')) {
      target = argument.slice('--target='.length);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (target === null || target.trim() === '') throw new Error('--target is required');
  return { target, dryRun };
}

/**
 * The tile paths under a `z/x/y.json` archive, sorted, so a run is reproducible
 * and a diff is reviewable in a stable order.
 */
export function tilePaths(root) {
  const out = [];
  const zooms = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const zoom of zooms.sort((a, b) => a.name.localeCompare(b.name))) {
    const zoomDir = join(root, zoom.name);
    const columns = readdirSync(zoomDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const column of columns.sort((a, b) => a.name.localeCompare(b.name))) {
      const columnDir = join(zoomDir, column.name);
      const files = readdirSync(columnDir).filter((name) => name.endsWith('.json'));
      for (const file of files.sort()) out.push(join(columnDir, file));
    }
  }
  return out;
}

/**
 * Decide what one document needs, without writing anything.
 *
 * Returns `'ok'` when it already carries the canonical URI, `'add'` when it
 * carries none, and throws when it carries a different one - see the header.
 */
export function verdictFor(key, doc) {
  if (doc.attribution !== ATTRIBUTION || doc.licence !== LICENCE) {
    throw new Error(`${key}: attribution or licence is not the canonical pair; not this script's job`);
  }
  if (!Object.hasOwn(doc, 'licenceUrl')) return 'add';
  if (doc.licenceUrl === LICENCE_URL) return 'ok';
  throw new Error(
    `${key}: carries a licenceUrl that is not the canonical ODbL URI ` +
      `(${String(doc.licenceUrl)}). Refusing to overwrite a licensing claim.`,
  );
}

/**
 * Insert `licenceUrl` immediately after `licence`, so the three travel together
 * in every file rather than the new one landing at the end of whichever object
 * happened to be serialised last.
 */
export function withLicenceUrl(doc) {
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    out[key] = value;
    if (key === 'licence') out.licenceUrl = LICENCE_URL;
  }
  if (!Object.hasOwn(out, 'licenceUrl')) out.licenceUrl = LICENCE_URL;
  return out;
}

export function backfill({ target, dryRun }, io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const writeFile = io.writeFile ?? ((p, bytes) => { writeFileSync(p, bytes); });
  const list = io.tilePaths ?? tilePaths;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));

  const root = resolve(target);
  if (!existsSync(root)) throw new Error(`camera archive not found: ${root}`);

  const indexPath = join(root, 'index.json');
  if (!existsSync(indexPath)) throw new Error(`camera archive has no index.json at ${indexPath}`);

  let added = 0;
  let already = 0;

  /*
   * THE ROOT SIDECARS, NOT JUST THE TILES.
   *
   * `index.json` is the obvious one and it is not the only one: the archive root
   * also holds `overview.json`, `counties.json`, `places.json` and
   * `tombstones.json`, and `validateArchiveBodies` holds every one of them to
   * the same notice. The first cut of this script walked only `z/x/y` and
   * declared success on 8,804 files, after which the validator refused on
   * `overview.json` - which is a better outcome than shipping, and is exactly
   * what that check is for.
   *
   * Read from the directory rather than a hard-coded list, so a sidecar added
   * later is carried without anybody remembering this file exists.
   */
  const sidecars = readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => join(root, name));

  for (const path of sidecars) {
    const key = path.slice(root.length + 1);
    const doc = JSON.parse(readFile(path));
    if (verdictFor(key, doc) === 'ok') {
      already += 1;
      continue;
    }
    /* Pretty-printed, because these are the files a person opens. The tiles are
       machine-sized and stay on one line. */
    if (!dryRun) writeFile(path, `${JSON.stringify(withLicenceUrl(doc), null, 2)}\n`);
    added += 1;
  }

  for (const path of list(root)) {
    if (path === indexPath) continue;
    const key = path.slice(root.length + 1);
    const doc = JSON.parse(readFile(path));
    if (verdictFor(key, doc) === 'ok') {
      already += 1;
      continue;
    }
    if (!dryRun) writeFile(path, `${JSON.stringify(withLicenceUrl(doc))}\n`);
    added += 1;
  }

  log(
    `${dryRun ? 'would add' : 'added'} licenceUrl to ${String(added)} file(s); ` +
      `${String(already)} already carried it`,
  );
  return { added, already };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    backfill(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`backfill-camera-licence-url: ${String(error.message ?? error)}\n`);
    process.exitCode = 1;
  }
}
