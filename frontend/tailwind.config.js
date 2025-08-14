/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
  './src/**/*.{js,ts,jsx,tsx}',
  './app/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f8ff',
          100: '#e8efff',
          200: '#cfe0ff',
          300: '#a7c3ff',
          400: '#7aa2ff',
          500: '#4d80ff',
          600: '#2b61e6',
          700: '#2049b4',
          800: '#1a3a8c',
          900: '#182f6e',
        }
      }
    },
  },
  plugins: [],
}
