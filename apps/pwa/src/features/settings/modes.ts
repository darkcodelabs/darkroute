/**
 * The six theme modes, exactly as section 05 names them.
 *
 * SOURCE: `Flockys Design System.dc.html` section 05, `Theme modes` --
 * "6 skins · same tokens, remapped". Each card in that section carries a title
 * and one right-aligned mono badge; both strings below are read off the card,
 * not written here.
 *
 *   Night watch    DEFAULT
 *   Neon grid      80s CYBERPUNK
 *   Cartridge 96   90s INFOTAINMENT
 *   Pursuit        SCANNER
 *   Cluster        80s MOVIE DASH
 *   Dash cast      PHONE-PROJECTED HEAD UNIT · 800×480 LANDSCAPE
 *
 * =============================================================================
 * THIS FILE DECIDES NOTHING ABOUT WHICH MODE IS ACTIVE
 * =============================================================================
 * `app/mode.ts` owns that, and it owns the rule that matters:
 *
 *   "Night Watch is the fallback and the only mode allowed on the always-on
 *    watch face."   -- section 05
 *
 * `resolveMode()` forces `night-watch` on `watch-round` and `watch-square` and
 * reports `reason: 'forced-watch'` when it did. SETTINGS renders that reason
 * rather than pretending the user's pick took -- a picker that silently ignores
 * a press is worse than one that says why it cannot honour it.
 *
 * The order is `FWM_MODES`', which is section 05's order, which puts
 * `night-watch` first because it is the default rather than because it sorts
 * first.
 */

import { DEFAULT_MODE } from '../../app/mode.ts';
import type { FwmMode } from '../../app/mode.ts';

export interface ModeChoice {
  readonly mode: FwmMode;
  /** The card title, in section 05's own casing. */
  readonly name: string;
  /** The card's mono badge. Never a sentence this file wrote. */
  readonly badge: string;
}

const MODE_COPY: Readonly<Record<FwmMode, { readonly name: string; readonly badge: string }>> =
  Object.freeze({
    // Its badge used to read DEFAULT, which was a STATUS and not a card name -
    // and it stopped being true the day slate became the first-launch look. What
    // is permanently true of this one is the token block: no glow, no shadow,
    // lowest power draw, which is why `ALWAYS_ON_MODE` forces it on a watch face
    // whatever the driver picked. The DEFAULT marker is derived below instead.
    'night-watch': { name: 'Night watch', badge: 'NO GLOW · ALWAYS-ON WATCH' },
    'neon-grid': { name: 'Neon grid', badge: '80s CYBERPUNK' },
    'cartridge-96': { name: 'Cartridge 96', badge: '90s INFOTAINMENT' },
    pursuit: { name: 'Pursuit', badge: 'SCANNER' },
    cluster: { name: 'Cluster', badge: '80s MOVIE DASH' },
    'dash-cast': {
      name: 'Dash cast',
      badge: 'PHONE-PROJECTED HEAD UNIT · 800×480 LANDSCAPE',
    },
    // Added in "DarkRoute Design System 80sv3". Names and badges are the
    // design's own, read off its mode cards rather than written here.
    aurora: { name: 'Aurora', badge: '2026 SOFT GLOW' },
    refinement: { name: 'Refinement', badge: 'RETRO-INSTITUTIONAL' },
    /**
     * The only badge here this file wrote rather than read off a mode card,
     * because there is no card: e-ink was asked for directly. It names the
     * hardware rather than a decade, which is also the honest description --
     * every value in its token block follows from what an e-paper panel can
     * physically do. GAP: docs/gaps-inbox/settings.md#e-ink-mode-is-not-drawn
     */
    'e-ink': { name: 'E-ink', badge: 'GREYSCALE · NO GLOW' },
    // v1's own four. Names are the design file's; the badges say what each
    // palette is for rather than which decade it came from, because v1's
    // themes are not period pieces.
    slate: { name: 'Slate', badge: 'COOL · LOW CONTRAST' },
    carbon: { name: 'Carbon', badge: 'NEUTRAL · AMBER ACCENT' },
    violet: { name: 'Violet', badge: 'DARK · SOFT' },
    paper: { name: 'Paper', badge: 'WARM LIGHT · NO GLOW' },
    // Four more, added because v1's set had one warm option and it was the
    // light one. Badges say the condition each is for, in the same voice.
    ember: { name: 'Ember', badge: 'WARM DARK · LOW BLUE' },
    tide: { name: 'Tide', badge: 'DEEP BLUE · HIGH CONTRAST' },
    moss: { name: 'Moss', badge: 'EARTH · QUIET' },
    sodium: { name: 'Sodium', badge: 'AMBER MONOCHROME · NIGHT VISION' },
  });

