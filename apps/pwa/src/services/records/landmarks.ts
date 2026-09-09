/**
 * WHAT A CAMERA IS NEXT TO, READ ON THE DEVICE.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * "METCALF AVE" repeated six times down a list is not a location. A driver
 * looking at nine cameras on one corridor cannot tell which is which, and the
 * street is the only distinguishing field the archive carries.
 *
 * A landmark is the field a person would actually use: the reader by the
 * supermarket, not the third one on Metcalf.
 *
 * =============================================================================
 * IT IS REFERENCE DATA, NOT CAMERA DATA
 * =============================================================================
 * Served from `/records/`, beside `county-index.json`, for the same reason:
 * it is derived, it can be rebuilt without disturbing the camera archive, and
 * it is not part of the provenance chain that makes the archive trustworthy.
 * See `scripts/build-landmarks.mjs`.
 *
 * NOTHING LEAVES THE DEVICE. It is a static file and the lookup is a map read.
 * No position, no camera id, no query is ever sent to resolve a landmark.
 *
 * =============================================================================
 * IT IS ALLOWED TO BE ABSENT
 * =============================================================================
 * Coverage is partial by construction - most cameras are not near anything with
 * a name on it - and the file itself may not have loaded yet, or at all on a
 * device that has never had signal. Every caller therefore gets `null` and must
 * render nothing rather than a placeholder. A chip reading "unknown" would take
 * the space of a real fact to say the archive has none.
 */

/** The file, on the same route as the other derived reference data. */
const INDEX_URL = '/records/landmarks.json';

/** The schema this reader understands. A different tag is refused, not guessed. */
const SCHEMA = 'darkroute-landmarks/v1';
/** The dictionary encoding. See `parse` for why v1 could not ship. */
const SCHEMA_V2 = 'darkroute-landmarks/v2';

export interface Landmark {
  /** What the place is called. Brand where OSM has one, else its name. */
  readonly name: string;
  /** How far the camera is from it, in metres. */
  readonly metres: number;
  /** Wikidata id for the brand, when recorded. Lets a chain group exactly. */
  readonly brandId: string | null;
}

interface Payload {
  readonly schema?: unknown;
  readonly landmarks?: unknown;
  readonly names?: unknown;
  readonly attribution?: unknown;
  readonly radiusM?: unknown;
}

let table: Map<string, Landmark> | null = null;
let loading: Promise<void> | null = null;
let attribution = 'Map data © OpenStreetMap contributors';

/**
 * THE NAME TABLE, in v2.
 *
 * v1 wrote the landmark's name into every record. This index is mostly chains,
 * so that meant storing "Walmart" thousands of times and every other brand
 * likewise - 2.78 MB against a 1.6 MB ceiling, which the builder correctly
 * refused to ship. v2 stores each distinct name once and points at it by index.
 *
 * The brand id lives here too, because it is a property of the BRAND: every
 * Walmart shares one wikidata id, so repeating it per camera repeated the same
 * mistake one column over.
 */
function readNames(raw: unknown): { name: string; brandId: string | null }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; brandId: string | null }[] = [];
  for (const entry of raw as readonly unknown[]) {
    if (!Array.isArray(entry)) {
      out.push({ name: '', brandId: null });
      continue;
    }
    const [name, brandId] = entry as [unknown, unknown];
    out.push({
      name: typeof name === 'string' ? name : '',
      brandId: typeof brandId === 'string' && brandId !== '' ? brandId : null,
    });
  }
  return out;
}

