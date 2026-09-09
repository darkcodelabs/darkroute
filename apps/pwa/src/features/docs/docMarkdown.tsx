/**
 * MARKDOWN TO ELEMENTS, for the published-document reader.
 *
 * =============================================================================
 * WHY THIS IS A MODULE OF ITS OWN
 * =============================================================================
 * The reader's first renderer lived inside `DocViewScreen.tsx` and handled "the
 * subset these documents actually use" - which was measured against one file
 * and then not measured again. The published set grew to eleven documents and
 * the subset did not keep up. Counted across those eleven on 2026-09-09:
 *
 *   106 thematic breaks (`---`)     drawn as a paragraph reading "---"
 *   119 ordered lists               run together into one paragraph
 *   208 links + 22 autolinks        shown as `[text](url)` and `<url>`
 *   157 italics (`*x*`, `_x_`)      shown with their asterisks and underscores
 *   250 list-continuation lines     pasted into the paragraph after the list
 *     7 nested bullets              likewise
 *    31 table rows with empty cells columns shifted left by every empty one
 *    18 escaped pipes in cells      split the cell in two
 *     5 blockquotes with a list, a fence or a paragraph break inside
 *
 * The owner's screenshot of the terms page shows the first of those. A reader
 * that puts "---" on screen where a rule belongs is telling somebody the text
 * they are agreeing to is broken, and the whole argument of the docs screen is
 * that the rendering IS the repository.
 *
 * So this is a small, complete parser rather than a longer list of special
 * cases: BLOCKS first, into a tree, then INLINES inside each block. Every
 * construct the documents use is here, plus the ones cheap enough that leaving
 * them out would be a trap for the next document (front matter, `~~~` fences,
 * hard breaks, entities, escapes, `<br>`). What it does not understand renders
 * as its own text, never as nothing.
 *
 * =============================================================================
 * IT BUILDS ELEMENTS, NOT HTML - AND IT NEVER TRUSTS A URL
 * =============================================================================
 * The bytes come off the network. Every branch below returns React elements,
 * so there is no path from document text to markup; and a link is only a link
 * if its destination is `http:`, `https:` or `mailto:`. A `javascript:` URL in
 * a document - or in whatever a compromised proxy handed back - renders as the
 * link's words with no anchor around them. Relative links resolve against the
 * document's own URL in the repository, which is where the reader is told the
 * real thing lives anyway. `#anchor` links scroll the reading band, because the
 * heading they name is on this screen.
 *
 * =============================================================================
 * WHAT IS DELIBERATELY NOT HERE
 * =============================================================================
 * Setext headings (a line of `===` or `---` UNDER a title) - zero in the set,
 * and every `---` in it sits between two blank lines, which makes it a rule.
 * `docOutline.ts` counts `#` and `##` lines to make the size line, and it would
 * not see a setext heading; the two must agree or the `§` count names a section
 * the band cannot scroll to. Raw HTML other than `<br>` and comments renders as
 * text, by design. Images render as a link to the file with the alt text as
 * its words: the app's `img-src` would refuse to load them, and a broken image
 * icon says less than the words do.
 */

import { useState } from 'react';
import type { MouseEvent, ReactElement, ReactNode } from 'react';

/** What the code box offers, and what it says once the adapter has answered. */
export const DOC_COPY_IDLE = 'Copy';
export const DOC_COPY_DONE = 'Copied';
export const DOC_COPY_REFUSED = 'No clipboard';

/** The caption on a fence with no info string. */
export const DOC_CODE_LABEL = 'Code';

/** The prefix on every heading id, so a document's anchors cannot collide with the app's own. */
export const DOC_ANCHOR_PREFIX = 'fwm-doc-';

export interface DocRenderOptions {
  /** A fenced block's Copy affordance hands its body here. */
  readonly onCopy: (text: string) => Promise<boolean>;
  /**
   * The document's own URL in the repository. `./OTHER.md` and `../../x` links
   * resolve against it, the same way they do on the page it was written for.
   */
  readonly source: string;
}

/* ===========================================================================
 * BLOCKS
 * ======================================================================== */

