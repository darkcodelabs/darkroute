#!/usr/bin/env node
/** Automatic ALPR reporting: the production fetcher, with no review queue. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { fetchWithRetry, GDELT_QUERIES, NEWS_GDELT_QUERIES } from './misuse-patrol.mjs';
import { buildNewsFeed } from './news-feed.mjs';
import { readPublishedFeed, publishNewsFeed } from './news-publish.mjs';

export const PATROL_QUERIES = [...NEWS_GDELT_QUERIES, ...GDELT_QUERIES];
// Nine bounded queries finish within the host unit's 45-minute deadline even
// if every request times out or is rate-limited. Preserve time for publication.
export const NEWS_QUERY_ATTEMPTS = 3;

export async function collectNews({
  previous = null, candidates = [], days = 14, queries = PATROL_QUERIES,
  fetchArticles = (query) => fetchWithRetry({ days, query, announce, attempts: NEWS_QUERY_ATTEMPTS }),
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  announce = () => {}, now = () => new Date().toISOString(),
} = {}) {
  const articles = [];
  let succeeded = 0;
  for (const [index, query] of queries.entries()) {
    announce(`Search ${String(index + 1)}/${String(queries.length)}: ${query}`);
    try {
      articles.push(...await fetchArticles(query));
      succeeded += 1;
    } catch (error) {
      announce(`Partial coverage: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (index + 1 < queries.length) await sleep(20_000);
  }
  return buildNewsFeed({ previous, candidates, articles, attempted: queries.length, succeeded, now: now() });
}

async function run() {
  const options = { publish: false, json: false, days: 14, output: null, seed: null };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--publish') options.publish = true;
    else if (argument === '--json') options.json = true;
    else if (['--days', '--output', '--seed'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value`);
      if (argument === '--days') options.days = Number(value);
      else if (argument === '--output') options.output = value;
      else options.seed = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 90) {
    throw new Error('--days must be an integer from 1 through 90');
  }
  const published = options.publish ? await readPublishedFeed() : null;
  let candidates = [];
  if (options.seed !== null) {
    const seed = JSON.parse(readFileSync(options.seed, 'utf8'));
    if (!Array.isArray(seed.candidates)) throw new Error('Seed must contain candidates');
    candidates = seed.candidates;
  }
  const feed = await collectNews({
    previous: published?.feed ?? null, candidates, days: options.days,
    announce: options.json ? () => {} : (line) => console.log(line),
  });
  if (options.publish) {
    await publishNewsFeed(feed, { expectedEtag: published?.etag ?? null });
  }
  if (options.output !== null) writeFileSync(options.output, `${JSON.stringify(feed, null, 2)}\n`);
  if (options.json) console.log(JSON.stringify(feed));
  else console.log(`${options.publish ? 'Published' : 'Collected'} ${String(feed.articles.length)} articles; ${feed.coverage.status} (${String(feed.coverage.succeeded)}/${String(feed.coverage.attempted)} searches).`);
  // Keep the previous articles visible while marking a completely failed run.
  if (feed.coverage.status === 'unavailable') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    console.error(`news-patrol: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
