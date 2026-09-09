/**
 * SURFACE DETECTION - one entry point picks the layout.
 *
 * "Layout keys off [data-fwm-surface], never off UA alone. Same bundle, same
 *  tokens, four layouts: phone · watch-round · watch-square · dash."
 * - Flockys Design System.dc.html, section 06
 *
 * WHY THAT SENTENCE IS A RULE AND NOT A PREFERENCE
 *   A user-agent string is a claim, not a measurement. It is spoofable, it is
 *   frozen in Chrome, it says nothing about a foldable that just unfolded, and
 *   an Android head unit reports a phone UA. So the UA test below is only one
 *   of three inputs, and every *stylesheet* in this product selects on
 *   `[data-fwm-surface]` - never on a UA sniff, never on a bare width query
 *   that would disagree with what this module decided. There is exactly one
 *   place that decides which surface we are on, and it is `detectSurface()`.
 *
 *   The corollary: this value can change without a reload. A phone rotated
 *   into landscape on a 700px-wide foldable becomes `dash`. `watchSurface()`
 *   re-runs detection on resize and on orientation change so the attribute
 *   never lies about the current viewport.
 *
 * WHAT THIS MODULE NEVER DOES
 *   It never writes a class, a style, a token or a mode. It writes exactly one
 *   attribute. Anything else that keys off the surface reads the attribute.
 */

/** The four layouts. Nothing else is a surface. */
export const FWM_SURFACES = ['phone', 'watch-round', 'watch-square', 'dash'] as const;

export type FwmSurface = (typeof FWM_SURFACES)[number];

/**
 * The fallback when there is no DOM to measure - a unit test in a bare node
 * runtime, or a server render. `phone` is the primary surface and the only
 * honest default: claiming `watch` or `dash` without a viewport would put a
 * driver on a layout their device cannot show.
 */
export const FALLBACK_SURFACE: FwmSurface = 'phone';

/** The attribute every stylesheet selects on. Exported so tests name it once. */
export const SURFACE_ATTRIBUTE = 'data-fwm-surface';

/** `dataset` key form of {@link SURFACE_ATTRIBUTE}. */
const SURFACE_DATASET_KEY = 'fwmSurface';

export function isFwmSurface(value: unknown): value is FwmSurface {
  return typeof value === 'string' && (FWM_SURFACES as readonly string[]).includes(value);
}

/**
 * True when this runtime can actually be measured. Checked before the snippet
 * runs, because the snippet reads `navigator`, `matchMedia`, `screen` and
 * `document` unguarded - as it should: it is a browser snippet.
 */
function measurable(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement !== null &&
    typeof navigator !== 'undefined' &&
    typeof matchMedia === 'function' &&
    typeof screen !== 'undefined'
  );
}

/**
 * The section 06 snippet, reproduced from
 * "Flockys Design System.dc.html", panel
 * "SURFACE DETECTION - ONE ENTRY POINT PICKS THE LAYOUT".
 *
 * ONE DEVIATION, AND ONLY ONE. The design writes the last assignment as
 *
 *     document.documentElement.dataset.fwmSurface = …
 *
 * `tsconfig.base.json` sets `noPropertyAccessFromIndexSignature`, and
 * `DOMStringMap` is an index signature, so TypeScript rejects the dotted form
 * with TS4111 and demands `dataset['fwmSurface']`. That is a syntax
 * requirement of the compiler, not a change to the logic: same object, same
 * key, same value. Every other character below - the regex, the three media
 * queries, the `screen.width === screen.height` fallback for round, the
 * 700px/landscape dash test and the nesting of the ternaries - is the design's.
 *
 * The `// prettier-ignore` directives keep the design's own line breaks and
 * comment alignment intact. Prettier would otherwise unfold the ternary chain
 * and re-indent the media queries, which changes nothing semantically but does
 * mean this block would no longer be a copy of the design source that a
 * reviewer can diff by eye. They are formatting directives, not code.
 */
function runSection06Snippet(): string {
  // --- BEGIN section 06 snippet ------------------------------------------
  const ua = navigator.userAgent;
  // prettier-ignore
  const watch =
    /Wear OS|Watch|WatchOS/i.test(ua) ||          // declared wearable
    matchMedia('(max-width: 320px) and (max-height: 420px)').matches ||
    matchMedia('(display-mode: standalone) and (max-width: 300px)').matches;
  // prettier-ignore
  const round = matchMedia('(shape: round)').matches ||   // Wear OS round
                screen.width === screen.height;
  // prettier-ignore
  document.documentElement.dataset[SURFACE_DATASET_KEY] =
    watch ? (round ? 'watch-round' : 'watch-square')
          : matchMedia('(min-width: 700px) and (orientation: landscape)').matches
            ? 'dash' : 'phone';
  // --- END section 06 snippet --------------------------------------------

  return document.documentElement.dataset[SURFACE_DATASET_KEY] ?? FALLBACK_SURFACE;
}

