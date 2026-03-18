/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        'primary':  '#a218ff',
        'accent':   '#ff2371',
        'navy':     '#001048',
        'dark':     '#191c26',
        'surface':  '#1e2130',
        'light':    '#f3f1ef',
        'warning':  '#ca792d',
        'danger':   '#b4190e',
        'success':  '#4d8965',
      },
    },
  },
  plugins: [],
}
