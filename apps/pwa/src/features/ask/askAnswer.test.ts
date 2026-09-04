/**
 * What ASK will say, and -- more importantly -- what it refuses to say.
 *
 * The rule these tests exist to hold: every sentence ASK produces is built from
 * a number the device already has, or is a refusal that names the real reason.
 * There is no branch that fills a template with a plausible-looking figure, and
 * no branch that refuses for a reason that is not the reason.
 */

import { describe, expect, it } from 'vitest';

import { classify, countWord, isPlateShaped, normaliseQuestion, resolveAsk } from './askAnswer.ts';
import type { AskCameraFact, AskFacts } from './askAnswer.ts';

/** A live drive with the numbers screen 01 renders: 3 in range, 425 ft ahead. */
function facts(over: Partial<AskFacts> = {}): AskFacts {
  return {
    hasFix: true,
    countInRange: 3,
    nearestDistanceFt: 425,
    nearestDirection: 'ahead',
    todayPasses: 4,
    plateLookupEnabled: false,
    cachedCameras: [],
    ...over,
  };
}

/** The camera the design draws on SWEEP and on LOOKUP: `FWM-0442 · HOA`. */
const FALCON: AskCameraFact = { id: 'FWM-0442', ownerType: 'hoa' };

describe('a camera question is answered from the engine, not from a template', () => {
  it("uses the engine's count and its nearest assessment", () => {
    const answer = resolveAsk('cameras near me', facts());

    expect(answer.answered).toBe(true);
    expect(answer.text).toBe('three in range. nearest is 425 feet ahead.');
  });

  it('counts muted cameras, because the count it is given already does', () => {
    // The cameras slice counts a muted camera exactly like any other. ASK reads
    // that number and does not get a say in it.
    const answer = resolveAsk('any cameras around', facts({ countInRange: 1 }));

    expect(answer.text).toContain('one in range');
  });

  it('says nothing is in range rather than rounding a zero away', () => {
    const answer = resolveAsk('cameras near me', facts({ countInRange: 0 }));

    expect(answer.answered).toBe(true);
    expect(answer.text).toBe('nothing in range. nearest is 425 feet ahead.');
  });

  it('switches to miles at the distance every other readout switches at', () => {
    const answer = resolveAsk('cameras near me', facts({ nearestDistanceFt: 3168 }));

    expect(answer.text).toContain('0.6 miles ahead');
  });

  it('drops the direction when there is no heading to be relative to', () => {
    const answer = resolveAsk('cameras near me', facts({ nearestDirection: null }));

    expect(answer.text).toBe('three in range. nearest is 425 feet away.');
  });

  it('refuses to count anything without a fix', () => {
    const answer = resolveAsk('cameras near me', facts({ hasFix: false }));

    expect(answer.answered).toBe(false);
    expect(answer.text).toContain('no gps fix');
    expect(answer.actions).toHaveLength(0);
  });

  it('offers only the action the design draws for it', () => {
    expect(resolveAsk('cameras near me', facts()).actions).toEqual(['on-sweep']);
  });

  it('answers the question the product is named after', () => {
    // CAMERA_WORDS carried `watching` and not `watched`, so the app called
    // DarkRoute had no answer for "am i being watched".
    expect(classify('am i being watched')).toBe('cameras');
    expect(resolveAsk('am i being watched', facts()).text).toContain('three in range');
  });
});

describe("the exposure question comes from the day's own count", () => {
  it('reports the number of passes and that muted ones are in it', () => {
    const answer = resolveAsk('flocked today?', facts({ todayPasses: 4 }));

    expect(answer.answered).toBe(true);
    expect(answer.text).toBe('four camera passes logged today. muted ones count.');
  });

  it('says a real zero rather than hiding the row', () => {
    expect(resolveAsk('flocked today?', facts({ todayPasses: 0 })).text).toBe(
      'no camera passes logged today. muted ones count.',
    );
  });

  it('agrees with itself about singular and plural', () => {
    expect(resolveAsk('flocked today?', facts({ todayPasses: 1 })).text).toContain(
      'one camera pass logged',
    );
  });
});

