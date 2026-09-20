/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'ambar-accent': '#ff7300',
        'ambar-dark': '#2e3636',
      },
    },
  },
  plugins: [],
}
