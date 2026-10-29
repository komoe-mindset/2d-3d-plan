/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f1eee6',
        ink: '#17171a',
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'monospace'],
        serif: ['"Instrument Serif"', '"Cormorant Garamond"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
