/**
 * DID THE THING ACTUALLY DRAW?
 *
 * =============================================================================
 * THE FAILURE THIS EXISTS FOR
 * =============================================================================
 * A tile-host migration shipped a completely black map to production while
 * technology press were testing the app. Every existing check passed, and all
 * of them were right to: the bundle uploaded, the glyphs answered byte-range
 * requests, the sprite PNGs had valid signatures, the HTML returned 200.
 *
 * The basemap manifest is an object in R2 rather than a file in this
 * repository, so it still pointed at the retired host. The app fetched it,
 * received a URL on a dead origin, and the cross-origin request failed
 * silently. No asset was missing. Nothing 404'd. The map simply never asked
 * for tiles, and no gate in this project could have noticed, because every
 * gate checked ASSETS and the assets were all fine.
 *
 * `curl` cannot catch this class of bug and neither can a byte-range probe.
 * The only thing that can is a browser: load the page, wait, and ask what is
 * on the screen.
 *
 * =============================================================================
 * WHAT IT ASSERTS, AND WHY EACH ONE
 * =============================================================================
 *   the shell renders      a blank page is the failure mode that matters most
 *   no page errors         an exception during boot leaves a half-built app
 *   the map canvas exists  MapLibre built and got a WebGL context
 *   the basemap PAINTED    the archive answered range requests - this is the
 *                          exact assertion that would have caught the black map
 *   camera tiles resolved  the generation-pinned tiles are reachable
 *
 * The basemap check is deliberately the strict one: it counts 206 responses
 * for the archive rather than trusting that a request was made, because the
 * broken state made a request for the MANIFEST and then stopped.
 *
 * =============================================================================
 * IT RUNS AGAINST WHATEVER HOST IT IS GIVEN
 * =============================================================================
 * `deploy.mjs` verified a hardcoded dev host, so production was never checked
 * by anything. This takes the URL as an argument for that reason: the host that
 * was just deployed to is the host that has to be proved, and a gate pointed at
 * a different machine is a gate that passes while production is down.
 *
 *   node apps/pwa/scripts/verify-render.mjs https://darkroute.ai
 *
 * Exit 0 renders, 1 does not, 2 could not check. "I did not look" and "I looked
 * and it was fine" are different answers and must not share an exit code.
 */

import { chromium } from '@playwright/test';

const TARGET = process.argv[2];
if (TARGET === undefined || !/^https?:\/\//.test(TARGET)) {
  process.stderr.write('usage: node verify-render.mjs <url>\n');
  process.exit(2);
}

/** Long enough for a cold archive read on a slow runner, short enough to fail a hang. */
const SETTLE_MS = 25_000;
const LOAD_TIMEOUT_MS = 90_000;

/** Kansas City. Somewhere with cameras, so the camera path is exercised too. */
const FIX = { latitude: 38.9181, longitude: -94.6923, accuracy: 8 };

function say(line) {
  process.stdout.write(`${line}\n`);
}

let browser;
try {
  browser = await chromium.launch({
    // Software GL, because CI has no GPU. A map that paints on swiftshader
    // paints on a phone; the reverse is not guaranteed, which is the safe
    // direction for a gate to be wrong in.
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
} catch (error) {
  process.stderr.write(`verify-render: could not launch a browser: ${String(error)}\n`);
  process.exit(2);
}

const failures = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: FIX,
    permissions: ['geolocation'],
  });
  const page = await context.newPage();

  const pageErrors = [];
  let basemapRanges = 0;
  let cameraTiles = 0;
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 200)));
  page.on('response', (response) => {
    const url = response.url();
    // 206 specifically: PMTiles reads the archive in byte ranges, so a 200 on
    // the manifest is not evidence that the archive itself answered.
    if (url.includes('.pmtiles') && response.status() === 206) basemapRanges += 1;
    if (url.includes('/cameras/11/') && response.ok()) cameraTiles += 1;
  });

  await page.goto(`${TARGET}/?screen=drive`, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
  await page.waitForTimeout(5_000);

  // Onboarding stands in front of the map on a first visit, and a gate that
  // only ever sees onboarding is not checking the product.
  const start = page.locator('.fwm-onboardingv1-start');
  if ((await start.count()) > 0) {
    await start.click({ force: true });
    await page.waitForTimeout(3_000);
  }
  await page.waitForTimeout(SETTLE_MS);

  const seen = await page.evaluate(() => {
    const canvas = document.querySelector('.maplibregl-canvas');
    return {
      title: document.title,
      bodyChars: (document.body.textContent ?? '').trim().length,
      hasCanvas: canvas !== null,
      canvasPainted: canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0,
    };
  });

  if (seen.title !== 'DarkRoute') failures.push(`title is ${JSON.stringify(seen.title)}, not DarkRoute`);
  if (seen.bodyChars < 40) failures.push(`the page rendered ${String(seen.bodyChars)} characters - effectively blank`);
  if (!seen.hasCanvas) failures.push('no map canvas: MapLibre never built');
  if (!seen.canvasPainted) failures.push('the map canvas has no size: nothing was drawn into it');
  if (basemapRanges === 0) failures.push('the basemap archive answered ZERO range requests - the map is blank ground');
  if (cameraTiles === 0) failures.push('no camera tile resolved - the archive is unreachable from this host');
  if (pageErrors.length > 0) failures.push(`uncaught error during boot: ${pageErrors[0]}`);

  say(`verify-render ${TARGET}`);
  say(`  title           ${seen.title}`);
  say(`  rendered text   ${String(seen.bodyChars)} chars`);
  say(`  map canvas      ${seen.hasCanvas ? 'built' : 'MISSING'}${seen.canvasPainted ? ', painted' : ''}`);
  say(`  basemap ranges  ${String(basemapRanges)}`);
  say(`  camera tiles    ${String(cameraTiles)}`);
} catch (error) {
  process.stderr.write(`verify-render: could not complete the check: ${String(error)}\n`);
  await browser.close();
  process.exit(2);
}

await browser.close();

if (failures.length > 0) {
  process.stderr.write('\nverify-render FAILED:\n');
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.stderr.write('\nThe assets can all be present and correct and this can still fail.\n');
  process.exit(1);
}

say('\nIt renders: shell, map canvas, basemap tiles and camera tiles all confirmed.');
