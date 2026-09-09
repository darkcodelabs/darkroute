/**
 * LOCATION DENIED - the explanation, and the way back.
 *
 * NOT DRAWN IN THE DESIGN. A1 renders LOCATION in its granted state and says
 * "you can skip everything except location"; nothing in any of the four design
 * files draws what the driver sees when the OS says no. The copy below is
 * therefore authored, not transcribed.
 *   GAP: see DESIGN-GAPS.md#onboarding-location-denied-has-no-designed-state
 *
 * The SHAPE is borrowed rather than invented: it is the caveat block from
 * `A2 · OFFLINE - DEGRADED` ("DB last updated 2 days ago. Cameras added since
 * then are invisible…") - a left rule in the state hue, mono body copy, and
 * A2's own RETRY SYNC button underneath. A2 is the other screen in this product
 * whose whole job is telling the driver what it cannot currently see, so its
 * vocabulary is the right one to reuse.
 *
 * WHAT THE COPY MAY NOT SAY. Not "we need this to keep you safe", not "grant
 * location to continue", and not a promise that some other feature will cover
 * for it. Without a position there is no distance, and without a distance there
 * is no alert - that is the entire consequence, and it is stated once.
 *
 * A RETRY IS NOT A GUARANTEE. Most browsers resolve a second geolocation
 * request as denied without ever showing the OS dialog again, which is why the
 * copy points at site settings rather than at the button. The button re-asks;
 * if the platform has already made up its mind, the word stays DENIED and the
 * driver is not left thinking the app is broken.
 */

import type { ReactElement } from 'react';

import '../onboarding.css';

export interface LocationDeniedNoticeProps {
  /** Re-runs the geolocation request. From the driver's tap, never on mount. */
  readonly onRetry: () => void;
}

export function LocationDeniedNotice({ onRetry }: LocationDeniedNoticeProps): ReactElement {
  return (
    // `status`, not `alert`. In this product an alert is a camera, at the OS
    // level and at the ARIA level; a permission the driver just declined is
    // news, not a warning to interrupt them with.
    <div className="fwm-location-denied" role="status" data-testid="location-denied">
      <span className="fwm-location-denied-title">LOCATION DENIED</span>
      <p className="fwm-location-denied-body">
        Distance to cameras is computed from your position. Without it there are no alerts, and a
        report cannot record where a camera is.
      </p>
      <p className="fwm-location-denied-body">
        Turn location on for this site in your browser settings, then retry.
      </p>
      <button type="button" className="fwm-location-retry" onClick={onRetry}>
        RETRY LOCATION
      </button>
    </div>
  );
}
