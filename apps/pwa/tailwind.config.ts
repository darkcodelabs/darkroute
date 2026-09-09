import type { Config } from 'tailwindcss';

/**
 * Tailwind theme = a NAMED VIEW OVER apps/pwa/src/styles/tokens.css.
 *
 * HARD RULE: every value in this file is `var(--fwm-*)`. Not one literal token
 * value is duplicated here. That is what makes the six mode blocks and the four
 * surface blocks in tokens.css work — a mode swaps the variable, and every
 * Tailwind utility that reads it changes with no rebuild and no class churn.
 *
 * Consequences, on purpose:
 *  - The theme REPLACES Tailwind's defaults for every family it owns, so there
 *    is no `text-red-500` and no `p-5` to reach for. If a utility does not
 *    exist, the value is not in the design system.
 *  - Arbitrary values (`text-[13px]`) and `hover:` variants are rejected by
 *    scripts/check-design-values.mjs. Touch surfaces have no hover state.
 *  - Opacity modifiers (`bg-surface-1/50`) do NOT work with bare var() colors.
 *    That is acceptable: opacity is not a token family here.
 */

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // packages/core and packages/api-client may ship class names too.
    '../../packages/*/src/**/*.{ts,tsx}',
  ],

  theme: {
    // --- colour -----------------------------------------------------------
    // `transparent` / `current` / `inherit` are CSS keywords, not design
    // values, and are kept so layout code does not need an escape hatch.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',

      bg: 'var(--fwm-bg)',
      'bg-sunken': 'var(--fwm-bg-sunken)',
      'surface-1': 'var(--fwm-surface-1)',
      'surface-2': 'var(--fwm-surface-2)',
      line: 'var(--fwm-line)',
      'line-strong': 'var(--fwm-line-strong)',

      text: 'var(--fwm-text)',
      'text-2': 'var(--fwm-text-2)',
      'text-muted': 'var(--fwm-text-muted)',
      'text-disabled': 'var(--fwm-text-disabled)',

      // Hue means alert state and nothing else. Never use these for decoration.
      'alert-clear': 'var(--fwm-alert-clear)',
      'alert-approaching': 'var(--fwm-alert-approaching)',
      'alert-in-range': 'var(--fwm-alert-in-range)',
      'alert-multiple': 'var(--fwm-alert-multiple)',

      'accent-scan': 'var(--fwm-accent-scan)',
      'accent-mesh': 'var(--fwm-accent-mesh)',
      destructive: 'var(--fwm-destructive)',
    },

    // --- type -------------------------------------------------------------
    fontFamily: {
      // Each var already carries its own fallback stack, so these stay
      // single-element arrays; Tailwind must not comma-join anything.
      ui: ['var(--fwm-font-ui)'],
      data: ['var(--fwm-font-data)'],
    },
    fontSize: {
      hero: 'var(--fwm-text-hero)',
      readout: 'var(--fwm-text-readout)',
      title: 'var(--fwm-text-title)',
      subtitle: 'var(--fwm-text-subtitle)',
      body: 'var(--fwm-text-body)',
      micro: 'var(--fwm-text-micro)',
    },
    // No lineHeight / letterSpacing families: the token set does not define
    // them. See docs/gaps-inbox/repo-tooling.md#type-metrics-not-tokenized.

    // --- space ------------------------------------------------------------
    // '0' is dimensionless zero, not a design value, so it is not a token.
    spacing: {
      '0': '0',
      '1': 'var(--fwm-space-1)',
      '2': 'var(--fwm-space-2)',
      '3': 'var(--fwm-space-3)',
      '4': 'var(--fwm-space-4)',
      '6': 'var(--fwm-space-6)',
      '8': 'var(--fwm-space-8)',
      '12': 'var(--fwm-space-12)',
      // Structural sizes, usable as w-/h-/p-/m-/gap-.
      'touch-min': 'var(--fwm-touch-min)',
      'nav-h': 'var(--fwm-nav-h)',
      'nav-w': 'var(--fwm-nav-w)',
      'header-h': 'var(--fwm-header-h)',
    },

    borderRadius: {
      '0': 'var(--fwm-radius-0)',
      '1': 'var(--fwm-radius-1)',
      '2': 'var(--fwm-radius-2)',
      full: 'var(--fwm-radius-full)',
    },

    // --- motion -----------------------------------------------------------
    transitionDuration: {
      instant: 'var(--fwm-dur-instant)',
      fast: 'var(--fwm-dur-fast)',
      base: 'var(--fwm-dur-base)',
      alert: 'var(--fwm-dur-alert)',
    },
    transitionTimingFunction: {
      out: 'var(--fwm-ease-out)',
      mech: 'var(--fwm-ease-mech)',
    },
    // The five keyframes (fwmSweep / fwmPulse / fwmRing / fwmScan / fwmVoice)
    // live in src/styles/global.css, not here: their published durations
    // (2.4s, 1.6s, 1.1s, .6s-1.3s) have no matching token, so mapping them into
    // an `animation` family would mean inventing values.
    // See DESIGN-GAPS.md#animations-are-not-tokens.

    boxShadow: {
      'glow-alert': 'var(--fwm-glow-alert)',
      none: 'none',
    },

    extend: {},
  },

  plugins: [],
};

export default config;
