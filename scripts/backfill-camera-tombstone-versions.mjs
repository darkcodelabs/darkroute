/**
 * Add the exact OSM version to legacy camera tombstones.
 *
 * A tombstone already records the hourly replication sequence that removed or
 * retagged its node. That exact `.osc.gz` is the authority for the version. A
 * current-node lookup is not: the node may have changed again after the
 * tombstone, and a deleted node's current version says nothing about which
 * historical event this ledger entry represents.
 *
 * Run against a staging archive, inspect with --dry first:
 *
 *   node scripts/backfill-camera-tombstone-versions.mjs --dry --target=/tmp/cameras
 *   node scripts/backfill-camera-tombstone-versions.mjs --target=/tmp/cameras
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_COUNTY_GEOFENCE,
  DEFAULT_OUT_DIR,
  assertSafeCameraTarget,
  normaliseCoordinate,
  releaseGeofenceIdentity,
  resolveCameraTarget,
} from './fetch-cameras.mjs';
import { loadCountiesBytes } from './counties.mjs';
import {
  forEachElement,
  indexTombstoneLedger,
  qualifies,
  sequenceDiffUrl,
} from './sync-cameras.mjs';

function rawNodeId(id) {
  if (typeof id !== 'string' || !/^osm:\d+$/.test(id)) {
    throw new Error(`invalid OSM camera id ${String(id)}`);
  }
  return id.slice(4);
}

function latestNodeEvent(tombstone, events) {
  const raw = rawNodeId(tombstone.id);
  const matching = events.filter((event) => event.type === 'node' && String(event.id) === raw);
  if (matching.length === 0) {
    throw new Error(
      `${tombstone.id} is absent from its recorded replication sequence ${String(tombstone.seq)}`,
    );
  }
  for (const event of matching) {
    if (!Number.isSafeInteger(event.version) || event.version < 1) {
      throw new Error(
        `${tombstone.id} has an invalid version in sequence ${String(tombstone.seq)}`,
      );
    }
  }
  const maxVersion = Math.max(...matching.map((event) => event.version));
  const latest = matching.filter((event) => event.version === maxVersion);
  if (latest.length !== 1) {
    throw new Error(
      `${tombstone.id} has ${String(latest.length)} events at version ${String(maxVersion)} ` +
        `in sequence ${String(tombstone.seq)}`,
    );
  }
  return latest[0];
}

/** Resolve one ledger entry from the last OSM version present in its exact diff. */
export function resolveTombstoneVersion(tombstone, events, { countyIndex = null } = {}) {
  const event = latestNodeEvent(tombstone, events);
  if (tombstone.reason === 'osm_delete') {
    if (event.action !== 'delete') {
      throw new Error(
        `${tombstone.id} says osm_delete but sequence ${String(tombstone.seq)} ends in ${String(event.action)}`,
      );
    }
  } else if (tombstone.reason === 'osm_untag') {
    if (event.action !== 'modify' || qualifies(event.tags)) {
      throw new Error(
        `${tombstone.id} says osm_untag but sequence ${String(tombstone.seq)} does not end unqualified`,
      );
    }
  } else if (tombstone.reason === 'osm_out_of_scope') {
    if (
      event.action !== 'modify' ||
      !qualifies(event.tags) ||
      !Number.isFinite(event.lat) ||
      event.lat < -90 ||
      event.lat > 90 ||
      !Number.isFinite(event.lon) ||
      event.lon < -180 ||
      event.lon > 180 ||
      typeof countyIndex?.lookup !== 'function' ||
      countyIndex.lookup(normaliseCoordinate(event.lat), normaliseCoordinate(event.lon)) !== null
    ) {
      throw new Error(
        `${tombstone.id} says osm_out_of_scope but sequence ${String(tombstone.seq)} ` +
          'does not end as a qualifying node outside the pinned territory',
      );
    }
  } else {
    throw new Error(`${tombstone.id} has unsupported reason ${String(tombstone.reason)}`);
  }
  return event.version;
}

