/**
 * THE EFF ATLAS OF SURVEILLANCE, COUNTY-SCOPED - who around you is RECORDED AS
 * OPERATING ALPR, which is not the same claim as anything in `countyRecords.ts`.
 *
 * =============================================================================
 * WHY THIS IS A SEPARATE SERVICE AND NOT A FIELD ON THE MISUSE RECORD
 * =============================================================================
 * `countyRecords.ts` holds allegations. Every entry says a named agency did a
 * specific thing and carries a URL a reader can open, and the build fails if one
 * loses its citation, because an entry without a source is not a record - it is
 * an accusation about a real police department shown to drivers in that
 * department's jurisdiction.
 *
 * An Atlas row is not that. It says "this agency is recorded as operating this
 * technology", assembled from procurement records, council minutes and FOIA. It
 * accuses nobody of anything. 3,574 agencies appear in the ALPR set and the
 * overwhelming majority of them have never been accused of misusing it.
 *
 * If those two ever share a list, a card shape or a sentence, this product has
 * published 3,574 accusations it cannot support. Hence: separate file, separate
 * fetch, separate block on the screen, separate wording. The screen is obliged
 * to keep them apart and the wording in `MisuseScreen.tsx` says which is which.
 *
 * =============================================================================
 * THREE ABSENCES THAT MUST NEVER RENDER THE SAME
 * =============================================================================
 * This is the same discipline `hazards.ts` runs under, with one more state:
 *
 *   'recorded'  the Atlas has rows for this county
 *   'none'      the Atlas has been read and has NO row for this county
 *   'unknown'   nothing has loaded yet, or there is no county to ask about
 *
 * 'none' is the dangerous one, and the UI is required to say what it means: the
 * Atlas is compiled from public records, it is not a census, and an agency
 * missing from it may operate cameras anyway. A bare "0" would read as "audited
 * and clean", which is a claim nobody has made - the same mistake the misuse
 * strip is built to avoid, in a different layer.
 *
 * =============================================================================
 * THE VENDOR LIST IS PARTIAL AND SAYS SO
 * =============================================================================
 * 27.5% of the ALPR rows leave the vendor column blank. `vendorKnown` is how
 * many of a county's rows named one, and it exists so the UI can print "vendor
 * recorded for 25 of 26" rather than a list that reads as complete. A partial
 * list presented as whole is the same failure as a confident wrong value.
 *
 * =============================================================================
 * FRESHNESS IS RETRIEVAL, NOT VINTAGE
 * =============================================================================
 * `fetchedAt` is when the bytes were downloaded from EFF. It is NOT the date the
 * Atlas compiled its records - the CSV publishes no such date, and the only
 * date-shaped thing on the response is a filename that moves with the request.
 * The screen therefore says "retrieved", and `scripts/build-atlas-counties.mjs`
 * explains at length why it may not say "as of".
 */

/* NO MODULE-LEVEL URL. The fetch below builds its path from the `base` the
   caller hands in, the same way every other record store does, so a generation-
   bound base reaches this file too. An absolute '/records/atlas-counties.json'
   sat here for one commit and was never read - it would have pinned this store
   to the unversioned path while everything around it followed the generation. */
const SCHEMA = 'darkroute-atlas-counties/v1';
export const ATLAS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** What the Atlas has to say about one county. */
export interface AtlasCounty {
  readonly fips: string;
  /**
   * Atlas rows for this county. One row is one recorded deployment of ALPR by
   * one agency; it is NOT a camera count and must never be rendered as one.
   */
  readonly deployments: number;
  /** The agencies named, alphabetical. Never an individual officer. */
  readonly agencies: readonly string[];
  /** Vendors named, deduplicated across the county. Partial - see `vendorKnown`. */
  readonly vendors: readonly string[];
  /** How many of `deployments` rows named a vendor at all. */
  readonly vendorKnown: number;
}

/** Which kind of answer the caller is holding. See the header. */
export type AtlasCoverage = 'recorded' | 'none' | 'unknown';

/** The credit line, carried in the file so the app hard-codes no claim about it. */
export interface AtlasSource {
  readonly name: string;
  readonly home: string;
  readonly attribution: string;
  /**
   * WHAT WAS OBSERVED, and whether anybody confirmed it.
   *
   * `confirmed` is false and is expected to stay false: eff.org/copyright states
   * CC BY 4.0 in prose and CC BY 3.0 US in the rel="license" badge in the same
   * paragraph. The UI may print the observation; it may not print a version.
   */
  readonly licenceObserved: string;
  readonly licenceConfirmed: boolean;
  readonly licenceUrl: string;
}

export interface AtlasTotals {
  readonly alprRows: number;
  readonly placed: number;
  readonly unplaced: number;
  readonly counties: number;
  readonly agencies: number;
}

export interface AtlasIndex {
  /** The county's Atlas entry, or null when it has none or nothing has loaded. */
  forCounty(fips: string | null | undefined): AtlasCounty | null;
  /** Which of the three absences this is. The UI must branch on it. */
  coverageOf(fips: string | null | undefined): AtlasCoverage;
  /** When the bytes were downloaded from EFF. Never a compilation date. */
  fetchedAt(): string | null;
  /** Last upstream source check carried by the published snapshot. */
  checkedAt(): string | null;
  totals(): AtlasTotals | null;
  source(): AtlasSource | null;
  ready(): boolean;
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  refreshIfStale(): Promise<void>;
}

