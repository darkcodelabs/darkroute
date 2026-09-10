import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNewsFeed, classifyNewsTopic, deduplicateNewsArticles, normalizeNewsArticle, normalizePublicSourceUrl,
} from './news-feed.mjs';

const NOW = '2026-09-10T12:00:00.000Z';
const SOURCE = {
  url: 'https://www.example.com/news/cameras', title: 'Council discusses license plate readers',
  domain: 'untrusted-publisher.example', publishedAt: '2026-09-09T12:00:00.000Z',
  query: 'license plate reader',
};
const candidate = {
  sourceUrl: SOURCE.url, sourceName: SOURCE.domain, _title: SOURCE.title,
  _publishedAt: SOURCE.publishedAt, _query: 'misuse', _drop: true,
  agency: 'do not publish this', incidents: 900, fips: '12345', summary: 'unverified',
};

describe('public news citations', () => {
  it('normalizes URLs and drops tracking without dropping meaningful parameters', () => {
    assert.equal(normalizePublicSourceUrl(
      'HTTPS://WWW.Example.COM.:443/story?utm_source=x&b=2&a=1&fbclid=x&msclkid=x#part',
    ), 'https://www.example.com/story?a=1&b=2');
    assert.equal(normalizePublicSourceUrl('http://news.example.com/story'), 'http://news.example.com/story');
  });

  it('rejects credentials, non-web links, malformed links, and private/local forms', () => {
    const credentialled = ['https://user', 'pass@example.com/story'].join(':');
    for (const url of [
      credentialled, 'javascript:alert(1)', 'file:///etc/passwd', '/relative', '', null,
      'https://localhost/story', 'http://localhost./', 'http://host.local/',
      'http://host.internal/', 'https://intranet/', 'https://private.lan/',
      'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/',
      'http://10.2.3.4/', 'http://172.16.0.1/', 'http://192.168.1.1/',
      'http://169.254.169.254/', 'http://100.64.0.1/', 'http://[::1]/',
      'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/',
      'https://example.com/\u0000story', 'https://example.com/' + 'a'.repeat(8192),
    ]) assert.throws(() => normalizePublicSourceUrl(url), String(url));
  });

  it('only emits a dated headline, source identity and lexical topic from candidates', () => {
    const article = normalizeNewsArticle(candidate);
    assert.deepEqual(Object.keys(article), ['id', 'title', 'url', 'publisher', 'publishedAt', 'topic']);
    assert.equal(article.publisher, 'example.com');
    assert.equal(article.topic, 'news');
    assert.equal(article.id, normalizeNewsArticle(SOURCE).id);
    assert.equal(article.title, SOURCE.title);
  });

  it('decodes feed entities without admitting HTML, impossible dates or incomplete rows', () => {
    const decoded = normalizeNewsArticle({ ...SOURCE, title: 'Council &amp; residents: &#8220;ALPR&#8221;' });
    assert.equal(decoded.title, 'Council & residents: “ALPR”');
    for (const row of [
      null, [], {}, { ...SOURCE, title: '' }, { ...SOURCE, title: '<script>alert(1)</script>' },
      { ...SOURCE, title: '&lt;img src=x onerror=alert(1)&gt;' },
      { ...SOURCE, title: 'a'.repeat(601) }, { ...SOURCE, title: 'x\u202ey' },
      { ...SOURCE, publishedAt: '2026-02-30T12:00:00.000Z' },
      { ...SOURCE, publishedAt: 'September 9, 2026' }, { ...SOURCE, publishedAt: null },
      { ...SOURCE, url: 'http://localhost/' },
    ]) assert.equal(normalizeNewsArticle(row), null);
    assert.equal(normalizeNewsArticle({ ...SOURCE, publishedAt: '2026-09-09' }).publishedAt,
      '2026-09-09T00:00:00.000Z');
  });

  it('classifies explicit misuse language without treating query terms or ordinary news as abuse', () => {
    for (const title of [
      'ALPR misuse investigation', 'Officer misused plate database', 'Stalking allegation involves cameras',
      'Audit finds unauthorized searches', 'Police investigate unauthorised access',
      'Report of improper access to plate records',
    ]) assert.equal(classifyNewsTopic(title), 'abuse', title);
    for (const title of [
      'Council approves Flock cameras', 'ALPR privacy debate', 'Police audit license plate readers',
      'Camera company stock rises', 'Unauthorized protest at city hall', 'Road access improves',
    ]) assert.equal(classifyNewsTopic(title), 'news', title);
  });
});

