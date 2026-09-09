/**
 * WHAT THE CONSOLE READS, AND THE PURE SHAPES IT MAKES OF IT.
 *
 * Every fetch here is a public, unauthenticated read of the same files the
 * phone reads. Every function below the fetches is pure and tested: how a
 * misuse table is grouped, how a view becomes a .geojson, how a row is named.
 */

import { OWNERS } from '../data/api.ts';
import type { AbuseRecord, Camera } from '../data/api.ts';

export interface CountyRow {
  readonly fips: string;
  readonly name: string;
  readonly lsad: string;
  readonly state: string;
  readonly label: string;
  readonly cameras: number;
}

export interface CountiesDoc {
  readonly generatedAt: string;
  readonly counties: number;
  readonly located: number;
  readonly unlocated: number;
  readonly rows: readonly CountyRow[];
}

export interface TombstonesDoc {
  readonly generatedAt: string;
  readonly upstream: string;
  readonly tombstones: readonly { readonly id: string; readonly reason: string }[];
}

export interface IndexDoc {
  readonly generatedAt: string;
  readonly upstream: string | null;
  readonly cameras: number;
  readonly tiles: number;
  readonly bbox?: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal: signal ?? null, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path}: HTTP ${String(response.status)}`);
  return (await response.json()) as T;
}

export function fetchCounties(signal?: AbortSignal): Promise<CountiesDoc> {
  return getJson<CountiesDoc>('/cameras/counties.json', signal);
}

export function fetchTombstones(signal?: AbortSignal): Promise<TombstonesDoc> {
  return getJson<TombstonesDoc>('/cameras/tombstones.json', signal);
}

export function fetchIndex(signal?: AbortSignal): Promise<IndexDoc> {
  return getJson<IndexDoc>('/cameras/index.json', signal);
}

/** The bytes a published file weighs, from a HEAD; null when the host will not say. */
export async function fetchSize(path: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(path, { method: 'HEAD', signal: signal ?? null });
    const length = response.headers.get('content-length');
    return length === null ? null : Number(length);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Names

export function formatCount(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US');
}

export function formatBytes(n: number | null): string {
  if (n === null) return '';
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${String(Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "W 95th St & Santa Fe Trail Dr", "on W 95th St", "off W 95th St", or the id. */
export function cameraLabel(camera: Camera): string {
  if (camera.street === null) return camera.id;
  if (camera.cross !== null) return `${camera.street} & ${camera.cross}`;
  const away = camera.streetM ?? 0;
  return `${away > 60 ? 'off' : 'on'} ${camera.street}`;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function compass(deg: number | null): string | null {
  if (deg === null || !Number.isFinite(deg)) return null;
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % POINTS.length;
  return POINTS[index] ?? null;
}

export function ownerKicker(owner: string | null): string {
  switch (owner) {
    case 'police':
      return 'POLICE / AGENCY';
    case 'inter_agency':
      return 'INTER-AGENCY SHARED';
    case 'hoa':
      return 'HOA / NEIGHBORHOOD';
    case 'private':
      return 'PRIVATE / BUSINESS';
    case 'unverified':
      return 'UNVERIFIED REPORT';
    default:
      return 'OWNER NOT RECORDED';
  }
}

/** The inspector's callout: what this class of camera means for a driver. */
export function ownerNote(camera: Camera): string {
  switch (camera.ownerType) {
    case 'unverified':
      return 'Mapped from the ground and never confirmed against imagery. The phone draws it and alerts on it; treat the position as ±40 m.';
    case 'inter_agency':
      return 'Shared beyond the operating agency. A read here can be queried by departments with no connection to this county.';
    case 'police':
      return `Operated by ${camera.operator ?? 'a police agency the mapper did not name'}. Reads are retained under that agency's policy, which this archive cannot see.`;
    case 'hoa':
      return 'A neighborhood association camera. Reads are commonly shared with police on request, and sometimes by default.';
    case 'private':
      return 'A business or private operator. Retention and sharing are whatever the contract says, and the contract is not public.';
    default:
      return 'The mapper recorded the camera and not who runs it. Absence is honest; it is not the same as "nobody".';
  }
}

