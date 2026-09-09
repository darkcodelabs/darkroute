import { afterEach, describe, expect, it } from 'vitest';

import {
  BASE_FONT_PX,
  DEFAULT_TEXT_SCALE,
  TEXT_SCALES,
  TEXT_SCALE_ATTRIBUTE,
  applyTextScale,
  currentTextScale,
  formatTextScale,
  isTextScale,
  resolveTextScale,
} from './textScale.ts';

afterEach(() => {
  document.documentElement.style.removeProperty('font-size');
  document.documentElement.removeAttribute(TEXT_SCALE_ATTRIBUTE);
});

describe('the text scale', () => {
  it('sets the ROOT font size, which is what makes the rem type ramp scale', () => {
    applyTextScale(1.25);

    expect(document.documentElement.style.fontSize).toBe(`${BASE_FONT_PX * 1.25}px`);
    expect(document.documentElement.getAttribute(TEXT_SCALE_ATTRIBUTE)).toBe('1.25');
  });

  it('leaves spacing and touch targets alone - they are px, and deliberately so', () => {
    // The guard is on the token file, not on this module: if a spacing or
    // touch-target token ever becomes rem, scaling text would move every
    // control under the driver's thumb. This asserts the premise still holds.
    const tokens = document.documentElement;
    applyTextScale(1.5);

    expect(tokens.style.fontSize).toBe('24px');
    // Nothing here writes a spacing custom property.
    expect(tokens.style.getPropertyValue('--fwm-space-4')).toBe('');
    expect(tokens.style.getPropertyValue('--fwm-touch-min')).toBe('');
  });

  it('snaps an unoffered value to the nearest step instead of honouring it', () => {
    expect(resolveTextScale(1.2)).toBe(1.25);
    expect(resolveTextScale(0.9)).toBe(0.875);
  });

  it('refuses a value that would leave the driver unable to read their way out', () => {
    // A number out of range clamps to the nearest end of the ramp rather than
    // jumping to the default: clamping is monotone, so a corrupted 0 gives the
    // smallest offered size - readable, and adjustable from there.
    expect(resolveTextScale(0)).toBe(0.875);
    // Something that is not a number at all is not clampable, and falls back.
    expect(resolveTextScale(Number.NaN)).toBe(DEFAULT_TEXT_SCALE);
    expect(resolveTextScale('huge')).toBe(DEFAULT_TEXT_SCALE);
    expect(resolveTextScale(undefined)).toBe(DEFAULT_TEXT_SCALE);
    // 4x is snapped to the ceiling, not applied: at 5rem the hero readout would
    // be 320px and would not fit beside the ring.
    expect(resolveTextScale(4)).toBe(1.5);
  });

  it('reads back what it applied', () => {
    for (const scale of TEXT_SCALES) {
      applyTextScale(scale);
      expect(currentTextScale()).toBe(scale);
    }
  });

  it('reports the design default when nothing has been applied', () => {
    expect(currentTextScale()).toBe(DEFAULT_TEXT_SCALE);
  });

  it('labels the steps as percentages, because "1.125" means nothing to a driver', () => {
    expect(formatTextScale(1)).toBe('100%');
    expect(formatTextScale(1.375)).toBe('138%');
    expect(formatTextScale(0.875)).toBe('88%');
  });

  it('knows an offered step from an arbitrary number', () => {
    expect(isTextScale(1.25)).toBe(true);
    expect(isTextScale(1.3)).toBe(false);
  });
});
