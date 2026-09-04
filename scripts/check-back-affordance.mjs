/**
 * CAN THE DRIVER GET OFF THIS SCREEN?
 *
 * THE BUG THIS EXISTS FOR
 *   SETTINGS, OFFLINE, DOCS, HELP, LOOK UP, ASK, ALERT DIET and ADMIN were
 *   reachable and had nothing on them that went anywhere. INTEL's "no camera
 *   selected" state was worse: it returned above its own header, so the `‹` the
 *   loaded card draws was not there at all.
 *
 *   Every one of those screens passed its own test suite, because every test
 *   renders one screen and asks about that screen's job. Nothing asked whether
 *   the set of screens is navigable. `check-text-fits.mjs` exists for the same
 *   class of defect one axis over - it measures whether text fits, this
 *   measures whether you can leave.
 *
 * WHAT IT CHECKS, PER SCREEN
 *   the control EXISTS in the rendered DOM;
 *   it is a <button>, so it is reachable by keyboard and by assistive tech;
 *   it has an ACCESSIBLE NAME, because a bare `‹` announces as "button";
 *   it is at least 44 CSS px on BOTH axes - the design system's own minimum,
 *     `--fwm-touch-min`;
 *   it is inside the viewport with a non-zero box;
 *   and clicking it ACTUALLY LANDS on the screen it claims. A control that
 *     exists, is named, and no-ops is the worst of the three failures because
 *     it looks fixed.
 *
 * WHY IT MEASURES AT SEVERAL WIDTHS AND TEXT SCALES
 *   The 44px promise is a token, and a header is a flex row: a long screen
 *   title at 150% text on a 320px phone is exactly the situation in which a
 *   flex child gets squeezed under its minimum. `flex: none` in `nav.css` is
 *   what stops that, and this is what proves it.
 *
 * A DOCK ROOT IS CHECKED FOR THE OPPOSITE THING
 *   DRIVE, LOG, MESH and MORE are v1's dock keys. Back from a root could only
 *   point at the root, so those screens must draw NO back key, and a stray one
 *   there is a finding too.
 *
 * USAGE
 *   npx vite build && npx vite preview --outDir dist --port 4199   (apps/pwa)
 *   node scripts/check-back-affordance.mjs [http://localhost:4199]
 */

import { chromium } from '@playwright/test'

const target = process.argv[2] ?? 'http://localhost:4199'

/** Narrowest first: that is where a flex row squeezes a fixed control. */
const VIEWPORTS = [
  { name: '320x568 (SE)', width: 320, height: 568 },
  { name: '390x844 (13/14)', width: 390, height: 844 },
  { name: '430x932 (Pro Max)', width: 430, height: 932 },
]

/**
 * 1.0 and the 1.5 ceiling SETTINGS offers. The middle step is omitted on
 * purpose: this measures a control that is sized in a token rather than in its
 * own label, so the interesting question is whether the ceiling moves it at
 * all, not where the gradient bends.
 */
const TEXT_SCALES = [1, 1.5]

/** Matches BASE_FONT_PX in apps/pwa/src/app/textScale.ts. */
const BASE_FONT_PX = 16

/** `--fwm-touch-min` at its phone value. The control may be bigger, never less. */
const MIN_TOUCH_PX = 44

/**
 * Every v1 screen that is not a dock root, and the screen its arrow claims.
 *
 * INTEL is here at `radar` because `?screen=intel` cold has no camera selected
 * and nothing to close - see the empty-state comment in `IntelViewV1.tsx`. The
 * LOADED card's dismiss is a handler rather than a screen id and is opened by
 * tapping the map further down.
 */
const EXPECT_BACK = {
  settings: 'more',
  offline: 'more',
  docs: 'more',
  help: 'more',
  lookup: 'more',
  ask: 'more',
  triage: 'more',
  admin: 'more',
  misuse: 'more',
  intel: 'radar',
}

/** v1's four dock keys. */
const EXPECT_NO_BACK = ['radar', 'log', 'node', 'more']

const findings = []

/** Read the back key's shape out of the page, or null when there is none. */
const MEASURE = () => {
  const el = document.querySelector('.fwm-backkey')
  if (el === null) return null
  const box = el.getBoundingClientRect()
  return {
    tag: el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label'),
    to: el.getAttribute('data-fwm-back-to'),
    width: Math.round(box.width * 10) / 10,
    height: Math.round(box.height * 10) / 10,
    onScreen: box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight,
  }
}

/** Everything wrong with one measurement, as sentences. */
function faultsIn(found, destination) {
  if (found === null) return ['no back control in the DOM']
  const faults = []
  if (found.tag !== 'button') faults.push(`is a <${found.tag}>, not a button`)
  if (found.name === null || found.name.trim() === '') faults.push('has no accessible name')
  if (found.name !== null && found.name.trim().toLowerCase() === 'back')
    faults.push('is named "back", which names a direction and not a destination')
  if (destination !== null && found.to !== destination)
    faults.push(`points at ${String(found.to)}, expected ${destination}`)
  if (found.width < MIN_TOUCH_PX || found.height < MIN_TOUCH_PX)
    faults.push(`is ${String(found.width)}x${String(found.height)}, under ${MIN_TOUCH_PX}px`)
  if (!found.onScreen) faults.push('is not fully inside the viewport')
  return faults
}

