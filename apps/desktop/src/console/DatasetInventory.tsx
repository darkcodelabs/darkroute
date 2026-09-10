import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { Archive } from './Console.tsx';
import { formatCount } from './data.ts';

export const DATASETS = [
  { id: 'monitoring', name: 'Road monitoring', path: '/api/v1/monitoring', view: '/?tab=monitoring' },
  { id: 'atlas', name: 'EFF Atlas deployments', path: '/api/v1/atlas', view: '/?tab=reports&report=atlas' },
  { id: 'abuse', name: 'Documented abuse', path: '/api/v1/abuse', view: '/?tab=reports&report=abuse' },
  { id: 'news', name: 'ALPR news', path: '/api/v1/news', view: '/?tab=reports&report=news' },
  { id: 'hazards', name: 'Work-zone hazards', path: '/records/hazards.json', view: '/records/hazards.json' },
] as const;
type DatasetId = typeof DATASETS[number]['id'];
interface Summary { readonly count: number; readonly unit: string; readonly date: string; readonly detail: string }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid inventory');
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid count');
  return value;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid rows');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'date unavailable';
  return new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/u, ' UTC');
}

/** Validate the fields used for counts; an unavailable dataset must never look empty. */
export function datasetSummary(id: DatasetId, value: unknown, now = Date.now()): Summary {
  const data = object(value);
  if (id === 'monitoring') {
    const total = count(data['total']);
    if (array(data['records']).length !== total || count(data['count']) !== total) throw new Error('Incomplete inventory');
    const sources = array(data['sources']);
    const current = sources.filter((source) => object(source)['status'] === 'ok').length;
    return { count: total, unit: 'equipment records', date: `Snapshot ${date(data['generatedAt'])}`, detail: `${sources.length} sources · ${current} current. Separate from ALPR cameras.` };
  }
  if (id === 'atlas') {
    const totals = object(data['totals']);
    return { count: count(totals['alprRows']), unit: 'deployment rows', date: `Retrieved ${date(data['fetchedAt'])} · Checked ${date(data['checkedAt'])}`, detail: `${formatCount(count(totals['agencies']))} agencies · ${formatCount(count(totals['counties']))} counties. These are county context, not camera locations.` };
  }
  if (id === 'news') {
    const coverage = object(data['coverage']);
    return { count: array(data['articles']).length, unit: 'articles', date: `Updated ${date(data['updatedAt'])} · Last attempt ${date(data['lastAttemptAt'])}`, detail: `Collection ${String(coverage['status'])} · ${count(coverage['succeeded'])} of ${count(coverage['attempted'])} searches answered.` };
  }
  if (id === 'abuse') {
    const total = count(data['count']);
    if (array(data['records']).length !== total) throw new Error('Incomplete records');
    return { count: total, unit: 'source records', date: `Dataset ${date(data['generatedAt'])}`, detail: 'Each published finding keeps its summary and citation.' };
  }
  const total = count(data['count']);
  if (array(data['hazards']).length !== total) throw new Error('Incomplete hazards');
  const stale = typeof data['builtAt'] === 'string' && now - Date.parse(data['builtAt']) > 86_400_000;
  return { count: total, unit: 'work-zone records', date: `Built ${date(data['builtAt'])}`, detail: `${stale ? 'Stale snapshot (older than 24 hours). ' : ''}Coverage: ${array(data['coverage']).join(', ')}. Raw record count; source IDs are not necessarily unique. See the data guide for coverage limits.` };
}

export function DatasetInventory({ archive }: { readonly archive: Archive }): ReactElement {
  const [summaries, setSummaries] = useState<Partial<Record<DatasetId, Summary | null>>>({});
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    // Only this catalog view loads these five snapshots; no polling or per-row requests.
    void Promise.all(DATASETS.map(async (dataset) => {
      let summary: Summary | null = null;
      try {
        const response = await fetch(dataset.path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]), headers: { accept: 'application/json' }, cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        summary = datasetSummary(dataset.id, await response.json());
      } catch { /* Show the failure for this dataset while the others remain usable. */ }
      if (!controller.signal.aborted) setSummaries((previous) => ({ ...previous, [dataset.id]: summary }));
    })).then(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [refresh]);

  return <div className="dc-panel">
    <h1>Published data inventory</h1>
    <p>Each dataset has its own count, scope and update time. The ALPR camera count covers only the camera archive.</p>
    <p><a className="dc-source" href="https://github.com/darkcodelabs/darkroute/blob/main/docs/data-inventory.md" target="_blank" rel="noreferrer">Complete inventory and data guide ↗</a></p>
    <button className="dc-chip" type="button" disabled={loading} onClick={() => { setRefresh((value) => value + 1); }}>{loading ? 'Checking datasets…' : 'Refresh dataset counts'}</button>
    <article className="dc-monitoring-source">
      <h2><a href="/?tab=archive">ALPR camera archive</a></h2>
      <p>{formatCount(archive.stats?.cameras ?? null)} mapped cameras · {formatCount(archive.tombstones)} removal records</p>
      <p className="dc-table-sub">Built {date(archive.stats?.generatedAt)} · Source watermark {date(archive.stats?.upstream)}</p>
      <a className="dc-source" href="/api/v1/stats" target="_blank" rel="noreferrer">Camera metadata JSON ↗</a>
    </article>
    {DATASETS.map((dataset) => {
      const summary = summaries[dataset.id];
      return <article className="dc-monitoring-source" key={dataset.id}>
        <h2><a href={dataset.view}>{dataset.name}</a></h2>
        {summary === undefined ? <p role="status">Checking current inventory…</p> : summary === null
          ? <p className="dc-report-warning" role="status">Current count unavailable. Open the dataset for its response.</p>
          : <><p>{formatCount(summary.count)} {summary.unit}</p><p className="dc-table-sub">{summary.date}</p><p>{summary.detail}</p></>}
        <a className="dc-source" href={dataset.path} target="_blank" rel="noreferrer">Complete JSON ↗</a>
      </article>;
    })}
  </div>;
}
