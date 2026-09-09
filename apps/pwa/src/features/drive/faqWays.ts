/**
 * THE TWO SCREENS THAT ANSWER "WHAT IS THIS DOING WITH MY LOCATION".
 *
 * =============================================================================
 * WHY THEY MOVED HERE
 * =============================================================================
 * WHAT IT KNOWS and HOW THIS WORKS were rows in MORE, several taps from the map
 * and sitting in a list beside a theme picker and an install prompt. They are
 * not settings. They are the answer to the question a person asks in the first
 * minute of using a surveillance-avoidance app - does this thing leak me? - and
 * the honest answer being three navigations away from the screen that raised
 * the question is the same as not having one.
 *
 * They belong together because they are two halves of one claim. WHAT IT KNOWS
 * answers the question in a sentence and names the file that makes the sentence
 * true; HOW THIS WORKS is the documents behind those files, plus the commit the
 * running build came from. Neither is much use without the other: a claim with
 * no source is a promise, and a source with no claim is a repository.
 *
 * =============================================================================
 * WHY IT IS UNDER DEVELOPERS
 * =============================================================================
 * The rail reads downward from things used while moving to things used while
 * stopped. CONTACT, DEVELOPERS and FAQ are the stopped end, and they escalate:
 * tell a person, read the data, check the claim.
 *
 * =============================================================================
 * THIS WAS `FaqKey.tsx`, A KEY AND A SHEET
 * =============================================================================
 * The key is gone. The rail is `features/chrome/Rail.tsx` now -- five circles
 * drawn from the spec, one button type -- and the question mark is the last of
 * them, so the glyph this file used to carry is drawn there. What is left is
 * the list, which needs the screen's own two closures because not one of its
 * five rows is a link: `faqWays(onOpenScreen, onOpenDoc)`.
 *
 * `FAQ_LABEL` survives the key it named, because `Rail.tsx` cites it as where
 * its own word for this key came from.
 */

import type { RailSheetItem } from './RailSheet.tsx';

export const FAQ_LABEL = 'FAQ';
export const FAQ_KNOWS = 'What it knows';
export const FAQ_WORKS = 'How this works';

/**
 * THE LIST. A function, because every row of it opens something INSIDE the app
 * and the screen owns navigation -- these are the same two closures `DRIVE`
 * handed the component this file replaced.
 */
export function faqWays(
  onOpenScreen: (screen: 'help' | 'docs') => void,
  onOpenDoc: (name: 'legal' | 'transparency' | 'terms') => void,
  /** Whether demo drive is on, so the last row can name where it goes. */
  demoOn: boolean,
  onToggleDemo: (on: boolean) => void,
): readonly RailSheetItem[] {
  return [
    {
      id: 'help',
      label: FAQ_KNOWS,
      note: 'every answer names the file that makes it true',
      onSelect: () => {
        onOpenScreen('help');
      },
    },
    {
      id: 'docs',
      label: FAQ_WORKS,
      note: 'the documents, and the source this build came from',
      onSelect: () => {
        onOpenScreen('docs');
      },
    },
    /*
     * THE THREE THAT GET ASKED ABOUT MOST, promoted out of the document list so
     * they are one tap rather than three. All three render the repository's own
     * markdown; none is written here.
     *
     * TERMS JOINED THEM, and it is the one somebody looks FOR rather than reads
     * past. It shipped in the document list first, which is correct and is also
     * eleven rows down a screen you reach from another screen - a terms page
     * nobody can find is a terms page nobody agreed to.
     */
    {
      id: 'terms',
      label: 'Terms of use',
      note: 'what you are agreeing to, and the ways the data is wrong',
      onSelect: () => {
        onOpenDoc('terms');
      },
    },
    {
      id: 'legal',
      label: 'The legal position',
      note: 'what is settled, what is not, what we will not do',
      onSelect: () => {
        onOpenDoc('legal');
      },
    },
    {
      id: 'transparency',
      label: 'Transparency',
      note: 'every request, and what is kept',
      onSelect: () => {
        onOpenDoc('transparency');
      },
    },
    /*
     * DEMO DRIVE, LAST, AND IT IS THE ONE ROW HERE THAT CHANGES THE APP.
     *
     * Everything above opens a document. This turns on a mode, so it sits at
     * the bottom behind a divider rather than in among them - a row that reads
     * like its neighbours and does something different is the row people press
     * by accident.
     *
     * IT IS HERE BECAUSE NOBODY COULD FIND IT. It shipped as a card in SETTINGS,
     * which is correct and is also two screens away from the map it operates
     * on. This menu is one tap from the map and is already where somebody looks
     * when they want to know what the app is doing.
     *
     * The label says which way pressing it goes, the same rule the theme key
     * follows: `Turn on demo drive` while it is off, `Turn off demo drive`
     * while it is on. It reports state rather than asking the caller to guess.
     */
    {
      id: 'demo',
      label: demoOn ? 'Turn off demo drive' : 'Turn on demo drive',
      note: demoOn
        ? 'the pad on the map is placing you by hand'
        : 'place yourself on the map by hand, to see alerts without driving',
      onSelect: () => {
        onToggleDemo(!demoOn);
      },
    },
  ];
}
