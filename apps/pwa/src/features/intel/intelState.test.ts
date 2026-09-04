/**
 * What the INTEL CARD is allowed to say.
 *
 * Reference: `Flockys Screens II.dc.html` -- `A4 · INTEL CARD - MODAL FROM
 * SWEEP` and `B9 · RECORD FLAGS`; `Flockys App Screens.dc.html` -- `B4`'s
 * owner vocabulary.
 *
 * The point of most of these is the same one: a field this build has no source
 * for renders an em dash and never a plausible value. A card that invented
 * `EFF ATLAS · CROSS-REFERENCED` would be telling a driver a camera had been
 * checked against a public dataset that nothing in this build has ever opened.
 */

import { describe, expect, it } from 'vitest';

import type { AlertLogEntry, CameraAssessment, CameraRecord } from '../../stores';
import { NO_VALUE } from '../radar';

import {
  FACT_TONE,
  IDENTITY_UNKNOWN_NOTE,
  MUTE_STILL_COUNTED,
  OWNER_LABEL,
  READ_WINDOW_DAYS,
  actionMessage,
  intelFact,
  intelFacts,
  intelIdentity,
  intelModel,
  intelReadout,
  intelReads,
  intelTiles,
  isActionFailure,
  muteClockLabel,
  operatorRecordVisible,
  operatorSentence,
  operatorSourcesLabel,
  shareHeadline,
  shareText,
  streetLine,
  tagValue,
  dataAsOf,
} from './intelState.ts';
import type { IntelActionOutcome, IntelInput } from './intelState.ts';

const NOW = 1_760_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The camera A4 is about: FWM-0442, 425 ft away, facing 223 degrees. */
function record(over: Partial<CameraRecord> = {}): CameraRecord {
  return {
    id: 'FWM-0442',
    lat: 39.1,
    lon: -84.58,
    directionDeg: 223,
    ownerType: 'hoa',
    confirmations: 28,
    ...over,
  };
}

function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'FWM-0442',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    // 223 degrees is south-west, which is what the panel prints beside 425 FT.
    bearingDeg: 223,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 223,
    inRange: true,
    muted: false,
    mergedIds: ['FWM-0442'],
    ...over,
  };
}

function pass(over: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return {
    id: 1,
    cameraId: 'FWM-0442',
    label: null,
    atMs: NOW,
    state: 'in_range',
    previousState: 'clear',
    distanceFt: 425,
    speedMph: 47,
    headingDeg: 41,
    muted: false,
    outcome: null,
    ...over,
  };
}

