/**
 * THE PROMOTER'S TESTS ARE ABOUT WHAT IT REFUSES.
 *
 * A test suite for a script that publishes allegations about named police
 * departments earns its keep on the refusals, not on the happy path. The one
 * case that has already gone wrong in this queue - a candidate claiming a
 * guilty plea over an article that said the officer pleaded NOT guilty - has
 * two tests here, one for each of the two independent gates that stop it.
 *
 * Nothing in this file reaches the network. Every fetch and every model call is
 * injected, so the suite runs in CI - which is the only part of this script
 * that ever should.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeSourceUrl } from './misuse-patrol.mjs';
import {
  CANDIDATES_NOTE,
  DROP_REASONS,
  PENDING_REASONS,
  addressIsPublic,
  agencyMissingFrom,
  agencyParts,
  articleCeiling,
  assertNotCi,
  assertedDispositions,
  buildGazetteer,
  citationProblems,
  commitPlan,
  examineCandidate,
  fetchArticle,
  htmlToText,
  incidentsSupported,
  parseExtraction,
  planWrite,
  quoteIsInArticle,
  readPageMetadata,
  resolveFips,
  selectCandidates,
  sourceNameFor,
  verifyExtraction,
} from './promote-misuse-candidates.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const GAZETTEER_FILE = join(ROOT, 'apps/pwa/public/cameras/counties.json');
const CITATION_CHECK = join(HERE, 'check-record-citations.mjs');

const GAZETTEER = buildGazetteer(JSON.parse(readFileSync(GAZETTEER_FILE, 'utf8')).rows);

/* -------------------------------------------------------------------------
 * Fixtures. Two articles: one that supports a record, one that is the trap.
 * ---------------------------------------------------------------------- */

const GWINNETT_ARTICLE = [
  'Three Gwinnett County Police Department officers were fired and criminally charged this week',
  "after an internal investigation found they used the department's Flock Safety license plate",
  'reader network to look up vehicles for personal reasons, the department said Friday.',
  '',
  'Gwinnett County Police Department Chief J.D. McClure said an audit found the three officers ran',
  'unauthorized searches of the license plate reader database between March and July 2026 without',
  'any case number attached to them.',
  '',
  'The three officers were charged with computer trespass, a felony under Georgia law, and each was',
  'terminated on Sept. 2, 2026.',
].join(' ');

const GWINNETT_CANDIDATE = Object.freeze({
  fips: '',
  agency: '',
  summary: '',
  incidents: 0,
  year: 0,
  sourceUrl:
    'https://www.atlantanewsfirst.com/2026/09/05/3-gwinnett-police-officers-fired-charged-alleged-flock-camera-misuse/',
  sourceName: 'atlantanewsfirst.com',
  _title: '3 Gwinnett police officers fired, charged for alleged Flock camera misuse',
  _description: '',
  _publishedAt: '2026-09-05T05:30:00.000Z',
  _query: '"license plate reader" stalking officer sourcelang:english',
});

const GWINNETT_EXTRACTION = Object.freeze({
  documentsMisuse: true,
  misuseQuote:
    "Three Gwinnett County Police Department officers were fired and criminally charged this week after an internal investigation found they used the department's Flock Safety license plate reader network to look up vehicles for personal reasons, the department said Friday.",
  agency: 'Gwinnett County Police Department',
  agencyQuote:
    'Gwinnett County Police Department Chief J.D. McClure said an audit found the three officers ran unauthorized searches of the license plate reader database between March and July 2026 without any case number attached to them.',
  place: 'Gwinnett County',
  county: 'Gwinnett',
  state: 'GA',
  locationQuote:
    'Gwinnett County Police Department Chief J.D. McClure said an audit found the three officers ran unauthorized searches of the license plate reader database between March and July 2026 without any case number attached to them.',
  disposition: 'charged',
  dispositionQuote:
    'The three officers were charged with computer trespass, a felony under Georgia law, and each was terminated on Sept. 2, 2026.',
  incidents: 3,
  incidentsQuote:
    'Gwinnett County Police Department Chief J.D. McClure said an audit found the three officers ran unauthorized searches of the license plate reader database between March and July 2026 without any case number attached to them.',
  year: 2026,
  yearQuote: 'terminated on Sept. 2, 2026.',
  outlet: 'Atlanta News First',
  summary:
    'An internal investigation at the Gwinnett County Police Department found three officers ran unauthorized searches of the department’s Flock Safety license plate reader network for personal reasons between March and July 2026. All three were charged with computer trespass and terminated on Sept. 2, 2026.',
});

/*
 * THE TRAP. The officer pleaded NOT guilty. The article also contains the word
 * "charged", a resignation and a count of searches, so everything except the
 * plea is extractable - which is exactly why a careless read upgrades it.
 */
const NOT_GUILTY_ARTICLE = [
  'A former Apache Junction police officer pleaded not guilty Tuesday to charges that he misused',
  "the Apache Junction Police Department's Flock Safety license plate reader system to track his",
  "estranged wife's vehicle.",
  '',
  'Prosecutors say the officer ran unauthorized searches of the license plate reader database on 14',
  'occasions in April 2026. He was charged in August with one count of computer tampering.',
  '',
  'The Apache Junction Police Department placed him on administrative leave before he resigned in',
  'May 2026. His trial is set for January.',
].join(' ');

const NOT_GUILTY_CANDIDATE = Object.freeze({
  ...GWINNETT_CANDIDATE,
  sourceUrl: 'https://www.fox10phoenix.com/news/apache-junction-officer-plea',
  sourceName: 'fox10phoenix.com',
  _title: 'Former Apache Junction officer pleads not guilty in Flock misuse case',
});

