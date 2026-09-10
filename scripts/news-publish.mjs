/** Publish the independently refreshed news feed without touching camera slots. */
import { createHash } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { required, s3Credentials } from './camera-generation.mjs';
import { MAX_NEWS_ARTICLES, NEWS_SCHEMA } from './news-feed.mjs';

export const NEWS_BUCKET = 'darkroute-cameras';
export const NEWS_KEY = 'news/feed.json';
export const MAX_NEWS_BYTES = 2_097_152;
const REQUEST_TIMEOUT_MS = 45_000;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateFeed(feed) {
  if (!object(feed)) throw new Error('news feed must be a JSON object');
  if (
    feed.schema !== NEWS_SCHEMA || !Array.isArray(feed.articles) ||
    feed.articles.length > MAX_NEWS_ARTICLES || !object(feed.coverage) ||
    !['updatedAt', 'lastAttemptAt'].every((key) =>
      typeof feed[key] === 'string' && Number.isFinite(Date.parse(feed[key])))
  ) throw new Error('news feed schema or timestamps are invalid');
  const { status, attempted, succeeded } = feed.coverage;
  if (
    !['complete', 'partial', 'unavailable'].includes(status) ||
    !Number.isSafeInteger(attempted) || attempted < 0 || attempted > 1000 ||
    !Number.isSafeInteger(succeeded) || succeeded < 0 || succeeded > attempted
  ) throw new Error('news feed coverage is invalid');
}

function etagOf(value) {
  if (typeof value !== 'string' || !/^"[a-f\d]{32}"$/i.test(value)) {
    throw new Error('news object has no usable single-part ETag');
  }
  return value;
}

async function withClient(supplied, operation) {
  const client = supplied ?? new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID?.trim() || required('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: await s3Credentials(),
    // R2 rejects two non-default checksums. The PUT supplies ContentMD5 below.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  try {
    return await operation(client);
  } finally {
    if (supplied === undefined) client.destroy();
  }
}

async function bodyBytes(body) {
  if (body === undefined || body === null) throw new Error('news object has no body');
  const chunks = [];
  let length = 0;
  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk);
      length += bytes.length;
      if (length > MAX_NEWS_BYTES) throw new Error('news object is too large');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  }
  if (typeof body.transformToByteArray !== 'function') {
    throw new Error('news object body is unreadable');
  }
  const bytes = Buffer.from(await body.transformToByteArray());
  if (bytes.length > MAX_NEWS_BYTES) throw new Error('news object is too large');
  return bytes;
}

/** null means an absent object, never failed authentication or unreadable data. */
export async function readPublishedFeed({ client } = {}) {
  return withClient(client, async (r2) => {
    let response;
    try {
      response = await r2.send(
        new GetObjectCommand({ Bucket: NEWS_BUCKET, Key: NEWS_KEY }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 && error.name !== 'NoSuchBucket') return null;
      throw error;
    }
    if (response.ContentLength > MAX_NEWS_BYTES) throw new Error('news object is too large');
    const bytes = await bodyBytes(response.Body);
    const etag = etagOf(response.ETag);
    if (etag.slice(1, -1).toLowerCase() !== createHash('md5').update(bytes).digest('hex')) {
      throw new Error('news object does not match its ETag');
    }
    const feed = JSON.parse(bytes.toString('utf8'));
    validateFeed(feed);
    return { feed, etag };
  });
}

/**
 * The caller supplies the ETag it merged against, or null for the first object.
 * A concurrent publisher returns R2's 412 and must be read/merged again; there
 * is no unconditional retry that could overwrite another writer's articles.
 */
export async function publishNewsFeed(feed, { client, expectedEtag } = {}) {
  if (expectedEtag === undefined) throw new Error('expectedEtag is required; use null for a new feed');
  if (expectedEtag !== null) etagOf(expectedEtag);
  validateFeed(feed);
  const bytes = Buffer.from(`${JSON.stringify(feed)}\n`);
  if (bytes.length > MAX_NEWS_BYTES) throw new Error('news object is too large');
  const digest = createHash('md5').update(bytes).digest();
  return withClient(client, async (r2) => {
    const response = await r2.send(new PutObjectCommand({
      Bucket: NEWS_BUCKET,
      Key: NEWS_KEY,
      Body: bytes,
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'public, max-age=60',
      ContentMD5: digest.toString('base64'),
      ...(expectedEtag === null ? { IfNoneMatch: '*' } : { IfMatch: expectedEtag }),
    }), { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const etag = etagOf(response.ETag);
    if (etag.slice(1, -1).toLowerCase() !== digest.toString('hex')) {
      throw new Error('published news ETag did not match; read the object before retrying');
    }
    return { etag };
  });
}
