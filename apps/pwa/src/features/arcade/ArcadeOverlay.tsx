/**
 * PEW -- the arena. A framed glass card in the alert band, over the map.
 *
 * =============================================================================
 * WHAT THIS IS
 * =============================================================================
 * The owner's ask: "a mini game kinda like asteroids where if you were near a
 * camera you could pewpew at it or something." This is the surface. The dock
 * offers a key when `offer.ts` says a reader is near and the car is parked;
 * the key raises this overlay; the overlay lays the readers around the car
 * out as rocks and lets the driver shoot them for a minute.
 *
 * IT IS UNMISTAKABLY A TOY. A framed card with a HUD pill and a red close key,
 * inside the same insets the alert card uses -- `top: --fwm-drive-row-2`,
 * `bottom: --fwm-dock-h` -- so the search bar stays above it and the dock stays
 * live below it. A transparent layer over the live map that swallowed map taps
 * was considered and rejected: it would look like the map and behave
 * differently.
 *
 * =============================================================================
 * WHAT IT NEVER DOES
 * =============================================================================
 * Nothing leaves the phone and nothing is written down. A hit does not call
 * `historyActions`, `camerasActions.selectCamera`, `alertActions`, the
 * settings, the route, the map, `navigator.vibrate` (the vibration adapter
 * would throw), speech or fetch. This directory imports nothing from
 * `services/` and nothing from `stores/persist.ts`. The score is a module
 * `let` in `score.ts` with no camera id anywhere near it.
 *
 * It never costs a driver an alert. `useArcadeStandDown.ts` says how, in
 * three layers; the short version is that the alert engine empties the overlay
 * stack before the alert paints, so this component is gone before the warning
 * is on the glass, and the dock underneath was never covered.
 *
 * =============================================================================
 * THE FIELD IS CAPTURED ONCE
 * =============================================================================
 * The readers, the heading and the seed are read when a round is created and
 * not again. A GPS wobble that moved a rock a player was aiming at would be a
 * worse game and a subtler lie; the arena is a picture of the moment the key
 * was pressed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import { useOverlayDismiss } from '../../components/overlay/useOverlayDismiss.ts';
import { findCamera, useCamerasStore } from '../../stores/cameras.ts';
import { navigationActions, useNavigationStore } from '../../stores/navigation.ts';
import type { Overlay } from '../../stores/navigation.ts';
import { usePositionStore } from '../../stores/position.ts';
import { DockIcon } from '../dock/icons.tsx';
import { detourCameras, ownerOf } from '../dock/useDockState.ts';
import { OWNER_WORD, readArcadePalette } from './palette.ts';
import { noteRound, sessionBestHits } from './score.ts';
import { createRound, remainingS, shoot } from './sim.ts';
import type { ArcadeReader, RoundState } from './sim.ts';
import { pointToArena, useArcadeLoop } from './useArcadeLoop.ts';
import { useArcadeStandDown } from './useArcadeStandDown.ts';

import './arcade.css';

/* ------------------------------------------------------------------------ *
 * THE OVERLAY
 * ------------------------------------------------------------------------ */

/**
 * `modal`, not `sheet`: it takes the band and it is either open or it is not.
 * The id is not a screen id and nothing deep-links here -- a round exists for
 * as long as the fix it was laid out from is current, like the detour offer.
 */
export const ARCADE_OVERLAY: Overlay = Object.freeze({ id: 'arcade', kind: 'modal' });

/** Raise the arena. A second press while it is up is a no-op, not a second overlay. */
export function openArcade(): void {
  if (useNavigationStore.getState().topOverlay?.id === ARCADE_OVERLAY.id) return;
  navigationActions.openOverlay(ARCADE_OVERLAY);
}

/** Put it away. The round is forfeited; there is nothing to save. */
export function closeArcade(): void {
  navigationActions.closeOverlay(ARCADE_OVERLAY.id);
}

export const ARCADE_CLOSE_LABEL = 'Close pew';
export const ARCADE_AGAIN_LABEL = 'Again';
export const ARCADE_END_CLOSE_LABEL = 'Close';
export const ARCADE_CANVAS_LABEL = 'Pew arena. Tap to aim and fire.';

/* ------------------------------------------------------------------------ *
 * THE ROUND, FROM THE STORES
 * ------------------------------------------------------------------------ */

/** The two-mile set, as the field's own shape. Read once per round. */
function readersNow(): readonly ArcadeReader[] {
  const cameras = useCamerasStore.getState();
  return detourCameras(cameras.assessments).map((assessment) => {
    const record = findCamera(cameras, assessment.id) ?? null;
    return {
      id: assessment.id,
      distanceFt: assessment.distanceFt,
      bearingDeg: assessment.bearingDeg,
      inRange: assessment.inRange,
      owner: ownerOf(record, record?.ownerType),
    };
  });
}

function newRound(): RoundState {
  const palette = readArcadePalette();
  return createRound(readersNow(), usePositionStore.getState().headingDeg, Date.now() & 0x7fffffff, {
    cadenceS: palette.cadenceS,
    burstS: palette.burstS,
  });
}

/**
 * THE ROUND ON SCREEN, observable. For tests, which need to see that a tap put
 * one shot in the air; nothing in the app reads it.
 */
