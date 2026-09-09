#!/usr/bin/env node
/**
 * PROMOTE REVIEWED MISUSE CANDIDATES INTO THE RECORD FILE.
 *
 * `scripts/misuse-patrol.mjs` finds reporting and files a candidate with five
 * empty fields. A person then opened every one of those articles, filled in
 * `fips`, `agency`, `summary`, `incidents` and `year`, and moved the entry into
 * `apps/pwa/public/records/counties.json`. At 143 candidates that read is the
 * bottleneck, and this script exists to end it.
 *
 * WHAT THIS REPLACES IS THE READING. IT IS NOT WHAT REPLACES THE JUDGEMENT.
 *
 * `counties.json` makes public allegations of misconduct about named
 * law-enforcement agencies and shows them to drivers inside those agencies'
 * jurisdictions. Its own header states the standard: "An entry without a source
 * a reader can open is not a record, it is an accusation." The human review
 * that this script inherits has already caught a candidate that claimed a
 * guilty plea where the article said the officer pleaded NOT guilty. Automating
 * the reading must not automate that mistake, so the judgement is encoded here
 * rather than dropped:
 *
 *   1. NOTHING IS PROMOTED OFF A HEADLINE. The article is fetched. A fetch that
 *      fails, redirects to a paywall stub, or returns anything but HTML leaves
 *      the candidate PENDING - never dropped and never promoted. A number that
 *      came from a non-200 is not a finding.
 *   2. THE MODEL PROPOSES, THE SCRIPT DISPOSES. The language model extracts, and
 *      must attach a verbatim quote from the article to every load-bearing
 *      claim. Every quote is then re-checked against the fetched text by code
 *      the model does not get to talk past. A quote that is not in the article
 *      is a fabrication and the candidate is dropped.
 *   3. AN ACCUSATION, A CHARGE, A PLEA AND A CONVICTION ARE FOUR DIFFERENT
 *      CLAIMS. `disposition` is extracted as its own field, ranked, and the
 *      summary is scanned for language that outranks it. A summary may restate
 *      the disposition or something weaker. It may never upgrade one.
 *   4. AN ARTICLE THAT RECORDS A NOT-GUILTY PLEA CAN NEVER PRODUCE A GUILTY
 *      RECORD. That is `contested-plea` below, and it has no override.
 *   5. REFUSING IS A GOOD OUTCOME. Every drop is printed with its reason and
 *      written back onto the candidate, so a queue that empties to nothing is a
 *      successful run and a legible one.
 *
 * THE ERROR DIRECTION IS DELIBERATE. Every gate here is built to over-refuse.
 * A dropped candidate costs one article a person can still read by hand; a
 * wrongly promoted one publishes a false allegation about a named police
 * department to the people it polices. Where a rule is crude, it is crude in
 * the direction of dropping.
 *
 * THIS IS NOT A BUILD STEP AND IT MUST NEVER RUN IN CI. It spends money, it
 * reaches the live internet, and it writes the allegation file. It refuses to
 * start when `CI` or `GITHUB_ACTIONS` is set. `scripts/check-record-citations.mjs`
 * is the CI gate and stays exactly as it is; this script runs it as a
 * subprocess after writing and rolls both files back if it goes red.
 *
 * USAGE
 *   node scripts/promote-misuse-candidates.mjs                 # dry run, prints the plan
 *   node scripts/promote-misuse-candidates.mjs --write         # commit the plan
 *   node scripts/promote-misuse-candidates.mjs --limit 5       # examine the first 5
 *   node scripts/promote-misuse-candidates.mjs --only <url>    # examine one candidate
 *   node scripts/promote-misuse-candidates.mjs --recheck       # re-examine past drops
 *   node scripts/promote-misuse-candidates.mjs --prune         # delete refusals, don't annotate
 *   node scripts/promote-misuse-candidates.mjs --json          # machine-readable report
 *   node scripts/promote-misuse-candidates.mjs --model <id>   # override ANTHROPIC_MODEL
 *   node scripts/promote-misuse-candidates.mjs --pause <ms>   # gap between sources (default 1500)
 *
 * Needs ANTHROPIC_API_KEY in the environment. The key is read once, sent only
 * to api.anthropic.com, and never printed, written or included in the report.
 *
 * Exit codes: 0 = ran, 1 = a run or a post-write check failed, 2 = usage error.
 */

import { spawnSync } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSourceUrl } from './misuse-patrol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RECORDS = resolve(ROOT, 'apps/pwa/public/records/counties.json');
const CANDIDATES = resolve(ROOT, 'apps/pwa/public/records/candidates.json');
const GAZETTEER = resolve(ROOT, 'apps/pwa/public/cameras/counties.json');
const CITATION_CHECK = resolve(HERE, 'check-record-citations.mjs');

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/*
 * OVERRIDABLE, AND WRONG IS SAFE. `--model` or ANTHROPIC_MODEL replaces this.
 * An id this API does not recognise comes back as an error, which this script
 * files as PENDING - so a stale default costs a re-run, never a bad record.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 2048;

const USER_AGENT = 'DarkRoute-misuse-promoter/1.0 (+https://darkroute.ai)';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_ARTICLE_BYTES = 4_194_304;
const MIN_ARTICLE_CHARS = 600;
const DEFAULT_PAUSE_MS = 1_500;

const MIN_QUOTE_CHARS = 20;
const MAX_QUOTE_CHARS = 600;
const MIN_SUMMARY_CHARS = 80;
const MAX_SUMMARY_CHARS = 1500;
const MIN_YEAR = 1990;
const MAX_INCIDENTS = 10_000;

export class UsageError extends Error {}

/**
 * EVERY WAY THIS SCRIPT CAN REFUSE A CANDIDATE.
 *
 * A DROP is a judgement about the SOURCE: the script read the article and will
 * not make a record out of it. Drops are final until a person overrules them.
 */
export const DROP_REASONS = Object.freeze({
  UNSAFE_SOURCE_HOST: 'unsafe-source-host',
  NOT_MISUSE: 'not-misuse',
  NO_ALPR_SUBJECT: 'no-alpr-subject',
  NO_MISUSE_LANGUAGE: 'no-misuse-language',
  QUOTE_NOT_IN_ARTICLE: 'quote-not-in-article',
  AGENCY_NOT_NAMED: 'agency-not-named',
  AGENCY_NOT_LAW_ENFORCEMENT: 'agency-not-law-enforcement',
  AGENCY_NOT_IN_ARTICLE: 'agency-not-in-article',
  COUNTY_UNRESOLVED: 'county-unresolved',
  COUNTY_AMBIGUOUS: 'county-ambiguous',
  LOCATION_NOT_IN_ARTICLE: 'location-not-in-article',
  DISPOSITION_UNKNOWN: 'disposition-unknown',
  DISPOSITION_EXCEEDS_ARTICLE: 'disposition-exceeds-article',
  CONTESTED_PLEA: 'contested-plea',
  SUMMARY_UPGRADES_DISPOSITION: 'summary-upgrades-disposition',
  SUMMARY_OMITS_AGENCY: 'summary-omits-agency',
  SUMMARY_MALFORMED: 'summary-malformed',
  INCIDENTS_NOT_INTEGER: 'incidents-not-integer',
  INCIDENTS_NOT_COUNTED: 'incidents-not-counted',
  YEAR_UNSUPPORTED: 'year-unsupported',
  RECORD_FAILS_CITATION_CHECK: 'record-fails-citation-check',
});

/**
 * EVERY WAY THIS SCRIPT CAN FAIL TO REACH A JUDGEMENT.
 *
 * A PENDING is a statement about US, not about the source: the article was not
 * read, so nothing about it is known. A pending candidate stays in the queue
 * and is examined again on the next run. It is never a drop, because "we could
 * not fetch it" is not evidence that an article documents nothing.
 */
export const PENDING_REASONS = Object.freeze({
  FETCH_FAILED: 'fetch-failed',
  NOT_HTML: 'not-html',
  ARTICLE_TOO_SHORT: 'article-too-short',
  MODEL_UNAVAILABLE: 'model-unavailable',
  MODEL_OUTPUT_UNPARSEABLE: 'model-output-unparseable',
  MODEL_SHAPE_INVALID: 'model-shape-invalid',
  EXAMINATION_FAILED: 'examination-failed',
});

/** Not a refusal: the source is already cited in the record file. */
export const SKIP_ALREADY_RECORDED = 'already-recorded';

/* ==========================================================================
 * TEXT
 * ========================================================================== */

const ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['ndash', '-'],
  ['mdash', '-'],
  ['lsquo', "'"],
  ['rsquo', "'"],
  ['ldquo', '"'],
  ['rdquo', '"'],
  ['hellip', '...'],
  ['amp;', '&'],
]);

export function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    const inner = String(body);
    if (inner.startsWith('#')) {
      const hex = inner[1] === 'x' || inner[1] === 'X';
      const digits = hex ? inner.slice(2) : inner.slice(1);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return ENTITIES.get(inner.toLowerCase()) ?? whole;
  });
}

/**
 * ONE SPELLING FOR BOTH SIDES OF A QUOTE COMPARISON.
 *
 * A newsroom CMS emits curly quotes, non-breaking spaces and soft hyphens that
 * a model reproducing a sentence will silently straighten. Comparing raw text
 * would reject honest quotes and teach whoever runs this to stop trusting the
 * check. Comparing THESE forms rejects only invented ones.
 */
export function normalizeForMatch(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/gu, '"')
    .replace(/[\u2010-\u2015\u2212]/gu, '-')
    .replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

