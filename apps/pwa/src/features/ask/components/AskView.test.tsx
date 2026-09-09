/**
 * Every ASK state, rendered one at a time, against what the design draws.
 *
 * Reference: `Flockys App Screens.dc.html` -- screen `04 · ASK - LISTENING`
 * (the header and its chip, the nine-column band, `LISTENING…`, the `YOU`
 * block, the `DARKROUTE` card and its two actions, and the `TRY` chips), as
 * redrawn by `.design-src-v2/Flockys App Screens v2.dc.html` -- which changed
 * no copy on this screen at all, only fills, radii and the meter.
 *
 * `ask.css` is pulled in as text so the rules the tests care about -- the hue
 * blocks, the animation being scoped to the listening phase, the absence of
 * `:hover` -- can be asserted. vitest runs with `css: false`, so a computed
 * style would be empty and asserting on one would prove nothing.
 */

// `ask.css` is READ FROM DISK, not imported, for the reason above.
// `node:fs` used to need a @ts-expect-error here, because @types/node was
// deliberately not a dependency (see eslint.config.js). It arrives transitively
// now via the build-side AWS SDK that publishes the basemap, so the suppression
// became an error in its own right. The stance in eslint.config.js still holds
// for RUNTIME code; this is a test reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AskAnswer } from '../askAnswer.ts';

import { AskView } from './AskView.tsx';
import type { AskViewModel } from './AskView.tsx';
import { TRY_CHIPS } from './TryChips.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const askCss: string = readFileSync(`${HERE}/../ask.css`, 'utf8');
/** Rules only. The file's prose explains why there is no hover state, using the word. */
const askRules: string = askCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every top-level rule in the file, as `{ selector, body }`. */
function rules(): readonly { readonly selector: string; readonly body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  let match = pattern.exec(askRules);
  while (match !== null) {
    out.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
    match = pattern.exec(askRules);
  }
  return out;
}

function model(over: Partial<AskViewModel> = {}): AskViewModel {
  return {
    phase: 'idle',
    wakeWord: 'off',
    notices: [],
    transcript: '',
    transcriptInterim: false,
    answer: null,
    chips: TRY_CHIPS,
    ...over,
  };
}

const CAMERA_ANSWER: AskAnswer = {
  intent: 'cameras',
  answered: true,
  text: 'three in range. nearest is 425 feet ahead.',
  actions: ['on-sweep'],
};

/** The route answer the design draws, with both of its actions. */
const ROUTE_ANSWER: AskAnswer = {
  intent: 'route',
  answered: true,
  text: 'seven on your usual route.',
  actions: ['take-detour', 'on-sweep'],
};

