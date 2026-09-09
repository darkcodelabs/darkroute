/**
 * EVERY MISUSE RECORD CARRIES A CITATION, OR THE BUILD FAILS.
 *
 * `apps/pwa/public/records/counties.json` makes public allegations of
 * misconduct about named law enforcement agencies and shows them to drivers in
 * those agencies' jurisdictions. An entry without a source a reader can open is
 * not a record, it is an accusation.
 *
 * This is the same shape of gate `check-help-citations.mjs` already runs over
 * the privacy answers, for the same reason: the claim and its proof must ship
 * together or neither ships.
 *
 * WHAT IT CHECKS
 *   - every record has a county FIPS, an agency, a summary and a year
 *   - every record has an http(s) sourceUrl and a sourceName
 *   - the incident count is a positive integer, because "0 on record" is a
 *     claim nobody has made and "several" is not a number
 *   - the FIPS resolves against the camera gazetteer, so a record cannot be
 *     filed against a county that does not exist
 *
 * It does NOT fetch the URLs. A build gate that depends on the live internet
 * fails for reasons that have nothing to do with the change being built; the
 * fetching happens once, when a record is added, and is the author's job.
 *
 * Exit codes: 0 = clean, 1 = a record is unciteable, 2 = usage error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = join(ROOT, 'apps/pwa/public/records/counties.json');
const COUNTIES = join(ROOT, 'apps/pwa/public/cameras/counties.json');

if (!existsSync(RECORDS)) {
  process.stdout.write('record citations: no records file - nothing to check\n');
  process.exit(0);
}

const body = JSON.parse(readFileSync(RECORDS, 'utf8'));
const records = Array.isArray(body.records) ? body.records : [];

const known = new Set();
if (existsSync(COUNTIES)) {
  for (const row of JSON.parse(readFileSync(COUNTIES, 'utf8')).rows ?? []) {
    if (typeof row.fips === 'string') known.add(row.fips);
  }
}

const problems = [];
records.forEach((record, index) => {
  const at = `records[${index}]`;
  const fail = (why) => problems.push(`${at} ${why}`);

  if (typeof record.fips !== 'string' || !/^\d{5}$/.test(record.fips)) fail('has no five-digit county FIPS');
  else if (known.size > 0 && !known.has(record.fips)) fail(`is filed against unknown county FIPS ${record.fips}`);

  if (typeof record.agency !== 'string' || record.agency.length === 0) fail('names no agency');
  if (typeof record.summary !== 'string' || record.summary.length === 0) fail('has no summary');
  if (typeof record.sourceName !== 'string' || record.sourceName.length === 0) fail('has no sourceName');

  if (typeof record.sourceUrl !== 'string' || !/^https?:\/\//.test(record.sourceUrl)) {
    fail('has no http(s) sourceUrl - an uncited allegation must never ship');
  }
  if (!Number.isInteger(record.incidents) || record.incidents < 1) {
    fail('has no positive integer incident count');
  }
  if (!Number.isInteger(record.year) || record.year < 1990) fail('has no plausible year');
});

process.stdout.write(`record citations: ${records.length - problems.length}/${records.length} records fully cited\n`);
if (problems.length > 0) {
  process.stderr.write(`\n${problems.join('\n')}\n`);
  process.exit(1);
}
