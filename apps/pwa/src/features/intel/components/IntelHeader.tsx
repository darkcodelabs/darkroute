/**
 * The grabber, the title row and the id line.
 *
 * SOURCE: `A4 · INTEL CARD - MODAL FROM SWEEP`. A 44x4 pill centred above an
 * 18px gap; `FALCON` at 22px/700/.06em beside `425 FT · SW` in mono at the
 * alert hue; `FWM-0442 · READING & TENNESSEE` in 11px mono at .12em under it.
 *
 * =============================================================================
 * THE GRABBER IS THE DISMISS
 * =============================================================================
 * The panel draws a bottom sheet with a grabber and a scrim and draws no close
 * button anywhere. Those two are the affordances it does draw, so those two are
 * what close it -- inventing an X would be adding a control the design does not
 * show, and shipping a modal with no way out is not an option.
 * GAP: docs/gaps-inbox/intel.md#modal-has-no-drawn-dismiss
 *
 * =============================================================================
 * THE ID IS A COPY TARGET, WHEREVER IT IS DRAWN
 * =============================================================================
 * `services/adapters/clipboard.ts` exists for one thing -- "copying a camera id
 * (FWM-0442)". The id is rendered exactly once: on the second line when there
 * is a hardware name above it, and in the title itself when there is not (which
 * is every record in this build). The copy affordance follows it rather than
 * being pinned to a line that may not be carrying it. When no copy handler is
 * wired, both render as text, not as dead buttons.
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

import type { IntelIdentity, IntelReadout } from '../intelState.ts';

export interface IntelHeaderProps {
  readonly identity: IntelIdentity;
  readonly readout: IntelReadout;
  readonly cameraId: string;
  /** Closes the card. Absent renders the grabber as the drawn pill only. */
  readonly onDismiss?: (() => void) | undefined;
  /** Copies {@link cameraId}. Absent renders the line as plain text. */
  readonly onCopyId?: (() => void) | undefined;
}

export function IntelHeader({
  identity,
  readout,
  cameraId,
  onDismiss,
  onCopyId,
}: IntelHeaderProps): ReactElement {
  const distance =
    readout.cardinal === null
      ? `${readout.value} ${readout.unit}`
      : `${readout.value} ${readout.unit} · ${readout.cardinal}`;

  return (
    <>
      {onDismiss === undefined ? (
        <div className="fwm-intel-grabber" data-fwm-intel-grabber="static" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="fwm-intel-grabber"
          data-fwm-intel-grabber="dismiss"
          aria-label="close intel card"
          onClick={onDismiss}
        />
      )}

      <div className="fwm-intel-title-row">
        <BrandMark />
      <h2 className="fwm-intel-title">
          {identity.idInTitle && onCopyId !== undefined ? (
            <button
              type="button"
              className="fwm-intel-title-copy"
              data-fwm-intel-copy="title"
              aria-label={`copy camera id ${cameraId}`}
              onClick={onCopyId}
            >
              {identity.title}
            </button>
          ) : (
            identity.title
          )}
        </h2>
        <p className="fwm-intel-readout fwm-data" data-fwm-intel-readout="true">
          {distance}
        </p>
      </div>

      {identity.idInTitle || onCopyId === undefined ? (
        <p
          className="fwm-intel-subline fwm-data"
          data-fwm-intel-subline={identity.sublineIsNote ? 'note' : 'identity'}
        >
          {identity.subline}
        </p>
      ) : (
        <button
          type="button"
          className="fwm-intel-subline fwm-data"
          data-fwm-intel-copy="subline"
          data-fwm-intel-subline="copy"
          aria-label={`copy camera id ${cameraId}`}
          onClick={onCopyId}
        >
          {identity.subline}
        </button>
      )}
    </>
  );
}
