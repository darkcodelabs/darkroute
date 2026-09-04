/**
 * RADAR's 52px header: the title in the state hue, a bare `?`, and a menu.
 *
 * SOURCE: `Flockys App Screens v2.dc.html`, `01 · RADAR - IN RANGE` --
 * `height:52px`, `padding:0 16px`, `border-bottom:1px`, the title at
 * `19px/700/.06em` in the state hue, and three 44x36 mono keys: REP, SET, VOL.
 *
 * =============================================================================
 * WHY THIS NO LONGER DRAWS THE DESIGN'S THREE KEYS
 * =============================================================================
 * The design put four controls in a 52px bar and two of them had nowhere to go:
 *
 *   REP  duplicated the dock. REPORT is already the fifth key in the dock bar,
 *        on every screen, which is where a driver reaches for it. Two entry
 *        points to one sheet is two things to maintain and one more thing in a
 *        row that has to stay readable at a glance in a car mount.
 *
 *   VOL  was drawn armed -- a hue outline over bare ground -- and specified
 *        nowhere. It is the mute control, and muting has rules: how long, what
 *        it silences, whether the record still counts. That belongs on a
 *        settings screen where the rules can be stated next to the switch, not
 *        behind a three-letter key that gives no hint what it will do.
 *        It now lives in SETTINGS. See `features/settings`.
 *
 *   SET  is the menu. A three-letter abbreviation of a word the platform draws
 *        as a picture everywhere else is the one control here that had to
 *        change: `SET` reads as an abbreviation to guess at.
 *
 * =============================================================================
 * WHY A DRAWN MARK AND NOT A GLYPH
 * =============================================================================
 * The ask was for something "iOS and Android can render". No character can be
 * promised: U+2699 GEAR renders as a colour emoji on one platform and a thin
 * outline on the other, U+2261 IDENTICAL TO is a maths operator that falls back
 * to a box in a font that lacks it, and both take the platform's own metrics
 * rather than this product's.
 *
 * So the mark is an inline SVG on the same 24x24 / 1.6px stroke grid as the
 * five dock icons, painted with `currentColor`. It renders identically on every
 * platform because the app draws it, and it inherits the key's state hue for
 * free. Same reasoning as `components/dock/icons.tsx` -- and the same rule:
 * never substitute an emoji for a drawn mark.
 *
 * =============================================================================
 * WHY `?` HAS NO CHIP
 * =============================================================================
 * The filled chip is what makes a control read as a button you are meant to
 * press. WHAT THIS APP KNOWS is a reference a driver opens once, not an action
 * they take while driving; giving it the same weight as the menu made a 52px
 * bar look like it had three equal jobs. It keeps the same 44px touch target --
 * the target is not the paint.
 *
 * THE MUTE COUNTDOWN
 *   "MUTED 8:12", beside the title in amber. It is a timer, not an alert.
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

import { NO_VALUE, formatMuteCountdown } from '../format.ts';

export interface RadarHeaderProps {
  /** Milliseconds of global mute left, or null when nothing is muted. */
  readonly muteRemainingMs?: number | null;
  /**
   * How many cameras are in the database on this device.
   *
   * The TOTAL, not the number on the scope. It was the in-range count at first
   * and that was the wrong number for this spot: it reads `0` on a clear road,
   * which is the same thing an app with no data at all would show, so the one
   * permanent number in the chrome could not tell "nothing near you" apart from
   * "nothing loaded". The total says the app has 130,000 cameras and is
   * working; the scope says how many are near you.
   *
   * `null` before the first tile lands -- drawn as a dash, because "none
   * cached" and "not fetched yet" are different answers.
   */
  readonly camerasKnown?: number | null;
  /** Cameras in the whole published set. `null` until `index.json` is read. */
  readonly camerasTotal?: number | null;
  /**
   * How many cameras have been driven past, this session.
   *
   * A TALLY BESIDE THE DATABASE COUNTS, NOT A GAUGE. It used to be a stat tile
   * the size of the speed readout, which gave the least urgent number on the
   * screen the same weight as the most urgent one. Up here it is read when
   * somebody looks for it and never competes with the row below.
   */
  readonly todayPasses?: number | null;
  /**
   * Opens SETTINGS, which is where mute, permissions, themes -- and now the
   * FAQ -- live. The header used to carry a second key for the FAQ; see the
   * note beside the menu button.
   */
  readonly onSettings?: (() => void) | undefined;
}

