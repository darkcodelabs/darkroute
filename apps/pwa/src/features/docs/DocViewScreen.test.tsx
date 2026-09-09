/**
 * THE READER MUST NOT CLAIM ANYTHING IT HAS NOT DONE.
 *
 * Two behaviours are pinned here, and neither is markup.
 *
 * THE COPY VERDICT. `clipboard.writeText` returns false on a browser with no
 * clipboard API, in an insecure context, and when the write is refused - and a
 * button that says "Copied" in any of those cases is a green light wired to
 * nothing, on the one screen whose entire purpose is that a reader can check
 * the app's claims for themselves. The word on the button is the adapter's
 * answer and nothing else.
 *
 * THE CODE BLOCK IS A BOX, NOT A BLEED. A fenced block that overflows the
 * viewport is the failure brief 4 names; the box, its caption and its own
 * scroller are what stop it, and the caption comes from the fence's own info
 * string rather than from a word typed here.
 *
 * `fetch` is stubbed rather than mocked at the module level: this component
 * fetches a same-origin path through a Cloudflare Pages function, and what is
 * under test is what it does with the bytes, not that it called `fetch`.
 *
 * THE WAY BACK IS A HISTORY POP. The third group of cases is the owner's bug:
 * "open the transparency page and go back and it takes me to ?screen=more". The
 * reader wrote nothing to history, so the gesture popped the entry under the
 * map. These cases drive a fake history stack the way a browser would, and
 * assert that the gesture, the arrow and the owner's own close all leave the
 * driver on the screen the document was opened over.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAdapters, type MockAdapterSet } from '../../services/adapters/testing/mocks.ts';

import {
  disposeScreenState,
  getScreenState,
  hasOverlay,
  initScreenState,
  interruptForAlert,
  openScreen,
  restoreAfterAlert,
} from '../../app/screenState.ts';
import type { HistoryPort } from '../../app/screenState.ts';

import {
  DOC_CODE_LABEL,
  DOC_COPY_DONE,
  DOC_COPY_IDLE,
  DOC_COPY_REFUSED,
  DocViewScreen,
  docOverlayId,
} from './DocViewScreen.tsx';

const DOC = [
  '# Taxonomy and export',
  '',
  'What DarkRoute calls things.',
  '',
  '> Written for somebody who has no reason to trust it.',
  '',
  '## 0. The shortest possible orientation',
  '',
  '```bash',
  'curl -s https://darkroute.ai/cameras/index.json',
  '```',
  '',
  '```',
  '/cameras/index.json     count, bbox',
  '```',
].join('\n');

let adapters: MockAdapterSet;
/** What reached the clipboard, in order. */
let copied: { kind: string; text: string }[];

function draw(): void {
  render(
    <DocViewScreen
      name="taxonomy"
      title="Taxonomy"
      file="TAXONOMY.md"
      onBack={() => undefined}
      adapters={adapters}
    />,
  );
}

/** Renders and waits for the fetched document to land. */
async function drawLoaded(): Promise<void> {
  draw();
  await waitFor(() => {
    expect(screen.getByText('Taxonomy and export')).toBeInTheDocument();
  });
}

