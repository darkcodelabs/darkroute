/**
 * SETTINGS as a picture: what is on screen for a given model, and what is not.
 *
 * No store, no database, no surface detection. The wiring lives in
 * `SettingsScreen.test.tsx`; this file is about the four things the design
 * composition has to get right -- the section 04 slider, the section 04
 * toggles, the section 05 picker with its watch rule, and the privacy block
 * with its one removal control.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FORCED_WATCH_NOTICE, MODE_CHOICES } from '../modes.ts';
import { PRIVACY_PROMISES, STORED_ITEMS } from '../storage.ts';

import { REMOVAL_CANCEL_LABEL, REMOVAL_LABELS, REMOVAL_WARNING } from './RemovalControl.tsx';
import { AUDIO_LABEL, HYDRATING_NOTICE, SettingsView, VIBRATION_LABEL } from './SettingsView.tsx';
import type { SettingsViewModel } from './SettingsView.tsx';

function model(over: Partial<SettingsViewModel> = {}): SettingsViewModel {
  return {
    ready: true,
    thresholdFt: 500,
    vibration: true,
    audio: true,
    mode: 'night-watch',
    modeForced: false,
    textScale: 1,
    typeface: 'original',
  glass: 'medium',
  liquid: 'off',
  clear: 'high',
  mapView: 'auto',
  tone: 'clear' as const,
  mapTilt: 'flat' as const,
  clusterCameras: true,
  headingUpMap: false,
    durable: true,
    durabilityReason: null,
    removalPhase: 'idle',
    removalLines: [],
    removalReason: null,
    ...over,
  };
}

/** Every handler wired, so nothing renders disabled for want of a prop. */
function wired() {
  return {
    onThresholdChange: vi.fn(),
    onVibrationChange: vi.fn(),
    onAudioChange: vi.fn(),
    onModePick: vi.fn(),
    onRemovalPress: vi.fn(),
    onRemovalCancel: vi.fn(),
  };
}

describe('ALERT AT', () => {
  it('renders the value the way section 04 renders it, over a 100-1000 slider', () => {
    const { container } = render(<SettingsView model={model()} {...wired()} />);

    expect(screen.getByText('ALERT AT')).toBeInTheDocument();
    expect(
      container.querySelector('[data-fwm-settings-threshold="true"]')?.textContent,
    ).toBe('500 FT');

    const slider = screen.getByRole('slider', { name: 'ALERT AT' });
    expect(slider).toHaveAttribute('min', '100');
    expect(slider).toHaveAttribute('max', '1000');
    // "TURN BEZEL · 50 FT STEPS" -- W10. The slider steps the same way.
    expect(slider).toHaveAttribute('step', '50');
    expect(slider).toHaveValue('500');
  });

  it('carries the value on the element the stylesheet keys the fill off', () => {
    const { container } = render(<SettingsView model={model({ thresholdFt: 750 })} {...wired()} />);

    expect(
      container.querySelector('.fwm-settings-threshold')?.getAttribute('data-fwm-threshold-ft'),
    ).toBe('750');
  });
});

