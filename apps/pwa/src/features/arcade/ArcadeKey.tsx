/**
 * THE KEY ON THE DOCK. 44 by 44, in the slot the map inset leaves empty.
 *
 * `BrowseRow` draws a 56px map inset beside the column in exactly two states,
 * APPROACHING and PASSING -- both moving. The game is offered only to a parked
 * car on `dense`, so whenever this key can appear the slot is empty, and a 44
 * key fits in it without the meta row's overflow trick. `MetaKey` is
 * untouched: the detour key keeps its slot and its precedence.
 *
 * NEUTRAL INK, NOT THE PANE'S HUE. `dense`'s hue is the exposure tier ramp,
 * and a toy wearing a reading's colour is the thing `dock.css` warns about --
 * the same reason E4's Cancel is `--dr-ink`. The glyph is a ship because that
 * is what it is; the word under it is the owner's.
 */

import type { ReactElement } from 'react';

import { DockIcon } from '../dock/icons.tsx';

import './arcade.css';

/** The glyph, at the size of the collapsed row's leading mark. */
const KEY_ICON_SIZE = 20;

export const ARCADE_KEY_LABEL = 'Pew';
export const ARCADE_KEY_SPOKEN = 'Play pew at this reader';

export interface ArcadeKeyProps {
  readonly onPress: () => void;
}

export function ArcadeKey({ onPress }: ArcadeKeyProps): ReactElement {
  return (
    <button
      type="button"
      className="fwm-arcade-key"
      data-fwm-action="arcade"
      aria-label={ARCADE_KEY_SPOKEN}
      onClick={onPress}
    >
      <DockIcon name="ship" size={KEY_ICON_SIZE} />
      <span className="fwm-arcade-key-label">{ARCADE_KEY_LABEL}</span>
    </button>
  );
}
