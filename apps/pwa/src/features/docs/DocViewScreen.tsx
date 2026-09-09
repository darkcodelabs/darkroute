/**
 * A PUBLISHED DOCUMENT, RENDERED IN THE APP.
 *
 * =============================================================================
 * IT RENDERS THE REPOSITORY, IT DOES NOT RESTATE IT
 * =============================================================================
 * Every word on this screen comes from the markdown file in the public
 * repository, fetched through `/api/v1/doc/:name` so the app's CSP stays as
 * narrow as it is. Nothing here summarises, condenses or rewrites - a
 * documentation screen that paraphrases its own repository is a second source
 * of truth, and the two will disagree the first time somebody edits one.
 *
 * That is also why the screen names the file and links to it. If this rendering
 * is wrong or stale, the reader can go and read the real thing, which is the
 * standard the rest of this app is held to.
 *
 * =============================================================================
 * THE RENDERER BUILDS ELEMENTS, NOT HTML
 * =============================================================================
 * The obvious implementation converts markdown to an HTML string and hands it
 * to `dangerouslySetInnerHTML`. That is an injection sink pointed at content
 * fetched over the network, on a privacy product. The renderer is
 * `docMarkdown.tsx`, and every branch of it returns React elements, so there
 * is no path from document text to markup at all - safe by construction rather
 * than by sanitiser.
 *
 * IT USED TO LIVE HERE and handle "the subset these documents actually use",
 * measured against one file. The owner's screenshot of the terms page showed
 * the result of not measuring again: a literal `---` where a rule belongs,
 * links shown as `[text](url)`, numbered lists run together. The module's
 * header carries the count of what was broken across all eleven documents.
 * Anything it does not understand still renders as its own text rather than
 * vanishing, because a document with silently missing paragraphs is worse than
 * one with a stray asterisk.
 *
 * =============================================================================
 * WHAT BRIEF 4 CHANGED
 * =============================================================================
 * THE BODY IS 17px AT 1.6. It was 15, which is what the rest of this app uses
 * for controls, applied to eight thousand words of technical prose across the
 * full width of a phone. `docView.css` carries the argument.
 *
 * THE HEADINGS ARE TRACKED CAPS, so they read as structure rather than as more
 * prose in bold, and this file stops choosing an element by SIZE: `#` is the
 * document's name, `##` and `###` are its spine, and the stylesheet draws all
 * three.
 *
 * CODE BLOCKS ARE BOXED, CAPTIONED AND COPYABLE. {@link CodeBlock} is the only
 * new component: a hairlined box, the fence's own language as its caption, a
 * horizontal scroller, and a Copy affordance that reports the clipboard
 * adapter's verdict rather than claiming success.
 *
 * THERE IS A PROGRESS RAIL AND A SIZE LINE. `§0 of 9 · 8,300 words ·
 * TAXONOMY.md`, every segment measured from the fetched text - see
 * `docOutline.ts`, which also records why the third segment is a word count
 * rather than the spec page's "about 22 min".
 *
 * A BLOCKQUOTE BECOMES A CALLOUT. It is the one construct in markdown that
 * says "read this differently", so it is the one that gets a surface. The spec
 * page draws its callout around a paragraph that is not a blockquote in the
 * real file, and there is nothing in the markup of an ordinary paragraph that
 * could tell this renderer to promote it - so the rule is `>` and nothing else,
 * which is derivable rather than guessed.
 *
 * =============================================================================
 * BACK CLOSES THE DOCUMENT, WHEREVER IT WAS OPENED FROM
 * =============================================================================
 * The screen that opens this reader draws it from its own local state and
 * hands over `onBack`, and it used to be the only thing that could close it.
 * Nothing was written to history when a document opened, so the browser's back
 * gesture had no entry to pop for it: it popped the entry UNDER the map instead,
 * which is wherever the driver had been before - MORE, if they had come through
 * the hub, and nowhere at all on a cold start. Reported by the owner as "open
 * the transparency page and go back and it takes me to ?screen=more".
 *
 * So the reader writes ONE history entry as it mounts - `openOverlay`, the same
 * adapter the report sheet and the camera card use - and closes itself when
 * that entry is gone, whichever way it went: the Android gesture, the browser
 * key, or the `‹` at the top, which is `goBack()` and therefore the very same
 * pop. Back lands on whatever was under the document because that is the entry
 * beneath it; the reader never names a destination.
 *
 * The entry carries a kind and an id and no payload, per `screenState`'s
 * privacy rule. `doc:` plus the document's short API name is an id from a fixed
 * list, not a value a driver typed. And it is per document rather than one
 * shared `doc` so that a reader opened from another reader owns its own entry,
 * and one back press closes one document.
 *
 * FORWARD DOES NOT BRING IT BACK. The owning screen's state is what draws the
 * document; the entry alone draws nothing, and the next navigation clears it.
 * That is the outcome `DriveScreen` asked for when it kept the reader out of
 * the screen registry - a gesture must not restore a document over a map whose
 * position has since moved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, UIEvent } from 'react';

import {
  closeOverlay,
  goBack,
  hasOverlay,
  openOverlay,
  subscribe,
} from '../../app/screenState.ts';
import { BackKey } from '../../components/nav/BackKey.tsx';
import { createPlatformAdapters } from '../../services/adapters';
import type { AdapterSet } from '../../services/adapters';

import { renderDocMarkdown } from './docMarkdown.tsx';
import { docOutline, docProgress, docSection, docSize } from './docOutline.ts';

import './docView.css';

export const DOC_VIEW_FAILED = 'this document could not be read from the repository.';
export const DOC_VIEW_LOADING = 'reading the published document…';

/** The title track's one outbound word. */
export const DOC_VIEW_REPO = 'Repo';

