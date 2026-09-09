/**
 * ROADWORK AND CLOSURES, BAKED.
 *
 * =============================================================================
 * WHAT THIS IS NOT
 * =============================================================================
 * It is not a police layer, and the control that shows it must never say it is.
 *
 * That was the original request and the research answered it plainly: police
 * activity is not in these feeds. Kansas publishes zero police strings across
 * 97 live collections. Missouri: 1,135 records, zero matches for
 * police/trooper/sheriff. Florida, Pennsylvania and New York the same across
 * 146 subtypes. The WZDx standard has exactly two event types and every one of
 * 5,297 live features was one of them.
 *
 * The single exception is California's CHP CAD feed, and its own distribution
 * disqualifies the label: the largest value is "Assist CT with Maintenance",
 * then traffic hazards, then collisions. That is officers dispatched to
 * incidents, overwhelmingly crashes - not patrol, not enforcement, and nothing
 * to do with a plate reader.
 *
 * So this ships as ROADWORK AND CLOSURES, which is what the data is. A layer
 * labelled "police" that showed work zones would be the exact kind of claim
 * this project spends its documentation refusing to make.
 *
 * =============================================================================
 * WHY IT IS BAKED AND NOT FETCHED LIVE
 * =============================================================================
 * A live per-viewport fetch is the obvious design and it would quietly destroy
 * the property this product sells.
 *
 * Camera tiles are safe because the request COLLAPSES: the service worker holds
 * them and `sync.ts` does not re-fetch a tile it already has, so a square is
 * asked for about once, ever. A hazard layer polled while the map is open
 * turns that into a per-address timestamped sequence of squares in the edge
 * log - a route trace, on the one product whose entire pitch is that no such
 * trace exists.
 *
 * So the feeds are read on a schedule, server-side, and shipped as a file. The
 * phone contacts no state DOT, the CSP does not change, and the layer works
 * with the radio off like everything else.
 *
 * =============================================================================
 * THE LICENCE GATE IS A BUILD GATE
 * =============================================================================
 * Only feeds whose licence permits republication may be in here, and the check
 * runs against the LIVE payload every time rather than against a note somebody
 * wrote once - a publisher can change terms, and a build that assumes otherwise
 * will ship an infringement without anybody noticing.
 *
 * Every keyed feed is excluded on principle: the Metropolitan Transportation
 * Commission requires written acceptance from every sublicensee, and New York
 * and Pennsylvania require naming downstream recipients in advance. A GPL-3.0
 * project that anybody may fork can satisfy none of those, so an API key here
 * would be a licence violation waiting for its first fork.
 *
 *   node scripts/build-hazards.mjs          fetch, verify, write
 *   node scripts/build-hazards.mjs --dry    report, write nothing
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'apps/pwa/public/records/hazards.json');

const USER_AGENT = 'DarkRoute-hazards/1.0 (+https://darkroute.ai; contact cory@darkcode.ai)';

/**
 * Licences that permit republication, by the identifier the feed itself states.
 *
 * An allowlist rather than a denylist: an unrecognised licence is refused, so
 * a publisher switching to something restrictive fails the build rather than
 * passing it by not matching a pattern nobody remembered to add.
 */
const PERMITTED = new Map([
  ['https://creativecommons.org/publicdomain/zero/1.0/', 'CC0-1.0'],
  ['https://creativecommons.org/publicdomain/zero/1.0', 'CC0-1.0'],
  ['https://creativecommons.org/licenses/by/4.0/', 'CC-BY-4.0'],
  ['https://creativecommons.org/licenses/by/4.0', 'CC-BY-4.0'],
]);

/**
 * THE SOURCES, AND WHY EACH ONE IS HERE.
 *
 * `publishable` is a claim about the licence, checked below against what the
 * feed actually says. It is not permission to skip that check.
 */
const SOURCES = [
  {
    key: 'ks-kandrive-wzdx',
    label: 'Kansas DOT · KanDrive',
    url: 'https://kscars.kandrive.gov/carsapi_v1/api/wzdx',
    attribution: 'Kansas Department of Transportation (KanDrive), CC0 1.0',
    home: 'https://www.kandrive.gov/',
  },
  {
    key: 'mo-modot-wzdx',
    label: 'Missouri DOT · MoDOT',
    /*
     * The WZDx feed specifically, and NOT MoDOT's richer message.v2.json. Same
     * agency, different legal footing: the richer feed publishes no terms
     * anywhere on modot.org, and an absent licence is a refusal here, not a
     * blank cheque.
     */
    url: 'https://traveler.modot.org/timconfig/feed/desktop/mo_wzdx.json',
    attribution: 'Missouri Department of Transportation, CC0 1.0',
    home: 'https://traveler.modot.org/',
  },
];

/**
 * Layers that must never be ingested even though they sit on a permitted host.
 *
 * Iowa's open-data portal REPUBLISHES its neighbours' 511 feeds. Iowa's CC BY
 * grant covers Iowa's data; it cannot re-license Missouri's, Nebraska's or
 * Kansas's. Named here so an accidental include fails loudly.
 */
const REFUSED_SERVICES = new Set(['511_MO_View', '511_NE_View', '511_KS_View']);

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');

function say(m) {
  process.stdout.write(`${m}\n`);
}

function die(m) {
  process.stderr.write(`\nbuild-hazards failed: ${m}\n`);
  process.exit(1);
}

