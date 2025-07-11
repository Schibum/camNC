import { defineConfig } from 'tailwindcss';
import { heroui } from '@heroui/theme';
import tailwindcssAnimate from 'tailwindcss-animate';

export default defineConfig({
  content: ['./apps/**/*.{ts,tsx}', './packages/**/*.{ts,tsx}'],
  darkMode: 'class',
  plugins: [heroui({ prefix: '' }), tailwindcssAnimate],
});
