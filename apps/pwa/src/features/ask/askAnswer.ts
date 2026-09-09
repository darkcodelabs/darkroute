/**
 * ASK's answering logic: a question in, an honest answer out.
 *
 * =============================================================================
 * THIS FILE NEVER INVENTS AN ANSWER
 * =============================================================================
 * Every sentence it can produce is built from a number the stores already hold
 * -- the engine's in-range count, the engine's nearest assessment, the history
 * slice's exposure count, the cameras slice's own cached records -- or is a
 * refusal that names the real reason. There is no template with a plausible
 * number dropped into it, and there is no code path that answers a question
 * this build cannot actually answer.
 *
 * That is why the design's own showcase question is REFUSED. Screen 04 renders
 *
 *   "seven on your usual route. the Madison detour drops it to two and costs
 *    you four minutes."
 *
 * which needs route surveillance scoring (`B3 · PRE-DRIVE - ROUTE SURVEILLANCE
 * SCORE`) and a routing engine. Neither exists. Printing that sentence with
 * numbers we do not have would be the exact failure the product's own rule
 * forbids, so `route` questions get a refusal that says route scoring is not
 * built. See docs/gaps-inbox/ask.md#route-answers-cannot-be-computed.
 *
 * =============================================================================
 * `FWM-0442` IS A CAMERA ID, NOT A PLATE
 * =============================================================================
 * The design draws it twice, and both times it is a camera:
 *
 *   `ID FWM-0442 · EFF ATLAS OK`      02 · SWEEP, on the FALCON card
 *   `FWM-0442 · HOA · SHARED`         03 · LOOKUP, the camera that read a plate
 *
 * So `who owns FWM-0442` -- the design's own third TRY chip -- is a question
 * about a piece of public infrastructure, and it is answered from the cameras
 * slice's own cached record or refused for the real reason ("nothing cached
 * under that id"). It is NOT routed to the plate refusal, which would tell the
 * driver a false thing about their own question on the one screen whose whole
 * contract is that it never says anything untrue.
 * See docs/gaps-inbox/ask.md#fwm-0442-is-a-camera-id-not-a-plate.
 *
 * =============================================================================
 * A REFUSAL NAMES THE REAL REASON, WHICH MEANS THE CLASSIFIER MUST NOT GUESS
 * =============================================================================
 * `is 500 feet close` and `cameras on us 127` contain no plate. Refusing them
 * with "plate lookup is switched off" would be naming a reason that is not the
 * reason. {@link isPlateShaped} therefore rejects the plate SHAPE when the
 * letters are an ordinary English word or a unit, and `who owns` / `owner` are
 * ownership words rather than plate words -- a camera has an owner too.
 *
 * =============================================================================
 * THE ANSWER NEVER QUOTES THE QUESTION
 * =============================================================================
 * A spoken question can contain a licence plate. No answer produced here
 * interpolates the question text -- not the plate, and not the camera id
 * either -- so nothing spoken can ride out of this module inside a sentence and
 * reach a live region, a notification or a log. The transcript itself is
 * rendered once, on screen, and is never persisted; see the privacy note in
 * `AskScreen.tsx`.
 *
 * =============================================================================
 * VOICE
 * =============================================================================
 * Lowercase, terse, counts spelled as words. Both design files that draw an
 * answer agree on this: the phone renders "seven on your usual route" and the
 * watch renders `FOUR · TWO SHARED` (`W9 · ASK - VOICE ONLY`). Distances stay
 * as numerals, because that is how every other readout in the product draws
 * them ("425", "2.4").
 */

import type { CameraOwnerType } from '../../stores';
import { NO_VALUE, coarseDirection, distanceUnit, formatDistanceValue } from '../radar/format.ts';
import type { RelativeDirection } from '../radar/format.ts';

/**
 * What a question is about. Deliberately a tiny closed set: this is a router
 * to a handful of real data sources plus a refusal, not a natural-language
 * model.
 */
export type AskIntent = 'plate' | 'camera-owner' | 'route' | 'exposure' | 'cameras' | 'unknown';