type Block =
  | { readonly kind: 'heading'; readonly depth: number; readonly text: string; readonly indented: boolean }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'rule' }
  | { readonly kind: 'code'; readonly language: string; readonly body: string }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly (readonly Block[])[];
    }
  | { readonly kind: 'table'; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] };

/** ``` or ~~~, up to three spaces in, with an optional info string. */
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
/** Three or more of one of `-` `*` `_`, spaces allowed between. Checked before lists: `* * *` is a rule. */
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** `#` to `######`, then a space or the end of the line. `#hashtag` is prose. */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/** The optional closing run of `#`s on a heading, which must follow a space. */
const HEADING_CLOSE = /[ \t]+#+$/;
const QUOTE = /^ {0,3}> ?/;
const QUOTE_START = /^ {0,3}>/;
/** A bullet or an ordered marker, with what follows it captured for the width rule. */
const LIST_MARK = /^( {0,3})([-*+]|\d{1,9}[.)])( *)(.*)$/;
/** A table's delimiter row: cells of hyphens, each optionally flanked by a colon. */
const TABLE_SEP = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const INDENTED = /^ {4}/;
const HTML_COMMENT_OPEN = /^ {0,3}<!--/;

interface ItemStart {
  readonly indent: number;
  /** `-`, `*`, `+` for a bullet; `.` or `)` for an ordered marker. Lists only continue with the same one. */
  readonly type: string;
  readonly ordered: boolean;
  readonly number: number;
  /** How far in the item's content starts, which is what a continuation line must be indented to. */
  readonly width: number;
  readonly rest: string;
}

