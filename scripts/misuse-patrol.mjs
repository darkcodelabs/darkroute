#!/usr/bin/env node
/**
 * Watch for reporting about ALPR misuse and write a human review queue.
 *
 * This script never edits the allegation-bearing records file. Search results
 * are leads, not evidence: a reviewer must open each source before moving a
 * candidate into counties.json. A quiet search is successful; a failed search
 * is not. The default provider is GDELT DOC 2.0, which needs no credential.
 *
 * Usage:
 *   node scripts/misuse-patrol.mjs
 *   node scripts/misuse-patrol.mjs --write
 *   node scripts/misuse-patrol.mjs --json
 *   node scripts/misuse-patrol.mjs --days 30
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RECORDS = resolve(ROOT, 'apps/pwa/public/records/counties.json');
const CANDIDATES = resolve(ROOT, 'apps/pwa/public/records/candidates.json');

export const GDELT_DOC_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
export const GDELT_QUERIES = [
  '"license plate reader" officer misuse sourcelang:english',
  '"license plate reader" stalking officer sourcelang:english',
  '"automated license plate reader" audit misuse sourcelang:english',
  '"Flock Safety" officer "searched database" sourcelang:english',
  '"plate reader" "unauthorized search" police sourcelang:english',
  '"license plate recognition" "improper access" police sourcelang:english',
];

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const MAX_RECORDS = 100;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RESPONSE_BYTES = 1_048_576;
/*
 * GDELT DOC 2.0 ASKS FOR ONE REQUEST EVERY FIVE SECONDS, AND WE WERE ASKING FOR
 * ONE EVERY TWO.
 *
 * Six standing queries at a 2s gap is three requests inside the window the API
 * allows one, from a GitHub Actions runner whose egress IP is shared with
 * thousands of other jobs already spending that budget. The patrol failed on
 * HTTP 429 every scheduled run from 2026-09-03 to 2026-09-06 - four days with
 * nobody watching for new documented abuse - and the first two of those 429s
 * were ours to prevent.
 *
 * TWENTY, NOT SEVEN, AND NOT FIVE. Seven was tried against the live endpoint on
 * 2026-09-06 and four of six queries were still throttled; the one that got
 * through went straight through, which says the limiter is a rolling quota on a
 * shared address rather than a simple per-request interval. This job runs once a
 * day on a cron and nothing waits on it, so spending two minutes instead of
 * forty seconds costs nothing and is the difference between a sweep and a sweep
 * full of holes. The floor is what the API tolerates from a client alone on its
 * address; we are on a GitHub Actions runner, sharing with thousands.
 */
const QUERY_PAUSE_MS = 20_000;
const USER_AGENT = 'DarkRoute-misuse-patrol/1.0 (+https://darkroute.ai)';
const TRACKING_PARAMETERS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);
const NOISE = [
  'stock',
  'shares',
  'earnings',
  'ipo',
  'funding round',
  'series b',
  'series c',
  'partnership announcement',
  'now available',
  'product launch',
];

class UsageError extends Error {}

function cleanText(value) {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, field) {
  const cleaned = schemaString(value, field);
  if (cleaned === '') throw new Error(`GDELT response has an invalid ${field}`);
  return cleaned;
}

function schemaString(value, field) {
  if (typeof value !== 'string') throw new Error(`GDELT response has an invalid ${field}`);
  return cleanText(value);
}

function optionalString(value, field) {
  if (value === undefined) return '';
  return schemaString(value, field);
}

export function normalizeSourceUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    throw new Error('source URL must be a non-empty string no longer than 8192 bytes');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('source URL is not an absolute URL');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error('source URL must be credential-free HTTP(S)');
  }

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMETERS.has(lower)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

function gdeltPublishedAt(value) {
  const raw = requiredString(value, 'articles[].seendate');
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  if (match === null) throw new Error('GDELT response has an invalid articles[].seendate');

  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== iso) {
    throw new Error('GDELT response has an impossible articles[].seendate');
  }
  return iso;
}

