/**
 * Pure, bounded conversion of source headlines into the public news feed.
 * GDELT's seendate is an observation time, not a verified publication date.
 * The compatibility field publishedAt retains that upstream timestamp; callers
 * must label it Seen. A topic is a headline classification, never a finding of
 * misconduct. No incident, agency, location, or count is inferred here.
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { normalizeSourceUrl } from './misuse-patrol.mjs';

export const NEWS_SCHEMA = 'darkroute-news/v1';
export const MAX_NEWS_ARTICLES = 1000;
export const MAX_NEWS_AGE_DAYS = 180;
const MAX_INPUT_ROWS = 20_000;
const DAY_MS = 86_400_000;
const ENTITIES = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
};

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** URL admission is syntactic; no DNS resolution or article fetching occurs.
 * A news citation needs a public hostname. Literal IPs and local naming zones
 * are excluded, including URL-parser canonicalizations of numeric loopback.
 */
export function normalizePublicSourceUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('source URL must be a public HTTP(S) URL');
  }
  const url = new URL(normalizeSourceUrl(value));
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (
    isIP(host.replace(/^\[|\]$/gu, '')) !== 0 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/u.test(host) ||
    /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp|invalid|test|onion|arpa)$/u.test(host) ||
    host.length > 253
  ) {
    throw new Error('source URL must use a public hostname');
  }
  url.hostname = host;
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:dclid|msclkid|igshid|srsltid|twclid|yclid|_hsenc|_hsmi)$/iu.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

function headline(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let text = value;
  // Decode common feed entities before rejecting markup and control characters.
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, name) => {
      if (!name.startsWith('#')) return ENTITIES[name.toLowerCase()] ?? entity;
      const hex = name[1].toLowerCase() === 'x';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    });
  }
  text = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (
    text.length < 3 || text.length > 600 ||
    /<\/?[a-z!][^>]*>/iu.test(text) ||
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text)
  ) return null;
  return text;
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(value);
  let iso = dateOnly ? `${value}T00:00:00.000Z` : value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(iso)) iso = iso.replace(/Z$/u, '.000Z');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(iso)) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso ? iso : null;
}

export function classifyNewsTopic(title) {
  if (typeof title !== 'string') return 'news';
  return /\b(?:misus(?:e|ed|es|ing)|stalk(?:ing|ed|er|ers)|unauthori[sz]ed\s+(?:access|search(?:es|ing)?|use)|improper\s+(?:access|search(?:es|ing)?|use))\b/iu.test(title)
    ? 'abuse' : 'news';
}

/** Accept existing candidates, normalized GDELT articles, or previous feed rows.
 * _drop and former review fields have no authority over source-headline admission.
 */
export function normalizeNewsArticle(row) {
  if (!record(row)) return null;
  const title = headline(row.title ?? row._title);
  const publishedAt = timestamp(row.publishedAt ?? row._publishedAt);
  if (title === null || publishedAt === null) return null;
  let url;
  try { url = normalizePublicSourceUrl(row.url ?? row.sourceUrl); } catch { return null; }
  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 24),
    title, url,
    // Source-controlled labels cannot claim a different publisher's identity.
    publisher: new URL(url).hostname.replace(/^www\./u, ''),
    publishedAt,
    topic: classifyNewsTopic(title),
  };
}

function rows(value, name) {
  if (!Array.isArray(value) || value.length > MAX_INPUT_ROWS) {
    throw new Error(`${name} must be an array of at most ${String(MAX_INPUT_ROWS)} rows`);
  }
  return value;
}

function boundedInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${String(min)} through ${String(max)}`);
  }
}

/** Merge whole-sweep results. attempted/succeeded count upstream queries, not
 * stories. A successful empty response is complete; failed queries cannot erase
 * existing stories. Expiry resumes after at least one successful query.
 */
export function buildNewsFeed({
  previous = null, candidates = [], articles = [], attempted = 0, succeeded = 0,
  now = new Date().toISOString(), maxArticles = MAX_NEWS_ARTICLES,
  maxAgeDays = MAX_NEWS_AGE_DAYS,
} = {}) {
  const checkedAt = timestamp(now);
  if (checkedAt === null) throw new Error('now must be a valid UTC ISO timestamp');
  boundedInteger(attempted, 'attempted', 0, 1000);
  boundedInteger(succeeded, 'succeeded', 0, attempted);
  boundedInteger(maxArticles, 'maxArticles', 1, MAX_NEWS_ARTICLES);
  boundedInteger(maxAgeDays, 'maxAgeDays', 1, MAX_NEWS_AGE_DAYS);
  const status = succeeded === 0 ? 'unavailable' : succeeded === attempted ? 'complete' : 'partial';
  const prior = record(previous) && previous.schema === NEWS_SCHEMA ? previous : null;
  const oldRows = prior === null ? [] : rows(prior.articles, 'previous.articles');
  const incoming = [...rows(candidates, 'candidates'), ...rows(articles, 'articles')];
  const nowMs = Date.parse(checkedAt);
  const cutoff = nowMs - maxAgeDays * DAY_MS;
  const combined = [];
  for (const [collection, preserveExpired] of [[oldRows, status === 'unavailable'], [incoming, false]]) {
    for (const row of collection) {
      const article = normalizeNewsArticle(row);
      if (article === null) continue;
      const seen = Date.parse(article.publishedAt);
      if (seen > nowMs || (!preserveExpired && seen < cutoff)) continue;
      combined.push(article);
    }
  }
  combined.sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url) || a.title.localeCompare(b.title));
  const unique = new Map();
  for (const article of combined) {
    if (!unique.has(article.url)) unique.set(article.url, article);
    if (unique.size === maxArticles) break;
  }
  const priorUpdatedAt = timestamp(prior?.updatedAt);
  return {
    schema: NEWS_SCHEMA,
    updatedAt: status === 'unavailable' && priorUpdatedAt !== null ? priorUpdatedAt : checkedAt,
    lastAttemptAt: checkedAt,
    coverage: { status, attempted, succeeded },
    articles: [...unique.values()],
  };
}
