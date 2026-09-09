/**
 * THE DRIVER'S PINCH IS NOT A COMMAND.
 *
 * =============================================================================
 * THIS HAS BROKEN TWICE
 * =============================================================================
 * Reported both times as "I pinch out to look around and it snaps back". The
 * mechanism is subtle enough that reading the file does not reveal it, which is
 * why it survived one fix:
 *
 * `commandedZoom` means THE LAST ZOOM PROP THE MAP APPLIED. The `zoomend`
 * handler wrote the MAP's zoom into it instead - the driver's own value. DRIVE
 * passes no zoom prop at all, so its prop is a constant `DEFAULT_ZOOM`. Pinch
 * out to 11.5 and the ref held 11.5 while the prop still held 14; every GPS fix
 * after that compared the two, read a fresh command, and eased back to 14. At
 * roughly one fix a second, which is why it felt random rather than immediate.
 *
 * A render test cannot catch it: it needs a real map, a real gesture and a
 * stream of position updates. So the invariant is guarded at the source, which
 * is where the mistake is actually visible.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ZOOM_COMMAND_EPSILON, isZoomCommand } from './zoom.ts';

function source(): string {
  const found = ['src/features/map/MapCanvas.tsx', 'apps/pwa/src/features/map/MapCanvas.tsx']
    .map((rel) => resolve(process.cwd(), rel))
    .map((path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return '';
      }
    })
    .find((text) => text !== '');
  expect(found, 'could not read MapCanvas.tsx').toBeTruthy();
  return found as string;
}

/** The `zoomend` handler body, which is where the bug lived both times. */
function zoomEndHandler(): string {
  const text = source();
  const at = text.indexOf("instance.on('zoomend'");
  expect(at, 'no zoomend handler in MapCanvas').toBeGreaterThan(-1);
  return text.slice(at, text.indexOf('});', at));
}

describe('the zoomend handler', () => {
  it('never writes the map zoom into commandedZoom', () => {
    // The whole bug in one line. `commandedZoom` tracks the PROP; putting the
    // driver's value in it makes an unchanged prop read as a new instruction.
    expect(
      zoomEndHandler(),
      'zoomend must not assign commandedZoom - that is the pinch-reset bug',
    ).not.toMatch(/commandedZoom\.current\s*=/);
  });

  it('still reports the driver zoom outward, so RANGE readouts stay honest', () => {
    // Removing the assignment must not turn this into a handler that does
    // nothing: the screen still needs to know what the driver chose.
    expect(zoomEndHandler()).toContain('zoomedRef.current?.(next)');
  });
});

describe('isZoomCommand', () => {
  it('treats an unchanged prop as no command at all', () => {
    // DRIVE's prop is a constant. If this ever returned true for equal values,
    // every fix would re-apply the default zoom over the driver's gesture.
    expect(isZoomCommand(14, 14)).toBe(false);
  });

  it('absorbs the rounding echo of a prop derived from the driver zoom', () => {
    // RADAR feeds the driver's zoom back through a feet-based range, which
    // quantises. That round trip must not read as a fresh instruction.
    expect(isZoomCommand(12, 12 + ZOOM_COMMAND_EPSILON / 2)).toBe(false);
  });

  it('still obeys a real command, which moves whole levels', () => {
    expect(isZoomCommand(14, 11.5)).toBe(true);
  });

  it('applies the first prop it ever sees', () => {
    expect(isZoomCommand(null, 14)).toBe(true);
  });
});
