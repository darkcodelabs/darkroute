/**
 * THE ATLAS JOIN, AND THE THINGS IT MUST REFUSE TO DO.
 *
 * These assert the unflattering half. A join that resolves 4,142 of 4,146 rows
 * is easy to test by counting the successes; what makes this one safe is that it
 * declines a dirty cell rather than guessing at it, that it never reads the
 * Summary column, and that a same-named county in the wrong state does not
 * match. Every test below is one of those.
 *
 * The shipped artifact is read off disk rather than fabricated, for the reason
 * `countyLocate.test.ts` gives: a fixture proves the wiring and says nothing
 * about whether the file the app actually serves holds what it claims.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
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
  normalizeName,
  parseCsv,
  readAtlasCsv,
  resolveCounty,
  splitVendors,
} from './atlas-counties.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(ROOT, 'apps/pwa/public/records/atlas-counties.json');
const GEOJSON = join(ROOT, 'scripts/data/us-counties.geojson');
/** Gitignored, so present only after a real build run. See the summary test. */
const CACHED_CSV = join(ROOT, '.cache/atlas/download.csv');

const lookup = buildCountyLookup(JSON.parse(readFileSync(GEOJSON, 'utf8')));
const exceptions = indexExceptions(COUNTY_EXCEPTIONS);

/** A CSV with the real header, so a column rename breaks these too. */
function csv(rows) {
  const header = [
    'AOSNUMBER', 'City', 'County', 'State', 'Agency', 'Type of LEA', 'Summary',
    'Technology', 'Vendor',
  ];
  const body = rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replaceAll('"', '""')}"`).join(','));
  return [header.map((h) => `"${h}"`).join(','), ...body].join('\r\n');
}

function row(over = {}) {
  return {
    City: 'Cincinnati',
    County: 'Hamilton County',
    State: 'OH',
    Agency: 'Cincinnati Police Department',
    Summary: 'The department has operated plate readers since at least 2019.',
    Technology: ALPR_TECHNOLOGY,
    Vendor: 'Flock Safety',
    ...over,
  };
}

test('a clean county cell joins on the Census name AND its designator', () => {
  const hit = resolveCounty({ state: 'OH', county: 'Hamilton County', city: 'Cincinnati' }, lookup, exceptions);
  assert.equal(hit.fips, '39061');
  assert.equal(hit.via, 'census');
});

test('the same county name in a different state does not match, which is the whole state constraint', () => {
  // Hamilton County exists in ten states. Dropping the state test to lift the
  // hit rate is what the scope refused with a number: 322 cameras joined to a
  // same-named agency in a state it does not operate in.
  const hit = resolveCounty({ state: 'ZZ', county: 'Hamilton County', city: 'Cincinnati' }, lookup, exceptions);
  assert.equal(hit.fips, null);
  assert.equal(hit.via, 'unknown');
});

test('an independent city is NOT resolved to the county of the same name', () => {
  // Virginia has both a Richmond County (51159) and a Richmond city (51760).
  // Matching on NAME alone would resolve whichever the Census file listed last.
  assert.equal(resolveCounty({ state: 'VA', county: 'Richmond County', city: 'Warsaw' }, lookup, exceptions).fips, '51159');
  assert.equal(resolveCounty({ state: 'VA', county: 'Richmond city', city: 'Richmond' }, lookup, exceptions).fips, '51760');
});

test('a dirty county string resolves through the exception map, not through a fuzzy match', () => {
  const genesse = resolveCounty({ state: 'MI', county: 'Genesse County', city: 'Davison' }, lookup, exceptions);
  assert.equal(genesse.fips, '26049');
  assert.equal(genesse.via, 'exception');
  assert.match(genesse.why, /Genesee/);

  const refError = resolveCounty({ state: 'MO', county: '#REF!', city: 'Grain Valley' }, lookup, exceptions);
  assert.equal(refError.fips, '29095');
  assert.equal(refError.via, 'exception');
});

test('a misspelling with NO exception entry stays unresolved instead of finding a near neighbour', () => {
  // "Hamiltn County" is one deletion from a real Ohio county and resolves to
  // nothing, because nothing in this build measures edit distance.
  const hit = resolveCounty({ state: 'OH', county: 'Hamiltn County', city: 'Cincinnati' }, lookup, exceptions);
  assert.equal(hit.fips, null);
  assert.equal(hit.via, 'unknown');
});

