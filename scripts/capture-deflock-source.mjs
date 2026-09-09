#!/usr/bin/env node

/**
 * Capture the pinned DeFlock adaptive Overpass query as a first-party,
 * replay-auditable source artifact.
 *
 * The query topology and feature conversion derive from deflock-data commit
 * 8d156b24db7090e870af3f007b0caece9b3c0951 (MIT). DarkRoute adds a positive-
 * longitude Aleutian seed, the documented ALPR/ANPR predicate, retained response
 * bodies, and deterministic validation. See scripts/data/DEFLOCK-DATA-LICENSE.txt.
 *
 * Usage:
 *   node scripts/capture-deflock-source.mjs --out=/tmp/darkroute-source-capture
 */

import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { link, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';

import {
  CA_AREA_MIN_COUNT,
  CAPTURE_IMPLEMENTATION_PATHS,
  MX_AREA_MIN_COUNT,
  OVERPASS_ENDPOINTS,
  activeOverpassEndpoints,
  OVERPASS_USER_AGENT,
  RAW_DATASET_PATH,
  RESPONSE_BUNDLE_PATH,
  RESPONSE_LEDGER_PATH,
  SPLIT_THRESHOLD,
  tileConcurrency,
  TILE_RETRIES,
  TILE_RETRY_DELAY_MS,
  MIN_TILE_SPAN,
  buildSeedTiles,
  assertDataBodyMatchesTile,
  canonicalTimestamp,
  captureSha256,
  countProbeIsConsistent,
  countQuery,
  dataQuery,
  finalizeCapture,
  requestBytes,
  retainedResponseBytes,
  selectedFeatures,
  singleMirror,
  splitTile,
  subtractionQuery,
  tileId,
  validateCaptureArtifacts,
} from './deflock-capture.mjs';

const TIMEOUT_MS = 55_000;

/**
 * HOW LONG TO WAIT, TAKEN FROM THE QUERY'S OWN DECLARED TIMEOUT.
 *
 * A flat 55s was applied to every request, and the subtraction query says
 * `[out:json][timeout:90]` - it tells Overpass it may spend ninety seconds. So
 * the client hung up at 55 and killed a request the server was still lawfully
 * working on, EVERY time, for the whole of the United States' largest state.
 * That query could not succeed at any hour on any mirror; the run reached the
 * subtraction stage and died there on run 2 and again on run 5, once with an
 * HTML error page and once with `fetch failed`, and neither of those reads as
 * "we hung up first".
 *
 * Reading the number out of the query is what stops the two drifting again: an
 * Overpass request carries its own budget in its first line, and a client that
 * disagrees with it is a client that has decided to fail. `HEADROOM_MS` is for
 * the reply itself - a subtraction body for California is megabytes, and the
 * server's clock stops when it finishes computing, not when we finish reading.
 *
 * The floor stays 55s so nothing that used to wait longer now waits less.
 */
const QUERY_TIMEOUT_HEADROOM_MS = 30_000;

export function queryTimeoutMs(query, floor = TIMEOUT_MS) {
  const declared = /\[timeout:(\d+)\]/.exec(String(query));
  if (declared === null) return floor;
  const seconds = Number(declared[1]);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return floor;
  return Math.max(floor, seconds * 1000 + QUERY_TIMEOUT_HEADROOM_MS);
}
const ROOT = resolve(import.meta.dirname, '..');

export function captureImplementationFiles(root = ROOT) {
  return CAPTURE_IMPLEMENTATION_PATHS.map((path) => {
    const bytes = readFileSync(resolve(root, path));
    return {
      path,
      bytes: bytes.length,
      sha256: captureSha256(bytes),
    };
  });
}

export function parseCaptureArgs(argv) {
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    let value;
    if (argument === '--out') {
      value = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--out=')) {
      value = argument.slice('--out='.length);
    } else {
      throw new Error(`unknown capture argument: ${argument}`);
    }
    if (out !== null) throw new Error('--out may be supplied only once');
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
      throw new Error('--out requires a non-empty path');
    }
    out = value;
  }
  if (out === null) throw new Error('--out is required');
  return { out };
}

function targetComponents(path) {
  const components = [];
  let current = resolve(path);
  const root = parse(current).root;
  while (true) {
    components.push(current);
    if (current === root) break;
    current = dirname(current);
  }
  return components.reverse();
}