/**
 * The menu mark: three rules on the 24x24 grid the dock icons use.
 *
 * `aria-hidden` because the button carries the accessible name. An icon-only
 * control with no name is unusable; two names is a control that announces
 * itself twice.
 */
function MenuMark(): ReactElement {
  return (
    <svg
      className="fwm-radar-key-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

export function RadarHeader({
  muteRemainingMs = null,
  camerasKnown = null,
  camerasTotal = null,
  todayPasses = null,
  onSettings,
}: RadarHeaderProps): ReactElement {
  const muted = muteRemainingMs !== null && muteRemainingMs > 0;

  return (
    <header className="fwm-radar-header">
      <div className="flex items-center">
        <BrandMark />
      <span className="fwm-radar-title">RADAR</span>
        {muted ? (
          <span className="fwm-radar-mute fwm-data" data-fwm-radar-mute="true">
            {`MUTED ${formatMuteCountdown(muteRemainingMs)}`}
          </span>
        ) : null}
      </div>
      {/* THE LIVE COUNT, centred on the title's own row.
          It is the one number that is true of the whole screen: how many of
          them are around you at this range, right now. Centre because it
          belongs to neither side -- it is not a title and it is not a control. */}
      <p
        className="fwm-radar-live fwm-data"
        data-fwm-radar-live={camerasKnown === null ? 'unknown' : String(camerasKnown)}
      >
        {/* CACHED OUT OF PUBLISHED. `979 / 130,684`.
            The cached figure alone is unreadable -- it could mean the database
            holds 979 cameras, or that this phone holds 979 of a much larger
            set, and those are very different claims. Both numbers together say
            what is on the device AND what exists, which is also the only place
            the sync is visible. */}
        {/* LABELLED EITHER SIDE OF THE SLASH, not once at the end.
            It read `149 /131,083 CAMS`, and one label after two numbers does
            not say which is which -- a driver has to work out that the first is
            theirs and the second is everyone's. LOCAL and NETWORK name them
            where they stand, and the pairing is the whole reason both numbers
            are on screen: what this phone holds, out of what exists. */}
        <span className="fwm-radar-live-value">
          {camerasKnown === null ? NO_VALUE : camerasKnown.toLocaleString('en-US')}
        </span>
        <span className="fwm-radar-live-label">AREA</span>
        <span className="fwm-radar-live-total">
          {camerasTotal === null ? '' : `/ ${camerasTotal.toLocaleString('en-US')}`}
        </span>
        <span className="fwm-radar-live-label">NETWORK</span>

        {/* PASSED, INSIDE the same centred group. It was a separate element in
            normal flow while the counts are absolutely centred, so the two
            drew on top of each other -- `1,263 /0PASSED AMS`. One group, one
            rule between them, no overlap possible.

            Deliberately not zero-suppressed: "0 PASSED" is a real reading on a
            drive that has not passed one yet, and hiding it would make the
            tally look broken rather than empty. */}
        {todayPasses === null || todayPasses === undefined ? null : (
          <>
            <span className="fwm-radar-live-rule" aria-hidden="true" />
            <span className="fwm-radar-passed-value">{todayPasses.toLocaleString('en-US')}</span>
            <span className="fwm-radar-passed-label">PASSED</span>
          </>
        )}
      </p>

      <div className="fwm-radar-keys">
        {/* THE `?` MOVED INTO THE MENU, as a FAQ row in SETTINGS.
            It sat here on the argument that "what is it doing with my
            location" should not be behind the same control as the settings.
            The argument holds and the placement did not: two keys in a header
            whose middle is a live count is one key too many -- the count grew
            when it gained LOCAL and NETWORK and had nowhere to go. The answer
            is one tap further away and the header has room for the reading it
            exists to show. */}
        <button
          type="button"
          className="fwm-radar-key"
          data-fwm-radar-key="menu"
          disabled={onSettings === undefined}
          onClick={onSettings}
          aria-label="menu"
        >
          <MenuMark />
        </button>
      </div>
    </header>
  );
}
