/**
 * THE MENU LANGUAGE, AND THE DECLARATIONS THAT MAKE IT THE DRAWING.
 *
 * Two halves, and they check different kinds of thing.
 *
 * THE RENDERED HALF asks what each row type draws and what it reports. jsdom
 * has a DOM, so that much is real -- and the three rules that are not geometry
 * (one accent fill, the dot is the taxonomy, the state is spelled out) are all
 * checkable there.
 *
 * SEVEN TYPES, NOT SIX. `MenuSlider` was added for MAP VIEW's warn distance --
 * the spec draws no control that is dragged, and the alternative was one panel
 * keeping a private slider while its two neighbours spoke the language. It is
 * held to the same two rules as everything else here, and the geometry half
 * below pins it to the row height and the switch's own disc rather than letting
 * it carry numbers of its own.
 *
 * THE SOURCE HALF reads `menu.css` off disk and resolves what it declares. It
 * has to, twice over: vitest runs with `css: false`, which stubs every
 * stylesheet import -- `?raw` included -- to the empty string, so an assertion
 * against an import would pass on '' whatever the file said; and jsdom does not
 * lay out and does not cascade custom properties, so `getComputedStyle(row)
 * .height` is '' in this environment. `TopBar.test.tsx` and
 * `dockConformance.test.ts` read their stylesheets the same way for the same
 * two reasons, and the resolver below is theirs.
 *
 * EVERY ONE OF THESE FAILS SILENTLY IF IT BREAKS. A 40px row, a switch whose
 * knob no longer fits its track, a header that lost its tracking, an accent
 * fill that spread to a second row -- not one of them throws, and not one is
 * visible in a unit test that only renders. The browser measurement that proves
 * the layout is recorded in the report this file was written beside; this is
 * the cheap guard that fails in CI when somebody tidies a declaration away.
 */

import { readFileSync } from 'node:fs';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  Menu,
  MenuAction,
  MenuFilter,
  MenuGroup,
  MenuHeader,
  MenuNavigate,
  MenuNote,
  MenuReportIcon,
  MenuRule,
  MenuSelect,
  MenuSlider,
  MenuToggle,
} from './Menu.tsx';

/* ------------------------------------------------------------------------ *
 * THE STYLESHEET, AND A CALCULATOR FOR WHAT IT DECLARES
 * ------------------------------------------------------------------------ */

/** `import.meta.dirname` is real under vitest; the app's types do not declare it. */
const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

