/**
 * "THIS IS WRONG" — from the screen where a driver notices it.
 *
 * =============================================================================
 * WHY IT STARTS HERE
 * =============================================================================
 * The reports that prompted this were all the same shape: somebody standing at
 * a camera, looking at the INTEL card, seeing it name the wrong maker. The
 * moment they know is the moment they are reading the wrong field, and every
 * navigation between that moment and a way to say so loses most of them.
 *
 * So the correction starts on the card, pre-filled with what the archive says,
 * and the driver's whole job is to say what it should be.
 *
 * =============================================================================
 * IT IS BUTTONS, NOT A FORM
 * =============================================================================
 * This is used at the roadside, often one-handed, sometimes in the dark. Every
 * choice that can be a button is a button; the only free text is an optional
 * note and an optional way to reach the person.
 *
 * The field list is the API's own allowlist, so a choice here cannot produce a
 * submission the server will reject - a validation error arriving after the
 * effort of filling something in is the worst time to learn the rules.
 *
 * =============================================================================
 * NOTHING IS SENT UNTIL THE LAST PRESS
 * =============================================================================
 * Same rule the detour sheet holds: the app does not act on a driver's behalf
 * across a boundary. Filling this in sends nothing. The send key says where it
 * goes, and says the submission will be public, because it will be - it becomes
 * a pull request with their words in it.
 */

import { useState } from 'react';
import type { ReactElement } from 'react';

import { ShareRefused, shareCorrection } from '../../services/share/shareCorrection.ts';
import type { CorrectionField } from '../../services/share/shareCorrection.ts';

import './correctionSheet.css';

export const CORRECTION_TITLE = 'What is wrong here?';
export const CORRECTION_PUBLIC =
  'this becomes a public pull request on the archive, with what you write in it. no account, ' +
  'and no need to give a contact.';
export const CORRECTION_SEND = 'Send it';
export const CORRECTION_SENT = 'Sent. It is a pull request now — open it to watch what happens.';
export const CORRECTION_DUPLICATE = 'Already sent — this exact correction is on the same pull request.';

interface Choice {
  readonly id: CorrectionField;
  readonly label: string;
  readonly hint: string;
}

/**
 * The things drivers actually report, in the order they report them.
 *
 * `brand` is first because it is the complaint that prompted this whole path:
 * the archive naming one maker for a unit that plainly says another on its own
 * housing.
 */
const CHOICES: readonly Choice[] = [
  { id: 'brand', label: 'Wrong brand', hint: 'the housing says a different maker' },
  { id: 'operator', label: 'Wrong operator', hint: 'a different agency or business runs it' },
  { id: 'gone', label: 'It is gone', hint: 'nothing there any more' },
  { id: 'position', label: 'Wrong place', hint: 'it is not where the map has it' },
  { id: 'direction', label: 'Wrong facing', hint: 'it points somewhere else' },
  { id: 'ownerType', label: 'Wrong owner type', hint: 'police, HOA, private and so on' },
  { id: 'mount', label: 'Wrong mount', hint: 'pole, signal, trailer' },
  { id: 'other', label: 'Something else', hint: 'say it in the note' },
];

export interface CorrectionSheetProps {
  readonly cameraId: string;
  /**
   * What the archive currently says, where it knows.
   *
   * `undefined` is explicit in the value type rather than only implied by
   * `Partial`: under `exactOptionalPropertyTypes` a caller passing a field it
   * has no value for is passing `undefined`, and refusing that would force
   * every call site to build the object conditionally for no gain.
   */
  readonly current: Readonly<Partial<Record<CorrectionField, string | undefined>>>;
  readonly onClose: () => void;
}

export function CorrectionSheet({ cameraId, current, onClose }: CorrectionSheetProps): ReactElement {
  const [field, setField] = useState<CorrectionField | null>(null);
  const [right, setRight] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ url: string; duplicate: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const send = (): void => {
    if (field === null || sending) return;
    setSending(true);
    setFailed(null);
    shareCorrection({
      // `gone` is a removal, not a field correction, and the API models those
      // separately - so the kind follows the choice rather than being fixed.
      kind: field === 'gone' ? 'removed' : 'correction',
      cameraId,
      field,
      wrong: current[field],
      right: right.trim() === '' ? undefined : right.trim(),
      note: note.trim() === '' ? undefined : note.trim(),
    })
      .then((shared) => {
        setSent({ url: shared.url, duplicate: shared.duplicate });
      })
      .catch((cause: unknown) => {
        /*
         * The server's own sentence. It names the constraint that failed, and
         * a person who just typed something deserves to be told what to change
         * rather than that it "failed".
         */
        setFailed(cause instanceof ShareRefused ? cause.message : 'that could not be sent.');
      })
      .finally(() => {
        setSending(false);
      });
  };

  if (sent !== null) {
    return (
      <div className="fwm-correct" role="group" aria-label={CORRECTION_TITLE}>
        <p className="fwm-correct-done">
          {sent.duplicate ? CORRECTION_DUPLICATE : CORRECTION_SENT}
        </p>
        {sent.url === '' ? null : (
          <a className="fwm-correct-link" href={sent.url} target="_blank" rel="noreferrer">
            Open the pull request
          </a>
        )}
        <button type="button" className="fwm-correct-close" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="fwm-correct" role="group" aria-label={CORRECTION_TITLE}>
      <h3 className="fwm-correct-title">{CORRECTION_TITLE}</h3>

      <div className="fwm-correct-choices">
        {CHOICES.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="fwm-correct-choice"
            aria-pressed={field === choice.id}
            onClick={() => {
              setField(choice.id);
              setRight('');
            }}
          >
            <span className="fwm-correct-choice-label">{choice.label}</span>
            <span className="fwm-correct-choice-hint fwm-data">{choice.hint}</span>
          </button>
        ))}
      </div>

      {field !== null && field !== 'gone' && field !== 'other' ? (
        <label className="fwm-correct-field">
          <span className="fwm-correct-field-label fwm-data">
            {/* What it says now, so the correction is a delta rather than a
                claim floating free of anything. */}
            {current[field] === undefined
              ? 'the archive records nothing here. what should it say?'
              : `the archive says “${current[field] ?? ''}”. what should it say?`}
          </span>
          <input
            className="fwm-correct-input"
            value={right}
            onChange={(event) => {
              setRight(event.target.value);
            }}
            maxLength={120}
            autoComplete="off"
          />
        </label>
      ) : null}

      {field !== null ? (
        <label className="fwm-correct-field">
          <span className="fwm-correct-field-label fwm-data">anything else worth saying</span>
          <textarea
            className="fwm-correct-input fwm-correct-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            maxLength={600}
            rows={2}
          />
        </label>
      ) : null}

      {failed === null ? null : <p className="fwm-correct-failed fwm-data">{failed}</p>}

      <p className="fwm-correct-public fwm-data">{CORRECTION_PUBLIC}</p>

      <div className="fwm-correct-keys">
        <button
          type="button"
          className="fwm-correct-send"
          disabled={field === null || sending}
          onClick={send}
        >
          {sending ? 'Sending…' : CORRECTION_SEND}
        </button>
        <button type="button" className="fwm-correct-close" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