function parse(payload: Payload): Map<string, Landmark> {
  const out = new Map<string, Landmark>();
  /*
   * BOTH SCHEMAS. A phone holding a cached v1 file is not wrong, and refusing
   * it would blank the landmark chip until the new one downloaded - a
   * regression for the sake of tidiness.
   */
  const v2 = payload.schema === SCHEMA_V2;
  if (!v2 && payload.schema !== SCHEMA) return out;
  if (typeof payload.attribution === 'string' && payload.attribution !== '') {
    attribution = payload.attribution;
  }
  const raw = payload.landmarks;
  if (typeof raw !== 'object' || raw === null) return out;

  const names = v2 ? readNames(payload.names) : [];

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;

    if (v2) {
      const [index, metres] = value as [unknown, unknown];
      if (typeof index !== 'number' || !Number.isInteger(index)) continue;
      if (typeof metres !== 'number' || !Number.isFinite(metres)) continue;
      const entry = names[index];
      // A record pointing outside the table is a corrupt file, not a camera
      // with no landmark - drop the record rather than invent a blank name.
      if (entry === undefined || entry.name === '') continue;
      out.set(id, { name: entry.name, metres, brandId: entry.brandId });
      continue;
    }

    const [name, metres, brandId] = value as [unknown, unknown, unknown];
    if (typeof name !== 'string' || name === '') continue;
    if (typeof metres !== 'number' || !Number.isFinite(metres)) continue;
    out.set(id, {
      name,
      metres,
      brandId: typeof brandId === 'string' && brandId !== '' ? brandId : null,
    });
  }
  return out;
}

/**
 * Load the index once.
 *
 * FAILURE IS A SILENT EMPTY TABLE, on purpose. This file is a convenience; a
 * device with no signal, or one where it 404s because no landmark run has
 * happened yet, must keep every warning it has. Turning a missing nicety into
 * a visible error would train drivers to ignore errors.
 */
export async function loadLandmarks(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (table !== null) return;
  loading ??= (async () => {
    try {
      const response = await fetchImpl(INDEX_URL, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        table = new Map();
        return;
      }
      table = parse((await response.json()) as Payload);
    } catch {
      table = new Map();
    }
  })();
  await loading;
}

/** The landmark for one camera, or null. Never throws, never fetches. */
export function landmarkFor(id: string | undefined): Landmark | null {
  if (id === undefined || table === null) return null;
  return table.get(id) ?? null;
}

/** Whether the index has been read at all. Used to decide when to re-render. */
export function landmarksReady(): boolean {
  return table !== null;
}

/** The credit that must appear wherever a landmark is shown. ODbL obliges it. */
export function landmarkAttribution(): string {
  return attribution;
}

/**
 * WHICH OF THESE CAMERAS MAY SHOW THEIR LANDMARK.
 *
 * =============================================================================
 * THE FAILURE THIS PREVENTS
 * =============================================================================
 * Six cameras ring one big-box store. Tagging each of them NEAR HOME DEPOT is
 * strictly true and completely useless: the driver set out to tell nine
 * cameras apart and now has six that say the same thing, which is exactly the
 * problem the landmark was added to fix, with a different word in it.
 *
 * Worse than useless, actually - it is misleading. A person reading "near Home
 * Depot" on a warning reasonably concludes there is ONE reader there.
 *
 * So a landmark is shown only when it is UNIQUE among the cameras currently on
 * screen. Where several share one, none of them shows it and the street stands
 * alone, which is the honest answer: this landmark does not distinguish these
 * cameras.
 *
 * Scoped to what is visible rather than to the whole archive, because that is
 * the set the driver is actually comparing.
 */
export function distinctLandmarks(
  ids: readonly (string | undefined)[],
): Map<string, Landmark> {
  const seen = new Map<string, string[]>();
  for (const id of ids) {
    const landmark = landmarkFor(id);
    if (landmark === null || id === undefined) continue;
    const key = landmark.brandId ?? landmark.name.toLowerCase();
    const bucket = seen.get(key);
    if (bucket === undefined) seen.set(key, [id]);
    else bucket.push(id);
  }

  const out = new Map<string, Landmark>();
  for (const owners of seen.values()) {
    if (owners.length !== 1) continue;
    const id = owners[0];
    if (id === undefined) continue;
    const landmark = landmarkFor(id);
    if (landmark !== null) out.set(id, landmark);
  }
  return out;
}

/** Test seam. Nothing in the app calls this. */
export function resetLandmarksForTest(): void {
  table = null;
  loading = null;
}
