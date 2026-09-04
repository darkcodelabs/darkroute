/**
 * THE PREFLIGHT - open the shipped page in a real browser and look at it.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * Three separate outages shipped green in one day. Every one of them passed the
 * full unit suite, the typecheck, the lint gate and the design-token check, and
 * every one of them was visible in one second to anybody holding the phone:
 *
 *   1. The dial rendered with NO STYLESHEET. `sweep.css` was imported by
 *      `SweepScreen.tsx`; RADAR absorbed SWEEP, stopped rendering that screen,
 *      and the dial shipped its full markup with no rules. A 406px rectangle of
 *      nothing.
 *
 *   2. The dial rendered with NO VARIABLES. Its component-scoped locals were
 *      declared on `.fwm-sweep`, the same dead screen root. The dot-matrix
 *      field had no lattice size, the scan beam had no duration. An unresolved
 *      CSS custom property is not an error -- it is an empty string, and the
 *      declaration is silently dropped.
 *
 *   3. The zone card rendered UNDER THE DOCK. Nothing reserved the dock's
 *      height, so the last card in the column lost its bottom 35px.
 *
 * None of the three is reachable from a DOM assertion. vitest runs with
 * `css: false` -- the stylesheet imports as the empty string -- so a jsdom test
 * cannot see a missing rule, a missing variable, or one element covering
 * another. The tests were not weak; they were the wrong instrument.
 *
 * This is the right one: a browser, the deployed URL, and questions about
 * PIXELS.
 *
 * =============================================================================
 * WHAT IT ASSERTS, AND WHY EACH ONE
 * =============================================================================
 *   paints        the dial is not a rectangle of background. Catches (1).
 *   lattice       the dot-matrix field is actually drawn. Catches (2), which a
 *                 plain "is anything painted" check would miss, because the
 *                 rings still drew while the field did not.
 *   sweeps        two captures a beat apart DIFFER. The scan beam is an
 *                 animation; a still frame cannot tell you it is running, and
 *                 the beam is the one element whose whole job is to move.
 *   unclipped     nothing in the column is hidden behind the dock. Catches (3).
 *   pinch         a two-finger gesture changes the range readout. The gesture
 *                 is the only zoom control left after the slider was removed,
 *                 so if it is dead the dial has no controls at all.
 *   quiet         no console errors, no page errors.
 *
 * =============================================================================
 * WHY IT RUNS AGAINST THE DEPLOYED URL
 * =============================================================================
 * A local dev server would test the code. This tests what a driver loads: the
 * built bundle, the service worker, the real headers, the CDN. Two of the three
 * outages above were only true of the deployed artefact.
 *
 * USAGE
 *   pnpm preflight                  # against the live dev URL
 *   pnpm preflight http://localhost:4173
 */

import { chromium } from '@playwright/test'

const LIVE_URL = 'https://dev.darkroute.ai'
const target = (process.argv[2] ?? LIVE_URL).replace(/\/$/, '')

/** iPhone-ish. The design is drawn for a phone in a car mount. */
const VIEWPORT = { width: 393, height: 852 }
const AT = { latitude: 38.9178, longitude: -94.6921 }

