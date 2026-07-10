import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Left sidebar — dark indigo per spec.
        sidebar: {
          DEFAULT: '#1A1D3A',
          hover: '#2C2F52',
          active: '#4A4FB5',
          muted: '#9DA2C8',
        },
        accent: {
          DEFAULT: '#4A4FB5',
          hover: '#3D42A0',
        },
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