describe('a question this build cannot answer is refused, never faked', () => {
  it("refuses the design's own route question instead of inventing a detour", () => {
    // `04 · ASK` renders "seven on your usual route. the Madison detour drops it
    // to two and costs you four minutes." Route scoring does not exist, so the
    // numbers in that sentence do not exist either.
    const answer = resolveAsk('any cameras on my route home', facts());

    expect(answer.intent).toBe('route');
    expect(answer.answered).toBe(false);
    expect(answer.text).toContain('route scoring is not built');
    expect(answer.actions).toHaveLength(0);
  });

  it('never offers TAKE DETOUR, because nothing can compute one', () => {
    const questions = [
      'cameras near me',
      'flocked today?',
      'any cameras on my route home',
      'who owns FWM-0442',
      'who owns plate HVK 8842',
      'what is the weather',
    ];

    for (const question of questions) {
      expect(resolveAsk(question, facts({ cachedCameras: [FALCON] })).actions).not.toContain(
        'take-detour',
      );
    }
  });

  it('declines an unrelated question outright', () => {
    const answer = resolveAsk('what is the weather', facts());

    expect(answer.intent).toBe('unknown');
    expect(answer.answered).toBe(false);
  });
});

describe('a camera id is a camera id, not a plate', () => {
  // `ID FWM-0442 · EFF ATLAS OK`   -- 02 · SWEEP, the FALCON card
  // `FWM-0442 · HOA · SHARED`      -- 03 · LOOKUP, the camera that read a plate
  it("classifies the design's own third TRY chip as a camera question", () => {
    expect(classify('who owns FWM-0442')).toBe('camera-owner');
    expect(classify('FWM-0442')).toBe('camera-owner');
  });

  it('never tells the driver a plate is switched off when they asked about a camera', () => {
    const answer = resolveAsk('who owns FWM-0442', facts());

    expect(answer.intent).toBe('camera-owner');
    expect(answer.text).not.toContain('plate');
  });

  it("answers from the cached record's own owner class", () => {
    const answer = resolveAsk('who owns FWM-0442', facts({ cachedCameras: [FALCON] }));

    expect(answer.answered).toBe(true);
    expect(answer.text).toBe('a homeowners association owns that one.');
    expect(answer.actions).toEqual(['on-sweep']);
  });

  it('matches the id however it was heard', () => {
    for (const question of ['who owns fwm 0442', 'who owns FWM0442', 'owner of FWM-0442?']) {
      expect(resolveAsk(question, facts({ cachedCameras: [FALCON] })).answered).toBe(true);
    }
  });

  it('refuses with the real reason when nothing is cached under that id', () => {
    const answer = resolveAsk('who owns FWM-0442', facts({ cachedCameras: [] }));

    expect(answer.answered).toBe(false);
    expect(answer.text).toContain('cached on this device');
  });

  it('refuses when the cached record carries no owner rather than guessing one', () => {
    const answer = resolveAsk('who owns FWM-0442', facts({ cachedCameras: [{ id: 'FWM-0442' }] }));

    expect(answer.answered).toBe(false);
    expect(answer.text).toContain('no owner');
  });

  it('never repeats the camera id back into the answer', () => {
    for (const cached of [[FALCON], []]) {
      const answer = resolveAsk('who owns FWM-0442', facts({ cachedCameras: cached }));
      expect(answer.text).not.toContain('0442');
      expect(answer.text.toLowerCase()).not.toContain('fwm');
    }
  });

  it('asks which camera when an ownership question names none', () => {
    expect(classify('who owns that camera')).toBe('camera-owner');
    expect(resolveAsk('who owns that camera', facts()).text).toContain('which camera');
  });

  it('still treats an explicit plate word as a plate, even beside an id', () => {
    expect(classify('who owns plate FWM 0442')).toBe('plate');
  });
});