/**
 * Backfill a ledger, fetching every recorded sequence once and preserving
 * entry order. Existing versions are verified against the same historical
 * event instead of being trusted as an exception.
 */
export async function backfillTombstoneVersions(
  tombstones,
  loadSequence,
  { countyIndex = null } = {},
) {
  indexTombstoneLedger(tombstones);
  const bySequence = new Map();
  for (const tombstone of tombstones) {
    const group = bySequence.get(tombstone.seq) ?? [];
    group.push(tombstone);
    bySequence.set(tombstone.seq, group);
  }

  const versions = new Map();
  let added = 0;
  let verified = 0;
  for (const seq of [...bySequence.keys()].sort((a, b) => a - b)) {
    const group = bySequence.get(seq);
    const ids = new Set(group.map(({ id }) => rawNodeId(id)));
    const events = await loadSequence(seq, ids);
    for (const tombstone of group) {
      const osmVersion = resolveTombstoneVersion(tombstone, events, { countyIndex });
      if (Object.hasOwn(tombstone, 'osmVersion')) {
        if (tombstone.osmVersion !== osmVersion) {
          throw new Error(
            `${tombstone.id} records version ${String(tombstone.osmVersion)}, ` +
              `but sequence ${String(seq)} proves ${String(osmVersion)}`,
          );
        }
        verified += 1;
      } else {
        added += 1;
      }
      versions.set(tombstone.id, osmVersion);
    }
  }

  return {
    tombstones: tombstones.map((tombstone) => ({
      ...tombstone,
      osmVersion: versions.get(tombstone.id),
    })),
    added,
    verified,
    sequences: bySequence.size,
  };
}

export function parseBackfillArgs(argv) {
  const parsed = { dry: false, target: DEFAULT_OUT_DIR };
  const seen = new Set();
  const once = (name) => {
    if (seen.has(name)) throw new Error(`${name} may be supplied only once`);
    seen.add(name);
  };

  for (let index = 0; index < argv.length;) {
    const arg = argv[index];
    if (arg === '--dry') {
      once('--dry');
      parsed.dry = true;
      index += 1;
      continue;
    }
    if (arg === '--target' || arg.startsWith('--target=')) {
      once('--target');
      const value = arg === '--target' ? argv[index + 1] : arg.slice(9);
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--target requires a non-empty value');
      }
      parsed.target = resolveCameraTarget(value);
      index += arg === '--target' ? 2 : 1;
      continue;
    }
    throw new Error(`unknown backfill argument: ${arg}`);
  }
  return parsed;
}

async function main() {
  const { dry, target } = parseBackfillArgs(process.argv.slice(2));
  assertSafeCameraTarget(target);
  const path = join(target, 'tombstones.json');
  if (!existsSync(path)) throw new Error(`camera archive has no tombstones.json at ${path}`);
  const document = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(document.tombstones)) {
    throw new Error(`${path} does not contain a tombstones array`);
  }

  const geofenceBytes = readFileSync(DEFAULT_COUNTY_GEOFENCE);
  releaseGeofenceIdentity(geofenceBytes);
  const countyIndex = loadCountiesBytes(geofenceBytes);
  const result = await backfillTombstoneVersions(
    document.tombstones,
    async (seq, ids) => {
      process.stdout.write(`  ${String(seq)} (${String(ids.size)} tombstone(s)) ...`);
      const events = [];
      await forEachElement(sequenceDiffUrl(seq), (event) => {
        if (event.type === 'node' && ids.has(String(event.id))) events.push(event);
      });
      process.stdout.write(` ${String(events.length)} matching event(s)\n`);
      return events;
    },
    { countyIndex },
  );

  process.stdout.write(
    `resolved ${String(result.tombstones.length)} tombstones across ` +
      `${String(result.sequences)} exact diff(s): ${String(result.added)} added, ` +
      `${String(result.verified)} already verified\n`,
  );
  if (dry) {
    process.stdout.write('--dry: nothing written\n');
    return;
  }
  writeFileSync(path, `${JSON.stringify({ ...document, tombstones: result.tombstones })}\n`);
  process.stdout.write(`wrote ${path}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
