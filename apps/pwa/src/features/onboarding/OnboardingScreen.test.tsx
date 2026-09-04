/**
 * A1 · ONBOARDING - PERMISSIONS, tested against what the design literally
 * renders and against the one rule this screen exists to keep: it asks for
 * nothing until the driver asks it to.
 *
 * The copy block below is transcribed from `Flockys Screens II.dc.html`, frame
 * A1, and is asserted as literal text rather than through a shared constant on
 * purpose. A constant imported by both the component and the test would let the
 * two drift together, which is exactly the failure this suite is for.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { disposeScreenState, getScreenState } from '../../app/screenState.ts';
import { ADAPTER_NAMES } from '../../services/adapters';
import type { PermissionOutcome, RequestOutcome } from '../../services/adapters';
import { createMockAdapters, type MockAdapterSet } from '../../services/adapters/testing/mocks.ts';
import { capabilitiesActions, useSettingsStore } from '../../stores/index.ts';

import { OnboardingScreen } from './OnboardingScreen.tsx';
import { isRequestable, statusWordFor } from './components/PermissionCard.tsx';

/** Every string frame A1 renders, byte for byte. */
const A1_COPY = [
  'THEY WATCHING. WE WATCHING BACK.',
  "Cameras read your plate as you drive. This tells you where they are, before you pass them. Three permissions, then you're done.",
  'LOCATION',
  'GRANTED',
  'Required. Distance to cameras is computed on-device. Coordinates never leave the phone unless you file a report.',
  'NOTIFICATIONS',
  'ALLOW',
  'Asks the browser to show an alert notice. Delivery follows browser and phone rules. One channel, replaces itself, never stacks.',
  'MOTION SENSORS',
  'OPTIONAL',
  'Compass auto-fills which way a camera faces when you report one.',
  'SHOW A HANDLE',
  'off = you appear as an anonymous dot',
  'START WATCHING',
  'no account · no analytics · GPL-3.0-only source',
  'you can skip everything except location',
] as const;

interface SetupOptions {
  /** Passive permission state each adapter reports before anything is tapped. */
  readonly location?: PermissionOutcome;
  readonly notifications?: PermissionOutcome;
  readonly motion?: PermissionOutcome;
  /** What the OS says when `request()` is actually called. */
  readonly locationRequest?: RequestOutcome;
  /** Omit `onComplete` to exercise the default (navigate to RADAR). */
  readonly withOnComplete?: boolean;
}

interface Harness {
  readonly adapters: MockAdapterSet;
  readonly onComplete: ReturnType<typeof vi.fn>;
  readonly clock: () => number;
}

const CLOCK_BASE = 1_787_000_000_000;

async function setup(options: SetupOptions = {}): Promise<Harness> {
  const adapters = createMockAdapters();
  // The design's own frame: location already granted, the other two not yet
  // decided. Tests that need a different starting point say so.
  adapters.geolocation.mock.setPermission(options.location ?? 'granted');
  adapters.notifications.mock.setPermission(options.notifications ?? 'prompt');
  adapters.motion.mock.setPermission(options.motion ?? 'prompt');
  if (options.locationRequest !== undefined) {
    adapters.geolocation.mock.setRequestOutcome(options.locationRequest);
  }

  const onComplete = vi.fn();
  let tick = 0;
  const clock = (): number => CLOCK_BASE + (tick += 1);

  const props =
    options.withOnComplete === false
      ? { adapters, now: clock }
      : { adapters, now: clock, onComplete };

  await act(async () => {
    render(<OnboardingScreen {...props} />);
  });

  return { adapters, onComplete, clock };
}

/** Click, and let any promise the handler started settle inside act(). */
async function tap(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

function requestCounts(adapters: MockAdapterSet): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of ADAPTER_NAMES) {
    const adapter = adapters[name] as unknown as { mock: { requests(): number } };
    counts[name] = adapter.mock.requests();
  }
  return counts;
}

afterEach(() => {
  // Three module singletons this screen writes to. A leaked permission or a
  // leaked completion flag would make the next test lie.
  capabilitiesActions.reset();
  useSettingsStore.getState().reset();
  disposeScreenState();
});

