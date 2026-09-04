/**
 * ASK, as a pure function of a view model.
 *
 * `AskScreen.tsx` owns the microphone, the stores and the answering; this file
 * decides what is on screen and in what order, and nothing else. Splitting them
 * is what makes every state -- idle, listening, answering, answered, and
 * wake-word-unavailable -- individually renderable in a test with no adapter,
 * no microphone and no permission prompt.
 *
 * =============================================================================
 * THE STACK, TOP TO BOTTOM -- transcribed from `04 · ASK - LISTENING`
 * =============================================================================
 *   52px header        `ASK`, and the wake-word chip on the right
 *   notice strips      one line per thing the platform has to admit
 *   84px voice band    nine columns; the control that opens the microphone
 *   caption            `LISTENING…` in the design; one line per phase here
 *   `YOU` block        the transcript, behind a 2px rule
 *   `DARKROUTE` card     the answer and its actions
 *   `TRY` chips        pinned to the bottom of the column
 *
 * v2 redrew this panel and changed NOT ONE STRING in it. The order above, the
 * copy, the phases and the components are all v1's; everything v2 moved is a
 * fill, a radius or a length, and it lives in `ask.css` and `VoiceBars.tsx`.
 * See `docs/gaps-inbox/lookup-ask-v2.md`.
 *
 * The dock the panel also draws is chrome owned by `src/app/App.tsx`, not by
 * this screen. See `components/dock/`. v2 deleted the REPORT CAMERA bar that
 * used to sit above it and moved that entry point into the dock itself, which
 * is that owner's change, not this one's.
 *
 * =============================================================================
 * TWO LIVE REGIONS, NOT THREE
 * =============================================================================
 * The notice strips and the answer card announce. The caption does NOT: it
 * flips `LISTENING…` -> `PRESS TO TALK` in the same commit that mounts an
 * answer, so making it a third live region meant every arriving answer was
 * announced twice. The state it carries is already on the band itself, whose
 * `aria-pressed` and label change with it and which is the focused element at
 * the moment it changes.
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

import type { AskAnswer } from '../askAnswer.ts';
import { AnswerCard } from './AnswerCard.tsx';
import { AskNotice } from './AskNotice.tsx';
import type { AskNoticeTone } from './AskNotice.tsx';
import { Transcript } from './Transcript.tsx';
import { TryChips } from './TryChips.tsx';
import { VoiceBars } from './VoiceBars.tsx';
import { WakeWordChip } from './WakeWordChip.tsx';
import type { WakeWordState } from './WakeWordChip.tsx';

/**
 * Where the screen is.
 *
 * `answering` is the gap between a final question and an answer. With the
 * built-in answerer it is instantaneous, so it is only ever seen when a caller
 * injects an asynchronous one -- but it is a real state and it is drawn rather
 * than papered over with a stale caption.
 */
export type AskPhase = 'idle' | 'listening' | 'answering' | 'answered' | 'unavailable';

export interface AskNoticeState {
  readonly text: string;
  readonly tone: AskNoticeTone;
}

export interface AskViewModel {
  readonly phase: AskPhase;
  readonly wakeWord: WakeWordState;
  /**
   * Empty when the platform has nothing to admit. A list rather than one line
   * because the standing privacy disclosure and a transient adapter error are
   * both true at once, and the disclosure may never be pushed off the screen
   * by a recogniser hiccup.
   */
  readonly notices: readonly AskNoticeState[];
  /** Render-only. Never stored, never sent. See `Transcript.tsx`. */
  readonly transcript: string;
  readonly transcriptInterim: boolean;
  readonly answer: AskAnswer | null;
  readonly chips: readonly string[];
}

export interface AskViewHandlers {
  /** Opens or closes the microphone. Absent renders the band inert. */
  readonly onToggleListening?: (() => void) | undefined;
  /** Arms or disarms wake word. Absent renders the chip inert. */
  readonly onToggleWakeWord?: (() => void) | undefined;
  /** Asks a question without the microphone. Wired to the TRY chips. */
  readonly onAsk?: ((question: string) => void) | undefined;
  readonly onTakeDetour?: (() => void) | undefined;
  readonly onShowOnSweep?: (() => void) | undefined;
}

export type AskViewProps = AskViewHandlers & {
  readonly model: AskViewModel;
};

/**
 * The caption under the bars.
 *
 * `LISTENING…` is the design's, character for character, ellipsis included.
 * The other four are authored: the design draws only the listening state.
 * GAP: see docs/gaps-inbox/ask.md#only-the-listening-caption-is-drawn
 */
const CAPTION: Readonly<Record<AskPhase, string>> = {
  idle: 'PRESS TO TALK',
  listening: 'LISTENING…',
  answering: 'ANSWERING…',
  answered: 'PRESS TO TALK',
  unavailable: 'VOICE UNAVAILABLE',
};

export function AskView({ model, ...handlers }: AskViewProps): ReactElement {
  const listening = model.phase === 'listening';
  const canListen = model.phase !== 'unavailable';

  return (
    <section className="fwm-ask" data-fwm-ask-phase={model.phase} aria-label="ask">
      <header className="fwm-ask-header">
        <BrandMark />
      <span className="fwm-ask-title">ASK</span>
        <WakeWordChip state={model.wakeWord} onToggle={handlers.onToggleWakeWord} />
      </header>

      {model.notices.map((notice) => (
        <AskNotice key={notice.text} text={notice.text} tone={notice.tone} />
      ))}

      <div className="fwm-ask-body">
        <VoiceBars
          listening={listening}
          onPress={canListen ? handlers.onToggleListening : undefined}
        />

        <p className="fwm-ask-status">{CAPTION[model.phase]}</p>

        <Transcript text={model.transcript} interim={model.transcriptInterim} />

        {model.answer === null ? null : (
          <AnswerCard
            answer={model.answer}
            onTakeDetour={handlers.onTakeDetour}
            onShowOnSweep={handlers.onShowOnSweep}
          />
        )}

        <TryChips chips={model.chips} onAsk={handlers.onAsk} />
      </div>
    </section>
  );
}
