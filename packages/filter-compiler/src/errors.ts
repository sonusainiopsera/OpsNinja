/**
 * Typed validation error structures returned from parseFilterAst / validateFilterAst.
 * Never throws — validation always returns a typed result.
 */

export interface ValidationError {
  /** Dot-separated path to the offending node, e.g. "children[0].value" */
  path: string;
  message: string;
  /** Optional machine-readable code for downstream 400 responses */
  code: ValidationErrorCode;
}

export type ValidationErrorCode =
  | 'UNKNOWN_FIELD'
  | 'OPERATOR_NOT_ALLOWED'
  | 'INVALID_VALUE'
  | 'DEPTH_EXCEEDED'
  | 'NODE_COUNT_EXCEEDED'
  | 'EMPTY_IN_ARRAY'
  | 'INVALID_STRUCTURE';

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

/** Programmer-error thrown by compile() when called on an already-validated AST that hits an internal inconsistency. */
export class CompilerInternalError extends Error {
  constructor(
    message: string,
    public readonly signature: string,
  ) {
    super(message);
    this.name = 'CompilerInternalError';
  }
}
