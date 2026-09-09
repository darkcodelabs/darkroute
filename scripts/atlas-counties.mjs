/**
 * THE EFF ATLAS OF SURVEILLANCE, REDUCED TO A COUNTY-SCOPED AGENCY REGISTER.
 *
 * =============================================================================
 * WHAT SHIPS, AND THE MEASUREMENT THAT DECIDED IT
 * =============================================================================
 * One claim: "the Atlas records N ALPR deployments across M agencies in this
 * county". That is a fact about a county, it needs no name matching at all, and
 * it is true for the overwhelming majority of the camera archive.
 *
 * The thing that does NOT ship is the obvious one - a per-camera "EFF ATLAS ·
 * CROSS-REFERENCED" row joining a pin to the agency that runs it. It was scoped,
 * measured over all 8,803 tiles and all 4,146 ALPR rows, and refused:
 *
 *   - 16.99% of cameras carry an `operator` tag at all, so the join has nothing
 *     to match on for five cameras in six.
 *   - A state-constrained exact match reaches 7.27% of the archive.
 *   - The top 10 agencies hold 28.6% of those matches, so the coverage that
 *     does exist is concentrated in a handful of big departments.
 *   - 96.58% of the cameras it does match ALREADY carry a manufacturer tag and
 *     a police owner type, so the row tells the reader nothing new.
 *   - The Atlas contradicts the camera's own vendor tag on 17.36% of them.
 *
 * Dropping the state test to lift the hit rate would publish 322 cameras joined
 * to a same-named agency in the WRONG STATE. So the per-camera row stays an em
 * dash, and this file exists instead.
 *
 * THE ONE-LINE REASON: the Atlas has ZERO coordinates, by EFF's deliberate
 * design. It is a register of AGENCIES. EFF routes camera locations to DeFlock,
 * which this app already consumes. Asking the Atlas where a camera is means
 * asking a register of agencies a question it was built not to answer.
 *
 * =============================================================================
 * DEPLOYMENT IS NOT MISUSE, AND THE TWO MUST NEVER RENDER THE SAME
 * =============================================================================
 * `countyRecords.ts` holds allegations: a named agency did a specific thing, and
 * a URL a reader can open says so. An Atlas row is a completely different kind
 * of statement - "this agency is recorded as operating this technology" - and it
 * is not an accusation of anything.
 *
 * Nothing in this file may be folded into that one. Separate artifact, separate
 * service, separate block on the screen, separate wording. A build that merged
 * them would turn 3,574 agencies who have done nothing wrong into a misuse feed.
 *
 * =============================================================================
 * WHY THE SUMMARY COLUMN IS NOT IN HERE
 * =============================================================================
 * The CSV carries a `Summary` column and it is the one field this build refuses.
 *
 * EFF's licence grant covers material ORIGINAL TO EFF. Their methodology page
 * says the Atlas ingests datasets from journalists, nonprofits, government and
 * vendors, and nothing in the CSV marks which rows came from where. So the safe
 * set is the set of FACTS - agency, city, county, state, vendor, technology -
 * because a fact is not copyrightable whoever collected it. `Summary` is prose,
 * and prose is the one field where somebody's copyright plausibly subsists.
 *
 * `FIELDS_USED` below is that list, `assertFieldsUsed` is the gate, and there is
 * a test that reads the shipped artifact and fails if a summary ever appears in
 * it.
 *
 * =============================================================================
 * THE LICENCE IS A READING, NOT A FACT
 * =============================================================================
 * The Atlas's only licence signal is a footer link to eff.org/copyright, and
 * that page CONTRADICTS ITSELF: the prose says CC BY 4.0 while the rel="license"
 * badge in the same paragraph points at CC BY 3.0 US.
 *
 * So this build does not record a verified SPDX id. It records what was observed
 * and states that the version is unconfirmed, which is the difference between
 * "we checked" and "we read a page". Attribution is required under either
 * reading and is given under both.
 */

/**
 * The only columns this build is allowed to read, and the reason the list is a
 * constant rather than a convention.
 *
 * `assertFieldsUsed` compares it against the CSV's real header, so a column
 * rename upstream fails the build instead of silently emptying a field, and a
 * future edit that reaches for `Summary` has to delete a line that says why it
 * must not.
 */
export const FIELDS_USED = Object.freeze(['Agency', 'City', 'County', 'State', 'Vendor', 'Technology']);

/** Columns that exist in the CSV and must never be read. See the header. */
export const FIELDS_REFUSED = Object.freeze(['Summary']);

/**
 * The technology label, matched EXACTLY.
 *
 * The CSV's `Technology` column is a closed vocabulary of 13 values and this is
 * one of them. An exact match rather than a substring test because "Automated
 * License Plate Readers" is the whole label; a `.includes('License Plate')`
 * would quietly start matching a new sibling category nobody reviewed.
 */
export const ALPR_TECHNOLOGY = 'Automated License Plate Readers';

/** The artifact's schema tag, so a reader can refuse a file it does not know. */
export const SCHEMA = 'darkroute-atlas-counties/v1';

