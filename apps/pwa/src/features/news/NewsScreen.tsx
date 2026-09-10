import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';
import { filterNews, NEWS_DESCRIPTION, NewsCards, NewsStatus, TOPIC_LABELS } from './NewsCards.tsx';
import type { NewsFilter } from './NewsCards.tsx';
import { useNewsFeed } from './useNewsFeed.ts';
import './news.css';

export function NewsScreen({ embedded = false }: { readonly embedded?: boolean } = {}): ReactElement {
  const state = useNewsFeed();
  const [topic, setTopic] = useState<NewsFilter>('all');
  const [query, setQuery] = useState('');
  const articles = useMemo(() => filterNews(state.data?.articles ?? [], topic, query), [state.data, topic, query]);
  return <section className="fwm-news" aria-label="ALPR news">
    {embedded ? null : <header className="fwm-news-header"><BackKey to="more" label={BACK_TO_MORE} />
      <ReloadTitle title="News" className="fwm-news-title" /></header>}
    <div className="fwm-news-intro"><h2>ALPR in the news</h2><p>{NEWS_DESCRIPTION}</p></div>
    <div className="fwm-news-filters" role="group" aria-label="news topics">
      {(Object.keys(TOPIC_LABELS) as NewsFilter[]).map((key) => <button type="button" className="fwm-news-button"
        key={key} aria-pressed={topic === key} onClick={() => { setTopic(key); }}>{TOPIC_LABELS[key]}</button>)}
    </div>
    <label className="fwm-news-search">Search headlines and publishers
      <input type="search" value={query} maxLength={200} placeholder="Search this feed" onChange={(event) => { setQuery(event.target.value); }} />
    </label>
    <NewsStatus state={state} />
    {state.data === null ? null : articles.length ? <NewsCards articles={articles} /> :
      <p className="fwm-news-empty">{state.data.articles.length === 0 ? 'No headlines in this snapshot yet.' : 'No headlines match these filters.'}</p>}
    <p className="fwm-news-footnote">“Seen” is when the source index observed a story; it may differ from its publication date. Search stays on this device.</p>
  </section>;
}
