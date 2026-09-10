/** Public infrastructure inventories, separate from the ALPR alert engine. */
export const MONITORING_SCHEMA = 'darkroute-road-monitoring/v1';
export const MONITORING_MAX_BYTES = 8 * 1024 * 1024;
export const MONITORING_MAX_RECORDS = 20_000;
export const MONITORING_KINDS = [
  'bluetooth_sensor', 'probe_sensor', 'traffic_camera', 'red_light_camera',
  'speed_camera', 'toll_reader', 'radar_sensor',
] as const;
export type MonitoringKind = typeof MONITORING_KINDS[number];

export interface MonitoringRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: MonitoringKind;
  readonly lat: number;
  readonly lon: number;
  readonly name: string;
  readonly operator: string | null;
  readonly road: string | null;
  readonly direction: string | null;
  readonly status: 'active' | 'inactive' | 'unknown';
  readonly sourceUrl: string;
  /** Official image metadata only; clients use the on-demand image proxy. */
  readonly imageUrl: string | null;
  readonly sourceUpdatedAt: string | null;
}

export interface MonitoringSource {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly attribution: string;
  readonly licence: string | null;
  readonly licenceUrl: string | null;
  readonly coverage: string;
  readonly checkedAt: string;
  readonly fetchedAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly status: 'ok' | 'stale' | 'unavailable' | 'retired';
  readonly count: number;
}

export interface MonitoringSnapshot {
  readonly schema: typeof MONITORING_SCHEMA;
  readonly generatedAt: string;
  readonly sources: readonly MonitoringSource[];
  readonly records: readonly MonitoringRecord[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function nullableText(value: unknown, max: number): value is string | null {
  return value === null || text(value, max);
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day >= 1 && day <= days;
}
function nullableDate(value: unknown): value is string | null {
  return value === null || date(value);
}
function ipv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}
function ipv6(value: string): boolean {
  if (value.includes(':::') || (value.startsWith(':') && !value.startsWith('::'))
    || (value.endsWith(':') && !value.endsWith('::'))) return false;
  const halves = value.split('::');
  if (halves.length > 2) return false;
  const groups = value.split(':').filter((part) => part !== '');
  let count = 0;
  for (const [index, group] of groups.entries()) {
    if (group.includes('.')) {
      if (index !== groups.length - 1 || !ipv4(group)) return false;
      count += 2;
    } else {
      if (!/^[0-9a-f]{1,4}$/iu.test(group)) return false;
      count += 1;
    }
  }
  return halves.length === 2 ? count < 8 : count === 8;
}
function url(value: unknown): value is string {
  if (!text(value, 8192) || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  // The core stays platform-free: validate HTTP authority without browser URL globals.
  const authority = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/iu.exec(value)?.[1];
  if (authority === undefined || authority.includes('@')) return false;
  const host = /^(?:\[([0-9a-f:.]+)\]|([a-z0-9.-]+))(?::([0-9]{1,5}))?$/iu.exec(authority);
  if (host === null || (host[3] !== undefined && Number(host[3]) > 65535)) return false;
  if (host[1] !== undefined) return ipv6(host[1]);
  const hostname = host[2];
  if (hostname === undefined || hostname.length > 253) return false;
  if (/^[0-9.]+$/u.test(hostname)) return ipv4(hostname);
  return hostname.replace(/\.$/u, '').split('.').every((label) =>
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label));
}

function bytes(text: string): number {
  let total = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    total += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (total > MONITORING_MAX_BYTES) return total;
  }
  return total;
}
function source(input: unknown): MonitoringSource | null {
  if (!record(input) || !text(input['id'], 200) || !text(input['name'], 1000)
    || !url(input['url']) || !text(input['attribution'], 4000)
    || !nullableText(input['licence'], 1000) || !(input['licenceUrl'] === null || url(input['licenceUrl']))
    || !text(input['coverage'], 2000) || !date(input['checkedAt'])
    || !nullableDate(input['fetchedAt']) || !nullableDate(input['sourceUpdatedAt'])
    || typeof input['status'] !== 'string' || !['ok', 'stale', 'unavailable', 'retired'].includes(input['status'])
    || typeof input['count'] !== 'number' || !Number.isSafeInteger(input['count'])
    || input['count'] < 0 || input['count'] > MONITORING_MAX_RECORDS) return null;
  return {
    id: input['id'], name: input['name'], url: input['url'], attribution: input['attribution'],
    licence: input['licence'], licenceUrl: input['licenceUrl'], coverage: input['coverage'],
    checkedAt: input['checkedAt'], fetchedAt: input['fetchedAt'], sourceUpdatedAt: input['sourceUpdatedAt'],
    status: input['status'] as MonitoringSource['status'], count: input['count'],
  };
}
function location(input: unknown): MonitoringRecord | null {
  if (!record(input) || !text(input['id'], 300) || !text(input['sourceId'], 200)
    || !MONITORING_KINDS.includes(input['kind'] as MonitoringKind)
    || typeof input['lat'] !== 'number' || !Number.isFinite(input['lat']) || Math.abs(input['lat']) > 90
    || typeof input['lon'] !== 'number' || !Number.isFinite(input['lon']) || Math.abs(input['lon']) > 180
    || !text(input['name'], 1000) || !nullableText(input['operator'], 1000)
    || !nullableText(input['road'], 1000) || !nullableText(input['direction'], 200)
    || typeof input['status'] !== 'string' || !['active', 'inactive', 'unknown'].includes(input['status'])
    || !url(input['sourceUrl']) || !(input['imageUrl'] === null || url(input['imageUrl']))
    || !nullableDate(input['sourceUpdatedAt'])) return null;
  return {
    id: input['id'], sourceId: input['sourceId'], kind: input['kind'] as MonitoringKind,
    lat: input['lat'], lon: input['lon'], name: input['name'], operator: input['operator'],
    road: input['road'], direction: input['direction'], status: input['status'] as MonitoringRecord['status'],
    sourceUrl: input['sourceUrl'], imageUrl: input['imageUrl'], sourceUpdatedAt: input['sourceUpdatedAt'],
  };
}

/** Reject incomplete inventories; retain explicit stale/unknown states and only defined metadata. */
export function parseMonitoringSnapshot(input: unknown): MonitoringSnapshot | null {
  try {
    if (!record(input) || input['schema'] !== MONITORING_SCHEMA || !date(input['generatedAt'])
      || !Array.isArray(input['sources']) || input['sources'].length > 500
      || !Array.isArray(input['records']) || input['records'].length > MONITORING_MAX_RECORDS
      || bytes(JSON.stringify(input)) > MONITORING_MAX_BYTES) return null;
    const sources: MonitoringSource[] = [];
    const sourceCounts = new Map<string, number>();
    for (const raw of input['sources']) {
      const parsed = source(raw);
      if (parsed === null || sourceCounts.has(parsed.id)) return null;
      sources.push(parsed);
      sourceCounts.set(parsed.id, 0);
    }
    const records: MonitoringRecord[] = [];
    const ids = new Set<string>();
    for (const raw of input['records']) {
      const parsed = location(raw);
      if (parsed === null || ids.has(parsed.id) || !sourceCounts.has(parsed.sourceId)) return null;
      ids.add(parsed.id);
      sourceCounts.set(parsed.sourceId, (sourceCounts.get(parsed.sourceId) ?? 0) + 1);
      records.push(parsed);
    }
    if (sources.some((item) => item.count !== sourceCounts.get(item.id))) return null;
    return { schema: MONITORING_SCHEMA, generatedAt: input['generatedAt'], sources, records };
  } catch { return null; }
}