/**
 * FIPS state code -> USPS abbreviation, the same table `counties.mjs` carries.
 *
 * Duplicated rather than imported because that module's export is bound to the
 * point-in-polygon index and pulling it in here would drag 3.2 MB of geometry
 * into a build that only needs names. Census FIPS 5-2 is reference data and does
 * not drift.
 */
const STATE_BY_FIPS = Object.freeze({
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  10: 'DE', 11: 'DC', 12: 'FL', 13: 'GA', 15: 'HI', 16: 'ID', 17: 'IL', 18: 'IN',
  19: 'IA', 20: 'KS', 21: 'KY', 22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI',
  27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE', 32: 'NV', 33: 'NH', 34: 'NJ',
  35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH', 40: 'OK', 41: 'OR', 42: 'PA',
  44: 'RI', 45: 'SC', 46: 'SD', 47: 'TN', 48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA',
  53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY', 60: 'AS', 66: 'GU', 69: 'MP', 72: 'PR',
  78: 'VI',
});

/**
 * The Census LSAD code spelled the way a human writes it.
 *
 * THE JOIN CANNOT WORK WITHOUT THIS. The Census file stores `NAME: "Richmond"`
 * and `LSAD: "city"` in separate fields, and Virginia has BOTH a Richmond County
 * and a Richmond city. There are seven such collisions in the file - Richmond,
 * Fairfax, Bedford, Franklin and Roanoke in Virginia, St. Louis in Missouri,
 * Baltimore in Maryland - and every one of them is a county and an independent
 * city with the same name in the same state.
 *
 * Matching on `NAME` alone would resolve each of those to whichever feature the
 * file happened to list second. So the join key is `NAME + designator`, which is
 * exactly the string the Atlas writes ("Richmond County", "Baltimore City"), and
 * the designator has to come from somewhere. It comes from here.
 */
const LSAD_WORD = Object.freeze({
  County: 'County',
  Parish: 'Parish',
  Borough: 'Borough',
  city: 'city',
  Muno: 'Municipio',
  CA: 'Census Area',
  'Cty&Bor': 'City and Borough',
  Muny: 'Municipality',
  // Two features carry no LSAD at all: the District of Columbia and Carson
  // City, Nevada. Their NAME is already the whole name, so the designator is
  // the empty string and the canonical form is just the name.
  '': '',
});

/**
 * Invisible characters that carry no meaning and break an exact string compare.
 *
 * THIS IS NOT FUZZY MATCHING and the distinction is the whole design. Five ALPR
 * rows are filed under `"‎Harris County‎"` - Harris County, Texas,
 * wrapped in left-to-right marks by whatever editor produced the row. Removing a
 * character that renders as nothing changes no word; it makes two strings that
 * were always the same string compare as the same string.
 *
 * Everything a human would have to THINK about - a misspelling, a missing
 * designator, a county in the wrong state - goes in the exception table below,
 * by hand, with a note saying what was wrong. No stemming, no edit distance, no
 * "closest match wins". A silent fuzzy join is precisely what this scope refused,
 * because the failure mode of one is a real police department attached to a
 * county it has no jurisdiction in.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/**
 * Case-folded, whitespace-collapsed, invisible characters removed. Nothing else.
 *
 * `\s` already covers the non-breaking space, so there is no separate rule for
 * it. What `\s` does NOT cover is the zero-width and bidi range above, which is
 * the only reason that regex exists.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * THE CONDITIONAL FETCH, with the filesystem lifted out so it can be tested.
 *
 * The export is 8.6 MB and changes rarely. EFF serves it with a WEAK ETag -
 * `W/"..."` - which is a promise about semantic equivalence rather than byte
 * equality, and which is exactly the right validator here: two exports that
 * differ only in a generation stamp are the same data and there is no reason to
 * pull 8.6 MB to find that out. `If-None-Match` with a weak tag is legal, and a
 * 304 from this endpoint has been confirmed against the live server.
 *
 * `If-None-Match` is sent ONLY when there is a cached body to reuse. A 304 with
 * nothing on disk is an unusable answer - the server has correctly told us
 * nothing changed and we have nothing to show for it - so the request that could
 * produce one is not made.
 *
 * THREE OUTCOMES, each honest about a different thing:
 *
 *   200   new bytes, new `fetchedAt`, new `checkedAt`
 *   304   same bytes, `fetchedAt` UNCHANGED, `checkedAt` moves forward
 *   skip  neither was asked, and neither stamp moves - because claiming to have
 *         checked without checking is the exact failure `docs/camera-sync-
 *         runbook.md` was written about
 *
 * Note what `fetchedAt` does NOT do on a 304: it does not advance. The data is
 * as old as it was; only our confidence that it is still current is new, and
 * those are two different facts that get two different fields.
 */
