/**
 * CONFIDENCE - how much this record deserves to be believed.
 *
 * =============================================================================
 * WHY A CAMERA RECORD NEEDS A CONFIDENCE AT ALL
 * =============================================================================
 * Every other number on the intel card is a measurement: how far, which way,
 * who owns it. This one is about the RECORD rather than the camera, and it is
 * the only thing on the card that tells a driver how much weight to put on the
 * rest of it.
 *
 * The data is crowd- and OSM-sourced. A camera confirmed by four people last
 * week and a camera one person added fourteen months ago are drawn identically
 * on the scope, and they are not the same claim. Without this the product
 * presents a fourteen-month-old unconfirmed guess with exactly the authority of
 * a fact.
 *
 * =============================================================================
 * WHAT GOES INTO IT, AND WHY NOTHING ELSE DOES
 * =============================================================================
 *   AGE          when it was last confirmed. Cameras are removed, roads are
 *                rebuilt, and a record nobody has touched in a year is a record
 *                about the past.
 *   CONFIRMATIONS how many people have said it is still there. One person can
 *                be wrong about a camera; four rarely are about the same one.
 *   COMPLETENESS how many fields the record actually carries. A record with no
 *                owner and no mount is thinner evidence than one with both.
 *
 * Deliberately NOT included: distance, whether it is in range, or anything
 * about the driver. Confidence is a property of the record and must read the
 * same to everybody looking at the same camera - a number that changed as you
 * drove toward it would be measuring the wrong thing.
 *
 * =============================================================================
 * WHY IT IS FIVE BARS AND A WORD
 * =============================================================================
 * A percentage invites arithmetic nobody can check. Five steps and a word -
 * FRESH, GOOD, THIN, STALE - say the only thing a driver needs: how much to
 * trust it, at a glance, while driving.
 */

/** How long before a confirmation stops counting for much. */
export const CONFIDENCE_FRESH_DAYS = 30;
/** Past this, the record is describing the past. */
export const CONFIDENCE_STALE_DAYS = 180;

export const CONFIDENCE_STEPS = 5;

export type ConfidenceGrade = 'fresh' | 'good' | 'thin' | 'stale' | 'unknown';

export interface ConfidenceInput {
  /** Days since the last confirmation, or null when nothing ever confirmed it. */
  readonly ageDays: number | null;
  /** How many people have confirmed it. */
  readonly confirmations: number;
  /** Fields the record carries, out of those it could. */
  readonly fieldsKnown: number;
  readonly fieldsPossible: number;
}

export interface Confidence {
  /** 0..CONFIDENCE_STEPS. The number of lit bars. */
  readonly steps: number;
  readonly grade: ConfidenceGrade;
  /** `STALE · 14 D`, or `NEVER CONFIRMED`. */
  readonly label: string;
}

/** `14 D`, `3 MO`, `2 YR`. Coarse on purpose: the exact day is not the point. */
export function ageLabel(ageDays: number | null): string {
  if (ageDays === null) return 'NEVER CONFIRMED';
  if (ageDays < 1) return 'TODAY';
  if (ageDays < 60) return `${String(Math.round(ageDays))} D`;
  if (ageDays < 730) return `${String(Math.round(ageDays / 30))} MO`;
  return `${String(Math.round(ageDays / 365))} YR`;
}

export function confidenceFor(input: ConfidenceInput): Confidence {
  const { ageDays, confirmations, fieldsKnown, fieldsPossible } = input;

  // Never confirmed is its own answer, not a low score. "Nobody has checked"
  // and "several people checked and it scored badly" are different claims and
  // a driver deciding whether to trust a marker needs to tell them apart.
  if (ageDays === null && confirmations <= 0) {
    return { steps: 1, grade: 'unknown', label: ageLabel(null) };
  }

  // Age, worth up to two bars. A confirmation decays; it does not expire.
  const ageScore =
    ageDays === null
      ? 0
      : ageDays <= CONFIDENCE_FRESH_DAYS
        ? 2
        : ageDays <= CONFIDENCE_STALE_DAYS
          ? 1
          : 0;

  // Confirmations, worth up to two. The second and fourth are the ones that
  // change the picture: one person is an assertion, two is corroboration.
  const confirmScore = confirmations >= 4 ? 2 : confirmations >= 2 ? 1 : 0;

  // Completeness, worth one. It is the weakest signal - a fully filled record
  // can still be wrong - so it can never carry a record on its own.
  const completeness = fieldsPossible <= 0 ? 0 : fieldsKnown / fieldsPossible;
  const fieldScore = completeness >= 0.6 ? 1 : 0;

  const steps = Math.min(CONFIDENCE_STEPS, Math.max(1, ageScore + confirmScore + fieldScore));
  const grade: ConfidenceGrade =
    ageDays !== null && ageDays > CONFIDENCE_STALE_DAYS
      ? 'stale'
      : steps >= 4
        ? 'fresh'
        : steps === 3
          ? 'good'
          : 'thin';

  return {
    steps,
    grade,
    label: `${grade.toUpperCase()} · ${ageLabel(ageDays)}`,
  };
}

/**
 * The fields a driver could fill in, and how many are missing.
 *
 * Drives `HELP IDENTIFY · 2 FIELDS MISSING`. Naming the count turns a vague
 * invitation into a specific, finishable task, which is the difference between
 * a prompt people ignore and one they act on.
 */
export interface MissingFields {
  readonly missing: readonly string[];
  readonly label: string | null;
}

export function missingFields(known: Readonly<Record<string, boolean>>): MissingFields {
  const missing = Object.entries(known)
    .filter(([, isKnown]) => !isKnown)
    .map(([field]) => field);
  if (missing.length === 0) return { missing, label: null };
  return {
    missing,
    label: `${String(missing.length)} ${missing.length === 1 ? 'FIELD' : 'FIELDS'} MISSING`,
  };
}
