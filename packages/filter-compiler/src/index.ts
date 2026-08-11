/**
 * @opsninja/filter-compiler
 *
 * Allow-listed filter AST compiler: validates JSON filter ASTs at write time
 * and compiles them to parameterized SQL predicates at read time.
 *
 * Security contract:
 *  - parseFilterAst:     structural Zod validation (no field/op semantics)
 *  - validateFilterAst:  field allow-list, operator allow-list, value schemas
 *  - compileToPredicate: pure → parameterized SQL, no user literals in sql string
 *  - computeSignature:   deterministic SHA-256 cache key
 */

export { parseFilterAst, validateFilterAst, compileToPredicate } from './compile';
export type { Predicate, CompileOptions } from './compile';

export { computeSignature, COMPILER_VERSION } from './signature';

export type {
  FilterAst,
  AstNode,
  GroupNode,
  ConditionNode,
  AstValidationError,
  ValidationResult,
  ParseResult,
} from './ast';

export {
  AstErrorCode,
  MAX_DEPTH,
  MAX_CONDITIONS,
  countConditions,
  getDepth,
} from './ast';

export type { Operator } from './operators';
export { OPERATORS } from './operators';

export type { Clock, RelativeDateToken } from './clock';
export { systemClock, RELATIVE_DATE_TOKENS, isRelativeDateToken } from './clock';

export type { FieldDef, SqlFieldType } from './field-registry';
export { FIELD_REGISTRY, getFieldDef, isKnownField } from './field-registry';
