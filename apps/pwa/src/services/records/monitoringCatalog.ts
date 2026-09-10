import { MONITORING_KINDS } from '../../stores/fwmCore.ts';
import type { MonitoringKind, MonitoringRecord } from '../../stores/fwmCore.ts';

export { MONITORING_KINDS };
export const MONITORING_LABELS: Readonly<Record<MonitoringKind, string>> = {
  bluetooth_sensor: 'Bluetooth sensors', probe_sensor: 'Travel-time probes',
  traffic_camera: 'Traffic cameras', red_light_camera: 'Red-light cameras',
  speed_camera: 'Speed cameras', toll_reader: 'Toll readers', radar_sensor: 'Radar sensors',
};
export const MONITORING_SYMBOLS: Readonly<Record<MonitoringKind, string>> = {
  bluetooth_sensor: 'BT', probe_sensor: 'TT', traffic_camera: 'TV',
  red_light_camera: 'RL', speed_camera: 'SP', toll_reader: 'TL', radar_sensor: 'RD',
};
export type MonitoringTypes = Readonly<Record<MonitoringKind, boolean>>;
export const MONITORING_OFF: MonitoringTypes = Object.freeze({
  bluetooth_sensor: false, probe_sensor: false, traffic_camera: false,
  red_light_camera: false, speed_camera: false, toll_reader: false, radar_sensor: false,
});
export function readMonitoringTypes(raw: unknown): MonitoringTypes {
  const bag = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return Object.fromEntries(MONITORING_KINDS.map((kind) => [kind, bag[kind] === true])) as Record<MonitoringKind, boolean>;
}
export function monitoringEnabled(types: MonitoringTypes): boolean {
  return MONITORING_KINDS.some((kind) => types[kind]);
}
export function selectedMonitoring(records: readonly MonitoringRecord[], types: MonitoringTypes): readonly MonitoringRecord[] {
  return records.filter((record) => types[record.kind]);
}
export function monitoringCounts(records: readonly MonitoringRecord[]): { active: number; unknown: number; inactive: number } {
  const counts = { active: 0, unknown: 0, inactive: 0 };
  for (const record of records) counts[record.status]++;
  return counts;
}
export function monitoringStatus(status: MonitoringRecord['status']): string {
  return status === 'active' ? 'Listed active' : status === 'inactive' ? 'Listed inactive' : 'Status not reported';
}
export function monitoringDate(value: string | null): string {
  return value === null ? 'Not reported' : new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
