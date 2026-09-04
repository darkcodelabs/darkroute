/**
 * CAMERA TILES, SERVED FROM R2 RATHER THAN FROM THE DEPLOY.
 *
 * =============================================================================
 * THE PROBLEM THIS SOLVES, WHICH IS A BILLING ONE BEFORE IT IS ANYTHING ELSE
 * =============================================================================
 * The freshness patrol commits its tiles to the repo, and a push to `main`
 * triggers a Cloudflare Pages build. Hourly, that is ~720 builds a month
 * against a free-tier ceiling of 500 - so the schedule that keeps the data
 * current cannot run for a whole month without stopping the deploys that
 * publish it. Anything FASTER than hourly is arithmetic that gets worse.
 *
 * The data does not belong in the artefact. A camera tile is not code, it
 * changes on its own schedule, and coupling it to a bundle rebuild means the
 * whole app is redeployed to move eleven cameras.
 *
 * =============================================================================
 * WHY A FUNCTION AND NOT JUST POINTING THE APP AT tiles.darkroute.ai
 * =============================================================================
 * That would have been one line - `TILE_BASE` is a constant - and it would
 * have cost the thing this product sells.
 *
 * Every tile request stays SAME-ORIGIN. On the public production host that does
 * not make the request anonymous to DarkRoute's own edge, but it prevents a
 * separate tile operator from learning the driver's rough position - the 15 km
 * square encoded by the tile id - on every drive.
 *
 * Reading through a Function keeps the request same-origin, keeps the service
 * worker's `/cameras/` route matching, and needs NO app change at all -
 * `TILE_BASE` stays `/cameras`. The bucket is reached over an R2 binding, so the
 * tile bytes never cross the public internet on their way here either.
 *
 * =============================================================================
 * WHAT A MISS MEANS
 * =============================================================================
 * 404 for a square with no ALPR in it, which `services/cameras/sync.ts` reads
 * as "no cameras here" rather than as an error. That is the normal answer for
 * most of the country and it must stay cheap and quiet.
 */

interface Env {
  /** R2 bucket holding the published tile archive. Bound in the Pages project. */
  readonly CAMERA_TILES?: R2Bucket;
}

/**
 * Immutable for an hour, then revalidate.
 *
 * The selected generation can change once an hour, so a logical tile URL cannot
 * be cached forever. The archive is
 * ~8,600 files that a driver pulls a handful of. An hour at the edge with
 * `must-revalidate` after means a second driver in the same square costs
 * nothing and a rebuilt tile is picked up on the next drive rather than the
 * next week.
 *
 * The SERVICE WORKER caches these too, for a week, and that is deliberate and
 * separate: the edge cache is about cost, the worker cache is about a driver
 * with no signal.
 */
const CACHE_CONTROL = 'public, max-age=3600, must-revalidate';

/**
 * The only mutable object a reader consults.
 *
 * Camera generations are uploaded beneath an inactive slot before this small
 * pointer is replaced. Reading it for every request is intentional: caching it
 * in the isolate could keep one worker on an older generation after cutover.
 */
const POINTER_KEY = '__camera/current.json';
const POINTER_SCHEMA = 'darkroute-camera-pointer/v1';
const SLOT = new Set(['a', 'b', 'c']);
const SHA256 = /^[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TILE_KEY = /^11\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.json$/;
const SIDECAR_KEYS = new Set([
  'index.json',
  'overview.json',
  'tombstones.json',
  'places.json',
  'counties.json',
  'continuity.json',
]);

interface CameraSnapshotRef {
  readonly slot: 'a' | 'b' | 'c';
  readonly generation: string;
  readonly manifestSha256: string;
}

interface CameraPointer extends CameraSnapshotRef {
  readonly schema: typeof POINTER_SCHEMA;
  readonly previous: CameraSnapshotRef | null;
  readonly updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isSnapshotRef(value: unknown): value is CameraSnapshotRef {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['slot', 'generation', 'manifestSha256']) &&
    typeof value['slot'] === 'string' &&
    SLOT.has(value['slot']) &&
    typeof value['generation'] === 'string' &&
    SHA256.test(value['generation']) &&
    typeof value['manifestSha256'] === 'string' &&
    SHA256.test(value['manifestSha256'])
  );
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return false;

  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isCameraPointer(value: unknown): value is CameraPointer {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schema',
      'slot',
      'generation',
      'manifestSha256',
      'previous',
      'updatedAt',
    ]) ||
    value['schema'] !== POINTER_SCHEMA ||
    !isSnapshotRef({
      slot: value['slot'],
      generation: value['generation'],
      manifestSha256: value['manifestSha256'],
    }) ||
    !isCanonicalInstant(value['updatedAt'])
  ) {
    return false;
  }

  const previous = value['previous'];
  return previous === null || (isSnapshotRef(previous) && previous.slot !== value['slot']);
}

