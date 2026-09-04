import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * THE WORKER'S CAMERA POLICY, IMPORTED SO IT CAN BE TESTED AS BEHAVIOUR.
 *
 * Workbox serialises these by SOURCE TEXT into `dist/sw.js`, so importing them
 * here is not the same as calling them here - the worker gets the bodies, not a
 * reference. That is why every function in that module is self-contained, and
 * why `scripts/service-worker-policy.test.mjs` asserts the built worker carries
 * the bodies rather than the names.
 */
import {
  admitGenerationBoundResponse,
  isCameraSidecarRequest,
} from './src/services/cameras/swAdmission.ts';

/**
 * Vite config for the DarkRoute PWA.
 *
 * This file sits OUTSIDE apps/pwa/src, so literal values are permitted here.
 * Every literal below that mirrors a design token names its source:
 *   #000000  -> --fwm-bg           (apps/pwa/src/styles/tokens.css)
 * Nothing in src/ may follow this file's example.
 *
 * Manifest fields are transcribed from "Flockys Design System.dc.html",
 * section 06, panel "MANIFEST TOKENS".
 */

const DEV_PORT = 5173;

/**
 * THE BUILD'S OWN IDENTITY, so a bug report can name what was running.
 *
 * Stamped at BUILD time rather than read at runtime, because there is nothing
 * to read at runtime: `package.json` is not served, and a version typed into a
 * TypeScript constant is a second copy that drifts the first time somebody
 * bumps one and not the other.
 *
 * The COMMIT is the part that actually identifies a build. The version has
 * been `0.1.0` for the whole life of this repo and will answer "which build is
 * this" with the same string for every deploy; a short sha answers it exactly,
 * and is what turns "it did the thing again" into a diff. `--dirty` is
 * deliberate: a build made from a working tree with uncommitted changes is not
 * the commit it claims to be, and a report naming a clean sha for a dirty
 * build sends somebody to the wrong code.
 *
 * Every lookup is guarded. A build from a tarball has no git, and failing a
 * production build over a version string would be absurd.
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function readCommit(): string {
  try {
    return execSync('git describe --always --dirty --abbrev=8', {
      cwd: new URL('.', import.meta.url).pathname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'nogit';
  }
}

/**
 * THE SHA, SEPARATELY, BECAUSE THE DESCRIBE STRING IS NOT A COMMIT REF.
 *
 * `git describe` returns `v0-design-83-g<short-sha>` once any tag exists: readable,
 * carries the dirty flag, and useless as a URL. The docs screen was building
 * `<repo>/commit/${BUILD.commit}` out of it, so the one link whose entire job is
 * to let a stranger read the exact source behind their bundle pointed at a ref
 * GitHub cannot resolve. It would have 404'd on launch day with the repository
 * public and everything else correct - a broken promise in the middle of the
 * screen that argues the promises are checkable.
 *
 * So both are stamped. The describe string is what a person READS, because it
 * says `-dirty` when it matters; the sha is what the link RESOLVES.
 */
function readCommitSha(): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: new URL('.', import.meta.url).pathname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'nogit';
  }
}

