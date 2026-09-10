import { useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { useSettingsStore } from '../../stores/settings.ts';
import { MenuGroup, MenuHeader, MenuNote, MenuToggle } from '../chrome/Menu.tsx';
import { roadMonitoring } from '../../services/records/roadMonitoring.ts';
import { MONITORING_KINDS, MONITORING_LABELS, MONITORING_SYMBOLS, monitoringCounts, monitoringDate, monitoringEnabled, selectedMonitoring } from '../../services/records/monitoringCatalog.ts';
import { focusMapOn } from '../drive/driveSignals.ts';
import './monitoring.css';

export function MonitoringControls({ visibleCount = null }: { readonly visibleCount?: number | null }): ReactElement {
  const types = useSettingsStore((state) => state.monitoringTypes);
  const setType = useSettingsStore((state) => state.setMonitoringType);
  const { data, loading, error } = useSyncExternalStore(roadMonitoring.subscribe, roadMonitoring.getSnapshot);
  const enabled = monitoringEnabled(types);
  const records = selectedMonitoring(data?.records ?? [], types);
  const counts = monitoringCounts(records);
  return (
    <div className="fwm-monitoring-controls">
      <MenuHeader label="Road monitoring" sub="Optional infrastructure inventories" />
      <MenuGroup label="Road monitoring types">
        {MONITORING_KINDS.map((kind) => <MenuToggle key={kind} label={MONITORING_LABELS[kind]}
          state={types[kind] ? `${MONITORING_SYMBOLS[kind]} · on` : 'off'} on={types[kind]} onToggle={(on) => { setType(kind, on); }} />)}
      </MenuGroup>
      <MenuNote>Separate from ALPR exposure and route avoidance. Travel-time probes have unspecified technology.</MenuNote>
      {!enabled ? <MenuNote>Enable a type to load available coverage.</MenuNote> : <>
        {loading ? <MenuNote>Checking inventories…</MenuNote> : null}
        {error ? <MenuNote>{error} {data ? 'Showing the last available inventory.' : 'Coverage is unavailable.'}</MenuNote> : null}
        {data ? <>
          <MenuNote>{counts.active.toLocaleString()} listed active · {counts.unknown.toLocaleString()} status not reported · {counts.inactive.toLocaleString()} inactive, across selected inventories.</MenuNote>
          <MenuNote>{visibleCount === 0 ? 'No selected inventory points in this view. Coverage is partial; equipment may still be present.' : visibleCount === null ? 'Pan the map to explore available coverage.' : `${visibleCount.toLocaleString()} inventory points in this map view.`}</MenuNote>
          <details className="fwm-monitoring-sources">
            <summary>Coverage and sources ({data.sources.length})</summary>
            <p>Inventory assembled {monitoringDate(data.generatedAt)}. Listed status comes from the source, not a live device check.</p>
            {data.sources.map((source) => {
              const first = records.find((record) => record.sourceId === source.id);
              return <article key={source.id}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a>
                <p>{source.coverage} · {source.status === 'ok' ? 'Available' : source.status}</p>
                <p>Source updated: {monitoringDate(source.sourceUpdatedAt)}<br />Checked: {monitoringDate(source.checkedAt)}</p>
                {first ? <button type="button" onClick={() => { focusMapOn({ lon: first.lon, lat: first.lat }); }}>View {source.coverage}</button> : null}
              </article>;
            })}
          </details>
        </> : null}
      </>}
    </div>
  );
}
