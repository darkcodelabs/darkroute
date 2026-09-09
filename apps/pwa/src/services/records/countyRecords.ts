/**
 * COUNTY MISUSE RECORDS - what has been documented where you are driving.
 *
 * =============================================================================
 * WHAT THIS IS, AND THE BAR IT HAS TO CLEAR
 * =============================================================================
 * A strip at the top of RADAR that says `HAMILTON CO · 6 ON RECORD`. Every one
 * of those six is a published, citable incident of ALPR misuse by a named
 * agency in that county.
 *
 * This is the most dangerous data in the product and it is worth being explicit
 * about why. It makes a public allegation of misconduct about a real, named law
 * enforcement agency, and it shows it to drivers in that agency's jurisdiction.
 * Get it wrong and the product is defaming a sheriff.
 *
 * So the rules are absolute:
 *
 *   1. EVERY RECORD CARRIES A URL. No entry exists without a source a reader
 *      can open. `scripts/check-record-citations.mjs` fails the build if one
 *      is missing, which is the same gate the help answers already run under.
 *
 *   2. DEPLOYMENT IS NOT MISUSE. That an agency operates cameras is not a
 *      record. Most agencies in the camera data have no record at all, and the
 *      strip must be absent for them rather than showing a zero - a zero reads
 *      as "audited and clean", which is a claim nobody has made.
 *
 *   3. THE COUNT IS WHAT THE SOURCE SAYS. Not "several", not an estimate, not
 *      a sum of related things.
 *
 * =============================================================================
 * WHY ABSENCE IS NOT INNOCENCE, AND THE UI MUST SAY SO
 * =============================================================================
 * No record for a county means nothing has been DOCUMENTED AND PUBLISHED there.
 * ALPR misuse is discovered by audits, lawsuits and reporting, and most
 * jurisdictions have had none of those - California produces far more records
 * than other states because SB 34 obliges audits, not because California police
 * misuse cameras more.
 *
 * A driver must never read a missing strip as a clean bill of health. That is
 * why the strip renders only when there IS a record, and why the screen behind
 * it says what the absence means rather than printing a reassuring zero.
 *
 * =============================================================================
 * KEYED BY FIPS, NOT BY NAME
 * =============================================================================
 * There are 31 Washington Counties. The cameras already carry a five-character
 * county FIPS from `scripts/fetch-cameras.mjs`, and the gazetteer already turns
 * that into a label, so a record joins on the identifier and never on a string
 * that thirty other places share.
 */

export interface CountyMisuseRecord {
  /** Five-character county FIPS, the same key the cameras carry. */
  readonly fips: string;
  /** The agency the record concerns. Never an individual officer's name. */
  readonly agency: string;
  /** One sentence, in the source's own terms. */
  readonly summary: string;
  /** Distinct documented incidents this entry represents. */
  readonly incidents: number;
  readonly year: number;
  /** A URL a reader can open. Enforced by the citation check. */
  readonly sourceUrl: string;
  readonly sourceName: string;
}

export interface CountyMisuseSummary {
  readonly fips: string;
  /** Total documented incidents across every record for the county. */
  readonly incidents: number;
  readonly records: readonly CountyMisuseRecord[];
}

export interface CountyRecordsIndex {
  /**
   * A county's documented record, or null when nothing is on file.
   *
   * Null means UNDOCUMENTED, never CLEAN. See the header.
   */
  forCounty(fips: string | null | undefined): CountyMisuseSummary | null;
  /**
   * EVERY record on file, newest first.
   *
   * The county lookup answers "has the agency around me done this", which is
   * the question RADAR asks. The MISUSE feed asks the other one - "who has
   * done this, anywhere" - and that needs the whole file rather than one
   * bucket of it.
   *
   * Empty until the file has loaded, exactly like `forCounty` returning null:
   * an empty list reads as "nothing loaded yet", and the screen says which.
   */
  all(): readonly CountyMisuseRecord[];
  /**
   * WHEN THE FILE WAS BUILT, as the file itself states it, or null before it
   * has loaded.
   *
   * The screen claims "47 records - 68 documented incidents" and said nothing
   * about when that was true. A count with no date reads as current, which is a
   * claim the file cannot support: it is a hand-curated set refreshed by a
   * daily patrol, so the honest thing is to print the stamp and let the reader
   * judge it. Parsed from `counties.json`'s own `generatedAt`, never from the
   * clock or the fetch time.
   */
  generatedAt(): string | null;
  ready(): boolean;
}