/* The code box's three words and its caption live with the renderer now; they
   stay exported from here because the screen is what a test renders. */
export { DOC_CODE_LABEL, DOC_COPY_DONE, DOC_COPY_IDLE, DOC_COPY_REFUSED } from './docMarkdown.tsx';

export interface DocViewScreenProps {
  /** The short name the API knows. See `functions/api/v1/doc/[name].ts`. */
  readonly name: string;
  readonly title: string;
  /** The file in the repository, shown so the reader can go and check it. */
  readonly file: string;
  /**
   * Called once the document's history entry is gone - the reader is closed and
   * the owner should stop drawing it. NOT the arrow's handler: the arrow pops
   * history, and this is what the pop calls. See BACK CLOSES THE DOCUMENT.
   */
  readonly onBack: () => void;
  /** Injected in tests so nothing touches a real platform. */
  readonly adapters?: AdapterSet;
}

/** The history entry this reader owns while `name` is open. */
export function docOverlayId(name: string): string {
  return `doc:${name}`;
}

const REPO_DOCS = 'https://github.com/darkcodelabs/darkroute/blob/main/docs/public';

export function DocViewScreen({
  name,
  title,
  file,
  onBack,
  adapters,
}: DocViewScreenProps): ReactElement {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** How far through the band, 0 to 1, and which section that lands in. */
  const [read, setRead] = useState<{ readonly at: number; readonly section: number }>({
    at: 0,
    section: 0,
  });
  const bandRef = useRef<HTMLDivElement | null>(null);

  const set = useMemo(() => adapters ?? createPlatformAdapters(), [adapters]);

  /*
   * THE HISTORY ENTRY, and the close that follows it out.
   *
   * `onBack` is read through a ref: the owner passes a fresh closure every
   * render, and re-running this effect on each one would push an entry per
   * render. The subscription fires on every store change and asks one question
   * - is my entry still there - so the reader closes on a popstate, on a dock
   * press that cleared the stack, and on nothing else; an alert moving the
   * entry aside is not it going (`hasOverlay` counts the saved stack).
   *
   * The cleanup closes the entry only if it is still open, which is the case
   * where the OWNER took the reader down by some other route. On a pop it is
   * already gone and this is a no-op, so the two paths cannot double-count.
   */
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  /** True from the arrow's press until the pop it asked for has landed. */
  const popping = useRef(false);
  useEffect(() => {
    const id = docOverlayId(name);
    popping.current = false;
    openOverlay({ id, kind: 'modal' });
    const unsubscribe = subscribe(() => {
      if (!hasOverlay(id)) onBackRef.current();
    });
    return () => {
      unsubscribe();
      closeOverlay(id);
    };
  }, [name]);

  /*
   * THE ARROW IS THE BACK GESTURE. It pops the entry this reader pushed, and the
   * subscription above turns that pop into the close - so the two cannot land
   * in different places. The fallback is for a runtime with no history to pop
   * from, where the store is unwound directly and the owner told at once.
   *
   * ONE POP PER DOCUMENT. `history.back()` lands asynchronously, and a second
   * press in that gap would pop a second entry - the map's own - and put the
   * driver a screen further back than they asked to go. So the first press
   * arms `popping` and every press after it, until the entry is gone, is
   * ignored.
   */
  const back = useCallback((): void => {
    if (popping.current) return;
    popping.current = true;
    if (goBack()) return;
    closeOverlay(docOverlayId(name));
    onBackRef.current();
  }, [name]);

  const copy = useCallback(
    async (body: string): Promise<boolean> => set.clipboard.writeText('doc-snippet', body),
    [set],
  );

  useEffect(() => {
    let live = true;
    setText(null);
    setFailed(false);
    setRead({ at: 0, section: 0 });
    fetch(`/api/v1/doc/${name}`, { headers: { accept: 'text/markdown' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((body) => {
        if (live) setText(body);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [name]);

  /** The spine and the prose length, measured once per document. */
  const outline = useMemo(() => (text === null ? null : docOutline(text)), [text]);
  const blocks = useMemo(
    () =>
      text === null
        ? null
        : renderDocMarkdown(text, { onCopy: copy, source: `${REPO_DOCS}/${file}` }),
    [text, copy, file],
  );

  /**
   * WHERE THE READER IS, computed on scroll rather than watched.
   *
   * The offsets are read from the DOM at the moment of the scroll instead of
   * being cached, because they move: a code block's own font loads late, a
   * table reflows, and the text scale is a live setting. A cached offset
   * silently drifts and the section number stops matching the heading actually
   * on screen. Reading N `offsetTop`s inside a scroll handler is a layout read
   * of a list nine long on the document this was measured against.
   */
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const band = event.currentTarget;
    const marks = band.querySelectorAll<HTMLElement>('[data-fwm-doc-section]');
    const offsets: number[] = [];
    marks.forEach((mark) => offsets.push(mark.offsetTop - band.offsetTop));
    setRead({
      at: docProgress(band.scrollTop, band.scrollHeight, band.clientHeight),
      section: docSection(offsets, band.scrollTop),
    });
  }, []);

  return (
    <section className="fwm-docview" aria-label={title}>
      <header className="fwm-docview-top">
        {/* THE SHARED BACK KEY, not another one.
            A second round arrow drawn by this stylesheet is a second thing to
            keep in sync with the first, and `backAffordance.source.test.ts`
            exists to catch exactly that - it caught this. */}
        <BackKey label="Back" onBack={back} />
        <h1 className="fwm-docview-title">{title}</h1>

        {/* THE SOURCE, NAMED. If this rendering is wrong, the real thing is one
            tap away - which is the standard the rest of the app is held to. It
            is one word in the title track now rather than a full line under it:
            the line it replaced said `TAXONOMY.md · read it in the repository`,
            and the file name is on the size line below, so the only part that
            was not already on screen twice is where it goes. */}
        <a
          className="fwm-docview-source"
          href={`${REPO_DOCS}/${file}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {DOC_VIEW_REPO}
        </a>
      </header>

      {/* THE SIZE LINE. Every segment is measured from the text that was
          actually fetched; nothing here is a constant. */}
      <div className="fwm-docview-gauge">
        <div
          className="fwm-docview-rail"
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(read.at * 100)}
        >
          <div
            className="fwm-docview-rail-fill"
            style={{ width: `${String(Math.round(read.at * 100))}%` }}
          />
        </div>
        <p className="fwm-docview-meta fwm-data">
          {outline === null
            ? file
            : `§${String(read.section)} of ${String(outline.headings.length)} · ${docSize(outline.words)} · ${file}`}
        </p>
      </div>

      <div className="fwm-docview-body" ref={bandRef} onScroll={onScroll}>
        {failed ? <p className="fwm-docview-p fwm-data">{DOC_VIEW_FAILED}</p> : null}
        {text === null && !failed ? (
          <p className="fwm-docview-p fwm-data">{DOC_VIEW_LOADING}</p>
        ) : null}
        {blocks}
      </div>
    </section>
  );
}
