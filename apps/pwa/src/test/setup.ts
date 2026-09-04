/* Vitest setup, loaded before every test file in apps/pwa.
 *
 * jsdom gives us a DOM but almost none of the platform surface this app is built
 * on. Rather than let each test invent its own stub, the shared decisions live
 * here:
 *
 *   - Web Crypto is REAL (node:crypto.webcrypto), never faked. The evidence chain
 *     is the one part of this product a user could be asked to stand behind, so
 *     its tests have to exercise genuine ECDSA and AES-GCM. A mocked signature
 *     that always verifies would test nothing.
 *   - Everything else optional is left ABSENT by default. Adapters are required
 *     to capability-detect, and the honest default for jsdom is "this browser
 *     does not have it". A test that wants a capability opts in explicitly.
 */

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Real Web Crypto, or no crypto tests at all. Vitest runs on Node, whose global
// `crypto` is a genuine WebCrypto implementation, and its jsdom environment
// leaves it in place. We assert rather than polyfill: if a runtime ever shows up
// without SubtleCrypto, the right outcome is a loud failure, not a stub that
// makes every signature verify.
if (!globalThis.crypto?.subtle) {
  throw new Error(
    'SubtleCrypto is unavailable in this test runtime. The evidence chain and ' +
      'plate vault must be tested against real ECDSA and AES-GCM -- a mocked ' +
      'primitive would verify anything and prove nothing.',
  )
}

// structuredClone backs CryptoKey persistence in IndexedDB. Node has it natively
// from 17; define it only if this runtime somehow lacks it.
if (typeof globalThis.structuredClone !== 'function') {
  throw new Error(
    'structuredClone is missing. The plate vault and evidence chain persist ' +
      'CryptoKey values through it, so a runtime without it cannot honestly ' +
      'test those paths. Upgrade Node rather than stubbing this.',
  )
}

// matchMedia drives surface detection (phone / watch-round / watch-square / dash).
// Default: every query false, which resolves to the phone surface. A surface test
// overrides this deliberately.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * TESTS RENDER THE DIAL, NOT THE MAP.
 *
 * `mapEnabled()` defaults to the MapLibre scope now, which is right for a
 * phone and wrong for jsdom: MapLibre needs a WebGL context that does not
 * exist here, so every RADAR test would be asserting against an empty
 * container instead of the renderer it was written for.
 *
 * Pinning it here rather than in 53 test files keeps the choice in ONE place,
 * and makes the pin obvious when the dial is finally deleted -- at which point
 * this block is what tells you the suite needs re-pointing rather than a
 * hundred mysterious failures.
 *
 * The map's own behaviour is covered by `features/map/*.test.ts`, which test
 * the pure parts, and by the browser preflight, which is the only place a
 * WebGL map can honestly be checked at all.
 */
try {
  globalThis.sessionStorage?.setItem('fwm.map', '0');
} catch {
  // A jsdom without storage still runs; the flag then falls back to its
  // default and only the RADAR render tests would notice.
}