export async function readAtlasCsv({ fetchImpl, url, meta, cached, now, offline = false }) {
  if (offline) {
    if (cached === null || cached === undefined) {
      throw new Error('offline build requested with no cached copy to read');
    }
    return {
      status: 'cached',
      text: cached,
      fetchedAt: meta?.fetchedAt ?? null,
      checkedAt: meta?.checkedAt ?? null,
      etag: meta?.etag ?? null,
      filename: meta?.filename ?? null,
    };
  }

  const headers = { Accept: 'text/csv' };
  const hasCached = typeof cached === 'string' && cached.length > 0;
  if (hasCached && typeof meta?.etag === 'string' && meta.etag !== '') {
    headers['If-None-Match'] = meta.etag;
  }

  const response = await fetchImpl(url, { headers, redirect: 'follow' });

  if (response.status === 304) {
    if (!hasCached) throw new Error('server answered 304 but there is no cached copy to reuse');
    return {
      status: 'not-modified',
      text: cached,
      fetchedAt: meta?.fetchedAt ?? null,
      checkedAt: now,
      etag: meta?.etag ?? null,
      filename: meta?.filename ?? null,
    };
  }

  if (!response.ok) throw new Error(`${url} answered HTTP ${String(response.status)}`);

  /*
   * The Content-Disposition filename is recorded VERBATIM and never parsed for
   * a date. It reads `Atlas of Surveillance-<yyyymmdd>.csv` and the digits track
   * the REQUEST, not the data: the same ETag comes back under a filename whose
   * date has moved on. Treating it as a vintage would be inventing a freshness
   * claim out of a server-side `Date.today`.
   */
  const disposition = response.headers.get('content-disposition') ?? '';
  return {
    status: 'fetched',
    text: await response.text(),
    fetchedAt: now,
    checkedAt: now,
    etag: response.headers.get('etag'),
    filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? null,
  };
}

/**
 * A minimal RFC 4180 reader.
 *
 * Hand-written rather than a dependency because the whole job is quoted fields
 * containing commas and embedded newlines, which is thirty lines, and because
 * this build already refuses to add a package to a repo whose supply chain is
 * part of its argument. Bare CR is dropped rather than treated as a terminator:
 * the Atlas export is CRLF, and a lone CR inside a quoted summary is data.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * The header must contain every column this build reads, or the build stops.
 *
 * A renamed column would otherwise read as an empty string on every row, and an
 * empty `Technology` means zero ALPR rows, and zero ALPR rows means a published
 * artifact that says every county in America has no recorded deployment. That is
 * the single worst thing this file could ship, so it is checked rather than
 * assumed.
 */
export function assertFieldsUsed(header) {
  const present = new Set(header.map((h) => normalizeName(h)));
  const missing = FIELDS_USED.filter((f) => !present.has(normalizeName(f)));
  if (missing.length > 0) {
    throw new Error(`Atlas CSV is missing columns this build reads: ${missing.join(', ')}`);
  }
  return true;
}

/**
 * COUNTY NAME -> FIPS, built from the Census file this repo already ships.
 *
 * The same `scripts/data/us-counties.geojson` the basemap receipt and the
 * on-device county index are built from, so a county that resolves here is a
 * county the rest of the app can draw and label. Keyed by
 * `<USPS>|<name + designator>`, normalized, which is an exact compare.
 */
export function buildCountyLookup(geojson) {
  const byKey = new Map();
  const byFips = new Map();
  for (const feature of geojson.features ?? []) {
    const props = feature.properties ?? {};
    const stateFips = String(props.STATE ?? '').padStart(2, '0');
    const state = STATE_BY_FIPS[stateFips] ?? STATE_BY_FIPS[Number(stateFips)];
    if (state === undefined) continue;
    const fips = `${stateFips}${String(props.COUNTY ?? '').padStart(3, '0')}`;
    const lsad = String(props.LSAD ?? '');
    const word = LSAD_WORD[lsad];
    if (word === undefined) throw new Error(`unknown Census LSAD "${lsad}" on FIPS ${fips}`);
    const name = String(props.NAME ?? '');
    byKey.set(`${state}|${normalizeName(`${name} ${word}`)}`, fips);
    byFips.set(fips, { fips, name, lsad, state });
  }
  if (byKey.size === 0) throw new Error('county geometry produced no names');
  return { byKey, byFips };
}