beforeEach(() => {
  adapters = createMockAdapters();
  copied = [];
  adapters.clipboard.writeText = async (kind, text): Promise<boolean> => {
    copied.push({ kind, text });
    return true;
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(DOC, { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  disposeScreenState();
});

/**
 * A history stack with the one property of the browser's that matters here:
 * `back()` does not land until the event loop turns. `pending()` says how many
 * pops have been asked for and `flush()` delivers them, so a test can press the
 * arrow twice in the gap and see what the browser would have done with it.
 */
function createDeferredHistory(initialSearch = ''): HistoryPort & {
  pending(): number;
  flush(): void;
  index(): number;
} {
  const stack: { state: unknown; url: string }[] = [{ state: null, url: `/${initialSearch}` }];
  let index = 0;
  let queued = 0;
  const handlers = new Set<() => void>();
  const parse = (url: string): { pathname: string; search: string; hash: string } => {
    const parsed = new URL(url, 'https://flock.test');
    return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash };
  };
  return {
    history: {
      get state() {
        return stack[index]?.state ?? null;
      },
      pushState(state: unknown, _title: string, url?: string | URL | null) {
        stack.length = index + 1;
        stack.push({ state, url: String(url ?? stack[index]?.url ?? '/') });
        index = stack.length - 1;
      },
      replaceState(state: unknown, _title: string, url?: string | URL | null) {
        stack[index] = { state, url: String(url ?? stack[index]?.url ?? '/') };
      },
      back() {
        queued += 1;
      },
    } as HistoryPort['history'],
    get location() {
      return parse(stack[index]?.url ?? '/');
    },
    addEventListener(_type, handler) {
      handlers.add(handler);
    },
    removeEventListener(_type, handler) {
      handlers.delete(handler);
    },
    pending: () => queued,
    flush() {
      while (queued > 0) {
        queued -= 1;
        if (index > 0) index -= 1;
        for (const handler of [...handlers]) handler();
      }
    },
    index: () => index,
  };
}

/** The reader over DRIVE, with DRIVE itself reached from MORE - the owner's route. */
function drawOverDrive(onBack: () => void): ReturnType<typeof createDeferredHistory> {
  const port = createDeferredHistory('?screen=more');
  initScreenState({ port });
  openScreen('radar');
  render(
    <DocViewScreen
      name="transparency"
      title="Transparency"
      file="TRANSPARENCY.md"
      onBack={onBack}
      adapters={adapters}
    />,
  );
  return port;
}

describe('the size line', () => {
  it('names the section, the length and the file, all measured from the text', async () => {
    await drawLoaded();
    // One `#` and one `##` in the fixture, so two sections. Fourteen words of
    // prose outside the fences -- four in the paragraph and ten in the
    // blockquote, whose `>` is structure and not one of them -- which is under
    // a hundred, so it is stated exactly rather than rounded.
    expect(screen.getByText('§0 of 2 · 14 words · TAXONOMY.md')).toBeInTheDocument();
  });

  it('says only the file name while the document is still being read', () => {
    // A count printed before the bytes land would be a count of nothing, and a
    // zero on this line reads as "an empty document" rather than "not yet".
    draw();
    expect(screen.getByText('TAXONOMY.md')).toBeInTheDocument();
  });

  it('starts the rail at nought, and reports it to assistive technology', async () => {
    await drawLoaded();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('a fenced code block', () => {
  it('takes its caption from the fence, and says Code when the fence has none', async () => {
    await drawLoaded();
    // `bash` is the info string on the first fence; the second has none. The
    // spec page's own `PUBLISHED FILES` is a caption somebody wrote for one
    // block on one page and there is nothing in markdown that could produce it.
    expect(screen.getByText('bash')).toBeInTheDocument();
    expect(screen.getByText(DOC_CODE_LABEL)).toBeInTheDocument();
  });

  it('offers a copy per block, and hands the adapter the block it belongs to', async () => {
    await drawLoaded();
    const buttons = screen.getAllByRole('button', { name: DOC_COPY_IDLE });
    expect(buttons).toHaveLength(2);

    await act(async () => {
      fireEvent.click(buttons[1] as HTMLElement);
    });

    // The second block, verbatim, and marked as the one kind of document text
    // the clipboard adapter's allowlist admits.
    expect(copied).toEqual([
      { kind: 'doc-snippet', text: '/cameras/index.json     count, bbox' },
    ]);
  });

  it('says Copied only when the adapter says it wrote', async () => {
    await drawLoaded();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: DOC_COPY_IDLE })[0] as HTMLElement);
    });
    expect(screen.getByRole('button', { name: DOC_COPY_DONE })).toBeInTheDocument();
  });

  it('says so instead when the write was refused, and does not say Copied', async () => {
    // Firefox on http, an OS that refused the write, a browser with no
    // clipboard at all. All three come back false and none of them copied
    // anything.
    adapters.clipboard.writeText = async (): Promise<boolean> => false;
    await drawLoaded();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: DOC_COPY_IDLE })[0] as HTMLElement);
    });
    expect(screen.getByRole('button', { name: DOC_COPY_REFUSED })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DOC_COPY_DONE })).toBeNull();
  });
});

describe('a blockquote', () => {
  it('becomes the callout, and an ordinary paragraph does not', async () => {
    await drawLoaded();
    const callout = screen.getByText('Written for somebody who has no reason to trust it.');
    expect(callout).toHaveClass('fwm-docview-callout');
    expect(screen.getByText('What DarkRoute calls things.')).toHaveClass('fwm-docview-p');
  });
});

describe('when the repository cannot be read', () => {
  it('says the document could not be read rather than rendering an empty one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    draw();
    await waitFor(() => {
      expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    });
    // And the size line does not invent a section count for a document that
    // never arrived.
    expect(screen.getByText('TAXONOMY.md')).toBeInTheDocument();
  });
});

