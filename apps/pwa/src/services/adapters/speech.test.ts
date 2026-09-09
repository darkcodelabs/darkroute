/**
 * A turn cue never talks over a camera warning. That is the test.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SPEECH_LANG,
  SPEECH_RATE,
  createSpeechSynthesisAdapter,
  isPrioritySource,
  speechSynthesisCapability,
  type SpeechSource,
} from './speech';
import { withGlobals } from './testing/globals';

/**
 * Models the platform closely enough to be worth trusting: `speak` flips
 * `speaking` on the way in and `cancel` flips it back, because the priority
 * rule is a decision about exactly that flag.
 */
class FakeUtterance {
  rate = 1;
  lang = '';
  onerror: ((event: { readonly error?: string }) => void) | null = null;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

interface FakeEngine {
  speaking: boolean;
  pending: boolean;
  readonly speak: (utterance: FakeUtterance) => void;
  readonly cancel: () => void;
}

interface Harness {
  readonly engine: FakeEngine;
  readonly spoken: FakeUtterance[];
  readonly cancels: () => number;
}

function withEngine(run: (harness: Harness) => void): void {
  const spoken: FakeUtterance[] = [];
  const cancel = vi.fn(() => {
    engine.speaking = false;
    engine.pending = false;
  });
  const engine: FakeEngine = {
    speaking: false,
    pending: false,
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push(utterance);
      engine.speaking = true;
    }),
    cancel,
  };
  withGlobals({ speechSynthesis: engine, SpeechSynthesisUtterance: FakeUtterance }, () => {
    run({ engine, spoken, cancels: () => cancel.mock.calls.length });
  });
}

/** No speech synthesis at all, which is jsdom and some Android WebViews. */
function withoutEngine(run: () => void): void {
  withGlobals({ speechSynthesis: undefined, SpeechSynthesisUtterance: undefined }, run);
}

describe('an unsupported environment', () => {
  it('says why in a sentence a driver could read', () => {
    withoutEngine(() => {
      const capability = speechSynthesisCapability();
      expect(capability.supported).toBe(false);
      expect(capability.reason).toMatch(/cannot speak/i);
    });
  });

  it('refuses to start, and speak stays a no-op that reports itself', () => {
    withoutEngine(() => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();

      expect(adapter.enabled()).toBe(false);
      expect(adapter.error()?.code).toBe('unsupported');

      const result = adapter.speak({ source: 'camera-alert', text: '400 feet, ahead' });
      expect(result.ok).toBe(false);
      expect(result.outcome).toBe('blocked');
    });
  });

  it('refuses when the engine exists but there is nothing to hand it', () => {
    withGlobals({ speechSynthesis: {}, SpeechSynthesisUtterance: undefined }, () => {
      const capability = speechSynthesisCapability();
      expect(capability.supported).toBe(false);
      expect(capability.reason).toMatch(/nothing to hand it/i);
    });
  });
});

describe('the priority rule', () => {
  const priorityCases: readonly SpeechSource[] = ['camera-alert', 'abuse-area'];

  it.each(priorityCases)('cuts off whatever is speaking for a %s', (source) => {
    withEngine(({ engine, spoken, cancels }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();

      adapter.speak({ source: 'navigation', text: 'Turn right onto West 119th Street.' });
      expect(engine.speaking).toBe(true);

      const result = adapter.speak({ source, text: 'camera, 400 feet, ahead slight left' });

      expect(result.ok).toBe(true);
      expect(result.outcome).toBe('accepted');
      expect(result.cancelled).toBe(true);
      expect(cancels()).toBe(1);
      // The warning still went out; cancelling is not the same as yielding.
      expect(spoken).toHaveLength(2);
      expect(spoken[1]!.text).toMatch(/camera/);
    });
  });

  it('drops a turn cue while something is already speaking, rather than queueing it', () => {
    withEngine(({ engine, spoken, cancels }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();

      adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });
      expect(engine.speaking).toBe(true);

      const result = adapter.speak({ source: 'navigation', text: 'Turn right.' });

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe('dropped');
      expect(result.cancelled).toBe(false);
      // Neither queued behind the warning nor allowed to cut it off.
      expect(spoken).toHaveLength(1);
      expect(cancels()).toBe(0);
    });
  });

  it('drops a turn cue that is only queued behind a pending one', () => {
    withEngine(({ engine, spoken }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      // Accepted but not started yet: still ahead of this cue in the queue.
      engine.pending = true;

      const result = adapter.speak({ source: 'navigation', text: 'Turn left.' });

      expect(result.outcome).toBe('dropped');
      expect(spoken).toHaveLength(0);
    });
  });

  it('speaks a turn cue when the road is quiet', () => {
    withEngine(({ spoken }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();

      const result = adapter.speak({ source: 'navigation', text: 'Turn right onto Main Street.' });

      expect(result.ok).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(spoken.map((u) => u.text)).toEqual(['Turn right onto Main Street.']);
    });
  });

  it('names the two sources that may interrupt, and only those', () => {
    expect(isPrioritySource('camera-alert')).toBe(true);
    expect(isPrioritySource('abuse-area')).toBe(true);
    expect(isPrioritySource('navigation')).toBe(false);
  });
});

