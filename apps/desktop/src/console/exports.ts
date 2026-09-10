import type { MonitoringRecord, MonitoringResult } from '../data/api.ts';

function cell(value: unknown): string {
  const raw = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Source names and descriptions are external text. Keep spreadsheet formula prefixes inert.
  const text = typeof value === 'string' && /^[\s]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Every matching row and every returned field, independent of the visible page size. */
export function recordsCsv(rows: readonly object[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `${[columns.map(cell).join(','), ...rows.map((row) => columns.map((key) => cell((row as Record<string, unknown>)[key])).join(','))].join('\r\n')}\r\n`;
}

/** Keep per-publisher attribution and terms beside the equipment facts in flat exports. */
export function monitoringCsv(data: MonitoringResult, records: readonly MonitoringRecord[]): string {
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  return recordsCsv(records.map((record) => {
    const source = sources.get(record.sourceId);
    return { ...record, sourceName: source?.name, sourceAttribution: source?.attribution, sourceLicence: source?.licence,
      sourceLicenceUrl: source?.licenceUrl, sourceStatus: source?.status, sourceCheckedAt: source?.checkedAt,
      sourceFetchedAt: source?.fetchedAt, snapshotGeneratedAt: data.generatedAt };
  }));
}