/** Is this quote actually in the article, rather than a plausible sentence? */
export function quoteIsInArticle(quote, articleText) {
  const needle = normalizeForMatch(quote);
  if (needle.length < MIN_QUOTE_CHARS) return false;
  if (needle.length > MAX_QUOTE_CHARS) return false;
  if (needle.split(' ').length < 3) return false;
  return normalizeForMatch(articleText).includes(needle);
}

const BLOCK_TAGS =
  /<\/?(?:p|div|br|li|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|figcaption|blockquote)\b[^>]*>/gi;

/** HTML to something a model can read, with the parts that are not prose removed. */
export function htmlToText(html) {
  const stripped = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

/* ==========================================================================
 * DISPOSITION - AN ACCUSATION IS NOT A CHARGE IS NOT A PLEA IS NOT A CONVICTION
 * ========================================================================== */

/**
 * WHY THE NEGATION IS MASKED BEFORE ANYTHING IS MATCHED.
 *
 * "not guilty plea" contains the substring "guilty plea". A scanner looking for
 * a guilty plea finds one in the sentence that says the opposite. That is not a
 * hypothetical - it is the exact error the human review caught, and a regex is
 * a faster way to make it than a tired reader is.
 *
 * So denials are replaced with a token first. NEGPLEA carries no letters that
 * any pattern below looks for, so once "pleaded not guilty" has become
 * "pleaded NEGPLEA" there is no arrangement of these patterns that can read it
 * as an admission.
 *
 * The mask can only ever LOWER the claim a text appears to make. Applied to the
 * ARTICLE that lowers the ceiling, which causes refusals - safe. Applied to the
 * SUMMARY it would loosen the check, so the summary gets only the minimal mask:
 * exactly the "not guilty" collocation, and nothing else. A summary that says
 * "the officer did not plead guilty" is therefore refused rather than parsed,
 * which is the right way round.
 */
const NEG_MASK = ' NEGPLEA ';
const NOT_GUILTY = /\bnot[\s-]+guilty\b/gi;
const DENIALS = [
  /\b(?:did|does|do|has|have|had|was|were|is|are|will|would|never|refused to)\s+not\s+plea?d\w*(?:\s+\w+){0,2}\s+guilty\b/gi,
  /\bnever\s+plea?d\w*\s+guilty\b/gi,
  /\bwithout\s+(?:a\s+)?guilty\s+plea\b/gi,
  /\bmaintain(?:s|ed|ing)?\s+(?:his|her|their|its)\s+innocence\b/gi,
];

/** The minimal mask: the "not guilty" collocation only. Safe on a summary. */
export function maskNotGuilty(text) {
  return String(text).replace(NOT_GUILTY, NEG_MASK);
}

/** The full mask, including denials. Only ever applied to the article. */
export function maskDenials(text) {
  let masked = maskNotGuilty(text);
  for (const pattern of DENIALS) masked = masked.replace(pattern, NEG_MASK);
  return masked;
}

/**
 * THE LADDER, RANKED BY HOW STRONG A CLAIM THE RUNG MAKES ABOUT A PERSON.
 *
 * This is not the order of a court docket - it is the order of assertion. An
 * allegation asserts least. A conviction asserts most. `acquitted` sits at zero
 * because an exoneration can never be an upgrade of anything.
 *
 * `pleaded_not_guilty` outranks `charged` because entering a plea is a further
 * fact, and sits below `pleaded_guilty` because it is the denial of it. Nothing
 * in this file lets the second be written where the first was read.
 */
export const DISPOSITIONS = Object.freeze([
  {
    id: 'acquitted',
    rank: 0,
    label: 'acquitted or cleared',
    phrases: [
      /\bacquitted\b/i,
      /\bfound\s+NEGPLEA\b/i,
      /\bcharges?\s+(?:were\s+|was\s+)?(?:dropped|dismissed)\b/i,
      /\bcleared\s+of\s+(?:any\s+)?wrongdoing\b/i,
      /\bexonerated\b/i,
      /\bunfounded\b/i,
    ],
  },
  {
    id: 'accused',
    rank: 1,
    label: 'accused or alleged',
    phrases: [
      /\baccused\s+of\b/i,
      /\baccusations?\b/i,
      /\balleged(?:ly)?\b/i,
      /\ballegations?\b/i,
      /\bcomplaint\s+(?:was\s+)?filed\b/i,
      /\bclaims?\s+that\s+(?:the\s+)?officer\b/i,
    ],
  },
  {
    id: 'under_investigation',
    rank: 2,
    label: 'under investigation',
    phrases: [
      /\bunder\s+investigation\b/i,
      /\binternal\s+(?:affairs\s+)?(?:investigation|review|inquiry)\b/i,
      /\b(?:opened|launched|began)\s+an?\s+(?:internal\s+)?(?:investigation|review|inquiry)\b/i,
      /\bis\s+investigating\b/i,
      /\breferred\s+(?:the\s+)?(?:case|matter)\s+to\b/i,
    ],
  },
  {
    id: 'policy_violation_found',
    rank: 3,
    label: 'a policy violation was found',
    phrases: [
      /\bpolicy\s+violations?\b/i,
      /\bviolat(?:ed|ion\s+of)\s+(?:the\s+|its\s+|department\s+)?polic/i,
      /\baudit\s+(?:found|revealed|flagged|uncovered|showed)\b/i,
      /\bsustained\s+(?:the\s+)?(?:finding|complaint|allegation)/i,
      /\bimproper(?:ly)?\s+(?:search|access|use|ran|queried)/i,
      /\bunauthori[sz]ed\s+(?:search|access|use|quer|look)/i,
      /\bmisus(?:e|ed|ing)\s+(?:the\s+)?(?:system|database|camera|network)/i,
    ],
  },
  {
    id: 'resigned_or_fired',
    rank: 3,
    label: 'resigned, fired or disciplined',
    phrases: [
      /\bresign(?:ed|ation)\b/i,
      /\b(?:was\s+|were\s+)?fired\b/i,
      /\bterminated\b/i,
      /\bdismissed\s+from\s+(?:the\s+)?(?:department|force|agency)\b/i,
      /\bplaced\s+on\s+(?:administrative\s+)?leave\b/i,
      /\bsuspended\b/i,
      /\bdisciplined\b/i,
      /\bdecertified\b/i,
    ],
  },
  {
    id: 'charged',
    rank: 4,
    label: 'criminally charged',
    phrases: [
      /\bcharged\s+(?:with|in|on|for|after|following|over)\b/i,
      /\b(?:was|were|is|are|been)\s+charged\b/i,
      /\bfaces?\s+(?:\w+\s+){0,3}charges\b/i,
      /\bcharges\s+(?:of|against)\b/i,
      /\bcriminal\s+charges\b/i,
      /\bindicted\b/i,
      /\bindictment\b/i,
      /\barrested\b/i,
      /\barrest\s+warrant\b/i,
      /\bbooked\s+into\b/i,
      /\bcount(?:s)?\s+of\s+(?:felony|misdemeanor)/i,
    ],
  },
  {
    id: 'pleaded_not_guilty',
    rank: 5,
    label: 'pleaded not guilty',
    phrases: [
      /\bplea?d(?:ed|s|ing)?\s+NEGPLEA\b/i,
      /\bNEGPLEA\s+ple(?:a|as)\b/i,
      /\bentered\s+an?\s+NEGPLEA\s+plea\b/i,
    ],
  },
  {
    id: 'pleaded_guilty',
    rank: 6,
    label: 'pleaded guilty or no contest',
    phrases: [
      /\bplea?d(?:ed|s|ing)?\s+guilty\b/i,
      /\bguilty\s+ple(?:a|as)\b/i,
      /\bplea?d(?:ed|s|ing)?\s+no\s+contest\b/i,
      /\bnolo\s+contendere\b/i,
      /\bentered\s+an?\s+guilty\s+plea\b/i,
      /\bplea\s+(?:agreement|deal)\b/i,
      /\badmitted\s+guilt\b/i,
    ],
  },
  {
    id: 'convicted',
    rank: 7,
    label: 'convicted',
    phrases: [
      /\bconvicted\b/i,
      /\bconviction\b/i,
      /\bfound\s+guilty\b/i,
      /\b(?:was|is|were)\s+guilty\b/i,
      /\bsentenced\s+to\b/i,
      /\bjury\s+(?:found|convicted|returned)\b/i,
      /\bverdict\s+of\s+guilty\b/i,
    ],
  },
]);

const BY_ID = new Map(DISPOSITIONS.map((entry) => [entry.id, entry]));

export function isDisposition(id) {
  return typeof id === 'string' && BY_ID.has(id);
}

export function dispositionRank(id) {
  const entry = BY_ID.get(id);
  if (entry === undefined) throw new Error(`unknown disposition: ${String(id)}`);
  return entry.rank;
}

export function dispositionLabel(id) {
  return BY_ID.get(id)?.label ?? String(id);
}

/**
 * Every rung this text asserts, most severe first.
 *
 * `masked` says which mask was applied. The article gets the full one; a
 * summary gets the minimal one, because a loose mask on a summary would let a
 * bad summary through and a loose mask on an article only causes refusals.
 */
export function assertedDispositions(text, { full = false } = {}) {
  const haystack = full ? maskDenials(String(text)) : maskNotGuilty(String(text));
  const hits = [];
  for (const entry of DISPOSITIONS) {
    if (entry.phrases.some((pattern) => pattern.test(haystack))) hits.push(entry.id);
  }
  return hits.sort((a, b) => dispositionRank(b) - dispositionRank(a));
}

/** The strongest claim this text makes, or null if it makes none. */
export function topDisposition(text, options = {}) {
  return assertedDispositions(text, options)[0] ?? null;
}

/**
 * The highest disposition the ARTICLE will support, and whether it records a
 * denial.
 *
 * `contested` is the whole point of this function. When an article contains a
 * not-guilty plea, this script will not write a stronger claim than that plea,
 * even if some other sentence in the same article mentions a guilty plea -
 * because that other sentence is usually about a different person, a different
 * case, or a co-defendant, and telling those apart is exactly the judgement a
 * person should be making. The candidate is refused and says why.
 */
export function articleCeiling(articleText) {
  const asserted = assertedDispositions(articleText, { full: true });
  const contested = asserted.includes('pleaded_not_guilty');
  const highest = asserted[0] ?? null;
  const ceiling = contested ? 'pleaded_not_guilty' : highest;
  return { ceiling, contested, asserted };
}

/* ==========================================================================
 * THE FLOOR - WHAT THE ARTICLE MUST SAY BEFORE A MODEL IS BELIEVED AT ALL
 * ========================================================================== */

/*
 * These two lists are not the misuse test - the model does that reading. They
 * are the floor UNDER the model's answer: if the fetched text contains no word
 * for the technology and no word for the wrongdoing, then whatever the model
 * said it read, it did not read it here. A model that returns a confident
 * extraction for an article about a school board meeting is caught by text it
 * cannot influence.
 */
export const ALPR_TERMS = Object.freeze([
  'license plate reader',
  'licence plate reader',
  'license plate readers',
  'plate reader',
  'plate readers',
  'license plate recognition',
  'automated license plate',
  'automatic license plate',
  'alpr',
  'lpr camera',
  'flock safety',
  'flock camera',
  'flock cameras',
  'flock system',
  'flock network',
  'flock database',
]);

export const MISUSE_TERMS = Object.freeze([
  'misuse',
  'misused',
  'misusing',
  'unauthorized',
  'unauthorised',
  'improper',
  'improperly',
  'violation',
  'violated',
  'abuse',
  'abused',
  'stalk',
  'stalking',
  'harass',
  'personal reasons',
  'personal use',
  'without a valid',
  'wrongdoing',
  'illegal',
  'unlawful',
  'audit found',
  'policy violation',
]);

function containsAny(haystack, terms) {
  return terms.filter((term) => haystack.includes(term));
}

/* ==========================================================================
 * AGENCY
 * ========================================================================== */

/*
 * A RECORD ACCUSES AN AGENCY, SO THE AGENCY HAS TO BE ONE.
 *
 * `CountyMisuseRecord.agency` is documented as "the agency the record concerns,
 * never an individual officer's name". These patterns say what counts, and the
 * denylist says what people mistake for one: the camera vendor is not a police
 * department, and a record filed against Flock Safety in a county where Flock
 * sells cameras would accuse every department in it of nothing in particular.
 */
const AGENCY_WORDS =
  /\b(?:police|sheriff|sheriff's|patrol|marshal|marshals|constable|trooper|troopers|public safety|department|dept\.?|bureau|office|task force|district attorney|attorney general|corrections|university police|campus police|transit police|park police)\b/i;

const AGENCY_DENYLIST =
  /\b(?:flock safety|flock,? inc|motorola|axon|vigilant solutions|rekor|leonardo|genetec|verra mobility|amazon|ring|google|meta|microsoft)\b/i;

/** "Moody Police Department and Springville Police Department" is two agencies. */
export function agencyParts(agency) {
  return String(agency)
    .split(/\s+and\s+|\s*;\s*|\s*,\s+(?=[A-Z])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/*
 * THE WORDS THAT DO NOT IDENTIFY ANYBODY.
 *
 * Half of every agency name is boilerplate. What makes "Moody Police
 * Department" a specific accusation is "Moody".
 */
const GENERIC_AGENCY_WORDS = new Set([
  'police',
  'department',
  'departments',
  'dept',
  'office',
  'offices',
  'sheriff',
  'sheriffs',
  'county',
  'parish',
  'city',
  'town',
  'village',
  'township',
  'borough',
  'state',
  'public',
  'safety',
  'bureau',
  'division',
  'unit',
  'force',
  'patrol',
  'marshal',
  'marshals',
  'constable',
  'district',
  'attorney',
  'general',
  'corrections',
  'university',
  'campus',
  'transit',
  'park',
  'the',
  'of',
  'and',
]);

/**
 * Is this agency actually named in the article - and if not, which word is missing?
 *
 * The whole string is checked first, and that is the common case. The fallback
 * exists because newsrooms write around the formal name: an article that says
 * "Springville Police Chief Jason Mize" is unmistakably about the Springville
 * Police Department and contains that string nowhere. Requiring the whole name
 * verbatim refuses records that are perfectly well sourced.
 *
 * So what must be present is every DISTINCTIVE word - the ones that pick this
 * agency out from every other one. A model cannot invent "DeKalb County Police
 * Department" over a Gwinnett article, because "dekalb" is not in the text.
 * Returns null when the agency is named, or the missing word when it is not.
 */
export function agencyMissingFrom(agency, normalizedArticle) {
  if (normalizedArticle.includes(normalizeForMatch(agency))) return null;
  const distinctive = normalizeForMatch(agency)
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 3 && !GENERIC_AGENCY_WORDS.has(word));
  if (distinctive.length === 0) return normalizeForMatch(agency);
  return distinctive.find((word) => !new RegExp(`\\b${word}\\b`).test(normalizedArticle)) ?? null;
}

/* ==========================================================================
 * COUNTY - RESOLVED AGAINST THE SAME GAZETTEER THE CITATION CHECK USES
 * ========================================================================== */

/**
 * Build the lookup the citation check validates against.
 *
 * `apps/pwa/public/cameras/counties.json` is the file
 * `check-record-citations.mjs` resolves a FIPS against, so a county that is not
 * in it is a county this app cannot file a record against. Resolving here
 * against anything else would let a record through the promoter and fail the
 * build.
 */
export function buildGazetteer(rows) {
  const byKey = new Map();
  const byNameState = new Map();
  const byFips = new Map();
  for (const row of rows) {
    if (typeof row?.fips !== 'string' || typeof row?.name !== 'string') continue;
    const state = String(row.state ?? '').toUpperCase();
    const name = normalizeCountyName(row.name);
    const type = String(row.lsad ?? '').toLowerCase();
    byFips.set(row.fips, row);
    const nameStateKey = `${name}|${state}`;
    if (!byNameState.has(nameStateKey)) byNameState.set(nameStateKey, []);
    byNameState.get(nameStateKey).push(row);
    byKey.set(`${nameStateKey}|${type}`, row);
  }
  return { byKey, byNameState, byFips };
}

/** "St. Clair County" and "st clair" are the same county. */
export function normalizeCountyName(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.'’]/gu, '')
    .replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/gu, ' ')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/**
 * A county name and a state to a FIPS, or a refusal.
 *
 * NEVER A GUESS. Requirement five of this script is that an unresolvable county
 * is a drop, and the ambiguous case is the one that matters: Baltimore MD is
 * two rows - the county (24005) and the independent city (24510) - and so are
 * St. Louis MO and five Virginia names. Picking either one is a coin flip that
 * files an allegation against the wrong jurisdiction, so an ambiguous name with
 * no `countyType` to settle it is refused.
 */
export function resolveFips(gazetteer, { county, state, countyType } = {}) {
  if (typeof county !== 'string' || county.trim() === '') {
    return { ok: false, reason: DROP_REASONS.COUNTY_UNRESOLVED, detail: 'no county was extracted' };
  }
  if (typeof state !== 'string' || !/^[A-Za-z]{2}$/.test(state.trim())) {
    return {
      ok: false,
      reason: DROP_REASONS.COUNTY_UNRESOLVED,
      detail: `no two-letter state for "${county}"`,
    };
  }
  const name = normalizeCountyName(county);
  const upper = state.trim().toUpperCase();
  const matches = gazetteer.byNameState.get(`${name}|${upper}`) ?? [];

  if (matches.length === 0) {
    return {
      ok: false,
      reason: DROP_REASONS.COUNTY_UNRESOLVED,
      detail: `"${county}, ${upper}" is not in apps/pwa/public/cameras/counties.json`,
    };
  }
  if (matches.length === 1) return { ok: true, row: matches[0] };

  const type = String(countyType ?? '').toLowerCase();
  const exact = gazetteer.byKey.get(`${name}|${upper}|${type}`);
  if (type !== '' && exact !== undefined) return { ok: true, row: exact };
  return {
    ok: false,
    reason: DROP_REASONS.COUNTY_AMBIGUOUS,
    detail: `"${county}, ${upper}" matches ${String(matches.length)} rows (${matches
      .map((row) => `${row.fips} ${row.label}`)
      .join(', ')}); countyType did not settle it`,
  };
}

/* ==========================================================================
 * INCIDENTS - "SEVERAL" IS NOT A NUMBER
 * ========================================================================== */

const NUMBER_WORDS = new Map([
  ['one', 1],
  ['a single', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
]);

const VAGUE_QUANTIFIERS =
  /\b(?:several|multiple|numerous|many|dozens?|scores|countless|a\s+number\s+of|repeatedly|various|some|handful)\b/i;

/**
 * Does the article actually support this count?
 *
 * `incidents` is documented in the app as "distinct documented incidents this
 * entry represents", so it counts FINDINGS, not database queries: one officer
 * making forty unauthorised searches is one finding, and two departments each
 * failing an audit is two.
 *
 * That makes the rule asymmetric on purpose. A count of one needs a quote that
 * describes the episode and does not hedge it with a plural. A count above one
 * is an arithmetic claim about the article, so the article has to state the
 * number - in digits or in words. "Several unauthorised searches" supports
 * neither three nor seven, and a script that turns it into a number is guessing
 * in a file that is not allowed to guess.
 */
export function incidentsSupported(incidents, quote) {
  if (!Number.isInteger(incidents) || incidents < 1 || incidents > MAX_INCIDENTS) {
    return { ok: false, reason: DROP_REASONS.INCIDENTS_NOT_INTEGER, detail: String(incidents) };
  }
  const text = normalizeForMatch(quote);
  if (incidents === 1) {
    if (VAGUE_QUANTIFIERS.test(text)) {
      return {
        ok: false,
        reason: DROP_REASONS.INCIDENTS_NOT_COUNTED,
        detail: `a count of 1 was taken from a hedged quote: "${String(quote).slice(0, 120)}"`,
      };
    }
    return { ok: true };
  }
  const digits = new RegExp(`(?:^|[^0-9])${String(incidents)}(?:[^0-9]|$)`).test(text);
  const word = [...NUMBER_WORDS.entries()].some(
    ([spelling, value]) => value === incidents && new RegExp(`\\b${spelling}\\b`).test(text),
  );
  if (digits || word) return { ok: true };
  return {
    ok: false,
    reason: DROP_REASONS.INCIDENTS_NOT_COUNTED,
    detail: `the article does not state ${String(incidents)}: "${String(quote).slice(0, 120)}"`,
  };
}

/* ==========================================================================
 * THE VERIFIER - THE PART THE MODEL DOES NOT GET TO ARGUE WITH
 * ========================================================================== */

const MARKUP = /[<>]|https?:\/\/|\{|\}|\[|\]/;

function drop(reason, detail) {
  return { ok: false, reason, detail };
}

/**
 * A model extraction to a record, or a refusal with a reason.
 *
 * PURE, AND THAT IS THE POINT. It takes the article text that was actually
 * fetched and the extraction that was actually returned, and it re-derives
 * every claim from the first. It performs no network call, holds no state, and
 * has no way to accept something it cannot find in the text - which is what
 * makes it testable and what makes it the gate rather than the model.
 *
 * The order is deliberate: cheap structural refusals first, then the subject
 * floor, then the quote-fabrication check, then the four claim fields. Reading
 * the reasons in a run's output tells you which stage rejected a candidate.
 */
export function verifyExtraction({ candidate, articleText, extraction, gazetteer, sourceName }) {
  const text = String(articleText);
  const lower = normalizeForMatch(text);

  /* --- did the model itself refuse? ----------------------------------- */
  if (extraction.documentsMisuse !== true) {
    return drop(
      DROP_REASONS.NOT_MISUSE,
      typeof extraction.refusalReason === 'string' && extraction.refusalReason.trim() !== ''
        ? extraction.refusalReason.trim().slice(0, 300)
        : 'the article does not document ALPR misuse by a named agency',
    );
  }

  /* --- the floor the model cannot move -------------------------------- */
  if (containsAny(lower, ALPR_TERMS).length === 0) {
    return drop(
      DROP_REASONS.NO_ALPR_SUBJECT,
      'the fetched text contains no term for a plate reader; whatever was read, it was not read here',
    );
  }
  if (containsAny(lower, MISUSE_TERMS).length === 0) {
    return drop(
      DROP_REASONS.NO_MISUSE_LANGUAGE,
      'the fetched text contains no term for misuse, violation or wrongdoing',
    );
  }

  /* --- every load-bearing claim carries a quote, and every quote is real */
  const quotes = {
    misuseQuote: extraction.misuseQuote,
    agencyQuote: extraction.agencyQuote,
    locationQuote: extraction.locationQuote,
    dispositionQuote: extraction.dispositionQuote,
    incidentsQuote: extraction.incidentsQuote,
  };
  for (const [field, quote] of Object.entries(quotes)) {
    if (typeof quote !== 'string' || !quoteIsInArticle(quote, text)) {
      return drop(
        DROP_REASONS.QUOTE_NOT_IN_ARTICLE,
        `${field} is not a verbatim span of the fetched article: "${String(quote ?? '').slice(0, 160)}"`,
      );
    }
  }

  /* --- agency ---------------------------------------------------------- */
  const agency = typeof extraction.agency === 'string' ? extraction.agency.trim() : '';
  if (agency === '' || agency.split(/\s+/u).length < 2 || !AGENCY_WORDS.test(agency)) {
    return drop(DROP_REASONS.AGENCY_NOT_NAMED, `"${agency}" does not name a law-enforcement body`);
  }
  if (AGENCY_DENYLIST.test(agency)) {
    return drop(
      DROP_REASONS.AGENCY_NOT_LAW_ENFORCEMENT,
      `"${agency}" is a vendor or platform, not the agency a record accuses`,
    );
  }
  const parts = agencyParts(agency);
  const missing = parts.filter((part) => agencyMissingFrom(part, lower) !== null);
  if (missing.length > 0) {
    return drop(
      DROP_REASONS.AGENCY_NOT_IN_ARTICLE,
      `the fetched text never names ${missing
        .map((part) => `"${part}" (no "${String(agencyMissingFrom(part, lower))}" in it)`)
        .join(' or ')}`,
    );
  }

  /* --- county ---------------------------------------------------------- */
  const place = typeof extraction.place === 'string' ? extraction.place.trim() : '';
  const locationQuote = normalizeForMatch(extraction.locationQuote);
  const countyMentioned = locationQuote.includes(normalizeCountyName(extraction.county ?? ''));
  const placeMentioned = place !== '' && locationQuote.includes(normalizeForMatch(place));
  if (!countyMentioned && !placeMentioned) {
    return drop(
      DROP_REASONS.LOCATION_NOT_IN_ARTICLE,
      `the location quote names neither the county "${String(extraction.county)}" nor the place "${place}"`,
    );
  }
  const resolved = resolveFips(gazetteer, {
    county: extraction.county,
    state: extraction.state,
    countyType: extraction.countyType,
  });
  if (!resolved.ok) return drop(resolved.reason, resolved.detail);

  /* --- disposition ------------------------------------------------------ */
  const disposition = extraction.disposition;
  if (!isDisposition(disposition)) {
    return drop(DROP_REASONS.DISPOSITION_UNKNOWN, `"${String(disposition)}" is not on the ladder`);
  }
  const { ceiling, contested } = articleCeiling(text);
  const claimed = dispositionRank(disposition);

  /*
   * THE TRAP, CLOSED. An article that records a not-guilty plea caps at that
   * plea, full stop. If the article also mentions a guilty plea somewhere -
   * a co-defendant, an earlier case, a different officer - then telling those
   * apart is a person's job and this run says so instead of choosing.
   */
  if (contested && claimed > dispositionRank('pleaded_not_guilty')) {
    return drop(
      DROP_REASONS.CONTESTED_PLEA,
      `the article records a not-guilty plea; "${dispositionLabel(disposition)}" was claimed anyway`,
    );
  }
  if (ceiling === null || claimed > dispositionRank(ceiling)) {
    return drop(
      DROP_REASONS.DISPOSITION_EXCEEDS_ARTICLE,
      `the article supports at most "${ceiling === null ? 'nothing' : dispositionLabel(ceiling)}", not "${dispositionLabel(disposition)}"`,
    );
  }
  /*
   * The quote has to SAY it. The ceiling is the strongest claim anywhere in the
   * article; this is the strongest claim in the one sentence the model cited
   * for this disposition, which is what stops a claim being borrowed from a
   * paragraph about somebody else.
   */
  const quoted = topDisposition(extraction.dispositionQuote, { full: true });
  if (quoted === null || dispositionRank(quoted) < claimed) {
    return drop(
      DROP_REASONS.DISPOSITION_EXCEEDS_ARTICLE,
      `the cited sentence supports "${quoted === null ? 'nothing' : dispositionLabel(quoted)}", not "${dispositionLabel(disposition)}": "${String(extraction.dispositionQuote).slice(0, 160)}"`,
    );
  }

  /* --- summary ---------------------------------------------------------- */
  const summary = typeof extraction.summary === 'string' ? extraction.summary.trim() : '';
  if (
    summary.length < MIN_SUMMARY_CHARS ||
    summary.length > MAX_SUMMARY_CHARS ||
    MARKUP.test(summary)
  ) {
    return drop(
      DROP_REASONS.SUMMARY_MALFORMED,
      `a summary of ${String(summary.length)} characters, or one carrying markup, is not a record's summary`,
    );
  }
  if (!parts.some((part) => normalizeForMatch(summary).includes(normalizeForMatch(part)))) {
    return drop(
      DROP_REASONS.SUMMARY_OMITS_AGENCY,
      `the summary never names ${parts.map((part) => `"${part}"`).join(' or ')}`,
    );
  }
  /*
   * REQUIREMENT THREE, ENFORCED ON THE PROSE ITSELF. The summary is scanned
   * with the minimal mask, so it may restate the disposition or anything
   * weaker and nothing stronger. A summary that says "pleaded guilty" over a
   * `pleaded_not_guilty` disposition dies here even if every other field was
   * extracted correctly.
   */
  const summaryClaims = assertedDispositions(summary);
  const upgrade = summaryClaims.find((id) => dispositionRank(id) > claimed);
  if (upgrade !== undefined) {
    return drop(
      DROP_REASONS.SUMMARY_UPGRADES_DISPOSITION,
      `the disposition is "${dispositionLabel(disposition)}" but the summary asserts "${dispositionLabel(upgrade)}"`,
    );
  }

  /* --- incidents --------------------------------------------------------- */
  const counted = incidentsSupported(extraction.incidents, extraction.incidentsQuote);
  if (!counted.ok) return drop(counted.reason, counted.detail);

  /* --- year -------------------------------------------------------------- */
  const publishedYear = Number.parseInt(String(candidate._publishedAt ?? '').slice(0, 4), 10);
  const year = extraction.year;
  if (!Number.isInteger(year) || year < MIN_YEAR) {
    return drop(DROP_REASONS.YEAR_UNSUPPORTED, `"${String(year)}" is not a plausible year`);
  }
  if (Number.isInteger(publishedYear) && year > publishedYear) {
    return drop(
      DROP_REASONS.YEAR_UNSUPPORTED,
      `${String(year)} is after the article's publication year ${String(publishedYear)}`,
    );
  }
  const yearInText = new RegExp(`(?:^|[^0-9])${String(year)}(?:[^0-9]|$)`).test(lower);
  if (!yearInText && year !== publishedYear) {
    return drop(
      DROP_REASONS.YEAR_UNSUPPORTED,
      `${String(year)} appears nowhere in the article and is not its publication year`,
    );
  }

  /* --- the record --------------------------------------------------------- */
  const record = {
    fips: resolved.row.fips,
    agency,
    summary,
    incidents: extraction.incidents,
    year,
    sourceUrl: normalizeSourceUrl(candidate.sourceUrl),
    sourceName,
    disposition,
  };

  /*
   * BELT AND BRACES. `check-record-citations.mjs` is the gate that ships and it
   * still runs, as a subprocess, after this file is written. This is the same
   * set of assertions applied one record at a time so that a failure names the
   * candidate that caused it instead of failing the whole write.
   */
  const problems = citationProblems(record, gazetteer.byFips);
  if (problems.length > 0) {
    return drop(DROP_REASONS.RECORD_FAILS_CITATION_CHECK, problems.join('; '));
  }
  return { ok: true, record, resolved: resolved.row };
}

/** The assertions `check-record-citations.mjs` makes, applied to one record. */
export function citationProblems(record, knownFips) {
  const problems = [];
  if (typeof record.fips !== 'string' || !/^\d{5}$/.test(record.fips)) {
    problems.push('has no five-digit county FIPS');
  } else if (knownFips.size > 0 && !knownFips.has(record.fips)) {
    problems.push(`is filed against unknown county FIPS ${record.fips}`);
  }
  if (typeof record.agency !== 'string' || record.agency.length === 0)
    problems.push('names no agency');
  if (typeof record.summary !== 'string' || record.summary.length === 0)
    problems.push('has no summary');
  if (typeof record.sourceName !== 'string' || record.sourceName.length === 0) {
    problems.push('has no sourceName');
  }
  if (typeof record.sourceUrl !== 'string' || !/^https?:\/\//.test(record.sourceUrl)) {
    problems.push('has no http(s) sourceUrl');
  }
  if (!Number.isInteger(record.incidents) || record.incidents < 1) {
    problems.push('has no positive integer incident count');
  }
  if (!Number.isInteger(record.year) || record.year < MIN_YEAR)
    problems.push('has no plausible year');
  return problems;
}

/* ==========================================================================
 * FETCHING THE ARTICLE
 * ========================================================================== */

/*
 * THE URLS COME FROM A ROBOT READING A SEARCH API, SO THEY ARE INPUT.
 *
 * A candidate file is written by a scheduled job from GDELT results and edited
 * by whoever has commit access. Handing that straight to `fetch` on a
 * developer's machine is a request-forgery primitive pointed at their own
 * network. The scheme is checked, the host is resolved, and anything that lands
 * on loopback, link-local, carrier-grade NAT or private space is refused - and
 * refused as a DROP, because a source a reader on the internet cannot open is
 * not a citation in the first place.
 */
const BLOCKED_V4 = [
  [/^0\./, 'this network'],
  [/^10\./, 'private'],
  [/^127\./, 'loopback'],
  [/^169\.254\./, 'link-local'],
  [/^172\.(1[6-9]|2\d|3[01])\./, 'private'],
  [/^192\.0\.0\./, 'IETF protocol assignments'],
  [/^192\.168\./, 'private'],
  [/^198\.(1[89])\./, 'benchmarking'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'carrier-grade NAT'],
  [/^(22[4-9]|23\d)\./, 'multicast'],
  [/^(24\d|25[0-5])\./, 'reserved'],
];

export function addressIsPublic(address, family) {
  const value = String(address).toLowerCase();
  if (family === 6) {
    if (value === '::' || value === '::1') return { ok: false, why: 'loopback' };
    if (/^f[cd]/.test(value)) return { ok: false, why: 'unique local' };
    if (/^fe[89ab]/.test(value)) return { ok: false, why: 'link-local' };
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped !== null) return addressIsPublic(mapped[1], 4);
    return { ok: true };
  }
  for (const [pattern, why] of BLOCKED_V4) {
    if (pattern.test(value)) return { ok: false, why };
  }
  return { ok: true };
}

export async function assertPublicHost(url, lookupImpl = dnsLookup) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('source URL must be HTTP(S)');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('source URL must be credential-free');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (/^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(host)) {
    throw new Error(`${host} is not a public host`);
  }
  const addresses = await lookupImpl(host, { all: true });
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`${host} does not resolve`);
  }
  for (const entry of addresses) {
    const verdict = addressIsPublic(entry.address, entry.family);
    if (!verdict.ok) throw new Error(`${host} resolves to ${verdict.why} space (${entry.address})`);
  }
  return addresses;
}