/**
 * THE MODES EACH DESIGN OFFERS.
 *
 * Not the same list, and that is the point. v0's nine are period skins built
 * around its instrument panel; v1's seven are the design file's own palettes.
 * One storage field, two pickers - a driver who chooses Slate in v1 and
 * switches to v0 gets night watch, because Slate is not a v0 theme and v0 has
 * no palette for it.
 */
export const V0_MODES: readonly FwmMode[] = Object.freeze([
  'night-watch',
  'neon-grid',
  'cartridge-96',
  'pursuit',
  'cluster',
  'dash-cast',
  'aurora',
  'refinement',
  'e-ink',
]);

/**
 * v1's set: the design file's seven, then four added after them.
 *
 * Order is deliberate. The design's own seven keep their order and their
 * position, so a driver who knew where their theme was still finds it there;
 * the additions go on the end rather than being interleaved by hue.
 */
export const V1_MODES: readonly FwmMode[] = Object.freeze([
  'night-watch',
  'slate',
  'carbon',
  'violet',
  'e-ink',
  'refinement',
  'paper',
  'ember',
  'tide',
  'moss',
  'sodium',
]);

/**
 * The RETIRED picker's list, and it is left pointing at `V0_MODES` on purpose.
 *
 * `MODE_CHOICES` feeds `ModePicker` and `SettingsView`, which v0 rendered.
 * The shipping screen is `SettingsViewV1`, which maps `V1_MODES` itself and
 * never reads this. Repointing it at the live list churns five v0 test files
 * for no change a driver can see.
 *
 * The DEFAULT badge therefore lands wherever the current default happens to
 * sit in this retired list. It was `slate`, which is absent here, so for a day
 * nothing carried the badge at all; it is `neon-grid` now, which IS one of the
 * modes this picker offered, so exactly one entry carries it. Neither state is
 * a gap - the badge is a function of the default, not a property of the list.
 *
 * The DEFAULT badge is DERIVED from `DEFAULT_MODE` rather than transcribed onto
 * one entry, for the same reason the caption below derives its count: a marker
 * hand-typed onto a mode is a claim that goes quietly stale the moment the
 * default moves, on a screen whose whole job is telling the truth about state.
 * It moved once already.
 *
 * Every other badge is still read off its card rather than written here.
 */
export const MODE_CHOICES: readonly ModeChoice[] = Object.freeze(
  V0_MODES.map((mode) =>
    Object.freeze({
      mode,
      name: MODE_COPY[mode].name,
      badge: mode === DEFAULT_MODE ? 'DEFAULT' : MODE_COPY[mode].badge,
    }),
  ),
);

/**
 * Section 05's own strapline, with the count DERIVED rather than transcribed.
 *
 * It read "6 skins" until v3 added two, at which point a hand-typed number
 * would have been quietly wrong on a screen whose whole job is telling the
 * truth about state. The rest of the sentence is the design's.
 */
export const MODE_SECTION_CAPTION = `${String(V0_MODES.length)} skins · same tokens, remapped`;

/**
 * What SETTINGS says when the watch rule has overridden the pick.
 *
 * Section 05 states the rule; `app/mode.ts` enforces it and hands back
 * `reason: 'forced-watch'`. This is the sentence that reason renders as, in the
 * product's lowercase voice.
 * GAP: see docs/gaps-inbox/settings.md#forced-watch-copy-is-not-drawn
 */
export const FORCED_WATCH_NOTICE = 'night watch is the only mode an always-on watch face may use.';
