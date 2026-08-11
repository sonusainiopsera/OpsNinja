import { gray, indigo, red, amber, green, blue, white } from './primitives.js';

export const TOKENS_VERSION = '1.0.0' as const;

export const SEMANTIC_ROLES = [
  'surface',
  'surface-raised',
  'surface-sunken',
  'border-default',
  'border-subtle',
  'text-primary',
  'text-secondary',
  'text-muted',
  'text-inverse',
  'accent',
  'accent-hover',
  'accent-fg',
  'focus-ring',
  'danger',
  'warning',
  'success',
  'info',
  'sla-running',
  'sla-warning',
  'sla-paused',
  'sla-breached',
] as const;

export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

export type ThemeTokens = Record<SemanticRole, string>;

export const LIGHT_TOKENS: ThemeTokens = {
  'surface': white,
  'surface-raised': white,
  'surface-sunken': gray['100'],
  'border-default': gray['200'],
  'border-subtle': gray['100'],
  'text-primary': gray['900'],
  'text-secondary': gray['600'],
  'text-muted': gray['500'],
  'text-inverse': white,
  'accent': indigo['600'],
  'accent-hover': indigo['700'],
  'accent-fg': white,
  'focus-ring': indigo['400'],
  'danger': red['600'],
  'warning': amber['600'],
  'success': green['600'],
  'info': blue['600'],
  'sla-running': green['600'],
  'sla-warning': amber['600'],
  'sla-paused': gray['500'],
  'sla-breached': red['600'],
};

export const DARK_TOKENS: ThemeTokens = {
  'surface': gray['900'],
  'surface-raised': gray['800'],
  'surface-sunken': gray['950'],
  'border-default': gray['700'],
  'border-subtle': gray['800'],
  'text-primary': gray['50'],
  'text-secondary': gray['400'],
  'text-muted': gray['400'],
  'text-inverse': gray['900'],
  'accent': indigo['400'],
  'accent-hover': indigo['300'],
  'accent-fg': gray['900'],
  'focus-ring': indigo['300'],
  'danger': red['400'],
  'warning': amber['400'],
  'success': green['400'],
  'info': blue['400'],
  'sla-running': green['400'],
  'sla-warning': amber['400'],
  'sla-paused': gray['400'],
  'sla-breached': red['400'],
};

function buildCSSBlock(selector: string, tokens: ThemeTokens): string {
  const lines = (Object.keys(tokens) as SemanticRole[]).map(
    (role) => `  --on-color-${role}: ${tokens[role]};`,
  );
  return `${selector} {\n${lines.join('\n')}\n}`;
}

export const LIGHT_CSS = buildCSSBlock('[data-theme="light"]', LIGHT_TOKENS);
export const DARK_CSS = buildCSSBlock('[data-theme="dark"]', DARK_TOKENS);

export function getCSSVar(role: SemanticRole): string {
  return `var(--on-color-${role})`;
}
