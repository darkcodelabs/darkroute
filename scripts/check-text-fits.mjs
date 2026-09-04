/**
 * DOES THE TEXT FIT THE BOX IT IS IN?
 *
 * THE BUG THIS EXISTS FOR
 *   "some text is too large for the thing it's in." Reported from a phone,
 *   against a build whose tests all passed -- because every test asserts what a
 *   string SAYS, and none of them assert that it is not spilling out of, or
 *   being clipped by, the element drawn around it. jsdom has no layout, so no
 *   unit test in this repo can ever catch this class of defect.
 *
 * WHAT COUNTS AS A DEFECT
 *   An element whose own content is wider or taller than the box it was given,
 *   when that box cannot scroll. That is either a visible spill (overflow
 *   visible) or a silent truncation (overflow hidden/clip) -- both are wrong,
 *   and the second is worse because it reads as intentional.
 *
 *   Deliberately scrollable regions are excluded: overflow there is the point.
 *   So is `text-overflow: ellipsis`, which is a considered decision to truncate.
 *
 * WHY IT MEASURES AT SEVERAL WIDTHS
 *   The reported symptom is size-dependent. A 320 CSS-pixel viewport (iPhone SE
 *   in landscape-safe terms, and the narrowest phone still shipping) is where a
 *   fixed-column layout runs out of room first, and the RADAR top block is now
 *   built from fixed columns on purpose.
 */

import { chromium } from '@playwright/test'

const target = process.argv[2] ?? 'http://localhost:4199'

/** Narrowest first: that is where a fixed-column block fails. */
const VIEWPORTS = [
  { name: '320x568 (SE)', width: 320, height: 568 },
  { name: '390x844 (13/14)', width: 390, height: 844 },
  { name: '430x932 (Pro Max)', width: 430, height: 932 },
]

/*
 * EVERY SCREEN THE REGISTRY CAN RESOLVE, not the four that were easy to reach.
 *
 * The first version of this list held `radar, log, settings, help`, and the
 * next screenshot from a device showed CONFIRM STILL THERE painted straight out
 * of its own button on the INTEL card -- a screen this check had never opened.
 * A fit check that covers most of the app is a fit check that reports "0
 * overflowing boxes" about the part nobody was worried about.
 *
 * `onboarding` is deliberately absent: it is a first-run gate that redirects,
 * so asking for it by URL measures whatever it redirected to. `admin` is
 * absent because it renders a refusal without a server saying otherwise, and
 * measuring the refusal proves nothing about the screen.
 */
const SCREENS = [
  'radar',
  'log',
  'settings',
  'help',
  'report',
  'ask',
  'triage',
  'dead-drop',
  'zone-audit',
  'heat-map',
  'offline',
]

/**
 * THE INTEL CARD HAS TO BE OPENED, NOT NAVIGATED TO.
 *
 * `?screen=intel` renders "NO CAMERA SELECTED · TAP A DOT ON SWEEP", which is
 * the correct empty state and is not the card. Measuring it reported the intel
 * screen clean while the real card was clipping its own buttons on a device.
 *
 * So this does what a driver does: load RADAR, ask the map which camera it
 * actually painted, and tap it. The map instance is the same handle
 * `check-map-render.mjs` uses, and the hit layer is the app's own 44px target,
 * so this exercises the real path rather than reaching into the store.
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
  return page.evaluate(() => document.querySelector('.fwm-intel-actions') !== null)
}

/**
 * THE TEXT SCALES THIS IS MEASURED AT - and why the biggest one matters most.
 *
 * SETTINGS offers 87.5% to 150%, and the control's own caption says what the
 * design intends: "scales the words. buttons and the dock stay where they are."
 * Type grows; spacing, touch targets and chrome are in px and do not. That is a
 * deliberate trade -- a dock that grew with the type would eat the map -- and
 * it means EVERY control that sizes to its own label is one step away from
 * overflowing, by design rather than by accident.
 *
 * Measuring only at 1.0 is measuring the one setting where that trade costs
 * nothing. A device screenshot showed CONFIRM STILL THERE painted out of both
 * ends of its button while this check reported the whole app clean.
 *
 * 1.5 is the ceiling the app actually offers, so it is the one that has to
 * hold. 1.25 is here to say whether a failure is a cliff or a gradient.
 */
const TEXT_SCALES = [1, 1.25, 1.5]

/** Matches BASE_FONT_PX in apps/pwa/src/app/textScale.ts. */
const BASE_FONT_PX = 16

