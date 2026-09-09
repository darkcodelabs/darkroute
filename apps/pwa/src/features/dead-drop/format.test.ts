/**
 * DEAD DROP's strings, against what `B2` literally draws and against what the
 * signed record can honestly supply.
 */

import { describe, expect, it } from 'vitest';

import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';

import {
  NO_VALUE,
  capturedClock,
  capturedShort,
  dropCameraId,
  dropHeading,
  dropNumber,
  dropPhoto,
  dropPosition,
  hasPhoto,
  heldFor,
  photoWord,
} from './format.ts';

/** The capture the panel draws: 2026-08-20T14:22:08.412Z. */
const CAPTURED = '2026-08-20T14:22:08.412Z';
const CAPTURED_MS = Date.parse(CAPTURED);
const MINUTE = 60_000;

/** The payload REPORT actually signs, at the panel's coordinates. */
function payload(over: Partial<Record<string, unknown>> = {}): CanonicalObject {
  return {
    schema: 'fwm-report/v1',
    kind: 'new_camera',
    camera_id: null,
    position: { lat: 39.0997, lon: -84.5786 },
    gps_accuracy_m: 4,
    satellites: null,
    facing_deg: 223,
    facing_source: 'compass',
    mount: 'pole',
    make_model: null,
    photo: null,
    ...over,
  } as CanonicalObject;
}

describe('drop numbering', () => {
  it('zero-pads the chain position the way the panel draws it', () => {
    expect(dropNumber(0)).toBe('DROP 00');
    expect(dropNumber(1)).toBe('DROP 01');
    expect(dropNumber(3)).toBe('DROP 03');
  });

  it('keeps counting past a hundred drops instead of truncating', () => {
    expect(dropNumber(142)).toBe('DROP 142');
  });
});

describe('the CAPTURED row', () => {
  it('renders the signed timestamp to the millisecond, in UTC', () => {
    expect(capturedClock(CAPTURED)).toBe('14:22:08.412 UTC');
  });

  it('says nothing rather than guessing when the stamp is malformed', () => {
    expect(capturedClock('2026-08-20')).toBe(NO_VALUE);
  });
});

describe('the row time', () => {
  it('is the UTC clock time on the day of capture', () => {
    expect(capturedShort(CAPTURED, CAPTURED_MS + 30 * MINUTE)).toBe('14:22');
  });

  it('says "yesterday" the next UTC day, as the panel does for the synced drop', () => {
    const nextDay = Date.parse('2026-08-21T02:00:00.000Z');
    expect(capturedShort(CAPTURED, nextDay)).toBe('yesterday');
  });

  it('falls back to the date once a drop has been held longer than that', () => {
    const later = Date.parse('2026-09-03T02:00:00.000Z');
    expect(capturedShort(CAPTURED, later)).toBe('2026-08-20');
  });
});

describe('how long a drop has been held', () => {
  it('renders the panel’s "41 MIN"', () => {
    expect(heldFor(CAPTURED, CAPTURED_MS + 41 * MINUTE)).toBe('41 MIN');
  });

  it('truncates rather than rounding up: 59 minutes is not an hour', () => {
    expect(heldFor(CAPTURED, CAPTURED_MS + 59 * MINUTE)).toBe('59 MIN');
    expect(heldFor(CAPTURED, CAPTURED_MS + 60 * MINUTE)).toBe('1 HR');
  });

  it('counts in days once a queue has been holding for weeks', () => {
    expect(heldFor(CAPTURED, CAPTURED_MS + 24 * 60 * MINUTE)).toBe('1 DAY');
    expect(heldFor(CAPTURED, CAPTURED_MS + 21 * 24 * 60 * MINUTE)).toBe('21 DAYS');
  });

  it('clamps to zero when the device clock has gone backwards', () => {
    expect(heldFor(CAPTURED, CAPTURED_MS - 5 * MINUTE)).toBe('0 MIN');
  });
});

describe('the POSITION row', () => {
  it('renders the signed coordinates and accuracy as the panel draws them', () => {
    expect(dropPosition(payload())).toBe('39.0997 N 84.5786 W ±4M');
  });

  it('drops the accuracy rather than printing an empty tolerance', () => {
    expect(dropPosition(payload({ gps_accuracy_m: null }))).toBe('39.0997 N 84.5786 W');
  });

  it('names the southern and eastern hemispheres correctly', () => {
    const southEast = payload({ position: { lat: -33.8688, lon: 151.2093 } });
    expect(dropPosition(southEast)).toBe('33.8688 S 151.2093 E ±4M');
  });

  it('renders an em dash rather than a coordinate the record does not have', () => {
    expect(dropPosition(payload({ position: null }))).toBe(NO_VALUE);
    expect(dropPosition(null)).toBe(NO_VALUE);
  });
});

describe('the HEADING row', () => {
  it("renders the record's own facing in degrees", () => {
    expect(dropHeading(payload())).toBe('223°');
  });

  it('renders no speed, because no signed field carries one', () => {
    expect(dropHeading(payload())).not.toContain('MPH');
  });

  it('renders an em dash when the record set no facing', () => {
    expect(dropHeading(payload({ facing_deg: null }))).toBe(NO_VALUE);
  });
});

describe('the PHOTO row', () => {
  it('says NONE rather than inventing a count and a size', () => {
    expect(dropPhoto(payload())).toBe('NONE');
    expect(photoWord(payload())).toBe('no photo');
    expect(hasPhoto(payload())).toBe(false);
  });

  it("uses the panel's word once a record actually carries one", () => {
    const withPhoto = payload({ photo: { bytes: 2_100_000 } });
    expect(dropPhoto(withPhoto)).toBe('1');
    expect(photoWord(withPhoto)).toBe('photo');
  });
});

describe('the camera a drop names', () => {
  it('reads the confirmed camera id off the signed payload', () => {
    expect(dropCameraId(payload({ camera_id: 'FWM-0442' }))).toBe('FWM-0442');
  });

  it('is null for a new-camera report, which names none', () => {
    expect(dropCameraId(payload())).toBeNull();
  });
});
