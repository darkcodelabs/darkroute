/**
 * `B2 · DEAD DROP - QUEUE + EVIDENCE CHAIN`, rendered from a view model,
 * against what the design draws and against this repo's house rules.
 *
 * `dead-drop.css` is READ FROM DISK, not imported. vitest runs with
 * `css: false`, which stubs every CSS import -- `?raw` included -- to an empty
 * string, so an assertion against the import would pass on '' no matter what
 * the file says.
 */

// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  CHAINING_NOTE,
  NO_SIGNATURE_CHECK,
  SIGNING_STATEMENT,
  SYNC_UNAVAILABLE_REASON,
  loadingModel,
  unavailableModel,
} from '../deadDropModel.ts';
import type { DeadDropViewModel, DropDetail, DropSummary } from '../deadDropModel.ts';

import { DeadDropView } from './DeadDropView.tsx';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const css: string = readFileSync(`${HERE}/../dead-drop.css`, 'utf8');
/** Rules only. The file's prose explains why there is no hover state, using the word. */
const rules: string = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The card the panel draws, fact for fact. */
const DETAIL: DropDetail = {
  reportId: 'r3',
  state: 'pending',
  title: 'DROP 03',
  badge: 'HELD · 41 MIN',
  facts: [
    { key: 'CAPTURED', value: '14:22:08.412 UTC' },
    { key: 'POSITION', value: '39.0997 N 84.5786 W ±4M' },
    { key: 'HEADING', value: '223°' },
    { key: 'PHOTO', value: 'NONE' },
    { key: 'SIGNED', value: 'DEVICE KEY OK' },
  ],
  verdict: 'verified',
  chainHash: '8f04·822f·b975·e932·0ddb·14d4',
  previousChainHash: 'ea6c·81fb·9735·c591·9b44·3f8b',
  unverifiableReason: null,
};

/** The three rows below it. */
const DROPS: readonly DropSummary[] = [
  {
    reportId: 'r2',
    state: 'pending',
    title: 'DROP 02 · FWM-0442',
    meta: '13:58 · no photo · signed',
    badge: 'HELD',
  },
  {
    reportId: 'r1',
    state: 'pending',
    title: 'DROP 01',
    meta: '13:12 · no photo · signed',
    badge: 'HELD',
  },
  {
    reportId: 'r0',
    state: 'synced',
    title: 'DROP 00 · FWM-0119',
    meta: 'yesterday · accepted',
    badge: 'SYNCED',
  },
];

function model(over: Partial<DeadDropViewModel> = {}): DeadDropViewModel {
  return {
    status: 'ready',
    heldCount: 3,
    detail: DETAIL,
    drops: DROPS,
    hasHeld: true,
    hasExportable: true,
    verifiable: true,
    failure: null,
    ...over,
  };
}

describe('the panel, top to bottom', () => {
  it('draws the header, the statement, the card, the queue and the two keys', () => {
    const { container } = render(<DeadDropView model={model()} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('DEAD DROP');
    expect(screen.getByText('3 HELD')).toBeInTheDocument();
    expect(screen.getByText(SIGNING_STATEMENT)).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-dead-drop-card]')).not.toBeNull();
    expect(container.querySelectorAll('.fwm-dead-drop-row')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'NOT SENT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EXPORT JSON' })).toBeInTheDocument();
  });

  it('labels the hash block the way the panel does', () => {
    const { container } = render(<DeadDropView model={model()} />);
    const block = container.querySelector('[data-fwm-dead-drop-hashes]');
    if (block === null) throw new Error('the hash block was not drawn');

    expect(within(block as HTMLElement).getByText('sha256')).toBeInTheDocument();
    expect(within(block as HTMLElement).getByText('prev')).toBeInTheDocument();
    expect(within(block as HTMLElement).getByText(DETAIL.chainHash)).toBeInTheDocument();
    expect(within(block as HTMLElement).getByText(DETAIL.previousChainHash)).toBeInTheDocument();
  });

  it('carries the note about chaining, verbatim', () => {
    render(<DeadDropView model={model()} />);
    expect(screen.getByText(CHAINING_NOTE)).toBeInTheDocument();
  });

  it('says nothing about a missing signature check when the check ran', () => {
    const { container } = render(<DeadDropView model={model()} />);
    expect(container.querySelector('[data-fwm-dead-drop-unverifiable]')).toBeNull();
  });

  it('says why every verdict is UNVERIFIED when the platform cannot check one', () => {
    const { container } = render(
      <DeadDropView
        model={model({
          verifiable: false,
          detail: {
            ...DETAIL,
            verdict: 'unverified',
            facts: DETAIL.facts.map((fact) =>
              fact.key === 'SIGNED' ? { key: 'SIGNED', value: 'UNVERIFIED' } : fact,
            ),
            unverifiableReason: NO_SIGNATURE_CHECK,
          },
        })}
      />,
    );

    expect(screen.getByText(NO_SIGNATURE_CHECK)).toBeInTheDocument();
    expect(
      container.querySelector('[data-fwm-dead-drop-unverifiable]'),
    ).not.toBeNull();
    // The caution takes the approaching hue. CHAIN BROKEN owns the in-range one.
    expect(rules).toMatch(
      /\.fwm-dead-drop-warning\s*\{[^}]*color:\s*var\(--fwm-alert-approaching\)/,
    );
  });

  it('marks the SIGNED value with its verdict so the hue can follow the result', () => {
    const { container } = render(<DeadDropView model={model()} />);
    const signed = container.querySelector(
      '[data-fwm-dead-drop-fact="SIGNED"] [data-fwm-dead-drop-verdict]',
    );
    expect(signed?.getAttribute('data-fwm-dead-drop-verdict')).toBe('verified');

    // Only the SIGNED row carries a verdict: the other four are facts, not results.
    expect(container.querySelectorAll('[data-fwm-dead-drop-verdict]')).toHaveLength(1);
  });

  it('carries each drop’s state on the row, the dot and the badge alike', () => {
    const { container } = render(<DeadDropView model={model()} />);
    const rows = [...container.querySelectorAll('.fwm-dead-drop-row')];
    const last = rows[rows.length - 1];
    if (last === undefined) throw new Error('no rows were drawn');

    expect(last.getAttribute('data-fwm-dead-drop-state')).toBe('synced');
    expect(
      last.querySelector('.fwm-dead-drop-dot')?.getAttribute('data-fwm-dead-drop-state'),
    ).toBe('synced');
    expect(
      last.querySelector('.fwm-dead-drop-badge')?.getAttribute('data-fwm-dead-drop-state'),
    ).toBe('synced');
  });
});