describe('A1 copy', () => {
  it('renders every string the design frame renders, verbatim', async () => {
    await setup();
    for (const line of A1_COPY) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });

  it('draws the wordmark as one word with Route in the in-range hue', async () => {
    await setup();
    const wordmark = screen.getByRole('heading', { level: 1 });
    // ONE WORD, TWO COLOURS. The rendered text must read `DarkRoute` with no
    // space, which is the assertion that catches the two-tone lockup being
    // split into two elements that a screen reader announces separately.
    expect(wordmark.textContent).toBe('DarkRoute');

    // The colour itself is one rule in onboarding.css
    // (`.fwm-onboarding-wordmark-hue { color: var(--fwm-alert-in-range) }`).
    // vitest runs with `css: false`, so stylesheet text is not reachable from
    // here -- `node scripts/check-design-values.mjs` is what proves that rule
    // uses a token and not a hex. What this test can prove is that exactly the
    // second half of the wordmark carries the class.
    const hue = screen.getByText('Route');
    expect(hue.className).toBe('fwm-onboarding-wordmark-hue');
    expect(hue.previousSibling?.textContent).toBe('Dark');
    expect(hue.nextSibling).toBeNull();
    expect(wordmark.querySelectorAll('.fwm-onboarding-wordmark-hue')).toHaveLength(1);
  });

  it('never rewrites the fine print into two sentences of marketing', async () => {
    await setup();
    const fineprint = screen.getByText('no account · no analytics · GPL-3.0-only source');
    expect(fineprint.parentElement?.textContent).toBe(
      'no account · no analytics · GPL-3.0-only sourceyou can skip everything except location',
    );
  });
});

