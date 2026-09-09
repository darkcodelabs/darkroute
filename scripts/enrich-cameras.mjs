/**
 * ENRICH THE ARCHIVE IN PLACE - the OSM tags, and nothing else.
 *
 * =============================================================================
 * WHY THIS EXISTS INSTEAD OF A REBUILD
 * =============================================================================
 * The INTEL card draws twelve fields and prints a dash in most of them: MOUNT,
 * the hardware name, the operator. Those are not missing from OpenStreetMap --
 * measured across a complete 130,684-node US sweep, `manufacturer` is on
 * 91.97% of ALPR nodes, `camera:mount` on 30.65% and `operator` on 17.68%.
 * They are missing from OUR archive, because it was written by an earlier
 * `normalise()` that kept two tags and threw the rest away.
 *
 * The obvious remedy is to re-run `fetch-cameras.mjs`. It is not available:
 *
 *   AGAINST OVERPASS, it fails. Three full national sweeps, three aborts --
 *   chunks 14, 23 and 42 each answered HTTP 200 with an empty body and no
 *   remark for a region holding thousands of cameras. The circuit breaker in
 *   that script caught all three and left the archive alone, which is the
 *   system working; it is still not a rebuild.
 *
 *   AGAINST THE OFFLINE DUMP, it is destructive. `writeTiles` rebuilds the
 *   whole directory from the source it was handed, and the Aug-20 dump is not
 *   a superset of what we hold: 443 ids on disk are absent from it, every one
 *   of them carrying `osmVersion`, meaning the hourly patrol discovered them
 *   AFTER the dump was taken. Nothing would put them back -- the diffs that
 *   added them sit behind the patrol's watermark. The same rebuild deletes
 *   `tombstones.json` and `overview.json`, which live in that directory and
 *   which `fetch-cameras.mjs` does not write.
 *
 * =============================================================================
 * SO THIS ADDS AND NEVER REPLACES
 * =============================================================================
 * The failure modes above are all consequences of one thing: a rebuild treats
 * its source as the truth about WHICH CAMERAS EXIST. This script never asks
 * that question. It walks the tiles already on disk, and for a record whose id
 * the dump also holds, it copies the tags across. A record the dump has never
 * heard of is left exactly as it was.
 *
 *   NO record is created. NO record is removed. NO tile file is created or
 *   deleted. `lat`, `lon`, `street`, `cross`, `countyFips`, `placeGeoid`,
 *   `confirmations`, `osmVersion` and `updatedAt` are never written.
 *
 * That makes the id set, the tombstone ledger, the overview and the patrol's
 * watermark all trivially safe, because none of them is touched.
 *
 * =============================================================================
 * WHAT IT WILL NOT DO
 * =============================================================================
 * It does not set `osmVersion`. The dump was not fetched with `out meta` and
 * carries no version, and writing a version we do not have would arm the
 * patrol's replay guard with a lie. Enrichment is about what a camera IS, not
 * about tracking what it was when.
 *
 * It does not touch `directionDeg` or `ownerType`, which the existing records
 * already carry from the same source and which the app is already reading.
 *
 * USAGE
 *   node scripts/enrich-cameras.mjs --input=../meridian-flock/data/alpr_osm.json
 *   node scripts/enrich-cameras.mjs --input=... --dry
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'apps/pwa/public/cameras');

/**
 * Tags kept off the record even when the dump has them.
 *
 * `man_made` and `surveillance:type` are the QUERY -- every node has them by
 * construction and they say nothing a reader wants. The `*:wikidata` pairs are
 * identifiers for a machine that is not this one, and they are on ~89% of
 * nodes, so carrying them would be most of the added bytes for none of the
 * added meaning.
 */
export const SKIPPED_TAGS = new Set([
  'man_made',
  'surveillance:type',
  'manufacturer:wikidata',
  'operator:wikidata',
  'brand:wikidata',
]);

/** The tags worth carrying, from a node's raw tag bag. */
export function keepTags(raw) {
  const kept = {};
  for (const key of Object.keys(raw ?? {}).sort()) {
    if (SKIPPED_TAGS.has(key)) continue;
    const value = raw[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    kept[key] = value;
  }
  return kept;
}

/** Every tile file under the archive. */
export function tileFiles(dir = OUT_DIR) {
  const found = [];
  if (!existsSync(dir)) return found;
  const stack = [dir];
  while (stack.length > 0) {
    const at = stack.pop();
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (entry.name.endsWith('.json')) found.push(path);
    }
  }
  return found;
}

function parseArgs(argv) {
  const opts = { input: null, dry: false };
  for (const arg of argv) {
    if (arg === '--dry') opts.dry = true;
    else if (arg.startsWith('--input=')) opts.input = arg.slice(8);
  }
  return opts;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.input === null) {
    process.stderr.write('enrich-cameras: --input=<overpass dump.json> is required\n');
    process.exit(1);
  }

  const path = resolve(ROOT, opts.input);
  process.stdout.write(`reading ${path}\n`);
  const dump = JSON.parse(readFileSync(path, 'utf8'));

  /** id -> kept tags. Keyed the way the records are, so no arithmetic at merge. */
  const tagsById = new Map();
  for (const node of dump.elements ?? []) {
    if (node.type !== 'node') continue;
    const raw = node.tags ?? {};
    // Trust the dump's own filter, but verify -- the same rule the fetcher uses.
    if (raw['surveillance:type'] !== 'ALPR') continue;
    const kept = keepTags(raw);
    if (Object.keys(kept).length > 0) tagsById.set(`osm:${String(node.id)}`, kept);
  }
  process.stdout.write(`  ${String(tagsById.size)} nodes with tags\n`);

  const files = tileFiles();
  process.stdout.write(`  ${String(files.length)} tile files on disk\n`);

  let records = 0;
  let enriched = 0;
  let untouched = 0;
  let filesWritten = 0;
  const coverage = new Map();

  for (const file of files) {
    let body;
    try {
      body = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(body.cameras)) continue;

    let changed = false;
    for (const camera of body.cameras) {
      records += 1;
      const tags = tagsById.get(camera.id);
      if (tags === undefined) {
        untouched += 1;
        continue;
      }
      // ADDITIVE. An existing `tags` object on the record wins key by key: the
      // patrol writes those from a live replication diff, which is newer than
      // any dump, and overwriting them would walk the archive backwards.
      const merged = { ...tags, ...(camera.tags ?? {}) };
      camera.tags = merged;
      for (const key of Object.keys(merged)) {
        coverage.set(key, (coverage.get(key) ?? 0) + 1);
      }
      enriched += 1;
      changed = true;
    }

    if (changed && !opts.dry) {
      // Same shape, same key order, one trailing newline -- so a re-run with no
      // new tags produces no diff at all.
      writeFileSync(file, `${JSON.stringify(body, null, 0)}\n`);
      filesWritten += 1;
    }
  }

  process.stdout.write(
    `\n${String(records)} records: ${String(enriched)} enriched, ${String(untouched)} left alone\n`,
  );
  process.stdout.write(`${String(filesWritten)} tile files rewritten${opts.dry ? ' (DRY -- none)' : ''}\n\n`);

  const ranked = [...coverage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  process.stdout.write('tag coverage across the whole archive:\n');
  for (const [key, count] of ranked) {
    const pct = ((count / records) * 100).toFixed(2).padStart(6);
    process.stdout.write(`  ${key.padEnd(24)} ${pct}%  (${String(count)})\n`);
  }

  // The one invariant worth stating out loud after a write.
  process.stdout.write(
    `\nrecord count unchanged: ${String(records)} in, ${String(records)} out\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(process.argv.slice(2));
}
