#!/usr/bin/env node
/**
 * DOES THE CAMERA CARD'S MINI MAP ACTUALLY DRAW, AND DOES IT STAY IN ITS BOX?
 *
 * The sibling of `check-map-render.mjs`, and for the same reason: the picture
 * lives in a WebGL context, so no unit test can see it and a screenshot of a
 * working map and a broken one are the same rectangle. This opens a real card
 * by tapping a real camera and reads the geometry back off the DOM.
 *
 * What it checks, at 320 / 390 / 430 CSS px -- the narrowest phone this ships
 * to, the reference phone, and the widest:
 *
 *   - the picture is drawn and is INSIDE the hero it sits in
 *   - the page does not scroll sideways because of it
 *   - the caption says what the ground is: an attribution, or that nothing is
 *     cached here. Never a spinner, never a lie
 *   - a wheel over the picture scrolls the CARD. A map that swallows a gesture
 *     inside a scrolling card has broken the card
 *   - `prefers-reduced-motion` leaves it with no transition to run
 *
 * USAGE
 *   node scripts/check-minimap.mjs [http://localhost:4478]
 *
 * TWO THINGS TO KNOW BEFORE THE RESULT MEANS ANYTHING:
 *
 *   THE BUILD DELETES `dist/cameras`. Tiles are served from R2 by
 *   `functions/cameras/[[path]].ts` in production, so a `vite preview` has no
 *   cameras to tap and this script cannot open a card at all. Copy them back
 *   for the run: `cp -r apps/pwa/public/cameras apps/pwa/dist/cameras`.
 *
 *   THE ARCHIVE MUST ALLOW THIS ORIGIN. The production bucket does not send
 *   CORS headers for `localhost`, so a default local build gets no basemap and
 *   every reading below is the honest DEGRADE case rather than the drawn one.
 *   Build against a local archive to see ground:
 *   `VITE_FWM_BASEMAP_URL=http://localhost:4479/<archive>.pmtiles npx vite build`.
 *
 * Exit code 1 on any failed check.
 */
import { chromium } from '@playwright/test';

const target = process.argv[2] ?? 'http://localhost:4478';
const WIDTHS = [320, 390, 430];
/** Overland Park, which is where the shipped archive is densest. */
const AT = { latitude: 38.9183, longitude: -94.692 };

let failures = 0;

function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

/**
 * Tap a camera and wait for its card.
 *
 * The dot has to be ABOVE the DRIVE cards, which overlay the lower half of the
 * screen and would otherwise take the tap -- which is exactly what they did the
 * first time this script was written.
 */
async function openCard(page) {
  const moved = await page.evaluate(() => {
    const map = globalThis.__fwmMapInstance;
    if (!map) return 'no map';
    const camera = map
      .querySourceFeatures('fwm-cameras')
      .find((f) => typeof f.properties?.id === 'string');
    if (!camera) return 'no cameras';
    map.jumpTo({ center: camera.geometry.coordinates, zoom: 16 });
    map.panBy([0, 240], { duration: 0 });
    return 'ok';
  });
  if (moved !== 'ok') throw new Error(moved);
  await page.waitForTimeout(1200);
  const at = await page.evaluate(() => {
    const map = globalThis.__fwmMapInstance;
    const hit = map
      .queryRenderedFeatures(undefined, { layers: ['fwm-camera-hit'] })
      .find((f) => typeof f.properties?.id === 'string');
    if (!hit) return null;
    const point = map.project(hit.geometry.coordinates);
    return { x: point.x, y: point.y };
  });
  if (at === null) throw new Error('no rendered camera to tap');
  const started = Date.now();
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.fwm-intelv1', { timeout: 6000 });
  await page
    .waitForSelector('.fwm-minimap[data-fwm-ground="ground"], .fwm-minimap[data-fwm-ground="bare"]', {
      timeout: 9000,
    })
    .catch(() => null);
  return Date.now() - started;
}