/** Comments blanked, so prose that quotes a banned value is not read as one. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, (chunk) => chunk.replace(/[^\n]/gu, ' '));
}

const CSS: string = blankComments(readFileSync(`${HERE}/menu.css`, 'utf8'));
const TOKENS: string = blankComments(
  readFileSync(`${HERE}/../../styles/tokens.css`, 'utf8'),
);

/** One rule's body, by selector. */
function block(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector} in menu.css`).toBeGreaterThan(-1);
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
 * Flat and last-wins because that is what the cascade does with the tokens this
 * file reads: `--fwm-space-1`, `--fwm-space-2`, `--fwm-space-3`,
 * `--fwm-rule-w`, `--fwm-radius-full` and `--fwm-card-track-tight` are declared
 * once at `:root` and re-cut by no skin, which is why the geometry can be
 * resolved here at all. `--fwm-space-4` is NOT one of them, which is why
 * `menu.css` never reads it.
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
 * A length resolved through the tokens and the arithmetic, in its own unit.
 *
 * Arithmetic only -- digits, `+ - * /`, parentheses -- evaluated by a parser
 * and never by `new Function`: a test that pulls a string out of a stylesheet
 * should not be able to run it. Anything the tokeniser does not fully consume
 * (a stray unit, an unresolved name) throws rather than quietly reading zero.
 */
function measure(expression: string, unit: RegExp): number {
  const flat = substitute(expression).replace(/calc/giu, '').replace(unit, '');
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

/** A length in px. */
const px = (expression: string): number => measure(expression, /px/giu);
/** A tracking value in em. */
const em = (expression: string): number => measure(expression, /em/giu);

/* ------------------------------------------------------------------------ *
 * WHAT THE SEVEN TYPES DRAW
 * ------------------------------------------------------------------------ */

describe('the seven row types', () => {
  /* 1 -- SELECT. The current choice, and the ONLY accent fill in the language.
     It is also the only row the spec gives no `cursor: pointer`, so it is not
     a control here either. */
  it('states the current selection rather than offering it', () => {
    const { container } = render(
      <Menu>
        <MenuSelect label="All owners" count={1010} />
      </Menu>,
    );
    const row = container.querySelector('[data-fwm-row="select"]');
    expect(row?.tagName).toBe('DIV');
    expect(row?.closest('button')).toBeNull();
    expect(screen.getByText('All owners')).toBeInTheDocument();
    expect(screen.getByText('1010')).toBeInTheDocument();
  });

  /* THE COUNT IS BARE DIGITS. The spec draws `1010`, not `1,010`; a separator
     would be a formatting decision the design has not made. */
  it('draws a count without a separator the design never chose', () => {
    render(
      <Menu>
        <MenuSelect label="All owners" count={1010} />
      </Menu>,
    );
    expect(screen.queryByText('1,010')).not.toBeInTheDocument();
  });

  /* 2 -- FILTER. THE DOT IS THE TAXONOMY. The row's text is the label and the
     count and nothing else -- an owner name spelled out beside the dot is the
     failure this guards. */
  it('carries the owner in the dot and never as a text tag', () => {
    const { container } = render(
      <Menu>
        <MenuFilter owner="police" label="POLICE / AGENCY" count={1} onPress={vi.fn()} />
      </Menu>,
    );
    const dot = container.querySelector('.fwm-menu-dot');
    expect(dot).toHaveAttribute('data-fwm-owner', 'police');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot?.textContent).toBe('');
    expect(screen.getByRole('button').textContent).toBe('POLICE / AGENCY1');
  });

  it('reports a filter press and decides nothing itself', () => {
    const onPress = vi.fn();
    render(
      <Menu>
        <MenuFilter owner="flock" label="INTER-AGENCY SHARED" count={2} onPress={onPress} />
      </Menu>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  /* A HANDLER LEFT OFF MEANS "NOT WIRED IN THIS BUILD", and the row says so
     rather than looking live and doing nothing. */
  it('renders an unwired row disabled rather than live-looking and inert', () => {
    const { container } = render(
      <Menu>
        <MenuFilter owner="hoa" label="HOA / NEIGHBORHOOD" count={0} />
        <MenuNavigate label="Set theme" value="Night watch" />
        <MenuAction icon={<MenuReportIcon />} label="Report a camera here" />
      </Menu>,
    );
    for (const key of container.querySelectorAll('button')) {
      expect(key).toBeDisabled();
    }
  });

  /* 3 -- TOGGLE. THE STATE IS SPELLED OUT. The words are visible text and
     `aria-checked` is the same fact for a screen reader, so the picture and the
     announcement cannot drift apart. */
  it('spells the toggle state out in words beside the switch', () => {
    render(
      <Menu>
        <MenuToggle
          label="Roadwork"
          state="off — not a policy layer"
          on={false}
          onToggle={vi.fn()}
        />
      </Menu>,
    );
    expect(screen.getByText('off — not a policy layer')).toBeInTheDocument();
    const knob = screen.getByRole('switch', { name: 'Roadwork' });
    expect(knob).toHaveAttribute('aria-checked', 'false');
  });

  /* THE ROW IS NOT THE TARGET; THE SWITCH IS. The spec gives the toggle row no
     `cursor: pointer`, so a second target here would be a control nobody drew. */
  it('makes the switch the only target in a toggle row', () => {
    render(
      <Menu>
        <MenuToggle label="Alerts" state="sound and haptics on" on onToggle={vi.fn()} />
      </Menu>,
    );
    const keys = screen.getAllByRole('switch');
    expect(keys).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('reports the flip and holds no state of its own', () => {
    const onToggle = vi.fn();
    render(
      <Menu>
        <MenuToggle label="Alerts" state="sound and haptics on" on onToggle={onToggle} />
      </Menu>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Alerts' }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  /* THE TWO AXES A SECOND LOOK RIDES ON, AND THEIR DEFAULTS ARE THE DRAWING.
     `tone` and `filled` exist so brief 4's abuse menu can be red on thin glass
     with one row singled out. Neither may move the default a millimetre: an
     un-toned panel and an unflagged toggle must render exactly what was
     measured against the spec, which means NO ATTRIBUTE at all rather than a
     `false` or a `'default'` some future stylesheet could start selecting on. */
  it('writes no tone and no fill unless it is asked for one', () => {
    const { container } = render(
      <Menu>
        <MenuToggle label="Alerts" state="sound and haptics on" on onToggle={vi.fn()} />
      </Menu>,
    );
    expect(container.querySelector('.fwm-menu')).not.toHaveAttribute('data-fwm-tone');
    expect(container.querySelector('.fwm-menu-row')).not.toHaveAttribute('data-fwm-filled');
  });

  it('carries the tone on the panel and the fill on the row that asked', () => {
    const { container } = render(
      <Menu tone="abuse">
        <MenuToggle label="Layer" state="on the map" on filled onToggle={vi.fn()} />
        <MenuToggle label="Alerts" state="sound and haptics" on={false} onToggle={vi.fn()} />
      </Menu>,
    );
    expect(container.querySelector('.fwm-menu')).toHaveAttribute('data-fwm-tone', 'abuse');
    const filled = container.querySelectorAll('[data-fwm-filled="true"]');
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveTextContent('Layer');
  });

  /* AND THE LANGUAGE PAINTS NEITHER. Both are inert here by construction --
     `menu.css` has no rule for either, because the accent fill is the select
     row's alone (pinned two tests below) and no shadow may do a hairline's
     work. A tone's look is published by the file that owns the tone. */
  it('leaves both axes unpainted by the language itself', () => {
    expect(CSS).not.toMatch(/data-fwm-tone='abuse'/u);
    expect(CSS).not.toMatch(/data-fwm-filled/u);
  });

  /* 4 -- NAVIGATE. Label, value, chevron. */
  it('right-aligns the navigate row’s current value under a chevron', () => {
    const { container } = render(
      <Menu>
        <MenuNavigate label="Set theme" value="Night watch" onOpen={vi.fn()} />
      </Menu>,
    );
    expect(screen.getByText('Night watch')).toHaveClass('fwm-menu-value');
    const svg = container.querySelector('.fwm-menu-chevron');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('fill', 'none');
  });

  it('reports the navigate press', () => {
    const onOpen = vi.fn();
    render(
      <Menu>
        <MenuNavigate label="Set theme" value="Night watch" onOpen={onOpen} />
      </Menu>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  /* 5 -- ACTION. Icon and label, tinted to its own hue -- carried as a tone
     attribute so the stylesheet owns the colour and this file owns none. */
  it('tints the action row through its tone and not through a colour', () => {
    const { container } = render(
      <Menu>
        <MenuAction icon={<MenuReportIcon />} label="Report a camera here" onAct={vi.fn()} />
      </Menu>,
    );
    const row = container.querySelector('[data-fwm-row="action"]');
    expect(row).toHaveAttribute('data-fwm-tone', 'report');
    const svg = row?.querySelector('svg');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  /* 6 -- NOTE. No row, no border. It must not be one of the 44px rows. */
  it('draws the note as prose and not as a row', () => {
    const { container } = render(
      <Menu>
        <MenuNote>Display only — every camera is still watched.</MenuNote>
      </Menu>,
    );
    expect(container.querySelector('.fwm-menu-note')).toBeInTheDocument();
    expect(container.querySelector('.fwm-menu-row')).toBeNull();
  });

  /* 7 -- SLIDER. The one type with no drawing behind it. What it must keep is
     the two halves of the toggle row it was built from: the value in words, and
     a control that reports and decides nothing. */
  it('gives the slider the reading as its accessible value, not its position', () => {
    render(
      <Menu>
        <MenuSlider
          label="Warn me at"
          value="500 ft"
          at={5}
          min={0}
          max={10}
          onChange={vi.fn()}
        />
      </Menu>,
    );
    const input = screen.getByRole('slider', { name: 'Warn me at' });
    /* Without this a reader announces "5 of 10", which is a position on a list
       and says nothing about a distance. The visible reading and the announced
       one are the same string by construction. */
    expect(input).toHaveAttribute('aria-valuetext', '500 ft');
    expect(screen.getByText('500 ft')).toHaveClass('fwm-menu-value');
    expect((input as HTMLInputElement).value).toBe('5');
  });

  it('reports where the thumb landed and never what it means', () => {
    const onChange = vi.fn();
    render(
      <Menu>
        <MenuSlider label="Warn me at" value="500 ft" at={5} min={0} max={10} onChange={onChange} />
      </Menu>,
    );
    fireEvent.change(screen.getByRole('slider'), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  /* A HANDLER LEFT OFF MEANS "NOT WIRED IN THIS BUILD" here too. */
  it('renders an unwired slider disabled rather than live-looking and inert', () => {
    render(
      <Menu>
        <MenuSlider label="Warn me at" value="500 ft" at={5} min={0} max={10} />
      </Menu>,
    );
    expect(screen.getByRole('slider')).toBeDisabled();
  });

  /* THE NOTE IS THE LANGUAGE'S OWN NOTE, not a second style of muted line
     drawn inside the row. A slider is the one row whose value is a number the
     driver has to be told the meaning of, so the two travel together -- but
     they are still a row and a note, and the note is not one of the 44px
     rows. */
  it('draws the slider’s note as the language’s note, outside the row', () => {
    const { container } = render(
      <Menu>
        <MenuSlider
          label="Warn me at"
          value="500 ft"
          at={5}
          min={0}
          max={10}
          note="how close a reader gets before the app speaks up"
          onChange={vi.fn()}
        />
      </Menu>,
    );
    const note = container.querySelector('.fwm-menu-note');
    expect(note).toHaveTextContent('how close a reader gets before the app speaks up');
    expect(note?.closest('.fwm-menu-row')).toBeNull();
  });

  it('draws no note at all when it was given none', () => {
    const { container } = render(
      <Menu>
        <MenuSlider label="Warn me at" value="500 ft" at={5} min={0} max={10} onChange={vi.fn()} />
      </Menu>,
    );
    expect(container.querySelector('.fwm-menu-note')).toBeNull();
  });

  /* NO SEVENTH ROW TYPE APPEARED BY ACCIDENT. A rule is a group boundary, not
     a row -- the slider above is the seventh, and it is a row. */
  it('draws the group boundary as a separator and not as a row', () => {
    const { container } = render(
      <Menu>
        <MenuRule />
      </Menu>,
    );
    expect(container.querySelector('.fwm-menu-rule')).toHaveAttribute('role', 'separator');
    expect(container.querySelector('.fwm-menu-row')).toBeNull();
  });

  /* A GROUP ADDS NO GEOMETRY. It is where "rows never mix types inside a
     group" gets a name for assistive technology, and nothing else. */
  it('names a group without adding a row to it', () => {
    render(
      <Menu>
        <MenuGroup label="owners">
          <MenuFilter owner="private" label="PRIVATE / BUSINESS" count={8} onPress={vi.fn()} />
        </MenuGroup>
      </Menu>,
    );
    const group = screen.getByRole('group', { name: 'owners' });
    expect(group.querySelectorAll('.fwm-menu-row')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * THE WHOLE PANEL, AS THE SPEC ASSEMBLES IT
 * ------------------------------------------------------------------------ */

describe('the panel the spec draws, rebuilt from the set', () => {
  function drawn(): HTMLElement {
    const { container } = render(
      <Menu>
        <MenuHeader label="What the map draws" sub="on this phone" />
        <MenuSelect label="All owners" count={1010} />
        <MenuGroup label="owners">
          <MenuFilter owner="police" label="POLICE / AGENCY" count={1} onPress={vi.fn()} />
          <MenuFilter owner="flock" label="INTER-AGENCY SHARED" count={2} onPress={vi.fn()} />
          <MenuFilter owner="hoa" label="HOA / NEIGHBORHOOD" count={0} onPress={vi.fn()} />
          <MenuFilter owner="private" label="PRIVATE / BUSINESS" count={8} onPress={vi.fn()} />
          <MenuFilter owner="unverified" label="UNVERIFIED REPORTS" count={999} onPress={vi.fn()} />
        </MenuGroup>
        <MenuRule />
        <MenuGroup label="layers">
          <MenuToggle
            label="Roadwork"
            state="off — not a policy layer"
            on={false}
            onToggle={vi.fn()}
          />
          <MenuToggle label="Alerts" state="sound and haptics on" on onToggle={vi.fn()} />
        </MenuGroup>
        <MenuNavigate label="Set theme" value="Night watch" onOpen={vi.fn()} />
        <MenuAction icon={<MenuReportIcon />} label="Report a camera here" onAct={vi.fn()} />
        <MenuNote>Display only — every camera is still watched.</MenuNote>
      </Menu>,
    );
    return container;
  }

  it('is ten rows, one rule and one note', () => {
    const container = drawn();
    /* One select, five filters, two toggles, one navigate, one action. */
    expect(container.querySelectorAll('.fwm-menu-row')).toHaveLength(10);
    expect(container.querySelectorAll('.fwm-menu-rule')).toHaveLength(1);
    expect(container.querySelectorAll('.fwm-menu-note')).toHaveLength(1);
  });

  /* EXACTLY ONE PER GROUP, EVER. Two select rows in one panel is the failure
     that makes the accent fill stop meaning anything. */
  it('accents exactly one row', () => {
    expect(drawn().querySelectorAll('[data-fwm-row="select"]')).toHaveLength(1);
  });

  /* ALWAYS LAST, NEVER MORE THAN ONE. The note is prose under it, not a row. */
  it('puts the one action last among the rows', () => {
    const container = drawn();
    const rows = [...container.querySelectorAll('.fwm-menu-row')];
    const actions = rows.filter((row) => row.getAttribute('data-fwm-row') === 'action');
    expect(actions).toHaveLength(1);
    expect(rows.at(-1)).toBe(actions[0]);
  });

  /* NO TEXT-CHARACTER GLYPHS ANYWHERE. Everything the panel renders is a
     string the caller passed; the radio, the dots, the knob and the two icons
     are geometry. */
  it('renders no glyph the caller did not write', () => {
    const text = drawn().textContent ?? '';
    const strings = [
      'What the map draws',
      'on this phone',
      'All owners',
      '1010',
      'POLICE / AGENCY',
      '1',
      'INTER-AGENCY SHARED',
      '2',
      'HOA / NEIGHBORHOOD',
      '0',
      'PRIVATE / BUSINESS',
      '8',
      'UNVERIFIED REPORTS',
      '999',
      'Roadwork',
      'off — not a policy layer',
      'Alerts',
      'sound and haptics on',
      'Set theme',
      'Night watch',
      'Report a camera here',
      'Display only — every camera is still watched.',
    ];
    expect(text).toBe(strings.join(''));
  });

  /* THE FIVE OWNER HUES, and the dot is the only place any of them appears. */
  it('draws one dot per owner and nothing else in the palette', () => {
    const container = drawn();
    const owners = [...container.querySelectorAll('.fwm-menu-dot')].map((dot) =>
      dot.getAttribute('data-fwm-owner'),
    );
    expect(owners).toEqual(['police', 'flock', 'hoa', 'private', 'unverified']);
  });
});

/* ------------------------------------------------------------------------ *
 * WHAT IT MEASURES
 * ------------------------------------------------------------------------ */

describe('the menu’s geometry, resolved through the tokens', () => {
  const panel = block('.fwm-menu');

  it('is a radius-20 panel padded 14 with a 4px gap', () => {
    expect(px(decl(panel, 'border-radius'))).toBe(20);
    expect(px(decl(panel, 'padding'))).toBe(14);
    expect(px(decl(panel, 'gap'))).toBe(4);
  });

  it('wears the denser menu surface behind a 1px hairline', () => {
    expect(decl(panel, 'background')).toBe('var(--dr-surface-menu)');
    expect(px(decl(panel, 'border').split(' ')[0] ?? '')).toBe(1);
    expect(decl(panel, 'backdrop-filter')).toBe('var(--dr-blur)');
  });

  /* A GROUP RE-STATES THE PANEL'S GAP AND NOTHING ELSE, so a grouped run and a
     loose run measure identically and the spec's flat panel stays buildable. */
  it('gives a group the panel’s own gap and no geometry of its own', () => {
    const group = block('.fwm-menu-group');
    expect(px(decl(group, 'gap'))).toBe(4);
    expect(group).not.toMatch(/padding|margin|border/u);
  });

  it('sets the header at 11 on 0.14em of tracking over a 13px sub-line', () => {
    const label = block('.fwm-menu-head-label');
    expect(decl(label, 'font-size')).toBe('var(--fwm-text-micro)');
    expect(em(decl(label, 'letter-spacing'))).toBeCloseTo(0.14, 10);
    expect(decl(label, 'text-transform')).toBe('uppercase');
    expect(decl(label, 'color')).toBe('var(--dr-accent)');

    const sub = block('.fwm-menu-head-sub');
    expect(decl(sub, 'font-size')).toBe('var(--fwm-text-forecast)');
    expect(decl(sub, 'color')).toBe('var(--dr-ink-muted)');
  });

  /* EVERY ROW IS 44. There is no other row height in the language. */
  it('is 44 tall on a radius-12 row padded 0 12', () => {
    const row = block('.fwm-menu-row');
    expect(px(decl(row, 'height'))).toBe(44);
    expect(px(decl(row, 'border-radius'))).toBe(12);
    const padding = decl(row, 'padding').split(/\s+/u);
    expect(padding).toHaveLength(2);
    expect(padding[0]).toBe('0');
    expect(px(padding[1] ?? '')).toBe(12);
    expect(decl(row, 'background')).toBe('var(--dr-row-fill)');
    expect(px(decl(row, 'border').split(' ')[0] ?? '')).toBe(1);
  });

  /* 11 WHERE A ROUND MARK LEADS THE ROW, 10 WHERE A WORD DOES. */
  it('gaps a row by what leads it', () => {
    expect(px(decl(block(".fwm-menu-row[data-fwm-row='select']"), 'gap'))).toBe(11);
    expect(px(decl(block(".fwm-menu-row[data-fwm-row='filter']"), 'gap'))).toBe(11);
    expect(px(decl(block(".fwm-menu-row[data-fwm-row='action']"), 'gap'))).toBe(11);
    const worded = block(
      ".fwm-menu-row[data-fwm-row='toggle'],\n.fwm-menu-row[data-fwm-row='navigate']",
    );
    expect(px(decl(worded, 'gap'))).toBe(10);
  });

  /* THE RADIO IS 15 WITH A 1.5 RING AND A 7 CORE; THE OWNER DOT IS 9 AND
     SOLID. They are never the same size, because they never mean the same
     thing -- one says which one, the other says whose. */
  /* The ring is asserted as DECLARED. Chrome floors a border to a whole CSS
     pixel and paints 1 -- measured at scale factors 1, 2, 2.75 and 3 -- which
     is also what the spec page itself renders. See the note in `menu.css`. */
  it('draws a 15px radio with a 7px core and a 9px owner dot', () => {
    const radio = block('.fwm-menu-radio');
    expect(px(decl(radio, 'width'))).toBe(15);
    expect(px(decl(radio, 'height'))).toBe(15);
    expect(px(decl(radio, 'border').split(' ')[0] ?? '')).toBe(1.5);
    expect(px(decl(block('.fwm-menu-radio-core'), 'width'))).toBe(7);
    expect(px(decl(block('.fwm-menu-dot'), 'width'))).toBe(9);
    expect(px(decl(block('.fwm-menu-dot'), 'height'))).toBe(9);
  });

  /* THE ONLY ACCENT FILL IN THE LANGUAGE IS THE CURRENT SELECTION -- plus the
     on switch, which is the same claim about a two-state row. Anything else
     reaching for it means the panel has stopped saying one thing. */
  it('fills with accent in exactly two places', () => {
    const selected = block(".fwm-menu-row[data-fwm-row='select']");
    expect(decl(selected, 'background')).toBe('var(--dr-accent-fill)');
    expect(decl(selected, 'border-color')).toBe('var(--dr-accent-line)');
    expect(CSS.match(/--dr-accent-fill/gu) ?? []).toHaveLength(2);
  });

  /* THE SWITCH IS FOUR NUMBERS THAT ARE ONE NUMBER. 23 - 2 (edges) - 4
     (inset) = 17 is the knob exactly, and 40 - 2 - 4 = 34 = 17 x 2 is its
     travel exactly. This is the arithmetic the brief states and it holds. */
  it('fits a 17px knob in a 40 x 23 track with 17px of travel', () => {
    const track = block('.fwm-menu-switch');
    const w = px(decl(track, 'width'));
    const h = px(decl(track, 'height'));
    const edge = px(decl(track, 'border').split(' ')[0] ?? '');
    const inset = px(decl(track, 'padding'));
    const knob = px(decl(block('.fwm-menu-switch-knob'), 'width'));

    expect(w).toBe(40);
    expect(h).toBe(23);
    expect(edge).toBe(1);
    expect(inset).toBe(2);
    expect(knob).toBe(17);
    expect(h - edge * 2 - inset * 2).toBe(knob);
    expect(w - edge * 2 - inset * 2).toBe(knob * 2);
  });

  /* THE KNOB'S SIDE IS FLEX ALIGNMENT KEYED OFF `aria-checked` -- the same
     attribute a screen reader announces -- never a computed offset. */
  it('moves the knob by the attribute a screen reader reads', () => {
    expect(decl(block('.fwm-menu-switch'), 'justify-content')).toBe('flex-start');
    expect(decl(block(".fwm-menu-switch[aria-checked='true']"), 'justify-content')).toBe(
      'flex-end',
    );
    expect(CSS).not.toMatch(/translate|left:|right:/u);
  });

  /* THE SLIDER IS THE ONE ROW THAT IS NOT 44, and it is two of them: a 44 head
     so its label lands on the baseline every other label does, and a 44 band so
     the whole control drags rather than only the 8px bar. If either number
     stops being the row's own, the seventh type has started inventing geometry
     the other six do not have. */
  it('builds the slider out of the row height rather than a number of its own', () => {
    const head = block('.fwm-menu-slider-head');
    expect(px(decl(head, 'height'))).toBe(44);
    expect(px(decl(head, 'gap'))).toBe(10);

    const band = block('.fwm-menu-slider');
    expect(px(decl(band, 'height'))).toBe(44);

    const row = block(".fwm-menu-row[data-fwm-row='slider']");
    expect(px(decl(row, 'padding-bottom'))).toBe(12);
  });

  /* AN 8 TRACK UNDER A 23 DISC, and the 23 is the switch's height exactly --
     the two controls the language can put on a row present the same size of
     thing to a thumb. The disc is centred on the track by half their
     difference, which WebKit needs and Firefox does for itself. */
  it('sits a switch-sized disc on an 8px track in both engines', () => {
    const track = px(decl(block('.fwm-menu-slider::-webkit-slider-runnable-track'), 'height'));
    const moz = px(decl(block('.fwm-menu-slider::-moz-range-track'), 'height'));
    expect(track).toBe(8);
    expect(moz).toBe(track);

    const thumb = block('.fwm-menu-slider::-webkit-slider-thumb');
    const disc = px(decl(thumb, 'width'));
    expect(disc).toBe(px(decl(block('.fwm-menu-switch'), 'height')));
    expect(px(decl(thumb, 'height'))).toBe(disc);
    expect(px(decl(thumb, 'margin-top'))).toBe((track - disc) / 2);
    expect(px(decl(block('.fwm-menu-slider::-moz-range-thumb'), 'width'))).toBe(disc);
  });

  /* THE ACCENT GOES ON THE THUMB AND NOWHERE ELSE ON THIS CONTROL. A track
     that fills behind the thumb needs `::-moz-range-progress`, which has no
     WebKit twin, so it would be a picture one engine draws and the other does
     not -- and the fill would be a third accent fill besides. The empty track
     takes the switch's own off-track ground, because an unlit track and an
     unlit switch are the same claim. */
  it('spends the accent on the thumb and leaves the track unlit', () => {
    expect(decl(block('.fwm-menu-slider::-webkit-slider-thumb'), 'background')).toBe(
      'var(--dr-accent)',
    );
    expect(decl(block('.fwm-menu-slider::-moz-range-thumb'), 'background')).toBe(
      'var(--dr-accent)',
    );
    expect(decl(block('.fwm-menu-slider::-webkit-slider-runnable-track'), 'background')).toBe(
      'var(--dr-row-hover)',
    );
    expect(CSS).not.toMatch(/range-progress/u);
  });

  it('rules two groups apart with 1px inset 4, six of air either side', () => {
    const rule = block('.fwm-menu-rule');
    expect(px(decl(rule, 'height'))).toBe(1);
    const margin = decl(rule, 'margin').split(/\s+/u);
    expect(px(margin[0] ?? '')).toBe(6);
    expect(px(margin[1] ?? '')).toBe(4);
    expect(decl(rule, 'background')).toBe('var(--dr-hairline-row)');
  });

  it('sets the note at 12 muted with no ground and no edge', () => {
    const note = block('.fwm-menu-note');
    expect(decl(note, 'font-size')).toBe('var(--fwm-text-plate)');
    expect(decl(note, 'color')).toBe('var(--dr-ink-muted)');
    expect(note).not.toMatch(/background|border/u);
  });

  /* THE TYPE RAMP, ROW BY ROW. 14/700 accent on a select, 13/500 on a filter,
     14/500 on a toggle or navigate label, 13 muted on a value, 14/700 on an
     action. No other size appears in the language. */
  it('reads type off the scale and nowhere else', () => {
    const sizes = CSS.match(/font-size:[^;]+;/gu) ?? [];
    expect(sizes).not.toHaveLength(0);
    for (const size of sizes) {
      expect(size).toMatch(/var\(--fwm-text-(micro|forecast|label|plate)\)/u);
    }
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
    /* `calc(... * 11)` and `var(--fwm-space-3)`, never `44px`. Zero carries no
       design decision and `padding: 0 ...` needs it. */
    expect(CSS).not.toMatch(/(?<![\w.#-])(?!0)(?:\d*\.)?\d+(?:px|rem|em)\b/u);
  });

  /* `--fwm-space-4` is re-cut to 12 by two skins, so a 16 written through it
     is a 12 on a watch. It is never read here. */
  it('never reads a scale token a skin re-cuts', () => {
    expect(CSS).not.toMatch(/--fwm-space-4\b/u);
  });

  /* TOUCH-FIRST. The spec draws a hover fill on the filter, navigate and
     action rows; hover never fires on the target device and the gate rejects
     the selector outright. Dropped, not translated into an `:active` the spec
     never drew. */
  it('states no hover', () => {
    expect(CSS).not.toMatch(/:hover/u);
  });

  /* THE ONE RULE: if you can see an edge, it is a hairline. The brief spells
     the bar's material out with `--dr-lift` and `--dr-specular` and spells the
     panel's out without them, and a cast shadow is what the one rule bans by
     name. */
  it('lets no shadow do a hairline’s work', () => {
    expect(CSS).not.toMatch(/drop-shadow\s*\(/u);
    expect(CSS).not.toMatch(/box-shadow/u);
  });
});
