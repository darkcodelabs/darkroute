/**
 * The INTEL CARD, wired to the real stores and to the real engine output shape.
 *
 * Nothing here renders a hand-built view model. Every assertion goes through
 * the same path the driving loop uses -- `positionActions.ingestFix()` and
 * `ingestAlertTick()` -- so a card that agreed with a mock and disagreed with
 * the engine would fail here.
 *
 * The three ports (the pending-action queue, the share sheet, the clipboard)
 * are injected. None of them is faked into doing something the real one cannot:
 * the queue writes and reports whether it wrote, the share adapter returns one
 * of the four statuses `share.ts` defines, and the clipboard returns a boolean.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FACT_LABELS } from './intelState.ts';

import {
  alertActions,
  camerasActions,
  historyActions,
  ingestAlertTick,
  isCameraMutedAt,
  positionActions,
  resetAllStores,
  useCamerasStore,
  useNavigationStore,
  useSettingsStore,
} from '../../stores';
import type { AlertState, AlertTick, CameraAssessment, TileEntry } from '../../stores';
import type { ClipboardAdapter } from '../../services/adapters/clipboard.ts';
import type { ShareAdapter, SharePayload } from '../../services/adapters/share.ts';
import { NO_VALUE } from '../radar';

import { INTEL_OVERLAY, IntelScreen, closeIntelCard, openIntelCard } from './IntelScreen.tsx';
import { IntelV1Screen } from './IntelV1Screen.tsx';
import type { IntelQueuePort, IntelStatement } from './intelActions.ts';

const NOW = 1_760_000_000_000;
const now = (): number => NOW;
const CAMERA = 'FWM-0442';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari';

/** The camera A4 is about: 425 ft off, facing 223 degrees, HOA-owned. */
function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: CAMERA,
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 223,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 223,
    inRange: true,
    muted: false,
    mergedIds: [CAMERA],
    ...over,
  };
}

function tick(over: Partial<AlertTick> = {}): AlertTick {
  const nearest = over.nearest === undefined ? assessment() : over.nearest;
  const state: AlertState = over.state ?? 'in_range';
  return {
    timestampMs: NOW,
    state,
    previousState: 'clear',
    changed: true,
    nearest,
    cameras: nearest === null ? [] : [nearest],
    countInRange: 1,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: true,
    hapticPulses: 2,
    notifyCameraIds: [CAMERA],
    suppressedBy: [],
    ...over,
  };
}

/** One cached tile carrying the record fields the card can honestly render. */
function tile(): TileEntry {
  return {
    ref: { z: 14, x: 4_314, y: 6_320 },
    cameras: [
      {
        id: CAMERA,
        lat: 39.1,
        lon: -84.58,
        directionDeg: 223,
        ownerType: 'hoa',
        confirmations: 28,
      },
    ],
    fetchedAtMs: NOW,
    freshness: 'fresh',
    source: 'network',
  };
}

function lock(): void {
  positionActions.ingestFix({
    lat: 39.0997,
    lon: -84.5786,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: 21,
    headingDeg: 41,
    timestamp: NOW,
  });
}

/** A live camera, a cached record for it, and the card open on it. */
function openOn(camera = CAMERA): void {
  lock();
  camerasActions.putTile(tile());
  ingestAlertTick(tick());
  camerasActions.selectCamera(camera);
}

interface FakeQueue extends IntelQueuePort {
  readonly writes: { kind: IntelStatement; cameraId: string; atMs: number }[];
}

function fakeQueue(succeeds = true): FakeQueue {
  const writes: { kind: IntelStatement; cameraId: string; atMs: number }[] = [];
  return {
    writes,
    queue: (kind, cameraId, atMs) => {
      writes.push({ kind, cameraId, atMs });
      return Promise.resolve(succeeds);
    },
    close: () => undefined,
  };
}

function fakeShare(
  status: 'shared' | 'cancelled' | 'unsupported' | 'failed',
  sent: SharePayload[],
): ShareAdapter {
  return {
    name: 'share',
    capability: () => ({ supported: status !== 'unsupported' }),
    start: () => undefined,
    stop: () => undefined,
    canShare: () => status !== 'unsupported',
    share: (payload) => {
      sent.push(payload);
      return Promise.resolve({
        kind: payload.kind,
        status,
        withFiles: false,
        timestamp: NOW,
      });
    },
    current: () => null,
    error: () => null,
    subscribe: () => () => undefined,
  };
}

