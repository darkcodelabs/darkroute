import type { ReactElement } from 'react';
import type { NewsArticle, NewsFeed, NewsTopic } from '../../services/records/newsFeed.ts';
import type { useNewsFeed } from './useNewsFeed.ts';

export const NEWS_DESCRIPTION = 'ALPR reporting collected automatically; open the publisher for the full story.';
export const TOPIC_LABELS = { all: 'All', abuse: 'Abuse reporting', news: 'Other news' } as const;
export type NewsFilter = 'all' | NewsTopic;

export function filterNews(articles: readonly NewsArticle[], topic: NewsFilter, query = ''): readonly NewsArticle[] {
  const needle = query.trim().toLocaleLowerCase();
  return articles.filter((article) => (topic === 'all' || article.topic === topic) &&
    `${article.title} ${article.publisher}`.toLocaleLowerCase().includes(needle));
}

function date(stamp: string, withTime = false): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'UTC', ...(withTime ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } as const : {}) }).format(new Date(stamp));
}

export function NewsCards({ articles }: { readonly articles: readonly NewsArticle[] }): ReactElement {
  return <ul className="fwm-news-list" aria-label="news articles">
    {articles.map((article) => <li key={article.id}>
      <a className="fwm-news-card" href={article.url} target="_blank" rel="noreferrer noopener">
        <span className="fwm-news-meta"><span>{article.publisher}</span>
          <span>Seen <time dateTime={article.publishedAt}>{date(article.publishedAt)}</time></span></span>
        <span className="fwm-news-headline">{article.title}</span>
        <span className="fwm-news-meta"><span>{TOPIC_LABELS[article.topic]}</span><span>Read source ↗</span></span>
      </a>
    </li>)}
  </ul>;
}

function coverageMessage(feed: NewsFeed): string | null {
  if (feed.coverage.status === 'complete') return null;
  if (feed.coverage.status === 'unavailable') return 'The latest collection could not reach its sources. Any headlines below are from the previous snapshot.';
  return `Partial update: ${String(feed.coverage.succeeded)} of ${String(feed.coverage.attempted)} source searches completed. Some reporting may be missing.`;
}

export function NewsStatus({ state }: { readonly state: ReturnType<typeof useNewsFeed> }): ReactElement {
  const { data, loading, error } = state;
  const coverage = data === null ? null : coverageMessage(data);
  return <div className="fwm-news-status" aria-live="polite">
    {data === null && !error ? <p>Loading ALPR reporting…</p> : null}
    {error === null ? null : <p role="alert">{error} {data === null ? 'Try again when you have a connection.' : 'Showing the previous snapshot.'}</p>}
    {data === null ? null : <p>Updated <time dateTime={data.updatedAt}>{date(data.updatedAt, true)}</time></p>}
    {coverage === null ? null : <p className="fwm-news-notice">{coverage}</p>}
    {data === null || data.lastAttemptAt === data.updatedAt ? null :
      <p>Last collection attempt <time dateTime={data.lastAttemptAt}>{date(data.lastAttemptAt, true)}</time></p>}
    <button className="fwm-news-button" type="button" disabled={loading} onClick={() => { void state.refresh(); }}>
      {loading ? 'Refreshing…' : 'Refresh news'}
    </button>
  </div>;
}
