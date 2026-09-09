/**
 * DESTINATION HISTORY - the SETTINGS group, on brief 4's row/group idiom.
 *
 * SOURCE: `DarkRoute Search Entry.html`, section C, the frame captioned
 * `HISTORY, MANAGED · a row in Settings` (`[data-dc-tpl="169"]` and its
 * children). Every size, colour and string below was read out of Chromium
 * against that file at real size rather than off its prose - the measurements
 * are recorded beside the declarations in `settingsV1.css`.
 *
 * =============================================================================
 * A SELF-CONTAINED GROUP, LIKE `PermissionsV1`
 * =============================================================================
 * It reads the two preferences off the settings slice and the two counts off
 * the destinations slice itself, rather than taking them through
 * `SettingsViewModel`. That is the shape `PermissionsV1` and `AlertTestV1`
 * already have, and the reason is the same: this group's state is nobody
 * else's, and threading four more fields through a model both settings views
 * consume would make v0 carry values it does not draw.
 *
 * =============================================================================
 * WHAT THE SPEC DRAWS THAT THIS DOES NOT, AND WHY
 * =============================================================================
 * THE TWO CHEVRONS. `Keep for ›` and `Saved places ›` are drawn as NAVIGATE
 * rows, which promise a pushed screen. There is no `places` member in
 * `app/screenState.ts`'s `SECONDARY_SCREENS`, so both chevrons would point at
 * nothing, and `SettingsViewV1`'s header already settles this class of problem
 * once - for the `Theme ›` row - by drawing the control inline instead of a
 * chevron with nowhere to go. "A dead control is worse than an honest mark."
 *
 *   `Keep for` KEEPS ITS CHEVRON and earns it: it is a native `<details>` drawn
 *   as the spec's 44px row, and opening it reveals the four choices as the
 *   segmented picker this screen already uses four times. The chevron now leads
 *   somewhere, one row down instead of one screen along.
 *
 *   `Saved places` LOSES ITS CHEVRON and becomes a plain row stating the count
 *   and the names, which is exactly what the spec's own value slot says. What is
 *   behind that chevron - renaming, reordering, deleting a saved place - is a
 *   screen nobody has drawn, and inventing one is a bigger change than this
 *   brief asks for. Reported rather than guessed.
 *
 * THE COUNTS ARE NEVER FAKED. Three numbers are drawn here - the group's
 * `12 places`, the saved count, and the `9` on the destructive row - and every
 * one of them is a dash until the book has actually been read back off disk.
 * The panel's rule for camera counts is the same rule and it is stated in the
 * spec as a safety property: zero is a real and reassuring answer, so printing
 * it before you know is a lie rather than a placeholder. `0 saved places` shown
 * to somebody who has three is that lie wearing a settings row.
 *
 * =============================================================================
 * TWO PRESSES ON THE RED ROW, WHICH THE SPEC DOES NOT DRAW
 * =============================================================================
 * Section C draws one red row with a count on it and no armed state. This
 * builds it as arm-then-confirm, matching `RemovalControl`'s rule for the only
 * other irreversible local deletion in the product.
 *
 * The reason is that the spec's own copy makes the case: `Forget all recent
 * places` sits 44px under `Saved places`, in a group whose note is about which
 * of the two a wipe takes. A mis-tap there costs nine places with no undo, no
 * server copy to restore from, and - by design - no record that they ever
 * existed. Written down as a deviation from the drawing rather than slipped in:
 * if the owner wants one tap, deleting `armed` from {@link ForgetPhase} and the
 * branch that reads it is the whole change.
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import { COUNT_DASH } from '../../search/panel.ts';
import { EXPIRY_DAYS_CHOICES } from '../../search/places.ts';
import {
  destinationsActions,
  useDestinationsHydrated,
  useRecentPlaces,
  useSavedPlaces,
  useSettingsStore,
} from '../../../stores';

// ---------------------------------------------------------------------------
// Copy - every string below is the spec's, verbatim
// ---------------------------------------------------------------------------

/** `[data-dc-tpl="171"]`, 11 / 700 / 0.14em, drawn in the amber. */
export const HISTORY_HEADING = 'Destination history';

