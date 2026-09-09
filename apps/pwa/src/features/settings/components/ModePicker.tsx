/**
 * The theme modes, as a DROPDOWN.
 *
 * =============================================================================
 * WHY IT STOPPED BEING A RADIO GROUP
 * =============================================================================
 * It was one tappable card per mode, which was right at six and is wrong at
 * nine: the list had grown into the tallest thing in SETTINGS, and everything
 * below it -- the map toggles, the typeface, the privacy copy, the removal
 * control -- sat behind a scroll past a control most people set once and never
 * touch again. A picker's height should not be a function of how many themes
 * exist.
 *
 * A native `<select>` rather than a custom menu, and that is a deliberate
 * choice rather than a shortcut. The platform's own picker is the one that
 * already works with a screen reader, with a hardware keyboard, with a
 * switch control, and with whatever text size the driver has set -- and on a
 * phone it opens as a full-height wheel, which is a better list than the one
 * that was here. A hand-rolled dropdown would be a worse version of all of
 * that, in more code.
 *
 * The badge cannot ride inside an `<option>` -- the element renders text and
 * nothing else, on every platform -- so it moves BESIDE the control, where it
 * describes the current selection. Nothing is lost: it was only ever legible
 * on the selected row anyway.
 *
 * =============================================================================
 * WHAT THIS REPLACES (kept because the reasoning still applies)
 * =============================================================================
 * The six skins of section 05, as a radio group.
 *
 * SOURCE: `Flockys Design System.dc.html` section 05, `Theme modes` --
 * "6 skins · same tokens, remapped". Each row prints the card's own title and
 * its mono badge; the selected row takes the 3px left rule the design system
 * gives a selected card in `CARD · LIST ROW`.
 *
 * =============================================================================
 * THE WATCH RULE IS RENDERED, NOT HIDDEN
 * =============================================================================
 *   "Night Watch is the fallback and the only mode allowed on the always-on
 *    watch face."   -- section 05
 *
 * `app/mode.ts#applyMode` enforces that in code. On a watch surface this
 * component marks `night-watch` selected, renders ALL SIX rows inert, and
 * prints why. The alternative -- leaving live-looking rows that silently do
 * nothing when pressed -- is the exact failure this notice exists to prevent.
 *
 * WHY ALL SIX AND NOT FIVE
 * `forced` is read off the SURFACE by `SettingsScreen`, never off
 * `ResolvedMode.reason`: that reason is `'requested'`, not `'forced-watch'`,
 * whenever the stored mode already IS night-watch, which is the default and so
 * the state of every watch on first run. Disabling only the unselected rows
 * would leave one live control whose press changes nothing; a locked group
 * reads as locked, and the notice says who locked it.
 *
 * =============================================================================
 * NO PREVIEW SWATCHES
 * =============================================================================
 * Section 05 draws each mode as a full RADAR mock. A shrunken, non-live copy of
 * RADAR inside SETTINGS would be placeholder data wearing a design's clothes,
 * and the modes are applied to the whole document the moment one is picked --
 * so the preview is the screen the user is already looking at.
 * GAP: see docs/gaps-inbox/settings.md#mode-cards-are-not-reproduced
 */

import type { ReactElement } from 'react';

import type { FwmMode } from '../../../app/mode.ts';
import { FORCED_WATCH_NOTICE, MODE_CHOICES } from '../modes.ts';

export interface ModePickerProps {
  /** The mode actually written to `<html>` -- after the watch rule. */
  readonly active: FwmMode;
  /**
   * True when the surface, not the user, decides {@link active} -- i.e. the
   * always-on watch rule is in force. Every row goes inert.
   */
  readonly forced: boolean;
  /** Absent means "not wired in this build". */
  readonly onPick?: ((mode: FwmMode) => void) | undefined;
}

/** Every mode is a valid value, so a bad one can only come from a stale DOM. */
function isMode(value: string): value is FwmMode {
  return MODE_CHOICES.some((choice) => choice.mode === value);
}

export function ModePicker({ active, forced, onPick }: ModePickerProps): ReactElement {
  // On a watch the whole control is inert, and the notice below says why.
  const inert = onPick === undefined || forced;
  const current = MODE_CHOICES.find((choice) => choice.mode === active) ?? null;

  return (
    <div className="fwm-settings-modes">
      <div className="fwm-settings-mode-field">
        <select
          className="fwm-settings-mode-select fwm-data"
          aria-label="theme mode"
          value={active}
          disabled={inert}
          onChange={(event) => {
            const next = event.target.value;
            // Guarded rather than cast: the value comes back as a string, and
            // trusting it would let a stale option write a mode that has no
            // token block and therefore no colours at all.
            if (!isMode(next)) return;
            onPick?.(next);
          }}
        >
          {MODE_CHOICES.map((choice) => (
            <option key={choice.mode} value={choice.mode}>
              {choice.name}
            </option>
          ))}
        </select>
        {/* The badge for whatever is selected. It cannot live inside an
            `<option>`, and it was only ever readable on the selected row. */}
        <span className="fwm-settings-mode-badge fwm-data">{current?.badge ?? ''}</span>
      </div>

      {forced ? (
        <p className="fwm-settings-mode-notice fwm-data" role="status">
          {FORCED_WATCH_NOTICE}
        </p>
      ) : null}
    </div>
  );
}
