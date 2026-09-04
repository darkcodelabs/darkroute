/**
 * The strings the panel renders, and the rules behind the submit button.
 *
 * Reference: `Flockys App Screens.dc.html` -- `06 · REPORT - SHEET FROM ANY
 * SCREEN`. Every literal asserted below is read off that panel:
 * `NEW CAMERA` / `CONFIRM EXISTING`, `POSITION · AUTO`,
 * `39.0997 N · 84.5786 W`, `±4 M · 9 SATS`, `FACING · FROM COMPASS`, `SW`,
 * `223° · covering the northbound lane`, the four mount chips, and
 * `2 REPORTS QUEUED · SYNC ON WIFI`.
 */

import { describe, expect, it } from 'vitest';

import { GPS_ACCURACY_FIELD } from '../../services/crypto/chain.ts';

import {
  FACING_LABEL,
  MODE_LABEL,
  MOUNT_KINDS,
  MOUNT_LABEL,
  NO_FIX_DETAIL,
  POSITION_LABEL,
  REPORT_PAYLOAD_SCHEMA,
  emptyDraft,
  facingCardinal,
  facingDetail,
  laneCovered,
  makeModelIssue,
  positionDetail,
  queueLine,
  reportCoordinates,
  reportPayload,
  reportStatus,
  seedFacing,
  submitBlocker,
  withFacing,
  withMakeModel,
  withMode,
  withMount,
} from './reportDraft.ts';
import type { ReportSubject } from './reportDraft.ts';

/** The fix the panel renders, to the decimal. */
const CINCINNATI: ReportSubject = {
  cameraId: null,
  lat: 39.0997,
  lon: -84.5786,
  accuracyM: 4,
  satellites: 9,
};

describe('the copy the panel draws', () => {
  it('labels the toggle, the cards and the chips exactly as rendered', () => {
    expect(MODE_LABEL.new).toBe('NEW CAMERA');
    expect(MODE_LABEL.confirm).toBe('CONFIRM EXISTING');
    expect(POSITION_LABEL).toBe('POSITION · AUTO');
    expect(FACING_LABEL.compass).toBe('FACING · FROM COMPASS');
    expect(MOUNT_KINDS.map((kind) => MOUNT_LABEL[kind])).toEqual([
      'POLE MOUNT',
      'SOLAR',
      'TRAILER',
      'UNSURE',
    ]);
  });

  it('renders the queue line the panel draws, and pluralises the singular case', () => {
    expect(queueLine(2, true)).toBe('2 REPORTS QUEUED · SYNC ON WIFI');
    expect(queueLine(1, true)).toBe('1 REPORT QUEUED · SYNC ON WIFI');
  });

  it('does not promise wifi when the driver has turned wifi-only sync off', () => {
    expect(queueLine(2, false)).toBe('2 REPORTS QUEUED · SYNC WHEN ONLINE');
  });

  it('draws no queue line at all when nothing is queued', () => {
    expect(queueLine(0, true)).toBeNull();
  });
});

describe('POSITION · AUTO', () => {
  it("renders the panel's coordinate pair with the panel's own separator", () => {
    expect(reportCoordinates(39.0997, -84.5786)).toBe('39.0997 N · 84.5786 W');
  });

  it('says nothing rather than guessing when there is no fix', () => {
    expect(reportCoordinates(null, null)).toBe('—');
  });

  it('renders accuracy, satellites and the place segment in the drawn order', () => {
    expect(positionDetail({ accuracyM: 4, satellites: 9, place: 'FWM-0442' })).toBe(
      '±4 M · 9 SATS · FWM-0442',
    );
  });

  it('drops the satellite count on a browser, which never reports one', () => {
    expect(positionDetail({ accuracyM: 4, satellites: null, place: null })).toBe('±4 M');
  });

  it('has nothing to say when the platform reports neither', () => {
    expect(positionDetail({ accuracyM: null, satellites: null, place: null })).toBeNull();
    expect(NO_FIX_DETAIL).toBe('NO FIX');
  });

  it('SUBSTITUTES the camera id into the street-name slot, and only in confirm mode', () => {
    // The panel's third segment is a street name (`Reading Rd`). Naming it needs
    // a reverse geocode, which is a network request keyed to the driver's exact
    // position -- the one request this product refuses. So the slot is not
    // simply dropped: in CONFIRM mode it carries the camera being confirmed,
    // which is the same "which place is this" answer from data already on the
    // device. That is an ADDED element in a slot the design gives to something
    // else, and it is pinned here so it cannot become accidental.
    // GAP: see docs/gaps-inbox/report.md#no-street-name-without-a-reverse-geocode
    expect(positionDetail({ accuracyM: 4, satellites: null, place: 'FWM-0442' })).toBe(
      '±4 M · FWM-0442',
    );
    // NEW-CAMERA mode has no id to put there, and invents nothing.
    expect(positionDetail({ accuracyM: 4, satellites: null, place: null })).toBe('±4 M');
    expect(positionDetail({ accuracyM: 4, satellites: null, place: null })).not.toContain('Rd');
  });
});

