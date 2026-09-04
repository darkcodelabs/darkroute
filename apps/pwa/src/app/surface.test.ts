import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FALLBACK_SURFACE,
  FWM_SURFACES,
  currentSurface,
  detectSurface,
  isFwmSurface,
  watchSurface,
} from './surface.ts';

/**
 * Drive `matchMedia` by query text, which is the only lever the section 06
 * snippet has. `queries` lists the exact query strings that should report a
 * match; every other query answers false, the way a phone does.
 */
function stubMatchMedia(queries: readonly string[]): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: queries.includes(query),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function stubScreen(width: number, height: number): void {
  vi.stubGlobal('screen', { width, height } as unknown as Screen);
}

function stubUserAgent(ua: string): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
const WEAR_UA = 'Mozilla/5.0 (Linux; Android 11; Wear OS) AppleWebKit/537.36';

const WATCH_SIZE_QUERY = '(max-width: 320px) and (max-height: 420px)';
const WATCH_STANDALONE_QUERY = '(display-mode: standalone) and (max-width: 300px)';
const ROUND_QUERY = '(shape: round)';
const DASH_QUERY = '(min-width: 700px) and (orientation: landscape)';

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset['fwmSurface'];
});

describe('detectSurface', () => {
  it('resolves a plain phone to phone', () => {
    stubUserAgent(PHONE_UA);
    stubMatchMedia([]);
    stubScreen(412, 915);

    expect(detectSurface()).toBe('phone');
    expect(document.documentElement.getAttribute('data-fwm-surface')).toBe('phone');
  });

  it('resolves a declared wearable with a round shape to watch-round', () => {
    stubUserAgent(WEAR_UA);
    stubMatchMedia([ROUND_QUERY]);
    stubScreen(384, 384);

    expect(detectSurface()).toBe('watch-round');
  });

  it('resolves a declared wearable with a square shape to watch-square', () => {
    stubUserAgent(WEAR_UA);
    stubMatchMedia([]);
    // Not square, so the `screen.width === screen.height` fallback for round
    // must not fire either.
    stubScreen(320, 360);

    expect(detectSurface()).toBe('watch-square');
  });

  it('treats a square screen as round even without the shape query', () => {
    // This is the section 06 fallback: Wear OS devices that do not report
    // `(shape: round)` but are square-panelled round watches.
    stubUserAgent(WEAR_UA);
    stubMatchMedia([]);
    stubScreen(384, 384);

    expect(detectSurface()).toBe('watch-round');
  });

  it('detects a watch by viewport size alone, with no wearable user agent', () => {
    // The point of the snippet: the UA is one of three inputs, never the only
    // one. A spoofed or frozen UA must not be able to force the phone layout
    // onto a 300x360 panel.
    stubUserAgent(PHONE_UA);
    stubMatchMedia([WATCH_SIZE_QUERY]);
    stubScreen(300, 360);

    expect(detectSurface()).toBe('watch-square');
  });

  it('detects a watch from the standalone display-mode query', () => {
    stubUserAgent(PHONE_UA);
    stubMatchMedia([WATCH_STANDALONE_QUERY, ROUND_QUERY]);
    stubScreen(280, 280);

    expect(detectSurface()).toBe('watch-round');
  });

  it('resolves a wide landscape viewport to dash', () => {
    stubUserAgent(PHONE_UA);
    stubMatchMedia([DASH_QUERY]);
    stubScreen(1280, 720);

    expect(detectSurface()).toBe('dash');
  });

  it('prefers watch over dash when both would match', () => {
    // The snippet tests `watch` first. A tiny landscape panel is a watch.
    stubUserAgent(WEAR_UA);
    stubMatchMedia([DASH_QUERY]);
    stubScreen(454, 454);

    expect(detectSurface()).toBe('watch-round');
  });

  it('writes the attribute layout selects on, and nothing else', () => {
    stubUserAgent(PHONE_UA);
    stubMatchMedia([DASH_QUERY]);
    stubScreen(1280, 720);

    const before = document.documentElement.className;
    detectSurface();

    expect(document.documentElement.getAttribute('data-fwm-surface')).toBe('dash');
    expect(document.documentElement.className).toBe(before);
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });
});

describe('currentSurface', () => {
  it('reads the attribute without re-measuring', () => {
    document.documentElement.dataset['fwmSurface'] = 'dash';
    expect(currentSurface()).toBe('dash');
  });

  it('returns null for a value that is not a surface', () => {
    document.documentElement.dataset['fwmSurface'] = 'fridge';
    expect(currentSurface()).toBeNull();
  });
});

describe('isFwmSurface', () => {
  it('accepts exactly the four surfaces', () => {
    for (const surface of FWM_SURFACES) expect(isFwmSurface(surface)).toBe(true);
    expect(isFwmSurface('tablet')).toBe(false);
    expect(isFwmSurface(undefined)).toBe(false);
  });

  it('names phone as the fallback', () => {
    expect(FALLBACK_SURFACE).toBe('phone');
  });
});

describe('watchSurface', () => {
  it('re-measures on resize and reports only real changes', () => {
    stubUserAgent(PHONE_UA);
    stubMatchMedia([]);
    stubScreen(412, 915);

    const seen: string[] = [];
    const watch = watchSurface((surface) => seen.push(surface));
    expect(watch.current()).toBe('phone');

    // A resize that changes nothing must not notify.
    window.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([]);

    // Rotate into a dash viewport.
    stubMatchMedia([DASH_QUERY]);
    stubScreen(1280, 720);
    window.dispatchEvent(new Event('resize'));

    expect(seen).toEqual(['dash']);
    expect(watch.current()).toBe('dash');
    watch.stop();
  });

  it('also re-measures on orientationchange', () => {
    stubUserAgent(PHONE_UA);
    stubMatchMedia([]);
    stubScreen(412, 915);

    const seen: string[] = [];
    const watch = watchSurface((surface) => seen.push(surface));

    stubMatchMedia([DASH_QUERY]);
    stubScreen(1280, 720);
    window.dispatchEvent(new Event('orientationchange'));

    expect(seen).toEqual(['dash']);
    watch.stop();
  });

  it('stops listening after stop(), and stop() is idempotent', () => {
    stubUserAgent(PHONE_UA);
    stubMatchMedia([]);
    stubScreen(412, 915);

    const seen: string[] = [];
    const watch = watchSurface((surface) => seen.push(surface));
    watch.stop();
    watch.stop();

    stubMatchMedia([DASH_QUERY]);
    stubScreen(1280, 720);
    window.dispatchEvent(new Event('resize'));

    expect(seen).toEqual([]);
  });
});
