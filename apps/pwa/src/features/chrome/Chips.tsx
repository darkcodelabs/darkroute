/**
 * THE CHIP ROW. Section B of `searchbar_and_buttons.dc.html`, and nothing else.
 *
 * Three 36px pills centred under the bar: Reports, Layers, Map view, in that
 * order, with Layers drawn active. That is the whole set the spec renders, in
 * both themes, and it is transcribed rather than merged with whatever the app
 * currently shows -- the brief says so in as many words.
 *
 * THIS COMPONENT DOES NOT DECIDE ANYTHING. It does not know what a layer is,
 * does not open a panel and does not hold which chip is on. It is handed the
 * active chip and it reports the one press it has, for the same reason
 * `TopBar.tsx` is handed its count: a component that owns the state it draws is
 * one a test cannot put into the state it needs to check.
 *
 * COLOUR AND GEOMETRY ARE NOT HERE. Not one hex, not one pixel. `chrome.css`
 * resolves both.
 *
 * =============================================================================
 * WHAT THE SPEC DOES NOT SAY, AND WHAT WAS DONE ABOUT IT
 * =============================================================================
 * WHERE A CHIP GOES. The spec renders three `<button>`s with no handler, no
 * href and no target. It draws what a chip LOOKS like and is silent on what it
 * opens, so nothing here opens anything: the press is reported and the host
 * routes it. All three destinations are open questions and are reported as
 * such.
 *
 * WHETHER TWO CHIPS CAN BE ACTIVE AT ONCE. The spec draws exactly one active
 * chip, and `active` is therefore ONE id or none rather than a set. That is a
 * constraint on the host and it is stated here rather than buried: if these
 * turn out to be independent toggles -- Abuse shading on WHILE a layer set is
 * chosen -- this prop becomes a `readonly ChipId[]` and nothing else in the
 * file changes.
 *
 * WHAT `aria-pressed` CLAIMS. It says "this chip is on", which is what the
 * drawing says. If a chip turns out to OPEN A PANEL rather than to toggle a
 * state, the honest attribute is `aria-expanded` and it is a one-word change
 * here plus one selector in `chrome.css`. Neither is guessed at further: a
 * button whose only state is a colour is unusable without one of the two, and
 * `aria-pressed` is the one that matches the drawing.
 *
 * =============================================================================
 * AND THEN THE HOST ANSWERED BOTH -- SEE `ChipBinding`
 * =============================================================================
 * DRIVE mounted these over the map in place of `SearchPills`, and two of the
 * three turned out to OPEN A PANEL: `Layers` raises the map-control panel and
 * `Map view` raises the map-view panel. Reports raises the reports menu.
 *
 * That does not change the drawing and it does not change this file's default:
 * handed nothing but `active`, a chip is still the picture, still
 * `aria-pressed`, still nameless beyond its own word. What the host can now
 * add is the three things it knows and the drawing cannot say -- the panel
 * relationship, the state the name has to carry, and a ref the panel hands
 * focus back to. All three are OPTIONAL and all three default to the drawing.
 */

import type { ReactElement, RefObject } from 'react';

import { ChromeIcon } from './icons.tsx';
import type { ChromeIconName } from './icons.tsx';

import './chrome.css';

/** The mark inside a chip, at the spec's own size. */
const CHIP_ICON_PX = 16;

/** The three the spec draws. A union, so a fourth cannot arrive untyped. */
export type ChipId = 'abuse' | 'layers' | 'map-view';

export interface Chip {
  readonly id: ChipId;
  /** The word on the pill, exactly as the spec sets it. */
  readonly label: string;
  readonly icon: ChromeIconName;
}

/**
 * THE SET, IN THE SPEC'S ORDER.
 *
 * Reports, Layers, Map view -- left to right in both panels. Exported so a test
 * and a host read the same list, and frozen in shape by `readonly` so a caller
 * cannot quietly add a fourth on its way past.
 *
 * The labels carry the spec's own capitalisation: `Map view`, one capital, not
 * `Map View`.
 */
export const CHIPS: readonly Chip[] = [
  { id: 'abuse', label: 'Reports', icon: 'abuse' },
  { id: 'layers', label: 'Layers', icon: 'layers' },
  { id: 'map-view', label: 'Map view', icon: 'map-view' },
];

/**
 * WHAT THE HOST KNOWS ABOUT ONE CHIP THAT THE DRAWING CANNOT SAY.
 *
 * Every field is optional and every default is the spec's. A host that binds
 * nothing gets exactly the component that was measured against the drawing.
 */
export interface ChipBinding {
  /**
   * THE ACCESSIBLE NAME, when the word on the pill is not the whole truth.
   *
   * `Layers` is the word; what is ON is the cartography in force plus the
   * drawing filter when one is set, and a driver who cannot see the map needs
   * telling which. This is the pill row's own `layersLabel`, carried over
   * unchanged -- `DriveScreen.ownerFilter.test.tsx` asserts the sentence.
   *
   * The VISIBLE word never changes. The spec sets `Layers` and this names the
   * control, it does not relabel it.
   */
  readonly label?: string;
  /**
   * THIS CHIP OPENS A PANEL, AND THE PANEL IS OPEN OR IT IS NOT.
   *
   * Given, the chip carries `aria-expanded` beside its `aria-pressed`, which
   * is what the file's own note above says the honest answer is for a chip
   * that raises something rather than toggling a state. Not given, there is no
   * attribute: a chip that navigates must not claim to expand anything.
   */
  readonly expanded?: boolean;
  /**
   * THE ELEMENT, so a panel this chip opened can hand focus back to it.
   *
   * Without one, every close drops focus to `<body>`: the panels shut from
   * inside their own click handler and take `inert` in the same commit, so the
   * control holding focus stops being focusable. Escape does the same. See
   * `MapControlPanel`'s `closeAndRestore`.
   */
  readonly ref?: RefObject<HTMLButtonElement | null>;
}

export interface ChipsProps {
  /**
   * THE ONE THAT IS ON, or `null` for none.
   *
   * The spec draws Layers active; that is a state the host holds, not a default
   * this component invents, so there is no default here.
   */
  readonly active: ChipId | null;
  /** A chip was pressed. What that opens is the host's to decide. */
  readonly onSelect?: ((id: ChipId) => void) | undefined;
  /** What the host knows about each chip. See {@link ChipBinding}. */
  readonly bindings?: Partial<Record<ChipId, ChipBinding>> | undefined;
}

export function Chips({ active, onSelect, bindings }: ChipsProps): ReactElement {
  return (
    <div className="fwm-chip-row">
      {CHIPS.map((chip) => {
        const bound = bindings?.[chip.id];
        return (
          <button
            key={chip.id}
            type="button"
            ref={bound?.ref}
            className="fwm-chip"
            /* The state a sighted driver reads as an accent fill, in the one
               place a screen reader can also read it. `chrome.css` selects on
               this attribute rather than on a class for exactly that reason. */
            aria-pressed={chip.id === active}
            aria-expanded={bound?.expanded}
            /* `undefined` renders NO attribute, which is the point: a chip the
               host said nothing about is named by its own word, exactly as the
               drawing names it. */
            aria-label={bound?.label}
            onClick={(): void => {
              onSelect?.(chip.id);
            }}
          >
            <ChromeIcon name={chip.icon} size={CHIP_ICON_PX} />
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
