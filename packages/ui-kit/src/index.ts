// Tokens
export {
  TOKENS_VERSION,
  SEMANTIC_ROLES,
  LIGHT_TOKENS,
  DARK_TOKENS,
  getCSSVar,
  type SemanticRole,
  type ThemeTokens,
} from './tokens/semantic.js';

export {
  gray,
  indigo,
  red,
  amber,
  green,
  blue,
  white,
  spacing,
  radius,
  elevation,
  type GrayScale,
  type IndigoScale,
  type SpacingStep,
  type RadiusStep,
  type ElevationStep,
} from './tokens/primitives.js';

export {
  slaStateMeta,
  SLA_STATES,
  type SlaState,
  type SlaStateDescriptor,
} from './tokens/slaStateMeta.js';

// Theme engine
export { ThemeProvider, ThemeContext } from './theme/ThemeProvider.js';
export { useTheme } from './theme/useTheme.js';
export { themeScript } from './theme/themeScript.js';
export type { ThemeChoice, ResolvedTheme, ThemeContextValue } from './theme/ThemeProvider.js';
