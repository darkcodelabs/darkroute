/**
 * STREET NAMES, AS A PERSON WOULD WRITE THEM.
 * =============================================================================
 * The archive stores street and cross values in the mapper's own casing, and
 * for most of the US extract that is SHOUTED: `W 111TH ST`, `COLLEGE BLVD`,
 * `ANTIOCH RD`. The dock's expanded list drew them verbatim, so a driver
 * glancing at the nearby readers got four rows of block capitals where the spec
 * draws `Antioch Rd & W 119th St`.
 *
 * That is not a cosmetic difference at a windscreen. Capitals remove the
 * ascender-and-descender shape that makes a word identifiable without reading
 * it, which is the whole reason a road sign is set in mixed case. A list you
 * have to READ rather than recognise is a list you look at for longer.
 *
 * =============================================================================
 * WHY THIS IS NOT `text-transform: capitalize`
 * =============================================================================
 * That CSS rule uppercases the first letter of every word and leaves the rest
 * alone, so `W 111TH ST` stays `W 111TH ST` - every letter is already the first
 * letter of nothing. It also cannot know that `111TH` must become `111th` and
 * not `111Th`, that `NW` stays `NW`, or that `US` is not `Us`.
 *
 * So the casing is done in TypeScript, where the exceptions can be written
 * down, and the result is a string the test can assert.
 *
 * NOTHING HERE INVENTS A NAME. Every transformation is a case change over the
 * characters the archive already holds. A word this cannot classify is title
 * cased, which is the safe default: wrong casing is a blemish, and a wrong NAME
 * would be a camera at an address that does not exist.
 */

/**
 * Words that are acronyms rather than words, kept upper.
 *
 * DIRECTIONS AND ROUTE CLASSES ONLY. `ST` is deliberately absent - it is far
 * more often `Street` than `Saint` in this archive, and `St` reads correctly
 * for both.
 */
const KEEP_UPPER = new Set([
  'NE',
  'NW',
  'SE',
  'SW',
  'US',
  'SR',
  'FM',
  'RM',
  'CR',
  'I',
  'N',
  'S',
  'E',
  'W',
]);

/** `111TH` -> `111th`, `2ND` -> `2nd`. The ordinal suffix is never capitalised. */
const ORDINAL = /^(\d+)(ST|ND|RD|TH)$/i;

/** `MCKINLEY` -> `McKinley`. Scots and Irish prefixes the plain rule gets wrong. */
const MAC = /^(MC|MAC)([A-Z])(.+)$/i;

/** `O'BRIEN` -> `O'Brien`, and the same for a hyphenated pair. */
const SPLIT_ON = /([-'’])/;

function titleWord(word: string): string {
  if (word === '') return word;

  const ordinal = ORDINAL.exec(word);
  if (ordinal !== null) return `${ordinal[1] ?? ''}${(ordinal[2] ?? '').toLowerCase()}`;

  if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase();

  const mac = MAC.exec(word);
  if (mac !== null) {
    const prefix = (mac[1] ?? '').toLowerCase();
    const head = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    return `${head}${(mac[2] ?? '').toUpperCase()}${(mac[3] ?? '').toLowerCase()}`;
  }

  /* A hyphen or an apostrophe starts a new word: `WAL-MART`, `O'BRIEN`. The
     separators are kept because `split` was given a capturing group. */
  if (SPLIT_ON.test(word)) {
    return word
      .split(SPLIT_ON)
      .map((part) => (SPLIT_ON.test(part) ? part : titleWord(part)))
      .join('');
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Title case a place name the archive shouted.
 *
 * ALREADY-MIXED INPUT IS LEFT ALONE. A mapper who wrote `Antioch Rd` meant it,
 * and re-casing their string would be this module overruling the person who
 * stood at the pole. Only a value with no lower-case letter at all is treated
 * as shouted, which is the one case that is unambiguous.
 */
export function placeCase(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/[a-z]/.test(trimmed)) return trimmed;
  return trimmed.split(/\s+/).map(titleWord).join(' ');
}