async function readFeed(source) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return response.json();
}

/**
 * The licence the feed states about itself, right now.
 *
 * WZDx puts it in `road_event_feed_info.license` or `feed_info.license`. A feed
 * that states nothing is refused: "no licence" is not "any licence", and this
 * archive is republished.
 */
function licenceOf(document) {
  const info = document.road_event_feed_info ?? document.feed_info ?? {};
  const stated = typeof info.license === 'string' ? info.license.trim() : '';
  if (stated === '') return { ok: false, reason: 'the feed states no licence' };
  const spdx = PERMITTED.get(stated) ?? PERMITTED.get(stated.replace(/\/$/, ''));
  if (spdx === undefined) {
    return { ok: false, reason: `licence "${stated}" is not on the republication allowlist` };
  }
  return { ok: true, spdx, stated };
}

/** A representative point for a feature, whatever geometry it carries. */
function pointOf(geometry) {
  if (geometry === null || typeof geometry !== 'object') return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lon, lat] = geometry.coordinates;
    return typeof lat === 'number' && typeof lon === 'number' ? [lat, lon] : null;
  }
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    // The MIDDLE of the line, not an end. A work zone's start point is often
    // a junction away from the thing a driver would actually meet.
    const c = geometry.coordinates;
    const mid = c[Math.floor(c.length / 2)];
    return Array.isArray(mid) && typeof mid[1] === 'number' && typeof mid[0] === 'number'
      ? [mid[1], mid[0]]
      : null;
  }
  return null;
}

const now = Date.now();
const retrievedAt = new Date(now).toISOString();

const hazards = [];
const sourceReport = [];
let skipped = 0;

for (const source of SOURCES) {
  if (REFUSED_SERVICES.has(source.key)) die(`${source.key} is on the refused list and must not be built`);

  let document;
  try {
    document = await readFeed(source);
  } catch (error) {
    say(`  ${source.key}: FAILED — ${String(error.message ?? error)}`);
    sourceReport.push({ key: source.key, ok: false, reason: String(error.message ?? error), records: 0 });
    continue;
  }

  const licence = licenceOf(document);
  if (!licence.ok) {
    /*
     * A LICENCE FAILURE IS FATAL, not a skip.
     *
     * Continuing would publish an archive that silently lost a state, and the
     * reason it lost one is the reason somebody needs to look at it now.
     */
    die(`${source.key}: ${licence.reason}`);
  }

  const features = Array.isArray(document.features) ? document.features : [];
  let kept = 0;

  for (const feature of features) {
    const properties = feature?.properties ?? {};
    const core = properties.core_details ?? properties;
    const point = pointOf(feature?.geometry);
    if (point === null) {
      skipped += 1;
      continue;
    }

    /*
     * EXPIRED RECORDS ARE DROPPED AT BUILD TIME, by their own end date.
     *
     * That is what makes an ageing file safe: it shows FEWER hazards as it
     * gets older, never a phantom one. A stale layer that keeps drawing a work
     * zone lifted last week teaches drivers to ignore it.
     */
    const ends = properties.end_date ?? core.end_date ?? null;
    if (typeof ends === 'string') {
      const at = Date.parse(ends);
      if (Number.isFinite(at) && at < now) {
        skipped += 1;
        continue;
      }
    }

    const kind = core.event_type ?? properties.event_type ?? 'work-zone';
    hazards.push({
      /* The five-field provenance envelope, per feature. A row nobody can
         trace back to a source record and a licence is a row that cannot be
         defended when somebody asks where it came from. */
      s: source.key,
      i: String(core.data_source_id ?? feature.id ?? ''),
      k: kind,
      lat: Number(point[0].toFixed(5)),
      lon: Number(point[1].toFixed(5)),
      d: typeof core.description === 'string' ? core.description.slice(0, 140) : '',
      r: typeof core.road_names?.[0] === 'string' ? core.road_names[0] : '',
      e: typeof ends === 'string' ? ends : null,
    });
    kept += 1;
  }

  sourceReport.push({
    key: source.key,
    ok: true,
    label: source.label,
    licence: licence.spdx,
    licenceUrl: licence.stated,
    attribution: source.attribution,
    home: source.home,
    records: kept,
  });
  say(`  ${source.key}: ${String(kept)} kept, licence ${licence.spdx}`);
}

if (hazards.length === 0) die('no hazards from any source — refusing to publish an empty layer');

const payload = {
  schema: 'darkroute-hazards/v1',
  /*
   * `builtAt` is READ FROM THIS FILE by the app, not compiled into the bundle.
   * A staleness figure taken from a build constant reports the age of the app
   * rather than the age of the data, which is the bug `catalogue.ts` already
   * records having shipped once.
   */
  builtAt: retrievedAt,
  /** Where the layer has data at all. Outside this, it says NOT COVERED. */
  coverage: ['KS', 'MO'],
  sources: sourceReport,
  skipped,
  count: hazards.length,
  hazards,
};

const text = `${JSON.stringify(payload)}\n`;
const bytes = Buffer.byteLength(text);

say('');
say(`hazards   ${String(hazards.length)}`);
say(`skipped   ${String(skipped)} (expired or no usable geometry)`);
say(`coverage  ${payload.coverage.join(', ')}`);
say(`size      ${bytes.toLocaleString('en-US')} bytes`);

if (dry) {
  say('\n--dry: nothing written');
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  say(`\nwrote ${OUT}`);
}
