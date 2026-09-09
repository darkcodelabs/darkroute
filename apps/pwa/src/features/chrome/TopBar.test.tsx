/**
 * THE BAR, AND THE SIX DECLARATIONS THAT MAKE IT THE DRAWING.
 *
 * Two halves, and they check different kinds of thing.
 *
 * THE RENDERED HALF asks what the component draws and what it reports. jsdom
 * has a DOM, so that much is real.
 *
 * THE SOURCE HALF reads `topBar.css` off disk and resolves what it declares.
 * It has to, twice over: vitest runs with `css: false`, which stubs every
 * stylesheet import -- `?raw` included -- to the empty string, so an assertion
 * against an import would pass on '' whatever the file said; and jsdom does not
 * lay out and does not cascade custom properties, so `getComputedStyle(bar)
 * .height` is '' in this environment. `dockConformance.test.ts` reads its
 * stylesheet the same way for the same two reasons.
 *
 * EVERY ONE OF THESE FAILS SILENTLY IF IT BREAKS. A bar that is 60px tall, a
 * count that has drifted back into flow and taken the wordmark off the
 * centreline with it, an `overflow: hidden` that turns the mark into a
 * rectangle, a content child that lost its `z-index` and washes out under the
 * sweep -- not one of them throws, and not one of them is visible in a unit
 * test that only renders. The browser measurement that proves the layout is
 * recorded in the report this file was written beside; this is the cheap guard
 * that fails in CI when somebody tidies a declaration away.
 */

import { readFileSync } from 'node:fs';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CameraRecord } from '../../stores/cameras.ts';
import { useCamerasStore } from '../../stores/cameras.ts';

import {
  LOOKUP_DEBOUNCE_MS,
  TOPBAR_CLEAR,
  TOPBAR_COUNT_ACTION,
  TOPBAR_EMPTY,
  TOPBAR_FOLD,
  TOPBAR_LOOK_UP,
  TOPBAR_MARK,
  TOPBAR_PLACEHOLDER,
  TOPBAR_UNFOLD,
  TOPBAR_WORDMARK,
  TopBar,
} from './TopBar.tsx';
import { FIRST_RUN_HEADING, SEARCH_RESULTS } from '../search/SearchPanel.tsx';
import { reloadTitleLabel } from '../../components/nav';

/* ------------------------------------------------------------------------ *
 * THE PROMISE THIS BAR IS NOT ALLOWED TO BREAK
 *
 * `SearchBar.test.tsx` held it and that file is gone with its component. The
 * guarantee is not: TYPING SENDS NOTHING. No geocoder, no autocomplete, no
 * search-as-you-type request. `fetch` is a spy in every test in this file and
 * the assertion is `not.toHaveBeenCalled` -- because a bar that quietly
 * resolved queries over the network would be this product shipping the exact
 * thing it objects to, and no amount of reading the source proves that stays
 * true after the next change.
 *
 * `docs/public/API.md` and `docs/public/ARCHITECTURE.md` both cite the spy.
 * It lives here now.
 * ------------------------------------------------------------------------ */

const AT = { lat: 39.05, lon: -94.6 };

/**
 * A camera with a name worth typing.
 *
 * `operator` is what `titleOf` reads, so searching for part of it is the same
 * path a driver takes when they half-remember what a thing is called.
 */
const CAMERA: CameraRecord = {
  id: 'osm:topbar',
  lat: AT.lat + 0.004,
  lon: AT.lon,
  directionDeg: 90,
  confirmations: 1,
  tags: { operator: 'Overland Park Police', brand: 'DarkRoute' },
};

function seed(): void {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras: [CAMERA],
      fetchedAtMs: 1_700_000_000_000,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
}