describe('FACING · FROM COMPASS', () => {
  it("reproduces the panel's own readout for 223 degrees", () => {
    expect(facingCardinal(223)).toBe('SW');
    expect(facingDetail(223)).toBe('223° · covering the northbound lane');
  });

  it('names the lane by the reciprocal of the lens, on a four-point compass', () => {
    expect(laneCovered(0)).toBe('covering the southbound lane');
    expect(laneCovered(90)).toBe('covering the westbound lane');
    expect(laneCovered(180)).toBe('covering the northbound lane');
    expect(laneCovered(270)).toBe('covering the eastbound lane');
  });

  it('says nothing about a lane when no bearing is known', () => {
    expect(laneCovered(null)).toBeNull();
    expect(facingDetail(null)).toBeNull();
    expect(facingCardinal(null)).toBe('—');
  });
});

describe('the draft', () => {
  it('starts empty, in the mode the panel draws pressed', () => {
    const draft = emptyDraft();
    expect(draft.mode).toBe('new');
    expect(draft.facingDeg).toBeNull();
    expect(draft.facingSource).toBe('none');
    expect(draft.mount).toBeNull();
    expect(draft.makeModel).toBe('');
  });

  it('seeds the arc from the compass and reports where the bearing came from', () => {
    const seeded = seedFacing(emptyDraft(), 223, 'compass');
    expect(seeded.facingDeg).toBe(223);
    expect(FACING_LABEL[seeded.facingSource]).toBe('FACING · FROM COMPASS');
  });

  it('never overwrites a bearing the driver set on the arc', () => {
    const byHand = withFacing(seedFacing(emptyDraft(), 223, 'compass'), 40);
    const reseeded = seedFacing(byHand, 310, 'compass');
    expect(reseeded.facingDeg).toBe(40);
    expect(FACING_LABEL[reseeded.facingSource]).toBe('FACING · SET BY HAND');
  });

  it('says the arc is unset instead of drawing a bearing it does not have', () => {
    // The label changed with the meaning. An unset arc is now the NORMAL
    // opening state of every new report - the sheet stopped seeding facing from
    // the phone - so blaming the device for a question nobody has asked yet
    // would be wrong twice over.
    const seeded = seedFacing(emptyDraft(), null, 'compass');
    expect(seeded.facingDeg).toBeNull();
    expect(FACING_LABEL[seeded.facingSource]).toBe('FACING · NOT SET YET');
  });

  it('wraps a bearing the driver dragged past north', () => {
    expect(withFacing(emptyDraft(), 375).facingDeg).toBe(15);
    expect(withFacing(emptyDraft(), -10).facingDeg).toBe(350);
  });

  it('treats the chips as one choice, and lets a mis-tap be undone', () => {
    const pole = withMount(emptyDraft(), 'pole');
    expect(pole.mount).toBe('pole');
    expect(withMount(pole, 'unsure').mount).toBe('unsure');
    expect(withMount(pole, 'pole').mount).toBeNull();
  });

  it('keeps everything else when the mode changes', () => {
    const drafted = withMount(withMakeModel(emptyDraft(), 'Flock Falcon'), 'solar');
    const confirming = withMode(drafted, 'confirm');
    expect(confirming.mode).toBe('confirm');
    expect(confirming.mount).toBe('solar');
    expect(confirming.makeModel).toBe('Flock Falcon');
  });
});

describe('a plate must not escape through MAKE / MODEL', () => {
  it('accepts an ordinary make and model', () => {
    expect(makeModelIssue('Flock Falcon')).toBeNull();
    expect(makeModelIssue('')).toBeNull();
  });

  it('refuses anything plate-shaped', () => {
    expect(makeModelIssue('HVK 8842')).toBe('plate-shaped');
    expect(makeModelIssue('HVK-8842')).toBe('plate-shaped');
    expect(makeModelIssue('471 TRB')).toBe('plate-shaped');
  });

  it('blocks the submit rather than dropping what the driver typed', () => {
    const draft = withMakeModel(emptyDraft(), 'HVK 8842');
    expect(
      submitBlocker({ draft, hasPosition: true, cameraId: null, submitting: false }),
    ).toBe('plate-shaped');
  });

  it('keeps a plate out of the payload even if one somehow reaches it', () => {
    const payload = reportPayload(withMakeModel(emptyDraft(), 'HVK 8842'), CINCINNATI);
    expect(payload['make_model']).toBeNull();
    expect(JSON.stringify(payload)).not.toContain('HVK');
  });
});