describe('the panel the design draws', () => {
  it('renders the header, the caption, the speaker labels and the chips', () => {
    render(
      <AskView
        model={model({ phase: 'listening', transcript: 'any cameras on my route home', answer: CAMERA_ANSWER })}
      />,
    );

    expect(screen.getByText('ASK')).toBeInTheDocument();
    expect(screen.getByText('LISTENING…')).toBeInTheDocument();
    expect(screen.getByText('YOU')).toBeInTheDocument();
    expect(screen.getByText('any cameras on my route home')).toBeInTheDocument();
    expect(screen.getByText('DARKROUTE')).toBeInTheDocument();
    expect(screen.getByText('TRY')).toBeInTheDocument();
  });

  it('draws nine voice columns, the number the design draws', () => {
    const { container } = render(<AskView model={model({ phase: 'listening' })} />);

    expect(container.querySelectorAll('.fwm-ask-bar')).toHaveLength(9);
  });

  it('paints the dot field behind the columns, not among them', () => {
    // v2 stands the meter on a dimmer lattice of the same 5px pitch. It is one
    // element and it is the button's FIRST child: both it and the columns are
    // positioned, so DOM order is what puts the columns on top. Reordering
    // them would hide the meter behind its own backdrop.
    const { container } = render(<AskView model={model({ phase: 'listening' })} />);

    const band = container.querySelector('.fwm-ask-mic');
    expect(band?.querySelectorAll('.fwm-ask-field')).toHaveLength(1);
    expect(band?.firstElementChild?.className).toBe('fwm-ask-field');
  });

  it('gives every column its own clipped fill, which is what animates', () => {
    const { container } = render(<AskView model={model({ phase: 'listening' })} />);

    const columns = [...container.querySelectorAll('.fwm-ask-bar')];
    expect(columns.map((c) => c.getAttribute('data-fwm-ask-bar'))).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ]);
    for (const column of columns) {
      expect(column.querySelectorAll('.fwm-ask-bar-fill')).toHaveLength(1);
    }
  });

  it('renders the three TRY chips verbatim, in the design order', () => {
    // `TRY_CHIPS` is what `AskScreen` ships -- there is no filtered variant --
    // so this asserts the design contract against the constant the product
    // actually renders. `AskScreen.test.tsx` asserts the same three from the
    // running screen, which is the half this file cannot prove.
    const { container } = render(<AskView model={model()} onAsk={() => undefined} />);

    const chips = [...container.querySelectorAll('.fwm-ask-chip')].map((chip) => chip.textContent);
    expect(chips).toEqual(['cameras near me', 'flocked today?', 'who owns FWM-0442']);
    expect(TRY_CHIPS).toEqual(['cameras near me', 'flocked today?', 'who owns FWM-0442']);
  });

  it('labels the two answer actions exactly as the design labels them', () => {
    render(<AskView model={model({ phase: 'answered', answer: ROUTE_ANSWER })} />);

    expect(screen.getByRole('button', { name: 'TAKE DETOUR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ON SWEEP' })).toBeInTheDocument();
  });
});

describe('the five states', () => {
  it('idle draws the band and the chips, and claims to hear nothing', () => {
    const { container } = render(<AskView model={model()} />);

    expect(container.querySelector('.fwm-ask')?.getAttribute('data-fwm-ask-phase')).toBe('idle');
    expect(screen.getByText('PRESS TO TALK')).toBeInTheDocument();
    expect(screen.queryByText('LISTENING…')).toBeNull();
    // The bars are still drawn: the control cannot appear only after use.
    expect(container.querySelectorAll('.fwm-ask-bar')).toHaveLength(9);
  });

  it('listening switches the phase, which is what turns the bars on', () => {
    const { container } = render(<AskView model={model({ phase: 'listening' })} />);

    expect(container.querySelector('.fwm-ask')?.getAttribute('data-fwm-ask-phase')).toBe(
      'listening',
    );
    expect(screen.getByText('LISTENING…')).toBeInTheDocument();
  });

  it('answering says so instead of leaving a stale caption up', () => {
    render(<AskView model={model({ phase: 'answering', transcript: 'cameras near me' })} />);

    expect(screen.getByText('ANSWERING…')).toBeInTheDocument();
    expect(screen.queryByText('DARKROUTE')).toBeNull();
  });

  it('answered renders the card and the answer text', () => {
    const { container } = render(
      <AskView model={model({ phase: 'answered', answer: CAMERA_ANSWER })} />,
    );

    expect(screen.getByText('three in range. nearest is 425 feet ahead.')).toBeInTheDocument();
    expect(container.querySelector('.fwm-ask-answer')?.getAttribute('data-fwm-ask-answered')).toBe(
      'true',
    );
  });

  it('wake-word-unavailable disables the chip and renders the real reason', () => {
    render(
      <AskView
        model={model({
          wakeWord: 'unavailable',
          notices: [
            {
              text: 'wake word only runs while darkroute is on screen; it stops when the screen locks',
              tone: 'unsupported',
            },
          ],
        })}
        onToggleWakeWord={() => undefined}
      />,
    );

    const chip = screen.getByRole('button', { name: 'WAKE WORD OFF' });
    expect(chip).toBeDisabled();
    expect(
      screen.getByText(
        'wake word only runs while darkroute is on screen; it stops when the screen locks',
      ),
    ).toBeInTheDocument();
  });

  it('renders the armed chip only when it is actually armed', () => {
    render(<AskView model={model({ wakeWord: 'on' })} onToggleWakeWord={() => undefined} />);

    const chip = screen.getByRole('button', { name: 'WAKE WORD ON' });
    expect(chip.getAttribute('data-fwm-ask-wake')).toBe('on');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks an interim result as the guess it is', () => {
    const { container } = render(
      <AskView model={model({ phase: 'listening', transcript: 'cameras near', transcriptInterim: true })} />,
    );

    expect(
      container.querySelector('.fwm-ask-transcript')?.getAttribute('data-fwm-ask-interim'),
    ).toBe('true');
  });

  it('draws no YOU block and no card before anything has been said', () => {
    const { container } = render(<AskView model={model()} />);

    expect(container.querySelector('.fwm-ask-you')).toBeNull();
    expect(container.querySelector('.fwm-ask-answer')).toBeNull();
  });
});

