/**
 * WHICH ARCHIVE TO READ - and why the answer is never a fixed filename.
 *
 * =============================================================================
 * THE FAILURE THIS EXISTS TO PREVENT
 * =============================================================================
 * A PMTiles archive is read by HTTP range request: the client fetches the
 * header, then a directory, then byte ranges holding the tiles it wants. Those
 * are OFFSETS INTO A SPECIFIC FILE.
 *
 * So if a nightly rebuild overwrites the archive at the same URL, every client
 * holding a cached directory now has offsets into a file that no longer exists.
 * The bytes at those offsets are some other tile, or the middle of one. The map
 * does not error -- it draws garbage, or nothing, and keeps doing so until the
 * cache is cleared.
 *
 * PMTiles' own client tries to catch this with the ETag, and its API
 * documentation is explicit that it "does not send conditional request headers
 * If-Match because of CORS. Instead, it detects ETag mismatches via the
 * response ETag or the 416 response code." Which means the whole safety net
 * depends on the client being ABLE TO READ the ETag -- and a cross-origin
 * response only exposes it when the server sends
 * `Access-Control-Expose-Headers: etag`. Forget that header on the bucket and
 * the detection silently does nothing.
 *
 * Depending on a CORS header being right forever, to protect against a
 * corruption that is silent when it fails, is not a safety net. So the archive
 * is NEVER overwritten:
 *
 *   - every build writes a NEW, date-stamped file, immutable once uploaded
 *   - a tiny manifest at a stable URL says which one is current
 *   - the manifest is the only thing with a short cache lifetime
 *
 * A client reading an old archive is reading a COMPLETE, CONSISTENT, slightly
 * stale map. That is a good failure. Reading a new archive with old offsets is
 * a corrupt one.
 *
 * =============================================================================
 * WHY THE MANIFEST IS ALLOWED TO FAIL
 * =============================================================================
 * This app is used in a moving vehicle with bad connectivity, and the map is
 * the product. So a manifest that cannot be fetched must never mean "no map":
 * resolution falls back to the last archive this device actually used, and
 * failing that to the URL compiled into the build. Both are real archives that
 * were current at some point, which is exactly the good failure above.
 */

/** The pointer's filename. Stable, tiny, short-lived in cache. */
export const MANIFEST_FILE = 'basemap.json';

/**
 * The manifest lives BESIDE THE ARCHIVE, not on the app's own origin.
 *
 * This was origin-relative, which meant a client asked its own host -- the
 * Pages deployment -- which archive to read. Wrong owner: the archive lifecycle
 * belongs to the tiles bucket, and tying it to the app origin would mean an app
 * deploy is required to point at a newer map. It also silently "worked" in dev,
 * because a dev server answers every path with index.html.
 *
 * Derived from the configured archive URL so the two can never drift, and
 * cross-origin reads are covered by the bucket's CORS policy.
 */
export function manifestUrlFor(archiveUrl: string | null): string | null {
  if (archiveUrl === null) return null;
  try {
    const url = new URL(archiveUrl);
    return new URL(MANIFEST_FILE, `${url.origin}/`).toString();
  } catch {
    // A relative archive URL (a local test build). Fall back to the app origin,
    // which is where such an archive is being served from anyway.
    return `/${MANIFEST_FILE}`;
  }
}

/**
 * How long to wait for the pointer before giving up and using what we know.
 *
 * Short on purpose. This sits between the driver and a map they need now, and
 * the fallback is a perfectly good archive -- waiting longer to maybe learn
 * about a fresher one is the wrong trade in a car.
 */
export const MANIFEST_TIMEOUT_MS = 2_500;

/** Where the last successfully resolved archive is remembered. */
export const LAST_ARCHIVE_KEY = 'fwm.basemap.archive';

