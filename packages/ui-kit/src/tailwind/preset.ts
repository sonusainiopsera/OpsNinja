import type { Config } from 'tailwindcss';

function on(role: string): string {
  return `var(--on-color-${role})`;
}

const preset: Pick<Config, 'theme' | 'plugins'> = {
  theme: {
    extend: {
      colors: {
        // Surface backgrounds: bg-surface, bg-surface-raised, bg-surface-sunken
        surface: {
          DEFAULT: on('surface'),
          raised: on('surface-raised'),
          sunken: on('surface-sunken'),
        },
        // Text / foreground colours: text-primary, text-secondary, text-muted, text-inverse
        primary: on('text-primary'),
        secondary: on('text-secondary'),
        muted: on('text-muted'),
        inverse: on('text-inverse'),
        // Borders: border-subtle (for border-subtle utility)
        subtle: on('border-subtle'),
        // Accent interactive: bg-accent, text-accent, border-accent
        accent: {
          DEFAULT: on('accent'),
          hover: on('accent-hover'),
          fg: on('accent-fg'),
        },
        // Focus ring: ring-focus
        focus: on('focus-ring'),
        // Status: text-danger, bg-danger, text-warning, etc.
        danger: on('danger'),
        warning: on('warning'),
        success: on('success'),
        info: on('info'),
        // SLA: text-sla-running, bg-sla-breached, etc.
        sla: {
          running: on('sla-running'),
          warning: on('sla-warning'),
          paused: on('sla-paused'),
          breached: on('sla-breached'),
        },
      },
      borderColor: {
        DEFAULT: on('border-default'),
        subtle: on('border-subtle'),
      },
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '7': '28px',
        '8': '32px',
        '9': '36px',
        '10': '40px',
        '11': '44px',
        '12': '48px',
        '14': '56px',
        '16': '64px',
        '20': '80px',
        '24': '96px',
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
        xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
        none: 'none',
      },
      fontFamily: {
        sans: ['Inter var', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Display — hero, marketing banners
        'display': ['2.25rem', { lineHeight: '2.5rem', fontWeight: '700', letterSpacing: '-0.025em' }],
        // Headings — h1 aliases provided for convenience
        'heading-1': ['1.875rem', { lineHeight: '2.25rem', fontWeight: '700', letterSpacing: '-0.025em' }],
        'heading-2': ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
        'heading-3': ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        // Body copy
        'body': ['1rem', { lineHeight: '1.5rem', fontWeight: '400' }],
        'body-sm': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400' }],
        // Labels, captions, metadata
        'label': ['0.75rem', { lineHeight: '1rem', fontWeight: '500', letterSpacing: '0.025em' }],
        // Code / monospace
        'mono': ['0.875rem', { lineHeight: '1.5rem', fontWeight: '400' }],
      },
    },
  },
  plugins: [
    // 12-column grid helper: class="grid-12"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function gridPlugin({ addComponents }: { addComponents: (c: Record<string, Record<string, string>>) => void }) {
      addComponents({
        '.grid-12': {
          display: 'grid',
          gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
          gap: '1.5rem',
        },
      });
    },
  ],
};

export default preset;
