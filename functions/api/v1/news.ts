import { json } from './_middleware.ts';

interface Env { readonly CAMERA_TILES?: R2Bucket }
export const NEWS_KEY = 'news/feed.json';
const MAX_BYTES = 2_097_152;

/** One atomic news snapshot, independent of the camera generation/pointer. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (env.CAMERA_TILES === undefined) return json(503, { error: 'news_unavailable', detail: 'the published news snapshot could not be read' });
  try {
    const object = await env.CAMERA_TILES.get(NEWS_KEY);
    if (object === null || object.size > MAX_BYTES) return json(503, { error: 'news_unavailable', detail: 'the published news snapshot could not be read' });
    const body = await object.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BYTES) return json(503, { error: 'news_malformed', detail: 'the published news snapshot is not the expected shape' });
    const feed: unknown = JSON.parse(body);
    if (!isFeed(feed)) return json(503, { error: 'news_malformed', detail: 'the published news snapshot is not the expected shape' });
    return new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60, must-revalidate',
        'etag': object.httpEtag,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return json(503, { error: 'news_unavailable', detail: 'the published news snapshot could not be read' });
  }
};

function isFeed(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const feed = value as Record<string, unknown>;
  return feed['schema'] === 'darkroute-news/v1'
    && typeof feed['updatedAt'] === 'string'
    && typeof feed['lastAttemptAt'] === 'string'
    && typeof feed['coverage'] === 'object' && feed['coverage'] !== null
    && Array.isArray(feed['articles']) && feed['articles'].length <= 1000;
}
