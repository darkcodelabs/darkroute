/**
 * DOES THE BASEMAP ACTUALLY DRAW ROADS?
 *
 * The map has never rendered one: MapCanvas passed a .pmtiles URL where a style
 * document belongs. A screenshot cannot answer this -- MapLibre builds its GL
 * context without preserveDrawingBuffer, so a working map and a broken one read
 * back as the same black rectangle. So ask the map what it painted.
 */
import { chromium } from '@playwright/test';
const args = process.argv.slice(2);
const target = (
  args.find((argument) => !argument.startsWith('--')) ?? 'http://localhost:4199'
).replace(/\/$/, '');
const requireCameras = args.includes('--require-cameras');
const b = await chromium.launch();
const c = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  permissions: ['geolocation'],
  geolocation: { latitude: 38.9183, longitude: -94.692 },
});
const p = await c.newPage();
const errs = [],
  reqs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
// MapLibre reports a failed source through the console and an `error` event,
// not by throwing -- so listening only for pageerror sees a silent map.
p.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    errs.push(m.type() + ': ' + m.text().slice(0, 220));
});
p.on('requestfailed', (r) =>
  reqs.push(`FAIL ${r.url().slice(0, 100)} ${r.failure()?.errorText ?? ''}`),
);
p.on('response', (r) => {
  if (r.status() >= 400) reqs.push(`${r.status()} ${r.url().slice(0, 110)}`);
});
await p.goto(`${target}/?screen=radar&map=1`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(20_000);

// `rendered` and `layers` are no longer published on the attribute -- three
// whole-viewport queries per settle, on a driver's phone, so that this script
// could read them off a string. It asks the map for them itself a few lines
// down, which is where the numbers below come from now.
const out = await p.evaluate(() => {
  const el = document.querySelector('[data-fwm-map]');
  const raw = el?.getAttribute('data-fwm-map');
  // `__fwmMap` has never existed. `hasHandle` has therefore always been false,
  // and the handle it meant to test is the one every probe below uses.
  const m = globalThis.__fwmMapInstance;
  return { raw, hasHandle: Boolean(m) };
});
const state = out.raw ? JSON.parse(out.raw) : null;
console.log(
  'map state:',
  state
    ? JSON.stringify({ zoom: state.zoom, centre: state.centre, cameras: state.cameras })
    : 'ABSENT',
);
console.log('map handle:', out.hasHandle ? 'present' : 'MISSING');

// The real question: are BASEMAP features on screen?
const reqDetail = await p.evaluate(() =>
  performance
    .getEntriesByType('resource')
    .filter((e) => e.name.includes('8790') || e.name.includes('basemap.json'))
    .map((e) => `${e.name.slice(-46)} ${Math.round(e.transferSize || 0)}B`),
);
console.log('archive/manifest requests:', reqDetail.length);
for (const r of reqDetail.slice(0, 6)) console.log('   ', r);

// Ask the MAP what basemap features it has, which is the only real answer.
const src = await p.evaluate(() => {
  const m = globalThis.__fwmMapInstance;
  if (!m) return 'no handle';
  try {
    const style = m.getStyle();
    const s = m.getSource('basemap');
    return {
      styleSources: Object.keys(style?.sources ?? {}),
      sourceUrl: style?.sources?.basemap?.url,
      sourceType: style?.sources?.basemap?.type,
      loaded: typeof m.isSourceLoaded === 'function' ? m.isSourceLoaded('basemap') : 'n/a',
      hasTiles: Boolean(s && s.tiles),
      styleLoaded: m.isStyleLoaded?.(),
      zoom: m.getZoom(),
      bounds: m.getBounds?.()?.toArray?.(),
    };
  } catch (e) {
    return 'ERR ' + String(e).slice(0, 160);
  }
});
console.log('source state:', JSON.stringify(src));

const roads = await p.evaluate(() => {
  const m = globalThis.__fwmMapInstance;
  if (!m) return 'no map handle exposed';
  try {
    const q = m.querySourceFeatures('basemap', { sourceLayer: 'roads' });
    const r = m.queryRenderedFeatures(undefined);
    const kinds = {};
    for (const f of q.slice(0, 400)) {
      const k = f.properties?.kind ?? '?';
      kinds[k] = (kinds[k] || 0) + 1;
    }
    return { sourceRoads: q.length, renderedAny: r.length, kinds };
  } catch (e) {
    return 'ERR ' + String(e).slice(0, 120);
  }
});
console.log('basemap roads:', JSON.stringify(roads));

// THE PRODUCT. Roads without cameras is a map, not this app. The source can
// hold 979 records while the GL source holds zero -- that exact split shipped.
const cams = await p.evaluate(() => {
  const m = globalThis.__fwmMapInstance;
  if (!m) return 'no handle';
  try {
    const src = m.querySourceFeatures('fwm-cameras');
    return {
      sourceFeatures: src.length,
      clusters: src.filter((f) => f.properties?.cluster).length,
      points: src.filter((f) => !f.properties?.cluster).length,
      rendered: m.queryRenderedFeatures(undefined, {
        layers: ['fwm-camera-points', 'fwm-camera-clusters'],
      }).length,
      // Was published on the `data-fwm-map` attribute until that cost a style
      // walk per map settle on every driver's phone. Asked for directly here,
      // which is where every other number on this line already comes from.
      styleLayers: m.getStyle().layers.length,
    };
  } catch (e) {
    return 'ERR ' + String(e).slice(0, 140);
  }
});
console.log('CAMERAS ON MAP:', JSON.stringify(cams));

const painted = await p.evaluate(() => {
  const canvas = document.querySelector('.maplibregl-canvas');
  if (!canvas) return { error: 'no canvas' };
  return { w: canvas.width, h: canvas.height };
});
console.log('canvas:', JSON.stringify(painted));

// Third-party asset leak check: every request must be same-origin or localhost.
const offOrigin = [];
p.on('request', () => {});
const urls = await p.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
for (const u of urls) {
  try {
    const h = new URL(u).host;
    // FIRST PARTY = the app's own origin and our tiles bucket. Anything else is
    // a third party learning that this device is looking at a map.
    if (!/^localhost:|^127\.0\.0\.1:|^tiles\.darkroute\.ai$/.test(h)) offOrigin.push(h);
  } catch {}
}
console.log('off-origin hosts:', offOrigin.length ? [...new Set(offOrigin)].join(', ') : 'NONE');
const glyphs = urls.filter((u) => /basemap-assets\/fonts/.test(u)).length;
const sprites = urls.filter((u) => /basemap-assets\/sprites/.test(u)).length;
console.log(`self-hosted assets fetched: ${glyphs} glyph range(s), ${sprites} sprite file(s)`);
if (errs.length) console.log('page errors:', errs.slice(0, 4).join(' | '));
if (reqs.length) console.log('failed requests:', reqs.slice(0, 5).join(' | '));

/*
 * EXIT LIKE A GATE, NOT LIKE A SCREENSHOT.
 *
 * This script used to print the exact `Unexpected token '<'` and missing
 * shield failures reported by MapLibre and then exit zero. That made the
 * comment calling it a regression check untrue. Ignore browser/driver noise,
 * but fail on the map contracts this probe exists to establish.
 */
const fatal = [];
if (!out.hasHandle) fatal.push('MapLibre handle is absent');
if (typeof src !== 'object' || src === null) {
  fatal.push(`basemap source inspection failed: ${String(src)}`);
} else {
  if (src.styleLoaded !== true) fatal.push('style did not become ready');
  if (src.loaded !== true) fatal.push('basemap source did not finish loading');
}
if (typeof roads !== 'object' || roads === null || roads.sourceRoads < 1) {
  fatal.push(`no basemap road features were decoded: ${JSON.stringify(roads)}`);
}
if (glyphs < 1) fatal.push('the rendered view fetched no self-hosted glyph range');
if (sprites < 2) fatal.push('the rendered view did not fetch both sprite index and image');
if (offOrigin.length > 0)
  fatal.push(`unexpected asset hosts: ${[...new Set(offOrigin)].join(', ')}`);

const mapError = /Unexpected token|could not be loaded|Unimplemented type|Invalid sprite/i;
for (const error of errs.filter((message) => mapError.test(message))) fatal.push(error);
for (const request of reqs.filter((message) =>
  /basemap-assets|tiles\.darkroute\.ai/i.test(message),
)) {
  fatal.push(request);
}
if (requireCameras && (typeof cams !== 'object' || cams === null || cams.sourceFeatures < 1)) {
  fatal.push(`the deployed camera source is empty: ${JSON.stringify(cams)}`);
}

if (fatal.length > 0) {
  console.error(`MAP PREFLIGHT FAILED (${fatal.length})`);
  for (const problem of fatal) console.error(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log('MAP PREFLIGHT PASSED');
}
await b.close();
