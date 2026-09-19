/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'ambar-accent': '#0f6e51',
        'ambar-dark': '#0b3d2e',
      },
    },
  },
  plugins: [],
}
