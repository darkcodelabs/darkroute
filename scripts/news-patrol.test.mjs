import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectNews } from './news-patrol.mjs';

const now = () => '2026-09-10T00:00:00.000Z';
const story = { url: 'https://news.example.com/alpr', title: 'City installs license plate readers', domain: 'news.example.com', publishedAt: '2026-09-09T00:00:00.000Z' };

test('publishes successful searches despite another failed search', async () => {
  const waits = [];
  const feed = await collectNews({
    queries: ['a', 'b', 'c'], now, sleep: async (ms) => { waits.push(ms); },
    fetchArticles: async (query) => {
      if (query === 'b') throw new Error('HTTP 429');
      return [story];
    },
  });
  assert.deepEqual(feed.coverage, { status: 'partial', attempted: 3, succeeded: 2 });
  assert.equal(feed.articles.length, 1);
  assert.equal(feed.articles[0].topic, 'news');
  assert.deepEqual(waits, [20_000, 20_000]);
});

test('complete provider failure retains published reporting and its successful timestamp', async () => {
  const previous = await collectNews({ queries: ['a'], now, fetchArticles: async () => [story] });
  const feed = await collectNews({
    previous, queries: ['a'], now: () => '2026-09-11T00:00:00.000Z',
    fetchArticles: async () => { throw new Error('network unavailable'); },
  });
  assert.deepEqual(feed.articles, previous.articles);
  assert.equal(feed.updatedAt, previous.updatedAt);
  assert.equal(feed.lastAttemptAt, '2026-09-11T00:00:00.000Z');
  assert.equal(feed.coverage.status, 'unavailable');
});