/**
 * =============================================================================
 * THE EXCEPTION TABLE - the hand-checked resolution of every dirty county cell
 * =============================================================================
 * 117 of the 4,146 ALPR rows carry a `County` cell that does not name a county.
 * They are typos ("Genesse", "Mongomery", "Conuty", "Counthy", "Parsih"), a
 * spreadsheet error that leaked into the export ("#REF!"), a stray keystroke
 * ("y"), a city written where the county goes ("West Hollywood", "Venice
 * County"), a county in the wrong state, and forty rows where the cell is simply
 * empty.
 *
 * Every one of them is resolved BY HAND, here, with a note saying what was wrong
 * and what the evidence for the fix was. Nothing in the build guesses. The
 * alternative - an edit-distance match, or dropping the state constraint - is
 * what the scope refused, and it refused it with a number: relaxing the state
 * test to raise the hit rate publishes hundreds of rows joined to a same-named
 * agency in a state it does not operate in.
 *
 * KEY SHAPE. `state` plus the county cell as written. `city` is present only
 * where the county cell alone cannot decide - which is every row where the cell
 * is blank, because "" is not a name and 40 different rows share it. A
 * city-keyed entry is tried first, so the specific row wins over any general
 * rule for the same cell.
 *
 * `fips: null` IS A RESULT, not a gap. Four rows name two counties at once, or
 * name a city that genuinely straddles three, or cannot be read at all without
 * choosing between two equally supportable readings. Those are published in the
 * artifact's `unplaced` list with the reason attached, because a blank the
 * reader can see is honest and a confident wrong county is not.
 *
 * MAINTENANCE. A cell that stops appearing upstream leaves a dead entry here,
 * which is harmless; the build reports how many entries went unused so a human
 * can prune them. A NEW dirty cell does not silently vanish - it lands in
 * `unplaced` with `why: 'no exception entry'`, and the build prints it.
 */
