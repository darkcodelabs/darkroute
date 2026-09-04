/**
 * ONE LOADER FOR EVERY FILE THAT DESCRIBES THE ARCHIVE.
 *
 * =============================================================================
 * THE BUG THIS EXISTS FOR
 * =============================================================================
 * `overview.json`, `counties.json` and `places.json` were fetched with a bare
 * `fetch('/cameras/<file>')`: no generation query, no header check, and - for
 * the gazetteer - a module-level singleton with no invalidation input at all,
 * so a pointer change mid-drive could never be corrected. A generation
 * transition therefore left the map overview, the POI export and every county
 * and place name describing a DIFFERENT snapshot than the warnings the driver
 * was being given, with nothing on screen to say so.
 *
 * The tiles already had the protocol (`sync.ts::loadTile`) and the catalogue
 * already had the caching shape (`catalogue.ts`). This is that shape, written
 * once, so a fourth reader cannot drift into a fourth protocol.
 *
 * =============================================================================
 * WHAT "BOUND TO THE GENERATION" MEANS HERE
 * =============================================================================
 *   - the URL carries `?generation=<G>`, so the service worker's cache entry
 *     for G is a different entry from the one for G-1 and a pointer change can
 *     never be answered out of the old body;
 *   - the response header must equal G exactly (`fetchGenerationBound`);
 *   - the value is admitted ONLY if the working generation is still G when the
 *     response lands. A slow G1 response that arrives after the store has
 *     reached G2 is dropped, not merged - the late-response race;
 *   - reaching a new generation drops the old value immediately, so a reader
 *     sees "unknown" rather than the previous snapshot's answer while the new
 *     one loads. The absence is honest; the stale name is not.
 *
 * =============================================================================
 * WHY A FAILURE IS "UNKNOWN" AND NEVER FATAL
 * =============================================================================
 * Nothing here is needed to warn somebody about a camera - these files name
 * places and draw a zoomed-out overview. So a failed read resolves to `null`,
 * which every caller already renders as an absence, and the tile path is
 * untouched. That is deliberately the opposite of `loadTile`, which throws:
 * a tile that failed must never be cached as "no cameras here", whereas a
 * county whose name failed to load is simply an unnamed county.
 *
 * WIRE COMPATIBILITY. When there is no working generation at all - the app has
 * not reached the pointer yet, or the origin serves `/cameras/` without the
 * identity header - nothing is fetched and every read is `null`. That is the
 * same state the warning tiles are in on such an origin (`sync.ts` fetches no
 * tiles without an identity), so the screens agree instead of the overview
 * showing a hundred thousand dots over a map with no warnings behind it.
 */

import { useCamerasStore } from '../../stores/cameras.ts';
import { fetchGenerationBound } from './generation.ts';
import type { CameraSidecar } from './generation.ts';

/** Where the generation's files are served from. Same-origin, always. */
export const SIDECAR_BASE = '/cameras';

/**
 * How long a sidecar whose load FAILED is left alone before another attempt.
 *
 * These resources are read from render bodies on the driving screen, so with no
 * cooldown a single 503 or an offline miss turns into a fresh request for every
 * one of them on every render -- about 1.7 MB of counties and places, measured
 * at 20 fetches across 10 render passes. Thirty seconds is long enough that a
 * render loop cannot make a request storm and short enough that a driver coming
 * back into signal, or a pointer transition finishing, gets names again within
 * one block of driving.
 */
export const SIDECAR_RETRY_COOLDOWN_MS = 30_000;

export interface GenerationBoundResource<T> {
  /**
   * The value for the CURRENT working generation, or null when it is not known
   * yet, could not be read, or belongs to a generation that has since moved.
   *
   * Reading it starts the load. Callers are render paths, so this never awaits.
   */
  get(): T | null;
  /** The generation `get()`'s value belongs to, or null when there is none. */
  generation(): string | null;
  /** True once a value for the current working generation is held. */
  ready(): boolean;
  /** Await the load in flight, for a caller that can wait. Never rejects. */
  settled(): Promise<T | null>;
}

export interface GenerationBoundResourceOptions<T> {
  /** The file inside the generation, e.g. `counties.json`. */
  readonly path: CameraSidecar;
  /** Turn the parsed body into the value, or throw to refuse it. */
  readonly parse: (body: unknown) => T;
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
  readonly workingGeneration?: () => string | null;
  /** Injectable clock, so the retry cooldown is testable without waiting. */
  readonly now?: () => number;
}