describe('what blocks SUBMIT REPORT', () => {
  it('refuses a report with no position', () => {
    expect(
      submitBlocker({
        draft: emptyDraft(),
        hasPosition: false,
        cameraId: null,
        submitting: false,
      }),
    ).toBe('no-position');
  });

  it('refuses a confirmation with nothing nearby to confirm', () => {
    expect(
      submitBlocker({
        draft: emptyDraft('confirm'),
        hasPosition: true,
        cameraId: null,
        submitting: false,
      }),
    ).toBe('no-camera');
  });

  it('lets a complete new-camera report through', () => {
    expect(
      submitBlocker({
        draft: withMount(emptyDraft(), 'pole'),
        hasPosition: true,
        cameraId: null,
        submitting: false,
      }),
    ).toBeNull();
  });

  it('does not take a second press while one submission is in flight', () => {
    expect(
      submitBlocker({
        draft: emptyDraft(),
        hasPosition: true,
        cameraId: null,
        submitting: true,
      }),
    ).toBe('submitting');
  });
});

describe('the line above the button', () => {
  it('reads the queue when nothing is wrong', () => {
    expect(reportStatus({ blocker: null, queuedReports: 2, wifiOnly: true, failure: null })).toEqual(
      { tone: 'queued', text: '2 REPORTS QUEUED · SYNC ON WIFI' },
    );
  });

  it('says what is blocking instead of the count', () => {
    const status = reportStatus({
      blocker: 'no-position',
      queuedReports: 2,
      wifiOnly: true,
      failure: null,
    });
    expect(status).toEqual({ tone: 'blocked', text: 'NO POSITION FIX · A REPORT NEEDS ONE' });
  });

  it('puts a failure above everything else', () => {
    const status = reportStatus({
      blocker: 'no-position',
      queuedReports: 2,
      wifiOnly: true,
      failure: 'REPORT NOT QUEUED · TRY AGAIN',
    });
    expect(status).toEqual({ tone: 'failed', text: 'REPORT NOT QUEUED · TRY AGAIN' });
  });

  it('keeps the count visible while a submission is in flight', () => {
    expect(
      reportStatus({ blocker: 'submitting', queuedReports: 1, wifiOnly: true, failure: null }),
    ).toEqual({ tone: 'queued', text: '1 REPORT QUEUED · SYNC ON WIFI' });
  });

  it('has nothing to say with an empty queue and a fileable report', () => {
    expect(
      reportStatus({ blocker: null, queuedReports: 0, wifiOnly: true, failure: null }),
    ).toBeNull();
  });
});

describe('the signed payload', () => {
  it('carries what the sheet collected, named for the chain that hashes it', () => {
    const draft = withMount(withFacing(withMakeModel(emptyDraft(), 'Flock Falcon'), 223), 'pole');
    const payload = reportPayload(draft, CINCINNATI);

    expect(payload['schema']).toBe(REPORT_PAYLOAD_SCHEMA);
    expect(payload['kind']).toBe('new_camera');
    // THE PHONE, under a name that says so.
    expect(payload['observer_position']).toEqual({ lat: 39.0997, lon: -84.5786 });
    // THE CAMERA, and nobody established it, so it stays null rather than
    // quietly becoming a copy of the line above. That copy was the v1 bug.
    expect(payload['subject_position']).toBeNull();
    expect(payload['subject_position_source']).toBeNull();
    // A field called `position` must not come back, under any schema.
    expect(payload['position']).toBeUndefined();
    expect(payload[GPS_ACCURACY_FIELD]).toBe(4);
    expect(payload['facing_deg']).toBe(223);
    expect(payload['facing_source']).toBe('manual');
    expect(payload['mount']).toBe('pole');
    expect(payload['make_model']).toBe('Flock Falcon');
  });

  it('names the camera only when the report is a confirmation of one', () => {
    const subject: ReportSubject = { ...CINCINNATI, cameraId: 'FWM-0442' };
    expect(reportPayload(emptyDraft('new'), subject)['camera_id']).toBeNull();

    const confirmation = reportPayload(emptyDraft('confirm'), subject);
    expect(confirmation['kind']).toBe('confirm_existing');
    expect(confirmation['camera_id']).toBe('FWM-0442');
  });

  it('carries no photo, because this build cannot strip a photo of its location', () => {
    expect(reportPayload(emptyDraft(), CINCINNATI)['photo']).toBeNull();
  });
});
