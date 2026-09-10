import { parseMonitoringSnapshot } from '../../../../packages/core/src/roadMonitoring.ts';
import type { MonitoringSnapshot } from '../../../../packages/core/src/roadMonitoring.ts';
export type { MonitoringKind, MonitoringRecord } from '../../../../packages/core/src/roadMonitoring.ts';

/**
 * THE CONSOLE'S ONLY WAY TO REACH DATA.
 *
 * =============================================================================
 * IT USES THE PUBLIC API, NOT A PRIVATE ONE
 * =============================================================================
 * This app could read R2 directly, or carry its own query layer. It reads
 * `/api/v1/*` - the same endpoints anyone else gets - on purpose.
 *
 * A public API that its own author does not use is an API that quietly rots:
 * the caps are wrong, the errors are unreadable, the shape is awkward, and
 * nobody finds out because the only consumer is a stranger who gave up. Making
 * the console a first-class client means every one of those problems lands on
 * us first.
 *
 * It also means the rate limit applies here. That is intentional. If the limit
 * is too tight to browse an archive comfortably, it is too tight, and this is
 * where that gets noticed.
 */

/**
 * WHERE THE API LIVES.
 *
 * The console is deployed as its own Pages project, so "same origin" is the
 * CONSOLE's origin - which has no API on it. Left empty, every request 404s
 * into that project's own handler and surfaces as an unhandled Worker
 * exception, which is what the map view did.
 *
 * It calls the real API cross-origin instead. That works because the API sets
 * `access-control-allow-origin: *` deliberately: it is public, openly licensed
 * data, and restricting which page may read it would inconvenience exactly the
 * people it is for while stopping nobody - curl sends no Origin.
 *
 * Overridable so a local checkout can point at a preview deployment.
 */
const BASE = import.meta.env['VITE_API_BASE'] ?? 'https://darkroute.ai';

export interface Camera {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly ownerType: string | null;
  readonly street: string | null;
  readonly cross: string | null;
  readonly directionDeg: number | null;
  readonly operator: string | null;
  /** The maker, from the `manufacturer` tag; absent on an API older than the console. */
  readonly manufacturer?: string | null;
  /** The `camera:mount` tag: pole, wall, traffic_signal. */
  readonly mount?: string | null;
  /** The town, or "<Name> County", from the pinned release context. */
  readonly locality?: string | null;
  /** Join to the public Atlas and abuse endpoints for county context. */
  readonly countyFips?: string | null;
  /** Metres from the camera to `street`. */
  readonly streetM?: number | null;
}

export interface CamerasResult {
  readonly attribution: string;
  readonly licence: string;
  readonly count: number;
  readonly truncated: boolean;
  readonly emptyTiles: number;
  readonly cameras: readonly Camera[];
}

export interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * A failure that carries what the server actually said.
 *
 * The API answers errors as JSON with a machine code and a sentence of prose
 * explaining the specific problem. Throwing a bare `Error('request failed')`
 * would discard the useful half - and the useful half is the reason those
 * messages were written.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-cache',
    signal: signal ?? null,
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof record['error'] === 'string' ? record['error'] : 'unknown',
      typeof record['detail'] === 'string' ? record['detail'] : `HTTP ${String(response.status)}`,
    );
  }
  return body as T;
}

