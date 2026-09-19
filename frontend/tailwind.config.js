/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'ambar-accent': '#2563eb',
        'ambar-dark': '#0f172a',
      },
    },
  },
  plugins: [],
}
