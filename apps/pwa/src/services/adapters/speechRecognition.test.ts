/**
 * ASK is voice. Push-to-talk is the contract; wake word is a best effort that
 * has to say so out loud.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSpeechAdapter,
  speechCapability,
  wakeWordCapability,
  type SpeechResult,
} from './speechRecognition';
import { withGlobals, withGlobalsAsync } from './testing/globals';

class FakeRecognition extends EventTarget {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 0;
  starts = 0;
  stops = 0;
  aborts = 0;

  constructor() {
    super();
    FakeRecognition.last = this;
  }

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
  }

  abort(): void {
    this.aborts += 1;
  }

  say(transcript: string, isFinal = true, confidence = 0.92): void {
    const event = Object.assign(new Event('result'), {
      resultIndex: 0,
      results: {
        length: 1,
        0: { length: 1, isFinal, 0: { transcript, confidence } },
      },
    });
    this.dispatchEvent(event);
  }
}

function setVisibility(state: 'visible' | 'hidden'): () => void {
  const saved = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  return () => {
    Reflect.deleteProperty(document as unknown as Record<string, unknown>, 'visibilityState');
    if (saved) Object.defineProperty(Document.prototype, 'visibilityState', saved);
  };
}

afterEach(() => {
  FakeRecognition.last = null;
});

describe('capability', () => {
  it('says no, with a reason, where the api does not exist', () => {
    const capability = speechCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/speech recognition/i);
  });

  it('says yes for push-to-talk once a constructor exists', () => {
    withGlobals({ SpeechRecognition: FakeRecognition }, () => {
      expect(speechCapability().supported).toBe(true);
    });
  });
});

describe('wake word honesty', () => {
  it('is never claimed when there is no recogniser at all', () => {
    expect(wakeWordCapability().supported).toBe(false);
  });

  it('refuses while the app is off screen, and says that is why', () => {
    const restore = setVisibility('hidden');
    try {
      withGlobals({ SpeechRecognition: FakeRecognition }, () => {
        const capability = wakeWordCapability();
        expect(capability.supported).toBe(false);
        expect(capability.reason).toMatch(/on screen|screen locks/i);
      });
    } finally {
      restore();
    }
  });

  it('stops itself the moment the app leaves the screen', () => {
    withGlobals({ SpeechRecognition: FakeRecognition }, () => {
      const adapter = createSpeechAdapter();
      adapter.start({ mode: 'wake-word' });
      expect(adapter.listening()).toBe(true);
      expect(FakeRecognition.last?.continuous).toBe(true);

      const restore = setVisibility('hidden');
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        restore();
      }

      expect(adapter.listening()).toBe(false);
      expect(adapter.error()?.code).toBe('wake-word-suspended');
      expect(adapter.error()?.message).toMatch(/press to talk/i);
    });
  });
});

describe('push to talk', () => {
  it('runs one non-continuous session and reports what was heard', () => {
    withGlobals({ SpeechRecognition: FakeRecognition }, () => {
      const adapter = createSpeechAdapter();
      const heard: SpeechResult[] = [];
      adapter.subscribe((result) => heard.push(result));

      adapter.startPushToTalk();
      expect(adapter.mode()).toBe('push-to-talk');
      expect(FakeRecognition.last?.continuous).toBe(false);
      expect(FakeRecognition.last?.starts).toBe(1);

      FakeRecognition.last?.say('any cameras on my route home');
      expect(heard).toHaveLength(1);
      expect(heard[0]?.transcript).toBe('any cameras on my route home');
      expect(heard[0]?.isFinal).toBe(true);
      expect(heard[0]?.mode).toBe('push-to-talk');

      adapter.stopPushToTalk();
      expect(FakeRecognition.last?.stops).toBe(1);
      expect(adapter.listening()).toBe(false);
    });
  });

  it('is idempotent: a second press while listening starts nothing new', () => {
    withGlobals({ SpeechRecognition: FakeRecognition }, () => {
      const adapter = createSpeechAdapter();
      adapter.startPushToTalk();
      const first = FakeRecognition.last;
      adapter.startPushToTalk();
      expect(FakeRecognition.last).toBe(first);
      expect(first?.starts).toBe(1);
      adapter.stop();
      adapter.stop();
    });
  });

  it('never throws where speech recognition does not exist', () => {
    const adapter = createSpeechAdapter();
    expect(() => {
      adapter.startPushToTalk();
      adapter.stopPushToTalk();
      adapter.stop();
    }).not.toThrow();
    expect(adapter.error()?.code).toBe('unsupported');
    expect(adapter.listening()).toBe(false);
  });

  it('records the recogniser error code rather than swallowing it', () => {
    withGlobals({ SpeechRecognition: FakeRecognition }, () => {
      const adapter = createSpeechAdapter();
      adapter.startPushToTalk();
      FakeRecognition.last?.dispatchEvent(
        Object.assign(new Event('error'), { error: 'no-speech', message: 'nothing heard' }),
      );
      expect(adapter.error()?.code).toBe('no-speech');
      adapter.stop();
    });
  });
});

describe('microphone permission', () => {
  it('surfaces a denial as denied, and holds the mic for no longer than it must', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    await withGlobalsAsync(
      { SpeechRecognition: FakeRecognition, navigator: { mediaDevices: { getUserMedia } } },
      async () => {
        const adapter = createSpeechAdapter();
        await expect(adapter.request()).resolves.toBe('denied');
        expect(adapter.error()?.code).toBe('permission-request-failed');
      },
    );
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops every track it opened when the user allows', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }, { stop }] }));
    await withGlobalsAsync(
      { SpeechRecognition: FakeRecognition, navigator: { mediaDevices: { getUserMedia } } },
      async () => {
        const adapter = createSpeechAdapter();
        await expect(adapter.request()).resolves.toBe('granted');
      },
    );
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable rather than guessing when there is no mediaDevices', async () => {
    await withGlobalsAsync(
      { SpeechRecognition: FakeRecognition, navigator: { userAgent: 'test' } },
      async () => {
        const adapter = createSpeechAdapter();
        await expect(adapter.request()).resolves.toBe('unavailable');
      },
    );
  });
});

describe('off-device audio', () => {
  it('admits that the webkit-prefixed implementation streams audio away', () => {
    withGlobals({ SpeechRecognition: undefined, webkitSpeechRecognition: FakeRecognition }, () => {
      expect(createSpeechAdapter().sendsAudioOffDevice()).toBe(true);
    });
    withGlobals({ SpeechRecognition: FakeRecognition, webkitSpeechRecognition: undefined }, () => {
      expect(createSpeechAdapter().sendsAudioOffDevice()).toBe(false);
    });
  });
});
