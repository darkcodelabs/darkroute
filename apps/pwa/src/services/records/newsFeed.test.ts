import { describe, expect, it, vi } from 'vitest';
import { NEWS_REFRESH_INTERVAL_MS, createNewsFeedStore, fetchNewsFeed, parseNewsFeed } from './newsFeed.ts';

const article = { id: 'one', title: 'Council debates plate reader policy', url: 'https://publisher.test/story',
  publisher: 'Local reporting', publishedAt: '2026-09-10T02:00:00Z', topic: 'news' };
const snapshot = { schema: 'darkroute-news/v1', updatedAt: '2026-09-10T03:00:00Z',
  lastAttemptAt: '2026-09-10T03:00:00Z', coverage: { status: 'complete', attempted: 2, succeeded: 2 }, articles: [article] };
const credentialUrl = new URL('https://publisher.test/story');
credentialUrl.username = 'fixture-user';
credentialUrl.password = 'fixture-password';

describe('news feed boundary', () => {
  it('preserves empty snapshots and sorts valid reporting by observation time', () => {
    expect(parseNewsFeed({ ...snapshot, articles: [] }).articles).toEqual([]);
    const older = { ...article, id: 'older', title: 'Police release camera policy', url: 'https://publisher.test/policy', publishedAt: '2026-09-09T01:00:00Z' };
    expect(parseNewsFeed({ ...snapshot, articles: [older, article] }).articles.map((row) => row.id)).toEqual(['one', 'older']);
  });

  it('repairs old snapshots containing one story under multiple section URLs', () => {
    const rows = ['spotlightnews', 'ade', 'leader_herald', 'the_recorder', 'hv360'].map((section, index) => ({
      ...article, id: section, title: 'Flock data misused by Albany County investigator : Sheriff | News',
      url: `https://www.dailygazette.com/${section}/news/article_5047ba1c-0563-4b8f-960c-837d8b2f20bd.html`,
      publishedAt: index === 0 ? article.publishedAt : '2026-09-09T01:00:00Z',
    }));
    const other = { ...rows[1], id: 'other', url: 'https://another.example/story' };
    const parsed = parseNewsFeed({ ...snapshot, articles: [...rows, other] });
    expect(parsed.articles.map((row) => row.id)).toEqual(['spotlightnews', 'other']);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hello', '//publisher.test/story',
    credentialUrl.href])('rejects unsafe source URL %s', (url) => {
    expect(() => parseNewsFeed({ ...snapshot, articles: [{ ...article, url }] })).toThrow();
  });

  it('rejects broken schema, metadata, dates, topics, and duplicate IDs', () => {
    for (const bad of [null, {}, { ...snapshot, schema: 'other' }, { ...snapshot, updatedAt: 'yesterday' },
      { ...snapshot, coverage: { status: 'partial', attempted: 1, succeeded: 2 } },
      { ...snapshot, articles: [{ ...article, topic: 'proven abuse' }] },
      { ...snapshot, articles: [article, article] }]) {
      expect(() => parseNewsFeed(bad)).toThrow();
    }
  });

  it('reads only the same-origin feed without credentials or referrer', async () => {
    const read = vi.fn().mockResolvedValue(Response.json(snapshot));
    vi.stubGlobal('fetch', read);
    expect((await fetchNewsFeed()).articles).toHaveLength(1);
    expect(read).toHaveBeenCalledWith('/api/v1/news', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  });

  it('rejects HTTP failure and malformed success bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true })));
    await expect(fetchNewsFeed()).rejects.toThrow('HTTP 503');
    await expect(fetchNewsFeed()).rejects.toThrow('Invalid news feed');
  });
});

describe('shared news snapshot', () => {
  it('refreshes stale data while limiting automatic retries and allowing manual refresh', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const data = parseNewsFeed(snapshot);
    const read = vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(data);
    const feed = createNewsFeedStore(read);
    await feed.refreshIfStale();
    await feed.refreshIfStale();
    expect(read).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1000 + NEWS_REFRESH_INTERVAL_MS);
    await feed.refreshIfStale();
    expect(feed.getSnapshot().data).toBe(data);
    expect(feed.getSnapshot().error).not.toBeNull();
    await feed.refreshIfStale();
    expect(read).toHaveBeenCalledTimes(2);
    await feed.refresh();
    expect(read).toHaveBeenCalledTimes(3);
    expect(feed.getSnapshot().error).toBeNull();
  });

  it('shares simultaneous refreshes and keeps the last good snapshot after failure', async () => {
    const data = parseNewsFeed(snapshot);
    const read = vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('offline'));
    const feed = createNewsFeedStore(read);
    expect(feed.getSnapshot()).toEqual({ data: null, loading: false, error: null });
    const first = feed.refresh();
    expect(feed.getSnapshot().loading).toBe(true);
    expect(feed.refresh()).toBe(first);
    await first;
    expect(read).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot()).toEqual({ data, loading: false, error: null });
    await feed.refresh();
    expect(feed.getSnapshot()).toEqual({ data, loading: false, error: 'Could not refresh the news feed.' });
  });

  it('a failed first load remains unknown, and subscribers stop receiving updates after cleanup', async () => {
    const feed = createNewsFeedStore(vi.fn().mockRejectedValue(new Error('offline')));
    const change = vi.fn();
    const stop = feed.subscribe(change);
    await feed.refresh();
    expect(feed.getSnapshot().data).toBeNull();
    expect(feed.getSnapshot().error).not.toBeNull();
    expect(change).toHaveBeenCalledTimes(2);
    stop();
    await feed.refresh();
    expect(change).toHaveBeenCalledTimes(2);
  });
});
