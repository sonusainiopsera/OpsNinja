import type { Config } from 'tailwindcss';
import opsninjaPreset from '@opsninja/ui-kit/tailwind';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui-kit/src/**/*.{ts,tsx}',
  ],
  presets: [opsninjaPreset as Config],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