/** Below this share of non-background pixels, the dial is not really drawn. */
const MIN_PAINTED = 0.04
/** How long to wait between the two beam captures. The scan is 2.4s. */
const BEAM_GAP_MS = 700
/** Two frames of an animation must differ by at least this share of pixels. */
const MIN_BEAM_DELTA = 0.002

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`)
}

/**
 * Share of pixels in a PNG buffer that differ from its most common colour.
 *
 * Decoded by hand rather than with a dependency: this reads the raw RGBA the
 * browser hands back for a clip, so there is no PNG parsing to do and no image
 * library to add to a repo that has none.
 */
function paintedShare(pixels) {
  const counts = new Map()
  for (let i = 0; i < pixels.length; i += 4) {
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let dominant = 0
  let best = 0
  for (const [key, n] of counts) {
    if (n > best) { best = n; dominant = key }
  }
  const total = pixels.length / 4
  const dr = (dominant >> 16) & 255, dg = (dominant >> 8) & 255, db = dominant & 255
  let painted = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i] - dr) > 10 || Math.abs(pixels[i + 1] - dg) > 10 || Math.abs(pixels[i + 2] - db) > 10) {
      painted += 1
    }
  }
  return { painted: painted / total, distinct: counts.size }
}

function differingShare(a, b) {
  if (a.length !== b.length) return 1
  let diff = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) {
      diff += 1
    }
  }
  return diff / (a.length / 4)
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  permissions: ['geolocation'],
  geolocation: AT,
})
const page = await context.newPage()

const noise = []
page.on('console', (m) => { if (m.type() === 'error') noise.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => noise.push(`pageerror: ${e.message.slice(0, 200)}`))

process.stdout.write(`preflight ${target}\n\n`)

// `?screen=radar` is an explicit request, which the first-run gate honours --
// so this lands on the screen under test rather than on onboarding.
await page.goto(`${target}/?screen=radar`, { waitUntil: 'networkidle' })
// The camera tiles are fetched after the first fix arrives; the dial has
// nothing to draw until then.
await page.waitForTimeout(9_000)

/** Raw RGBA for one element, via the browser's own canvas. */
async function grab(selector) {
  const clip = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }, selector)
  if (clip === null || clip.width === 0) return null
  const shot = await page.screenshot({ clip, type: 'png' })
  // Decode via the page: no image dependency in this repo.
  return page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    const bmp = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    return Array.from(ctx.getImageData(0, 0, bmp.width, bmp.height).data)
  }, Array.from(shot))
}

// --- 1. the dial paints at all -------------------------------------------
const dialPixels = await grab('.fwm-sweep-dial')
if (dialPixels === null) {
  check('paints', false, 'no .fwm-sweep-dial on the page')
} else {
  const { painted, distinct } = paintedShare(Uint8Array.from(dialPixels))
  check(
    'paints',
    painted >= MIN_PAINTED,
    `${(painted * 100).toFixed(1)}% of the dial is non-background, ${String(distinct)} colours`,
  )
}

// --- 2. the dot-matrix field is drawn ------------------------------------
// Asked of the field layer specifically. The rings kept drawing when the
// lattice did not, so "the dial paints" was true while the look was gone.
const fieldLattice = await page.evaluate(() => {
  const field = document.querySelector('.fwm-sweep-field')
  if (field === null) return { present: false }
  const cs = getComputedStyle(field)
  const dial = document.querySelector('.fwm-sweep-dial')
  const grid = getComputedStyle(dial).getPropertyValue('--fwm-sweep-grid').trim()
  return {
    present: true,
    // An unresolved var() leaves `background-image: none` behind.
    hasImage: cs.backgroundImage !== 'none' && cs.backgroundImage !== '',
    // A resolved lattice cell. Empty string is the exact failure mode.
    grid,
    size: cs.backgroundSize,
  }
})
check(
  'lattice',
  fieldLattice.present && fieldLattice.hasImage && fieldLattice.grid !== '',
  fieldLattice.present
    ? `--fwm-sweep-grid="${fieldLattice.grid}" background-size=${fieldLattice.size}`
    : 'no .fwm-sweep-field',
)

// --- 3. the scan beam actually sweeps ------------------------------------
const beamDur = await page.evaluate(() => {
  const beam = document.querySelector('.fwm-sweep-beam')
  return beam === null ? null : getComputedStyle(beam).animationDuration
})
const beamA = await grab('.fwm-sweep-dial')
await page.waitForTimeout(BEAM_GAP_MS)
const beamB = await grab('.fwm-sweep-dial')
const delta =
  beamA === null || beamB === null
    ? 0
    : differingShare(Uint8Array.from(beamA), Uint8Array.from(beamB))
check(
  'sweeps',
  delta >= MIN_BEAM_DELTA && beamDur !== null && beamDur !== '0s',
  `animation-duration=${String(beamDur)}, ${(delta * 100).toFixed(2)}% of pixels moved in ${String(BEAM_GAP_MS)}ms`,
)

// --- 4. nothing is hidden behind the dock --------------------------------
const clipping = await page.evaluate(() => {
  const dock = document.querySelector('.fwm-dock-bar')
  if (dock === null) return { checked: false }
  const dockTop = dock.getBoundingClientRect().top
  const hidden = []
  for (const sel of ['.fwm-radar-zone', '.fwm-sweep-dial', '.fwm-radar-tiles']) {
    const el = document.querySelector(sel)
    if (el === null) continue
    const r = el.getBoundingClientRect()
    if (r.bottom > dockTop + 1) hidden.push(`${sel} overlaps the dock by ${String(Math.round(r.bottom - dockTop))}px`)
  }
  return { checked: true, hidden }
})
check(
  'unclipped',
  clipping.checked && clipping.hidden.length === 0,
  clipping.hidden?.join('; ') || 'nothing runs under the dock',
)

// --- 5. pinch still zooms -------------------------------------------------
// The slider is gone, so this gesture is the dial's only range control.
const rangeBefore = await page.evaluate(
  () => document.querySelector('[data-fwm-sweep-ring-label]')?.textContent ?? null,
)
const pinched = await page.evaluate(async () => {
  const dial = document.querySelector('.fwm-sweep-dial')
  if (dial === null) return false
  const r = dial.getBoundingClientRect()
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  const touch = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: id === 1, bubbles: true })
  const send = (type, init) => dial.dispatchEvent(new PointerEvent(type, init))

  send('pointerdown', touch(1, cx - 30, cy))
  send('pointerdown', touch(2, cx + 30, cy))
  // Fingers apart: a wider spread asks for a shorter range.
  for (let step = 1; step <= 6; step += 1) {
    send('pointermove', touch(1, cx - 30 - step * 12, cy))
    send('pointermove', touch(2, cx + 30 + step * 12, cy))
    await new Promise((r2) => setTimeout(r2, 16))
  }
  send('pointerup', touch(1, cx - 102, cy))
  send('pointerup', touch(2, cx + 102, cy))
  return true
})
await page.waitForTimeout(400)
const rangeAfter = await page.evaluate(
  () => document.querySelector('[data-fwm-sweep-ring-label]')?.textContent ?? null,
)
check(
  'pinch',
  pinched && rangeBefore !== null && rangeAfter !== rangeBefore,
  `ring label ${String(rangeBefore)} -> ${String(rangeAfter)}`,
)

// --- 6. the console is quiet ---------------------------------------------
check('quiet', noise.length === 0, noise.slice(0, 3).join(' | ') || 'no console or page errors')

await browser.close()

const failed = results.filter((r) => !r.ok)
process.stdout.write(`\n${String(results.length - failed.length)}/${String(results.length)} passed\n`)
if (failed.length > 0) {
  process.stderr.write(`\npreflight failed: ${failed.map((f) => f.name).join(', ')}\n`)
  process.exit(1)
}
