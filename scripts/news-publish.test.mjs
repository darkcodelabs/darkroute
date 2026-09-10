import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import {
  MAX_NEWS_BYTES, NEWS_BUCKET, NEWS_KEY, publishNewsFeed, readPublishedFeed,
} from './news-publish.mjs';

const feed = {
  schema: 'darkroute-news/v1', updatedAt: '2026-09-10T05:00:00.000Z',
  lastAttemptAt: '2026-09-10T05:00:00.000Z',
  coverage: { status: 'complete', attempted: 2, succeeded: 2 },
  articles: [{ title: 'An ALPR report', url: 'https://example.com/story' }],
};
const bytes = Buffer.from(`${JSON.stringify(feed)}\n`);
const etag = `"${createHash('md5').update(bytes).digest('hex')}"`;

function clientFor(reply) {
  const commands = [];
  return {
    commands,
    async send(command) {
      commands.push(command);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

function failure(status, name) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

describe('news R2 publication', () => {
  it('reads the fixed feed key with its ETag for a conditional update', async () => {
    const client = clientFor({ Body: Readable.from([bytes]), ETag: etag, ContentLength: bytes.length });
    assert.deepEqual(await readPublishedFeed({ client }), { feed, etag });
    assert.equal(client.commands[0].constructor.name, 'GetObjectCommand');
    assert.deepEqual(client.commands[0].input, { Bucket: 'darkroute-cameras', Key: 'news/feed.json' });
  });

  it('returns null for a missing object, and preserves other read failures', async () => {
    assert.equal(await readPublishedFeed({ client: clientFor(failure(404, 'NoSuchKey')) }), null);
    for (const error of [failure(403, 'AccessDenied'), failure(500, 'InternalError'), failure(404, 'NoSuchBucket')]) {
      await assert.rejects(readPublishedFeed({ client: clientFor(error) }), (cause) => cause === error);
    }
  });

  it('rejects broken, mismatched and oversized stored data instead of replacing it', async () => {
    await assert.rejects(readPublishedFeed({ client: clientFor({ Body: Readable.from([bytes]) }) }), /ETag/);
    await assert.rejects(readPublishedFeed({ client: clientFor({ Body: Readable.from(['not json']), ETag: etag }) }), /ETag/);
    await assert.rejects(readPublishedFeed({ client: clientFor({ ContentLength: MAX_NEWS_BYTES + 1 }) }), /too large/);
    await assert.rejects(readPublishedFeed({
      client: clientFor({ Body: Readable.from([Buffer.alloc(MAX_NEWS_BYTES + 1)]), ETag: etag }),
    }), /too large/);
    const malformed = Buffer.from('not json');
    const malformedEtag = `"${createHash('md5').update(malformed).digest('hex')}"`;
    await assert.rejects(readPublishedFeed({
      client: clientFor({ Body: Readable.from([malformed]), ETag: malformedEtag }),
    }), SyntaxError);
  });

  it('creates atomically and never follows the unrelated basemap bucket default', async () => {
    const client = clientFor({ ETag: etag });
    assert.deepEqual(await publishNewsFeed(feed, { client, expectedEtag: null }), { etag });
    const command = client.commands[0];
    assert.equal(command.constructor.name, 'PutObjectCommand');
    assert.equal(command.input.Bucket, NEWS_BUCKET);
    assert.equal(command.input.Key, NEWS_KEY);
    assert.equal(command.input.IfNoneMatch, '*');
    assert.equal(command.input.IfMatch, undefined);
    assert.equal(command.input.ContentType, 'application/json; charset=utf-8');
    assert.equal(command.input.CacheControl, 'public, max-age=60');
    assert.deepEqual(command.input.Body, bytes);
    assert.equal(command.input.ContentMD5, createHash('md5').update(bytes).digest('base64'));
    assert.equal(client.commands.length, 1);
  });

  it('uses the predecessor ETag and does not retry a concurrent write unconditionally', async () => {
    const client = clientFor({ ETag: etag });
    await publishNewsFeed(feed, { client, expectedEtag: etag });
    assert.equal(client.commands[0].input.IfMatch, etag);
    assert.equal(client.commands[0].input.IfNoneMatch, undefined);
    const conflict = failure(412, 'PreconditionFailed');
    const racing = clientFor(conflict);
    await assert.rejects(publishNewsFeed(feed, { client: racing, expectedEtag: etag }), (cause) => cause === conflict);
    assert.equal(racing.commands.length, 1);
  });

  it('refuses an implicit overwrite or malformed input before sending anything', async () => {
    const client = clientFor({ ETag: etag });
    await assert.rejects(publishNewsFeed(feed, { client }), /expectedEtag is required/);
    await assert.rejects(publishNewsFeed(feed, { client, expectedEtag: '*' }), /ETag/);
    await assert.rejects(publishNewsFeed([], { client, expectedEtag: null }), /JSON object/);
    await assert.rejects(publishNewsFeed({ ...feed, extra: 'x'.repeat(MAX_NEWS_BYTES) }, { client, expectedEtag: null }), /too large/);
    assert.equal(client.commands.length, 0);
  });

  it('rejects feeds the public endpoint cannot serve before publication', async () => {
    const client = clientFor({ ETag: etag });
    for (const malformed of [
      { ...feed, schema: 'other/v1' },
      { ...feed, articles: Array.from({ length: 1001 }, () => feed.articles[0]) },
      { ...feed, articles: {} },
      { ...feed, coverage: null },
      { ...feed, coverage: [] },
      { ...feed, updatedAt: undefined },
      { ...feed, lastAttemptAt: 'not a date' },
      { ...feed, coverage: { status: 'partial', attempted: 1, succeeded: 2 } },
    ]) {
      await assert.rejects(publishNewsFeed(malformed, { client, expectedEtag: null }), /news feed/);
    }
    assert.equal(client.commands.length, 0);
    assert.equal(MAX_NEWS_BYTES, 2_097_152);
  });
});
