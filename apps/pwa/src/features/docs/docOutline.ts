/**
 * HOW BIG IS THE THING I JUST OPENED, answered from the document itself.
 *
 * =============================================================================
 * WHY THIS IS A MODULE AND NOT THREE LINES IN THE COMPONENT
 * =============================================================================
 * Every number the reader's size line prints is a MEASUREMENT of the fetched
 * markdown, and the whole reason the line exists is that a reader has no way to
 * judge the length of a document from its title. A measurement that is wrong is
 * worse than no line at all - it makes somebody close a two-screen document
 * because it claimed to be forty. So the counting is here, in a pure function
 * over a string, with its own tests.
 *
 * =============================================================================
 * WHAT COUNTS, AND WHAT DOES NOT
 * =============================================================================
 * SECTIONS are the TOP TWO heading levels and nothing below them. `#` and `##`
 * are the document's own spine; `###` is a term inside a section, and there are
 * 40 of them in TAXONOMY.md against 8 `##`, so counting them would turn "9
 * sections" into "49" and answer a question nobody asked. Measured on
 * `docs/public/TAXONOMY.md`: one `#` and eight `##`, which is the spec page's
 * own `§0 of 9` exactly - §0 is the title and the eight `##` are 1 through 8.
 *
 * WORDS are prose only. Everything inside a fenced code block is excluded,
 * because 243 of TAXONOMY.md's lines are shell and JSON and nobody reads those
 * at prose speed - counting them would inflate the figure by a fifth. Bullet
 * markers, blockquote chevrons and table pipes go too; see `proseOf`.
 *
 * MEASURED, on 2026-09-08, through this function:
 *
 *   TAXONOMY.md        9 sections   7,603 words
 *   DATA-CONTRACTS.md  12           14,230
 *   TERMS.md           11           1,496
 *   LEGAL.md           8            3,356
 *   TRANSPARENCY.md    9            2,488
 *
 * -- the five reachable from DRIVE's map rail. TAXONOMY.md's nine is the spec
 * page's own `§0 of 9`, arrived at independently.
 *
 * =============================================================================
 * WHY THE LINE SAYS WORDS AND NOT MINUTES
 * =============================================================================
 * The spec page draws `§0 of 9 · about 22 min · TAXONOMY.md`. The section count
 * reconciles against the real file exactly. THE TIME DOES NOT: 7,603 words in
 * 22 minutes is 346 words per minute, which is a skimming rate rather than a
 * reading one - the meta-analytic figure for silent reading of English
 * non-fiction is around 238 wpm, and the common convention in this kind of line
 * is 200. At either of those the same document is 32 or 38 minutes. Counting
 * the code as well, which is the most generous reading, still only gets to 402
 * wpm.
 *
 * So the number on the spec page cannot be produced from the document it names,
 * and there is no reading rate anywhere in this product to divide by. Rather
 * than pick one and present the result as though it were measured, this returns
 * the WORD COUNT, which is the same fact without a model in front of it, and
 * `docSize` rounds it so it does not imply a precision that would invite the
 * question "which words".
 *
 * If a rate is chosen, this is the one line that changes:
 *
 *   export const DOC_WPM = 200;
 *   export function docSize(words: number): string {
 *     return `about ${String(Math.max(1, Math.round(words / DOC_WPM)))} min`;
 *   }
 */

/** A top-level entry in a document's spine: `#` or `##`, in document order. */
export interface DocHeading {
  /** 1 for `#`, 2 for `##`. */
  readonly level: 1 | 2;
  readonly text: string;
}

export interface DocOutline {
  /** `#` and `##`, in order. `§N of outline.headings.length` counts these. */
  readonly headings: readonly DocHeading[];
  /** Words outside every fenced code block. */
  readonly words: number;
}

/**
 * The document's spine and its prose length.
 *
 * FENCE STATE IS TRACKED ACROSS THE WHOLE WALK, which is the only subtle part:
 * `# ` is a comment in shell and `## ` is one in several languages, and
 * TAXONOMY.md has fourteen `bash` blocks. Reading headings without tracking the
 * fences finds eight extra `#` lines that are comments in example commands, and
 * `§0 of 17` is then wrong in a way nobody would think to check.
 */