describe('bounded news feed refresh', () => {
  it('collapses the same publisher story across section aliases and repeated sightings', () => {
    const rows = ['spotlightnews', 'ade', 'leader_herald', 'the_recorder', 'hv360'].map((section, index) =>
      normalizeNewsArticle({ ...SOURCE, title: 'Flock data misused by Albany County investigator : Sheriff | News',
        url: `https://www.dailygazette.com/${section}/news/article_5047ba1c-0563-4b8f-960c-837d8b2f20bd.html`,
        publishedAt: index === 0 ? NOW : SOURCE.publishedAt }));
    const otherPublisher = normalizeNewsArticle({ ...SOURCE, title: rows[0].title, url: 'https://other.example.com/story' });
    const correctedHeadline = { ...rows[1], title: 'Sheriff releases findings of the Albany County investigation' };
    const result = deduplicateNewsArticles([...rows, correctedHeadline, otherPublisher]);
    assert.equal(result.length, 2);
    assert.equal(result[0].url, rows[0].url);
    assert.equal(result[0].publishedAt, NOW);
    assert.equal(result[1].publisher, 'other.example.com');
  });

  it('also collapses matching publisher headlines without an article UUID', () => {
    const rows = [
      normalizeNewsArticle(SOURCE),
      normalizeNewsArticle({ ...SOURCE, url: 'https://example.com/another-section/cameras', title: 'Council discusses license plate readers!', publishedAt: NOW }),
      normalizeNewsArticle({ ...SOURCE, url: 'https://example.com/different', title: 'Council votes to remove all cameras' }),
    ];
    assert.equal(deduplicateNewsArticles(rows).length, 2);
  });
  it('deduplicates normalized citations deterministically and keeps the newest seen time', () => {
    const newer = { ...SOURCE, url: `${SOURCE.url}?utm_medium=rss`, publishedAt: NOW };
    const rows = [SOURCE, newer, { ...SOURCE, url: 'https://example.org/second' }];
    const first = buildNewsFeed({ candidates: [candidate], articles: rows, attempted: 6, succeeded: 3, now: NOW });
    const reversed = buildNewsFeed({ candidates: [candidate], articles: rows.toReversed(), attempted: 6, succeeded: 3, now: NOW });
    assert.deepEqual(first, reversed);
    assert.equal(first.articles.length, 2);
    assert.equal(first.articles[0].publishedAt, NOW);
    assert.equal(first.articles[0].title, SOURCE.title);
    assert.deepEqual(first.coverage, { status: 'partial', attempted: 6, succeeded: 3 });
  });

  it('a complete empty search preserves prior stories and advances refresh time', () => {
    const previous = buildNewsFeed({ articles: [SOURCE], attempted: 2, succeeded: 2, now: NOW });
    const later = '2026-09-11T12:00:00.000Z';
    const refreshed = buildNewsFeed({ previous, attempted: 2, succeeded: 2, now: later });
    assert.deepEqual(refreshed.articles, previous.articles);
    assert.equal(refreshed.coverage.status, 'complete');
    assert.equal(refreshed.updatedAt, later);
  });

  it('all-fail preserves previous stories and last successful refresh, even during a long outage', () => {
    const previous = buildNewsFeed({ articles: [SOURCE], attempted: 6, succeeded: 3, now: NOW });
    const later = '2027-05-01T12:00:00.000Z';
    const failed = buildNewsFeed({ previous, attempted: 6, succeeded: 0, now: later });
    assert.deepEqual(failed.articles, previous.articles);
    assert.equal(failed.updatedAt, previous.updatedAt);
    assert.equal(failed.lastAttemptAt, later);
    assert.deepEqual(failed.coverage, { status: 'unavailable', attempted: 6, succeeded: 0 });
  });

  it('keeps valid rows through partial failures, bounds retention and rejects future observations', () => {
    const rows = [
      SOURCE, {}, { ...SOURCE, url: 'https://example.org/old', publishedAt: '2025-01-01T00:00:00.000Z' },
      { ...SOURCE, url: 'https://example.org/future', publishedAt: '2027-01-01T00:00:00.000Z' },
      { ...SOURCE, url: 'https://example.org/newest', publishedAt: NOW },
    ];
    const feed = buildNewsFeed({ articles: rows, attempted: 6, succeeded: 3, now: NOW, maxArticles: 1 });
    assert.equal(feed.articles.length, 1);
    assert.equal(feed.articles[0].url, 'https://example.org/newest');
    assert.equal(feed.coverage.status, 'partial');
    assert.equal(buildNewsFeed({ articles: rows, attempted: 1, succeeded: 1, now: NOW }).articles.length, 2);
  });

  it('seeds dated legacy candidates without a review gate and rejects unbounded options', () => {
    const candidates = Array.from({ length: 142 }, (_, i) => ({ ...candidate, _title: `${candidate._title} ${i}`, sourceUrl: `https://example.com/story/${i}` }));
    assert.equal(buildNewsFeed({ candidates, attempted: 6, succeeded: 3, now: NOW }).articles.length, 142);
    for (const options of [
      { maxArticles: 1001 }, { maxAgeDays: 181 }, { attempted: 1, succeeded: 2 },
      { attempted: -1 }, { now: 'invalid' }, { candidates: {} }, { articles: new Array(20_001) },
    ]) assert.throws(() => buildNewsFeed({ now: NOW, ...options }));
    assert.deepEqual(buildNewsFeed({ now: NOW }).coverage, { status: 'unavailable', attempted: 0, succeeded: 0 });
  });
});
