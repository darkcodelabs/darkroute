/**
 * THE SEARCH ENTRY PANEL -- `DarkRoute Search Entry.html`, sections A to F.
 *
 * A 46px field with the voice mic inside it, a scrolling list of places, a
 * hairline, and a 40px footer. It is where a trip begins, and the number on the
 * right of every row -- how many cameras are on the way there -- is the reason
 * this application exists rather than a decoration on a list of addresses.
 *
 * =============================================================================
 * ONE COMPONENT, BOTH ORIENTATIONS
 * =============================================================================
 * Not two screens that resemble each other. One tree, one state object, and the
 * orientation is a PROP that changes six things -- the anchor, the panel's
 * size, the row height, the badge, the inset and what the keyboard does to it.
 * All six are resolved in `searchPanel.css` off one `data-fwm-orient`
 * attribute, so this file draws the same markup either way and there is no
 * branch in it that reads the orientation at all.
 *
 * WHICH IS WHY ROTATING NEVER RESETS. The query, the caret, the scroll offset,
 * the picked destination and keyboard focus all survive a rotation because
 * NOTHING IS REMOUNTED -- the attribute changes and the browser reflows. A host
 * that keys this component on the orientation, or renders it from two branches
 * of a ternary, breaks that on its own and no amount of state-keeping in here
 * can put it back. `SearchPanel.test.tsx` holds the reflow; the host's half is
 * a rule rather than a mechanism.
 *
 * =============================================================================
 * FOUR MORE DIFFERENCES THAN THE SPEC'S OWN LIST ADMITS TO
 * =============================================================================
 * The brief names six legal differences between the orientations. The rendered
 * document draws TEN, and the extra four are consistent across both spec files
 * rather than accidents of one frame:
 *
 *   TYPE SCALES     name 15 -> 13.5, sub 12.5 -> 11.5, count 13.5 -> 12.5, and
 *                   the badge glyph 12 -> 11.
 *   BADGE RADIUS    9 -> 8. F. GEOMETRY publishes "9 badge" as though it were
 *                   universal; it is the portrait number.
 *   PANEL SHADOW    `0 16px 44px rgba(0,0,0,0.55)` -> `0 12px 34px
 *                   rgba(0,0,0,0.5)`.
 *   OVERFLOW        portrait sets none, landscape sets `hidden`.
 *
 * They are built as values on the one geometry block rather than as branches,
 * so they cost nothing and cannot drift; they are reported in
 * gap record search-panel because the difference table needs them
 * added or the four need blessing.
 *
 * =============================================================================
 * NO SPEED GATE, EVER
 * =============================================================================
 * There is no motion lock in this file, no disabled field, no "keyboard locked
 * above 5 mph" and no read of the speed at all -- and nothing here takes a
 * speed, so one cannot be added without adding a prop somebody has to justify.
 * Passengers type. People at lights type. The application does not decide who
 * is driving.
 *
 * (The LANDSCAPE spec still carries two sentences promising the opposite. They
 * contradict its own A4 body, both of this file's specs, and the brief. They
 * are stale and they are listed in gap record search-panel.)
 *
 * =============================================================================
 * AND IT OPENS WITH THE KEYBOARD DOWN
 * =============================================================================
 * "The field is focusable but not focused -- no keyboard on open." Most trips
 * are somewhere the user has already been, so the panel's job on open is to
 * show those. Nothing here calls `focus()`; the field acquires it when a thumb
 * lands on it and only then.
 *
 * COLOUR AND GEOMETRY ARE NOT IN THIS FILE. Not one hex, not one pixel.
 * `searchPanel.css` resolves both and `scripts/check-design-values.mjs` fails
 * the build on a raw value in either.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';

import { ChromeIcon } from '../chrome/icons.tsx';
import {
  GROUP_LABEL,
  GROUP_VERB,
  NO_COUNTS,
  NO_ESTIMATES,
  countLabel,
  countName,
  countTier,
  idleRows,
  panelState,
  routeRows,
  sections,
  typingRows,
} from './panel.ts';
import { isFirstRun } from './places.ts';
import './searchPanel.css';
import type {
  CountLookup,
  EstimateLookup,
  RouteOption,
  RouteOptionKind,
  SearchRow,
  SearchState,
} from './panel.ts';
import type { PlaceBook } from './places.ts';
import type { SearchHit } from '../lookup/search.ts';
import type { Place } from '../../services/route/planRoute.ts';

/* ========================================================================== *
 * THE SENTENCES, EXPORTED SO A TEST AND A HOST QUOTE ONE STRING
 * ========================================================================== */