export interface BasemapManifest {
  /** Absolute or origin-relative URL of the CURRENT archive. Immutable once published. */
  readonly url: string;
  /** ISO timestamp of the build, for diagnostics. */
  readonly built?: string | undefined;
  /** The OSM replication timestamp the archive was built from. */
  readonly osm?: string | undefined;
}

/**
 * Whether a manifest may point the app at this URL.
 *
 * THE MANIFEST IS NOT ALLOWED TO MOVE US OFF OUR OWN INFRASTRUCTURE. `basemap.ts`
 * states the rule the whole design rests on -- self-hosted tiles or no basemap --
 * and without this check a manifest naming `https://someone-else.example/x.pmtiles`
 * would be obeyed, silently sending every driver's tile requests to a third
 * party. That is the one thing this product must never do, and "the bucket would
 * have to be compromised first" is not a reason to leave the door open: a
 * misconfigured deploy or a wrong `R2_PUBLIC_BASE` reaches the same place
 * without an attacker.
 *
 * Same ORIGIN as the manifest itself, which is by construction the tiles host.
 */
export function isPermittedArchive(archiveUrl: string, manifestUrl: string): boolean {
  // A RELATIVE MANIFEST URL IS NOT A VALID BASE, and treating that as "refuse"
  // made the whole manifest path silently inert in local builds: a relative
  // fallback yields a relative `/basemap.json`, `new URL(x, '/basemap.json')`
  // throws, every manifest was rejected, and archive resolution could never be
  // exercised in the one environment where you would notice it misbehaving.
  // Both are resolved against a common synthetic base so a relative pair
  // compares as the same origin, which is what it is.
  const BASE = 'https://relative.invalid/';
  try {
    const manifest = new URL(manifestUrl, BASE);
    const archive = new URL(archiveUrl, manifest);
    return archive.origin === manifest.origin;
  } catch {
    return false;
  }
}

/**
 * Parse a manifest body, refusing anything that is not a usable pointer.
 *
 * Deliberately strict. A half-valid manifest that yields a bad URL would be
 * worse than no manifest at all, because the fallback path is known-good.
 */
export function parseManifest(body: unknown): BasemapManifest | null {
  if (typeof body !== 'object' || body === null) return null;
  const url = (body as { url?: unknown }).url;
  if (typeof url !== 'string' || url.trim() === '') return null;
  // IT HAS TO NAME AN ARCHIVE. Any non-empty string resolves as a relative path
  // on the manifest's own origin, so the origin check alone would accept
  // rubbish -- and because a resolved URL is REMEMBERED for next launch, one
  // junk pointer would persistently replace a working fallback with a 404.
  // Lowercased to compare, but the VALUE is kept verbatim -- and `isPmtiles`
  // in basemap.ts matches case-sensitively, so accepting `X.PMTILES` here would
  // mean the pmtiles protocol handler is never registered while the style still
  // prefixes `pmtiles://`. Accepted, remembered, and a dead map.
  if (!url.trim().endsWith('.pmtiles')) return null;
  const built = (body as { built?: unknown }).built;
  const osm = (body as { osm?: unknown }).osm;
  return {
    url: url.trim(),
    built: typeof built === 'string' ? built : undefined,
    osm: typeof osm === 'string' ? osm : undefined,
  };
}