/** Reads a line as a list item, or returns null when it is not one. */
function itemStart(line: string): ItemStart | null {
  if (RULE.test(line)) return null;
  const m = LIST_MARK.exec(line);
  if (m === null) return null;
  const indent = (m[1] ?? '').length;
  const marker = m[2] ?? '';
  const spaces = (m[3] ?? '').length;
  let rest = m[4] ?? '';
  // `-foo` and `1.foo` are prose: the marker needs a space after it.
  if (spaces === 0 && rest !== '') return null;
  let width = indent + marker.length + Math.min(Math.max(spaces, 1), 4);
  if (spaces > 4) {
    // Five or more spaces after the marker start an indented code block inside
    // the item; the content column is one space in and the rest is indent.
    width = indent + marker.length + 1;
    rest = ' '.repeat(spaces - 1) + rest;
  }
  const ordered = /\d/.test(marker);
  return {
    indent,
    type: ordered ? marker.slice(-1) : marker,
    ordered,
    number: ordered ? Number.parseInt(marker, 10) : 1,
    width,
    rest,
  };
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

/** A pipe row into cells: `\|` is a pipe in a cell, anything else splits it. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Whether `lines[i]` opens a table: a pipe row over a delimiter row with the same cell count. */
function tableStart(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? '';
  const next = lines[i + 1] ?? '';
  if (!line.includes('|') || !TABLE_SEP.test(next)) return false;
  if (!next.includes('|') && !line.trim().startsWith('|')) return false;
  return splitRow(line).length === splitRow(next).length;
}

/**
 * Whether `lines[i]` begins a block that ends the paragraph before it.
 *
 * The list rule is CommonMark's: a bullet may interrupt a paragraph, an ordered
 * item only if it is numbered 1, and neither may be empty. Indented code never
 * interrupts - a line indented four spaces after prose is more of the prose.
 */
function interrupts(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? '';
  if (FENCE.test(line) || RULE.test(line) || HEADING.test(line) || QUOTE_START.test(line)) return true;
  if (HTML_COMMENT_OPEN.test(line) || tableStart(lines, i)) return true;
  const item = itemStart(line);
  if (item !== null && item.rest.trim() !== '' && (!item.ordered || item.number === 1)) return true;
  return false;
}

/** The whole document, less any front matter, as blocks. */
function parseDocument(markdown: string): Block[] {
  const lines = markdown.split('\n').map((line) => line.replace(/\r$/, ''));
  let from = 0;
  /* FRONT MATTER IS NOT PROSE. A `---` on the first line opens a YAML block
     that a site generator reads and a person never should; it closes on the
     next `---` (or `...`). None of the published set carries one today, and
     the day one does it must not print `title: Terms` above the terms. */
  if ((lines[0] ?? '').trim() === '---') {
    for (let i = 1; i < lines.length; i += 1) {
      const line = (lines[i] ?? '').trim();
      if (line === '---' || line === '...') {
        from = i + 1;
        break;
      }
    }
  }
  return parseBlocks(lines.slice(from));
}

function parseBlocks(lines: readonly string[]): Block[] {
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    // Fenced code, kept verbatim. Closes on a fence of the same character at
    // least as long as the opener; an unclosed fence runs to the end.
    const fence = FENCE.exec(line);
    if (fence !== null && !((fence[2] ?? '').startsWith('`') && (fence[3] ?? '').includes('`'))) {
      const indent = (fence[1] ?? '').length;
      const opener = fence[2] ?? '';
      const language = (fence[3] ?? '').trim().split(/\s+/)[0] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(inner);
        if (close !== null && (close[1] ?? '').startsWith(opener[0] ?? '') && (close[1] ?? '').length >= opener.length) {
          i += 1;
          break;
        }
        body.push(inner.slice(Math.min(indent, leadingSpaces(inner))));
        i += 1;
      }
      out.push({ kind: 'code', language, body: body.join('\n') });
      continue;
    }

    if (HTML_COMMENT_OPEN.test(line)) {
      // A comment is for the author of the file, not its reader.
      while (i < lines.length && !(lines[i] ?? '').includes('-->')) i += 1;
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const text = (heading[2] ?? '').replace(HEADING_CLOSE, '').trim();
      out.push({
        kind: 'heading',
        depth: (heading[1] ?? '#').length,
        text: /^#+$/.test(text) ? '' : text,
        indented: line.startsWith(' '),
      });
      i += 1;
      continue;
    }

    if (QUOTE_START.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        if (QUOTE_START.test(inner)) {
          body.push(inner.replace(QUOTE, ''));
          i += 1;
        } else if (!isBlank(inner) && !isBlank(body[body.length - 1]) && !interrupts(lines, i)) {
          // A lazy continuation: prose carrying on under the `>` without one.
          body.push(inner);
          i += 1;
        } else {
          break;
        }
      }
      out.push({ kind: 'quote', blocks: parseBlocks(body) });
      continue;
    }

    if (tableStart(lines, i)) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && (lines[i] ?? '').includes('|')) {
        const cells = splitRow(lines[i] ?? '');
        // Rows keep the header's width: a short row pads, a long one drops the
        // excess, so an empty cell stays in its own column instead of pulling
        // every cell after it one to the left.
        while (cells.length < head.length) cells.push('');
        rows.push(cells.slice(0, head.length));
        i += 1;
      }
      out.push({ kind: 'table', head, rows });
      continue;
    }

    const first = itemStart(line);
    if (first !== null) {
      const items: Block[][] = [];
      while (i < lines.length) {
        const start = itemStart(lines[i] ?? '');
        if (start === null || start.type !== first.type) break;
        const item: string[] = [start.rest];
        i += 1;
        while (i < lines.length) {
          const inner = lines[i] ?? '';
          if (isBlank(inner)) {
            item.push('');
            i += 1;
            continue;
          }
          if (leadingSpaces(inner) >= start.width) {
            item.push(inner.slice(start.width));
            i += 1;
            continue;
          }
          // Less indented than the item's content. A new marker is the next
          // item (or a new list); a line after a blank is whatever it is; and
          // anything else that does not open a block is the item's paragraph
          // carrying on without the indent, as it does on the page.
          if (itemStart(inner) !== null || isBlank(item[item.length - 1]) || interrupts(lines, i)) break;
          item.push(inner.trimStart());
          i += 1;
        }
        while (item.length > 0 && isBlank(item[item.length - 1])) item.pop();
        items.push(parseBlocks(item));
      }
      out.push({ kind: 'list', ordered: first.ordered, start: first.number, items });
      continue;
    }

    if (INDENTED.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (isBlank(lines[i]) || INDENTED.test(lines[i] ?? ''))) {
        body.push((lines[i] ?? '').slice(4));
        i += 1;
      }
      while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
      out.push({ kind: 'code', language: '', body: body.join('\n') });
      continue;
    }

    // A paragraph runs until a blank line or a block that may interrupt it.
    const body: string[] = [line.trimStart()];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines, i)) {
      body.push((lines[i] ?? '').trimStart());
      i += 1;
    }
    out.push({ kind: 'paragraph', text: body.join('\n') });
  }

  return out;
}

