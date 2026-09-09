/**
 * THE RAIL. Section B of `searchbar_and_buttons.dc.html`, and nothing else.
 *
 * Five 40px circles in a right-aligned column, 10 apart. Top to bottom: theme,
 * gear, mail, code, help. ONE BUTTON TYPE and no second one -- the brief names
 * the theme control specifically, because it used to be a bespoke tile with a
 * word on it and it is now a plain round key like the other four.
 *
 * THIS COMPONENT DOES NOT DECIDE ANYTHING. It draws five keys and reports which
 * was pressed. It does not open settings, does not toggle a theme and does not
 * know what the envelope is addressed to.
 *
 * COLOUR AND GEOMETRY ARE NOT HERE. Not one hex, not one pixel. `chrome.css`
 * resolves both.
 *
 * =============================================================================
 * THE SPEC DRAWS NO LABELS, AND A BUTTON HAS TO HAVE ONE
 * =============================================================================
 * All ten rendered rail keys -- five dark, five light -- are an `<svg>` inside
 * a `<button>` with no text, no `aria-label` and no `title`. A control like
 * that has no accessible name at all: a screen reader announces it as "button"
 * and a driver using one has five identical buttons in a column.
 *
 * So each key is named, and the names are NOT invented from the drawings. Four
 * of the five already exist in this app with words on them -- `SEARCH_SETTINGS`
 * on the bar's old gear, and `CONTACT_LABEL` / `DEVELOPER_LABEL` / `FAQ_LABEL`
 * on `features/drive/`'s own round rail keys, which are the same envelope, the
 * same brackets and the same question mark. Those words are reused so the rail
 * says the same thing it said yesterday.
 *
 * Every one of them is a constant, in one place, for the reason `TOPBAR_FOLD`
 * gives: if a name turns out to be wrong, the constant and the `onSelect` case
 * are the whole of the change.
 *
 * =============================================================================
 * THE SUN DOES SWAP FOR A MOON, AND THE SPEC IS NOT THE AUTHORITY ON THAT
 * =============================================================================
 * This block used to argue the opposite, from a real measurement: the spec
 * renders the rail twice, on the dark panel and on the light one, and draws the
 * SAME sun in both -- identical path, identical stroke, only the ink tier
 * differs. That measurement is still correct. The conclusion drawn from it was
 * not.
 *
 * A spec page renders both panels at once so a reader can compare them. Nobody
 * is ever in both themes at once, so a page that must show a key twice has no
 * way to show a key that changes - the same sun in both panels is a property of
 * the PAGE, not a decision about the control.
 *
 * The old bar had the rule and it is the right one: the glyph names where
 * pressing it GOES, not where you already are. Sun while the app is dark, moon
 * while it is light. A control that shows its current state and moves to the
 * other one is the toggle everybody misreads at a glance, and this one is read
 * at a windscreen.
 *
 * `SearchBar.tsx` carried that rule and its moon path; both are restored here
 * rather than redrawn, so the crescent is the one that shipped before.
 */

import type { ReactElement, RefObject } from 'react';

import { ChromeIcon } from './icons.tsx';
import type { ChromeIconName } from './icons.tsx';

import './chrome.css';

/** The mark inside a rail key, at the spec's own size. */
const RAIL_ICON_PX = 18;

/** The five the spec draws. A union, so a sixth cannot arrive untyped. */
export type RailKeyId = 'theme' | 'settings' | 'mail' | 'code' | 'help';

/**
 * THE FIVE NAMES.
 *
 * `RAIL_THEME` names the destination, exactly as the bar's toggle did, because
 * the glyph beside it now does too. An accessible name that said only "Switch
 * theme" while the drawing said which way is a name that carries less than the
 * picture, which is backwards.
 */
