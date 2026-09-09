/**
 * THE v1 MODAL IS COLOURED BY WHO OWNS THE CAMERA, AND ONLY WHEN SOMEBODY DOES.
 *
 * Two claims, and the second is the one worth a test. A driver taps a dot on
 * the map and this card comes up; it has to be the colour that dot was, or the
 * tap answers with something that looks like a different camera. But most
 * records carry NO owner at all -- OSM's ALPR nodes usually have no operator --
 * and a card that fell through to a colour would be telling that driver a
 * camera is police when nobody knows who owns it.
 *
 * `intelV1.css` is read from disk rather than imported: vitest runs with
 * `css: false`, which stubs every CSS import to an empty string, so a computed
 * style would be empty and asserting on one would prove nothing.
 */

import { readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CameraOwnerType, CameraRecord } from '../../../stores';
import { READ_WINDOW_DAYS, intelModel } from '../intelState.ts';
import type { IntelInput, IntelViewModel } from '../intelState.ts';

import { DETAILS_LABEL, IntelViewV1 } from './IntelViewV1.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;

function withoutComments(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

const cssRules: string = withoutComments(`${HERE}/../intelV1.css`);
const tokens: string = withoutComments(`${HERE}/../../../styles/tokens.css`);

/**
 * The card's own token for each owner class.
 *
 * The card reads `--dr-owner-*` rather than naming the map's hues itself, which
 * is one indirection more than it used to be and is the point: `tokens.css`
 * binds four of those five straight to the palette the map paints its dots
 * from, so the two cannot drift apart in a component file. The fifth is
 * asserted separately below, because it deliberately does not match yet.
 */
const OWNER_TOKEN: Readonly<Record<CameraOwnerType, string>> = {
  police: '--dr-owner-police',
  inter_agency: '--dr-owner-flock',
  hoa: '--dr-owner-hoa',
  private: '--dr-owner-private',
  unverified: '--dr-owner-unverified',
};

/**
 * The map's own colour for each owner class, from `cameraLayer`'s
 * `circle-color` match expression in `features/map/layers.ts`.
 */
const MAP_HUE: Readonly<Record<CameraOwnerType, string>> = {
  police: '--fwm-alert-in-range',
  inter_agency: '--fwm-alert-multiple',
  hoa: '--fwm-alert-approaching',
  private: '--fwm-alert-in-range-text',
  unverified: '--fwm-accent-scan',
};

function record(over: Partial<CameraRecord> = {}): CameraRecord {
  return { id: 'osm:1', lat: 38.9, lon: -94.6, directionDeg: 90, ...over } as CameraRecord;
}

function model(over: Partial<IntelInput> = {}): IntelViewModel {
  return intelModel({
    cameraId: 'osm:1',
    record: record(),
    assessment: null,
    state: 'approaching',
    mutedCamera: false,
    muteRemainingMs: 0,
    reads: 0,
    windowDays: READ_WINDOW_DAYS,
    operatorRecord: null,
    photoAvailable: false,
    ...over,
  });
}

function ownerAttr(m: IntelViewModel): string | null {
  const { container } = render(<IntelViewV1 model={m} />);
  return container.querySelector('.fwm-intelv1')?.getAttribute('data-fwm-owner') ?? null;
}

describe('the card carries the owner class the map colours by', () => {
  it('puts each class on the root, and gives each one its owner token', () => {
    for (const owner of Object.keys(OWNER_TOKEN) as CameraOwnerType[]) {
      expect(ownerAttr(model({ record: record({ ownerType: owner }) }))).toBe(owner);
      const rule = new RegExp(
        `\\[data-fwm-owner='${owner}'\\][^{]*\\{[^}]*var\\(${OWNER_TOKEN[owner]}\\)`,
      );
      expect(cssRules).toMatch(rule);
    }
  });

  it('resolves four of the five straight to the hue the map paints the dot in', () => {
    // The guarantee the old version of this test held directly, kept through
    // the one indirection: if somebody re-points `--dr-owner-police` at
    // something that is not the map's in-range hue, a card opened from a red
    // dot stops being red and this says so.
    for (const owner of ['police', 'inter_agency', 'hoa', 'private'] as CameraOwnerType[]) {
      const binding = new RegExp(`${OWNER_TOKEN[owner]}:\\s*var\\(${MAP_HUE[owner]}\\)`);
      expect(tokens, `${owner} no longer resolves to the map's own hue`).toMatch(binding);
    }
  });

  it('is PURPLE for unverified, and knowingly disagrees with the map until the rest lands', () => {
    /*
     * THE ONE HUE THAT MOVED. Owner decision, 2026-09-08: cyan is `system
     * positive / active selection` everywhere else in the product, so it could
     * not also mean "nobody has checked this camera" without breaking the
     * one-hue-one-meaning rule every brief states.
     *
     * Brief 4 says the four surfaces that spend it - the Lookup chips, this
     * modal, the map markers and the Layers menu - have to move together, and
     * section B is one of the four. So this asserts BOTH halves of the current
     * state: the token is the purple, and `features/map/layers.ts` has not
     * moved yet. When it does, the second assertion is the one that fails, and
     * it should be deleted rather than adjusted.
     */
    expect(tokens).toMatch(/--dr-owner-unverified:\s*#a78bfa/);
    expect(tokens).not.toMatch(
      new RegExp(`--dr-owner-unverified:\\s*var\\(${MAP_HUE.unverified}\\)`),
    );
  });

  it('says unknown for a record that asserts no owner, and never a class', () => {
    // The common case, and absence is NOT `unverified`: that is a class
    // somebody asserted. `features/map/ownerFilter.ts` refuses the same
    // conflation, in the same words, for the same reason.
    expect(ownerAttr(model({ record: record() }))).toBe('unknown');
    expect(ownerAttr(model({ record: null }))).toBe('unknown');
  });

  it('gives unknown no hue of its own, so it falls through to the neutral', () => {
    // The safety rule, stated as the absence of a rule: nothing in the card
    // may hand `unknown` an owner colour. The assertions above already prove
    // the file was read, so an empty one cannot pass this by saying nothing.
    expect(cssRules).not.toMatch(/\[data-fwm-owner='unknown'\]/);
    expect(cssRules).toMatch(/--fwm-intelv1-owner:\s*var\(--fwm-line-strong\)/);
  });
});

/**
 * WHAT THE MODAL KEEPS, AND WHAT IT HANDS ON.
 *
 * Brief 4 cuts this card to "operator tag + hue dot, cross-street name,
 * distance / facing / mount in one line, a 62 px static map inset ... `Go to
 * this camera` ... `Still there` / `It's gone` ... and a `Details` row with the
 * OSM id in mono". The eight provenance fields that used to fill it are behind
 * that row; `IntelDetailsV1.test.tsx` is where they are asserted.
 */
describe('the modal leads with where the camera is', () => {
  it('draws the street as the headline and the id only on the Details row', () => {
    render(
      <IntelViewV1 model={model({ record: record({ street: 'METCALF AVE', cross: 'W 111TH ST' }) })} />,
    );

    // The identity line would have led with the manufacturer or, failing that,
    // the id: `intelIdentity` is built for the full card, whose job is to say
    // what the thing on the pole IS. The modal's job is where it is.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('METCALF AVE @ W 111TH ST');
    const row = screen.getByRole('button', { name: new RegExp(DETAILS_LABEL) });
    expect(row).toHaveTextContent('osm:1');
  });

  it('falls back to the identity title when no street is known anywhere', () => {
    // A record that snapped to nothing and a basemap that could not be asked.
    // The card prints what it can rather than an empty headline.
    render(<IntelViewV1 model={model({ record: record() })} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('osm:1');
  });

  it('does not draw the eight provenance fields until Details is pressed', () => {
    const { container } = render(<IntelViewV1 model={model()} />);

    expect(container.querySelectorAll('.fwm-inteldetailv1-fact')).toHaveLength(0);
    expect(screen.getByRole('button', { name: new RegExp(DETAILS_LABEL) })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
