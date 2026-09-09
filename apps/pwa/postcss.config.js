/**
 * PostCSS pipeline for the PWA.
 *
 * @tailwindcss/postcss reads apps/pwa/tailwind.config.ts (loaded by the @config
 * directive at the top of src/styles/global.css), which maps utilities onto
 * `var(--fwm-*)` only. autoprefixer targets the browserslist in this package's
 * dependency tree; the product ships to Chrome on Android and Wear OS first.
 *
 * ESM object syntax because @fwm/pwa is `"type": "module"`.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