test('a cell naming two counties is REFUSED rather than resolved to the first one', () => {
  const hit = resolveCounty(
    { state: 'SC', county: 'Spartanburg County/ Cherokee County', city: 'Chesnee' },
    lookup,
    exceptions,
  );
  assert.equal(hit.fips, null);
  assert.equal(hit.via, 'refused');
  assert.match(hit.why, /two counties/);
});

test('a blank county cell resolves only when the CITY decides it, and by city not by state', () => {
  // Falls Church is a Virginia independent city, so the blank is informative.
  assert.equal(resolveCounty({ state: 'VA', county: '', city: 'Falls Church' }, lookup, exceptions).fips, '51610');
  // A Virginia row whose blank nobody has resolved gets nothing, rather than
  // inheriting the answer from another blank row in the same state.
  assert.equal(resolveCounty({ state: 'VA', county: '', city: 'Vienna' }, lookup, exceptions).fips, null);
});

test('invisible characters are removed, because a bidi mark is not a different county', () => {
  // Five real rows are filed under "‎Harris County‎".
  assert.equal(normalizeName('‎Harris County‎'), 'harris county');
  assert.equal(resolveCounty({ state: 'TX', county: '‎Harris County‎', city: 'Houston' }, lookup, exceptions).fips, '48201');
});

test('normalisation folds case and whitespace and does nothing else', () => {
  assert.equal(normalizeName('  HAMILTON   County '), 'hamilton county');
  // NOT stemmed, NOT de-punctuated, NOT diacritic-folded: "Dona Ana" and
  // "Doña Ana" stay different strings, which is why the tilde case is a
  // hand-written exception rather than a rule that would also change how every
  // Puerto Rico municipio matches.
  assert.notEqual(normalizeName('Dona Ana County'), normalizeName('Doña Ana County'));
});

test('only ALPR rows are read, so a body-camera row never becomes a plate-reader deployment', () => {
  const rows = parseCsv(csv([
    row(),
    row({ Technology: 'Body-worn Cameras', Agency: 'Woodstock Police Department' }),
    row({ Technology: 'Drones', Agency: 'Somewhere Sheriff' }),
  ]));
  const index = buildIndex({ rows, lookup, exceptions });
  assert.equal(index.totals.alprRows, 1);
  assert.equal(index.counties['39061'].agencies.length, 1);
});

test('an empty ALPR set is refused rather than published as "nothing recorded anywhere"', () => {
  // A published empty layer would assert that no county in America has a
  // recorded deployment - one false negative in 3,221 places at once.
  const rows = parseCsv(csv([row({ Technology: 'Body-worn Cameras' })]));
  assert.throws(() => buildIndex({ rows, lookup, exceptions }), /refusing to publish an empty layer/);
});

test('a renamed column fails the build instead of quietly emptying a field', () => {
  const text = csv([row()]).replace('"Technology"', '"Tech"');
  assert.throws(() => buildIndex({ rows: parseCsv(text), lookup, exceptions }), /missing columns/);
});

test('the Summary column never reaches the artifact', () => {
  const secret = 'PROSE THAT MUST NOT BE REPUBLISHED';
  const rows = parseCsv(csv([row({ Summary: secret })]));
  const index = buildIndex({ rows, lookup, exceptions });
  assert.ok(!JSON.stringify(index).includes(secret));
  assert.ok(!Object.hasOwn(index.counties['39061'], 'summary'));
  assert.ok(FIELDS_REFUSED.includes('Summary'));
  assert.ok(!FIELDS_USED.includes('Summary'));
});

test('vendor cells split on commas and keep one spelling per vendor', () => {
  assert.deepEqual(splitVendors('Flock Safety, Motorola Solutions'), ['Flock Safety', 'Motorola Solutions']);
  assert.deepEqual(splitVendors(''), []);
  const rows = parseCsv(csv([
    row({ Vendor: 'ELSAG' }),
    row({ Vendor: 'ELSAG', Agency: 'Blue Ash Police Department' }),
    row({ Vendor: 'Elsag', Agency: 'Norwood Police Department' }),
  ]));
  const index = buildIndex({ rows, lookup, exceptions });
  // Two spellings of one vendor render as a bug. The winner is the commonest
  // spelling in the corpus, which is a fact about the data and not a preference.
  assert.deepEqual(index.counties['39061'].vendors, ['ELSAG']);
});

test('a row with no vendor is counted but does not invent one', () => {
  const rows = parseCsv(csv([row({ Vendor: '' }), row({ Agency: 'Blue Ash Police Department' })]));
  const index = buildIndex({ rows, lookup, exceptions });
  assert.equal(index.counties['39061'].n, 2);
  assert.equal(index.counties['39061'].vendorKnown, 1);
});

