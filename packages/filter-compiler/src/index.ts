/**
 * @opsninja/filter-compiler — Allow-listed saved view filter AST compiler.
 *
 * Public API:
 *   parseFilterAst     — parse unknown JSON + full semantic validation
 *   validateFilterAst  — re-validate a typed FilterAst (e.g., after loading from DB)
 *   compileToPredicate — compile a valid FilterAst to parameterised SQL { sql, params }
 *   computeSignature   — stable SHA-256 cache-key hash of a FilterAst
 *
 * Security guarantees:
 *   - Unknown fields and operators are rejected at validation time.
 *   - Compilation emits only $n positional placeholders; no user literal appears in sql.
 *   - The filter-compiler has no framework dependencies and is fully unit-testable.
 */

export { parseFilterAst, validateFilterAst } from './validate';
export { compileToPredicate, type CompiledPredicate, type CompileOptions } from './compile';
export { computeSignature } from './signature';
export { SystemClock, FixedClock, RELATIVE_DATE_TOKENS, type RelativeDateToken, type Clock } from './clock';
export {
  type FilterAst,
  type FilterNode,
  type GroupNode,
  type ConditionNodeType,
  MAX_DEPTH,
  MAX_NODES,
} from './ast';
export {
  type ValidationResult,
  type ValidationError,
  type ValidationErrorCode,
  CompilerInternalError,
} from './errors';
export { FIELD_REGISTRY, type FieldName, type FieldEntry } from './field-registry';
export { OPERATORS, type Operator } from './operators';
