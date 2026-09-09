/**
 * THE TOP BAR. Section A of `searchbar_and_buttons.dc.html`, and the search
 * that runs behind it.
 *
 * 56px of glass on a 999px pill: the mark hanging off the left cap, the
 * wordmark with the read count under it, a 1x24 rule, the field, and one key.
 * The spec page is a static rendering of exactly that markup at real size in
 * both themes, and this is a transcription of it.
 *
 * =============================================================================
 * WHAT SECTION A DRAWS, AND WHAT THE MOUNTED BAR ADDS TO IT
 * =============================================================================
 * The spec page is a PICTURE. Its field has no `value`, its wordmark is an
 * `<img>` and its count is two spans -- because a static rendering has nothing
 * to type into and nowhere to go. The bar this file draws is the one on the
 * road, and it carries the behaviour the old `SearchBar` carried, every piece
 * of it, on this markup:
 *
 *   THE FIELD          holds a query, searches the cameras ALREADY ON THE
 *                      PHONE through `searchCameras`, and opens THE SEARCH
 *                      ENTRY PANEL on what it found. Nothing about a query
 *                      leaves the device.
 *   THE ONE KEY OUT    `Start DarkRoute`, under the local results, is a PRESS
 *                      -- never a keystroke, never a blur, never an empty
 *                      local result -- and it says what it sends before it
 *                      sends it. Enter is the same press.
 *   THE CHEVRON        folds the bar AND reports the fold, so the screen can
 *                      take the rest of its chrome away with it.
 *   THE WORDMARK       reloads. In a PWA with no browser chrome it is the only
 *                      way to, and `components/nav/reloadTitle.source.test.ts`
 *                      holds every v1 screen to having one.
 *   THE COUNT          opens HOW THIS WORKS. A claim about how much of the
 *                      country is under a camera has to be able to hand over
 *                      the page that says where the claim came from.
 *   THE MARK           is section E's 72x72 target when a host wires it.
 *
 * EVERY ONE OF THOSE IS OPTIONAL EXCEPT THE FOLD AND THE FIELD. Hand this
 * component nothing but a `total` and it draws section A: an image, a reading,
 * a field and one key. That is not a courtesy to tests -- it is the same rule
 * the mark already followed, and it is why `TopBar.test.tsx` can still assert
 * the drawing without the app around it.
 *
 * THIS COMPONENT STILL DECIDES NOTHING IT DOES NOT OWN. It does not open a
 * screen, does not plan a route, does not know what a camera card is and does
 * not hold the fold's consequences. It owns the QUERY -- which is the bar's own
 * text, in the bar's own field -- and it reports every press.
 *
 * COLOUR AND GEOMETRY ARE NOT HERE. Not one hex, not one pixel. `topBar.css`
 * resolves section A's, `topBarLive.css` resolves what the mounted bar adds,
 * and `scripts/check-design-values.mjs` fails the build on a raw value in
 * either.
 *
 * =============================================================================
 * THE DROPDOWN IS GONE, AND THE PANEL IS WHAT REPLACED IT
 * =============================================================================
 * The bar used to hang a flat `role="listbox"` of places-then-cameras under
 * itself. `DarkRoute Search Entry.html` replaces that whole surface with a
 * 366 x 470 panel bottom-anchored to the phone: a field with the voice mic
 * inside it, a list where every row carries how many cameras are on the way
 * there, a hairline and a footer. `features/search/SearchPanel.tsx` is that
 * panel, it is ONE component that also serves the landscape left column, and
 * this bar is one of its hosts rather than its owner.
 *
 * WHAT STAYED ON THIS SIDE OF THE LINE. The query, the fold, the on-device
 * camera search and the ONE outbound press are still the bar's -- they are the
 * behaviour the old `SearchBar` carried and every sentence they draw is still
 * exported from this file. The bar hands the panel what it found and the panel
 * decides how a list of results is drawn.
 *
 * THE BAR STILL HAS ITS OWN FIELD, AND SO DOES THE PANEL. Both read and write
 * ONE query, so they are two views of one state rather than two states. The
 * spec's own portrait frame draws the panel over a map with NO bar above it and
 * never draws how a phone opens it, so how the two relate is undrawn; the bar
 * opening the panel on focus is the behaviour it already had, kept rather than
 * invented. Recorded in gap record search-panel.
 *
 * =============================================================================
 * WHAT THE BRIEF MOVED OUT, AND WHY THE RIGHT SIDE IS ONE KEY
 * =============================================================================
 * The old bar carried a light-mode toggle and a settings gear inside the
 * field. Both are gone from here and neither is replaced: they belong to the
 * rail now, on the brief's own argument -- a search field holds search
 * controls. What remains in `.fwm-topbar-keys` is the chevron, and it is one
 * key permanently: the CLEAR key is not in that group, it is drawn against the
 * field it clears, which is the thing it belongs to.
 *
 * =============================================================================
 * THE SWEEP AND THE MARK
 * =============================================================================
 * Section D mounts a sweep grid as this bar's first child; section E makes the
 * mark a target that fires a pulse and counts taps. Both arrive from
 * `useChromeSweep()` in the host -- `sweep` is rendered here at `z-index: 0`
 * and `onTapMark` is `tapMark`. The bar has NO `overflow: hidden`, so the mark
 * is not clipped, and every content child is `z-index: 1` above the grid
 * blending in `screen`, so the wordmark and the count stay legible mid-sweep.
 * See section 2 of `topBar.css`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement, RefObject } from 'react';

import { ReloadTitle } from '../../components/nav';
import { useCachedCameras } from '../../stores/index.ts';
import { archiveAgeLabel, archiveFreshness } from '../../services/cameras/useCatalogueUpstream.ts';
import type { ArchiveFreshness } from '../../services/cameras/useCatalogueUpstream.ts';
import { formatCacheCount } from '../offline/format.ts';
import { searchCameras } from '../lookup/search.ts';
import { useSearchAnchor } from '../search/anchor.ts';
import { estimateKey, estimatePlaces } from '../../services/route/estimates.ts';
import type { PlaceEstimate } from '../../services/route/estimates.ts';
import { SEARCH_VOICE, SearchPanel } from '../search/SearchPanel.tsx';
import { ChromeIcon } from './icons.tsx';
import { currentMap } from '../map/mapRegistry.ts';
import { EMPTY_BOOK } from '../search/places.ts';
import { dismissSearch, raiseSearch, setSearchFocused, useSearchRaise } from '../search/searchRaise.ts';
import { useSearchPortal } from '../search/useSearchPortal.ts';
import { useLandscapePanelHeight } from '../search/keyboard.ts';
import { useSurface } from '../../app/useSurface.ts';
import { RouteRefused, findPlaces } from '../../services/route/planRoute.ts';
import type { CountLookup, EstimateLookup, RouteOption, RouteOptionKind } from '../search/panel.ts';
import type { PlaceBook } from '../search/places.ts';
import type { SearchOrientation } from '../search/SearchPanel.tsx';
import type { Place } from '../../services/route/planRoute.ts';

import './topBar.css';
import './topBarLive.css';

/**
 * THE FIELD'S PROMPT, and the only sentence this bar renders.
 *
 * "Search address, street or camera" -- the spec's own string. It is also the
 * field's accessible name: there is no visible label to point at, and a search
 * field whose only name is its placeholder is one a screen reader announces as
 * "edit text, blank" the moment somebody starts typing.
 */
