/**
 * ReportingService — applies compiled filter predicates to reporting queries.
 *
 * Uses the same compileToPredicate from @opsninja/filter-compiler as ViewsService,
 * ensuring identical filtering semantics across queues and reports.
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

export interface CompiledReportFilter {
  predicate: CompiledPredicate;
  cacheKey: string;
}

@Injectable()
export class ReportingService {
  /**
   * Parse, validate and compile a raw filter AST for a report query.
   * Identical validation semantics to ViewsService.compileView.
   */
  compileReportFilter(rawAst: unknown): CompiledReportFilter {
    const validated = parseFilterAst(rawAst);
    if (!validated.success) {
      throw new BadRequestException({
        message: 'Invalid report filter AST',
        errors: validated.errors,
      });
    }

    const ast: FilterAst = validated.data;
    const cacheKey = `report:${computeSignature(ast)}`;

    try {
      const predicate = compileToPredicate(ast);
      return { predicate, cacheKey };
    } catch (err) {
      if (err instanceof CompilerInternalError) {
        console.error('[ReportingService] compiler internal error', {
          signature: err.signature,
          message: err.message,
        });
        throw new InternalServerErrorException('Report filter compilation failed');
      }
      throw err;
    }
  }
}