for (const width of WIDTHS) {
  const context = await browser.newContext({
    // The service worker's navigation fallback answers `/cameras/*.json` with
    // index.html in a preview build, which leaves the map with no cameras.
    serviceWorkers: 'block',
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    permissions: ['geolocation'],
    geolocation: AT,
  });
  const page = await context.newPage();
  await page.goto(`${target}/?screen=radar`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const ms = await openCard(page);
  const read = await page.evaluate(() => {
    const figure = document.querySelector('.fwm-minimap');
    const hero = document.querySelector('.fwm-intelv1-hero');
    const card = document.querySelector('.fwm-intelv1');
    if (figure === null || hero === null || card === null) return null;
    const f = figure.getBoundingClientRect();
    const h = hero.getBoundingClientRect();
    return {
      ground: figure.getAttribute('data-fwm-ground'),
      note: document.querySelector('.fwm-minimap-note')?.textContent ?? '',
      cones: document.querySelectorAll('.fwm-minimap-cone').length,
      dots: document.querySelectorAll('.fwm-minimap-dot').length,
      label: document.querySelector('.fwm-minimap-mark')?.getAttribute('aria-label') ?? '',
      box: { w: Math.round(f.width), h: Math.round(f.height) },
      insideHero: f.right <= h.right + 0.5 && f.left >= h.left - 0.5,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cardOverflowX: card.scrollWidth - card.clientWidth,
      cardScrollTop: card.scrollTop,
      centre: { x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2) },
    };
  });

  console.log(`\n=== ${String(width)} CSS px === (card + picture in ${String(ms)} ms)`);
  if (read === null) {
    check('the card and its picture are on screen', false, 'no .fwm-minimap');
    await context.close();
    continue;
  }
  console.log(`   ground=${read.ground} note=${JSON.stringify(read.note)} box=${read.box.w}x${read.box.h}`);
  check('the picture is inside the hero', read.insideHero);
  check('the page does not scroll sideways', read.pageOverflowX === 0, `overflow ${String(read.pageOverflowX)}px`);
  check('the card does not scroll sideways', read.cardOverflowX === 0, `overflow ${String(read.cardOverflowX)}px`);
  check('the camera is marked', read.dots === 1);
  check(
    'the caption says what the ground is',
    read.ground === 'ground' ? read.note.includes('OpenStreetMap') : read.note.length > 0,
  );
  check('the mark is labelled for a screen reader', read.label.includes('camera position'));

  // A wheel over the picture must move the CARD, not the map.
  await page.mouse.move(read.centre.x, read.centre.y);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(400);
  const scrolled = await page.evaluate(
    () => document.querySelector('.fwm-intelv1')?.scrollTop ?? 0,
  );
  check('a wheel over the picture scrolls the card', scrolled > read.cardScrollTop, `scrollTop ${String(Math.round(scrolled))}`);

  // The counterpart to the reduced-motion check at the bottom: with no
  // preference expressed, the ground IS supposed to fade up, so a `pending`
  // canvas must be transparent. Without this the check below would pass on a
  // build where the fade had simply been deleted.
  if (width === 390) {
    const fade = await page.evaluate(async () => {
      const figure = document.querySelector('.fwm-minimap');
      const canvas = figure?.querySelector('.maplibregl-canvas') ?? null;
      if (figure === null || canvas === null) return null;
      const settled = figure.getAttribute('data-fwm-ground');
      figure.setAttribute('data-fwm-ground', 'pending');
      // A TRANSITION HAS TO BE WAITED OUT. `getComputedStyle` returns the value
      // the animation is CURRENTLY at, so reading it on the next line reports
      // the opacity the canvas is leaving rather than the one it is heading to.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const pending = getComputedStyle(canvas).opacity;
      figure.setAttribute('data-fwm-ground', settled ?? 'ground');
      return pending;
    });
    check('the ground fades up when no preference is expressed', fade === '0', `pending opacity ${String(fade)}`);
  }

  await context.close();
}

// ---------------------------------------------------------------------------
// Reduced motion: nothing may animate in.
// ---------------------------------------------------------------------------
const still = await browser.newContext({
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  permissions: ['geolocation'],
  geolocation: AT,
});
const stillPage = await still.newPage();
await stillPage.goto(`${target}/?screen=radar`, { waitUntil: 'domcontentloaded' });
await stillPage.waitForTimeout(9000);
await openCard(stillPage);
/**
 * WHAT "DOES NOT ANIMATE IN" IS ACTUALLY TESTED BY.
 *
 * Not the transition duration: `global.css` puts `transition-duration:
 * var(--fwm-dur-instant) !important` on every element in the app under reduced
 * motion, so 90 ms is the answer everywhere and it says nothing about this
 * component. What matters is whether the canvas STARTS INVISIBLE -- if it does
 * not, there is no opacity change for any duration to animate.
 *
 * So the ground state is forced back to `pending` and the opacity read: 0 means
 * a fade is set up, 1 means there is nothing to fade.
 */
const readFade = async () => {
  const figure = document.querySelector('.fwm-minimap');
  const canvas = figure?.querySelector('.maplibregl-canvas') ?? null;
  if (figure === null || canvas === null) return null;
  const was = figure.getAttribute('data-fwm-ground');
  figure.setAttribute('data-fwm-ground', 'pending');
  // Long enough for a fade to have finished if one were declared -- see the
  // note on the same wait in the no-preference check above.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const pending = getComputedStyle(canvas).opacity;
  figure.setAttribute('data-fwm-ground', was ?? 'ground');
  return { pending, settled: getComputedStyle(canvas).opacity };
};
const motion = await stillPage.evaluate(readFade);
console.log(`\n=== prefers-reduced-motion: reduce ===`);
console.log(`   ${JSON.stringify(motion)}`);
check('the ground does not fade in', motion?.pending === '1', `pending opacity ${String(motion?.pending)}`);
check('and it is not left invisible either', motion?.settled === '1');
await still.close();

await browser.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