describe('the toggles', () => {
  it('states each value twice: on the pill and on the label', () => {
    const { container } = render(
      <SettingsView model={model({ vibration: true, audio: false })} {...wired()} />,
    );

    expect(screen.getByRole('switch', { name: 'Vibration' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Audio' })).toHaveAttribute('aria-checked', 'false');

    // Scoped to ALERTS: MUTE is a switch row too, in its own section, and
    // this test is about the two alert toggles.
    const alerts = container.querySelector('[aria-label="ALERTS"]')!;
    const rows = alerts.querySelectorAll('[data-fwm-settings-row]');
    expect([...rows].map((row) => row.getAttribute('data-fwm-settings-row'))).toEqual([
      'on',
      'off',
    ]);
  });

  it('renders no switch for a preference nothing in the build reads', () => {
    render(<SettingsView model={model()} {...wired()} />);

    // The settings slice persists these; no consumer reads them, so SETTINGS
    // does not offer a control that would write a field nothing honours.
    expect(screen.queryByRole('switch', { name: /wake lock/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /wifi/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /parked/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /handle/i })).toBeNull();
  });

  it('labels the drawn row with the drawn string, and the undrawn one honestly', () => {
    render(<SettingsView model={model()} {...wired()} />);

    // Section 04's `TOGGLE · SLIDER · CHIPS` draws two rows: `Vibration` and
    // `Wake lock`. The first is quoted here; the second is the one this build
    // cannot honour, so it must not appear.
    expect(VIBRATION_LABEL).toBe('Vibration');
    expect(screen.getByRole('switch', { name: VIBRATION_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Wake lock' })).toBeNull();
    // `Audio` is derived from B10, not quoted from section 04.
    expect(screen.getByRole('switch', { name: AUDIO_LABEL })).toBeInTheDocument();
  });
});

describe("the rest of the brief's screen 6", () => {
  // `DESIGN-GAPS.md#no-settings-screen-exists` lists volume, WiFi sync status +
  // manual trigger and database freshness. Each is absent for a stated reason
  // and each has a gap entry; none of them may be quietly stood up here as a
  // control that writes nothing or a readout of a store this screen never read.
  it('offers no volume control, because nothing persists or honours a level', () => {
    render(<SettingsView model={model()} {...wired()} />);

    expect(screen.queryByRole('slider', { name: /volume/i })).toBeNull();
    expect(screen.queryByRole('switch', { name: /volume/i })).toBeNull();
    expect(screen.queryByText(/volume/i)).toBeNull();
  });

  it('does not restate the sync queue that DEAD DROP owns', () => {
    render(<SettingsView model={model()} {...wired()} />);

    expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
    expect(screen.queryByText(/queued/i)).toBeNull();
  });

  it('does not restate the database freshness that OFFLINE owns', () => {
    render(<SettingsView model={model()} {...wired()} />);

    // A freshness sentence on a screen that never opened the database would be
    // the exact failure `features/offline`'s CacheNotice exists to avoid.
    expect(screen.queryByText(/fresh|stale|last checked/i)).toBeNull();
  });

  it('offers exactly one slider, and it is the one the engine honours', () => {
    render(<SettingsView model={model()} {...wired()} />);

    const sliders = screen.getAllByRole('slider');
    expect(sliders.map((slider) => slider.getAttribute('aria-label'))).toEqual(['ALERT AT']);
  });
});

describe('the theme picker', () => {
  it('offers every skin and selects the one that is applied', () => {
    render(<SettingsView model={model({ mode: 'pursuit' })} {...wired()} />);

    // A native <select> now, not a radio group: the list grew past the point
    // where a card per mode was a reasonable thing to put on this screen.
    const picker = screen.getByRole('combobox', { name: 'theme mode' });
    expect(within(picker).getAllByRole('option')).toHaveLength(MODE_CHOICES.length);
    expect(picker).toHaveValue('pursuit');
  });

  it('says why on a watch instead of silently ignoring the press', () => {
    render(<SettingsView model={model({ mode: 'night-watch', modeForced: true })} {...wired()} />);

    expect(screen.getByText(FORCED_WATCH_NOTICE)).toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'theme mode' });
    expect(picker).toHaveValue('night-watch');
    // The whole control is inert, and looks it. One disabled select says
    // "locked" more plainly than eight disabled rows did.
    expect(picker).toBeDisabled();
  });
});

describe('what stays on the phone', () => {
  it('lists every stored thing with what the button does to it', () => {
    const { container } = render(<SettingsView model={model()} {...wired()} />);

    for (const item of STORED_ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
    const dispositions = [...container.querySelectorAll('[data-fwm-settings-disposition]')].map(
      (node) => node.getAttribute('data-fwm-settings-disposition'),
    );
    expect(dispositions).toEqual(STORED_ITEMS.map((item) => item.disposition));
    // Evidence is kept on purpose, and the list says so before the button is
    // pressed rather than only in the report afterwards.
    expect(dispositions).toContain('kept');
  });

  it('repeats the promises the onboarding screen already made, unedited', () => {
    render(<SettingsView model={model()} {...wired()} />);

    for (const promise of PRIVACY_PROMISES) {
      expect(screen.getByText(promise)).toBeInTheDocument();
    }
  });
});

describe('the removal control', () => {
  it('arms before it commits, and offers a way out', () => {
    render(<SettingsView model={model()} {...wired()} />);
    expect(screen.getByRole('button', { name: REMOVAL_LABELS.idle })).toBeEnabled();
    expect(screen.queryByText(REMOVAL_WARNING)).toBeNull();
    expect(screen.queryByRole('button', { name: REMOVAL_CANCEL_LABEL })).toBeNull();

    render(<SettingsView model={model({ removalPhase: 'armed' })} {...wired()} />);
    expect(screen.getByRole('button', { name: REMOVAL_LABELS.armed })).toBeEnabled();
    expect(screen.getByText(REMOVAL_WARNING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REMOVAL_CANCEL_LABEL })).toBeEnabled();
  });

  it('cannot be pressed while it is working', () => {
    render(<SettingsView model={model({ removalPhase: 'working' })} {...wired()} />);

    expect(screen.getByRole('button', { name: REMOVAL_LABELS.working })).toBeDisabled();
  });

  it('shows the counted report, not a toast', () => {
    const lines = [
      '2 encrypted plates deleted',
      'encryption keys destroyed',
      '3 signed camera reports kept - deleting one breaks the chain for the rest. clear them separately.',
    ];
    render(<SettingsView model={model({ removalPhase: 'done', removalLines: lines })} {...wired()} />);

    const report = screen.getByRole('list', { name: 'what was removed' });
    for (const line of lines) {
      expect(within(report).getByText(line)).toBeInTheDocument();
    }
  });

  it('says why when nothing was removed', () => {
    const reason = 'nothing was removed: the local database could not be opened (TypeError)';
    render(
      <SettingsView
        model={model({ removalPhase: 'unavailable', removalReason: reason })}
        {...wired()}
      />,
    );

    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'what was removed' })).toBeNull();
  });
});

describe('honest states', () => {
  it('renders every control inert while the stored settings are still being read', () => {
    render(<SettingsView model={model({ ready: false })} />);

    expect(screen.getByText(HYDRATING_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'ALERT AT' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Vibration' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'theme mode' })).toBeDisabled();
    expect(screen.getByRole('button', { name: REMOVAL_LABELS.idle })).toBeDisabled();
  });

  it('admits it when a reload would lose these settings', () => {
    const reason = 'settings are held in memory for this session only';
    render(<SettingsView model={model({ durable: false, durabilityReason: reason })} {...wired()} />);

    expect(screen.getByText(reason)).toBeInTheDocument();
  });
});