/**
 * THE FIELD'S PROMPT, and it is a question rather than an instruction.
 *
 * "Where to?" is what the spec draws in every frame that has an empty field.
 * It is also the field's accessible name: there is no visible label to point
 * at, and a search field whose only name is its placeholder is announced as
 * "edit text, blank" the moment somebody starts typing.
 */
export const SEARCH_PROMPT = 'Where to?';

/** What the list is, for a listbox with no visible label. */
export const SEARCH_RESULTS = 'Places';

/**
 * THE MIC'S NAME. It is a control, so it needs one -- and the name says what
 * it does rather than what it looks like.
 */
export const SEARCH_VOICE = 'Search by voice';

/** The footer, verbatim. The left half explains the column of numbers above it. */
export const SEARCH_FOOTER_NOTE = 'count is cameras on the fastest route';
export const SEARCH_DROP_PIN = 'Drop a pin';

/** PICKED and ROUTING put a word where the mic was. Both are the spec's own. */
/** How `panel.ts` keys a recent's row; the hold reads the id back off it. */
export const RECENT_ROW_PREFIX = 'recent:';

export const SEARCH_CHANGE = 'change';
export const SEARCH_END = 'end';

/**
 * FIRST RUN -- "no zero, no em-dashes, no empty list".
 *
 * A heading that states the fact, ONE line saying what fills the list and that
 * it stays on the phone, and the two actions. The sentence is the spec's,
 * word for word, and the promise in the middle of it -- "on this phone" -- is
 * the one thing on this surface that is a claim about the product rather than
 * about the user, so it is not paraphrased.
 */
export const FIRST_RUN_HEADING = 'Nowhere saved yet';
export const FIRST_RUN_BODY =
  'Type a destination or say it. Places you go build up here, on this phone, so the next trip is one tap.';
export const FIRST_RUN_HOME = 'Set home';
export const FIRST_RUN_WORK = 'Set work';

/* ========================================================================== *
 * THE MARKS, AT THE SPEC'S OWN SIZES
 * ========================================================================== */

/**
 * 17 AND 18, AND THE MIC IS THE BIGGER ONE.
 *
 * "The mic sits inside the field at full accent, SAME SIZE as the search
 * glyph." Optically, not literally: the spec draws the ring at 17 and the
 * capsule at 18 in every frame either appears in, because a capsule with a
 * cradle under it reads a pixel smaller than a ring in the same box. Copied,
 * not corrected.
 *
 * Unitless SVG user units rather than CSS lengths, so there is no token for
 * either -- the call `features/chrome/icons.tsx` and `TopBar.tsx` already make.
 */
const GLYPH_PX = 17;
const MIC_PX = 18;
const PIN_PX = 17;

/* ========================================================================== *
 * PROPS
 * ========================================================================== */

export type SearchOrientation = 'portrait' | 'landscape';