export const COUNTY_EXCEPTIONS = Object.freeze([
  // ---------------------------------------------------------------------------
  // VIRGINIA'S INDEPENDENT CITIES: the County cell is blank BECAUSE THERE IS NO
  // COUNTY. Virginia's 38 independent cities are outside any county and are
  // their own county-equivalent in the Census file, carrying LSAD "city". The
  // Atlas leaves the cell empty for exactly these rows, which makes the blank
  // informative rather than missing - but only once the city is read, because
  // "" is shared by 40 rows across seven states. Hence the city key.
  //
  // Five of these names are ALSO Virginia counties (Richmond, Fairfax, Franklin,
  // Roanoke, Bedford). The city reading is the right one for every row here for
  // the same structural reason: a row filed in a county would have said so.
  // ---------------------------------------------------------------------------
  { state: 'VA', county: '', city: 'Falls Church', fips: '51610', why: 'County cell blank: Falls Church is a Virginia independent city, not in any county.' },
  { state: 'VA', county: '', city: 'Norfolk', fips: '51710', why: 'County cell blank: Norfolk is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Williamsburg', fips: '51830', why: 'County cell blank: Williamsburg is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Newport News', fips: '51700', why: 'County cell blank: Newport News is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Fairfax', fips: '51600', why: 'County cell blank: Fairfax CITY (51600), which is a separate county-equivalent from Fairfax County (51059). The blank cell is what distinguishes them.' },
  { state: 'VA', county: '', city: 'Portsmouth', fips: '51740', why: 'County cell blank: Portsmouth is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Hampton', fips: '51650', why: 'County cell blank: Hampton is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Virginia Beach', fips: '51810', why: 'County cell blank: Virginia Beach is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Roanoke', fips: '51770', why: 'County cell blank: Roanoke CITY (51770), not Roanoke County (51161).' },
  { state: 'VA', county: '', city: 'Lynchburg', fips: '51680', why: 'County cell blank: Lynchburg is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Suffolk', fips: '51800', why: 'County cell blank: Suffolk is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Martinsville', fips: '51690', why: 'County cell blank: Martinsville is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Hopewell', fips: '51670', why: 'County cell blank: Hopewell is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Danville', fips: '51590', why: 'County cell blank: Danville is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Poquoson', fips: '51735', why: 'County cell blank: Poquoson is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Radford', fips: '51750', why: 'County cell blank: Radford is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Chesapeake', fips: '51550', why: 'County cell blank: Chesapeake is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Emporia', fips: '51595', why: 'County cell blank: Emporia is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Winchester', fips: '51840', why: 'County cell blank: Winchester is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Waynesboro', fips: '51820', why: 'County cell blank: Waynesboro is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Richmond', fips: '51760', why: 'County cell blank: Richmond CITY (51760), not Richmond County (51159).' },
  { state: 'VA', county: '', city: 'Petersburg', fips: '51730', why: 'County cell blank: Petersburg is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Manassas', fips: '51683', why: 'County cell blank: Manassas CITY (51683), which is a separate county-equivalent from Manassas Park city (51685).' },
  { state: 'VA', county: '', city: 'Franklin', fips: '51620', why: 'County cell blank: Franklin CITY (51620), not Franklin County (51067). The agency is Franklin Police Department, a city force.' },
  { state: 'VA', county: '', city: 'Covington', fips: '51580', why: 'County cell blank: Covington is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Charlottesville', fips: '51540', why: 'County cell blank: Charlottesville is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Bristol', fips: '51520', why: 'County cell blank: Bristol is a Virginia independent city.' },
  { state: 'VA', county: '', city: 'Alexandria', fips: '51510', why: 'County cell blank: Alexandria is a Virginia independent city.' },

  // ---------------------------------------------------------------------------
  // THE OTHER BLANK CELLS. Same shape, different states. Four of the five below
  // are the same structural fact as Virginia's - the place IS the county
  // equivalent - and the fifth is not, which is why it resolves to null.
  // ---------------------------------------------------------------------------
  { state: 'MD', county: '', city: 'Baltimore', fips: '24510', why: 'County cell blank: Baltimore CITY (24510) is a Maryland independent city and a separate county-equivalent from Baltimore County (24005). Two rows share this cell; the second is the Maryland Transportation Authority, a statewide agency that the Atlas files at Baltimore. This places it where the Atlas placed it and claims nothing wider.' },
  { state: 'NV', county: '', city: 'Carson City', fips: '32510', why: 'County cell blank: Carson City is a Nevada consolidated municipality and its own county-equivalent (Census LSAD is empty for it).' },
  { state: 'DC', county: '', city: 'Washington', fips: '11001', why: 'County cell blank: the District of Columbia is a single county-equivalent, FIPS 11001.' },
  { state: 'PR', county: '', city: 'San Juan', fips: '72127', why: 'County cell blank: Puerto Rico’s county-equivalents are municipios, and San Juan is one (72127).' },
  { state: 'AR', county: '', city: 'N Little Rock', fips: '05119', why: 'County cell blank: North Little Rock lies wholly within Pulaski County. Arkansas has no independent cities, so this is a missing value rather than a structural blank - but the city does not straddle, so there is exactly one answer.' },
  { state: 'TX', county: '', city: 'Mansfield', fips: null, why: 'County cell blank and unresolvable: Mansfield, Texas straddles Tarrant, Johnson and Ellis counties. Picking the largest share would be a guess about where the cameras are, which is the thing this layer must not do.' },

  // ---------------------------------------------------------------------------
  // "SAINT" WRITTEN OUT WHERE THE CENSUS ABBREVIATES IT. The Census file writes
  // "St. Louis", "St. Clair", "Ste. Genevieve"; a large number of Atlas rows
  // write "Saint". This is resolved by hand rather than by a global
  // Saint/St. rewrite because such a rewrite is a silent rule that would also
  // fire on names nobody checked, and because the Missouri case is a trap:
  // "Saint Louis County" is 29189 and St. Louis CITY is 29510, two different
  // county-equivalents with the same name in the same state.
  // ---------------------------------------------------------------------------
  { state: 'MO', county: 'Saint Louis County', fips: '29189', why: '"Saint" spelled out; Census writes "St. Louis". County (29189), NOT St. Louis city (29510) - all eight rows name St. Louis County municipalities: Webster Groves, Chesterfield, Shrewsbury, Hazelwood, Ferguson, Eureka, Edmundson, Calverton Park.' },
  { state: 'MO', county: 'Saint Charles County', fips: '29183', why: '"Saint" spelled out; Census writes "St. Charles".' },
  { state: 'MO', county: 'Saint Francois County', fips: '29187', why: '"Saint" spelled out; Census writes "St. Francois".' },
  { state: 'MO', county: 'Sainte Genevieve County', fips: '29186', why: '"Sainte" spelled out; Census writes "Ste. Genevieve".' },
  { state: 'MN', county: 'St Louis County', fips: '27137', why: 'Missing the period; Census writes "St. Louis". Minnesota’s St. Louis County (27137), the Duluth one - not Missouri’s.' },
  { state: 'IN', county: 'Saint Joseph County', fips: '18141', why: '"Saint" spelled out; Census writes "St. Joseph".' },
  { state: 'MI', county: 'Saint Clair County', fips: '26147', why: '"Saint" spelled out; Census writes "St. Clair".' },
  { state: 'AL', county: 'Saint Clair County', fips: '01115', why: '"Saint" spelled out; Census writes "St. Clair".' },
  { state: 'WI', county: 'Saint Croix County', fips: '55109', why: '"Saint" spelled out; Census writes "St. Croix".' },
  { state: 'WI', county: 'Croix County', fips: '55109', why: 'The saint is missing entirely - the county is St. Croix. The agency cell says "Croix County Sheriff’s Office", so the truncation is in the source row rather than in one field.' },
  { state: 'LA', county: 'Saint Tammany Parish', fips: '22103', why: '"Saint" spelled out; Census writes "St. Tammany".' },
  { state: 'LA', county: 'Saint Mary Parish', fips: '22101', why: '"Saint" spelled out; Census writes "St. Mary".' },
  { state: 'LA', county: 'Saint Martin Parish', fips: '22099', why: '"Saint" spelled out; Census writes "St. Martin".' },
  { state: 'LA', county: 'Saint Charles Parish', fips: '22089', why: '"Saint" spelled out; Census writes "St. Charles".' },
  { state: 'LA', county: 'St. John Baptist Parish', fips: '22095', why: 'Missing "the"; Census writes "St. John the Baptist".' },
  { state: 'LA', county: 'St. Mary County', fips: '22101', why: 'Louisiana has parishes, not counties. St. Mary Parish (22101); the city cell is Morgan City, its largest municipality.' },

  // ---------------------------------------------------------------------------
  // MISSPELLINGS. Each is resolved to the county the row's own City or Agency
  // cell independently confirms, so the fix rests on two fields agreeing rather
  // than on the misspelling looking close to something.
  // ---------------------------------------------------------------------------
  { state: 'IN', county: 'Mongomery County', fips: '18107', why: 'Missing "t": Montgomery County. Crawfordsville is its county seat, and the agency cell repeats the same typo, so the error is in the row not the field.' },
  { state: 'MN', county: 'Mille Lacs Coutny', fips: '27095', why: 'Transposed "Coutny": Mille Lacs County. Isle is a Mille Lacs County city.' },
  { state: 'NM', county: 'Santa Fe Conuty', fips: '35049', why: 'Transposed "Conuty": Santa Fe County. The Pueblo of Pojoaque is in Santa Fe County.' },
  { state: 'FL', county: 'Orange Conuty, Orange County', fips: '12095', why: 'The misspelling and the correction were both left in the cell. Orange County; the city is Orlando, its seat.' },
  { state: 'MO', county: 'Buchanan Counthy', fips: '29021', why: 'Stray "h": Buchanan County. St. Joseph is its county seat.' },
  { state: 'LA', county: 'East Baton Rouge Parsih', fips: '22033', why: 'Transposed "Parsih": East Baton Rouge Parish. The city is Baton Rouge.' },
  { state: 'MI', county: 'Genesse County', fips: '26049', why: 'Misspelled: Genesee County. Davison is a Genesee County township.' },
  { state: 'CA', county: 'Montery County', fips: '06053', why: 'Missing "e": Monterey County. Soledad is a Monterey County city.' },
  { state: 'VA', county: 'Albermarle County', fips: '51003', why: 'Inserted "r": Albemarle County. The agency is Albemarle County Police Department, spelled correctly in its own cell.' },
  { state: 'OK', county: 'Gravin County', fips: '40049', why: 'Transposed: Garvin County. Pauls Valley is its county seat.' },
  { state: 'OK', county: 'Leflore County', fips: '40079', why: 'Census writes "Le Flore" as two words. Poteau is its county seat.' },
  { state: 'NM', county: 'Dona Ana County', fips: '35013', why: 'Tilde dropped; Census writes "Doña Ana". Las Cruces is its county seat. Resolved by hand rather than by folding diacritics globally, which would change how every Puerto Rico municipio is matched.' },
  { state: 'FL', county: 'De Soto County', fips: '12027', why: 'Census writes "DeSoto" as one word. Arcadia is its county seat and the agency cell writes "Desoto", a third spelling.' },
  { state: 'IL', county: 'La Salle County', fips: '17099', why: 'Census writes "LaSalle" as one word. All five rows are LaSalle County municipalities - La Salle, Ottawa, Peru, Oglesby - and one agency cell already writes "LaSalle County Sheriff’s Office".' },
  { state: 'MI', county: 'Ottawa County |', fips: '26139', why: 'A stray pipe character on the end of an otherwise correct cell.' },
  { state: 'VA', county: 'y', city: 'Manassas Park', fips: '51685', why: 'The cell is the single character "y". The city cell says Manassas Park, which is a Virginia independent city (51685) distinct from Manassas city (51683).' },
  { state: 'MO', county: '#REF!', city: 'Grain Valley', fips: '29095', why: 'A spreadsheet reference error survived into the published export. Grain Valley is a Jackson County city.' },
  { state: 'MA', county: 'Usa County', fips: '25017', why: 'Not a county - no state has one. The city is Waltham, which is in Middlesex County.' },

  // ---------------------------------------------------------------------------
  // WRONG PLACE ENTIRELY. The cell names something real that is not a county of
  // that state: a city, a neighbouring state’s county, or a county that does not
  // exist. Each is resolved to the county the City cell actually sits in.
  // ---------------------------------------------------------------------------
  { state: 'FL', county: 'Venice County', fips: '12115', why: 'Florida has no Venice County. Venice is a city in Sarasota County, and the agency is Venice Police Department.' },
  { state: 'FL', county: 'Cross City County', fips: '12029', why: 'Florida has no Cross City County. Cross City is the seat of Dixie County, and the agency is the Dixie County Sheriff’s Office.' },
  { state: 'OH', county: 'Chester County', fips: '39017', why: 'Ohio has no Chester County (Pennsylvania does). The city is West Chester Township, which is in Butler County, and the agency is West Chester Township Police Department.' },
  { state: 'CA', county: 'King County', fips: '06031', why: 'California’s county is KingS, plural; King County is in Washington. Hanford is the seat of Kings County. The agency cell carries the same singular error.' },
  { state: 'CA', county: 'West Hollywood', fips: '06037', why: 'A city written in the county column. West Hollywood is in Los Angeles County, and the agency is the LASD West Hollywood Station.' },
  { state: 'VA', county: 'Richmond (city) County', fips: '51760', why: 'The parenthetical is the real designator and the trailing "County" is wrong: Richmond city (51760), not Richmond County (51159).' },
  { state: 'VA', county: 'Alexandria (city) County', fips: '51510', why: 'Same shape: Alexandria city (51510). Virginia has no Alexandria County - it was renamed Arlington in 1920.' },
  { state: 'VA', county: 'Colonial Heights (city) County', fips: '51570', why: 'Same shape: Colonial Heights city (51570).' },
  { state: 'PS', county: 'St. Louis County', city: 'Des Peres', fips: '29189', why: '"PS" is not a USPS state code - it is a mistyped "MO". Des Peres is a St. Louis County, Missouri municipality and its Department of Public Safety is the agency named.' },

  // ---------------------------------------------------------------------------
  // THE DESIGNATOR IS SIMPLY MISSING. Four rows write a bare county name. Each
  // is unambiguous within its state, but they are listed by hand rather than
  // handled by a "bare name also matches" rule: such a rule would silently
  // resolve "Baltimore" and "Richmond" too, which are the exact seven cases the
  // LSAD exists to disambiguate.
  // ---------------------------------------------------------------------------
  { state: 'OH', county: 'Butler', fips: '39017', why: 'Designator omitted: Butler County. Oxford, Ohio is in Butler County.' },
  { state: 'AL', county: 'Jefferson', fips: '01073', why: 'Designator omitted: Jefferson County. Pinson is a Jefferson County town.' },
  { state: 'FL', county: 'Pinellas', fips: '12103', why: 'Designator omitted: Pinellas County. Pinellas Park is in it.' },
  { state: 'VA', county: 'Montgomery', fips: '51121', why: 'Designator omitted: Montgomery County (51121). Blacksburg is in Montgomery County, and Virginia has no Montgomery city, so the county reading is the only one.' },

  // ---------------------------------------------------------------------------
  // REFUSED. A blank in the artifact, published with its reason. Three of these
  // name more than one county and the fourth cannot be read without choosing
  // between two readings that are equally supportable from the row itself.
  // ---------------------------------------------------------------------------
  { state: 'SC', county: 'Spartanburg County/ Cherokee County', fips: null, why: 'The cell names two counties. Chesnee straddles both, so there is no single answer and choosing the larger share would be a guess.' },
  { state: 'SC', county: 'Berkeley County/ Charleston County.', fips: null, why: 'The cell names two counties, and Summerville in fact spans three (Dorchester as well). No single answer.' },
  { state: 'PA', county: 'Shiawassee County', fips: null, why: 'Shiawassee is a MICHIGAN county; Pennsylvania has none. Two readings are available and the row supports both equally: Hazelton Township really is in Shiawassee County, Michigan (so the STATE is wrong), and Hazleton really is a Pennsylvania city in Luzerne County (so the COUNTY and the city spelling are wrong). Nothing in the row breaks the tie, so this stays blank.' },
]);