export function osmUrl(id: string): string {
  const raw = id.replace(/^osm:/, '');
  return raw.startsWith('w') ? `https://www.openstreetmap.org/way/${raw.slice(1)}` : `https://www.openstreetmap.org/node/${raw}`;
}

export function correctionUrl(id: string): string {
  return `https://darkroute.ai/?screen=report&camera=${encodeURIComponent(id)}`;
}

/** The z11 tile a point lives in, as the archive addresses it. */
export function tileOf(lat: number, lon: number): { readonly x: number; readonly y: number } {
  const n = 2 ** 11;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latR = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return { x, y };
}

// ---------------------------------------------------------------------------
// Counting

export type OwnerCounts = Readonly<Record<string, number>>;

export function countByOwner(cameras: readonly Camera[]): OwnerCounts {
  const counts: Record<string, number> = {};
  for (const owner of OWNERS) counts[owner.id] = 0;
  for (const camera of cameras) {
    const key = camera.ownerType ?? 'unverified';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const EARTH_M = 6_371_000;

export function metresBetween(
  a: { readonly lat: number; readonly lon: number },
  b: { readonly lat: number; readonly lon: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

export function formatMiles(metres: number): string {
  const miles = metres / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${String(Math.round(miles))} mi`;
}

// ---------------------------------------------------------------------------
// Misuse

export interface MisuseRow {
  readonly key: string;
  readonly year: number;
  readonly agency: string;
  readonly fips: string;
  readonly county: string;
  readonly cases: number;
  readonly incidents: number;
  readonly sourceUrl: string;
  readonly sourceName: string;
}

export function countyLabelFor(fips: string, counties: readonly CountyRow[] | null): string {
  const row = counties?.find((c) => c.fips === fips);
  return row?.label ?? (fips === '' ? '—' : `FIPS ${fips}`);
}

/** One row per (year, agency, county), newest first, most cases first within a year. */
export function misuseRows(
  records: readonly AbuseRecord[],
  counties: readonly CountyRow[] | null,
): readonly MisuseRow[] {
  const grouped = new Map<string, MisuseRow>();
  for (const record of records) {
    const key = `${String(record.year)}|${record.agency}|${record.fips}`;
    const held = grouped.get(key);
    if (held === undefined) {
      grouped.set(key, {
        key,
        year: record.year,
        agency: record.agency,
        fips: record.fips,
        county: countyLabelFor(record.fips, counties),
        cases: 1,
        incidents: record.incidents,
        sourceUrl: record.sourceUrl,
        sourceName: record.sourceName,
      });
    } else {
      grouped.set(key, { ...held, cases: held.cases + 1, incidents: held.incidents + record.incidents });
    }
  }
  return [...grouped.values()].sort(
    (a, b) => b.year - a.year || b.cases - a.cases || a.agency.localeCompare(b.agency),
  );
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function misuseCsv(rows: readonly MisuseRow[]): string {
  const lines = ['year,agency,county,fips,cases,incidents,source,source_url'];
  for (const row of rows) {
    lines.push(
      [row.year, row.agency, row.county, row.fips, row.cases, row.incidents, row.sourceName, row.sourceUrl]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Export

export function viewGeoJson(cameras: readonly Camera[]): string {
  return `${JSON.stringify(
    {
      type: 'FeatureCollection',
      attribution: 'Map data © OpenStreetMap contributors',
      licence: 'ODbL-1.0',
      features: cameras.map((camera) => ({
        type: 'Feature',
        id: camera.id,
        geometry: { type: 'Point', coordinates: [camera.lon, camera.lat] },
        properties: {
          id: camera.id,
          ownerType: camera.ownerType,
          street: camera.street,
          cross: camera.cross,
          locality: camera.locality ?? null,
          directionDeg: camera.directionDeg,
          operator: camera.operator,
          manufacturer: camera.manufacturer ?? null,
          mount: camera.mount ?? null,
        },
      })),
    },
    null,
    2,
  )}\n`;
}

/** Hand the browser a file. Inert in a sandboxed viewer; a no-op there, not an error. */
export function download(name: string, body: string, type: string): void {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** Search: street, cross street, locality, id or operator, any case. */
export function matchesQuery(camera: Camera, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const hay = [camera.id, camera.street, camera.cross, camera.locality, camera.operator, camera.manufacturer]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}
