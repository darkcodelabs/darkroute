/**
 * Confidence, and the one thing it must never do: make a thin record look like
 * a checked one.
 */

import { describe, expect, it } from 'vitest';

import {
  CONFIDENCE_STALE_DAYS,
  CONFIDENCE_STEPS,
  ageLabel,
  confidenceFor,
  missingFields,
} from './confidence.ts';

const base = { ageDays: 5, confirmations: 4, fieldsKnown: 3, fieldsPossible: 3 };

describe('confidence', () => {
  it('tells "nobody has checked" apart from "checked and it scored badly"', () => {
    // The distinction the whole thing exists for. A driver deciding whether to
    // trust a marker needs to know which of the two they are looking at, and a
    // single low number cannot say.
    const never = confidenceFor({ ageDays: null, confirmations: 0, fieldsKnown: 0, fieldsPossible: 3 });
    const checked = confidenceFor({ ageDays: 400, confirmations: 1, fieldsKnown: 0, fieldsPossible: 3 });

    expect(never.grade).toBe('unknown');
    expect(never.label).toBe('NEVER CONFIRMED');
    expect(checked.grade).toBe('stale');
    expect(checked.label).toContain('STALE');
  });

  it('ranks a fresh, corroborated, complete record highest', () => {
    expect(confidenceFor(base).steps).toBe(CONFIDENCE_STEPS);
    expect(confidenceFor(base).grade).toBe('fresh');
  });

  it('never lets completeness alone carry a record', () => {
    // A fully filled record can still be wrong, and a form that scores well for
    // being filled in rewards guessing.
    const filledButOld = confidenceFor({
      ageDays: CONFIDENCE_STALE_DAYS + 1,
      confirmations: 0,
      fieldsKnown: 3,
      fieldsPossible: 3,
    });
    expect(filledButOld.steps).toBeLessThanOrEqual(2);
    expect(filledButOld.grade).toBe('stale');
  });

  it('always lights at least one bar, because the camera is still on the map', () => {
    // Zero bars would read as "there is nothing here", and there is: somebody
    // put a camera at this position. The claim being weak is not the same as
    // the claim being absent.
    const worst = confidenceFor({ ageDays: 5000, confirmations: 0, fieldsKnown: 0, fieldsPossible: 3 });
    expect(worst.steps).toBeGreaterThanOrEqual(1);
  });

  it('decays with age rather than expiring', () => {
    const fresh = confidenceFor({ ...base, ageDays: 5 });
    const middling = confidenceFor({ ...base, ageDays: 90 });
    const old = confidenceFor({ ...base, ageDays: 400 });
    expect(fresh.steps).toBeGreaterThan(middling.steps);
    expect(middling.steps).toBeGreaterThan(old.steps);
  });

  it('says the age coarsely, because the exact day is not the point', () => {
    expect(ageLabel(0)).toBe('TODAY');
    expect(ageLabel(14)).toBe('14 D');
    expect(ageLabel(90)).toBe('3 MO');
    expect(ageLabel(800)).toBe('2 YR');
    expect(ageLabel(null)).toBe('NEVER CONFIRMED');
  });

  it('is a property of the record, not of the driver', () => {
    // Nothing about distance, heading or range is an input. A confidence that
    // changed as you drove toward a camera would be measuring the wrong thing,
    // and two drivers looking at one camera must read the same number.
    const a = confidenceFor(base);
    const b = confidenceFor({ ...base });
    expect(a).toStrictEqual(b);
  });
});

describe('missing fields', () => {
  it('names the count so the ask is finishable', () => {
    const { label, missing } = missingFields({ owner: false, mount: false, facing: true });
    expect(missing).toStrictEqual(['owner', 'mount']);
    expect(label).toBe('2 FIELDS MISSING');
  });

  it('says nothing at all when the record is complete', () => {
    expect(missingFields({ owner: true, mount: true }).label).toBeNull();
  });

  it('is singular for one', () => {
    expect(missingFields({ owner: false, mount: true }).label).toBe('1 FIELD MISSING');
  });
});
