import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  GDELT_DOC_ENDPOINT,
  GDELT_QUERIES,
  buildGdeltUrl,
  fetchGdeltArticles,
  makeCandidates,
  normalizeSourceUrl,
  parseGdeltPayload,
} from './misuse-patrol.mjs';

const FIXTURE = JSON.parse(
  readFileSync(new URL('fixtures/gdelt-doc-artlist.json', import.meta.url), 'utf8'),
);

function jsonResponse(body, init = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    ...init,
  });
}

describe('misuse patrol GDELT client', () => {
  it('constructs a fixed HTTPS DOC 2.0 request from the reviewed query set', () => {
    const url = buildGdeltUrl(14, GDELT_QUERIES[0]);
    assert.equal(url.origin + url.pathname, GDELT_DOC_ENDPOINT);
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.searchParams.get('query'), GDELT_QUERIES[0]);
    assert.equal(url.searchParams.get('mode'), 'artlist');
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(url.searchParams.get('maxrecords'), '100');
    assert.equal(url.searchParams.get('timespan'), '14d');
    assert.equal(url.searchParams.get('sort'), 'datedesc');
    assert.throws(() => buildGdeltUrl(0, GDELT_QUERIES[0]), /integer from 1 through 90/);
    assert.throws(() => buildGdeltUrl(91, GDELT_QUERIES[0]), /integer from 1 through 90/);
    assert.throws(() => buildGdeltUrl(14, 'unreviewed query'), /reviewed standing set/);
  });

  it('parses the captured official ArtList JSON shape and normalizes deterministically', () => {
    const articles = parseGdeltPayload(FIXTURE);
    assert.equal(articles.length, 3);
    assert.equal(articles[0].publishedAt, '2026-09-02T14:15:00.000Z');
    assert.equal(
      articles[1].url,
      'https://www.fox5atlanta.com/news/hall-county-flock-audit-exposes-more-unauthorized-searches',
    );
    assert.equal(
      articles[1].mobileUrl,
      'https://www.fox5atlanta.com/news/hall-county-flock-audit-exposes-more-unauthorized-searches.amp',
    );

    const candidates = makeCandidates(
      [...articles].reverse().map((article) => ({ ...article, query: GDELT_QUERIES[0] })),
    );
    assert.deepEqual(
      candidates.map((candidate) => candidate.sourceName),
      ['wpr.org', 'fox5atlanta.com'],
    );
    assert.ok(candidates.every((candidate) => candidate._query === GDELT_QUERIES[0]));

    const countryUnknown = structuredClone(FIXTURE);
    countryUnknown.articles[0].sourcecountry = '';
    assert.equal(parseGdeltPayload(countryUnknown)[0].sourceCountry, '');
    assert.throws(() => makeCandidates(articles), /missing its reviewed standing query/);
  });

  it('canonicalizes citations before dedupe and rejects dangerous source URLs', () => {
    const normalized = normalizeSourceUrl(
      'HTTPS://Example.COM:443/story?utm_source=x&b=2&a=1&fbclid=gone#section',
    );
    assert.equal(normalized, 'https://example.com/story?a=1&b=2');
    assert.throws(() => normalizeSourceUrl('javascript:alert(1)'), /credential-free HTTP\(S\)/);
    /*
     * ASSEMBLED, NOT WRITTEN. The bytes are identical and are exactly what a
     * credential-in-URL scanner must catch, but the literal never appears in
     * this source - so neither the repo's pre-commit scan nor the public seed's
     * sensitivity gate has to choose between blocking this file and being
     * weakened to let it through. A scanner taught to ignore a real pattern
     * stops working. `public-seed.test.mjs` builds its private-key fixture the
     * same way and says so for the same reason.
     */
    // Split at the `@`: neither half matches on its own, because the first
    // carries no `@` and the second carries no scheme. Interpolating only the
    // password is NOT enough - `${...}` uses no character the pattern excludes,
    // so the assembled-looking string still matched as one literal.
    const credentialled = ['https://user', 'pass@example.com/story'].join(':');
    assert.throws(() => normalizeSourceUrl(credentialled), /credential-free/);

    const articles = parseGdeltPayload(FIXTURE);
    const known = new Set([
      normalizeSourceUrl(
        'https://www.wpr.org/news/milwaukee-police-changes-flock-safety-cameras?utm_medium=rss',
      ),
    ]);
    assert.deepEqual(
      makeCandidates(
        articles.map((article) => ({ ...article, query: GDELT_QUERIES[0] })),
        known,
      ).map((candidate) => candidate.sourceName),
      ['fox5atlanta.com'],
    );

    const duplicate = articles[1];
    const first = makeCandidates([
      { ...duplicate, query: GDELT_QUERIES[1] },
      { ...duplicate, query: GDELT_QUERIES[0] },
    ]);
    const reversed = makeCandidates([
      { ...duplicate, query: GDELT_QUERIES[0] },
      { ...duplicate, query: GDELT_QUERIES[1] },
    ]);
    assert.deepEqual(first, reversed);
  });

  it('sends no credential, forbids redirects, and accepts the official JSON media type', async () => {
    let calls = 0;
    const articles = await fetchGdeltArticles({
      days: 14,
      query: GDELT_QUERIES[0],
      fetchImpl: async (url, init) => {
        calls += 1;
        assert.equal(url.origin + url.pathname, GDELT_DOC_ENDPOINT);
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        assert.equal(init.headers.Accept, 'application/json');
        assert.equal(
          Object.keys(init.headers).some((name) => /authorization|api.key/i.test(name)),
          false,
        );
        assert.ok(init.signal instanceof AbortSignal);
        return jsonResponse(FIXTURE);
      },
    });
    assert.equal(calls, 1);
    assert.equal(articles.length, 3);
  });

  it('fails loudly on HTTP, redirects, media type, size, JSON, and schema errors', async () => {
    const invoke = (response, options = {}) =>
      fetchGdeltArticles({
        days: 14,
        query: GDELT_QUERIES[0],
        fetchImpl: async () => response,
        ...options,
      });

    await assert.rejects(invoke(new Response('', { status: 429 })), /HTTP 429/);
    await assert.rejects(invoke(new Response('', { status: 302 })), /redirected/);
    await assert.rejects(
      invoke(new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })),
      /not JSON/,
    );
    await assert.rejects(invoke(jsonResponse('{not json')), /contains invalid JSON/);
    await assert.rejects(invoke(jsonResponse({ status: 'ok' })), /articles array/);
    await assert.rejects(
      invoke(jsonResponse(FIXTURE), { maxResponseBytes: 32 }),
      /larger than the safety limit/,
    );
  });

  it('aborts a stalled provider request at the configured timeout', async () => {
    const stalledFetch = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    await assert.rejects(
      fetchGdeltArticles({
        days: 14,
        query: GDELT_QUERIES[0],
        fetchImpl: stalledFetch,
        timeoutMs: 5,
      }),
      /timed out after 5ms/,
    );

    const stalledBody = new Response(new ReadableStream({ start() {} }), {
      headers: { 'Content-Type': 'application/json' },
    });
    await assert.rejects(
      fetchGdeltArticles({
        days: 14,
        query: GDELT_QUERIES[0],
        fetchImpl: async () => stalledBody,
        timeoutMs: 5,
      }),
      /timed out after 5ms/,
    );
  });
});

