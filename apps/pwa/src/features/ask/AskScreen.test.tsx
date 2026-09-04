/**
 * ASK, wired to the real stores and to the mock adapter set.
 *
 * Three rules carry this suite:
 *
 *   1. THE MICROPHONE OPENS FROM A PRESS AND FROM NOWHERE ELSE. Mounting the
 *      screen must start nothing and request nothing, including the wake word
 *      the design draws already armed.
 *   2. THE SCREEN NEVER CLAIMS TO BE LISTENING AT A CLOSED MICROPHONE. The
 *      adapter can end a session without telling anyone; the screen has to
 *      notice anyway.
 *   3. NOTHING SAID HERE LEAVES THE SCREEN. A spoken plate must not reach
 *      storage, the URL, an answer or any store.
 *
 * The camera numbers come through `positionActions.ingestFix()` and
 * `ingestAlertTick()`, the same path the driving loop uses, so an answer that
 * agreed with a hand-built fixture and disagreed with the engine would fail.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScreenRegistry } from '../../app/App.tsx';
import { disposeScreenState, getScreenState, initScreenState } from '../../app/screenState.ts';
import { no } from '../../services/adapters/types.ts';
import { createMockAdapters, type MockAdapterSet } from '../../services/adapters/testing/mocks.ts';
import { ingestAlertTick, positionActions, resetAllStores } from '../../stores/index.ts';
import type { AlertTick, CameraAssessment } from '../../stores/index.ts';

import { AskScreen } from './AskScreen.tsx';
import type { AskAnswer } from './askAnswer.ts';

const NOW = 1_760_000_000_000;

const OFF_DEVICE = 'AUDIO LEAVES THE PHONE · THIS BROWSER USES A REMOTE SPEECH SERVICE';

function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'cam-1',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 221,
    inRange: true,
    muted: false,
    mergedIds: ['cam-1'],
    ...over,
  };
}

function tick(over: Partial<AlertTick> = {}): AlertTick {
  const nearest = over.nearest === undefined ? assessment() : over.nearest;
  return {
    timestampMs: NOW,
    state: 'in_range',
    previousState: 'clear',
    changed: true,
    nearest,
    cameras: nearest === null ? [] : [nearest],
    countInRange: 3,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: true,
    hapticPulses: 2,
    notifyCameraIds: ['cam-1'],
    suppressedBy: [],
    ...over,
  };
}

function lock(): void {
  positionActions.ingestFix({
    lat: 39.0997,
    lon: -84.5786,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: 21,
    headingDeg: 41,
    timestamp: NOW,
  });
}

/** One final recognition result, as the adapter publishes it. */
function speak(adapters: MockAdapterSet, transcript: string, isFinal = true): void {
  act(() => {
    adapters.speechRecognition.mock.emit({
      transcript,
      isFinal,
      confidence: 0.9,
      mode: 'push-to-talk',
      timestamp: NOW,
    });
  });
}

/**
 * Chrome, this product's primary target: the recogniser exists and it is the
 * network-backed one. The shared mock hard-codes `false` and exposes no setter,
 * so the one method is overridden here rather than in `testing/mocks.ts`, which
 * this feature does not own.
 */
function withOffDeviceAudio(set: MockAdapterSet): MockAdapterSet {
  return {
    ...set,
    speechRecognition: { ...set.speechRecognition, sendsAudioOffDevice: () => true },
  };
}

let adapters: MockAdapterSet;

beforeEach(() => {
  resetAllStores();
  adapters = createMockAdapters();
});

afterEach(() => {
  resetAllStores();
  disposeScreenState();
});

describe('this screen opens no microphone until it is pressed', () => {
  it('starts nothing and requests nothing on mount', () => {
    render(<AskScreen adapters={adapters} />);

    expect(adapters.speechRecognition.mock.starts()).toBe(0);
    expect(adapters.speechRecognition.mock.requests()).toBe(0);
    expect(adapters.speechRecognition.listening()).toBe(false);
    expect(adapters.visibility.mock.starts()).toBe(0);
  });

  it('renders the wake-word chip disarmed, even though the design draws it armed', () => {
    render(<AskScreen adapters={adapters} />);

    expect(screen.getByRole('button', { name: 'WAKE WORD OFF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'WAKE WORD ON' })).toBeNull();
  });

  it('opens the microphone on the first press of the voice band, and not before', () => {
    render(<AskScreen adapters={adapters} />);

    expect(adapters.speechRecognition.mock.starts()).toBe(0);
    act(() => {
      screen.getByRole('button', { name: 'press to talk' }).click();
    });

    expect(adapters.speechRecognition.mock.starts()).toBe(1);
    expect(adapters.speechRecognition.listening()).toBe(true);
    expect(screen.getByText('LISTENING…')).toBeInTheDocument();
  });

  it('closes the microphone on the second press', () => {
    render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'press to talk' }).click();
    });
    act(() => {
      screen.getByRole('button', { name: 'stop listening' }).click();
    });

    expect(adapters.speechRecognition.listening()).toBe(false);
    expect(screen.getByText('PRESS TO TALK')).toBeInTheDocument();
  });

  it('closes the microphone when the screen goes away', () => {
    const { unmount } = render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'press to talk' }).click();
    });
    expect(adapters.speechRecognition.listening()).toBe(true);

    unmount();
    expect(adapters.speechRecognition.listening()).toBe(false);
  });

  it('answers a chip without touching the microphone at all', () => {
    lock();
    ingestAlertTick(tick());
    render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'cameras near me' }).click();
    });

    expect(adapters.speechRecognition.mock.starts()).toBe(0);
    expect(screen.getByText('three in range. nearest is 425 feet ahead.')).toBeInTheDocument();
  });
});