describe('the action keys', () => {
  it('renders both disabled when neither is wired', () => {
    render(<DeadDropView model={model()} />);
    const send = screen.getByRole('button', { name: 'NOT SENT' });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('title', SYNC_UNAVAILABLE_REASON);
    expect(screen.getByRole('button', { name: 'EXPORT JSON' })).toBeDisabled();
  });

  it('runs the wired handler on a press', () => {
    const onSyncNow = vi.fn();
    const onExport = vi.fn();
    render(<DeadDropView model={model()} onSyncNow={onSyncNow} onExport={onExport} />);

    fireEvent.click(screen.getByRole('button', { name: 'SEND NOW' }));
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT JSON' }));

    expect(onSyncNow).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('still draws both keys when there is nothing to act on', () => {
    render(
      <DeadDropView
        model={model({ detail: null, drops: [], hasHeld: false, hasExportable: false })}
        onSyncNow={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'SEND NOW' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'EXPORT JSON' })).toBeDisabled();
  });
});

describe('states the panel does not draw', () => {
  it('draws no card and no rows while the queue is still being read', () => {
    const { container } = render(<DeadDropView model={loadingModel()} />);

    expect(screen.getByText('READING')).toBeInTheDocument();
    expect(screen.getByText('READING THE QUEUE')).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-dead-drop-card]')).toBeNull();
    expect(container.querySelectorAll('.fwm-dead-drop-row')).toHaveLength(0);
  });

  it('keeps the signing statement in every state, because it stays true', () => {
    render(<DeadDropView model={loadingModel()} />);
    expect(screen.getByText(SIGNING_STATEMENT)).toBeInTheDocument();
  });

  it('marks a failure as a failure rather than as an empty queue', () => {
    const { container } = render(
      <DeadDropView model={unavailableModel('NO LOCAL STORAGE · NOTHING IS QUEUED HERE')} />,
    );
    expect(
      container.querySelector('.fwm-dead-drop-empty')?.getAttribute('data-fwm-dead-drop-empty'),
    ).toBe('unavailable');
  });
});

describe('house rules', () => {
  it('renders the whole panel without a single style attribute', () => {
    const { container } = render(<DeadDropView model={model()} />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('declares no :hover rule anywhere in dead-drop.css', () => {
    expect(rules).not.toContain(':hover');
  });

  it('carries no hover variant on any attribute in the rendered tree', () => {
    const { container } = render(<DeadDropView model={model()} />);
    for (const node of container.querySelectorAll('*')) {
      for (const attribute of node.attributes) {
        expect(attribute.value.toLowerCase()).not.toContain('hover');
      }
    }
  });

  it('expresses every value in dead-drop.css as a token or a calc over one', () => {
    const declarations = rules.match(/[a-z-]+\s*:\s*[^;{}]+/g) ?? [];
    for (const declaration of declarations) {
      const value = declaration.slice(declaration.indexOf(':') + 1);
      // A raw length, duration or hex would be a hardcoded design value.
      expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(value).not.toMatch(/(?<![\w.])\d*\.?\d+(px|rem|em|vh|vw)\b/);
    }
  });

  it('has no rule that hides or collapses a drop for its state', () => {
    expect(rules).not.toMatch(/display:\s*none/);
    expect(rules).not.toMatch(/visibility:\s*hidden/);
  });
});

describe('nothing sensitive reaches an attribute', () => {
  it('puts no coordinate, hash or report id into any data attribute', () => {
    const { container } = render(<DeadDropView model={model()} />);
    for (const node of container.querySelectorAll('*')) {
      for (const attribute of node.attributes) {
        if (attribute.name === 'class') continue;
        expect(attribute.value).not.toContain('39.0997');
        expect(attribute.value).not.toContain('84.5786');
        expect(attribute.value).not.toContain(DETAIL.chainHash);
        expect(attribute.value).not.toContain('r3');
      }
    }
  });
});
