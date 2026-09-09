/**
 * THE WAY IN FOR SOMEBODY WHO IS NOT DRIVING.
 *
 * =============================================================================
 * WHY THE DATA HAS A DOOR THAT IS NOT THIS APP
 * =============================================================================
 * The archive is ODbL data about public infrastructure. Locking it inside one
 * phone app would be a smaller version of the thing this project objects to:
 * somebody else deciding what you may know about your own street.
 *
 * Researchers, journalists and neighbourhood groups do not want a PWA in a
 * cradle. They want a bounding box and a JSON array, and they should not have
 * to scrape a map to get one.
 *
 * =============================================================================
 * WHY IT IS ON THE RAIL AT ALL
 * =============================================================================
 * Because nobody finds a developer page from a driving screen by guessing, and
 * an API nobody can find is a private API with extra steps. It is the fourth
 * key of five, under CONTACT: both are for the person who has stopped the car,
 * and neither is reached at speed.
 *
 * =============================================================================
 * THIS WAS `DeveloperKey.tsx`, A KEY AND A SHEET
 * =============================================================================
 * The key is gone. The rail is `features/chrome/Rail.tsx` now -- five circles
 * drawn from the spec, one button type -- and the angle brackets are one of
 * them, so the glyph this file used to carry is drawn there. What is left is
 * the list, which is data, and the two rows that are not links and therefore
 * need the screen's own handler: `developerWays(onOpenDoc)`.
 *
 * `DEVELOPER_LABEL` survives the key it named, because `Rail.tsx` cites it as
 * where its own word for this key came from.
 */

import type { RailSheetItem } from './RailSheet.tsx';

export const DEVELOPER_LABEL = 'Developers';
export const DEVELOPER_REPO = 'https://github.com/darkcodelabs/darkroute';
/*
 * The console is its own deployment, not a route in this app.
 *
 * It is a desk-side tool with a different shape, a different bundle and no
 * offline story, and serving it from this origin would put a megabyte of
 * table-and-chart code inside the artefact a driver installs. The apex stays
 * the driving app.
 *
 * `api.darkroute.ai` is the console's own hostname. The name says API because
 * that is what somebody arriving there is looking for - the endpoints, the
 * spec, and a box to try them in.
 */
export const DEVELOPER_CONSOLE = 'https://api.darkroute.ai';
export const DEVELOPER_SPEC = '/api/v1/openapi.json';

/**
 * THE WAY IN FOR DATA, WHICH THIS APP DELIBERATELY HAS NO ENDPOINT FOR.
 *
 * Somebody who has been mapping cameras, or who has a log worth contributing,
 * currently has nowhere to put it: reports live in IndexedDB on their own
 * phone and there is no upload route, on purpose. An anonymous write endpoint
 * on a public archive is a way to put unattributable claims into a dataset
 * whose whole value is that every row can be traced.
 *
 * A pull request is the honest version of the same thing. It is attributable,
 * it is reviewable by people who are not us, it is public while it is being
 * decided, and the person contributing keeps their name on it. The cost is
 * that it needs a GitHub account, which is a real barrier and the right one to
 * accept: the alternative is a queue nobody can audit.
 *
 * Points at the contribution guide rather than at a bare "new issue" form,
 * because the first thing a contributor needs is the shape the data should be
 * in.
 */
export const DEVELOPER_SHARE =
  'https://github.com/darkcodelabs/darkroute/blob/main/CONTRIBUTING-DATA.md';

const WAYS: readonly RailSheetItem[] = [
  {
    id: 'console',
    label: 'API console',
    note: 'try every endpoint in the browser',
    href: DEVELOPER_CONSOLE,
  },
  {
    id: 'spec',
    label: 'OpenAPI spec',
    note: 'generate a client from it',
    href: DEVELOPER_SPEC,
  },
  {
    id: 'share',
    label: 'I want to share data',
    note: 'cameras or logs, as a pull request',
    href: DEVELOPER_SHARE,
  },
  {
    id: 'repo',
    label: 'Source',
    note: 'GPL-3.0, read the code',
    href: DEVELOPER_REPO,
  },
];

export type DeveloperDoc = 'data-contracts' | 'taxonomy';

/**
 * THE LIST, BUILT AROUND THE TWO ROWS THAT STAY INSIDE THE APP.
 *
 * A function rather than a constant because two of the six are not links: they
 * open a published document in the app's own reader, and the reader belongs to
 * the screen. `onOpenDoc` is that screen's closure, handed in, exactly as it
 * was handed to the component this file replaced.
 */
export function developerWays(onOpenDoc: (name: DeveloperDoc) => void): readonly RailSheetItem[] {
  return [
    ...WAYS.slice(0, 2),
    /*
     * THE TWO DOCUMENTS SOMEBODY BUILDING AGAINST THIS ACTUALLY NEEDS, and
     * they open in the app rather than throwing the reader at GitHub.
     *
     * Rendered from the repository's own markdown through `/api/v1/doc`, so
     * nothing is restated here - a documentation screen that paraphrases its
     * own repository is a second source of truth waiting to disagree with the
     * first.
     */
    {
      id: 'contracts',
      label: 'Data contracts',
      note: 'the signed record and the canonical bytes',
      onSelect: () => {
        onOpenDoc('data-contracts');
      },
    },
    {
      id: 'taxonomy',
      label: 'Taxonomy',
      note: 'what we call things, and how to export it',
      onSelect: () => {
        onOpenDoc('taxonomy');
      },
    },
    ...WAYS.slice(2),
  ];
}
