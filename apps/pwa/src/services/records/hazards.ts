/**
 * ROADWORK AND CLOSURES, READ ON THE DEVICE.
 *
 * =============================================================================
 * IT IS NOT A POLICE LAYER
 * =============================================================================
 * That was the original request, and the answer is that the data does not
 * exist. Kansas publishes zero police strings across 97 live collections;
 * Missouri, Florida, Pennsylvania and New York the same. The WZDx standard has
 * two event types and both are work zones. See `scripts/build-hazards.mjs`.
 *
 * Every string in this file therefore says roadwork and closures, and the
 * control that switches it on must too. A layer labelled "police" that drew
 * work zones would be the exact kind of claim this project spends its
 * documentation refusing to make.
 *
 * =============================================================================
 * TWO ABSENCES THAT MUST NEVER RENDER THE SAME
 * =============================================================================
 * "There is no roadwork here" and "this layer does not cover this state" are
 * completely different facts, and conflating them is how a driver in a state
 * with no feed concludes the road ahead is clear.
 *
 * `coverageOf` answers which one it is, and the UI is obliged to say so.
 *
 * =============================================================================
 * STALENESS IS MEASURED, NOT ASSUMED
 * =============================================================================
 * `builtAt` is read from the FILE, never from a build constant. A constant
 * compiled into the bundle reports the age of the app rather than the age of
 * the data - a bug this codebase has already shipped once and recorded.
 */

const URL_ = '/records/hazards.json';
const SCHEMA = 'darkroute-hazards/v1';

/**
 * When the layer stops being worth drawing.
 *
 * A work zone is a slow-moving fact, so hours are fine where minutes would be
 * needed for an incident feed. Past this the layer reports itself stale rather
 * than drawing points nobody has re-verified in a day.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface Hazard {
  readonly id: string;
  readonly source: string;
  readonly kind: string;
  readonly lat: number;
  readonly lon: number;
  readonly description: string;
  readonly road: string;
}

export interface HazardSource {
  readonly key: string;
  readonly label: string;
  readonly licence: string;
  readonly attribution: string;
  readonly records: number;
}

interface Loaded {
  readonly builtAt: number;
  readonly coverage: readonly string[];
  readonly sources: readonly HazardSource[];
  readonly hazards: readonly Hazard[];
}

let loaded: Loaded | null = null;
let loading: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Load once. A missing file is an empty layer, never an error a driver sees. */
export async function loadHazards(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (loaded !== null) return;
  loading ??= (async () => {
    try {
      const response = await fetchImpl(URL_, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        loaded = { builtAt: 0, coverage: [], sources: [], hazards: [] };
        return;
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || body['schema'] !== SCHEMA) {
        loaded = { builtAt: 0, coverage: [], sources: [], hazards: [] };
        return;
      }
      const rows = Array.isArray(body['hazards']) ? body['hazards'] : [];
      loaded = {
        builtAt: Date.parse(String(body['builtAt'] ?? '')) || 0,
        coverage: Array.isArray(body['coverage']) ? (body['coverage'] as string[]) : [],
        sources: (Array.isArray(body['sources']) ? body['sources'] : [])
          .filter(isRecord)
          .filter((s) => s['ok'] === true)
          .map((s) => ({
            key: String(s['key'] ?? ''),
            label: String(s['label'] ?? ''),
            licence: String(s['licence'] ?? ''),
            attribution: String(s['attribution'] ?? ''),
            records: typeof s['records'] === 'number' ? s['records'] : 0,
          })),
        hazards: rows.filter(isRecord).flatMap((h) => {
          const lat = h['lat'];
          const lon = h['lon'];
          if (typeof lat !== 'number' || typeof lon !== 'number') return [];
          return [
            {
              id: `${String(h['s'] ?? '')}:${String(h['i'] ?? '')}`,
              source: String(h['s'] ?? ''),
              kind: String(h['k'] ?? 'work-zone'),
              lat,
              lon,
              description: String(h['d'] ?? ''),
              road: String(h['r'] ?? ''),
            },
          ];
        }),
      };
    } catch {
      loaded = { builtAt: 0, coverage: [], sources: [], hazards: [] };
    }
  })();
  await loading;
}

export function hazards(): readonly Hazard[] {
  return loaded?.hazards ?? [];
}

export function hazardSources(): readonly HazardSource[] {
  return loaded?.sources ?? [];
}

/** Milliseconds since the data was built, or null when nothing has loaded. */
export function hazardAgeMs(now = Date.now()): number | null {
  if (loaded === null || loaded.builtAt === 0) return null;
  return Math.max(0, now - loaded.builtAt);
}

export function hazardsStale(now = Date.now()): boolean {
  const age = hazardAgeMs(now);
  return age === null || age > STALE_AFTER_MS;
}

/**
 * WHICH KIND OF EMPTY THIS IS.
 *
 * `covered` means the layer has a feed for this place and found nothing here.
 * `uncovered` means no feed exists for it at all, and the map being blank says
 * precisely nothing about the road. The caller must render these differently.
 */
export type Coverage = 'covered' | 'uncovered' | 'unknown';

/**
 * Whether this position is inside a state the layer covers.
 *
 * Bounding boxes rather than polygons on purpose: this decides which SENTENCE
 * to print, not what to draw, and a driver near a state line being told
 * "covered" when they are a mile outside it is a far smaller error than
 * shipping county geometry to answer it precisely.
 */
const COVERED_BOXES: Readonly<Record<string, readonly [number, number, number, number]>> = {
  KS: [-102.06, 36.99, -94.58, 40.01],
  MO: [-95.78, 35.99, -89.09, 40.62],
};

export function coverageOf(lat: number | null, lon: number | null): Coverage {
  if (loaded === null) return 'unknown';
  if (lat === null || lon === null) return 'unknown';
  for (const state of loaded.coverage) {
    const box = COVERED_BOXES[state];
    if (box === undefined) continue;
    if (lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3]) return 'covered';
  }
  return 'uncovered';
}

/** The states the layer has a feed for, for the control to name them. */
export function hazardCoverage(): readonly string[] {
  return loaded?.coverage ?? [];
}

export function resetHazardsForTest(): void {
  loaded = null;
  loading = null;
}