/* ===========================================================================
 * INLINES
 * ======================================================================== */

type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'br' }
  | { readonly kind: 'strong' | 'em' | 'del'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] };

/** An unmatched run of `*`, `_` or `~~`, before emphasis is resolved. */
interface Delim {
  readonly kind: 'delim';
  readonly ch: string;
  n: number;
  readonly orig: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

type Token = Inline | Delim;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
};

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const PUNCT = /[\p{P}\p{S}]/u;
const WS = /\s/;

function isWs(ch: string | undefined): boolean {
  return ch === undefined || WS.test(ch);
}

function isPunct(ch: string | undefined): boolean {
  return ch !== undefined && PUNCT.test(ch);
}

/**
 * Where the closing run of `n` backticks sits, or -1. A run of a different
 * length is content: `` `a `` b` `` is one code span reading "a `` b".
 */
function closingTicks(text: string, from: number, n: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 0;
    while (text[i + run] === '`') run += 1;
    if (run === n) return i;
    i += run;
  }
  return -1;
}

interface LinkParts {
  readonly label: string;
  readonly dest: string;
  readonly end: number;
}

/** `[label](dest "title")` starting at `text[start] === '['`, or null. */
function readLink(text: string, start: number): LinkParts | null {
  let depth = 0;
  let j = start;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '`') {
      let run = 0;
      while (text[j + run] === '`') run += 1;
      const close = closingTicks(text, j + run, run);
      j = close === -1 ? j + run : close + run;
      continue;
    }
    if (ch === '[') depth += 1;
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
    j += 1;
  }
  if (j >= text.length || text[j + 1] !== '(') return null;
  const label = text.slice(start + 1, j);

  let k = j + 2;
  while (isWs(text[k]) && k < text.length) k += 1;
  let dest = '';
  if (text[k] === '<') {
    const close = text.indexOf('>', k + 1);
    if (close === -1) return null;
    dest = text.slice(k + 1, close);
    k = close + 1;
  } else {
    let parens = 0;
    while (k < text.length) {
      const ch = text[k] ?? '';
      if (WS.test(ch)) break;
      if (ch === '(') parens += 1;
      if (ch === ')') {
        if (parens === 0) break;
        parens -= 1;
      }
      dest += ch;
      k += 1;
    }
  }
  while (isWs(text[k]) && k < text.length) k += 1;
  const quote = text[k];
  if (quote === '"' || quote === "'" || quote === '(') {
    const close = text.indexOf(quote === '(' ? ')' : quote, k + 1);
    if (close === -1) return null;
    k = close + 1;
    while (isWs(text[k]) && k < text.length) k += 1;
  }
  if (text[k] !== ')') return null;
  return { label, dest, end: k + 1 };
}

/**
 * A destination the reader may follow, or null.
 *
 * ONLY THREE SCHEMES. The document was fetched over the network and a link is
 * the one place its text becomes something the browser acts on. `javascript:`,
 * `data:`, `blob:`, a custom scheme - none of them have any business in a
 * published document, so none of them become a link; the words render and the
 * URL does not. A `#fragment` is an anchor in THIS document. Anything else is
 * relative to where the file lives in the repository.
 */
function resolveHref(dest: string, source: string): string | null {
  const d = dest.trim();
  if (d === '') return null;
  if (d.startsWith('#')) return `#${DOC_ANCHOR_PREFIX}${d.slice(1)}`;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(d);
  if (scheme !== null) {
    const name = (scheme[1] ?? '').toLowerCase();
    return name === 'http' || name === 'https' || name === 'mailto' ? d : null;
  }
  try {
    return new URL(d, source).href;
  } catch {
    return null;
  }
}