function fakeClipboard(ok: boolean, writes: { kind: string; text: string }[]): ClipboardAdapter {
  return {
    name: 'clipboard',
    capability: () => ({ supported: ok }),
    permission: () => Promise.resolve('granted'),
    start: () => undefined,
    stop: () => undefined,
    writeText: (kind, text) => {
      writes.push({ kind, text });
      return Promise.resolve(ok);
    },
    current: () => null,
    error: () => null,
    subscribe: () => () => undefined,
  };
}

beforeEach(() => {
  resetAllStores();
});

afterEach(() => {
  resetAllStores();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('wiring', () => {
  it("renders the engine's distance and the record's owner and facing", () => {
    openOn();

    const { container } = render(<IntelScreen now={now} queue={null} share={null} clipboard={null} />);

    expect(container.querySelector('[data-fwm-intel-readout="true"]')?.textContent).toBe(
      '425 FT · SW',
    );
    expect(container.querySelector('[data-fwm-intel-tile="OWNER"]')?.textContent).toContain('HOA');
    expect(container.querySelector('[data-fwm-intel-tile="FACING"]')?.textContent).toContain('223°');
    expect(container.querySelector('[data-fwm-intel-fact="CONFIRMED BY"]')?.textContent).toContain(
      '28 HAKCERS',
    );
  });

  it('takes the alert hue from the engine, not from the card', () => {
    openOn();
    const { container } = render(<IntelScreen now={now} queue={null} />);
    expect(container.querySelector('.fwm-intel')?.getAttribute('data-fwm-intel-state')).toBe(
      'in_range',
    );
  });

  it('counts the driver own passes of this camera out of the alert log', () => {
    openOn();
    historyActions.record({
      cameraId: CAMERA,
      atMs: NOW - 60_000,
      state: 'in_range',
      previousState: 'clear',
      muted: false,
    });
    historyActions.record({
      cameraId: CAMERA,
      atMs: NOW - 120_000,
      state: 'in_range',
      previousState: 'clear',
      muted: true,
    });

    const { container } = render(<IntelScreen now={now} queue={null} />);
    // Three: the two recorded above plus the entry-into-range the tick above
    // wrote through `ingestAlertTick`. The muted one counts like any other --
    // muting removes the alert, never the record.
    expect(container.querySelector('[data-fwm-intel-fact="YOUR READS"]')?.textContent).toContain(
      '3 THIS SESSION',
    );
  });

  it('says nothing is selected rather than drawing a camera it was not given', () => {
    render(<IntelScreen now={now} queue={null} />);
    expect(screen.getByText(/NO CAMERA SELECTED/)).toBeInTheDocument();
  });

  it('renders a cached record with no live measurement without claiming an alert', () => {
    camerasActions.putTile(tile());
    camerasActions.selectCamera(CAMERA);

    const { container } = render(<IntelScreen now={now} queue={null} />);
    expect(container.querySelector('[data-fwm-intel-readout="true"]')?.textContent).toContain(
      NO_VALUE,
    );
    expect(container.querySelector('.fwm-intel')?.getAttribute('data-fwm-intel-state')).not.toBe(
      'in_range',
    );
  });
});

// ---------------------------------------------------------------------------
// CONFIRM / DISPUTE
// ---------------------------------------------------------------------------

describe('confirm and dispute', () => {
  it('queues a confirmation against this camera and says it was queued, not sent', async () => {
    openOn();
    const queue = fakeQueue();

    render(<IntelScreen now={now} queue={queue} />);
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM STILL THERE' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('CONFIRMATION QUEUED');
    });
    expect(queue.writes).toEqual([{ kind: 'confirm_camera', cameraId: CAMERA, atMs: NOW }]);
  });

  it('queues a dispute under its own kind', async () => {
    openOn();
    const queue = fakeQueue();

    render(<IntelScreen now={now} queue={queue} />);
    fireEvent.click(screen.getByRole('button', { name: 'DISPUTE' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('DISPUTE QUEUED');
    });
    expect(queue.writes[0]?.kind).toBe('dispute_camera');
  });

  it('says it was not queued rather than pretending it was', async () => {
    openOn();

    render(<IntelScreen now={now} queue={fakeQueue(false)} />);
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM STILL THERE' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('NOT QUEUED');
    });
  });

  it('disables both statements when there is nowhere to queue them', () => {
    openOn();
    render(<IntelScreen now={now} queue={null} />);
    expect(screen.getByRole('button', { name: 'CONFIRM STILL THERE' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DISPUTE' })).toBeDisabled();
  });

  it('does not carry the previous camera outcome onto the next card', async () => {
    openOn();
    const queue = fakeQueue();
    render(<IntelScreen now={now} queue={queue} />);
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM STILL THERE' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    act(() => {
      camerasActions.selectCamera('FWM-0118');
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MUTE
// ---------------------------------------------------------------------------

describe('mute this one', () => {
  it('silences this camera without removing it from anything', () => {
    openOn();
    const { container } = render(<IntelScreen now={now} queue={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));

    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The card is still the same card: every fact, tile and action survives.
    // Counted off FACT_LABELS rather than a literal -- the point of the
    // assertion is that muting removes NOTHING, not how many rows there are,
    // and a literal here fails every time a row is added for an unrelated
    // reason.
    expect(container.querySelectorAll('[data-fwm-intel-fact]')).toHaveLength(
      FACT_LABELS.length,
    );
    expect(container.querySelector('[data-fwm-intel-tile="OWNER"]')?.textContent).toContain('HOA');
    // And the engine still knows about it.
    expect(useCamerasStore.getState().assessments).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('STILL DRAWN, STILL COUNTED');
  });

  // -------------------------------------------------------------------------
  // THE KEY SETS A TIMER. THE CARD HAS TO SAY SO.
  // -------------------------------------------------------------------------

  it('draws the ten minutes the mute actually lasts', () => {
    openOn();
    const { container } = render(<IntelScreen now={now} queue={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));

    // `DEFAULT_MUTE_DURATION_MS` -- "long-press = mute 10 min". The number is
    // read back off the timer the press wrote, so the two cannot disagree.
    expect(container.querySelector('[data-fwm-intel-note="mute"]')?.textContent).toBe(
      'MUTED 10:00 · STILL DRAWN, STILL COUNTED',
    );
    expect(isCameraMutedAt(useSettingsStore.getState(), CAMERA, NOW + 600_001)).toBe(false);
  });

  it('counts the mute down as the drive goes on', () => {
    openOn();
    const { container, rerender } = render(<IntelScreen now={now} queue={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));

    rerender(<IntelScreen now={() => NOW + 108_000} queue={null} />);
    expect(container.querySelector('[data-fwm-intel-note="mute"]')?.textContent).toBe(
      'MUTED 8:12 · STILL DRAWN, STILL COUNTED',
    );
  });

  it('un-presses the key when the timer lapses, because the camera alerts again', () => {
    // The mute is not a latch. Ten minutes after the press it expires on its
    // own and this camera starts alerting again -- so the key it was pressed
    // on cannot still be reading as pressed.
    openOn();
    const { container, rerender } = render(<IntelScreen now={now} queue={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));
    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    rerender(<IntelScreen now={() => NOW + 600_001} queue={null} />);

    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(container.querySelector('[data-fwm-intel-note="mute"]')).toBeNull();
    expect(container.textContent).not.toContain('MUTED');
  });

  it('re-mutes rather than un-muting when the key is pressed after the timer lapsed', () => {
    openOn();
    const { rerender } = render(<IntelScreen now={now} queue={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));

    const later = NOW + 600_001;
    rerender(<IntelScreen now={() => later} queue={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));

    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(isCameraMutedAt(useSettingsStore.getState(), CAMERA, later + 1)).toBe(true);
  });

  it('un-silences it from the same key', () => {
    openOn();
    render(<IntelScreen now={now} queue={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));
    fireEvent.click(screen.getByRole('button', { name: 'MUTE THIS ONE' }));

    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('does not show a global mute as this camera being muted', () => {
    openOn();
    act(() => {
      alertActions.muteAll(NOW);
    });

    render(<IntelScreen now={now} queue={null} />);
    expect(screen.getByRole('button', { name: 'MUTE THIS ONE' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

// ---------------------------------------------------------------------------
// SHARE and the camera id
// ---------------------------------------------------------------------------

describe('share and copy', () => {
  it('shares the camera and never the driver, and never invents a link', async () => {
    openOn();
    const sent: SharePayload[] = [];

    render(<IntelScreen now={now} queue={null} share={fakeShare('shared', sent)} />);
    fireEvent.click(screen.getByRole('button', { name: 'SHARE' }));

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    const payload = sent[0];
    expect(payload?.kind).toBe('camera-intel');
    // `share.ts` refuses to construct an origin and this build has none.
    expect(payload?.url).toBeUndefined();
    expect(payload?.text).toContain(CAMERA);
    expect(payload?.text).toContain('OWNER: HOA');
    // Once. The id is promoted into the title on every record this build
    // holds, so a headline of `title · cameraId` printed it twice.
    expect(payload?.text?.match(new RegExp(CAMERA, 'g'))).toHaveLength(1);
    expect(payload?.text?.split('\n')[0]).toBe(CAMERA);
    expect(payload?.text).not.toContain('YOUR READS');
    expect(payload?.text).not.toContain('39.0997');
  });

  it('says sharing is unavailable rather than failing silently', async () => {
    openOn();
    render(<IntelScreen now={now} queue={null} share={fakeShare('unsupported', [])} />);
    fireEvent.click(screen.getByRole('button', { name: 'SHARE' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('SHARING IS NOT AVAILABLE');
    });
  });

  it('treats a dismissed share sheet as the user saying no, not as a failure', async () => {
    openOn();
    render(<IntelScreen now={now} queue={null} share={fakeShare('cancelled', [])} />);
    fireEvent.click(screen.getByRole('button', { name: 'SHARE' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('copies the camera id under the clipboard kind that exists for it', async () => {
    openOn();
    const writes: { kind: string; text: string }[] = [];

    render(<IntelScreen now={now} queue={null} clipboard={fakeClipboard(true, writes)} />);
    fireEvent.click(screen.getByRole('button', { name: `copy camera id ${CAMERA}` }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('CAMERA ID COPIED');
    });
    expect(writes).toEqual([{ kind: 'camera-id', text: CAMERA }]);
  });

  it('never puts anything but the camera id on the clipboard', async () => {
    openOn();
    const writes: { kind: string; text: string }[] = [];

    render(<IntelScreen now={now} queue={null} clipboard={fakeClipboard(true, writes)} />);
    fireEvent.click(screen.getByRole('button', { name: `copy camera id ${CAMERA}` }));

    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]?.text).toBe(CAMERA);
    expect(writes[0]?.text).not.toContain('39.');
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe('privacy', () => {
  it('offers no maps key on an iPhone in the shipped v1 card', () => {
    vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
    openOn();

    render(<IntelV1Screen />);

    expect(screen.getByRole('heading', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show it in maps/i })).toBeNull();
  });

  it('puts no coordinate anywhere in the rendered card', () => {
    openOn();
    const { container } = render(<IntelScreen now={now} queue={null} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('39.0997');
    expect(text).not.toContain('84.5786');
    expect(text).not.toContain('39.1');
  });

  it('writes nothing to the URL when the card is opened', () => {
    const before = window.location.search;
    openOn();
    render(<IntelScreen now={now} queue={null} />);
    expect(window.location.search).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The SWEEP bridge
// ---------------------------------------------------------------------------

describe('opening the card from a SWEEP dot', () => {
  it('raises a modal that carries an id and a kind, and no payload', () => {
    openIntelCard(CAMERA);

    const overlays = useNavigationStore.getState().overlays;
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toEqual(INTEL_OVERLAY);
    expect(overlays[0]?.kind).toBe('modal');
    // The camera lives in the cameras slice; the overlay never carries it.
    expect(Object.keys(overlays[0] ?? {})).toEqual(['id', 'kind']);
    expect(useCamerasStore.getState().selectedCameraId).toBe(CAMERA);
  });

  it('never writes a camera id into the URL', () => {
    openIntelCard(CAMERA);
    expect(window.location.search).not.toContain(CAMERA);
    expect(window.location.href).not.toContain(CAMERA);
  });

  it('closes the modal and forgets which camera it was about', () => {
    openIntelCard(CAMERA);
    closeIntelCard();

    expect(useNavigationStore.getState().overlays).toHaveLength(0);
    expect(useCamerasStore.getState().selectedCameraId).toBeNull();
  });
});
