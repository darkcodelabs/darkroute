/** The producer contract mirrors packages/core/src/roadMonitoring.ts. */
export const MONITORING_SCHEMA = 'darkroute-road-monitoring/v1';
export const MONITORING_MAX_BYTES = 8 * 1024 * 1024;
export const MONITORING_MAX_RECORDS = 20_000;
const KINDS = new Set(['bluetooth_sensor', 'probe_sensor', 'traffic_camera', 'red_light_camera', 'speed_camera', 'toll_reader', 'radar_sensor']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const nullableText = (value, max) => value === null || text(value, max);
const date = (value) => {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day >= 1 && day <= days;
};
const nullableDate = (value) => value === null || date(value);
const ipv4 = (value) => {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
};
const ipv6 = (value) => {
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
};
const url = (value) => {
  if (!text(value, 8192) || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
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
};

export function validateMonitoringSnapshot(snapshot) {
  if (!object(snapshot) || snapshot.schema !== MONITORING_SCHEMA || !date(snapshot.generatedAt)
    || !Array.isArray(snapshot.sources) || snapshot.sources.length > 500
    || !Array.isArray(snapshot.records) || snapshot.records.length > MONITORING_MAX_RECORDS
    || Buffer.byteLength(JSON.stringify(snapshot)) > MONITORING_MAX_BYTES) throw new Error('Invalid monitoring snapshot');
  const sources = new Map();
  const normalizedSources = [];
  for (const source of snapshot.sources) {
    if (!object(source) || !text(source.id, 200) || sources.has(source.id) || !text(source.name, 1000)
      || !url(source.url) || !text(source.attribution, 4000) || !nullableText(source.licence, 1000)
      || !(source.licenceUrl === null || url(source.licenceUrl)) || !text(source.coverage, 2000)
      || !date(source.checkedAt) || !nullableDate(source.fetchedAt) || !nullableDate(source.sourceUpdatedAt)
      || !['ok', 'stale', 'unavailable', 'retired'].includes(source.status)
      || !Number.isSafeInteger(source.count) || source.count < 0 || source.count > MONITORING_MAX_RECORDS
      || Date.parse(source.checkedAt) > Date.parse(snapshot.generatedAt)
      || (source.fetchedAt !== null && Date.parse(source.fetchedAt) > Date.parse(source.checkedAt))) throw new Error('Invalid monitoring source');
    sources.set(source.id, 0);
    normalizedSources.push({
      id: source.id, name: source.name, url: source.url, attribution: source.attribution,
      licence: source.licence, licenceUrl: source.licenceUrl, coverage: source.coverage,
      checkedAt: source.checkedAt, fetchedAt: source.fetchedAt, sourceUpdatedAt: source.sourceUpdatedAt,
      status: source.status, count: source.count,
    });
  }
  const ids = new Set();
  const normalizedRecords = [];
  for (const row of snapshot.records) {
    if (!object(row) || !text(row.id, 300) || ids.has(row.id) || !text(row.sourceId, 200) || !sources.has(row.sourceId) || !KINDS.has(row.kind)
      || !Number.isFinite(row.lat) || Math.abs(row.lat) > 90 || !Number.isFinite(row.lon) || Math.abs(row.lon) > 180
      || !text(row.name, 1000) || !nullableText(row.operator, 1000) || !nullableText(row.road, 1000)
      || !nullableText(row.direction, 200) || !['active', 'inactive', 'unknown'].includes(row.status)
      || !url(row.sourceUrl) || !nullableDate(row.sourceUpdatedAt) || !(row.imageUrl === null || url(row.imageUrl))) throw new Error('Invalid monitoring record');
    ids.add(row.id);
    sources.set(row.sourceId, sources.get(row.sourceId) + 1);
    normalizedRecords.push({
      id: row.id, sourceId: row.sourceId, kind: row.kind, lat: row.lat, lon: row.lon, name: row.name,
      operator: row.operator, road: row.road, direction: row.direction, status: row.status,
      sourceUrl: row.sourceUrl, imageUrl: row.imageUrl, sourceUpdatedAt: row.sourceUpdatedAt,
    });
  }
  if (snapshot.sources.some((source) => source.count !== sources.get(source.id))) throw new Error('Monitoring counts do not match records');
  return { schema: MONITORING_SCHEMA, generatedAt: snapshot.generatedAt, sources: normalizedSources, records: normalizedRecords };
}