export interface CountyRecordsOptions {
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
}

interface RawRecord {
  readonly fips?: unknown;
  readonly agency?: unknown;
  readonly summary?: unknown;
  readonly incidents?: unknown;
  readonly year?: unknown;
  readonly sourceUrl?: unknown;
  readonly sourceName?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * A raw row to a record, or null.
 *
 * Strict on purpose: a row missing its citation is DROPPED rather than shown
 * uncited. The build-time check should have caught it, and if something got
 * past that, the failure has to be silence rather than an unsourced accusation.
 */
export function parseRecord(raw: RawRecord): CountyMisuseRecord | null {
  const fips = text(raw.fips);
  const agency = text(raw.agency);
  const summary = text(raw.summary);
  const sourceUrl = text(raw.sourceUrl);
  const sourceName = text(raw.sourceName);
  if (fips === null || agency === null || summary === null) return null;
  if (sourceUrl === null || sourceName === null) return null;
  if (!/^https?:\/\//.test(sourceUrl)) return null;

  const incidents =
    typeof raw.incidents === 'number' && Number.isFinite(raw.incidents) && raw.incidents > 0
      ? Math.floor(raw.incidents)
      : 1;
  const year =
    typeof raw.year === 'number' && Number.isFinite(raw.year) ? Math.floor(raw.year) : 0;

  return { fips, agency, summary, incidents, year, sourceUrl, sourceName };
}

/** Shared and frozen: a screen that reads before the file loads allocates nothing. */
const NO_RECORDS: readonly CountyMisuseRecord[] = Object.freeze([]);

export function createCountyRecords(options: CountyRecordsOptions = {}): CountyRecordsIndex {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? '/records';

  let byFips: Map<string, CountyMisuseSummary> | null = null;
  /**
   * The flat list, newest first, built once alongside the county buckets.
   *
   * Sorted here rather than in the screen so every reader gets the same order,
   * and because the order is a property of the data: a documented-abuse feed
   * that is not newest-first is a feed nobody can tell has been updated.
   */
  let flat: readonly CountyMisuseRecord[] = NO_RECORDS;
  let builtAt: string | null = null;
  let loading: Promise<void> | null = null;

  const load = (): Promise<void> => {
    if (loading !== null) return loading;
    loading = (async (): Promise<void> => {
      const grouped = new Map<string, CountyMisuseRecord[]>();
      try {
        const res = await doFetch(`${base}/counties.json`);
        if (res.ok) {
          const body = (await res.json()) as { records?: RawRecord[]; generatedAt?: unknown };
          if (typeof body.generatedAt === 'string' && body.generatedAt.trim() !== '') {
            builtAt = body.generatedAt;
          }
          for (const raw of body.records ?? []) {
            const record = parseRecord(raw);
            if (record === null) continue;
            const held = grouped.get(record.fips);
            if (held === undefined) grouped.set(record.fips, [record]);
            else held.push(record);
          }
        }
      } catch {
        // An empty index reads as "nothing documented", which is the honest
        // answer when the file cannot be read - and is what the UI already
        // renders for the overwhelming majority of counties.
      }
      const summaries = new Map<string, CountyMisuseSummary>();
      for (const [fips, records] of grouped) {
        summaries.set(fips, {
          fips,
          incidents: records.reduce((sum, record) => sum + record.incidents, 0),
          records,
        });
      }
      byFips = summaries;
      flat = Object.freeze(
        [...grouped.values()].flat().sort((a, b) => {
          if (b.year !== a.year) return b.year - a.year;
          // Same year: the bigger documented count first. Ties fall back to the
          // agency name so the order is stable between loads rather than
          // whatever the file happened to list.
          if (b.incidents !== a.incidents) return b.incidents - a.incidents;
          return a.agency.localeCompare(b.agency);
        }),
      );
    })();
    return loading;
  };

  return {
    all() {
      if (byFips === null) void load();
      return flat;
    },

    generatedAt() {
      if (byFips === null) void load();
      return builtAt;
    },

    forCounty(fips) {
      if (byFips === null) {
        void load();
        return null;
      }
      if (fips === null || fips === undefined || fips === '') return null;
      return byFips.get(fips) ?? null;
    },
    ready() {
      return byFips !== null;
    },
  };
}

/** The app's one record index. */
export const countyRecords: CountyRecordsIndex = createCountyRecords();