async function readBounded(response, maxBytes) {
  if (response.body === null) throw new Error('the response has no body');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('the response is larger than the safety limit');
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(joined);
}

function firstMatch(html, patterns) {
  for (const pattern of patterns) {
    const found = pattern.exec(html);
    if (found !== null && typeof found[1] === 'string' && found[1].trim() !== '') {
      return decodeEntities(found[1]).trim();
    }
  }
  return '';
}

function walkJsonLd(value, out) {
  if (Array.isArray(value)) {
    for (const item of value) walkJsonLd(item, out);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (typeof value.articleBody === 'string' && value.articleBody.length > out.body.length) {
    out.body = value.articleBody;
  }
  if (typeof value.datePublished === 'string' && out.published === '') {
    out.published = value.datePublished;
  }
  if (typeof value.headline === 'string' && out.headline === '') out.headline = value.headline;
  const publisher = value.publisher;
  if (publisher !== null && typeof publisher === 'object' && typeof publisher.name === 'string') {
    if (out.outlet === '') out.outlet = publisher.name;
  }
  for (const nested of Object.values(value)) walkJsonLd(nested, out);
}

/**
 * The page's own structured description of itself.
 *
 * News sites publish JSON-LD `articleBody`, and it is cleaner than anything a
 * tag-stripper produces: no navigation, no "most read" rail, no cookie banner.
 * Taking it when it is there means the quotes the model cites come from the
 * article rather than from a sidebar about an unrelated arrest.
 */
export function readPageMetadata(html) {
  const out = { body: '', published: '', headline: '', outlet: '' };
  const blocks = String(html).matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    try {
      walkJsonLd(JSON.parse(decodeEntities(block[1])), out);
    } catch {
      /* A newsroom with broken JSON-LD still has a readable page. */
    }
  }
  if (out.outlet === '') {
    out.outlet = firstMatch(html, [
      /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
    ]);
  }
  if (out.published === '') {
    out.published = firstMatch(html, [
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["'](?:date|pubdate|publish-date)["'][^>]+content=["']([^"']+)["']/i,
      /<time[^>]+datetime=["']([^"']+)["']/i,
    ]);
  }
  if (out.headline === '') {
    out.headline = firstMatch(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
  }
  return out;
}

/**
 * Fetch one article. Returns `{ ok: true, ... }` or a PENDING, never a drop -
 * except the host guard, which is a statement about the citation itself.
 */
export async function fetchArticle({
  url,
  fetchImpl = globalThis.fetch,
  lookupImpl = dnsLookup,
  timeoutMs = FETCH_TIMEOUT_MS,
  maxBytes = MAX_ARTICLE_BYTES,
}) {
  try {
    await assertPublicHost(url, lookupImpl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/does not resolve/.test(detail)) {
      return { ok: false, kind: 'pending', reason: PENDING_REASONS.FETCH_FAILED, detail };
    }
    return { ok: false, kind: 'drop', reason: DROP_REASONS.UNSAFE_SOURCE_HOST, detail };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });
    } catch (error) {
      const detail = controller.signal.aborted
        ? `timed out after ${String(timeoutMs)}ms`
        : error instanceof Error
          ? error.message
          : String(error);
      return { ok: false, kind: 'pending', reason: PENDING_REASONS.FETCH_FAILED, detail };
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: 'pending',
        reason: PENDING_REASONS.FETCH_FAILED,
        detail: `HTTP ${String(response.status)}`,
      };
    }
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') {
      return {
        ok: false,
        kind: 'pending',
        reason: PENDING_REASONS.NOT_HTML,
        detail: `Content-Type ${mediaType ?? 'missing'}`,
      };
    }

    let html;
    try {
      html = await readBounded(response, maxBytes);
    } catch (error) {
      return {
        ok: false,
        kind: 'pending',
        reason: PENDING_REASONS.FETCH_FAILED,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const meta = readPageMetadata(html);
    const body = meta.body.length >= MIN_ARTICLE_CHARS ? meta.body : htmlToText(html);
    /*
     * A PAYWALL STUB IS NOT AN ARTICLE THAT SAYS NOTHING.
     *
     * Two hundred characters of "Subscribe to continue reading" is a page that
     * was not read, and a page that was not read cannot support a refusal any
     * more than it can support a record. It stays PENDING so a person can open
     * it, which is the one case where the manual read survives on purpose.
     */
    if (body.length < MIN_ARTICLE_CHARS) {
      return {
        ok: false,
        kind: 'pending',
        reason: PENDING_REASONS.ARTICLE_TOO_SHORT,
        detail: `${String(body.length)} characters of readable text; probably a paywall or a stub`,
      };
    }
    return {
      ok: true,
      text: body,
      outlet: meta.outlet,
      headline: meta.headline,
      publishedDate: meta.published,
      finalUrl: typeof response.url === 'string' && response.url !== '' ? response.url : url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** "WBRC FOX6 Birmingham, July 27, 2026" - the shape the file already uses. */
export function sourceNameFor({ outlet, publishedDate, candidate }) {
  const name =
    (typeof outlet === 'string' && outlet.trim() !== '' ? outlet.trim() : '') ||
    (typeof candidate?.sourceName === 'string' ? candidate.sourceName.trim() : '') ||
    'unknown outlet';
  const stamp =
    publishedDate === '' || publishedDate == null ? candidate?._publishedAt : publishedDate;
  const parsed = new Date(String(stamp));
  if (Number.isNaN(parsed.getTime())) return name.slice(0, 120);
  const formatted = parsed.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${name}, ${formatted}`.slice(0, 200);
}

/* ==========================================================================
 * THE READ
 * ========================================================================== */

/**
 * The schema the model answers in.
 *
 * EVERY CLAIM CARRIES ITS QUOTE. That is not decoration - `verifyExtraction`
 * refuses any extraction whose quotes are not verbatim spans of the fetched
 * text, so the schema is what makes the fabrication check possible at all. A
 * model that invents an agency has to invent a sentence naming it, and that
 * sentence is not in the article.
 */
export const EXTRACTION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    documentsMisuse: {
      type: 'boolean',
      description:
        'True only if this article documents a specific instance of automated licence plate reader misuse by a named law-enforcement agency. False for explainers, policy debates, vendor news, legislative coverage, opinion pieces and articles about ALPR use that no source calls improper.',
    },
    refusalReason: {
      type: 'string',
      description:
        'Why this is not a documented misuse record. Required when documentsMisuse is false.',
    },
    agency: {
      type: 'string',
      description:
        "The law-enforcement agency the record concerns, in full, as the article names it - never an individual officer's name. Join two agencies with ' and '.",
    },
    agencyQuote: {
      type: 'string',
      description: 'A verbatim sentence from the article naming that agency.',
    },
    place: {
      type: 'string',
      description: 'The city, town or area the agency serves, as the article names it.',
    },
    county: {
      type: 'string',
      description:
        'The US county (or parish, or independent city) that place is in. The county name only, without the word County.',
    },
    countyType: {
      type: 'string',
      enum: ['County', 'Parish', 'city'],
      description:
        "Required where a state has both a county and an independent city of the same name - Baltimore MD, St. Louis MO, and the Virginia names. 'city' means an independent city.",
    },
    state: { type: 'string', description: 'The two-letter USPS state code.' },
    locationQuote: {
      type: 'string',
      description: 'A verbatim sentence from the article naming that place or that county.',
    },
    disposition: {
      type: 'string',
      enum: DISPOSITIONS.map((entry) => entry.id),
      description:
        'The strongest thing the article actually establishes. accused < under_investigation < policy_violation_found / resigned_or_fired < charged < pleaded_not_guilty < pleaded_guilty < convicted, and acquitted for an exoneration.',
    },
    dispositionQuote: {
      type: 'string',
      description:
        'A verbatim sentence from the article that states that disposition, about this subject and no one else.',
    },
    incidents: {
      type: 'integer',
      description:
        'Distinct documented misuse findings this article establishes - not the number of database searches. One officer making forty searches is 1. Two departments each failing an audit is 2.',
    },
    incidentsQuote: {
      type: 'string',
      description: 'A verbatim sentence supporting that count. Above 1, it must state the number.',
    },
    year: { type: 'integer', description: 'The year the misuse or the finding occurred.' },
    yearQuote: { type: 'string', description: 'A verbatim span supporting that year.' },
    outlet: { type: 'string', description: 'The publication name, as the article gives it.' },
    summary: {
      type: 'string',
      description:
        "Two to four sentences, in the article's own terms, naming the agency and stating what was found and when. It must state the disposition exactly as extracted and never anything stronger.",
    },
  },
  required: ['documentsMisuse'],
});

export const SYSTEM_PROMPT = `You are filling in a review queue entry for a public file that makes allegations of misconduct about named law-enforcement agencies and shows them to drivers in those agencies' jurisdictions. An entry without a source a reader can open is not a record, it is an accusation.

You are replacing a person who opened each article and read it. Do what they did.

REFUSING IS A GOOD OUTCOME. Most articles a keyword search returns are not records: explainers, city-council debates, vendor announcements, legislative coverage, opinion columns, and straightforward reporting on ALPR use that nobody has called improper. Set documentsMisuse false and say why. An empty queue is a success.

Set documentsMisuse true ONLY when all of these hold:
  - the article is about automated licence plate readers, ALPR, or Flock cameras
  - it reports a specific instance of MISUSE - an unauthorised search, an improper access, a policy violation, stalking, data shared where it should not have been
  - it names the law-enforcement agency responsible

NEVER UPGRADE A CLAIM. An accusation, a criminal charge, a plea and a conviction are four different facts and they are not interchangeable.
  - If the article says the person pleaded NOT guilty, the disposition is pleaded_not_guilty. Never pleaded_guilty. Never convicted. This exact mistake has already been caught once in this queue and it must not happen again.
  - If the article says only that someone is accused, the disposition is accused - not charged.
  - If several people appear in one article, extract only the subject the agency employed, and cite a sentence about that subject.
  - The summary must state the disposition exactly as you extracted it and nothing stronger. If the disposition is accused, the summary says accused.

QUOTES ARE VERBATIM OR THE ENTRY IS THROWN AWAY. Every quote field must be copied character for character from the article text you were given. Do not paraphrase, do not correct, do not join two sentences. A quote that is not found in the text discards the whole extraction.

COUNT WHAT THE ARTICLE COUNTS. incidents is a positive integer of distinct documented findings. If the article says "several" and gives no number, it is not evidence of a number: describe the single documented finding as 1, or refuse.

Use no knowledge outside the article except one thing: which US county a named place is in. Everything else must be in the text.`;

export function buildExtractionPrompt({ candidate, article }) {
  return [
    `SOURCE URL: ${candidate.sourceUrl}`,
    `HEADLINE AS THE PATROL SAW IT: ${String(candidate._title ?? '')}`,
    `PATROL SAW IT PUBLISHED: ${String(candidate._publishedAt ?? 'unknown')}`,
    '',
    'ARTICLE TEXT:',
    '---',
    article.text.slice(0, 60_000),
    '---',
    '',
    'Fill in the extraction. Refuse if this is not a documented instance of ALPR misuse by a named law-enforcement agency.',
  ].join('\n');
}

/** Pull the tool input out of a Messages API response, whatever else came with it. */
export function parseExtraction(body) {
  if (body === null || typeof body !== 'object' || !Array.isArray(body.content)) {
    return {
      ok: false,
      reason: PENDING_REASONS.MODEL_OUTPUT_UNPARSEABLE,
      detail: 'no content array',
    };
  }
  for (const block of body.content) {
    if (block?.type === 'tool_use' && block.input !== null && typeof block.input === 'object') {
      return { ok: true, extraction: block.input };
    }
  }
  for (const block of body.content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(block.text);
      const raw = fenced === null ? block.text : fenced[1];
      try {
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object') return { ok: true, extraction: parsed };
      } catch {
        /* fall through to the pending below */
      }
    }
  }
  return {
    ok: false,
    reason: PENDING_REASONS.MODEL_OUTPUT_UNPARSEABLE,
    detail: 'the response carried no tool call and no JSON object',
  };
}

/**
 * Ask the model to read one article.
 *
 * A FAILURE HERE IS NEVER A DROP. An expired key, an unknown model id, a 529 or
 * a malformed reply says nothing whatever about the article, so all of them
 * come back PENDING and the candidate stays in the queue.
 */
export async function extractWithClaude({
  candidate,
  article,
  apiKey,
  model = DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  endpoint = ANTHROPIC_ENDPOINT,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = 120_000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0,
          system: SYSTEM_PROMPT,
          tools: [
            {
              name: 'file_misuse_record',
              description:
                'Record what this article does and does not establish about ALPR misuse.',
              input_schema: EXTRACTION_SCHEMA,
            },
          ],
          tool_choice: { type: 'tool', name: 'file_misuse_record' },
          messages: [{ role: 'user', content: buildExtractionPrompt({ candidate, article }) }],
        }),
      });
    } catch (error) {
      return {
        ok: false,
        reason: PENDING_REASONS.MODEL_UNAVAILABLE,
        detail: controller.signal.aborted
          ? `timed out after ${String(timeoutMs)}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    }
    if (!response.ok) {
      let hint = '';
      try {
        hint = String(await response.text()).slice(0, 200);
      } catch {
        hint = '';
      }
      return {
        ok: false,
        reason: PENDING_REASONS.MODEL_UNAVAILABLE,
        detail: `HTTP ${String(response.status)}${hint === '' ? '' : `: ${hint}`}`,
      };
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return {
        ok: false,
        reason: PENDING_REASONS.MODEL_OUTPUT_UNPARSEABLE,
        detail: 'the response body was not JSON',
      };
    }
    const parsed = parseExtraction(body);
    if (!parsed.ok) return parsed;
    if (typeof parsed.extraction.documentsMisuse !== 'boolean') {
      return {
        ok: false,
        reason: PENDING_REASONS.MODEL_SHAPE_INVALID,
        detail: 'documentsMisuse is missing or is not a boolean',
      };
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/* ==========================================================================
 * ONE CANDIDATE, END TO END
 * ========================================================================== */

/**
 * Fetch, read, verify. Returns exactly one of promote / drop / pending.
 *
 * The three outcomes are not interchangeable and the distinction is the whole
 * safety property of this script:
 *   PROMOTE - the article was read and it supports a record.
 *   DROP    - the article was read and it does not. A judgement about the source.
 *   PENDING - the article was NOT read. A statement about us, never about it.
 */
export async function examineCandidate({
  candidate,
  gazetteer,
  apiKey,
  model,
  fetchArticleImpl = fetchArticle,
  extractImpl = extractWithClaude,
}) {
  const article = await fetchArticleImpl({ url: candidate.sourceUrl });
  if (!article.ok) {
    return { kind: article.kind, reason: article.reason, detail: article.detail };
  }

  const extracted = await extractImpl({ candidate, article, apiKey, model });
  if (!extracted.ok) {
    return { kind: 'pending', reason: extracted.reason, detail: extracted.detail };
  }

  const verdict = verifyExtraction({
    candidate,
    articleText: article.text,
    extraction: extracted.extraction,
    gazetteer,
    sourceName: sourceNameFor({
      /*
       * THE PAGE'S OWN NAME FOR ITSELF FIRST. `sourceName` is half the
       * citation, and og:site_name or the JSON-LD publisher came off the
       * fetched page. The model's `outlet` is a reading of the same page and
       * only stands in when the page published neither.
       */
      outlet: article.outlet === '' ? extracted.extraction.outlet : article.outlet,
      publishedDate: article.publishedDate,
      candidate,
    }),
  });
  if (!verdict.ok) return { kind: 'drop', reason: verdict.reason, detail: verdict.detail };
  return { kind: 'promote', record: verdict.record, county: verdict.resolved };
}

/* ==========================================================================
 * THE RUN
 * ========================================================================== */

const CANDIDATE_ANNOTATIONS = [
  '_drop',
  '_dropDetail',
  '_droppedAt',
  '_pending',
  '_pendingDetail',
  '_pendingAt',
];

function withoutAnnotations(candidate) {
  return Object.fromEntries(
    Object.entries(candidate).filter(([key]) => !CANDIDATE_ANNOTATIONS.includes(key)),
  );
}

function candidateOrder(a, b) {
  return (
    String(b._publishedAt).localeCompare(String(a._publishedAt)) ||
    String(a.sourceUrl).localeCompare(String(b.sourceUrl)) ||
    String(a._title).localeCompare(String(b._title))
  );
}

/**
 * Which candidates this run will actually open.
 *
 * IDEMPOTENCE IS KEYED ON THE CANONICAL SOURCE URL, the same canonicaliser the
 * patrol dedupes with, so a re-run promotes nothing twice: a promoted candidate
 * is gone from the queue and its URL is in the record file, and either fact
 * alone is enough to skip it.
 *
 * A candidate already carrying a `_drop` is skipped too, unless `--recheck`.
 * The refusal is written down; re-fetching 38 articles to arrive at the same
 * refusal costs money and tells nobody anything.
 */
export function selectCandidates(candidates, { limit = null, only = null, recheck = false } = {}) {
  const wanted = only === null ? null : normalizeSourceUrl(only);
  const chosen = [];
  const skipped = [];
  for (const candidate of candidates) {
    let key;
    try {
      key = normalizeSourceUrl(candidate.sourceUrl);
    } catch {
      skipped.push({ candidate, why: 'the candidate has no usable sourceUrl' });
      continue;
    }
    if (wanted !== null && key !== wanted) continue;
    if (typeof candidate._drop === 'string' && !recheck) {
      skipped.push({ candidate, why: `already dropped: ${candidate._drop}` });
      continue;
    }
    if (limit !== null && chosen.length >= limit) {
      skipped.push({ candidate, why: 'beyond --limit' });
      continue;
    }
    chosen.push(candidate);
  }
  return { chosen, skipped };
}

/**
 * Turn the examined outcomes into the two files that will be written.
 *
 * PURE. It takes the records already on file, the queue as it stands and what
 * each examination decided, and returns the exact contents of both files. No
 * clock, no disk, no network - so a test can assert on what a run WOULD write.
 */
export function planWrite({ records, candidates, outcomes, prune = false, generatedAt }) {
  const byUrl = new Map();
  for (const record of records) {
    try {
      byUrl.set(normalizeSourceUrl(record.sourceUrl), record);
    } catch {
      /* A malformed row already on file is the citation check's business. */
    }
  }
  const alreadyCited = new Set(byUrl.keys());

  const promoted = [];
  const nextRecords = [...records];
  for (const outcome of outcomes) {
    if (outcome.result.kind !== 'promote') continue;
    const key = normalizeSourceUrl(outcome.result.record.sourceUrl);
    if (byUrl.has(key)) continue;
    byUrl.set(key, outcome.result.record);
    nextRecords.push(outcome.result.record);
    promoted.push(outcome);
  }
  /*
   * BY FIPS ONLY, AND THE SORT IS STABLE.
   *
   * The file is ordered by county and nothing else, and several counties carry
   * more than one record. Adding a second key would reshuffle rows that this
   * run did not touch - eleven of them, measured - and a diff that moves
   * allegations around for no reason is a diff nobody reads carefully. A stable
   * sort over the existing order followed by the new rows leaves every
   * untouched record exactly where it was.
   */
  nextRecords.sort((a, b) => String(a.fips).localeCompare(String(b.fips)));

  const decided = new Map(outcomes.map((outcome) => [outcome.key, outcome.result]));
  const nextCandidates = [];
  const alreadyRecorded = [];
  for (const candidate of candidates) {
    let key;
    try {
      key = normalizeSourceUrl(candidate.sourceUrl);
    } catch {
      nextCandidates.push(candidate);
      continue;
    }
    const result = decided.get(key);
    if (result?.kind === 'promote') continue;
    if (result === undefined && alreadyCited.has(key)) {
      alreadyRecorded.push(candidate.sourceUrl);
      /*
       * Already in the record file and never examined this run: the source is
       * cited, so the queue entry is spent. This is the second half of
       * idempotence - it survives a queue restored from a branch, or a
       * candidate a person promoted by hand.
       */
      continue;
    }
    const base = withoutAnnotations(candidate);
    if (result?.kind === 'drop') {
      /* `--prune` means the same thing for a refusal made now as for one on file. */
      if (prune) continue;
      nextCandidates.push({
        ...base,
        _drop: result.reason,
        _dropDetail: result.detail,
        _droppedAt: generatedAt,
      });
      continue;
    }
    if (result?.kind === 'pending') {
      nextCandidates.push({
        ...base,
        _pending: result.reason,
        _pendingDetail: result.detail,
        _pendingAt: generatedAt,
      });
      continue;
    }
    if (prune && typeof candidate._drop === 'string') continue;
    nextCandidates.push(candidate);
  }
  nextCandidates.sort(candidateOrder);

  return {
    records: nextRecords,
    candidates: nextCandidates,
    promoted,
    alreadyRecorded,
    counties: new Set(nextRecords.map((record) => record.fips)).size,
  };
}

export const CANDIDATES_NOTE =
  'REVIEW QUEUE, NOT RECORDS. Nothing here is shown in the app. ' +
  'scripts/promote-misuse-candidates.mjs fetches each source, extracts the record and refuses ' +
  'what it cannot support; `_drop` is a refusal it stands behind and `_pending` is an article it ' +
  'never managed to read. A person may overrule either.';

/* ==========================================================================
 * FILES
 * ========================================================================== */

function readJson(path, collection) {
  let body;
  try {
    body = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not readable JSON: ${detail}`);
  }
  if (body === null || typeof body !== 'object' || !Array.isArray(body[collection])) {
    throw new Error(`${path} must contain a ${collection} array`);
  }
  return body;
}

/** `JSON.stringify(value, null, 2)` plus a newline reproduces both files byte for byte. */
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * WRITE BOTH FILES, THEN LET THE GATE THAT SHIPS HAVE THE LAST WORD.
 *
 * `check-record-citations.mjs` is not weakened, bypassed, or reimplemented as
 * the authority - it is RUN, as its own process, over the file this function
 * just wrote. If it goes red both files go back byte for byte. A promoter that
 * can leave the record file failing its own citation check is a promoter that
 * breaks the build with an uncited allegation sitting in it.
 *
 * Paths and the check are injectable so this is exercised for real against
 * temporary files rather than trusted to have been written correctly.
 */
export function commitPlan({
  plan,
  note,
  generatedAt,
  recordsPath = RECORDS,
  candidatesPath = CANDIDATES,
  checkPath = CITATION_CHECK,
  runCheck = (path) => spawnSync(process.execPath, [path], { encoding: 'utf8' }),
}) {
  const recordsBefore = readFileSync(recordsPath, 'utf8');
  const candidatesBefore = readFileSync(candidatesPath, 'utf8');
  writeJson(recordsPath, {
    generatedAt: generatedAt.slice(0, 10),
    note,
    counties: plan.counties,
    records: plan.records,
  });
  writeJson(candidatesPath, {
    generatedAt,
    note: CANDIDATES_NOTE,
    candidates: plan.candidates,
  });

  const checked = runCheck(checkPath);
  const output = `${String(checked.stdout ?? '')}${String(checked.stderr ?? '')}`;
  if (checked.status !== 0) {
    writeFileSync(recordsPath, recordsBefore);
    writeFileSync(candidatesPath, candidatesBefore);
    return {
      ok: false,
      output,
      detail: 'check-record-citations.mjs rejected the written file; both files were rolled back',
    };
  }
  return { ok: true, output };
}

/* ==========================================================================
 * CLI
 * ========================================================================== */

function parseArgs(argv) {
  const options = {
    write: false,
    json: false,
    recheck: false,
    prune: false,
    limit: null,
    only: null,
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    pause: DEFAULT_PAUSE_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--write') options.write = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--recheck') options.recheck = true;
    else if (argument === '--prune') options.prune = true;
    else if (argument === '--limit') {
      if (value === undefined || !/^\d+$/.test(value))
        throw new UsageError('--limit needs an integer');
      options.limit = Number(value);
      index += 1;
    } else if (argument === '--only') {
      if (value === undefined) throw new UsageError('--only needs a source URL');
      try {
        options.only = normalizeSourceUrl(value);
      } catch (error) {
        throw new UsageError(`--only ${error instanceof Error ? error.message : String(error)}`);
      }
      index += 1;
    } else if (argument === '--model') {
      if (value === undefined || value.startsWith('--'))
        throw new UsageError('--model needs a model id');
      options.model = value;
      index += 1;
    } else if (argument === '--pause') {
      if (value === undefined || !/^\d+$/.test(value))
        throw new UsageError('--pause needs milliseconds');
      options.pause = Number(value);
      index += 1;
    } else throw new UsageError(`unknown argument: ${argument}`);
  }
  if (options.limit !== null && options.limit < 1)
    throw new UsageError('--limit must be at least 1');
  if (options.pause > 60_000) throw new UsageError('--pause must be at most 60000');
  return options;
}

/**
 * THIS DOES NOT RUN IN CI, AND THE REFUSAL IS THE ENFORCEMENT.
 *
 * A workflow that can promote candidates is a workflow that can publish an
 * allegation about a named police department with no person in the loop, on a
 * cron, from a runner. `misuse-patrol.yml` deliberately stops at opening a pull
 * request for exactly this reason. Nothing stops someone adding a step that
 * calls this file, so the file says no itself.
 */
export function assertNotCi(env = process.env) {
  const flags = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL'];
  const set = flags.filter((flag) => {
    const value = env[flag];
    return value !== undefined && value !== '' && value !== 'false' && value !== '0';
  });
  if (set.length > 0) {
    throw new UsageError(
      `refusing to run in CI (${set.join(', ')} is set). This script fetches sources, spends money ` +
        'and writes the allegation file. A person runs it and reads the output. ' +
        'check-record-citations.mjs is the CI gate.',
    );
  }
}

function tally(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  assertNotCi();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new UsageError('ANTHROPIC_API_KEY is not set; this script reads articles with it');
  }
  if (!existsSync(CANDIDATES)) {
    throw new UsageError(
      `${CANDIDATES} does not exist. Run scripts/misuse-patrol.mjs --write, or check out the ` +
        'misuse-patrol/candidates branch.',
    );
  }

  const recordsBody = readJson(RECORDS, 'records');
  const candidatesBody = readJson(CANDIDATES, 'candidates');
  const gazetteer = buildGazetteer(readJson(GAZETTEER, 'rows').rows);
  const say = options.json
    ? () => {}
    : (line) => {
        console.log(line);
      };

  const { chosen } = selectCandidates(candidatesBody.candidates, {
    limit: options.limit,
    only: options.only,
    recheck: options.recheck,
  });

  say(
    `${String(candidatesBody.candidates.length)} in the queue, ${String(chosen.length)} to examine, ` +
      `${String(recordsBody.records.length)} records on file`,
  );
  say(`model ${options.model}; ${options.write ? 'WILL WRITE' : 'dry run'}\n`);

  const outcomes = [];
  for (const [index, candidate] of chosen.entries()) {
    const key = normalizeSourceUrl(candidate.sourceUrl);
    say(
      `[${String(index + 1)}/${String(chosen.length)}] ${String(candidate.sourceName)}  ${String(candidate._title ?? '')}`,
    );
    /*
     * ONE BAD CANDIDATE MUST NOT COST THE OTHER HUNDRED AND FORTY-TWO.
     *
     * A queue of 143 is an hour of fetching and a bill, and an unforeseen throw
     * on candidate 40 would discard the 39 judgements already made. Whatever it
     * was, it is a failure of this script and not a finding about the article,
     * so it lands as PENDING and the run carries on.
     */
    let result;
    try {
      result = await examineCandidate({ candidate, gazetteer, apiKey, model: options.model });
    } catch (error) {
      result = {
        kind: 'pending',
        reason: PENDING_REASONS.EXAMINATION_FAILED,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    outcomes.push({ key, candidate, result });

    if (result.kind === 'promote') {
      const record = result.record;
      say(
        `        PROMOTE  ${record.fips} ${String(result.county?.label ?? '')}  ${record.agency}`,
      );
      say(
        `                 disposition ${record.disposition}; incidents ${String(record.incidents)}; year ${String(record.year)}`,
      );
      say(`                 ${record.summary}`);
      say(`                 ${record.sourceName}`);
    } else if (result.kind === 'drop') {
      say(`        DROP     ${result.reason}: ${result.detail}`);
    } else {
      say(`        PENDING  ${result.reason}: ${result.detail}`);
    }
    say('');

    if (index + 1 < chosen.length && options.pause > 0) {
      await new Promise((done) => setTimeout(done, options.pause));
    }
  }

  const generatedAt = new Date().toISOString();
  const plan = planWrite({
    records: recordsBody.records,
    candidates: candidatesBody.candidates,
    outcomes,
    prune: options.prune,
    generatedAt,
  });

  const drops = outcomes.filter((outcome) => outcome.result.kind === 'drop');
  const pendings = outcomes.filter((outcome) => outcome.result.kind === 'pending');
  const report = {
    examined: chosen.length,
    promoted: plan.promoted.map((outcome) => ({
      sourceUrl: outcome.result.record.sourceUrl,
      fips: outcome.result.record.fips,
      agency: outcome.result.record.agency,
      disposition: outcome.result.record.disposition,
      incidents: outcome.result.record.incidents,
      year: outcome.result.record.year,
    })),
    dropped: drops.map((outcome) => ({
      sourceUrl: outcome.candidate.sourceUrl,
      reason: outcome.result.reason,
      detail: outcome.result.detail,
    })),
    pending: pendings.map((outcome) => ({
      sourceUrl: outcome.candidate.sourceUrl,
      reason: outcome.result.reason,
      detail: outcome.result.detail,
    })),
    /*
     * WHAT WAS NOT LOOKED AT, NOT WHAT WAS SKIPPED FOR A REASON. `--only` and
     * `--limit` leave most of the queue untouched, and reporting zero there
     * would read as "the queue is clear" when the queue is 57 long.
     */
    notExamined: candidatesBody.candidates.length - chosen.length,
    [SKIP_ALREADY_RECORDED]: plan.alreadyRecorded,
    queueAfter: plan.candidates.length,
    recordsAfter: plan.records.length,
    wrote: false,
  };

  if (options.write) {
    const committed = commitPlan({ plan, note: recordsBody.note, generatedAt });
    if (!committed.ok) {
      console.error(committed.output);
      throw new Error(committed.detail);
    }
    report.wrote = true;
    say(committed.output.trim());
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  say('SUMMARY');
  say(`  promoted  ${String(report.promoted.length)}`);
  say(`  dropped   ${String(report.dropped.length)}`);
  for (const [reason, count] of tally(report.dropped.map((entry) => entry.reason))) {
    say(`      ${reason.padEnd(30)} ${String(count)}`);
  }
  say(`  pending   ${String(report.pending.length)}`);
  for (const [reason, count] of tally(report.pending.map((entry) => entry.reason))) {
    say(`      ${reason.padEnd(30)} ${String(count)}`);
  }
  say(`  not examined this run  ${String(report.notExamined)}`);
  if (plan.alreadyRecorded.length > 0) {
    say(
      `  ${String(plan.alreadyRecorded.length)} queue entries left the queue because their source ` +
        'is already cited in counties.json',
    );
  }
  say(`  queue after  ${String(report.queueAfter)}`);
  say(`  records after  ${String(report.recordsAfter)}`);
  say('');
  if (options.write) {
    say('wrote apps/pwa/public/records/counties.json and apps/pwa/public/records/candidates.json');
    say('READ THE PROMOTED SUMMARIES ABOVE BEFORE YOU COMMIT THEM. They are allegations.');
  } else {
    say('DRY RUN - nothing was written. Re-run with --write to commit this plan.');
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await runCli();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`promote-misuse-candidates: ${detail}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