describe('permissions are never requested on mount', () => {
  it('requests nothing from any adapter when the screen renders', async () => {
    const { adapters } = await setup({ location: 'prompt' });

    for (const [name, count] of Object.entries(requestCounts(adapters))) {
      expect(`${name}:${String(count)}`).toBe(`${name}:0`);
    }
  });

  it('still requests nothing after the passive permission read resolves', async () => {
    const { adapters } = await setup({ location: 'prompt' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(adapters.geolocation.mock.requests()).toBe(0);
  });
});

describe('a tap on a card requests that permission and no other', () => {
  const cases = [
    { testId: 'permission-location', adapter: 'geolocation' },
    { testId: 'permission-notifications', adapter: 'notifications' },
    { testId: 'permission-motion', adapter: 'motion' },
  ] as const;

  for (const { testId, adapter } of cases) {
    it(`${testId} calls ${adapter}.request() exactly once`, async () => {
      const { adapters } = await setup({ location: 'prompt' });

      await tap(screen.getByTestId(testId));

      const counts = requestCounts(adapters);
      expect(counts[adapter]).toBe(1);
      for (const [name, count] of Object.entries(counts)) {
        if (name === adapter) continue;
        expect(`${name}:${String(count)}`).toBe(`${name}:0`);
      }
    });
  }

  it('reflects the platform answer in the status word', async () => {
    const { adapters } = await setup({ notifications: 'prompt' });
    expect(screen.getByText('ALLOW')).toBeInTheDocument();

    adapters.notifications.mock.setRequestOutcome('granted');
    await tap(screen.getByTestId('permission-notifications'));

    expect(screen.getByTestId('permission-notifications').textContent).toContain('GRANTED');
  });

  it('leaves an already-granted card with nothing to prompt for', async () => {
    const { adapters } = await setup({ location: 'granted' });
    const card = screen.getByTestId('permission-location');
    expect(card).toBeDisabled();

    await tap(card);
    expect(adapters.geolocation.mock.requests()).toBe(0);
  });

  it('says UNAVAILABLE, not DENIED, when the platform has no such sensor', async () => {
    const adapters = createMockAdapters();
    adapters.motion.mock.setCapability({ supported: false, reason: 'no motion sensor here' });
    await act(async () => {
      render(<OnboardingScreen adapters={adapters} onComplete={vi.fn()} />);
    });

    expect(screen.getByTestId('permission-motion').textContent).toContain('UNAVAILABLE');
    expect(screen.getByTestId('permission-motion')).toBeDisabled();
  });
});

describe('a denied location explains itself and offers a retry', () => {
  it('renders the explanation and a retry, and does not crash', async () => {
    const { adapters, onComplete } = await setup({
      location: 'prompt',
      locationRequest: 'denied',
    });

    await tap(screen.getByRole('button', { name: 'START WATCHING' }));

    expect(screen.getByTestId('permission-location').textContent).toContain('DENIED');
    expect(screen.getByTestId('location-denied')).toBeInTheDocument();
    expect(screen.getByText('LOCATION DENIED')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Distance to cameras is computed from your position. Without it there are no alerts, and a report cannot record where a camera is.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Turn location on for this site in your browser settings, then retry.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RETRY LOCATION' })).toBeInTheDocument();

    // The denial did not finish onboarding: the consequence is read first.
    expect(onComplete).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().onboardingCompletedAtMs).toBeNull();
    expect(adapters.geolocation.mock.requests()).toBe(1);
  });

  /**
   * THE REFRESH LOOP, PINNED.
   *
   * The rule was "stop on a refusal, and only once", and only the first half
   * was implemented: `if (outcome !== 'denied') complete()` stopped on EVERY
   * refusal, forever, and stopped silently. A driver who dismissed the OS
   * prompt pressed the only button on the screen, watched nothing happen, and
   * refreshed straight back onto `?screen=onboarding` -- because they had
   * genuinely never completed, so the first-run gate was right to hold them.
   *
   * A dismissed prompt and a real refusal are indistinguishable from here on
   * some engines, which is exactly why the second press has to work.
   */
  it('lets the second press through, so a refusal is never a dead end', async () => {
    const { adapters, onComplete } = await setup({
      location: 'prompt',
      locationRequest: 'denied',
    });

    await tap(screen.getByRole('button', { name: 'START WATCHING' }));
    expect(onComplete).not.toHaveBeenCalled();

    // Same button. This one goes through -- and WITHOUT a second OS prompt,
    // because the refusal moved the permission out of `prompt`, so the press
    // takes the straight-to-complete path. Asking twice for something already
    // refused is nagging, not a fix.
    await tap(screen.getByRole('button', { name: 'START WATCHING' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(adapters.geolocation.mock.requests()).toBe(1);
  });

  it('re-asks when RETRY LOCATION is tapped, and recovers if the answer changes', async () => {
    const { adapters } = await setup({ location: 'denied' });
    expect(screen.getByTestId('location-denied')).toBeInTheDocument();

    adapters.geolocation.mock.setRequestOutcome('denied');
    await tap(screen.getByRole('button', { name: 'RETRY LOCATION' }));
    expect(adapters.geolocation.mock.requests()).toBe(1);
    expect(screen.getByTestId('location-denied')).toBeInTheDocument();

    adapters.geolocation.mock.setRequestOutcome('granted');
    await tap(screen.getByRole('button', { name: 'RETRY LOCATION' }));
    expect(adapters.geolocation.mock.requests()).toBe(2);
    expect(screen.queryByTestId('location-denied')).toBeNull();
    expect(screen.getByTestId('permission-location').textContent).toContain('GRANTED');
  });

  it('does not trap the driver behind a decision the browser will not re-ask', async () => {
    const { onComplete } = await setup({ location: 'prompt', locationRequest: 'denied' });

    await tap(screen.getByRole('button', { name: 'START WATCHING' }));
    expect(onComplete).not.toHaveBeenCalled();

    // Second tap, explanation already on screen: the app opens anyway.
    await tap(screen.getByRole('button', { name: 'START WATCHING' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().onboardingCompletedAtMs).not.toBeNull();
  });

  it('shows no explanation while location is undecided or granted', async () => {
    await setup({ location: 'prompt' });
    expect(screen.queryByTestId('location-denied')).toBeNull();
  });
});

describe('the handle toggle', () => {
  it('defaults off, and off is what the store holds', async () => {
    await setup();
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(useSettingsStore.getState().showHandle).toBe(false);
  });

  it('records the preference, and records nothing else', async () => {
    await setup();
    const toggle = screen.getByRole('switch');

    await tap(toggle);
    expect(useSettingsStore.getState().showHandle).toBe(true);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    // Onboarding does not claim a handle: no name exists to store yet.
    expect(useSettingsStore.getState()).not.toHaveProperty('handle');

    await tap(screen.getByRole('switch'));
    expect(useSettingsStore.getState().showHandle).toBe(false);
  });
});

describe('START WATCHING', () => {
  it('asks for location from the tap when it has not been decided', async () => {
    const { adapters, onComplete } = await setup({
      location: 'prompt',
      locationRequest: 'granted',
    });

    await tap(screen.getByRole('button', { name: 'START WATCHING' }));

    expect(adapters.geolocation.mock.requests()).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('writes the completion flag exactly once, however many times it is tapped', async () => {
    const { onComplete } = await setup({ location: 'granted' });
    const button = screen.getByRole('button', { name: 'START WATCHING' });

    await tap(button);
    const first = useSettingsStore.getState().onboardingCompletedAtMs;
    expect(first).not.toBeNull();

    await tap(button);
    await tap(button);

    // The clock advances on every read, so a second write would move this.
    expect(useSettingsStore.getState().onboardingCompletedAtMs).toBe(first);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('replaces itself with RADAR when no completion handler is given', async () => {
    await setup({ location: 'granted', withOnComplete: false });

    await tap(screen.getByRole('button', { name: 'START WATCHING' }));

    expect(getScreenState().screen).toBe('radar');
    expect(useSettingsStore.getState().onboardingCompletedAtMs).not.toBeNull();
  });

  it('finishes without asking when the platform has no geolocation at all', async () => {
    const adapters = createMockAdapters();
    adapters.geolocation.mock.setCapability({ supported: false, reason: 'no gps in this browser' });
    const onComplete = vi.fn();
    await act(async () => {
      render(<OnboardingScreen adapters={adapters} onComplete={onComplete} />);
    });

    expect(screen.getByTestId('permission-location').textContent).toContain('UNAVAILABLE');
    await tap(screen.getByRole('button', { name: 'START WATCHING' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('the status table', () => {
  it('maps every platform answer to exactly one word', () => {
    expect(statusWordFor('required', 'granted', 'supported')).toBe('GRANTED');
    expect(statusWordFor('required', 'denied', 'supported')).toBe('DENIED');
    expect(statusWordFor('required', 'prompt', 'supported')).toBe('ALLOW');
    expect(statusWordFor('recommended', 'prompt', 'supported')).toBe('ALLOW');
    expect(statusWordFor('optional', 'prompt', 'supported')).toBe('OPTIONAL');
    expect(statusWordFor('required', 'granted', 'unsupported')).toBe('UNAVAILABLE');
    expect(statusWordFor('required', 'unavailable', 'supported')).toBe('UNAVAILABLE');
  });

  /**
   * REVERSED DECISION. This used to assert that `unknown` folded into `prompt`
   * -- `('required', 'unknown', …)` was ALLOW and `('optional', 'unknown', …)`
   * was OPTIONAL -- on the reasoning that both mean "not decided yet".
   *
   * They do not. `prompt` is something the OS said; `unknown` is the app
   * admitting it has not looked, and printing a platform's word for it is a
   * guess that is wrong every time the real answer turns out to be GRANTED.
   * That is how SETTINGS came to show MOTION SENSORS as OPTIONAL on an Android
   * phone that had granted it -- and, because the length of the unread window
   * varies per launch, to show GRANTED on the next load with nothing changed.
   */
  it('says CHECKING for a permission it has not read, rather than guessing', () => {
    expect(statusWordFor('required', 'unknown', 'unknown')).toBe('CHECKING');
    expect(statusWordFor('recommended', 'unknown', 'unknown')).toBe('CHECKING');
    expect(statusWordFor('optional', 'unknown', 'unknown')).toBe('CHECKING');
    // Even once the synchronous probe has landed: the capability is known, the
    // permission still is not.
    expect(statusWordFor('optional', 'unknown', 'supported')).toBe('CHECKING');
    // Except where the probe already settles it. "This phone does not have the
    // hardware" needs no permission read to be true.
    expect(statusWordFor('optional', 'unknown', 'unsupported')).toBe('UNAVAILABLE');
  });

  it('only offers a tap where a prompt could actually appear', () => {
    expect(isRequestable('ALLOW')).toBe(true);
    expect(isRequestable('OPTIONAL')).toBe(true);
    expect(isRequestable('DENIED')).toBe(true);
    // Not knowing yet is not the same as knowing there is nothing to ask for.
    // Disabling this would make onboarding's LOCATION press inert for the few
    // hundred milliseconds a driver is most likely to reach for it.
    expect(isRequestable('CHECKING')).toBe(true);
    expect(isRequestable('GRANTED')).toBe(false);
    expect(isRequestable('UNAVAILABLE')).toBe(false);
  });
});

describe('touch-first contract', () => {
  /**
   * onboarding.css itself is checked by `node scripts/check-design-values.mjs`,
   * which scans every non-test file under apps/pwa/src and fails the build on
   * `:hover`, `hover:`, a raw hex, a raw length, a raw duration or a raw easing
   * curve. It cannot be asserted from inside vitest: the runner is configured
   * with `css: false`, so a stylesheet import resolves to an empty string.
   * What IS assertable here is the rendered tree.
   */
  it('has no hover-dependent attribute in the rendered tree', async () => {
    await setup();
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.value.toLowerCase()).not.toContain('hover');
      }
    }
  });

  it('gives every control a tappable element and no inline style', async () => {
    await setup({ location: 'prompt' });
    const controls = Array.from(document.body.querySelectorAll('button'));
    // three cards, the handle switch, START WATCHING.
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(control.getAttribute('type')).toBe('button');
      // An inline style is how a raw design value gets past the checker.
      expect(control.getAttribute('style')).toBeNull();
    }
  });
});