describe('a plate never survives the answering path', () => {
  it('refuses a plate question while the lookup flag is off', () => {
    const answer = resolveAsk('who owns plate HVK 8842', facts({ plateLookupEnabled: false }));

    expect(answer.intent).toBe('plate');
    expect(answer.answered).toBe(false);
    expect(answer.text).toContain('plate lookup is switched off');
  });

  it('still refuses in ASK once the flag is on, and points at the local screen', () => {
    const answer = resolveAsk('who owns plate HVK 8842', facts({ plateLookupEnabled: true }));

    expect(answer.answered).toBe(false);
    expect(answer.text).toContain('never sent');
  });

  it('does not repeat the plate back in any form', () => {
    const answer = resolveAsk('who owns plate HVK 8842', facts());

    expect(answer.text).not.toContain('HVK');
    expect(answer.text).not.toContain('8842');
    expect(answer.text.toLowerCase()).not.toContain('hvk');
  });

  it('classifies a bare plate as a plate before anything else can claim it', () => {
    // Both shapes the LOOKUP panel draws: `OH · HVK 8842` and `KY · 471 TRB`.
    expect(classify('HVK 8842')).toBe('plate');
    expect(classify('471 TRB')).toBe('plate');
    expect(classify('is plate ABC 1234 near a camera on my route')).toBe('plate');
  });

  it('never puts the question inside the answer, whatever the question was', () => {
    const questions = [
      'who owns FWM-0442',
      'who owns plate HVK 8842',
      'cameras near me',
      'flocked today?',
      'any cameras on my route home',
      'my address is 12 Madison',
    ];

    for (const question of questions) {
      const answer = resolveAsk(question, facts({ cachedCameras: [FALCON] }));
      expect(answer.text).not.toContain(question);
    }
  });
});

describe('a refusal names the real reason, so the plate test may not over-fire', () => {
  // Every one of these was classified `plate` and answered with "plate lookup
  // is switched off in this build" -- a refusal naming a reason that is not the
  // reason, for a question containing no plate.
  const NO_PLATE_HERE: readonly string[] = [
    'is 500 feet close',
    'cameras on us 127',
    'how many cameras in the last 500 ft',
    'who owns the camera ahead',
    'who is the owner of this camera',
  ];

  it('does not see a plate in a question that has none', () => {
    for (const question of NO_PLATE_HERE) {
      expect(classify(question)).not.toBe('plate');
    }
  });

  it('never answers one of them with the plate refusal', () => {
    for (const question of NO_PLATE_HERE) {
      expect(resolveAsk(question, facts()).text).not.toContain('plate lookup is switched off');
    }
  });

  it('routes a road number to the camera question it actually is', () => {
    expect(classify('cameras on us 127')).toBe('cameras');
  });

  it('reads the plate shape and not the words that sit beside a number', () => {
    expect(isPlateShaped('hvk 8842')).toBe(true);
    expect(isPlateShaped('471 trb')).toBe(true);
    expect(isPlateShaped('is 500 feet close')).toBe(false);
    expect(isPlateShaped('us 127')).toBe(false);
    expect(isPlateShaped('about 500 ft')).toBe(false);
  });
});

describe('classification order is a safety property', () => {
  it('puts route ahead of cameras, because the design example matches both', () => {
    expect(classify('any cameras on my route home')).toBe('route');
    expect(classify('any cameras near me')).toBe('cameras');
  });

  it('normalises casing and punctuation before matching', () => {
    expect(normaliseQuestion('  Flocked TODAY?  ')).toBe('flocked today');
    expect(classify('FLOCKED TODAY?')).toBe('exposure');
  });

  it('treats an empty question as unknown rather than as a match', () => {
    expect(classify('   ')).toBe('unknown');
  });
});

describe('counts read the way both design files write them', () => {
  it('spells counts as words up to twelve', () => {
    expect(countWord(0)).toBe('no');
    expect(countWord(1)).toBe('one');
    expect(countWord(7)).toBe('seven');
    expect(countWord(12)).toBe('twelve');
  });

  it('switches to numerals past twelve', () => {
    expect(countWord(13)).toBe('13');
  });

  it('never renders a negative or a fraction', () => {
    expect(countWord(-3)).toBe('no');
    expect(countWord(2.7)).toBe('two');
  });
});
