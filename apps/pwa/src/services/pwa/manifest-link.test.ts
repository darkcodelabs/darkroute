/**
 * THE MANIFEST LINK, AND THE ATTRIBUTE ON IT.
 *
 * =============================================================================
 * TWO SEPARATE BUGS, ONE SYMPTOM
 * =============================================================================
 * "The app cannot be installed" has been true here twice, for reasons that
 * look nothing alike and are invisible in exactly the same way.
 *
 *   1. The `<link rel="manifest">` was absent. The file was generated, deployed
 *      and served correctly with the right content type, and no browser ever
 *      asked for it, because nothing on the page said it existed.
 *
 *   2. The link was present but had no `crossorigin`. A manifest is fetched as
 *      a CORS request WITHOUT credentials, even same-origin. Behind Cloudflare
 *      Access that request carries no `CF_Authorization` cookie, so Access
 *      redirects it to the login host, which sends no
 *      `access-control-allow-origin`. The browser then reports a cross-origin
 *      failure for a file on the same origin. Measured on dev.darkroute.ai:
 *      the redirect's own JWT carried `auth_status: NONE`.
 *
 * Neither one fails a build, a typecheck, a test run or a deploy. Both end at
 * "add to home screen is missing" with nothing pointing at why, and the second
 * one takes the TWA with it, because an Android Trusted Web Activity wraps an
 * installable PWA and verifies Digital Asset Links against the manifest scope.
 *
 * Read from `index.html` rather than from a built page: this is a claim about
 * the source of truth, and the built copy is derived from it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** cwd is `apps/pwa` under `pnpm test:unit` and the repo root under `--root`. */
function indexHtml(): string {
  const found = ['index.html', 'apps/pwa/index.html']
    .map((rel) => resolve(process.cwd(), rel))
    .find((path) => existsSync(path));
  expect(found).toBeDefined();
  return readFileSync(found as string, 'utf8');
}

function manifestLink(): string {
  const html = indexHtml();
  const match = /<link[^>]*rel="manifest"[^>]*>/.exec(html);
  expect(match, 'no <link rel="manifest"> in index.html; the app cannot be installed').not.toBeNull();
  return match?.[0] ?? '';
}

describe('the manifest link', () => {
  it('is on the page at all', () => {
    expect(manifestLink()).toContain('rel="manifest"');
  });

  it('points at the file that is actually shipped', () => {
    // `public/manifest.webmanifest` is copied to the site root verbatim, so a
    // link to any other path is a 404 and an uninstallable app.
    expect(manifestLink()).toContain('href="/manifest.webmanifest"');
    const shipped = ['public/manifest.webmanifest', 'apps/pwa/public/manifest.webmanifest']
      .map((rel) => resolve(process.cwd(), rel))
      .find((path) => existsSync(path));
    expect(shipped, 'the manifest the link names does not exist').toBeDefined();
  });

  it('SENDS CREDENTIALS, so Access serves it instead of redirecting to login', () => {
    // The whole bug. Without this the fetch is anonymous, Access bounces it to
    // a host that sends no CORS header, and the install prompt never appears.
    expect(manifestLink()).toContain('crossorigin="use-credentials"');
  });

  it('does not use anonymous, which is the value that looks right and is not', () => {
    // `crossorigin="anonymous"` also satisfies "has a crossorigin attribute"
    // while still omitting the cookie, so it fails in exactly the same way.
    expect(manifestLink()).not.toContain('crossorigin="anonymous"');
  });
});
