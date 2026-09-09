/**
 * THE SERVICE WORKER HAS ONE POLICY SOURCE.
 *
 * Workbox generates `sw.js` from the inline block in `vite.config.ts`. These
 * assertions keep the camera generation and tile policies coupled and prevent
 * the deleted Google Fonts routes from returning after all fonts moved onto
 * this origin.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('../apps/pwa/vite.config.ts', import.meta.url), 'utf8');
const admissionUrl = new URL('../apps/pwa/src/services/cameras/swAdmission.ts', import.meta.url);
const admission = readFileSync(admissionUrl, 'utf8');
const builtWorkerUrl = new URL('../apps/pwa/dist/sw.js', import.meta.url);

describe('the generated service-worker policy source', () => {
  it('keeps the live navigation and camera cache policies', () => {
    assert.match(source, /handler: 'NetworkFirst'/);
    assert.match(source, /cacheName: 'fwm-documents'/);
    assert.match(source, /url\.pathname === '\/cameras\/index\.json'/);
    assert.match(source, /cacheName: 'fwm-camera-generation-v1'/);
    assert.match(source, /networkTimeoutSeconds: 3/);
    assert.match(source, /searchParams\.get\('generation'\)/);
    assert.match(source, /actual === expected/);
    assert.match(source, /handler: 'StaleWhileRevalidate'/);
    assert.match(source, /cacheName: 'fwm-camera-tiles-v2'/);
  });

  it('caches requested same-origin glyphs and sprite indexes without precaching all ranges', () => {
    assert.match(source, /url\.pathname\.startsWith\('\/basemap-assets\/'\)/);
    assert.match(source, /url\.pathname\.endsWith\('\.pbf'\)/);
    assert.match(source, /url\.pathname\.endsWith\('\.json'\)/);
    assert.match(source, /cacheName: 'fwm-basemap-assets-v1'/);
    assert.match(source, /maxEntries: 800/);
    assert.match(source, /cacheWillUpdate/);
    assert.match(source, /JSON\.parse\(await clone\.text\(\)\)/);
    assert.match(source, /bytes\[0\] !== 0x3c/);
    assert.doesNotMatch(source, /globPatterns:\s*\[[^\]]*pbf/s);
  });

  it('gives the three archive sidecars the same generation policy as the tiles', () => {
    // What they DO is asserted in apps/pwa/src/services/cameras/swAdmission.test.ts,
    // against real Request and Response objects. This asserts they are wired in.
    assert.match(source, /urlPattern: isCameraSidecarRequest/);
    assert.match(source, /cacheWillUpdate: admitGenerationBoundResponse/);
    assert.match(source, /cacheName: 'fwm-camera-sidecars-v1'/);
    assert.match(source, /from '\.\/src\/services\/cameras\/swAdmission\.ts'/);
  });

  it('keeps the worker policy functions serialisable', () => {
    /*
     * WORKBOX COPIES THESE BY SOURCE TEXT, not by reference: the built worker
     * carries the function BODY, and any identifier it closes over is simply
     * absent there. An import or a module-level constant would compile, build,
     * ship, and then throw ReferenceError inside the worker on a phone, where
     * nothing is watching -- so the property that makes the copy safe is
     * asserted here rather than left to a reviewer to notice.
     */
    const code = admission.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /^\s*import\s/m, 'swAdmission.ts must import nothing');
    // Column zero only: a `const` inside a function body is a local, and every
    // one of these functions is expected to have some.
    assert.doesNotMatch(
      code,
      /^(?:export )?(?:const|let|var)\s/m,
      'swAdmission.ts must hold no module-level binding for a serialised function to reference',
    );
  });

  it('inlines those bodies into the built worker rather than their names', () => {
    // Only meaningful after a build. `pnpm build:pwa` produces dist/sw.js, and
    // the deploy script runs it; a clean checkout has nothing to assert on.
    if (!existsSync(builtWorkerUrl)) return;

    /*
     * A STALE dist IS NOT EVIDENCE EITHER, and this used to treat it as though
     * it were. `dist/sw.js` from before the sidecar route existed fails these
     * assertions with a 12 KB minified blob pasted into the output and nothing
     * saying which of "the code is wrong" or "your build is old" it means. It
     * cost a real debugging detour.
     *
     * Absent and stale are the same situation - there is no build of THIS
     * source to check - so they get the same answer, with a reason printed.
     */
    const builtAt = statSync(builtWorkerUrl).mtimeMs;
    const newestSource = Math.max(
      statSync(new URL('../apps/pwa/vite.config.ts', import.meta.url)).mtimeMs,
      statSync(admissionUrl).mtimeMs,
    );
    if (newestSource > builtAt) {
      console.log(
        'service-worker-policy: dist/sw.js is older than its sources; skipping the built-worker ' +
          'assertions. Run `pnpm build:pwa` to check them.',
      );
      return;
    }

    const worker = readFileSync(builtWorkerUrl, 'utf8');
    assert.match(worker, /fwm-camera-sidecars-v1/);
    assert.match(worker, /\(\?:overview\|counties\|places\)/);
    assert.doesNotMatch(worker, /isCameraSidecarRequest/);
    assert.doesNotMatch(worker, /admitGenerationBoundResponse/);
  });

  it('does not admit remote font origins or their retired caches', () => {
    assert.doesNotMatch(source, /fonts\.(?:googleapis|gstatic)\.com/);
    assert.doesNotMatch(source, /fwm-google-fonts/);
  });
});