export const TOPBAR_PLACEHOLDER = 'Search address, street or camera';
/** The prompt while SET HOME / SET WORK waits for a place to be picked. */
export const TOPBAR_SAVE_HOME = 'Type your home address, then pick it';
export const TOPBAR_SAVE_WORK = 'Type your work address, then pick it';
/** The name a dropped pin gets. Its detail line is the coordinate. */
export const TOPBAR_DROPPED_PIN = 'Dropped pin';

/** The wordmark's alt text. The artwork reads "darkroute"; the product is `darkroute.ai`. */
export const TOPBAR_WORDMARK = 'darkroute.ai';

/**
 * THE CHEVRON'S NAME, AND THE ONE THING SECTION A DOES NOT SAY.
 *
 * The brief states what the right side HOLDS -- "only the chevron" -- and never
 * what it does. The old bar had exactly one chevron and it folded the bar away,
 * with these words already written for it, so that is what it is wired to here.
 * The second string is the old bar's own `SEARCH_EXPAND`, character for
 * character: folded, the key says how to come back rather than repeating how to
 * go away.
 */
export const TOPBAR_FOLD = 'Hide the search bar';
export const TOPBAR_UNFOLD = 'Show the search bar';

/** THE MARK, WHEN IT IS A TARGET. Section E's tap counter, and its name. */
export const TOPBAR_MARK = 'darkroute.ai';

/** The old bar's words, carried over unchanged. Two surfaces, one sentence. */
export const TOPBAR_CLEAR = 'Clear';
export const TOPBAR_EMPTY =
  'no reader in the tiles this phone has loaded. zoom into an area to load it.';
export const TOPBAR_LOOK_UP = 'Start DarkRoute';
export const TOPBAR_LOOK_UP_NOTE =
  'any place - an address, a business, a town. sends only what you typed, through darkroute.ai';
export const TOPBAR_LOOKING = 'Looking…';

/** How long the typing has to stop before the term is sent. */
export const LOOKUP_DEBOUNCE_MS = 450;
/** Below this, a term is the first half of a word rather than a query. */
export const LOOKUP_MIN_CHARS = 3;
export const TOPBAR_NO_PLACE = 'no place found by that name.';
/* `TOPBAR_RESULTS` is gone with the listbox it named. The panel draws the list
   now and `SEARCH_RESULTS` in `features/search/SearchPanel.tsx` is its name --
   one string for one control, rather than a host still publishing a word for a
   thing it no longer renders. */

/**
 * THE ARCHIVE'S AGE, IN WORDS, FOR THE COUNT'S ACCESSIBLE NAME.
 *
 * The dot says this in colour and a colour has no text alternative. "Live" on
 * its own is not enough either: the whole reason this reading exists is that
 * the app served a six-day-old archive under a confident number, so the name
 * carries the STATE and the AGE together -- `archiveAgeLabel` supplies the age
 * and this supplies the verdict beside it.
 *
 * `unknown` says so rather than borrowing a severity. A phone that has never
 * reached the network does not know how old its archive is, and announcing
 * "stale" would be asserting a measurement nobody took.
 *
 * These are the old bar's four strings, character for character. The reading
 * moved surfaces; it did not change its mind.
 */
export const TOPBAR_ARCHIVE_STATE: Readonly<Record<ArchiveFreshness, string>> = {
  live: 'archive live',
  behind: 'archive behind',
  stale: 'archive stale',
  unknown: 'archive age unknown',
};
/** What the count is counting, and what pressing it does. */
export const TOPBAR_COUNT_UNIT = 'cameras watched';
export const TOPBAR_COUNT_UNKNOWN = 'camera count unknown';
export const TOPBAR_COUNT_ACTION = 'how this works';

/**
 * `139,918 cameras watched, archive live, updated 4 hours ago - how this works`
 *
 * Built here rather than assembled in the markup so the one string a
 * screen-reader user hears is testable without a render, and so the four
 * freshness states cannot drift into four differently-shaped sentences.
 */
export function topBarCountLabel(
  total: number | null,
  freshness: ArchiveFreshness,
  ageLabel: string | null,
): string {
  const counted =
    total === null ? TOPBAR_COUNT_UNKNOWN : `${formatCacheCount(total)} ${TOPBAR_COUNT_UNIT}`;
  const age = ageLabel === null ? '' : `, updated ${ageLabel}`;
  return `${counted}, ${TOPBAR_ARCHIVE_STATE[freshness]}${age} - ${TOPBAR_COUNT_ACTION}`;
}

/** The two brand files, which live in `/brand/` and deliberately not in `/assets/`. */
/**
 * EXPORTED, AND THAT IS THE WHOLE DIFF TO THIS FILE.
 *
 * The landscape left rail draws the same 42px mark at the top of its column --
 * "Logo only, 42 px, at the top of the tab rail", section B of
 * `DarkRoute Landscape Mode.html`. It takes the path from here rather than
 * spelling `/brand/darkroute-logo.png` a second time, because two spellings of
 * an asset path is how one surface keeps the old artwork after a rebrand.
 *
 * NOTHING ABOUT THIS BAR'S APPEARANCE CHANGES. The 56px height, the 999 radius,
 * the glass, the hairline, the lit edge, the `0 8px 0 64px` padding, the
 * overhanging mark, the 86x15 wordmark, the read count, the divider, the
 * placeholder, the three trailing keys and the pixel sweeps are untouched. The
 * bar is not rendered on the landscape surface at all -- see `drive.css` -- and
 * that is a mount decision made outside this component, deliberately.
 */
export const MARK_SRC = '/brand/darkroute-logo.png';
/*
 * THE SAME MARK WITH DARK LINE WORK, for the pale skins.
 *
 * The burst is identical - same 1312x1312 artwork, same crop, same magenta and
 * cyan - and only the diamond and the eye change from white to a near-black
 * grey. So this swaps without moving a pixel of the glow, which is why it is a
 * second file rather than a filter: `invert()` or a `mix-blend-mode` would take
 * the burst with it and the mark is the one thing on the bar that must not
 * change colour between themes.
 *
 * It already existed and was wired to nothing. Referenced where it lives rather
 * than copied next to its pair: `check-design-values.mjs` requires every image
 * under `public/brand/` to derive from one of two named masters, and this one
 * derives from the app icon. The gate is right - a brand directory anybody can
 * drop a PNG into is a brand directory that drifts - so the file stays put.
 */
