/**
 * What this device is holding, and what the removal control does to each row.
 *
 * SOURCE: `Flockys Watch.dc.html` `W12`, the card titled `STAYS ON THE PHONE -
 * SAID OUT LOUD, NOT HIDDEN`: an arrow, a phrase, one line each, in mono, with
 * the arrow in the destructive orange. The list here uses the same shape and
 * adds one right-aligned tag per row, because this list has to answer a second
 * question -- does the button below delete this or not.
 *
 * The rows come from `../storage.ts`, which maps them to real object stores and
 * to what `clearLocalData()` actually does. Nothing on this screen decides a
 * disposition; it renders one.
 *
 * =============================================================================
 * FOLDED SHUT BY DEFAULT, AND THAT IS NOT THE SAME AS HIDDEN
 * =============================================================================
 * Eight rows, each with a label, a tag and a sentence, is the longest block on
 * this screen -- and it sits directly above the one genuinely destructive
 * control in the app. Expanded by default it pushed the removal button off the
 * bottom of the phone and made the section read as a wall rather than as an
 * answer, so the people who most needed to read it scrolled past it.
 *
 * `<details>` rather than a state flag: the summary is a real disclosure
 * widget, so it is keyboard-operable, announced as expandable by a screen
 * reader, and -- the part that matters here -- its contents are still found by
 * the browser's own in-page FIND, which a conditionally-rendered block is not.
 * Nothing about this removes the text from the page; it removes it from the
 * default view, which is what was asked for.
 *
 * The COUNT is in the summary on purpose. A fold with no number on it invites
 * the reader to assume it is boilerplate; the number of kinds of data is the
 * fact that makes somebody open it. It is read off `STORED_ITEMS.length` rather
 * than typed, so disclosing a new store cannot leave the summary undercounting
 * the list directly beneath it.
 */

import type { ReactElement } from 'react';

import { DISPOSITION_TAGS, STORED_ITEMS } from '../storage.ts';

export const STORED_SUMMARY = `WHAT IS ON THIS DEVICE · ${String(STORED_ITEMS.length)} KINDS`;

export function StoredList(): ReactElement {
  return (
    <details className="fwm-settings-stored-fold">
      <summary className="fwm-settings-stored-summary fwm-data">{STORED_SUMMARY}</summary>
      <ul className="fwm-settings-stored">
      {STORED_ITEMS.map((item) => (
        <li
          key={item.id}
          className="fwm-settings-stored-item"
          data-fwm-settings-disposition={item.disposition}
        >
          <div className="fwm-settings-stored-head">
            <span className="fwm-settings-stored-label">{item.label}</span>
            <span className="fwm-settings-stored-tag fwm-data">
              {DISPOSITION_TAGS[item.disposition]}
            </span>
          </div>
          <p className="fwm-settings-stored-detail fwm-data">{item.detail}</p>
        </li>
        ))}
      </ul>
    </details>
  );
}
