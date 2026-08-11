import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import {
  parseFilterAst,
  validateFilterAst,
  compileToPredicate,
  computeSignature,
  type FilterAst,
  type Predicate,
} from '@opsninja/filter-compiler';

export interface ReportFilterContext {
  ast: FilterAst;
  signature: string;
}

/**
 * ReportFilterService
 *
 * Validates and compiles filter ASTs for the report builder.
 * Shares identical filtering semantics with SavedViewService by consuming
 * the same @opsninja/filter-compiler package — there is no duplicate
 * filter SQL construction in this module.
 */
@Injectable()
export class ReportFilterService {
  /**
   * Validates a raw filter AST from user input.
   * Throws BadRequestException with structured errors on validation failure.
   */
  validateReportFilter(raw: unknown): ReportFilterContext {
    const parsed = parseFilterAst(raw);
    if (!parsed.ok) {
      throw new BadRequestException({
        message: 'Invalid report filter AST',
        errors: parsed.errors,
      });
    }

    const validated = validateFilterAst(parsed.ast);
    if (!validated.ok) {
      throw new BadRequestException({
        message: 'Report filter references unknown fields or disallowed operators',
        errors: validated.errors,
      });
    }

    return {
      ast: validated.ast,
      signature: computeSignature(validated.ast),
    };
  }

  /**
   * Compiles a validated filter AST to a parameterized predicate for query execution.
   * Throws InternalServerErrorException on programmer error — never leaks AST.
   */
  compileFilter(ast: FilterAst): Predicate {
    try {
      return compileToPredicate(ast);
    } catch (err: unknown) {
      const sig = computeSignature(ast);
      const message = err instanceof Error ? err.message : 'unknown';
      console.error('[ReportFilterService] compile error', { signature: sig, error: message });
      throw new InternalServerErrorException('Report filter compilation failed');
    }
  }
}
