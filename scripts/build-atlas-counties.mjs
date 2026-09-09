#!/usr/bin/env node
/**
 * BUILD THE COUNTY-SCOPED ATLAS OF SURVEILLANCE LAYER.
 *
 * `scripts/atlas-counties.mjs` holds the reasoning, the field policy and the
 * hand-written exception table. This file is the part that touches the network
 * and the filesystem, kept separate for the reason `counties.mjs` is separate
 * from `fetch-cameras.mjs`: the join logic has to be testable without either.
 *
 * =============================================================================
 * ZERO RUNTIME DEPENDENCY ON EFF'S SERVER
 * =============================================================================
 * The phone never contacts atlasofsurveillance.org. This runs on a schedule,
 * server-side, and ships a file, exactly like `build-hazards.mjs` - and for the
 * same reason, which is not politeness to EFF. A per-render fetch from the
 * device would put a timestamped request in somebody's edge log every time a
 * driver opened the screen, on the one product whose entire pitch is that no
 * such trace exists.
 *
 * =============================================================================
 * THE FETCH IS CONDITIONAL, AND THE ETAG IS WEAK
 * =============================================================================
 * The export is 8.6 MB and changes rarely. EFF serves it with
 * `ETag: W/"..."` - a WEAK validator, which is a promise about semantic
 * equivalence rather than byte equality, and which is exactly the right
 * validator for this: two exports that differ only in generation timestamp are
 * the same data and there is no reason to pull 8.6 MB to discover that.
 *
 * `If-None-Match` with a weak tag is legal and the server honours it - a 304
 * was confirmed against the live endpoint. On 304 the cached bytes are reused
 * and NOTHING about the data changes; only `checkedAt` moves.
 *
 * =============================================================================
 * FRESHNESS, AND WHAT THIS BUILD CANNOT PROVE
 * =============================================================================
 * `docs/camera-sync-runbook.md` is blunt about this: wall-clock time says when a
 * machine happened to run, not how old the data in the response was. The camera
 * archive can do better because Overpass returns `osm3s.timestamp_osm_base`.
 *
 * The Atlas returns no such thing. There is no vintage field in the CSV and no
 * `Last-Modified` on the response. The one date-shaped signal is the
 * `Content-Disposition` filename, which today reads
 * `Atlas of Surveillance-20260907.csv` - and 20260907 is the date the request
 * was made, which strongly suggests it is stamped at export time rather than
 * being the date the records were compiled. It is recorded as an OBSERVATION
 * and is never presented as a vintage.
 *
 * So the artifact states two things it can actually prove:
 *
 *   fetchedAt   when these exact bytes were downloaded from EFF
 *   checkedAt   when EFF last confirmed they are still current (200 or 304)
 *
 * and the UI says "retrieved", not "as of", because the difference between
 * those two words is the difference between a fact and a guess.
 *
 * =============================================================================
 * THE LICENCE READING
 * =============================================================================
 * eff.org/copyright contradicts itself: the prose says CC BY 4.0, the
 * rel="license" badge in the same paragraph says CC BY 3.0 US. This build
 * records that contradiction rather than picking a winner, and marks the version
 * unconfirmed. Attribution is required under both readings and is given.
 *
 * Usage:
 *   node scripts/build-atlas-counties.mjs            fetch (conditionally), write
 *   node scripts/build-atlas-counties.mjs --dry      report, write nothing
 *   node scripts/build-atlas-counties.mjs --offline  build from cache, no network
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALPR_TECHNOLOGY,
  COUNTY_EXCEPTIONS,
  FIELDS_REFUSED,
  FIELDS_USED,
  SCHEMA,
  buildCountyLookup,
  buildIndex,
  indexExceptions,
  parseCsv,
  readAtlasCsv,
} from './atlas-counties.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/pwa/public/records/atlas-counties.json');
const GEOJSON = join(ROOT, 'scripts/data/us-counties.geojson');
const CAMERA_COUNTIES = join(ROOT, 'apps/pwa/public/cameras/counties.json');

/** Gitignored, like every other `.cache` directory in this repo. */
const CACHE = join(ROOT, '.cache/atlas');
const CACHE_CSV = join(CACHE, 'download.csv');
const CACHE_META = join(CACHE, 'meta.json');

