/**
 * HELP - v1. "What it knows."
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isHelp` block.
 *
 * =============================================================================
 * THE ANSWERS ARE NOT REDRAWN, THEY ARE THE SAME DATA
 * =============================================================================
 * `answers.ts` is the source, unchanged, and it is the file with the rule at
 * the top: never write an answer you cannot point at code for. v1 changes the
 * hierarchy - a green promise card, then cards instead of a form - and changes
 * not one word of what the product claims about itself.
 *
 * The design writes four questions with one file path each. The real data has
 * more of both, and every file stays: the whole argument of this screen is that
 * a reader can go and check, and a citation dropped to make a card shorter is a
 * claim quietly made uncheckable.
 */

import type { ReactElement } from 'react';

import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../components/nav';
import { HELP_SECTIONS } from './answers.ts';

import './helpV1.css';

export const HELP_V1_TITLE = 'What it knows';

export const HELP_V1_PROMISE = 'Every answer names the file that makes it true.';
export const HELP_V1_PROMISE_SUB =
  'the repo is public. do not take our word for it - open the line.';

export function HelpV1Screen(): ReactElement {
  return (
    <section className="fwm-helpv1" aria-label="what it knows">
      <header className="fwm-helpv1-header">
        {/* Reached from MORE's RECEIPTS tile, from SETTINGS' help row and from
            RADAR under v0. All three are one tap from MORE, and MORE is the
            only one of them that is a place rather than a control. */}
        <BackKey to="more" label={BACK_TO_MORE} />
        <ReloadTitle title={HELP_V1_TITLE} className="fwm-helpv1-title" />
      </header>

      <div className="fwm-helpv1-promise">
        <h2 className="fwm-helpv1-promise-title">{HELP_V1_PROMISE}</h2>
        <p className="fwm-helpv1-promise-sub">{HELP_V1_PROMISE_SUB}</p>
      </div>

      {HELP_SECTIONS.map((section) => (
        <div className="fwm-helpv1-section" key={section.title}>
          <h2 className="fwm-helpv1-section-title fwm-data">{section.title}</h2>
          {section.answers.map((answer) => (
            <article className="fwm-helpv1-card" key={answer.question}>
              <h3 className="fwm-helpv1-question">{answer.question}</h3>
              <p className="fwm-helpv1-answer">{answer.answer}</p>
              {/* EVERY path, not the first one. See the header. */}
              <ul className="fwm-helpv1-files" aria-label="check in">
                {answer.checkIn.map((file) => (
                  <li className="fwm-helpv1-file fwm-data" key={file}>
                    {file}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}
