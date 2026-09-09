/**
 * INTEL DRAWS A WAY OUT IN BOTH OF ITS STATES.
 *
 * =============================================================================
 * WHY THIS IS ITS OWN FILE
 * =============================================================================
 * `IntelView.test.tsx` is v0's card, 800-odd lines of it, and this is about a
 * branch in v1's - the one `?screen=intel` lands on when nothing is selected.
 *
 * That branch returned ABOVE the header, so the `‹` the loaded card draws did
 * not exist on it: an old bookmark or a notification for a camera the archive
 * has since dropped put the driver on a screen that said "no camera selected"
 * and offered nothing else. INTEL is behind no hub, so no dock key is lit
 * there either. It was found by a headless pass, not by a test, which is
 * exactly why there is now a test.
 *
 * The headless pass cannot check the OTHER half: opening the loaded card needs
 * a camera painted on a real map, and a preview server with no archive has
 * none - `scripts/check-back-affordance.mjs` says so out loud rather than
 * reporting clean. So the loaded card's dismiss is asserted here.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OVERLAY_CLOSE_LABEL } from '../../../components/overlay/OverlayClose.tsx';
import type { CameraAssessment, CameraRecord } from '../../../stores';
import { READ_WINDOW_DAYS, intelModel } from '../intelState.ts';
import type { IntelInput, IntelViewModel } from '../intelState.ts';

import { INTEL_V1_DISMISS, INTEL_V1_TO_DRIVE, IntelViewV1 } from './IntelViewV1.tsx';

function record(): CameraRecord {
  return { id: 'FWM-0442', lat: 39.1, lon: -84.58, directionDeg: 223, ownerType: 'hoa', confirmations: 28 };
}

function assessment(): CameraAssessment {
  return {
    id: 'FWM-0442',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 223,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 223,
    inRange: true,
    muted: false,
    mergedIds: ['FWM-0442'],
  };
}

function model(): IntelViewModel {
  const input: IntelInput = {
    cameraId: 'FWM-0442',
    record: record(),
    assessment: assessment(),
    state: 'in_range',
    mutedCamera: false,
    muteRemainingMs: 0,
    reads: 21,
    windowDays: READ_WINDOW_DAYS,
    operatorRecord: null,
    photoAvailable: false,
  };
  return intelModel(input);
}

describe('the v1 intel card', () => {
  it('draws a dismiss on the loaded card, named for what it does', () => {
    // WHAT THIS ASSERTED BEFORE, and why it changed: it looked for a BackKey
    // named INTEL_V1_DISMISS. The loaded card draws `OverlayClose` instead --
    // the report sheet's own round X, which is the one exit control this
    // product has. A back chevron is a promise about where you came from that
    // a modal raised over the map cannot keep. The behaviour under test is
    // unchanged: one control, and it calls the handler rather than navigating,
    // because only `closeIntelCard` knows whether this is an overlay.
    const onDismiss = vi.fn();
    render(<IntelViewV1 model={model()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: OVERLAY_CLOSE_LABEL }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('draws exactly ONE way out of the loaded card, not two', () => {
    // The regression this guards: both a BackKey and an OverlayClose landing
    // in the same header, which is what merging the two independent fixes for
    // "this screen has no exit" naively produces.
    render(<IntelViewV1 model={model()} onDismiss={vi.fn()} />);

    expect(screen.queryByRole('button', { name: INTEL_V1_DISMISS })).toBeNull();
    expect(screen.getAllByRole('button', { name: OVERLAY_CLOSE_LABEL })).toHaveLength(1);
  });

  it('draws a way out of the EMPTY state too, which is where it was missing', () => {
    // No `onDismiss` on purpose. There is no card to close on a cold deep link,
    // and `closeIntelCard` would fall through to `back()`, which returns false
    // and does nothing when this module pushed no history. A control that looks
    // like an exit and is not one is worse than no control - so this branch
    // navigates to DRIVE instead, unconditionally.
    const { container } = render(<IntelViewV1 model={null} />);

    const key = screen.getByRole('button', { name: INTEL_V1_TO_DRIVE });
    expect(key.getAttribute('data-fwm-back-to')).toBe('radar');
    expect(container.querySelector('.fwm-intelv1-empty')?.textContent).toContain('no camera');
  });

  it('still draws the empty-state exit when the container HAS handed it a dismiss', () => {
    // Reached as a screen, with the container wiring `closeIntelCard` as it
    // always does: the empty state ignores it and offers DRIVE regardless,
    // because "no camera selected" has nothing to dismiss either way.
    render(<IntelViewV1 model={null} onDismiss={vi.fn()} />);

    expect(screen.getByRole('button', { name: INTEL_V1_TO_DRIVE })).toBeTruthy();
    expect(screen.queryByRole('button', { name: INTEL_V1_DISMISS })).toBeNull();
  });

  it('never offers a DISABLED close key as the empty state’s only control', () => {
    // The trap that made this branch use a BackKey rather than the close key:
    // `OverlayClose` renders disabled when `onClose` is undefined, which is
    // exactly a cold deep link to `?screen=intel`. A greyed-out X on a screen
    // that says "no camera selected" is worse than no control at all, because
    // it looks like the way out and cannot be pressed.
    render(<IntelViewV1 model={null} />);

    expect(screen.queryByRole('button', { name: OVERLAY_CLOSE_LABEL })).toBeNull();
    expect(screen.getByRole('button', { name: INTEL_V1_TO_DRIVE }).hasAttribute('disabled')).toBe(false);
  });
});