const NOT_GUILTY_EXTRACTION = Object.freeze({
  documentsMisuse: true,
  misuseQuote:
    'Prosecutors say the officer ran unauthorized searches of the license plate reader database on 14 occasions in April 2026.',
  agency: 'Apache Junction Police Department',
  agencyQuote:
    'The Apache Junction Police Department placed him on administrative leave before he resigned in May 2026.',
  place: 'Apache Junction',
  county: 'Pinal',
  state: 'AZ',
  locationQuote:
    'A former Apache Junction police officer pleaded not guilty Tuesday to charges that he misused the Apache Junction Police Department’s Flock Safety license plate reader system to track his estranged wife’s vehicle.',
  disposition: 'pleaded_not_guilty',
  dispositionQuote:
    'A former Apache Junction police officer pleaded not guilty Tuesday to charges that he misused the Apache Junction Police Department’s Flock Safety license plate reader system to track his estranged wife’s vehicle.',
  incidents: 1,
  incidentsQuote:
    'Prosecutors say the officer ran unauthorized searches of the license plate reader database on 14 occasions in April 2026.',
  year: 2026,
  yearQuote: 'He was charged in August with one count of computer tampering.',
  outlet: 'FOX 10 Phoenix',
  summary:
    'A former Apache Junction Police Department officer pleaded not guilty to charges that he used the department’s Flock Safety license plate reader system to track his estranged wife’s vehicle in April 2026. The department placed him on leave before he resigned that May.',
});

function verify(
  extraction,
  { candidate = GWINNETT_CANDIDATE, articleText = GWINNETT_ARTICLE } = {},
) {
  return verifyExtraction({
    candidate,
    articleText,
    extraction,
    gazetteer: GAZETTEER,
    sourceName: 'Atlanta News First, September 5, 2026',
  });
}

describe('the disposition ladder', () => {
  it('reads "pleaded not guilty" as a denial and never as an admission', () => {
    assert.deepEqual(assertedDispositions('He entered a not guilty plea.'), ['pleaded_not_guilty']);
    assert.deepEqual(assertedDispositions('He pleaded not guilty.'), ['pleaded_not_guilty']);
    assert.ok(assertedDispositions('He pleaded guilty.').includes('pleaded_guilty'));
    assert.ok(!assertedDispositions('He pleaded not guilty.').includes('pleaded_guilty'));
    assert.ok(!assertedDispositions('a not guilty plea was entered').includes('pleaded_guilty'));
  });

  it('caps an article that records a denial, and says it is contested', () => {
    const ceiling = articleCeiling(NOT_GUILTY_ARTICLE);
    assert.equal(ceiling.contested, true);
    assert.equal(ceiling.ceiling, 'pleaded_not_guilty');

    const clean = articleCeiling(GWINNETT_ARTICLE);
    assert.equal(clean.contested, false);
    assert.equal(clean.ceiling, 'charged');
  });
});