describe('the way back', () => {
  it('writes one history entry as it opens, so a back gesture has something of its own to pop', () => {
    const port = drawOverDrive(() => undefined);

    expect(hasOverlay(docOverlayId('transparency'))).toBe(true);
    expect(getScreenState().depth, 'MORE -> DRIVE -> the document').toBe(2);
    // The URL is untouched: a document is not a screen and is not deep-linkable.
    expect(port.location.search).toBe('');
  });

  it('closes when the back gesture pops its entry, and the screen under it is what is left', async () => {
    const onBack = vi.fn();
    const port = drawOverDrive(onBack);

    port.history.back();
    port.flush();

    await waitFor(() => {
      expect(onBack).toHaveBeenCalledTimes(1);
    });
    // DRIVE, not MORE. The entry popped was the document's, not the map's.
    expect(getScreenState().screen).toBe('radar');
    expect(port.location.search).toBe('');
    expect(hasOverlay(docOverlayId('transparency'))).toBe(false);
  });

  it('makes the arrow the same pop as the gesture', async () => {
    const onBack = vi.fn();
    const port = drawOverDrive(onBack);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(port.pending(), 'the arrow asked history for exactly one pop').toBe(1);
    expect(onBack, 'and nothing closes until that pop lands').not.toHaveBeenCalled();

    port.flush();
    await waitFor(() => {
      expect(onBack).toHaveBeenCalledTimes(1);
    });
    expect(getScreenState().screen).toBe('radar');
    expect(port.index(), 'one entry back from the document: the map').toBe(1);
  });

  it('pops once however many times the arrow is pressed before the pop lands', async () => {
    // history.back() is asynchronous. Two presses in the gap would pop two
    // entries - the document's and then the map's - and land on MORE, which is
    // the very screen the owner reported arriving at by mistake.
    const onBack = vi.fn();
    const port = drawOverDrive(onBack);

    const arrow = screen.getByRole('button', { name: 'Back' });
    fireEvent.click(arrow);
    fireEvent.click(arrow);
    fireEvent.click(arrow);

    expect(port.pending()).toBe(1);
    port.flush();
    await waitFor(() => {
      expect(onBack).toHaveBeenCalledTimes(1);
    });
    expect(getScreenState().screen, 'DRIVE, not MORE').toBe('radar');
  });

  it('stays open through a camera alert', () => {
    // The alert moves the overlay stack aside and puts it back. That is not
    // the document closing, and the reader must not tell its owner it was.
    const onBack = vi.fn();
    drawOverDrive(onBack);

    interruptForAlert();
    expect(onBack).not.toHaveBeenCalled();
    restoreAfterAlert();
    expect(onBack).not.toHaveBeenCalled();
    expect(hasOverlay(docOverlayId('transparency'))).toBe(true);
  });

  it('takes its entry with it when the owner closes it some other way', () => {
    // An entry left behind after the reader is gone would make the next back
    // gesture a visible no-op: a pop that closes nothing.
    const port = createDeferredHistory();
    initScreenState({ port });
    const view = render(
      <DocViewScreen
        name="terms"
        title="Terms of use"
        file="TERMS.md"
        onBack={() => undefined}
        adapters={adapters}
      />,
    );
    expect(hasOverlay(docOverlayId('terms'))).toBe(true);

    view.unmount();

    expect(hasOverlay(docOverlayId('terms'))).toBe(false);
    expect(getScreenState().depth).toBe(0);
  });

  it('gives each document its own entry, so one pop closes one document', async () => {
    // A reader opened from inside another reader. Back must close the one on
    // top and leave the one under it - the entries are per document, not one
    // shared `doc`.
    const port = createDeferredHistory();
    initScreenState({ port });
    const closeLegal = vi.fn();
    const closeTerms = vi.fn();
    render(
      <DocViewScreen name="legal" title="Legal" file="LEGAL.md" onBack={closeLegal} adapters={adapters} />,
    );
    render(
      <DocViewScreen name="terms" title="Terms" file="TERMS.md" onBack={closeTerms} adapters={adapters} />,
    );
    expect(getScreenState().depth).toBe(2);

    port.history.back();
    port.flush();

    await waitFor(() => {
      expect(closeTerms).toHaveBeenCalledTimes(1);
    });
    expect(closeLegal, 'the document underneath is still open').not.toHaveBeenCalled();
    expect(hasOverlay(docOverlayId('legal'))).toBe(true);
  });
});
