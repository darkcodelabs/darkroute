/**
 * THE v1 CARD IS COLOURED BY WHO OWNS THE CAMERA, AND ONLY WHEN SOMEBODY DOES.
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

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CameraOwnerType, CameraRecord } from '../../../stores';
import { READ_WINDOW_DAYS, intelModel } from '../intelState.ts';
import type { IntelInput, IntelViewModel } from '../intelState.ts';

import { IntelViewV1 } from './IntelViewV1.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const cssRules: string = readFileSync(`${HERE}/../intelV1.css`, 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/**
 * The map's own colour for each owner class.
 *
 * Copied from `cameraLayer`'s `circle-color` match expression in
 * `features/map/layers.ts`, which is the source of truth -- the filter panel's
 * swatches restate the same five. If the card and the map ever diverge, this
 * is where it is caught rather than on a driver's screen.
 */
const MAP_HUE: Readonly<Record<CameraOwnerType, string>> = {
  police: '--fwm-alert-in-range',
  inter_agency: '--fwm-alert-multiple',
  hoa: '--fwm-alert-approaching',
  private: '--fwm-plasma-6',
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
  it('puts each class on the root, and gives each one the map hue', () => {
    for (const owner of Object.keys(MAP_HUE) as CameraOwnerType[]) {
      expect(ownerAttr(model({ record: record({ ownerType: owner }) }))).toBe(owner);
      const rule = new RegExp(
        `\\[data-fwm-owner='${owner}'\\][^{]*\\{[^}]*var\\(${MAP_HUE[owner]}\\)`,
      );
      expect(cssRules).toMatch(rule);
    }
  });

  it('says unknown for a record that asserts no owner, and never a class', () => {
    // The common case, and absence is NOT `unverified`: that is a class
    // somebody asserted. `features/map/ownerFilter.ts` refuses the same
    // conflation, in the same words, for the same reason.
    expect(ownerAttr(model({ record: record() }))).toBe('unknown');
    expect(ownerAttr(model({ record: null }))).toBe('unknown');
  });

  it('gives unknown no hue of its own, so it falls through to the neutral', () => {
    // The safety rule, stated as the absence of a rule: nothing in the sheet
    // may hand `unknown` an owner colour. The assertions above already prove
    // the file was read, so an empty one cannot pass this by saying nothing.
    expect(cssRules).not.toMatch(/\[data-fwm-owner='unknown'\]/);
    expect(cssRules).toMatch(/--fwm-intelv1-owner:\s*var\(--fwm-line-strong\)/);
  });
});

describe('the facts are a grid of cells, not a stack of cards', () => {
  it('draws every fact, including the ones that are an em dash', () => {
    const { container } = render(<IntelViewV1 model={model()} />);
    // An unknown is STATED on this card, never dropped: a missing
    // INTER-AGENCY SHARING row reads as "this camera does not share".
    expect(container.querySelectorAll('.fwm-intelv1-fact')).toHaveLength(
      model().facts.length,
    );
  });

  it('lays the block out as a grid and gives the cells no box of their own', () => {
    expect(cssRules).toMatch(/\.fwm-intelv1-facts\s*\{[^}]*display:\s*grid/);
    const cell = /\.fwm-intelv1-fact\s*\{([^}]*)\}/.exec(cssRules);
    expect(cell).not.toBeNull();
    expect(cell?.[1] ?? '').not.toMatch(/background|border/);
  });
});