describe('a not-guilty article can never produce a guilty record', () => {
  /*
   * GATE ONE. The extraction claims the plea was guilty. The article says the
   * opposite, and the drop is named for exactly that fact so the run's output
   * says which article it was.
   */
  it('refuses an extraction that upgrades the plea', () => {
    const verdict = verify(
      { ...NOT_GUILTY_EXTRACTION, disposition: 'pleaded_guilty' },
      { candidate: NOT_GUILTY_CANDIDATE, articleText: NOT_GUILTY_ARTICLE },
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.CONTESTED_PLEA);
  });

  it('refuses a conviction claimed over a denial', () => {
    const verdict = verify(
      { ...NOT_GUILTY_EXTRACTION, disposition: 'convicted' },
      { candidate: NOT_GUILTY_CANDIDATE, articleText: NOT_GUILTY_ARTICLE },
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.CONTESTED_PLEA);
  });

  /*
   * GATE TWO, INDEPENDENT OF GATE ONE. The disposition is extracted correctly
   * and only the prose upgrades it. This is the failure that ships if the
   * summary is trusted because the structured fields looked right.
   */
  it('refuses a summary that says guilty plea over a not-guilty disposition', () => {
    const verdict = verify(
      {
        ...NOT_GUILTY_EXTRACTION,
        summary:
          'A former Apache Junction Police Department officer pleaded guilty to charges that he used the department’s Flock Safety license plate reader system to track his estranged wife’s vehicle in April 2026.',
      },
      { candidate: NOT_GUILTY_CANDIDATE, articleText: NOT_GUILTY_ARTICLE },
    );
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.SUMMARY_UPGRADES_DISPOSITION);
    assert.match(verdict.detail, /pleaded guilty/);
  });

  it('refuses a summary that convicts where the article only charged', () => {
    const verdict = verify({
      ...GWINNETT_EXTRACTION,
      summary:
        'Three Gwinnett County Police Department officers were convicted of computer trespass after an audit found they ran unauthorized license plate reader searches for personal reasons in 2026.',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.SUMMARY_UPGRADES_DISPOSITION);
  });

  it('promotes the same article when the record follows the plea', () => {
    const verdict = verify(NOT_GUILTY_EXTRACTION, {
      candidate: NOT_GUILTY_CANDIDATE,
      articleText: NOT_GUILTY_ARTICLE,
    });
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
    assert.equal(verdict.record.fips, '04021');
    assert.equal(verdict.record.disposition, 'pleaded_not_guilty');
    assert.match(verdict.record.summary, /pleaded not guilty/);
    assert.ok(!/pleaded guilty/.test(verdict.record.summary));
  });

  it('refuses a stronger claim than the one sentence it was cited from', () => {
    const verdict = verify({
      ...GWINNETT_EXTRACTION,
      disposition: 'convicted',
      dispositionQuote:
        'The three officers were charged with computer trespass, a felony under Georgia law, and each was terminated on Sept. 2, 2026.',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.DISPOSITION_EXCEEDS_ARTICLE);
  });
});

describe('a county it cannot resolve is a drop, never a guess', () => {
  it('drops a county that is not in the camera gazetteer', () => {
    const verdict = verify({ ...GWINNETT_EXTRACTION, county: 'Ravenloft', state: 'GA' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.COUNTY_UNRESOLVED);
    assert.match(verdict.detail, /cameras\/counties\.json/);
  });

  it('drops a county whose name matches two rows with nothing to settle it', () => {
    const ambiguous = resolveFips(GAZETTEER, { county: 'Baltimore', state: 'MD' });
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.reason, DROP_REASONS.COUNTY_AMBIGUOUS);

    const settled = resolveFips(GAZETTEER, {
      county: 'Baltimore',
      state: 'MD',
      countyType: 'city',
    });
    assert.equal(settled.ok, true);
    assert.equal(settled.row.fips, '24510');
  });

  it('drops a location the article never names', () => {
    const verdict = verify({
      ...GWINNETT_EXTRACTION,
      county: 'Fulton',
      place: 'Atlanta',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.LOCATION_NOT_IN_ARTICLE);
  });

  it('normalizes county spellings the way the gazetteer writes them', () => {
    assert.equal(
      resolveFips(GAZETTEER, { county: 'St. Clair County', state: 'AL' }).row.fips,
      '01115',
    );
    assert.equal(resolveFips(GAZETTEER, { county: 'st clair', state: 'al' }).row.fips, '01115');
  });
});

describe('an article that does not document ALPR misuse is dropped', () => {
  it('takes the model at its word when it refuses', () => {
    const verdict = verify({
      documentsMisuse: false,
      refusalReason: 'This is an explainer about how Flock cameras work in Milwaukee.',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.NOT_MISUSE);
    assert.match(verdict.detail, /explainer/);
  });

  /*
   * The floor under the model's answer. If the fetched text has no word for the
   * technology, then whatever the model read, it did not read it here - and no
   * amount of confidently extracted structure gets past that.
   */
  it('drops a confident extraction over an article with no plate readers in it', () => {
    const verdict = verify(GWINNETT_EXTRACTION, {
      articleText:
        'The Gwinnett County Police Department said three officers were charged with computer trespass on Sept. 2, 2026 after an unauthorized and improper search of a records system used to look up vehicles for personal reasons during a policy violation review that year.',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.NO_ALPR_SUBJECT);
  });

  it('drops an article about plate readers that alleges nothing', () => {
    const verdict = verify(GWINNETT_EXTRACTION, {
      articleText:
        'The Gwinnett County Police Department installed a Flock Safety license plate reader network in 2026, and Chief J.D. McClure said the automated license plate reader cameras had helped recover stolen vehicles across the county since March, with three cameras added in July 2026 and more planned.',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.NO_MISUSE_LANGUAGE);
  });
});

describe('the quote check catches an invented article', () => {
  it('drops an extraction whose supporting sentence is not in the text', () => {
    const verdict = verify({
      ...GWINNETT_EXTRACTION,
      dispositionQuote:
        'A grand jury returned an indictment against all three officers on the first of September.',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.QUOTE_NOT_IN_ARTICLE);
    assert.match(verdict.detail, /dispositionQuote/);
  });

  it('accepts a quote that differs only in typographic punctuation', () => {
    assert.ok(
      quoteIsInArticle(
        'the department’s Flock Safety license plate reader network',
        GWINNETT_ARTICLE,
      ),
    );
    assert.ok(
      !quoteIsInArticle('the department paid Flock Safety for the network', GWINNETT_ARTICLE),
    );
  });

  it('will not accept a quote too short to mean anything', () => {
    assert.ok(!quoteIsInArticle('the', GWINNETT_ARTICLE));
    assert.ok(!quoteIsInArticle('Gwinnett County', GWINNETT_ARTICLE));
  });
});

describe('incidents is a number the article states', () => {
  it('refuses to turn "several" into a count', () => {
    assert.equal(incidentsSupported(3, 'several officers were fired over the misuse').ok, false);
    assert.equal(
      incidentsSupported(3, 'several officers were fired over the misuse').reason,
      DROP_REASONS.INCIDENTS_NOT_COUNTED,
    );
    assert.equal(incidentsSupported(1, 'several officers were fired over the misuse').ok, false);
  });

  it('accepts a count the article writes in digits or in words', () => {
    assert.equal(incidentsSupported(3, 'the three officers ran unauthorized searches').ok, true);
    assert.equal(incidentsSupported(14, 'searched the database on 14 occasions').ok, true);
    assert.equal(incidentsSupported(1, 'the officer looked up his wife’s plate').ok, true);
  });

  it('refuses anything that is not a positive integer', () => {
    for (const value of [0, -1, 2.5, '3', null, undefined, Number.NaN]) {
      assert.equal(incidentsSupported(value, 'the three officers').ok, false);
    }
  });

  it('drops a record whose count the article does not carry', () => {
    const verdict = verify({
      ...GWINNETT_EXTRACTION,
      incidents: 7,
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.INCIDENTS_NOT_COUNTED);
  });
});

describe('the agency has to be an agency, and has to be in the article', () => {
  it('splits a record filed against two departments', () => {
    assert.deepEqual(agencyParts('Moody Police Department and Springville Police Department'), [
      'Moody Police Department',
      'Springville Police Department',
    ]);
  });

  it('refuses the camera vendor', () => {
    const verdict = verify({ ...GWINNETT_EXTRACTION, agency: 'Flock Safety' });
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.reason === DROP_REASONS.AGENCY_NOT_LAW_ENFORCEMENT ||
        verdict.reason === DROP_REASONS.AGENCY_NOT_NAMED,
    );
  });

  /*
   * A newsroom writes "Springville Police Chief Jason Mize", not "the
   * Springville Police Department". Requiring the formal name verbatim refuses
   * records that are perfectly well sourced - the record already on file for
   * St. Clair County is one of them - so what has to be present is every word
   * that identifies WHICH agency.
   */
  it('accepts an agency the article names the way newsrooms name them', () => {
    const article =
      'Springville Police Chief Jason Mize said an audit of the Flock license plate reader system found unauthorized checks on a family member, and Moody Police Chief Reece Smith fired an employee over the same policy violation.';
    const normalized = article.toLowerCase();
    assert.equal(agencyMissingFrom('Springville Police Department', normalized), null);
    assert.equal(agencyMissingFrom('Moody Police Department', normalized), null);
    assert.equal(agencyMissingFrom('DeKalb County Police Department', normalized), 'dekalb');
    assert.equal(agencyMissingFrom('Police Department', normalized), 'police department');
  });

  it('refuses an agency the article never names', () => {
    const verdict = verify({ ...GWINNETT_EXTRACTION, agency: 'DeKalb County Police Department' });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.AGENCY_NOT_IN_ARTICLE);
  });

  it('refuses a summary that never names who it accuses', () => {
    const verdict = verify({
      ...GWINNETT_EXTRACTION,
      summary:
        'An internal investigation found three officers ran unauthorized searches of a Flock Safety license plate reader network for personal reasons between March and July 2026, and all three were charged with computer trespass.',
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.SUMMARY_OMITS_AGENCY);
  });
});

describe('the year has to come from somewhere', () => {
  it('drops a year that is neither in the article nor its publication year', () => {
    const verdict = verify({ ...GWINNETT_EXTRACTION, year: 2019 });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.YEAR_UNSUPPORTED);
  });

  it('drops a year after the article was published', () => {
    const verdict = verify({ ...GWINNETT_EXTRACTION, year: 2031 });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, DROP_REASONS.YEAR_UNSUPPORTED);
  });
});

/* -------------------------------------------------------------------------
 * Fetching. Nothing here touches the network: fetch and DNS are injected.
 * ---------------------------------------------------------------------- */

function htmlResponse(body, init = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    ...init,
  });
}

const PUBLIC_DNS = async () => [{ address: '203.0.113.34', family: 4 }];

const ARTICLE_PAGE = `<!doctype html><html><head><title>Three officers charged</title>
<meta property="og:site_name" content="Atlanta News First">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"Three officers charged","datePublished":"2026-09-05T05:30:00Z","publisher":{"name":"Atlanta News First"},"articleBody":${JSON.stringify(GWINNETT_ARTICLE)}}</script>
</head><body><nav>Most read</nav><p>${GWINNETT_ARTICLE}</p><script>tracker()</script></body></html>`;

describe('fetching an article', () => {
  it('prefers the page’s own structured article body over the stripped page', async () => {
    const meta = readPageMetadata(ARTICLE_PAGE);
    assert.equal(meta.outlet, 'Atlanta News First');
    assert.equal(meta.published, '2026-09-05T05:30:00Z');
    assert.match(meta.body, /Three Gwinnett County Police Department officers/);
    assert.ok(!meta.body.includes('Most read'));
  });

  it('strips scripts and markup out of a page that has no structured body', () => {
    const text = htmlToText('<p>One &amp; two</p><script>secret()</script><div>Three</div>');
    assert.match(text, /One & two/);
    assert.ok(!text.includes('secret'));
  });

  it('reads a live-shaped article into text and metadata', async () => {
    const article = await fetchArticle({
      url: GWINNETT_CANDIDATE.sourceUrl,
      fetchImpl: async () => htmlResponse(ARTICLE_PAGE),
      lookupImpl: PUBLIC_DNS,
    });
    assert.equal(article.ok, true);
    assert.equal(article.outlet, 'Atlanta News First');
    assert.match(article.text, /computer trespass/);
  });

  /*
   * A FETCH THAT FAILED IS NOT AN ARTICLE THAT SAID NOTHING.
   *
   * Every one of these is PENDING, never a drop. Turning a 503, a paywall stub
   * or a PDF into "this article documents no misuse" would be writing a finding
   * out of a page nobody read.
   */
  it('leaves an unreadable source pending rather than dropping it', async () => {
    const cases = [
      [async () => htmlResponse('nope', { status: 503 }), PENDING_REASONS.FETCH_FAILED],
      [
        async () =>
          new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
        PENDING_REASONS.NOT_HTML,
      ],
      [
        async () => htmlResponse('<html><body><p>Subscribe to continue reading.</p></body></html>'),
        PENDING_REASONS.ARTICLE_TOO_SHORT,
      ],
      [
        async () => {
          throw new Error('ECONNRESET');
        },
        PENDING_REASONS.FETCH_FAILED,
      ],
    ];
    for (const [fetchImpl, reason] of cases) {
      const article = await fetchArticle({
        url: GWINNETT_CANDIDATE.sourceUrl,
        fetchImpl,
        lookupImpl: PUBLIC_DNS,
      });
      assert.equal(article.ok, false);
      assert.equal(article.kind, 'pending');
      assert.equal(article.reason, reason);
    }
  });

  it('refuses a source that resolves inside the network it is run from', async () => {
    const article = await fetchArticle({
      url: 'https://intranet.example.com/story',
      fetchImpl: async () => {
        throw new Error('should never be called');
      },
      lookupImpl: async () => [{ address: '10.0.0.5', family: 4 }],
    });
    assert.equal(article.ok, false);
    assert.equal(article.kind, 'drop');
    assert.equal(article.reason, DROP_REASONS.UNSAFE_SOURCE_HOST);
  });

  it('knows which addresses are not on the public internet', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '169.254.169.254',
      '172.20.0.1',
      '100.64.0.1',
    ]) {
      assert.equal(addressIsPublic(address, 4).ok, false, address);
    }
    assert.equal(addressIsPublic('203.0.113.34', 4).ok, true);
    assert.equal(addressIsPublic('::1', 6).ok, false);
    assert.equal(addressIsPublic('::ffff:127.0.0.1', 6).ok, false);
    assert.equal(addressIsPublic('2606:2800:220:1::', 6).ok, true);
  });

  it('names the source the way the record file already names sources', () => {
    assert.equal(
      sourceNameFor({
        outlet: 'Atlanta News First',
        publishedDate: '2026-09-05T05:30:00Z',
        candidate: GWINNETT_CANDIDATE,
      }),
      'Atlanta News First, September 5, 2026',
    );
    assert.equal(
      sourceNameFor({ outlet: '', publishedDate: '', candidate: GWINNETT_CANDIDATE }),
      'atlantanewsfirst.com, September 5, 2026',
    );
  });
});