describe('the screen never animates a microphone that is shut', () => {
  // The adapter records an error without notifying subscribers (`core.fail`)
  // and clears its own listening flag on the recogniser's `end` event with no
  // outbound signal at all. Both of these used to leave the bars running.

  it('drops out of listening when the permission prompt is denied mid-session', () => {
    vi.useFakeTimers();
    try {
      render(<AskScreen adapters={adapters} />);
      act(() => {
        screen.getByRole('button', { name: 'press to talk' }).click();
      });
      expect(screen.getByText('LISTENING…')).toBeInTheDocument();

      // `error: not-allowed`, then `end`. Nothing is published to a subscriber.
      act(() => {
        adapters.speechRecognition.mock.fail('not-allowed', 'microphone access refused');
        adapters.speechRecognition.stop();
      });
      expect(screen.getByText('LISTENING…')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(screen.queryByText('LISTENING…')).toBeNull();
      expect(screen.getByText('PRESS TO TALK')).toBeInTheDocument();
      expect(screen.getByText('microphone access refused')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops out of listening when the session simply ends on silence', () => {
    // "the session ends on silence" -- docs/platform-capabilities.md.
    vi.useFakeTimers();
    try {
      const { container } = render(<AskScreen adapters={adapters} />);
      act(() => {
        screen.getByRole('button', { name: 'press to talk' }).click();
      });

      act(() => {
        adapters.speechRecognition.stop();
      });
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(container.querySelector('.fwm-ask')?.getAttribute('data-fwm-ask-phase')).toBe('idle');
      expect(container.querySelector('.fwm-ask-notice')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disarms the chip when an armed wake-word session dies on its own', () => {
    vi.useFakeTimers();
    try {
      render(<AskScreen adapters={adapters} />);
      act(() => {
        screen.getByRole('button', { name: 'WAKE WORD OFF' }).click();
      });
      expect(screen.getByRole('button', { name: 'WAKE WORD ON' })).toBeInTheDocument();

      act(() => {
        adapters.speechRecognition.mock.fail('audio-capture', 'the microphone went away');
        adapters.speechRecognition.stop();
      });
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(screen.getByRole('button', { name: 'WAKE WORD OFF' })).toBeInTheDocument();
      expect(screen.getByText('the microphone went away')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('watches nothing while it is not listening', () => {
    vi.useFakeTimers();
    try {
      render(<AskScreen adapters={adapters} />);

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(adapters.speechRecognition.mock.starts()).toBe(0);
      expect(screen.getByText('PRESS TO TALK')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the two capability answers are kept apart', () => {
  it('arms the wake word from a press and reports it armed', () => {
    render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'WAKE WORD OFF' }).click();
    });

    expect(screen.getByRole('button', { name: 'WAKE WORD ON' })).toBeInTheDocument();
    expect(adapters.speechRecognition.mode()).toBe('wake-word');
  });

  it('uses the pessimistic probe for the chip and the optimistic one for the band', () => {
    // Push-to-talk works; the wake word does not. The band must stay live.
    adapters.speechRecognition.setWakeWordCapability(
      no('wake word only runs while darkroute is on screen; it stops when the screen locks'),
    );
    render(<AskScreen adapters={adapters} />);

    expect(screen.getByRole('button', { name: 'WAKE WORD OFF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'press to talk' })).toBeEnabled();
    expect(
      screen.getByText(
        'wake word only runs while darkroute is on screen; it stops when the screen locks',
      ),
    ).toBeInTheDocument();
  });

  it('disarms the wake word when the page stops being on screen', () => {
    render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'WAKE WORD OFF' }).click();
    });
    expect(screen.getByRole('button', { name: 'WAKE WORD ON' })).toBeInTheDocument();

    act(() => {
      adapters.visibility.setVisible(false);
    });

    expect(screen.getByRole('button', { name: 'WAKE WORD OFF' })).toBeInTheDocument();
    expect(adapters.speechRecognition.listening()).toBe(false);
  });

  it('watches the page only while the wake word is armed', () => {
    render(<AskScreen adapters={adapters} />);
    expect(adapters.visibility.mock.starts()).toBe(0);

    act(() => {
      screen.getByRole('button', { name: 'WAKE WORD OFF' }).click();
    });
    expect(adapters.visibility.mock.starts()).toBe(1);

    act(() => {
      screen.getByRole('button', { name: 'WAKE WORD ON' }).click();
    });
    expect(adapters.visibility.mock.stops()).toBe(1);
  });

  it('lets the band take the microphone from an armed wake word, and says so', () => {
    // The adapter runs one session at a time. A band press while wake word is
    // armed used to only tear the session down, which left no way to ask a
    // question at all and flipped the chip off as a silent side effect.
    render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'WAKE WORD OFF' }).click();
    });
    expect(adapters.speechRecognition.mode()).toBe('wake-word');

    act(() => {
      screen.getByRole('button', { name: 'stop listening' }).click();
    });

    expect(adapters.speechRecognition.mode()).toBe('push-to-talk');
    expect(adapters.speechRecognition.listening()).toBe(true);
    expect(screen.getByText('LISTENING…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WAKE WORD OFF' })).toBeInTheDocument();
    expect(screen.getByText(/PUSH-TO-TALK HAS IT/)).toBeInTheDocument();
  });
});

describe('the privacy disclosure is not a degraded state', () => {
  it('admits that audio leaves the phone before anything is pressed', () => {
    render(<AskScreen adapters={withOffDeviceAudio(adapters)} />);

    expect(screen.getByText(OFF_DEVICE)).toBeInTheDocument();
    expect(adapters.speechRecognition.mock.starts()).toBe(0);
  });

  it('keeps the disclosure on screen when something else fails', async () => {
    const failing = (): Promise<AskAnswer> => Promise.reject(new Error('no answerer'));
    render(<AskScreen adapters={withOffDeviceAudio(adapters)} resolve={failing} />);

    await act(async () => {
      screen.getByRole('button', { name: 'cameras near me' }).click();
      await Promise.resolve();
    });

    expect(screen.getByText('that could not be answered.')).toBeInTheDocument();
    expect(screen.getByText(OFF_DEVICE)).toBeInTheDocument();
  });
});

describe('a platform that cannot listen says so', () => {
  it('disables the band and renders the reason instead of animating nothing', () => {
    adapters.speechRecognition.mock.setCapability(
      no('speech recognition is not available in this browser'),
    );
    render(<AskScreen adapters={adapters} />);

    expect(screen.getByRole('button', { name: 'press to talk' })).toBeDisabled();
    expect(screen.getByText('VOICE UNAVAILABLE')).toBeInTheDocument();
    expect(
      screen.getByText('speech recognition is not available in this browser'),
    ).toBeInTheDocument();
  });

  it('never renders a transcript it did not receive', () => {
    adapters.speechRecognition.mock.setCapability(no('no recogniser here'));
    const { container } = render(<AskScreen adapters={adapters} />);

    expect(container.querySelector('.fwm-ask-you')).toBeNull();
    expect(container.querySelector('.fwm-ask-answer')).toBeNull();
  });
});

describe('what it hears, and what it does with it', () => {
  it('shows an interim result as a guess and the final result as the question', () => {
    lock();
    ingestAlertTick(tick());
    const { container } = render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'press to talk' }).click();
    });

    speak(adapters, 'cameras near', false);
    expect(
      container.querySelector('.fwm-ask-transcript')?.getAttribute('data-fwm-ask-interim'),
    ).toBe('true');

    speak(adapters, 'cameras near me');
    expect(
      container.querySelector('.fwm-ask-transcript')?.getAttribute('data-fwm-ask-interim'),
    ).toBe('false');
    // Scoped to the YOU block: `cameras near me` is also a TRY chip.
    expect(container.querySelector('.fwm-ask-transcript')?.textContent).toBe('cameras near me');
  });

  it("answers with the engine's own count, not with a number of its own", () => {
    lock();
    ingestAlertTick(tick({ countInRange: 2, nearest: assessment({ distanceFt: 820 }) }));
    render(<AskScreen adapters={adapters} />);

    speak(adapters, 'cameras near me');

    expect(screen.getByText('two in range. nearest is 820 feet ahead.')).toBeInTheDocument();
  });

  it('refuses the route question the design itself draws an answer for', () => {
    lock();
    ingestAlertTick(tick());
    render(<AskScreen adapters={adapters} />);

    speak(adapters, 'any cameras on my route home');

    expect(screen.getByText(/route scoring is not built/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TAKE DETOUR' })).toBeNull();
  });

  it('draws an honest waiting state while an injected answerer is still working', async () => {
    let release: (answer: AskAnswer) => void = () => undefined;
    const pending = new Promise<AskAnswer>((resolve) => {
      release = resolve;
    });
    render(<AskScreen adapters={adapters} resolve={() => pending} />);

    act(() => {
      screen.getByRole('button', { name: 'cameras near me' }).click();
    });

    expect(screen.getByText('ANSWERING…')).toBeInTheDocument();
    expect(screen.queryByText('DARKROUTE')).toBeNull();

    await act(async () => {
      release({ intent: 'cameras', answered: true, text: 'one in range.', actions: [] });
      await pending;
    });

    expect(screen.getByText('one in range.')).toBeInTheDocument();
  });
});

describe('nothing said here leaves the screen', () => {
  it('keeps a spoken plate out of the answer', () => {
    render(<AskScreen adapters={adapters} />);

    speak(adapters, 'who owns plate HVK 8842');

    const card = document.querySelector('.fwm-ask-answer-text');
    expect(card?.textContent ?? '').not.toContain('HVK');
    expect(card?.textContent ?? '').not.toContain('8842');
    expect(card?.textContent ?? '').toContain('plate lookup is switched off');
  });

  it('answers a spoken camera id as a camera, and never repeats it', () => {
    // `FWM-0442` is the camera the design draws on SWEEP and on LOOKUP. It is
    // not a plate, and telling the driver "plate lookup is switched off" would
    // be false about the question they asked.
    render(<AskScreen adapters={adapters} />);

    speak(adapters, 'who owns FWM-0442');

    const card = document.querySelector('.fwm-ask-answer-text');
    expect(card?.textContent ?? '').not.toContain('FWM-0442');
    expect(card?.textContent ?? '').not.toContain('0442');
    expect(card?.textContent ?? '').not.toContain('plate');
    expect(card?.textContent ?? '').toContain('cached on this device');
  });

  it('writes no transcript to storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<AskScreen adapters={adapters} />);

    speak(adapters, 'who owns FWM-0442');
    speak(adapters, 'who owns plate HVK 8842');

    for (const call of setItem.mock.calls) {
      expect(String(call[1] ?? '')).not.toContain('FWM-0442');
      expect(String(call[1] ?? '')).not.toContain('0442');
      expect(String(call[1] ?? '')).not.toContain('8842');
    }
  });

  it('puts no transcript in the URL', () => {
    initScreenState({ initialScreen: 'ask' });
    render(<AskScreen adapters={adapters} />);

    speak(adapters, 'who owns FWM-0442');

    expect(window.location.search).not.toContain('0442');
    expect(getScreenState().screen).toBe('ask');
  });

  it('forgets the transcript when the screen is unmounted', () => {
    // Scoped to the YOU block: `who owns FWM-0442` is also a TRY chip.
    const first = render(<AskScreen adapters={adapters} />);

    speak(adapters, 'who owns FWM-0442');
    expect(first.container.querySelector('.fwm-ask-transcript')?.textContent).toBe(
      'who owns FWM-0442',
    );

    first.unmount();
    const second = render(<AskScreen adapters={adapters} />);

    expect(second.container.querySelector('.fwm-ask-transcript')).toBeNull();
  });
});

