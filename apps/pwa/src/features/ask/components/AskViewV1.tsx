/**
 * ASK - v1. Hands free.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isAsk` block.
 *
 * A VIEW, NOT A SCREEN. `AskScreen` still owns the speech adapter, the wake
 * word, the capability probe, the off-device disclosure and the resolver; this
 * draws that model as v1's ping-ring and command list.
 *
 * =============================================================================
 * THE COMMAND LIST IS THE REAL GRAMMAR, NOT THE DESIGN'S
 * =============================================================================
 * v1 lists five spoken commands, three of which this build cannot do: it
 * cannot hand a waypoint to a maps app to AVOID, it cannot file a report from
 * a locked phone, and it has no ten-minute mute by voice. Printing them under
 * "WHAT IT UNDERSTANDS" would teach a driver to say things into a microphone
 * and get nothing back.
 *
 * So the list is `TRY_CHIPS` - the questions the resolver actually answers -
 * and they are tappable, which also makes the screen usable on a device with
 * no speech recognition at all.
 *
 * =============================================================================
 * THE PRIVACY LINE IS THE MODEL'S, NEVER THIS FILE'S
 * =============================================================================
 * The design writes "no audio is recorded, and nothing is sent anywhere". That
 * is true on a browser with on-device recognition and FALSE on one that ships
 * audio to a remote speech service, which several do. `model.notices` is where
 * the container puts the truth for the browser actually running, including its
 * standing off-device disclosure. This renders the notices and states no
 * privacy claim of its own.
 */

import type { ReactElement } from 'react';

import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../../components/nav';
import type { AskViewProps } from './AskView.tsx';

import '../askV1.css';

export const ASK_V1_TITLE = 'Ask';
export const HANDS_FREE = 'HANDS FREE';

export const PROMPT = '"Hey Flocky, what’s ahead?"';

/** What the mic key says in each phase. The model's phase, never a guess. */
export const PHASE_LABEL = {
  idle: 'Press to talk',
  listening: 'Listening…',
  answering: 'Answering…',
  answered: 'Press to talk',
  unavailable: 'Voice unavailable',
} as const;

export const WAKE_LABEL = {
  on: 'Wake word is on.',
  off: 'Wake word is off. Tap the mic.',
  unavailable: 'This browser has no wake word.',
} as const;

export const UNDERSTANDS = 'WHAT IT UNDERSTANDS';

export function AskViewV1({
  model,
  onToggleListening,
  onToggleWakeWord,
  onAsk,
}: AskViewProps): ReactElement {
  const listening = model.phase === 'listening';
  const canListen = model.phase !== 'unavailable';

  return (
    <section className="fwm-askv1" data-fwm-ask-phase={model.phase} aria-label="ask">
      <header className="fwm-askv1-header">
        {/* ASK, like LOOK UP, was a v0 dock key that v1 moved behind MORE and
            left with no exit. The title already claims `margin-right: auto`,
            so the arrow takes the left and the HANDS FREE badge keeps the
            right. */}
        <BackKey to="more" label={BACK_TO_MORE} />
        <ReloadTitle title={ASK_V1_TITLE} className="fwm-askv1-title" />
        <span className="fwm-askv1-badge fwm-data">{HANDS_FREE}</span>
      </header>

      <div className="fwm-askv1-mic-card">
        {/* The ring pings only while the microphone is actually open. An idle
            animation would be the screen implying it is listening. */}
        <button
          type="button"
          className="fwm-askv1-mic"
          data-fwm-listening={String(listening)}
          aria-pressed={listening}
          aria-label={PHASE_LABEL[model.phase]}
          disabled={!canListen || onToggleListening === undefined}
          onClick={onToggleListening}
        >
          <span className="fwm-askv1-ring" aria-hidden="true" />
          <span className="fwm-askv1-ring-inner" aria-hidden="true" />
          <svg
            className="fwm-askv1-glyph"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 4.5a2.6 2.6 0 0 1 2.6 2.6v4.4a2.6 2.6 0 0 1-5.2 0V7.1A2.6 2.6 0 0 1 12 4.5Z" />
            <path d="M6.2 11.4a5.8 5.8 0 0 0 11.6 0M12 17.2V19.5" />
          </svg>
        </button>

        <p className="fwm-askv1-prompt">{PROMPT}</p>
        <p className="fwm-askv1-phase fwm-data">{PHASE_LABEL[model.phase]}</p>
      </div>

      {/* THE TRANSCRIPT. Render-only: never stored, never sent. Interim text is
          dimmed because a recogniser's first guess is often wrong and a driver
          should be able to see which words have settled. */}
      {model.transcript === '' ? null : (
        <p
          className="fwm-askv1-transcript"
          data-fwm-interim={String(model.transcriptInterim)}
          aria-live="polite"
        >
          {model.transcript}
        </p>
      )}

      {model.answer === null ? null : (
        <div className="fwm-askv1-answer" data-fwm-answered={String(model.answer.answered)}>
          <p className="fwm-askv1-answer-text">{model.answer.text}</p>
        </div>
      )}

      {/* THE PLATFORM'S OWN ADMISSIONS. See the header for why no privacy
          sentence is written in this file. */}
      {model.notices.map((notice) => (
        <p className="fwm-askv1-notice fwm-data" data-fwm-tone={notice.tone} key={notice.text}>
          {notice.text}
        </p>
      ))}

      <button
        type="button"
        className="fwm-askv1-wake"
        aria-pressed={model.wakeWord === 'on'}
        disabled={model.wakeWord === 'unavailable' || onToggleWakeWord === undefined}
        onClick={onToggleWakeWord}
      >
        {WAKE_LABEL[model.wakeWord]}
      </button>

      <h2 className="fwm-askv1-eyebrow fwm-data">{UNDERSTANDS}</h2>

      <ul className="fwm-askv1-commands" aria-label="what it understands">
        {model.chips.map((chip) => (
          <li key={chip}>
            <button
              type="button"
              className="fwm-askv1-command"
              disabled={onAsk === undefined}
              onClick={() => {
                onAsk?.(chip);
              }}
            >
              <span className="fwm-askv1-command-say">{chip}</span>
              {/* TAPPABLE, and that is the point: it is the same question the
                  microphone would ask, on a device that may have no
                  microphone the browser will open. */}
              <span className="fwm-askv1-command-hint fwm-data">tap to ask</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
