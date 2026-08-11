'use client';

import { useTheme } from '@opsninja/ui-kit';
import { SEMANTIC_ROLES, LIGHT_TOKENS, DARK_TOKENS } from '@opsninja/ui-kit';
import { slaStateMeta, SLA_STATES } from '@opsninja/ui-kit';

function Swatch({ role, hex }: { role: string; hex: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div
        className="h-10 w-10 rounded-md border border-border-subtle flex-shrink-0"
        style={{ backgroundColor: hex }}
        aria-hidden="true"
      />
      <div>
        <p className="text-body-sm font-medium text-primary">{role}</p>
        <p className="text-label text-muted font-mono">{hex}</p>
      </div>
    </div>
  );
}

export default function TokenShowcasePage() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const tokens = resolvedTheme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;

  return (
    <main className="min-h-screen bg-surface p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-heading-1 text-primary mb-2">Token Showcase</h1>
        <p className="text-body text-secondary mb-8">
          OpsNinja UI Kit semantic tokens — Agent Workspace
        </p>

        {/* Theme Toggle */}
        <section className="mb-10" aria-label="Theme controls">
          <h2 className="text-heading-2 text-primary mb-4">Theme</h2>
          <div className="flex gap-3">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                data-testid={`theme-${t}`}
                onClick={() => setTheme(t)}
                className={[
                  'rounded-md px-4 py-2 text-body-sm font-medium transition-colors',
                  theme === t
                    ? 'bg-accent text-accent-fg'
                    : 'bg-surface-raised text-secondary border border-border',
                ].join(' ')}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-label text-muted" data-testid="resolved-theme">
            Resolved: <strong className="text-primary">{resolvedTheme}</strong>
          </p>
        </section>

        {/* Colour Tokens */}
        <section className="mb-10" aria-label="Colour tokens">
          <h2 className="text-heading-2 text-primary mb-4">Colour Tokens</h2>
          <div className="grid-12 gap-4">
            {SEMANTIC_ROLES.map((role) => {
              const hex = tokens[role];
              if (!hex) return null;
              return (
                <div key={role} className="col-span-12 sm:col-span-6 md:col-span-4">
                  <Swatch role={role} hex={hex} />
                </div>
              );
            })}
          </div>
        </section>

        {/* SLA State Tokens */}
        <section aria-label="SLA state tokens">
          <h2 className="text-heading-2 text-primary mb-4">SLA State Tokens</h2>
          <div className="grid-12 gap-4">
            {SLA_STATES.map((state) => {
              const meta = slaStateMeta[state];
              const hex = tokens[meta.token];
              if (!hex) return null;
              return (
                <div
                  key={state}
                  data-testid={`sla-state-${state}`}
                  className="col-span-12 sm:col-span-6 md:col-span-3 rounded-lg border border-border p-4"
                >
                  <div
                    className="mb-3 h-8 w-8 rounded-full"
                    style={{ backgroundColor: hex }}
                    aria-hidden="true"
                  />
                  <p className="text-body font-medium text-primary">{meta.label}</p>
                  <p className="text-label text-muted">{meta.iconName}</p>
                  <p className="text-label text-muted font-mono">{meta.patternClass}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