const MARK_SRC_LIGHT = '/assets/darkroute-app-icon-light.png';
const WORDMARK_SRC = '/brand/darkroute-wordmark.png';

/** The chevron, at the spec's own size. 19px inside a 36px target. */
const CHEVRON_PX = 19;

/** How many hits the sheet shows. Enough to choose from, few enough to read. */
const MAX_HITS = 8;

export interface TopBarProps {
  /**
   * HOW MANY CAMERAS THE PUBLISHED ARCHIVE HOLDS -- the `139,918` the spec
   * draws under the wordmark.
   *
   * Passed in rather than read here, for the reason the old bar's own prop
   * carries: a component that fetches its own numbers is one a test cannot put
   * into the state it needs to check. `null` is a count that has not been read
   * yet, and it prints as the repository's own no-value dash rather than as a
   * confident zero.
   */
  readonly total: number | null;
  /**
   * WHEN THE COUNT WAS TRUE -- the published archive's own timestamp, or null
   * when this phone has never reached the network.
   *
   * The dot beside the number says how old the archive behind it is, and the
   * count's accessible name says it in words. The dot being the wrong colour on
   * a stale archive is the bug this whole reading exists to prevent, and being
   * able to hand this component a six-day-old timestamp is how that stays
   * checked. Read at render rather than held: the age is a function of the
   * clock, and the clock is not a store anything can subscribe to.
   */
  readonly upstream?: string | null | undefined;
  /**
   * The chevron was pressed, and the bar is now folded or not.
   *
   * The fold state stays owned HERE -- it is the bar's own control and the bar
   * is the only thing that can be folded -- but folding is not just about the
   * bar: the owner wants the map rail, the chips and the dock to go with it,
   * so one press clears everything off the map. Reported rather than lifted,
   * because a parent holding this state would have to hand it straight back
   * for the chevron to draw.
   */
  readonly onFoldChange?: ((folded: boolean) => void) | undefined;
  /**
   * The chevron was pressed, without the state.
   *
   * Section A's own callback, kept because a host that only wants to know THAT
   * the key was pressed should not have to read a boolean it will not use.
   * Both fire; neither replaces the other.
   */
  readonly onFold?: (() => void) | undefined;
  /** Where the driver is, so hits can be ordered by distance. */
  readonly at?: { readonly lat: number; readonly lon: number } | null | undefined;
  /** Open a camera's card. Owned by the screen, like every other navigation. */
  readonly onPick?: ((cameraId: string) => void) | undefined;
  /**
   * Set a destination. The bar does not plan a route - that is the host's
   * press - it only says where the driver said they were going.
   */
  readonly onDestination?: ((place: Place, option: RouteOptionKind | null) => void) | undefined;
  /**
   * Open HOW THIS WORKS. When it is given the count becomes a control; when it
   * is not, the count is the reading section A draws and nothing more.
   */
  readonly onHowItWorks?: (() => void) | undefined;
  /**
   * The mark was tapped. Section E's pulse and tap counter, from
   * `useChromeSweep().tapMark`.
   *
   * Given, the mark acquires a 72x72 button UNDER the artwork -- the image
   * itself stays `pointer-events: none` and `aria-hidden`, which is what
   * section A draws, and the target is a sibling rather than a wrapper. Not
   * given, there is no target: making the mark one is an addition, and the
   * section that adds it says so.
   */
  readonly onTapMark?: (() => void) | undefined;
  /**
   * Whether a pale skin is on, so the mark can draw its dark-line variant.
   * Absent means dark, which is the bar the spec was measured against.
   */
  readonly light?: boolean | undefined;
  /**
   * SECTION D'S GRID, from `useChromeSweep().sweep`, rendered as this bar's
   * FIRST child at `z-index: 0`.
   */
  readonly sweep?: ReactElement | null | undefined;
  /**
   * THE RESULTS SHEET IS OPEN, or has just shut.
   *
   * The sheet is positioned from the bar and overlaps whatever the host draws
   * under it -- on DRIVE, the chip row. The host cannot see this state and the
   * bar will not reach out and hide somebody else's controls, so it is
   * reported and the host decides.
   */
  readonly onSearchingChange?: ((searching: boolean) => void) | undefined;
  /** The field, so a host can hand focus to it. */
  readonly fieldRef?: RefObject<HTMLInputElement | null> | undefined;

  /* ---------------------------------------------------------------------
   * THE PANEL'S OWN PROPS, PASSED STRAIGHT THROUGH
   *
   * Not re-decided here. The bar is a HOST of `SearchPanel`, and a host that
   * reinterprets its guest's props is a second implementation of it -- which
   * is the failure "one component, both orientations" exists to prevent. Every
   * one of these is optional, and with none of them supplied the panel draws
   * what the old dropdown drew: the cameras on this phone, the one outbound
   * key, and a destination that starts a drive the moment it is chosen.
   * ------------------------------------------------------------------ */

  /** Saved places and recents. Empty is the first-run book, not an error. */
  readonly book?: PlaceBook | undefined;
  /** How many cameras are on the way to a place. Absent means "not measured". */
  readonly counts?: CountLookup | undefined;
  /** The rows the panel could not count, so a host can go and measure them. */
  readonly onCountsNeeded?: ((places: readonly Place[]) => void) | undefined;
  /**
   * The route options for the picked destination, or null while they are being
   * planned. Absent entirely means this host offers no route PREVIEW and a
   * chosen destination starts a drive, which is what the app did before.
   */
  readonly routes?: readonly RouteOption[] | null | undefined;
  /** A destination was chosen and the panel is previewing routes. */
  readonly onPicked?: ((place: Place | null) => void) | undefined;
  /**
   * WRITE THIS PLACE TO HISTORY. Fired from the panel's route-start transition
   * and from nowhere else, exactly once. Searching writes nothing; looking at
   * three options and closing writes nothing.
   */
  readonly onRemember?: ((place: Place) => void) | undefined;
  /** Portrait bottom-anchors; landscape fills the left column. */
  readonly orientation?: SearchOrientation | undefined;
  /** The soft keyboard is up, and the chrome yields to it. */
  readonly keyboard?: boolean | undefined;
  /** Speak a destination. Unwired, the mic is still drawn -- voice is a peer. */
  readonly onVoice?: (() => void) | undefined;
  readonly onDropPin?: (() => void) | undefined;
  readonly onSetSaved?: ((kind: 'home' | 'work') => void) | undefined;
  /** Forget one recent, by its id. Section C's long-press. */
  readonly onForget?: ((placeId: string) => void) | undefined;
  /** A place picked while SET HOME / SET WORK was pending. Saves it, routes nowhere. */
  readonly onSaveAs?: ((place: Place, kind: 'home' | 'work') => void) | undefined;
}

