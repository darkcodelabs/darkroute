/**
 * The grouping, which is the part of the new LOOK UP that can be wrong in a way
 * a screenshot would not show.
 *
 * A card is easy to look at and say "yes, that is a street". What a screenshot
 * cannot tell you is whether the camera with no street is still in the list at
 * all, whether the badge is counting the rows underneath it or something else,
 * or whether two spellings of one road opened two cards. Those are the
 * assertions here, and half of them are about what must NOT happen.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../services/db/schema.ts';
// The same shortener the card and the flat list use. Asserted against rather
// than transcribed, so a row and the card it opens cannot render one operator
// two different ways.
import { shortOperator } from '../intel/intelState.ts';

import type { SearchHit } from './search.ts';
import {
  NO_STREET_LABEL,
  UNNAMED_POLE,
  groupByStreet,
  groupListLabel,
  rowTitleOf,
  streetKeyOf,
} from './streetGroups.ts';

function camera(over: Partial<CameraRecord> & { id: string }): CameraRecord {
  return { lat: 38.9, lon: -94.6, directionDeg: null, ...over };
}

/** A ranked result, the shape `searchCameras` hands the screen. */
function hit(over: Partial<CameraRecord> & { id: string }, metres: number | null = null): SearchHit {
  return { camera: camera(over), metres };
}

const METCALF_75TH = hit({ id: 'osm:1', street: 'METCALF AVE', cross: '75TH ST' }, 120);
const METCALF_79TH = hit({ id: 'osm:2', street: 'METCALF AVE', cross: '79TH ST' }, 300);
const NALL = hit({ id: 'osm:3', street: 'NALL AVE' }, 800);
const NOWHERE = hit({ id: 'osm:13639701701' }, 40);