function tokenize(text: string, source: string): Token[] {
  const tokens: Token[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') tokens.push({ kind: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';

    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '\n') {
        flush();
        tokens.push({ kind: 'br' });
        i += 2;
        continue;
      }
      if (next !== undefined && ASCII_PUNCT.test(next)) {
        buf += next;
        i += 2;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === '`') {
      let run = 0;
      while (text[i + run] === '`') run += 1;
      const close = closingTicks(text, i + run, run);
      if (close === -1) {
        buf += '`'.repeat(run);
        i += run;
        continue;
      }
      let code = text.slice(i + run, close).replace(/\n/g, ' ');
      if (code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
      flush();
      tokens.push({ kind: 'code', text: code });
      i = close + run;
      continue;
    }

    if (ch === '\n') {
      // Two spaces before the newline are a hard break; otherwise it is the
      // soft break of a wrapped source line, which reads as a space.
      const trimmed = buf.replace(/ +$/, '');
      const hard = buf.length - trimmed.length >= 2;
      buf = trimmed;
      if (hard) {
        flush();
        tokens.push({ kind: 'br' });
      } else {
        buf += ' ';
      }
      i += 1;
      continue;
    }

    if (ch === '<') {
      const rest = text.slice(i);
      const br = /^<br[ \t]*\/?>/i.exec(rest);
      if (br !== null) {
        flush();
        tokens.push({ kind: 'br' });
        i += br[0].length;
        continue;
      }
      const comment = /^<!--[\s\S]*?-->/.exec(rest);
      if (comment !== null) {
        i += comment[0].length;
        continue;
      }
      const auto = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(rest);
      const mail = auto === null ? /^<([\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/.exec(rest) : null;
      const raw = auto?.[1] ?? mail?.[1];
      if (raw !== undefined) {
        const href = resolveHref(mail === null ? raw : `mailto:${raw}`, source);
        if (href !== null) {
          flush();
          tokens.push({ kind: 'link', href, children: [{ kind: 'text', text: raw }] });
          i += (auto ?? mail)?.[0].length ?? 0;
          continue;
        }
      }
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === '&') {
      const entity = /^&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/.exec(text.slice(i));
      if (entity !== null) {
        const name = entity[1] ?? '';
        let decoded: string | undefined;
        if (name.startsWith('#')) {
          const point = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
          decoded = point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�';
        } else {
          decoded = ENTITIES[name];
        }
        if (decoded !== undefined) {
          buf += decoded;
          i += entity[0].length;
          continue;
        }
      }
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
      const at = ch === '!' ? i + 1 : i;
      const link = readLink(text, at);
      if (link !== null) {
        const href = resolveHref(link.dest, source);
        const children = parseInline(link.label, source);
        flush();
        if (href === null) {
          // The words, without the destination. See `resolveHref`.
          tokens.push(...children);
        } else {
          tokens.push({ kind: 'link', href, children });
        }
        i = link.end;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      let n = 0;
      while (text[i + n] === ch) n += 1;
      const before = text[i - 1];
      const after = text[i + n];
      /* CommonMark's flanking rules, which are what keep `snake_case` and
         `2 * 3` as prose while `_this_` and `*this*` become emphasis. */
      const left = !isWs(after) && (!isPunct(after) || isWs(before) || isPunct(before));
      const right = !isWs(before) && (!isPunct(before) || isWs(after) || isPunct(after));
      const canOpen = ch === '_' ? left && (!right || isPunct(before)) : left;
      const canClose = ch === '_' ? right && (!left || isPunct(after)) : right;
      if (ch === '~' && n !== 2) {
        buf += ch.repeat(n);
      } else if (canOpen || canClose) {
        flush();
        tokens.push({ kind: 'delim', ch, n, orig: n, canOpen, canClose });
      } else {
        buf += ch.repeat(n);
      }
      i += n;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush();
  return tokens;
}

/** Leftover delimiter runs are prose; adjacent text runs become one. */
function settle(tokens: readonly Token[]): Inline[] {
  const out: Inline[] = [];
  for (const token of tokens) {
    const inline: Inline = token.kind === 'delim' ? { kind: 'text', text: token.ch.repeat(token.n) } : token;
    const last = out[out.length - 1];
    if (inline.kind === 'text' && last !== undefined && last.kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: last.text + inline.text };
    } else {
      out.push(inline);
    }
  }
  return out;
}

/**
 * CommonMark's "process emphasis": each closer looks back for the nearest
 * opener of its character, the pair wraps what sits between them, and the
 * rule of three decides which pairings a run that could go either way is
 * allowed to make. It is the algorithm rather than a regex because the
 * documents nest these - `**bold with *italics* in it**`, `**`/api/*`**` -
 * and a regex gets one of those right by getting the other wrong.
 */
function resolveEmphasis(tokens: Token[]): Inline[] {
  const bottoms = new Map<string, Token>();
  let i = 0;
  while (i < tokens.length) {
    const closer = tokens[i];
    if (closer === undefined || closer.kind !== 'delim' || !closer.canClose) {
      i += 1;
      continue;
    }
    const key = `${closer.ch}${closer.canOpen ? 'o' : 'c'}${String(closer.orig % 3)}`;
    const bottom = bottoms.get(key);
    let found = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      const opener = tokens[j];
      if (opener === bottom) break;
      if (opener === undefined || opener.kind !== 'delim' || opener.ch !== closer.ch || !opener.canOpen) continue;
      const odd =
        (closer.canOpen || opener.canClose) &&
        (opener.orig + closer.orig) % 3 === 0 &&
        !(opener.orig % 3 === 0 && closer.orig % 3 === 0);
      if (!odd) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      const previous = tokens[i - 1];
      if (previous !== undefined) bottoms.set(key, previous);
      if (!closer.canOpen) tokens[i] = { kind: 'text', text: closer.ch.repeat(closer.n) };
      i += 1;
      continue;
    }
    const opener = tokens[found] as Delim;
    const use = closer.ch === '~' ? 2 : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
    const kind = closer.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em';
    const inner = tokens.splice(found + 1, i - found - 1);
    tokens.splice(found + 1, 0, { kind, children: settle(inner) });
    i = found + 2;
    opener.n -= use;
    closer.n -= use;
    if (closer.n === 0) tokens.splice(i, 1);
    if (opener.n === 0) {
      tokens.splice(found, 1);
      i -= 1;
    }
  }
  return settle(tokens);
}

function parseInline(text: string, source: string): Inline[] {
  return resolveEmphasis(tokenize(text, source));
}

/** The words of an inline tree with no markup: what a heading's anchor is made from. */
function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'text' || node.kind === 'code') return node.text;
      if (node.kind === 'br') return ' ';
      return plain(node.children);
    })
    .join('');
}

