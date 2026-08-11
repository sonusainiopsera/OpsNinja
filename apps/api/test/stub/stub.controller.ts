import { Controller, Get, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ListEnvelope } from '@opsninja/shared';
import {
  buildListEnvelope,
  applyLimitCap,
  decodeCursor,
  encodeCursor,
} from '@opsninja/shared';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsninja/shared';
import { ZodValidationPipe } from '../../src/common/pipes/zod-validation.pipe';
import { NotFoundError, UnauthorizedError, ForbiddenError, ConflictError, UnprocessableEntityError, RateLimitError } from '../../src/common/errors/app-error';
import {
  StubListQuerySchema,
  StubItemSchema,
  type StubItem,
  type StubListQuery,
} from '../fixtures/dto.fixtures';

/** Static fixture items for list endpoint tests. */
const FIXTURE_ITEMS: StubItem[] = Array.from({ length: 5 }, (_, i) => ({
  id: `item-${String(i + 1).padStart(3, '0')}`,
  title: `Fixture Item ${i + 1}`,
  priority: 'medium' as const,
}));

/**
 * StubController — only included in the test AppModule.
 * Provides endpoints that exercise all HTTP status codes and pagination
 * without any domain logic.
 */
@ApiTags('__test_stub__')
@Controller('stub')
export class StubController {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  /** Returns a 404 envelope — tests exception filter mapping. */
  @Get('not-found')
  notFound(): never {
    throw new NotFoundError('stub-resource', 'fixture-id');
  }

  /** Returns a 401 envelope. */
  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedError();
  }

  /** Returns a 403 envelope. */
  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenError();
  }

  /** Returns a 409 envelope. */
  @Get('conflict')
  conflict(): never {
    throw new ConflictError();
  }

  /** Returns a 422 envelope. */
  @Get('unprocessable')
  unprocessable(): never {
    throw new UnprocessableEntityError('Business rule violated in stub');
  }

  /** Returns a 429 envelope with Retry-After header. */
  @Get('rate-limited')
  rateLimited(): never {
    throw new RateLimitError(60);
  }

  /**
   * Validates a query DTO — returns 400 on invalid input, 200 on valid input.
   * Used to verify the Zod validation pipe integration end-to-end.
   */
  @Get('validate')
  @ApiOperation({ summary: 'Stub endpoint that validates a DTO via ZodValidationPipe' })
  validateDto(
    @Query(new ZodValidationPipe(StubItemSchema.partial().required({ id: true, title: true })))
    query: Pick<StubItem, 'id' | 'title'>,
  ): Pick<StubItem, 'id' | 'title'> {
    return query;
  }

  /**
   * Paginated list endpoint — returns fixture items with cursor pagination.
   * Supports two pages of results so integration tests can verify cursor traversal.
   */
  @Get('list')
  @HttpCode(200)
  list(
    @Query(new ZodValidationPipe(StubListQuerySchema)) query: StubListQuery,
  ): ListEnvelope<StubItem> {
    const secret = this.configService.get('HMAC_SECRET', { infer: true });
    const limit = applyLimitCap(query.limit);

    let startIndex = 0;
    if (query.cursor) {
      const payload = decodeCursor(query.cursor, secret);
      const cursorIndex = FIXTURE_ITEMS.findIndex((item) => item.id === payload.id);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const pageItems = FIXTURE_ITEMS.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < FIXTURE_ITEMS.length;
    const lastItem = pageItems[pageItems.length - 1];

    return buildListEnvelope(
      pageItems,
      hasMore,
      lastItem,
      (item) => ({ id: item.id }),
      secret,
    );
  }
}