export interface SearchPanelProps {
  /**
   * Landscape fills the left column at 336 x 418, exactly as `A4` draws it.
   * Portrait hangs off the top search bar and is as tall as its rows, capped
   * by the room between the bar and the keyboard -- the owner's correction of
   * 2026-09-08, which supersedes the spec's 366 x 470 bottom sheet FOR THE
   * ANCHOR AND THE HEIGHT ONLY. Everything inside the panel is the drawing's
   * in both. Same tree, same state, different geometry.
   */
  readonly orientation?: SearchOrientation | undefined;
  /**
   * The soft keyboard is up. Chrome yields to it: landscape reflows to
   * 336 x 218 and drops the divider and the footer; portrait's ceiling comes
   * down to clear the keyboard, and the panel shortens with it.
   */
  readonly keyboard?: boolean | undefined;
  /** Saved places and recents. The panel never writes to it directly. */
  readonly book: PlaceBook;
  /** The query, owned by the host so the bar and the panel show one string. */
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** The readers already on this phone, from `searchCameras`. */
  readonly cameras?: readonly SearchHit[] | undefined;
  /**
   * What the geocoder answered, or null when it has not been asked.
   * NULL IS THE NORMAL STATE -- see `onLookUp`.
   */
  readonly places?: readonly Place[] | null | undefined;
  /** How many cameras are on the way to a place. Absent means "not measured". */
  readonly counts?: CountLookup | undefined;
  /**
   * THE DRIVE PER PLACE, which is the other half of what the spec's row draws.
   *
   * `'14 min · 7.2 mi'` in state 1, `'recent · 6 min'` in state 2, and the
   * locality with a distance beside it for a geocoder answer. Absent means
   * nothing has measured it and the row keeps the sub-line it already had --
   * the same two-armed discipline `counts` keeps, for the same reason.
   */
  readonly estimates?: EstimateLookup | undefined;
  /**
   * The three route options for the picked destination, or null while they are
   * still being planned. Absent entirely means the host does not offer a route
   * PREVIEW, and tapping a destination starts the drive the way it always did.
   */
  readonly routes?: readonly RouteOption[] | null | undefined;
  /** A destination was chosen and the panel moved to PICKED. */
  readonly onPicked?: ((place: Place | null) => void) | undefined;
  /** A camera row. Reveals the marker and opens its card; never a destination. */
  readonly onShow?: ((cameraId: string) => void) | undefined;
  /**
   * A ROUTE STARTED. The panel dismisses, the dock takes over, and this is the
   * one moment the destination is written down.
   */
  readonly onStart?: ((place: Place, option: RouteOptionKind | null) => void) | undefined;
  /**
   * WRITE THIS PLACE TO HISTORY. Called from the ROUTING transition and from
   * nowhere else, exactly once per start.
   */
  readonly onRemember?: ((place: Place) => void) | undefined;
  /**
   * FORGET ONE RECENT. Section C: "Long-press any row to forget that one
   * place." Fired with the recent's own id; saved places and map results
   * never fire it.
   */
  readonly onForget?: ((placeId: string) => void) | undefined;
  /** The one press that leaves the device, and the word on it. */
  readonly onLookUp?: (() => void) | undefined;
  readonly lookUpLabel?: string | undefined;
  readonly lookUpNote?: string | undefined;
  readonly looking?: boolean | undefined;
  /**
   * WHAT TO SAY WHEN A QUERY MATCHES NOTHING ON THIS PHONE.
   *
   * Drawn instead of an empty list, and it is the host's sentence rather than
   * one written here: only the host knows what its list was searching. A blank
   * panel would read as "broken" where the true answer is "this phone has not
   * loaded that area yet", which is a thing a person can act on.
   */
  readonly emptyNote?: string | undefined;
  /**
   * One line under the list -- a lookup that came back with nothing, or the
   * endpoint's own refusal. `role="status"`, because it arrives after a press
   * rather than with the render.
   */
  readonly notice?: string | undefined;
  /**
   * These rows have no count. Reported so the host can measure them -- the
   * "and retries" half of "shows a dash and a retry, never a blank".
   */
  readonly onCountsNeeded?: ((places: readonly Place[]) => void) | undefined;
  /**
   * SPEAK A DESTINATION. Wired, the mic is a control; unwired it is still drawn
   * -- at full accent, inside the field, optically the size of the search glyph
   * -- because voice is a peer of typing and a panel that hides it until
   * somebody implements speech would have made it a fallback. The same call
   * `TopBar.tsx` makes for its read count: a control only when there is
   * somewhere for it to lead, and the drawing either way.
   */
  readonly onVoice?: (() => void) | undefined;
  readonly onDropPin?: (() => void) | undefined;
  /** First run's two actions. */
  readonly onSetSaved?: ((kind: 'home' | 'work') => void) | undefined;
  readonly fieldRef?: RefObject<HTMLInputElement | null> | undefined;
}