function snapshotTargetComponents(path) {
  return targetComponents(path).map((component) => {
    if (!existsSync(component)) {
      throw new Error(`capture output component disappeared: ${component}`);
    }
    const stat = lstatSync(component);
    if (stat.isSymbolicLink()) {
      throw new Error(`capture output has a symlink component: ${component}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`capture output component is not a directory: ${component}`);
    }
    return Object.freeze({ path: component, device: stat.dev, inode: stat.ino });
  });
}

function rejectSymlinkComponents(path) {
  for (const component of targetComponents(path)) {
    if (existsSync(component) && lstatSync(component).isSymbolicLink()) {
      throw new Error(`capture output has a symlink component: ${component}`);
    }
  }
}

async function revalidateCaptureTarget(prepared, expectedEntries) {
  if (
    typeof prepared !== 'object' ||
    prepared === null ||
    typeof prepared.path !== 'string' ||
    !Array.isArray(prepared.components)
  ) {
    throw new Error('capture output was not prepared before network access');
  }
  const paths = targetComponents(prepared.path);
  if (paths.length !== prepared.components.length) {
    throw new Error('capture output component snapshot is incomplete');
  }
  for (let index = 0; index < paths.length; index += 1) {
    const expected = prepared.components[index];
    const component = paths[index];
    if (expected?.path !== component || !existsSync(component)) {
      throw new Error(`capture output component changed: ${component}`);
    }
    const stat = lstatSync(component);
    if (stat.isSymbolicLink()) {
      throw new Error(`capture output has a symlink component: ${component}`);
    }
    if (!stat.isDirectory() || stat.dev !== expected.device || stat.ino !== expected.inode) {
      throw new Error(`capture output component changed: ${component}`);
    }
  }
  const actualEntries = (await readdir(prepared.path)).sort();
  const expectedSorted = [...expectedEntries].sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedSorted)) {
    throw new Error(`capture output changed after preparation: ${prepared.path}`);
  }
  return prepared.path;
}

export async function prepareCaptureTarget(path) {
  const target = resolve(path);
  const root = parse(target).root;
  if (target === root || target === resolve('.') || target === resolve(import.meta.dirname, '..')) {
    throw new Error(`unsafe capture output: ${target}`);
  }
  rejectSymlinkComponents(target);
  await mkdir(target, { recursive: true });
  rejectSymlinkComponents(target);
  if ((await readdir(target)).length !== 0) {
    throw new Error(`capture output must be empty: ${target}`);
  }
  return Object.freeze({
    path: target,
    components: Object.freeze(snapshotTargetComponents(target)),
  });
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function retry(operation) {
  let last;
  for (let attempt = 1; attempt <= TILE_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (attempt < TILE_RETRIES) await delay(TILE_RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw last;
}

/**
 * HOW OFTEN A TILE'S DATA CAME FROM THE INSTANCE THAT COUNTED IT.
 *
 * The cross-mirror check is a preference now rather than a requirement - see
 * the note inside `queryOverpassCandidate`. This is what stops that from being
 * a silent downgrade: every fetch is tallied, and the run prints the split at
 * the end, so a receipt that rests on one instance's word cannot be mistaken
 * for one two mirrors agreed on.
 */
/**
 * ENDPOINTS THAT HAVE PROVED THEY CANNOT ANSWER AN AREAS QUERY, for this run.
 *
 * `overpass.deflock.org` has no areas database. Asked for a subtraction it
 * returns HTTP 200 with an HTML body carrying
 * `open64: 2 No such file or directory /opt/overpass/db//osm3s_areas`. That is
 * permanent, not load: it serves bbox tiles fine and fast - every one of the 88
 * data leaves passed against it alone - and can never serve
 * `area["ISO3166-1"=...]`.
 *
 * Learning it once per run rather than hard-coding it means a mirror that gains
 * an areas database is used again with no edit here, and a mirror that loses
 * one stops costing every subtraction a wasted request and three wasted
 * retries. The subtractions are the LAST thing a capture does, after every
 * mirror has been worked hard, so a wasted attempt there is expensive.
 */
const AREAS_UNAVAILABLE = new Set();

/** The endpoint's own words when it has no areas database. */
export function isMissingAreasDatabase(message) {
  return /osm3s_areas/.test(String(message));
}

export const captureIndependence = {
  independent: 0,
  sameInstance: 0,
  /** The ids that fell back, so a reviewer can see WHICH tiles, not just how many. */
  tiles: [],
};

export async function queryOverpassCandidate(
  id,
  role,
  query,
  fetchImpl = fetch,
  { excludeEndpoints = [], preferEndpoints = [] } = {},
) {
  const errors = [];
  const body = requestBytes(query);
  const endpoints = activeOverpassEndpoints();
  /*
   * THE EXCLUSION IS A PREFERENCE, NOT A FILTER, AND THAT CHANGE IS THE WHOLE
   * DIFFERENCE BETWEEN A CAPTURE THAT FINISHES AND ONE THAT DOES NOT.
   *
   * A tile's data is meant to come from a different instance than its count, so
   * no single stale mirror can certify itself. That is worth having and it is
   * still what every healthy run gets: the endpoints that did not answer the
   * count are tried FIRST, in order, and one of them almost always answers.
   *
   * It used to `continue` past the count's endpoint instead of demoting it,
   * which made independence a HARD REQUIREMENT - and that is what killed the
   * 2026-09-06 run. Two mirrors were in play, `overpass.deflock.org` answered
   * the counts in about a third of a second, and every data query was therefore
   * only allowed to ask `overpass-api.de`. It returned 429. The run died on a
   * rate-limited secondary while a healthy primary sat there holding the answer
   * and forbidden from giving it.
   *
   * The owner's ruling, 2026-09-06, is the one this now implements: if one
   * mirror gives us the data then we have the data. A second source is
   * validation, not a freshness gate - a check that makes the capture
   * impossible to run protects nothing, because the archive does not get
   * fresher by not being captured. It just gets older with a guard over it, and
   * it sat five days stale that way.
   *
   * WHAT THE FALLBACK COSTS IS EXACT AND IT IS COUNTED. When a tile's data
   * comes from the same instance that answered its count, a mirror serving a
   * stale or truncated view agrees with itself, so `countProbeIsConsistent`
   * passes on both halves of one wrong answer. Every other guard still applies:
   * the geofence, the tile-body check, the exact-count rule, and above all
   * `timestamp_osm_base` having to be a real UTC timestamp. `captureIndependence`
   * below tallies how often it happened so the run says so out loud and a
   * reviewer sees it before approving rather than after.
   */
  /*
   * `preferEndpoints` OUTRANKS EVERYTHING, and it exists for one situation:
   * a leaf whose count and data disagreed. That is mirror skew - the two halves
   * came from instances holding different views - and the remedy is to ask ONE
   * instance both questions rather than to keep rolling the dice on which pair
   * of mirrors happens to agree. See `captureDataLeaf`.
   */
  /* A subtraction never asks a mirror that has already said it has no areas
     database - see `AREAS_UNAVAILABLE`. Never filtered to empty: if every
     endpoint has failed that way the run should say so with the real error
     rather than "all allowed endpoints failed" over an empty list. */
  const capable =
    role === 'subtraction' && endpoints.some((endpoint) => !AREAS_UNAVAILABLE.has(endpoint))
      ? endpoints.filter((endpoint) => !AREAS_UNAVAILABLE.has(endpoint))
      : endpoints;
  const first = capable.filter((endpoint) => preferEndpoints.includes(endpoint));
  const rest = capable.filter((endpoint) => !preferEndpoints.includes(endpoint));
  const preferred = rest.filter((endpoint) => !excludeEndpoints.includes(endpoint));
  const demoted = rest.filter((endpoint) => excludeEndpoints.includes(endpoint));
  for (const endpoint of [...first, ...preferred, ...demoted]) {
    const independent = !excludeEndpoints.includes(endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), queryTimeoutMs(query));
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': OVERPASS_USER_AGENT,
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      if (response.url !== endpoint) {
        throw new Error(`response resolved to unapproved URL ${String(response.url)}`);
      }
      const responseBody = Buffer.from(await response.arrayBuffer());
      let parsed;
      try {
        parsed = JSON.parse(responseBody.toString('utf8'));
      } catch {
        throw new Error(`non-JSON response: ${responseBody.toString('utf8', 0, 200)}`);
      }
      if (typeof parsed.remark === 'string') throw new Error(`Overpass remark: ${parsed.remark}`);
      if (!Array.isArray(parsed.elements)) throw new Error('response has no elements array');
      canonicalTimestamp(parsed.osm3s?.timestamp_osm_base, `${id} osm_base`);
      const retained = retainedResponseBytes(parsed);
      const retainedParsed = JSON.parse(retained.toString('utf8'));
      if (independent) captureIndependence.independent += 1;
      else {
        captureIndependence.sameInstance += 1;
        captureIndependence.tiles.push(id);
      }
      return {
        id,
        role,
        query,
        endpoint,
        /* NOT COPIED INTO THE ARTIFACT by `accept()`, deliberately: the recorded
           response shape is what `validateCaptureArtifacts` checks, and adding a
           key to it would fail every previously captured receipt. The tally is
           reported instead. */
        independent,
        body: retained,
        parsed: retainedParsed,
        transportSha256: captureSha256(responseBody),
        transportBytes: responseBody.length,
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      if (role === 'subtraction' && isMissingAreasDatabase(failure)) {
        AREAS_UNAVAILABLE.add(endpoint);
      }
      errors.push(`${endpoint}: ${failure}`);
      process.stderr.write(`  ${id} ${endpoint} failed: ${failure}\n`);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${id}: all allowed Overpass endpoints failed: ${errors.join('; ')}`);
}

const accept = (responses, candidate) => {
  if (responses.has(candidate.id)) throw new Error(`accepted response id repeats: ${candidate.id}`);
  responses.set(candidate.id, {
    id: candidate.id,
    role: candidate.role,
    query: candidate.query,
    endpoint: candidate.endpoint,
    body: candidate.body,
    transportSha256: candidate.transportSha256,
    transportBytes: candidate.transportBytes,
  });
};

async function captureCount(tile, responses, fetchImpl) {
  const id = tileId(tile);
  return retry(async () => {
    const candidate = await queryOverpassCandidate(
      `count:${id}`,
      'count',
      countQuery(tile),
      fetchImpl,
    );
    if (candidate.parsed.elements.length !== 1) {
      throw new Error(`${id}: count response did not contain exactly one element`);
    }
    const count = Number(candidate.parsed.elements[0]?.tags?.total);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${id}: count response has no nonnegative integer total`);
    }
    accept(responses, candidate);
    return { count, responseId: candidate.id, endpoint: candidate.endpoint };
  });
}

async function captureZeroConfirmation(tile, countEndpoint, responses, fetchImpl) {
  const id = tileId(tile);
  return retry(async () => {
    const candidate = await queryOverpassCandidate(
      `zero:${id}`,
      'data',
      dataQuery(tile),
      fetchImpl,
      { excludeEndpoints: [countEndpoint] },
    );
    assertDataBodyMatchesTile(candidate.parsed, tile);
    const selected = selectedFeatures(candidate.parsed).size;
    if (selected !== 0) {
      throw new Error(`${id}: zero count contradicted by ${String(selected)} selected features`);
    }
    accept(responses, candidate);
    return candidate.id;
  });
}

export async function planCapture(seed, responses, fetchImpl = fetch) {
  const countNodes = [];
  const leaves = [];
  const queue = [...seed];
  while (queue.length > 0) {
    const batch = queue.splice(0, tileConcurrency(activeOverpassEndpoints().length));
    const counts = await Promise.all(batch.map((tile) => captureCount(tile, responses, fetchImpl)));
    for (let index = 0; index < batch.length; index += 1) {
      const bbox = batch[index];
      const id = tileId(bbox);
      const { count, responseId, endpoint } = counts[index];
      const span = Math.min(bbox.n - bbox.s, bbox.e - bbox.w);
      if (count === 0) {
        const confirmationResponseId = await captureZeroConfirmation(
          bbox,
          endpoint,
          responses,
          fetchImpl,
        );
        countNodes.push({
          id,
          bbox,
          responseId,
          count,
          resolution: 'zero',
          children: [],
          confirmationResponseId,
        });
      } else if (count > SPLIT_THRESHOLD && span > MIN_TILE_SPAN) {
        const children = splitTile(bbox);
        countNodes.push({
          id,
          bbox,
          responseId,
          count,
          resolution: 'split',
          children: children.map(tileId),
          confirmationResponseId: null,
        });
        queue.push(...children);
      } else {
        countNodes.push({
          id,
          bbox,
          responseId,
          count,
          resolution: 'data',
          children: [],
          confirmationResponseId: null,
        });
        leaves.push({ id, bbox, countResponseId: responseId, probed: count });
      }
    }
    process.stdout.write(
      `planned ${String(countNodes.length)} count nodes; ${String(queue.length)} pending; ` +
        `${String(leaves.length)} leaves\n`,
    );
  }
  return { countNodes, leaves };
}

/**
 * ONE LEAF'S DATA, AND THE COUNT THAT AUTHORISES IT, TAKEN TOGETHER.
 *
 * =============================================================================
 * WHY THIS RE-PROBES INSTEAD OF JUST RETRYING
 * =============================================================================
 * The count for a leaf is taken during PLANNING and frozen on the leaf as
 * `probed`. The data is fetched later - minutes later on a national run, hours
 * later when one mirror is carrying it alone. This function used to compare the
 * fresh data against that frozen number and, on a mismatch, hand the whole
 * thing to `retry()`.
 *
 * That retry could not succeed. It re-fetched the DATA and compared it against
 * the SAME stale count, so a leaf whose true count had moved by one - somebody
 * adding a single ALPR node to OSM - failed identically on every attempt and
 * took the entire run with it. Observed exactly that: "data response has 3739
 * features; probe promised 3738", three times, then a dead national capture at
 * 38 of 87 leaves.
 *
 * The failure is not the rule being too strict. `countProbeIsConsistent`
 * demands exact agreement on purpose, and loosening it to a tolerance would
 * make thousands of silently missing cameras indistinguishable from a complete
 * release. The failure is that the two halves were never contemporaneous: the
 * rule assumes the count and the data describe the same instant, and a frozen
 * probe guarantees they do not.
 *
 * So a mismatch RE-PROBES the leaf and compares against the fresh count. Both
 * halves are then taken seconds apart, which is what the rule always assumed.
 * Exactness is untouched - a re-probe that still disagrees still fails, because
 * that is a mirror serving an inconsistent view rather than the world moving on.
 *
 * The re-probe is `accept()`ed into the response set like any other, so the
 * artifact records the count that actually authorised the data rather than the
 * one from planning. A receipt that cited a count nobody checked the data
 * against would be worse than no receipt.
 */
async function captureDataLeaf(leaf, countEndpoint, fetchImpl, responses) {
  let expected = leaf.probed;
  let countResponseId = leaf.countResponseId;
  /*
   * WHICH RE-PROBE THIS IS, because `retry()` can run the body below more than
   * once and each pass that mismatches takes a fresh count.
   *
   * The id used to be a bare `recount:${leaf.id}`, which is stable across those
   * passes - so a leaf that mismatched TWICE tried to `accept()` a second
   * response under an id already in the ledger and the whole capture died on
   * "accepted response id repeats". That is the ledger's duplicate guard doing
   * exactly its job: every retained response is meant to be a distinct
   * observation, and two of them cannot share a name.
   *
   * Numbering them keeps each re-probe its own observation, which is also the
   * honest record - the second count is a different request at a different
   * moment, not a correction of the first.
   */
  let reprobes = 0;
  /*
   * ONCE THE TWO HALVES HAVE DISAGREED, ASK ONE INSTANCE BOTH QUESTIONS.
   *
   * A first attempt still prefers a different mirror than the count came from,
   * because that is what makes the exact-count rule an independent check. But a
   * mismatch is usually not churn - churn is two features, and what actually
   * happened on 2026-09-06 was `probe promised 1140, data has 801`, a 30%
   * shortfall that means the two mirrors are holding different views of the
   * database. Rolling the dice again on which pair happens to agree is how that
   * run burned three attempts and died.
   *
   * So the retry pins the data to the instance that answered the count. The
   * check becomes self-consistency rather than cross-mirror agreement for that
   * leaf, which is weaker and is exactly what `captureIndependence` is counting.
   */
  let pinToCounter = false;

  return retry(async () => {
    const candidate = await queryOverpassCandidate(
      `data:${leaf.id}`,
      'data',
      dataQuery(leaf.bbox),
      fetchImpl,
      pinToCounter
        ? { preferEndpoints: [countEndpoint] }
        : { excludeEndpoints: [countEndpoint] },
    );
    assertDataBodyMatchesTile(candidate.parsed, leaf.bbox);
    const featureCount = selectedFeatures(candidate.parsed).size;
    if (countProbeIsConsistent(expected, featureCount, leaf.bbox)) {
      return { candidate, featureCount, expected, countResponseId };
    }

    /*
     * Re-probe BEFORE throwing, so the next attempt has a contemporaneous
     * count to compare against. The throw is what makes `retry()` come round
     * again; without it a first-attempt mismatch would be accepted on the
     * strength of a count taken after the data, which is the same ordering
     * problem in the other direction.
     */
    pinToCounter = true;
    reprobes += 1;
    const reprobe = await queryOverpassCandidate(
      `recount:${String(reprobes)}:${leaf.id}`,
      'count',
      countQuery(leaf.bbox),
      fetchImpl,
    );
    const total = Number(reprobe.parsed.elements[0]?.tags?.total);
    if (reprobe.parsed.elements.length === 1 && Number.isSafeInteger(total) && total >= 0) {
      accept(responses, reprobe);
      expected = total;
      countResponseId = reprobe.id;
    }

    throw new Error(
      `${leaf.id}: data response has ${String(featureCount)} features; ` +
        `probe promised ${String(leaf.probed)}` +
        (expected === leaf.probed ? '' : `, re-probed ${String(expected)}`),
    );
  });
}

export async function captureDataLeaves(leaves, responses, fetchImpl = fetch) {
  const dataLeaves = [];
  const queue = [...leaves];
  while (queue.length > 0) {
    const batch = queue.splice(0, tileConcurrency(activeOverpassEndpoints().length));
    const captured = await Promise.all(
      batch.map((leaf) => {
        const countEndpoint = responses.get(leaf.countResponseId)?.endpoint;
        if (!OVERPASS_ENDPOINTS.includes(countEndpoint)) {
          throw new Error(`${leaf.id}: count response has no allowed endpoint`);
        }
        return captureDataLeaf(leaf, countEndpoint, fetchImpl, responses);
      }),
    );
    for (let index = 0; index < batch.length; index += 1) {
      const leaf = batch[index];
      const { candidate, featureCount, expected, countResponseId } = captured[index];
      accept(responses, candidate);
      dataLeaves.push({
        ...leaf,
        /* The count that actually authorised this data, which is the re-probe
           when the planning count had gone stale. See `captureDataLeaf`. */
        countResponseId,
        probed: expected,
        dataResponseId: candidate.id,
        featureCount,
      });
    }
    process.stdout.write(
      `captured ${String(dataLeaves.length)}/${String(leaves.length)} accepted data leaves\n`,
    );
  }
  return dataLeaves;
}

/**
 * HOW HARD TO TRY FOR A SUBTRACTION, and why it is not the tile number.
 *
 * A capture makes roughly two hundred requests and then, at the very end, two
 * of these. By that point every mirror has been worked hard for several
 * minutes, which is exactly when one returns 504 - and losing the subtraction
 * loses the ENTIRE run, every seed, every leaf, both a country's worth of work.
 * Three attempts at two seconds is the tile budget, and a tile is cheap to
 * redo. This is not.
 *
 * Six attempts, and the ramp starts at fifteen seconds rather than two, because
 * what fails here is a mirror that is busy rather than a mirror that is wrong.
 * Worst case is about eleven minutes of waiting to save an hour of capture.
 */
const SUBTRACTION_ATTEMPTS = 6;

async function retrySubtraction(operation) {
  let last;
  for (let attempt = 1; attempt <= SUBTRACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (attempt < SUBTRACTION_ATTEMPTS) {
        const wait = 15_000 * 2 ** (attempt - 1);
        process.stderr.write(
          `  subtraction attempt ${String(attempt)} failed; waiting ${String(Math.round(wait / 1000))}s\n`,
        );
        await delay(wait);
      }
    }
  }
  throw last;
}

async function captureSubtraction(iso, minimum, responses, fetchImpl) {
  const candidate = await retrySubtraction(async () => {
    const response = await queryOverpassCandidate(
      `subtraction:${iso}`,
      'subtraction',
      subtractionQuery(iso),
      fetchImpl,
    );
    const featureCount = selectedFeatures(response.parsed).size;
    if (featureCount < minimum) {
      throw new Error(
        `${iso} subtraction has ${String(featureCount)} features; minimum ${String(minimum)}`,
      );
    }
    return { response, featureCount };
  });
  accept(responses, candidate.response);
  return {
    iso,
    responseId: candidate.response.id,
    featureCount: candidate.featureCount,
    minimum,
    unavailable: null,
  };
}

/**
 * THE CROSS-CHECK IS ALLOWED TO BE MISSING. THE ARCHIVE IS NOT.
 *
 * The CA and MX subtractions do NOT decide which cameras ship. That is
 * `sourceTerritoryIncludes` in `fetch-cameras-deflock.mjs`, a point-in-polygon
 * test against the 3,221-feature Census county geofence: a camera is in the
 * release if and only if it falls inside a US county. The subtractions produce
 * `foreignCandidateMatches`, a corroborating count of how many cameras in the
 * border-overlap tiles are also inside Canada or Mexico - the ledger's own
 * policy line calls it
 * "retain-canada-and-mexico-area-overlaps-for-census-geofence-adjudication".
 *
 * It is a SECOND SOURCE VALIDATING THE PRIMARY, and on 2026-09-06/07 it was the
 * only thing standing between a five-day-stale archive and a completed capture:
 * `overpass.deflock.org` has no areas database at all, kumi's was serving a
 * quarter of the truth, and `overpass-api.de` was 504ing under the load the
 * capture itself had just put on it. Runs 2, 5, 6 and 9 each finished every
 * seed and every leaf and then died here.
 *
 * Owner's ruling, 2026-09-07: United States only for now; a second source is
 * validation, not a gate. So a subtraction that cannot be obtained is RECORDED
 * as unobtained and the capture continues.
 *
 * WHAT IT COSTS, EXACTLY: `foreignCandidateMatches` becomes null rather than a
 * number. NOT ZERO - zero would mean "we looked at the border overlap and found
 * nothing foreign", which is a claim about the world, and what is true is that
 * we did not look. The census geofence still filters every camera, so the
 * release is still US-only by construction; what is lost is the independent
 * confirmation that it filtered correctly.
 */
function unobtainedSubtraction(iso, minimum, reason) {
  return { iso, responseId: null, featureCount: null, minimum, unavailable: reason };
}

export async function runCapture(fetchImpl = fetch) {
  const startedAt = new Date().toISOString();
  const captureId = randomUUID();
  // Snapshot before the first request. A capture must bind the code that began
  // the run, and it must fail rather than attest to files changed mid-capture.
  const implementationFiles = captureImplementationFiles();
  const responses = new Map();
  process.stdout.write(
    `capture ${captureId}\n` +
      `user-agent ${OVERPASS_USER_AGENT}\n` +
      `seed roots ${String(buildSeedTiles().length)} (including +longitude Aleutians)\n`,
  );
  const { countNodes, leaves } = await planCapture(buildSeedTiles(), responses, fetchImpl);
  const dataLeaves = await captureDataLeaves(leaves, responses, fetchImpl);
  const [CA, MX] = await Promise.all(
    [
      ['CA', CA_AREA_MIN_COUNT],
      ['MX', MX_AREA_MIN_COUNT],
    ].map(async ([iso, minimum]) => {
      try {
        return await captureSubtraction(iso, minimum, responses, fetchImpl);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`  SUBTRACTION UNAVAILABLE ${iso}: ${reason}\n`);
        return unobtainedSubtraction(iso, minimum, reason);
      }
    }),
  );
  if (JSON.stringify(captureImplementationFiles()) !== JSON.stringify(implementationFiles)) {
    throw new Error('capture implementation changed while the capture was running');
  }
  return finalizeCapture({
    captureId,
    startedAt,
    completedAt: new Date().toISOString(),
    countNodes,
    dataLeaves,
    subtractions: { CA, MX },
    responses,
    implementationFiles,
  });
}