export function fetchCameras(
  box: Box,
  options: { owner?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<CamerasResult> {
  const params = new URLSearchParams({
    bbox: [box.west, box.south, box.east, box.north].map((n) => n.toFixed(5)).join(','),
  });
  if (options.owner != null && options.owner !== '') params.set('owner', options.owner);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  return get<CamerasResult>(`/api/v1/cameras?${params.toString()}`, signal);
}

export interface AbuseRecord {
  readonly fips: string;
  readonly agency: string;
  readonly incidents: number;
  readonly year: number;
  readonly sourceName: string;
  readonly summary: string;
  readonly sourceUrl: string;
}

export interface AbuseResult {
  readonly count: number;
  readonly records: readonly AbuseRecord[];
  readonly generatedAt?: string | null;
}

export function fetchAbuse(signal?: AbortSignal): Promise<AbuseResult> {
  return get<AbuseResult>('/api/v1/abuse', signal);
}

export interface NewsArticle {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publisher: string;
  /** Upstream observation time, not a verified publication date. */
  readonly publishedAt: string;
  readonly topic: 'abuse' | 'news';
}
export interface NewsResult {
  readonly updatedAt: string;
  readonly lastAttemptAt: string;
  readonly coverage: { readonly status: 'complete' | 'partial' | 'unavailable'; readonly attempted: number; readonly succeeded: number };
  readonly articles: readonly NewsArticle[];
}
export function fetchNews(signal?: AbortSignal): Promise<NewsResult> {
  return get<NewsResult>('/api/v1/news', signal);
}

export interface AtlasCounty {
  readonly fips: string;
  readonly deployments: number;
  readonly agencies: readonly string[];
  readonly vendors: readonly string[];
  readonly vendorKnown: number;
}
export interface AtlasResult {
  readonly fetchedAt: string;
  readonly checkedAt: string;
  readonly source: { readonly name: string; readonly home: string; readonly attribution: string; readonly licence?: unknown };
  readonly totals: { readonly alprRows: number; readonly agencies: number; readonly counties: number };
  readonly counties: readonly AtlasCounty[];
}
export function fetchAtlas(signal?: AbortSignal): Promise<AtlasResult> {
  return get<AtlasResult>('/api/v1/atlas', signal);
}

export interface MonitoringResult extends MonitoringSnapshot {
  readonly count: number;
  readonly total: number;
}

/** Fetch the complete inventory once; searches and kind filters stay on this device. */
export async function fetchMonitoring(signal?: AbortSignal): Promise<MonitoringResult> {
  const body = await get<unknown>('/api/v1/monitoring', signal);
  const snapshot = parseMonitoringSnapshot(body);
  const envelope = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  const query = envelope['query'];
  if (snapshot === null || envelope['count'] !== snapshot.records.length || envelope['total'] !== snapshot.records.length
    || typeof query !== 'object' || query === null || !('bbox' in query) || !('kind' in query)
    || query.bbox !== null || query.kind !== null) {
    throw new ApiError(200, 'monitoring_malformed', 'The monitoring inventory response is incomplete or invalid.');
  }
  return { ...snapshot, count: snapshot.records.length, total: snapshot.records.length };
}

/** Images go through the same-origin proxy only when a record's details are open. */
export async function fetchMonitoringImage(id: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/v1/monitoring/image?${new URLSearchParams({ id }).toString()}`, {
    credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: signal ?? null,
  });
  const type = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type ?? '')
    || Number(response.headers.get('content-length')) > 5 * 1024 * 1024) {
    throw new ApiError(response.status, 'monitoring_image_unavailable', 'The source photo is unavailable right now.');
  }
  const blob = await response.blob();
  if (blob.size === 0 || blob.size > 5 * 1024 * 1024) throw new ApiError(200, 'monitoring_image_invalid', 'The source photo is invalid.');
  return blob;
}

export interface Stats {
  readonly cameras: number;
  readonly generation: string | null;
  readonly generatedAt: string | null;
  readonly upstream: string | null;
  readonly source: string;
  readonly attribution: string;
  readonly licence: string;
  readonly abuseRecords: number;
}

export function fetchStats(signal?: AbortSignal): Promise<Stats> {
  return get<Stats>('/api/v1/stats', signal);
}

/** Owner classes, in the order the app itself lists them. */
export const OWNERS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'police', label: 'POLICE / AGENCY' },
  { id: 'inter_agency', label: 'INTER-AGENCY SHARED' },
  { id: 'hoa', label: 'HOA / NEIGHBORHOOD' },
  { id: 'private', label: 'PRIVATE / BUSINESS' },
  { id: 'unverified', label: 'UNVERIFIED REPORTS' },
];

export function ownerLabel(id: string | null): string {
  return OWNERS.find((o) => o.id === id)?.label ?? 'UNCLASSIFIED';
}

/** "Metcalf Ave at W 111th St", or the id when the archive has no street. */
export function placeOf(camera: Camera): string {
  if (camera.street === null) return camera.id;
  if (camera.cross === null) return camera.street;
  return `${camera.street} at ${camera.cross}`;
}