/**
 * ABSENT AND BROKEN ARE DIFFERENT ANSWERS, and conflating them is what made the
 * flat fallback below look unsafe.
 *
 * `null` means no generation has ever been published - there is nothing to be
 * inconsistent WITH, so the flat root is simply the archive.
 *
 * A THROW means a pointer exists and cannot be trusted: unreadable, not JSON,
 * or the wrong shape. That is the case the original fail-closed rule was
 * written for, and it still fails closed. Reading the flat root there could
 * pair a new watermark with an old snapshot, which is the exact silent
 * combination this protocol exists to prevent.
 */
async function readPointer(bucket: R2Bucket): Promise<CameraPointer | null> {
  const object = await bucket.get(POINTER_KEY);
  if (object === null) return null;

  const value: unknown = JSON.parse(await object.text());
  if (!isCameraPointer(value)) throw new Error('invalid camera generation pointer');
  return value;
}

/**
 * THE FLAT-ROOT FALLBACK, and why a generation-only reader was not enough.
 *
 * =============================================================================
 * THE BUG THIS FIXES: THE DEPLOYED APP SERVES NO CAMERAS AT ALL
 * =============================================================================
 * This Function reads every tile through `__camera/current.json`. That pointer
 * is written by the first published generation, and no generation has ever been
 * published: a read-only inventory of the live bucket returns 8,821 objects at
 * the FLAT root, `pointer: none`, `versionsKnown: none`. So `readPointer` threw
 * on every request and every camera tile answered 503 - on the deployed build,
 * in production, right now.
 *
 * It is invisible to anyone who has used the app before, which is why it
 * survived: the client holds tiles in IndexedDB, so an existing device keeps
 * drawing the cameras it already had. A FRESH INSTALL gets nothing. That is the
 * silent-no-warning failure this codebase treats as its worst outcome, and it
 * was shipped.
 *
 * =============================================================================
 * WHY A SYNTHESISED GENERATION RATHER THAN NO HEADER
 * =============================================================================
 * The obvious fix - read the flat key and stamp nothing - breaks the client in
 * a different way. `services/cameras/generation.ts` requires
 * `x-darkroute-camera-generation` to be 64 hex and to equal what was asked for;
 * without it `readCameraGeneration` throws, no working generation exists, and
 * the sidecars refuse to load. The app would draw tiles and no county names.
 *
 * So flat mode synthesises a generation from the SHA-256 of `index.json`. That
 * is a real identity, not a placeholder: it is stable while the archive is
 * stable, it changes exactly when the archive changes, and it is 64 hex, so
 * every generation-keyed cache entry, header check and late-response race guard
 * on the client works unmodified.
 *
 * READ EVERY REQUEST, NOT MEMOISED. A per-isolate cache was the obvious
 * optimisation and it is wrong twice: an archive replaced under a warm isolate
 * would keep being served under the old id, and - worse - a bucket that LOST
 * its index would keep answering from a hash nothing backs any more, which is
 * the stale-data-presented-as-current failure the pointer protocol exists to
 * prevent. `index.json` is a few hundred bytes and this route already reads the
 * pointer on every request for exactly the same reason.
 *
 * THIS BRANCH DELETES ITSELF. The moment a generation IS published, the pointer
 * exists, `readPointer` succeeds, and nothing below ever runs again. It is a
 * bridge to the cutover, not a second permanent protocol.
 */
const FLAT_INDEX_KEY = 'index.json';