const artifactName = (path) => basename(path);

export async function writeCapture(preparedTarget, capture, { beforeLink } = {}) {
  if (beforeLink !== undefined && typeof beforeLink !== 'function') {
    throw new Error('capture install hook must be a function');
  }
  const target = await revalidateCaptureTarget(preparedTarget, []);
  const summary = validateCaptureArtifacts(capture.ledger, {
    ledgerBytes: capture.ledgerBytes,
    responseBundle: capture.responseBundle,
    rawDataset: capture.rawGzip,
    implementationFiles: capture.implementationFiles,
  });
  const files = [
    [artifactName(RESPONSE_LEDGER_PATH), capture.ledgerBytes],
    [artifactName(RESPONSE_BUNDLE_PATH), capture.responseBundle],
    [artifactName(RAW_DATASET_PATH), capture.rawGzip],
  ];
  const receiptSummary = {
    schema: 'darkroute-deflock-capture-summary/v1',
    captureId: capture.ledger.captureId,
    capturedAt: capture.ledger.capture.completedAt,
    minimumOsmBase: summary.minimumOsmBase,
    sourceBuild: summary.rawDataset.decodedSha256.slice(0, 16),
    sourceFeatures: summary.rawDataset.featureCount,
    ledger: summary.ledgerIdentity,
    /* SAID IN THE RECEIPT, not just on the terminal. The cross-mirror check is
       validation now rather than a gate, and a reviewer approving this receipt
       has to be able to see how much of it two instances agreed on. */
    sameInstanceLeaves: summary.sameInstanceLeaves,
    /* WHICH TILES MOVED WHILE THE RUN WAS IN FLIGHT. A re-probed leaf was
       authorised by a count taken after its first data answer disagreed, which
       is the honest ordering and is still an exact match -- but it is a second
       observation of a changing tile and a reviewer should see which. */
    reprobedLeaves: summary.reprobedLeaves,
    /*
     * THE OTHER HALF OF THAT DISCLOSURE, AND THE THING `singleMirror()` WAS
     * WRITTEN FOR.
     *
     * `sameInstanceLeaves` says which tiles fell back. This says whether the run
     * had a second mirror to fall back FROM. The distinction is not cosmetic and
     * `endpoints` below cannot make it: one endpoint there could mean three were
     * allowed and two were down for a tile, or it could mean the run was
     * configured down to a single instance by `FWM_OVERPASS_SKIP` and no
     * independence check was ever possible. The doc on `singleMirror` promised a
     * reviewer would see this in the artifact and, until now, nothing recorded
     * it - the function had no non-test caller at all.
     */
    singleMirror: singleMirror(),
    responseBundle: summary.responseBundle,
    rawDataset: summary.rawDataset,
    roleCounts: summary.roleCounts,
    endpoints: summary.endpoints,
  };
  files.push([
    'deflock-us-capture-summary.json',
    Buffer.from(`${JSON.stringify(receiptSummary, null, 2)}\n`),
  ]);
  const temporaryNames = new Set();
  const installedNames = new Set();
  for (const [name, bytes] of files) {
    await revalidateCaptureTarget(preparedTarget, [...temporaryNames, ...installedNames]);
    const temporaryName = `.${name}.${captureSha256(bytes).slice(0, 12)}.${randomUUID()}.tmp`;
    const temporary = join(target, temporaryName);
    await writeFile(temporary, bytes, { flag: 'wx' });
    temporaryNames.add(temporaryName);
  }
  await revalidateCaptureTarget(preparedTarget, [...temporaryNames]);
  for (const [name] of files) {
    const temporaryName = [...temporaryNames].find((entry) => entry.startsWith(`.${name}.`));
    if (temporaryName === undefined) throw new Error(`capture staging file is missing for ${name}`);
    await revalidateCaptureTarget(preparedTarget, [...temporaryNames, ...installedNames]);
    // A hard link is atomic and, unlike rename(), cannot replace a file which
    // appeared after the empty-directory preflight.
    if (beforeLink !== undefined) await beforeLink({ name, target });
    await link(join(target, temporaryName), join(target, name));
    installedNames.add(name);
    await revalidateCaptureTarget(preparedTarget, [...temporaryNames, ...installedNames]);
    await unlink(join(target, temporaryName));
    temporaryNames.delete(temporaryName);
  }
  await revalidateCaptureTarget(
    preparedTarget,
    files.map(([name]) => name),
  );
  return receiptSummary;
}

