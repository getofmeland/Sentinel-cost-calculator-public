/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      // Brand colours — source of truth is src/config/brand.ts. Mirror values here when updating.
      colors: {
        'primary':  '#a218ff',
        'accent':   '#ff2371',
        // Accessible tints for small text — the saturated brand colours fall
        // below WCAG AA against the dark surface. See brand.ts for the ratios.
        'primary-text': '#bf6bff',
        'accent-text':  '#ff6b9b',
        'navy':     '#001048',
        'dark':     '#191c26',
        'surface':  '#1e2130',
        'surface-raised': '#252838',
        'surface-inset':  '#2e3245',
        'light':    '#f3f1ef',
        'warning':  '#ca792d',
        'danger':   '#b4190e',
        'success':  '#4d8965',
      },
    },
  },
  plugins: [],
}