const DOWNLOAD = 'https://atlasofsurveillance.org/download.csv';
const HOME = 'https://atlasofsurveillance.org/';

const USER_AGENT = 'DarkRoute-atlas/1.0 (+https://darkroute.ai; contact cory@darkcode.ai)';

/**
 * Attribution, and it is not optional under either reading of the licence.
 *
 * EFF asks for the project AND the university, because the Atlas is a joint
 * project with the Reynolds School of Journalism and the students who compile it
 * are half the labour. The string is carried in the artifact so the phone can
 * render it without the app hard-coding a claim about somebody else's work.
 */
const ATTRIBUTION =
  'Atlas of Surveillance, a project of the Electronic Frontier Foundation and the ' +
  'University of Nevada, Reno Reynolds School of Journalism';

/**
 * WHAT WAS OBSERVED ON eff.org/copyright, and nothing more.
 *
 * `confirmed: false` is the load-bearing field. Two licence statements on one
 * page cannot both be the answer, and this project does not record a version it
 * has not been told. The curation platform's client used to assert a bare
 * `CC-BY-4.0` for this source; it now points here, and this block is the one
 * place the answer lives.
 */
const LICENCE = Object.freeze({
  observed: 'Creative Commons Attribution - version unconfirmed',
  confirmed: false,
  url: 'https://www.eff.org/copyright',
  note:
    'eff.org/copyright states CC BY 4.0 in prose and CC BY 3.0 US in the rel="license" ' +
    'badge in the same paragraph. Both readings require attribution, which is given. ' +
    'The grant covers material original to EFF; the Atlas ingests datasets from ' +
    'journalists, nonprofits, government and vendors, and the CSV does not mark which ' +
    'rows are which, so this layer republishes only facts (agency, city, county, state, ' +
    'vendor, technology) and never the Summary column.',
});

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const offline = args.has('--offline');

function say(message) {
  process.stdout.write(`${message}\n`);
}

function die(message) {
  process.stderr.write(`\nbuild-atlas-counties failed: ${message}\n`);
  process.exit(1);
}

function readMeta() {
  if (!existsSync(CACHE_META)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_META, 'utf8'));
  } catch {
    // A corrupt cache is a cache miss, not a failure. The next fetch rewrites it.
    return null;
  }
}

/**
 * `readAtlasCsv` plus this build's filesystem and its User-Agent.
 *
 * The decision - what to send, what a 304 means, which stamps move - lives in
 * `atlas-counties.mjs` where it can be tested against a fake fetch. What is left
 * here is reading the cache, writing the cache, and saying out loud which of the
 * three outcomes happened, because a build whose output does not distinguish
 * "downloaded" from "confirmed unchanged" is a build nobody can audit.
 */
async function readCsv() {
  const meta = readMeta();
  const cached = existsSync(CACHE_CSV) ? readFileSync(CACHE_CSV, 'utf8') : null;
  const now = new Date().toISOString();

  const agentFetch = (url, init) =>
    fetch(url, {
      ...init,
      headers: { ...init.headers, 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(300_000),
    });

  let source;
  try {
    source = await readAtlasCsv({ fetchImpl: agentFetch, url: DOWNLOAD, meta, cached, now, offline });
  } catch (error) {
    die(String(error.message ?? error));
  }

  if (source.status === 'cached') {
    say(`  offline: reusing cached copy fetched ${String(source.fetchedAt ?? 'at an unrecorded time')}`);
    return source;
  }
  if (source.status === 'not-modified') {
    say(`  304 not modified: the copy fetched ${String(source.fetchedAt)} is still current`);
    if (!dry) {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(CACHE_META, `${JSON.stringify({ ...meta, checkedAt: source.checkedAt }, null, 2)}\n`);
    }
    return source;
  }

  say(`  200: ${String(source.text.length)} bytes, etag ${String(source.etag)}`);
  if (!dry) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(CACHE_CSV, source.text);
    writeFileSync(
      CACHE_META,
      `${JSON.stringify(
        { etag: source.etag, fetchedAt: source.fetchedAt, checkedAt: source.checkedAt, filename: source.filename },
        null,
        2,
      )}\n`,
    );
  }
  return source;
}

say(`reading ${DOWNLOAD}`);
const source = await readCsv();

const rows = parseCsv(source.text);
const lookup = buildCountyLookup(JSON.parse(readFileSync(GEOJSON, 'utf8')));

