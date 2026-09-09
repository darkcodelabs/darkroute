/**
 * THE GAZETTEER - turning a camera's FIPS and GEOID into words.
 *
 * `scripts/fetch-cameras.mjs` writes a five-character county FIPS and a
 * seven-character place GEOID onto every camera, and the names once into
 * `counties.json` and `places.json`. That normalisation keeps 130,684 records
 * small; it also means the app holds identifiers it cannot yet read out loud.
 * This is the lookup.
 *
 * WHY IT IS LAZY AND CACHED
 *   Both files are small next to the tiles, but neither is needed to warn
 *   somebody about a camera - they are needed to NAME where it is. So nothing
 *   is fetched until a screen asks for a name, and once fetched it is held for
 *   the session. A driver who never opens a screen that names a place never
 *   pays for one.
 *
 * WHY A MISS IS A MISS
 *   26,289 cameras are in no place at all - most of the country's area is
 *   unincorporated - and 783 are in no county polygon. `null` is the honest
 *   answer for those, and callers must render the absence rather than
 *   substituting the nearest name. "Near Overland Park" and "in Overland Park"
 *   are different claims, and only one of them is in the data.
 *
 * WHY THE NAMES ARE BOUND TO THE CAMERA GENERATION
 *   Both files are published inside the same atomic generation as the tiles,
 *   and both are rewritten when the archive is: a county's camera count is in
 *   `counties.json`, and a renamed or re-FIPSed row is indistinguishable from
 *   the old one. This module used to fetch them once, unversioned, with no
 *   header check and no invalidation input at all - a module singleton that a
 *   mid-drive pointer change could never correct - so a driver could be warned
 *   about G2 cameras under G1 names for the rest of the session.
 *
 *   Now both files are read through `createGenerationBoundResource`: the same
 *   `?generation=` URL and exact-header check the tiles use, dropped the moment
 *   the working generation moves, and refused if the response lands after it
 *   has. See `sidecar.ts`.
 */

import { createGenerationBoundResource } from './sidecar.ts';

export interface GazetteerEntry {
  readonly id: string;
  readonly name: string;
  /** Pre-formatted for a strip: "JOHNSON CO, KS" or "OVERLAND PARK". */
  readonly label: string;
  readonly cameras: number;
}

export interface Gazetteer {
  county(fips: string | undefined): GazetteerEntry | null;
  place(geoid: string | undefined): GazetteerEntry | null;
  /** True once both files of the CURRENT generation are held. */
  ready(): boolean;
  /** The generation the held names belong to, or null when none are. */
  generation(): string | null;
}

export interface GazetteerOptions {
  readonly fetchImpl?: typeof fetch;
  readonly base?: string;
  /** The snapshot the names must describe. Defaults to the working tiles'. */
  readonly workingGeneration?: () => string | null;
}

interface Row {
  readonly fips?: string;
  readonly geoid?: string;
  readonly name?: string;
  readonly label?: string;
  readonly cameras?: number;
}

function index(rows: readonly Row[], key: 'fips' | 'geoid'): Map<string, GazetteerEntry> {
  const map = new Map<string, GazetteerEntry>();
  for (const row of rows) {
    const id = row[key];
    if (typeof id !== 'string' || id === '') continue;
    map.set(id, {
      id,
      name: row.name ?? '',
      label: row.label ?? row.name ?? '',
      cameras: row.cameras ?? 0,
    });
  }
  return map;
}

/** A body that is not a row list names nothing, and must not be admitted. */
function rowsOf(body: unknown, key: 'fips' | 'geoid'): Map<string, GazetteerEntry> {
  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) throw new Error('gazetteer: body has no rows');
  return index(rows as readonly Row[], key);
}

export function createGazetteer(options: GazetteerOptions = {}): Gazetteer {
  const shared = {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.workingGeneration === undefined
      ? {}
      : { workingGeneration: options.workingGeneration }),
  };

  const counties = createGenerationBoundResource({
    ...shared,
    path: 'counties.json',
    parse: (body) => rowsOf(body, 'fips'),
  });
  const places = createGenerationBoundResource({
    ...shared,
    path: 'places.json',
    parse: (body) => rowsOf(body, 'geoid'),
  });

  return {
    county(fips) {
      // `get()` starts the load and returns null until the CURRENT
      // generation's file is held, so a lookup during a transition is an
      // absence rather than the previous snapshot's name.
      const held = counties.get();
      if (held === null || fips === undefined) return null;
      return held.get(fips) ?? null;
    },
    place(geoid) {
      const held = places.get();
      if (held === null || geoid === undefined) return null;
      return held.get(geoid) ?? null;
    },
    ready() {
      return counties.ready() && places.ready();
    },
    generation() {
      // One generation or none: two files describing different snapshots is
      // exactly the mixture this binding exists to refuse.
      const held = counties.generation();
      return held !== null && held === places.generation() ? held : null;
    },
  };
}

/** The app's one gazetteer. Screens read names through this. */
export const gazetteer: Gazetteer = createGazetteer();