/** An archive from N hours ago, as the ISO string the catalogue serves. */
function hoursOld(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** The state the dot is painted from, as the DOM carries it. */
function dotState(container: HTMLElement): string | null {
  return container.querySelector('.fwm-topbar-count')?.getAttribute('data-fwm-archive') ?? null;
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useCamerasStore.setState(useCamerasStore.getInitialState(), true);
  /*
   * Not a mock of some search client - the global. If ANY code path under this
   * component reaches the network, whatever it uses to do it, this catches it.
   */
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------ *
 * THE STYLESHEET, AND A CALCULATOR FOR WHAT IT DECLARES
 * ------------------------------------------------------------------------ */

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/** Comments blanked, so prose that quotes a banned value is not read as one. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '));
}

const CSS: string = blankComments(readFileSync(`${HERE}/topBar.css`, 'utf8'));
const TOKENS: string = blankComments(
  readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8'),
);

/** One rule's body, by selector. */
function block(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector} in topBar.css`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', at);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

/** One declaration's value, from a rule body. */
function decl(body: string, property: string): string {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, 'u').exec(body);
  expect(found, `no ${property} declaration`).not.toBeNull();
  return (found?.[1] ?? '').trim();
}

/**
 * Every custom property declared anywhere in a stylesheet, last one winning.
 *
 * Flat and last-wins because that is what the cascade does with the five
 * scale tokens this file reads: `--fwm-space-1` and friends are declared once
 * at `:root` and re-cut by no skin, which is exactly why the geometry can be
 * resolved here at all.
 */
function declaredVars(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/giu;
  let match = pattern.exec(css);
  while (match !== null) {
    out.set(match[1] ?? '', (match[2] ?? '').trim());
    match = pattern.exec(css);
  }
  return out;
}

const VARS: ReadonlyMap<string, string> = new Map([
  ...declaredVars(TOKENS),
  ...declaredVars(CSS),
]);

/** `var(--x)` replaced by what --x is, repeatedly, until none are left. */
function substitute(expression: string): string {
  let out = expression;
  for (let pass = 0; pass < 8 && out.includes('var('); pass += 1) {
    out = out.replace(/var\(\s*(--[a-z0-9-]+)\s*\)/giu, (whole, name: string) => {
      const value = VARS.get(name);
      expect(value, `${name} is declared nowhere -- it would resolve to nothing`).toBeDefined();
      return value ?? whole;
    });
  }
  return out;
}

/**
 * A length in px, resolved through the tokens and the arithmetic.
 *
 * Arithmetic only -- digits, `+ - * /`, parentheses -- evaluated by a parser
 * and never by `new Function`: a test that pulls a string out of a stylesheet
 * should not be able to run it. Anything the tokeniser does not fully consume
 * (a stray unit, an unresolved name) throws rather than quietly reading zero.
 */
function px(expression: string): number {
  const flat = substitute(expression).replace(/calc/giu, '').replace(/px/giu, '');
  const tokens = flat.match(/\d*\.\d+|\d+|[()+\-*/]/gu);
  expect(tokens, `${expression} is not arithmetic`).not.toBeNull();
  expect((tokens ?? []).join(''), `${expression} has a leftover unit or name`).toBe(
    flat.replace(/\s+/gu, ''),
  );

  const list = tokens ?? [];
  let cursor = 0;
  const peek = (): string | undefined => list[cursor];

  function unary(): number {
    const token = peek();
    if (token === '-') {
      cursor += 1;
      return -unary();
    }
    if (token === '(') {
      cursor += 1;
      const value = sum();
      cursor += 1; /* the ')' */
      return value;
    }
    cursor += 1;
    return Number(token);
  }

  function product(): number {
    let value = unary();
    for (;;) {
      const token = peek();
      if (token !== '*' && token !== '/') return value;
      cursor += 1;
      const right = unary();
      value = token === '*' ? value * right : value / right;
    }
  }

  function sum(): number {
    let value = product();
    for (;;) {
      const token = peek();
      if (token !== '+' && token !== '-') return value;
      cursor += 1;
      const right = product();
      value = token === '+' ? value + right : value - right;
    }
  }

  const answer = sum();
  expect(cursor, `${expression} did not parse to the end`).toBe(list.length);
  return answer;
}

/* ------------------------------------------------------------------------ *
 * WHAT IT DRAWS
 * ------------------------------------------------------------------------ */

describe('the top bar', () => {
  it('draws the spec’s prompt as the field’s own name', () => {
    render(<TopBar total={139_918} />);
    expect(screen.getByPlaceholderText(TOPBAR_PLACEHOLDER)).toBe(
      screen.getByRole('searchbox', { name: TOPBAR_PLACEHOLDER }),
    );
  });

  it('groups the read count the way the drawing does', () => {
    render(<TopBar total={139_918} />);
    expect(screen.getByText('139,918')).toBeInTheDocument();
  });

  it('prints no count at all rather than a confident zero', () => {
    render(<TopBar total={null} />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  /* THE RIGHT SIDE HOLDS ONLY THE CHEVRON. The toggle and the gear moved to
     the rail, and the way that stays true is a count, not a comment.

     SCOPED TO THE KEY GROUP, and that is not a softening. It used to count
     every button in the bar, which was the same thing when the bar was a
     picture: the drawing has one. The mounted bar has a wordmark that RELOADS
     -- the only way to reload a PWA with no browser chrome, and
     `reloadTitle.source.test.ts` holds every v1 screen to drawing one -- so a
     count of every button in the tree now answers a different question than
     the one this test is asking. `.fwm-topbar-keys` is the group the brief's
     sentence is about, and the test below counts the whole inventory so
     nothing can arrive unnoticed anywhere else either. */
  it('carries one key in the group and it is the chevron', () => {
    const { container } = render(<TopBar total={139_918} />);
    const keys = container.querySelectorAll('.fwm-topbar-keys button');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toHaveAccessibleName(TOPBAR_FOLD);
  });

  /* AND THE WHOLE BAR HOLDS TWO CONTROLS, NAMED. Handed nothing but a count,
     this draws section A: the reload wordmark and the chevron, and not the
     clear key, not the mark's target, not a count that goes anywhere. Each of
     those arrives only when a host wires it, which is what the three tests
     under `the mounted bar` check. */
  it('draws exactly the two controls section A has, and no more', () => {
    render(<TopBar total={139_918} />);
    expect(screen.getAllByRole('button').map((key) => key.getAttribute('aria-label'))).toEqual([
      reloadTitleLabel(TOPBAR_WORDMARK),
      TOPBAR_FOLD,
    ]);
  });

  it('reports the chevron press and decides nothing itself', () => {
    const onFold = vi.fn();
    render(<TopBar total={139_918} onFold={onFold} />);
    fireEvent.click(screen.getByRole('button', { name: TOPBAR_FOLD }));
    expect(onFold).toHaveBeenCalledTimes(1);
  });

  /* THE MARK IS NOT A TARGET IN SECTION A. Section E makes it one; until then
     a second focusable brand image in the bar is a key nobody drew. */
  it('draws the mark as decoration and not as a control', () => {
    const { container } = render(<TopBar total={139_918} />);
    const mark = container.querySelector('.fwm-topbar-mark');
    expect(mark?.tagName).toBe('IMG');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark?.closest('button')).toBeNull();
  });

  /* NO TEXT-CHARACTER GLYPHS. The chevron is a path in a 24-unit box, and the
     dot beside the count is a styled span -- never a bullet character. */
  it('draws its icon as geometry rather than as a character', () => {
    const { container } = render(<TopBar total={139_918} />);
    const svg = container.querySelector('.fwm-topbar-chevron svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('fill', 'none');
    expect(container.textContent ?? '').toMatch(/^[\d,\s–-]*$/u);
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT THE MOUNTED BAR ADDS, AND THAT IT ADDS NOTHING UNASKED
 *
 * The spec page is a picture; the bar on the road holds a query, opens a
 * results sheet, folds, and hands the mark to section E. Every one of those is
 * wired by the host, and the tests above prove the DEFAULT is still the
 * drawing. These prove the wiring works and that it is the old `SearchBar`'s
 * behaviour rather than a new one wearing its name.
 * ------------------------------------------------------------------------ */

describe('the mounted bar', () => {
  /* THE THREE THAT LEAK WHAT IS TYPED. All three send characters somewhere on
     some platform, and this field runs entirely on the device. */
  it('never autocompletes, autocorrects or spellchecks the field', () => {
    render(<TopBar total={139_918} />);
    const field = screen.getByRole('searchbox', { name: TOPBAR_PLACEHOLDER });
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('autocorrect', 'off');
    expect(field).toHaveAttribute('spellcheck', 'false');
  });

  /* THE DROPDOWN IS NOW `features/search/SearchPanel.tsx`, and the assertion
     migrated with it rather than being deleted: what this ever checked is that
     the bar OPENS a list on what is typed and that the one outbound key is
     under it. The list's own accessible name is the panel's, because the panel
     draws it. */
  it('opens the results list on what is typed, and offers the one key out', () => {
    render(<TopBar total={139_918} />);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: TOPBAR_PLACEHOLDER }), {
      target: { value: 'metcalf' },
    });

    expect(screen.getByRole('listbox', { name: SEARCH_RESULTS })).toBeInTheDocument();
    /* THE ONE OUTBOUND KEY, and it is a key rather than a keystroke: nothing
       here fires while typing, on blur, or because the local search came back
       empty. */
    expect(screen.getByText(TOPBAR_LOOK_UP)).toBeInTheDocument();
  });

  /* THE PANEL OPENS TO PLACES, WHICH IS NEW AND IS THE SPEC'S OWN RULE.
     The dropdown needed a query because it had nothing else to show; the panel
     opens on saved places and recents, because most trips are somewhere the
     driver has already been. With an empty book that is the first-run sentence
     rather than an empty box. */
  it('opens on focus, to places rather than to a cursor', () => {
    render(<TopBar total={139_918} />);
    fireEvent.focus(screen.getByRole('searchbox', { name: TOPBAR_PLACEHOLDER }));
    expect(screen.getByText(FIRST_RUN_HEADING)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /* CLEAR IS NOT IN THE KEY GROUP -- see the rule in `topBar.css` section 8 --
     and it does not exist until there is something to clear. */
  it('draws the clear key only against a field with something in it', () => {
    const { container } = render(<TopBar total={139_918} />);
    expect(screen.queryByRole('button', { name: TOPBAR_CLEAR })).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: TOPBAR_PLACEHOLDER }), {
      target: { value: 'metcalf' },
    });
    const clear = screen.getByRole('button', { name: TOPBAR_CLEAR });
    expect(clear.closest('.fwm-topbar-keys')).toBeNull();
    expect(container.querySelectorAll('.fwm-topbar-keys button')).toHaveLength(1);

    fireEvent.click(clear);
    expect(screen.getByRole('searchbox', { name: TOPBAR_PLACEHOLDER })).toHaveValue('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  /* THE CHEVRON IS THE FOLD, and the screen is told so it can take the rest of
     its chrome away with it. Reported rather than lifted: a parent holding this
     would have to hand it straight back for the key to draw. */
  it('folds itself and reports the fold', () => {
    const onFoldChange = vi.fn();
    render(<TopBar total={139_918} onFoldChange={onFoldChange} />);

    fireEvent.click(screen.getByRole('button', { name: TOPBAR_FOLD }));
    expect(onFoldChange).toHaveBeenCalledWith(true);
    /* Folded, the bar is the mark and the way back and nothing else. */
    expect(screen.queryByRole('searchbox')).toBeNull();
    const back = screen.getByRole('button', { name: TOPBAR_UNFOLD });
    expect(back).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(back);
    expect(onFoldChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('searchbox', { name: TOPBAR_PLACEHOLDER })).toBeInTheDocument();
  });

  /* SECTION E. The target is a SIBLING of the artwork, never a wrapper, which
     is what lets the image stay `pointer-events: none` and `aria-hidden`
     exactly as section A draws it. */
  it('gives the mark a target only when a host wires one, and never wraps it', () => {
    const tapMark = vi.fn();
    const { container } = render(<TopBar total={139_918} onTapMark={tapMark} />);

    const mark = container.querySelector('.fwm-topbar-mark');
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark?.closest('button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: TOPBAR_MARK }));
    expect(tapMark).toHaveBeenCalledTimes(1);
  });

  /* THE SWEEP IS THE BAR'S FIRST CHILD, at `z-index: 0`, which is the half of
     section D this file owns. */
  it('mounts the sweep as the bar’s first child', () => {
    const { container } = render(
      <TopBar total={139_918} sweep={<div data-testid="sweep" />} />,
    );
    const bar = container.querySelector('.fwm-topbar');
    expect(bar?.firstElementChild).toHaveAttribute('data-testid', 'sweep');
  });

  /* THE COUNT IS A READING UNTIL SOMEBODY GIVES IT SOMEWHERE TO GO, and then
     it is the transparency route -- a claim about how much of the country is
     under a camera handing over the page that says where the claim came from. */
  it('makes the count a control only when there is somewhere for it to lead', () => {
    const { container, unmount } = render(<TopBar total={139_918} />);
    expect(container.querySelector('button.fwm-topbar-count')).toBeNull();
    unmount();

    const onHowItWorks = vi.fn();
    render(<TopBar total={139_918} onHowItWorks={onHowItWorks} />);
    fireEvent.click(screen.getByText('139,918'));
    expect(onHowItWorks).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------ *
 * THE SEARCH ITSELF, CARRIED OVER FROM `SearchBar.test.tsx`
 *
 * The component was replaced; not one of these behaviours was. Each of them is
 * the same assertion against the same strings, on the markup that draws them
 * now.
 * ------------------------------------------------------------------------ */

describe('the search, which runs on the device', () => {
  it('sends nothing while somebody types', () => {
    seed();
    render(<TopBar total={139_918} at={AT} />);
    const field = screen.getByPlaceholderText(TOPBAR_PLACEHOLDER);
    for (const text of ['o', 'ov', 'ove', 'over', 'overland']) {
      fireEvent.change(field, { target: { value: text } });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('finds a camera by what it is called, from the cameras on this phone', () => {
    seed();
    render(<TopBar total={139_918} at={AT} />);
    fireEvent.change(screen.getByPlaceholderText(TOPBAR_PLACEHOLDER), {
      target: { value: 'overland' },
    });
    expect(screen.getByText(/Overland Park Police/i)).toBeTruthy();
  });

  it('sends nothing when a result is chosen', () => {
    seed();
    const onPick = vi.fn();
    render(<TopBar total={139_918} at={AT} onPick={onPick} />);
    fireEvent.change(screen.getByPlaceholderText(TOPBAR_PLACEHOLDER), {
      target: { value: 'overland' },
    });
    fireEvent.click(screen.getByText(/Overland Park Police/i));
    expect(onPick).toHaveBeenCalledWith(CAMERA.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says so plainly when this phone holds no match, rather than reaching out for one', () => {
    seed();
    render(<TopBar total={139_918} at={AT} />);
    fireEvent.change(screen.getByPlaceholderText(TOPBAR_PLACEHOLDER), {
      target: { value: 'zzzznowhere' },
    });
    expect(screen.getByText(TOPBAR_EMPTY)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /* THE ONE KEY THAT LEAVES THE DEVICE, and it is a PRESS. Not a keystroke,
     not a blur, and not "the local search came back empty". */
  it('reaches the network only when somebody presses the key that says so', () => {
    seed();
    render(<TopBar total={139_918} at={AT} />);
    fireEvent.change(screen.getByPlaceholderText(TOPBAR_PLACEHOLDER), {
      target: { value: '1420 baltimore ave' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockReturnValue(Promise.resolve({ ok: true, json: () => Promise.resolve({ places: [] }) }));
    fireEvent.click(screen.getByText(TOPBAR_LOOK_UP));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * THE CLEAR KEY THROWS THE ANSWER AWAY, SO THE QUESTION CAN BE ASKED AGAIN.
   *
   * Found by pressing it: type a place, get it, press CLEAR, type the same
   * place - and nothing came back, because the debounce remembered having
   * asked while the answer it asked for was gone. The pause and the term are
   * the same both times; the only thing that changed between them is the
   * press, and the press is the driver saying "start over".
   */
  it('asks again for a term whose answer the clear key threw away', async () => {
    vi.useFakeTimers();
    try {
      seed();
      fetchSpy.mockReturnValue(
        Promise.resolve({ ok: true, json: () => Promise.resolve({ places: [] }) }),
      );
      render(<TopBar total={139_918} at={AT} />);
      const field = screen.getByPlaceholderText(TOPBAR_PLACEHOLDER);

      fireEvent.change(field, { target: { value: 'oak park mall' } });
      await act(async () => {
        vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: TOPBAR_CLEAR }));
      fireEvent.change(field, { target: { value: 'oak park mall' } });
      await act(async () => {
        vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  /* AND THE RULE IT LEAVES STANDING: the pause fires once per term while the
     answer is on screen. Waiting longer, or re-rendering, sends nothing new. */
  it('does not ask the same term twice while its answer is still held', async () => {
    vi.useFakeTimers();
    try {
      seed();
      fetchSpy.mockReturnValue(
        Promise.resolve({ ok: true, json: () => Promise.resolve({ places: [] }) }),
      );
      const { rerender } = render(<TopBar total={139_918} at={AT} />);
      fireEvent.change(screen.getByPlaceholderText(TOPBAR_PLACEHOLDER), {
        target: { value: 'oak park mall' },
      });
      await act(async () => {
        vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS * 3);
      });
      rerender(<TopBar total={139_919} at={AT} />);
      await act(async () => {
        vi.advanceTimersByTime(LOOKUP_DEBOUNCE_MS * 3);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries no slogan - the bar is a name, a number and a field', () => {
    // "Online / No Account" was marketing on a surface somebody reads at
    // speed. It is the half of the old second line that is not coming back.
    render(<TopBar total={139_918} />);
    expect(screen.queryByText(/No Account/)).toBeNull();
    expect(screen.queryByText(/Online/)).toBeNull();
  });
});

/**
 * THE CAMERA COUNT, AND THE DOT THAT SAYS WHETHER TO BELIEVE IT.
 *
 * On 2026-09-07 this app drew "139,918 cameras" over an archive that had not
 * been rebuilt for six days, because a repository variable had switched the
 * sync off and no screen in the product had ever been given the archive's age
 * to render. Both halves of that are guarded here: the number is the real one,
 * and the state beside it is bound to how old the archive actually is.
 */
describe('the camera count and the archive behind it', () => {
  it('draws the real published total, not a figure rounded to the nearest thousand', () => {
    // `140k` cannot change by less than a thousand, so it cannot show a sync
    // stopping - which is exactly what it failed to show for six days.
    render(<TopBar total={139_918} />);
    expect(screen.getByText('139,918')).toBeTruthy();
    expect(screen.queryByText(/^\s*140k\s*$/)).toBeNull();
  });

  it('reads the live window as live', () => {
    const { container } = render(<TopBar total={139_918} upstream={hoursOld(2)} />);
    expect(dotState(container)).toBe('live');
  });

  it('does not read a six-day-old archive as live', () => {
    // The one this whole reading was built for. Six days is 144 hours, three
    // times the stale threshold, and it shipped looking exactly like a working
    // app.
    const { container } = render(<TopBar total={139_918} upstream={hoursOld(24 * 6)} />);
    expect(dotState(container)).toBe('stale');
    expect(dotState(container)).not.toBe('live');
  });

  it('does not read an archive that has merely stopped for a day as live', () => {
    // Between the two: something has stopped and not come back, but readers do
    // not move often and the map is still broadly true. It gets its own state
    // rather than being rounded up to an alarm or down to fine.
    const { container } = render(<TopBar total={139_918} upstream={hoursOld(20)} />);
    expect(dotState(container)).toBe('behind');
  });

  it('says it does not know rather than saying stale, when there is no timestamp', () => {
    // A phone that has never reached the network does not know how old its
    // archive is. Calling that "stale" would be asserting a measurement
    // nobody took.
    const { container } = render(<TopBar total={139_918} upstream={null} />);
    expect(dotState(container)).toBe('unknown');
  });

  it('says the state AND the age out loud, because a colour has no text alternative', () => {
    render(<TopBar total={139_918} upstream={hoursOld(24 * 6)} onHowItWorks={vi.fn()} />);
    const key = screen.getByRole('button', { name: new RegExp(TOPBAR_COUNT_ACTION) });
    const spoken = key.getAttribute('aria-label') ?? '';
    expect(spoken).toContain('139,918');
    expect(spoken).toContain('archive stale');
    expect(spoken).toContain('6 days ago');
  });

  it('does not offer an age it never measured', () => {
    render(<TopBar total={139_918} upstream={null} onHowItWorks={vi.fn()} />);
    const key = screen.getByRole('button', { name: new RegExp(TOPBAR_COUNT_ACTION) });
    const spoken = key.getAttribute('aria-label') ?? '';
    expect(spoken).toContain('archive age unknown');
    expect(spoken).not.toContain('ago');
  });

  it('sends nothing when the count is pressed', () => {
    // It is a navigation, not a refresh. Nothing on this bar reaches the
    // network without somebody asking for a place by name.
    const onHowItWorks = vi.fn();
    render(<TopBar total={139_918} onHowItWorks={onHowItWorks} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(TOPBAR_COUNT_ACTION) }));
    expect(onHowItWorks).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT IT MEASURES
 * ------------------------------------------------------------------------ */

describe('the bar’s geometry, resolved through the tokens', () => {
  const bar = block('.fwm-topbar');

  it('is 56 tall on a 999 pill, padded 0 8 0 64', () => {
    expect(px(decl(bar, 'height'))).toBe(56);
    expect(px(decl(bar, 'border-radius'))).toBe(999);
    expect(px(decl(bar, 'gap'))).toBe(10);
    const padding = decl(bar, 'padding').split(/\s+/u);
    expect(padding).toHaveLength(4);
    expect(px(padding[1] ?? '')).toBe(8);
    expect(px(padding[3] ?? '')).toBe(64);
  });

  it('wears a 1px hairline and no second edge', () => {
    expect(px(decl(bar, 'border').split(' ')[0] ?? '')).toBe(1);
    /* The lift and the specular rim are ONE declaration: `box-shadow` does not
       accumulate, so a second rule setting either would erase the other. */
    expect(decl(bar, 'box-shadow')).toBe('var(--dr-lift), var(--dr-specular)');
  });

  /* THE MARK BREAKS THE EDGE, and `overflow: hidden` is the one declaration
     that silently un-draws it. */
  it('never clips the mark', () => {
    expect(decl(bar, 'overflow')).toBe('visible');
  });

  it('hangs the 72px mark 6 left and 8 above a 56px bar', () => {
    const mark = block('.fwm-topbar-mark');
    expect(px(decl(mark, 'width'))).toBe(72);
    expect(px(decl(mark, 'height'))).toBe(72);
    expect(px(decl(mark, 'left'))).toBe(-6);
    expect(px(decl(mark, 'top'))).toBe(-8);
    /* 72 - 8 - 56: the mark clears the bottom edge by the same 8 it clears
       the top by, which is what puts its centre on the bar's centreline. */
    expect(px(decl(mark, 'height')) + px(decl(mark, 'top')) - px(decl(bar, 'height'))).toBe(8);
    expect(decl(mark, 'z-index')).toBe('2');
    expect(decl(mark, 'pointer-events')).toBe('none');
  });

  it('puts a 112px bloom behind it, off the corner', () => {
    const bloom = block('.fwm-topbar-bloom');
    expect(px(decl(bloom, 'width'))).toBe(112);
    expect(px(decl(bloom, 'height'))).toBe(112);
    expect(px(decl(bloom, 'left'))).toBe(-20);
    expect(px(decl(bloom, 'top'))).toBe(-28);
    expect(decl(bloom, 'background')).toBe('var(--dr-bloom)');
    /* NO `z-index`. It has to stay under the content at 1 and the mark at 2,
       which `auto` plus document order already does. */
    expect(bloom).not.toMatch(/z-index/u);
  });

  /* THE BOX IS THE WORDMARK'S SIZE AND NOTHING MORE. Any other height and
     `align-items: center` stops putting the logotype on the placeholder's
     centreline. */
  it('holds the wordmark in a box that is exactly 86 x 15', () => {
    const word = block('.fwm-topbar-word');
    expect(px(decl(word, 'width'))).toBe(86);
    expect(px(decl(word, 'height'))).toBe(15);
    const image = block('.fwm-topbar-wordmark');
    expect(px(decl(image, 'width'))).toBe(86);
    expect(px(decl(image, 'height'))).toBe(15);
  });

  /* THE FAILURE THIS ONE EXISTS FOR: in flow the count makes that box two rows
     tall, the box re-centres around both lines and the wordmark rides up. */
  it('hangs the read count out of flow at 17', () => {
    const count = block('.fwm-topbar-count');
    expect(decl(count, 'position')).toBe('absolute');
    expect(px(decl(count, 'top'))).toBe(17);
    expect(px(decl(count, 'gap'))).toBe(6);
    expect(px(decl(block('.fwm-topbar-dot'), 'width'))).toBe(5);
    expect(decl(block('.fwm-topbar-n'), 'font-size')).toBe('var(--fwm-text-micro)');
  });

  it('rules the field off with 1 x 24 of hairline', () => {
    const rule = block('.fwm-topbar-rule');
    expect(px(decl(rule, 'width'))).toBe(1);
    expect(px(decl(rule, 'height'))).toBe(24);
    expect(decl(rule, 'background')).toBe('var(--dr-hairline)');
  });

  it('sets the prompt at 15 and the key at 36', () => {
    expect(decl(block('.fwm-topbar-field'), 'font-size')).toBe('var(--fwm-text-body)');
    expect(px(decl(block('.fwm-topbar-chevron'), 'width'))).toBe(36);
    expect(px(decl(block('.fwm-topbar-chevron'), 'height'))).toBe(36);
  });

  /* WITHOUT THIS THE SWEEP BLENDS STRAIGHT THROUGH THE READOUTS. The grid is
     `z-index: 0` in `mix-blend-mode: screen`; anything left at `auto` is
     brightened by it rather than painted over it. */
  it('lifts every content child above the sweep', () => {
    const layer = block(
      '.fwm-topbar-word,\n.fwm-topbar-rule,\n.fwm-topbar-field,\n.fwm-topbar-keys',
    );
    expect(decl(layer, 'position')).toBe('relative');
    expect(decl(layer, 'z-index')).toBe('1');
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT THE STYLESHEET MAY NOT CONTAIN
 * ------------------------------------------------------------------------ */

describe('the stylesheet’s own contract', () => {
  /* The gate says this too. It is repeated here because the gate is a separate
     command and a component that can only be checked by remembering to run
     something else is one that gets shipped unchecked. */
  it('writes no raw colour', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
    expect(CSS).not.toMatch(/\b(?:rgba?|hsla?|color-mix|oklch)\s*\(/iu);
  });

  it('writes no raw length', () => {
    /* `calc(... * 14)` and `var(--fwm-space-1)`, never `56px`. Zero carries no
       design decision and `padding: 0 ...` needs it. */
    expect(CSS).not.toMatch(/(?<![\w.#-])(?!0)(?:\d*\.)?\d+(?:px|rem|em)\b/u);
  });

  /* TOUCH-FIRST. The spec draws a hover fill on the chevron; hover never fires
     on the target device and the gate rejects the selector outright. Dropped,
     not translated into an `:active` the spec never drew. */
  it('states no hover', () => {
    expect(CSS).not.toMatch(/:hover/u);
  });

  /* THE ONE RULE: if you can see an edge, it is a hairline. A cast shadow
     doing that job is the thing the brief bans by name. */
  it('lets no shadow do a hairline’s work', () => {
    expect(CSS).not.toMatch(/drop-shadow\s*\(/u);
    expect(CSS.match(/box-shadow/gu) ?? []).toHaveLength(1);
  });
});
