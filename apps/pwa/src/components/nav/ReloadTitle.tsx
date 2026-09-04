/**
 * THE PAGE TITLE, AND IT RELOADS - one control, drawn by every v1 page.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * DRIVE's wordmark was already a `<button>` that called `location.reload()`,
 * with its own chrome reset in `drive.css` and its own hand-written accessible
 * name. Every other screen drew a plain `<h1>`, so the gesture that works on
 * the first screen of the app did nothing on the other thirteen - which is
 * worse than not having it, because a driver who learns it on DRIVE then taps a
 * dead word on SETTINGS and concludes the app is stuck.
 *
 * The fix is not fourteen copies of DRIVE's button. It is this: one component,
 * beside `BackKey.tsx` for the same reason that file gives - two copies of a
 * control is how the third copy ends up subtly different - and DRIVE renders it
 * too rather than keeping its own.
 *
 * =============================================================================
 * IT IS STILL A HEADING
 * =============================================================================
 * The `<h1>` stays and the button goes INSIDE it, rather than the button
 * replacing the heading. A screen with no `h1` is a screen a heading-navigation
 * user cannot find the top of, and "make the title tappable" is not a reason to
 * take that away from thirteen screens. The screen keeps passing its own title
 * class to the `<h1>`, so its type ramp, its hue and its `margin-right: auto`
 * in a flex header are exactly what they were; `.fwm-reloadtitle` resets the
 * button's own chrome and inherits all of it.
 *
 * DRIVE is the one caller whose heading is not a header bar - the wordmark
 * sits in the status pill over the map - and its class carries a drop shadow
 * and a `nowrap` the others do not need. Passing the class through is what lets
 * that survive rather than being flattened into a shared look.
 *
 * =============================================================================
 * THE NAME SAYS WHAT PRESSING IT DOES
 * =============================================================================
 * "Settings" announces as "Settings, button", which tells a screen-reader user
 * that something will happen and not what. Reloading is destructive - it throws
 * away whatever the screen was holding - so it is named before it is pressed,
 * not discovered after: `reloadTitleLabel` is the whole phrase, and it is
 * built here so all fourteen say it the same way.
 *
 * The cost is stated rather than hidden: the `<h1>`'s own accessible name is
 * computed from its contents, so it becomes the phrase too. A heading that
 * announces "Settings - reload this page" is louder than one that announces
 * "Settings", and it is also true - the heading IS the control now, and a user
 * skimming by heading is exactly the user who should be told that before they
 * land on it.
 *
 * =============================================================================
 * WHAT DOES NOT GET ONE
 * =============================================================================
 * A sheet or a card raised over another screen. REPORT holds an unsent draft
 * and a photograph; INTEL's loaded card is an overlay over the map far more
 * often than it is a screen and cannot tell which it is. Reloading from either
 * discards the thing the driver is standing in, so those two keep their plain
 * `<h1>`. See the comments at both call sites.
 */

import type { ReactElement } from 'react';

import './nav.css';

/** What pressing the title does, in words. Written once, said by every page. */
export const RELOAD_PROMISE = 'reload this page';

/**
 * The accessible name: the visible title, then the promise.
 *
 * A function rather than a constant per screen, because the visible half
 * differs and the spoken half must not. DRIVE's hand-written
 * `'DarkRoute - reload this page'` is this string for `'DarkRoute'`, which is
 * how that screen migrated onto this component without changing what it says.
 */
export function reloadTitleLabel(title: string): string {
  return `${title} - ${RELOAD_PROMISE}`;
}

export interface ReloadTitleProps {
  /** The words on the screen. Also the first half of the accessible name. */
  readonly title: string;
  /**
   * The screen's own heading class, applied to the `<h1>`.
   *
   * Required, not optional: every one of these headings is already typed by a
   * feature stylesheet, and a default here would be a fifteenth opinion about
   * what a title looks like.
   */
  readonly className: string;
  /**
   * Draw the title as the WORDMARK ARTWORK instead of as words.
   *
   * DRIVE only. The other thirteen headings are the screen's name in the app's
   * own type; this one is the product's name, and the brand draws it as a
   * distressed logotype that no font reproduces.
   *
   * `title` is still REQUIRED and still carries the accessible name. The
   * artwork is `aria-hidden` and the button keeps
   * `reloadTitleLabel(title)`, so a screen reader hears "DarkRoute - reload
   * this page" exactly as it did when the mark was text. An image with no text
   * alternative would have made the first control on the first screen
   * anonymous.
   */
  readonly asMark?: boolean;
  /**
   * Used instead of reloading.
   *
   * For tests and harnesses only - jsdom has no navigation, so a real reload
   * is unassertable. `DockV1` takes `onSelect` the same way and for the same
   * reason. No screen passes it.
   */
  readonly onReload?: () => void;
}

export function ReloadTitle({
  title,
  className,
  asMark = false,
  onReload,
}: ReloadTitleProps): ReactElement {
  return (
    <h1 className={className}>
      <button
        type="button"
        className="fwm-reloadtitle"
        /* Readable from the DOM, so a headless pass can assert that every page
           title is a control without pressing one and losing the page. */
        data-fwm-reload-title="true"
        aria-label={reloadTitleLabel(title)}
        onClick={() => {
          if (onReload === undefined) globalThis.location.reload();
          else onReload();
        }}
      >
        {asMark ? <span className="fwm-reloadtitle-mark" aria-hidden="true" /> : title}
      </button>
    </h1>
  );
}