describe('reading the model’s answer', () => {
  it('takes the tool call, and falls back to a fenced JSON object', () => {
    assert.deepEqual(
      parseExtraction({ content: [{ type: 'tool_use', input: { documentsMisuse: false } }] }),
      { ok: true, extraction: { documentsMisuse: false } },
    );
    assert.deepEqual(
      parseExtraction({
        content: [{ type: 'text', text: '```json\n{"documentsMisuse":true}\n```' }],
      }),
      { ok: true, extraction: { documentsMisuse: true } },
    );
    assert.equal(parseExtraction({ content: [{ type: 'text', text: 'I could not.' }] }).ok, false);
    assert.equal(parseExtraction(null).ok, false);
  });
});

/* -------------------------------------------------------------------------
 * End to end, with the fetch and the model injected.
 * ---------------------------------------------------------------------- */

function fakeExaminers({ article = GWINNETT_ARTICLE, extraction = GWINNETT_EXTRACTION } = {}) {
  return {
    fetchArticleImpl: async () => ({
      ok: true,
      text: article,
      outlet: 'Atlanta News First',
      headline: 'Three officers charged',
      publishedDate: '2026-09-05T05:30:00Z',
      finalUrl: GWINNETT_CANDIDATE.sourceUrl,
    }),
    extractImpl: async () => ({ ok: true, extraction }),
  };
}