/* ========================================================================== *
 * THE PANEL
 * ========================================================================== */

export function SearchPanel({
  orientation = 'portrait',
  keyboard = false,
  book,
  query,
  onQueryChange,
  cameras = [],
  places = null,
  counts = NO_COUNTS,
  estimates = NO_ESTIMATES,
  routes,
  onPicked,
  onShow,
  onStart,
  onRemember,
  onForget,
  onLookUp,
  lookUpLabel,
  lookUpNote,
  looking = false,
  emptyNote,
  notice,
  onCountsNeeded,
  onVoice,
  onDropPin,
  onSetSaved,
  fieldRef,
}: SearchPanelProps): ReactElement | null {
  /*
   * THE ONE PIECE OF STATE THIS COMPONENT OWNS.
   *
   * Everything else -- the query, the book, the counts, the options -- belongs
   * to a host that can persist it. The picked destination does not: it exists
   * between a tap and a start, it is the thing state 3 IS, and lifting it would
   * mean the panel could not move between two of its own four states without
   * asking permission.
   */
  const [picked, setPicked] = useState<Place | null>(null);
  /*
   * ROUTING IS A LATCH, NOT A PROP, and it is what makes "written to history
   * HERE, once" enforceable. It is set in one handler, it dismisses the panel,
   * and the write sits beside it -- so there is exactly one line in this file
   * that can add to the history and it is reached by exactly one press.
   */
  const [routing, setRouting] = useState(false);
  /*
   * AND THE LATCH LIFTS ON THE NEXT QUERY, so a host that keeps this component
   * MOUNTED across a drive does not end up holding a dead panel.
   *
   * `TopBar.tsx` unmounts it -- dismissing is what the state means -- and for
   * that host this never runs. A landscape column that keeps the panel in the
   * tree and hides it needs the other behaviour: a person who types again is
   * asking for the list back, and refusing them because a route is already
   * running would be the panel deciding something that is not its to decide.
   *
   * A ref rather than a dependency, because `routing` in the dependency list
   * would make this fire on the render that set it and lift the latch before
   * the panel had dismissed at all.
   */
  const routedRef = useRef(false);
  useEffect(() => {
    if (!routedRef.current) return;
    routedRef.current = false;
    setRouting(false);
  }, [query]);

  /*
   * TYPING IS A CHANGE OF MIND, AND IN PORTRAIT IT IS TYPED SOMEWHERE ELSE.
   *
   * The panel's own field answers this inline -- its `onChange` drops `picked`
   * before it reports the keystroke -- and that handler is the whole mechanism
   * in landscape. Portrait has no field here any more (see the field block
   * below), so the same intent arrives as a CHANGED `query` PROP from the bar,
   * and it has to be honoured for the same reason: without this, a person who
   * picked a destination and then went back to the bar to type would be looking
   * at three route options for the place they just changed their mind about,
   * with nothing on the screen able to leave that state.
   *
   * A REF HOLDING THE LAST QUERY, not a dependency on `picked`: this must fire
   * when the QUERY moves and never when the pick does, and `setPicked(place)`
   * from a row press does not touch the query.
   */
  const lastQueryRef = useRef(query);
  useEffect(() => {
    if (lastQueryRef.current === query) return;
    lastQueryRef.current = query;
    if (orientation === 'landscape') return;
    setPicked((current) => {
      if (current === null) return null;
      onPicked?.(null);
      return null;
    });
  }, [query, orientation, onPicked]);

  const state: SearchState = panelState({ query, picked, routing });

  /*
   * WHICH ROWS. One expression per state, and PICKED's is the only one that
   * does not read the book -- a route preview is about the three ways there,
   * not about where else you might have gone.
   */
  let rows: readonly SearchRow[];
  if (state === 'picked') {
    rows = routeRows(routes ?? []);
  } else if (state === 'typing') {
    rows = typingRows({ book, query, places, cameras, counts, estimates });
  } else {
    rows = idleRows(book, counts, estimates);
  }

  /*
   * THE ROWS THAT HAVE NO COUNT, REPORTED SO SOMEBODY CAN GO AND MEASURE THEM.
   *
   * The panel cannot measure them itself: a count is a route, and
   * `services/route/planRoute.ts` forbids a call that is not a direct user
   * action. So it draws the dash the rule requires and says which rows are
   * still waiting, and a host with a right to ask goes and asks.
   *
   * KEYED ON THE ROW IDS rather than on the row objects, which are rebuilt on
   * every render and would make this fire forever.
   */
  const pending = rows.filter(
    (row) => row.trailing.kind === 'count' && row.trailing.count.state === 'unknown',
  );
  const pendingKey = pending.map((row) => row.id).join('|');
  const askedRef = useRef<string>('');
  useEffect(() => {
    if (onCountsNeeded === undefined || pendingKey === '' || askedRef.current === pendingKey) {
      return;
    }
    askedRef.current = pendingKey;
    onCountsNeeded(
      pending.flatMap((row) => (row.action.kind === 'route' ? [row.action.place] : [])),
    );
    /* THE DEPENDENCY IS THE KEY, NOT THE ARRAY. `pending` is rebuilt on every
       render, so depending on it would re-fire this forever; the key is a
       string and only changes when the set of uncounted rows does. `askedRef`
       is the other half and it is load-bearing rather than belt-and-braces: a
       host that passes an inline lambda changes `onCountsNeeded`'s identity on
       every render, and without the ref that alone would loop. */
  }, [pending, pendingKey, onCountsNeeded]);

  /*
   * 4 · ROUTING -- THE PANEL DISMISSES AND THE DOCK TAKES OVER.
   *
   * Nothing is drawn. Returning null rather than hiding the tree is deliberate:
   * a hidden panel still holds a focused field, and the keyboard would stay up
   * over a map somebody is now driving by.
   */
  if (state === 'routing') return null;

  /**
   * A ROUTE STARTED, AND THIS IS THE ONLY PLACE HISTORY IS WRITTEN.
   *
   * Section C: "On route start, not on search and not on tap. A destination you
   * looked at and abandoned leaves no trace -- the common privacy complaint
   * about every other navigation app."
   */
  const start = (place: Place, option: RouteOptionKind | null): void => {
    routedRef.current = true;
    setRouting(true);
    /* THE PREVIEW IS OVER. Clearing it here rather than leaving it to lapse is
       what makes the latch above sufficient: a panel that came back still
       holding a destination would come back into PICKED, showing three route
       options for a drive that is already running. */
    setPicked(null);
    onRemember?.(place);
    onStart?.(place, option);
  };

  /** A destination row was tapped. This is state 3, and it writes NOTHING. */
  const pick = (place: Place): void => {
    /*
     * NO PREVIEW OFFERED, SO NO PREVIEW SHOWN. A host that hands this component
     * no `routes` prop at all is one that plans a single route the moment a
     * destination is chosen, which is what the application did before this
     * panel existed. Skipping straight to ROUTING there is the honest
     * behaviour: drawing an empty PICKED with three dashes in it would be
     * inventing a state the host cannot leave.
     */
    if (routes === undefined) {
      start(place, null);
      return;
    }
    setPicked(place);
    onPicked?.(place);
  };

  /** A row was held. Only a recent has anything to forget. */
  const hold = (row: SearchRow): void => {
    if (!row.id.startsWith(RECENT_ROW_PREFIX)) return;
    onForget?.(row.id.slice(RECENT_ROW_PREFIX.length));
  };

  const press = (row: SearchRow): void => {
    if (row.action.kind === 'route') {
      pick(row.action.place);
      return;
    }
    if (row.action.kind === 'show') {
      onShow?.(row.action.cameraId);
      return;
    }
    if (row.action.kind === 'start') {
      if (picked !== null) start(picked, row.action.optionId);
      return;
    }
    onLookUp?.();
  };

  /** PICKED puts the destination in the field; every other state puts the query. */
  const fieldValue = picked === null ? query : picked.name;

  /**
   * THE TRAILING SLOT. The mic while there is something to say, a word while
   * there is something to undo.
   *
   * The spec draws the mic at real size in every frame with an editable field,
   * and draws "clear" there in the state-2 DIAGRAM. The mic wins: "voice is a
   * peer, not a fallback" is a rule and the word in the small drawing is an
   * annotation, the same way "voice" stands in for the mic in state 1 of that
   * same row of pictures.
   * GAP: search-panel / 8-smaller-contradictions
   */
  const showMic = state === 'idle' || state === 'typing';

  const grouped = sections(rows);
  const empty = isFirstRun(book) && state === 'idle';

  return (
    <div
      className="fwm-search-panel"
      data-fwm-orient={orientation}
      data-fwm-keyboard={keyboard ? 'up' : 'down'}
      data-fwm-state={state}
    >
      {/* --- THE FIELD, 46 at radius 14, AND LANDSCAPE ONLY --------------
          OWNER CORRECTION, 2026-09-08, which supersedes `navigation mode search
          entry behavior.dc.html` for portrait and nothing else:

            "In portrait there is exactly ONE field, and it is the top search
             bar. The panel never renders a field in portrait. Delete the
             panel's field element on that path -- do not hide it, do not sync
             it, do not keep it as a 'mirror.' The bar is the input; the panel
             is only the result list."

          DELETED AND NOT HIDDEN, in those words and for a reason a stylesheet
          cannot deliver: a `display: none` input is still an input. It is still
          in the accessibility tree's count of text fields, `document.forms`
          still finds it, a password manager still offers to fill it, and it can
          still be focused programmatically -- which on a phone is a soft
          keyboard for a control nobody can see. The only way for there to be
          one field is for there to be one field.

          LANDSCAPE IS UNAFFECTED. There is no top bar on that surface --
          `drive.css` takes `.fwm-drive-top` away -- so the panel is the only
          thing that could hold an input, and it holds the one the spec draws.
          The difference between the two orientations is which surface owns the
          field, and that follows the bar's existence rather than being a style
          choice to unify. */}
      {orientation === 'landscape' ? (
      <div className="fwm-search-field">
        <ChromeIcon name="search" size={GLYPH_PX} />
        <input
          ref={fieldRef}
          className="fwm-search-input"
          type="search"
          value={fieldValue}
          placeholder={SEARCH_PROMPT}
          aria-label={SEARCH_PROMPT}
          /* The three that leak what is typed. All send characters somewhere
             on some platform, and this field runs on the device. */
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          /* NO `autoFocus`, AND THAT IS THE RULE RATHER THAN AN OVERSIGHT.
             "The keyboard never appears on open in either orientation." */
          onChange={(event) => {
            /* TYPING IN PICKED IS A CHANGE OF MIND, and it drops the preview
               rather than refusing the keystroke. There is no state in this
               panel a person can be locked into. */
            if (picked !== null) {
              setPicked(null);
              onPicked?.(null);
            }
            onQueryChange(event.target.value);
          }}
        />
        {/* VOICE IS A PEER, NOT A FALLBACK. Inside the field, at full accent,
            optically the size of the search glyph -- not a long-press, not a
            second key, not buried in a menu. Drawn whether or not a host has
            wired it, and a BUTTON only when one has: the drawing is the rule,
            the behaviour is the host's, and a mic that is a dead control is
            worse than a mic that is honestly a mark. No speech recogniser
            exists in this application yet.
            GAP: search-panel / e-voice-has-no-recogniser */}
        {showMic ? (
          onVoice === undefined ? (
            <span className="fwm-search-mic" aria-hidden="true">
              <ChromeIcon name="mic" size={MIC_PX} />
            </span>
          ) : (
            <button
              type="button"
              className="fwm-search-mic"
              aria-label={SEARCH_VOICE}
              onClick={onVoice}
            >
              <ChromeIcon name="mic" size={MIC_PX} />
            </button>
          )
        ) : (
          <button
            type="button"
            className="fwm-search-undo"
            onClick={() => {
              setPicked(null);
              onPicked?.(null);
            }}
          >
            {SEARCH_CHANGE}
          </button>
        )}
      </div>
      ) : null}

      {/* --- THE LIST --------------------------------------------------- */}
      <div className="fwm-search-list">
        {empty ? (
          <FirstRun onSetSaved={onSetSaved} />
        ) : (
          <div className="fwm-search-rows" role="listbox" aria-label={SEARCH_RESULTS}>
            {grouped.map((section) => (
              <div
                key={section.group}
                role="group"
                aria-label={GROUP_LABEL[section.group]}
                className="fwm-search-group"
              >
                {section.headed ? (
                  <div className="fwm-search-head" aria-hidden="true">
                    <span className="fwm-search-head-label">{GROUP_LABEL[section.group]}</span>
                    <span className="fwm-search-head-rule" />
                    <span className="fwm-search-head-verb">{GROUP_VERB[section.group]}</span>
                  </div>
                ) : null}
                {section.rows.map((row) => (
                  <Row key={row.id} row={row} onPress={press} onHold={hold} />
                ))}
              </div>
            ))}

            {/* NOT A BLANK PANEL. A query that matched nothing on this phone
                gets the host's own sentence about why, in the place the rows
                would have been. */}
            {rows.length > 0 || state !== 'typing' || emptyNote === undefined ? null : (
              <p className="fwm-search-none fwm-data">{emptyNote}</p>
            )}

            {notice === undefined ? null : (
              <p className="fwm-search-none fwm-data" role="status">
                {notice}
              </p>
            )}

            {/* THE ONE KEY THAT LEAVES THE DEVICE, under the local results
                because the local results are free and this is not. It is a
                PRESS: nothing here fires while typing, on blur, or because the
                on-device search came back empty. `planRoute.ts` opens with that
                rule and this row is how the panel keeps it while still showing
                map results the way section D draws them. */}
            {onLookUp === undefined || state !== 'typing' ? null : (
              <button
                type="button"
                className="fwm-search-lookup"
                disabled={looking}
                onClick={onLookUp}
              >
                <span className="fwm-search-lookup-label">{lookUpLabel ?? ''}</span>
                {lookUpNote === undefined ? null : (
                  <span className="fwm-search-lookup-note fwm-data">{lookUpNote}</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* --- THE HAIRLINE AND THE FOOTER --------------------------------
          BOTH GO WHEN THE KEYBOARD TAKES THE PANEL DOWN TO 218 in landscape,
          which is what A5 draws: no divider, no footer, three rows of 44. The
          footer explains a column of numbers, and at 218 there is one screenful
          of them and no room for the sentence. That is a behaviour difference
          the spec's own six-item list does not carry; it is drawn, and it is in
          gap record search-panel. */}
      <div className="fwm-search-divider" aria-hidden="true" />
      <div className="fwm-search-footer">
        <span className="fwm-search-note">{SEARCH_FOOTER_NOTE}</span>
        {onDropPin === undefined ? (
          <span className="fwm-search-pin-note">{SEARCH_DROP_PIN}</span>
        ) : (
          <button type="button" className="fwm-search-pin" onClick={onDropPin}>
            {SEARCH_DROP_PIN}
          </button>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== *
 * ONE ROW
 * ========================================================================== */

interface RowProps {
  readonly row: SearchRow;
  readonly onPress: (row: SearchRow) => void;
  readonly onHold?: ((row: SearchRow) => void) | undefined;
}

/**
 * BADGE · NAME · SUB-LINE · COUNT.
 *
 * The badge is a CHARACTER and not an icon, which is the spec's own decision
 * and is copied rather than improved: H and W read as words at 12px in a way no
 * house glyph does, and the star, the return arrow, the bullseye and the
 * fisheye are each one codepoint that a font already draws well. It is
 * `aria-hidden` because what it means is in the row's own name and the group it
 * sits in, and "black star" read aloud before every third place name is noise.
 */
function Row({ row, onPress, onHold }: RowProps): ReactElement {
  const trailing = row.trailing;
  return (
    <button
      type="button"
      role="option"
      aria-selected={row.emphasis === 'default'}
      className="fwm-search-row"
      data-fwm-emphasis={row.emphasis}
      onClick={() => {
        onPress(row);
      }}
      /* THE LONG-PRESS. A touch held on a row fires `contextmenu` on every
         mobile engine, which is the one gesture a list row has that is not
         a tap; the default menu is refused so the hold is the app's. */
      onContextMenu={(event) => {
        if (onHold === undefined) return;
        event.preventDefault();
        onHold(row);
      }}
    >
      <span className="fwm-search-badge" data-fwm-tone={row.tone} aria-hidden="true">
        {row.glyph}
      </span>
      <span className="fwm-search-text">
        <span className="fwm-search-name">{row.name}</span>
        <span className="fwm-search-sub fwm-data">{row.sub}</span>
      </span>
      {trailing.kind === 'count' ? (
        /* THE COUNT, AND A DASH IS A REAL ANSWER. Never a blank, and never a
           fake zero: zero is the answer this whole product is looking for and
           printing it before anybody measured would be a safety lie. */
        <span
          className="fwm-search-count fwm-data"
          data-fwm-tier={countTier(trailing.count)}
          aria-label={countName(trailing.count)}
        >
          {countLabel(trailing.count)}
        </span>
      ) : (
        /* A CAMERA IS NOT SOMEWHERE YOU ARE GOING, so its right side is how far
           away it is over what tapping it does. Section D. */
        <span className="fwm-search-meta">
          <span className="fwm-search-far fwm-data">{trailing.far}</span>
          <span className="fwm-search-verb">{trailing.verb}</span>
        </span>
      )}
    </button>
  );
}

/* ========================================================================== *
 * FIRST RUN
 * ========================================================================== */

/**
 * "First run is a sentence."
 *
 * No zero, no em-dashes, no empty list. A heading that says what is true, one
 * line saying what fills the list AND that it stays on the phone, and the two
 * actions that fill it. Set home carries the accent because it is the one
 * almost everybody wants; Set work is the plain row beside it.
 */
function FirstRun({
  onSetSaved,
}: {
  readonly onSetSaved: ((kind: 'home' | 'work') => void) | undefined;
}): ReactElement {
  return (
    <div className="fwm-search-first">
      <div className="fwm-search-first-card">
        <p className="fwm-search-first-head">{FIRST_RUN_HEADING}</p>
        <p className="fwm-search-first-body">{FIRST_RUN_BODY}</p>
      </div>
      <button
        type="button"
        className="fwm-search-set"
        data-fwm-kind="home"
        disabled={onSetSaved === undefined}
        onClick={() => {
          onSetSaved?.('home');
        }}
      >
        <ChromeIcon name="pin" size={PIN_PX} />
        <span className="fwm-search-set-label">{FIRST_RUN_HOME}</span>
      </button>
      <button
        type="button"
        className="fwm-search-set"
        data-fwm-kind="work"
        disabled={onSetSaved === undefined}
        onClick={() => {
          onSetSaved?.('work');
        }}
      >
        <ChromeIcon name="pin" size={PIN_PX} />
        <span className="fwm-search-set-label">{FIRST_RUN_WORK}</span>
      </button>
    </div>
  );
}