let index;
try {
  index = buildIndex({ rows, lookup, exceptions: indexExceptions(COUNTY_EXCEPTIONS) });
} catch (error) {
  die(String(error.message ?? error));
}

/*
 * HOW MUCH OF THE CAMERA ARCHIVE THIS ACTUALLY REACHES.
 *
 * Counting counties would flatter it - most of the 3,221 US counties hold no
 * camera at all. The number that matters is what share of the cameras drivers
 * will actually meet sit in a county the Atlas has something to say about, so
 * this weights by the archive's own per-county camera counts. It is published in
 * the artifact because a coverage figure kept in a build log is a coverage
 * figure nobody can check.
 */
let coverage = null;
if (existsSync(CAMERA_COUNTIES)) {
  const cameraRows = JSON.parse(readFileSync(CAMERA_COUNTIES, 'utf8')).rows ?? [];
  let total = 0;
  let covered = 0;
  for (const row of cameraRows) {
    const cameras = typeof row.cameras === 'number' ? row.cameras : 0;
    total += cameras;
    if (Object.hasOwn(index.counties, String(row.fips))) covered += cameras;
  }
  coverage = {
    camerasInCoveredCounties: covered,
    camerasWithACounty: total,
    // The claim the UI is entitled to make, stated as a fraction rather than a
    // rounded percentage so a reader can recompute it.
    note: 'share of located cameras whose county has at least one Atlas ALPR row',
  };
}

const payload = {
  schema: SCHEMA,
  /* See the header: what was downloaded and when it was last confirmed, both
     proved by the HTTP exchange, and neither claiming to be EFF's own vintage. */
  fetchedAt: source.fetchedAt,
  checkedAt: source.checkedAt,
  source: {
    name: 'Atlas of Surveillance',
    home: HOME,
    download: DOWNLOAD,
    attribution: ATTRIBUTION,
    licence: LICENCE,
    /* Observed, never interpreted. The digits in it track the request date. */
    observedFilename: source.filename,
    etag: source.etag,
  },
  technology: ALPR_TECHNOLOGY,
  /* The columns read, declared in the file itself so the refusal is auditable
     from the artifact and not only from the build script. */
  fieldsUsed: [...FIELDS_USED],
  fieldsRefused: [...FIELDS_REFUSED],
  totals: index.totals,
  coverage,
  /* Every row this build declined to place, with the reason. Published rather
     than dropped: a blank the reader can see is honest. */
  unplaced: index.unplaced,
  counties: index.counties,
};

const text = `${JSON.stringify(payload)}\n`;
const digest = createHash('sha256').update(text).digest('hex');

say('');
say(`csv rows        ${String(index.totals.csvRows)}`);
say(`alpr rows       ${String(index.totals.alprRows)}`);
say(`placed          ${String(index.totals.placed)}`);
say(`unplaced        ${String(index.totals.unplaced)}`);
say(`counties        ${String(index.totals.counties)}`);
say(`agencies        ${String(index.totals.agencies)}`);
if (coverage !== null) {
  const pct = ((100 * coverage.camerasInCoveredCounties) / coverage.camerasWithACounty).toFixed(2);
  say(`camera coverage ${pct}% of ${String(coverage.camerasWithACounty)} located cameras`);
}
say(`size            ${text.length.toLocaleString('en-US')} bytes (sha256 ${digest})`);

for (const row of index.unplaced) {
  say(`  unplaced: ${row.state} / "${row.county}" / ${row.city} - ${row.why}`);
}

/*
 * A DEAD EXCEPTION IS NOT AN ERROR, BUT IT IS WORTH SAYING.
 *
 * When EFF fixes a typo upstream the entry here stops firing, and an exception
 * table nobody prunes is one nobody trusts. This prints them; it does not fail,
 * because a build that broke every time somebody else fixed their data would be
 * a build that gets disabled.
 */
if (index.unusedExceptions.length > 0) {
  say('');
  say(`${String(index.unusedExceptions.length)} exception entries matched nothing this run (upstream may have fixed them):`);
  for (const entry of index.unusedExceptions) {
    say(`  ${entry.state} / "${entry.county}"${entry.city === undefined ? '' : ` / ${entry.city}`}`);
  }
}

if (dry) {
  say('\n--dry: nothing written');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  say(`\nwrote ${OUT}`);
}