/**
 * A heading's anchor, the way GitHub makes one - so the `#7-1-...` links the
 * documents already carry land on the same heading here that they do there.
 * Lowercase; letters, numbers, spaces, hyphens and underscores kept; everything
 * else dropped; spaces to hyphens. Two spaces make two hyphens, which is why
 * `Flow A — from` becomes `flow-a--from`.
 */
export function docSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

/* ===========================================================================
 * ELEMENTS
 * ======================================================================== */

interface CodeBlockProps {
  readonly body: string;
  /** The fence's info string, or '' where it had none. */
  readonly language: string;
  readonly onCopy: (text: string) => Promise<boolean>;
}

/**
 * A FENCED BLOCK: hairlined box, caption, sideways scroller, Copy.
 *
 * THE VERDICT IS THE ADAPTER'S. `writeText` returns false on a browser with no
 * clipboard API, in an insecure context, and when the write is refused; a
 * button that said "Copied" in any of those cases would be a green light wired
 * to nothing, which is the exact failure TEST THE ALERT exists to remove from
 * the settings screen. Three words, three states, and the refusal is drawn in
 * the muted ink so it does not read as a second offer.
 *
 * NOT RESET ON A TIMER. A `setTimeout` back to "Copy" is a second thing to
 * clean up on unmount and it takes the answer away from anybody who looked back
 * a moment later; the next press restates it.
 */