export function parseGdeltPayload(value) {
  if (!isRecord(value) || !Array.isArray(value.articles)) {
    throw new Error('GDELT response must be an object with an articles array');
  }
  if (value.articles.length > MAX_RECORDS) {
    throw new Error(`GDELT response exceeds the ${String(MAX_RECORDS)}-article request limit`);
  }

  return value.articles.map((article, index) => {
    if (!isRecord(article))
      throw new Error(`GDELT response has an invalid articles[${String(index)}]`);
    const mobileUrl = optionalString(article.url_mobile, `articles[${String(index)}].url_mobile`);
    return {
      url: normalizeSourceUrl(requiredString(article.url, `articles[${String(index)}].url`)),
      title: requiredString(article.title, `articles[${String(index)}].title`),
      publishedAt: gdeltPublishedAt(article.seendate),
      domain: requiredString(article.domain, `articles[${String(index)}].domain`).toLowerCase(),
      language: requiredString(article.language, `articles[${String(index)}].language`),
      // GDELT emits an empty country for some otherwise valid outlets. The
      // field must still exist with the documented string type; it is context,
      // never an admission or filtering decision.
      sourceCountry: schemaString(
        article.sourcecountry,
        `articles[${String(index)}].sourcecountry`,
      ),
      mobileUrl: mobileUrl === '' ? '' : normalizeSourceUrl(mobileUrl),
    };
  });
}

export function buildGdeltUrl(days, query) {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new Error(`days must be an integer from 1 through ${String(MAX_DAYS)}`);
  }
  if (!GDELT_QUERIES.includes(query)) throw new Error('query is not in the reviewed standing set');
  const url = new URL(GDELT_DOC_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'artlist');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(MAX_RECORDS));
  url.searchParams.set('timespan', `${String(days)}d`);
  url.searchParams.set('sort', 'datedesc');
  return url;
}

async function readChunk(reader, signal, timeoutMs) {
  if (signal.aborted) throw new Error(`GDELT request timed out after ${String(timeoutMs)}ms`);
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(new Error(`GDELT request timed out after ${String(timeoutMs)}ms`));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function readBoundedBody(response, maxBytes, signal, timeoutMs) {
  const length = response.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new Error('GDELT response has an invalid Content-Length');
    if (Number(length) > maxBytes)
      throw new Error('GDELT response is larger than the safety limit');
  }
  if (response.body === null) throw new Error('GDELT response has no body');

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await readChunk(reader, signal, timeoutMs);
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('GDELT response is larger than the safety limit');
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } catch {
    throw new Error('GDELT response is not valid UTF-8');
  }
}

/**
 * How many times a single query is attempted before the run fails.
 *
 * FOUR ATTEMPTS, 2s / 8s / 32s apart. GDELT DOC 2.0 is a free public endpoint
 * with no key and an undocumented, fairly aggressive rate limit - a plain
 * `curl` from a quiet host draws a 429 - so a single 429 says almost nothing
 * about whether the service is up.
 *
 * THE POINT IS NOT TO PAPER OVER FAILURE. A patrol that goes red on a
 * transient limit trains its owner to ignore it, which is the same end state
 * as a patrol that lies: nobody reads the result. Exhausting these retries
 * still THROWS, so a genuine outage fails the workflow loudly, which is the
 * property that matters and is why this run reports a non-zero exit rather
 * than an empty candidate list.
 *
 * The history is why the bar is here at all: this patrol reported success
 * every day for weeks while searching NOTHING, because it required an API key
 * that was never set and treated the absence as a clean no-op.
 */
export const GDELT_ATTEMPTS = 4;

/**
 * Backoff before attempt n+1, in ms.
 *
 * A RATE LIMIT AND A DROPPED CONNECTION ARE NOT THE SAME FAILURE. A transport
 * blip is worth retrying in two seconds. An HTTP 429 is the endpoint saying
 * "you are asking too often", and answering it two seconds later is asking too
 * often again - which is what the 2026-09-03 through 2026-09-06 failures did,
 * three times each, before giving up.
 *
 * So 429 starts at fifteen seconds, three times the interval GDELT publishes,
 * and everything else keeps the old ramp.
 */
export function gdeltBackoffMs(attempt, rateLimited = false) {
  const base = rateLimited ? 15_000 : 2_000;
  return base * 4 ** (attempt - 1);
}

/** Did this failure come from the endpoint asking us to slow down? */
export function isRateLimit(message) {
  return /HTTP 429\b/.test(String(message));
}

