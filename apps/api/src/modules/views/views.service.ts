/**
 * ViewsService — applies compiled filter predicates to ticket queries.
 *
 * This service is the ONLY location in apps/api that calls compileToPredicate.
 * All filter SQL for saved views is constructed here, never in handler code.
 */

import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';

import {
  parseFilterAst,
  compileToPredicate,
  computeSignature,
  CompilerInternalError,
  type FilterAst,
  type CompiledPredicate,
} from '@opsninja/filter-compiler';

export interface CompiledView {
  predicate: CompiledPredicate;
  cacheKey: string;
}

@Injectable()
export class ViewsService {
  /**
   * Parse, validate and compile a raw filter AST payload.
   * Returns a CompiledView ready for use in a Drizzle where() clause.
   * @throws BadRequestException with field-level errors on validation failure.
   * @throws InternalServerErrorException on compiler internal error (500, no AST leaked).
   */
  compileView(rawAst: unknown): CompiledView {
    const validated = parseFilterAst(rawAst);
    if (!validated.success) {
      throw new BadRequestException({
        message: 'Invalid filter AST',
        errors: validated.errors,
      });
    }

    const ast: FilterAst = validated.data;
    const cacheKey = `view:${computeSignature(ast)}`;

    try {
      const predicate = compileToPredicate(ast);
      return { predicate, cacheKey };
    } catch (err) {
      if (err instanceof CompilerInternalError) {
        // Log signature only — never log AST content
        console.error('[ViewsService] compiler internal error', {
          signature: err.signature,
          message: err.message,
        });
        throw new InternalServerErrorException('Filter compilation failed');
      }
      throw err;
    }
  }
}
