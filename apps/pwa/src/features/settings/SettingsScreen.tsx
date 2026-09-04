/**
 * SETTINGS, wired to the real stores, the real mode module and the real
 * removal path.
 *
 * SOURCE: no panel. `DESIGN-GAPS.md#no-settings-screen-exists` records that
 * `RADAR`'s header draws a `SET` key with nowhere to go and that no screen was
 * ever drawn for it. Option (1) in that entry is the one taken here: compose it
 * from the components the design system does ship --
 * `Flockys Design System.dc.html` section 04 (`BUTTONS`, `TOGGLE · SLIDER ·
 * CHIPS`, `CARD · LIST ROW`) and section 05 (`Theme modes`) -- plus the
 * privacy copy the screens already say out loud (`A1`, `03`, `W12`).
 * Everything invented rather than quoted is listed in
 * `docs/gaps-inbox/settings.md`.
 *
 * =============================================================================
 * THIS FILE IS WIRING
 * =============================================================================
 * It reads store selectors, resolves the mode through `app/mode.ts`, and calls
 * one port. It:
 *
 *   - computes no distance and no bearing. The only number it touches is the
 *     threshold, snapped by the engine's own snapper in `threshold.ts`.
 *   - requests no permission and starts no sensor. There is no `navigator`
 *     call on this path except the ones IndexedDB makes for the removal.
 *   - sends nothing anywhere. No fetch, no beacon, no analytics, no URL write.
 *   - shows no value it has not read back. Before the persisted blob has
 *     hydrated, every control renders disabled and the screen says it is still
 *     reading, rather than presenting the defaults as the driver's choices.
 *
 * =============================================================================
 * THE MODE IS APPLIED FROM HERE, AND THE WATCH RULE STILL WINS
 * =============================================================================
 * `main.tsx` applies `DEFAULT_MODE` before the first render and cannot read the
 * persisted preference -- it is the shell's file and it is not this feature's
 * to edit. So this screen reconciles the stored mode onto `<html>` while it is
 * open, through `applyMode()`, which is the ONLY function in the product that
 * writes `data-fwm-mode`, and which forces `night-watch` on a watch surface
 * itself. There is no code path here that puts `pursuit` on a wrist: this file
 * never writes the attribute, it asks `applyMode` to.
 * GAP: see docs/gaps-inbox/settings.md#stored-mode-is-not-applied-at-boot
 *
 * THE PICKER IS LOCKED BY THE SURFACE, NOT BY `ResolvedMode.reason`.
 * `resolveMode()` returns `reason: 'requested'` on a watch whose stored mode
 * already IS night-watch -- the default, and therefore every watch's first run.
 * Locking off that reason would leave all six rows live in exactly the most
 * common case, swallow the first press and still persist it. `isWatchSurface()`
 * is asked instead, and `onModePick` refuses the write as well as the paint.
 *
 * The surface itself is SUBSCRIBED to, not sampled once: a `MutationObserver`
 * on `data-fwm-surface` re-reads whatever `app/App.tsx` wrote, so a device that
 * becomes a watch mid-session locks the picker on the spot rather than at the
 * next mount.
 *
 * =============================================================================
 * REMOVAL: TWO PRESSES, ONE PATH, AND THE IN-MEMORY MIRROR GOES TOO
 * =============================================================================
 * The port is `removal.ts`, which calls `forgetLocalIdentity()` and nothing
 * else. On success this screen also calls `historyActions.reset()`, because the
 * trips and alerts the wipe removed from IndexedDB have an in-memory mirror in
 * the history slice, and a removal that leaves the driver's passes on the LOG
 * screen until the next reload has not removed them in any sense the driver
 * would recognise. The history slice's own comment says the durable copy is
 * cleared separately; this is the other half of that.
 *
 * The alert slice is deliberately NOT reset: it holds the live tick, and
 * blanking the distance to a camera that is currently in range would turn a
 * privacy action into a safety one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

import { applyMode, isWatchSurface, resolveMode } from '../../app/mode.ts';
import type { FwmMode } from '../../app/mode.ts';
import { applyTextScale } from '../../app/textScale.ts';
import type { TextScale } from '../../app/textScale.ts';
import type { Typeface } from '../../app/typeface.ts';
import type { FwmClear, FwmGlass, FwmGlassTone , FwmLiquid } from '../../app/glass.ts';
import type { FwmMapView } from '../../app/mapView.ts';
import type { FwmMapTilt } from '../../app/mapTilt.ts';
import { SURFACE_ATTRIBUTE, currentSurface } from '../../app/surface.ts';
import type { FwmSurface } from '../../app/surface.ts';
import {
  historyActions,
  useAlertThresholdFt,
  useAudioEnabled,
  useFwmMode,
  useTextScale,
  useTypeface,
  useGlass,
  useLiquid,
  useClear,
  useTone,
  useMapView,
  useMapTilt,
  useSettingsHydrated,
  useSettingsStore,
  useVibrationEnabled,
} from '../../stores';

import { SettingsView } from './components/SettingsView.tsx';
import type { SettingsViewModel, SettingsViewProps } from './components/SettingsView.tsx';
import type { RemovalPhase } from './components/RemovalControl.tsx';
import { removeLocalData } from './removal.ts';
import type { RemovalPort } from './removal.ts';

import './settings.css';

export interface SettingsScreenProps {
  /** The removal path. A test passes a fake; the app passes nothing. */
  readonly removalPort?: RemovalPort | undefined;
  /**
   * The surface to resolve the mode against. Defaults to whatever
   * `data-fwm-surface` currently says, which the shell keeps up to date.
   */
  readonly surface?: FwmSurface | null | undefined;
  /**
   * WHICH VIEW DRAWS THE MODEL.
   *
   * Everything hard about this screen is in the container: the hydration gate,
   * the watch rule, the surface observer, the two-press removal. v1 changes
   * none of it and all of the chrome, so it arrives as a second VIEW rather
   * than a second screen - `SettingsViewV1` takes the same model and the same
   * handlers. Defaults to v0's, so `SettingsScreen.test.tsx` is untouched.
   */
  readonly view?: ComponentType<SettingsViewProps> | undefined;
}

