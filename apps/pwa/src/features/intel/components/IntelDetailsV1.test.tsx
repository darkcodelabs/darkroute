/**
 * THE AUDIT TRAIL, ONE LEVEL UNDER THE CAMERA MODAL.
 *
 * Brief 4 moves eight fields off the card a driver reads while moving - "EFF
 * Atlas, inter-agency sharing, first reported, confirmed by, your reads, in
 * this county, covers, data as of" - and this is where they went. Two things
 * have to stay true through that move and both are asserted here:
 *
 *   NOTHING WAS DROPPED. The reason the old card printed em dashes rather than
 *   hiding empty rows is that a missing INTER-AGENCY SHARING row reads as "this
 *   camera does not share". Pushing the block one level deeper must not quietly
 *   become deleting the empty half of it.
 *
 *   THE CONTAINER STAYS MOUNTED. The sheet is a branch of `IntelViewV1` rather
 *   than a second overlay, so a queued verdict and a running mute countdown
 *   survive the trip in and back out. An overlay id would have unmounted the
 *   screen that owns both.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OVERLAY_CLOSE_LABEL } from '../../../components/overlay/OverlayClose.tsx';
import type { CameraRecord } from '../../../stores';
import { READ_WINDOW_DAYS, intelModel } from '../intelState.ts';
import type { IntelInput, IntelViewModel } from '../intelState.ts';

import { DETAILS_LABEL, IntelViewV1 } from './IntelViewV1.tsx';
import { CORRECT_LABEL, MUTE_LABEL, SHARE_LABEL } from './IntelDetailsV1.tsx';

function record(over: Partial<CameraRecord> = {}): CameraRecord {
  return { id: 'osm:1', lat: 38.9, lon: -94.6, directionDeg: 90, ...over } as CameraRecord;
}

function model(over: Partial<IntelInput> = {}): IntelViewModel {
  return intelModel({
    cameraId: 'osm:1',
    record: record(),
    assessment: null,
    state: 'approaching',
    mutedCamera: false,
    muteRemainingMs: 0,
    reads: 0,
    windowDays: READ_WINDOW_DAYS,
    operatorRecord: null,
    photoAvailable: false,
    ...over,
  });
}

/** Open the sheet the way a driver does: by pressing the row. */
function openDetails(): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(DETAILS_LABEL) }));
}

describe('the Details sheet', () => {
  it('draws every fact, including the ones that are an em dash', () => {
    const m = model();
    const { container } = render(<IntelViewV1 model={m} />);
    openDetails();

    // An unknown is STATED on this card, never dropped: a missing
    // INTER-AGENCY SHARING row reads as "this camera does not share".
    expect(container.querySelectorAll('.fwm-inteldetailv1-fact')).toHaveLength(m.facts.length);
  });

  it('keeps the three tiles, which is where MOUNT and FACING are still said', () => {
    /*
     * The modal's one summary line DROPS a mount or a facing nobody wrote down
     * - `faces —` in a sentence is noise rather than an absence - and that is
     * only defensible because the value is stated in full somewhere. Here.
     */
    const m = model({ record: record({ directionDeg: null }) });
    const { container } = render(<IntelViewV1 model={m} />);
    openDetails();

    const tiles = container.querySelectorAll('.fwm-inteldetailv1-tile');
    expect(tiles).toHaveLength(m.tiles.length);
    // MOUNT is untagged on this record and FACING has no bearing, so both are
    // drawn and both are marked unknown rather than left out.
    expect(container.querySelectorAll('[data-fwm-known="false"]').length).toBeGreaterThan(0);
  });

  it('carries the mute, the share and the correction key that left the modal', () => {
    render(
      <IntelViewV1 model={model()} onToggleMute={vi.fn()} onShare={vi.fn()} />,
    );

    // Not on the modal: brief 4 cuts it to two verdicts and a row.
    expect(screen.queryByRole('button', { name: MUTE_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: SHARE_LABEL })).toBeNull();

    openDetails();

    expect(screen.getByRole('button', { name: MUTE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SHARE_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CORRECT_LABEL })).toBeInTheDocument();
  });

  it('opens on a press of the row and closes back onto the modal', () => {
    render(<IntelViewV1 model={model()} onDismiss={vi.fn()} />);

    openDetails();
    const row = screen.getByRole('button', { name: new RegExp(DETAILS_LABEL) });
    expect(row).toHaveAttribute('aria-expanded', 'true');

    // TWO CLOSE KEYS ARE ON SCREEN AT ONCE and that is correct: the modal's own
    // is still mounted underneath, which is the whole reason nothing on it is
    // lost. The sheet's is the one at the head of its title row, and it is the
    // last of the two in the document.
    const closes = screen.getAllByRole('button', { name: OVERLAY_CLOSE_LABEL });
    fireEvent.click(closes[closes.length - 1] as HTMLElement);

    expect(screen.getByRole('button', { name: new RegExp(DETAILS_LABEL) })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('leaves the card underneath alive, outcome and all', () => {
    // The reason this is a branch of the view rather than an overlay id: the
    // container that holds `outcome` is unmounted by a second overlay, and with
    // it goes the one line saying whether the verdict a driver just pressed was
    // actually written.
    render(<IntelViewV1 model={model()} outcome="confirm-queued" onDismiss={vi.fn()} />);
    openDetails();

    expect(document.querySelector('.fwm-intelv1-outcome')).not.toBeNull();
  });
});
