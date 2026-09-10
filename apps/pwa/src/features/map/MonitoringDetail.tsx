import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { MonitoringRecord, MonitoringSource } from '../../stores/fwmCore.ts';
import { MONITORING_LABELS, monitoringDate, monitoringStatus } from '../../services/records/monitoringCatalog.ts';
import { MonitoringOverlap } from './MonitoringOverlap.tsx';
import type { MonitoringOverlapCamera } from './MonitoringOverlap.tsx';
import { MonitoringPhoto } from './MonitoringPhoto.tsx';
import './monitoring.css';

export function MonitoringDetail({ record, source, cameras, onOpenCamera, onClose }: {
  readonly cameras: readonly MonitoringOverlapCamera[]; readonly onOpenCamera: (id: string) => void;
  readonly record: MonitoringRecord; readonly source: MonitoringSource | undefined; readonly onClose: () => void;
}): ReactElement {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [record.id]);
  return <section className="fwm-monitoring-detail" role="dialog" aria-label="Road monitoring details"
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><h2>{MONITORING_LABELS[record.kind]}</h2><button ref={close} type="button" onClick={onClose} aria-label="Close road monitoring details">Close</button></header>
    <h3>{record.name}</h3>
    <p>{monitoringStatus(record.status)} · inventory record, not a live device check</p>
    {record.imageUrl != null ? <MonitoringPhoto key={record.id} id={record.id} name={record.name} credit={source?.attribution ?? 'Source inventory'} /> : null}
    <dl>
      <dt>Operator</dt><dd>{record.operator ?? 'Not reported'}</dd>
      <dt>Road</dt><dd>{record.road ?? 'Not reported'}</dd>
      <dt>Direction</dt><dd>{record.direction ?? 'Not reported'}</dd>
      <dt>Coverage</dt><dd>{source?.coverage ?? 'Not reported'}</dd>
      <dt>Source updated</dt><dd>{monitoringDate(record.sourceUpdatedAt ?? source?.sourceUpdatedAt ?? null)}</dd>
      <dt>Source checked</dt><dd>{monitoringDate(source?.checkedAt ?? null)}</dd>
      <dt>Inventory fetched</dt><dd>{monitoringDate(source?.fetchedAt ?? null)}</dd>
      <dt>Source status</dt><dd>{source?.status === 'ok' ? 'Available' : source?.status ?? 'Not reported'}</dd>
    </dl>
    <MonitoringOverlap record={record} cameras={cameras} onOpenCamera={onOpenCamera} />
    {record.kind === 'bluetooth_sensor' ? <p>Bluetooth travel-time detectors can match detectable device identifiers between stations to estimate travel time. This inventory contains equipment locations only, with no captured identifiers.{' '}
      <a href="https://deldot.gov/Programs/itms/index.shtml?dc=technology" target="_blank" rel="noopener noreferrer">How Bluetooth monitoring works (DelDOT)</a></p> : null}
    {record.kind === 'probe_sensor' ? <p>Travel-time sensor. The source does not identify its technology as Bluetooth.</p> : null}
    <p>Road monitoring does not change ALPR exposure or route avoidance.</p>
    <a href={record.sourceUrl} target="_blank" rel="noopener noreferrer">Open source record</a>
    {source ? <footer><p>{source.attribution}</p>{source.licenceUrl ? <a href={source.licenceUrl} target="_blank" rel="noopener noreferrer">{source.licence ?? 'Source terms and information'}</a> : <p>{source.licence ?? 'Licence not reported'}</p>}</footer> : null}
  </section>;
}