/** Date only, UTC. A build MINUTE is noise in a bug report; the day is not. */
function buildDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolved once so `@/…` imports work identically in vite, vitest and tsc. */
const srcDir = new URL('./src/', import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
      /*
       * @meshtastic/js SHIPS A BROKEN EXPORTS MAP, and this is the workaround.
       *
       * Its package.json points `exports["."].import` and `module` at
       * `./dist/index.ts` -- a TypeScript SOURCE file -- and the published
       * tarball does not contain one. `dist/` holds `index.js`, `index.js.map`
       * and `index.d.ts` and nothing else. So the bundler resolves the entry,
       * fails to find the file, and the build dies.
       *
       * `tsc` succeeds on the same package because it reads `types`, which is
       * correct -- which is why this failed at BUILD and not at typecheck.
       *
       * Pointed at the file that actually exists. Every published version of
       * this package is a prerelease (2.6.0-0 is the newest), so there is no
       * stable release to move to and no reason to expect this to be fixed by
       * a version bump; revisit when one ships.
       */
      '@meshtastic/js': new URL('./node_modules/@meshtastic/js/dist/index.js', import.meta.url)
        .pathname,
    },
  },

  /* Literals here are build metadata, not design values, and this file is
     outside apps/pwa/src so the token gate does not apply. */
  define: {
    __FWM_VERSION__: JSON.stringify(readVersion()),
    __FWM_COMMIT__: JSON.stringify(readCommit()),
    __FWM_COMMIT_SHA__: JSON.stringify(readCommitSha()),
    __FWM_BUILT__: JSON.stringify(buildDay()),
  },

  server: {
    port: DEV_PORT,
    strictPort: true,
  },

  preview: {
    port: DEV_PORT,
    strictPort: true,
  },

  build: {
    target: 'es2022',
    /*
     * NO SOURCEMAPS IN A PUBLISHED BUILD.
     *
     * This was `true`, and `scripts/deploy.mjs` uploads the whole of `dist`
     * with no exclusion, so the maps were served. Measured on the live site:
     * `/assets/index-<hash>.js.map` was a public 200 of 6.1 MB carrying the
     * entire pre-minification source, and `/sw.js.map` carried the absolute
     * build path of the machine that produced it inside `sourcesContent`.
     *
     * `false`, NOT `'hidden'`. `'hidden'` only drops the `sourceMappingURL`
     * comment; the .map is still written into `dist` and still uploaded, and
     * the bundle filename is in `index.html`, so the map stays one guess away.
     * Hiding the pointer is not the same as not shipping the file.
     *
     * The service worker's map is emitted SEPARATELY by vite-plugin-pwa and is
     * not governed by this line -- see `workbox.sourcemap` below. Both are
     * needed; fixing one leaves the other served.
     */
    sourcemap: false,
    // The alert path must never wait on a lazy chunk, so keep the shell small
    // and let route-level code splitting happen through dynamic import only.
    chunkSizeWarningLimit: 700,
  },

  plugins: [
    /**
     * THE CAMERA ARCHIVE DOES NOT GO IN THE DEPLOY.
     *
     * =======================================================================
     * THE BUG THIS FIXES: FIVE-DAY-OLD DATA WITH A WORKING PIPELINE
     * =======================================================================
     * The freshness patrol applies OSM diffs hourly and publishes the tiles to
     * R2. `functions/cameras/[[path]].ts` exists to serve them from there, and
     * the R2 binding is configured. Every part of that worked.
     *
     * And none of it reached a driver, because all 8,610 archive files were
     * also copied into `dist/` as STATIC ASSETS - and on Cloudflare Pages a
     * static asset always wins over a Function. `/cameras/index.json` resolved
     * to the file baked into the deploy, the Function was never invoked, and
     * R2 was written to hourly by the patrol and read by nobody. The app served
     * whatever the last deploy happened to carry, which is exactly the coupling
     * the Function was written to break.
     *
     * So the build stops shipping them. The files stay in `public/cameras` -
     * they are the reviewed bootstrap snapshot and what
     * `DATA-PROVENANCE.md` points a reader at. Scheduled refreshes live in
     * atomic R2 generations rather than Git; the deployed artefact does not
     * contain either copy, and the Function answers from the active generation.
     *
     * Tiles are NOT precached (see `globPatterns` below: js/css/html/woff2/
     * png/svg, and a tile is .json), so nothing offline regresses. A tile is
     * runtime-cached the first time a driver enters that square, exactly as
     * before; the only change is which origin answered that first request.
     *
     * `vite dev` serves `public/` directly and is unaffected. `vite preview`
     * serves `dist/` and will 404 on tiles, which is honest: that is what the
     * deploy looks like, and the data comes from R2 in production.
     */
    {
      name: 'fwm-archive-not-in-deploy',
      apply: 'build' as const,
      closeBundle(): void {
        rmSync(new URL('./dist/cameras', import.meta.url), {
          recursive: true,
          force: true,
        });
        /*
         * NO SOURCEMAP EVER LEAVES IN `dist`, WHATEVER THE CONFIG SAYS.
         *
         * The two `sourcemap: false` settings above are the fix; this is the
         * guard that survives them. `scripts/deploy.mjs` uploads this whole
         * directory with no exclusion list, so a map that reaches `dist` is a
         * map on the public internet -- and that is exactly how 6.1 MB of
         * pre-minification source and an absolute build path came to be served
         * from darkroute.ai. Turning maps back on for a debugging build should
         * cost a deliberate change here, not a silent republication.
         */
        const dist = fileURLToPath(new URL('./dist', import.meta.url));
        for (const entry of readdirSync(dist, { recursive: true })) {
          const name = typeof entry === 'string' ? entry : String(entry);
          if (name.endsWith('.map')) rmSync(join(dist, name), { force: true });
        }
        /*
         * ONE MAP GOES BACK, EMPTY, AND ONLY THIS ONE.
         *
         * Deleting `sw.js.map` from the deploy was not enough to stop it being
         * SERVED. Pages caches static assets in its own edge store, and four
         * zone-level purges returned success while `darkroute.ai/sw.js.map`
         * kept answering with the old bytes and a steadily climbing `age`;
         * `?cb=1` on the same path returned the correct 404 body, which is how
         * we know the origin was already clean and the cache key was the only
         * thing left holding it.
         *
         * A cache entry cannot be waited out responsibly when what it holds is
         * an absolute build path, so it is OVERWRITTEN instead: a real asset at
         * the same URL replaces the cached content on the next deploy. This is
         * a valid, empty source map - no `sources`, no `sourcesContent` - so
         * a debugger that asks for it gets a well-formed answer containing
         * nothing rather than a 404 it might log as a build error.
         *
         * Safe to delete once the original cache entry has expired.
         */
        writeFileSync(
          join(dist, 'sw.js.map'),
          `${JSON.stringify({ version: 3, file: 'sw.js', sources: [], names: [], mappings: '' })}\n`,
        );
      },
    },
    react(),

    VitePWA({
      // The service worker is generated, but registration is deliberately NOT
      // injected: the design requires an install/update prompt that is gated
      // ("after 2nd session, never on first alert" — section 06, PLATFORM
      // BEHAVIOUR). That gating is application code, which calls registerSW()
      // from workbox-window itself. Until it does, no service worker is active.
      injectRegister: null,
      registerType: 'prompt',
      strategies: 'generateSW',

      /**
       * NO MANIFEST IS GENERATED HERE, ON PURPOSE.
       *
       * `scripts/generate-assets.mjs` renders the icon set from the design
       * tokens and writes `public/manifest.webmanifest`; vite copies that file
       * to `dist/` verbatim and `index.html` links it directly.
       *
       * This block used to carry a second, hand-written manifest, and because
       * vite-plugin-pwa GENERATES the served file, that copy silently
       * overwrote the generated one. The build shipped a single 1273x1236 PNG
       * as its only icon, so Chrome on Android saw no 192 and no 512, failed
       * the installability check, and never offered "Add to home screen".
       *
       * One manifest, generated from the tokens, guarded by
       * `scripts/generate-assets.test.mjs` (it asserts the 192/512 pair).
       * Do not reintroduce a copy here.
       */
      manifest: false,

      workbox: {
        /*
         * THE WORKER'S OWN MAP, WHICH `build.sourcemap` DOES NOT REACH.
         *
         * vite-plugin-pwa copies `build.sourcemap` into this only when it is
         * left undefined, and it defaults ON otherwise -- so `sw.js.map` was
         * published even while the app's own maps were the thing being argued
         * about. It is the smaller file and the worse leak: `sourcesContent`
         * embeds the ABSOLUTE build path of the machine that made it.
         *
         * Set explicitly rather than left to inherit, so that turning app
         * sourcemaps back on for a debugging build cannot silently re-publish
         * this one too.
         */
        sourcemap: false,

        /*
         * THE NEW WORKER TAKES OVER BY ITSELF. IT HAS TO.
         *
         * These were off, on the reasoning that a swap must never happen
         * during a camera alert — and the page-side controller was given an
         * `applyUpdate()` to call when it was safe. That created a deadlock
         * nobody spotted until a device sat on a months-old build:
         *
         *   the OLD page is the one that decides to take an update,
         *   the OLD page is served BY the old worker,
         *   and the old page has no update code in it.
         *
         * So a new worker installed, waited for a page that would never ask,
         * and every deploy after the driver's first visit was invisible. A
         * fix that lives in the new build cannot fix a client that will never
         * receive the new build.
         *
         * `skipWaiting` + `clientsClaim` breaks it from the worker's side,
         * which is the only side that reaches a stuck client. The alert
         * safety is NOT lost: activating a worker does not reload a loaded
         * document, so a running page keeps the JS it already has and only
         * picks up new assets on its next navigation. The one thing that
         * could interrupt an alert — a reload — stays in `registerSW.ts`,
         * still gated on `canApplyUpdate()`.
         */
        skipWaiting: true,
        clientsClaim: true,

        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        /*
         * THE DOCUMENT IS FETCHED FROM THE NETWORK FIRST, AND THAT IS THE FIX
         * FOR "I KEEP SEEING AN OLD BUILD".
         *
         * `navigateFallback` serves the PRECACHED index.html for every
         * navigation. That is right offline and wrong the rest of the time: a
         * cached document names the asset hashes of the build it came from, so
         * a device that has one keeps loading that build -- through refreshes,
         * through new deploys, for as long as the precache holds -- while the
         * server has been serving something else for hours. A fix that lives in
         * a newer bundle cannot reach a client that will never fetch it.
         *
         * `NetworkFirst` on navigations means a connected driver always gets
         * the current HTML, and therefore the current assets. Offline still
         * works: the last document that loaded is in the cache and is what the
         * fallback serves when the network is gone, which is the case the
         * precache was really for.
         *
         * Three seconds, then the cache. A driver on a bad signal must not sit
         * on a white screen waiting for a document they already have.
         *
         * THE FALLBACK IS DENIED EVERY URL, WHICH IS HOW IT IS TURNED OFF.
         *
         * Deleting the `navigateFallback` key does nothing: vite-plugin-pwa
         * injects `index.html` as a default for a SPA, so the NavigationRoute
         * is installed either way. And Workbox matches routes in REGISTRATION
         * ORDER, with that one registered before `runtimeCaching` -- verified
         * in the built `sw.js`, fallback at byte 1480 and the documents route
         * at 1602 -- so it kept winning and the NetworkFirst handler below was
         * dead code, twice over.
         *
         * `navigateFallbackDenylist: [/./]` matches every path, so the fallback
         * declines every navigation and the request falls through to the route
         * that actually asks the network. This is the documented lever, not a
         * trick: the denylist exists precisely to take navigations away from
         * the precache.
         *
         * Offline is not lost. The NetworkFirst route caches every document it
         * serves, so after one visit there is a document to fall back on --
         * which is the case the precached fallback existed for.
         */
        navigateFallbackDenylist: [/./],
        // Report submission is POST and is therefore never handled by the
        // Workbox runtime caches below; it stays network-only and the client
        // queues failures in IndexedDB (section 06, PLATFORM BEHAVIOUR).
        runtimeCaching: [
          {
            // Navigations. Registered FIRST so it wins over the precache route
            // that `navigateFallback` installs.
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fwm-documents',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4 },
              /*
               * 200 ONLY. `0` was here to admit an opaque response, which is
               * the right allowance for a cross-origin TILE and the wrong one
               * for a document: this site sits behind Cloudflare Access, and an
               * expired session answers a navigation with a 302. A navigation
               * request carries `redirect: 'manual'`, so that arrives as an
               * opaqueredirect with status 0 -- and admitting status 0 here
               * means trying to store "you are logged out" as the app's
               * document. Only a real page is a real page.
               */
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            /*
             * REFERENCE RECORDS. `/records/counties.json` is the misuse file
             * and `/records/county-index.json` is the county geometry the NEAR
             * ME chip resolves a fix against.
             *
             * MATCHED BY NOTHING BEFORE THIS. `globPatterns` above is
             * js/css/html/woff2/png/svg, so a `.json` under `/records/` was
             * neither precached nor runtime-cached, and both files were
             * network-only. On a phone with no signal the MISUSE screen showed
             * no records at all and NEAR ME could not resolve a county -- on a
             * product whose whole claim is that it works with the radio off.
             *
             * NOT PRECACHED EITHER, deliberately: the county index is about a
             * megabyte, and pulling every US county boundary down on first load
             * for a screen most drivers never open is the same mistake as
             * precaching the tile archive. StaleWhileRevalidate fetches it once
             * a driver actually opens MISUSE, then answers instantly and
             * offline forever after.
             *
             * THESE ARE NOT CAMERA DATA and carry no generation. County borders
             * change on a Census vintage and the misuse file changes when a
             * human commits a cited record; neither is bound to a camera
             * pointer, so binding them to the generation protocol would mean
             * reissuing county boundaries every time a camera moved.
             *
             * 200 ONLY, same reason as the tiles: a cached 404 or an Access
             * redirect stored as a record file is a screen that says "nothing
             * documented" because of a network failure, which is a claim about
             * the world rather than about a fetch.
             */
            urlPattern: ({ url }: { url: URL }) =>
              url.origin === self.location.origin && /^\/records\/[\w-]+\.json$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fwm-records-v1',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 8, purgeOnQuotaError: true },
            },
          },
          {
            /*
             * CAMERA GENERATION IDENTITY. NetworkFirst is deliberate: this
             * small index is the atomic pointer observation that decides
             * whether the much larger tile cache is reusable. The client also
             * adds a public time-bucket query, so a worker from before this
             * route existed cannot return its old unversioned SWR entry.
             */
            urlPattern: ({ url }: { url: URL }) =>
              url.origin === self.location.origin && url.pathname === '/cameras/index.json',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fwm-camera-generation-v1',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  cacheWillUpdate: async ({
                    response,
                  }: {
                    response: Response;
                  }): Promise<Response | null> => {
                    const generation = response.headers.get('x-darkroute-camera-generation');
                    return response.status === 200 && /^[0-9a-f]{64}$/.test(generation ?? '')
                      ? response
                      : null;
                  },
                },
              ],
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            /*
             * THE FILES THAT DESCRIBE THE ARCHIVE: overview, counties, places.
             *
             * MATCHED BY NOTHING BEFORE THIS, exactly as the tiles once were.
             * `globPatterns` is js/css/html/woff2/png/svg and no runtime route
             * named them, so a driver with no signal kept getting camera
             * warnings from the tile cache while the map overview, the POI
             * export and every county and place name failed outright. The app
             * disagreeing with itself about what it holds is the failure; a
             * thinner map is not.
             *
             * SAME POLICY AS THE TILES, because they are the same generation.
             * The client fetches them on a `?generation=<G>` URL, so a pointer
             * change produces a new cache key and the old body can never answer
             * for the new snapshot; `admitGenerationBoundResponse` refuses any
             * response whose header disagrees with that key.
             *
             * NOT PRECACHED. `overview.json` alone is about a megabyte, and
             * pulling the whole country down on first load for screens most
             * drivers never open is the mistake the tile archive already
             * taught. StaleWhileRevalidate fetches each one when a driver
             * actually opens the screen that needs it, then answers offline.
             *
             * SIX ENTRIES: three files across two generations, so a driver mid
             * -transition keeps a working set while the new one arrives.
             */
            urlPattern: isCameraSidecarRequest,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fwm-camera-sidecars-v1',
              cacheableResponse: { statuses: [200] },
              plugins: [{ cacheWillUpdate: admitGenerationBoundResponse }],
              expiration: {
                maxEntries: 6,
                maxAgeSeconds: 60 * 60 * 24 * 7,
                purgeOnQuotaError: true,
              },
            },
          },
          {
            /*
             * MAP GLYPHS AND SPRITE INDEXES. All 256 Unicode glyph ranges are
             * shipped, but downloading 768 protobuf files at install time
             * would waste bandwidth and storage. Cache only the ranges and
             * sprite indexes MapLibre actually requests. Sprite PNGs remain
             * in the precache above.
             *
             * This route is also part of the HTML-fallback repair: a missing
             * glyph path on Pages is answered by index.html, which MapLibre
             * tries to decode as protobuf (`Unimplemented type: 4`). The build
             * gate proves every possible range exists; this cache makes each
             * requested range available offline after its first use.
             */
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' &&
              url.origin === self.location.origin &&
              url.pathname.startsWith('/basemap-assets/') &&
              (url.pathname.endsWith('.pbf') || url.pathname.endsWith('.json')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fwm-basemap-assets-v1',
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  /**
                   * Pages answers an absent static path with index.html at
                   * status 200. Never preserve that fallback for a year under
                   * a glyph or sprite URL: MapLibre would then keep parsing
                   * `<!doctype` even after a corrected deployment landed.
                   */
                  cacheWillUpdate: async ({
                    request,
                    response,
                  }: {
                    request: Request;
                    response: Response;
                  }): Promise<Response | null> => {
                    if (response.status !== 200) return null;
                    const clone = response.clone();
                    if (request.url.endsWith('.json')) {
                      try {
                        const value = JSON.parse(await clone.text()) as unknown;
                        return typeof value === 'object' && value !== null ? response : null;
                      } catch {
                        return null;
                      }
                    }
                    const bytes = new Uint8Array(await clone.arrayBuffer());
                    // Valid glyph PBFs are nonempty binary protobufs. The SPA
                    // fallback begins with '<' (0x3c).
                    return bytes.length > 0 && bytes[0] !== 0x3c ? response : null;
                  },
                },
              ],
              expiration: {
                // 768 glyph ranges + ten 1x/2x sprite indexes, with headroom.
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 365,
                purgeOnQuotaError: true,
              },
            },
          },
          {
            /*
             * CAMERA TILES. The reason the app can work with the radio off.
             *
             * These were matched by NOTHING. `globPatterns` above lists
             * js/css/html/woff2/png/svg and the tiles are `.json`, so they were
             * never precached; no runtime route named them either. A cold start
             * with no signal produced an empty map over a city full of cameras,
             * and the OFFLINE screen was right to say the cache was not there.
             *
             * Adding them to `globPatterns` would be wrong: the archive is
             * 8,589 files, and precaching the United States on first load is
             * not a thing to do to somebody's phone or their data plan.
             * `CacheFirst` caches the squares a driver actually enters, which
             * is the shape of the need.
             *
             * STALE WHILE REVALIDATE, and it used to be CacheFirst.
             *
             * The old reasoning was sound and its premise is now false. It read:
             * "a tile is a static build artefact - `fetch-cameras.mjs` writes it
             * and a deploy replaces it - so there is nothing to revalidate
             * between deploys". That was true while the archive shipped inside
             * the bundle. It stopped being true the hour the freshness patrol
             * went live: tiles are published to R2 EVERY HOUR and served by
             * `functions/cameras/[[path]].ts`, with no deploy involved.
             *
             * CacheFirst against an hourly-changing origin means a driver can be
             * up to SEVEN DAYS behind the data while the app reports itself
             * current - and the cameras added in that week are the ones nobody
             * has a warning for yet.
             *
             * The client generation-keys each URL. Within an immutable
             * generation SWR keeps the instant offline answer; after a pointer
             * change the new URL cannot hit the old body's cache entry. The
             * client also checks the response header before accepting bytes, so
             * a pointer race is availability rather than a mixed catalogue.
             *
             * 200 ONLY. A 404 is the normal answer for a rural square and must
             * never be cached: `sync.ts` reads it as "no cameras here", and a
             * cached 404 would keep saying that after the tile existed. Nor
             * status 0 -- an Access redirect stored as a tile is an empty
             * square over a real road, the one failure this product must not
             * have.
             */
            urlPattern: ({ url }: { url: URL }) =>
              url.origin === self.location.origin &&
              /^\/cameras\/11\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)\.json$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              /*
               * NAME BUMPED TO v2, WHICH IS THE POINT.
               *
               * Every device that ran a build before the archive moved to R2
               * holds tiles cached under the old name, put there by CacheFirst
               * with a seven-day life. Switching the handler to
               * StaleWhileRevalidate fixes the NEXT fetch and does nothing
               * about those: SWR serves the stale entry first, so a driver
               * would still see week-old cameras on the drive after the fix
               * shipped.
               *
               * A new cache name abandons the old store wholesale - Workbox
               * cleans it up - so the first fetch after this deploy goes to the
               * network and comes back with what R2 actually holds.
               */
              cacheName: 'fwm-camera-tiles-v2',
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  /** Never let a raced or stale Function response poison G. */
                  cacheWillUpdate: async ({
                    request,
                    response,
                  }: {
                    request: Request;
                    response: Response;
                  }): Promise<Response | null> => {
                    const expected = new URL(request.url).searchParams.get('generation');
                    const actual = response.headers.get('x-darkroute-camera-generation');
                    return response.status === 200 &&
                      /^[0-9a-f]{64}$/.test(expected ?? '') &&
                      actual === expected
                      ? response
                      : null;
                  },
                },
              ],
              expiration: {
                // A ring of 17x17 is 289 tiles; this holds several cities'
                // worth of driving without letting a long trip evict home.
                maxEntries: 1200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
      },

      devOptions: {
        // Never run a service worker in dev: a stale precache during a live
        // alert is a correctness bug, not a caching inconvenience.
        enabled: false,
      },
    }),
  ],
});
