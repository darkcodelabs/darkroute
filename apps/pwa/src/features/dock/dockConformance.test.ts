/**
 * SECTION G, AS EXECUTABLE ASSERTIONS OVER THE SOURCE FILES.
 *
 * `dockv3.dc.html` ends with a table it calls GEOMETRY -- every published
 * number in one place. The handoff calls that table the contract, so this file
 * is that table and nothing else: one assertion per published value, each one
 * naming the file and the line that would have to change to break it.
 *
 * IT NEVER RENDERS ANYTHING. It reads `dock.css` and the pane's component files
 * off disk and asks whether they still say what the spec says. A rendering test
 * would answer a different question -- whether the markup behaves -- and
 * `dockRows.test.tsx` is where that lives.
 *
 * WHY OFF DISK AND NOT THROUGH AN IMPORT. vitest runs with `css: false`, which
 * stubs every stylesheet import -- `?raw` included -- to the empty string, so an
 * assertion against `import css from './dock.css?raw'` would pass on '' no
 * matter what the file contained. `radar.css` is read the same way, for the
 * same reason, by `features/radar/components/RadarView.test.tsx`.
 *
 * WHY SOURCE AND NOT COMPUTED STYLE. jsdom does not lay out and does not
 * cascade custom properties, so `getComputedStyle(pane).height` is the empty
 * string in this environment. The three locked heights can only be checked by
 * resolving what the stylesheet declares, which is what `resolveLength` does --
 * and resolving them is the only way to check a number the design gate forbids
 * writing literally.
 *
 * THESE ARE NOT A STYLE GUIDE. Every one is a defect that fails SILENTLY: a
 * fourth height nobody measures, a pane that grows mid-turn, a 0.84 ground that
 * looks like glass in a screenshot and like a plate on a phone, a tab row
 * tinted by an alert, a 13px tap target for someone driving, a density colour
 * with no word beside it, a text arrow that resolves to some other font on one
 * Android build, a mistyped token that CSS resolves to no declaration at all.
 * None of them throws.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DOCK_PANE, type DockPane } from './Dock.tsx';
import {
  dockDensityOf,
  dockDetourLabel,
  dockDetourSpoken,
  DOCK_TIER_WORD,
} from './BrowseRow.tsx';
import { dockDensityTier } from './ExpandedPanel.tsx';
import { DOCK_STATE_IDS, DOCK_TABS } from './dockState.ts';

/* ------------------------------------------------------------------------ *
 * THE FILES
 * ------------------------------------------------------------------------ */

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/** Repo-relative, and used for nothing but the offender lines a failure prints. */
const DIR = 'apps/pwa/src/features/dock';

const DOCK_CSS: string = readFileSync(`${HERE}/dock.css`, 'utf8');
const TOKENS_CSS: string = readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8');

/**
 * Comments blanked, OFFSETS PRESERVED.
 *
 * Every one of these files argues with itself in prose, and the prose quotes
 * the very things being banned: `dock.css` writes `0.84` inside the paragraph
 * explaining why 0.84 may not appear in a rule. Deleting the comments would
 * shift every line number after them and make the offender lines lie, so each
 * comment becomes the same count of spaces and newlines instead.
 */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

const DOCK_RULES: string = blankComments(DOCK_CSS);
const TOKEN_RULES: string = blankComments(TOKENS_CSS);

/**
 * The same treatment for a `.ts` or `.tsx`, line comments included.
 *
 * The lookbehind on the line-comment arm is there so a `https://` inside a
 * string is not read as the start of a comment.
 */
function blankJsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\w])\/\/[^\n]*/g, (whole: string, keep: string) =>
      keep.concat(' '.repeat(whole.length - keep.length)),
    );
}

interface SourceFile {
  readonly name: string;
  readonly text: string;
}

/**
 * THE FILES THIS BRIEF OWNS, and no others.
 *
 * `DriveRows`, `ExpandedPanel`, `MapInset`, `icons` and `dockState` are other
 * briefs' work and are being rebuilt against sections C, E and F in parallel.
 * Asserting over them here would either fail on somebody else's half-finished
 * file or, worse, pass because this file had been softened to let it. The pane
 * is what this suite guards, and these five files are the pane.
 */
const OWNED = ['dock.css', 'Dock.tsx', 'BrowseRow.tsx', 'TabRow.tsx', 'ReportButton.tsx'];

const SOURCES: readonly SourceFile[] = readdirSync(HERE)
  .filter((name) => OWNED.includes(name))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({ name, text: readFileSync(`${HERE}/${name}`, 'utf8') }));

function source(name: string): SourceFile {
  const found = SOURCES.find((file) => file.name === name);
  if (found === undefined) {
    throw new Error(
      `${DIR}/${name} does not exist. The dock contract names it; write it or ` +
        'correct this test, but do not let a check pass by being skipped.',
    );
  }
  return found;
}

/** `path:line  detail`, so a failure names the file and the line, not just the fact. */
function at(name: string, text: string, index: number, detail: string): string {
  const line = text.slice(0, index).split('\n').length;
  return `${DIR}/${name}:${line}  ${detail}`;
}

/** Every match of a global pattern, already formatted as offender lines. */
function findAll(file: SourceFile, pattern: RegExp, label: (match: string) => string): string[] {
  const out: string[] = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(file.text);
  while (match !== null) {
    out.push(at(file.name, file.text, match.index, label(match[0])));
    match = pattern.exec(file.text);
  }
  return out;
}

/* ------------------------------------------------------------------------ *
 * A CSS READER, AND A CALCULATOR FOR WHAT IT FINDS
 * ------------------------------------------------------------------------ */

interface CssRule {
  readonly selector: string;
  readonly body: string;
  /** Offset of the selector in the source the rule was read from. */
  readonly index: number;
}

interface CssDecl {
  readonly prop: string;
  readonly value: string;
  readonly index: number;
}

/**
 * Every top-level rule. FLAT ON PURPOSE, and guarded by a test below.
 *
 * `dock.css` has no `@media`, no `@supports` and no nesting -- the design is a
 * fixed surface on a phone, not a responsive one -- so a flat reader is exact.
 * A nested block would fall out of this regex and stop being checked at all,
 * which is why its absence is asserted rather than assumed.
 */
function cssRules(text: string): readonly CssRule[] {
  const out: CssRule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(text);
  while (match !== null) {
    out.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '', index: match.index });
    match = pattern.exec(text);
  }
  return out;
}

function declarations(rule: CssRule, text: string): readonly CssDecl[] {
  const out: CssDecl[] = [];
  const bodyStart = text.indexOf('{', rule.index) + 1;
  let offset = 0;
  for (const piece of rule.body.split(';')) {
    const colon = piece.indexOf(':');
    if (colon >= 0) {
      out.push({
        prop: piece.slice(0, colon).trim(),
        value: piece.slice(colon + 1).trim(),
        index: bodyStart + offset,
      });
    }
    offset += piece.length + 1;
  }
  return out;
}

/** Every custom property a stylesheet DECLARES, last declaration winning. */
function declaredVars(text: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const rule of cssRules(text)) {
    for (const decl of declarations(rule, text)) {
      if (decl.prop.startsWith('--')) out.set(decl.prop, decl.value);
    }
  }
  return out;
}

const TOKEN_VARS = declaredVars(TOKEN_RULES);
const DOCK_VARS = declaredVars(DOCK_RULES);
const ALL_VARS: ReadonlyMap<string, string> = new Map([...TOKEN_VARS, ...DOCK_VARS]);

/**
 * Arithmetic only: digits, the four operators, and parentheses.
 *
 * A recursive-descent parser rather than `new Function`, because a test that
 * evaluates a string pulled out of a stylesheet should not be able to run it.
 * The token round-trip check rejects anything the tokeniser did not fully
 * consume -- a stray unit, a leftover `var(`, an unresolved name -- as `null`,
 * which every caller reports rather than quietly treating as zero.
 */