let liveRound: RoundState | null = null;
export function liveArcadeRound(): RoundState | null {
  return liveRound;
}

/* ------------------------------------------------------------------------ *
 * THE HUD
 * ------------------------------------------------------------------------ */

interface Hud {
  readonly secondsLeft: number;
  readonly hits: number;
  readonly owner: RoundState['lastHitOwner'];
  readonly over: RoundState['over'];
}

function hudOf(round: RoundState | null): Hud {
  if (round === null) return { secondsLeft: 0, hits: 0, owner: null, over: null };
  return {
    secondsLeft: remainingS(round),
    hits: round.hits,
    owner: round.lastHitOwner,
    over: round.over,
  };
}

function sameHud(a: Hud, b: Hud): boolean {
  return a.secondsLeft === b.secondsLeft && a.hits === b.hits && a.owner === b.owner && a.over === b.over;
}

/** `0:42`. */
export function clockLabel(secondsLeft: number): string {
  const total = Math.max(0, Math.floor(secondsLeft));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/** `3 hits`, `1 hit`. */
export function hitsLabel(hits: number): string {
  return hits === 1 ? '1 hit' : `${String(hits)} hits`;
}

/* ------------------------------------------------------------------------ *
 * THE COMPONENT
 * ------------------------------------------------------------------------ */

export function ArcadeOverlay(): ReactElement {
  /** Escape, the close key and the end card's Close all land here. */
  const dismiss = useOverlayDismiss(closeArcade);
  const down = useArcadeStandDown(closeArcade);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /* Laid out once, at mount, unless the mount check already failed -- a round
     that is about to be closed lays out nothing. */
  const [round, setRound] = useState<RoundState | null>(() => (down ? null : newRound()));
  const [hud, setHud] = useState<Hud>(() => hudOf(round));
  const shownHud = useRef(hud);
  const noted = useRef(false);

  useEffect(() => {
    liveRound = round;
    return (): void => {
      liveRound = null;
    };
  }, [round]);

  const onFrame = useCallback((current: RoundState): void => {
    const next = hudOf(current);
    if (!sameHud(next, shownHud.current)) {
      shownHud.current = next;
      setHud(next);
    }
    if (current.over !== null && !noted.current) {
      noted.current = true;
      noteRound(current.hits);
    }
  }, []);

  const active = !down && round !== null && round.over === null;
  useArcadeLoop({ canvasRef, round, active, onFrame });

  const onTap = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (round === null || round.over !== null) return;
      const at = pointToArena(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
      shoot(round, at.x, at.y);
    },
    [round],
  );

  const again = useCallback((): void => {
    noted.current = false;
    const fresh = newRound();
    shownHud.current = hudOf(fresh);
    setHud(shownHud.current);
    setRound(fresh);
  }, []);

  return (
    <div className="fwm-arcade" data-fwm-arcade={round === null ? 'closing' : hud.over ?? 'live'}>
      <div className="fwm-arcade-frame">
        {round === null ? null : (
          <canvas
            ref={canvasRef}
            className="fwm-arcade-canvas"
            aria-label={ARCADE_CANVAS_LABEL}
            onPointerDown={onTap}
          />
        )}

        {/* THE HUD. Clock, hits, and the class of the last reader hit -- the
            word beside the colour, so hue never travels alone. Polite: it is
            read when the reader is idle, never over anything else. */}
        {round !== null && hud.over === null ? (
          <div className="fwm-arcade-hud" role="status" aria-live="polite">
            <span className="fwm-arcade-hud-clock">{clockLabel(hud.secondsLeft)}</span>
            <span className="fwm-arcade-hud-sep" aria-hidden="true">
              ·
            </span>
            <span>{hitsLabel(hud.hits)}</span>
            {hud.owner === null ? null : (
              <>
                <span className="fwm-arcade-hud-sep" aria-hidden="true">
                  ·
                </span>
                <span className="fwm-arcade-hud-dot" data-fwm-owner={hud.owner} aria-hidden="true" />
                <span>{OWNER_WORD[hud.owner]}</span>
              </>
            )}
          </div>
        ) : null}

        {/* THE END CARD. Replaces the pill. `Again` is one tap. */}
        {round !== null && hud.over !== null ? (
          <div className="fwm-arcade-end" role="status">
            <div className="fwm-arcade-end-card">
              <p className="fwm-arcade-end-line">
                Round over · {hitsLabel(hud.hits)} · best this session {String(sessionBestHits())}
              </p>
              <div className="fwm-arcade-end-keys">
                <button type="button" className="fwm-arcade-end-key" onClick={again}>
                  {ARCADE_AGAIN_LABEL}
                </button>
                <button type="button" className="fwm-arcade-end-key" onClick={dismiss}>
                  {ARCADE_END_CLOSE_LABEL}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* THE CLOSE KEY, IN THE END COLOUR. It throws the round away, which is
            what `dock.css` paints in `--fwm-alert-in-range` on the one End key
            in the navigation family. */}
        <button
          type="button"
          className="fwm-arcade-close"
          aria-label={ARCADE_CLOSE_LABEL}
          onClick={dismiss}
        >
          <DockIcon name="close" size={20} />
        </button>
      </div>
    </div>
  );
}
