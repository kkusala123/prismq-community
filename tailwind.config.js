/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/client/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F8FA',
        brand: {
          50: '#F2F5FA',
          100: '#E3EAF5',
          200: '#C7D6EC',
          300: '#9BB6DF',
          400: '#658ECE',
          500: '#3B6AB8',
          600: '#2554A8',
          700: '#1D448A',
          800: '#17366E',
          900: '#122B57',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        'card-hover': '0 8px 20px -6px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
};