describe('the shell can register it', () => {
  it('is a zero-prop component, the shape the screen registry takes', () => {
    // `App.tsx` types its registry as `Partial<Record<ScreenId, ComponentType>>`
    // and renders `<Screen />` with no props. This is a compile-time assertion
    // as much as a runtime one.
    const registry: ScreenRegistry = { ask: AskScreen };
    const Screen = registry.ask;
    expect(Screen).toBe(AskScreen);

    render(<AskScreen />);
    expect(screen.getByText('ASK')).toBeInTheDocument();
  });
});

describe('the TRY row is the row the design draws', () => {
  it('renders all three chips, in the design order', () => {
    // The third chip is a CAMERA id, not a plate lookup, so `plateLookup` does
    // not gate it. Filtering it shipped two of the design's three chips while
    // the view-level design-contract test still reported three.
    render(<AskScreen adapters={adapters} />);

    const chips = [...document.querySelectorAll('.fwm-ask-chip')].map((chip) => chip.textContent);
    expect(chips).toEqual(['cameras near me', 'flocked today?', 'who owns FWM-0442']);
  });

  it('asks the camera-owner chip without opening the microphone', () => {
    render(<AskScreen adapters={adapters} />);

    act(() => {
      screen.getByRole('button', { name: 'who owns FWM-0442' }).click();
    });

    expect(adapters.speechRecognition.mock.starts()).toBe(0);
    expect(screen.getByText(/cached on this device/)).toBeInTheDocument();
  });
});
