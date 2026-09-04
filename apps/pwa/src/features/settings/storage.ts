/**
 * What this device is holding, said out loud.
 *
 * SOURCE (the heading and the voice): `Flockys Watch.dc.html` `W12`, whose own
 * privacy card is titled `STAYS ON THE PHONE - SAID OUT LOUD, NOT HIDDEN`.
 * SOURCE (the promises): `Flockys Screens II.dc.html` `A1 · ONBOARDING -
 * PERMISSIONS` and `Flockys App Screens.dc.html` `03 · LOOKUP - PLATE HISTORY`.
 * Every sentence in {@link PRIVACY_PROMISES} is quoted from one of those three
 * panels, unedited.
 *
 * =============================================================================
 * THE LIST IS THE STORAGE CONTRACT, NOT A REASSURING SUMMARY
 * =============================================================================
 * Each row names a real object store from `services/db/schema.ts` and states
 * what the removal control does to it. The dispositions are read off the code
 * that actually runs, not off intent:
 *
 *   removed    `clearLocalData()` clears the store, or `destroyVault()` the key
 *              -- plateVault, plateMatches, alerts, trips, reportPhotos, the
 *              secret settings (including `plateVault.keyId`), and both
 *              non-exportable keys.
 *   kept       `pendingReports` + `reportChain`. Deliberate: "deleting one
 *              breaks the chain for every record after it" -- signed evidence
 *              the user chose to create is not shredded by a privacy button.
 *              Note the split with `reportPhotos` directly above: the signed
 *              body is KEPT and the photograph it names is REMOVED. A report is
 *              a link in the chain, a photograph is a leaf, and the digest the
 *              chain committed to survives in the payload either way -- so the
 *              picture can go without breaking anything. Two rows, because one
 *              row saying "reports" would have printed a single tag over two
 *              different answers.
 *              `docs/plate-data-handling.md#removal`.
 *   untouched  `cameraTiles`, `tileMeta`, `pendingActions`, `session`, and the
 *              non-secret settings. Public camera data and this screen's own
 *              preferences: nothing here is about the driver, and claiming to
 *              delete it would be padding the number.
 *
 * If somebody changes `clearLocalData()`, this list is wrong, and
 * `removal.test.ts` (this feature's, beside `removal.ts`) fails -- it asserts
 * the emptied stores against the repositories rather than against this file.
 * There is no `settings.test.ts` in this feature; `stores/settings.ts`'s test
 * of that name is a different file and asserts nothing about removal.
 */

/** What the one removal control does to a row. */
export type StoredDisposition = 'removed' | 'kept' | 'untouched';

export interface StoredItem {
  readonly id: string;
  /** The row heading. */
  readonly label: string;
  /** One lowercase sentence. Never a plate, never a coordinate, never a count. */
  readonly detail: string;
  readonly disposition: StoredDisposition;
}

/** The right-hand tag each disposition prints. */
export const DISPOSITION_TAGS: Readonly<Record<StoredDisposition, string>> = Object.freeze({
  removed: 'REMOVED',
  kept: 'KEPT',
  untouched: 'STAYS',
});

export const STORED_ITEMS: readonly StoredItem[] = Object.freeze([
  Object.freeze({
    id: 'plate-vault',
    label: 'PLATES YOU SAVED',
    detail: 'encrypted on this device. the key that reads them cannot be copied out.',
    disposition: 'removed',
  }),
  Object.freeze({
    id: 'plate-matches',
    label: 'PLATE MATCH INDEX',
    detail: 'a keyed index, not a hash. useless to anyone without the key.',
    disposition: 'removed',
  }),
  Object.freeze({
    id: 'trips',
    label: 'TRIP HISTORY',
    detail: 'where you drove, and when.',
    disposition: 'removed',
  }),
  Object.freeze({
    id: 'alerts',
    label: 'ALERT HISTORY',
    detail: 'every camera you passed - the muted ones count too.',
    disposition: 'removed',
  }),
  Object.freeze({
    id: 'report-photos',
    label: 'PHOTOS YOU ATTACHED',
    detail: 'the pictures you added to reports. the report keeps the digest, not the picture.',
    disposition: 'removed',
  }),
  Object.freeze({
    id: 'reports',
    label: 'SIGNED CAMERA REPORTS',
    detail: 'evidence you filed. each one commits to the one before it, so deleting one breaks the rest.',
    disposition: 'kept',
  }),
  Object.freeze({
    id: 'tiles',
    label: 'CACHED CAMERAS · MAP TILES',
    detail: 'public camera data. nothing here is about you.',
    disposition: 'untouched',
  }),
  Object.freeze({
    id: 'settings',
    label: 'THESE SETTINGS',
    detail: 'threshold, mode, toggles. no plate and no coordinate is ever written here.',
    disposition: 'untouched',
  }),
] as const satisfies readonly StoredItem[]);

/**
 * The three promises, quoted.
 *
 *   1. `A1 · ONBOARDING - PERMISSIONS`, the LOCATION card.
 *   2. `03 · LOOKUP - PLATE HISTORY`, the amber-ruled footer.
 *   3. `A1 · ONBOARDING - PERMISSIONS`, the line under START WATCHING.
 */
export const PRIVACY_PROMISES: readonly string[] = Object.freeze([
  'Coordinates never leave the phone unless you file a report.',
  'Plate never leaves this device. Matched against your own trip log - no Flock system is queried.',
  'no account · no analytics · GPL-3.0-only source',
]);

/** W12's card title, used here as the section heading it already is. */
export const PRIVACY_HEADING = 'STAYS ON THE PHONE - SAID OUT LOUD, NOT HIDDEN';
