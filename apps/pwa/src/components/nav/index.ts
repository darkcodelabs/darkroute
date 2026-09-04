/**
 * Navigation chrome that is not the dock.
 *
 * The dock answers "where else can I go"; this answers "how do I get out of
 * here", which is a different question and, until now, one that eight screens
 * had no answer to at all. See `BackKey.tsx` for why back is a named parent
 * rather than a history pop.
 *
 * `ReloadTitle.tsx` is the other half of the same header row: the screen's own
 * name, which reloads the page when it is pressed. DRIVE shipped that gesture
 * on its wordmark alone; this is the one implementation, and every v1 page
 * draws it.
 */

export { BACK_GLYPH, BACK_TO_MORE, BackKey, type BackKeyProps } from './BackKey.tsx';
export {
  RELOAD_PROMISE,
  ReloadTitle,
  reloadTitleLabel,
  type ReloadTitleProps,
} from './ReloadTitle.tsx';