function CodeBlock({ body, language, onCopy }: CodeBlockProps): ReactElement {
  const [copied, setCopied] = useState<boolean | null>(null);

  const label = language === '' ? DOC_CODE_LABEL : language;

  return (
    <div className="fwm-docview-box">
      <div className="fwm-docview-box-head">
        <span className="fwm-docview-box-label">{label}</span>
        <button
          type="button"
          className="fwm-docview-copy"
          data-fwm-copied={copied === null ? 'idle' : String(copied)}
          onClick={() => {
            // USER GESTURE ONLY - every browser refuses a write outside one.
            void onCopy(body).then(setCopied);
          }}
        >
          {copied === null ? DOC_COPY_IDLE : copied ? DOC_COPY_DONE : DOC_COPY_REFUSED}
        </button>
      </div>
      <div className="fwm-docview-scroll">
        <pre className="fwm-docview-code">{body}</pre>
      </div>
    </div>
  );
}

/**
 * An anchor link scrolls the reading band rather than changing the page URL.
 *
 * The reader is an overlay over DRIVE, and a fragment navigation would write a
 * hash into the app's own location that outlives the document it named. The
 * heading is on this screen, so the band goes to it and the URL stays put.
 */
function jumpToAnchor(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  const id = (event.currentTarget.getAttribute('href') ?? '').slice(1);
  const target = event.currentTarget.ownerDocument.getElementById(id);
  if (target !== null) target.scrollIntoView({ block: 'start' });
}

interface RenderState {
  readonly onCopy: (text: string) => Promise<boolean>;
  readonly source: string;
  /** Anchors handed out so far: a repeated heading gets `-1`, `-2`, as on GitHub. */
  readonly anchors: Map<string, number>;
  /* Counts `#` and `##` only, and it is the same rule `docOutline` applies -
     the two must agree or the size line names a section the band cannot scroll
     to. Stamped on the element as `data-fwm-doc-section` so the screen can
     measure where each one sits without holding a ref per heading. */
  section: number;
  key: number;
}

function nextKey(state: RenderState): string {
  state.key += 1;
  return `k${String(state.key)}`;
}

function renderInlines(nodes: readonly Inline[], state: RenderState): ReactNode[] {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text':
        return node.text;
      case 'code':
        return <code key={nextKey(state)}>{node.text}</code>;
      case 'br':
        return <br key={nextKey(state)} />;
      case 'strong':
        return <strong key={nextKey(state)}>{renderInlines(node.children, state)}</strong>;
      case 'em':
        return <em key={nextKey(state)}>{renderInlines(node.children, state)}</em>;
      case 'del':
        return <del key={nextKey(state)}>{renderInlines(node.children, state)}</del>;
      case 'link':
        return node.href.startsWith('#') ? (
          <a key={nextKey(state)} className="fwm-docview-link" href={node.href} onClick={jumpToAnchor}>
            {renderInlines(node.children, state)}
          </a>
        ) : (
          <a
            key={nextKey(state)}
            className="fwm-docview-link"
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
          >
            {renderInlines(node.children, state)}
          </a>
        );
      default:
        return null;
    }
  });
}

function inline(text: string, state: RenderState): ReactNode[] {
  return renderInlines(parseInline(text, state.source), state);
}