/** `[data-dc-tpl="173"]` label and `[data-dc-tpl="175"]` value. */
export const REMEMBER_LABEL = 'Remember places';
export const REMEMBER_USE = 'never leaves the phone';

/** `[data-dc-tpl="179"]` / `[data-dc-tpl="184"]` / `[data-dc-tpl="189"]`. */
export const KEEP_LABEL = 'Keep for';
export const SAVED_LABEL = 'Saved places';
export const FORGET_LABEL = 'Forget all recent places';

/**
 * `[data-dc-tpl="191"]`, verbatim, and it is the reason the group has a note.
 *
 * It is the one sentence in the group that distinguishes the red row from the
 * red row on the other group of this screen, and getting it wrong in either
 * direction is a broken promise rather than a copy nit.
 */
export const HISTORY_NOTE =
  'Saved places survive a history wipe. Wipe everything on this phone takes both.';

/** Shown while the two presses are pending. `RemovalControl`'s words, shortened. */
export const FORGET_ARMED_LABEL = 'Tap again to forget them';
export const FORGET_CANCEL_LABEL = 'Keep them';

/**
 * The four `Keep for` choices, labelled.
 *
 * The VALUES come from `features/search/places.ts` - `EXPIRY_DAYS_CHOICES`,
 * beside the expiry function that reads them - so a fifth option is added in
 * one place. Only the WORDS are here, because a label is a drawing decision and
 * `a year` is not something the rules module should have an opinion about.
 *
 * `a year` rather than `365 days`, which is the spec's own phrasing: "30, 90, a
 * year or never".
 */
export const KEEP_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '30': '30 days',
  '90': '90 days',
  '365': 'a year',
  never: 'never',
});

export function keepLabel(days: number | null): string {
  return KEEP_LABELS[days === null ? 'never' : String(days)] ?? String(days);
}

/** The two presses the red row takes. See the header for why there are two. */
export type ForgetPhase = 'idle' | 'armed';

// ---------------------------------------------------------------------------

export interface DestinationHistoryV1Props {
  /**
   * False while the settings blob is still in flight.
   *
   * Passed in rather than read here so this group is inert for the same reason,
   * at the same moment, as every other control on the screen: a press that
   * lands before the stored preference does writes a default over a choice.
   */
  readonly ready: boolean;
}

