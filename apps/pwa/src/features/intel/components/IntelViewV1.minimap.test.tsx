/**
 * THE PICTURE ON THE CAMERA CARD.
 *
 * The map itself is a WebGL context and there is none in jsdom, which is the
 * whole reason `MiniMap` draws its mark in DOM rather than as a MapLibre
 * marker: the position, the facing and the caption are the parts a driver in a
 * dead zone still gets, so they are the parts a test can still see.
 *
 * A browser check is not optional for this feature and is not replaced by these
 * assertions -- `scripts/check-minimap.mjs` opens a real card at 320, 390 and
 * 430 CSS px and reads the real geometry back. This file covers what that
 * cannot: what happens when the map cannot be built at all.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IntelViewV1 } from './IntelViewV1.tsx';
import { READ_WINDOW_DAYS, intelModel } from '../intelState.ts';
import type { IntelViewModel } from '../intelState.ts';
import type { CameraRecord } from '../../../stores';

/** A cached record, as the tile store holds one. */
function record(over: Partial<CameraRecord> = {}): CameraRecord {
  return {
    id: 'osm:13472226901',
    lat: 38.9183,
    lon: -94.692,
    directionDeg: 90,
    ...over,
  };
}

function model(over: Partial<CameraRecord> | null = {}): IntelViewModel {
  return intelModel({
    cameraId: 'osm:13472226901',
    record: over === null ? null : record(over),
    assessment: null,
    state: 'clear',
    mutedCamera: false,
    muteRemainingMs: 0,
    reads: 0,
    windowDays: READ_WINDOW_DAYS,
    operatorRecord: null,
    photoAvailable: false,
  });
}

/**
 * NO CANVAS, SAID ONCE AND QUIETLY.
 *
 * jsdom implements no 2D or WebGL context and logs "Not implemented:
 * HTMLCanvasElement's getContext()" every time MapLibre asks for one, ten times
 * a run. Returning null is the SAME answer -- MapLibre throws "failed to
 * initialize WebGL" either way and the component falls back to the bare state
 * -- and it makes the missing context a stated condition of these tests rather
 * than noise in the log.
 */
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe('the mini map on the hero', () => {
  it('draws a picture of the camera beside the distance readout', () => {
    const { container } = render(<IntelViewV1 model={model()} />);
    const locate = container.querySelector('.fwm-intelv1-locate');
    expect(locate).not.toBeNull();
    // Beside, not under: the readout and the picture are siblings in one row,
    // which is what fills the empty half of the hero.
    expect(locate?.querySelector('.fwm-intelv1-readout')).not.toBeNull();
    expect(locate?.querySelector('.fwm-minimap')).not.toBeNull();
  });

  it('marks the camera and the way its lens points', () => {
    const { container } = render(<IntelViewV1 model={model({ directionDeg: 90 })} />);
    expect(container.querySelector('.fwm-minimap-dot')).not.toBeNull();
    // One cone for the one direction on the record.
    expect(container.querySelectorAll('.fwm-minimap-cone')).toHaveLength(1);
  });

  it('draws no cone for a camera whose facing nobody wrote down', () => {
    // `null` facing never means "not facing you". The picture says nothing
    // rather than pointing the lens somewhere it cannot justify.
    const { container } = render(<IntelViewV1 model={model({ directionDeg: null })} />);
    expect(container.querySelectorAll('.fwm-minimap-cone')).toHaveLength(0);
    expect(container.querySelector('.fwm-minimap-dot')).not.toBeNull();
  });

  it('draws a cone for every direction on a record that carries several', () => {
    const { container } = render(
      <IntelViewV1 model={model({ directionDeg: 90, tags: { direction: '90;270' } })} />,
    );
    expect(container.querySelectorAll('.fwm-minimap-cone')).toHaveLength(2);
  });

  it('draws no picture at all when no record is cached for the camera', () => {
    // There is no coordinate anywhere in the app for that camera, and a map
    // centred on a guess is worse than no map.
    const { container } = render(<IntelViewV1 model={model(null)} />);
    expect(container.querySelector('.fwm-minimap')).toBeNull();
    // The rest of the card is unaffected -- it still says what it knows.
    expect(container.querySelector('.fwm-intelv1-readout')).not.toBeNull();
  });

  it('says there is no ground rather than spinning, when no map can be built', () => {
    // jsdom has no WebGL, which is the same shape of failure as a phone in a
    // dead zone with nothing cached: the mark stands, and the caption says so.
    render(<IntelViewV1 model={model()} />);
    return waitFor(() => {
      const figure = document.querySelector('.fwm-minimap');
      expect(figure?.getAttribute('data-fwm-ground')).toBe('bare');
      expect(within(figure as HTMLElement).getByText('no map cached here')).toBeInTheDocument();
    });
  });

  it('offers the picture to a screen reader as one labelled image', () => {
    render(<IntelViewV1 model={model({ directionDeg: 90 })} />);
    // The cones are the only place the facing is DRAWN, so the label has to
    // carry it -- otherwise it is a fact withheld from anybody not looking.
    expect(screen.getByRole('img', { name: /camera position/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /facing/i })).toBeInTheDocument();
  });
});
