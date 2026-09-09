/**
 * The `DARKROUTE` answer card.
 *
 * SOURCE: `.design-src-v2/Flockys App Screens v2.dc.html`, `04 · ASK -
 * LISTENING` (lines 313-322) -- a borderless #12141A card at a 6px radius with
 * 16px padding, the speaker label `DARKROUTE` in #FF2D5E, the answer at 16px/1.5,
 * and two 44px actions at an 8px radius: `TAKE DETOUR` filled in the alert hue
 * with #0A0A0C ink, and `ON SWEEP` outlined in #3A3F4B.
 *
 * v2 changed no markup and no copy here -- it took the card's 1px #23262F edge
 * off, raised the fill from #0E0F13 to #12141A so the card still separates from
 * the black body, and moved both corners from 2px to 6px / 8px. All of that is
 * in `ask.css`; this file is byte-identical to its v1 self below the comment.
 * See `docs/gaps-inbox/lookup-ask-v2.md`.
 *
 * WHICH ACTIONS APPEAR
 *   Only the ones the answer itself names. The card does not decorate an
 *   answer with a button that has nothing to act on: `TAKE DETOUR` needs a
 *   route to detour from, and this build has no route scoring, so nothing in
 *   `askAnswer.ts` ever emits it. It is drawn here because the design draws it
 *   and because the moment a route answer exists it is the button it needs.
 *
 * A DISABLED ACTION IS AN HONEST ACTION
 *   Same rule as RADAR: an action with no handler renders drawn and dimmed
 *   rather than live-looking and inert.
 *
 * The card is `role="status"` so an answer that arrives while the driver is
 * looking at the road is announced rather than silently painted.
 */

import type { ReactElement } from 'react';

import type { AskActionKind, AskAnswer } from '../askAnswer.ts';

/** The exact labels the design draws, and the exact emphasis it draws them in. */
const ACTION_LABEL: Readonly<Record<AskActionKind, string>> = {
  'take-detour': 'TAKE DETOUR',
  'on-sweep': 'ON SWEEP',
};

const ACTION_EMPHASIS: Readonly<Record<AskActionKind, 'primary' | 'secondary'>> = {
  'take-detour': 'primary',
  'on-sweep': 'secondary',
};

export interface AnswerCardProps {
  readonly answer: AskAnswer;
  /** Wired by whoever owns routing. Absent renders `TAKE DETOUR` disabled. */
  readonly onTakeDetour?: (() => void) | undefined;
  /** Wired by whoever owns navigation. Absent renders `ON SWEEP` disabled. */
  readonly onShowOnSweep?: (() => void) | undefined;
}

export function AnswerCard({
  answer,
  onTakeDetour,
  onShowOnSweep,
}: AnswerCardProps): ReactElement {
  const handlerFor = (kind: AskActionKind): (() => void) | undefined =>
    kind === 'take-detour' ? onTakeDetour : onShowOnSweep;

  return (
    <div
      className="fwm-ask-answer"
      data-fwm-ask-answered={answer.answered ? 'true' : 'false'}
      data-fwm-ask-intent={answer.intent}
      role="status"
    >
      <p className="fwm-ask-speaker">DARKROUTE</p>
      <p className="fwm-ask-answer-text">{answer.text}</p>
      {answer.actions.length === 0 ? null : (
        <div className="fwm-ask-actions">
          {answer.actions.map((kind) => {
            const onPress = handlerFor(kind);
            return (
              <button
                key={kind}
                type="button"
                className="fwm-ask-action"
                data-fwm-ask-action={kind}
                data-fwm-ask-action-kind={ACTION_EMPHASIS[kind]}
                disabled={onPress === undefined}
                onClick={onPress}
              >
                {ACTION_LABEL[kind]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