test('an unplaced row is published with its reason rather than dropped silently', () => {
  const rows = parseCsv(csv([
    row(),
    row({ State: 'SC', County: 'Spartanburg County/ Cherokee County', City: 'Chesnee', Agency: 'Chesnee Police Department' }),
  ]));
  const index = buildIndex({ rows, lookup, exceptions });
  assert.equal(index.totals.unplaced, 1);
  assert.equal(index.unplaced[0].agency, 'Chesnee Police Department');
  assert.match(index.unplaced[0].why, /two counties/);
});

/* ---------------------------------------------------------------------------
 * THE FETCH IS CONDITIONAL. 8.6 MB, a weak ETag, and a build that runs on a
 * schedule: pulling the whole export to discover nothing changed is the thing
 * these assert against.
 * ------------------------------------------------------------------------ */

function fakeResponse({ status = 200, body = '', headers = {} }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

test('the fetch sends If-None-Match when there is a cached copy and an etag for it', async () => {
  let sent = null;
  const result = await readAtlasCsv({
    fetchImpl: async (_url, init) => {
      sent = init.headers;
      return fakeResponse({ status: 304 });
    },
    url: 'https://example.invalid/download.csv',
    meta: { etag: 'W/"abc"', fetchedAt: '2026-09-01T00:00:00.000Z', checkedAt: '2026-09-01T00:00:00.000Z' },
    cached: 'cached body',
    now: '2026-09-07T00:00:00.000Z',
  });
  assert.equal(sent['If-None-Match'], 'W/"abc"');
  assert.equal(result.status, 'not-modified');
  assert.equal(result.text, 'cached body');
});

test('a 304 does NOT move fetchedAt, because the data did not get any newer', () => {
  // The whole point of the two stamps. `checkedAt` is our confidence; the
  // vintage of the bytes is `fetchedAt`, and confirming a file is unchanged does
  // not make it younger. Reporting it as younger is the exact mistake
  // `docs/camera-sync-runbook.md` describes.
  return readAtlasCsv({
    fetchImpl: async () => fakeResponse({ status: 304 }),
    url: 'https://example.invalid/download.csv',
    meta: { etag: 'W/"abc"', fetchedAt: '2026-08-01T00:00:00.000Z', checkedAt: '2026-08-01T00:00:00.000Z' },
    cached: 'cached body',
    now: '2026-09-07T00:00:00.000Z',
  }).then((result) => {
    assert.equal(result.fetchedAt, '2026-08-01T00:00:00.000Z');
    assert.equal(result.checkedAt, '2026-09-07T00:00:00.000Z');
  });
});

test('the fetch omits If-None-Match with no cached body, because a 304 would be unusable', async () => {
  let sent = null;
  await readAtlasCsv({
    fetchImpl: async (_url, init) => {
      sent = init.headers;
      return fakeResponse({ status: 200, body: 'x', headers: { etag: 'W/"new"' } });
    },
    url: 'https://example.invalid/download.csv',
    meta: { etag: 'W/"abc"' },
    cached: null,
    now: '2026-09-07T00:00:00.000Z',
  });
  assert.equal(sent['If-None-Match'], undefined);
});

test('a 304 with nothing cached is an error rather than an empty build', async () => {
  await assert.rejects(
    readAtlasCsv({
      fetchImpl: async () => fakeResponse({ status: 304 }),
      url: 'https://example.invalid/download.csv',
      meta: { etag: 'W/"abc"' },
      cached: null,
      now: '2026-09-07T00:00:00.000Z',
    }),
    /no cached copy/,
  );
});

test('an offline build makes no request at all rather than a quiet one', async () => {
  let called = false;
  const result = await readAtlasCsv({
    fetchImpl: async () => {
      called = true;
      return fakeResponse({ status: 200 });
    },
    url: 'https://example.invalid/download.csv',
    meta: { etag: 'W/"abc"', fetchedAt: '2026-08-01T00:00:00.000Z', checkedAt: '2026-08-02T00:00:00.000Z' },
    cached: 'cached body',
    now: '2026-09-07T00:00:00.000Z',
    offline: true,
  });
  assert.equal(called, false);
  assert.equal(result.status, 'cached');
  // NEITHER stamp moves. Nobody checked, so nothing may claim they did.
  assert.equal(result.fetchedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(result.checkedAt, '2026-08-02T00:00:00.000Z');
});

test('the Content-Disposition date is recorded but never used as a vintage', async () => {
  const result = await readAtlasCsv({
    fetchImpl: async () => fakeResponse({
      status: 200,
      body: 'x',
      headers: {
        etag: 'W/"new"',
        'content-disposition': 'attachment; filename="Atlas of Surveillance-20260907.csv"',
      },
    }),
    url: 'https://example.invalid/download.csv',
    meta: null,
    cached: null,
    now: '2026-09-07T00:00:00.000Z',
  });
  assert.equal(result.filename, 'Atlas of Surveillance-20260907.csv');
  // The date in it tracks the REQUEST, not the data, so it is carried verbatim
  // as an observation and `fetchedAt` remains the only freshness claim.
  assert.equal(result.fetchedAt, '2026-09-07T00:00:00.000Z');
});

test('every exception entry names a county the shipped Census file actually has', () => {
  // A typo in a hand-written FIPS is invisible until somebody reads a screen
  // that names the wrong sheriff, so it is checked here instead.
  for (const entry of COUNTY_EXCEPTIONS) {
    if (entry.fips === null) continue;
    assert.ok(lookup.byFips.has(entry.fips), `${entry.state} "${entry.county}" -> unknown FIPS ${entry.fips}`);
    assert.equal(
      lookup.byFips.get(entry.fips).state,
      entry.state === 'PS' ? 'MO' : entry.state,
      `${entry.state} "${entry.county}" resolves into another state`,
    );
  }
});

test('every exception entry says what was wrong with the cell', () => {
  for (const entry of COUNTY_EXCEPTIONS) {
    assert.equal(typeof entry.why, 'string');
    assert.ok(entry.why.length > 30, `${entry.state} "${entry.county}" has no real explanation`);
  }
});

test('the shipped artifact carries a fetch stamp, an attribution and an unconfirmed licence', () => {
  if (!existsSync(ARTIFACT)) return; // built by `node scripts/build-atlas-counties.mjs`
  const body = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  assert.equal(body.schema, SCHEMA);
  assert.ok(Number.isFinite(Date.parse(body.fetchedAt)), 'fetchedAt is not a date');
  assert.match(body.source.attribution, /Electronic Frontier Foundation/);
  assert.match(body.source.attribution, /Reynolds School of Journalism/);
  // THE LICENCE IS A READING. eff.org/copyright says CC BY 4.0 in prose and
  // CC BY 3.0 US in its own rel="license" badge, so a confirmed version is a
  // claim this project has no basis for.
  assert.equal(body.source.licence.confirmed, false);
  assert.doesNotMatch(body.source.licence.observed, /4\.0|3\.0/);
});

test('the shipped artifact holds no prose from the Summary column', () => {
  if (!existsSync(ARTIFACT)) return;
  const body = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  // A county entry has exactly four keys. Anything else got in by accident, and
  // "by accident" is how a copyrightable field would arrive.
  for (const county of Object.values(body.counties)) {
    assert.deepEqual(Object.keys(county).sort(), ['agencies', 'n', 'vendorKnown', 'vendors']);
  }

  /*
   * AND THE DIRECT TEST, against the real strings.
   *
   * A shape-based check is not enough here: the shortest ALPR summary in the
   * corpus is 48 characters ("The Johnson Police uses Flock Safety technology.")
   * and the longest legitimate agency name is 79, so no length bound separates
   * them, and two vendors end in "Inc." so no punctuation rule does either. The
   * only honest test is whether EFF's own sentences appear in what we publish.
   *
   * Skipped when the cached download is absent, which is the normal state of a
   * clean checkout. `pnpm test` after a build run exercises it.
   */
  if (!existsSync(CACHED_CSV)) return;
  const rows = parseCsv(readFileSync(CACHED_CSV, 'utf8'));
  const header = rows[0];
  const technology = header.indexOf('Technology');
  const summary = header.indexOf('Summary');
  const rendered = JSON.stringify(body.counties);
  let checked = 0;
  for (const csvRow of rows.slice(1)) {
    if (csvRow[technology] !== ALPR_TECHNOLOGY) continue;
    const prose = String(csvRow[summary] ?? '').trim();
    if (prose.length < 40) continue;
    assert.ok(!rendered.includes(prose), `a Summary reached the artifact: ${prose.slice(0, 60)}`);
    checked += 1;
  }
  assert.ok(checked > 1000, 'the summary check ran against almost nothing');
});