/**
 * THE LOADED INTEL CARD HAS TO BE OPENED, NOT NAVIGATED TO.
 *
 * Lifted from `check-text-fits.mjs`, which learned the same lesson: the card a
 * driver sees is the one reached by tapping a dot, and `?screen=intel` renders
 * the empty state instead. Both states draw a back key and they are not the
 * same control - one navigates, one hands off to `closeIntelCard` - so both
 * have to be measured.
 */
async function openIntelCard(page) {
  const point = await page.evaluate(() => {
    const map = globalThis.__fwmMapInstance
    if (!map) return null
    const hits = map.queryRenderedFeatures({ layers: ['fwm-camera-hit'] })
    const single = hits.find((f) => !f.properties.cluster)
    if (single === undefined) return null
    const p = map.project(single.geometry.coordinates)
    return { x: Math.round(p.x), y: Math.round(p.y) }
  })
  if (point === null) return false
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(1_500)
  return page.evaluate(() => document.querySelector('.fwm-intelv1-hero') !== null)
}

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    permissions: ['geolocation'],
    geolocation: { latitude: 38.9183, longitude: -94.692 },
  })
  const page = await context.newPage()

  for (const scale of TEXT_SCALES) {
    for (const [screen, destination] of Object.entries(EXPECT_BACK)) {
      await page.goto(`${target}/?screen=${screen}`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(1_200)

      /*
       * SET THE SCALE AFTER THE APP HAS SETTLED. `App.tsx` applies the stored
       * scale in an effect that runs once the settings store hydrates, and a
       * value written before that is silently reverted - which is how a check
       * ends up printing numbers labelled 150% that were measured at 100%.
       */
      const applied = await page.evaluate(
        ({ px, ratio }) => {
          document.documentElement.style.setProperty('font-size', `${px}px`, 'important')
          document.documentElement.setAttribute('data-fwm-text-scale', String(ratio))
          return getComputedStyle(document.documentElement).fontSize
        },
        { px: BASE_FONT_PX * scale, ratio: scale },
      )
      const wanted = `${String(BASE_FONT_PX * scale)}px`
      if (applied !== wanted) {
        // Loudly. A silently skipped measurement is how a check reports clean.
        process.stdout.write(
          `  WARNING: ${vp.name} ${screen} -- root font-size is ${applied}, wanted ${wanted}; NOT measured\n`,
        )
        continue
      }
      await page.waitForTimeout(400)

      const found = await page.evaluate(MEASURE)
      const faults = faultsIn(found, destination)

      // AND IT GOES THERE. Existing and named is not the same as working: the
      // control could be under a scrim, or wired to a handler that no-ops.
      if (faults.length === 0) {
        await page.click('.fwm-backkey')
        await page.waitForTimeout(400)
        // RADAR is DEFAULT_SCREEN and deliberately carries no parameter.
        const landed = new URL(page.url()).searchParams.get('screen') ?? 'radar'
        if (landed !== destination) faults.push(`clicked, and landed on ${landed}`)
      }

      for (const fault of faults) findings.push({ where: vp.name, scale, screen, fault })
    }

    for (const screen of EXPECT_NO_BACK) {
      await page.goto(`${target}/?screen=${screen}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_000)
      const count = await page.evaluate(() => document.querySelectorAll('.fwm-backkey').length)
      if (count > 0)
        findings.push({
          where: vp.name,
          scale,
          screen,
          fault: `is a v1 dock root and draws ${String(count)} back key(s); back there points at itself`,
        })
    }
  }

  /*
   * THE LOADED CARD, ONCE PER VIEWPORT. It costs a map render and a real tap,
   * so it is not repeated per text scale - what is being proved here is that
   * the OTHER branch of `IntelViewV1` draws the control at all.
   */
  await page.goto(`${target}/?screen=radar&map=1`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(9_000)
  if (await openIntelCard(page)) {
    const found = await page.evaluate(MEASURE)
    // `custom`: the loaded card dismisses through `closeIntelCard`, which is
    // the only thing that knows whether this is an overlay or a screen.
    for (const fault of faultsIn(found, 'custom'))
      findings.push({ where: vp.name, scale: 1, screen: 'intel (card)', fault })
  } else {
    process.stdout.write(
      `  WARNING: ${vp.name} -- the intel card did not open, so its dismiss was NOT measured\n`,
    )
  }

  await context.close()
}

await browser.close()

if (findings.length === 0) {
  process.stdout.write(
    `every non-root screen has a named back control of at least ${MIN_TOUCH_PX}px that navigates, ` +
      'at 320/390/430 CSS px and 100/150% text; no dock root draws one.\n',
  )
  process.exit(0)
}

process.stdout.write(`${String(findings.length)} back-affordance finding(s)\n\n`)
for (const f of findings) {
  process.stdout.write(
    `${f.where}  text ${String(Math.round(f.scale * 100))}%  ${f.screen}\n  ${f.fault}\n\n`,
  )
}
process.exit(1)