/** Is this failure worth another attempt, or is it the answer? */
export function isRetryableGdeltFailure(message) {
  // A rate limit, a gateway/server error, a timeout, or a transport failure.
  // NOT a malformed payload, an unexpected redirect or a wrong content type:
  // those are the endpoint telling us something true about itself, and
  // retrying them just spends more time arriving at the same answer.
  return (
    /HTTP (?:429|5\d\d)\b/.test(message) ||
    message.includes('timed out') ||
    message.includes('GDELT request failed:')
  );
}

/**
 * One query, retried through transient failures, loud on a real one.
 *
 * Injectable clock and fetch so the tests can exercise the backoff without
 * spending 42 seconds doing it.
 */
export async function fetchWithRetry({
  days,
  query,
  announce = null,
  attempts = GDELT_ATTEMPTS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  fetchArticles = fetchGdeltArticles,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchArticles({ days, query });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === attempts || !isRetryableGdeltFailure(message)) throw error;
      lastError = error;
      const wait = gdeltBackoffMs(attempt, isRateLimit(message));
      announce?.(`    ${message}; retrying in ${String(Math.round(wait / 1000))}s`);
      await sleep(wait);
    }
  }
  /* c8 ignore next 2 -- the loop either returns or throws; this is a guard. */
  throw lastError ?? new Error('GDELT request failed');
}

export async function fetchGdeltArticles({
  days,
  query,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('GDELT timeout must be an integer from 1 through 120000ms');
  }
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 8_388_608) {
    throw new Error('GDELT response limit must be an integer from 1 through 8388608 bytes');
  }
  const url = buildGdeltUrl(days, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`GDELT request timed out after ${String(timeoutMs)}ms`);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`GDELT request failed: ${detail}`);
    }

    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new Error('GDELT request unexpectedly redirected');
    }
    if (!response.ok) throw new Error(`GDELT request failed with HTTP ${String(response.status)}`);
    if (response.url !== '' && response.url !== url.href) {
      throw new Error('GDELT response URL does not match the requested endpoint');
    }

    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') {
      throw new Error(`GDELT response is not JSON (Content-Type ${mediaType ?? 'missing'})`);
    }
    const text = await readBoundedBody(response, maxResponseBytes, controller.signal, timeoutMs);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('GDELT response contains invalid JSON');
    }
    return parseGdeltPayload(body).map((article) => ({ ...article, query }));
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeNoise(text) {
  const haystack = text.toLowerCase();
  return NOISE.some((word) => haystack.includes(word));
}

function candidateOrder(a, b) {
  return (
    String(b._publishedAt).localeCompare(String(a._publishedAt)) ||
    String(a.sourceUrl).localeCompare(String(b.sourceUrl)) ||
    String(a._title).localeCompare(String(b._title))
  );
}

export function makeCandidates(articles, knownUrls = new Set()) {
  const ordered = [...articles].sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.url.localeCompare(b.url) ||
      a.title.localeCompare(b.title) ||
      String(a.query).localeCompare(String(b.query)),
  );
  const found = new Map();
  for (const article of ordered) {
    if (!GDELT_QUERIES.includes(article.query)) {
      throw new Error('normalized article is missing its reviewed standing query');
    }
    if (knownUrls.has(article.url) || found.has(article.url)) continue;
    if (looksLikeNoise(article.title)) continue;
    found.set(article.url, {
      fips: '',
      agency: '',
      summary: '',
      incidents: 0,
      year: 0,
      sourceUrl: article.url,
      sourceName: article.domain,
      _title: article.title,
      _description: '',
      _publishedAt: article.publishedAt,
      _query: article.query,
    });
  }
  return [...found.values()].sort(candidateOrder);
}

