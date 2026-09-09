/**
 * The signing statement, verbatim from the panel.
 *
 * "Reports are signed the moment you file them and held on this phone.
 *  Nothing is edited after the fact. There is nowhere to send them yet."
 *
 * It is a constant, not a prop, and it is rendered in every state including an
 * empty queue: it describes what this device does with a report, which is true
 * before the first one is filed. `services/crypto/chain.ts` and
 * `services/db/repositories/pendingReports.ts` are the two files that make it
 * true; if either ever stops being true, this sentence has to come out.
 */

import type { ReactElement } from 'react';

import { SIGNING_STATEMENT } from '../deadDropModel.ts';

export function SigningNotice(): ReactElement {
  return <p className="fwm-dead-drop-notice">{SIGNING_STATEMENT}</p>;
}
