/**
 * The 52px header.
 *
 * SOURCE: the header every screen in `Flockys Screens II.dc.html` shares --
 * 52px, the screen name at 17px/700/.1em on the left, a mono 10px/.1em
 * strapline on the right in the muted grey, never wrapped. `WATCHLIST` /
 * `ON-DEVICE MATCHING`, `TRIAGE` / `ALERT FATIGUE CONTROL`, `ZONE AUDIT` /
 * `2 MI RADIUS`.
 *
 * `SETTINGS` is not a drawn panel, so its strapline is not quoted from
 * anywhere. `ON THIS DEVICE` is the shortest true thing this screen can say
 * about itself and it is the claim the rest of the screen has to keep.
 * GAP: see docs/gaps-inbox/settings.md#header-strapline-is-not-drawn
 *
 * No back key: no design in any of the four files draws one, the shell owns
 * navigation, and a screen that invents its own back button competes with the
 * platform gesture `screenState.goBack()` already handles.
 */

import type { ReactElement } from 'react';

import { BrandMark } from '../../../components/brand/BrandMark.tsx';

export const SETTINGS_TITLE = 'SETTINGS';
export const SETTINGS_STRAPLINE = 'ON THIS DEVICE';

export function SettingsHeader(): ReactElement {
  return (
    <header className="fwm-settings-header">
      <BrandMark />
      <h1 className="fwm-settings-title">{SETTINGS_TITLE}</h1>
      <span className="fwm-settings-strapline fwm-data">{SETTINGS_STRAPLINE}</span>
    </header>
  );
}