function input(over: Partial<IntelInput> = {}): IntelInput {
  return {
    cameraId: 'FWM-0442',
    record: record(),
    assessment: assessment(),
    state: 'in_range',
    mutedCamera: false,
    muteRemainingMs: 0,
    reads: 21,
    windowDays: READ_WINDOW_DAYS,
    operatorRecord: null,
    photoAvailable: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('the title and the line under it', () => {
  it('renders the hardware name over the id and the place, as the panel draws it', () => {
    const identity = intelIdentity('FWM-0442', 'FALCON', 'READING & TENNESSEE');
    expect(identity.title).toBe('FALCON');
    // The PLACE leads and the id trails: the most-read line on the card no
    // longer opens with a database key.
    expect(identity.subline).toBe('READING & TENNESSEE · FWM-0442');
    expect(identity.sublineIsNote).toBe(false);
    expect(identity.idInTitle).toBe(false);
  });

  it('promotes the id to the title when no hardware name exists, and never prints it twice', () => {
    const identity = intelIdentity('FWM-0442', null, null);
    expect(identity.title).toBe('FWM-0442');
    expect(identity.subline).toBe(IDENTITY_UNKNOWN_NOTE);
    expect(identity.sublineIsNote).toBe(true);
    // The copy affordance follows the id, so it has to be told where it went.
    expect(identity.idInTitle).toBe(true);
  });

  it('keeps the place on the second line when only the hardware name is missing', () => {
    const identity = intelIdentity('FWM-0442', null, 'READING & TENNESSEE');
    expect(identity.title).toBe('FWM-0442');
    expect(identity.subline).toBe('READING & TENNESSEE');
    expect(identity.subline).not.toContain('FWM-0442');
  });

  it('never invents a hardware name for a real record', () => {
    // `CameraRecord` has no field for one, so the model must not produce one.
    expect(intelModel(input()).identity.title).toBe('FWM-0442');
  });
});

// ---------------------------------------------------------------------------
// The readout
// ---------------------------------------------------------------------------

describe('the distance readout', () => {
  it('reads 425 FT · SW for the camera the panel draws', () => {
    const readout = intelReadout(assessment());
    expect(readout.value).toBe('425');
    expect(readout.unit).toBe('FT');
    expect(readout.cardinal).toBe('SW');
  });

  it('switches to miles at the engine cut point rather than printing four digits', () => {
    const readout = intelReadout(assessment({ distanceFt: 12_672 }));
    expect(readout.value).toBe('2.4');
    expect(readout.unit).toBe('MI');
  });

  it('shows an em dash and no direction when the engine has not assessed the camera', () => {
    const readout = intelReadout(null);
    expect(readout.value).toBe(NO_VALUE);
    expect(readout.cardinal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

describe('the OWNER / MOUNT / FACING tiles', () => {
  it('draws all three in the panel order even when two have nothing behind them', () => {
    const tiles = intelTiles(null);
    expect(tiles.map((tile) => tile.label)).toEqual(['OWNER', 'MOUNT', 'FACING']);
    expect(tiles.every((tile) => tile.value === NO_VALUE)).toBe(true);
    expect(tiles.every((tile) => !tile.known)).toBe(true);
  });

  it('renders the owner and the facing the record actually carries', () => {
    const tiles = intelTiles(record());
    expect(tiles[0]).toMatchObject({ label: 'OWNER', value: 'HOA', known: true });
    expect(tiles[2]).toMatchObject({ label: 'FACING', value: '223°', known: true });
  });

  it('leaves MOUNT unknown because no camera record in this build carries one', () => {
    expect(intelTiles(record())[1]).toMatchObject({ label: 'MOUNT', value: NO_VALUE, known: false });
  });

  it('marks a facing of unknown as unknown instead of printing a zero bearing', () => {
    expect(intelTiles(record({ directionDeg: null }))[2]?.known).toBe(false);
  });

  it('has a word for every owner type TRIAGE groups by', () => {
    expect(Object.values(OWNER_LABEL)).toEqual([
      'POLICE',
      'INTER-AGENCY',
      'HOA',
      'PRIVATE',
      'UNVERIFIED',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

describe('the fact rows', () => {
  it('draws every row, in the panel order', () => {
    const facts = intelFacts({ record: null, reads: 0, windowDays: READ_WINDOW_DAYS });
    expect(facts.map((fact) => fact.label)).toEqual([
      'EFF ATLAS',
      'INTER-AGENCY SHARING',
      'FIRST REPORTED',
      'IN THIS COUNTY',
      'CONFIRMED BY',
      // Present in the LIST even though it renders a dash on the 94% of
      // records with one bearing -- the panel draws every row in a fixed
      // order, and a row that appears and disappears would move the ones
      // under it.
      'COVERS',
      'YOUR READS',
      'DATA AS OF',
    ]);
  });

  it('refuses to claim an Atlas cross-reference, a sharing status or a first-reported date', () => {
    const facts = intelFacts({ record: record(), reads: 21, windowDays: READ_WINDOW_DAYS });
    for (const label of ['EFF ATLAS', 'INTER-AGENCY SHARING', 'FIRST REPORTED']) {
      const fact = facts.find((item) => item.label === label);
      expect(fact?.value).toBe(NO_VALUE);
      expect(fact?.known).toBe(false);
      expect(fact?.tone).toBe('default');
    }
  });

  it('renders the confirmation count the record carries', () => {
    const facts = intelFacts({ record: record(), reads: 21, windowDays: READ_WINDOW_DAYS });
    expect(facts.find((fact) => fact.label === 'CONFIRMED BY')?.value).toBe('28 HAKCERS');
  });

  // -------------------------------------------------------------------------
  // The panel's colours, encoded even for the rows nothing can fill yet
  // -------------------------------------------------------------------------

  it('holds the colour A4 draws each value in', () => {
    // Read straight off the panel: green cross-reference, alert-red sharing
    // count, alert-red reads, and the block's own colour for the other two.
    expect(FACT_TONE).toEqual({
      'EFF ATLAS': 'clear',
      'INTER-AGENCY SHARING': 'alert',
      'FIRST REPORTED': 'default',
      // The county row is context, not an alarm -- it is true of every camera
      // in the county and colouring it would put an alert hue on a fact about
      // geography.
      'IN THIS COUNTY': 'default',
      'CONFIRMED BY': 'default',
      // Geography, like the county row. It says what the mapper recorded, not
      // that anything is wrong.
      COVERS: 'default',
      // Default too. A freshness stamp coloured red would read as "this data
      // is wrong", when the honest claim is only "this is when it was true" -
      // and on a fresh archive that is a reassurance, not a warning.
      'DATA AS OF': 'default',
      'YOUR READS': 'alert',
    });
  });

  it('colours a filled row without being told which colour, so the tone is reachable', () => {
    // The three unsourced rows are the two the panel colours most loudly. If
    // the tone only travelled with the value, `clear` would be a tone no input
    // could produce and `intel.css`'s rule for it would be dead code -- and
    // whoever lands the data source would have to rediscover the colouring.
    expect(intelFact('EFF ATLAS', 'CROSS-REFERENCED')).toEqual({
      label: 'EFF ATLAS',
      value: 'CROSS-REFERENCED',
      tone: 'clear',
      known: true,
    });
    expect(intelFact('INTER-AGENCY SHARING', 'YES · 412 AGENCIES')).toMatchObject({
      tone: 'alert',
      known: true,
    });
    expect(intelFact('FIRST REPORTED', 'MAR 2026')).toMatchObject({
      tone: 'default',
      known: true,
    });
  });

  it('never colours an em dash, whatever the row is drawn in', () => {
    // A missing value in alert red is a colour about nothing.
    for (const label of ['EFF ATLAS', 'INTER-AGENCY SHARING', 'YOUR READS'] as const) {
      expect(intelFact(label, null)).toMatchObject({ value: NO_VALUE, tone: 'default' });
    }
  });

  it('renders YOUR READS as the panel words it, and alerts only when there is something to alert about', () => {
    const some = intelFacts({ record: record(), reads: 21, windowDays: READ_WINDOW_DAYS });
    const your = some.find((fact) => fact.label === 'YOUR READS');
    // Not "IN 30 DAYS": the alert log is never persisted, so it cannot
    // hold anything older than this session. See the row's own note.
    expect(your?.value).toBe('21 THIS SESSION');
    expect(your?.tone).toBe('alert');

    const none = intelFacts({ record: record(), reads: 0, windowDays: READ_WINDOW_DAYS });
    const zero = none.find((fact) => fact.label === 'YOUR READS');
    expect(zero?.value).toBe('0 THIS SESSION');
    expect(zero?.known).toBe(true);
    expect(zero?.tone).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// YOUR READS
// ---------------------------------------------------------------------------

describe('counting this device own passes', () => {
  it('counts one pass per entry into range for this camera', () => {
    const entries = [pass({ id: 1 }), pass({ id: 2, atMs: NOW - DAY_MS })];
    expect(intelReads(entries, 'FWM-0442', NOW)).toBe(2);
  });

  it('ignores other cameras', () => {
    expect(intelReads([pass({ cameraId: 'FWM-0118' })], 'FWM-0442', NOW)).toBe(0);
  });

  it('ignores transitions that are not an entry into range', () => {
    // Dropping back to clear is a recorded transition and it is not a read.
    const leaving = pass({ state: 'clear', previousState: 'in_range' });
    expect(intelReads([leaving], 'FWM-0442', NOW)).toBe(0);
  });

  it('counts a muted pass, because muting removes the alert and never the record', () => {
    expect(intelReads([pass({ muted: true })], 'FWM-0442', NOW)).toBe(1);
  });

  it('stops at the window edge instead of counting the whole log', () => {
    const old = pass({ id: 9, atMs: NOW - 45 * DAY_MS });
    expect(intelReads([pass(), old], 'FWM-0442', NOW)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B9
// ---------------------------------------------------------------------------

describe('the flagged operator', () => {
  it('names the agency before the finding, so a quote cannot drop it', () => {
    const sentence = operatorSentence({
      agency: 'County sheriff',
      findings: '1 documented stalking case, 1 unaudited-access finding.',
      sources: 3,
    });
    expect(sentence).toBe(
      'County sheriff - 1 documented stalking case, 1 unaudited-access finding.',
    );
    expect(sentence.startsWith('County sheriff')).toBe(true);
  });

  it('counts the citations the way the panel does', () => {
    expect(operatorSourcesLabel(3)).toBe('SEE THE 3 SOURCES');
  });

  it('will not show a record with no citation behind it', () => {
    expect(
      operatorRecordVisible({ agency: 'County sheriff', findings: 'something', sources: 0 }),
    ).toBe(false);
    expect(operatorRecordVisible(null)).toBe(false);
  });

  it('does not colour the camera when the operator is flagged', () => {
    const flagged = intelModel(
      input({
        operatorRecord: { agency: 'County sheriff', findings: 'a finding.', sources: 3 },
      }),
    );
    const plain = intelModel(input());
    // The flag reaches the state, which is the card's only hue input: "a
    // flagged agency's cams still alert normally".
    expect(flagged.state).toBe(plain.state);
  });
});

// ---------------------------------------------------------------------------
// Muting
// ---------------------------------------------------------------------------

describe('muting', () => {
  it('greys the card without removing a single fact, tile or action', () => {
    const loud = intelModel(input());
    const quiet = intelModel(
      input({ state: 'muted', mutedCamera: true, muteRemainingMs: 600_000 }),
    );

    expect(quiet.state).toBe('muted');
    expect(quiet.tiles).toEqual(loud.tiles);
    expect(quiet.facts).toEqual(loud.facts);
    expect(quiet.readout).toEqual(loud.readout);
  });

  it('keeps a global mute off the per-camera key', () => {
    // Everything is silenced -- which reaches the card as its state -- and this
    // camera is not on the per-camera list. The key must read as unpressed.
    const model = intelModel(input({ mutedCamera: false, state: 'muted' }));
    expect(model.state).toBe('muted');
    expect(model.mutedCamera).toBe(false);
    expect(model.muteCountdown).toBeNull();
  });

  // -------------------------------------------------------------------------
  // `MUTE THIS ONE` IS A TEN-MINUTE TIMER, AND THE CARD SAYS SO
  // -------------------------------------------------------------------------

  it('prints what is left of the mute, so a timer is never drawn as a latch', () => {
    // `DEFAULT_MUTE_DURATION_MS` is 600_000. Nine minutes and 41 seconds in.
    const model = intelModel(input({ mutedCamera: true, muteRemainingMs: 581_000 }));
    expect(model.muteCountdown).toBe('9:41');
    expect(muteClockLabel(model.muteCountdown ?? '')).toBe('MUTED 9:41');
  });

  it('says the muted camera is still drawn and still counted', () => {
    expect(MUTE_STILL_COUNTED).toBe('STILL DRAWN, STILL COUNTED');
  });

  it('draws no countdown once the timer has run out', () => {
    // The mute has lapsed: the alert slice will drop the id on its next tick,
    // and until then the card must not print a clock that is not running.
    expect(intelModel(input({ mutedCamera: true, muteRemainingMs: 0 })).muteCountdown).toBeNull();
  });

  it('draws no countdown for a camera that was never muted here', () => {
    expect(
      intelModel(input({ mutedCamera: false, muteRemainingMs: 600_000 })).muteCountdown,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SHARE
// ---------------------------------------------------------------------------

describe('what a share carries', () => {
  it('names the camera once, not twice', () => {
    // `intelIdentity` promotes the id INTO the title when there is no hardware
    // name -- which is every record in this build -- so `title · cameraId`
    // shipped `FWM-0442 · FWM-0442` on every share this product could produce.
    const first = shareText(intelModel(input())).split('\n')[0];
    expect(first).toBe('FWM-0442');
    expect(first?.match(/FWM-0442/g)).toHaveLength(1);
  });

  it('names the camera exactly once anywhere in the body', () => {
    expect(shareText(intelModel(input())).match(/FWM-0442/g)).toHaveLength(1);
  });

  it('builds the headline from wherever the identity put the id', () => {
    expect(shareHeadline(intelIdentity('FWM-0442', 'FALCON', 'READING & TENNESSEE'))).toBe(
      'FALCON · READING & TENNESSEE · FWM-0442',
    );
    expect(shareHeadline(intelIdentity('FWM-0442', 'FALCON', null))).toBe('FALCON · FWM-0442');
    expect(shareHeadline(intelIdentity('FWM-0442', null, 'READING & TENNESSEE'))).toBe(
      'FWM-0442 · READING & TENNESSEE',
    );
    expect(shareHeadline(intelIdentity('FWM-0442', null, null))).toBe('FWM-0442');
  });

  it('never sends the note explaining what the record is missing', () => {
    // It is an explanation aimed at the driver looking at the card, not a fact
    // about the camera, and a share is read by somebody who never saw the card.
    expect(shareText(intelModel(input()))).not.toContain(IDENTITY_UNKNOWN_NOTE);
  });

  it('carries the camera and never the driver', () => {
    const text = shareText(intelModel(input()));
    expect(text).toContain('FWM-0442');
    expect(text).toContain('OWNER: HOA');
    expect(text).toContain('FACING: 223°');
    // The driver's own movement history and their distance from the camera are
    // facts about the phone, not about public infrastructure.
    expect(text).not.toContain('YOUR READS');
    expect(text).not.toContain('425');
    expect(text).not.toContain('SW');
  });

  it('carries no coordinate', () => {
    const text = shareText(intelModel(input()));
    expect(text).not.toContain('39.1');
    expect(text).not.toContain('84.58');
  });

  it('drops unknown rows rather than sharing em dashes', () => {
    const text = shareText(intelModel(input({ record: null })));
    expect(text).not.toContain(NO_VALUE);
    expect(text).not.toContain('MOUNT');
  });
});

// ---------------------------------------------------------------------------
// Action feedback
// ---------------------------------------------------------------------------

describe('action feedback', () => {
  it('says a statement was queued rather than sent', () => {
    expect(actionMessage('confirm-queued')).toContain('QUEUED');
    expect(actionMessage('dispute-queued')).toContain('QUEUED');
  });

  it('separates a refusal from a success', () => {
    expect(isActionFailure('queue-failed')).toBe(true);
    expect(isActionFailure('share-failed')).toBe(true);
    expect(isActionFailure('copy-failed')).toBe(true);
    expect(isActionFailure('shared')).toBe(false);
    expect(isActionFailure('unmuted')).toBe(false);
  });

  it('never interpolates anything into a message', () => {
    // Fixed sentences only: an error string is written for a developer and can
    // quote a payload field.
    const outcomes: readonly IntelActionOutcome[] = [
      'confirm-queued',
      'dispute-queued',
      'queue-failed',
      'unmuted',
      'id-copied',
      'copy-failed',
      'shared',
      'share-unavailable',
      'share-failed',
    ];
    for (const outcome of outcomes) {
      expect(actionMessage(outcome)).toMatch(/^[A-Z0-9 ·,'-]+$/);
    }
  });
});

describe('the street line', () => {
  /**
   * Local streets are not in the map data at all -- the road tiles are TIGER
   * PRISECROADS, which is arterials only -- so a marker on a zoomed-in scope
   * has nothing around it to say where it is. The name is the answer, snapped
   * at build time and shipped instead of the geometry.
   */
  const at = (street?: string, cross?: string): CameraRecord => ({
    id: 'osm:1',
    lat: 38.9,
    lon: -94.6,
    directionDeg: null,
    ...(street === undefined ? {} : { street }),
    ...(cross === undefined ? {} : { cross }),
  });

  it('prints the street alone for a mid-block camera', () => {
    expect(streetLine(at('METCALF AVE'))).toBe('METCALF AVE');
  });

  it('prints an intersection when there really is one', () => {
    expect(streetLine(at('METCALF AVE', 'W 95TH ST'))).toBe('METCALF AVE @ W 95TH ST');
  });

  it('never invents a junction out of the same road twice', () => {
    // TIGER splits one street into many records, so the nearest "other"
    // segment is often the same street. "METCALF @ METCALF" is not a place.
    expect(streetLine(at('METCALF AVE', 'METCALF AVE'))).toBe('METCALF AVE');
  });

  it('is null when nothing snapped, rather than guessing', () => {
    expect(streetLine(at())).toBeNull();
    expect(streetLine(at('   '))).toBeNull();
    expect(streetLine(null)).toBeNull();
    expect(streetLine(undefined)).toBeNull();
  });

  it('ignores an empty cross street instead of trailing an @', () => {
    expect(streetLine(at('METCALF AVE', '  '))).toBe('METCALF AVE');
  });
});

/**
 * THE MAPPER'S OWN TAGS - the fields that were printing a dash over real data.
 *
 * MOUNT was hardcoded `null` under a comment saying nothing on `CameraRecord`
 * could supply it, and the hardware name was hardcoded `null` too, so the title
 * fell back to the raw id: `osm:13472226901` as a headline, over a note saying
 * there was no hardware name on the record. Both were true of the record and
 * neither was true of the source -- OSM carries `manufacturer` on 91.66% of
 * these nodes and `camera:mount` on 30.55%, measured across all 131,083 after
 * `scripts/enrich-cameras.mjs` merged them in.
 */
describe('tagValue', () => {
  const withTags = (tags: Record<string, string>): CameraRecord => ({
    id: 'osm:1',
    lat: 0,
    lon: 0,
    directionDeg: null,
    tags,
  });

  it('upper-cases, because one answer must not read as three', () => {
    // `pole`, `Pole` and `POLE` are what mappers actually type.
    expect(tagValue(withTags({ 'camera:mount': 'pole' }), 'camera:mount')).toBe('POLE');
  });

  it('takes the FIRST of a semicolon list rather than inventing a join', () => {
    // OSM's way of saying "both". The tile has room for one, and averaging or
    // concatenating produces a value no mapper wrote.
    expect(tagValue(withTags({ 'camera:mount': 'pole;mast' }), 'camera:mount')).toBe('POLE');
  });

  it('is null for a tag the mapper did not write -- the majority case', () => {
    expect(tagValue(withTags({ manufacturer: 'Flock Safety' }), 'camera:mount')).toBeNull();
  });

  it('is null for a record with no tags at all, and for no record', () => {
    expect(tagValue({ id: 'osm:1', lat: 0, lon: 0, directionDeg: null }, 'operator')).toBeNull();
    expect(tagValue(null, 'operator')).toBeNull();
  });

  it('treats whitespace as absence', () => {
    expect(tagValue(withTags({ operator: '   ' }), 'operator')).toBeNull();
  });
});

describe('the tiles read the record', () => {
  const record = (tags: Record<string, string>): CameraRecord => ({
    id: 'osm:1',
    lat: 0,
    lon: 0,
    directionDeg: 90,
    ownerType: 'police',
    tags,
  });

  it('MOUNT is the mapper value, not a permanent dash', () => {
    const mount = intelTiles(record({ 'camera:mount': 'pole' })).find((t) => t.label === 'MOUNT');
    expect(mount?.value).toBe('POLE');
    expect(mount?.known).toBe(true);
  });

  it('MOUNT stays a dash where the mapper wrote none -- correct, not a gap', () => {
    // 69% of ALPR nodes have no mount tagged.
    const mount = intelTiles(record({})).find((t) => t.label === 'MOUNT');
    expect(mount?.value).toBe(NO_VALUE);
    expect(mount?.known).toBe(false);
  });

  it('OWNER prefers the operator STRING over the four-way bucket', () => {
    // "OVERLAND PARK PD" is a fact; "POLICE" is that fact with the useful part
    // removed. Shortened because the tile is about 55px of inner column on a
    // 320px screen and the median operator is 25 characters -- see
    // `shortOperator`, which uses the abbreviation OSM mappers write by hand.
    const owner = intelTiles(record({ operator: 'Overland Park Police Department' })).find(
      (t) => t.label === 'OWNER',
    );
    expect(owner?.value).toBe('OVERLAND PARK PD');
  });

  it('and falls back to the bucket, which every record has', () => {
    const owner = intelTiles(record({})).find((t) => t.label === 'OWNER');
    expect(owner?.known).toBe(true);
    expect(owner?.value).not.toBe(NO_VALUE);
  });
});

describe('the title is hardware, not an id', () => {
  const record = (tags: Record<string, string>): CameraRecord => ({
    id: 'osm:13472226901',
    lat: 0,
    lon: 0,
    directionDeg: null,
    tags,
  });

  it('promotes the manufacturer and demotes the id to the subline', () => {
    const identity = intelIdentity(
      'osm:13472226901',
      tagValue(record({ manufacturer: 'Genetec' }), 'manufacturer'),
      'NALL AVE',
    );
    expect(identity.title).toBe('GENETEC');
    expect(identity.idInTitle).toBe(false);
    expect(identity.subline).toContain('osm:13472226901');
  });

  it('falls back to brand, the documented alternative for the same fact', () => {
    expect(tagValue(record({ brand: 'Flock Safety' }), 'brand')).toBe('FLOCK SAFETY');
  });

  it('still shows the id when the mapper named no hardware', () => {
    const identity = intelIdentity('osm:13472226901', null, null);
    expect(identity.title).toBe('osm:13472226901');
    expect(identity.idInTitle).toBe(true);
  });
});

describe('dataAsOf', () => {
  const NOW = Date.parse('2026-08-31T12:00:00Z');

  it('gives the date AND the gap, because only one of them survives a screenshot', () => {
    // The relative half is what a driver reads; the absolute half is what is
    // still true when the screenshot is opened in a bug report a month later.
    // 4d17h, floored. Whole days elapsed, not calendar days crossed.
    expect(dataAsOf('2026-08-26T19:00:00Z', NOW)).toBe('26 AUG 2026 · 4 DAYS AGO');
    expect(dataAsOf('2026-08-31T01:00:00Z', NOW)).toBe('31 AUG 2026 · TODAY');
    expect(dataAsOf('2026-08-30T01:00:00Z', NOW)).toBe('30 AUG 2026 · 1 DAY AGO');
  });

  it('refuses a future stamp rather than printing "IN 3 DAYS"', () => {
    // Clock skew on the device would otherwise turn a freshness row into the
    // least trustworthy thing on the card.
    expect(dataAsOf('2026-09-03T00:00:00Z', NOW)).toBeNull();
  });

  it('returns null for anything it cannot parse, never a guess', () => {
    expect(dataAsOf(null, NOW)).toBeNull();
    expect(dataAsOf('', NOW)).toBeNull();
    expect(dataAsOf('not a date', NOW)).toBeNull();
  });
});