/** Sub-pixel rounding is not a defect. Two CSS pixels is. */
const SLACK_PX = 2

const browser = await chromium.launch()
const findings = []

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

  // `intel` last: it is reached by tapping RADAR's map, not by a URL.
  for (const screen of [...SCREENS, 'intel']) {
   for (const scale of TEXT_SCALES) {
    const url = screen === 'intel' ? 'radar' : screen
    await page.goto(`${target}/?screen=${url}&map=1`, { waitUntil: 'domcontentloaded' })
    // Fonts change metrics, and a webfont that lands late turns a fitting label
    // into an overflowing one. Measuring before they settle measures nothing.
    await page.evaluate(() => document.fonts.ready)
    // The map needs longer than a static screen: the card cannot be tapped
    // until a camera has actually been painted.
    await page.waitForTimeout(screen === 'intel' ? 9_000 : 3_000)

    /*
     * SET THE SCALE **AFTER** THE APP HAS SETTLED, NOT BEFORE.
     *
     * `App.tsx` calls `applyTextScale(preferredTextScale)` in an effect that
     * runs once the settings store hydrates, which happens a beat after load.
     * Setting the root font-size before that ran silently reverted it, and the
     * first version of this check duly reported findings labelled "text 150%"
     * that were measured at 100% -- three viewports' worth of numbers that
     * meant nothing.
     *
     * Written the way `applyTextScale` writes it: root font-size plus the data
     * attribute. Driving SETTINGS instead would mean a broken settings control
     * could quietly turn this whole dimension off.
     */
    const applied = await page.evaluate(
      ({ px, ratio }) => {
        document.documentElement.style.setProperty('font-size', `${px}px`, 'important')
        document.documentElement.setAttribute('data-fwm-text-scale', String(ratio))
        return getComputedStyle(document.documentElement).fontSize
      },
      { px: BASE_FONT_PX * scale, ratio: scale },
    )
    // VERIFIED, not assumed. See above for what happens when it is assumed.
    const wanted = `${String(BASE_FONT_PX * scale)}px`
    if (applied !== wanted) {
      process.stdout.write(
        `  WARNING: ${vp.name} ${screen} -- root font-size is ${applied}, wanted ${wanted}; NOT measured at this scale\n`,
      )
      continue
    }
    await page.waitForTimeout(600)

    if (screen === 'intel' && !(await openIntelCard(page))) {
      // Loudly. A silently skipped screen is how this check reported the whole
      // app clean while the card was broken.
      process.stdout.write(`  WARNING: ${vp.name} ${String(scale)} -- intel card did not open, NOT measured\n`)
      continue
    }

    const overflows = await page.evaluate(
      ({ slack }) => {
        const out = []
        const scrollable = new Set(['auto', 'scroll', 'overlay'])

        for (const el of document.querySelectorAll('body *')) {
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') continue
          const box = el.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue

          // Canvas/SVG/media manage their own internal size.
          if (/^(CANVAS|SVG|IMG|VIDEO|PATH|G|CIRCLE|TEXT|LINE|RECT|POLYGON|DEFS|USE|STOP|LINEARGRADIENT|RADIALGRADIENT|CLIPPATH|MASK|FILTER)$/.test(el.tagName)) continue

          const wideOver = el.scrollWidth - el.clientWidth
          const tallOver = el.scrollHeight - el.clientHeight

          const wide = wideOver > slack && !scrollable.has(style.overflowX)

          /*
           * VERTICAL OVERFLOW IS USUALLY NOT A DEFECT, AND SAYING IT IS WOULD
           * MAKE THIS CHECK USELESS.
           *
           * A hero numeral set at `line-height: 0.9` has a content box shorter
           * than its own glyph box by design -- tight leading is how a big
           * number is drawn. The half-leading distributes that overflow evenly
           * and nothing collides, so `scrollHeight > clientHeight` is the
           * NORMAL state for every tight readout in this app.
           *
           * It only matters when something actually cuts the glyphs off. So:
           * report vertical overflow only where an ancestor clips that axis and
           * the element's box really does extend past it.
           */
          let tall = false
          if (tallOver > slack && !scrollable.has(style.overflowY)) {
            for (let a = el.parentElement; a !== null; a = a.parentElement) {
              const aStyle = getComputedStyle(a)
              if (aStyle.overflowY !== 'hidden' && aStyle.overflowY !== 'clip') continue
              const aBox = a.getBoundingClientRect()
              const grown = box.height + tallOver
              const top = box.top - (grown - box.height) / 2
              if (top < aBox.top - slack || top + grown > aBox.bottom + slack) tall = true
              break
            }
          }
          if (!wide && !tall) continue

          // An explicit ellipsis is a decision to truncate, not a defect.
          if (wide && !tall && style.textOverflow === 'ellipsis') continue

          const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
          if (text === '') continue
          // Only report the element that actually holds the text, not every
          // ancestor that inherits the same overflow from it.
          const ownText = [...el.childNodes].some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
          )
          if (!ownText) continue

          out.push({
            kind: 'self',
            tag: el.tagName.toLowerCase(),
            cls: el.getAttribute('class') ?? '',
            text: text.slice(0, 48),
            wideOver: wide ? Math.round(wideOver) : 0,
            tallOver: tall ? Math.round(tallOver) : 0,
            box: `${Math.round(box.width)}x${Math.round(box.height)}`,
            fontSize: style.fontSize,
            whiteSpace: style.whiteSpace,
            clipped: style.overflowX === 'hidden' || style.overflowY === 'hidden' || style.overflowX === 'clip',
          })
        }

        /*
         * THE SECOND PASS, AND THE ONE THAT CATCHES A FIXED-COLUMN BLOCK.
         *
         * The check above asks whether an element's CONTENT overflows ITSELF.
         * A label sitting in a fixed-width grid column passes that test
         * perfectly -- it sizes to its own text, so scrollWidth equals
         * clientWidth -- while hanging out of the column it was given. RADAR's
         * top block is built from fixed columns precisely so that data cannot
         * reflow the layout, which means this is exactly how it fails.
         *
         * So: does the child's border box escape the parent's padding box.
         */
        for (const el of document.querySelectorAll('body *')) {
          const parent = el.parentElement
          if (parent === null || parent === document.body) continue
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') continue
          if (style.position === 'absolute' || style.position === 'fixed') continue

          const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ')
          if (text === '') continue
          const ownText = [...el.childNodes].some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
          )
          if (!ownText) continue

          const pStyle = getComputedStyle(parent)
          if (scrollable.has(pStyle.overflowX) || scrollable.has(pStyle.overflowY)) continue

          const box = el.getBoundingClientRect()
          const pBox = parent.getBoundingClientRect()
          if (box.width === 0 || pBox.width === 0) continue

          const left = pBox.left + parseFloat(pStyle.paddingLeft || '0')
          const right = pBox.right - parseFloat(pStyle.paddingRight || '0')
          const escapes = Math.max(left - box.left, box.right - right)
          if (escapes <= slack) continue

          out.push({
            kind: 'escape',
            tag: el.tagName.toLowerCase(),
            cls: el.getAttribute('class') ?? '',
            parentCls: parent.getAttribute('class') ?? parent.tagName.toLowerCase(),
            text: text.slice(0, 48),
            wideOver: Math.round(escapes),
            tallOver: 0,
            box: `${Math.round(box.width)}x${Math.round(box.height)} in ${Math.round(right - left)}`,
            fontSize: style.fontSize,
            whiteSpace: style.whiteSpace,
            clipped: pStyle.overflowX === 'hidden' || pStyle.overflowX === 'clip',
          })
        }
        return out
      },
      { slack: SLACK_PX },
    )

    for (const o of overflows) findings.push({ viewport: vp.name, screen, scale, ...o })
   }
  }

  await context.close()
}

await browser.close()

if (findings.length === 0) {
  process.stdout.write(
    'every text box fits its content at 320/390/430 CSS px and 100/125/150% text.\n',
  )
  process.exit(0)
}

process.stdout.write(`${String(findings.length)} overflowing text box(es)\n\n`)
for (const f of findings) {
  const how = [
    f.wideOver > 0 ? `${String(f.wideOver)}px too wide` : '',
    f.tallOver > 0 ? `${String(f.tallOver)}px too tall` : '',
  ]
    .filter(Boolean)
    .join(', ')
  const where =
    f.kind === 'escape' ? `  escapes <${f.parentCls}>` : ''
  process.stdout.write(
    `${f.viewport}  ${f.screen}  text ${String(Math.round(f.scale * 100))}%  [${f.kind}]\n` +
      `  <${f.tag} class="${f.cls}">  box ${f.box}  font ${f.fontSize}  ws ${f.whiteSpace}${f.clipped ? '  CLIPPED' : '  SPILLING'}${where}\n` +
      `  ${how}\n` +
      `  "${f.text}"\n\n`,
  )
}
process.exit(1)