interface RemovalState {
  readonly phase: RemovalPhase;
  readonly lines: readonly string[];
  readonly reason: string | null;
}

const IDLE: RemovalState = Object.freeze({ phase: 'idle', lines: [], reason: null });

export function SettingsScreen({
  removalPort = removeLocalData,
  surface,
  view: View = SettingsView,
}: SettingsScreenProps = {}): ReactElement {
  // --- stored preferences --------------------------------------------------
  const hydrated = useSettingsHydrated();
  const thresholdFt = useAlertThresholdFt();
  const vibration = useVibrationEnabled();
  const audio = useAudioEnabled();
  const requestedMode = useFwmMode();
  const textScale = useTextScale();
  const typeface = useTypeface();
  const glass = useGlass();
  const liquid = useLiquid();
  const clear = useClear();
  const tone = useTone();
  const mapView = useMapView();
  const mapTilt = useMapTilt();
  const durable = useSettingsStore((state) => state.durable);
  const durabilityReason = useSettingsStore((state) => state.durabilityReason);

  // --- the surface, followed rather than re-decided -------------------------
  // `detectSurface()` WRITES the attribute, and a screen must not re-decide the
  // surface as a side effect of rendering -- so this reads `data-fwm-surface`
  // and then SUBSCRIBES to it. `app/App.tsx` is the one subscriber that
  // re-measures; when it writes a new surface this observer re-reads it, so a
  // phone that becomes a `watch-*` while SETTINGS is open cannot leave the
  // picker disagreeing with the document about which surface it is on.
  const [detectedSurface, setDetectedSurface] = useState<FwmSurface | null>(currentSurface);

  useEffect(() => {
    // An explicit prop wins and needs no observer: a test names its surface.
    if (surface !== undefined) return undefined;
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const root = document.documentElement;
    // Re-read on subscribe: the attribute may have moved between the first
    // render and this effect.
    setDetectedSurface(currentSurface());
    const observer = new MutationObserver(() => {
      setDetectedSurface(currentSurface());
    });
    observer.observe(root, { attributes: true, attributeFilter: [SURFACE_ATTRIBUTE] });
    return () => {
      observer.disconnect();
    };
  }, [surface]);

  // --- the mode, after the watch rule --------------------------------------
  const onSurface = surface === undefined ? detectedSurface : surface;
  const resolved = resolveMode(requestedMode, onSurface);

  // THE LOCK IS A PROPERTY OF THE SURFACE, NOT OF THE LAST REQUEST.
  // `resolveMode()` reports `reason: 'forced-watch'` only when the request
  // DIFFERED from night-watch. On a watch whose stored mode is already
  // night-watch -- which is `stores/settings.ts`'s default and therefore the
  // state of every watch on first run -- the reason is `'requested'`, and
  // reading the lock off it would leave all six rows live. The first press on
  // Pursuit would then be swallowed by `applyMode()`'s own watch rule AND
  // persisted into the settings blob from a wrist, with the row only going
  // inert after the doomed press. So the lock is asked of the surface.
  const modeLocked = isWatchSurface(onSurface);

  useEffect(() => {
    // `applyMode` is the only writer of `data-fwm-mode`, and it enforces the
    // watch rule itself. Re-running it on every change keeps the document in
    // step with the stored preference for as long as this screen is open.
    applyMode(requestedMode, onSurface);
  }, [requestedMode, onSurface]);

  // --- removal -------------------------------------------------------------
  const [removal, setRemoval] = useState<RemovalState>(IDLE);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const onRemovalPress = useCallback((): void => {
    // First press arms, second commits. Nothing is destroyed by one tap.
    if (removal.phase !== 'armed') {
      setRemoval({ phase: 'armed', lines: [], reason: null });
      return;
    }
    setRemoval({ phase: 'working', lines: [], reason: null });
    void removalPort().then(
      (outcome) => {
        if (!live.current) return;
        if (outcome.status === 'removed') {
          // The durable copy is gone; drop the in-memory mirror with it.
          historyActions.reset();
          setRemoval({ phase: 'done', lines: outcome.lines, reason: null });
          return;
        }
        setRemoval({ phase: 'unavailable', lines: [], reason: outcome.reason });
      },
      // The port already converts every failure into an outcome. This branch
      // exists so a throw from somewhere unexpected cannot leave the control
      // stuck on `Forgetting…` forever, claiming work that is not happening.
      () => {
        if (!live.current) return;
        setRemoval({
          phase: 'unavailable',
          lines: [],
          reason: 'nothing was removed: the removal did not complete',
        });
      },
    );
  }, [removal.phase, removalPort]);

  const onRemovalCancel = useCallback((): void => {
    setRemoval(IDLE);
  }, []);

  // --- writes --------------------------------------------------------------
  const onThresholdChange = useCallback((next: number): void => {
    useSettingsStore.getState().setThresholdFt(next);
  }, []);

  const onTypefacePick = useCallback((face: Typeface): void => {
    useSettingsStore.getState().setTypeface(face);
  }, []);

  /**
   * The store action is enough. `App`'s hydration effect already watches this
   * value and calls `applyGlass`, so the
   * attribute lands without this screen writing to the document.
   */
  const onGlassPick = useCallback((next: FwmGlass): void => {
    useSettingsStore.getState().setGlass(next);
  }, []);

  /** Same route as the frost pick: the store action, and App applies it. */
  const onLiquidPick = useCallback((next: FwmLiquid): void => {
    useSettingsStore.getState().setLiquid(next);
  }, []);

  const onClearPick = useCallback((next: FwmClear): void => {
    useSettingsStore.getState().setClear(next);
  }, []);

  const onTonePick = useCallback((next: FwmGlassTone): void => {
    useSettingsStore.getState().setTone(next);
  }, []);


  const onMapViewPick = useCallback((next: FwmMapView): void => {
    useSettingsStore.getState().setMapView(next);
  }, []);

  const onMapTiltPick = useCallback((next: FwmMapTilt): void => {
    useSettingsStore.getState().setMapTilt(next);
  }, []);

  const onVibrationChange = useCallback((on: boolean): void => {
    useSettingsStore.getState().setVibration(on);
  }, []);

  const clusterCameras = useSettingsStore((state) => state.clusterCameras);
  const headingUpMap = useSettingsStore((state) => state.headingUpMap);

  const onClusterCamerasChange = useCallback((on: boolean): void => {
    useSettingsStore.getState().setClusterCameras(on);
  }, []);

  const onHeadingUpMapChange = useCallback((on: boolean): void => {
    useSettingsStore.getState().setHeadingUpMap(on);
  }, []);

  const onAudioChange = useCallback((on: boolean): void => {
    useSettingsStore.getState().setAudio(on);
  }, []);

  const onModePick = useCallback(
    (mode: FwmMode): void => {
      // Second line of defence behind the inert rows: no press reachable from a
      // wrist may reach the persisted preference. `applyMode()` already refuses
      // to WRITE a phone skin to `<html>` on a watch, but it cannot stop the
      // store from remembering one.
      if (isWatchSurface(onSurface)) return;
      // Store first, then apply. `applyMode` re-runs from the effect above; the
      // direct call is what makes the skin change on the press rather than one
      // paint later.
      useSettingsStore.getState().setMode(mode);
      applyMode(mode, onSurface);
    },
    [onSurface],
  );

  const onTextScalePick = useCallback((scale: TextScale): void => {
    // Same order as the mode: store first, then apply directly, so the type
    // resizes under the driver's finger rather than one paint later. The
    // effect that watches the store re-applies it on every later render, and
    // on the next cold start.
    useSettingsStore.getState().setTextScale(scale);
    applyTextScale(scale);
  }, []);

  const model: SettingsViewModel = useMemo(
    () => ({
      ready: hydrated,
      thresholdFt,
      vibration,
      clusterCameras,
      headingUpMap,
      audio,
      mode: resolved.mode,
      modeForced: modeLocked,
      textScale,
      typeface,
      glass,
      liquid,
      clear,
      tone,
      mapView,
      mapTilt,
      durable,
      durabilityReason,
      removalPhase: removal.phase,
      removalLines: removal.lines,
      removalReason: removal.reason,
    }),
    [
      hydrated,
      thresholdFt,
      vibration,
      audio,
      resolved,
      modeLocked,
      textScale,
      typeface,
      glass,
      liquid,
      clear,
      tone,
      mapView,
      mapTilt,
      durable,
      durabilityReason,
      removal,
    ],
  );

  // Until the stored blob has been read back, every control is inert: the
  // values on screen are defaults, not choices, and writing over a preference
  // that is still in flight would silently discard it.
  if (!hydrated) return <View model={model} />;

  return (
    <View
      model={model}
      onThresholdChange={onThresholdChange}
      onVibrationChange={onVibrationChange}
      onClusterCamerasChange={onClusterCamerasChange}
      onHeadingUpMapChange={onHeadingUpMapChange}
      onAudioChange={onAudioChange}
      onModePick={onModePick}
      onTextScalePick={onTextScalePick}
      onTypefacePick={onTypefacePick}
      onGlassPick={onGlassPick}
      onLiquidPick={onLiquidPick}
      onClearPick={onClearPick}
      onTonePick={onTonePick}
      onMapViewPick={onMapViewPick}
      onMapTiltPick={onMapTiltPick}
      onRemovalPress={onRemovalPress}
      onRemovalCancel={onRemovalCancel}
    />
  );
}