async function readFlatGeneration(bucket: R2Bucket): Promise<string> {
  const index = await bucket.get(FLAT_INDEX_KEY);
  if (index === null) throw new Error('flat camera root has no index.json');
  const digest = await crypto.subtle.digest('SHA-256', await index.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function unavailable(): Response {
  return new Response('camera archive unavailable', {
    status: 503,
    headers: { 'cache-control': 'no-store' },
  });
}

function isLogicalCameraKey(key: string): boolean {
  if (SIDECAR_KEYS.has(key)) return true;
  const tile = TILE_KEY.exec(key);
  return tile !== null && Number(tile[1]) < 2048 && Number(tile[2]) < 2048;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const bucket = context.env.CAMERA_TILES;

  /**
   * NO BINDING MEANS GET OUT OF THE WAY, and this is the most important line
   * in the file.
   *
   * A Pages Function SHADOWS the static asset at the same path. This route
   * first shipped returning 503 when the bucket was unbound -- which is what
   * every request looked like the moment it deployed, because the bucket did
   * not exist yet. The tiles were still sitting in `public/cameras/`, served
   * perfectly well, and this Function stood in front of them and refused.
   *
   * `context.next()` preserves compatibility with an older deploy that still
   * carried the static archive. Current builds deliberately remove
   * `dist/cameras`, so an unbound current deployment falls through to a normal
   * static miss rather than pretending stale data is available. Production
   * therefore requires the R2 binding; this branch only keeps rollback to an
   * older artefact from being shadowed by the Function.
   */
  if (bucket === undefined) return context.next();

  const url = new URL(context.request.url);
  // `/cameras/11/537/792.json` -> `11/537/792.json`. Taken from the URL rather
  // than from `params.path`, so a key can never be assembled out of a
  // caller-controlled array.
  const key = url.pathname.startsWith('/cameras/') ? url.pathname.slice('/cameras/'.length) : '';

  // NO TRAVERSAL, EVER. R2 keys are flat strings and `..` is a legal one, so
  // this is not about escaping a filesystem -- it is about refusing to fetch
  // an object outside the published set because somebody asked oddly.
  if (!isLogicalCameraKey(key)) {
    return new Response('bad tile', { status: 400 });
  }

  /*
   * A PUBLISHED GENERATION IS PREFERRED AND A FLAT ROOT IS ACCEPTED.
   *
   * This used to fail closed on any pointer problem, with the reasoning that
   * reading the former flat root "could silently combine a new watermark with
   * an old camera snapshot". That reasoning is kept for a BROKEN pointer, which
   * still 503s. It never applied to an ABSENT one: there is no pointer at all
   * in the live bucket, so failing closed protected no watermark - it served
   * 503 for every tile on every fresh install.
   *
   * The two cases stay separable rather than blended: a generation read is
   * slot-scoped and stamps the pointer's own id; a flat read is root-scoped and
   * stamps the archive's own hash. Nothing mixes a slot with a root, and the
   * moment a pointer exists this falls back to the generation path forever.
   */
  let pointer: CameraPointer | null;
  try {
    pointer = await readPointer(bucket);
  } catch {
    // A pointer that EXISTS and is broken still fails closed. Only its absence
    // opens the flat path. See `readPointer`.
    return unavailable();
  }

  let generation: string;
  let objectKey: string;
  if (pointer === null) {
    try {
      generation = await readFlatGeneration(bucket);
    } catch {
      // No pointer AND no flat index is a bucket with nothing publishable in
      // it. That IS an availability failure, and it is the only one left.
      return unavailable();
    }
    objectKey = key;
  } else {
    generation = pointer.generation;
    objectKey = `__camera/slots/${pointer.slot}/data/${key}`;
  }

  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(objectKey);
  } catch {
    return unavailable();
  }

  if (object === null) {
    // These files describe the archive itself. Serving a 404 for one would
    // turn a damaged generation into plausible-looking empty/stale catalogue
    // state, so a required sidecar miss is an availability failure.
    if (SIDECAR_KEYS.has(key)) return unavailable();

    // NOT `context.next()` here. A miss from a bound bucket is the answer --
    // a square with no ALPR in it -- and falling through would quietly re-read
    // the deployed copy, which is the stale thing this migration exists to
    // stop serving.
    // The normal answer for a rural square. Cached, because most of the
    // country is one and re-asking every drive is the expensive mistake.
    const headers = new Headers({ 'cache-control': CACHE_CONTROL });
    headers.set('x-darkroute-camera-generation', generation);
    return new Response('null', { status: 404, headers });
  }

  // Do not copy arbitrary object metadata into the HTTP response. The
  // publisher controls R2, but a poisoned Content-Disposition/CSP header would
  // still cross a trust boundary here. This allowlist is the whole response
  // metadata contract.
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': CACHE_CONTROL,
    etag: object.httpEtag,
    'x-darkroute-camera-generation': generation,
  });
  return new Response(object.body, { headers });
};
