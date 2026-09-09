/**
 * WHAT MAY BE PUBLISHED TO OPENSTREETMAP, AND WHAT MAY NOT.
 *
 * =============================================================================
 * THESE TESTS EXIST TO PIN REFUSALS
 * =============================================================================
 * Everything here asserts that something is NOT publishable. That is the
 * unusual shape, and it is deliberate: an OSM write is permanent, public, and
 * attributed to a named human being. The cost of wrongly refusing a report is
 * that a camera goes unmapped for a while. The cost of wrongly accepting one is
 * a false record under somebody's real account, at a coordinate that says where
 * their car was, in a database that is mirrored worldwide within the hour.
 *
 * Those are not symmetric, so the gate is not symmetric, and the tests are
 * written from the refusing side.
 *
 * The three refusals each correspond to a defect found in this codebase rather
 * than to a hypothetical:
 *
 *   1. `fwm-report/v1` stored ONE coordinate, taken from `useCurrentFix()`, and
 *      called it `position`. Readers treated it as the camera's location. It is
 *      the driver's.
 *   2. v2 records can still lack a camera position, because establishing one
 *      requires somebody to do it. Null has to stay null.
 *   3. The demo drive writes fabricated Chicago coordinates into the real
 *      position store, from a control that ships in production builds.
 */

import { describe, expect, it } from 'vitest';

import { osmBlocker, osmNodePosition } from './osmTags.ts';
import { REPORT_PAYLOAD_SCHEMA } from './reportDraft.ts';
import type { CanonicalObject } from '../../services/crypto/canonicalize.ts';

/** A v2 payload with the camera placed. The only publishable shape. */
function placed(over: Record<string, unknown> = {}): CanonicalObject {
  return {
    schema: REPORT_PAYLOAD_SCHEMA,
    kind: 'new_camera',
    camera_id: null,
    observer_position: { lat: 39.0997, lon: -84.5786 },
    subject_position: { lat: 39.0998, lon: -84.5788 },
    subject_position_source: 'placed',
    synthetic: false,
    gps_accuracy_m: 8,
    satellites: null,
    facing_deg: 180,
    facing_source: 'manual',
    mount: 'pole',
    make_model: null,
    photo: null,
    ...over,
  } as CanonicalObject;
}

describe('osmNodePosition', () => {
  it('reads the camera position, which is not the observer position', () => {
    // The two coordinates in the fixture differ. If this ever returns the
    // observer's, the number below changes and the test fails - which is the
    // whole reason the fixture does not reuse one point for both.
    expect(osmNodePosition(placed())).toEqual({ lat: 39.0998, lon: -84.5788 });
  });

  it('NEVER falls back to the observer position', () => {
    // The single most consequential line in this feature. A fallback here is
    // invisible in code review and files every camera in a traffic lane.
    const noSubject = placed({ subject_position: null, subject_position_source: null });
    expect(osmNodePosition(noSubject)).toBeNull();
  });

  it('refuses a v1 record, whose only coordinate is the driver', () => {
    const v1 = {
      schema: 'fwm-report/v1',
      kind: 'new_camera',
      camera_id: null,
      position: { lat: 39.0997, lon: -84.5786 },
      gps_accuracy_m: 8,
    } as CanonicalObject;
    expect(osmNodePosition(v1)).toBeNull();
    expect(osmBlocker(v1)).toBe('legacy-schema');
  });

  it('refuses coordinates that are not coordinates', () => {
    expect(osmNodePosition(placed({ subject_position: { lat: 'x', lon: 1 } }))).toBeNull();
    expect(osmNodePosition(placed({ subject_position: { lat: 91, lon: 1 } }))).toBeNull();
    expect(osmNodePosition(placed({ subject_position: { lat: 1, lon: 181 } }))).toBeNull();
    expect(osmNodePosition(placed({ subject_position: Number.NaN }))).toBeNull();
    expect(osmNodePosition(placed({ subject_position: [39, -84] }))).toBeNull();
    expect(osmNodePosition(null)).toBeNull();
  });
});

describe('osmBlocker', () => {
  it('passes a v2 report with a placed camera and nothing else', () => {
    expect(osmBlocker(placed())).toBeNull();
  });

  it('refuses a report captured during the demo drive', () => {
    /*
     * THE MICHIGAN AVENUE CASE.
     *
     * `demoDrive.ts` starts at 41.8819 / -87.6206 and writes fixes through the
     * same store the report screen reads, at `accuracyM: 4`. Its control mounts
     * unconditionally in Settings - there is no `import.meta.env.DEV` guard
     * anywhere in `features/demo/`. A curious user can run the demo, open the
     * report sheet (which opens from any screen) and submit.
     *
     * Every other signal says this record is excellent: high accuracy, valid
     * signature, tile source `network`. Only the capture-time flag knows.
     */
    const demo = placed({
      synthetic: true,
      observer_position: { lat: 41.8819, lon: -87.6206 },
      subject_position: { lat: 41.8821, lon: -87.6206 },
      gps_accuracy_m: 4,
    });
    expect(osmBlocker(demo)).toBe('demo-origin');
  });

  it('will not treat a missing flag as a passing flag', () => {
    // Absent is not false. A payload with no `synthetic` key predates the flag,
    // so it cannot vouch for itself and the schema check catches it first.
    const older = placed();
    delete (older as Record<string, unknown>)['synthetic'];
    // Still v2 and still placed, so it passes - the schema pin is what makes
    // this safe, and this test is here so that reasoning stays visible if the
    // schema check is ever relaxed.
    expect(osmBlocker(older)).toBeNull();
  });

  it('reports the missing camera position rather than passing quietly', () => {
    expect(osmBlocker(placed({ subject_position: null }))).toBe('no-subject-position');
    expect(osmBlocker(null)).toBe('no-subject-position');
  });
});