/** The exception table indexed for lookup. City-keyed entries win. */
function indexExceptions(entries) {
  const byCounty = new Map();
  const byCity = new Map();
  for (const entry of entries) {
    const county = normalizeName(entry.county);
    const state = String(entry.state).toUpperCase();
    if (entry.city === undefined) {
      const key = `${state}|${county}`;
      if (byCounty.has(key)) throw new Error(`duplicate exception entry: ${key}`);
      byCounty.set(key, entry);
    } else {
      const key = `${state}|${county}|${normalizeName(entry.city)}`;
      if (byCity.has(key)) throw new Error(`duplicate exception entry: ${key}`);
      byCity.set(key, entry);
    }
  }
  return { byCounty, byCity };
}

/**
 * One row's county, by exact match then by hand.
 *
 * Returns `{ fips, via }` where `via` is `census` for an exact join, `exception`
 * for a hand entry that resolved, `refused` for a hand entry that deliberately
 * did not, and `unknown` for a cell nobody has looked at yet. The caller reports
 * every case that is not `census` so a new kind of dirt shows up in the build
 * output rather than in the artifact.
 */
export function resolveCounty(row, lookup, exceptions) {
  const state = String(row.state ?? '').trim().toUpperCase();
  const county = normalizeName(row.county);
  const city = normalizeName(row.city);

  const cityHit = exceptions.byCity.get(`${state}|${county}|${city}`);
  if (cityHit !== undefined) {
    return { fips: cityHit.fips, via: cityHit.fips === null ? 'refused' : 'exception', why: cityHit.why, key: `${state}|${county}|${city}` };
  }

  const exact = lookup.byKey.get(`${state}|${county}`);
  if (exact !== undefined) return { fips: exact, via: 'census', why: null, key: `${state}|${county}` };

  const hit = exceptions.byCounty.get(`${state}|${county}`);
  if (hit !== undefined) {
    return { fips: hit.fips, via: hit.fips === null ? 'refused' : 'exception', why: hit.why, key: `${state}|${county}` };
  }

  return { fips: null, via: 'unknown', why: 'no exception entry for this county cell', key: `${state}|${county}` };
}