function evaluate(expression: string): number | null {
  const tokens = expression.match(/\d*\.\d+|\d+|[()+\-*/]/g);
  if (tokens === null || tokens.join('') !== expression.replace(/\s+/g, '')) return null;

  let cursor = 0;
  const peek = (): string | undefined => tokens[cursor];

  function unary(): number | null {
    const token = peek();
    if (token === undefined) return null;
    if (token === '-') {
      cursor += 1;
      const value = unary();
      return value === null ? null : -value;
    }
    if (token === '+') {
      cursor += 1;
      return unary();
    }
    if (token === '(') {
      cursor += 1;
      const value = sum();
      if (peek() !== ')') return null;
      cursor += 1;
      return value;
    }
    if (!/^[\d.]/.test(token)) return null;
    cursor += 1;
    return Number(token);
  }

  function product(): number | null {
    let value = unary();
    for (;;) {
      if (value === null) return null;
      const op = peek();
      if (op !== '*' && op !== '/') return value;
      cursor += 1;
      const right = unary();
      if (right === null) return null;
      value = op === '*' ? value * right : value / right;
    }
  }

  function sum(): number | null {
    let value = product();
    for (;;) {
      if (value === null) return null;
      const op = peek();
      if (op !== '+' && op !== '-') return value;
      cursor += 1;
      const right = product();
      if (right === null) return null;
      value = op === '+' ? value + right : value - right;
    }
  }

  const result = sum();
  return cursor === tokens.length ? result : null;
}

/** The root font size every `rem` on the type scale is a ratio of. */
const ROOT_PX = 16;

/**
 * A CSS length in px, or `null` when it does not reduce to one.
 *
 * `check-design-values.mjs` forbids a raw length as hard as a raw hex, so the
 * pane spells 150 as the sum of seven ratios off the 4px step. Substituting the
 * custom properties and doing the arithmetic is the only way left to ask
 * whether the stylesheet still draws the number the spec published.
 */
function resolveLength(value: string, vars: ReadonlyMap<string, string>): number | null {
  let expression = value;
  for (let pass = 0; pass < 8 && expression.includes('var('); pass += 1) {
    expression = expression.replace(
      /var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g,
      (whole: string, name: string) => {
        const found = vars.get(name);
        return found === undefined ? whole : `(${found})`;
      },
    );
  }
  if (expression.includes('var(')) return null;
  return evaluate(
    expression
      .replace(/\bcalc\b/g, '')
      .replace(/(\d*\.?\d+)rem\b/g, (_whole, n: string) => String(Number(n) * ROOT_PX))
      .replace(/(\d*\.?\d+)px\b/g, '$1')
      .trim(),
  );
}

/** A local declared on the pane, resolved to px. */
function local(name: string): number | null {
  const value = ALL_VARS.get(name);
  return value === undefined ? null : resolveLength(value, ALL_VARS);
}

/** The value a selector declares for one property, verbatim. */
function declared(selector: string, prop: string): string | undefined {
  const rule = cssRules(DOCK_RULES).find((candidate) => candidate.selector === selector);
  if (rule === undefined) return undefined;
  return declarations(rule, DOCK_RULES).find((decl) => decl.prop === prop)?.value;
}

/** The height a pane selector declares, resolved. */
function paneHeight(pane: DockPane): number | null {
  const value = declared(`.fwm-dock[data-fwm-pane='${pane}']`, 'height');
  return value === undefined ? null : resolveLength(value, ALL_VARS);
}

/* ------------------------------------------------------------------------ *
 * G -- collapsed 150 / navigating 170 / expanded 302
 * ------------------------------------------------------------------------ */

/**
 * A selector that targets the PANE ITSELF -- `.fwm-dock`, optionally narrowed
 * by attribute, and nothing after it.
 *
 * The negative lookahead is the whole point: `.fwm-dock-lede` and
 * `.fwm-dock-report` both begin with the string `.fwm-dock`, and both set a
 * height of their own that is none of this check's business.
 */
const PANE_COMPOUND = /^\.fwm-dock(?![\w-])(?:\[[^\]]*\])*$/;

function targetsPane(selector: string): boolean {
  return selector.split(',').some((part) => PANE_COMPOUND.test(part.trim()));
}

/** A fourth height is a fourth height however it is spelled. */
const HEIGHT_PROPS: ReadonlySet<string> = new Set(['height', 'min-height', 'max-height']);

const THREE_HEIGHTS: ReadonlySet<number> = new Set([150, 170, 302]);