function renderHeading(block: Extract<Block, { kind: 'heading' }>, state: RenderState, top: boolean): ReactElement {
  const nodes = parseInline(block.text, state.source);
  const base = docSlug(plain(nodes));
  const seen = state.anchors.get(base) ?? 0;
  state.anchors.set(base, seen + 1);
  const id = `${DOC_ANCHOR_PREFIX}${seen === 0 ? base : `${base}-${String(seen)}`}`;
  const key = nextKey(state);
  const children = renderInlines(nodes, state);

  /* THE SECTION MARK GOES ON THE `#` AND `##` HEADINGS AND NOWHERE ELSE, and
     only at the top of the document - `docOutline` reads unindented lines, so
     a heading inside a list or a quote is drawn but not counted. `###` is a
     term inside a section - 40 of them against 8 in TAXONOMY.md - and marking
     those would make the size line count 49 sections and answer a question
     nobody asked. */
  const counted = top && block.depth <= 2 && !block.indented;
  if (counted) state.section += 1;
  const mark = counted ? { 'data-fwm-doc-section': String(state.section) } : {};

  if (block.depth === 1) {
    return (
      <h2 className="fwm-docview-h1" id={id} key={key} {...mark}>
        {children}
      </h2>
    );
  }
  if (block.depth === 2) {
    return (
      <h3 className="fwm-docview-h2" id={id} key={key} {...mark}>
        {children}
      </h3>
    );
  }
  if (block.depth === 3) {
    return (
      <h4 className="fwm-docview-h3" id={id} key={key}>
        {children}
      </h4>
    );
  }
  // `####` and below are one rank: the documents use `####` for a term under a
  // term, and there is no fifth level of structure a phone screen could show.
  return (
    <h5 className="fwm-docview-h4" id={id} key={key}>
      {children}
    </h5>
  );
}

/**
 * The blocks of a list item or a callout. One paragraph on its own is drawn
 * as the container's own text - `<li>words</li>`, the way a tight list reads
 * on the page - and anything more keeps its blocks.
 */
function renderInner(blocks: readonly Block[], state: RenderState): ReactNode[] {
  const only = blocks[0];
  if (blocks.length === 1 && only !== undefined && only.kind === 'paragraph') {
    return inline(only.text, state);
  }
  return renderBlocks(blocks, state, false);
}

function renderBlocks(blocks: readonly Block[], state: RenderState, top: boolean): ReactElement[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'rule':
        return <hr className="fwm-docview-rule" key={nextKey(state)} />;
      case 'heading':
        return renderHeading(block, state, top);
      case 'paragraph':
        return (
          <p className="fwm-docview-p" key={nextKey(state)}>
            {inline(block.text, state)}
          </p>
        );
      case 'code':
        return <CodeBlock key={nextKey(state)} body={block.body} language={block.language} onCopy={state.onCopy} />;
      case 'quote':
        // A callout. The one construct that says "read this differently".
        return (
          <blockquote className="fwm-docview-callout" key={nextKey(state)}>
            {renderInner(block.blocks, state)}
          </blockquote>
        );
      case 'list': {
        const key = nextKey(state);
        const items = block.items.map((item) => (
          <li key={nextKey(state)}>{renderInner(item, state)}</li>
        ));
        return block.ordered ? (
          <ol
            className="fwm-docview-list fwm-docview-list-ordered"
            key={key}
            {...(block.start === 1 ? {} : { start: block.start })}
          >
            {items}
          </ol>
        ) : (
          <ul className="fwm-docview-list" key={key}>
            {items}
          </ul>
        );
      }
      case 'table': {
        // Rendered as rows rather than flattened: these documents use them for
        // contracts, where the columns are the content.
        const key = nextKey(state);
        return (
          <div className="fwm-docview-tablewrap" key={key}>
            <table className="fwm-docview-table">
              <thead>
                <tr>
                  {block.head.map((cell) => (
                    <th key={nextKey(state)}>{inline(cell, state)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={nextKey(state)}>
                    {row.map((cell) => (
                      <td key={nextKey(state)}>{inline(cell, state)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return <></>;
    }
  });
}

/**
 * Markdown to elements.
 *
 * `onCopy` is threaded through rather than reached for inside {@link CodeBlock}
 * because this is called from a `useMemo` and the adapter set belongs to the
 * screen - a module-level `createPlatformAdapters()` here would make one
 * clipboard instance per import rather than per screen.
 */
export function renderDocMarkdown(markdown: string, options: DocRenderOptions): ReactElement[] {
  const state: RenderState = {
    onCopy: options.onCopy,
    source: options.source,
    anchors: new Map(),
    section: -1,
    key: 0,
  };
  return renderBlocks(parseDocument(markdown), state, true);
}