describe('the notice strip carries every line that is true at once', () => {
  it('renders a transient reason AND the standing privacy disclosure', () => {
    // The off-device disclosure is the only place the product admits that audio
    // leaves the phone. A recogniser hiccup may not take it off the screen.
    const { container } = render(
      <AskView
        model={model({
          notices: [
            { text: 'microphone access refused', tone: 'warning' },
            { text: 'AUDIO LEAVES THE PHONE · THIS BROWSER USES A REMOTE SPEECH SERVICE', tone: 'warning' },
          ],
        })}
      />,
    );

    const lines = [...container.querySelectorAll('.fwm-ask-notice')].map((n) => n.textContent);
    expect(lines).toEqual([
      'microphone access refused',
      'AUDIO LEAVES THE PHONE · THIS BROWSER USES A REMOTE SPEECH SERVICE',
    ]);
  });

  it('draws no strip at all when the platform has nothing to admit', () => {
    const { container } = render(<AskView model={model()} />);

    expect(container.querySelectorAll('.fwm-ask-notice')).toHaveLength(0);
  });

  it('leaves the caption out of the live regions, so an answer announces once', () => {
    const { container } = render(
      <AskView model={model({ phase: 'answered', answer: CAMERA_ANSWER })} />,
    );

    const live = [...container.querySelectorAll('[role="status"]')].map((n) => n.className);
    expect(live).not.toContain('fwm-ask-status');
    expect(live).toContain('fwm-ask-answer');
  });
});

