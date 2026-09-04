/**
 * PostCSS pipeline for the PWA.
 *
 * tailwindcss reads apps/pwa/tailwind.config.ts, which maps utilities onto
 * `var(--fwm-*)` only. autoprefixer targets the browserslist in this package's
 * dependency tree; the product ships to Chrome on Android and Wear OS first.
 *
 * ESM object syntax because @fwm/pwa is `"type": "module"`.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