export interface ResolveOptions {
  /** The URL compiled into the build, used when nothing better is known. */
  readonly fallbackUrl: string | null;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null | undefined;
  readonly manifestUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * The archive this client should read, in order of preference.
 *
 *   1. the manifest, when it answers in time and parses
 *   2. the last archive this device used, remembered across sessions
 *   3. the URL compiled into the build
 *
 * Order matters. (2) sits above (3) because a device that has been running for
 * months has a cached archive that (3) may no longer name, and asking it to
 * switch to a different file discards every cached byte it holds -- offline,
 * that is the difference between a map and a black rectangle.
 */
export async function resolveArchiveUrl(options: ResolveOptions): Promise<string | null> {
  const { fallbackUrl, storage = null } = options;
  const doFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  const remembered = readRemembered(storage);

  if (doFetch !== undefined) {
    const manifestUrl = options.manifestUrl ?? manifestUrlFor(fallbackUrl);
    const manifest =
      manifestUrl === null
        ? null
        : await fetchManifest(doFetch, manifestUrl, options.timeoutMs ?? MANIFEST_TIMEOUT_MS);
    if (manifest !== null && manifestUrl !== null) {
      // See `isPermittedArchive`: a manifest may say WHICH archive, never WHOSE.
      if (isPermittedArchive(manifest.url, manifestUrl)) {
        /**
         * REMEMBER ONLY WHAT IS ACTUALLY THERE.
         *
         * This remembered before checking anything, so a well-formed pointer at
         * a NONEXISTENT archive -- one bad publish -- was written to storage and
         * then outranked the compiled-in fallback forever, on every device that
         * fetched it once. Origin-pinning does not help: the URL is perfectly
         * well-formed, it just 404s.
         *
         * One 16-byte range request settles it, and only when the archive has
         * actually changed -- so the steady state costs nothing.
         */
        if (manifest.url === remembered) return manifest.url;
        if (await archiveExists(doFetch, manifest.url, options.timeoutMs ?? MANIFEST_TIMEOUT_MS)) {
          remember(storage, manifest.url);
          return manifest.url;
        }
      }
    }
  }

  return remembered ?? fallbackUrl;
}

/**
 * Is there really an archive at this URL?
 *
 * A 16-byte range read. Cheap, and it distinguishes "the manifest names a new
 * archive" from "the manifest names a typo" -- which are indistinguishable
 * until something asks.
 */
async function archiveExists(
  doFetch: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer =
    controller === null
      ? null
      : setTimeout(() => {
          controller.abort();
        }, timeoutMs);
  try {
    const response = await doFetch(url, {
      ...(controller === null ? {} : { signal: controller.signal }),
      headers: { Range: 'bytes=0-15' },
    });
    // 206 for a range, 200 for a server that ignores Range. Both mean it exists.
    return response.status === 206 || response.status === 200;
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function fetchManifest(
  doFetch: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<BasemapManifest | null> {
  // AbortController rather than Promise.race: race leaves the request running,
  // and on a phone that is a radio kept awake for a response nobody will read.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer =
    controller === null
      ? null
      : setTimeout(() => {
          controller.abort();
        }, timeoutMs);
  try {
    const response = await doFetch(url, {
      ...(controller === null ? {} : { signal: controller.signal }),
      // The pointer must not be served from a stale cache -- it is the one
      // thing in this design whose whole job is to change.
      cache: 'no-cache',
    });
    if (!response.ok) return null;
    return parseManifest(await response.json());
  } catch {
    // Offline, timed out, or malformed. All three mean the same thing here:
    // use what we already know. See the header.
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * The archive this device last used, or null.
 *
 * EXPORTED for the INTEL card's mini map, which needs an archive URL and must
 * not resolve one: resolution is a manifest fetch plus a range probe, and doing
 * that per card would be two requests to draw a thumbnail and a chance of
 * drawing a DIFFERENT archive from the one the scope is reading. This is the
 * offline-friendly answer -- the archive whose tiles are already in the
 * browser's cache -- and it costs nothing to read. See `MiniMap.tsx`.
 */
export function readRemembered(storage: ResolveOptions['storage']): string | null {
  if (storage === null || storage === undefined) return null;
  try {
    const value = storage.getItem(LAST_ARCHIVE_KEY);
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

function remember(storage: ResolveOptions['storage'], url: string): void {
  if (storage === null || storage === undefined) return;
  try {
    storage.setItem(LAST_ARCHIVE_KEY, url);
  } catch {
    // Private mode, quota, a disabled store. Losing the memo costs a manifest
    // fetch next launch; throwing here would cost the map.
  }
}
