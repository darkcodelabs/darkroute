/**
 * A SHORT LIST OPENED FROM THE RAIL, and the one place that behaviour lives.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * `ContactKey` was the first of these. Then DEVELOPER wanted the same shape,
 * and FAQ after it - a round key on the rail that expands to a few
 * destinations and closes on Escape or an outside tap.
 *
 * Three copies of a dismissal contract is how two of them end up subtly
 * different: one closes on Escape and the others do not, one restores focus and
 * the others drop it, and nobody notices because each looks fine on its own.
 * Dismissal is exactly the kind of behaviour that has to be identical
 * everywhere, because a driver learns it once and then expects it.
 *
 * =============================================================================
 * IT NO LONGER DRAWS ITS OWN KEY, AND THAT IS THE CHROME BRIEF'S CALL
 * =============================================================================
 * It used to be a 48px round `<button>` with the sheet under it. The rail is
 * now `features/chrome/Rail.tsx` -- five 40px circles, ONE button type, drawn
 * from the spec -- and three of those five are these lists. Two rails' worth of
 * keys over one map is the thing the brief removed.
 *
 * So this is CONTROLLED and keyless: the host says which one is open, this
 * draws that one, and dismissal reports rather than decides. What did not
 * change is the contract -- Escape and an outside tap both close it, Escape
 * puts focus back on the key that opened it, and the listeners are bound only
 * while it is open, so the map keeps every event it normally gets the rest of
 * the time.
 *
 * THE "ONLY ONE OPEN" REGISTRY WENT WITH THE KEY. It was a module variable that
 * let three sibling sheets close each other. The host now holds ONE id -- the
 * key that is open, or none -- so two sheets cannot exist at once to need
 * telling about each other. The invariant is stronger, not weaker: it is
 * structural instead of cooperative.
 *
 * =============================================================================
 * WHAT IT DOES NOT DO
 * =============================================================================
 * It does not decide what is in the list, or what a row means. A row is either
 * a link that leaves the app or an action that opens a screen inside it, and
 * the caller says which - so this file never has to know that GitHub is
 * external and that FAQ is not.
 */

import { useEffect, useRef } from 'react';
import type { ReactElement, RefObject } from 'react';

import './contactKey.css';

export interface RailSheetItem {
  readonly id: string;
  readonly label: string;
  /** The second line. What this row actually is, in the driver's words. */
  readonly note: string;
  /** A destination outside the app. Mutually exclusive with `onSelect`. */
  readonly href?: string;
  /** Somewhere inside the app. Mutually exclusive with `href`. */
  readonly onSelect?: () => void;
  /**
   * Whether an `href` leaves this tab.
   *
   * `mailto:` must not: opening it in a new tab leaves a blank tab behind on
   * every phone browser that honours it.
   */
  readonly sameTab?: boolean;
}

export interface RailSheetProps {
  /** The list's accessible name, and the name of the key that opened it. */
  readonly label: string;
  readonly items: readonly RailSheetItem[];
  /**
   * Shut it. Called for Escape, for an outside tap and for a chosen row --
   * every way out is the same way out.
   */
  readonly onClose: () => void;
  /**
   * The rail key this was opened from, so Escape can put focus back on it.
   *
   * Without it, dismissing drops focus to `<body>`: the element holding focus
   * is inside a sheet that is about to stop existing. An outside tap does NOT
   * restore focus - the driver has already put it somewhere else, and pulling
   * it back onto the rail would fight them.
   */
  readonly returnFocusTo?: RefObject<HTMLButtonElement | null> | undefined;
}

export function RailSheet({ label, items, onClose, returnFocusTo }: RailSheetProps): ReactElement {
  const sheetRef = useRef<HTMLDivElement | null>(null);

  /*
   * ESCAPE AND AN OUTSIDE TAP BOTH CLOSE IT.
   *
   * The two gestures people try without thinking. Bound only while this is
   * mounted - and it is mounted only while it is open - so the map keeps every
   * event it normally gets the rest of the time: a listener that lives forever
   * on a screen that pans is a listener in the way.
   *
   * THE KEY THAT OPENED IT IS NOT AN OUTSIDE TAP. It is the rail's own button
   * and the host toggles on it; closing here as well would shut and reopen in
   * one press, or shut twice, depending on the order the two handlers run in.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      onClose();
      returnFocusTo?.current?.focus();
    };
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sheetRef.current?.contains(target) === true) return;
      if (returnFocusTo?.current?.contains(target) === true) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose, returnFocusTo]);

  return (
    <div className="fwm-contact-sheet" ref={sheetRef} role="group" aria-label={label}>
      {items.map((item) =>
        item.href === undefined ? (
          <button
            key={item.id}
            type="button"
            className="fwm-contact-way"
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            <span className="fwm-contact-way-label">{item.label}</span>
            <span className="fwm-contact-way-note fwm-data">{item.note}</span>
          </button>
        ) : (
          <a
            key={item.id}
            className="fwm-contact-way"
            href={item.href}
            target={item.sameTab === true ? undefined : '_blank'}
            rel={item.sameTab === true ? undefined : 'noreferrer'}
            onClick={() => {
              onClose();
            }}
          >
            <span className="fwm-contact-way-label">{item.label}</span>
            <span className="fwm-contact-way-note fwm-data">{item.note}</span>
          </a>
        ),
      )}
    </div>
  );
}