describe('one candidate, end to end', () => {
  it('promotes a candidate whose article supports every field', async () => {
    const result = await examineCandidate({
      candidate: GWINNETT_CANDIDATE,
      gazetteer: GAZETTEER,
      apiKey: 'not-a-real-key',
      ...fakeExaminers(),
    });
    assert.equal(result.kind, 'promote');
    assert.equal(result.record.fips, '13135');
    assert.equal(result.record.agency, 'Gwinnett County Police Department');
    assert.equal(result.record.incidents, 3);
    assert.equal(result.record.year, 2026);
    assert.equal(result.record.sourceName, 'Atlanta News First, September 5, 2026');
    assert.equal(result.record.sourceUrl, GWINNETT_CANDIDATE.sourceUrl);
  });

  it('reports a model failure as pending, never as a refusal of the article', async () => {
    const result = await examineCandidate({
      candidate: GWINNETT_CANDIDATE,
      gazetteer: GAZETTEER,
      apiKey: 'not-a-real-key',
      fetchArticleImpl: fakeExaminers().fetchArticleImpl,
      extractImpl: async () => ({
        ok: false,
        reason: PENDING_REASONS.MODEL_UNAVAILABLE,
        detail: 'HTTP 529',
      }),
    });
    assert.equal(result.kind, 'pending');
    assert.equal(result.reason, PENDING_REASONS.MODEL_UNAVAILABLE);
  });
});

/* -------------------------------------------------------------------------
 * The write plan, and the property that re-running is safe.
 * ---------------------------------------------------------------------- */

const EXISTING_RECORD = Object.freeze({
  fips: '01115',
  agency: 'Moody Police Department and Springville Police Department',
  summary:
    'Audits of the Flock systems at two St. Clair County departments found license plate reader policy violations at both, and both cases were turned over to the Alabama Law Enforcement Agency for review.',
  incidents: 2,
  year: 2026,
  sourceUrl:
    'https://www.wbrc.com/2026/07/27/employees-2-police-departments-st-clair-county-violated-flock-camera-policy/',
  sourceName: 'WBRC FOX6 Birmingham, July 27, 2026',
});

async function examineAll(candidates, examiners) {
  const outcomes = [];
  for (const candidate of candidates) {
    outcomes.push({
      key: normalizeSourceUrl(candidate.sourceUrl),
      candidate,
      result: await examineCandidate({
        candidate,
        gazetteer: GAZETTEER,
        apiKey: 'not-a-real-key',
        ...examiners,
      }),
    });
  }
  return outcomes;
}