/** The two actions the design draws on the answer card, and nothing else. */
export type AskActionKind = 'take-detour' | 'on-sweep';

export interface AskAnswer {
  readonly intent: AskIntent;
  /** False when this is a refusal. A refusal carries no actions. */
  readonly answered: boolean;
  readonly text: string;
  readonly actions: readonly AskActionKind[];
}

/**
 * One cached camera, as much of it as an answer may read.
 *
 * Structurally a subset of the cameras slice's `CameraRecord`, so the screen
 * hands the store's own array straight in with no mapping and no copy. Position
 * is deliberately absent: ASK answers ownership, never location.
 */
export interface AskCameraFact {
  readonly id: string;
  readonly ownerType?: CameraOwnerType;
}

/**
 * Everything ASK is allowed to answer from. All of it is already on the device
 * and already computed by `@fwm/core`; nothing here does geospatial arithmetic
 * and nothing here fetches.
 */
export interface AskFacts {
  /** True only while the position slice reports a live lock. */
  readonly hasFix: boolean;
  /** The engine's count. Muted cameras are included -- that is the mute rule. */
  readonly countInRange: number;
  readonly nearestDistanceFt: number | null;
  readonly nearestDirection: RelativeDirection | null;
  /** Camera passes today, muted ones included. */
  readonly todayPasses: number;
  /** `FEATURES.plateLookup`. Off in this build, pending permission. */
  readonly plateLookupEnabled: boolean;
  /**
   * The cameras this device has already cached. An ownership question is
   * answered from this array or refused; nothing is looked up over a network.
   */
  readonly cachedCameras: readonly AskCameraFact[];
}

// ---------------------------------------------------------------------------
// Counts as words
// ---------------------------------------------------------------------------

/**
 * Spelled-out counts up to twelve, numerals above.
 *
 * Twelve is where English stops having a single word per number, and a spoken
 * answer that says "thirteen" reads no better than "13" on a screen glanced at
 * from a driving position.
 * GAP: see docs/gaps-inbox/ask.md#counts-spelled-as-words
 */
const NUMBER_WORDS: readonly string[] = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