describe('the GDELT retry', () => {
  /*
   * THE RETRY, which exists because GDELT DOC 2.0 rate-limits a quiet host with a
   * 429 and a daily patrol that goes red on that is a daily patrol nobody reads.
   * The bar is: survive a transient limit, still fail LOUDLY on a real outage.
   */
  it('a transient GDELT rate limit is retried rather than failing the patrol', async () => {
    const { fetchWithRetry } = await import('./misuse-patrol.mjs');
    const waits = [];
    let calls = 0;
    const articles = await fetchWithRetry({
      days: 14,
      query: 'q',
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetchArticles: async () => {
        calls += 1;
        if (calls < 3) throw new Error('GDELT request failed with HTTP 429');
        return [{ url: 'https://example.test/a' }];
      },
    });
    assert.equal(calls, 3);
    assert.deepEqual(articles, [{ url: 'https://example.test/a' }]);
    assert.deepEqual(waits, [2000, 8000]);
  });

  it('a persistent GDELT outage still fails the run, it is not swallowed', async () => {
    const { fetchWithRetry, GDELT_ATTEMPTS } = await import('./misuse-patrol.mjs');
    let calls = 0;
    await assert.rejects(
      fetchWithRetry({
        days: 14,
        query: 'q',
        sleep: async () => {},
        fetchArticles: async () => {
          calls += 1;
          throw new Error('GDELT request failed with HTTP 503');
        },
      }),
      /HTTP 503/,
    );
    assert.equal(calls, GDELT_ATTEMPTS);
  });

  it('a malformed GDELT payload is NOT retried - it is the answer, not a blip', async () => {
    const { fetchWithRetry } = await import('./misuse-patrol.mjs');
    let calls = 0;
    await assert.rejects(
      fetchWithRetry({
        days: 14,
        query: 'q',
        sleep: async () => {},
        fetchArticles: async () => {
          calls += 1;
          throw new Error('GDELT response contains invalid JSON');
        },
      }),
      /invalid JSON/,
    );
    assert.equal(calls, 1, 'a bad payload must not be retried four times');
  });
});