describe('G · the three heights', () => {
  it('reads dock.css with a flat parser because dock.css is flat', () => {
    /* If a nested or conditional block is ever added, every rule inside it
       drops out of `cssRules` and stops being checked -- silently. This is the
       tripwire on that: it fails loudly rather than checking less. */
    const nested = /@(?:media|supports|container|layer|scope)\b/.exec(DOCK_RULES);
    expect(
      nested === null ? null : at('dock.css', DOCK_CSS, nested.index, `nested block ${nested[0]}`),
    ).toBeNull();
  });

  it('draws the collapsed pane at 150, border-box, hairline included', () => {
    expect(paneHeight('collapsed')).toBe(150);
  });

  it('draws the navigating pane at 170', () => {
    expect(paneHeight('navigating')).toBe(170);
  });

  it('draws the expanded pane at 302', () => {
    expect(paneHeight('expanded')).toBe(302);
  });

  /**
   * THE SUMS, AND NOT JUST THE TOTALS.
   *
   * Section A publishes the composition as well as the number -- 1 hairline +
   * 12 pad + 44 lede + 24 meta + 4 pad + 1 divider + 63 tabs + 1 hairline -- and
   * a total that is right for the wrong reasons is a pane that will drift the
   * next time a row is tuned. Each part is pinned, so a row that changes has to
   * change the total too and this suite says which one moved.
   */
  it('composes 150 out of the parts section A publishes', () => {
    expect({
      hairline: local('--fwm-dk-hairline'),
      padTop: local('--fwm-dk-pad-t'),
      lede: local('--fwm-dk-lede-h'),
      meta: local('--fwm-dk-meta-h'),
      padBottom: local('--fwm-dk-pad-b'),
      divider: local('--fwm-dk-divider'),
      tabs: local('--fwm-dk-tabs-h'),
    }).toStrictEqual({
      hairline: 1,
      padTop: 12,
      lede: 44,
      meta: 24,
      padBottom: 4,
      divider: 1,
      tabs: 63,
    });
  });

  it('composes 170 out of the parts section E publishes', () => {
    expect({
      maneuver: local('--fwm-dk-maneuver-h'),
      footer: local('--fwm-dk-footer-h'),
    }).toStrictEqual({ maneuver: 56, footer: 32 });
  });

  it('composes 302 out of the parts section C publishes', () => {
    expect({ head: local('--fwm-dk-head-h'), list: local('--fwm-dk-list-h') }).toStrictEqual({
      head: 84,
      list: 151,
    });
  });

  /**
   * AND OUT OF SECTION F'S, WHICH ARE DIFFERENT PARTS OF THE SAME 302.
   *
   *   C  `2 hairline + 84 + 1 divider + 151 list + 1 divider + 63 tabs`
   *   F  `12 + 56 + 32 + 1 + 135 list + 1 + 63 tabs, +2 hairline`
   *
   * C's 84 is the collapsed body entire, 4px pad included; F's 100 is the
   * navigating body without that pad, because in F the list takes the place it
   * was holding. Neither is nominal -- both add to 302 exactly -- so nothing in
   * the expanded pane has to be squeezed to make a sum work.
   */
  it('composes the same 302 out of the different parts section F publishes', () => {
    expect({
      head: local('--fwm-dk-head-nav-h'),
      list: local('--fwm-dk-list-nav-h'),
      padTop: local('--fwm-dk-pad-t'),
      maneuver: local('--fwm-dk-maneuver-h'),
      footer: local('--fwm-dk-footer-h'),
    }).toStrictEqual({ head: 100, list: 135, padTop: 12, maneuver: 56, footer: 32 });
  });

  it('adds both expanded splits to the one published 302', () => {
    const hairline = local('--fwm-dk-hairline') ?? 0;
    const divider = local('--fwm-dk-divider') ?? 0;
    const tabs = local('--fwm-dk-tabs-h') ?? 0;
    const sum = (head: number, list: number): number =>
      hairline * 2 + head + divider + list + divider + tabs;
    expect([
      sum(local('--fwm-dk-head-h') ?? 0, local('--fwm-dk-list-h') ?? 0),
      sum(local('--fwm-dk-head-nav-h') ?? 0, local('--fwm-dk-list-nav-h') ?? 0),
    ]).toStrictEqual([302, 302]);
  });

  it('gives each expanded head the height its own section publishes', () => {
    /* One `.fwm-dock-head` class, two heights, chosen by `data-fwm-head`. The
       list under it is `flex: 1 1 auto` and takes what is left, so a head that
       drifts moves the list rather than the pane. */
    expect(
      resolveLength(
        declared(".fwm-dock-head[data-fwm-head='nearby']", 'height') ?? '',
        ALL_VARS,
      ),
    ).toBe(84);
    expect(
      resolveLength(
        declared(".fwm-dock-head[data-fwm-head='navigating']", 'height') ?? '',
        ALL_VARS,
      ),
    ).toBe(100);
  });

  it('pads the expanded head 12 above, and 4 below only where C draws the 4', () => {
    /* `.fwm-dock-body` carries no padding in the expanded pane -- the two heads
       do not pad the same, and the list under them runs to the pane's edge. */
    expect(resolveLength(declared('.fwm-dock-head', 'padding-top') ?? '', ALL_VARS)).toBe(12);
    expect(
      resolveLength(
        declared(".fwm-dock-head[data-fwm-head='nearby']", 'padding-bottom') ?? '',
        ALL_VARS,
      ),
    ).toBe(4);
    expect(declared(".fwm-dock-head[data-fwm-head='navigating']", 'padding-bottom')).toBeUndefined();
  });

  it('squeezes no navigation footer to fit an expanded head', () => {
    /* The 32 is the footer's in all eight navigation states, expanded or not.
       This rule used to hand the expanded one `flex: 1 1 auto` and 28px,
       against a file that publishes 56 + 32 in both. */
    expect(
      declared(".fwm-dock-head[data-fwm-head='navigating'] .fwm-dock-footer", 'height'),
    ).toBeUndefined();
    expect(resolveLength(declared('.fwm-dock-footer', 'height') ?? '', ALL_VARS)).toBe(32);
  });

  it('puts no fourth height on the pane, however it is spelled', () => {
    const offenders: string[] = [];
    for (const rule of cssRules(DOCK_RULES)) {
      if (!targetsPane(rule.selector)) continue;
      for (const decl of declarations(rule, DOCK_RULES)) {
        if (!HEIGHT_PROPS.has(decl.prop)) continue;
        const px = resolveLength(decl.value, ALL_VARS);
        if (px !== null && THREE_HEIGHTS.has(px)) continue;
        offenders.push(
          at('dock.css', DOCK_CSS, decl.index, `${rule.selector} ${decl.prop}: ${decl.value}`),
        );
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('leaves every one of the nineteen on one of the three', () => {
    const strays = DOCK_STATE_IDS.filter(
      (id) => !(['collapsed', 'navigating', 'expanded'] as const).includes(DOCK_PANE[id]),
    );
    expect(strays).toStrictEqual([]);
  });

  /**
   * ESCALATION IS COLOUR AND WEIGHT, NEVER SIZE, and this is that rule as
   * arithmetic: the five drive states section B draws are the SAME height as
   * the browse states in section A. A pane that grew when a camera came into
   * range would move the control under the driver's thumb.
   */
  it('gives the five drive states the same height as the browse states', () => {
    const drive = (['cruising', 'approaching', 'passing', 'cleared', 'offline'] as const).map(
      (id) => DOCK_PANE[id],
    );
    expect(drive).toStrictEqual(['collapsed', 'collapsed', 'collapsed', 'collapsed', 'collapsed']);
  });
});

/* ------------------------------------------------------------------------ *
 * G -- inset 10 all sides · radius 24 pane, 14 tab pill, 12 list row
 * ------------------------------------------------------------------------ */

describe('G · the inset and the radii', () => {
  it('insets the pane 10 on all four sides', () => {
    /* The wrapper in `styles/global.css` pads the 10 and the pane must not add
       a second one. Both copies of the number are pinned: the pane's own local,
       and the scrim's, which reaches back out through that padding. */
    expect(local('--fwm-dk-inset')).toBe(10);
  });

  it('adds the safe area BELOW the 10 rather than inside it', () => {
    /* A margin and not padding: the three heights are border-box and a padding
       here would eat 34px out of the 150 on a notched phone. */
    expect(declared('.fwm-dock', 'margin-bottom')).toBe('env(safe-area-inset-bottom, 0px)');
  });

  it('rounds the pane 24, the tab pill 14 and the map inset 12', () => {
    expect({
      pane: local('--fwm-dk-radius'),
      tab: local('--fwm-dk-tab-radius'),
      inset: local('--fwm-dk-map-radius'),
    }).toStrictEqual({ pane: 24, tab: 14, inset: 12 });
  });

  it('clips the pane so the tab row corners are the pane corners', () => {
    /* One radius on one element. The tab row draws none of its own, which is
       the whole of "the tab bar is the pane's floor, not a second slab". */
    expect(declared('.fwm-dock', 'overflow')).toBe('hidden');
    expect(declared('.fwm-dock-tabs', 'border-radius')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ *
 * G -- one merged pane, one hairline, one divider
 * ------------------------------------------------------------------------ */

describe('one pane, one hairline, one divider', () => {
  it('draws exactly one border on the pane and none on the tab row', () => {
    expect(declared('.fwm-dock', 'border')).toBe(
      'var(--fwm-dk-hairline) solid var(--fwm-dk-edge)',
    );
    expect(declared('.fwm-dock-tabs', 'border')).toBeUndefined();
    expect(declared('.fwm-dock-tabs', 'border-top')).toBeUndefined();
  });

  it('splits the body from the tab row with a 1px divider and nothing else', () => {
    expect(local('--fwm-dk-divider')).toBe(1);
    expect(resolveLength(declared('.fwm-dock-divider', 'height') ?? '', ALL_VARS)).toBe(1);
  });

  it('draws no rule above the meta line, because the seam is gone', () => {
    expect(declared('.fwm-dock-meta', 'border-top')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ *
 * G -- tint 0.72 dark, 0.74 light · grain 2px x 3px @ 2.2%
 * ------------------------------------------------------------------------ */

/** The four layers, in the order the spec puts them in. */
describe('G · four-layer glass', () => {
  it('grounds the pane on the thin glass with the grain over it', () => {
    /* `var(--dr-grain), <ground>` and not the other way round: the grain has to
       ride whatever ground the state uses, so a lit pane keeps its own tint at
       the same 0.72 and still reads as the same glass as the top bar. */
    expect(declared('.fwm-dock', 'background')).toBe('var(--dr-grain), var(--fwm-dk-ground)');
    expect(DOCK_VARS.get('--fwm-dk-ground')).toBe('var(--dr-surface-thin)');
  });

  it('reads the map back through it and lights its top edge without a plate', () => {
    expect(declared('.fwm-dock', 'backdrop-filter')).toBe('var(--dr-blur)');
    /* `--dr-dock-lift` AND NOT `--dr-lift`. Both in-context frames draw the
       pane on `0 12px 34px rgba(0,0,0,0.5)`; `--dr-lift` is `0 10px 30px` at
       the same alpha and belongs to the top bar and the menus. */
    expect(declared('.fwm-dock', 'box-shadow')).toBe(
      'var(--dr-dock-lift), var(--dr-specular)',
    );
  });

  it('holds the tint at 0.72 dark and 0.74 light in tokens.css', () => {
    const thin = [...TOKEN_RULES.matchAll(/--dr-surface-thin:\s*([^;]+);/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    /* The dark declaration first, then every light skin's. Nothing else may
       declare it, and none of them may be 0.84 -- at 0.84 over a near-black
       basemap the blur runs and nothing behind it is bright enough to smear. */
    expect(thin.length).toBeGreaterThan(0);
    expect(thin[0]).toBe('rgba(14, 17, 21, 0.72)');
    expect(thin.slice(1).every((value) => value === 'rgba(255, 255, 255, 0.74)')).toBe(true);
  });

  it('never writes 0.84 on a dock surface', () => {
    const offenders = SOURCES.flatMap((file) =>
      findAll({ name: file.name, text: blankComments(file.text) }, /0\.84/g, () => 'tint 0.84'),
    );
    expect(offenders).toStrictEqual([]);
  });

  it('crosses the grain on coprime 2px and 3px periods at 2.2%', () => {
    /* Coprime on purpose, so the two gradients never phase into a visible
       plaid; 2.2% white is below conscious perception as dots and reads as
       texture. Both live in tokens.css and the pane only names them. */
    const grain = TOKEN_VARS.get('--dr-grain') ?? '';
    expect(grain).toContain('0deg');
    expect(grain).toContain('1px 2px');
    expect(grain).toContain('90deg');
    expect(grain).toContain('1px 3px');
    const ink = [...TOKEN_RULES.matchAll(/--dr-grain-ink:\s*([^;]+);/g)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(ink[0]).toBe('rgba(255, 255, 255, 0.022)');
    /* Light inverts the INK as well as the surface: white grain on white glass
       is invisible, and a light surface hides texture, so it needs more. */
    expect(ink.slice(1).every((value) => value === 'rgba(15, 20, 25, 0.028)')).toBe(true);
  });

  it('lays a lit state tint as a layer over the same 0.72, not as a new ground', () => {
    const lit = cssRules(DOCK_RULES).filter(
      (rule) =>
        rule.selector.includes("data-fwm-state='approaching'") &&
        declarations(rule, DOCK_RULES).some((decl) => decl.prop === 'background'),
    );
    /* ONE RULE, SHARED BY EVERY LIT STATE. A per-state background would be as
       many chances to write a different alpha as there are lit states. */
    expect(lit.length).toBe(1);
    const background = declarations(lit[0] as CssRule, DOCK_RULES).find(
      (decl) => decl.prop === 'background',
    );
    expect(background?.value).toContain('var(--dr-surface-thin)');
    expect(background?.value).toContain('var(--fwm-dk-tint)');
  });
});

/* ------------------------------------------------------------------------ *
 * G -- no grab handle, no expand chevron
 * ------------------------------------------------------------------------ */

describe('G · no grab handle', () => {
  it('names neither the grabber nor the chevron in any file the pane ships', () => {
    /* Deleted, not hidden. A `display: none` leaves something for a screen
       reader to trip over and something for a future reader to restore by
       accident. */
    const offenders = SOURCES.flatMap((file) =>
      findAll(
        { name: file.name, text: blankComments(blankJsComments(file.text)) },
        /grabber|chevron-up|fwm-dock-expand\b/g,
        (hit) => `${hit} -- the spec deletes both`,
      ),
    );
    expect(offenders).toStrictEqual([]);
  });

  it('makes the whole body the tap target instead, as a real button', () => {
    /* A handler on a `<div>` is unreachable by keyboard, invisible to a screen
       reader and has no accessible name; a `role="button"` on a box that
       CONTAINS buttons is invalid nesting. A stretched transparent `<button>`
       is neither. */
    const dock = blankJsComments(source('Dock.tsx').text);
    expect(dock).toContain('className="fwm-dock-tap"');
    expect(dock).toContain('type="button"');
    expect(dock).toContain('aria-label=');
    expect(declared('.fwm-dock-tap', 'position')).toBe('absolute');
    expect(declared('.fwm-dock-tap', 'inset')).toBe('0');
  });

  it('keeps the keys that share a row above the target so a press still lands', () => {
    expect(declared('.fwm-dock-action,\n.fwm-dock-detour', 'position')).toBe('relative');
  });
});

/* ------------------------------------------------------------------------ *
 * G -- the tab row: 63 tall, 47 targets, neutral in all nineteen
 * ------------------------------------------------------------------------ */

describe('the tab row', () => {
  it('is Map, Exposure, Mesh, Lookup, More, in that order', () => {
    expect(DOCK_TABS.map((tab) => tab.label)).toStrictEqual([
      'Map',
      'Exposure',
      'Mesh',
      'Lookup',
      'More',
    ]);
  });

  it('does not carry Report as a sixth destination', () => {
    expect(DOCK_TABS.some((tab) => /report/i.test(tab.label))).toBe(false);
  });

  it('grids exactly five columns', () => {
    expect(declared('.fwm-dock-tabs', 'grid-template-columns')).toBe('repeat(5, minmax(0, 1fr))');
  });

  it('stands 63 tall and gives every column a 47px hit target', () => {
    expect({
      row: resolveLength(declared('.fwm-dock-tabs', 'height') ?? '', ALL_VARS),
      column: resolveLength(declared('.fwm-dock-tab', 'height') ?? '', ALL_VARS),
    }).toStrictEqual({ row: 63, column: 47 });
  });

  /**
   * STATE COLOUR STOPS AT THE DIVIDER, and this is the mechanism rather than
   * the promise: not one rule that touches the tab row may read a per-state
   * local or be narrowed by a state attribute. Tinting the tabs to match a live
   * amber alert would spend amber on furniture and teach a driver to stop
   * trusting it.
   */
  it('stays neutral in all nineteen states, alert or not', () => {
    const stateInk = /--fwm-dk-(?:hue|tint|edge|figure|glyph|headline|sub|tier|ink-2|hue-2)\b/;
    const offenders: string[] = [];
    for (const rule of cssRules(DOCK_RULES)) {
      if (!/\.fwm-dock-tabs?\b/.test(rule.selector)) continue;
      if (/data-fwm-state/.test(rule.selector)) {
        offenders.push(at('dock.css', DOCK_CSS, rule.index, `state-narrowed: ${rule.selector}`));
      }
      for (const decl of declarations(rule, DOCK_RULES)) {
        if (stateInk.test(decl.value)) {
          offenders.push(
            at('dock.css', DOCK_CSS, decl.index, `${rule.selector} reads ${decl.value}`),
          );
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('gives the active tab a surface, not colour alone', () => {
    /* Section 08: 13% accent fill and an accent hairline, exactly the active
       chip in the top bar, because the dock and the bar are one system. */
    expect(declared('.fwm-dock-tab[data-fwm-active]', 'background')).toBe('var(--dr-accent-fill)');
    expect(declared('.fwm-dock-tab[data-fwm-active]', 'border-color')).toBe(
      'var(--dr-dock-accent-line)',
    );
    expect(declared('.fwm-dock-tab[data-fwm-active]', 'color')).toBe('var(--dr-accent)');
  });

  it('is drawn once, by the shell, so no pane can ship without it', () => {
    const dock = blankJsComments(source('Dock.tsx').text);
    expect(dock).toContain('<TabRow activeTab={activeTab} onTab={onTab} />');
    expect(blankJsComments(source('BrowseRow.tsx').text)).not.toContain('TabRow');
  });
});

/* ------------------------------------------------------------------------ *
 * G -- density ramp: 4 tiers, colour AND word
 * ------------------------------------------------------------------------ */

describe('G · the density ramp', () => {
  it('has four tiers on the spec’s own boundaries and no fifth', () => {
    /* 0, 1-5, 6-12, 13+. A downtown grid reading sixty still says `high`:
       escalating past it would cost a hue that alerting needs. */
    expect([0, 1, 5, 6, 12, 13, 60].map(dockDensityTier)).toStrictEqual([
      'clear',
      'low',
      'low',
      'moderate',
      'moderate',
      'high',
      'high',
    ]);
  });

  it('colours the number, the glyph and the word -- and never the pane', () => {
    const tiers = ['clear', 'low', 'moderate', 'high'];
    for (const tier of tiers) {
      const selector = `.fwm-dock-body[data-fwm-density='${tier}']`;
      expect(declared(selector, '--fwm-dk-tier')).toBeDefined();
      expect(declared(selector, '--fwm-dk-figure')).toBeDefined();
      expect(declared(selector, '--fwm-dk-glyph')).toBeDefined();
      /* The ground is the pane's and the ramp may not touch it: text colour is
         WHERE YOU ARE, surface colour is ACT NOW, and keeping them in different
         scopes is what lets density and proximity stay separable at 60mph. */
      expect(declared(selector, '--fwm-dk-ground')).toBeUndefined();
      expect(declared(selector, '--fwm-dk-tint')).toBeUndefined();
      expect(declared(selector, 'background')).toBeUndefined();
    }
  });

  it('rides a word beside the colour for every tier', () => {
    /* Colour never travels alone. Both come off one function so they cannot
       disagree about which tier a count is in. */
    expect(DOCK_TIER_WORD).toStrictEqual({
      clear: 'exposure clear',
      low: 'exposure low',
      moderate: 'exposure moderate',
      high: 'exposure high',
    });
    expect(blankJsComments(source('BrowseRow.tsx').text)).toContain(
      'className="fwm-dock-tier"',
    );
  });

  it('hangs the tier on the body, not on the pane', () => {
    expect(blankJsComments(source('Dock.tsx').text)).toContain(
      'className="fwm-dock-body" data-fwm-density={density}',
    );
  });

  /**
   * THE RAMP MEASURES CAMERAS PER 2 MI AND NOTHING ELSE.
   *
   * `DockData.count` is a slot, not a meaning: ABUSE ZONE's `3` sourced
   * misconduct reports sit in the same field as DENSE AREA's `14` readers.
   * Running the ramp on the first would paint an accountability number in the
   * density hue and print `exposure low` under the words `abuse reports` --
   * one hue carrying two meanings, and a tier word that is not about the thing
   * beside it.
   */
  it('does not run on a count that is not a camera density', () => {
    expect(dockDensityOf('abuse-zone', { count: 3 })).toBeUndefined();
    expect(dockDensityOf('dense', { count: 14 })).toBe('high');
    expect(dockDensityOf('dense', {})).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ *
 * G -- map inset 56 / nav 48 / radius 12, and it is static
 * ------------------------------------------------------------------------ */

describe('G · the map inset', () => {
  it('draws 56 in a drive row and 48 in a navigation row', () => {
    expect({ drive: local('--fwm-dk-map'), nav: local('--fwm-dk-map-nav') }).toStrictEqual({
      drive: 56,
      nav: 48,
    });
  });

  it('puts no live map instance in a dock row', () => {
    /* A MapLibre instance per dock row -- a tile fetch, a raster upload and a
       render loop -- on a phone that is also drawing the real map behind the
       dock. The tile is a static schematic and must stay one. */
    const offenders = SOURCES.flatMap((file) =>
      findAll(
        { name: file.name, text: blankComments(blankJsComments(file.text)) },
        /MiniMap|maplibre|new Map\(/g,
        (hit) => `${hit} -- the inset is a static tile`,
      ),
    );
    expect(offenders).toStrictEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * G -- scrim 180 to 85% ink
 * ------------------------------------------------------------------------ */

describe('G · the scrim', () => {
  it('stands 180 tall behind the dock', () => {
    expect(resolveLength(declared('.fwm-dock-scrim', 'height') ?? '', ALL_VARS)).toBe(180);
  });

  it('runs full bleed, back out through the wrapper’s own 10px inset', () => {
    for (const side of ['right', 'bottom', 'left']) {
      expect(resolveLength(declared('.fwm-dock-scrim', side) ?? '', ALL_VARS)).toBe(-10);
    }
  });

  it('swallows no taps on the map underneath it', () => {
    expect(declared(':root .fwm-shell-dock > .fwm-dock-scrim', 'pointer-events')).toBe('none');
  });
});

/* ------------------------------------------------------------------------ *
 * G -- number 30/800 tabular · secondary action hit 40
 * ------------------------------------------------------------------------ */

describe('G · the figure and the keys', () => {
  it('sets the figure at 30, weight 800', () => {
    expect(resolveLength(declared('.fwm-dock-count', 'font-size') ?? '', ALL_VARS)).toBe(30);
    expect(declared('.fwm-dock-count', 'font-weight')).toBe('800');
  });

  it('keeps every number tabular so a countdown cannot jitter', () => {
    /* `0.8 mi` ticks to `0.7 mi` eight times a minute and proportional digits
       reflow the whole line when it does. */
    expect(declared('.fwm-dock', 'font-variant-numeric')).toBe('tabular-nums');
  });

  it('gives the right slot a 40px hit target despite the 13px label', () => {
    /* Never ship a 13px tap target for someone driving. The row is 24 and must
       not grow, so the PADDING overflows it symmetrically and the box does not. */
    const key = '.fwm-dock-action,\n.fwm-dock-detour';
    expect(resolveLength(declared(key, 'height') ?? '', ALL_VARS)).toBe(40);
    expect(resolveLength(declared(key, 'font-size') ?? '', ALL_VARS)).toBe(13);
    /* `margin: <block> 0` -- only the block half carries the overflow, and the
       inline half must stay zero so the key does not shift the row. */
    const margin = (declared(key, 'margin') ?? '').split(/\s+(?=0$)/);
    expect(resolveLength(margin[0] ?? '', ALL_VARS)).toBe(-8);
    expect(margin[1]).toBe('0');
    expect(resolveLength(declared('.fwm-dock-meta', 'height') ?? '', ALL_VARS)).toBe(24);
  });

  it('always says the verb: `Reroute around N`, never a bare `Around N`', () => {
    /* `Around 3` names a quantity without saying what happens to it, and a
       driver reading four characters at 70mph gets a number and no verb. */
    expect(dockDetourLabel(3)).toBe('Reroute around 3');
    expect(dockDetourSpoken(1)).toBe('Reroute around 1 reader');
    expect(dockDetourSpoken(9)).toBe('Reroute around 9 readers');
    const offenders = SOURCES.flatMap((file) =>
      findAll(
        { name: file.name, text: blankComments(blankJsComments(file.text)) },
        /`Around \$\{|'Around |"Around /g,
        (hit) => `${hit} -- the key always carries the verb`,
      ),
    );
    expect(offenders).toStrictEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * E -- the 56px maneuver row and the 32px footer
 * ------------------------------------------------------------------------ */

describe('E · the navigation skeleton', () => {
  it('opens the maneuver row a step wider than the collapsed split', () => {
    /* 13 and not the split's 12: the maneuver glyph is drawn at 28 to 34 where
       the collapsed lede's is 20, and the spec pushes the readout off it. */
    expect(resolveLength(declared('.fwm-dock-maneuver', 'gap') ?? '', ALL_VARS)).toBe(13);
    expect(resolveLength(declared('.fwm-dock-split', 'gap') ?? '', ALL_VARS)).toBe(12);
  });

  it('splits the maneuver row from the footer with a full-width rule', () => {
    /* Section E says it in words -- `a 56px maneuver row and a 32px footer
       split by a full-width divider` -- and all eight frames draw it as the
       footer's own `border-top`. Inside the 32, so the 170 is untouched. */
    expect(declared('.fwm-dock-footer', 'border-top')).toBe(
      'var(--fwm-dk-divider) solid var(--dr-hairline-row)',
    );
  });

  it('sets the maneuver figure at 26, and takes 30 back only under 800 feet', () => {
    /* The collapsed figure stands alone over one line; a maneuver figure
       carries a unit on its baseline and a road under it. E2 is the one state
       whose number is the whole message. */
    expect(
      resolveLength(declared('.fwm-dock-maneuver .fwm-dock-count', 'font-size') ?? '', ALL_VARS),
    ).toBe(26);
    expect(declared('.fwm-dock-maneuver .fwm-dock-count', 'line-height')).toBe('1.05');
    expect(
      resolveLength(
        declared(
          ".fwm-dock[data-fwm-state='turn-imminent'] .fwm-dock-maneuver .fwm-dock-count",
          'font-size',
        ) ?? '',
        ALL_VARS,
      ),
    ).toBe(30);
  });

  it('sets the unit riding that baseline at 14, not at the footer’s 13', () => {
    expect(resolveLength(declared('.fwm-dock-unit', 'font-size') ?? '', ALL_VARS)).toBe(14);
    expect(declared('.fwm-dock-unit', 'font-weight')).toBe('500');
    expect(
      declared(".fwm-dock[data-fwm-state='turn-imminent'] .fwm-dock-unit", 'font-weight'),
    ).toBe('700');
  });

  it('drops the line under a maneuver to 14, and leaves E2’s at 15 and bold', () => {
    /* Beside a figure the run is 15 and qualifies it; under a readout it is the
       second of two stacked lines and 15 there competes with the number. */
    expect(
      resolveLength(declared('.fwm-dock-maneuver .fwm-dock-caption', 'font-size') ?? '', ALL_VARS),
    ).toBe(14);
    /* The 15 is named rather than measured: `--fwm-dk-t-15` reads
       `--fwm-text-body`, which four of the seventeen skins re-cut, and the
       point of the assertion is that this run takes the BODY size. */
    expect(declared('.fwm-dock-caption', 'font-size')).toBe('var(--fwm-dk-t-15)');
    const e2 = ".fwm-dock[data-fwm-state='turn-imminent'] .fwm-dock-maneuver .fwm-dock-caption";
    expect(declared(e2, 'font-size')).toBe('var(--fwm-dk-t-15)');
    expect(declared(e2, 'font-weight')).toBe('700');
  });

  it('sits the figure and its unit 7 apart, and stacks the pair 1 apart', () => {
    /* Every figure-over-line pair in the file is `gap: 1px`; only the three
       states that draw a 19px sentence instead of a number open it to 2. */
    expect(resolveLength(declared('.fwm-dock-title', 'gap') ?? '', ALL_VARS)).toBe(7);
    expect(resolveLength(declared('.fwm-dock-stack', 'gap') ?? '', ALL_VARS)).toBe(1);
    expect(
      resolveLength(
        declared(".fwm-dock-stack[data-fwm-shape='titled']", 'gap') ?? '',
        ALL_VARS,
      ),
    ).toBe(2);
  });

  it('rounds the 48px turn tile 11 where the 56px map inset takes 12', () => {
    /* Section G compresses both into one `radius 12`; all three 48px tiles the
       file draws are `border-radius: 11px`. The drawing is the more specific
       of the two and the smaller tile wants the tighter corner. */
    expect(local('--fwm-dk-map-nav-radius')).toBe(11);
    expect(
      resolveLength(
        declared(".fwm-dock[data-fwm-pane='navigating'] .fwm-dock-inset", 'border-radius') ?? '',
        ALL_VARS,
      ),
    ).toBe(11);
    expect(resolveLength(declared('.fwm-dock-inset', 'border-radius') ?? '', ALL_VARS)).toBe(12);
  });
});

/* ------------------------------------------------------------------------ *
 * C and F -- the three lists, and the rows in them
 * ------------------------------------------------------------------------ */

describe('C and F · the lists', () => {
  it('draws the nearby row exactly as the file draws it', () => {
    /* `height: 44px; border-radius: 12px; padding: 0 8px; gap: 11px`, a 9px
       dot, and a list inset `5px 10px`. Every one of those is off the drawing
       rather than off a description of it. */
    expect({
      height: resolveLength(declared('.fwm-dock-row', 'height') ?? '', ALL_VARS),
      radius: resolveLength(declared('.fwm-dock-row', 'border-radius') ?? '', ALL_VARS),
      padding: declared('.fwm-dock-row', 'padding'),
      gap: resolveLength(declared('.fwm-dock-row', 'gap') ?? '', ALL_VARS),
      dot: local('--fwm-dk-dot-row'),
      listPadY: local('--fwm-dk-list-pad-y'),
      listPadX: local('--fwm-dk-list-pad-x'),
    }).toStrictEqual({
      height: 44,
      radius: 12,
      padding: '0 var(--fwm-space-2)',
      gap: 11,
      dot: 9,
      listPadY: 5,
      listPadX: 10,
    });
  });

  it('sets a nearby row’s two runs at 14/500 and 12, with the distance 14/700', () => {
    expect(
      resolveLength(declared('.fwm-dock-list .fwm-dock-line', 'font-size') ?? '', ALL_VARS),
    ).toBe(14);
    expect(declared('.fwm-dock-list .fwm-dock-line', 'font-weight')).toBe('500');
    expect(
      resolveLength(declared('.fwm-dock-list .fwm-dock-sub', 'font-size') ?? '', ALL_VARS),
    ).toBe(12);
    expect(
      resolveLength(declared('.fwm-dock-list .fwm-dock-trail', 'font-size') ?? '', ALL_VARS),
    ).toBe(14);
    expect(declared('.fwm-dock-list .fwm-dock-trail', 'font-weight')).toBe('700');
  });

  it('insets each of the three lists at the depth its own frame draws', () => {
    /* 5 over C's 44px rows, 4 over F1's 42px steps, 8 over F2's two 54px cards
       -- and the same 10 across all three, which is what lets a row carry a
       radius and read as a card. */
    expect(local('--fwm-dk-list-pad-steps')).toBe(4);
    expect(local('--fwm-dk-list-pad-routes')).toBe(8);
    expect(
      resolveLength(
        declared(".fwm-dock-list[data-fwm-list='steps']", 'padding-top') ?? '',
        ALL_VARS,
      ),
    ).toBe(4);
    expect(
      resolveLength(
        declared(".fwm-dock-list[data-fwm-list='routes']", 'padding-top') ?? '',
        ALL_VARS,
      ),
    ).toBe(8);
    expect(
      resolveLength(declared(".fwm-dock-list[data-fwm-list='routes']", 'gap') ?? '', ALL_VARS),
    ).toBe(8);
  });

  it('shortens a turn step to 42 and leads it with a 13px distance in a 44 cell', () => {
    /* F1 fits four steps into 135 where C fits four rows into 151, and the two
       pixels come off the row. The fixed cell is what makes a left, a right and
       a merge start their road name at the same x. */
    expect(
      resolveLength(
        declared(".fwm-dock-list[data-fwm-list='steps'] .fwm-dock-row", 'height') ?? '',
        ALL_VARS,
      ),
    ).toBe(42);
    const dist = ".fwm-dock-list[data-fwm-list='steps'] .fwm-dock-trail";
    expect(resolveLength(declared(dist, 'width') ?? '', ALL_VARS)).toBe(44);
    expect(resolveLength(declared(dist, 'font-size') ?? '', ALL_VARS)).toBe(13);
  });

  it('draws a route card 54 tall on a 14 radius, not a 12-radius list row', () => {
    /* F2's rows are a choice between two lines, each with its own ground and
       hairline; F1's are steps already decided. The 11px gap is the nearby
       row's, because a mark leading a line of text is the same object. */
    expect({
      height: resolveLength(declared('.fwm-dock-option', 'height') ?? '', ALL_VARS),
      radius: resolveLength(declared('.fwm-dock-option', 'border-radius') ?? '', ALL_VARS),
      padding: declared('.fwm-dock-option', 'padding'),
      gap: resolveLength(declared('.fwm-dock-option', 'gap') ?? '', ALL_VARS),
    }).toStrictEqual({
      height: 54,
      radius: 14,
      padding: '0 var(--fwm-space-3)',
      gap: 11,
    });
  });

  it('rings the route radio at 1.5 and fills it with a 7px pip', () => {
    /* A 15px ring drawn at the pane's 1px hairline reads as a hole rather than
       as a control, and the pip is 7 against the 8 a bare space step gives. */
    expect(local('--fwm-dk-radio-ring')).toBe(1.5);
    expect(resolveLength(declared('.fwm-dock-radio', 'width') ?? '', ALL_VARS)).toBe(15);
    expect(resolveLength(declared('.fwm-dock-radio-dot', 'width') ?? '', ALL_VARS)).toBe(7);
    expect(resolveLength(declared('.fwm-dock-radio-dot', 'height') ?? '', ALL_VARS)).toBe(7);
  });

  it('sets a route card’s headline at 15, and bolds only the one on offer', () => {
    expect(
      declared(".fwm-dock-list[data-fwm-list='routes'] .fwm-dock-line", 'font-size'),
    ).toBe('var(--fwm-dk-t-15)');
    expect(
      declared(".fwm-dock-option[data-fwm-chosen='true'] .fwm-dock-line", 'font-weight'),
    ).toBe('700');
  });
});

/* ------------------------------------------------------------------------ *
 * The two rules that are not numbers
 * ------------------------------------------------------------------------ */

describe('colour is tokens only, and every token resolves', () => {
  it('writes no hex, rgb(), hsl() or color-mix() in a rule', () => {
    const offenders = SOURCES.flatMap((file) =>
      findAll(
        { name: file.name, text: blankComments(blankJsComments(file.text)) },
        /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|color-mix|oklch)\s*\(/g,
        (hit) => `raw colour ${hit}`,
      ),
    );
    expect(offenders).toStrictEqual([]);
  });

  it('names only tokens that tokens.css or dock.css actually defines', () => {
    /* CSS treats an undefined custom property as no declaration at all -- no
       warning, no fallback, no paint -- so a reference to a token that does not
       exist reads as compliant to a grep and renders as nothing on the phone. */
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const text = blankComments(blankJsComments(file.text));
      const pattern = /var\(\s*(--(?:fwm|dr)-[\w-]+)/g;
      let match = pattern.exec(text);
      while (match !== null) {
        const name = match[1] ?? '';
        if (!ALL_VARS.has(name)) {
          offenders.push(at(file.name, file.text, match.index, `${name} is not declared anywhere`));
        }
        match = pattern.exec(text);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('declares its own locals as --fwm-dk-*, so none can shadow a real token', () => {
    /* tokens.css owns twenty-one `--fwm-dock-*` names. A local of the same name
       would leave two live definitions of one name with different values, one
       shadowing the other inside a subtree. */
    const offenders = [...DOCK_VARS.keys()]
      .filter((name) => name.startsWith('--fwm-') && !name.startsWith('--fwm-dk-'))
      .map((name) => `${DIR}/dock.css  writes ${name}, which is not a --fwm-dk- local`);
    expect(offenders).toStrictEqual([]);
  });

  it('read tokens.css at all, so an empty read cannot pass this suite', () => {
    expect(TOKEN_VARS.size).toBeGreaterThan(200);
    expect(SOURCES.length).toBe(OWNED.length);
  });

  it('draws every mark as SVG and none of them as a character', () => {
    /* A text arrow resolves to whatever glyph the font on that Android build
       happens to carry, which is sometimes nothing at all. */
    const glyphs = ['↑', '→', '←', '↱', '⚑', '◉', '⃠'];
    const offenders = SOURCES.flatMap((file) =>
      glyphs.flatMap((glyph) => {
        const index = file.text.indexOf(glyph);
        return index === -1 ? [] : [at(file.name, file.text, index, `text glyph ${glyph}`)];
      }),
    );
    expect(offenders).toStrictEqual([]);
  });

  it('carries no :hover, because hover never fires on the target device', () => {
    const offenders = SOURCES.flatMap((file) =>
      findAll({ name: file.name, text: blankComments(file.text) }, /:hover\b/g, () => ':hover'),
    );
    expect(offenders).toStrictEqual([]);
  });
});

/**
 * EVERY CLASS THE PANE EMITS HAS A RULE, which is the check that would have
 * caught the defect this describe block exists for.
 *
 * `.fwm-dock-maneuver`, `.fwm-dock-footer`, `.fwm-dock-unit`, `.fwm-dock-head`,
 * `.fwm-dock-option` and the two radio parts shipped with NO declaration
 * anywhere in `dock.css`. Every other check in this file passed: the heights
 * resolved to 150 / 170 / 302 because section 2 sums tokens, and the tokens
 * were right. What was missing was the rules that hand those heights to the
 * rows -- so the pane's own arithmetic was correct and the pane was wrong.
 *
 * An unstyled div is a block. The navigating pane stacked its glyph, its
 * readout and its 48px tile vertically inside a 56px allowance, pushed the
 * footer past the pane's locked height, and clipped both the next-turn sentence
 * and the map inset out of sight. Nothing rendered an error; it just looked
 * like a different product.
 *
 * This reads every class name the dock's components emit and asks the
 * stylesheet whether it has heard of it. It is deliberately a whole-directory
 * check rather than an OWNED-five check: the panes that emit these names are
 * `DriveRows.tsx` and `ExpandedPanel.tsx`, and the whole failure was a seam
 * between files that each looked correct alone.
 */
describe('every emitted class has a rule', () => {
  it('declares every fwm-dock class the components render', () => {
    const emitted = new Set<string>();
    for (const name of readdirSync(HERE)) {
      if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
      const text = readFileSync(`${HERE}/${name}`, 'utf8');
      for (const match of text.matchAll(/["'`\s]((?:fwm-dock-[a-z0-9-]+)(?:\s+fwm-dock-[a-z0-9-]+)*)["'`\s]/g)) {
        for (const one of (match[1] ?? '').split(/\s+/)) if (one !== '') emitted.add(one);
      }
    }

    /* A class the stylesheet never names is one nothing can size, colour or
       lay out. Sorted so a failure reads as a list rather than as one name. */
    const undeclared = [...emitted].filter((name) => !DOCK_CSS.includes(`.${name}`)).sort();
    expect(undeclared).toStrictEqual([]);
  });
});

/**
 * THE FOUR VALUES THE PANE DRAWS THAT THE SHARED CHROME TOKENS DO NOT CARRY,
 * AND THE THREE CASCADE SEATS THAT USED TO EAT THEM.
 *
 * Every number below was read out of `DarkRoute Dock V3 (2).html` -- the two
 * IN-CONTEXT frames for the pane's own values, the LIGHT twin section A draws
 * beside the dark one for the pale re-cuts. Each of the seven shipped WRONG and
 * none of them threw: a shadow one step short, a hairline one hundredth thin,
 * an accent edge four hundredths hot, a scrim missing its middle stop, a card
 * edge borrowing the pane's, an opaque slate where a translucent hairline
 * belongs, and a state rule out-specifying a list row's type size.
 */
describe('the pane values the shared tokens do not carry', () => {
  /** Every declaration of one token, dark first and then each pale skin's. */
  function tokenCuts(name: string): readonly string[] {
    return [...TOKEN_RULES.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map((m) =>
      (m[1] ?? '').trim().replace(/\s+/g, ' '),
    );
  }

  it('lifts the pane on the in-context frames’ shadow, not the top bar’s', () => {
    /* `box-shadow: 0 12px 34px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)`
       -- section A's `COLLAPSED, IN CONTEXT` and section C's `EXPANDED`. The
       tab-cropped state cards draw the same geometry at 0.45; the in-context
       frames are the drawing of the thing that ships. The light twin in the
       same row of section A is `0 12px 30px rgba(15,20,25,0.16)`. */
    const cuts = tokenCuts('--dr-dock-lift');
    expect(cuts[0]).toBe('0 12px 34px rgba(0, 0, 0, 0.5)');
    expect(cuts.slice(1)).toStrictEqual([
      '0 12px 30px rgba(15, 20, 25, 0.16)',
      '0 12px 30px rgba(15, 20, 25, 0.16)',
      '0 12px 30px rgba(15, 20, 25, 0.16)',
    ]);
    /* And it is not the same value as `--dr-lift`, which is what it replaced. */
    expect(tokenCuts('--dr-lift')[0]).toBe('0 10px 30px rgba(0, 0, 0, 0.5)');
  });

  it('draws both dividers at 0.08, not at the footer rule’s 0.07', () => {
    /* `height: 1px; background: rgba(255,255,255,0.08)` five times in the file,
       above the list and below it. The list's own `border-top` IS the divider
       above it, so it takes the same token; it had been an OPAQUE
       `--fwm-line-soft`. The light frame draws `rgba(15,20,25,0.09)`. */
    expect(declared('.fwm-dock-divider', 'background')).toBe('var(--dr-dock-divider)');
    expect(declared('.fwm-dock-list', 'border-top')).toBe(
      'var(--fwm-rule-w) solid var(--dr-dock-divider)',
    );
    const cuts = tokenCuts('--dr-dock-divider');
    expect(cuts[0]).toBe('rgba(255, 255, 255, 0.08)');
    expect(cuts.slice(1)).toStrictEqual([
      'rgba(15, 20, 25, 0.09)',
      'rgba(15, 20, 25, 0.09)',
      'rgba(15, 20, 25, 0.09)',
    ]);
    /* The NAVIGATING pane's footer rule keeps 0.07, and the two are two
       values: the file draws both, in the same pane. */
    expect(tokenCuts('--dr-hairline-row')[0]).toBe('rgba(255, 255, 255, 0.07)');
  });

  it('edges the active tab and the chosen route at 0.38, not 0.42', () => {
    /* `border: 1px solid rgba(47,212,212,0.38)` on the tab row in A and C and
       on F2's taken card. `--dr-accent-line` is 0.42 and is read by surfaces
       this file does not draw. Light: `rgba(9,96,100,0.38)`. */
    expect(declared(".fwm-dock-option[data-fwm-chosen='true']", 'border-color')).toBe(
      'var(--dr-dock-accent-line)',
    );
    const cuts = tokenCuts('--dr-dock-accent-line');
    expect(cuts[0]).toBe('rgba(47, 212, 212, 0.38)');
    expect(cuts.slice(1)).toStrictEqual([
      'rgba(9, 96, 100, 0.38)',
      'rgba(9, 96, 100, 0.38)',
      'rgba(9, 96, 100, 0.38)',
    ]);
    expect(tokenCuts('--dr-accent-line')[0]).toBe('rgba(47, 212, 212, 0.42)');
  });

  it('runs the scrim through the file’s own three stops', () => {
    /* `linear-gradient(to top, rgba(7,9,11,0.85), rgba(7,9,11,0.4) 45%,
       transparent)` -- the 180px sheet in section A's in-context frame. It had
       been two stops of `--fwm-shadow-ink`, which is neither alpha, and the
       missing middle stop straightened the ramp. The light frame draws
       `rgba(233,237,240,0.9)` to `rgba(233,237,240,0.45) 45%`. */
    expect(declared('.fwm-dock-scrim', 'background')).toBe('var(--dr-dock-scrim)');
    const cuts = tokenCuts('--dr-dock-scrim');
    expect(cuts[0]).toBe(
      'linear-gradient( to top, rgba(7, 9, 11, 0.85), rgba(7, 9, 11, 0.4) 45%, transparent )',
    );
    expect(cuts.slice(1)).toStrictEqual([
      'linear-gradient( to top, rgba(233, 237, 240, 0.9), rgba(233, 237, 240, 0.45) 45%, transparent )',
      'linear-gradient( to top, rgba(233, 237, 240, 0.9), rgba(233, 237, 240, 0.45) 45%, transparent )',
      'linear-gradient( to top, rgba(233, 237, 240, 0.9), rgba(233, 237, 240, 0.45) 45%, transparent )',
    ]);
  });

  it('gives an untaken route card the card edge and not the pane’s', () => {
    /* F2's second card: `border: 1px solid rgba(255,255,255,0.08); background:
       rgba(255,255,255,0.035)`. `--dr-card-line` is that 0.08 and
       `--dr-row-fill` that 0.035; `--dr-hairline`, which this had been taking,
       is 0.10 -- the PANE's edge. */
    expect(declared('.fwm-dock-option', 'border')).toBe(
      'var(--fwm-rule-w) solid var(--dr-card-line)',
    );
    expect(declared('.fwm-dock-option', 'background')).toBe('var(--dr-row-fill)');
    expect(tokenCuts('--dr-card-line')[0]).toBe('rgba(255, 255, 255, 0.08)');
    expect(tokenCuts('--dr-row-fill')[0]).toBe('rgba(255, 255, 255, 0.035)');
    expect(tokenCuts('--dr-hairline')[0]).toBe('rgba(255, 255, 255, 0.1)');
  });

  it('lets no state rule out-specify a list row’s 12px second line', () => {
    /* THE ONE THAT SHIPPED AS 13. `.fwm-dock-list .fwm-dock-sub` is (0,2,0) and
       declares the file's
         <div style="font-size: 12px; color: #8d97a1;">{{ c.who }}</div>
       A rule reading `.fwm-dock[data-fwm-state='armed-expanded'] .fwm-dock-sub`
       is (0,3,0) and beat it in the cascade, so the row drew at 13 while the
       token and the rule both still said 12 -- which is why the declared-value
       assertion above passed on a wrong pane.
    
       `.fwm-dock-sub` is emitted in exactly three places, all of them the
       second line of a LIST row inside `ExpandedPanel.tsx`, and the only two
       states that mount that panel are the two expanded ones. So a font-size
       rule scoped to either of those states and NOT to a list can only land on
       a list row. */
    const expanded = ['armed-expanded', 'navigating-expanded'];
    const offenders: string[] = [];
    for (const rule of cssRules(DOCK_RULES)) {
      if (!declarations(rule, DOCK_RULES).some((decl) => decl.prop === 'font-size')) continue;
      for (const raw of rule.selector.split(',')) {
        const one = raw.trim();
        if (!one.endsWith('.fwm-dock-sub')) continue;
        if (one.includes('.fwm-dock-list')) continue;
        if (!expanded.some((state) => one.includes(`'${state}'`))) continue;
        offenders.push(at('dock.css', DOCK_CSS, rule.index, `${one} sets font-size`));
      }
    }
    expect(offenders).toStrictEqual([]);
    expect(
      resolveLength(declared('.fwm-dock-list .fwm-dock-sub', 'font-size') ?? '', ALL_VARS),
    ).toBe(12);
  });

  it('keeps `.fwm-dock-sub` off every element that is not a list row', () => {
    /* The deleted rule's comment called its target "the expanded camera
       header". The head does not carry that class -- it draws its sentence as
       `.fwm-dock-line-meta` -- and a comment that names a target the markup
       does not have is how the wrong number got written down. */
    const panel = readFileSync(`${HERE}/ExpandedPanel.tsx`, 'utf8');
    const uses = [...panel.matchAll(/className="fwm-dock-sub"/g)];
    expect(uses).toHaveLength(3);
    for (const name of readdirSync(HERE)) {
      if (!name.endsWith('.tsx') || name.includes('.test.') || name === 'ExpandedPanel.tsx') {
        continue;
      }
      expect(readFileSync(`${HERE}/${name}`, 'utf8')).not.toContain('fwm-dock-sub');
    }
  });

  it('holds the grain at the file’s own 0.022, which no readback can check', () => {
    /* The file draws `rgba(255,255,255,0.022)` on every one of its grain stops
       and never writes 0.024. A measurement of the built pane reads 0.024
       because Chromium stores a legacy `rgba()` alpha as one byte: 0.022 lands
       on 6/255 and serialises as "0.024", and so does 0.024. The source is the
       only place this value can be checked. */
    expect(tokenCuts('--dr-grain-ink')[0]).toBe('rgba(255, 255, 255, 0.022)');
    expect(Math.round(0.022 * 255)).toBe(Math.round(0.024 * 255));
  });
});