export function DestinationHistoryV1({ ready }: DestinationHistoryV1Props): ReactElement {
  const remember = useSettingsStore((store) => store.rememberPlaces);
  const keepDays = useSettingsStore((store) => store.keepPlacesDays);
  const setRemember = useSettingsStore((store) => store.setRememberPlaces);
  const setKeepDays = useSettingsStore((store) => store.setKeepPlacesDays);

  const saved = useSavedPlaces();
  const recents = useRecentPlaces();
  const known = useDestinationsHydrated();

  const [phase, setPhase] = useState<ForgetPhase>('idle');

  const onForget = useCallback((): void => {
    setPhase((was) => {
      if (was === 'idle') return 'armed';
      void destinationsActions.forgetAllRecentPlaces();
      return 'idle';
    });
  }, []);

  /* A count nobody has read back yet is a dash, never a zero. See the header. */
  const count = (n: number): string => (known ? String(n) : COUNT_DASH);
  const total = known ? `${String(saved.length + recents.length)} places` : `${COUNT_DASH} places`;

  /*
   * `3 · Home, Work, Mom's` - the spec's own value, built from the real names.
   *
   * The names are the point rather than decoration: this row is the only place
   * on the phone that says which addresses the wipe two groups down is going to
   * take, and a bare `3` would make somebody open the panel to find out.
   */
  const savedValue = known
    ? saved.length === 0
      ? 'none yet'
      : `${String(saved.length)} · ${saved.map((place) => place.name).join(', ')}`
    : COUNT_DASH;

  return (
    <div className="fwm-settingsv1-group" role="group" aria-label={HISTORY_HEADING}>
      <div className="fwm-settingsv1-group-head">
        {/* AMBER, as drawn. `data-fwm-hue="amber"` resolves to `--dr-owner-hoa`
            - the gap and the delta are recorded on that rule in
            `settingsV1.css` rather than repeated here. */}
        <h2 className="fwm-settingsv1-group-label" data-fwm-hue="amber">
          {HISTORY_HEADING}
        </h2>
        <p className="fwm-settingsv1-group-note fwm-data">{`on this phone · ${total}`}</p>
      </div>

      {/* --- Remember places -------------------------------------------
          THE SWITCH SPELLS ITS STATE OUT, which is brief 4's rule for every
          toggle on this screen, and the spec's own string here is already in
          that form: `on · never leaves the phone`. The second half is a
          promise rather than a description of the switch, and it is the half
          worth reading - so it stays on both states. */}
      <button
        type="button"
        className="fwm-settingsv1-switch"
        data-testid="settingsv1-remember-places"
        role="switch"
        aria-checked={remember}
        disabled={!ready}
        onClick={() => {
          setRemember(!remember);
        }}
      >
        <span className="fwm-settingsv1-switch-label">{REMEMBER_LABEL}</span>
        {/* The words and `aria-checked` carry the same fact to the eye and to a
            screen reader, so the two cannot drift. */}
        <span className="fwm-settingsv1-switch-sub fwm-data">
          {`${remember ? 'on' : 'off'} · ${REMEMBER_USE}`}
        </span>
        <span className="fwm-settingsv1-perm-track" aria-hidden="true">
          <span className="fwm-settingsv1-perm-knob" />
        </span>
      </button>

      {/* --- Keep for ---------------------------------------------------
          The spec's chevron row, and the chevron leads one row down instead of
          one screen along. See the header. */}
      <details className="fwm-settingsv1-fold">
        <summary className="fwm-settingsv1-fold-key">
          <span className="fwm-settingsv1-fold-title">{KEEP_LABEL}</span>
          <span className="fwm-settingsv1-fold-value fwm-data">{keepLabel(keepDays)}</span>
          <span className="fwm-settingsv1-fold-chevron" aria-hidden="true">
            ›
          </span>
        </summary>

        <div className="fwm-settingsv1-stops" role="radiogroup" aria-label={KEEP_LABEL}>
          {EXPIRY_DAYS_CHOICES.map((choice) => (
            <button
              type="button"
              key={choice === null ? 'never' : String(choice)}
              className="fwm-settingsv1-stop"
              role="radio"
              aria-checked={choice === keepDays}
              disabled={!ready}
              data-fwm-selected={String(choice === keepDays)}
              onClick={() => {
                setKeepDays(choice);
              }}
            >
              {keepLabel(choice)}
            </button>
          ))}
        </div>
      </details>

      {/* --- Saved places ----------------------------------------------
          A plain row, not a navigate row. See the header. */}
      <div className="fwm-settingsv1-row" data-testid="settingsv1-saved-places">
        <span className="fwm-settingsv1-row-label">{SAVED_LABEL}</span>
        <span className="fwm-settingsv1-row-value fwm-data">{savedValue}</span>
      </div>

      {/* --- Forget all recent places -----------------------------------
          The count rides IN the row, which is the one place this group differs
          from the wipe row two groups down - and it is the spec's own
          arrangement: label left, count right, both in the red. */}
      <button
        type="button"
        className="fwm-settingsv1-removal-key"
        data-testid="settingsv1-forget-recents"
        data-fwm-removal={phase}
        disabled={!ready || !known || recents.length === 0}
        onClick={onForget}
      >
        <span className="fwm-settingsv1-removal-label">
          {phase === 'armed' ? FORGET_ARMED_LABEL : FORGET_LABEL}
        </span>
        <span className="fwm-settingsv1-removal-count fwm-data">{count(recents.length)}</span>
      </button>

      {phase === 'armed' ? (
        <button
          type="button"
          className="fwm-settingsv1-removal-cancel"
          onClick={() => {
            setPhase('idle');
          }}
        >
          {FORGET_CANCEL_LABEL}
        </button>
      ) : null}

      <p className="fwm-settingsv1-note fwm-data">{HISTORY_NOTE}</p>
    </div>
  );
}