describe('stopping', () => {
  it('cancels anything in flight', () => {
    withEngine(({ engine, cancels }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });

      adapter.stop();

      expect(cancels()).toBe(1);
      expect(engine.speaking).toBe(false);
      expect(adapter.enabled()).toBe(false);
    });
  });

  it('is idempotent, so a second stop does not re-cancel', () => {
    withEngine(({ cancels }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });

      adapter.stop();
      adapter.stop();

      expect(cancels()).toBe(1);
    });
  });

  it('refuses to speak once the switch is off', () => {
    withEngine(({ spoken }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      adapter.stop();

      const result = adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/map view panel/i);
      expect(spoken).toHaveLength(0);
    });
  });
});

describe('the voice', () => {
  it('speaks above the default rate, for a car at speed', () => {
    withEngine(({ spoken }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });

      expect(spoken[0]!.rate).toBe(SPEECH_RATE);
      expect(SPEECH_RATE).toBeGreaterThan(1);
      expect(spoken[0]!.lang).toBe(SPEECH_LANG);
    });
  });

  it('leaves pitch to the voice the driver already chose', () => {
    withEngine(({ spoken }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });

      // The fake declares no pitch, so the property only exists if we set one.
      expect(Object.hasOwn(spoken[0]!, 'pitch')).toBe(false);
      expect(Object.hasOwn(spoken[0]!, 'volume')).toBe(false);
    });
  });
});

describe('honesty about what the platform did', () => {
  it('reports an utterance error, which is the only late signal there is', () => {
    withEngine(({ spoken }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      const result = adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });
      expect(result.ok).toBe(true);
      expect(adapter.error()).toBeNull();

      spoken[0]!.onerror?.({ error: 'synthesis-failed' });

      expect(adapter.error()?.code).toBe('synthesis-failed');
    });
  });

  it('reports a refusal from the engine instead of claiming it spoke', () => {
    withEngine(({ engine }) => {
      const throwing = engine as { speak: (utterance: FakeUtterance) => void };
      throwing.speak = (): never => {
        throw new Error('no voice is installed');
      };
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();

      const result = adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe('failed');
      expect(adapter.error()?.code).toBe('speak-failed');
    });
  });

  it('says nothing for empty copy rather than taking the queue with silence', () => {
    withEngine(({ spoken }) => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();

      const result = adapter.speak({ source: 'navigation', text: '   ' });

      expect(result.outcome).toBe('blocked');
      expect(spoken).toHaveLength(0);
    });
  });

  it('publishes every outcome, including the drop nothing else records', () => {
    withEngine(() => {
      const adapter = createSpeechSynthesisAdapter();
      adapter.start();
      const seen: string[] = [];
      adapter.subscribe((event) => {
        seen.push(`${event.source}:${event.outcome}`);
        // The event carries the shape of what happened and none of the words.
        expect(Object.hasOwn(event, 'text')).toBe(false);
      });

      adapter.speak({ source: 'camera-alert', text: 'camera, 400 feet' });
      adapter.speak({ source: 'navigation', text: 'Turn right.' });

      expect(seen).toEqual(['camera-alert:accepted', 'navigation:dropped']);
    });
  });
});