describe('sorting results into streets', () => {
  it('puts two cameras on one street under one heading, and counts both', () => {
    const groups = groupByStreet([METCALF_75TH, METCALF_79TH]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('METCALF AVE');
    expect(groups[0]?.hits).toHaveLength(2);
  });

  it('does not split one street into a card per intersection', () => {
    // The two METCALF cameras have DIFFERENT cross streets. Keying on
    // "street at cross" would give two cards of one row each, which is the flat
    // list this replaced with a header bolted onto every row.
    const groups = groupByStreet([METCALF_75TH, METCALF_79TH, NALL]);

    expect(groups.map((group) => group.label)).toEqual(['METCALF AVE', 'NALL AVE']);
  });

  it('keeps the rows inside a group in the order the search ranked them', () => {
    // Nothing in the grouper sorts. A second ordering here could disagree with
    // the one `searchCameras` already applied, and then the top row of a card
    // would not be its nearest camera.
    const groups = groupByStreet([METCALF_79TH, METCALF_75TH]);

    expect(groups[0]?.hits.map((each) => each.camera.id)).toEqual(['osm:2', 'osm:1']);
  });

  it('orders the cards by where each street first appeared, not alphabetically', () => {
    // NALL sorts before METCALF in the alphabet and is further away. The list
    // is nearest-first, so the nearest street has to be the first card.
    const groups = groupByStreet([METCALF_75TH, NALL]);

    expect(groups.map((group) => group.label)).toEqual(['METCALF AVE', 'NALL AVE']);
  });

  it('treats a difference in case or spacing as the same road, not a second card', () => {
    const groups = groupByStreet([
      METCALF_75TH,
      hit({ id: 'osm:4', street: 'Metcalf   Ave' }),
    ]);

    expect(groups).toHaveLength(1);
    // ...and the header keeps the spelling on the NEAREST camera, which is the
    // first one seen, rather than whichever spelling happened to sort last.
    expect(groups[0]?.label).toBe('METCALF AVE');
  });
});

describe('the cameras the archive has no street for', () => {
  it('says the street is not recorded rather than inventing one', () => {
    const groups = groupByStreet([NOWHERE]);

    expect(groups.map((group) => group.label)).toEqual([NO_STREET_LABEL]);
    // The screen leans on this to draw the header as a note instead of a name.
    expect(groups[0]?.isStreet).toBe(false);
  });

  it('never sweeps them onto a street some other camera was on', () => {
    // The failure this exists to catch: `undefined` used as a map key, so every
    // streetless camera in the country lands under whichever road came first.
    const groups = groupByStreet([METCALF_75TH, NOWHERE, METCALF_79TH]);

    const metcalf = groups.find((group) => group.label === 'METCALF AVE');
    expect(metcalf?.hits.map((each) => each.camera.id)).toEqual(['osm:1', 'osm:2']);
    expect(groups.find((group) => group.isStreet === false)?.hits).toHaveLength(1);
  });

  it('keeps them last even when one of them is the nearest camera in the list', () => {
    // NOWHERE is 40 m away and every street here is further. It still goes to
    // the bottom: the one group that answers no question about a road must not
    // be the one that moves around the screen as the fix drifts.
    const groups = groupByStreet([NOWHERE, METCALF_75TH, NALL]);

    expect(groups.map((group) => group.label)).toEqual([
      'METCALF AVE',
      'NALL AVE',
      NO_STREET_LABEL,
    ]);
  });

  it('draws no such group at all when every camera has a street', () => {
    // The unflattering half: an empty trailing card headed "street not
    // recorded" is the app reporting an absence it does not have.
    const groups = groupByStreet([METCALF_75TH, NALL]);

    expect(groups.every((group) => group.isStreet)).toBe(true);
  });

  it('has no street key to group a streetless camera by', () => {
    expect(streetKeyOf(camera({ id: 'osm:5' }))).toBeNull();
    // Whitespace is not a street either. The archive ships trimmed values, but
    // a blank string would key a card whose header is an empty line.
    expect(streetKeyOf(camera({ id: 'osm:6', street: '   ' }))).toBeNull();
  });

  it('returns nothing at all for a search that matched nothing', () => {
    expect(groupByStreet([])).toEqual([]);
  });
});

/*
 * =============================================================================
 * THIS BLOCK WAS REWRITTEN BY BRIEF 4, AND THE INVERSION IS THE POINT
 * =============================================================================
 * It used to assert `operator ?? cross ?? id`. Two of those three moved:
 *
 *   The CROSS STREET is first now. Brief 4: "Lead with the cross street", and
 *   the spec's own Lookup frame draws six rows, every one of them a cross
 *   street or the fallback and not one of them an operator.
 *
 *   The ID is no longer a title at all. "`osm:12425289022` is a database key,
 *   not a name." It is still on the row, one line down and in mono, so nothing
 *   quotable was lost - see `LookupV1Screen.groups.test.tsx`, which asserts it
 *   is rendered.
 *
 *   `rowSublineOf` IS DELETED, not relaxed. Its whole job was putting the owner
 *   class on the second line, and the second line is the id now. The owner did
 *   not vanish with it: it is the 9px dot at the head of every row, in that
 *   class's own hue, which is what the spec draws and what the filter chips
 *   above the list are coloured to match.
 */
describe('what a row is called under a street header', () => {
  it('leads with the cross street, which is what tells two cameras on one road apart', () => {
    // NOT the street: it is on the card above, and repeating it is what made
    // the ungrouped list read ACCESS RD three times in a row.
    expect(rowTitleOf(METCALF_75TH.camera)).toBe('at 75TH ST');
  });

  it('prefers the cross street over the operator, which is the half brief 4 flipped', () => {
    const row = camera({
      id: 'osm:7',
      street: 'METCALF AVE',
      cross: '75TH ST',
      tags: { operator: 'Johnson County Park & Rec District' },
    });

    expect(rowTitleOf(row)).toBe('at 75TH ST');
  });

  it('says on or off the street where there is no cross street, and falls to the operator only with no street', () => {
    // Mid-block is a fact about the camera, and the row says it. Past sixty
    // metres the camera is beside the road, and the row says that instead.
    const onRoad = camera({ id: 'osm:8', street: 'ACCESS RD', streetM: 12 });
    const offRoad = camera({ id: 'osm:9', street: 'ACCESS RD', streetM: 310 });
    const noStreet = camera({
      id: 'osm:10',
      tags: { operator: 'Johnson County Park & Rec District' },
    });

    expect(rowTitleOf(onRoad)).toBe('on ACCESS RD');
    expect(rowTitleOf(offRoad)).toBe('off ACCESS RD');
    expect(rowTitleOf(noStreet)).toBe(shortOperator('Johnson County Park & Rec District'));
  });

  it('never titles a row with its id, however little else it knows', () => {
    /*
     * The one assertion brief 4 is unambiguous about. NALL has a street and
     * nothing else; NOWHERE has neither a street nor a cross nor an operator,
     * and it is the 26.67% of the archive with no street at all. Both used to
     * render their `osm:` key as the row's name.
     */
    expect(rowTitleOf(NALL.camera)).toBe(`on ${NALL.camera.street ?? ''}`);
    expect(rowTitleOf(NOWHERE.camera)).toBe(UNNAMED_POLE);
    expect(rowTitleOf(NOWHERE.camera)).not.toContain('osm:');
  });

  it('does not claim a side of the road, because no field records one', () => {
    /*
     * The spec writes `unnamed pole, north side`. There is no side-of-road
     * field in the archive - `directionDeg` is which way the camera FACES - so
     * the side is not printed. A confident wrong side is the same defect as a
     * confident wrong street, one field over.
     */
    expect(UNNAMED_POLE).not.toMatch(/north|south|east|west|side/i);
  });
});

describe('what the badge says out loud', () => {
  it('says one camera, not 1 cameras', () => {
    const [alone] = groupByStreet([NALL]);

    expect(alone).toBeDefined();
    expect(alone && groupListLabel(alone)).toBe('NALL AVE, 1 camera');
  });

  it('names the street and the count, because the badge itself is a bare numeral', () => {
    const [metcalf] = groupByStreet([METCALF_75TH, METCALF_79TH]);

    expect(metcalf).toBeDefined();
    expect(metcalf && groupListLabel(metcalf)).toBe('METCALF AVE, 2 cameras');
  });
});
