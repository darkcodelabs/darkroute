/**
 * B9 · RECORD FLAGS -- the flagged-operator variant of the INTEL CARD.
 *
 * Reference: `Flockys Screens II.dc.html`, `B9 · RECORD FLAGS - WHERE IT
 * SURFACES`, panel 1 ("ON THE INTEL CARD").
 *
 * `FEATURES.record` is FALSE in the shipped build, so this file is the only
 * place the banner can be seen at all. The flag is stubbed on here and nowhere
 * else: `IntelView.test.tsx` asserts the shipped behaviour, which is that
 * nothing is drawn until every entry can carry its citation.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OperatorRecordBanner } from './OperatorRecordBanner.tsx';
import { IntelView } from './IntelView.tsx';
import { READ_WINDOW_DAYS, intelModel } from '../intelState.ts';
import type { OperatorRecord } from '../intelState.ts';

vi.mock('../../../config/features.ts', () => ({
  FEATURES: { plateLookup: false, presence: false, record: true },
  isEnabled: (flag: string) => flag === 'record',
}));

/** The record B9 draws, split into the two fields the rule requires. */
function flagged(over: Partial<OperatorRecord> = {}): OperatorRecord {
  return {
    agency: 'County sheriff',
    findings: '1 documented stalking case, 1 unaudited-access finding.',
    sources: 3,
    ...over,
  };
}

describe('the banner, with RECORD switched on', () => {
  it('renders the label, the sentence and the source count the panel draws', () => {
    render(<OperatorRecordBanner record={flagged()} onSeeSources={vi.fn()} />);

    expect(screen.getByText('OPERATOR HAS A RECORD')).toBeInTheDocument();
    expect(
      screen.getByText('County sheriff - 1 documented stalking case, 1 unaudited-access finding.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SEE THE 3 SOURCES' })).toBeInTheDocument();
  });

  it('names an agency and never an individual', () => {
    const { container } = render(<OperatorRecordBanner record={flagged()} />);
    // The rendered sentence is built from `agency` + `findings` and there is no
    // field on the record a name could arrive in.
    expect(container.textContent).toContain('County sheriff');
    expect(Object.keys(flagged())).toEqual(['agency', 'findings', 'sources']);
  });

  it('hides the citation link rather than dangling it when nothing can open RECORD', () => {
    render(<OperatorRecordBanner record={flagged()} />);
    expect(screen.queryByText(/SEE THE/)).toBeNull();
    // The accusation itself still shows: it is sourced, just not navigable here.
    expect(screen.getByText('OPERATOR HAS A RECORD')).toBeInTheDocument();
  });

  it('refuses to render a record with no citation behind it', () => {
    const { container } = render(<OperatorRecordBanner record={flagged({ sources: 0 })} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing at all when there is no record', () => {
    const { container } = render(<OperatorRecordBanner record={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('a flagged operator on the whole card', () => {
  function card(record: OperatorRecord | null) {
    return intelModel({
      cameraId: 'FWM-0442',
      record: {
        id: 'FWM-0442',
        lat: 39.1,
        lon: -84.58,
        directionDeg: 223,
        ownerType: 'police',
        confirmations: 28,
      },
      assessment: null,
      state: 'in_range',
      mutedCamera: false,
      muteRemainingMs: 0,
      reads: 21,
      windowDays: READ_WINDOW_DAYS,
      operatorRecord: record,
      photoAvailable: false,
    });
  }

  it("alerts exactly as it would unflagged: the flag colours the operator, not the camera", () => {
    const plain = card(null);
    const marked = card(flagged());

    // The state IS the hue -- `intel.css` sets `--fwm-intel-hue` from it and
    // from nothing else -- so a state that survives the flag is a colour that
    // survives the flag.
    expect(marked.state).toBe(plain.state);
    expect(marked.readout).toEqual(plain.readout);
    expect(marked.tiles).toEqual(plain.tiles);
    expect(marked.facts).toEqual(plain.facts);
  });

  it('adds the banner and changes nothing else on the card', () => {
    const marked = render(<IntelView model={card(flagged())} />);
    expect(screen.getByText('OPERATOR HAS A RECORD')).toBeInTheDocument();
    expect(
      marked.container.querySelector('.fwm-intel')?.getAttribute('data-fwm-intel-state'),
    ).toBe('in_range');
    expect(
      marked.container.querySelector('.fwm-intel')?.getAttribute('data-fwm-intel-flagged'),
    ).toBe('true');
    // Every drawn action survives the flag.
    expect(screen.getByRole('button', { name: 'CONFIRM STILL THERE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toBeInTheDocument();
  });
});