/*
 * VOICE IS A PEER, NOT A FALLBACK -- and now it is a control.
 *
 * `DarkRoute Search Entry.html`, E. RULES: "The mic sits inside the field at
 * full accent, same size as the search glyph. Matching happens on the phone
 * against the local place list." The RECOGNISER is the platform's -- the Web
 * Speech API, which on Android Chrome hands the audio to the phone's own
 * speech service -- and the MATCHING is this bar's: what is heard lands in
 * the field as typed text, filters the places and cameras already on the
 * phone, and goes to the geocoder only when the driver presses Look up,
 * exactly like a typed query. Nothing is sent by this application on a mic
 * press except what the platform's recogniser sends on the driver's behalf,
 * and the press is the consent. Where the platform has no recogniser the mic
 * stays a drawing, as it always was.
 */
interface SpeechRecogniser {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult:
    | ((event: { readonly results: ArrayLike<ArrayLike<{ readonly transcript: string }>> }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SpeechRecogniserCtor = new () => SpeechRecogniser;

function speechRecogniserCtor(): SpeechRecogniserCtor | undefined {
  const scope = globalThis as unknown as {
    readonly SpeechRecognition?: SpeechRecogniserCtor;
    readonly webkitSpeechRecognition?: SpeechRecogniserCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/** Whether this platform can turn speech into a query at all. */
export function hasSpeechRecognition(): boolean {
  return speechRecogniserCtor() !== undefined;
}

export function TopBar({
  total,
  upstream = null,
  onFoldChange,
  onFold,
  at = null,
  onPick,
  onDestination,
  onHowItWorks,
  onTapMark,
  light,
  sweep,
  onSearchingChange,
  fieldRef,
  book = EMPTY_BOOK,
  counts,
  onCountsNeeded,
  routes,
  onPicked,
  onRemember,
  orientation,
  keyboard,
  onVoice,
  onDropPin,
  onSetSaved,
  onForget,
  onSaveAs,
}: TopBarProps): ReactElement {
  const [query, setQuery] = useState('');
  /*
   * OPEN IS NOT LOCAL STATE ANY MORE, and that is the seam.
   *
   * The panel has two openers in two different subtrees -- this bar's field in
   * portrait, and the top right-rail button in landscape, which section D of
   * the landscape spec makes the opener there: "Search becomes the first
   * right-rail button and opens the destination panel in section A4."
   * `features/search/searchRaise.ts` argues the arrangement in full.
   *
   * The bar stays the panel's only HOST -- it still owns the query, the book,
   * the hits and the lookup -- so there is still exactly one search component.
   * What moved out is one boolean that two unrelated places have to agree
   * about, and it moved to the only shape that lets them: a shared
   * subscription, the same one `app/useSurface.ts` uses for the surface.
   */
  const raise = useSearchRaise();
  const open = raise.raised;
  /*
   * COLLAPSED, and it starts expanded.
   *
   * The bar covers the top of the map, and on a phone that strip is where the
   * road you are about to reach is drawn. The chevron gives it back without
   * costing the driver the bar entirely - it folds to the mark, which is still
   * the way back. Local state, not a setting: this is a gesture about the next
   * thirty seconds, not a preference.
   */
  const [folded, setFolded] = useState(false);
  /*
   * The place lookup's state. `null` means it has not been asked - which is the
   * state it is in for every query nobody presses the key on, which is most of
   * them.
   */
  const [places, setPlaces] = useState<readonly Place[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  /*
   * THE TERM THE LAST REQUEST WAS MADE FOR. Read by the debounce below so a
   * re-render, a new fix or a rotation cannot re-ask a question whose answer
   * is still on screen. Declared beside `places` because the two are one
   * fact: this is the question, that is the answer.
   */
  const askedRef = useRef<string>('');
  /*
   * THROWING THE ANSWER AWAY FORGETS THE QUESTION, in the same breath.
   *
   * FOUND BY PRESSING IT. Type `Oak Park`, get a place, press CLEAR, type
   * `Oak Park` again: nothing. The clear key had emptied `places` and the
   * debounce then refused to send the term because `askedRef` still held it -
   * so the panel sat on "no reader in the tiles this phone has loaded" and the
   * one key under it, for a query the app had answered thirty seconds earlier.
   * Every site that discarded the answer had the same hole; four of them
   * called `setPlaces(null)` and none of them cleared the memory of asking.
   *
   * So there is one way to discard, and it clears both. The once-per-term rule
   * is unchanged where it was written for: a re-render, a fix or a rotation
   * discards nothing and asks nothing. What changes is that a driver who threw
   * an answer away can ask the question again, which is what a clear key is.
   */
  const forgetPlaces = useCallback((): void => {
    setPlaces(null);
    setLookupError(null);
    askedRef.current = '';
  }, []);
  const cameras = useCachedCameras();

  /**
   * THE ONE OUTBOUND CALL, in one place so both ways in reach the same code.
   *
   * "How do I start navigating" was the question this bar could not answer:
   * the lookup lived only inside a key at the bottom of the results sheet, and
   * pressing Enter - which is what everybody does in a search field - did
   * nothing at all. Enter is the gesture; the key is the disclosure.
   */
  const lookUpRef = useRef<() => void>(() => undefined);
  const lookUp = (): void => {
    const term = query.trim();
    if (term === '' || looking) return;
    setLooking(true);
    setLookupError(null);
    findPlaces(term, at)
      .then((found) => {
        setPlaces(found);
      })
      .catch((cause: unknown) => {
        // The endpoint's own sentence. It distinguishes "could not be reached"
        // from "answered 502", and only one is worth trying again in a moment.
        setLookupError(
          cause instanceof RouteRefused ? cause.message : 'that place could not be looked up.',
        );
      })
      .finally(() => {
        setLooking(false);
      });
  };
  /* THE LATEST ONE, FOR THE DEBOUNCE BELOW. `lookUp` closes over `query`, `at`
     and `looking`, so it is a new function every render; the timer has to call
     the CURRENT one when it fires and must not be re-armed because the previous
     one went stale. */
  lookUpRef.current = lookUp;

  const hits = useMemo(() => {
    if (query.trim() === '') return [];
    return searchCameras({ cameras, query, ownerType: null, at }).slice(0, MAX_HITS);
  }, [cameras, query, at]);


  /*
   * READ AT RENDER, NOT HELD IN STATE.
   *
   * The age is a function of the clock, and the clock is not a store anything
   * can subscribe to. It is recomputed whenever this bar draws, which is every
   * time the catalogue announces, every keystroke and every fold - often enough
   * that a dot cannot sit at `live` for hours after the archive left the live
   * window. It is deliberately NOT on a timer: a repaint per minute over a live
   * GL map, to move a threshold six hours wide, is a cost with nothing behind
   * it.
   */
  const freshness = archiveFreshness(upstream);
  const ageLabel = archiveAgeLabel(upstream);

  /*
   * THE PANEL IS UP WHENEVER THE FIELD IS LIVE, AND NOT ONLY ONCE SOMETHING IS
   * TYPED.
   *
   * The dropdown this replaced needed a query -- it had nothing else to show.
   * The panel opens TO PLACES: "most trips are somewhere the user has already
   * been, so the panel's job on open is to show those", and a panel that waits
   * for a keystroke before offering Home is one that has made the common case
   * the slow one. One expression, read by the markup below and reported to the
   * host so it can take its own chrome out of the way.
   */
  /*
   * WHICH ORIENTATION THE PANEL IS DRAWN IN, and it is DERIVED rather than
   * asked for.
   *
   * `app/surface.ts` is the one place in this application allowed to decide
   * what layout we are on -- its header forbids any stylesheet selecting on a
   * bare width or orientation query -- and a phone turned sideways already
   * resolves to `dash` there. Reading the same answer keeps the panel's
   * orientation and the chrome's layout from disagreeing for the one frame
   * after a rotation that a prop threaded down through DRIVE would cost.
   *
   * The prop survives as an OVERRIDE so a test can draw either orientation
   * without a media query, and so a host with a reason can force one.
   */
  const surface = useSurface();
  const orient: SearchOrientation =
    orientation ?? (surface === 'dash' ? 'landscape' : 'portrait');

  /*
   * TYPING LOOKS THE PLACE UP, ONCE THE TYPING STOPS.
   *
   * REPORTED AS A REGRESSION AND IT IS ONE, EVEN THOUGH THE CODE DID WHAT IT
   * ALWAYS DID: "these used to produce results". Typing `Walmart` produced a
   * sentence saying no reader on this phone matches, a key, and nothing else,
   * because the lookup only ever fired from Enter or from a press -- and on a
   * phone nobody presses Enter, and the key reads like a way to start driving
   * rather than like the search it is. The old bar got away with it because its
   * sheet was a thin list under a field; the panel is the whole surface, so the
   * empty one is now the entire answer to a question the driver asked.
   *
   * THE PRIVACY RULE IS UNCHANGED AND IS THE REASON FOR EVERY CONDITION BELOW.
   * `planRoute.findPlaces` sends the typed term to darkroute.ai; nothing else
   * about the phone goes with it beyond the coarse `near` bias, and the footer
   * says so on the panel that is showing while it happens. What changes is WHEN
   * it is sent, so these are the limits:
   *
   *   - the panel must be OPEN. A folded bar with a stale query sends nothing.
   *   - THREE CHARACTERS, because one and two match everything and are usually
   *     the first half of a word somebody is still typing.
   *   - 450ms AFTER THE LAST KEYSTROKE, so a typed word is one request rather
   *     than one per letter.
   *   - ONCE PER TERM WHILE THE ANSWER IS HELD. `askedRef` holds the term the
   *     request was made for, so a re-render, a new fix or a rotation cannot
   *     re-ask the same question. Discarding the answer - the clear key, a
   *     keystroke, a chosen row - clears it too; see `forgetPlaces`.
   *   - and it never fires while one is in flight.
   *
   * ENTER AND THE KEY BOTH STILL WORK, unchanged: they are the way to ask
   * before the pause is up, and the key is what a driver who has waited and
   * seen nothing presses. Neither is now the only way to get an answer.
   */
  useEffect(() => {
    const term = query.trim();
    /* PORTRAIT ONLY, AND THAT IS A PRIVACY BOUNDARY RATHER THAN A LAYOUT ONE.
       The regression this answers is portrait's: the bar is the only field, a
       phone keyboard has no Enter anybody presses, and the panel's whole
       surface was answering a question with a shrug. Landscape has none of
       that -- the panel owns a real field with the lookup key under it -- and
       the owner's rule for that surface is that it does not change. An
       unprompted request there would be a term leaving the device on a surface
       where nobody asked for that, which is the one kind of change that cannot
       be undone by reverting the commit. Caught by an adversarial verifier
       that executed both branches rather than reading them. */
    if (orient === 'landscape') return undefined;
    if (!open || folded || term.length < LOOKUP_MIN_CHARS) return undefined;
    if (askedRef.current === term) return undefined;
    const timer = setTimeout(() => {
      askedRef.current = term;
      lookUpRef.current();
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, open, folded, orient]);

  /*
   * THE KEYBOARD IS UP BECAUSE THE FIELD HAS FOCUS, and for no other reason.
   * `features/search/keyboard.ts` sets out why this is not measured from the
   * visual viewport: a viewport shrinks for a soft keyboard and it also shrinks
   * for a collapsing address bar, and the pixel count that separates them is a
   * constant nobody has measured and neither spec contains.
   */
  const keyboardUp = keyboard ?? raise.focused;

  /*
   * THE FOLD BELONGS TO THE BAR, AND IN LANDSCAPE THERE IS NO BAR.
   *
   * `drive.css` takes `.fwm-drive-top` away entirely on that surface -- "A 56px
   * bar spanning 940px is all dead space" -- so there is no chevron to press
   * and nothing that could have been folded. Left as it was, a fold made in
   * portrait would have travelled through a rotation and quietly refused the
   * right-rail button, which is the only opener landscape has.
   */
  const barFolded = orient === 'landscape' ? false : folded;
  const searching = !barFolded && open;

  /* Where the panel's elements are parented. See the note on `panel` below. */
  const portalHost = useSearchPortal();

  /*
   * THE FIELD THAT ACTUALLY GETS FOCUSED, WHICH IS THE PANEL'S AND NOT THE BAR'S.
   *
   * This was a real hole, found in the browser rather than in a test: in
   * LANDSCAPE the bar does not exist -- `drive.css` takes `.fwm-drive-top` away
   * on that surface -- so the bar's own `onFocus` can never fire there. The
   * panel is opened by the right-rail button and the only input on the screen
   * is the 46px field the panel draws. Nothing was reporting focus on it, so
   * the chrome never yielded and the keyboard would have covered the bottom of
   * the panel, the right rail and four of the five tabs.
   *
   * A REF AND TWO LISTENERS RATHER THAN A WRAPPER ELEMENT. `SearchPanel`
   * already publishes `fieldRef` for exactly this kind of hand-off, and a
   * wrapping div inside the portal would have become a box between the
   * container and a `position: fixed` panel -- one `transform` away from being
   * the containing block the portal exists to avoid.
   *
   * `focus`/`blur` and not their bubbling forms: this is one element, and the
   * capture-phase variants would also catch focus moving between rows.
   */
  /*
   * THE BAR'S OWN BOX, MEASURED, BECAUSE THE PORTRAIT PANEL HANGS FROM IT.
   *
   * "The panel hangs from the bar. It is a dropdown, not a bottom sheet" --
   * owner, 2026-09-08. `features/search/anchor.ts` argues why the position is
   * measured off this element rather than summed from the tokens it is laid out
   * with, and publishes the three numbers the stylesheet reads.
   *
   * ONLY WHILE THE PANEL IS OPEN AND ONLY IN PORTRAIT. Landscape has no bar to
   * hang from -- the panel anchors to the left column there, unchanged -- and a
   * shut panel has nothing to position.
   */
  /*
   * THE ROWS' OWN NUMBERS, MEASURED HERE, BECAUSE NOTHING ELSE WAS DOING IT.
   *
   * `DarkRoute Search Entry.html` draws '14 min · 7.2 mi' and '2 cams' on every
   * destination row. `SearchPanel` has always published which rows nobody has
   * measured -- `onCountsNeeded` -- and both that callback and `counts` are
   * OPTIONAL props that no host ever supplied, so every row on production drew
   * the place's address and a dash.
   *
   * IT IS ANSWERED HERE RATHER THAN IN `DriveScreen` because everything the
   * answer needs is already in this component: the position it takes as `at`,
   * and the archive it already reads for on-device hits. Pushing it a level up
   * would thread two props through a screen that has no use for either.
   *
   * The host's own `onCountsNeeded` is still called if it passes one -- this
   * adds an answer, it does not take the question away.
   */
  const [estimates, setEstimates] = useState<ReadonlyMap<string, PlaceEstimate>>(new Map());
  const askRef = useRef<AbortController | null>(null);
  const measure = useCallback(
    (places: readonly Place[]) => {
      onCountsNeeded?.(places);
      /* NO POSITION, NO ORIGIN, NO REQUEST. A search with no fix is still a
         search: the rows keep their locality and their dash. */
      if (at === null || places.length === 0) return;
      askRef.current?.abort();
      const controller = new AbortController();
      askRef.current = controller;
      void estimatePlaces({
        from: { lat: at.lat, lon: at.lon },
        places,
        cameras,
        signal: controller.signal,
      }).then((measured) => {
        if (controller.signal.aborted || measured.size === 0) return;
        /* MERGED, NOT REPLACED. A second keystroke asks about different rows,
           and the ones already paid for should not go back to a dash. */
        setEstimates((held) => new Map([...held, ...measured]));
      });
    },
    [at, cameras, onCountsNeeded],
  );
  useEffect(() => () => askRef.current?.abort(), []);

  /* The two lookups the panel takes, both reading the one map. A place the
     host supplied a count for wins, because a host that measured something
     knows something this component does not. */
  const rowCounts = useCallback<CountLookup>(
    (place) => {
      const supplied = counts?.(place);
      if (supplied !== undefined && supplied.state === 'known') return supplied;
      const measured = estimates.get(estimateKey(place));
      return measured === undefined
        ? { state: 'unknown' }
        : { state: 'known', cams: measured.cameras };
    },
    [counts, estimates],
  );
  const rowEstimates = useCallback<EstimateLookup>(
    (place) => {
      const measured = estimates.get(estimateKey(place));
      return measured === undefined
        ? null
        : { minutes: measured.minutes, miles: measured.miles };
    },
    [estimates],
  );

  const barRef = useRef<HTMLDivElement | null>(null);
  useSearchAnchor(searching && orient !== 'landscape', barRef);

  /*
   * A TAP ANYWHERE ELSE SHUTS THE DROPDOWN.
   *
   * "There is no way to close this if you accidentally open it. Just allow
   * clicking out of it to close it" -- owner, 2026-09-09. The portrait panel is
   * a dropdown hung from the bar and a dropdown has no close key of its own:
   * the bar's field opens it on a press, the clear key only exists once there
   * is a query, and the chevron folds the whole bar. A press that landed on the
   * map opened nothing and closed nothing.
   *
   * CAPTURE PHASE ON THE DOCUMENT, because the thing under the press is very
   * often the map canvas, and MapLibre stops the events it handles before they
   * bubble. Capture runs first regardless.
   *
   * INSIDE THE BAR OR THE PANEL, NOTHING HAPPENS: the field is where the query
   * is typed and the panel is what is being chosen from. PORTRAIT ONLY, because
   * landscape's panel is opened and shut by the right-rail key and the owner's
   * rule for that surface is that it does not change.
   */
  useEffect(() => {
    if (!searching || orient === 'landscape') return undefined;
    const outside = (event: PointerEvent): void => {
      const target = event.target;
      const element =
        target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      if (element === null) return;
      if (barRef.current?.contains(element) === true) return;
      if (element.closest('.fwm-search-panel') !== null) return;
      dismissSearch();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [searching, orient]);

  const panelFieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const field = panelFieldRef.current;
    if (field === null) return undefined;
    const took = (): void => {
      setSearchFocused(true);
    };
    const lost = (): void => {
      setSearchFocused(false);
    };
    field.addEventListener('focus', took);
    field.addEventListener('blur', lost);
    /* It can already be focused by the time this runs -- a rotation re-parents
       nothing but does re-run effects, and the caret is meant to survive. */
    if (document.activeElement === field) setSearchFocused(true);
    return () => {
      field.removeEventListener('focus', took);
      field.removeEventListener('blur', lost);
      /* The panel went while the field still had focus. Leaving the flag set
         would strand the landscape chrome hidden behind a keyboard that is no
         longer there. */
      setSearchFocused(false);
    };
  }, [searching]);

  /*
   * AND HOW TALL IT IS WHILE A LANDSCAPE KEYBOARD IS OVER IT.
   *
   * The one state in this layout with no inset to derive a height from: the
   * panel's bottom edge is decided by the keyboard rather than by the frame.
   * `keyboard.ts` measures the visible viewport and publishes the answer, with
   * the spec's drawn 218 as the fallback -- 200 is what ONE keyboard on ONE
   * device reserves, and a panel pinned to 218 under a 260px keyboard has its
   * last rows underneath it.
   */
  useLandscapePanelHeight(orient === 'landscape' && keyboardUp);

  /* REPORTED IN AN EFFECT, not from the handlers. Four different presses can
     change it -- typing, clearing, folding, choosing a row -- and a callback
     fired from each of them is four places for the fifth to be forgotten. */
  useEffect(() => {
    onSearchingChange?.(searching);
  }, [searching, onSearchingChange]);

  /*
   * THE PANEL, BUILT HERE AND PARENTED SOMEWHERE ELSE.
   *
   * `features/search/useSearchPortal.ts` argues the reparenting in full; the
   * short version is that two correct rules about the landscape surface -- the
   * `display: none` that takes this bar away, and the `backdrop-filter` on the
   * screen that would capture a `position: fixed` child -- are both fatal to an
   * element that has to be fixed to the viewport and visible while its host is
   * hidden. Moving the ELEMENTS out while the STATE stays here is what makes a
   * rotation a reflow instead of a remount, and it is the only arrangement that
   * keeps the caret, the scroll offset and focus across one.
   *
   * A NODE RATHER THAN A SECOND COMPONENT. It is the same element either way,
   * so React reconciles it as one instance whichever branch renders it, and
   * nothing below is a fallback that draws something different.
   */
  /*
   * SECTION C AND E OF THE SEARCH SPEC, WIRED. Voice, the dropped pin and
   * SET HOME / SET WORK were drawn and not wired ("the mic is still drawn");
   * the host may still supply its own handler for any of them, and these are
   * what run when it does not.
   */
  const [pendingSave, setPendingSave] = useState<'home' | 'work' | null>(null);
  const recogniserRef = useRef<SpeechRecogniser | null>(null);
  const speak = useCallback((): void => {
    recogniserRef.current?.abort();
    const Ctor = speechRecogniserCtor();
    if (Ctor === undefined) return;
    const recogniser = new Ctor();
    recogniserRef.current = recogniser;
    recogniser.lang = navigator.language;
    recogniser.interimResults = false;
    recogniser.maxAlternatives = 1;
    recogniser.continuous = false;
    recogniser.onresult = (event) => {
      const heard = event.results[0]?.[0]?.transcript.trim() ?? '';
      if (heard === '') return;
      setQuery(heard);
      forgetPlaces();
      raiseSearch();
    };
    const settle = (): void => {
      if (recogniserRef.current === recogniser) recogniserRef.current = null;
    };
    recogniser.onend = settle;
    recogniser.onerror = settle;
    recogniser.start();
  }, [forgetPlaces]);
  useEffect(() => () => recogniserRef.current?.abort(), []);
  const voice = onVoice ?? (hasSpeechRecognition() ? speak : undefined);

  /* DROP A PIN: the map's centre becomes the destination. The driver panned
     the map to that spot, which is the pointing this key names; a route to it
     starts like any other and is remembered like any other. */
  const dropPin = (): void => {
    const map = currentMap();
    if (map === null) return;
    const centre = map.getCenter();
    const place: Place = {
      name: TOPBAR_DROPPED_PIN,
      detail: `${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}`,
      lat: centre.lat,
      lon: centre.lng,
    };
    dismissSearch();
    setQuery('');
    forgetPlaces();
    setPendingSave(null);
    onRemember?.(place);
    onDestination?.(place, null);
  };

  /* SET HOME / SET WORK: the field becomes the prompt for that address, and
     the next place picked is saved under it instead of driven to. */
  const beginSave = (kind: 'home' | 'work'): void => {
    setPendingSave(kind);
    setQuery('');
    forgetPlaces();
    raiseSearch();
    (fieldRef?.current ?? panelFieldRef.current)?.focus();
  };
  const pickedWithSave = (place: Place | null): void => {
    if (place !== null && pendingSave !== null) {
      onSaveAs?.(place, pendingSave);
      setPendingSave(null);
      dismissSearch();
      setQuery('');
      forgetPlaces();
      return;
    }
    onPicked?.(place);
  };
  const prompt =
    pendingSave === null ? TOPBAR_PLACEHOLDER : pendingSave === 'home' ? TOPBAR_SAVE_HOME : TOPBAR_SAVE_WORK;

  const panel = !searching ? null : (
      <SearchPanel
        book={book}
        query={query}
        onQueryChange={(next) => {
          setQuery(next);
          // A previous lookup's answers are about a previous query. Leaving
          // them up would show places that do not match what is now typed.
          forgetPlaces();
        }}
        cameras={hits}
        places={places}
        counts={rowCounts}
        estimates={rowEstimates}
        onCountsNeeded={measure}
        routes={routes}
        orientation={orient}
        keyboard={keyboardUp}
        onPicked={pickedWithSave}
        onShow={(cameraId) => {
          dismissSearch();
          setQuery('');
          onPick?.(cameraId);
        }}
        /* A DESTINATION IS REPORTED WHEN THE DRIVE STARTS, not when a row is
           tapped -- which is the same moment the destination is written to
           history, and the reason `onDestination` did not have to change its
           meaning for the panel to gain a preview state. */
        onStart={(place, option) => {
          dismissSearch();
          setQuery('');
          forgetPlaces();
          setPendingSave(null);
          onDestination?.(place, option);
        }}
        onRemember={onRemember}
        onForget={onForget}
        onLookUp={lookUp}
        lookUpLabel={looking ? TOPBAR_LOOKING : TOPBAR_LOOK_UP}
        lookUpNote={TOPBAR_LOOK_UP_NOTE}
        looking={looking}
        emptyNote={TOPBAR_EMPTY}
        notice={
          lookupError ??
          (places !== null && places.length === 0 ? TOPBAR_NO_PLACE : undefined)
        }
        onVoice={voice}
        onDropPin={onDropPin ?? dropPin}
        onSetSaved={onSetSaved ?? beginSave}
        fieldRef={panelFieldRef}
      />
  );

  return (
    <div className="fwm-topbar-shell">
      <div
        ref={barRef}
        className="fwm-topbar"
        data-fwm-folded={folded ? 'true' : 'false'}
      >
        {/* THE SWEEP GRID, as the first child, at `z-index: 0`. Section D owns
            what it draws; this is the slot and the layering it lands on. */}
        {sweep}

        {/* The bloom, then the mark. Both absolute, both `pointer-events: none`,
            and the order matters: the bloom is `z-index: auto` so it paints under
            the content, the mark is 2 so it paints over it. */}
        <span className="fwm-topbar-bloom" aria-hidden="true" />

        {/* SECTION E'S TARGET, at `z-index: 3` -- above the artwork it stands
            in for, which is why the artwork can stay `pointer-events: none` and
            `aria-hidden` exactly as section A draws it. Empty on purpose: the
            picture is the image below, this is only the 72x72 it is pressed by. */}
        {onTapMark === undefined ? null : (
          <button
            type="button"
            className="fwm-topbar-mark-key"
            aria-label={TOPBAR_MARK}
            onClick={onTapMark}
          />
        )}
        <img
          className="fwm-topbar-mark"
          src={light === true ? MARK_SRC_LIGHT : MARK_SRC}
          alt=""
          aria-hidden="true"
        />

        {/* THE WORDMARK'S BOX IS EXACTLY 86x15 and holds one image, so the
            logotype centres on the bar's centreline in line with the placeholder.
            The count is absolutely positioned inside it and adds no height --
            in flow it makes this two rows and pushes the wordmark off centre,
            which is the failure the brief names and `searchBar.css` had already
            had once.

            AND THE WORDMARK RELOADS. In a PWA running with no browser chrome it
            is the only way to reload, `reloadTitle.source.test.ts` holds every
            v1 screen to drawing one, and this bar is where DRIVE draws its. The
            artwork is handed to `ReloadTitle` rather than restated by it: the
            chrome's wordmark is a different file at a measured size from the
            stencil `asMark` paints. See `ReloadTitleProps.art`.

            NEITHER IS DRAWN FOLDED, and the count goes because the name does.
            Folded, the bar is the mark and the way back and nothing else. */}
        {folded ? null : (
          <div className="fwm-topbar-word">
            <ReloadTitle
              title={TOPBAR_WORDMARK}
              className="fwm-topbar-title"
              art={
                <img className="fwm-topbar-wordmark" src={WORDMARK_SRC} alt="" aria-hidden="true" />
              }
            />
            {/* THE COUNT, AND THE DOT THAT SAYS WHETHER TO BELIEVE IT.
                The real number, grouped -- `139,918`, not `140k`. The rounded
                form is what this app showed for six days while the archive
                behind it stood still, and a figure that cannot change by less
                than a thousand cannot show a sync stopping.

                A CONTROL ONLY WHEN THERE IS SOMEWHERE TO GO. Handed
                `onHowItWorks` it opens the transparency route, because a claim
                about how much of the country is under a camera has to be able
                to hand over the page that says where the claim came from.
                Handed nothing it is the reading section A draws, and a `<div>`
                rather than a button that does nothing. */}
            {onHowItWorks === undefined ? (
              <div className="fwm-topbar-count" data-fwm-archive={freshness}>
                <span className="fwm-topbar-dot" aria-hidden="true" />
                <span className="fwm-topbar-n">{formatCacheCount(total)}</span>
              </div>
            ) : (
              <button
                type="button"
                className="fwm-topbar-count"
                data-fwm-archive={freshness}
                aria-label={topBarCountLabel(total, freshness, ageLabel)}
                onClick={onHowItWorks}
              >
                <span className="fwm-topbar-dot" aria-hidden="true" />
                <span className="fwm-topbar-n">{formatCacheCount(total)}</span>
              </button>
            )}
          </div>
        )}

        {folded ? null : <div className="fwm-topbar-rule" aria-hidden="true" />}

        {folded ? null : (
          <input
            ref={fieldRef}
            className="fwm-topbar-field"
            type="search"
            value={query}
            placeholder={prompt}
            aria-label={TOPBAR_PLACEHOLDER}
            /* No autocomplete, no spellcheck, no autocorrect: all three send what
               is typed somewhere on some platforms, and this field runs entirely
               on the device. The old bar carries the same three for the same
               reason. */
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            /*
             * THE TAP RAISES THE PANEL AND DOES NOT TAKE FOCUS.
             *
             * "THE PANEL OPENS WITH THE KEYBOARD DOWN in both orientations. The
             * field is focusable, not focused. Most trips are somewhere the
             * user has already been, so the panel's job on open is to show
             * those."
             *
             * A tap on a text input focuses it, and a focused text input on a
             * phone is a soft keyboard over half the screen -- so the panel
             * would have opened onto a list with two rows showing and the
             * keyboard covering the seven that are the reason it opened. The
             * default action of the press is what does that, so the press is
             * the thing that has to be answered: `preventDefault` on
             * `pointerdown` suppresses the focus that would have followed, and
             * the panel comes up over history with nothing over IT.
             *
             * The field is still a field. Tab still reaches it, `onFocus`
             * below still fires when it does, and the panel's own 46px field --
             * which is the input the spec draws in every frame -- is one tap
             * away for somebody who wants to type. Nothing here disables
             * anything, and see the note on the absent speed gate above.
             */
            onPointerDown={(event) => {
              if (open) return;
              event.preventDefault();
              raiseSearch();
            }}
            /*
             * REACHED BY TAB, OR BY A HOST HANDING FOCUS OVER. Both are
             * deliberate requests to search from somebody who is not using a
             * soft keyboard at all, so focus is honoured and reported: the
             * landscape chrome yields to it.
             */
            onFocus={() => {
              setSearchFocused(true);
            }}
            onBlur={() => {
              /* BLURRING IS NOT DISMISSING. A driver who taps a row is briefly
                 unfocused on the way to choosing it, and a panel that shut on
                 blur would close under the thumb that was choosing. */
              setSearchFocused(false);
            }}
            /* ENTER LOOKS THE PLACE UP. `type="search"` in a bare div fires no
               submit, so the key has to be read here - and without it the most
               obvious gesture in a text field did nothing, which is what "how do
               I start navigating" was actually asking. */
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              lookUp();
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              raiseSearch();
              // A previous lookup's answers are about a previous query. Leaving
              // them up would show places that do not match what is now typed.
              forgetPlaces();
            }}
          />
        )}

        {/* CLEAR, AND IT IS NOT IN THE KEY GROUP. It belongs to the field it
            empties, not to the row of controls at the end of the bar, and the
            brief's "only the chevron" is about that row. Drawn only when there
            is something to clear. */}
        {/* THE MIC, IN THE FIELD, AT FULL ACCENT -- section E. It takes the
            clear key's slot while there is nothing to clear, and only where
            the platform can hear. */}
        {folded || query !== '' || voice === undefined ? null : (
          <button
            type="button"
            className="fwm-topbar-clear"
            aria-label={SEARCH_VOICE}
            onClick={voice}
          >
            <ChromeIcon name="mic" size={CHEVRON_PX} />
          </button>
        )}
        {folded || query === '' ? null : (
          <button
            type="button"
            className="fwm-topbar-clear"
            aria-label={TOPBAR_CLEAR}
            onClick={() => {
              setQuery('');
              dismissSearch();
              forgetPlaces();
              setPendingSave(null);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={CHEVRON_PX}
              height={CHEVRON_PX}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m6.8 6.8 10.4 10.4M17.2 6.8 6.8 17.2" />
            </svg>
          </button>
        )}

        {/* ONE KEY. The toggle and the gear are on the rail; this row is a
            group of one so that stays visibly deliberate rather than looking
            like a key that lost its neighbours. */}
        <div className="fwm-topbar-keys">
          <button
            type="button"
            className="fwm-topbar-chevron"
            aria-label={folded ? TOPBAR_UNFOLD : TOPBAR_FOLD}
            aria-expanded={!folded}
            onClick={() => {
              setFolded((was) => {
                onFoldChange?.(!was);
                return !was;
              });
              dismissSearch();
              onFold?.();
            }}
          >
            {/* Inline SVG, 24-unit box, 1.7 stroke, round caps and joins, no
                fill -- the brief's icon rule, and the spec's own path. Paint
                arrives through `currentColor` from the key's own `color`. */}
            <svg
              viewBox="0 0 24 24"
              width={CHEVRON_PX}
              height={CHEVRON_PX}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M7 10.5 12 15.5l5-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* THE PANEL, WHICH IS WHAT THE DROPDOWN BECAME.
          `features/search/SearchPanel.tsx` -- one component, both
          orientations, four states, and it anchors itself to the PHONE rather
          than to this bar. Everything below is a hand-off: what the bar found,
          what the bar's one outbound key is called, and the callbacks the host
          gave it. The bar reinterprets none of it. */}
      {panel === null ? null : portalHost === null ? panel : createPortal(panel, portalHost)}
    </div>
  );
}
