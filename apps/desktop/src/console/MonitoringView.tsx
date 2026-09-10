import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { fetchMonitoring, fetchMonitoringImage } from '../data/api.ts';
import type { MonitoringKind, MonitoringRecord, MonitoringResult } from '../data/api.ts';
import { download, formatCount } from './data.ts';
import { monitoringCsv } from './exports.ts';

export const MONITORING_KINDS: readonly { id: MonitoringKind; label: string }[] = [
  { id: 'bluetooth_sensor', label: 'Bluetooth sensors' },
  { id: 'probe_sensor', label: 'Probe sensors' },
  { id: 'traffic_camera', label: 'Traffic cameras' },
  { id: 'red_light_camera', label: 'Red light cameras' },
  { id: 'speed_camera', label: 'Speed cameras' },
  { id: 'toll_reader', label: 'Toll readers' },
  { id: 'radar_sensor', label: 'Radar sensors' },
];

function stamp(value: string | null): string {
  return value === null ? 'not recorded' : new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/u, ' UTC');
}

export function monitoringRows(data: MonitoringResult | null, kind: MonitoringKind | null, query: string): readonly MonitoringRecord[] {
  const q = query.trim().toLowerCase();
  const sources = new Map(data?.sources.map((source) => [source.id, source.name]));
  return (data?.records ?? []).filter((record) => (kind === null || record.kind === kind)
    && [record.id, record.name, record.operator, record.road, record.direction, sources.get(record.sourceId)]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
}

export function MonitoringView(): ReactElement {
  const [data, setData] = useState<MonitoringResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [kind, setKind] = useState<MonitoringKind | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const [opened, setOpened] = useState<string | null>(null);
  const reload = useCallback(() => { setRefresh((value) => value + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchMonitoring(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result);
      setError(null);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Monitoring inventory could not be read.');
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

  const records = useMemo(() => monitoringRows(data, kind, query), [data, kind, query]);
  const sources = useMemo(() => new Map(data?.sources.map((source) => [source.id, source])), [data]);

  return (
    <section className="dc-pane dc-reports dc-monitoring" aria-label="Road monitoring">
      <div className="dc-panel">
        <h1>Road monitoring</h1>
        <p>Published inventories of roadside equipment. These records do not establish ALPR capability and are counted separately from the ALPR camera archive.</p>
        {data !== null ? <p className="dc-table-sub">{formatCount(data.total)} inventory records · {data.sources.length} sources · Snapshot {stamp(data.generatedAt)}</p> : null}
        <button type="button" className="dc-chip" disabled={loading} onClick={reload}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        <p><a className="dc-source" href="/records/road-monitoring.json" target="_blank" rel="noreferrer">Open complete inventory JSON ↗</a> · <a className="dc-source" href="/?tab=api">All datasets and API</a></p>
      </div>
      {error !== null ? <p className="dc-report-warning" role="status">Could not refresh: {error} {data === null ? 'No inventory has loaded yet.' : 'Previously loaded inventory remains visible.'}</p> : null}
      <details className="dc-panel" open={data !== null && data.sources.some((source) => source.status !== 'ok')}>
        <summary>Sources and freshness{data === null ? '' : ` · ${data.sources.length}`}</summary>
        {data?.sources.map((source) => <article key={source.id} className="dc-monitoring-source">
          <h2><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name} ↗</a></h2>
          <p>{source.coverage} · {source.status} · {formatCount(source.count)} inventory records</p>
          <p className="dc-table-sub">Checked {stamp(source.checkedAt)} · Retrieved {stamp(source.fetchedAt)} · Source updated {stamp(source.sourceUpdatedAt)}</p>
          {source.status !== 'ok' ? <p className="dc-report-warning">{source.status === 'retired' ? 'This source is retired.' : 'The latest source collection is not current.'} Any retained records below are from an earlier successful collection.</p> : null}
          <p>{source.attribution} · {source.licenceUrl !== null ? <a className="dc-source" href={source.licenceUrl} target="_blank" rel="noopener noreferrer">{source.licence ?? 'Source terms and information'} ↗</a> : source.licence ?? 'Licence not recorded'}</p>
        </article>)}
      </details>
      <label className="dc-monitoring-search">Search this inventory
        <input type="search" value={query} placeholder="Name, road, operator, source or ID" onChange={(event) => { setQuery(event.target.value); setLimit(100); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); setLimit(100); } }} />
      </label>
      <div className="dc-report-controls" role="group" aria-label="Equipment kind">
        <button type="button" className="dc-chip" aria-pressed={kind === null} onClick={() => { setKind(null); setLimit(100); }}>All equipment</button>
        {MONITORING_KINDS.map((option) => <button type="button" className="dc-chip" key={option.id} aria-pressed={kind === option.id}
          onClick={() => { setKind(option.id); setLimit(100); }}>{option.label}</button>)}
      </div>
      {data !== null ? <>
        <p className="dc-table-sub" role="status">Showing {Math.min(limit, records.length)} of {formatCount(records.length)} matching inventory records. CSV includes every match; JSON includes the complete inventory and source metadata.</p>
        <div className="dc-report-controls">
          <button type="button" className="dc-chip" disabled={records.length === 0} onClick={() => { download('darkroute-monitoring.csv', monitoringCsv(data, records), 'text/csv;charset=utf-8'); }}>Download all matching CSV</button>
          <button type="button" className="dc-chip" onClick={() => { download('darkroute-monitoring.json', JSON.stringify(data, null, 2), 'application/json'); }}>Download complete JSON</button>
        </div>
      </> : null}
      {records.slice(0, limit).map((record) => <article className="dc-panel" key={record.id}>
        <div className="dc-kicker">{MONITORING_KINDS.find((option) => option.id === record.kind)?.label} · {record.status === 'unknown' ? 'Status unknown' : record.status}</div>
        <h2>{record.name}</h2>
        <p>{record.operator ?? 'Operator not recorded'} · {record.road ?? 'Road not recorded'}{record.direction === null ? '' : ` · ${record.direction}`}</p>
        <button type="button" className="dc-chip" aria-expanded={opened === record.id} aria-label={`${opened === record.id ? 'Close' : 'View'} details for ${record.name}`}
          onClick={() => { setOpened(opened === record.id ? null : record.id); }}>{opened === record.id ? 'Close details' : 'View details'}</button>
        {opened === record.id ? <div className="dc-monitoring-detail">
          <p className="dc-table-sub">{record.lat.toFixed(5)}, {record.lon.toFixed(5)} · {record.id}</p>
          <p className="dc-table-sub">Source updated {stamp(record.sourceUpdatedAt)} · {sources.get(record.sourceId)?.name ?? record.sourceId}</p>
          <a className="dc-source" href={record.sourceUrl} target="_blank" rel="noopener noreferrer">Source record ↗</a>
          {record.imageUrl === null ? <p className="dc-table-sub">No source photo available.</p> : <MonitoringPhoto key={`${record.id}:${record.imageUrl}`} record={record} />}
        </div> : null}
      </article>)}
      {data !== null && records.length === 0 ? <p className="dc-empty">No loaded inventory records match these filters.</p> : null}
      {records.length > limit ? <button type="button" className="dc-chip" onClick={() => { setLimit((value) => value + 100); }}>Show 100 more</button> : null}
    </section>
  );
}

function MonitoringPhoto({ record }: { readonly record: MonitoringRecord }): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    fetchMonitoringImage(record.id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl !== null) URL.revokeObjectURL(objectUrl); };
  }, [record.id]);
  return <figure className="dc-monitoring-photo">
    {failed ? <p role="status">The source photo is unavailable right now.</p> : url === null ? <p role="status">Loading source photo…</p>
      : <img src={url} alt={`Source photo for ${record.name}`} onError={() => { setFailed(true); }} />}
    <figcaption>Source photo, fetched when you open these details. The image capture time may differ from the inventory update.</figcaption>
  </figure>;
}