describe('a control with nothing behind it admits it', () => {
  it('disables the voice band when the platform cannot listen', () => {
    render(<AskView model={model({ phase: 'unavailable' })} onToggleListening={() => undefined} />);

    expect(screen.getByRole('button', { name: 'press to talk' })).toBeDisabled();
    expect(screen.getByText('VOICE UNAVAILABLE')).toBeInTheDocument();
  });

  it('disables an answer action that has no handler', () => {
    render(<AskView model={model({ phase: 'answered', answer: ROUTE_ANSWER })} />);

    expect(screen.getByRole('button', { name: 'TAKE DETOUR' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ON SWEEP' })).toBeDisabled();
  });

  it('runs an action handler on a press, and only on a press', () => {
    const onShowOnSweep = vi.fn();
    render(
      <AskView
        model={model({ phase: 'answered', answer: CAMERA_ANSWER })}
        onShowOnSweep={onShowOnSweep}
      />,
    );

    expect(onShowOnSweep).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'ON SWEEP' }).click();
    expect(onShowOnSweep).toHaveBeenCalledTimes(1);
  });

  it('asks the chip question on a press, verbatim', () => {
    const onAsk = vi.fn();
    render(<AskView model={model()} onAsk={onAsk} />);

    screen.getByRole('button', { name: 'flocked today?' }).click();
    expect(onAsk).toHaveBeenCalledWith('flocked today?');
  });

  it('disables the chips rather than removing the row when nothing can answer', () => {
    const { container } = render(<AskView model={model()} />);

    const chips = container.querySelectorAll('.fwm-ask-chip');
    expect(chips).toHaveLength(3);
    for (const chip of chips) expect(chip).toBeDisabled();
  });
});

describe('the answer card carries the answer and nothing else', () => {
  it('draws no action row on a refusal', () => {
    const { container } = render(
      <AskView
        model={model({
          phase: 'answered',
          answer: {
            intent: 'plate',
            answered: false,
            text: 'plate lookup is switched off in this build.',
            actions: [],
          },
        })}
      />,
    );

    const card = container.querySelector('.fwm-ask-answer');
    expect(card?.getAttribute('data-fwm-ask-answered')).toBe('false');
    expect(within(card as HTMLElement).queryByRole('button')).toBeNull();
  });
});

describe('the stylesheet holds the rules the screen depends on', () => {
  it('has no hover state anywhere', () => {
    expect(askRules).not.toContain(':hover');
  });

  it('animates the bars only while the phase is listening', () => {
    const animated = rules().filter((rule) => rule.body.includes('animation-'));
    expect(animated.length).toBeGreaterThan(0);
    for (const rule of animated) {
      expect(rule.selector).toContain('[data-fwm-ask-phase="listening"]');
    }
  });

  it('carries one hue per phase and never picks a colour per component', () => {
    expect(askRules).toContain('--fwm-ask-hue: var(--fwm-text-muted)');
    expect(askRules).toContain('--fwm-ask-hue: var(--fwm-accent-scan)');
    expect(askRules).toContain('--fwm-ask-hue: var(--fwm-text-disabled)');
  });

  it('scrolls its own body, so the bottom-pinned TRY row stays reachable', () => {
    // `App.tsx` renders `<main class="relative flex-1">` with no overflow of its
    // own. Without this the notice lines, a long transcript and a long refusal
    // push the `margin-top: auto` chip row under the fixed dock.
    const body = /(?:^|\n)\.fwm-ask-body \{([^}]*)\}/.exec(askCss)?.[1] ?? '';
    expect(body).toContain('overflow-y: auto');
  });

  it('gives every tap target the product touch floor', () => {
    for (const selector of ['.fwm-ask-wake', '.fwm-ask-action', '.fwm-ask-chip']) {
      const body = new RegExp(`(?:^|\\n)\\${selector} \\{([^}]*)\\}`).exec(askCss)?.[1] ?? '';
      expect(body).toContain('min-height: var(--fwm-touch-min)');
    }
  });
});

/**
 * v2's whole thesis, asserted on the file: "flat borderless controls, 8px
 * radius, fill-based depth". These are not style preferences -- each one is a
 * literal read from `04 · ASK - LISTENING` in
 * `.design-src-v2/Flockys App Screens v2.dc.html`, and each one is a place
 * where v2 disagrees with v1 and therefore wins.
 */