export function createGenerationBoundResource<T>(
  options: GenerationBoundResourceOptions<T>,
): GenerationBoundResource<T> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? SIDECAR_BASE;
  const workingGeneration =
    options.workingGeneration ?? (() => useCamerasStore.getState().generation);
  const now = options.now ?? Date.now;

  let value: T | null = null;
  let generation: string | null = null;
  let loading: Promise<void> | null = null;
  let loadingGeneration: string | null = null;
  /**
   * The generation whose load already failed, and when to allow another try.
   *
   * =========================================================================
   * WITHOUT THIS, A FAILED SIDECAR REFETCHES ON EVERY RENDER
   * =========================================================================
   * `get()` calls `prepare()`, and these resources are read from RENDER BODIES
   * on the driving screen -- `ZoneCard`, `ZoneCaption`, `RadarScreen`,
   * `MisuseScreen`, `IntelScreen` all call `gazetteer.county()`/`place()` while
   * rendering. A failure left `generation` null and cleared `loading` in the
   * `finally`, so the very next render started the whole load again.
   *
   * Measured against a 503 -- the exact answer `functions/cameras/[[path]].ts`
   * gives for a damaged generation, and the shape of an offline miss: 20
   * fetches across 10 render passes, where the module this replaced did 2 in
   * the life of a session. counties.json is 370 KB and places.json 1.36 MB, so
   * that is about 1.7 MB re-requested per render, on a phone, while driving.
   *
   * A cooldown rather than a permanent cache of the failure: the file may be
   * missing because the pointer is mid-transition, and a driver who comes back
   * into signal should get county names again without restarting the app.
   */
  let failedGeneration: string | null = null;
  let retryAfterMs = 0;

  const load = (wanted: string): Promise<void> => {
    if (loading !== null && loadingGeneration === wanted) return loading;
    // A generation whose load just failed is not retried until the cooldown
    // passes. Returning a resolved promise keeps `settled()` honest: the
    // question "is there anything more to wait for" is answered no.
    if (failedGeneration === wanted && now() < retryAfterMs) return Promise.resolve();
    loadingGeneration = wanted;
    loading = (async (): Promise<void> => {
      try {
        const body = await fetchGenerationBound({
          fetchImpl: doFetch,
          base,
          path: options.path,
          generation: wanted,
        });
        // THE LATE-RESPONSE RACE, closed. `fetchGenerationBound` has already
        // proved the BYTES are G; this proves the app still wants G. Without
        // it a slow G1 read landing after the store reached G2 would install
        // G1 names beside G2 warnings, which is the defect in the other
        // direction from the one the header check catches.
        if (workingGeneration() !== wanted) return;
        value = options.parse(body);
        generation = wanted;
        // A success clears the cooldown: the generation is readable again.
        failedGeneration = null;
        retryAfterMs = 0;
      } catch {
        // Unknown, never a guess and never the previous generation's answer.
        // Recorded so the next render does not re-request 1.7 MB immediately;
        // see `failedGeneration` above.
        failedGeneration = wanted;
        retryAfterMs = now() + SIDECAR_RETRY_COOLDOWN_MS;
      } finally {
        if (loadingGeneration === wanted) {
          loading = null;
          loadingGeneration = null;
        }
      }
    })();
    return loading;
  };

  /** Drop a superseded value, start the load for the current generation. */
  const prepare = (): string | null => {
    const wanted = workingGeneration();
    if (wanted === null) {
      // No identity means no admitted bytes. Anything held describes a
      // generation this app is no longer working in.
      value = null;
      generation = null;
      return null;
    }
    if (generation !== null && generation !== wanted) {
      value = null;
      generation = null;
    }
    if (generation !== wanted) void load(wanted);
    return wanted;
  };

  const current = (): T | null => {
    const wanted = prepare();
    return wanted !== null && generation === wanted ? value : null;
  };

  return {
    get: current,
    generation() {
      const wanted = prepare();
      return generation === wanted ? generation : null;
    },
    ready() {
      const wanted = prepare();
      return wanted !== null && generation === wanted;
    },
    async settled() {
      const wanted = prepare();
      if (wanted === null) return null;
      await loading;
      return current();
    },
  };
}
