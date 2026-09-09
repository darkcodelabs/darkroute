/**
 * HOW TO REACH A PERSON, from the screen a driver is actually on.
 *
 * =============================================================================
 * WHY IT IS ON THE MAP AND NOT ONLY IN SETTINGS
 * =============================================================================
 * SETTINGS has a contact row, and that is the right place for somebody who
 * went looking. This is for the other case: a driver who has just seen a camera
 * in the wrong place, or something the app got wrong, and whose next thought is
 * "who do I tell". Making them leave the map, find SETTINGS and scroll is three
 * steps too many for the moment when they still remember what happened.
 *
 * =============================================================================
 * THREE WAYS, BECAUSE THEY ARE NOT INTERCHANGEABLE
 * =============================================================================
 *   EMAIL     for anything that needs a paper trail, and the only one that
 *             works with no account anywhere
 *   GITHUB    for a bug, where the right outcome is an issue other people can
 *             read rather than a message only we can
 *   SIGNAL    for anything a person does not want to send in plaintext, which
 *             on a surveillance-avoidance app is a category with real members
 *
 * Every one leaves the app, and none of them send anything from here: these are
 * links, not a form. This app has no endpoint that accepts a message and it is
 * not growing one for a contact button.
 *
 * =============================================================================
 * THIS WAS `ContactKey.tsx`, A KEY AND A SHEET
 * =============================================================================
 * The key is gone: the rail is `features/chrome/Rail.tsx` now, five circles
 * drawn from the spec, and the envelope is one of them. What is left is the
 * part that was never the key's -- the three ways and the word on them -- and
 * it is data, so it is a `.ts` file with no JSX in it. `RailSheet` draws the
 * list; `Rail` draws the key; `DriveScreen` decides which list is open.
 *
 * `CONTACT_LABEL` survives the key it named. `Rail.tsx` cites it as where its
 * own word for the envelope came from, so the rail says what the rail said
 * yesterday rather than a synonym of it.
 */

import type { RailSheetItem } from './RailSheet.tsx';

export const CONTACT_LABEL = 'Contact';
export const CONTACT_EMAIL = 'cory@darkroute.ai';
export const CONTACT_REPO = 'https://github.com/darkcodelabs/darkroute';
export const CONTACT_SIGNAL =
  'https://signal.me/#eu/1pYtdcvX9UXy9GVQIzzLuox-k7UVoRF7eYmGBeWuqbXC4aCsIyhOwraAPC51qV5M';

export const CONTACT_WAYS: readonly RailSheetItem[] = [
  /* `sameTab`, because a `mailto:` opened in a new tab leaves a blank tab
     behind on every phone browser that honours it. */
  {
    id: 'email',
    label: 'Email',
    note: CONTACT_EMAIL,
    href: `mailto:${CONTACT_EMAIL}`,
    sameTab: true,
  },
  { id: 'repo', label: 'GitHub', note: 'read the code, open an issue', href: CONTACT_REPO },
  { id: 'signal', label: 'Signal', note: 'encrypted, no email needed', href: CONTACT_SIGNAL },
];
