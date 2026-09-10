import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { fetchAbuse, fetchAtlas, fetchNews } from '../data/api.ts';
import type { AbuseResult, AtlasResult, NewsResult } from '../data/api.ts';
import type { Archive } from './Console.tsx';
import { countyLabelFor, download, formatCount } from './data.ts';
import { recordsCsv } from './exports.ts';

type ReportKind = 'news' | 'abuse' | 'atlas';
const OPTIONS: readonly { id: ReportKind; label: string }[] = [
  { id: 'abuse', label: 'Abuse' }, { id: 'news', label: 'News' }, { id: 'atlas', label: 'EFF Atlas' },
];

function stamp(value: string | null | undefined): string {
  if (value == null) return 'date unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/u, ' UTC') : 'date unavailable';
}

export function ReportsView({ archive, query, onQueryChange }: { readonly archive: Archive; readonly query: string; readonly onQueryChange: (value: string) => void }): ReactElement {
  const [kind, setKind] = useState<ReportKind>(() => {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const wanted = params.get('report');
    return wanted === 'news' || wanted === 'atlas' ? wanted : 'abuse';
  });
  const [news, setNews] = useState<NewsResult | null>(null);
  const [abuse, setAbuse] = useState<AbuseResult | null>(null);
  const [atlas, setAtlas] = useState<AtlasResult | null>(null);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState<'all' | 'abuse' | 'news'>('all');
  const [year, setYear] = useState<number | null>(null);
  const [limit, setLimit] = useState(100);
  const reload = useCallback(() => { setRefresh((value) => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.allSettled([fetchNews(controller.signal), fetchAbuse(controller.signal), fetchAtlas(controller.signal)])
      .then(([nextNews, nextAbuse, nextAtlas]) => {
        if (controller.signal.aborted) return;
        const failed: string[] = [];
        if (nextNews.status === 'fulfilled') setNews(nextNews.value); else failed.push('News');
        if (nextAbuse.status === 'fulfilled') setAbuse(nextAbuse.value); else failed.push('Abuse');
        if (nextAtlas.status === 'fulfilled') setAtlas(nextAtlas.value); else failed.push('EFF Atlas');
        setErrors(failed);
        setLoading(false);
      });
    return () => { controller.abort(); };
  }, [refresh]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => { if (!document.hidden) reload(); }, 60_000);
    const visible = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', visible);
    return () => { globalThis.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);

  useEffect(() => {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('report', kind);
    globalThis.history.replaceState(null, '', url);
  }, [kind]);

  const q = query.trim().toLowerCase();
  const labels = useMemo(() => new Map(archive.counties?.map((county) => [county.fips, county.label])), [archive.counties]);
  const cases = abuse?.records ?? [];
  const years = [...new Set(cases.map((record) => record.year))].sort((a, b) => b - a);
  const shownCases = cases.filter((record) => (year === null || record.year === year)
    && `${record.agency} ${countyLabelFor(record.fips, archive.counties)} ${record.summary} ${record.sourceName}`.toLowerCase().includes(q));
  const articles = (news?.articles ?? []).filter((article) => (topic === 'all' || article.topic === topic)
    && `${article.title} ${article.publisher}`.toLowerCase().includes(q));
  const counties = (atlas?.counties ?? []).filter((county) =>
    `${county.fips} ${labels.get(county.fips) ?? ''} ${county.agencies.join(' ')} ${county.vendors.join(' ')}`.toLowerCase().includes(q));
  const length = kind === 'news' ? articles.length : kind === 'abuse' ? shownCases.length : counties.length;
  const current = kind === 'news' ? news : kind === 'abuse' ? abuse : atlas;
  const matchingRows = kind === 'news' ? articles : kind === 'abuse' ? shownCases : counties.map((county) => ({
    ...county, sourceAttribution: atlas?.source.attribution, sourceUrl: atlas?.source.home, sourceLicence: atlas?.source.licence, fetchedAt: atlas?.fetchedAt, checkedAt: atlas?.checkedAt,
  }));

  return (
    <section className="dc-pane dc-reports" aria-label="Reports">
      <div className="dc-report-controls" role="group" aria-label="Report type">
        {OPTIONS.map((option) => <button key={option.id} type="button" className="dc-chip" aria-pressed={kind === option.id}
          onClick={() => { setKind(option.id); setLimit(100); }}>{option.label}</button>)}
        <button type="button" className="dc-chip" disabled={loading} onClick={reload}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <label className="dc-monitoring-search">Search these reports
        <input type="search" value={query}
          placeholder={kind === 'news' ? 'Headline or publisher' : kind === 'atlas' ? 'County name, FIPS, agency or vendor' : 'Agency, county, summary or source'}
          onChange={(event) => { onQueryChange(event.target.value); setLimit(100); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { onQueryChange(''); setLimit(100); } }} />
      </label>
      <div className="dc-panel">
        <p><a className="dc-source" href={`/api/v1/${kind}`} target="_blank" rel="noreferrer">Open complete {kind === 'atlas' ? 'Atlas' : kind} API JSON ↗</a> · <a className="dc-source" href="/?tab=api">All datasets and API</a></p>
        <p className="dc-table-sub">CSV includes every matching record. API JSON includes the complete endpoint response, regardless of filters or the number displayed.</p>
        {kind === 'atlas' ? <p><a className="dc-source" href="/records/atlas-counties.json" target="_blank" rel="noreferrer">Open raw Atlas snapshot ↗</a> for unplaced rows, field selection and full source metadata.</p> : null}
        <div className="dc-report-controls">
          <button type="button" className="dc-chip" disabled={matchingRows.length === 0} onClick={() => { download(`darkroute-${kind}.csv`, recordsCsv(matchingRows), 'text/csv;charset=utf-8'); }}>Download all matching CSV</button>
          <button type="button" className="dc-chip" disabled={current === null} onClick={() => { download(`darkroute-${kind}.json`, JSON.stringify(current, null, 2), 'application/json'); }}>Download complete API JSON</button>
          {kind === 'atlas' ? <a className="dc-chip" href="/records/atlas-counties.json" download="darkroute-atlas-snapshot.json">Download raw Atlas snapshot</a> : null}
        </div>
      </div>
      {errors.length > 0 ? <p className="dc-report-warning" role="status">Could not refresh {errors.join(', ')}. Any previously loaded data remains visible.</p> : null}
      {kind === 'news' ? <>
        <div className="dc-panel">
          <h1>ALPR news</h1>
          <p>Source-linked reporting, collected automatically. Abuse reporting is a headline category; documented cases are listed separately under Abuse.</p>
          {news !== null ? <p className="dc-table-sub">{formatCount(news.articles.length)} articles · Updated {stamp(news.updatedAt)} · Last collection {stamp(news.lastAttemptAt)}</p> : null}
          {news !== null && news.coverage.status !== 'complete' ? <p className="dc-report-warning">Collection {news.coverage.status}: {news.coverage.succeeded} of {news.coverage.attempted} searches answered. Earlier articles are retained.</p> : null}
          <div className="dc-report-controls" role="group" aria-label="News topic">
            {(['all', 'abuse', 'news'] as const).map((value) => <button key={value} type="button" className="dc-chip" aria-pressed={topic === value}
              onClick={() => { setTopic(value); setLimit(100); }}>{value === 'all' ? 'All news' : value === 'abuse' ? 'Abuse reporting' : 'Other news'}</button>)}
          </div>
        </div>
        {articles.slice(0, limit).map((article) => <article className="dc-panel" key={article.id}>
          <div className="dc-kicker">{article.topic === 'abuse' ? 'Abuse reporting' : 'News'} · {article.publisher}</div>
          <h2><a href={article.url} target="_blank" rel="noopener noreferrer">{article.title} ↗</a></h2>
          <p className="dc-table-sub">Seen {stamp(article.publishedAt)}</p>
        </article>)}
      </> : null}
      {kind === 'abuse' ? <>
        <div className="dc-panel">
          <h1>Documented abuse</h1>
          <p>{formatCount(abuse?.count ?? null)} source records · Dataset {stamp(abuse?.generatedAt)}</p>
          <p>Each record names an agency and carries a dated source. Records describe county context, not an individual camera. No entry does not establish that no abuse occurred.</p>
          <div className="dc-report-controls" role="group" aria-label="Case year">
            <button type="button" className="dc-chip" aria-pressed={year === null} onClick={() => { setYear(null); setLimit(100); }}>All years</button>
            {years.map((value) => <button key={value} type="button" className="dc-chip" aria-pressed={year === value} onClick={() => { setYear(value); setLimit(100); }}>{value}</button>)}
          </div>
        </div>
        {shownCases.slice(0, limit).map((record, index) => <article className="dc-panel" key={`${record.fips}:${record.sourceUrl}:${index}`}>
          <div className="dc-kicker">{record.year} · {countyLabelFor(record.fips, archive.counties)}</div>
          <h2>{record.agency}</h2>
          <p>{record.summary}</p>
          <p className="dc-table-sub">{record.incidents} documented incidents</p>
          <a className="dc-source" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">{record.sourceName || 'Read source'} ↗</a>
        </article>)}
      </> : null}
      {kind === 'atlas' ? <>
        <div className="dc-panel">
          <h1>EFF Atlas of Surveillance</h1>
          <p>Agencies recorded as operating ALPR, grouped by county. These records establish neither abuse nor ownership of an individual mapped camera. Deployment counts are not camera counts.</p>
          {atlas !== null ? <>
            <p>{formatCount(atlas.totals.agencies)} agencies · {formatCount(atlas.totals.counties)} counties · Retrieved {stamp(atlas.fetchedAt)} · Checked {stamp(atlas.checkedAt)}</p>
            <p className="dc-table-sub">{atlas.source.attribution} · <a className="dc-source" href={atlas.source.home} target="_blank" rel="noopener noreferrer">Source ↗</a></p>
          </> : null}
        </div>
        {counties.slice(0, limit).map((county) => <article className="dc-panel" key={county.fips}>
          <h2>{labels.get(county.fips) ?? `County ${county.fips}`}</h2>
          <p>{county.agencies.join(' · ')}</p>
          <p className="dc-table-sub">{county.deployments} recorded deployments · Vendor recorded for {county.vendorKnown} of {county.deployments}</p>
          <p>{county.vendors.length > 0 ? county.vendors.join(' · ') : 'No vendor recorded'}</p>
        </article>)}
      </> : null}
      {length === 0 && !loading ? <p className="dc-empty">No loaded records match this view.</p> : null}
      {length > 0 ? <p className="dc-table-sub">Showing {Math.min(limit, length)} of {formatCount(length)} matching records.</p> : null}
      {length > limit ? <button type="button" className="dc-chip" onClick={() => { setLimit((value) => value + 100); }}>Show 100 more</button> : null}
    </section>
  );
}
