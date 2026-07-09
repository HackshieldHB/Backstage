import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: '#1A1D3A',
          hover: '#2C2F52',
          active: '#4A4FB5',
        },
      },
    },
  },
  plugins: [],
};

export default config;