async function main() {
  const { out } = parseCaptureArgs(process.argv.slice(2));
  const target = await prepareCaptureTarget(out);
  const capture = await runCapture();
  const summary = await writeCapture(target, capture);
  /* SAID OUT LOUD, BEFORE THE FILE PATHS. A reviewer approving this receipt is
     entitled to know how much of it two mirrors agreed on and how much rests on
     one instance's word, and burying it in an artifact is how that stops being
     read. See `captureIndependence`. */
  const { independent, sameInstance, tiles } = captureIndependence;
  process.stdout.write(
    `cross-mirror: ${String(independent)} independent, ` +
      `${String(sameInstance)} from the counting instance` +
      (sameInstance === 0 ? '' : ` (${tiles.slice(0, 8).join(', ')}${tiles.length > 8 ? ', …' : ''})`) +
      /* A run allowed only one instance never had an independence check to
         lose. Said here as well as in the receipt, because it changes what the
         other number on this line means. */
      (singleMirror() ? '\nSINGLE MIRROR: no cross-instance check was possible for any tile\n' : '\n'),
  );
  process.stdout.write(
    `capture complete: ${String(summary.sourceFeatures)} features\n` +
      `minimum osm_base: ${summary.minimumOsmBase}\n` +
      `ledger: ${join(target.path, artifactName(RESPONSE_LEDGER_PATH))}\n` +
      `raw source sha256: ${summary.rawDataset.decodedSha256}\n`,
  );
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  await main();
}
