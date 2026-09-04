/**
 * THE CATALOGUE - how big the map is, as opposed to how much of it you have.
 *
 * `index.json` is written by `scripts/fetch-cameras.mjs` alongside the tiles and
 * records what the currently served R2 archive contains.
 *
 * WHY THE APP NEEDS THAT NUMBER AT ALL
 *   A device only ever holds the tiles near it, so the cached count is a few
 *   hundred. Shown alone it is unreadable: `979 CAMS` could mean the database
 *   has 979 cameras in it, or that this phone has 979 of a much larger set, and
 *   those are very different claims about how much the product knows.
 *
 *   `979 / 139,000` says both at once - what is on the device, out of what
 *   exists - and makes the sync visible without a second screen.
 *
 * WHY IT IS LAZY AND CACHED
 *   Nothing needs it to warn somebody about a camera. It is fetched the first
 *   time a screen asks and held for the session, the same arrangement the
 *   gazetteer uses for names.
 *
 * WHY A MISS IS NULL
 *   If the file cannot be read, the answer is "unknown", never a guess and
 *   never a stale constant compiled into the bundle. A hardcoded total would
 *   go quietly wrong the first time the tiles are rebuilt.
 *
 * WHY THE FETCH IS GUARDED
 *   ` - CAMS` was the visible half of a much larger failure: an expired
 *   Cloudflare Access session turns every request on this origin into a
 *   redirect, and the catch below rendered that as "unknown" exactly as it was
 *   built to. Unknown was true and useless. `guardedFetch` can tell that case
 *   from a dead zone, and something else puts a sign-in banner on screen.
 *   See services/access/session.ts.
 */

import { readCameraGeneration } from './generation.ts';
import { useCamerasStore } from '../../stores/cameras.ts';

export interface CameraCatalogue {
  /** Cameras in the whole published set, or null until it is known. */
  total(): number | null;
  /**
   * WHEN THE SERVED ARCHIVE WAS TRUE - the `upstream` field, ISO-8601, or null.
   *
   * =========================================================================
   * WHY THIS CANNOT BE A BUILD CONSTANT, THOUGH IT WAS ONE FOR AN HOUR
   * =========================================================================
   * It was stamped at build time from `public/cameras/index.json`, on the
   * reasoning that the archive ships inside the bundle so its age cannot change
   * without a new build. That reasoning was correct and is now false.
   *
   * The freshness patrol publishes a complete R2 generation and atomically
   * advances its pointer; it commits neither tiles nor a watermark to Git.
   * An hourly Git commit would mean ~720 Pages builds a month against a ceiling
   * of 500. `functions/cameras/[[path]].ts` resolves the pointer through the R2
   * binding at the same `/cameras/` path, so the DATA a driver is warned
   * against moves without the BUNDLE moving.
   *
   * Measured the hour that went live: the bundle said 132,068 cameras at
   * 2026-08-26T19:00Z and R2 said 132,470 at 2026-08-31T17:00Z. A build
   * constant would have told a driver their data was five days old while the
   * app served them something current - which is the exact failure the
   * freshness row exists to prevent, so it has to be read from what is served.
   */
  upstream(): string | null;
  /** The immutable R2 generation digest backing both values above. */
  generation(): string | null;
  ready(): boolean;
}

export interface CatalogueOptions {
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
  readonly workingGeneration?: () => string | null;
}

export function createCatalogue(options: CatalogueOptions = {}): CameraCatalogue {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? '/cameras';
  const workingGeneration =
    options.workingGeneration ?? (() => useCamerasStore.getState().generation);

  let total: number | null = null;
  let upstream: string | null = null;
  let generation: string | null = null;
  let loading: Promise<void> | null = null;
  let loadingGeneration: string | null = null;

  const load = (wanted: string): Promise<void> => {
    if (loading !== null && loadingGeneration === wanted) return loading;
    loadingGeneration = wanted;
    loading = (async (): Promise<void> => {
      try {
        const identity = await readCameraGeneration({
          fetchImpl: doFetch,
          base,
          cacheKey: `catalogue-${wanted}`,
        });
        // Bidirectional admission: a current index must not label an older
        // working tile set, and a late G1 response must not overwrite G2.
        if (identity.generation !== wanted || workingGeneration() !== wanted) return;
        total = identity.cameras;
        upstream = identity.upstream;
        generation = identity.generation;
      } catch {
        // A count is a nicety; failing to read one must never take a screen
        // down. `null` reads as "unknown", which callers already render.
      } finally {
        if (loadingGeneration === wanted) {
          loading = null;
          loadingGeneration = null;
        }
      }
    })();
    return loading;
  };

  const prepare = (): string | null => {
    const wanted = workingGeneration();
    if (wanted === null) return null;
    if (generation !== null && generation !== wanted) {
      total = null;
      upstream = null;
      generation = null;
    }
    if (generation !== wanted) void load(wanted);
    return wanted;
  };

  return {
    total() {
      if (prepare() === null) return null;
      return total;
    },
    upstream() {
      if (prepare() === null) return null;
      return upstream;
    },
    generation() {
      if (prepare() === null) return null;
      return generation;
    },
    ready() {
      const wanted = prepare();
      return wanted !== null && generation === wanted && total !== null;
    },
  };
}

/** The app's one catalogue. */
export const catalogue: CameraCatalogue = createCatalogue();
