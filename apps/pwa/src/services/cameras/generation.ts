/**
 * The public identity of one immutable camera generation.
 *
 * The Function resolves `/cameras/*` through one atomic R2 pointer and puts
 * this digest on every response.  Clients use the digest as a cache namespace;
 * a timestamp, ETag or camera count is not a snapshot identity.
 */

import { guardedFetch, isAccessBounce } from '../access/session.ts';

export const CAMERA_GENERATION_HEADER = 'x-darkroute-camera-generation';
export const CAMERA_GENERATION_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The files that describe the archive rather than one 15 km square.
 *
 * They are published, replaced and deleted with the tiles inside one atomic
 * generation, so they are read the same way the tiles are read. A gazetteer
 * name or an overview dot that came from a different generation than the
 * warnings is the same class of error as a tile from a different generation.
 */
export const CAMERA_SIDECARS = Object.freeze([
  'overview.json',
  'counties.json',
  'places.json',
] as const);

export type CameraSidecar = (typeof CAMERA_SIDECARS)[number];

export interface CameraGenerationIdentity {
  readonly generation: string;
  readonly cameras: number;
  readonly tiles: number;
  readonly upstream: string;
}

export interface ReadCameraGenerationOptions {
  readonly fetchImpl: typeof fetch;
  readonly base: string;
  /** A public time bucket. It defeats an older SW's cached, unversioned index. */
  readonly cacheKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the pointer-selected index and bind its body to the generation header.
 *
 * `cache: no-store` handles the browser HTTP cache. The query handles a worker
 * from the release before the dedicated NetworkFirst identity route existed.
 */
export async function readCameraGeneration(
  options: ReadCameraGenerationOptions,
): Promise<CameraGenerationIdentity> {
  const separator = options.base.includes('?') ? '&' : '?';
  const url = `${options.base}/index.json${separator}camera-generation=${encodeURIComponent(options.cacheKey)}`;
  const response = await options.fetchImpl(url, {
    redirect: 'manual',
    cache: 'no-store',
  });
  if (isAccessBounce(response)) throw new Error('camera generation: signed out');
  if (!response.ok) {
    throw new Error(`camera generation: HTTP ${String(response.status)}`);
  }

  const generation = response.headers.get(CAMERA_GENERATION_HEADER);
  if (generation === null || !CAMERA_GENERATION_PATTERN.test(generation)) {
    throw new Error('camera generation: missing or invalid identity header');
  }

  const body: unknown = await response.json();
  if (
    !isRecord(body) ||
    body['zoom'] !== 11 ||
    !Number.isSafeInteger(body['cameras']) ||
    (body['cameras'] as number) < 0 ||
    !Number.isSafeInteger(body['tiles']) ||
    (body['tiles'] as number) < 0 ||
    typeof body['upstream'] !== 'string' ||
    body['upstream'] === ''
  ) {
    throw new Error('camera generation: invalid index body');
  }

  return {
    generation,
    cameras: body['cameras'] as number,
    tiles: body['tiles'] as number,
    upstream: body['upstream'],
  };
}

/**
 * The immutable URL of one file inside a generation.
 *
 * Named for the BINDING rather than for the tile, because every reader of this
 * archive uses it: the z11 tiles, and the three sidecars that describe the same
 * snapshot. The public generation key carries no driver data - it is the same
 * string for every driver on that generation - and it is what makes the service
 * worker's per-generation cache entries distinct.
 */
export function generationBoundUrl(base: string, path: string, generation: string): string {
  return `${base}/${path}?generation=${generation}`;
}

/**
 * Fetch one file of a generation and refuse anything that is not that file.
 *
 * THE RULES ARE THE TILE'S RULES, and that is the point of this function
 * existing rather than each reader writing its own fetch. `sync.ts::loadTile`
 * had them and `gazetteer.ts`, `overview.json`'s two call sites and nothing
 * else did, which is how the map overview, the POI export and every county
 * name could be from a different snapshot than the warnings on the same
 * screen.
 *
 *   - `guardedFetch`, so an expired Cloudflare Access session raises the
 *     sign-in banner instead of arriving as an unreadable body;
 *   - the response header must equal the requested generation EXACTLY, so a
 *     pointer that moved mid-flight is a failed read rather than a mixed one;
 *   - a non-200 is an error, never an empty result. A sidecar has no "rural
 *     square" case: the Function answers a missing one with 503 precisely so
 *     that a damaged generation cannot read as an empty catalogue.
 *
 * Throws on every one of those. Callers render the absence - see
 * `createGenerationBoundResource`, which is where the "a name is a nicety"
 * degradation lives.
 */
export async function fetchGenerationBound(options: {
  readonly fetchImpl: typeof fetch;
  readonly base: string;
  readonly path: string;
  readonly generation: string;
}): Promise<unknown> {
  const url = generationBoundUrl(options.base, options.path, options.generation);
  const res = await guardedFetch(url, options.fetchImpl);
  if (isAccessBounce(res)) throw new Error(`${options.path}: signed out`);
  if (res.headers.get(CAMERA_GENERATION_HEADER) !== options.generation) {
    throw new Error(`${options.path}: generation changed`);
  }
  if (!res.ok) throw new Error(`${options.path}: HTTP ${String(res.status)}`);
  return await res.json();
}