/**
 * THE OVERRIDE, AND WHY ONE EXISTS AT ALL.
 *
 * Detection measures the viewport, and the viewport is the truth right up until
 * the OS refuses to give the browser the rotation. A phone with Portrait Lock
 * on, mounted sideways in a car, reports a TALL viewport while it is physically
 * WIDE - `matchMedia('(orientation: landscape)')` is false, section 06 rules
 * `phone`, and the driver stares at a portrait layout on a landscape screen
 * with no way to argue. Same for a head unit that reports a phone-sized
 * viewport, and for anyone who simply wants the wide layout on a tablet held
 * upright.
 *
 * So the override is a DRIVER'S DECLARATION, not a second detector. It does not
 * measure anything, it cannot be inferred, and nothing sets it but a control
 * the driver pressed. `detectSurface` still runs - the attribute still gets
 * written, the watcher still fires - but the answer is the declared one.
 *
 * IT STAYS IN THIS MODULE for the reason the header gives: there is exactly one
 * place that decides which surface we are on. An override applied anywhere else
 * would be a second decider, and `App` and `ShellDock` would disagree about the
 * layout for exactly as long as it took the two to re-render.
 */
let override: FwmSurface | null = null;

/** Every live watch's re-measure, so a declaration reaches subscribers. */
const remeasurers = new Set<() => void>();

/**
 * Declare the surface, or hand the decision back to the viewport with `null`.
 * Re-detects immediately and notifies every live {@link watchSurface}, because
 * a driver who pressed a switch is owed the new layout on that press and not on
 * the next resize.
 */
export function setSurfaceOverride(surface: FwmSurface | null): void {
  if (override === surface) return;
  override = surface;
  detectSurface();
  for (const remeasure of [...remeasurers]) remeasure();
}

/** What has been declared, or null when the viewport is deciding. */
export function surfaceOverride(): FwmSurface | null {
  return override;
}

/**
 * Run detection, write `data-fwm-surface` on `<html>`, and return what it
 * decided. Safe to call as often as you like; it is a pure re-measure.
 *
 * In a runtime with no DOM it writes nothing and returns {@link FALLBACK_SURFACE}
 * rather than pretending it measured something.
 */
export function detectSurface(): FwmSurface {
  if (!measurable()) return override ?? FALLBACK_SURFACE;
  const decided = runSection06Snippet();
  if (override !== null) {
    // The snippet has already written the measured answer; overwrite it, so
    // that stylesheets and the hook below never see two different verdicts.
    document.documentElement.dataset[SURFACE_DATASET_KEY] = override;
    return override;
  }
  // The snippet can only produce one of the four, but the attribute is a
  // string the devtools (or a test) can overwrite with anything. Narrow it
  // rather than assert it.
  return isFwmSurface(decided) ? decided : FALLBACK_SURFACE;
}

/** Read the attribute without re-measuring. Returns null when unset. */
export function currentSurface(): FwmSurface | null {
  if (typeof document === 'undefined' || document.documentElement === null) return null;
  const value = document.documentElement.dataset[SURFACE_DATASET_KEY];
  return isFwmSurface(value) ? value : null;
}

export type SurfaceListener = (surface: FwmSurface) => void;

export interface SurfaceWatch {
  /** The surface as of the last measurement. */
  current(): FwmSurface;
  /** Re-measure now, e.g. after entering standalone display mode. */
  refresh(): FwmSurface;
  /** Remove every listener this watch added. Idempotent. */
  stop(): void;
}

/**
 * Detect once, then re-detect on resize and on orientation change, notifying
 * `onChange` only when the decision actually changes.
 *
 * `orientationchange` is listened for as well as `resize` because Android
 * fires it before the viewport settles on some devices, and a `dash` head unit
 * that is rotated must not spend a frame rendering the phone layout.
 */
export function watchSurface(onChange?: SurfaceListener): SurfaceWatch {
  let surface = detectSurface();
  let live = true;

  const remeasure = (): void => {
    if (!live) return;
    const next = detectSurface();
    if (next === surface) return;
    surface = next;
    onChange?.(next);
  };

  const target: EventTarget | undefined =
    typeof window === 'undefined' ? undefined : (window as EventTarget);
  target?.addEventListener('resize', remeasure);
  target?.addEventListener('orientationchange', remeasure);
  /* A declared surface is not an event any window fires, so the watch is
     registered with the module as well. See `setSurfaceOverride`. */
  remeasurers.add(remeasure);

  return {
    current: () => surface,
    refresh: () => {
      remeasure();
      return surface;
    },
    stop: () => {
      if (!live) return;
      live = false;
      remeasurers.delete(remeasure);
      target?.removeEventListener('resize', remeasure);
      target?.removeEventListener('orientationchange', remeasure);
    },
  };
}