describe('re-running promotes nothing twice', () => {
  it('moves a promoted candidate out of the queue and never back into the records', async () => {
    const candidates = [GWINNETT_CANDIDATE];
    const first = planWrite({
      records: [EXISTING_RECORD],
      candidates,
      outcomes: await examineAll(candidates, fakeExaminers()),
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.equal(first.records.length, 2);
    assert.equal(first.candidates.length, 0);
    assert.deepEqual(
      first.records.map((record) => record.fips),
      ['01115', '13135'],
    );

    /* The second run sees the file the first run wrote: an empty queue. */
    const second = planWrite({
      records: first.records,
      candidates: first.candidates,
      outcomes: [],
      generatedAt: '2026-09-08T01:00:00.000Z',
    });
    assert.deepEqual(second.records, first.records);
    assert.equal(second.candidates.length, 0);
  });

  /*
   * The harder half. Someone restores the queue from the patrol branch, so the
   * candidate is back AND the record is already on file. Examining it again
   * must not append a second copy - the canonical source URL is the key, the
   * same one the patrol dedupes with.
   */
  it('refuses to append a second record for a source already cited', async () => {
    const first = planWrite({
      records: [EXISTING_RECORD],
      candidates: [GWINNETT_CANDIDATE],
      outcomes: await examineAll([GWINNETT_CANDIDATE], fakeExaminers()),
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    const again = planWrite({
      records: first.records,
      candidates: [GWINNETT_CANDIDATE],
      outcomes: await examineAll([GWINNETT_CANDIDATE], fakeExaminers()),
      generatedAt: '2026-09-08T02:00:00.000Z',
    });
    assert.equal(again.records.length, 2);
    assert.equal(again.candidates.length, 0);
  });

  it('spends a queue entry whose source was promoted by hand, without examining it', () => {
    const promotedByHand = {
      ...GWINNETT_CANDIDATE,
      sourceUrl: `${EXISTING_RECORD.sourceUrl}?utm_source=newsletter`,
    };
    const plan = planWrite({
      records: [EXISTING_RECORD],
      candidates: [promotedByHand],
      outcomes: [],
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.equal(plan.candidates.length, 0);
    assert.equal(plan.records.length, 1);
  });

  it('writes the refusal onto the candidate it refused, and keeps it in the queue', async () => {
    const outcomes = await examineAll(
      [NOT_GUILTY_CANDIDATE],
      fakeExaminers({
        article: NOT_GUILTY_ARTICLE,
        extraction: { ...NOT_GUILTY_EXTRACTION, disposition: 'pleaded_guilty' },
      }),
    );
    const plan = planWrite({
      records: [EXISTING_RECORD],
      candidates: [NOT_GUILTY_CANDIDATE],
      outcomes,
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.equal(plan.records.length, 1);
    assert.equal(plan.candidates.length, 1);
    assert.equal(plan.candidates[0]._drop, DROP_REASONS.CONTESTED_PLEA);
    assert.equal(plan.candidates[0]._droppedAt, '2026-09-08T00:00:00.000Z');
    assert.match(plan.candidates[0]._dropDetail, /not-guilty plea/);

    /* And a re-run skips it rather than paying to be refused twice. */
    assert.equal(selectCandidates(plan.candidates).chosen.length, 0);
    assert.equal(selectCandidates(plan.candidates, { recheck: true }).chosen.length, 1);
    /* Unless a person asks for it gone - whether the refusal is on file... */
    const pruned = planWrite({
      records: [EXISTING_RECORD],
      candidates: plan.candidates,
      outcomes: [],
      prune: true,
      generatedAt: '2026-09-08T03:00:00.000Z',
    });
    assert.equal(pruned.candidates.length, 0);
    /* ...or made in this very run. */
    const prunedFresh = planWrite({
      records: [EXISTING_RECORD],
      candidates: [NOT_GUILTY_CANDIDATE],
      outcomes,
      prune: true,
      generatedAt: '2026-09-08T03:00:00.000Z',
    });
    assert.equal(prunedFresh.candidates.length, 0);
    assert.equal(prunedFresh.records.length, 1);
  });

  it('leaves a pending candidate in the queue with no refusal written on it', async () => {
    const outcomes = await examineAll([GWINNETT_CANDIDATE], {
      fetchArticleImpl: async () => ({
        ok: false,
        kind: 'pending',
        reason: PENDING_REASONS.FETCH_FAILED,
        detail: 'HTTP 503',
      }),
      extractImpl: async () => {
        throw new Error('the model must not be called for an article that was never fetched');
      },
    });
    const plan = planWrite({
      records: [],
      candidates: [GWINNETT_CANDIDATE],
      outcomes,
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.equal(plan.candidates.length, 1);
    assert.equal(plan.candidates[0]._pending, PENDING_REASONS.FETCH_FAILED);
    assert.equal(plan.candidates[0]._drop, undefined);
    assert.equal(selectCandidates(plan.candidates).chosen.length, 1);
  });

  it('counts the counties the record file claims to cover', async () => {
    const plan = planWrite({
      records: [EXISTING_RECORD],
      candidates: [GWINNETT_CANDIDATE],
      outcomes: await examineAll([GWINNETT_CANDIDATE], fakeExaminers()),
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.equal(plan.counties, 2);
  });

  it('honours --limit and --only without touching what it did not examine', () => {
    const queue = [GWINNETT_CANDIDATE, NOT_GUILTY_CANDIDATE];
    assert.equal(selectCandidates(queue, { limit: 1 }).chosen.length, 1);
    assert.deepEqual(
      selectCandidates(queue, { only: NOT_GUILTY_CANDIDATE.sourceUrl }).chosen.map(
        (c) => c.sourceUrl,
      ),
      [NOT_GUILTY_CANDIDATE.sourceUrl],
    );
    const plan = planWrite({
      records: [],
      candidates: queue,
      outcomes: [],
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.equal(plan.candidates.length, 2);
  });
});

/* -------------------------------------------------------------------------
 * The gate that ships still passes.
 * ---------------------------------------------------------------------- */

const TEMP_ROOTS = [];
after(() => {
  for (const path of TEMP_ROOTS) rmSync(path, { recursive: true, force: true });
});

describe('a promoted record passes check-record-citations.mjs', () => {
  it('passes the real check, run as the real subprocess, over the real file shape', async () => {
    const root = mkdtempSync(join(tmpdir(), 'promote-misuse-'));
    TEMP_ROOTS.push(root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'apps/pwa/public/records'), { recursive: true });
    mkdirSync(join(root, 'apps/pwa/public/cameras'), { recursive: true });
    cpSync(CITATION_CHECK, join(root, 'scripts/check-record-citations.mjs'));
    cpSync(GAZETTEER_FILE, join(root, 'apps/pwa/public/cameras/counties.json'));

    const plan = planWrite({
      records: [EXISTING_RECORD],
      candidates: [GWINNETT_CANDIDATE, NOT_GUILTY_CANDIDATE],
      outcomes: [
        ...(await examineAll([GWINNETT_CANDIDATE], fakeExaminers())),
        ...(await examineAll(
          [NOT_GUILTY_CANDIDATE],
          fakeExaminers({ article: NOT_GUILTY_ARTICLE, extraction: NOT_GUILTY_EXTRACTION }),
        )),
      ],
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.equal(plan.records.length, 3);

    writeFileSync(
      join(root, 'apps/pwa/public/records/counties.json'),
      `${JSON.stringify(
        {
          generatedAt: '2026-09-08',
          note: 'Documented ALPR misuse, one entry per published finding.',
          counties: plan.counties,
          records: plan.records,
        },
        null,
        2,
      )}\n`,
    );

    const checked = spawnSync(
      process.execPath,
      [join(root, 'scripts/check-record-citations.mjs')],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
    assert.match(checked.stdout, /3\/3 records fully cited/);
  });

  it('applies the same assertions the check makes, one record at a time', () => {
    const known = GAZETTEER.byFips;
    assert.deepEqual(citationProblems({ ...EXISTING_RECORD }, known), []);
    assert.deepEqual(citationProblems({ ...EXISTING_RECORD, fips: '99999' }, known), [
      'is filed against unknown county FIPS 99999',
    ]);
    assert.deepEqual(citationProblems({ ...EXISTING_RECORD, incidents: 0 }, known), [
      'has no positive integer incident count',
    ]);
    assert.deepEqual(citationProblems({ ...EXISTING_RECORD, sourceUrl: 'ftp://x/y' }, known), [
      'has no http(s) sourceUrl',
    ]);
  });

  it('carries the disposition on the record without disturbing the file’s shape', async () => {
    const [outcome] = await examineAll([GWINNETT_CANDIDATE], fakeExaminers());
    assert.deepEqual(Object.keys(outcome.result.record), [
      'fips',
      'agency',
      'summary',
      'incidents',
      'year',
      'sourceUrl',
      'sourceName',
      'disposition',
    ]);
  });
});

describe('this is not a build step', () => {
  it('refuses to run anywhere that looks like CI', () => {
    for (const flag of [
      'CI',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'BUILDKITE',
      'CIRCLECI',
      'JENKINS_URL',
    ]) {
      assert.throws(() => assertNotCi({ [flag]: 'true' }), /refusing to run in CI/);
    }
    assert.throws(() => assertNotCi({ CI: '1' }), /refusing to run in CI/);
    assert.doesNotThrow(() => assertNotCi({}));
    assert.doesNotThrow(() => assertNotCi({ CI: '' }));
    assert.doesNotThrow(() => assertNotCi({ CI: 'false' }));
  });

  it('is not wired into any workflow, and no workflow calls it', () => {
    const workflows = join(ROOT, '.github/workflows');
    const found = spawnSync('grep', ['-rl', 'promote-misuse-candidates', workflows], {
      encoding: 'utf8',
    });
    assert.equal(found.stdout.trim(), '', `a workflow references the promoter:\n${found.stdout}`);
  });

  it('tells the queue what the annotations mean', () => {
    assert.match(CANDIDATES_NOTE, /REVIEW QUEUE, NOT RECORDS/);
    assert.match(CANDIDATES_NOTE, /_drop/);
    assert.match(CANDIDATES_NOTE, /_pending/);
  });
});

describe('writing the allegation file', () => {
  function scratchFiles(records) {
    const root = mkdtempSync(join(tmpdir(), 'promote-commit-'));
    TEMP_ROOTS.push(root);
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'apps/pwa/public/records'), { recursive: true });
    mkdirSync(join(root, 'apps/pwa/public/cameras'), { recursive: true });
    cpSync(CITATION_CHECK, join(root, 'scripts/check-record-citations.mjs'));
    cpSync(GAZETTEER_FILE, join(root, 'apps/pwa/public/cameras/counties.json'));
    const recordsPath = join(root, 'apps/pwa/public/records/counties.json');
    const candidatesPath = join(root, 'apps/pwa/public/records/candidates.json');
    writeFileSync(
      recordsPath,
      `${JSON.stringify({ generatedAt: '2026-09-03', note: 'n', counties: 1, records }, null, 2)}\n`,
    );
    writeFileSync(
      candidatesPath,
      `${JSON.stringify({ generatedAt: '2026-09-05', note: 'n', candidates: [GWINNETT_CANDIDATE] }, null, 2)}\n`,
    );
    return {
      recordsPath,
      candidatesPath,
      checkPath: join(root, 'scripts/check-record-citations.mjs'),
    };
  }

  it('writes both files in the shape the repository already stores them in', async () => {
    const paths = scratchFiles([EXISTING_RECORD]);
    const plan = planWrite({
      records: [EXISTING_RECORD],
      candidates: [GWINNETT_CANDIDATE],
      outcomes: await examineAll([GWINNETT_CANDIDATE], fakeExaminers()),
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    const committed = commitPlan({
      plan,
      note: 'n',
      generatedAt: '2026-09-08T00:00:00.000Z',
      ...paths,
    });
    assert.equal(committed.ok, true, committed.output);
    assert.match(committed.output, /2\/2 records fully cited/);

    const written = JSON.parse(readFileSync(paths.recordsPath, 'utf8'));
    assert.equal(written.generatedAt, '2026-09-08');
    assert.equal(written.note, 'n');
    assert.equal(written.counties, 2);
    assert.deepEqual(
      written.records.map((record) => record.fips),
      ['01115', '13135'],
    );
    const queue = JSON.parse(readFileSync(paths.candidatesPath, 'utf8'));
    assert.deepEqual(queue.candidates, []);
    assert.match(queue.note, /REVIEW QUEUE, NOT RECORDS/);
    /* The file is JSON.stringify(…, null, 2) plus a newline, exactly as it is on disk. */
    assert.equal(readFileSync(paths.recordsPath, 'utf8').endsWith('\n}\n'), true);
  });

  /*
   * IF THE CHECK GOES RED, NOTHING WAS WRITTEN.
   *
   * The broken row here is already on file, not one this run promoted - which
   * is the case that matters: the promoter must not become the reason a
   * pre-existing problem ships, and it must not leave a half-written pair of
   * files behind when it declines to.
   */
  it('rolls both files back byte for byte when the citation check fails', async () => {
    const broken = { ...EXISTING_RECORD, incidents: 0 };
    const paths = scratchFiles([broken]);
    const recordsBefore = readFileSync(paths.recordsPath, 'utf8');
    const candidatesBefore = readFileSync(paths.candidatesPath, 'utf8');

    const plan = planWrite({
      records: [broken],
      candidates: [GWINNETT_CANDIDATE],
      outcomes: await examineAll([GWINNETT_CANDIDATE], fakeExaminers()),
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    const committed = commitPlan({
      plan,
      note: 'n',
      generatedAt: '2026-09-08T00:00:00.000Z',
      ...paths,
    });
    assert.equal(committed.ok, false);
    assert.match(committed.detail, /rolled back/);
    assert.match(committed.output, /positive integer incident count/);
    assert.equal(readFileSync(paths.recordsPath, 'utf8'), recordsBefore);
    assert.equal(readFileSync(paths.candidatesPath, 'utf8'), candidatesBefore);
  });
});

describe('the diff a run produces is only what it changed', () => {
  /*
   * The real file holds several counties with more than one record, and their
   * order within a county is whatever the people who wrote them chose. Sorting
   * on anything but the FIPS reshuffles rows this run never looked at, and a
   * diff full of moved allegations is a diff nobody reads line by line.
   */
  it('leaves every untouched record exactly where it was', async () => {
    const real = JSON.parse(
      readFileSync(join(ROOT, 'apps/pwa/public/records/counties.json'), 'utf8'),
    );
    const plan = planWrite({
      records: real.records,
      candidates: [GWINNETT_CANDIDATE],
      outcomes: await examineAll([GWINNETT_CANDIDATE], fakeExaminers()),
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    const added = plan.records.filter((record) => record.fips === '13135' && record.disposition);
    assert.equal(added.length, 1);
    assert.deepEqual(
      plan.records.filter((record) => !added.includes(record)),
      real.records,
    );
    assert.equal(plan.counties, new Set(real.records.map((record) => record.fips)).size + 1);
  });

  it('changes nothing at all when it promotes nothing', () => {
    const real = JSON.parse(
      readFileSync(join(ROOT, 'apps/pwa/public/records/counties.json'), 'utf8'),
    );
    const plan = planWrite({
      records: real.records,
      candidates: [],
      outcomes: [],
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.deepEqual(plan.records, real.records);
    assert.equal(plan.counties, real.counties);
  });
});

describe('the enumerated refusals are the real ones', () => {
  /*
   * A reason that is declared and never emitted is a lie in the list that the
   * next person reads to find out what this script can refuse. A reason emitted
   * and not declared is worse: an unexplained string in the queue file.
   */
  it('declares exactly the reasons it can emit', () => {
    const source = readFileSync(join(HERE, 'promote-misuse-candidates.mjs'), 'utf8');
    const emitted = new Set(
      [...source.matchAll(/(?:DROP|PENDING)_REASONS\.([A-Z_]+)/g)].map((match) => match[1]),
    );
    for (const key of Object.keys(DROP_REASONS)) {
      assert.ok(emitted.has(key), `DROP_REASONS.${key} is declared but never emitted`);
    }
    for (const key of Object.keys(PENDING_REASONS)) {
      assert.ok(emitted.has(key), `PENDING_REASONS.${key} is declared but never emitted`);
    }
    assert.equal(Object.keys(DROP_REASONS).length, 21);
    assert.equal(Object.keys(PENDING_REASONS).length, 7);
  });

  it('reports a queue entry whose source was already cited', () => {
    const plan = planWrite({
      records: [EXISTING_RECORD],
      candidates: [{ ...GWINNETT_CANDIDATE, sourceUrl: EXISTING_RECORD.sourceUrl }],
      outcomes: [],
      generatedAt: '2026-09-08T00:00:00.000Z',
    });
    assert.deepEqual(plan.alreadyRecorded, [EXISTING_RECORD.sourceUrl]);
    assert.equal(plan.candidates.length, 0);
  });
});
