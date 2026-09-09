/**
 * THE DOCK - v1.
 *
 * SOURCE: `.design-src-v1/FlockysWatchingMe.dc.html`, the `navVisible` block.
 *
 * =============================================================================
 * WHAT CHANGED FROM v0
 * =============================================================================
 * v0 carries five destinations in one 84px bar with REPORT folded in as a sixth
 * key. v1 carries five in a floating glass pill and lifts REPORT out of the bar
 * entirely, as a separate circle beside it.
 *
 * MORE remains the hub for the quieter destinations. LOOK UP is the exception:
 * camera search is a primary driving action, so it has a direct SEARCH key at
 * the far right of the pill as well as the explanatory tile inside MORE. Both
 * routes select the same `lookup` screen through the same screen-state adapter.
 *
 * Every key keeps its word in the accessibility tree while the picture remains
 * a row of evenly spaced glyphs.
 *
 * =============================================================================
 * WHAT IS REUSED RATHER THAN REBUILT
 * =============================================================================
 * `ReportKey`. The crimson circle is that component with a different shape
 * around it, which is why the tap-opens-the-sheet and hold-1s-drops-a-pin
 * gestures, the abort-on-drag slop, the queued badge and the "hold is not armed
 * when nothing is behind it" refusal all arrive here already correct. Rewriting
 * it to change a border radius would have forked two gestures and a timer.
 *
 * `screenState`. Same adapter, same `openScreen`, same override props.
 */

import type { ReactElement } from 'react';

import { openOverlay, openScreen, useScreenState } from '../../app/screenState.ts';
import type { ScreenId } from '../../app/screenState.ts';
import { REPORT_OVERLAY } from '../../features/report/ReportScreen.tsx';

import { ReportKey, type ReportKeyProps } from './ReportKey.tsx';
import './dockV1.css';

export interface DockV1KeyDefinition {
  /** Where the key goes. A real screen id, so every v0 deep link still lands. */
  readonly screen: ScreenId;
  /** The word, shown only while this key is the active one. */
  readonly label: string;
  /**
   * The other screens this key counts as being on.
   *
   * MORE is a hub: standing on SETTINGS is standing behind MORE, and a dock
   * with nothing lit while you are three taps into it reads as broken chrome.
   * The design's own `MORE_CHILDREN` list.
   */
  readonly also?: readonly ScreenId[];
}

/**
 * The five destinations, in dock order.
 *
 * DRIVE is `radar` and MESH is `node` because those are the ids the rest of the
 * app - the alert takeover's restore path, the manifest shortcuts, every
 * `?screen=` link ever shared - already speaks. v1 renamed the surfaces, not
 * the addresses.
 */
export const DOCK_V1_KEYS: readonly DockV1KeyDefinition[] = [
  { screen: 'radar', label: 'Drive' },
  { screen: 'log', label: 'Log' },
  { screen: 'node', label: 'Mesh' },
  {
    screen: 'more',
    label: 'More',
    also: ['misuse', 'triage', 'settings', 'help', 'ask', 'offline', 'admin'],
  },
  { screen: 'lookup', label: 'Search' },
];

export interface DockV1Props {
  /** The screen on top. Defaults to the screen-state adapter. */
  readonly active?: ScreenId;
  /** Called with the tapped key's screen. Defaults to `openScreen`. */
  readonly onSelect?: (screen: ScreenId) => void;
  readonly keys?: readonly DockV1KeyDefinition[];
  /** Passed straight through to `ReportKey`. */
  readonly report?: ReportKeyProps;
}

/** True when `screen` should light `key`. */
export function isKeyActive(key: DockV1KeyDefinition, screen: ScreenId | null): boolean {
  if (screen === null) return false;
  if (key.screen === screen) return true;
  return key.also?.includes(screen) === true;
}

function KeyGlyph({ screen }: { readonly screen: ScreenId }): ReactElement {
  // Drawn in `currentColor` so the glyph carries the key's state, which is why
  // these are inline SVG and not the brand raster.
  // NO width/height ATTRIBUTES. Size is a design value and belongs in the
  // stylesheet -- `.fwm-dockv1-glyph` in dockV1.css, off `--fwm-icon-size` -
  // which is also how v0's `DockIcon` does it. `strokeWidth` is a unitless SVG
  // user unit rather than a CSS length, so it stays here, same as v0.
  const common = {
    className: 'fwm-dockv1-glyph',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true,
  } as const;

  if (screen === 'radar') {
    // The heading arrow: the one glyph in the set that means "you, moving".
    return (
      <svg {...common} strokeLinejoin="round">
        <path d="M12 3.5 19 20l-7-4-7 4 7-16.5Z" />
      </svg>
    );
  }
  if (screen === 'log') {
    // Bars, because the log's own hero is a week of bars.
    return (
      <svg {...common} strokeLinecap="round">
        <path d="M5 18V9m4.7 9V5m4.6 13v-6M19 18v-9" />
      </svg>
    );
  }
  if (screen === 'node') {
    return (
      <svg {...common} strokeLinecap="round">
        <path d="M7 7.8 12 5l5 2.8M7 16.2 12 19l5-2.8M6 10.5v3M18 10.5v3" />
        <circle cx="12" cy="12" r="2.1" />
      </svg>
    );
  }
  if (screen === 'lookup') {
    // The same destination as MORE's "LOOK UP · Find a camera" tile, made
    // direct here: a magnifier rather than another generic menu mark.
    return (
      <svg {...common} strokeLinecap="round">
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 4.2 4.2" />
      </svg>
    );
  }
  return (
    <svg {...common} strokeLinecap="round">
      <path d="M5 8.5h14M5 15.5h14" />
    </svg>
  );
}

export function DockV1({
  active,
  onSelect,
  keys = DOCK_V1_KEYS,
  report,
}: DockV1Props = {}): ReactElement {
  const state = useScreenState();
  const current = active ?? state.screen;
  const select =
    onSelect ??
    ((screen: ScreenId) => {
      openScreen(screen);
    });

  return (
    <nav className="fwm-dockv1" aria-label="dock">
      <div className="fwm-dockv1-bar">
        {keys.map((key) => {
          const on = isKeyActive(key, current);
          return (
            <button
              type="button"
              key={key.screen}
              className="fwm-dockv1-key"
              data-fwm-dock-key={key.screen}
              data-fwm-active={String(on)}
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                select(key.screen);
              }}
            >
              <KeyGlyph screen={key.screen} />
              {/* The word is in the tree on every key, always: an icon button
                  with no accessible name is unusable, and only the ACTIVE key
                  paints its word. `.fwm-dockv1-word` clips the rest. */}
              <span className="fwm-dockv1-word">{key.label}</span>
            </button>
          );
        })}
      </div>
      {/* Lifted out of the bar, which is the one structural change v1 makes to
          the dock. Same component, same two gestures.

          A SHEET, NOT A NAVIGATION. `ReportKey`'s default is
          `openScreen('report')`, which REPLACES the screen - so the tap left
          DRIVE entirely, unmounted the map, and coming back rebuilt it at the
          default zoom. The design raises report over whatever you were on, and
          `App` now has a layer to raise it into. */}
      <div className="fwm-dockv1-report">
        <ReportKey
          onReport={() => {
            openOverlay(REPORT_OVERLAY);
          }}
          {...report}
        />
      </div>
    </nav>
  );
}
