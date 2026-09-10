import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { distanceM } from '../../stores/fwmCore.ts';
import type { MonitoringRecord } from '../../stores/fwmCore.ts';

type MonitoringCoordinate = Pick<MonitoringRecord, 'lat' | 'lon'>;
export interface MonitoringOverlapCamera {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
}

export function summarizeMonitoringOverlap(
  record: MonitoringCoordinate,
  cameras: readonly MonitoringOverlapCamera[],
): {
  readonly loadedCount: number;
  readonly within100m: number;
  readonly nearest: { readonly id: string; readonly distanceM: number } | null;
} {
  let within100m = 0;
  let nearest: { readonly id: string; readonly distanceM: number } | null = null;
  for (const camera of cameras) {
    const metres = distanceM(record.lat, record.lon, camera.lat, camera.lon);
    if (metres <= 100) within100m += 1;
    if (nearest === null || metres < nearest.distanceM) nearest = { id: camera.id, distanceM: metres };
  }
  return { loadedCount: cameras.length, within100m, nearest };
}

export function MonitoringOverlap({ record, cameras, onOpenCamera }: {
  readonly record: MonitoringCoordinate;
  readonly cameras: readonly MonitoringOverlapCamera[];
  readonly onOpenCamera: (id: string) => void;
}): ReactElement {
  const overlap = useMemo(() => summarizeMonitoringOverlap(record, cameras), [record, cameras]);
  const nearest = overlap.nearest;
  const nearestDistance = nearest === null ? 'Not available'
    : nearest.distanceM < 1000 ? `${Math.round(nearest.distanceM)} m` : `${(nearest.distanceM / 1000).toFixed(1)} km`;
  return <section aria-label="Nearby ALPR points">
    <h3>Nearby ALPR points</h3>
    <dl>
      <dt>Coverage</dt><dd>{overlap.loadedCount} loaded ALPR points</dd>
      <dt>Within 100 m</dt><dd>{nearest === null ? 'Not available' : overlap.within100m}</dd>
      <dt>Nearest loaded ALPR point</dt><dd>{nearestDistance}</dd>
    </dl>
    {nearest === null ? <p>No ALPR points are currently loaded. Proximity cannot be checked.</p>
      : <button type="button" onClick={() => onOpenCamera(nearest.id)}>Open nearest ALPR details</button>}
    <p>Proximity does not prove shared equipment, data sharing, or ALPR capability at this road monitoring site.</p>
  </section>;
}