function readJson(path, collection) {
  let body;
  try {
    body = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not readable JSON: ${detail}`);
  }
  if (!isRecord(body) || !Array.isArray(body[collection])) {
    throw new Error(`${path} must contain a ${collection} array`);
  }
  return body[collection];
}

function loadReviewState() {
  const knownUrls = new Set();
  for (const record of readJson(RECORDS, 'records')) {
    if (!isRecord(record)) throw new Error(`${RECORDS} contains a non-object record`);
    knownUrls.add(normalizeSourceUrl(record.sourceUrl));
  }

  const existingCandidates = existsSync(CANDIDATES) ? readJson(CANDIDATES, 'candidates') : [];
  for (const candidate of existingCandidates) {
    if (!isRecord(candidate)) throw new Error(`${CANDIDATES} contains a non-object candidate`);
    knownUrls.add(normalizeSourceUrl(candidate.sourceUrl));
  }
  return { knownUrls, existingCandidates };
}

function parseArgs(argv) {
  const options = { write: false, json: false, days: DEFAULT_DAYS };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write') options.write = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--days') {
      const value = argv[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new UsageError('--days needs an integer');
      }
      options.days = Number(value);
      index += 1;
    } else throw new UsageError(`unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > MAX_DAYS) {
    throw new UsageError(`--days must be from 1 through ${String(MAX_DAYS)}`);
  }
  return options;
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const { knownUrls, existingCandidates } = loadReviewState();
  const since = new Date(Date.now() - options.days * 86_400_000).toISOString().slice(0, 10);
  if (!options.json) {
    console.log(`searching GDELT DOC 2.0 since ${since}; ${String(knownUrls.size)} urls on file`);
  }

  /*
   * ONE RATE-LIMITED QUERY NO LONGER COSTS THE WHOLE DAY'S PATROL.
   *
   * This threw out of the loop, so the sixth query being throttled discarded
   * the five that had already answered and the run ended with nothing. Between
   * 2026-09-03 and 2026-09-06 that happened every single day: four days of
   * documented ALPR abuse went unwatched because an endpoint was busy.
   *
   * The queries are independent - they are six different searches, not six
   * pages of one - so a failure is a HOLE in the sweep, not a broken sweep. The
   * run carries on and records which searches did not happen.
   *
   * IT IS NOT ALLOWED TO LOOK CLEAN. A patrol that quietly returns four
   * candidates from five queries, when the sixth is the stalking one, reads as
   * "we looked and found four" - which is the exact false-absence this app
   * refuses everywhere else. `skipped` travels with the result, the summary
   * says so out loud, and a run where EVERY query failed still fails the job,
   * because that is not a patrol with a hole in it, that is no patrol.
   */
  const articles = [];
  const skipped = [];
  for (const [index, query] of GDELT_QUERIES.entries()) {
    if (!options.json) console.log(`  query ${String(index + 1)}/${String(GDELT_QUERIES.length)}`);
    try {
      articles.push(
        ...(await fetchWithRetry({
          days: options.days,
          query,
          announce: options.json
            ? null
            : (line) => {
                console.log(line);
              },
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skipped.push({ query, reason: message });
      if (!options.json) console.log(`    SKIPPED: ${message}`);
    }
    if (index + 1 < GDELT_QUERIES.length) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, QUERY_PAUSE_MS));
    }
  }

  if (skipped.length === GDELT_QUERIES.length) {
    throw new Error(
      `every GDELT query failed; the last said: ${String(skipped[skipped.length - 1]?.reason)}`,
    );
  }
  const candidates = makeCandidates(articles, knownUrls);
  if (options.json) {
    console.log(
      JSON.stringify({ searched: true, provider: 'GDELT DOC 2.0', candidates, skipped }, null, 2),
    );
  } else {
    if (skipped.length > 0) {
      console.log(
        `\n${String(skipped.length)} of ${String(GDELT_QUERIES.length)} searches did not run:`,
      );
      for (const gap of skipped) console.log(`  - ${gap.query}\n    ${gap.reason}`);
      console.log('this sweep has holes in it. what is below is not "all there was".');
    }
    console.log(
      `\n${String(candidates.length)} new candidate${candidates.length === 1 ? '' : 's'}`,
    );
    for (const candidate of candidates.slice(0, 20)) {
      console.log(`  ${candidate._publishedAt.slice(0, 10)}  ${candidate._title}`);
      console.log(`      ${candidate.sourceUrl}`);
    }
  }

  if (options.write && candidates.length > 0) {
    const reviewQueue = [...existingCandidates, ...candidates].sort(candidateOrder);
    writeFileSync(
      CANDIDATES,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note:
            'REVIEW QUEUE, NOT RECORDS. Nothing here is shown in the app. A person reads each ' +
            'source, fills in fips/agency/summary/incidents/year, drops the _ fields, and moves ' +
            'the entry into counties.json - where check-record-citations.mjs will gate it.',
          candidates: reviewQueue,
        },
        null,
        2,
      )}\n`,
    );
    if (!options.json) {
      console.log(
        `\nwrote ${String(reviewQueue.length)} candidates to apps/pwa/public/records/candidates.json`,
      );
    }
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await runCli();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`misuse-patrol: ${detail}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