export interface AtlasOptions {
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * A raw county entry to an `AtlasCounty`, or null.
 *
 * Strict in the same way `parseRecord` is strict: an entry claiming deployments
 * but naming no agency is DROPPED rather than rendered as a bare number. The
 * number on its own is the part a reader cannot check, and this layer's whole
 * value is that every count is a list of named agencies somebody can look up.
 */
export function parseAtlasCounty(fips: string, raw: unknown): AtlasCounty | null {
  if (!isRecord(raw)) return null;
  const deployments = count(raw['n']);
  if (deployments === 0) return null;
  const agencies = strings(raw['agencies']);
  if (agencies.length === 0) return null;
  return {
    fips,
    deployments,
    agencies,
    vendors: strings(raw['vendors']),
    // Clamped: a file claiming more vendor-bearing rows than rows would make the
    // UI print "vendor recorded for 9 of 7", which reads as a bug and is one.
    vendorKnown: Math.min(count(raw['vendorKnown']), deployments),
  };
}

export function createAtlasCounties(options: AtlasOptions = {}): AtlasIndex {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? '/records';

  let byFips: Map<string, AtlasCounty> | null = null;
  let retrievedAt: string | null = null;
  let sourceCheckedAt: string | null = null;
  let counts: AtlasTotals | null = null;
  let credit: AtlasSource | null = null;
  let loading: Promise<void> | null = null;
  let lastAttemptAt: number | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  const load = (): Promise<void> => {
    if (loading !== null) return loading;
    lastAttemptAt = Date.now();
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => { controller.abort(); }, 15_000);
    loading = (async (): Promise<void> => {
      const parsed = new Map<string, AtlasCounty>();
      try {
        const res = await doFetch(`${base}/atlas-counties.json`, {
          headers: { accept: 'application/json' },
          credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache',
          signal: controller.signal,
        });
        if (res.ok) {
          const body: unknown = await res.json();
          /*
           * A file whose schema tag is not ours is treated as no file at all.
           * The alternative is reading a v2 layout with v1 assumptions and
           * publishing whatever that produces about named police departments.
           */
          if (isRecord(body) && body['schema'] === SCHEMA) {
            const rows = isRecord(body['counties']) ? body['counties'] : {};
            for (const [fips, raw] of Object.entries(rows)) {
              const county = parseAtlasCounty(fips, raw);
              if (county !== null) parsed.set(fips, county);
            }
            if (parsed.size === 0) throw new Error('Atlas snapshot is empty');
            const stamp = body['fetchedAt'];
            if (typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) {
              throw new Error('Atlas retrieval date is missing');
            }
            retrievedAt = stamp;
            const checked = body['checkedAt'];
            sourceCheckedAt = typeof checked === 'string' && Number.isFinite(Date.parse(checked)) ? checked : null;
            const totals = isRecord(body['totals']) ? body['totals'] : {};
            counts = {
              alprRows: count(totals['alprRows']),
              placed: count(totals['placed']),
              unplaced: count(totals['unplaced']),
              counties: count(totals['counties']),
              agencies: count(totals['agencies']),
            };
            const source = isRecord(body['source']) ? body['source'] : {};
            const licence = isRecord(source['licence']) ? source['licence'] : {};
            credit = {
              name: String(source['name'] ?? ''),
              home: String(source['home'] ?? ''),
              attribution: String(source['attribution'] ?? ''),
              licenceObserved: String(licence['observed'] ?? ''),
              licenceConfirmed: licence['confirmed'] === true,
              licenceUrl: String(licence['url'] ?? ''),
            };
            byFips = parsed;
          }
        }
      } catch {
        /*
         * An unreadable file leaves `byFips` empty, and an empty index answers
         * 'none' for every county - which is WRONG, so it does not. `ready()`
         * stays true but the screen is told the difference by `coverageOf`
         * returning 'unknown' whenever nothing parsed at all. A failed fetch
         * must not be rendered as "the Atlas records nothing here".
         */
      }
      // A failed refresh keeps the last usable snapshot and its original dates.
      byFips ??= new Map();
    })().finally(() => {
      globalThis.clearTimeout(timer);
      loading = null;
      revision += 1;
      for (const listener of listeners) listener();
    });
    return loading;
  };

  const answerFor = (fips: string | null | undefined): AtlasCounty | null => {
    if (byFips === null) {
      void load();
      return null;
    }
    if (fips === null || fips === undefined || fips === '') return null;
    return byFips.get(fips) ?? null;
  };

  return {
    forCounty: answerFor,

    coverageOf(fips) {
      if (byFips === null) {
        void load();
        return 'unknown';
      }
      /*
       * AN EMPTY INDEX IS NOT AN EMPTY ATLAS. The file failed to load, or its
       * schema was not ours. Either way nobody has read the Atlas, and saying
       * "no deployment recorded" would be a claim about American policing made
       * on the strength of a 404.
       */
      if (byFips.size === 0) return 'unknown';
      if (fips === null || fips === undefined || fips === '') return 'unknown';
      return byFips.has(fips) ? 'recorded' : 'none';
    },

    fetchedAt() {
      if (byFips === null) void load();
      return retrievedAt;
    },

    checkedAt() {
      if (byFips === null) void load();
      return sourceCheckedAt;
    },

    totals() {
      if (byFips === null) void load();
      return counts;
    },

    source() {
      if (byFips === null) void load();
      return credit;
    },

    ready() {
      return byFips !== null;
    },

    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh: load,
    refreshIfStale() {
      if (loading !== null) return loading;
      if (lastAttemptAt !== null && Date.now() - lastAttemptAt < ATLAS_REFRESH_INTERVAL_MS) {
        return Promise.resolve();
      }
      return load();
    },
  };
}

/** The app's one Atlas index. */
export const atlasCounties: AtlasIndex = createAtlasCounties();