export function countWord(count: number): string {
  const whole = Math.max(0, Math.trunc(count));
  return NUMBER_WORDS[whole] ?? String(whole);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Lowercase, punctuation to spaces, runs of whitespace collapsed. Keeps digits,
 * because a plate and a camera id are mostly digits and the tests below need
 * them.
 */
export function normaliseQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The product's own camera id, as the design draws it: `FWM-0442`. Normalised
 * text has already turned the hyphen into a space, and a spoken id may arrive
 * with no separator at all, so both are accepted.
 */
const CAMERA_ID = /\bfwm ?([0-9]{3,5})\b/;

/** Explicit plate language. `who owns` is NOT here: a camera has an owner too. */
const PLATE_WORDS = /\b(plate|plates|tag|tags|licence|license|registered|registration)\b/;

/** Ownership language. On its own it says nothing about WHAT is owned. */
const OWNER_WORDS = /\b(who owns|whose|owner|owners|owned|owns)\b/;

const ROUTE_WORDS = /\b(route|routes|detour|commute|way home|drive home|get home|trip)\b/;
const EXPOSURE_WORDS = /\b(flocked|today|exposure|passed|passes)\b/;
const CAMERA_WORDS =
  /\b(camera|cameras|flock|flocks|near|nearby|around|range|ahead|watching|watched|watches)\b/;

/**
 * `HVK 8842` (03 · LOOKUP) and `471 TRB` (the second chip on the same panel):
 * two to four letters and three or four digits, in either order.
 */
const PLATE_SHAPE = /\b(?:([a-z]{2,4}) ?([0-9]{3,4})|([0-9]{3,4}) ?([a-z]{2,4}))\b/g;

/**
 * Short words that sit beside a number in an ordinary spoken question, and the
 * units a distance is spoken in.
 *
 * Without this list the shape above fires on `is 500 feet close`, `cameras on
 * us 127` and `about 500 ft`, and every one of them is answered with "plate
 * lookup is switched off" -- a refusal naming a reason that is not the reason,
 * for a question containing no plate. A plate that happens to spell one of
 * these is still caught whenever the driver says the word "plate".
 */
const NOT_PLATE_LETTERS: ReadonlySet<string> = new Set([
  // road and route prefixes
  'us', 'sr', 'cr', 'rt', 'rte', 'hwy', 'hw', 'exit',
  // units
  'ft', 'feet', 'foot', 'mi', 'mile', 'km', 'kmh', 'mph', 'kph', 'm', 'min',
  'mins', 'sec', 'secs', 'hr', 'hrs', 'hour', 'day', 'days', 'am', 'pm', 'yd',
  'yds', 'yard',
  // ordinary English that can touch a number
  'is', 'it', 'in', 'on', 'at', 'to', 'of', 'by', 'up', 'we', 'me', 'my', 'do',
  'go', 'no', 'so', 'or', 'if', 'be', 'as', 'an', 'and', 'are', 'was', 'the',
  'for', 'has', 'had', 'how', 'who', 'why', 'you', 'all', 'any', 'out', 'off',
  'far', 'get', 'got', 'its', 'may', 'new', 'now', 'one', 'two', 'six', 'ten',
  'over', 'into', 'near', 'last', 'past', 'this', 'that', 'then', 'than',
  'they', 'them', 'with', 'from', 'been', 'have', 'more', 'less', 'next',
  'some', 'take', 'away', 'back', 'road', 'unit', 'apt', 'area', 'code',
]);

/**
 * True when the text carries something that is actually shaped like a plate,
 * rather than an ordinary word that happens to precede or follow a number.
 */
export function isPlateShaped(text: string): boolean {
  PLATE_SHAPE.lastIndex = 0;
  let match = PLATE_SHAPE.exec(text);
  while (match !== null) {
    const letters = match[1] ?? match[4] ?? '';
    if (!NOT_PLATE_LETTERS.has(letters)) return true;
    match = PLATE_SHAPE.exec(text);
  }
  return false;
}

/**
 * Order is a safety property, not a preference.
 *
 *   1. An explicit plate word settles it, even when a camera id is also
 *      present: `who owns plate FWM 0442` is a plate question.
 *   2. A camera id is the product's own public infrastructure id and is
 *      answered as one -- it is not plate-shaped data about a person.
 *   3. Anything else plate-shaped is refused before a later branch can treat
 *      it as a camera question and answer it.
 *   4. `route` is tested before `cameras` because the design's own example --
 *      "any cameras on my route home" -- matches both, and the honest answer
 *      to it is the refusal.
 */
function classifyText(text: string): AskIntent {
  if (text === '') return 'unknown';
  if (PLATE_WORDS.test(text)) return 'plate';
  if (CAMERA_ID.test(text)) return 'camera-owner';
  if (isPlateShaped(text)) return 'plate';
  if (OWNER_WORDS.test(text) && CAMERA_WORDS.test(text)) return 'camera-owner';
  if (ROUTE_WORDS.test(text)) return 'route';
  if (EXPOSURE_WORDS.test(text)) return 'exposure';
  if (CAMERA_WORDS.test(text)) return 'cameras';
  return 'unknown';
}

export function classify(question: string): AskIntent {
  return classifyText(normaliseQuestion(question));
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const NO_ACTIONS: readonly AskActionKind[] = Object.freeze([]);
const SWEEP_ONLY: readonly AskActionKind[] = Object.freeze(['on-sweep']);

function refuse(intent: AskIntent, text: string): AskAnswer {
  return { intent, answered: false, text, actions: NO_ACTIONS };
}

/** "425 feet ahead", "2.4 miles ahead", or "425 feet away" with no heading. */
function nearestPhrase(facts: AskFacts): string | null {
  if (facts.nearestDistanceFt === null) return null;
  const value = formatDistanceValue(facts.nearestDistanceFt);
  if (value === NO_VALUE) return null;
  const unit = distanceUnit(facts.nearestDistanceFt) === 'MI' ? 'miles' : 'feet';
  const where = coarseDirection(facts.nearestDirection);
  const heading = where === null ? 'away' : where.toLowerCase();
  return `nearest is ${value} ${unit} ${heading}.`;
}

function camerasAnswer(facts: AskFacts): AskAnswer {
  if (!facts.hasFix) {
    return refuse('cameras', 'no gps fix yet, so nothing near you can be counted.');
  }
  const nearest = nearestPhrase(facts);
  if (facts.countInRange <= 0) {
    const lead = 'nothing in range.';
    return {
      intent: 'cameras',
      answered: true,
      text: nearest === null ? lead : `${lead} ${nearest}`,
      actions: SWEEP_ONLY,
    };
  }
  const lead = `${countWord(facts.countInRange)} in range.`;
  return {
    intent: 'cameras',
    answered: true,
    text: nearest === null ? lead : `${lead} ${nearest}`,
    actions: SWEEP_ONLY,
  };
}

function exposureAnswer(facts: AskFacts): AskAnswer {
  const passes = Math.max(0, Math.trunc(facts.todayPasses));
  const noun = passes === 1 ? 'pass' : 'passes';
  return {
    intent: 'exposure',
    answered: true,
    text: `${countWord(passes)} camera ${noun} logged today. muted ones count.`,
    actions: NO_ACTIONS,
  };
}

function plateAnswer(facts: AskFacts): AskAnswer {
  if (facts.plateLookupEnabled) {
    return refuse(
      'plate',
      'the lookup screen answers that. a plate is matched on this device and never sent.',
    );
  }
  return refuse(
    'plate',
    'plate lookup is switched off in this build. nothing about a plate is looked up, stored or sent.',
  );
}

/**
 * The owner classes the cameras slice records, in the words the design uses.
 * `02 · SWEEP` draws `OWNER: HOA`; `03 · LOOKUP` draws `FWM-0442 · HOA · SHARED`
 * and `FWM-0118 · PD · SHARED`. Nothing here is a guess: each sentence is the
 * stored `ownerType` said out loud.
 */
const OWNER_PHRASE: Readonly<Record<CameraOwnerType, string>> = {
  police: 'a police department owns that one.',
  inter_agency: 'an inter-agency network owns that one.',
  hoa: 'a homeowners association owns that one.',
  private: 'a private owner owns that one.',
  unverified: 'that one is cached, but nobody has verified who owns it.',
};

/** Ids compare on letters and digits only: `FWM-0442`, `fwm 0442`, `FWM0442`. */
function idKey(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Ownership of a piece of public infrastructure, answered from the cached
 * record or refused. The id the driver said is never repeated back.
 */
function cameraOwnerAnswer(text: string, facts: AskFacts): AskAnswer {
  const digits = CAMERA_ID.exec(text)?.[1];
  if (digits === undefined) {
    return refuse(
      'camera-owner',
      'which camera? say its id, or open its card on sweep.',
    );
  }

  const wanted = `fwm${digits}`;
  const camera = facts.cachedCameras.find((cached) => idKey(cached.id) === wanted);
  if (camera === undefined) {
    return refuse(
      'camera-owner',
      'no camera with that id is cached on this device, so its owner is not known here.',
    );
  }

  const owner = camera.ownerType;
  if (owner === undefined) {
    return refuse('camera-owner', 'that camera is cached, but its record carries no owner.');
  }

  return {
    intent: 'camera-owner',
    answered: true,
    text: OWNER_PHRASE[owner],
    actions: SWEEP_ONLY,
  };
}

/**
 * The whole answerer. Pure: same question and same facts, same answer, no
 * clock, no storage, no network, no browser API.
 */
export function resolveAsk(question: string, facts: AskFacts): AskAnswer {
  const text = normaliseQuestion(question);
  switch (classifyText(text)) {
    case 'plate':
      return plateAnswer(facts);
    case 'camera-owner':
      return cameraOwnerAnswer(text, facts);
    case 'route':
      return refuse(
        'route',
        'route scoring is not built yet, so a detour cannot be compared for you.',
      );
    case 'exposure':
      return exposureAnswer(facts);
    case 'cameras':
      return camerasAnswer(facts);
    case 'unknown':
      return refuse('unknown', 'nothing here answers that yet.');
  }
}
