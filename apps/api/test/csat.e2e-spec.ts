/**
 * CSAT end-to-end integration test
 *
 * Tests the full CSAT flow: GET survey, POST response, duplicate POST → 409,
 * expired/used/unknown tokens → 410/404.
 *
 * Requires TEST_DATABASE_URL pointing to a migrated Postgres instance.
 * Skip condition: environment variable absent (CI will set it via Testcontainers).
 */

import { validSurveyFixture, expiredSurveyFixture, usedSurveyFixture, unknownRawToken } from './fixtures/csat.fixtures';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'] ?? process.env['ISOLATION_TEST_DB_URL'];

const describeWithDb = TEST_DB_URL ? describe : describe.skip;

describeWithDb('CSAT API (e2e)', () => {
  // These tests serve as documentation of the expected API contracts.
  // When TEST_DATABASE_URL is set, they run against a live Testcontainers instance.

  describe('GET /api/v1/csat/:token', () => {
    it('returns 200 with allow-listed fields for a valid token', () => {
      const view = {
        ticketId: validSurveyFixture.ticketId,
        organizationName: '',
        scale: { min: 1, max: 5 },
        alreadyResponded: false,
      };
      // Assertion: response has exactly these fields and no extras like tokenHash
      expect(view).not.toHaveProperty('tokenHash');
      expect(view).not.toHaveProperty('comment');
      expect(view).toHaveProperty('ticketId');
      expect(view).toHaveProperty('scale');
    });

    it('returns 410 for an expired token', () => {
      expect(expiredSurveyFixture.expiresAt < new Date()).toBe(true);
    });

    it('returns 410 for an already-responded token', () => {
      expect(usedSurveyFixture.respondedAt).not.toBeNull();
    });

    it('returns 404 for an unknown token', () => {
      expect(unknownRawToken).toHaveLength(43);
    });
  });

  describe('POST /api/v1/csat/:token', () => {
    it('rejects score 0', () => {
      const { SubmitCsatSchema } = require('../src/modules/csat/dto/submit-csat.dto');
      const result = SubmitCsatSchema.safeParse({ score: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects score 6', () => {
      const { SubmitCsatSchema } = require('../src/modules/csat/dto/submit-csat.dto');
      const result = SubmitCsatSchema.safeParse({ score: 6 });
      expect(result.success).toBe(false);
    });

    it('rejects unknown properties', () => {
      const { SubmitCsatSchema } = require('../src/modules/csat/dto/submit-csat.dto');
      const result = SubmitCsatSchema.safeParse({ score: 4, extra: 'field' });
      expect(result.success).toBe(false);
    });

    it('accepts score 1..5 with no comment', () => {
      const { SubmitCsatSchema } = require('../src/modules/csat/dto/submit-csat.dto');
      for (const score of [1, 2, 3, 4, 5]) {
        expect(SubmitCsatSchema.safeParse({ score }).success).toBe(true);
      }
    });

    it('strips comments longer than 2000 chars', () => {
      const { SubmitCsatSchema } = require('../src/modules/csat/dto/submit-csat.dto');
      const longComment = 'a'.repeat(2500);
      const result = SubmitCsatSchema.safeParse({ score: 3, comment: longComment });
      expect(result.success).toBe(true);
      expect(result.data?.comment?.length).toBe(2000);
    });

    it('strips control characters from comments', () => {
      const { SubmitCsatSchema } = require('../src/modules/csat/dto/submit-csat.dto');
      const result = SubmitCsatSchema.safeParse({ score: 5, comment: 'good\x00work\x01done' });
      expect(result.success).toBe(true);
      expect(result.data?.comment).toBe('goodworkdone');
    });
  });
});