export const RAIL_THEME_TO_LIGHT = 'Switch to light mode';
export const RAIL_THEME_TO_DARK = 'Switch to dark mode';
/** What the key is called when nothing has said which theme is on. */
export const RAIL_THEME = RAIL_THEME_TO_LIGHT;
/** The gear. The bar's own word for the same destination, from `SearchBar.tsx`. */
export const RAIL_SETTINGS = 'Settings';
/** The envelope. `features/drive/ContactKey.tsx` calls this key Contact. */
export const RAIL_MAIL = 'Contact';
/** The brackets. `features/drive/DeveloperKey.tsx` calls this key Developers. */
export const RAIL_CODE = 'Developers';
/** The question mark. `features/drive/FaqKey.tsx` calls this key FAQ. */
export const RAIL_HELP = 'FAQ';

export interface RailKey {
  readonly id: RailKeyId;
  /** The accessible name. There is no visible one -- the rail is five glyphs. */
  readonly label: string;
  readonly icon: ChromeIconName;
}

/**
 * THE STACK, TOP TO BOTTOM, IN THE BRIEF'S ORDER.
 *
 * "theme (sun), gear, mail, code, help." The spec's markup agrees, and the
 * order is the contract: a driver reaches for the gear by position, in a mount,
 * without looking.
 */
export const RAIL_KEYS: readonly RailKey[] = [
  { id: 'theme', label: RAIL_THEME, icon: 'sun' },
  { id: 'settings', label: RAIL_SETTINGS, icon: 'gear' },
  { id: 'mail', label: RAIL_MAIL, icon: 'mail' },
  { id: 'code', label: RAIL_CODE, icon: 'code' },
  { id: 'help', label: RAIL_HELP, icon: 'help' },
];

/**
 * WHAT THE HOST KNOWS ABOUT ONE KEY THAT THE DRAWING CANNOT SAY.
 *
 * Both fields are optional and both default to the drawing. Handed nothing,
 * this is exactly the rail that was measured against the spec.
 *
 * DRIVE binds three of the five. `mail`, `code` and `help` each raise a short
 * list over the map -- the sheets `ContactKey`, `DeveloperKey` and `FaqKey`
 * used to own, absorbed here -- and a key that raises something has to say so
 * and has to be handed focus back when it shuts. `theme` and `settings` raise
 * nothing and bind nothing.
 */
export interface RailKeyBinding {
  /** This key opened a sheet, or it did not. Renders `aria-expanded`. */
  readonly expanded?: boolean;
  /** The element, so the sheet it opened can hand focus back to it. */
  readonly ref?: RefObject<HTMLButtonElement | null>;
}

export interface RailProps {
  /** A key was pressed. What it opens is the host's to decide. */
  readonly onSelect?: ((id: RailKeyId) => void) | undefined;
  /** What the host knows about each key. See {@link RailKeyBinding}. */
  readonly bindings?: Partial<Record<RailKeyId, RailKeyBinding>> | undefined;
  /**
   * Whether the app is currently on a LIGHT skin, so the theme key can draw the
   * one it would switch to. Absent means dark, which is the default and the
   * rail the spec was measured against.
   */
  readonly light?: boolean | undefined;
}

export function Rail({ onSelect, bindings, light }: RailProps): ReactElement {
  return (
    <div className="fwm-rail">
      {RAIL_KEYS.map((key) => {
        const bound = bindings?.[key.id];
        /* The one key whose drawing and whose name both depend on the mode.
           Everything else in this list is the same in both. */
        const themed = key.id === 'theme';
        const icon = themed && light === true ? 'moon' : key.icon;
        const label = themed
          ? light === true
            ? RAIL_THEME_TO_DARK
            : RAIL_THEME_TO_LIGHT
          : key.label;
        return (
          <button
            key={key.id}
            type="button"
            ref={bound?.ref}
            className="fwm-rail-key"
            aria-label={label}
            /* `undefined` renders NO attribute. A key that opens nothing must
               not claim to expand anything. */
            aria-expanded={bound?.expanded}
            onClick={(): void => {
              onSelect?.(key.id);
            }}
          >
            <ChromeIcon name={icon} size={RAIL_ICON_PX} />
          </button>
        );
      })}
    </div>
  );
}
