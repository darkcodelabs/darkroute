/**
 * "YOUR SIGN-IN EXPIRED" - the one sentence that was missing.
 *
 * Without this, an expired Cloudflare Access session presents as an app that
 * has quietly lost its data: ` - CAMS`, an empty map, and the ADMIN row gone
 * from SETTINGS. Every one of those readings is honest on its own and together
 * they point at the wrong thing entirely. See services/access/session.ts for
 * how the state is detected.
 *
 * WHY IT IS A BANNER AND NOT A REDIRECT
 *   The app does not navigate itself away. A background fetch failing is not
 *   consent to throw away whatever the driver was doing -- a half-written
 *   report, a queued submission, a live alert. It says what happened and puts
 *   the door next to it.
 *
 * WHY IT IS NOT DISMISSIBLE
 *   There is nothing behind it to get back to. Every readout on every screen is
 *   already showing the absence this explains, so dismissing it would restore
 *   exactly the confusing picture it exists to correct. It goes away by signing
 *   in, which is the only thing that changes the situation.
 */

import { useSyncExternalStore, type ReactElement } from 'react';

import { goToSignIn, isSignedOut, subscribeToSignedOut } from '../../services/access/session.ts';

import './access.css';

export const SIGNED_OUT_TITLE = 'SIGN-IN EXPIRED';
export const SIGNED_OUT_BODY =
  'this build is gated, and the gate stopped recognising this device. camera data, the map and settings are unchanged - nothing was lost, and nothing on screen is reading from them right now.';
export const SIGNED_OUT_ACTION = 'SIGN IN AGAIN';

export function SignedOutBanner(): ReactElement | null {
  const signedOut = useSyncExternalStore(subscribeToSignedOut, isSignedOut, isSignedOut);
  if (!signedOut) return null;

  return (
    <div className="fwm-signedout" role="status" aria-live="polite">
      <p className="fwm-signedout-title fwm-data">{SIGNED_OUT_TITLE}</p>
      <p className="fwm-signedout-body">{SIGNED_OUT_BODY}</p>
      <button
        type="button"
        className="fwm-signedout-action fwm-data"
        onClick={() => {
          goToSignIn();
        }}
      >
        {SIGNED_OUT_ACTION}
      </button>
    </div>
  );
}