describe('the v2 redesign: fills where the borders were', () => {
  function body(selector: string): string {
    return new RegExp(`(?:^|\\n)\\${selector} \\{([^}]*)\\}`).exec(askCss)?.[1] ?? '';
  }

  it('drops the answer card edge and lifts its fill a rung to compensate', () => {
    // Taking the stroke off #0E0F13 would leave a card that reads as flat
    // black on a black body. v2 lifts it to #12141A, which is what
    // --fwm-surface-card names.
    const card = body('.fwm-ask-answer');

    expect(card).toContain('border: 0');
    expect(card).toContain('background: var(--fwm-surface-card)');
    expect(card).toContain('border-radius: var(--fwm-radius-2)');
    expect(card).not.toContain('var(--fwm-surface-1)');
  });

  it('makes the TRY chips filled keys instead of outlined pills', () => {
    const chip = body('.fwm-ask-chip');

    expect(chip).toContain('border: 0');
    expect(chip).toContain('background: var(--fwm-surface-control)');
    expect(chip).toContain('border-radius: var(--fwm-radius-3)');
  });

  it('gives every rectangular control the 8px v2 corner, and draws no 2px one', () => {
    expect(body('.fwm-ask-action')).toContain('border-radius: var(--fwm-radius-3)');
    // v2 draws 999px twenty-eight times, always on something actually round,
    // and never draws 2px at all. Neither belongs on a key on this screen.
    expect(askRules).not.toContain('var(--fwm-radius-full)');
    expect(askRules).not.toContain('var(--fwm-radius-1)');
  });

  it('puts named ink on the saturated key rather than reusing the background', () => {
    // v2 authored --fwm-text-on-alert for exactly this. Reusing --fwm-bg meant
    // a mode that remapped the background silently repainted the label.
    const primary = body('.fwm-ask-action\\[data-fwm-ask-action-kind="primary"\\]');

    expect(primary).toContain('color: var(--fwm-text-on-alert)');
    expect(primary).not.toContain('color: var(--fwm-bg)');
  });

  it('leaves the one border v2 kept, on the quiet half of the action row', () => {
    // `ON SWEEP` is the only stroked control left on the screen. Removing it
    // would make the two keys indistinguishable once the fill came off.
    expect(body('.fwm-ask-action\\[data-fwm-ask-action-kind="secondary"\\]')).toContain(
      'border-color: var(--fwm-line-strong)',
    );
  });

  it('keeps the header rule, because v2 stripped the controls and not the chrome', () => {
    expect(body('.fwm-ask-header')).toContain(
      'border-bottom: var(--fwm-ask-rule-w) solid var(--fwm-line)',
    );
  });
});

describe('the v2 voice meter', () => {
  it('lights the columns and never the field behind them', () => {
    // An instrument face has lit and unlit cells. The field is the unlit ones,
    // so it stays --fwm-line-grid-1 in every phase; only the columns follow
    // --fwm-ask-hue. If the field took the hue, idle would glow.
    const field = /(?:^|\n)\.fwm-ask-field \{([^}]*)\}/.exec(askCss)?.[1] ?? '';
    const fill = /(?:^|\n)\.fwm-ask-bar-fill \{([^}]*)\}/.exec(askCss)?.[1] ?? '';

    expect(field).toContain('var(--fwm-line-grid-1)');
    expect(field).not.toContain('var(--fwm-ask-hue)');
    expect(fill).toContain('var(--fwm-ask-hue)');
  });

  it('masks both lattices with the two mask tokens v2 authored for them', () => {
    expect(askRules).toContain('mask: var(--fwm-mask-voice-field)');
    expect(askRules).toContain('mask: var(--fwm-mask-voice-bar)');
  });

  it('clips each column so a scaling fill can never spill past the band', () => {
    const column = /(?:^|\n)\.fwm-ask-bar \{([^}]*)\}/.exec(askCss)?.[1] ?? '';

    expect(column).toContain('overflow: hidden');
    expect(column).toContain('width: var(--fwm-ask-bar-w)');
  });

  it('carries nine periods and repeats none of them', () => {
    const periods = [...askRules.matchAll(/--fwm-ask-dur-(\d): calc\(var\(--fwm-dur-alert\) \* ([\d.]+)\)/g)];

    expect(periods).toHaveLength(9);
    expect(new Set(periods.map((m) => m[2])).size).toBe(9);
  });
});

describe('no inline styles, because that is how raw values sneak past the checker', () => {
  it('renders no style attribute in any state', () => {
    for (const phase of ['idle', 'listening', 'answering', 'answered', 'unavailable'] as const) {
      const { container, unmount } = render(
        <AskView
          model={model({
            phase,
            answer: ROUTE_ANSWER,
            transcript: 'cameras near me',
            notices: [{ text: 'a reason', tone: 'warning' }],
          })}
        />,
      );
      expect(container.querySelectorAll('[style]')).toHaveLength(0);
      unmount();
    }
  });
});
