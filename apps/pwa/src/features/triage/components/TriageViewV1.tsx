/**
 * TRIAGE - v1. "What interrupts you."
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `isTriage` block.
 *
 * A VIEW, NOT A SCREEN. `TriageScreen` still computes the projection from the
 * real pass history and still writes owner types through the settings store;
 * this file draws that model the way v1 draws it. See `SettingsViewV1` for the
 * same argument at more length.
 *
 * =============================================================================
 * THE HERO NUMBER IS THE ONE THING WORTH BEING CAREFUL ABOUT
 * =============================================================================
 * The design writes a big figure and calls it "alerts on a typical drive with
 * these switches". `AlertProjection.projected` is exactly that, computed from
 * recorded passes divided by recorded drives - and it is NULL when there are no
 * drives to divide by, which is every new install.
 *
 * Null renders as an em dash and a sentence saying why. It does not render as
 * zero. Zero is a claim that this configuration will not interrupt you, and a
 * driver who reads that on day one and turns off the police-agency switch on
 * the strength of it has been misled by a number the product never measured.
 */

import type { ReactElement } from 'react';

import { BACK_TO_MORE, BackKey, ReloadTitle } from '../../../components/nav';
import type { TriageViewProps } from './TriageView.tsx';

import '../triageV1.css';

export const NO_VALUE = '—';

export const TRIAGE_TITLE = 'What interrupts you';

export const TRIAGE_CAPTION =
  'turning one off never deletes the camera. it still draws on the map and it still logs - you ' +
  'just are not interrupted by it.';

/** Said in place of a rate when there is nothing to divide by. */
export const NO_PROJECTION = 'no finished drives yet, so there is no per-drive rate to report.';

/** Said when the one drive being divided by is still happening. */
export const OPEN_DRIVE = 'this drive so far';

export function TriageViewV1({ model, onOwnerType, onReAlert }: TriageViewProps): ReactElement {
  const { projection } = model;
  const projected = projection.projected;

  return (
    <section className="fwm-triagev1" aria-label="what interrupts you">
      <header className="fwm-triagev1-header">
        {/* Reached from MORE's INTERRUPTIONS tile and nowhere else. This screen
            is where a driver turns owner types off, so it is one of the ones
            they leave and come back to - and it had no leave. */}
        <BackKey to="more" label={BACK_TO_MORE} />
        <ReloadTitle title={TRIAGE_TITLE} className="fwm-triagev1-title" />
      </header>

      <div className="fwm-triagev1-hero" data-fwm-known={String(projected !== null)}>
        <span className="fwm-triagev1-figure">
          {projected === null ? NO_VALUE : projected.toFixed(1)}
        </span>
        <span className="fwm-triagev1-hero-body">
          {projected === null
            ? NO_PROJECTION
            : `alerts on ${projection.driveInProgress ? OPEN_DRIVE : 'a typical drive'} with these switches. ${TRIAGE_CAPTION}`}
        </span>
      </div>

      {/* THE BASELINE, only when both halves are real. "3.4 of 7.1" says what
          the switches are buying; "3.4" alone says nothing to compare against. */}
      {projected !== null && projection.baseline !== null ? (
        <p className="fwm-triagev1-baseline fwm-data">
          {projected.toFixed(1)} of {projection.baseline.toFixed(1)} with every switch on ·{' '}
          {projection.filteredPasses} of {projection.totalPasses} passes
        </p>
      ) : null}

      <ul className="fwm-triagev1-rows" aria-label="owner types">
        {model.rows.map((row) => (
          <li key={row.ownerType}>
            <button
              type="button"
              className="fwm-triagev1-row"
              role="switch"
              aria-checked={row.enabled}
              aria-label={row.label}
              disabled={onOwnerType === undefined}
              onClick={() => {
                onOwnerType?.(row.ownerType, !row.enabled);
              }}
            >
              <span className="fwm-triagev1-row-where">
                <span className="fwm-triagev1-row-label">{row.label}</span>
                <span className="fwm-triagev1-row-sub fwm-data">{row.caption}</span>
              </span>
              <span
                className="fwm-triagev1-track"
                data-fwm-on={String(row.enabled)}
                aria-hidden="true"
              >
                <span className="fwm-triagev1-knob" />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* RE-ALERT. Not in the v1 design at all, and kept because dropping it
          would silently remove a setting a driver may already have on. Zero is
          the off position - the store's own encoding, not a sentinel invented
          here. */}
      <button
        type="button"
        className="fwm-triagev1-row"
        role="switch"
        aria-checked={model.reAlertFt > 0}
        aria-label="warn again when a camera gets closer"
        disabled={onReAlert === undefined}
        onClick={() => {
          onReAlert?.(!(model.reAlertFt > 0));
        }}
      >
        <span className="fwm-triagev1-row-where">
          <span className="fwm-triagev1-row-label">Warn again when it gets closer</span>
          <span className="fwm-triagev1-row-sub fwm-data">
            {model.reAlertFt > 0
              ? `a second warning inside ${String(model.reAlertFt)} ft`
              : 'one warning per camera, per pass'}
          </span>
        </span>
        <span
          className="fwm-triagev1-track"
          data-fwm-on={String(model.reAlertFt > 0)}
          aria-hidden="true"
        >
          <span className="fwm-triagev1-knob" />
        </span>
      </button>
    </section>
  );
}
