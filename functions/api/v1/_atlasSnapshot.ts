export const ATLAS_KEY = 'records/atlas-counties.json';
export const ATLAS_MAX_BYTES = 2_097_152;

type JsonRecord = Record<string, unknown>;
export interface AtlasSnapshot extends JsonRecord {
  readonly fetchedAt: string;
  readonly checkedAt?: string;
  readonly source: JsonRecord;
  readonly totals: JsonRecord;
  readonly counties: Record<string, { n: number; agencies: string[]; vendors: string[]; vendorKnown: number }>;
}

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 5000
    && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 1000);
}
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Fail the snapshot as a whole; malformed records must not become absent counties. */
export function parseAtlasSnapshot(text: string): AtlasSnapshot | null {
  if (new TextEncoder().encode(text).byteLength > ATLAS_MAX_BYTES) return null;
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  if (!record(body) || body['schema'] !== 'darkroute-atlas-counties/v1'
    || !date(body['fetchedAt']) || (body['checkedAt'] !== undefined && !date(body['checkedAt']))
    || !record(body['source']) || !record(body['totals']) || !record(body['counties'])
    || Object.keys(body['counties']).length > 4000) return null;
  const source = body['source'];
  if (!['name', 'home', 'attribution'].every((key) => typeof source[key] === 'string' && source[key] !== '')
    || !record(source['licence'])) return null;
  try {
    const home = new URL(source['home'] as string);
    if (!['https:', 'http:'].includes(home.protocol) || home.username !== '' || home.password !== '') return null;
  } catch { return null; }
  if (!['alprRows', 'placed', 'unplaced', 'counties', 'agencies'].every((key) => count((body['totals'] as JsonRecord)[key]))) return null;
  let deployments = 0;
  for (const [code, row] of Object.entries(body['counties'])) {
    if (!/^\d{5}$/u.test(code) || !record(row) || !count(row['n']) || row['n'] === 0
      || !strings(row['agencies']) || row['agencies'].length === 0
      || !strings(row['vendors']) || !count(row['vendorKnown']) || row['vendorKnown'] > row['n']) return null;
    deployments += row['n'];
  }
  const totals = body['totals'];
  if (totals['placed'] !== deployments || totals['counties'] !== Object.keys(body['counties']).length
    || totals['alprRows'] !== deployments + (totals['unplaced'] as number)
    || (date(body['checkedAt']) && Date.parse(body['checkedAt']) < Date.parse(body['fetchedAt']))) return null;
  return body as AtlasSnapshot;
}
