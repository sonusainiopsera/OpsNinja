import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import {
  parseFilterAst,
  validateFilterAst,
  compileToPredicate,
  computeSignature,
  type FilterAst,
  type Predicate,
} from '@opsninja/filter-compiler';

export interface SavedViewFilter {
  ast: FilterAst;
  signature: string;
}

export interface CompiledViewFilter {
  predicate: Predicate;
  signature: string;
}

/**
 * SavedViewService
 *
 * Validates and compiles filter ASTs for saved views.
 * All SQL generation for ticket filtering must flow through this service
 * to ensure the filter-compiler allow-list is enforced.
 */
@Injectable()
export class SavedViewService {
  /**
   * Validates a raw filter AST from user input at write time.
   * Throws BadRequestException with field-level details on validation failure.
   */
  validateAndPrepare(raw: unknown): SavedViewFilter {
    const parsed = parseFilterAst(raw);
    if (!parsed.ok) {
      throw new BadRequestException({
        message: 'Invalid filter AST structure',
        errors: parsed.errors,
      });
    }

    const validated = validateFilterAst(parsed.ast);
    if (!validated.ok) {
      throw new BadRequestException({
        message: 'Filter references unknown fields or disallowed operators',
        errors: validated.errors,
      });
    }

    return {
      ast: validated.ast,
      signature: computeSignature(validated.ast),
    };
  }

  /**
   * Compiles a stored (already validated) filter AST to a parameterized predicate.
   * Should only be called with ASTs that passed validateAndPrepare() at write time.
   * Throws InternalServerErrorException on programmer error — never leaks AST content.
   */
  compile(ast: FilterAst): CompiledViewFilter {
    try {
      const predicate = compileToPredicate(ast);
      return { predicate, signature: computeSignature(ast) };
    } catch (err: unknown) {
      const sig = computeSignature(ast);
      const message = err instanceof Error ? err.message : 'unknown';
      // Log with signature for debugging — never expose AST content
      console.error('[SavedViewService] compile error', { signature: sig, error: message });
      throw new InternalServerErrorException('Filter compilation failed');
    }
  }
}
