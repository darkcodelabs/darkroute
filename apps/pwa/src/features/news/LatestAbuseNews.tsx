import type { ReactElement } from 'react';
import { openScreen } from '../../app/screenState.ts';
import { filterNews, NEWS_DESCRIPTION, NewsCards, NewsStatus } from './NewsCards.tsx';
import { useNewsFeed } from './useNewsFeed.ts';
import './news.css';

export function LatestAbuseNews({ onViewNews }: { readonly onViewNews?: (() => void) | undefined } = {}): ReactElement {
  const state = useNewsFeed();
  const articles = filterNews(state.data?.articles ?? [], 'abuse').slice(0, 5);
  return <section className="fwm-news-latest" aria-label="Latest abuse reporting">
    <h2>Latest abuse reporting</h2><p>{NEWS_DESCRIPTION} Documented case records follow below.</p>
    <NewsStatus state={state} />
    {state.data === null ? null : articles.length ? <NewsCards articles={articles} /> : <p>No abuse reporting in this snapshot yet.</p>}
    <button className="fwm-news-button" type="button" onClick={() => {
      if (onViewNews) onViewNews();
      else openScreen('news');
    }}>View all news</button>
  </section>;
}