export function docOutline(markdown: string): DocOutline {
  const headings: DocHeading[] = [];
  const prose: string[] = [];
  /** The fence that is open, or null: closes only on the same character, at least as long. */
  let fence: string | null = null;
  /* Front matter is a YAML block between a `---` on the first line and the
     next; `docMarkdown.tsx` never draws it, so its lines are not prose and its
     `title:` is not a heading. Skipped here for the same reason the fences
     are: the two walkers must agree on what the document is. */
  let frontMatter = (markdown.split('\n')[0] ?? '').trim() === '---';
  let first = true;

  for (const line of markdown.split('\n')) {
    if (frontMatter) {
      if (!first && (line.trim() === '---' || line.trim() === '...')) frontMatter = false;
      first = false;
      continue;
    }
    // ``` or ~~~, either of which the renderer treats as a fence, and which
    // it closes only on a run of the same character at least as long.
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (fence === null && run !== null) {
      fence = run;
      continue;
    }
    if (fence !== null) {
      if (run !== null && run.startsWith(fence[0] ?? '') && run.length >= fence.length && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(line)) {
        fence = null;
      }
      continue;
    }

    const heading = /^(#{1,2})\s+(.*)$/.exec(line);
    if (heading !== null) {
      headings.push({
        level: heading[1] === '#' ? 1 : 2,
        text: (heading[2] ?? '').trim(),
      });
      continue;
    }
    prose.push(proseOf(line));
  }

  const words = prose
    .join(' ')
    .split(/\s+/)
    .filter((word) => word !== '').length;

  return { headings, words };
}

/**
 * One line of markdown with its STRUCTURE stripped and its prose left alone.
 *
 * Three markers, and each of them would otherwise be counted as a word by a
 * whitespace split, because markdown puts a space after every one:
 *
 *   `> `        a blockquote. The words inside one are read; the chevron is not.
 *   `- ` / `* ` a bullet.
 *   `|`         a table cell boundary. `| a | b |` splits into five tokens for
 *               two words, so a contract table of forty rows would add a couple
 *               of hundred words that nobody reads as prose.
 *
 * Nothing else is stripped. `**bold**` and `` `code` `` are read as part of the
 * sentence they sit in, so their delimiters ride along with the word they are
 * attached to and change no count.
 */
function proseOf(line: string): string {
  return line
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\|/g, ' ');
}

/**
 * `8,300 words` - the prose length, rounded and separated.
 *
 * ROUNDED TO A HUNDRED because the exact figure is precise about something it
 * cannot be precise about: whether a table cell, a bullet marker or the text of
 * a link is "a word" are three judgements this function makes silently, and
 * printing 8,308 would present them as settled. A document under a hundred
 * words prints its exact count, because rounding `40 words` to `0` would be
 * absurd.
 *
 * `en-US` rather than the runtime locale, deliberately: every other number in
 * this product is grouped the same way regardless of where the phone thinks it
 * is, and a size line that switched separator with the OS language while the
 * document beside it stayed in English would read as a bug.
 */
export function docSize(words: number): string {
  const shown = words < 100 ? words : Math.round(words / 100) * 100;
  return `${shown.toLocaleString('en-US')} word${shown === 1 ? '' : 's'}`;
}

/**
 * Which section a reader is in, from a scroll offset and the offsets of the
 * headings themselves.
 *
 * ZERO-BASED, matching the spec's `§0 of 9`: before the first heading has
 * passed the top of the band you are in §0, which is the document's title and
 * whatever sits under it. `offsets` must be in document order.
 *
 * The comparison is `<=` against the scroll position, so a heading exactly at
 * the top of the band counts as entered. Anything else makes the number flicker
 * back and forth by one as a reader rests on a boundary.
 */
export function docSection(offsets: readonly number[], scrollTop: number): number {
  let index = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    if ((offsets[i] ?? 0) <= scrollTop) index = i;
    else break;
  }
  return index;
}

/**
 * How far through, as a fraction from 0 to 1.
 *
 * A band whose content fits without scrolling has nothing to be part-way
 * through, and dividing by its zero scrollable height would give `Infinity` or
 * `NaN`. It reads as 1: a document you can see all of is a document you have
 * reached the end of.
 */
export function docProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0) return 1;
  return Math.min(1, Math.max(0, scrollTop / scrollable));
}
