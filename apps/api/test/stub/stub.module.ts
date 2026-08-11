import { Module } from '@nestjs/common';
import { StubController } from './stub.controller';

/**
 * StubModule — included only in integration tests.
 * Provides StubController which exercises all error/pagination paths.
 */
@Module({
  controllers: [StubController],
})
export class StubModule {}