/**
 * Vendor cells, split and de-duplicated.
 *
 * The column holds a comma-separated list ("Flock Safety, Motorola Solutions"),
 * and the same vendor is spelled several ways across the corpus by different
 * contributors: ELSAG/Elsag, Rekor/Rekor Systems, NDI/NDI Technologies,
 * SkyCop/Skycop. Rendering both spellings side by side in one county reads as a
 * bug, so spellings are folded case-insensitively and the winner is the one that
 * occurs MOST OFTEN across the whole ALPR set - a deterministic choice made from
 * the data rather than a preference. Nothing is renamed: "Rekor" and "Rekor
 * Systems" differ by more than case and both survive, because deciding they are
 * the same company is an editorial judgement this build is not entitled to make.
 */
export function splitVendors(cell) {
  return String(cell ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/**
 * Build the county index from parsed CSV rows.
 *
 * Pure: takes rows and a lookup, returns the artifact body minus its
 * provenance envelope. The CLI adds `fetchedAt` and the licence reading, because
 * those are facts about a network request and do not belong in a function that
 * can be tested without one.
 */
export function buildIndex({ rows, lookup, exceptions = indexExceptions(COUNTY_EXCEPTIONS) }) {
  const header = rows[0] ?? [];
  assertFieldsUsed(header);
  const at = Object.fromEntries(header.map((h, i) => [normalizeName(h), i]));
  const col = (row, name) => String(row[at[normalizeName(name)]] ?? '');

  const alpr = rows
    .slice(1)
    .filter((row) => col(row, 'Technology') === ALPR_TECHNOLOGY)
    .map((row) => ({
      agency: col(row, 'Agency').trim(),
      city: col(row, 'City').trim(),
      county: col(row, 'County').trim(),
      state: col(row, 'State').trim().toUpperCase(),
      vendors: splitVendors(col(row, 'Vendor')),
    }));

  if (alpr.length === 0) {
    /*
     * REFUSING AN EMPTY LAYER, the same way `build-hazards.mjs` does. Zero ALPR
     * rows means the technology label changed or the export broke, and the
     * artifact it would produce says every county in America has no recorded
     * deployment - a false negative published in 3,221 places at once.
     */
    throw new Error(`no rows matched Technology "${ALPR_TECHNOLOGY}" - refusing to publish an empty layer`);
  }

  // The dominant spelling of each vendor, decided before any county is built so
  // the choice is global and identical in every county.
  const spellings = new Map();
  for (const row of alpr) {
    for (const vendor of row.vendors) {
      const fold = vendor.toLowerCase();
      const seen = spellings.get(fold) ?? new Map();
      seen.set(vendor, (seen.get(vendor) ?? 0) + 1);
      spellings.set(fold, seen);
    }
  }
  const canonicalVendor = new Map();
  for (const [fold, seen] of spellings) {
    const best = [...seen].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0][0];
    canonicalVendor.set(fold, best);
  }

  const counties = new Map();
  const unplaced = [];
  const usedExceptionKeys = new Set();
  let placed = 0;

  for (const row of alpr) {
    const hit = resolveCounty(row, lookup, exceptions);
    if (hit.via !== 'census') usedExceptionKeys.add(hit.key);
    if (hit.fips === null) {
      unplaced.push({
        state: row.state,
        county: row.county,
        city: row.city,
        agency: row.agency,
        why: hit.why,
      });
      continue;
    }
    placed += 1;
    const held = counties.get(hit.fips) ?? { agencies: new Set(), vendors: new Set(), rows: 0, vendorKnown: 0 };
    held.rows += 1;
    if (row.agency !== '') held.agencies.add(row.agency);
    if (row.vendors.length > 0) held.vendorKnown += 1;
    for (const vendor of row.vendors) held.vendors.add(canonicalVendor.get(vendor.toLowerCase()) ?? vendor);
    counties.set(hit.fips, held);
  }

  const out = {};
  for (const fips of [...counties.keys()].sort()) {
    const held = counties.get(fips);
    out[fips] = {
      // `n` is ROWS, not cameras. One Atlas row is one recorded deployment of
      // ALPR by one agency; it says nothing about how many readers that is.
      n: held.rows,
      agencies: [...held.agencies].sort((a, b) => a.localeCompare(b)),
      vendors: [...held.vendors].sort((a, b) => a.localeCompare(b)),
      // How many of the county's rows named a vendor at all. 27.5% of the whole
      // ALPR set leaves the column blank, so a vendor list without this number
      // beside it would read as complete when it is a partial view.
      vendorKnown: held.vendorKnown,
    };
  }

  const unusedExceptions = COUNTY_EXCEPTIONS.filter((entry) => {
    const key = entry.city === undefined
      ? `${entry.state}|${normalizeName(entry.county)}`
      : `${entry.state}|${normalizeName(entry.county)}|${normalizeName(entry.city)}`;
    return !usedExceptionKeys.has(key);
  });

  return {
    counties: out,
    unplaced,
    totals: {
      csvRows: rows.length - 1,
      alprRows: alpr.length,
      placed,
      unplaced: unplaced.length,
      counties: Object.keys(out).length,
      agencies: new Set(alpr.map((r) => r.agency).filter((a) => a !== '')).size,
    },
    unusedExceptions,
  };
}

export { indexExceptions };
