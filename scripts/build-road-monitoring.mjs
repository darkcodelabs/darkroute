#!/usr/bin/env node
/** Fetch bounded official equipment inventories; retain each source on failure. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MONITORING_SOURCES, iso } from './road-monitoring-sources.mjs';
import { MONITORING_SCHEMA, MONITORING_MAX_BYTES, MONITORING_MAX_RECORDS, validateMonitoringSnapshot } from './road-monitoring-schema.mjs';

async function readJson(url, read) {
  const response = await read(url, { redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; DarkRouteData/1.0; +https://darkroute.ai)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MONITORING_MAX_BYTES) throw new Error('Upstream response exceeds size limit');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MONITORING_MAX_BYTES) throw new Error('Upstream response exceeds size limit');
    chunks.push(Buffer.from(chunk));
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (data?.error) throw new Error('Upstream returned an error');
  return { data, modified: iso(response.headers.get('last-modified')) };
}
const query = (base, params) => { const url = new URL(base); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); return url.href; };

function equipmentRetired(metadata) {
  const description = typeof metadata.description === 'string' ? metadata.description.replace(/<[^>]*>/gu, ' ') : '';
  // Dataset maintenance is independent of device operation. Require an explicit
  // equipment retirement statement, excluding partial, future and negated claims.
  return description.split(/[.!?]/u).some((sentence) =>
    !/\b(?:some|certain|several|not|never|may|might|will)\b/iu.test(sentence)
    && /\b(?:sensors?|devices?|detectors?|cameras?|equipment|assets?)\s+(?:(?:are|is)\s+no\s+longer\s+(?:actively\s+)?maintained\s+and\s+)?(?:(?:have|has|been|were|was|are|is|all|since|now)\s+)*(?:retired|decommissioned|removed\s+from\s+(?:operation|service))\b/iu.test(sentence));
}

export async function fetchMonitoringSource(source, read = fetch) {
  let rows;
  let sourceUpdatedAt = null;
  if (source.format === 'arcgis') {
    const metadata = await readJson(query(source.endpoint, { f: 'json' }), read);
    sourceUpdatedAt = iso(metadata.data.editingInfo?.dataLastEditDate ?? metadata.data.editingInfo?.lastEditDate) ?? metadata.modified;
    if (equipmentRetired(metadata.data)) return { records: [], sourceUpdatedAt, retired: true };
    const endpoint = `${source.endpoint}/query`;
    const count = (await readJson(query(endpoint, { where: source.where, returnCountOnly: 'true', f: 'json' }), read)).data.count;
    if (!Number.isSafeInteger(count) || count < 1 || count > MONITORING_MAX_RECORDS) throw new Error('Invalid or empty upstream inventory');
    const idField = metadata.data.objectIdField ?? metadata.data.fields?.find((field) => field.type === 'esriFieldTypeOID')?.name;
    rows = [];
    for (let offset = 0; offset < count; offset += 1000) {
      const params = { where: source.where, outFields: source.fields, returnGeometry: 'true', outSR: '4326', f: 'geojson',
        resultOffset: String(offset), resultRecordCount: '1000', ...(idField ? { orderByFields: idField } : {}) };
      const page = (await readJson(query(endpoint, params), read)).data;
      if (page.type !== 'FeatureCollection' || !Array.isArray(page.features) || page.features.length !== Math.min(1000, count - offset)) {
        throw new Error('Incomplete upstream inventory page');
      }
      rows.push(...page.features);
    }
  } else if (source.format === 'socrata') {
    const metadata = (await readJson(source.metadata, read)).data;
    sourceUpdatedAt = iso(Number(metadata.rowsUpdatedAt) > 0 ? Number(metadata.rowsUpdatedAt) * 1000 : null);
    if (equipmentRetired(metadata)) return { records: [], sourceUpdatedAt, retired: true };
    const counted = (await readJson(query(source.endpoint, { $select: 'count(*)' }), read)).data;
    const count = Number(counted?.[0]?.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > MONITORING_MAX_RECORDS) throw new Error('Invalid or empty upstream inventory');
    rows = (await readJson(query(source.endpoint, { $limit: String(count), $order: ':id' }), read)).data;
    if (!Array.isArray(rows) || rows.length !== count) throw new Error('Incomplete upstream inventory');
  } else if (source.format === 'caltrans') {
    const response = await readJson(source.endpoint, read);
    sourceUpdatedAt = response.modified;
    rows = response.data.data;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > MONITORING_MAX_RECORDS) throw new Error('Invalid or empty Caltrans inventory');
  } else throw new Error('Unknown source format');
  const records = rows.map((row) => source.normalize(row)).filter((row) => row !== null);
  // A normalizer returns null only for explicitly removed equipment. A complete,
  // nonempty upstream inventory of removed rows authoritatively clears old assets.
  const ids = new Set(records.map((row) => row.id));
  if (ids.size !== records.length) throw new Error('Source returned duplicate equipment identifiers');
  return { records, sourceUpdatedAt };
}

export async function collectRoadMonitoring({ previous = null, sources = MONITORING_SOURCES, read = fetch,
  now = new Date().toISOString(), onSource = () => {} } = {}) {
  const normalizedPrevious = previous === null ? null : validateMonitoringSnapshot(previous);
  if (iso(now) !== now) throw new Error('now must be a canonical ISO date');
  const oldSources = new Map(normalizedPrevious?.sources.map((source) => [source.id, source]) ?? []);
  const oldRecords = new Map();
  for (const row of normalizedPrevious?.records ?? []) {
    if (!oldRecords.has(row.sourceId)) oldRecords.set(row.sourceId, []);
    oldRecords.get(row.sourceId).push(row);
  }
  const results = [];
  // Three bounded requests at once; each source preserves its own last valid data.
  for (let offset = 0; offset < sources.length; offset += 3) {
    const group = await Promise.all(sources.slice(offset, offset + 3).map(async (config) => {
      const base = { id: config.id, name: config.name, url: config.url, attribution: config.attribution,
        licence: config.licence, licenceUrl: config.licenceUrl, coverage: config.coverage, checkedAt: now };
      try {
        const result = await fetchMonitoringSource(config, read);
        const source = { ...base, fetchedAt: now, sourceUpdatedAt: result.sourceUpdatedAt,
          status: result.retired ? 'retired' : 'ok', count: result.records.length };
        const normalized = validateMonitoringSnapshot({ schema: MONITORING_SCHEMA, generatedAt: now, sources: [source], records: result.records });
        onSource({ id: config.id, status: source.status, count: source.count });
        return { source: normalized.sources[0], records: normalized.records };
      } catch (error) {
        const old = oldSources.get(config.id);
        const records = old?.status === 'retired' ? [] : oldRecords.get(config.id) ?? [];
        const source = { ...base, fetchedAt: old?.fetchedAt ?? null, sourceUpdatedAt: old?.sourceUpdatedAt ?? null,
          status: old?.status === 'retired' ? 'retired' : old?.fetchedAt == null ? 'unavailable' : 'stale', count: records.length };
        onSource({ id: config.id, status: source.status, count: records.length, reason: String(error.message).slice(0, 160) });
        return { source, records };
      }
    }));
    results.push(...group);
  }
  const snapshot = { schema: MONITORING_SCHEMA, generatedAt: now,
    sources: results.map((result) => result.source), records: results.flatMap((result) => result.records) };
  if (snapshot.records.length === 0 && !snapshot.sources.some((source) => ['ok', 'retired'].includes(source.status))) {
    throw new Error('No valid monitoring data; keeping the previous publication');
  }
  return validateMonitoringSnapshot(snapshot);
}

async function main() {
  const args = process.argv.slice(2);
  let output = null;
  let previous = null;
  for (let i = 0; i < args.length; i += 2) {
    if (!['--output', '--previous'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: --output PATH [--previous PATH]');
    if (args[i] === '--output') output = args[i + 1];
    else previous = JSON.parse(await readFile(args[i + 1], 'utf8'));
  }
  if (output === null) throw new Error('--output is required');
  const snapshot = await collectRoadMonitoring({ previous, onSource: (source) => console.log(JSON.stringify(source)) });
  await writeFile(output, `${JSON.stringify(snapshot)}\n`);
  console.log(`Built ${snapshot.records.length} records from ${snapshot.sources.filter((source) => source.status === 'ok').length}/${snapshot.sources.length} sources`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
